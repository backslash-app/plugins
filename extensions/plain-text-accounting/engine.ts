// The journal on disk and the program that reads it (hledger, ledger or bean-query).

import { type Context, exec, Icons, type Item } from "@backslash/api";
import {
  appendTxn,
  type Balance,
  balancesOf,
  BEAN_BALANCES,
  beanPostingsQuery,
  chooseEngine,
  type EngineId,
  expandHome,
  hledgerBalanceArgs,
  hledgerPrintArgs,
  journalRank,
  ledgerCsvArgs,
  mainCommodity,
  parseBeanBalances,
  parseBeanPostings,
  parseHledgerBalance,
  parseHledgerPrint,
  parseLedgerCsv,
  type Styles,
  tildify,
  type Txn,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

/** Where journals are looked for, the same list as `[permissions]`. */
export const ALLOWED = [
  "~/.hledger.journal",
  "~/.ledger",
  "~/finance",
  "~/Finance",
  "~/finances",
  "~/ledger",
  "~/Ledger",
  "~/accounting",
  "~/Accounting",
  "~/beancount",
  "~/Beancount",
  "~/Documents/finance",
  "~/Documents/Finance",
  "~/Documents/ledger",
  "~/Documents/accounting",
  "~/Documents/beancount",
];

export const PROGRAM: Record<EngineId, string> = { hledger: "hledger", ledger: "ledger", beancount: "bean-query" };
export const ENGINE_TITLE: Record<EngineId, string> = { hledger: "hledger", ledger: "Ledger", beancount: "Beancount" };

export class SetupError extends Error {}

export interface Journal {
  file: string;
  engine: EngineId;
  /** Default commodity for new entries (preference), may be empty. */
  commodity: string;
  depth: number;
}

const isFile = async (path: string) => {
  try {
    return (await Deno.stat(path)).isFile;
  } catch (e) {
    // Outside the folders this extension may read: the program can still read it.
    return e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied;
  }
};

async function findJournal(): Promise<string | undefined> {
  const env = Deno.env.get("LEDGER_FILE");
  if (env && await isFile(expandHome(env, HOME))) return expandHome(env, HOME);
  for (const c of ALLOWED) {
    const path = expandHome(c, HOME);
    try {
      const stat = await Deno.stat(path);
      if (stat.isFile) return path;
      if (!stat.isDirectory) continue;
      const names: string[] = [];
      for await (const e of Deno.readDir(path)) if (e.isFile && journalRank(e.name) >= 0) names.push(e.name);
      names.sort((a, b) => journalRank(a) - journalRank(b) || a.localeCompare(b));
      if (names[0]) return `${path}/${names[0]}`;
    } catch { /* missing */ }
  }
  return undefined;
}

async function installed(program: string): Promise<boolean> {
  try {
    await new Deno.Command(program, { args: ["--version"], stdout: "null", stderr: "null" }).output();
    return true;
  } catch {
    return false;
  }
}

export async function journal(ctx: Pick<Context, "preferences">): Promise<Journal> {
  const p = ctx.preferences;
  const pref = String(p.journal ?? "").trim();
  const file = pref ? expandHome(pref, HOME) : await findJournal();
  if (!file) {
    throw new SetupError(
      "No journal found: set its path in Settings → Extensions → Plain Text Accounting (or LEDGER_FILE)",
    );
  }
  const enginePref = String(p.engine ?? "auto");
  const engine = chooseEngine(enginePref, file, enginePref === "auto" ? await installed("hledger") : false);
  const depth = Number(p.depth ?? 2);
  return {
    file,
    engine,
    commodity: String(p.commodity ?? "").trim(),
    depth: Number.isFinite(depth) && depth >= 1 ? Math.min(depth, 6) : 2,
  };
}

async function tool(j: Journal, args: string[], signal?: AbortSignal): Promise<string> {
  const program = PROGRAM[j.engine];
  try {
    return await exec(program, args, { signal });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new SetupError(
        `${program} is not installed: install the ${
          j.engine === "beancount" ? "beancount and beanquery packages (pip install beanquery)" : `${program} package`
        }, or pick another tool in Settings`,
      );
    }
    const message = (e as Error).message.replace(/^[\w-]+ exited with \d+: /, "");
    throw new Error(
      `${ENGINE_TITLE[j.engine]} could not read ${tildify(j.file, HOME)}: ${message.split("\n").slice(0, 4).join(" ")}`,
    );
  }
}

/** Transactions from a day on (all of them without `from`). */
export async function transactions(j: Journal, styles: Styles, from?: string, signal?: AbortSignal): Promise<Txn[]> {
  switch (j.engine) {
    case "hledger":
      return parseHledgerPrint(await tool(j, hledgerPrintArgs(j.file, from), signal), styles);
    case "ledger":
      return parseLedgerCsv(await tool(j, ledgerCsvArgs(j.file, from), signal), styles);
    case "beancount":
      return parseBeanPostings(
        await tool(j, ["-f", "csv", j.file, beanPostingsQuery(from ?? "1900-01-01")], signal),
        styles,
      );
  }
}

/** Account balances, and the totals of each top-level account. */
export async function balances(
  j: Journal,
  styles: Styles,
  signal?: AbortSignal,
): Promise<{ rows: Balance[]; tops?: Balance[] }> {
  switch (j.engine) {
    case "hledger": {
      const [rows, tops] = await Promise.all([
        tool(j, hledgerBalanceArgs(j.file), signal),
        tool(j, hledgerBalanceArgs(j.file, 1), signal),
      ]);
      return { rows: parseHledgerBalance(rows, styles), tops: parseHledgerBalance(tops, styles) };
    }
    case "ledger":
      return { rows: balancesOf(parseLedgerCsv(await tool(j, ledgerCsvArgs(j.file), signal), styles)) };
    case "beancount":
      return { rows: parseBeanBalances(await tool(j, ["-f", "csv", j.file, BEAN_BALANCES], signal), styles) };
  }
}

/** The commodity new entries use: the preference, else the one the journal uses most. */
export const commodityFor = (j: Journal, txns: Txn[]) =>
  j.commodity || mainCommodity(txns, j.engine === "beancount" ? "USD" : "$");

/**
 * Appends an entry, then has the tool read the journal again: when it can't,
 * the journal is put back as it was and the tool's error is shown.
 */
export async function append(j: Journal, entry: string): Promise<void> {
  let before: string;
  try {
    before = await Deno.readTextFile(j.file).catch((e) => {
      if (e instanceof Deno.errors.NotFound) return "";
      throw e;
    });
    await Deno.writeTextFile(j.file, appendTxn(before, entry));
  } catch (e) {
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new Error(
        `${tildify(j.file, HOME)} is outside the folders this extension may write (${ALLOWED.join(", ")}): ` +
          "use Copy Entry instead and paste it in your journal",
      );
    }
    throw e;
  }
  if (j.engine === "beancount") return; // bean-query reports errors without failing: nothing reliable to check.
  try {
    const date = entry.slice(0, 10);
    await tool(j, j.engine === "hledger" ? hledgerPrintArgs(j.file, date) : ledgerCsvArgs(j.file, date));
  } catch (e) {
    await Deno.writeTextFile(j.file, before);
    throw new Error(`The entry was not added: ${(e as Error).message}`);
  }
}

export function setupItems(e: SetupError): Item[] {
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Plain Text Accounting",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## Plain text accounting",
        "",
        "This extension reads your journal with the tool you already use:",
        "",
        "- **hledger** (`.journal`, `.hledger`): `hledger print` and `hledger balance` in JSON",
        "- **Ledger** (`.ledger`, `.dat`): `ledger csv`",
        "- **Beancount** (`.beancount`, `.bean`): `bean-query` (from the beanquery package)",
        "",
        "Set **Journal** to your main file, or leave it empty to use `LEDGER_FILE` or the first journal",
        "found in one of these places, the only ones new entries can be written to:",
        "",
        ...ALLOWED.map((a) => `- \`${a}\``),
      ].join("\n"),
    },
    actions: [],
  }];
}

/** Runs `load`, turning setup problems into the help row. */
export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e);
    throw e;
  }
}
