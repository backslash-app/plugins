// Obsidian logic: vault discovery, markdown parsing (frontmatter, tags,
// links), daily note paths in moment.js format, and obsidian:// URIs.

export interface Vault {
  id: string;
  name: string;
  path: string;
  /** Last opened, ms. */
  ts: number;
  open: boolean;
}

/** Where Obsidian keeps `obsidian.json`: native, Flatpak and Snap installs. */
export const CONFIG_PATHS = [
  ".config/obsidian/obsidian.json",
  ".var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json",
  "snap/obsidian/current/.config/obsidian/obsidian.json",
];

/** Vaults of an `obsidian.json`, most recently opened first. */
export function parseVaults(json: string): Vault[] {
  let data: { vaults?: Record<string, { path?: string; ts?: number; open?: boolean }> };
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  return Object.entries(data.vaults ?? {})
    .filter(([, v]) => typeof v?.path === "string" && v.path)
    .map(([id, v]) => ({
      id,
      name: basename(v.path!.replace(/\/+$/, "")),
      path: v.path!.replace(/\/+$/, ""),
      ts: Number(v.ts ?? 0),
      open: v.open === true,
    }))
    .sort((a, b) => Number(b.open) - Number(a.open) || b.ts - a.ts);
}

/** Merges vault lists (several installs), keeping the first of each path. */
export function mergeVaults(lists: Vault[][]): Vault[] {
  const seen = new Set<string>();
  const out: Vault[] = [];
  for (const v of lists.flat().sort((a, b) => Number(b.open) - Number(a.open) || b.ts - a.ts)) {
    if (seen.has(v.path)) continue;
    seen.add(v.path);
    out.push(v);
  }
  return out;
}

/** The vault a preference names (case-insensitive), else the last opened. */
export function pickVault(vaults: Vault[], name: unknown): Vault | undefined {
  const n = String(name ?? "").trim().toLowerCase();
  return (n && vaults.find((v) => v.name.toLowerCase() === n || v.path.toLowerCase() === n)) || vaults[0];
}

export const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1);
export const dirname = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
export const stripMd = (p: string) => p.replace(/\.md$/i, "");

// ---------------------------------------------------------------------------
// Markdown

export interface Frontmatter {
  raw: string;
  /** Scalar values and lists, as strings. */
  fields: Record<string, string | string[]>;
}

/** Splits `---\nyaml\n---\nbody`. */
export function splitFrontmatter(text: string): { frontmatter: Frontmatter; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { frontmatter: { raw: "", fields: {} }, body: text };
  return { frontmatter: { raw: m[1], fields: parseYamlish(m[1]) }, body: text.slice(m[0].length) };
}

const unquote = (s: string) => s.trim().replace(/^(["'])(.*)\1$/, "$2");

/**
 * The flat subset of YAML frontmatter uses: `key: value`, `key: [a, b]` and
 * `key:` followed by `- item` lines. Nested maps are kept as text.
 */
export function parseYamlish(yaml: string): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  let listKey: string | undefined;
  for (const line of yaml.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && listKey) {
      (out[listKey] as string[]).push(unquote(item[1]));
      continue;
    }
    const kv = /^([A-Za-z0-9_\- ]+?)\s*:\s*(.*)$/.exec(line);
    if (!kv || /^\s/.test(line)) continue;
    const [, key, value] = kv;
    if (!value.trim()) {
      out[key] = [];
      listKey = key;
    } else if (/^\[.*\]$/.test(value.trim())) {
      out[key] = value.trim().slice(1, -1).split(",").map(unquote).filter(Boolean);
      listKey = undefined;
    } else {
      out[key] = unquote(value);
      listKey = undefined;
    }
  }
  return out;
}

const asList = (v: string | string[] | undefined): string[] =>
  v === undefined ? [] : Array.isArray(v) ? v : v.split(/[,\s]+/).filter(Boolean);

/** `#tags` in the text, outside code blocks and spans; nested tags (`#a/b`) kept whole. */
export function inlineTags(body: string): string[] {
  const text = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_\-/]*\p{L}[\p{L}\p{N}_\-/]*)/gu)) out.add(m[1]);
  return [...out];
}

/** Frontmatter `tags` (or `tag`) then inline tags, without `#`, unique. */
export function noteTags(fm: Frontmatter, body: string): string[] {
  const front = [...asList(fm.fields.tags), ...asList(fm.fields.tag)].map((t) => t.replace(/^#/, ""));
  return [...new Set([...front, ...inlineTags(body)])].filter(Boolean);
}

export function noteAliases(fm: Frontmatter): string[] {
  return [...asList(fm.fields.aliases), ...asList(fm.fields.alias)];
}

/**
 * Targets of the links of a note, normalized like Obsidian resolves them:
 * `[[Note]]`, `[[folder/Note|label]]`, `[[Note#heading]]`, `![[embed]]`,
 * `[text](Note.md)`. Returned lowercased, without `.md`.
 */
export function linkTargets(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g)) out.push(m[1].trim());
  for (const m of body.matchAll(/\[[^\]]*\]\(([^)\s]+\.md)(?:#[^)]*)?\)/gi)) {
    if (!/^[a-z]+:\/\//i.test(m[1])) out.push(decodeURIComponent(m[1]));
  }
  return out.map((t) => stripMd(t).replace(/^\.?\//, "").toLowerCase());
}

/**
 * How many notes link to each note. A link `[[Name]]` counts for every note
 * named Name; `[[folder/Name]]` for the note at that path.
 */
export function backlinkCounts(notes: { path: string; links: string[] }[]): Map<string, number> {
  const byName = new Map<string, string[]>();
  for (const n of notes) {
    const name = basename(stripMd(n.path)).toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), n.path]);
  }
  const byPath = new Map(notes.map((n) => [stripMd(n.path).toLowerCase(), n.path]));
  const counts = new Map<string, number>();
  for (const n of notes) {
    const targets = new Set<string>();
    for (const link of n.links) {
      const exact = byPath.get(link);
      const matches = exact ? [exact] : byName.get(basename(link)) ?? [];
      for (const p of matches) if (p !== n.path) targets.add(p);
    }
    for (const t of targets) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

/** Obsidian-only syntax made readable in the launcher's markdown. */
export function previewMarkdown(body: string, max = 5000): string {
  let t = body
    .replace(/%%[\s\S]*?%%/g, "") // comments
    .replace(/!\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g, "_(embedded: $1)_")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "**$2**")
    .replace(/\[\[([^\]]+)\]\]/g, (_, target: string) => `**${target.replace(/#\^?/, " › ")}**`)
    .replace(/==([^=]+)==/g, "**$1**")
    .replace(/^> \[!(\w+)\][+-]?\s*/gm, (_, kind: string) => `> **${kind[0].toUpperCase()}${kind.slice(1)}:** `)
    .trim();
  if (t.length > max) t = `${t.slice(0, max)}\n\n…`;
  return t || "_Empty note._";
}

export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

export function firstLine(body: string): string {
  for (const line of body.split("\n")) {
    const t = line.replace(/^\s*[-*] \[[ x]\]\s+|^#+\s*|^[-*>]\s+|^\d+\.\s+/i, "").replace(
      /\[\[([^\]|]+\|)?([^\]]+)\]\]/g,
      "$2",
    )
      .replace(/[*_`=]/g, "").trim();
    if (t && !/^%%/.test(t)) return t.length > 90 ? `${t.slice(0, 90)}…` : t;
  }
  return "";
}

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * Relevance of a note for the words typed: title and aliases first, then
 * tags and path, then content. 0 when a word is nowhere.
 */
export function score(
  note: { title: string; path: string; aliases: string[]; tags: string[]; content?: string },
  query: string,
): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const title = fold(note.title);
  const aliases = note.aliases.map(fold);
  const tags = note.tags.map(fold);
  const path = fold(note.path);
  const content = note.content ? fold(note.content) : "";
  let total = fold(query).trim() === title ? 20 : 0;
  for (const w of words) {
    if (title.startsWith(w)) total += 8;
    else if (title.includes(w)) total += 6;
    else if (aliases.some((a) => a.includes(w))) total += 5;
    else if (tags.some((t) => t.startsWith(w.replace(/^#/, "")))) total += 4;
    else if (path.includes(w)) total += 3;
    else if (content.includes(w)) total += 1;
    else return 0;
  }
  return total;
}

/** A short excerpt of the content around the first word found, for subtitles. */
export function snippet(content: string, query: string, width = 80): string | undefined {
  const words = fold(query).split(/\s+/).filter((w) => w.length > 1);
  const flat = content
    .replace(/\[\[([^\]|]+\|)?([^\]]+)\]\]/g, "$2")
    .replace(/^#+\s+|^\s*[-*] \[[ x]\]\s+/gim, "")
    .replace(/==|\*\*|__|`/g, "")
    .replace(/\s+/g, " ");
  const folded = fold(flat);
  for (const w of words) {
    const i = folded.indexOf(w);
    if (i !== -1) {
      const start = Math.max(0, i - 25);
      const text = flat.slice(start, start + width).trim();
      return `${start > 0 ? "…" : ""}${text}${start + width < flat.length ? "…" : ""}`;
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Daily notes

export interface DailyConfig {
  folder: string;
  format: string;
  template?: string;
}

/** `.obsidian/daily-notes.json`; Obsidian's defaults when missing. */
export function parseDailyConfig(json: string | undefined): DailyConfig {
  try {
    const c = JSON.parse(json ?? "{}");
    return {
      folder: String(c.folder ?? "").replace(/^\/+|\/+$/g, ""),
      format: String(c.format || "YYYY-MM-DD"),
      ...(c.template ? { template: String(c.template) } : {}),
    };
  } catch {
    return { folder: "", format: "YYYY-MM-DD" };
  }
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

/** ISO week number (moment's `W`, and `w` for ISO locales). */
export function isoWeek(d: Date): { week: number; year: number } {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const start = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return { week: Math.ceil(((t.getTime() - start.getTime()) / 86_400_000 + 1) / 7), year: t.getUTCFullYear() };
}

/** Formats a local date with the moment.js tokens daily notes use (`YYYY-MM-DD`, `dddd, MMMM Do YYYY`, `[Week] W`…). */
export function formatMoment(d: Date, format: string): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const week = isoWeek(d);
  const tokens: Record<string, () => string> = {
    YYYY: () => String(d.getFullYear()),
    GGGG: () => String(week.year),
    YY: () => pad(d.getFullYear() % 100),
    MMMM: () => MONTHS[d.getMonth()],
    MMM: () => MONTHS[d.getMonth()].slice(0, 3),
    MM: () => pad(d.getMonth() + 1),
    M: () => String(d.getMonth() + 1),
    DDDD: () => pad(dayOfYear(d), 3),
    DDD: () => String(dayOfYear(d)),
    DD: () => pad(d.getDate()),
    Do: () => ordinal(d.getDate()),
    D: () => String(d.getDate()),
    dddd: () => DAYS[d.getDay()],
    ddd: () => DAYS[d.getDay()].slice(0, 3),
    dd: () => DAYS[d.getDay()].slice(0, 2),
    d: () => String(d.getDay()),
    E: () => String(d.getDay() || 7),
    WW: () => pad(week.week),
    W: () => String(week.week),
    ww: () => pad(week.week),
    w: () => String(week.week),
    HH: () => pad(d.getHours()),
    H: () => String(d.getHours()),
    mm: () => pad(d.getMinutes()),
    ss: () => pad(d.getSeconds()),
    Q: () => String(Math.floor(d.getMonth() / 3) + 1),
  };
  const re = /\[([^\]]*)\]|YYYY|GGGG|YY|MMMM|MMM|MM|M|DDDD|DDD|DD|Do|D|dddd|ddd|dd|d|E|WW|W|ww|w|HH|H|mm|ss|Q/g;
  return format.replace(re, (tok, literal) => (literal !== undefined ? literal : tokens[tok]?.() ?? tok));
}

function dayOfYear(d: Date): number {
  return Math.round(
    (Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(d.getFullYear(), 0, 1)) / 86_400_000,
  ) +
    1;
}

/** The vault-relative path of the daily note for a date, with `.md`. */
export function dailyNotePath(config: DailyConfig, date: Date): string {
  const name = formatMoment(date, config.format);
  return `${config.folder ? `${config.folder}/` : ""}${name}.md`;
}

// ---------------------------------------------------------------------------
// obsidian:// URIs (https://help.obsidian.md/Extending+Obsidian/Obsidian+URI)

/** `obsidian://open?vault=My%20Vault&file=Folder%2FNote`: every value percent-encoded, spaces as %20. */
export function obsidianUri(action: string, params: Record<string, string | boolean | undefined>): string {
  const query = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== false)
    .map(([k, v]) => `${k}=${v === true ? "true" : encodeURIComponent(String(v))}`)
    .join("&");
  return `obsidian://${action}${query ? `?${query}` : ""}`;
}

export const openUri = (vault: string, path: string) => obsidianUri("open", { vault, file: stripMd(path) });

/** Appends text to a note (created if missing) without bringing Obsidian to the front. */
export const appendUri = (vault: string, path: string, line: string) =>
  obsidianUri("new", { vault, file: stripMd(path), content: line, append: true, silent: true });

/** The line added by a quick capture: "- 14:05 text", or "- text". */
export function captureLine(text: string, now: Date, timestamp: boolean): string {
  const t = text.trim().replace(/\s*\n\s*/g, " ");
  if (!timestamp) return `- ${t}`;
  return `- ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")} ${t}`;
}

/** "now", "5m", "3h", "2d", or the date. */
export function ago(ms: number, now = Date.now()): string {
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 7 * 1440) return `${Math.floor(m / 1440)}d`;
  return new Date(ms).toLocaleDateString("en", { day: "numeric", month: "short", year: "2-digit" });
}

/** Directories never searched: Obsidian's own, its trash, git, dependencies. */
export const skipDir = (name: string) => name.startsWith(".") || name === "node_modules";
