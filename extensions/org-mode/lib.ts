// Org files: headings, TODO keywords, timestamps, the agenda and the edits made in place.

// --- Keywords ----------------------------------------------------------------

export interface Keywords {
  todo: string[];
  done: string[];
}

export const DEFAULT_KEYWORDS = "TODO NEXT WAITING | DONE CANCELLED";

/**
 * "TODO(t) NEXT WAIT(w@/!) | DONE(d!) CANCELED(c@)" → { todo: [TODO, NEXT, WAIT], done: [DONE, CANCELED] },
 * as in `org-todo-keywords` and `#+TODO:` lines. Without "|", the last keyword is the done one.
 */
export function parseKeywords(spec: string): Keywords {
  const clean = (part: string) =>
    part.split(/\s+/).map((w) => w.replace(/\(.*\)$/, "")).filter((w) => /^[^\s|]+$/.test(w));
  const [left, right] = spec.includes("|") ? spec.split("|", 2) : [spec, undefined];
  const todo = clean(left);
  const done = right === undefined ? todo.splice(-1, 1) : clean(right);
  return { todo, done };
}

export function mergeKeywords(...sets: Keywords[]): Keywords {
  const todo: string[] = [], done: string[] = [];
  for (const s of sets) {
    for (const k of s.todo) if (!todo.includes(k) && !done.includes(k)) todo.push(k);
    for (const k of s.done) if (!done.includes(k) && !todo.includes(k)) done.push(k);
  }
  return { todo, done };
}

/** The `#+TODO:`, `#+SEQ_TODO:` and `#+TYP_TODO:` lines of a file. */
export function fileKeywords(text: string): Keywords | undefined {
  const sets = [...text.matchAll(/^#\+(?:SEQ_|TYP_)?TODO:\s*(.+)$/gim)].map((m) => parseKeywords(m[1]));
  return sets.length ? mergeKeywords(...sets) : undefined;
}

// --- Timestamps --------------------------------------------------------------

export interface Timestamp {
  active: boolean;
  /** Local midnight of the day. */
  date: Date;
  /** "14:00", or undefined for a whole day. */
  time?: string;
  end?: string;
  /** "+1w", "++1d", ".+2m". */
  repeater?: { kind: "+" | "++" | ".+"; n: number; unit: "h" | "d" | "w" | "m" | "y" };
  /** The deadline warning period in days ("-3d"). */
  warning?: number;
  raw: string;
}

const TS =
  /([<[])(\d{4})-(\d{2})-(\d{2})(?: +[^\s\d>\]+.-][^\s>\]]*)?(?: +(\d{1,2}:\d{2})(?:-(\d{1,2}:\d{2}))?)?((?: +(?:\.\+|\+\+|\+|--?)\d+[hdwmy](?:\/\d+[hdwmy])?)*) *([>\]])/g;

export function parseTimestamp(raw: string): Timestamp | undefined {
  TS.lastIndex = 0;
  const m = TS.exec(raw);
  return m ? fromMatch(m) : undefined;
}

function fromMatch(m: RegExpExecArray): Timestamp | undefined {
  if ((m[1] === "<") !== (m[8] === ">")) return undefined;
  const date = new Date(+m[2], +m[3] - 1, +m[4]);
  if (isNaN(date.getTime()) || date.getDate() !== +m[4]) return undefined;
  const ts: Timestamp = { active: m[1] === "<", date, raw: m[0] };
  if (m[5]) ts.time = m[5].padStart(5, "0");
  if (m[6]) ts.end = m[6].padStart(5, "0");
  for (const part of (m[7] ?? "").trim().split(/\s+/).filter(Boolean)) {
    const r = part.match(/^(\.\+|\+\+|\+)(\d+)([hdwmy])/);
    if (r) ts.repeater = { kind: r[1] as "+" | "++" | ".+", n: +r[2], unit: r[3] as "d" };
    const w = part.match(/^--?(\d+)([hdwmy])/);
    if (w) ts.warning = toDays(+w[1], w[2]);
  }
  return ts;
}

const toDays = (n: number, unit: string) =>
  unit === "w" ? n * 7 : unit === "m" ? n * 30 : unit === "y" ? n * 365 : unit === "h" ? 0 : n;

/** Every timestamp in a line (`<…>` and `[…]`, ranges `<a>--<b>` give both ends). */
export function timestampsIn(line: string): Timestamp[] {
  const out: Timestamp[] = [];
  TS.lastIndex = 0;
  for (const m of line.matchAll(TS)) {
    const ts = fromMatch(m as RegExpExecArray);
    if (ts) out.push(ts);
  }
  return out;
}

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");
export const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "[2026-10-31 Sat 14:05]", the way Org writes CLOSED and capture times. */
export function inactiveNow(now: Date): string {
  return `[${isoDay(now)} ${DAY_NAMES[now.getDay()]} ${pad(now.getHours())}:${pad(now.getMinutes())}]`;
}

/** A timestamp written back after a change of date, keeping its time, repeater and warning. */
export function formatTimestamp(ts: Timestamp, date: Date, time = ts.time): string {
  const [open, close] = ts.active ? ["<", ">"] : ["[", "]"];
  const rest = ts.raw.slice(1, -1).match(/((?:\s+(?:\.\+|\+\+|\+|--?)\d+[hdwmy](?:\/\d+[hdwmy])?)*)\s*$/)?.[1] ?? "";
  const t = time ? ` ${time}${ts.end ? `-${ts.end}` : ""}` : "";
  return `${open}${isoDay(date)} ${DAY_NAMES[date.getDay()]}${t}${rest}${close}`;
}

function addUnit(d: Date, n: number, unit: string): Date {
  const r = new Date(d);
  if (unit === "h") r.setHours(r.getHours() + n);
  else if (unit === "d") r.setDate(r.getDate() + n);
  else if (unit === "w") r.setDate(r.getDate() + 7 * n);
  else if (unit === "m") r.setMonth(r.getMonth() + n);
  else if (unit === "y") r.setFullYear(r.getFullYear() + n);
  return r;
}

const withTime = (ts: Timestamp) => {
  const d = new Date(ts.date);
  if (ts.time) d.setHours(+ts.time.slice(0, 2), +ts.time.slice(3, 5));
  return d;
};

/**
 * The next occurrence of a repeating timestamp once its task is done, as Org does it:
 * `+1w` one week later, `++1w` the first week-step in the future, `.+1w` one week from now.
 */
export function shiftRepeater(ts: Timestamp, now: Date): string {
  const r = ts.repeater;
  if (!r) return ts.raw;
  let next: Date;
  if (r.kind === "+") next = addUnit(withTime(ts), r.n, r.unit);
  else if (r.kind === ".+") {
    const base = new Date(now);
    if (r.unit !== "h") base.setHours(ts.time ? +ts.time.slice(0, 2) : 0, ts.time ? +ts.time.slice(3, 5) : 0, 0, 0);
    next = addUnit(base, r.n, r.unit);
  } else {
    next = withTime(ts);
    const limit = r.unit === "h" ? now : startOfDay(now);
    do next = addUnit(next, r.n, r.unit); while (next <= limit);
  }
  const time = ts.time ? (r.unit === "h" ? `${pad(next.getHours())}:${pad(next.getMinutes())}` : ts.time) : undefined;
  return formatTimestamp(ts, startOfDay(next), time);
}

// --- Headings ----------------------------------------------------------------

export interface Heading {
  file: string;
  /** 0-based line of the heading. */
  line: number;
  level: number;
  keyword?: string;
  done: boolean;
  priority?: string;
  title: string;
  tags: string[];
  /** Titles of the parent headings. */
  path: string[];
  scheduled?: Timestamp;
  deadline?: Timestamp;
  closed?: Timestamp;
  /** Active timestamps of the heading line and body (appointments). */
  timestamps: Timestamp[];
  body: string[];
  /** The heading line as it is in the file, to check it is still there before an edit. */
  raw: string;
}

const HEADING = /^(\*+)\s+(.*?)\s*$/;
const PLANNING = /^\s*(?:SCHEDULED|DEADLINE|CLOSED):/;

/** Splits "TODO [#A] Call Bob :work:phone:" with the file's keywords. */
export function parseHeadingText(text: string, keywords: Keywords) {
  let rest = text;
  let keyword: string | undefined;
  const first = rest.match(/^(\S+)(?:\s+|$)/);
  if (first && (keywords.todo.includes(first[1]) || keywords.done.includes(first[1]))) {
    keyword = first[1];
    rest = rest.slice(first[0].length);
  }
  let priority: string | undefined;
  const p = rest.match(/^\[#([A-Z0-9])\](?:\s+|$)/);
  if (p) {
    priority = p[1];
    rest = rest.slice(p[0].length);
  }
  let tags: string[] = [];
  const t = rest.match(/(?:^|\s+)(:(?:[\w@#%]+:)+)\s*$/);
  if (t) {
    tags = t[1].split(":").filter(Boolean);
    rest = rest.slice(0, t.index);
  }
  return { keyword, done: !!keyword && keywords.done.includes(keyword), priority, title: rest.trim(), tags };
}

/** The headings of an Org file, with planning, body timestamps and inherited path. */
export function parseOrg(text: string, file: string, defaults: Keywords): Heading[] {
  const keywords = mergeKeywords(fileKeywords(text) ?? defaults, defaults);
  const lines = text.split("\n");
  const headings: Heading[] = [];
  const stack: Heading[] = [];
  let current: Heading | undefined;
  let inBlock = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\r$/, "");
    if (/^\s*#\+BEGIN_/i.test(line)) inBlock = true;
    else if (/^\s*#\+END_/i.test(line)) inBlock = false;
    const h = !inBlock && line.match(HEADING);
    if (h) {
      const level = h[1].length;
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parts = parseHeadingText(h[2], keywords);
      current = {
        file,
        line: i,
        level,
        ...parts,
        path: stack.map((s) => s.title),
        timestamps: timestampsIn(parts.title).filter((t) => t.active),
        body: [],
        raw: lines[i],
      };
      headings.push(current);
      stack.push(current);
      const next = lines[i + 1] ?? "";
      if (PLANNING.test(next)) {
        for (const m of next.matchAll(/(SCHEDULED|DEADLINE|CLOSED):\s*([<[][^>\]]*[>\]])/g)) {
          const ts = parseTimestamp(m[2]);
          if (m[1] === "SCHEDULED") current.scheduled = ts;
          else if (m[1] === "DEADLINE") current.deadline = ts;
          else current.closed = ts;
        }
        i++;
      }
      continue;
    }
    if (!current) continue;
    current.body.push(line);
    if (!inBlock) current.timestamps.push(...timestampsIn(line).filter((t) => t.active));
  }
  for (const h of headings) {
    while (h.body.length && !h.body[h.body.length - 1].trim()) h.body.pop();
  }
  return headings;
}

// --- Agenda ------------------------------------------------------------------

export type Section = "Overdue" | "Today" | "Upcoming";

export interface AgendaEntry {
  heading: Heading;
  section: Section;
  kind: "deadline" | "scheduled" | "timestamp";
  /** Days from today: negative when late. */
  days: number;
  time?: string;
  /** "Deadline in 3d", "Sched. 2x", "14:00–15:00". */
  label: string;
}

const DAY = 86_400_000;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const daysBetween = (from: Date, to: Date) =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY);

/** The days of a repeating timestamp within [from, from + span] (one for a plain one). */
export function occurrences(ts: Timestamp, from: Date, span: number): number[] {
  const first = daysBetween(from, ts.date);
  if (!ts.repeater || ts.repeater.unit === "h") return first >= 0 && first <= span ? [first] : [];
  const out: number[] = [];
  let d = new Date(ts.date);
  for (let guard = 0; guard < 5000; guard++) {
    const diff = daysBetween(from, d);
    if (diff > span) break;
    if (diff >= 0) out.push(diff);
    d = addUnit(d, ts.repeater.n, ts.repeater.unit);
  }
  return out;
}

const timeLabel = (ts: Timestamp) => ts.time ? `${ts.time}${ts.end ? `–${ts.end}` : ""}` : undefined;

/**
 * What the agenda shows for today, like Org's day view: late deadlines and
 * scheduled items, today's, then what is coming within `lookahead` days
 * (deadlines from their own warning period when they have one).
 */
export function agenda(headings: Heading[], now: Date, lookahead = 7): AgendaEntry[] {
  const out: AgendaEntry[] = [];
  for (const h of headings) {
    const candidates: AgendaEntry[] = [];
    if (!h.done && h.deadline) {
      const d = daysBetween(now, h.deadline.date);
      const warn = h.deadline.warning ?? lookahead;
      const time = timeLabel(h.deadline);
      if (d < 0) {
        candidates.push({ heading: h, section: "Overdue", kind: "deadline", days: d, label: `${-d}d past deadline` });
      } else if (d === 0) {
        candidates.push({
          heading: h,
          section: "Today",
          kind: "deadline",
          days: 0,
          time: h.deadline.time,
          label: `Deadline today${time ? ` ${time}` : ""}`,
        });
      } else if (d <= warn) {
        candidates.push({ heading: h, section: "Upcoming", kind: "deadline", days: d, label: `Deadline in ${d}d` });
      }
    }
    if (!h.done && h.scheduled) {
      const d = daysBetween(now, h.scheduled.date);
      const time = timeLabel(h.scheduled);
      if (d < 0) {
        candidates.push({ heading: h, section: "Overdue", kind: "scheduled", days: d, label: `Sched. ${-d}x` });
      } else if (d === 0) {
        candidates.push({
          heading: h,
          section: "Today",
          kind: "scheduled",
          days: 0,
          time: h.scheduled.time,
          label: time ?? "Scheduled",
        });
      } else if (d <= lookahead) {
        candidates.push({ heading: h, section: "Upcoming", kind: "scheduled", days: d, label: `Scheduled in ${d}d` });
      }
    }
    if (!h.done) {
      for (const ts of h.timestamps) {
        const [d] = occurrences(ts, now, lookahead);
        if (d === undefined) continue;
        candidates.push({
          heading: h,
          section: d === 0 ? "Today" : "Upcoming",
          kind: "timestamp",
          days: d,
          time: ts.time,
          label: d === 0 ? timeLabel(ts) ?? "Today" : `In ${d}d${ts.time ? ` at ${ts.time}` : ""}`,
        });
      }
    }
    // One row per heading: the most pressing reason it is there.
    const rank = { Overdue: 0, Today: 1, Upcoming: 2 };
    const kindRank = { deadline: 0, scheduled: 1, timestamp: 2 };
    candidates.sort((a, b) =>
      rank[a.section] - rank[b.section] || a.days - b.days || kindRank[a.kind] - kindRank[b.kind]
    );
    if (candidates[0]) out.push(candidates[0]);
  }
  return sortAgenda(out);
}

/** Priority rank: A first, none counts as B (Org's default). */
export const priorityRank = (p?: string) => (p ?? "B").charCodeAt(0);

export function sortAgenda(entries: AgendaEntry[]): AgendaEntry[] {
  const rank = { Overdue: 0, Today: 1, Upcoming: 2 };
  return [...entries].sort((a, b) =>
    rank[a.section] - rank[b.section] ||
    a.days - b.days ||
    (a.time ?? "99").localeCompare(b.time ?? "99") ||
    priorityRank(a.heading.priority) - priorityRank(b.heading.priority) ||
    a.heading.file.localeCompare(b.heading.file) ||
    a.heading.line - b.heading.line
  );
}

/** "3 overdue · 4 today", for the root search. */
export function agendaSummary(entries: AgendaEntry[]): string | undefined {
  const overdue = entries.filter((e) => e.section === "Overdue").length;
  const today = entries.filter((e) => e.section === "Today").length;
  const parts = [overdue ? `${overdue} overdue` : "", today ? `${today} today` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** Open TODOs (not done), by priority then file order, for the "All TODOs" view. */
export function openTodos(headings: Heading[], keyword?: string): Heading[] {
  return headings
    .filter((h) => h.keyword && !h.done && (!keyword || h.keyword === keyword))
    .sort((a, b) =>
      priorityRank(a.priority) - priorityRank(b.priority) || a.file.localeCompare(b.file) || a.line - b.line
    );
}

// --- Edits -------------------------------------------------------------------

export class ChangedError extends Error {
  constructor() {
    super("This heading changed in its file meanwhile: the agenda was reloaded, try again");
  }
}

function checkLine(lines: string[], h: Pick<Heading, "line" | "raw">) {
  if (lines[h.line] !== h.raw) {
    // The file may have moved lines around: find the heading again, if it is there once.
    const found = lines.map((l, i) => l === h.raw ? i : -1).filter((i) => i >= 0);
    if (found.length !== 1) throw new ChangedError();
    return found[0];
  }
  return h.line;
}

/** The heading line with another keyword (or none), keeping stars, priority, title and tags. */
export function setKeywordLine(raw: string, from: string | undefined, to: string | undefined): string {
  const m = raw.match(/^(\*+\s+)(.*)$/);
  if (!m) return raw;
  let rest = m[2];
  if (from && (rest === from || rest.startsWith(`${from} `))) rest = rest.slice(from.length).replace(/^\s+/, "");
  return `${m[1]}${to ? `${to}${rest ? " " : ""}` : ""}${rest}`;
}

/** The heading line with another priority cookie (or none). */
export function setPriorityLine(raw: string, keyword: string | undefined, priority: string | undefined): string {
  const m = raw.match(/^(\*+\s+)(.*)$/);
  if (!m) return raw;
  let rest = m[2];
  let kw = "";
  if (keyword && (rest === keyword || rest.startsWith(`${keyword} `))) {
    kw = `${keyword} `;
    rest = rest.slice(keyword.length).replace(/^\s+/, "");
  }
  rest = rest.replace(/^\[#[A-Z0-9]\]\s*/, "");
  return `${m[1]}${kw}${priority ? `[#${priority}] ` : ""}${rest}`.replace(/\s+$/, "");
}

export interface DoneResult {
  text: string;
  /** For a repeating task: the new date, else undefined (the heading is now done). */
  repeatedTo?: string;
}

/**
 * Marks a heading done in the file text, as `C-c C-t d` does: the done keyword
 * and a CLOSED timestamp; a repeating SCHEDULED or DEADLINE moves to its next
 * date instead and the heading stays open (with `:LAST_REPEAT:` updated).
 */
export function markDone(
  text: string,
  h: Pick<Heading, "line" | "raw" | "keyword">,
  doneKeyword: string,
  now: Date,
  o: { closed?: boolean } = {},
): DoneResult {
  const lines = text.split("\n");
  const at = checkLine(lines, h);
  const planningAt = PLANNING.test(lines[at + 1] ?? "") ? at + 1 : -1;
  const planning = planningAt >= 0 ? lines[planningAt] : "";
  const repeating = [...planning.matchAll(/(SCHEDULED|DEADLINE):\s*(<[^>]*>)/g)].filter((m) =>
    parseTimestamp(m[2])?.repeater
  );
  if (repeating.length) {
    let next = planning;
    let first = "";
    for (const m of repeating) {
      const ts = parseTimestamp(m[2])!;
      const shifted = shiftRepeater(ts, now);
      first ||= shifted;
      next = next.replace(m[2], shifted);
    }
    lines[planningAt] = next;
    setProperty(lines, at, planningAt, "LAST_REPEAT", inactiveNow(now));
    return { text: lines.join("\n"), repeatedTo: first };
  }
  lines[at] = setKeywordLine(lines[at], h.keyword, doneKeyword);
  if (o.closed !== false) {
    const closed = `CLOSED: ${inactiveNow(now)}`;
    if (planningAt >= 0) {
      const indent = planning.match(/^\s*/)![0];
      const rest = planning.trim().replace(/CLOSED:\s*\[[^\]]*\]\s*/, "");
      lines[planningAt] = `${indent}${closed}${rest ? ` ${rest}` : ""}`;
    } else {
      lines.splice(at + 1, 0, closed);
    }
  }
  return { text: lines.join("\n") };
}

/** Sets a property in the heading's :PROPERTIES: drawer, creating the drawer after the planning line if needed. */
function setProperty(lines: string[], at: number, planningAt: number, name: string, value: string) {
  const start = (planningAt >= 0 ? planningAt : at) + 1;
  if (/^\s*:PROPERTIES:\s*$/i.test(lines[start] ?? "")) {
    const indent = lines[start].match(/^\s*/)![0];
    for (let i = start + 1; i < lines.length && !/^\*+\s/.test(lines[i]); i++) {
      if (/^\s*:END:\s*$/i.test(lines[i])) {
        lines.splice(i, 0, `${indent}:${name}: ${value}`);
        return;
      }
      if (new RegExp(`^\\s*:${name}:`, "i").test(lines[i])) {
        lines[i] = `${indent}:${name}: ${value}`;
        return;
      }
    }
    return;
  }
  lines.splice(start, 0, ":PROPERTIES:", `:${name}: ${value}`, ":END:");
}

/** Replaces one heading line after checking it is unchanged. */
export function replaceHeading(text: string, h: Pick<Heading, "line" | "raw">, line: string): string {
  const lines = text.split("\n");
  lines[checkLine(lines, h)] = line;
  return lines.join("\n");
}

// --- Capture -----------------------------------------------------------------

/**
 * "Call Bob :phone:" → "* TODO Call Bob :phone:", keeping a keyword or
 * priority that was typed ("NEXT [#A] Call Bob"), with the capture time below.
 */
export function captureEntry(
  input: string,
  keywords: Keywords,
  now: Date,
  o: { keyword?: string; stamp?: boolean } = {},
) {
  const text = input.trim().replace(/\s*\n\s*/g, " ");
  if (!text) throw new Error("Type what to capture after the command");
  const first = text.split(/\s+/)[0];
  const typed = keywords.todo.includes(first) || keywords.done.includes(first);
  const keyword = o.keyword === undefined ? keywords.todo[0] ?? "TODO" : o.keyword;
  const heading = `* ${typed || !keyword ? "" : `${keyword} `}${text}`;
  return o.stamp === false ? `${heading}\n` : `${heading}\n${inactiveNow(now)}\n`;
}

/** Appends an entry at the end of a file, on its own line. */
export function appendEntry(text: string, entry: string): string {
  if (!text) return entry;
  return `${text}${text.endsWith("\n") ? "" : "\n"}${entry}`;
}

// --- Files -------------------------------------------------------------------

export const expandHome = (path: string, home: string) => path.replace(/^~(?=$|\/)/, home);
export const tildify = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
export const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? path;
export const dirname = (path: string) => path.replace(/\/[^/]*$/, "") || "/";

/** "~/org, ~/notes/work.org" → paths, without duplicates. */
export function parsePaths(text: string, home: string): string[] {
  return [...new Set(text.split(/[,\n]+/).map((p) => p.trim()).filter(Boolean).map((p) => expandHome(p, home)))];
}

/** Org files to read in a folder listing: .org only, no backups, autosaves or archives. */
export const isOrgFile = (name: string) => name.endsWith(".org") && !name.startsWith(".#") && !name.startsWith("#");

/** Escapes what the preview's markdown would read as formatting. */
export const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]#<>]/g, "\\$&");

/** Org markup → the preview's markdown subset: *bold*, /italic/, =code=, ~code~, [[links][text]]. */
export function orgToMarkdown(lines: string[], max = 40): string {
  const out: string[] = [];
  let inBlock = false;
  let drawer = false;
  for (const raw of lines.slice(0, max)) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*#\+BEGIN_/i.test(line)) {
      inBlock = true;
      out.push("```");
      continue;
    }
    if (/^\s*#\+END_/i.test(line)) {
      inBlock = false;
      out.push("```");
      continue;
    }
    if (inBlock) {
      out.push(line.replace(/```/g, "'''"));
      continue;
    }
    if (/^\s*:(PROPERTIES|LOGBOOK):\s*$/i.test(line)) {
      drawer = true;
      continue;
    }
    if (drawer) {
      if (/^\s*:END:\s*$/i.test(line)) drawer = false;
      continue;
    }
    if (/^\s*#\+/.test(line)) continue;
    let md = line.trim()
      .replace(/^[-+]\s+\[( |X|-)\]\s+/, (_, c) => `- ${c === "X" ? "☑" : "☐"} `)
      .replace(/^\+\s+/, "- ");
    md = md
      .replace(/\[\[([^\]]+)\]\[([^\]]+)\]\]/g, (_, url, label) => `[${label}](${url})`)
      .replace(/\[\[([^\]]+)\]\]/g, (_, url) => `[${url}](${url})`)
      .replace(/(^|\s)[=~]([^=~\s][^=~]*?)[=~](?=\s|$|[.,;:!?)])/g, "$1`$2`")
      .replace(/(^|\s)\*([^*\s][^*]*?)\*(?=\s|$|[.,;:!?)])/g, "$1**$2**")
      .replace(/(^|\s)\/([^/\s][^/]*?)\/(?=\s|$|[.,;:!?)])/g, "$1*$2*");
    out.push(md);
  }
  if (inBlock) out.push("```");
  if (lines.length > max) out.push("", `_… ${lines.length - max} more lines_`);
  while (out.length && !out[0].trim()) out.shift();
  return out.join("\n");
}
