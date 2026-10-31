// Sizes, hash program output, grouping files into duplicates and choosing
// which copy to keep. No I/O here.

export interface FileInfo {
  path: string;
  size: number;
  /** Modification time, ms. */
  mtime: number;
  /** Same dev + ino = the same file reached by two hard links (trashing one frees nothing). */
  dev?: number;
  ino?: number;
}

export interface Group {
  hash: string;
  size: number;
  /** Newest first. */
  files: FileInfo[];
  /** What deleting all but one copy frees. */
  wasted: number;
}

const UNITS: Record<string, number> = {
  "": 1,
  b: 1,
  k: 1024,
  kb: 1024,
  kib: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  mib: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  gib: 1024 ** 3,
  o: 1,
  ko: 1024,
  mo: 1024 ** 2,
  go: 1024 ** 3,
};

/** "1 MB", "500k", "2.5G", "0" → bytes. Throws on anything else. */
export function parseSize(text: string): number {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*([a-z]*)\s*$/i.exec(text);
  const unit = m ? UNITS[m[2].toLowerCase()] : undefined;
  if (!m || unit === undefined) throw new Error(`“${text}” is not a size: write it like 500 KB, 1 MB or 2 GB`);
  return Math.round(Number(m[1].replace(",", ".")) * unit);
}

/** 1536 → "1.5 KB", binary units as file managers show them. */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = -1;
  do {
    v /= 1024;
    i++;
  } while (v >= 1024 && i < units.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

/**
 * `sha256sum` / `b3sum` lines → path → hash. `hash  path` (or `hash *path`
 * in binary mode); a name with a backslash or newline is escaped and the
 * line starts with `\`.
 */
export function parseHashOutput(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^(\\?)([0-9a-f]{32,128}) [ *](.+)$/.exec(line);
    if (!m) continue;
    const path = m[1] ? m[3].replace(/\\(\\|n|r)/g, (_, c) => (c === "n" ? "\n" : c === "r" ? "\r" : "\\")) : m[3];
    out.set(path, m[2]);
  }
  return out;
}

/** One entry per real file: hard links to the same inode count once. */
export function dedupeHardLinks(files: FileInfo[]): FileInfo[] {
  const seen = new Set<string>();
  return files.filter((f) => {
    if (f.ino === undefined || f.dev === undefined) return true;
    const key = `${f.dev}:${f.ino}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Files that share their size with another: the only ones worth hashing. */
export function sameSize(files: FileInfo[]): FileInfo[][] {
  const bySize = new Map<number, FileInfo[]>();
  for (const f of dedupeHardLinks(files)) {
    if (f.size <= 0) continue;
    const list = bySize.get(f.size);
    if (list) list.push(f);
    else bySize.set(f.size, [f]);
  }
  return [...bySize.values()].filter((g) => g.length > 1);
}

/** Splits files by a key (a partial or full hash), keeping only groups of two or more. */
export function splitBy(files: FileInfo[], key: (f: FileInfo) => string | undefined): FileInfo[][] {
  const by = new Map<string, FileInfo[]>();
  for (const f of files) {
    const k = key(f);
    if (k === undefined) continue;
    const list = by.get(k);
    if (list) list.push(f);
    else by.set(k, [f]);
  }
  return [...by.values()].filter((g) => g.length > 1);
}

const newestFirst = (a: FileInfo, b: FileInfo) => b.mtime - a.mtime || a.path.localeCompare(b.path);

export function makeGroup(hash: string, files: FileInfo[]): Group {
  const sorted = [...files].sort(newestFirst);
  return { hash, size: sorted[0].size, files: sorted, wasted: sorted[0].size * (sorted.length - 1) };
}

/** Most space to win first. */
export const byWasted = (a: Group, b: Group) => b.wasted - a.wasted || a.files[0].path.localeCompare(b.files[0].path);

export type Keep = "newest" | "oldest";

/** The copy to keep and the ones to trash. */
export function split(group: Group, keep: Keep | string): { keep: FileInfo; trash: FileInfo[] } {
  const k = keep === "newest"
    ? group.files[0]
    : keep === "oldest"
    ? group.files[group.files.length - 1]
    : group.files.find((f) => f.path === keep);
  if (!k) throw new Error("That file is no longer in the group");
  return { keep: k, trash: group.files.filter((f) => f !== k) };
}

/** The group without files that are gone; undefined when fewer than two remain. */
export function without(group: Group, gone: Set<string>): Group | undefined {
  const files = group.files.filter((f) => !gone.has(f.path));
  return files.length > 1 ? makeGroup(group.hash, files) : undefined;
}

// ---------------------------------------------------------------------------
// Walking

/** Folders never worth searching: tool caches, version control, trash. */
const SKIP = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "__pycache__",
  ".venv",
  ".tox",
  ".Trash",
  "Trash",
  ".cache",
  ".npm",
  ".cargo",
  ".rustup",
  ".gradle",
  ".m2",
  ".var",
  "lost+found",
]);

export function skipDir(name: string, hidden: boolean): boolean {
  if (SKIP.has(name) || /^\.Trash-\d+$/.test(name)) return true;
  return !hidden && name.startsWith(".");
}

// ---------------------------------------------------------------------------
// Display

export const baseName = (p: string) => p.slice(p.lastIndexOf("/") + 1) || p;
export const dirName = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";

/** A path shown from the scanned folder: `Photos/2024/a.jpg`, or `~/…` outside it. */
export function relativeTo(root: string, path: string, home = ""): string {
  const r = root.replace(/\/+$/, "");
  if (path.startsWith(`${r}/`)) return path.slice(r.length + 1);
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

/** Where the copies are: one folder's name, or "3 folders". */
export function whereSummary(group: Group, root: string, home = ""): string {
  const dirs = [...new Set(group.files.map((f) => dirName(f.path)))];
  if (dirs.length === 1) return relativeTo(root, `${dirs[0]}/`, home).replace(/\/$/, "") || "this folder";
  return `${dirs.length} folders`;
}

export function formatDate(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** The files of a group as a markdown list, the newest marked. */
export function groupMarkdown(group: Group, root: string, home = ""): string {
  const esc = (s: string) => s.replace(/([\\`*_[\]<>|])/g, "\\$1");
  const lines = group.files.map((f, i) => {
    const tag = i === 0 ? " — **newest**" : i === group.files.length - 1 ? " — oldest" : "";
    return `- \`${relativeTo(root, f.path, home).replace(/`/g, "'")}\`  \n  ${esc(formatDate(f.mtime))}${tag}`;
  });
  return [`**${group.files.length} identical copies** of ${formatSize(group.size)}`, "", ...lines].join("\n");
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Files of many groups to trash, keeping one per group. */
export function trashPlan(groups: Group[], keep: Keep): { files: FileInfo[]; bytes: number } {
  const files = groups.flatMap((g) => split(g, keep).trash);
  return { files, bytes: files.reduce((s, f) => s + f.size, 0) };
}

/** Prunes a hash cache: drops the oldest entries above `max`. */
export function pruneCache<T extends { at: number }>(cache: Record<string, T>, max: number): Record<string, T> {
  const entries = Object.entries(cache);
  if (entries.length <= max) return cache;
  return Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, max));
}
