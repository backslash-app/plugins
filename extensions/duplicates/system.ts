// Walking a folder, hashing (the start of each file in Deno, then whole files
// with b3sum or sha256sum), the hash cache, the trash and the file manager.

import { exec, openExternal, storage } from "@backslash/api";
import {
  byWasted,
  type FileInfo,
  type Group,
  makeGroup,
  parseHashOutput,
  pruneCache,
  sameSize,
  skipDir,
  splitBy,
} from "./lib.ts";

const env = (key: string) => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const tilde = (p: string) => (HOME && (p === HOME || p.startsWith(`${HOME}/`)) ? `~${p.slice(HOME.length)}` : p);
export const expandHome = (p: string) => p.trim().replace(/^~(?=\/|$)/, HOME).replace(/(.)\/+$/, "$1");

const denied = (e: unknown) => e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied;

// ---------------------------------------------------------------------------
// Walking

export interface Progress {
  phase: "walk" | "hash";
  done: number;
  total?: number;
}

/** Every regular file of at least `minSize` below `root` (symbolic links are not followed). */
export async function walk(
  root: string,
  o: { minSize: number; hidden: boolean; signal?: AbortSignal; progress?: (p: Progress) => void },
): Promise<FileInfo[]> {
  const st = await Deno.stat(root).catch((e) => {
    if (denied(e)) {
      throw new Error(`${tilde(root)} is outside what this extension may read (your home and mounted drives)`);
    }
    throw new Error(`${tilde(root)} doesn't exist`);
  });
  if (!st.isDirectory) throw new Error(`${tilde(root)} is not a folder`);
  const files: FileInfo[] = [];
  const stack = [root];
  let seen = 0;
  while (stack.length) {
    if (o.signal?.aborted) break;
    const dir = stack.pop()!;
    const names: string[] = [];
    try {
      for await (const e of Deno.readDir(dir)) {
        if (e.isSymlink) continue;
        if (e.isDirectory) {
          if (!skipDir(e.name, o.hidden)) stack.push(`${dir}/${e.name}`);
        } else if (e.isFile && (o.hidden || !e.name.startsWith("."))) names.push(e.name);
      }
    } catch {
      continue; // unreadable folder
    }
    await Promise.all(names.map(async (name) => {
      const path = `${dir === "/" ? "" : dir}/${name}`;
      const s = await Deno.lstat(path).catch(() => undefined);
      if (!s?.isFile || s.size < o.minSize) return;
      files.push({
        path,
        size: s.size,
        mtime: s.mtime?.getTime() ?? 0,
        dev: s.dev ?? undefined,
        ino: s.ino ?? undefined,
      });
    }));
    seen += names.length;
    o.progress?.({ phase: "walk", done: seen });
  }
  return files;
}

// ---------------------------------------------------------------------------
// Hashing

const HEAD = 64 * 1024;
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** SHA-256 of the first 64 KB: whole files when smaller, a quick filter otherwise. */
export async function headHash(path: string): Promise<string | undefined> {
  let file: Deno.FsFile | undefined;
  try {
    file = await Deno.open(path, { read: true });
    const buf = new Uint8Array(HEAD);
    let n = 0;
    while (n < HEAD) {
      const r = await file.read(buf.subarray(n));
      if (r === null) break;
      n += r;
    }
    return hex(await crypto.subtle.digest("SHA-256", buf.subarray(0, n)));
  } catch {
    return undefined;
  } finally {
    file?.close();
  }
}

let program: "b3sum" | "sha256sum" | undefined;

/** Whole-file hashes, many files per run: b3sum (much faster) or sha256sum. */
async function hashFiles(paths: string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const run = async (p: "b3sum" | "sha256sum") => {
    const out = await new Deno.Command(p, { args: ["--", ...paths], stdout: "piped", stderr: "null", signal })
      .output();
    // A file that vanished makes the exit code 1; the others are still printed.
    return parseHashOutput(new TextDecoder().decode(out.stdout));
  };
  for (const p of program ? [program] : (["b3sum", "sha256sum"] as const)) {
    try {
      const out = await run(p);
      program = p;
      return out;
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) throw e;
    }
  }
  throw new Error("sha256sum (coreutils) is needed to compare files");
}

export const hashProgram = () => program;

interface Cached {
  size: number;
  mtime: number;
  hash: string;
  at: number;
}

const CACHE_KEY = "hashes";
const CACHE_MAX = 40_000;

async function loadCache(): Promise<Record<string, Cached>> {
  return (await storage.get<Record<string, Cached> & never>(CACHE_KEY).catch(() => undefined)) ?? {};
}

/**
 * Groups of identical files, by most space wasted. Same size first, then the
 * same first 64 KB, then the same whole-file hash (cached by path, size and
 * modification time, so scanning again is quick).
 */
export async function findDuplicates(
  files: FileInfo[],
  o: { signal?: AbortSignal; progress?: (p: Progress) => void },
): Promise<Group[]> {
  const candidates = sameSize(files);
  const flat = candidates.flat();
  const head = new Map<string, string | undefined>();
  let done = 0;
  const total = flat.length;
  // Quick pass: the first 64 KB, a few files at a time.
  const queue = [...flat];
  await Promise.all(Array.from({ length: 8 }, async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      if (o.signal?.aborted) return;
      head.set(f.path, await headHash(f.path));
      o.progress?.({ phase: "hash", done: ++done, total });
    }
  }));

  const groups: Group[] = [];
  const needFull: FileInfo[][] = [];
  for (const sizeGroup of candidates) {
    for (const g of splitBy(sizeGroup, (f) => head.get(f.path))) {
      // Files up to 64 KB were read whole: their head hash is the hash.
      if (g[0].size <= HEAD) groups.push(makeGroup(head.get(g[0].path)!, g));
      else needFull.push(g);
    }
  }

  const cache = await loadCache();
  const full = new Map<string, string>();
  const missing: FileInfo[] = [];
  for (const f of needFull.flat()) {
    const c = cache[f.path];
    if (c && c.size === f.size && c.mtime === f.mtime) full.set(f.path, c.hash);
    else missing.push(f);
  }
  const now = Date.now();
  for (let i = 0; i < missing.length && !o.signal?.aborted; i += 64) {
    const batch = missing.slice(i, i + 64);
    const hashes = await hashFiles(batch.map((f) => f.path), o.signal);
    for (const f of batch) {
      const h = hashes.get(f.path);
      if (!h) continue;
      full.set(f.path, h);
      cache[f.path] = { size: f.size, mtime: f.mtime, hash: h, at: now };
    }
    o.progress?.({ phase: "hash", done: total - missing.length + i + batch.length, total });
  }
  if (missing.length) await storage.set(CACHE_KEY, pruneCache(cache, CACHE_MAX) as never).catch(() => {});

  for (const g of needFull) {
    for (const same of splitBy(g, (f) => full.get(f.path))) groups.push(makeGroup(full.get(same[0].path)!, same));
  }
  return groups.sort(byWasted);
}

/** Drops files that changed or disappeared since the scan. */
export async function stillThere(files: FileInfo[]): Promise<Set<string>> {
  const gone = new Set<string>();
  await Promise.all(files.map(async (f) => {
    const s = await Deno.lstat(f.path).catch(() => undefined);
    if (!s?.isFile || s.size !== f.size || (s.mtime?.getTime() ?? 0) !== f.mtime) gone.add(f.path);
  }));
  return gone;
}

// ---------------------------------------------------------------------------
// The desktop

/** Moves files to the trash (restorable from the file manager). */
export async function trash(paths: string[]): Promise<void> {
  for (let i = 0; i < paths.length; i += 100) {
    try {
      await exec("gio", ["trash", "--", ...paths.slice(i, i + 100)]);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) throw new Error("gio (GLib) is needed to move files to the trash");
      throw new Error(`Couldn't move to the trash: ${(e as Error).message.replace(/^gio exited with \d+: /, "")}`);
    }
  }
}

/** Opens the folder with the file selected (FileManager1), or just the folder. */
export async function showInFolder(path: string): Promise<void> {
  const uri = `file://${path.split("/").map(encodeURIComponent).join("/")}`;
  try {
    await exec("gdbus", [
      "call",
      "--session",
      "--dest",
      "org.freedesktop.FileManager1",
      "--object-path",
      "/org/freedesktop/FileManager1",
      "--method",
      "org.freedesktop.FileManager1.ShowItems",
      `['${uri.replace(/'/g, "%27")}']`,
      "",
    ]);
  } catch {
    await openExternal(path.split("/").slice(0, -1).join("/") || "/");
  }
}
