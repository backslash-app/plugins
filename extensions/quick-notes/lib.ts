// Quick Notes logic: plain markdown files, one per note, named after the
// note's title, so Obsidian, an editor or a sync tool can use them as is.

export interface Note {
  /** File name, with `.md`. */
  file: string;
  title: string;
  /** The text without its frontmatter. */
  body: string;
  /** The raw frontmatter block (with its `---` lines), kept when editing. */
  frontmatter: string;
  tags: string[];
  modified: number;
  created: number;
}

/** Characters no file name should hold on Linux, Windows or Android sync targets. */
// deno-lint-ignore no-control-regex
const FORBIDDEN = /[\/\\:*?"<>|#^\[\]\u0000-\u001f]/g;

/** A safe file name for a title: "Groceries / week 3?" → "Groceries - week 3.md". */
export function fileNameFor(title: string): string {
  const base = title
    .replace(FORBIDDEN, (c) => (c === "/" || c === "\\" || c === ":" || c === "|" ? "-" : ""))
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s]+$/g, "")
    .slice(0, 120)
    .trim();
  return `${base || "Untitled"}.md`;
}

/** `name.md`, or `name 2.md`, `name 3.md`… when taken (case-insensitive). */
export function uniqueFileName(wanted: string, taken: Iterable<string>, self?: string): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  if (self) lower.delete(self.toLowerCase());
  if (!lower.has(wanted.toLowerCase())) return wanted;
  const stem = wanted.replace(/\.md$/i, "");
  for (let i = 2;; i++) {
    const candidate = `${stem} ${i}.md`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

/** Splits `---\nyaml\n---\nbody`. */
export function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return { frontmatter: "", body: text };
  return { frontmatter: m[0], body: text.slice(m[0].length) };
}

/** The `tags:` of a frontmatter (inline list, block list or comma separated). */
export function frontmatterTags(frontmatter: string): string[] {
  const lines = frontmatter.split(/\r?\n/);
  const i = lines.findIndex((l) => /^tags?\s*:/i.test(l));
  if (i === -1) return [];
  const inline = lines[i].replace(/^tags?\s*:\s*/i, "").trim();
  if (inline) {
    return inline.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim().replace(/^["'#]+|["']+$/g, ""))
      .filter(Boolean);
  }
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    const m = /^\s*-\s*(.+)$/.exec(l);
    if (!m) break;
    out.push(m[1].trim().replace(/^["'#]+|["']+$/g, ""));
  }
  return out;
}

/** `#tags` in the text, outside code. */
export function inlineTags(body: string): string[] {
  const text = body.replace(/```[\s\S]*?```/g, "").replace(/`[^`]*`/g, "");
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:^|\s)#([\p{L}\p{N}_\-/]*\p{L}[\p{L}\p{N}_\-/]*)/gu)) out.add(m[1]);
  return [...out];
}

export function parseNote(file: string, text: string, modified = 0, created = 0): Note {
  const { frontmatter, body } = splitFrontmatter(text);
  const tags = [...new Set([...frontmatterTags(frontmatter), ...inlineTags(body)])];
  return { file, title: file.replace(/\.md$/i, ""), body, frontmatter, tags, modified, created: created || modified };
}

/** The file's text: the frontmatter kept as it was, then the body. */
export function serialize(note: { frontmatter?: string; body: string }): string {
  const body = note.body.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  const fm = note.frontmatter ?? "";
  return `${fm}${body}\n`;
}

/** The first line of meaningful text, for subtitles. */
export function firstLine(body: string): string {
  for (const line of body.split("\n")) {
    const t = line.replace(/^\s*[-*] \[[ x]\]\s+|^#+\s*|^[-*>]\s+|^\d+\.\s+/i, "").replace(/[*_`]/g, "").trim();
    if (t) return t.length > 90 ? `${t.slice(0, 90)}…` : t;
  }
  return "";
}

export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}

/** Checklist progress: `- [x]` done out of all `- [ ]`. */
export function checklist(body: string): { done: number; total: number } {
  const all = body.match(/^\s*[-*] \[[ xX]\]/gm) ?? [];
  return { done: all.filter((l) => /\[[xX]\]/.test(l)).length, total: all.length };
}

/** "Today", "Yesterday", "This Week", "This Month", "Older". */
export function ageSection(ms: number, now = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= day) return "Today";
  if (ms >= day - 86_400_000) return "Yesterday";
  if (ms >= day - 6 * 86_400_000) return "This Week";
  if (ms >= day - 30 * 86_400_000) return "This Month";
  return "Older";
}

/** "now", "5m", "3h", "2d", or the date. */
export function ago(ms: number, now = Date.now()): string {
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 7 * 1440) return `${Math.floor(m / 1440)}d`;
  return new Date(ms).toLocaleDateString("en", { day: "numeric", month: "short" });
}

/**
 * How well a note matches the words typed: 0 for no match, title matches
 * above body matches. Every word must be somewhere.
 */
export function matchScore(note: Note, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const title = fold(note.title);
  const body = fold(note.body);
  const tags = note.tags.map(fold);
  let score = 0;
  for (const w of words) {
    if (title.startsWith(w)) score += 6;
    else if (title.includes(w)) score += 4;
    else if (tags.some((t) => t.startsWith(w.replace(/^#/, "")))) score += 3;
    else if (body.includes(w)) score += 1;
    else return 0;
  }
  return score;
}

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Pinned first (in pin order), then the most recently modified. */
export function sortNotes(notes: Note[], pinned: string[]): Note[] {
  const rank = (n: Note) => {
    const i = pinned.indexOf(n.file);
    return i === -1 ? Infinity : i;
  };
  return [...notes].sort((a, b) => rank(a) - rank(b) || b.modified - a.modified);
}

/** A title from text typed in the search bar: its first line, shortened at a word. */
export function titleFromText(text: string, max = 60): string {
  const line = text.trim().split("\n")[0].replace(/^#+\s*/, "")
    // #tags stay in the text, not in the file name.
    .replace(/(^|\s)#[\p{L}\p{N}_\-/]+/gu, "").replace(/\s+/g, " ").trim() || "Untitled";
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  return (cut.lastIndexOf(" ") > 20 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trim() + "…";
}

/** Expands a leading `~` with `$HOME`. */
export function expandHome(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`;
  return path;
}

/** Shortens `$HOME/…` to `~/…` for display. */
export function tildify(path: string, home: string): string {
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** The detail preview: long notes are cut so the panel stays fast. */
export function preview(body: string, max = 4000): string {
  const t = body.trim();
  if (!t) return "_Empty note._";
  return t.length > max ? `${t.slice(0, max)}\n\n…` : t;
}
