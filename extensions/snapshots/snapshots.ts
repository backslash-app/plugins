// Running Timeshift, Snapper and btrfs, as the user when possible and through pkexec otherwise.
// What root listed is kept while the command is open, so the password is asked once.

import {
  MARK,
  needsRoot,
  parseBtrfsList,
  parseSnapperConfigs,
  parseSnapperList,
  parseTimeshiftConfig,
  parseTimeshiftList,
  pkexecError,
  rootIsBtrfs,
  shellLine,
  type SnapperConfig,
  snapperCreateArgs,
  snapperError,
  type Snapshot,
  splitMarked,
  type TimeshiftConfig,
  type TimeshiftDevice,
} from "./lib.ts";

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

async function sh(program: string, args: string[], timeout = 60_000): Promise<Output> {
  const { code, stdout, stderr } = await new Deno.Command(program, {
    args,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C" },
    signal: AbortSignal.timeout(timeout),
  }).output();
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  return { code, stdout: text(stdout), stderr: text(stderr).trim() };
}

/** Runs a script as root, after polkit asks for the password once. */
export async function asRoot(script: string, timeout = 120_000): Promise<string> {
  let o: Output;
  try {
    o = await sh("pkexec", ["/bin/sh", "-c", script], timeout);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("pkexec (polkit) is needed to read system snapshots");
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Error("The command took too long");
    throw e;
  }
  const denied = pkexecError(o.code, o.stderr);
  if (denied) throw new Error(denied);
  if (o.code === 127) throw new Error(`Not installed: ${o.stderr.split("\n").pop()}`);
  if (o.code !== 0) throw new Error(o.stderr.split("\n").filter(Boolean).pop() || `Exited with ${o.code}`);
  return o.stdout;
}

// --- Root caches ---------------------------------------------------------------

let timeshiftRoot: { device: TimeshiftDevice; snapshots: Snapshot[] } | undefined;
const snapperRoot = new Map<string, Snapshot[]>();
let btrfsRoot: Snapshot[] | undefined;

export interface Loaded {
  timeshift?: {
    config?: TimeshiftConfig;
    root?: { device: TimeshiftDevice; snapshots: Snapshot[] };
    error?: string;
  };
  snapper?: {
    configs: SnapperConfig[];
    snapshots: Snapshot[];
    /** Configs the user may not read. */
    locked: string[];
    /** Locked configs listed as root. */
    unlocked: string[];
    error?: string;
  };
  btrfs?: { snapshots?: Snapshot[] };
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function loadTimeshift(): Promise<Loaded["timeshift"]> {
  const [conf, def] = await Promise.all([
    Deno.readTextFile("/etc/timeshift/timeshift.json").catch(() => undefined),
    exists("/etc/timeshift/default.json"),
  ]);
  if (conf === undefined && !def) return undefined;
  let config: TimeshiftConfig | undefined;
  try {
    config = conf ? parseTimeshiftConfig(conf) : undefined;
  } catch {
    config = undefined;
  }
  return { config, root: timeshiftRoot };
}

/** Runs snapper as the user; throws `snapperError`'s sentence. */
export async function snapperUser(args: string[], timeout = 60_000): Promise<Output> {
  try {
    return await sh("snapper", args, timeout);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("snapper is not installed");
    throw e;
  }
}

/** Snapper's output, through pkexec when the config is root's only. */
export async function snapper(args: string[], timeout = 120_000): Promise<string> {
  const o = await snapperUser(args, timeout);
  if (o.code === 0) return o.stdout;
  if (needsRoot(o.stderr)) return await asRoot(shellLine(["snapper", ...args]), timeout);
  throw new Error(snapperError(o.stderr));
}

async function loadSnapper(): Promise<Loaded["snapper"]> {
  let configs: SnapperConfig[];
  try {
    const o = await snapperUser(["--jsonout", "list-configs"], 15_000);
    if (o.code !== 0) {
      return { configs: [], snapshots: [], locked: [], unlocked: [], error: snapperError(o.stderr) };
    }
    configs = parseSnapperConfigs(o.stdout);
  } catch (e) {
    if (e instanceof Error && /not installed/.test(e.message)) return undefined;
    if (e instanceof Deno.errors.NotCapable) return undefined;
    throw e;
  }
  const locked: string[] = [];
  const errors: string[] = [];
  const lists = await Promise.all(configs.map(async (c) => {
    const o = await snapperUser(["--jsonout", "-c", c.name, "list"], 30_000);
    if (o.code === 0) return parseSnapperList(o.stdout);
    if (needsRoot(o.stderr)) {
      locked.push(c.name);
      return snapperRoot.get(c.name) ?? [];
    }
    errors.push(`${c.name}: ${snapperError(o.stderr)}`);
    return [];
  }));
  return {
    configs,
    snapshots: lists.flat(),
    locked,
    unlocked: locked.filter((c) => snapperRoot.has(c)),
    error: errors.join("; ") || undefined,
  };
}

async function loadBtrfs(): Promise<Loaded["btrfs"]> {
  const mounts = await Deno.readTextFile("/proc/mounts").catch(() => "");
  return rootIsBtrfs(mounts) ? { snapshots: btrfsRoot } : undefined;
}

/** Whatever is installed, in parallel. */
export async function load(): Promise<Loaded> {
  const [timeshift, snapper] = await Promise.all([loadTimeshift(), loadSnapper()]);
  const btrfs = timeshift || snapper ? undefined : await loadBtrfs();
  return { timeshift, snapper, btrfs };
}

// --- Root listings ---------------------------------------------------------------

const TIMESHIFT_LIST = "timeshift --list --scripted";

/** Timeshift's output after the last marker of a script that ends with a listing. */
function keepTimeshift(out: string) {
  const parts = splitMarked(out);
  timeshiftRoot = parseTimeshiftList(parts[parts.length - 1]);
}

export async function timeshiftAsRoot(): Promise<void> {
  keepTimeshift(await asRoot(TIMESHIFT_LIST));
}

function snapperListScript(configs: string[]): string {
  return configs.map((c) => `${shellLine(["snapper", "--jsonout", "-c", c, "list"])}; echo ${MARK}`).join("\n");
}

function keepSnapper(configs: string[], parts: string[]) {
  configs.forEach((c, i) => {
    const text = parts[i]?.trim();
    if (!text) return;
    try {
      snapperRoot.set(c, parseSnapperList(text));
    } catch {
      snapperRoot.set(c, []);
    }
  });
}

export async function snapperAsRoot(configs: string[]): Promise<void> {
  keepSnapper(configs, splitMarked(await asRoot(snapperListScript(configs))));
}

export async function btrfsAsRoot(): Promise<void> {
  btrfsRoot = parseBtrfsList(await asRoot("btrfs subvolume list -s /"));
}

// --- Changes -------------------------------------------------------------------------

/** Runs a snapper change as the user, or as root together with a fresh listing of that config. */
async function snapperChange(config: string, args: string[], timeout: number): Promise<string> {
  const o = await snapperUser(args, timeout);
  if (o.code === 0) return o.stdout;
  if (!needsRoot(o.stderr)) throw new Error(snapperError(o.stderr));
  const out = await asRoot(`${shellLine(["snapper", ...args])}\necho ${MARK}\n${snapperListScript([config])}`, timeout);
  const [result, ...lists] = splitMarked(out);
  keepSnapper([config], lists);
  return result;
}

export async function createSnapshot(
  tool: "snapper" | "timeshift",
  o: { description: string; config: string; cleanup: string; important: boolean },
): Promise<string | undefined> {
  if (tool === "snapper") {
    const out = await snapperChange(o.config, snapperCreateArgs(o.config, o), 300_000);
    const n = out.trim().split("\n").pop()?.trim();
    return n && /^\d+$/.test(n) ? `#${n}` : undefined;
  }
  const create = shellLine(["timeshift", "--create", "--scripted", "--comments", o.description || "Backslash"]);
  // Rsync snapshots copy the whole system: give it half an hour.
  const out = await asRoot(`${create}\necho ${MARK}\n${TIMESHIFT_LIST}`, 30 * 60_000);
  keepTimeshift(out);
  return splitMarked(out)[0].match(/snapshot '(\d{4}-[\d_-]+)'/i)?.[1];
}

export async function deleteSnapshot(s: Snapshot): Promise<void> {
  if (s.tool === "snapper") {
    await snapperChange(s.config ?? "root", ["-c", s.config ?? "root", "delete", s.id], 300_000);
    return;
  }
  if (s.tool === "timeshift") {
    const del = shellLine(["timeshift", "--delete", "--scripted", "--snapshot", s.id]);
    keepTimeshift(await asRoot(`${del}\necho ${MARK}\n${TIMESHIFT_LIST}`, 10 * 60_000));
    return;
  }
  throw new Error("Btrfs snapshots are listed read-only");
}

/** The tool a quick snapshot uses: Snapper's root config first, then Timeshift. */
export async function defaultTool(): Promise<{ tool: "snapper" | "timeshift"; config: string } | undefined> {
  const state = await load();
  if (state.snapper?.configs.length) {
    const root = state.snapper.configs.find((c) => c.name === "root") ?? state.snapper.configs[0];
    return { tool: "snapper", config: root.name };
  }
  if (state.timeshift) return { tool: "timeshift", config: "" };
  return undefined;
}
