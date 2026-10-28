// Installed tools, files from the clipboard and recent folders, picture info,
// and running an operation.

import { clipboard, exec } from "@backslash/api";
import {
  canWriteAvif,
  command,
  EXIFTOOL_TAGS,
  type Family,
  IDENTIFY_FORMAT,
  IMAGE,
  type ImageInfo,
  imageSize,
  type Operation,
  osFamily,
  outputFor,
  outputPath,
  parseExiftool,
  parseFileList,
  parseIdentify,
  type Tools,
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
    const [magick7, magick6, exiftool, cwebp, avifenc] = await Promise.all([
      has("magick", ["-version"]),
      has("convert", ["-version"]),
      has("exiftool", ["-ver"]),
      has("cwebp", ["-version"]),
      has("avifenc", ["--version"]),
    ]);
    const magick = magick7 ? "magick" : magick6 ? "convert" : undefined;
    const formats = magick ? await output(magick, ["-list", "format"]) : undefined;
    return { magick, exiftool, cwebp, avifenc, magickAvif: !!formats && canWriteAvif(formats) };
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

export interface ImageFile {
  path: string;
  name: string;
  size: number;
  modified: number;
  width?: number;
  height?: number;
  info?: ImageInfo;
}

async function head(path: string, n = 256 * 1024): Promise<Uint8Array> {
  const f = await Deno.open(path, { read: true });
  try {
    const buf = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const r = await f.read(buf.subarray(got));
      if (!r) break;
      got += r;
      if (got >= 32 && buf[0] !== 0xff) break;
    }
    return buf.subarray(0, got);
  } finally {
    f.close();
  }
}

/** A file's size and dimensions, or undefined when it can't be read. */
export async function imageFile(path: string): Promise<ImageFile | undefined> {
  const st = await Deno.stat(path).catch(() => undefined);
  if (!st?.isFile) return undefined;
  const file: ImageFile = { path, name: path.split("/").pop()!, size: st.size, modified: st.mtime?.getTime() ?? 0 };
  const size = imageSize(await head(path).catch(() => new Uint8Array()));
  if (size) Object.assign(file, size);
  return file;
}

export const RECENT_FOLDERS = () => [
  `${HOME}/Pictures`,
  `${HOME}/Pictures/Screenshots`,
  `${HOME}/Images`,
  `${HOME}/Downloads`,
  `${HOME}/Téléchargements`,
  `${HOME}/Desktop`,
  `${HOME}/Bureau`,
];

/** The newest pictures of Pictures, Downloads and Desktop. */
export async function recentImages(limit = 30): Promise<ImageFile[]> {
  const found: { path: string; modified: number }[] = [];
  for (const dir of RECENT_FOLDERS()) {
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.isFile || !IMAGE.test(e.name) || e.name.startsWith(".")) continue;
        const st = await Deno.stat(`${dir}/${e.name}`).catch(() => undefined);
        if (st) found.push({ path: `${dir}/${e.name}`, modified: st.mtime?.getTime() ?? 0 });
      }
    } catch {
      // No such folder.
    }
  }
  const newest = found.sort((a, b) => b.modified - a.modified).slice(0, limit);
  return (await Promise.all(newest.map((f) => imageFile(f.path)))).filter((f): f is ImageFile => !!f);
}

/** EXIF and format details: exiftool for all files at once, else identify per file. */
export async function loadInfo(files: ImageFile[], signal?: AbortSignal): Promise<void> {
  if (!files.length) return;
  const t = await tools();
  if (t.exiftool) {
    const out = await exec("exiftool", ["-json", "-n", "-q", ...EXIFTOOL_TAGS, "--", ...files.map((f) => f.path)], {
      signal,
    }).catch((e) => String(e).includes("exited with 1") ? "" : "");
    const map = parseExiftool(out);
    for (const f of files) {
      const info = map.get(f.path);
      if (info) f.info = info;
    }
    if (map.size) return;
  }
  if (!t.magick) return;
  const identify: [string, string[]] = t.magick === "magick" ? ["magick", ["identify"]] : ["identify", []];
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f && !signal?.aborted; f = queue.shift()) {
      const out = await exec(identify[0], [...identify[1], "-format", IDENTIFY_FORMAT, "--", f.path], { signal })
        .catch(() => undefined);
      if (out) f.info = parseIdentify(out);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

const exists = (p: string) => {
  try {
    Deno.statSync(p);
    return true;
  } catch {
    return false;
  }
};

export interface Result {
  input: string;
  output: string;
  before: number;
  after: number;
}

/** Runs one operation; the output goes next to the original, never over a file. */
export async function apply(op: Operation, input: string): Promise<Result> {
  const t = await tools();
  const { suffix, ext } = outputFor(op, input);
  const out = outputPath(input, suffix, ext, exists);
  const [program, args] = command(op, input, out, t);
  try {
    await exec(program, args);
  } catch (e) {
    await Deno.remove(out).catch(() => {});
    if (e instanceof Deno.errors.NotFound) throw new Error(`${program} is not installed`);
    throw new Error(String((e as Error).message).replace(/^.*exited with \d+: /, "").split("\n")[0] || String(e));
  }
  const [before, after] = await Promise.all([
    Deno.stat(input).then((s) => s.size).catch(() => 0),
    Deno.stat(out).then((s) => s.size).catch(() => 0),
  ]);
  if (!after) throw new Error(`${program} wrote nothing`);
  return { input, output: out, before, after };
}
