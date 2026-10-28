// Logseq graphs on disk: graph discovery, config.edn, file names, the
// outline format, references and journals. Pure functions, no I/O.

export interface Graph {
  name: string;
  /** Absolute folder. */
  path: string;
  /** When Logseq last used it (ms), from its cache file. */
  used?: number;
}

/**
 * `~/.logseq/graphs/logseq_local_++home++me++notes.transit` → `/home/me/notes`.
 * Other cache files (Windows paths, iCloud, the GitHub sync of old versions) are ignored.
 */
export function graphFromCacheFile(file: string): Graph | undefined {
  const m = /^logseq_local_(.+)\.transit$/.exec(file);
  if (!m || !m[1].startsWith("++")) return undefined;
  const path = m[1].replace(/\+\+/g, "/").replace(/\/+$/, "");
  const name = path.split("/").pop() ?? "";
  return name ? { name, path } : undefined;
}

export interface Config {
  journalFile: string;
  journalTitle: string;
  pagesDir: string;
  journalsDir: string;
  tripleLowbar: boolean;
  org: boolean;
}

export const DEFAULT_CONFIG: Config = {
  journalFile: "yyyy_MM_dd",
  journalTitle: "MMM do, yyyy",
  pagesDir: "pages",
  journalsDir: "journals",
  tripleLowbar: false,
  org: false,
};

/** The few keys of `logseq/config.edn` that decide where files are and what they are called. */
export function parseConfig(edn: string | undefined): Config {
  if (!edn) return { ...DEFAULT_CONFIG };
  const text = edn.split("\n").map((l) => l.replace(/(^|[^\\"]);.*$/, "$1")).join("\n");
  const str = (key: string) => new RegExp(`:${key.replace("/", "\\/")}\\s+"([^"]*)"`).exec(text)?.[1];
  const kw = (key: string) => new RegExp(`:${key.replace("/", "\\/")}\\s+:([\\w-]+)`).exec(text)?.[1];
  return {
    journalFile: str("journal/file-name-format") ?? DEFAULT_CONFIG.journalFile,
    journalTitle: str("journal/page-title-format") ?? DEFAULT_CONFIG.journalTitle,
    pagesDir: str("pages-directory") ?? DEFAULT_CONFIG.pagesDir,
    journalsDir: str("journals-directory") ?? DEFAULT_CONFIG.journalsDir,
    tripleLowbar: kw("file/name-format") === "triple-lowbar",
    org: /^org$/i.test(kw("preferred-format") ?? str("preferred-format") ?? ""),
  };
}

// --- Dates (date-fns-like formats, as Logseq uses) ----------------------------

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

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** `yyyy`, `yy`, `MMMM`, `MMM`, `MM`, `M`, `dd`, `do`, `d`, `EEEE`, `EEE`, `E`; anything else is kept. */
export function formatDate(format: string, d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const tokens: [string, () => string][] = [
    ["yyyy", () => String(d.getFullYear())],
    ["yy", () => String(d.getFullYear()).slice(-2)],
    ["MMMM", () => MONTHS[d.getMonth()]],
    ["MMM", () => MONTHS[d.getMonth()].slice(0, 3)],
    ["MM", () => p(d.getMonth() + 1)],
    ["M", () => String(d.getMonth() + 1)],
    ["dd", () => p(d.getDate())],
    ["do", () => ordinal(d.getDate())],
    ["d", () => String(d.getDate())],
    ["EEEE", () => DAYS[d.getDay()]],
    ["EEE", () => DAYS[d.getDay()].slice(0, 3)],
    ["E", () => DAYS[d.getDay()].slice(0, 3)],
  ];
  let out = "";
  for (let i = 0; i < format.length;) {
    if (format[i] === "'") {
      const close = format.indexOf("'", i + 1);
      out += format.slice(i + 1, close < 0 ? undefined : close);
      i = close < 0 ? format.length : close + 1;
      continue;
    }
    const hit = tokens.find(([t]) => format.startsWith(t, i));
    if (hit) {
      out += hit[1]();
      i += hit[0].length;
    } else out += format[i++];
  }
  return out;
}

/** `2026_10_28` with format `yyyy_MM_dd` → that date (only numeric formats are read back). */
export function parseJournalFile(base: string, format: string): Date | undefined {
  const order: string[] = [];
  const re = new RegExp(
    "^" +
      format.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/yyyy|MM|dd/g, (t) => {
        order.push(t);
        return t === "yyyy" ? "(\\d{4})" : "(\\d{2})";
      }) + "$",
  );
  const m = re.exec(base);
  if (!m || order.length !== 3) return undefined;
  const v = Object.fromEntries(order.map((t, i) => [t, Number(m[i + 1])]));
  const date = new Date(v.yyyy, v.MM - 1, v.dd);
  return date.getMonth() === v.MM - 1 ? date : undefined;
}

// --- Page names --------------------------------------------------------------

/** A page's name from its file: `a___b.md` (triple-lowbar) or `a%2Fb.md` (legacy) → `a/b`. */
export function pageNameFromFile(base: string, tripleLowbar: boolean): string {
  let name = base;
  if (tripleLowbar) name = name.replace(/___/g, "/");
  try {
    name = decodeURIComponent(name);
  } catch { /* not encoded */ }
  return name;
}

/** Logseq links pages case-insensitively. */
export const pageKey = (name: string) => name.trim().toLowerCase();

export const pageUri = (graph: string, page: string) =>
  `logseq://graph/${encodeURIComponent(graph)}?page=${encodeURIComponent(page)}`;
export const blockUri = (graph: string, id: string) =>
  `logseq://graph/${encodeURIComponent(graph)}?block-id=${encodeURIComponent(id)}`;
export const graphUri = (graph: string) => `logseq://graph/${encodeURIComponent(graph)}`;

// --- The outline -------------------------------------------------------------

export interface Block {
  /** Text without its bullet and properties, continuation lines joined with `\n`. */
  content: string;
  /** The `id::` property, set when the block was referenced or linked. */
  id?: string;
  depth: number;
  properties: Record<string, string>;
}

export interface Page {
  properties: Record<string, string>;
  blocks: Block[];
}

const PROPERTY = /^\s*([A-Za-z0-9_\-/.]+)::\s?(.*)$/;

/** Splits a Logseq markdown file into its page properties and blocks. */
export function parsePage(text: string): Page {
  const properties: Record<string, string> = {};
  const blocks: Block[] = [];
  type Open = { depth: number; indent: number; lines: string[]; props: Record<string, string>; pageProps: boolean };
  let cur: Open | undefined;
  let started = false;
  let inCode = false;
  const flush = () => {
    if (!cur) return;
    const content = cur.lines.join("\n").trim();
    if (content || cur.props.id) blocks.push({ content, id: cur.props.id, depth: cur.depth, properties: cur.props });
    cur = undefined;
  };
  const add = (line: string) => {
    if (/^\s*```/.test(line)) inCode = !inCode;
    const prop = !inCode && PROPERTY.exec(line);
    if (!prop) return void cur!.lines.push(line);
    (cur!.pageProps ? properties : cur!.props)[prop[1].toLowerCase()] = prop[2].trim();
  };
  for (const line of text.replace(/\r/g, "").split("\n")) {
    const bullet = inCode ? null : /^([ \t]*)[-*](?: (.*))?$/.exec(line);
    if (bullet) {
      flush();
      const ws = bullet[1].replace(/\t/g, "  ").length;
      const first = bullet[2] ?? "";
      // A first block made only of properties holds the page's properties.
      const pageProps = !started && ws === 0 && PROPERTY.test(first);
      started = true;
      cur = { depth: Math.floor(ws / 2), indent: ws, lines: [], props: {}, pageProps };
      add(first);
      continue;
    }
    if (!started) {
      const prop = PROPERTY.exec(line);
      if (prop) properties[prop[1].toLowerCase()] = prop[2].trim();
      else if (line.trim()) {
        // Text before any bullet: a block of its own.
        started = true;
        cur = { depth: 0, indent: 0, lines: [], props: {}, pageProps: false };
        add(line.trim());
      }
      continue;
    }
    if (!cur) continue;
    // Continuation lines are indented two spaces past the bullet; deeper indentation is kept.
    const ws = /^[ \t]*/.exec(line)![0].replace(/\t/g, "  ").length;
    add(" ".repeat(Math.max(0, ws - cur.indent - 2)) + line.replace(/^[ \t]*/, ""));
  }
  flush();
  return { properties, blocks };
}

/** `[[Page]]`, `#tag`, `#[[Long tag]]` in a text, lowercased, in order, once each. */
export function references(text: string): string[] {
  const out = new Set<string>();
  const clean = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  for (const m of clean.matchAll(/\[\[([^\]]+)\]\]/g)) out.add(pageKey(m[1]));
  for (const m of clean.matchAll(/(?:^|\s)#([^\s#[\],.;:!?"'()]+)/g)) out.add(pageKey(m[1]));
  return [...out];
}

/** `tags:: [[a]], b` or `alias:: x, [[y z]]` → `["a", "b"]`. */
export function listProperty(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((v) => v.trim().replace(/^\[\[(.*)\]\]$/, "$1").replace(/^#/, "")).filter(Boolean);
}

/** How many blocks of other pages reference each page (key: lowercased name). */
export function backlinkCounts(pages: { name: string; page: Page; aliases?: string[] }[]): Map<string, number> {
  const alias = new Map<string, string>();
  for (const p of pages) for (const a of p.aliases ?? []) alias.set(pageKey(a), pageKey(p.name));
  const counts = new Map<string, number>();
  for (const p of pages) {
    const self = pageKey(p.name);
    const tags = listProperty(p.page.properties.tags).map(pageKey);
    for (const t of tags) if (t !== self) counts.set(alias.get(t) ?? t, (counts.get(alias.get(t) ?? t) ?? 0) + 1);
    for (const b of p.page.blocks) {
      const refs = new Set(
        [...references(b.content), ...listProperty(b.properties.tags).map(pageKey)].map((r) => alias.get(r) ?? r),
      );
      for (const r of refs) if (r !== self) counts.set(r, (counts.get(r) ?? 0) + 1);
    }
  }
  return counts;
}

/** Inline Logseq syntax made readable: `[[x]]` → x, TODO markers, `{{embed}}`, highlights. */
export function plain(text: string): string {
  return text
    .replace(/^(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELED|CANCELLED)\s+/, "")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/#\[\[([^\]]+)\]\]/g, "#$1")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\(\([0-9a-f-]{36}\)\)/g, "…")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~^=]{1,2}([^*_`~^=]+)[*_`~^=]{1,2}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function taskMarker(text: string): string | undefined {
  return /^(TODO|DOING|DONE|LATER|NOW|WAITING|CANCELED|CANCELLED)\s/.exec(text)?.[1];
}

/** The outline as markdown for the preview panel. */
export function previewMarkdown(page: Page, max = 4000): string {
  const out: string[] = [];
  let size = 0;
  for (const b of page.blocks) {
    const marker = taskMarker(b.content);
    let text = b.content
      .replace(/\[\[([^\]]+)\]\]/g, "**$1**")
      .replace(/\(\(([0-9a-f-]{36})\)\)/g, "*(block ref)*")
      .replace(/\{\{embed[^}]*\}\}/g, "*(embed)*");
    if (marker) {
      text = text.replace(
        /^\S+\s+/,
        marker === "DONE" ? "[x] " : marker === "CANCELED" || marker === "CANCELLED" ? "~~" : "[ ] ",
      );
    }
    const indent = "  ".repeat(Math.min(b.depth, 6));
    const lines = text.split("\n");
    const line = `${indent}- ${lines[0]}${lines.slice(1).map((l) => `\n${indent}  ${l}`).join("")}`;
    out.push(line);
    size += line.length;
    if (size > max) {
      out.push("\n…");
      break;
    }
  }
  return out.join("\n");
}

export function wordCount(page: Page): number {
  return page.blocks.reduce((n, b) => n + b.content.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length, 0);
}

// --- Capture -----------------------------------------------------------------

/**
 * Appends a top-level block to a journal file. Several lines become one
 * block with continuation lines; the file keeps a final line break.
 */
export function appendBlock(content: string, text: string, o: { org?: boolean; time?: string } = {}): string {
  const lines = text.replace(/\r/g, "").trim().split("\n");
  const bullet = o.org ? "*" : "-";
  const first = `${bullet} ${o.time ? `${o.time} ` : ""}${lines[0]}`;
  const block = [first, ...lines.slice(1).map((l) => `  ${l}`)].join("\n");
  // A new journal is just "-" (Logseq's empty first block): replace it.
  const existing = content.replace(/\s+$/, "");
  if (!existing || existing === bullet) return `${block}\n`;
  return `${existing}\n${block}\n`;
}

// --- Search ------------------------------------------------------------------

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Every word must be in the text; 3 per word at a word start, 1 inside a word. */
export function score(text: string, query: string): number {
  const t = fold(text);
  let s = 0;
  for (const w of fold(query).split(/\s+/).filter(Boolean)) {
    const i = t.indexOf(w);
    if (i < 0) return 0;
    s += i === 0 || /[\s\[#(/_-]/.test(t[i - 1]) ? 3 : 1;
  }
  return s;
}

export function ago(ms: number, now = Date.now()): string {
  const m = Math.round((now - ms) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return d < 365 ? `${Math.round(d / 30.4)}mo ago` : `${Math.round(d / 365)}y ago`;
}

export const plural = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;
