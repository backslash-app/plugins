// Copied files, their dates (exiftool), renaming on disk with a rollback, and
// the last batch kept for undo.

import { clipboard, exec, storage } from "@backslash/api";
import {
  basename,
  type FileInfo,
  parseExifDates,
  parseFileList,
  type Plan,
  renameSteps,
  type Row,
  type Rules,
  tempName,
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

let exiftool: Promise<boolean> | undefined;

export function hasExiftool(): Promise<boolean> {
  exiftool ??= new Deno.Command("exiftool", { args: ["-ver"], stdin: "null", stdout: "null", stderr: "null" })
    .output().then(() => true, () => false);
  return exiftool;
}

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

/** The files that are there, with their modification time. */
export async function fileInfos(paths: string[]): Promise<FileInfo[]> {
  const found = await Promise.all(paths.map(async (path) => {
    const st = await Deno.lstat(path).catch(() => undefined);
    return st ? { path, dir: st.isDirectory, mtime: st.mtime?.getTime() } : undefined;
  }));
  return found.filter((f): f is NonNullable<typeof f> => !!f);
}

/** Adds the date taken (EXIF, or the creation date of videos) to the files that have one. */
export async function loadDates(files: FileInfo[], signal?: AbortSignal): Promise<void> {
  const todo = files.filter((f) => !f.dir && !f.taken);
  if (!todo.length || !(await hasExiftool())) return;
  for (let i = 0; i < todo.length; i += 200) {
    const batch = todo.slice(i, i + 200);
    const out = await exec(
      "exiftool",
      ["-json", "-q", "-q", "-DateTimeOriginal", "-CreateDate", "-MediaCreateDate", "--", ...batch.map((f) => f.path)],
      { signal },
    ).catch((e) => String((e as Error).message ?? "").replace(/^.*exited with \d+: /s, ""));
    const dates = parseExifDates(out.slice(out.indexOf("[")));
    for (const f of batch) f.taken = dates.get(f.path) ?? f.taken;
  }
}

export const exists = (p: string) => {
  try {
    Deno.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Renaming

export interface Batch {
  at: number;
  renames: { from: string; to: string }[];
  rules?: string;
}

type Json = Parameters<typeof storage.set>[1];

export const lastBatch = async (): Promise<Batch | undefined> =>
  (await storage.get("last")) as unknown as Batch | undefined;
export const forgetBatch = () => storage.delete("last");

export const savedRules = async (): Promise<Record<string, unknown> | undefined> =>
  (await storage.get("rules")) as Record<string, unknown> | undefined;
export const saveRules = (r: Rules) => storage.set("rules", r as unknown as Json);

/**
 * Renames on disk in a safe order. Each step checks that its target is
 * still free (Deno.rename would replace a file); on any error, what was
 * done is undone in reverse.
 */
export async function applyRows(rows: Row[]): Promise<{ from: string; to: string }[]> {
  const token = Date.now().toString(36);
  const steps = renameSteps(rows, (from, n) => tempName(from, n, token));
  const done: [string, string][] = [];
  try {
    for (const [from, to] of steps) {
      if (exists(to) && from.toLowerCase() !== to.toLowerCase()) {
        throw new Error(`${basename(to)} appeared meanwhile: nothing was overwritten`);
      }
      await Deno.rename(from, to);
      done.push([from, to]);
    }
  } catch (e) {
    for (const [from, to] of done.reverse()) await Deno.rename(to, from).catch(() => {});
    if (e instanceof Deno.errors.PermissionDenied) throw new Error("Not allowed to rename these files");
    throw e;
  }
  return rows.filter((r) => r.status === "rename").map((r) => ({ from: r.from, to: r.to }));
}

/** Applies a plan and remembers it for undo. */
export async function rename(plan: Plan, rules?: string): Promise<number> {
  const renames = await applyRows(plan.rows);
  if (renames.length) await storage.set("last", { at: Date.now(), renames, ...(rules ? { rules } : {}) } as Json);
  return renames.length;
}
