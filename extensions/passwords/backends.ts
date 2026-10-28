// Talks to the password manager CLIs. Secrets are fetched only when an action
// asks for one, handed to the clipboard, and forgotten.

import {
  type BackendId,
  BACKENDS,
  type BwStatus,
  type Entry,
  expandHome,
  keepassWrongPassword,
  opSignedOut,
  parseBwFolders,
  parseBwItems,
  parseBwStatus,
  parseKeepassList,
  parseOpItems,
  parsePassShow,
  parsePassTree,
  passEntries,
  safeError,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

/** Runs a CLI; stdout trimmed. Errors carry stderr's first line, scrubbed of anything secret-looking. */
export async function cli(
  program: string,
  args: string[],
  o: { stdin?: string; env?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<string> {
  const child = new Deno.Command(program, {
    args,
    env: o.env,
    stdin: o.stdin === undefined ? "null" : "piped",
    stdout: "piped",
    stderr: "piped",
    signal: o.signal,
  }).spawn();
  if (o.stdin !== undefined) {
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(o.stdin));
    await w.close();
  }
  const { code, stdout, stderr } = await child.output();
  const out = new TextDecoder().decode(stdout);
  // stderr only: stdout may hold a secret even when the program fails.
  if (code !== 0) throw new Error(safeError(program, new TextDecoder().decode(stderr) || `exited with ${code}`));
  return out.replace(/\r?\n$/, "");
}

/** Whether a program can be started (installed and on PATH). */
async function installed(program: string): Promise<boolean> {
  try {
    await new Deno.Command(program, { args: ["--version"], stdout: "null", stderr: "null", stdin: "null" }).output();
    return true;
  } catch {
    return false;
  }
}

let available: Promise<BackendId[]> | undefined;

/** Managers installed on this computer, detected once per run. */
export function installedBackends(): Promise<BackendId[]> {
  available ??= Promise.all(BACKENDS.map(async (b) => ((await installed(b.program)) ? b.id : undefined)))
    .then((ids) => ids.filter((id): id is BackendId => id !== undefined));
  return available;
}

// --- Changes (an unlock) reload the list --------------------------------------

const changes = new EventTarget();
export const notifyChanged = () => changes.dispatchEvent(new Event("change"));

export function nextChange(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

/** What a backend has to show: its entries, or why it can't yet. */
export type Loaded =
  | { backend: BackendId; state: "ready"; entries: Entry[] }
  | { backend: BackendId; state: "locked" | "signed-out" | "unconfigured"; detail?: string }
  | { backend: BackendId; state: "error"; detail: string };

// --- pass ------------------------------------------------------------------

export const passStore = () => Deno.env.get("PASSWORD_STORE_DIR") || `${HOME}/.password-store`;

async function walkStore(root: string, rel = "", out: { path: string; modified?: number }[] = []) {
  for await (const e of Deno.readDir(rel ? `${root}/${rel}` : root)) {
    if (e.name.startsWith(".")) continue;
    const path = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory) await walkStore(root, path, out);
    else if (e.name.endsWith(".gpg")) {
      const stat = await Deno.stat(`${root}/${path}`).catch(() => undefined);
      out.push({ path, modified: stat?.mtime?.getTime() });
    }
  }
  return out;
}

async function loadPass(signal: AbortSignal): Promise<Loaded> {
  try {
    return { backend: "pass", state: "ready", entries: passEntries(await walkStore(passStore())) };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return { backend: "pass", state: "unconfigured", detail: "No password store: run `pass init <gpg-id>`" };
    }
    // A store outside ~/.password-store can't be read directly: ask pass.
    const tree = await cli("pass", ["ls"], { signal });
    return {
      backend: "pass",
      state: "ready",
      entries: passEntries(parsePassTree(tree).map((p) => ({ path: `${p}.gpg` }))),
    };
  }
}

let passOtp: Promise<boolean> | undefined;
/** pass-otp is an extension: `pass otp --help` only works when it's installed. */
export const hasPassOtp = () => passOtp ??= cli("pass", ["otp", "--help"]).then(() => true, () => false);

// --- Bitwarden ---------------------------------------------------------------

let bwSession: string | undefined;

export function bwSessionKey(prefs: Record<string, unknown>): string | undefined {
  return bwSession || String(prefs.bwSession ?? "").trim() || Deno.env.get("BW_SESSION") || undefined;
}

const bwArgs = (prefs: Record<string, unknown>) => {
  const s = bwSessionKey(prefs);
  return [...(s ? ["--session", s] : []), "--nointeraction"];
};

export async function bwStatus(prefs: Record<string, unknown>): Promise<{ status: BwStatus; email?: string }> {
  return parseBwStatus(await cli("bw", ["status", ...bwArgs(prefs)]));
}

async function loadBitwarden(prefs: Record<string, unknown>, signal: AbortSignal): Promise<Loaded> {
  const { status, email } = await bwStatus(prefs);
  if (status === "unauthenticated") return { backend: "bitwarden", state: "signed-out" };
  if (status !== "unlocked") return { backend: "bitwarden", state: "locked", detail: email };
  const [items, folders] = await Promise.all([
    cli("bw", ["list", "items", ...bwArgs(prefs)], { signal }),
    cli("bw", ["list", "folders", ...bwArgs(prefs)], { signal }).catch(() => "[]"),
  ]);
  return { backend: "bitwarden", state: "ready", entries: parseBwItems(items, parseBwFolders(folders)) };
}

/** `bw unlock`, the master password passed through the environment (not the command line). */
export async function bwUnlock(password: string): Promise<void> {
  const session = await cli("bw", ["unlock", "--raw", "--passwordenv", "BACKSLASH_BW_PASSWORD", "--nointeraction"], {
    env: { BACKSLASH_BW_PASSWORD: password },
  });
  if (!session.trim()) throw new Error("Bitwarden did not return a session");
  bwSession = session.trim();
  notifyChanged();
}

export function bwLock() {
  bwSession = undefined;
  notifyChanged();
}

// --- 1Password ---------------------------------------------------------------

async function loadOnePassword(signal: AbortSignal): Promise<Loaded> {
  try {
    const json = await cli("op", ["item", "list", "--format", "json"], { signal });
    return { backend: "1password", state: "ready", entries: parseOpItems(json || "[]") };
  } catch (e) {
    const message = (e as Error).message;
    if (opSignedOut(message)) return { backend: "1password", state: "signed-out", detail: message };
    throw e;
  }
}

// --- KeePassXC ---------------------------------------------------------------

let keepassPassword: string | undefined;

export function keepassDb(prefs: Record<string, unknown>): string | undefined {
  const p = String(prefs.keepassDb ?? "").trim();
  return p ? expandHome(p, HOME) : undefined;
}

function keepassArgs(prefs: Record<string, unknown>): string[] {
  const key = String(prefs.keepassKeyFile ?? "").trim();
  return ["-q", ...(key ? ["-k", expandHome(key, HOME)] : [])];
}

async function keepassList(prefs: Record<string, unknown>, password: string, signal?: AbortSignal) {
  const db = keepassDb(prefs)!;
  return parseKeepassList(
    await cli("keepassxc-cli", ["ls", ...keepassArgs(prefs), "-R", "-f", db], { stdin: `${password}\n`, signal }),
  );
}

async function loadKeepass(prefs: Record<string, unknown>, signal: AbortSignal): Promise<Loaded> {
  const db = keepassDb(prefs);
  if (!db) return { backend: "keepassxc", state: "unconfigured" };
  if (keepassPassword === undefined) return { backend: "keepassxc", state: "locked", detail: db };
  try {
    return { backend: "keepassxc", state: "ready", entries: await keepassList(prefs, keepassPassword, signal) };
  } catch (e) {
    if (keepassWrongPassword((e as Error).message)) {
      keepassPassword = undefined;
      return { backend: "keepassxc", state: "locked", detail: db };
    }
    throw e;
  }
}

/** Checks the password by listing the database; kept in memory only, for this run. */
export async function keepassUnlock(prefs: Record<string, unknown>, password: string): Promise<number> {
  const entries = await keepassList(prefs, password).catch((e) => {
    throw new Error(keepassWrongPassword(e.message) ? "Wrong password or key file" : e.message);
  });
  keepassPassword = password;
  notifyChanged();
  return entries.length;
}

export function keepassLock() {
  keepassPassword = undefined;
  notifyChanged();
}

// --- Loading -------------------------------------------------------------------

export async function load(id: BackendId, prefs: Record<string, unknown>, signal: AbortSignal): Promise<Loaded> {
  try {
    switch (id) {
      case "pass":
        return await loadPass(signal);
      case "bitwarden":
        return await loadBitwarden(prefs, signal);
      case "1password":
        return await loadOnePassword(signal);
      case "keepassxc":
        return await loadKeepass(prefs, signal);
    }
  } catch (e) {
    if (signal.aborted) throw e;
    return { backend: id, state: "error", detail: (e as Error).message };
  }
}

// --- Secrets, on demand ----------------------------------------------------------

export type Secret = "password" | "username" | "totp";

/** Reads one secret of an entry. Never logged, never stored. */
export async function reveal(entry: Entry, what: Secret, prefs: Record<string, unknown>): Promise<string> {
  let value = "";
  switch (entry.backend) {
    case "pass": {
      if (what === "totp") value = await cli("pass", ["otp", "code", entry.ref]);
      else {
        const content = parsePassShow(await cli("pass", ["show", entry.ref]), entry);
        value = (what === "password" ? content.password : content.username) ?? "";
      }
      break;
    }
    case "bitwarden":
      value = await cli("bw", ["get", what, entry.ref, ...bwArgs(prefs)]);
      break;
    case "1password": {
      if (what === "totp") {
        const [, vault, item] = /^op:\/\/([^/]*)\/(.+)$/.exec(entry.ref) ?? [];
        value = await cli("op", ["item", "get", item, ...(vault ? ["--vault", vault] : []), "--otp"]);
      } else value = await cli("op", ["read", "--no-newline", `${entry.ref}/${what}`]);
      break;
    }
    case "keepassxc": {
      if (keepassPassword === undefined) throw new Error("Unlock the KeePassXC database first");
      const db = keepassDb(prefs)!;
      const args = what === "totp"
        ? ["show", ...keepassArgs(prefs), "-t", db, entry.ref]
        : ["show", ...keepassArgs(prefs), "-a", what === "password" ? "Password" : "UserName", db, entry.ref];
      value = await cli("keepassxc-cli", args, { stdin: `${keepassPassword}\n` });
      break;
    }
  }
  value = value.replace(/\r?\n$/, "");
  if (!value) throw new Error(`No ${what === "totp" ? "one-time code" : what} in “${entry.title}”`);
  return value;
}
