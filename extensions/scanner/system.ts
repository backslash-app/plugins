// scanimage (SANE) for scanning; img2pdf or ImageMagick for PDFs; ocrmypdf or tesseract
// for the text. Pages wait in ~/.cache/backslash/scanner until they are saved.

import { storage } from "@backslash/api";
import {
  batchArgs,
  batchPages,
  explainSane,
  fileName,
  type Format,
  freeName,
  type Job,
  ocrmypdfArgs,
  type Options,
  parseOptions,
  parseScanners,
  pdfArgs,
  type PdfTool,
  recentScans,
  scanArgs,
  type ScanFile,
  type Scanner,
  tesseractPdfArgs,
  tesseractTextArgs,
} from "./lib.ts";

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name) || undefined;
  } catch {
    return undefined;
  }
}

export const HOME = env("HOME") ?? "";
export const SCANS = `${HOME}/Documents/Scans`;
export const CACHE = `${HOME}/.cache/backslash/scanner`;

export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

export class NotInstalled extends Error {}

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

async function sh(program: string, args: string[], timeout: number, signal?: AbortSignal): Promise<Output> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: { LC_ALL: "C" },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable) throw new NotInstalled(program);
    throw e;
  }
  const d = (b: Uint8Array) => new TextDecoder().decode(b);
  return { code: out.code, stdout: d(out.stdout), stderr: d(out.stderr).trim() };
}

async function must(program: string, args: string[], timeout: number): Promise<string> {
  const o = await sh(program, args, timeout);
  if (o.code !== 0) throw new Error(o.stderr.split("\n").filter(Boolean).pop() || `${program} exited with ${o.code}`);
  return o.stdout;
}

export async function installed(program: string): Promise<boolean> {
  try {
    await sh(program, ["--version"], 5000);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Scanners, cached: network discovery takes seconds

export async function cachedScanners(): Promise<Scanner[] | undefined> {
  return await storage.get("scanners").catch(() => undefined) as unknown as Scanner[] | undefined;
}

export async function scanners(signal?: AbortSignal): Promise<Scanner[]> {
  const o = await sh("scanimage", ["-L"], 60_000, signal);
  if (o.code !== 0 && !/No scanners were identified/i.test(o.stdout + o.stderr)) throw new Error(explainSane(o.stderr));
  const found = parseScanners(o.stdout);
  await storage.set("scanners", found as never).catch(() => {});
  return found;
}

export async function options(device: string): Promise<Options> {
  const key = `options:${device}`;
  const cached = await storage.get(key).catch(() => undefined) as unknown as Options | undefined;
  if (cached?.modes?.length) return cached;
  const o = await sh("scanimage", ["-d", device, "-A"], 60_000);
  if (o.code !== 0) throw new Error(explainSane(o.stderr || o.stdout));
  const parsed = parseOptions(o.stdout);
  await storage.set(key, parsed as never).catch(() => {});
  return parsed;
}

export interface Last {
  device?: string;
  preset?: string;
  source?: string;
}

export const last = async (): Promise<Last> =>
  (await storage.get("last").catch(() => undefined) as unknown as Last | undefined) ?? {};
export const remember = (l: Last) => storage.set("last", l as never).catch(() => {});

// ---------------------------------------------------------------------------
// Scanning

let counter = 0;

/** A fresh folder for the pages of one document. */
export async function workDir(): Promise<string> {
  const dir = `${CACHE}/${Date.now()}-${counter++}`;
  await Deno.mkdir(dir, { recursive: true });
  return dir;
}

/** One page from the flatbed (or the first sheet of the feeder) into `dir`. */
export async function scanPage(job: Job, dir: string, index: number, format: "png" | "jpeg"): Promise<string> {
  const out = `${dir}/page-${String(index).padStart(3, "0")}.${format === "jpeg" ? "jpg" : "png"}`;
  const o = await sh("scanimage", scanArgs(job, out, format), 300_000);
  if (o.code !== 0) {
    await Deno.remove(out).catch(() => {});
    throw new Error(explainSane(o.stderr));
  }
  return out;
}

/** Every sheet in the feeder. scanimage stops with "out of documents": that's the normal end. */
export async function scanFeeder(job: Job, dir: string): Promise<string[]> {
  const o = await sh("scanimage", batchArgs(job, dir), 900_000);
  const pages = batchPages(await Array.fromAsync(Deno.readDir(dir), (e) => e.name)).map((n) => `${dir}/${n}`);
  if (!pages.length) throw new Error(explainSane(o.stderr || "Document feeder out of documents"));
  return pages;
}

async function pdfTool(): Promise<PdfTool | undefined> {
  for (const tool of ["img2pdf", "magick", "convert"] as const) if (await installed(tool)) return tool;
  return undefined;
}

async function taken(): Promise<Set<string>> {
  await Deno.mkdir(SCANS, { recursive: true });
  return new Set(await Array.fromAsync(Deno.readDir(SCANS), (e) => e.name));
}

export interface Saved {
  path: string;
  ocr?: "ocrmypdf" | "tesseract";
  note?: string;
}

/** The pages as one PDF in ~/Documents/Scans, searchable when OCR is asked and available. */
export async function savePdf(pages: string[], name: string | undefined, ocr: boolean, langs: string): Promise<Saved> {
  const dir = pages[0].slice(0, pages[0].lastIndexOf("/"));
  const target = `${SCANS}/${freeName(fileName(new Date(), name, "pdf"), await taken())}`;
  const raw = `${dir}/document.pdf`;
  let note: string | undefined;

  // Without img2pdf or ImageMagick, tesseract writes the PDF itself (and its text layer).
  const tool = await pdfTool();
  if (!tool || (ocr && !(await installed("ocrmypdf")) && (await installed("tesseract")))) {
    if (!(await installed("tesseract"))) {
      const images = await saveImages(pages, name, "png", false, langs);
      return { path: images[0].path, note: "Saved as PNG images: install img2pdf (or ImageMagick) to make PDFs" };
    }
    const list = `${dir}/pages.txt`;
    await Deno.writeTextFile(list, pages.join("\n") + "\n");
    await must("tesseract", tesseractPdfArgs(list, `${dir}/document`, langs), 900_000);
    await Deno.rename(raw, target).catch(async () => await Deno.copyFile(raw, target));
    return { path: target, ocr: "tesseract" };
  }
  await must(tool, pdfArgs(tool, pages, raw), 300_000).catch((e) => {
    throw new Error(
      tool === "img2pdf"
        ? e.message
        : `ImageMagick couldn't write the PDF (its security policy may forbid PDF): ${e.message}`,
    );
  });
  let result = raw;
  let used: Saved["ocr"];
  if (ocr) {
    try {
      await must("ocrmypdf", ocrmypdfArgs(raw, `${dir}/ocr.pdf`, langs), 900_000);
      result = `${dir}/ocr.pdf`;
      used = "ocrmypdf";
    } catch (e) {
      note = e instanceof NotInstalled
        ? "ocrmypdf isn't installed: saved without a text layer"
        : `Text recognition failed: ${(e as Error).message}`;
    }
  }
  await Deno.copyFile(result, target);
  return { path: target, ocr: used, note };
}

/** Each page as an image in ~/Documents/Scans, with its text in a .txt next to it when asked. */
export async function saveImages(
  pages: string[],
  name: string | undefined,
  format: Format,
  ocr: boolean,
  langs: string,
): Promise<Saved[]> {
  const ext = format === "jpeg" ? "jpg" : "png";
  const names = await taken();
  const saved: Saved[] = [];
  const base = fileName(new Date(), name, ext).replace(/\.[^.]+$/, "");
  for (const [i, page] of pages.entries()) {
    const wanted = pages.length > 1 ? `${base} - ${i + 1}.${ext}` : `${base}.${ext}`;
    const file = freeName(wanted, names);
    names.add(file);
    const target = `${SCANS}/${file}`;
    await Deno.copyFile(page, target);
    let note: string | undefined;
    let used: Saved["ocr"];
    if (ocr) {
      try {
        await must("tesseract", tesseractTextArgs(target, target.replace(/\.[^.]+$/, ""), langs), 300_000);
        used = "tesseract";
      } catch (e) {
        note = e instanceof NotInstalled ? "tesseract isn't installed: no text recognized" : (e as Error).message;
      }
    }
    saved.push({ path: target, ocr: used, note });
  }
  return saved;
}

/** Adds a text layer to a saved PDF, or a .txt next to an image. */
export async function recognize(file: ScanFile, langs: string): Promise<void> {
  if (file.ext === "pdf") {
    const out = `${await workDir()}/ocr.pdf`;
    await must("ocrmypdf", ocrmypdfArgs(file.path, out, langs), 900_000).catch((e) => {
      throw e instanceof NotInstalled ? new Error("Install ocrmypdf to make PDFs searchable") : e;
    });
    await Deno.copyFile(out, file.path);
  } else {
    await must("tesseract", tesseractTextArgs(file.path, file.path.replace(/\.[^.]+$/, ""), langs), 300_000).catch(
      (e) => {
        throw e instanceof NotInstalled ? new Error("Install tesseract to recognize text") : e;
      },
    );
  }
}

export async function cleanUp(dir: string) {
  if (dir.startsWith(CACHE)) await Deno.remove(dir, { recursive: true }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Results

export async function recent(limit = 50): Promise<ScanFile[]> {
  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(SCANS));
  } catch {
    return [];
  }
  const stats = await Promise.all(
    entries.filter((e) => e.isFile).map(async (e) => {
      const info = await Deno.stat(`${SCANS}/${e.name}`).catch(() => undefined);
      return { name: e.name, size: info?.size ?? 0, modified: info?.mtime?.getTime() ?? 0 };
    }),
  );
  return recentScans(stats, SCANS).slice(0, limit);
}

export async function trash(file: ScanFile) {
  await must("gio", ["trash", "--", file.path], 15_000).catch((e) => {
    throw e instanceof NotInstalled ? new Error("gio is needed to move files to the trash") : e;
  });
  if (file.text) await must("gio", ["trash", "--", file.text], 15_000).catch(() => {});
}

export const osRelease = () => Deno.readTextFile("/etc/os-release").catch(() => "");
