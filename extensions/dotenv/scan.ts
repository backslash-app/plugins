// Finding .env files below the folders of the preferences, and reading them.

import { compareFiles, type EnvFile, exampleOf, isEnvFile, parseEnv, SKIP_DIRS } from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

export interface Found {
  dir: string;
  name: string;
  path: string;
  /** Unix milliseconds. */
  modified: number;
  size: number;
  text: string;
  parsed: EnvFile;
}

export interface Folder {
  dir: string;
  files: Found[];
  /** The folder's .env.example (or .sample…), if any. */
  example?: Found;
}

export interface Scan {
  folders: Folder[];
  /** Roots the extension may not read (outside its permissions). */
  denied: string[];
}

/** Files bigger than this are not .env files worth parsing. */
const MAX_SIZE = 512 * 1024;

const denied = (e: unknown) => e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied;

/** Folders holding .env files, at most `depth` levels below each root. */
async function walk(root: string, depth: number, out: Map<string, string[]>, signal?: AbortSignal): Promise<void> {
  const queue: [string, number][] = [[root, 0]];
  while (queue.length) {
    signal?.throwIfAborted();
    const [dir, level] = queue.shift()!;
    const names: string[] = [];
    try {
      for await (const entry of Deno.readDir(dir)) {
        if (entry.isFile && isEnvFile(entry.name)) names.push(entry.name);
        else if (entry.isDirectory && level < depth && !SKIP_DIRS.has(entry.name)) {
          if (entry.name.startsWith(".") && entry.name !== ".devcontainer") continue;
          queue.push([`${dir}/${entry.name}`, level + 1]);
        }
      }
    } catch (e) {
      if (dir === root) throw e;
      continue; // an unreadable subfolder
    }
    if (names.length) out.set(dir, names);
  }
}

async function read(dir: string, name: string): Promise<Found | undefined> {
  const path = `${dir}/${name}`;
  try {
    const st = await Deno.stat(path);
    if (!st.isFile || st.size > MAX_SIZE) return undefined;
    const text = await Deno.readTextFile(path);
    return { dir, name, path, modified: st.mtime?.getTime() ?? 0, size: st.size, text, parsed: parseEnv(text) };
  } catch {
    return undefined;
  }
}

export async function readFolder(dir: string, names: string[]): Promise<Folder> {
  const files = (await Promise.all(names.sort(compareFiles).map((n) => read(dir, n)))).filter((f) => f !== undefined);
  const ex = exampleOf(names);
  return { dir, files, example: files.find((f) => f.name === ex) };
}

export async function scan(roots: string[], depth: number, signal?: AbortSignal): Promise<Scan> {
  const dirs = new Map<string, string[]>();
  const refused: string[] = [];
  await Promise.all(roots.map(async (root) => {
    try {
      await walk(root, depth, dirs, signal);
    } catch (e) {
      if (denied(e)) refused.push(root);
      // A folder that doesn't exist is simply skipped.
    }
  }));
  const folders = await Promise.all([...dirs].map(([dir, names]) => readFolder(dir, names)));
  // The most recently changed projects first.
  const latest = (f: Folder) => Math.max(0, ...f.files.map((x) => x.modified));
  folders.sort((a, b) => latest(b) - latest(a));
  return { folders: folders.filter((f) => f.files.length), denied: refused };
}
