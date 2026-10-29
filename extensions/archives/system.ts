// Installed tools, copied and recent files, reading archives, and running
// the extract and compress commands.

import { clipboard } from "@backslash/api";
import {
  archiveType,
  commonDir,
  compressCommand,
  decompressCommand,
  extractCommand,
  failureLine,
  type Family,
  type Format,
  freePath,
  isArchive,
  listCommand,
  type Listing,
  MissingTool,
  osFamily,
  parseFileList,
  type Step,
  type Tools,
  wrongPassword,
  zipEncrypted,
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

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

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

const has = async (program: string, args = ["--version"]) => {
  try {
    await new Deno.Command(program, { args, stdin: "null", stdout: "null", stderr: "null" }).output();
    return true;
  } catch {
    return false;
  }
};

let found: Promise<Tools> | undefined;

export function tools(): Promise<Tools> {
  found ??= (async () => {
    const [bsdtar, tarVersion, unzip, zip, s7z, s7zz, s7za, gzip, bzip2, xz, zstd, lz4] = await Promise.all([
      has("bsdtar"),
      output("tar", ["--version"]),
      has("unzip", ["-v"]),
      has("zip", ["-v"]),
      has("7z", ["i"]),
      has("7zz", ["i"]),
      has("7za", ["i"]),
      has("gzip"),
      has("bzip2", ["--help"]),
      has("xz"),
      has("zstd"),
      has("lz4"),
    ]);
    return {
      bsdtar,
      // The flags used here (--skip-old-files, -a) are GNU tar's; a bsdtar named tar has its own entry.
      tar: !!tarVersion && tarVersion.includes("GNU tar"),
      unzip,
      zip,
      sevenZip: s7zz ? "7zz" : s7z ? "7z" : s7za ? "7za" : undefined,
      gzip,
      bzip2,
      xz,
      zstd,
      lz4,
    };
  })();
  return found;
}

// ---------------------------------------------------------------------------
// Files

/** Files copied in the file manager (or paths copied as text). */
export async function clipboardFiles(): Promise<string[]> {
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
    if (paths.length) return paths;
  }
  try {
    return parseFileList(await clipboard.read(), HOME);
  } catch {
    return [];
  }
}

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  modified: number;
  dir: boolean;
  /** For archives, once read. */
  listing?: Listing;
  /** Why it couldn't be listed. */
  error?: string;
  /** Listing was tried (streams like .gz have none). */
  read?: boolean;
}

export async function fileEntry(path: string): Promise<FileEntry | undefined> {
  const st = await Deno.stat(path).catch(() => undefined);
  if (!st || !(st.isFile || st.isDirectory)) return undefined;
  return { path, name: path.split("/").pop()!, size: st.size, modified: st.mtime?.getTime() ?? 0, dir: st.isDirectory };
}

export const RECENT_FOLDERS = () => [
  `${HOME}/Downloads`,
  `${HOME}/Téléchargements`,
  `${HOME}/Desktop`,
  `${HOME}/Bureau`,
  `${HOME}/Documents`,
];

/** The newest archives of Downloads, Desktop and Documents. */
export async function recentArchives(limit = 15): Promise<FileEntry[]> {
  const found: FileEntry[] = [];
  for (const dir of RECENT_FOLDERS()) {
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.isFile || e.name.startsWith(".") || !isArchive(e.name)) continue;
        const f = await fileEntry(`${dir}/${e.name}`);
        if (f) found.push(f);
      }
    } catch {
      // No such folder.
    }
  }
  return found.sort((a, b) => b.modified - a.modified).slice(0, limit);
}

export interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs a program in `cwd` without throwing on a non-zero exit; `stdout` may go to a file. */
export async function runStep(
  [program, args]: Step,
  o: { cwd?: string; signal?: AbortSignal; stdoutFile?: string } = {},
): Promise<Ran> {
  let file: Deno.FsFile | undefined;
  try {
    const child = new Deno.Command(program, {
      args,
      cwd: o.cwd,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: o.signal,
    }).spawn();
    let stdout = "";
    const err = new Response(child.stderr).text();
    if (o.stdoutFile) {
      // createNew: the file is never one that already exists.
      file = await Deno.open(o.stdoutFile, { write: true, createNew: true });
      await child.stdout.pipeTo(file.writable);
      file = undefined; // closed by pipeTo
    } else stdout = await new Response(child.stdout).text();
    const { code } = await child.status;
    return { code, stdout, stderr: await err };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new MissingTool(`${program} is not installed`, [program]);
    throw e;
  } finally {
    file?.close();
  }
}

/** What's inside an archive: the files, sizes, and whether it is encrypted. */
export async function loadListing(f: FileEntry, signal?: AbortSignal): Promise<void> {
  const t = await tools();
  f.read = true;
  const how = listCommand(f.path, t);
  if (!how) {
    if (archiveType(f.path)?.kind !== "stream") f.error = "No tool installed reads this archive";
    return;
  }
  try {
    const r = await runStep(how.step, { signal: signal ?? AbortSignal.timeout(15_000) });
    const listing = how.parse(`${r.stdout}\n${r.code ? r.stderr : ""}`);
    if (r.code && !listing.entries.length && !listing.locked) {
      f.error = failureLine(r.stderr || r.stdout) || `${how.step[0]} couldn't read it`;
      return;
    }
    if (archiveType(f.path)?.kind === "zip" && listing.encrypted === undefined) {
      listing.encrypted = zipEncrypted(await head(f.path)) ?? undefined;
    }
    f.listing = listing;
  } catch (e) {
    f.error = e instanceof MissingTool ? e.message : String((e as Error).message ?? e);
  }
}

async function head(path: string, n = 64 * 1024): Promise<Uint8Array> {
  const file = await Deno.open(path, { read: true }).catch(() => undefined);
  if (!file) return new Uint8Array();
  try {
    const buf = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const r = await file.read(buf.subarray(got));
      if (!r) break;
      got += r;
    }
    return buf.subarray(0, got);
  } finally {
    file.close();
  }
}

/** Archives' contents, a few at a time. */
export async function loadAll(files: FileEntry[], signal?: AbortSignal): Promise<void> {
  const queue = files.filter((f) => !f.read);
  const worker = async () => {
    for (let f = queue.shift(); f && !signal?.aborted; f = queue.shift()) await loadListing(f, signal);
  };
  await Promise.all([worker(), worker(), worker()]);
}

export const exists = (p: string) => {
  try {
    Deno.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

export const free = (dir: string, name: string, ext: string) => freePath(dir, name, ext, exists);

export class WrongPassword extends Error {}

function fail(step: Step, r: Ran): never {
  const message = `${r.stderr}\n${r.stdout}`;
  if (wrongPassword(message)) throw new WrongPassword("Wrong password");
  throw new Error(failureLine(message) || `${step[0]} exited with ${r.code}`);
}

/**
 * Extracts into `dest`, created when it isn't there; files already in it are
 * kept. A new, empty folder is removed again when extraction fails.
 */
export async function extract(archive: string, dest: string, password?: string): Promise<void> {
  const t = await tools();
  const type = archiveType(archive);
  if (type?.kind === "stream") {
    const step = decompressCommand(archive, t);
    const r = await runStep(step, { stdoutFile: dest }).catch(async (e) => {
      await Deno.remove(dest).catch(() => {});
      throw e;
    });
    if (r.code) {
      await Deno.remove(dest).catch(() => {});
      fail(step, r);
    }
    return;
  }
  const created = !exists(dest);
  if (created) await Deno.mkdir(dest, { recursive: true });
  const step = extractCommand(archive, dest, t, password);
  let r: Ran;
  try {
    r = await runStep(step);
  } catch (e) {
    if (created) await Deno.remove(dest, { recursive: true }).catch(() => {});
    throw e;
  }
  // unzip exits with 1 on warnings, 7z with 1 on warnings (skipped files), GNU tar with 1 when files changed.
  if (r.code === 0 || (r.code === 1 && !wrongPassword(r.stderr + r.stdout) && step[0] !== "bsdtar")) return;
  // Only a folder without files is removed: what was extracted before an error stays.
  if (created && !(await hasFiles(dest))) await Deno.remove(dest, { recursive: true }).catch(() => {});
  fail(step, r);
}

async function hasFiles(dir: string): Promise<boolean> {
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isDirectory || (await hasFiles(`${dir}/${e.name}`))) return true;
    }
  } catch {
    return true; // can't tell: keep it
  }
  return false;
}

/** Makes `output` (which doesn't exist) from `paths`; a partial archive is removed on failure. */
export async function compress(format: Format, paths: string[], output: string, password?: string): Promise<void> {
  const t = await tools();
  const { dir, names } = commonDir(paths);
  const step = compressCommand(format, output, names, t, password);
  let r: Ran;
  try {
    r = await runStep(step, { cwd: dir });
  } catch (e) {
    await Deno.remove(output).catch(() => {});
    throw e;
  }
  // zip exits with 18 when some files couldn't be read; 7z with 1 on warnings. The archive is still made.
  if (r.code === 0 || ((r.code === 1 || r.code === 18) && exists(output))) return;
  await Deno.remove(output).catch(() => {});
  fail(step, r);
}

/** Size of a file, or of everything in a folder (for the toast after compressing). */
export async function sizeOf(path: string, budget = { n: 5000 }): Promise<number> {
  const st = await Deno.lstat(path).catch(() => undefined);
  if (!st) return 0;
  if (!st.isDirectory) return st.size;
  let total = 0;
  try {
    for await (const e of Deno.readDir(path)) {
      if (--budget.n < 0) break;
      total += await sizeOf(`${path}/${e.name}`, budget);
    }
  } catch {
    // Unreadable folder.
  }
  return total;
}
