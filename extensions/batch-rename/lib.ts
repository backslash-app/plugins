// Copied files (clipboard URIs), the renaming rules, the plan (old → new with
// conflicts), the order that applies it safely and its undo. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Files from the clipboard

/**
 * Paths from what a file manager copies: text/uri-list (file:///…, one per
 * line, # comments), GNOME's x-special/gnome-copied-files ("copy" then URIs),
 * or plain absolute paths.
 */
export function parseFileList(text: string, home = ""): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;
    let path: string | undefined;
    if (line.startsWith("file://")) {
      try {
        const url = new URL(line);
        if (url.host && url.host !== "localhost") continue; // another machine
        path = decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
    } else if (line.startsWith("/")) path = line;
    else if (home && (line === "~" || line.startsWith("~/"))) path = home + line.slice(1);
    if (path && path.length > 1) path = path.replace(/\/+$/, "");
    if (path && path !== "/" && !out.includes(path)) out.push(path);
  }
  return out;
}

const trim = (s: string) => s.length > 1 ? s.replace(/\/+$/, "") : s;
export const basename = (p: string) => trim(p).split("/").pop() || p;
export const dirname = (p: string) => trim(p).split("/").slice(0, -1).join("/") || "/";
export const join = (dir: string, name: string) => `${dir === "/" ? "" : dir}/${name}`;

/**
 * "photo.jpg" → ["photo", "jpg"], "archive.tar.gz" → ["archive", "tar.gz"],
 * ".bashrc" → [".bashrc", ""]; folders keep their dots.
 */
export function splitName(name: string, dir = false): { stem: string; ext: string } {
  if (dir) return { stem: name, ext: "" };
  const m = name.match(/^(.+?)\.(tar\.(?:gz|bz2|xz|zst)|[^.]+)$/i);
  if (!m || !m[1] || m[1] === ".") return { stem: name, ext: "" };
  return { stem: m[1], ext: m[2] };
}

// ---------------------------------------------------------------------------
// Rules

export type CaseMode = "keep" | "lower" | "upper" | "title" | "sentence";
export type Placement = "none" | "prefix" | "suffix";

export interface Rules {
  find: string;
  replace: string;
  regex: boolean;
  ignoreCase: boolean;
  case: CaseMode;
  slugify: boolean;
  prefix: string;
  suffix: string;
  /** "replace" names the files by their number alone. */
  numbering: Placement | "replace";
  start: number;
  padding: number;
  /** Between the number or date and the name. */
  separator: string;
  date: Placement;
  dateSource: "exif" | "mtime";
  dateFormat: string;
  /** New extension without the dot; empty keeps it. */
  extension: string;
  lowerExtension: boolean;
  /** The order numbers follow. */
  order: "copied" | "name" | "date";
}

export const DEFAULT_RULES: Rules = {
  find: "",
  replace: "",
  regex: false,
  ignoreCase: false,
  case: "keep",
  slugify: false,
  prefix: "",
  suffix: "",
  numbering: "none",
  start: 1,
  padding: 3,
  separator: "_",
  date: "none",
  dateSource: "exif",
  dateFormat: "YYYY-MM-DD",
  extension: "",
  lowerExtension: false,
  order: "copied",
};

export const DATE_FORMATS = ["YYYY-MM-DD", "YYYY-MM-DD_HH-mm-ss", "YYYYMMDD_HHmmss", "YYYYMMDD", "YYYY-MM"];

/** The rules from a saved or submitted object, every field checked. */
export function readRules(v: Record<string, unknown> | undefined): Rules {
  const r = { ...DEFAULT_RULES };
  if (!v) return r;
  const str = (k: keyof Rules) => typeof v[k] === "string" ? v[k] as string : undefined;
  const bool = (k: keyof Rules) => typeof v[k] === "boolean" ? v[k] as boolean : undefined;
  const pick = <T extends string>(k: keyof Rules, options: readonly T[]) => {
    const s = str(k);
    return s && (options as readonly string[]).includes(s) ? s as T : undefined;
  };
  r.find = str("find") ?? r.find;
  r.replace = str("replace") ?? r.replace;
  r.regex = bool("regex") ?? r.regex;
  r.ignoreCase = bool("ignoreCase") ?? r.ignoreCase;
  r.case = pick("case", ["keep", "lower", "upper", "title", "sentence"] as const) ?? r.case;
  r.slugify = bool("slugify") ?? r.slugify;
  r.prefix = str("prefix") ?? r.prefix;
  r.suffix = str("suffix") ?? r.suffix;
  r.numbering = pick("numbering", ["none", "prefix", "suffix", "replace"] as const) ?? r.numbering;
  const start = Number(v.start);
  if (v.start !== undefined && v.start !== "" && Number.isInteger(start) && start >= 0) r.start = start;
  const padding = Number(v.padding);
  if (v.padding !== undefined && v.padding !== "" && Number.isInteger(padding) && padding >= 0 && padding <= 10) {
    r.padding = padding;
  }
  r.separator = str("separator") ?? r.separator;
  r.date = pick("date", ["none", "prefix", "suffix"] as const) ?? r.date;
  r.dateSource = pick("dateSource", ["exif", "mtime"] as const) ?? r.dateSource;
  r.dateFormat = str("dateFormat") || r.dateFormat;
  r.extension = (str("extension") ?? r.extension).trim().replace(/^\.+/, "");
  r.lowerExtension = bool("lowerExtension") ?? r.lowerExtension;
  r.order = pick("order", ["copied", "name", "date"] as const) ?? r.order;
  return r;
}

/** Checks what typed text can make invalid; throws a message for the user. */
export function checkRules(r: Rules): void {
  if (r.find && r.regex) {
    try {
      new RegExp(r.find);
    } catch (e) {
      throw new Error(`The pattern isn't a valid regular expression: ${(e as Error).message.replace(/^.*: /, "")}`);
    }
  }
  if (/[/\0]/.test(r.prefix + r.suffix + r.replace + r.separator)) throw new Error("Names can't contain a slash");
  if (/[/\0]/.test(r.extension) || r.extension.includes(" ")) throw new Error("Type an extension like jpg");
}

/** Whether the rules change anything at all. */
export const changesSomething = (r: Rules) =>
  !!(r.find || r.case !== "keep" || r.slugify || r.prefix || r.suffix || r.numbering !== "none" ||
    r.date !== "none" || r.extension || r.lowerExtension);

/** A one-line summary of the rules: "Replace “IMG” → “Photo” · lowercase · number 001…". */
export function describeRules(r: Rules): string {
  const parts: string[] = [];
  if (r.find) parts.push(`${r.regex ? "regex " : ""}“${r.find}” → “${r.replace}”`);
  if (r.case !== "keep") {
    parts.push(`${r.case === "sentence" ? "Sentence case" : r.case === "title" ? "Title Case" : `${r.case}case`}`);
  }
  if (r.slugify) parts.push("slug");
  if (r.date !== "none") parts.push(`${r.dateSource === "exif" ? "date taken" : "date modified"} as ${r.date}`);
  if (r.numbering !== "none") {
    parts.push(
      `${r.numbering === "replace" ? "numbers only" : `number as ${r.numbering}`} from ${pad(r.start, r.padding)}`,
    );
  }
  if (r.prefix) parts.push(`prefix “${r.prefix}”`);
  if (r.suffix) parts.push(`suffix “${r.suffix}”`);
  if (r.extension) parts.push(`.${r.extension}`);
  else if (r.lowerExtension) parts.push("lowercase extension");
  return parts.join(" · ") || "No change";
}

const pad = (n: number, width: number) => String(n).padStart(width, "0");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Find and replace on a name: plain text everywhere, or a regex with $1 groups. */
export function replaceText(text: string, r: Pick<Rules, "find" | "replace" | "regex" | "ignoreCase">): string {
  if (!r.find) return text;
  const re = new RegExp(r.regex ? r.find : escape(r.find), `g${r.ignoreCase ? "i" : ""}`);
  return text.replace(re, r.regex ? r.replace : r.replace.replace(/\$/g, "$$$$"));
}

export function changeCase(text: string, mode: CaseMode): string {
  switch (mode) {
    case "keep":
      return text;
    case "lower":
      return text.toLocaleLowerCase();
    case "upper":
      return text.toLocaleUpperCase();
    case "title":
      return text.toLocaleLowerCase().replace(/(^|[\s_\-.(\[])(\p{L})/gu, (_, sep, c) => sep + c.toLocaleUpperCase());
    case "sentence": {
      const lower = text.toLocaleLowerCase();
      return lower.replace(/\p{L}/u, (c) => c.toLocaleUpperCase());
    }
  }
}

/** "Été 2026 — Côte d'Azur!" → "ete-2026-cote-d-azur" */
export function slugify(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .replace(/æ/gi, "ae")
    .replace(/œ/gi, "oe")
    .replace(/ø/gi, "o")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Formats a date with YYYY, MM, DD, HH, mm and ss. */
export function formatDate(d: Date, format: string): string {
  const parts: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1, 2),
    DD: pad(d.getDate(), 2),
    HH: pad(d.getHours(), 2),
    mm: pad(d.getMinutes(), 2),
    ss: pad(d.getSeconds(), 2),
  };
  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => parts[t]);
}

/** "2026:07:14 18:32:05" (EXIF), with or without a time zone → a local Date. */
export function exifDate(text: unknown): Date | undefined {
  const m = String(text ?? "").match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m || m[1] === "0000") return undefined;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/** `exiftool -json -DateTimeOriginal -CreateDate -MediaCreateDate` → the date taken per path. */
export function parseExifDates(json: string): Map<string, Date> {
  const out = new Map<string, Date>();
  let rows: any[];
  try {
    rows = JSON.parse(json);
  } catch {
    return out;
  }
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const d = exifDate(r.DateTimeOriginal) ?? exifDate(r.CreateDate) ?? exifDate(r.MediaCreateDate);
    if (d && r.SourceFile) out.set(String(r.SourceFile), d);
  }
  return out;
}

export interface FileInfo {
  path: string;
  dir: boolean;
  /** Modification time, ms. */
  mtime?: number;
  /** From EXIF, when read. */
  taken?: Date;
}

/** The files in the order the numbers follow. */
export function ordered(files: FileInfo[], r: Rules): FileInfo[] {
  const list = [...files];
  if (r.order === "name") {
    list.sort((a, b) => basename(a.path).localeCompare(basename(b.path), undefined, { numeric: true }));
  } else if (r.order === "date") {
    const t = (f: FileInfo) => (r.dateSource === "exif" ? f.taken?.getTime() : undefined) ?? f.mtime ?? 0;
    list.sort((a, b) => t(a) - t(b));
  }
  return list;
}

/** The new name of the n-th file (in `ordered` order). */
export function newName(f: FileInfo, n: number, r: Rules): { name: string; dateFromMtime?: boolean } {
  let { stem, ext } = splitName(basename(f.path), f.dir);
  stem = replaceText(stem, r);
  stem = changeCase(stem, r.case);
  if (r.slugify) stem = slugify(stem);
  let dateFromMtime = false;
  let date = "";
  if (r.date !== "none") {
    const d = r.dateSource === "exif" && f.taken ? f.taken : f.mtime ? new Date(f.mtime) : undefined;
    dateFromMtime = r.dateSource === "exif" && !f.taken;
    if (d) date = formatDate(d, r.dateFormat);
  }
  const number = r.numbering === "none" ? "" : pad(r.start + n, r.padding);
  if (r.numbering === "replace") stem = "";
  const parts = [
    r.date === "prefix" ? date : "",
    r.numbering === "prefix" || r.numbering === "replace" ? number : "",
    stem,
    r.numbering === "suffix" ? number : "",
    r.date === "suffix" ? date : "",
  ].filter(Boolean);
  stem = `${r.prefix}${parts.join(r.separator)}${r.suffix}`;
  if (r.extension) ext = r.extension;
  if (r.lowerExtension) ext = ext.toLowerCase();
  return { name: ext ? `${stem}.${ext}` : stem, dateFromMtime };
}

// ---------------------------------------------------------------------------
// The plan

export type Status = "rename" | "same" | "conflict" | "invalid";

export interface Row {
  from: string;
  to: string;
  status: Status;
  reason?: string;
  /** The rules asked for the date taken and this file has none. */
  dateFromMtime?: boolean;
}

export interface Plan {
  rows: Row[];
  renames: number;
  conflicts: number;
}

const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** Why a name can't be used, if it can't. */
export function invalidName(name: string): string | undefined {
  if (!name.trim()) return "The new name is empty";
  if (name === "." || name === "..") return "Not a usable name";
  if (name.includes("/") || name.includes("\0")) return "Names can't contain a slash";
  if (utf8Length(name) > 255) return "The new name is too long";
  return undefined;
}

/**
 * Old → new for every file, with what stops a rename: two files getting the
 * same name, or a name taken by a file that stays (`exists` asks the disk).
 * A name freed by another rename of the batch is fine.
 */
export function planRows(
  pairs: { from: string; to: string; dateFromMtime?: boolean }[],
  exists: (p: string) => boolean,
): Plan {
  const sources = new Set(pairs.map((p) => p.from));
  const moving = new Set(pairs.filter((p) => p.from !== p.to).map((p) => p.from));
  const targets = new Map<string, number>();
  for (const p of pairs) targets.set(p.to, (targets.get(p.to) ?? 0) + 1);
  const rows = pairs.map(({ from, to, dateFromMtime }): Row => {
    const row: Row = { from, to, status: "rename", ...(dateFromMtime ? { dateFromMtime } : {}) };
    const bad = invalidName(basename(to));
    if (bad) return { ...row, status: "invalid", reason: bad };
    if (from === to) return { ...row, status: "same" };
    if ((targets.get(to) ?? 0) > 1) return { ...row, status: "conflict", reason: "Another file gets the same name" };
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (!caseOnly && exists(to) && !(sources.has(to) && moving.has(to))) {
      return { ...row, status: "conflict", reason: "A file with this name is already there" };
    }
    return row;
  });
  // A file that stays (conflict, invalid) keeps its name: whoever wanted it can't have it.
  const staying = new Set(rows.filter((r) => r.status !== "rename").map((r) => r.from));
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of rows) {
      if (r.status === "rename" && staying.has(r.to)) {
        Object.assign(r, { status: "conflict", reason: `${basename(r.to)} isn't renamed` });
        staying.add(r.from);
        changed = true;
      }
    }
  }
  return {
    rows,
    renames: rows.filter((r) => r.status === "rename").length,
    conflicts: rows.filter((r) => r.status === "conflict" || r.status === "invalid").length,
  };
}

/** Applies the rules to the files: the plan to preview. */
export function planRenames(files: FileInfo[], r: Rules, exists: (p: string) => boolean): Plan {
  const pairs = ordered(files, r).map((f, n) => {
    const { name, dateFromMtime } = newName(f, n, r);
    return { from: f.path, to: join(dirname(f.path), name), dateFromMtime };
  });
  return planRows(pairs, exists);
}

/**
 * The renames in an order that never needs a name still in use: straight
 * renames when no target is another file's current name, else every file
 * goes through a temporary name first (swaps, chains, case-only changes).
 */
export function renameSteps(rows: Row[], temp: (from: string, n: number) => string): [string, string][] {
  const go = rows.filter((r) => r.status === "rename");
  const sources = new Set(go.map((r) => r.from));
  const tangled = go.some((r) => sources.has(r.to) || r.from.toLowerCase() === r.to.toLowerCase());
  if (!tangled) return go.map((r) => [r.from, r.to]);
  const tmp = go.map((r, n) => temp(r.from, n));
  return [
    ...go.map((r, n): [string, string] => [r.from, tmp[n]]),
    ...go.map((r, n): [string, string] => [tmp[n], r.to]),
  ];
}

/** A hidden temporary name next to the file. */
export const tempName = (from: string, n: number, token: string) => join(dirname(from), `.bs-rename-${token}-${n}`);

/** What undoes a batch: each new name back to its old one, checked against the disk. */
export function undoPlan(renames: { from: string; to: string }[], exists: (p: string) => boolean): Plan {
  const plan = planRows(renames.map((r) => ({ from: r.to, to: r.from })), exists);
  for (const row of plan.rows) {
    if (row.status === "rename" && !exists(row.from)) {
      Object.assign(row, { status: "conflict", reason: `${basename(row.from)} isn't there anymore` });
    }
  }
  plan.renames = plan.rows.filter((r) => r.status === "rename").length;
  plan.conflicts = plan.rows.filter((r) => r.status === "conflict" || r.status === "invalid").length;
  return plan;
}

/**
 * The copied paths, following the last batch when they were renamed by it
 * (the clipboard still holds the old names).
 */
export function followRenames(paths: string[], renames: { from: string; to: string }[] | undefined): string[] {
  const map = new Map((renames ?? []).map((r) => [r.from, r.to]));
  return [...new Set(paths.map((p) => map.get(p) ?? p))];
}

// ---------------------------------------------------------------------------
// Formatting

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
