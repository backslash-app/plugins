// Running the vault or bao CLI with the user's own token and address, and turning its failures into setup rows.

import { action, close, copy, Icons, type Item, open, refresh } from "@backslash/api";
import {
  classifyError,
  cleanError,
  DEFAULT_ADDRESS,
  type ErrorKind,
  normalizeAddress,
  PRODUCT,
  type Program,
} from "./lib.ts";
import { holdOpen, runInTerminal } from "./terminal.ts";

export interface Prefs {
  program?: string;
  address?: string;
  namespace?: string;
  terminal?: string;
}

const env = (name: string) => {
  try {
    return Deno.env.get(name)?.trim() || undefined;
  } catch {
    return undefined;
  }
};

export class VaultError extends Error {
  constructor(message: string, readonly kind: ErrorKind | "missing", readonly detail = "") {
    super(message);
  }
}

export interface Cli {
  program: Program;
  /** The server the CLI talks to, for the UI links. */
  address: string;
  /** Where the address comes from: the preferences, VAULT_ADDR / BAO_ADDR, or the CLI's default. */
  addressSource: string;
  /** Variables added to the CLI's environment (from the preferences). */
  env: Record<string, string>;
  /** VAULT_TOKEN / BAO_TOKEN set, or the token helper (~/.vault-token). */
  tokenSource: string;
  terminal?: string;
}

async function installed(program: Program): Promise<boolean> {
  try {
    const out = await new Deno.Command(program, { args: ["version"], stdout: "null", stderr: "null" }).output();
    return out.success;
  } catch {
    return false;
  }
}

let detected: Promise<Program | undefined> | undefined;

/** The CLI to use: the preferred one, else vault, else bao. */
export async function cli(prefs: Prefs): Promise<Cli> {
  const wanted = String(prefs.program ?? "").trim().toLowerCase();
  let program: Program | undefined;
  if (wanted === "vault" || wanted === "bao") program = wanted;
  else if (wanted === "openbao") program = "bao";
  else {
    program = await (detected ??= (async () =>
      (await installed("vault")) ? "vault" : (await installed("bao")) ? "bao" : undefined)());
  }
  if (!program) throw new VaultError("Neither vault nor bao is installed", "missing");
  const extra: Record<string, string> = {};
  const fromPrefs = normalizeAddress(prefs.address);
  const fromEnv = program === "bao" ? env("BAO_ADDR") ?? env("VAULT_ADDR") : env("VAULT_ADDR");
  if (fromPrefs) {
    extra.VAULT_ADDR = fromPrefs;
    extra.BAO_ADDR = fromPrefs;
  }
  const namespace = String(prefs.namespace ?? "").trim();
  if (namespace) {
    extra.VAULT_NAMESPACE = namespace;
    extra.BAO_NAMESPACE = namespace;
  }
  const tokenVar = program === "bao" && env("BAO_TOKEN") ? "BAO_TOKEN" : env("VAULT_TOKEN") ? "VAULT_TOKEN" : "";
  return {
    program,
    address: fromPrefs || normalizeAddress(fromEnv) || DEFAULT_ADDRESS,
    addressSource: fromPrefs
      ? "Preferences"
      : fromEnv
      ? program === "bao" && env("BAO_ADDR") ? "BAO_ADDR" : "VAULT_ADDR"
      : "CLI default",
    env: extra,
    tokenSource: tokenVar || "~/.vault-token (vault login)",
    terminal: String(prefs.terminal ?? "").trim() || undefined,
  };
}

export interface Result {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs the CLI without throwing on a non-zero exit (`vault status` exits 2 when sealed). */
export async function raw(c: Cli, args: string[], signal?: AbortSignal): Promise<Result> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(c.program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal,
      env: { ...c.env, NO_COLOR: "1" },
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new VaultError(`${c.program} is not installed`, "missing");
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b).trim();
  return { code: out.code, stdout: text(out.stdout), stderr: text(out.stderr) };
}

/** Runs the CLI; a failure becomes a {@link VaultError} the views know how to explain. */
export async function vault(c: Cli, args: string[], signal?: AbortSignal): Promise<string> {
  const r = await raw(c, args, signal);
  if (r.code === 0) return r.stdout;
  const stderr = r.stderr || r.stdout;
  const kind = classifyError(stderr);
  const product = PRODUCT[c.program];
  const host = c.address.replace(/^https?:\/\//, "");
  const messages: Record<ErrorKind, string> = {
    empty: "Nothing here",
    sealed: `${product} at ${host} is sealed: unseal it first`,
    token: `${product} needs a valid token: log in with ${c.program} login`,
    denied: "Permission denied: your token's policies don't allow this path",
    tls: `Can't connect to ${host} securely: check the address (http or https) and VAULT_CACERT`,
    address: `Can't reach ${product} at ${host}: check VAULT_ADDR or the address in Settings`,
    other: cleanError(stderr),
  };
  throw new VaultError(messages[kind], kind, stderr);
}

/** A command line run in the terminal, with the address and namespace of the preferences. */
export function inTerminal(c: Cli, title: string, args: string[], o: { icon?: string; shortcut?: string } = {}) {
  return action(title, () => {
    const term = runInTerminal(
      holdOpen([c.program, ...args]),
      c.terminal,
      Object.keys(c.env).length ? c.env : undefined,
    );
    return close(`Opened in ${term}`);
  }, { icon: o.icon ?? Icons.terminal, shortcut: o.shortcut, section: PRODUCT[c.program] });
}

const INSTALL = "https://developer.hashicorp.com/vault/install";
const INSTALL_BAO = "https://openbao.org/docs/install/";

/** The row explaining a failure, with the way out. */
export function errorItems(e: unknown, c?: Cli): Item[] {
  if (!(e instanceof VaultError)) throw e;
  const product = c ? PRODUCT[c.program] : "Vault";
  const login = c ? [inTerminal(c, `Log In with ${c.program} login`, ["login"], { icon: Icons.key })] : [];
  const ui = c ? [open(`${c.address}/ui/`, `Open ${product} UI`, { icon: Icons.globe })] : [];
  const retry = action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });
  const guides: Record<VaultError["kind"], { icon: string; tint: "orange" | "red"; markdown: string[] }> = {
    missing: {
      icon: Icons.download,
      tint: "orange",
      markdown: [
        "## Install the Vault or OpenBao CLI",
        "",
        "This extension runs `vault` (HashiCorp Vault) or `bao` (OpenBao) with your own sign-in, so it sees exactly what",
        "your token may read.",
        "",
        "Install one with your package manager or from the official downloads, then log in:",
        "",
        "```sh",
        "export VAULT_ADDR=https://vault.example.com:8200",
        "vault login",
        "```",
      ],
    },
    token: {
      icon: Icons.key,
      tint: "orange",
      markdown: [
        `## Log in to ${product}`,
        "",
        `The CLI uses \`VAULT_TOKEN\` or the token saved by \`${c?.program ?? "vault"} login\` in \`~/.vault-token\`.`,
        "It has none, or it expired. Enter opens a terminal to log in (token, OIDC, userpass…).",
      ],
    },
    address: {
      icon: Icons.server,
      tint: "orange",
      markdown: [
        `## ${product} doesn't answer`,
        "",
        `Backslash connects to \`${c?.address ?? DEFAULT_ADDRESS}\` (${c?.addressSource ?? "CLI default"}).`,
        "",
        "Set **Address** in **Settings → Extensions → Vault Secrets**, or export `VAULT_ADDR` in your session",
        "(e.g. in `~/.profile`) before Backslash starts.",
      ],
    },
    tls: {
      icon: Icons.lock,
      tint: "orange",
      markdown: [
        "## TLS problem",
        "",
        "A dev server (`vault server -dev`) listens on plain **http**: use `http://127.0.0.1:8200`.",
        "For a private CA, export `VAULT_CACERT=/path/to/ca.pem` in your session.",
        "",
        "```",
        e.detail.slice(0, 600),
        "```",
      ],
    },
    sealed: {
      icon: Icons.lock,
      tint: "red",
      markdown: [`## ${product} is sealed`, "", "Unseal it with the unseal keys (`vault operator unseal`) or the UI."],
    },
    denied: {
      icon: Icons.shield,
      tint: "red",
      markdown: [
        "## Permission denied",
        "",
        "Your token's policies don't grant `list` or `read` here. Check them in **Vault Status**.",
      ],
    },
    empty: { icon: Icons.info, tint: "orange", markdown: ["Nothing here."] },
    other: {
      icon: Icons.alert,
      tint: "red",
      markdown: ["## The command failed", "", "```", e.detail.slice(0, 1500) || e.message, "```"],
    },
  };
  const g = guides[e.kind];
  const actions = e.kind === "missing"
    ? [open(INSTALL, "Open Vault Install Guide"), open(INSTALL_BAO, "Open OpenBao Install Guide")]
    : e.kind === "token"
    ? [...login, retry, ...ui]
    : [retry, ...ui, ...login, copy(e.detail || e.message, "Copy Error", { section: "Copy" })];
  return [{
    id: "error",
    title: e.message,
    subtitle: e.kind === "missing" ? "vault or bao is needed" : undefined,
    icon: { source: g.icon, tint: g.tint },
    detail: { markdown: g.markdown.join("\n") },
    actions,
  }];
}
