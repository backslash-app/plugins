// Where secrets live (system keyring, or the passphrase vault), the accounts
// list in storage, QR codes, and the background scan.

import { exec, storage } from "@backslash/api";
import {
  type Account,
  areaTools,
  base32Decode,
  detectSession,
  type Env,
  type Family,
  type ImportResult,
  newSalt,
  osFamily,
  parseLinks,
  pendingAttrs,
  sameAccount,
  scanScript,
  seal,
  type Sealed,
  secretAttrs,
  type Session,
  SESSION_ENV,
  type ShotTool,
  systemdRunArgs,
  unseal,
  VAULT_CHECK,
  vaultKey,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/authenticator`;
export const sessionEnv = (): Env => Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)]));
export const session = (): Session => detectSession(sessionEnv());
export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

export class MissingTool extends Error {
  constructor(message: string, public packages: string[]) {
    super(message);
  }
}

/** Whether a program can be started (installed and allowed). */
export async function installed(program: string, args = ["--version"]): Promise<boolean> {
  try {
    await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "null",
      signal: AbortSignal.timeout(3000),
    }).output();
    return true;
  } catch (e) {
    return !(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied ||
      e instanceof Deno.errors.NotCapable);
  }
}

// ---------------------------------------------------------------------------
// Keyring (secret-tool)

/** Runs secret-tool; `undefined` when it isn't installed. */
async function secretTool(
  args: string[],
  stdin?: string,
): Promise<{ code: number; stdout: string; stderr: string } | undefined> {
  try {
    const child = new Deno.Command("secret-tool", {
      args,
      stdin: stdin === undefined ? "null" : "piped",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(20_000),
    }).spawn();
    if (stdin !== undefined) {
      const w = child.stdin.getWriter();
      await w.write(new TextEncoder().encode(stdin));
      await w.close();
    }
    const out = await child.output();
    const dec = new TextDecoder();
    return { code: out.code, stdout: dec.decode(out.stdout).trim(), stderr: dec.decode(out.stderr).trim() };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable) return undefined;
    throw e;
  }
}

export type KeyringState = "ok" | "missing" | "unavailable";
let keyringState: Promise<KeyringState> | undefined;

/** Whether secrets can go to the system keyring: secret-tool installed and a Secret Service answering. */
export function keyring(): Promise<KeyringState> {
  keyringState ??= (async () => {
    if (!env("DBUS_SESSION_BUS_ADDRESS")) {
      return (await secretTool(["--version"])) ? "unavailable" : "missing";
    }
    const r = await secretTool(["lookup", ...secretAttrs("probe")]);
    if (!r) return "missing";
    // Exit 1 with nothing on stderr: the service answered, there is just no such secret.
    return r.code === 0 || (r.code === 1 && !r.stderr) ? "ok" : "unavailable";
  })();
  return keyringState;
}

async function keyringStore(attrs: string[], label: string, secret: string): Promise<void> {
  const r = await secretTool(["store", `--label=${label}`, ...attrs], secret);
  if (!r) throw new MissingTool("secret-tool is needed to use the keyring", ["secret-tool"]);
  if (r.code !== 0) throw new Error(`The keyring refused the secret${r.stderr ? `: ${r.stderr}` : ""}`);
}

async function keyringLookup(attrs: string[]): Promise<string | undefined> {
  const r = await secretTool(["lookup", ...attrs]);
  return r?.code === 0 && r.stdout ? r.stdout : undefined;
}

async function keyringClear(attrs: string[]): Promise<void> {
  await secretTool(["clear", ...attrs]);
}

// ---------------------------------------------------------------------------
// Vault (passphrase), when there is no keyring

interface VaultHeader {
  salt: string;
  check: Sealed;
}

const keys = new Map<string, Promise<CryptoKey>>();

export class VaultError extends Error {}

/** The vault key; creates the vault the first time. Throws VaultError on a wrong passphrase. */
async function vault(passphrase: string | undefined): Promise<CryptoKey> {
  if (!passphrase) throw new VaultError("No keyring found: set a vault passphrase to store secrets encrypted");
  let header = (await storage.get("vault")) as unknown as VaultHeader | undefined;
  const cacheKey = `${passphrase}\u0000${header?.salt ?? ""}`;
  if (header && keys.has(cacheKey)) return keys.get(cacheKey)!;
  if (!header) {
    const salt = newSalt();
    const key = await vaultKey(passphrase, salt);
    header = { salt, check: await seal(key, VAULT_CHECK) };
    await storage.set("vault", header as any);
    keys.set(`${passphrase}\u0000${salt}`, Promise.resolve(key));
    return key;
  }
  const key = await vaultKey(passphrase, header.salt);
  try {
    if ((await unseal(key, header.check)) !== VAULT_CHECK) throw new Error();
  } catch {
    throw new VaultError("Wrong vault passphrase: it doesn't open the secrets saved before");
  }
  keys.set(cacheKey, Promise.resolve(key));
  return key;
}

// ---------------------------------------------------------------------------
// Accounts

export interface Entry {
  id: string;
  issuer: string;
  account: string;
  digits: number;
  period: number;
  algorithm: Account["algorithm"];
  added: number;
  store: "keyring" | "vault";
  /** Vault only: the encrypted secret. */
  sealed?: Sealed;
}

export interface Loaded extends Entry {
  /** The decoded secret, or why it couldn't be read. */
  key?: Uint8Array;
  secret?: string;
  error?: string;
}

const entries = async (): Promise<Entry[]> => ((await storage.get("entries")) ?? []) as unknown as Entry[];
const saveEntries = (list: Entry[]) => storage.set("entries", list as any);

/** Secrets read in this process, by entry id: read once, then codes tick every second. */
const secrets = new Map<string, string>();

export async function loadAll(passphrase?: string): Promise<Loaded[]> {
  const list = await entries();
  let vaultKeyP: Promise<CryptoKey> | undefined;
  return await Promise.all(list.map(async (e): Promise<Loaded> => {
    try {
      let secret = secrets.get(e.id);
      if (!secret) {
        if (e.store === "keyring") {
          secret = await keyringLookup(secretAttrs(e.id));
          if (!secret) return { ...e, error: "Not found in the keyring: is it locked?" };
        } else {
          vaultKeyP ??= vault(passphrase);
          secret = await unseal(await vaultKeyP, e.sealed!);
        }
        secrets.set(e.id, secret);
      }
      return { ...e, secret, key: base32Decode(secret) };
    } catch (err) {
      return {
        ...e,
        error: err instanceof VaultError ? err.message : `Can't read the secret: ${(err as Error).message}`,
      };
    }
  }));
}

/** Where new secrets go: the keyring when it works, else the vault (needs the passphrase). */
export async function storeKind(passphrase?: string): Promise<"keyring" | "vault"> {
  if ((await keyring()) === "ok") return "keyring";
  if (passphrase) return "vault";
  const state = await keyring();
  throw new VaultError(
    state === "missing"
      ? "Install secret-tool to keep secrets in your keyring, or set a vault passphrase"
      : "The keyring isn't reachable: unlock it, or set a vault passphrase",
  );
}

export interface AddResult {
  added: Entry[];
  duplicates: number;
}

export async function addAccounts(accounts: Account[], passphrase?: string): Promise<AddResult> {
  const kind = await storeKind(passphrase);
  const list = await entries();
  const existing = await loadAll(passphrase);
  const added: Entry[] = [];
  let duplicates = 0;
  for (const a of accounts) {
    const known = [...existing, ...added.map((e) => ({ ...e, secret: secrets.get(e.id) }))];
    if (known.some((e) => e.secret && sameAccount({ ...e, secret: e.secret }, a))) {
      duplicates++;
      continue;
    }
    const id = crypto.randomUUID();
    const entry: Entry = {
      id,
      issuer: a.issuer,
      account: a.account,
      digits: a.digits,
      period: a.period,
      algorithm: a.algorithm,
      added: Date.now(),
      store: kind,
    };
    if (kind === "keyring") {
      await keyringStore(secretAttrs(id), `Backslash Authenticator: ${a.issuer || a.account}`, a.secret);
    } else {
      entry.sealed = await seal(await vault(passphrase), a.secret);
    }
    secrets.set(id, a.secret);
    added.push(entry);
  }
  if (added.length) await saveEntries([...list, ...added]);
  if (added.length) notifyChanged();
  return { added, duplicates };
}

export async function rename(id: string, issuer: string, account: string): Promise<void> {
  await saveEntries((await entries()).map((e) => (e.id === id ? { ...e, issuer, account } : e)));
  notifyChanged();
}

export async function remove(id: string): Promise<void> {
  const list = await entries();
  const entry = list.find((e) => e.id === id);
  if (entry?.store === "keyring") await keyringClear(secretAttrs(id));
  secrets.delete(id);
  await saveEntries(list.filter((e) => e.id !== id));
  notifyChanged();
}

// ---------------------------------------------------------------------------
// Scans left by the background job

/** Adds the accounts scanned on screen since last time. */
export async function importScans(passphrase?: string): Promise<{ result: AddResult; skipped: string[] }> {
  const dir = `${CACHE}/scans`;
  const links: string[] = [];
  const done: string[] = [];
  const pending: string[] = [];
  try {
    for await (const f of Deno.readDir(dir)) {
      if (!f.isFile) continue;
      const path = `${dir}/${f.name}`;
      if (f.name.endsWith(".uri")) {
        links.push((await Deno.readTextFile(path).catch(() => "")).trim());
        done.push(path);
      } else if (f.name.endsWith(".pending")) {
        const id = f.name.replace(/\.pending$/, "");
        const link = await keyringLookup(pendingAttrs(id));
        // Locked keyring: keep it for the next time.
        if (!link) continue;
        links.push(link);
        pending.push(id);
        done.push(path);
      }
    }
  } catch {
    // Nothing scanned yet.
  }
  if (!links.length) {
    for (const p of done) await Deno.remove(p).catch(() => {});
    return { result: { added: [], duplicates: 0 }, skipped: [] };
  }
  const parsed = parseLinks(links.filter(Boolean).join("\n"));
  const result = await addAccounts(parsed.accounts, passphrase);
  // Only forget the scans once they are safely stored.
  for (const id of pending) await keyringClear(pendingAttrs(id));
  for (const p of done) await Deno.remove(p).catch(() => {});
  return { result, skipped: parsed.skipped };
}

// ---------------------------------------------------------------------------
// QR codes

const PROBE: Record<string, string[]> = { import: ["-version"], slurp: ["-h"], grim: ["-h"] };

async function captureTool(s: Session): Promise<ShotTool | undefined> {
  for (const t of areaTools(s)) {
    if (!(await installed(t, PROBE[t]))) continue;
    if (t === "grim" && !(await installed("slurp", PROBE.slurp))) continue;
    return t;
  }
  return undefined;
}

/** Starts the background job: select an area, decode, keep the link for the next opening. */
export async function scanScreen(): Promise<void> {
  const s = session();
  const [tool, zbar, ring] = await Promise.all([captureTool(s), installed("zbarimg"), keyring()]);
  if (!zbar) throw new MissingTool("zbarimg is needed to read QR codes", ["zbarimg"]);
  if (!tool) throw new MissingTool("No screenshot tool to select an area", []);
  await Deno.mkdir(`${CACHE}/scans`, { recursive: true, mode: 0o700 });
  const script = scanScript({ tool, cache: CACHE, keyring: ring === "ok" });
  try {
    await exec("systemd-run", systemdRunArgs(`backslash-authenticator-scan-${Date.now()}`, script, sessionEnv()));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to scan in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: scans run in the background with systemd-run --user");
    }
    throw e;
  }
}

/** Decodes the QR code of a picture: its text, or undefined. */
async function decode(path: string): Promise<string | undefined> {
  try {
    return (await exec("zbarimg", ["--raw", "-q", "--", path])) || undefined;
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new MissingTool("zbarimg is needed to read QR codes", ["zbarimg"]);
    if (/exited with 4/.test(String(e))) return undefined; // nothing found
    throw e;
  }
}

/** The QR code in a copied picture (a screenshot), decoded. The picture is deleted right after. */
export async function scanClipboardImage(): Promise<string | undefined> {
  await Deno.mkdir(CACHE, { recursive: true, mode: 0o700 });
  const file = `${CACHE}/clipboard-${Date.now()}.png`;
  const tries: [string, string[]][] = [
    ["wl-paste", ["--no-newline", "--type", "image/png"]],
    ["xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]],
  ];
  if (!session().wayland) tries.reverse();
  let picture = false;
  for (const [program, args] of tries) {
    try {
      const out = await new Deno.Command(program, { args, stdin: "null", stdout: "piped", stderr: "null" }).output();
      if (out.success && out.stdout.length > 8 && out.stdout[0] === 0x89 && out.stdout[1] === 0x50) {
        await Deno.writeFile(file, out.stdout, { mode: 0o600 });
        picture = true;
        break;
      }
    } catch {
      // Not installed: try the next one.
    }
  }
  if (!picture) throw new Error("No picture in the clipboard: copy a screenshot of the QR code first");
  try {
    return await decode(file);
  } finally {
    await Deno.remove(file).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Import files

export const IMPORT_FOLDERS = () => [`${HOME}/Downloads`, `${HOME}/Documents`];

/** Aegis / 2FAS exports and link lists in Downloads and Documents, newest first. */
export async function exportFiles(): Promise<{ path: string; name: string; modified: number }[]> {
  const found: { path: string; name: string; modified: number }[] = [];
  for (const dir of IMPORT_FOLDERS()) {
    try {
      for await (const f of Deno.readDir(dir)) {
        if (!f.isFile || !/(aegis|2fas|otp|authenticator).*\.(json|txt|2fas)$/i.test(f.name)) continue;
        const st = await Deno.stat(`${dir}/${f.name}`).catch(() => undefined);
        found.push({ path: `${dir}/${f.name}`, name: f.name, modified: st?.mtime?.getTime() ?? 0 });
      }
    } catch {
      // No such folder.
    }
  }
  return found.sort((a, b) => b.modified - a.modified);
}

export function expandHome(p: string): string {
  return p.trim().replace(/^~(?=\/|$)/, HOME);
}

export type { ImportResult };

// ---------------------------------------------------------------------------
// Live reload: the views of a command share one process.

const changes = new EventTarget();
export function notifyChanged(): void {
  keyringState = undefined;
  changes.dispatchEvent(new Event("change"));
}

/** Resolves on the next change ("change"), after `ms` ("tick"), or when `signal` aborts. */
export function nextTick(ms: number, signal: AbortSignal): Promise<"change" | "tick"> {
  return new Promise((resolve) => {
    const finish = (why: "change" | "tick") => () => {
      clearTimeout(timer);
      changes.removeEventListener("change", onChange);
      signal.removeEventListener("abort", onTick);
      resolve(why);
    };
    const onChange = finish("change");
    const onTick = finish("tick");
    const timer = setTimeout(onTick, ms);
    changes.addEventListener("change", onChange);
    signal.addEventListener("abort", onTick);
  });
}
