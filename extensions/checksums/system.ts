// Copied and recent files, the hash programs (cached per file), sums and
// signature files next to a file, and gpg.

import { clipboard, exec } from "@backslash/api";
import {
  type Algo,
  algoInfo,
  findEntry,
  isSumsFile,
  parseFileList,
  parseGpgStatus,
  parseHashOutput,
  parseSums,
  pgpKind,
  type Signature,
  type SumEntry,
  type SumsFile,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
export const expandHome = (p: string) => p.trim().replace(/^~(?=\/|$)/, HOME);
const wayland = () =>
  env("XDG_SESSION_TYPE") === "wayland" || (!!env("WAYLAND_DISPLAY") && env("XDG_SESSION_TYPE") !== "x11");

async function output(program: string, args: string[], timeout = 3000): Promise<string | undefined> {
  try {
    const out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(timeout),
    }).output();
    return out.success ? new TextDecoder().decode(out.stdout) : undefined;
  } catch {
    return undefined;
  }
}

/** Files copied in the file manager (or paths copied as text), and the copied text itself. */
export async function clipboardContent(): Promise<{ paths: string[]; text: string }> {
  const tries: [string, string[]][] = [
    ["wl-paste", ["--no-newline", "--type", "text/uri-list"]],
    ["wl-paste", ["--no-newline", "--type", "x-special/gnome-copied-files"]],
    ["xclip", ["-selection", "clipboard", "-t", "text/uri-list", "-o"]],
    ["xclip", ["-selection", "clipboard", "-t", "x-special/gnome-copied-files", "-o"]],
  ];
  if (!wayland()) tries.push(...tries.splice(0, 2));
  for (const [program, args] of tries) {
    const out = await output(program, args, 1500);
    const paths = out ? parseFileList(out, HOME) : [];
    if (paths.length) return { paths, text: "" };
  }
  try {
    const text = await clipboard.read();
    return { paths: parseFileList(text, HOME), text };
  } catch {
    return { paths: [], text: "" };
  }
}

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  modified: number;
}

export async function fileEntry(path: string): Promise<FileEntry | undefined> {
  const st = await Deno.stat(path).catch(() => undefined);
  if (!st?.isFile) return undefined;
  return { path, name: path.split("/").pop()!, size: st.size, modified: st.mtime?.getTime() ?? 0 };
}

/** The newest downloads: where a hash copied from a web page usually belongs. */
export async function recentDownloads(limit = 12): Promise<FileEntry[]> {
  const found: FileEntry[] = [];
  for (const dir of [`${HOME}/Downloads`, `${HOME}/Téléchargements`]) {
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.isFile || e.name.startsWith(".") || /\.(part|crdownload)$/.test(e.name)) continue;
        const f = await fileEntry(`${dir}/${e.name}`);
        if (f) found.push(f);
      }
    } catch {
      // No such folder.
    }
  }
  return found.sort((a, b) => b.modified - a.modified).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Hashes

const cache = new Map<string, Promise<string>>();
const results = new Map<string, string>();
const keyOf = (f: FileEntry, algo: Algo) => `${algo}\0${f.path}\0${f.size}\0${f.modified}`;

export class MissingProgram extends Error {}

/** The hash of a file, computed once per version of the file (path, size, mtime). */
export function hashOf(f: FileEntry, algo: Algo, signal?: AbortSignal): Promise<string> {
  const key = keyOf(f, algo);
  let p = cache.get(key);
  if (!p) {
    const { program } = algoInfo(algo);
    p = exec(program, ["--", f.path], { signal }).then((out) => {
      const hash = parseHashOutput(out);
      results.set(key, hash);
      return hash;
    }).catch((e) => {
      cache.delete(key);
      if (e instanceof Deno.errors.NotFound) throw new MissingProgram(`${program} is not installed (coreutils)`);
      throw new Error(String((e as Error).message ?? e).replace(/^.*exited with \d+: /s, "").split("\n")[0]);
    });
    cache.set(key, p);
  }
  return p;
}

/** The hash if it was already computed, without waiting. */
export const knownHash = (f: FileEntry, algo: Algo): string | undefined => results.get(keyOf(f, algo));

// ---------------------------------------------------------------------------
// Sums and signatures next to a file

export interface Sums extends SumsFile {
  path: string;
}

export async function readSums(path: string): Promise<Sums | undefined> {
  const st = await Deno.stat(path).catch(() => undefined);
  if (!st?.isFile || st.size > 4 * 1024 * 1024) return undefined;
  const text = await Deno.readTextFile(path).catch(() => undefined);
  if (text === undefined) return undefined;
  return { path, ...parseSums(text, path) };
}

const folderSums = new Map<string, Promise<Sums[]>>();

/** The sums files of a folder (SHA256SUMS, x.iso.sha256…), read once. */
export function sumsIn(dir: string): Promise<Sums[]> {
  let p = folderSums.get(dir);
  if (!p) {
    p = (async () => {
      const found: Sums[] = [];
      try {
        for await (const e of Deno.readDir(dir)) {
          if (!e.isFile || !isSumsFile(e.name)) continue;
          const s = await readSums(`${dir}/${e.name}`);
          if (s?.entries.length) found.push(s);
        }
      } catch {
        // Unreadable folder.
      }
      return found;
    })();
    folderSums.set(dir, p);
  }
  return p;
}

/** The line of a sums file next to `f` that is about it. */
export async function sumsFor(f: FileEntry): Promise<{ sums: Sums; entry: SumEntry } | undefined> {
  const dir = f.path.split("/").slice(0, -1).join("/") || "/";
  for (const s of await sumsIn(dir)) {
    if (s.path === f.path) continue;
    const entry = findEntry(s, f.name);
    if (entry) return { sums: s, entry };
  }
  return undefined;
}

export const existsFile = (p: string) => Deno.stat(p).then((s) => s.isFile).catch(() => false);

/** A detached signature next to a file: x.iso.sig, x.iso.asc or x.iso.sign. */
export async function signatureFor(path: string): Promise<string | undefined> {
  for (const ext of ["sig", "asc", "sign", "gpg"]) {
    const p = `${path}.${ext}`;
    if (await existsFile(p)) {
      if (ext === "gpg" && (await kindOf(p)) === "other") continue;
      return p;
    }
  }
  return undefined;
}

export async function kindOf(path: string): Promise<ReturnType<typeof pgpKind>> {
  const file = await Deno.open(path, { read: true }).catch(() => undefined);
  if (!file) return "other";
  try {
    const buf = new Uint8Array(64);
    const n = (await file.read(buf)) ?? 0;
    return pgpKind(buf.subarray(0, n));
  } finally {
    file.close();
  }
}

let gpg: Promise<boolean> | undefined;
export function hasGpg(): Promise<boolean> {
  gpg ??= new Deno.Command("gpg", { args: ["--version"], stdin: "null", stdout: "null", stderr: "null" }).output()
    .then(() => true, () => false);
  return gpg;
}

/** `gpg --verify`: a detached signature with its file, or a clearsigned file alone. */
export async function verifySignature(sig: string, file?: string, signal?: AbortSignal): Promise<Signature[]> {
  if (!(await hasGpg())) throw new MissingProgram("gpg is not installed (GnuPG)");
  const out = await new Deno.Command("gpg", {
    args: ["--batch", "--no-tty", "--status-fd", "1", "--verify", "--", sig, ...(file ? [file] : [])],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: signal ?? AbortSignal.timeout(30_000),
  }).output();
  const sigs = parseGpgStatus(new TextDecoder().decode(out.stdout));
  if (!sigs.length) {
    const err = new TextDecoder().decode(out.stderr).split("\n").map((l) => l.replace(/^gpg: /, "").trim()).filter(
      Boolean,
    );
    throw new Error(err.at(-1) ?? "gpg found no signature");
  }
  return sigs;
}

/** Fetches a public key from keys.openpgp.org (gpg does the network part). */
export async function receiveKey(id: string): Promise<string> {
  const out = await new Deno.Command("gpg", {
    args: ["--batch", "--no-tty", "--keyserver", "hkps://keys.openpgp.org", "--recv-keys", id],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    signal: AbortSignal.timeout(30_000),
  }).output();
  const err = new TextDecoder().decode(out.stderr);
  if (!out.success || /no valid OpenPGP data|not found|No data/i.test(err)) {
    throw new Error(
      err.split("\n").map((l) => l.replace(/^gpg: /, "").trim()).filter(Boolean).at(-1) ?? "The key wasn't found",
    );
  }
  return err.match(/key [0-9A-F]+: (?:public key )?"([^"]+)"/)?.[1] ?? id;
}
