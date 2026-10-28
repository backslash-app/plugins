// Installed tools, copied and recent files, document info and previews,
// running operations, and the merge list.

import { clipboard, exec, storage } from "@backslash/api";
import {
  type Family,
  freePath,
  IMAGE,
  MissingTool,
  type Op,
  osFamily,
  parseFileList,
  parsePdfinfo,
  PDF,
  type PdfInfo,
  plan,
  type Tools,
  wrongPassword,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/pdf-tools`;
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
    const names = ["qpdf", "gs", "pdftk", "pdfinfo", "pdftoppm", "pdfunite", "pdfseparate", "img2pdf"] as const;
    const probe: Record<string, string[]> = {
      pdfinfo: ["-v"],
      pdftoppm: ["-v"],
      pdfunite: ["-v"],
      pdfseparate: ["-v"],
    };
    const ok = await Promise.all(names.map((n) => has(n, probe[n])));
    const [m7, m6] = await Promise.all([has("magick", ["-version"]), has("convert", ["-version"])]);
    const t = Object.fromEntries(names.map((n, i) => [n, ok[i]])) as unknown as Tools;
    t.magick = m7 ? "magick" : m6 ? "convert" : undefined;
    return t;
  })();
  return found;
}

// ---------------------------------------------------------------------------
// Files

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

export interface PdfFile {
  path: string;
  name: string;
  size: number;
  modified: number;
  info?: PdfInfo;
  preview?: string;
}

export async function pdfFile(path: string): Promise<PdfFile | undefined> {
  const st = await Deno.stat(path).catch(() => undefined);
  if (!st?.isFile) return undefined;
  return { path, name: path.split("/").pop()!, size: st.size, modified: st.mtime?.getTime() ?? 0 };
}

export const RECENT_FOLDERS = () => [
  `${HOME}/Downloads`,
  `${HOME}/Téléchargements`,
  `${HOME}/Documents`,
  `${HOME}/Desktop`,
  `${HOME}/Bureau`,
];

export async function recentPdfs(limit = 25): Promise<PdfFile[]> {
  const found: PdfFile[] = [];
  for (const dir of RECENT_FOLDERS()) {
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.isFile || !PDF.test(e.name) || e.name.startsWith(".")) continue;
        const f = await pdfFile(`${dir}/${e.name}`);
        if (f) found.push(f);
      }
    } catch {
      // No such folder.
    }
  }
  return found.sort((a, b) => b.modified - a.modified).slice(0, limit);
}

/** Pages, title, author… from pdfinfo (or qpdf for the page count). */
export async function loadInfo(f: PdfFile): Promise<void> {
  const t = await tools();
  if (t.pdfinfo) {
    try {
      f.info = parsePdfinfo(await exec("pdfinfo", ["--", f.path]));
      return;
    } catch (e) {
      if (wrongPassword(String(e))) {
        f.info = { encrypted: true, locked: true };
        return;
      }
    }
  }
  if (t.qpdf) {
    const pages = await output("qpdf", ["--show-npages", f.path]);
    // qpdf --is-encrypted exits with 0 when the file is encrypted.
    const encrypted = await new Deno.Command("qpdf", {
      args: ["--is-encrypted", f.path],
      stdout: "null",
      stderr: "null",
    })
      .output().then((o) => o.code === 0).catch(() => false);
    f.info = { pages: pages ? Number(pages.trim()) || undefined : undefined, encrypted };
  }
}

async function cacheKey(f: PdfFile): Promise<string> {
  const data = new TextEncoder().encode(`${f.path}\u0000${f.size}\u0000${f.modified}`);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-1", data))].map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** A picture of the first page (pdftoppm), cached. */
export async function loadPreview(f: PdfFile): Promise<void> {
  if (f.info?.locked || !(await tools()).pdftoppm) return;
  const file = `${CACHE}/previews/${await cacheKey(f)}`;
  if (await Deno.stat(`${file}.png`).then((s) => s.size > 0).catch(() => false)) {
    f.preview = `${file}.png`;
    return;
  }
  await Deno.mkdir(`${CACHE}/previews`, { recursive: true });
  try {
    await exec("pdftoppm", ["-png", "-f", "1", "-l", "1", "-scale-to", "480", "-singlefile", f.path, file]);
    f.preview = `${file}.png`;
  } catch {
    // Damaged or protected: no preview.
  }
}

/** Info and previews, a few files at a time. */
export async function loadAll(files: PdfFile[], signal?: AbortSignal): Promise<void> {
  const queue = files.filter((f) => !f.info);
  const worker = async () => {
    for (let f = queue.shift(); f && !signal?.aborted; f = queue.shift()) {
      await loadInfo(f);
      await loadPreview(f);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

export const exists = (p: string) => {
  try {
    Deno.statSync(p);
    return true;
  } catch {
    return false;
  }
};

export const free = (dir: string, name: string, ext: string) => freePath(dir, name, ext, exists);

export class WrongPassword extends Error {}

/** Runs an operation. Temporary pages go in the cache and are removed. */
export async function perform(op: Op): Promise<void> {
  const t = await tools();
  const steps = plan(op, t);
  if (op.kind === "extract") await Deno.mkdir(op.tmp, { recursive: true });
  if (op.kind === "split" || op.kind === "toImages") await Deno.mkdir(op.dir, { recursive: true });
  try {
    for (const s of steps) {
      try {
        await exec(s.program, s.args, { stdin: s.stdin });
      } catch (e) {
        const message = String((e as Error).message ?? e);
        if (e instanceof Deno.errors.NotFound) throw new MissingTool(`${s.program} is not installed`, [s.program]);
        if (wrongPassword(message)) throw new WrongPassword("Wrong password");
        // qpdf exits with 3 when it succeeded with warnings.
        if (s.program === "qpdf" && /exited with 3/.test(message)) continue;
        throw new Error(message.replace(/^.*exited with \d+: /, "").split("\n")[0] || message);
      }
    }
  } catch (e) {
    if ("output" in op) await Deno.remove(op.output).catch(() => {});
    throw e;
  } finally {
    if (op.kind === "extract") await Deno.remove(op.tmp, { recursive: true }).catch(() => {});
  }
}

export const isImage = (p: string) => IMAGE.test(p);
export const isPdf = (p: string) => PDF.test(p);

// ---------------------------------------------------------------------------
// The merge list, in order

export const mergeList = async (): Promise<string[]> => (await storage.get<string[]>("merge")) ?? [];
export const setMergeList = (paths: string[]) => storage.set("merge", paths);
