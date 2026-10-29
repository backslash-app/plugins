// Vikunja's tasks, projects and labels: due dates and their buckets, priorities, Vikunja's
// quick add magic (*label +project !priority and dates), and the hosts the extension may
// reach. No I/O here.

import { type Color, Icons, meta, type Metadata } from "@backslash/api";

/** Raised when the extension isn't set up or the server refuses it: the list shows how to fix it. */
export class SetupError extends Error {}

// ---------------------------------------------------------------------------
// Types (only the fields used; a task is sent back whole when it changes)

export interface Label {
  id: number;
  title: string;
  hex_color?: string;
}

export interface Project {
  id: number;
  title: string;
  hex_color?: string;
  is_archived?: boolean;
  parent_project_id?: number;
  position?: number;
  identifier?: string;
}

export interface Task {
  id: number;
  title: string;
  description?: string;
  done: boolean;
  /** RFC 3339; Vikunja's "no date" is year 1. */
  due_date?: string | null;
  priority?: number;
  labels?: Label[] | null;
  project_id: number;
  identifier?: string;
  index?: number;
  repeat_after?: number;
  repeat_mode?: number;
  percent_done?: number;
  is_favorite?: boolean;
  created?: string;
  updated?: string;
  assignees?: { username: string; name?: string }[] | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Dates

const DAY = 86_400_000;

/** A task's due date, or nothing for Vikunja's empty date (0001-01-01). */
export function dueOf(task: Pick<Task, "due_date">): Date | undefined {
  if (!task.due_date) return undefined;
  const d = new Date(task.due_date);
  return isNaN(d.getTime()) || d.getFullYear() < 1900 ? undefined : d;
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** Midnight of the same day. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayNumber(d: Date): number {
  return Math.round(startOfDay(d).getTime() / DAY);
}

export const BUCKETS = ["Overdue", "Today", "Tomorrow", "This Week", "Later", "No Due Date"];

/** Due before today: overdue; due today, even at an hour already past, is still today's. */
export function bucketOf(task: Pick<Task, "due_date">, now = new Date()): string {
  const due = dueOf(task);
  if (!due) return "No Due Date";
  const days = dayNumber(due) - dayNumber(now);
  if (days < 0) return "Overdue";
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return "This Week";
  return "Later";
}

/** Overdue first, then by due date, then the most urgent, then the newest. */
export function sortTasks(tasks: Task[], now = new Date()): Task[] {
  const rank = (t: Task) => BUCKETS.indexOf(bucketOf(t, now));
  const when = (t: Task) => dueOf(t)?.getTime() ?? Infinity;
  return [...tasks].sort((a, b) =>
    rank(a) - rank(b) || when(a) - when(b) || (b.priority ?? 0) - (a.priority ?? 0) || b.id - a.id
  );
}

/** Vikunja always stores a time: noon reads as "the whole day" here and in its interface. */
function hasTime(d: Date): boolean {
  return !(d.getHours() === 12 && d.getMinutes() === 0) && !(d.getHours() === 0 && d.getMinutes() === 0);
}

/** "today", "tomorrow 15:00", "Fri", "Nov 3", "Mar 3, 2027". */
export function shortDue(due: Date, now = new Date()): string {
  const clock = hasTime(due) ? ` ${due.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "";
  const days = dayNumber(due) - dayNumber(now);
  if (days === 0) return `today${clock}`;
  if (days === 1) return `tomorrow${clock}`;
  if (days === -1) return `yesterday${clock}`;
  if (days > 1 && days < 7) return `${due.toLocaleDateString("en", { weekday: "short" })}${clock}`;
  const sameYear = due.getFullYear() === now.getFullYear();
  return due.toLocaleDateString("en", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }) +
    clock;
}

/** Monday of next week. */
export function nextWeek(now = new Date()): Date {
  const d = startOfDay(now);
  return addDays(d, ((8 - d.getDay()) % 7) || 7);
}

/** `day` at the time of day `like` had (noon when it had none). */
export function onDay(day: Date, like?: Date): Date {
  const d = startOfDay(day);
  if (like) d.setHours(like.getHours(), like.getMinutes());
  else d.setHours(12, 0);
  return d;
}

export function rescheduleChoices(now = new Date()): { title: string; date: Date | null }[] {
  return [
    { title: "Today", date: startOfDay(now) },
    { title: "Tomorrow", date: addDays(startOfDay(now), 1) },
    { title: "Next Week", date: nextWeek(now) },
    { title: "Remove Due Date", date: null },
  ];
}

// ---------------------------------------------------------------------------
// Priorities and colors

export const PRIORITIES: { value: number; name: string; color?: Color; icon: string }[] = [
  { value: 0, name: "Unset", icon: Icons.noPriority },
  { value: 1, name: "Low", color: "gray", icon: Icons.low },
  { value: 2, name: "Medium", color: "blue", icon: Icons.medium },
  { value: 3, name: "High", color: "orange", icon: Icons.high },
  { value: 4, name: "Urgent", color: "red", icon: Icons.urgent },
  { value: 5, name: "DO NOW", color: "red", icon: Icons.urgent },
];

export const priorityOf = (n: number | undefined) => PRIORITIES.find((p) => p.value === n) ?? PRIORITIES[0];

/** Vikunja's hex colors ("e8445a", "#1973ff") → the nearest launcher tint. */
export function colorOf(hex: string | undefined | null): Color {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex?.trim() ?? "");
  if (!m) return "gray";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 30) return "gray";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 340) return "red";
  if (h < 40) return "orange";
  if (h < 70) return "yellow";
  if (h < 160) return "green";
  if (h < 190) return "teal";
  if (h < 250) return "blue";
  if (h < 300) return "purple";
  return "pink";
}

export function isRepeating(task: Task): boolean {
  return (task.repeat_after ?? 0) > 0 || (task.repeat_mode ?? 0) > 0;
}

/** "every 2 days", "every week", "monthly", "from the current date". */
export function repeatText(task: Task): string | undefined {
  if (task.repeat_mode === 1) return "every month";
  if (task.repeat_mode === 2 && task.repeat_after) return `every ${duration(task.repeat_after)} from completion`;
  if (!task.repeat_after) return undefined;
  return `every ${duration(task.repeat_after)}`;
}

function duration(seconds: number): string {
  const units: [number, string][] = [[604_800, "week"], [86_400, "day"], [3600, "hour"]];
  for (const [n, name] of units) {
    if (seconds % n === 0) {
      const k = seconds / n;
      return k === 1 ? name : `${k} ${name}s`;
    }
  }
  return `${Math.round(seconds / 60)} minutes`;
}

// ---------------------------------------------------------------------------
// Description (HTML since Vikunja 0.22) → text

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function htmlToText(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<li[^>]*data-checked="true"[^>]*>/gi, "\n- [x] ")
    .replace(/<li[^>]*data-checked="false"[^>]*>/gi, "\n- [ ] ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|blockquote|pre|ul|ol|tr)>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
      if (e[0] === "#") {
        const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
        return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
      }
      return ENTITIES[e.toLowerCase()] ?? all;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n- (\[[ x]\] )?\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Quick add magic

export type QuickAdd = {
  title: string;
  labels: string[];
  project?: string;
  priority?: number;
  due?: Date;
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** A word or a quoted phrase after a prefix: *urgent, *"two words", *'two words'. */
const WORD = `(?:"([^"]+)"|'([^']+)'|([^\\s"']+))`;

function take(text: string, re: RegExp): [RegExpExecArray | null, string] {
  const m = re.exec(text);
  if (!m) return [null, text];
  return [m, `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}`];
}

function validDate(y: number, m: number, d: number): Date | undefined {
  const date = new Date(y, m, d, 12);
  return date.getMonth() === m && date.getDate() === d ? date : undefined;
}

/** A date without a year: this year's, or next year's when it is already past. */
function upcoming(m: number, d: number, now: Date): Date | undefined {
  const date = validDate(now.getFullYear(), m, d);
  if (date && dayNumber(date) < dayNumber(now)) return validDate(now.getFullYear() + 1, m, d);
  return date;
}

type DateRule = [RegExp, (m: RegExpExecArray, now: Date) => Date | undefined];

const before = `(?:^|\\s)(?:(?:on|by|due)\\s+)?`;
const after = `(?=\\s|$|[,.;!?])`;

const DATE_RULES: DateRule[] = [
  [new RegExp(`${before}(\\d{4})-(\\d{1,2})-(\\d{1,2})${after}`, "i"), (m) => validDate(+m[1], +m[2] - 1, +m[3])],
  // 17/02/2027, 02/17/2027, 17.02.2027, 17/02: day first unless that can't be.
  [new RegExp(`${before}(\\d{1,2})[/.](\\d{1,2})(?:[/.](\\d{2,4}))?${after}`, "i"), (m, now) => {
    let [d, mo] = [+m[1], +m[2]];
    if (mo > 12 && d <= 12) [d, mo] = [mo, d];
    if (!m[3]) return upcoming(mo - 1, d, now);
    const y = +m[3] < 100 ? 2000 + +m[3] : +m[3];
    return validDate(y, mo - 1, d);
  }],
  // Feb 17, 17 feb, february 17th 2027.
  [
    new RegExp(
      `${before}(${MONTHS.join("|")})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${after}`,
      "i",
    ),
    (m, now) => {
      const mo = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3));
      return m[3] ? validDate(+m[3], mo, +m[2]) : upcoming(mo, +m[2], now);
    },
  ],
  [
    new RegExp(`${before}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS.join("|")})[a-z]*\\.?(?:\\s+(\\d{4}))?${after}`, "i"),
    (m, now) => {
      const mo = MONTHS.indexOf(m[2].toLowerCase().slice(0, 3));
      return m[3] ? validDate(+m[3], mo, +m[1]) : upcoming(mo, +m[1], now);
    },
  ],
  [new RegExp(`(?:^|\\s)in\\s+(\\d+)\\s+(day|week|month)s?${after}`, "i"), (m, now) => {
    const n = +m[1];
    const unit = m[2].toLowerCase();
    if (unit === "day") return addDays(now, n);
    if (unit === "week") return addDays(now, 7 * n);
    const d = new Date(now);
    d.setMonth(d.getMonth() + n);
    return d;
  }],
  [new RegExp(`${before}next\\s+week${after}`, "i"), (_, now) => nextWeek(now)],
  [new RegExp(`${before}next\\s+month${after}`, "i"), (_, now) => new Date(now.getFullYear(), now.getMonth() + 1, 1)],
  [
    new RegExp(`${before}(?:the\\s+)?end\\s+of\\s+(?:the\\s+)?month${after}`, "i"),
    (_, now) => new Date(now.getFullYear(), now.getMonth() + 1, 0),
  ],
  [new RegExp(`${before}this\\s+weekend${after}`, "i"), (_, now) => addDays(now, (6 - now.getDay() + 7) % 7)],
  [
    new RegExp(`${before}(today|tonight|tomorrow)${after}`, "i"),
    (m, now) => addDays(now, m[1].toLowerCase() === "tomorrow" ? 1 : 0),
  ],
  // "monday", "next monday": the coming one (full names only: "sun cream" is no date).
  [new RegExp(`${before}(?:next\\s+|this\\s+)?(${WEEKDAYS.join("|")})${after}`, "i"), (m, now) => {
    const target = WEEKDAYS.indexOf(m[1].toLowerCase());
    return addDays(now, (target - now.getDay() + 7) % 7 || 7);
  }],
];

const TIME_RULES: RegExp[] = [
  /(?:^|\s)(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)(?=\s|$|[,.;!?])/i,
  /(?:^|\s)at\s+(\d{1,2})(?::|h)?(\d{2})?(?=\s|$|[,.;!?])/i,
  /(?:^|\s)(\d{1,2})(?::|h)(\d{2})(?=\s|$|[,.;!?])/i,
];

/**
 * Vikunja's quick add magic, as its own web interface understands it:
 * `*label` (or `*"two words"`), `+project`, `!1`…`!5` and a date ("tomorrow",
 * "next monday", "in 3 days", "17/02", "2027-02-17", "feb 17", "next week",
 * "end of month") with an optional time ("at 15:00", "3pm"). The API takes the
 * title as it is, so the extension parses it. A date without a time is due at noon.
 */
export function parseQuickAdd(input: string, now = new Date()): QuickAdd {
  let text = ` ${input.trim()} `;
  const labels: string[] = [];
  const labelRe = new RegExp(`(?:^|\\s)\\*${WORD}`);
  while (true) {
    const [m, rest] = take(text, labelRe);
    if (!m) break;
    labels.push((m[1] ?? m[2] ?? m[3]).trim());
    text = rest;
  }
  let project: string | undefined;
  {
    const [m, rest] = take(text, new RegExp(`(?:^|\\s)\\+${WORD}`));
    if (m) [project, text] = [(m[1] ?? m[2] ?? m[3]).trim(), rest];
  }
  let priority: number | undefined;
  {
    const [m, rest] = take(text, /(?:^|\s)!([1-5])(?=\s|$)/);
    if (m) [priority, text] = [Number(m[1]), rest];
  }
  let time: { h: number; m: number } | undefined;
  for (const re of TIME_RULES) {
    const [m, rest] = take(text, re);
    if (!m) continue;
    let h = Number(m[1]);
    const min = Number(m[2] ?? 0);
    const ampm = m[3]?.toLowerCase();
    if (ampm === "pm" && h < 12) h += 12;
    if (ampm === "am" && h === 12) h = 0;
    if (h > 23 || min > 59) continue;
    [time, text] = [{ h, m: min }, rest];
    break;
  }
  let day: Date | undefined;
  for (const [re, fn] of DATE_RULES) {
    const [m, rest] = take(text, re);
    if (!m) continue;
    const d = fn(m, now);
    if (!d) continue;
    [day, text] = [d, rest];
    break;
  }
  let due: Date | undefined;
  if (day || time) {
    due = startOfDay(day ?? now);
    due.setHours(time?.h ?? 12, time?.m ?? 0);
    // "3pm" alone, already past: tomorrow.
    if (!day && due <= now) due = addDays(due, 1);
  }
  const title = text.replace(/\s+/g, " ").replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
  return { title, labels: [...new Set(labels)], project, priority, due };
}

/** A project by its title, ignoring case: the exact one, else the only one starting so. */
export function findProject(projects: Project[], name: string | undefined): Project | undefined {
  if (!name) return undefined;
  const n = name.toLowerCase().replace(/[-_]/g, " ");
  const norm = (p: Project) => p.title.toLowerCase().replace(/[-_]/g, " ");
  const exact = projects.find((p) => norm(p) === n);
  if (exact) return exact;
  const starts = projects.filter((p) => norm(p).startsWith(n));
  return starts.length === 1 ? starts[0] : undefined;
}

export function findLabel(labels: Label[], name: string): Label | undefined {
  return labels.find((l) => l.title.toLowerCase() === name.toLowerCase());
}

/** Projects people can add to: real ones (saved filters and Favorites have ids below 1), not archived. */
export function usableProjects(projects: Project[]): Project[] {
  return projects.filter((p) => p.id > 0 && !p.is_archived)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || a.id - b.id);
}

/** "Work › Clients": the path of a sub-project. */
export function projectPath(p: Project | undefined, all: Project[]): string {
  if (!p) return "";
  const names = [p.title];
  let parent = all.find((x) => x.id === p.parent_project_id);
  for (let i = 0; parent && i < 5; i++) {
    names.unshift(parent.title);
    parent = all.find((x) => x.id === parent!.parent_project_id);
  }
  return names.join(" › ");
}

// ---------------------------------------------------------------------------
// Requests

/** The query of `GET /tasks/all`: open tasks, soonest first. Both filter syntaxes: 0.24+ and older. */
export function tasksQuery(page: number, perPage = 50): string {
  const p = new URLSearchParams({
    filter: "done = false",
    filter_by: "done",
    filter_value: "false",
    filter_comparator: "equals",
    filter_include_nulls: "true",
    per_page: String(perPage),
    page: String(page),
  });
  p.append("sort_by", "due_date");
  p.append("order_by", "asc");
  p.append("sort_by", "id");
  p.append("order_by", "desc");
  return p.toString();
}

/** The whole task with changes: Vikunja's update replaces every field. */
export function updated(task: Task, changes: Partial<Task>): Task {
  const { labels: _labels, ...rest } = task;
  return { ...rest, ...changes };
}

/** A date for the API; Vikunja's "no date" is the zero time. */
export function apiDate(d: Date | null | undefined): string {
  return d ? d.toISOString() : "0001-01-01T00:00:00Z";
}

export function vikunjaError(status: number, text: string): Error {
  let message = "";
  try {
    message = String(JSON.parse(text).message ?? "");
  } catch {
    message = /^\s*</.test(text) ? "" : text.slice(0, 160);
  }
  if (status === 401) {
    return new SetupError("Vikunja refused the API token: check it in Settings → Extensions → Vikunja");
  }
  if (status === 403) {
    return new Error(`Vikunja refused it${message ? `: ${message}` : ""}: does the API token have this permission?`);
  }
  if (status === 404) return new Error(`Not found on Vikunja${message ? `: ${message}` : ""}`);
  return new Error(`Vikunja answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Detail panel

export function taskMetadata(task: Task, project: string, url: string, now = new Date()): Metadata[] {
  const due = dueOf(task);
  const prio = priorityOf(task.priority);
  const bucket = bucketOf(task, now);
  return [
    ...(project ? [meta.text("Project", project, { icon: Icons.project })] : []),
    ...(due
      ? [meta.text("Due", `${shortDue(due, now)} · ${due.toLocaleDateString("en-GB")}`, {
        icon: Icons.calendar,
        color: bucket === "Overdue" ? "red" : bucket === "Today" ? "orange" : undefined,
      })]
      : []),
    ...(task.priority ? [meta.text("Priority", prio.name, { icon: prio.icon, color: prio.color })] : []),
    ...(task.labels?.length
      ? [meta.tags("Labels", task.labels.map((l) => ({ text: l.title, color: colorOf(l.hex_color) })))]
      : []),
    ...(repeatText(task) ? [meta.text("Repeats", repeatText(task)!, { icon: Icons.repeat })] : []),
    ...(task.percent_done ? [meta.progress("Done", task.percent_done)] : []),
    ...(task.assignees?.length
      ? [meta.text("Assigned", task.assignees.map((a) => a.name || a.username).join(", "), { icon: Icons.person })]
      : []),
    meta.separator(),
    ...(task.identifier ? [meta.text("Task", task.identifier, { icon: Icons.hash })] : []),
    meta.link("Vikunja", "Open task", url),
  ];
}

// ---------------------------------------------------------------------------
// Hosts

/**
 * Where Vikunja runs, as declared in `[permissions] net` (kept equal by a
 * test): Vikunja Cloud, and a server on this computer, a container, the local
 * network, Tailscale or DuckDNS.
 */
export const HOSTS = [
  "app.vikunja.cloud",
  "localhost",
  "127.0.0.1",
  "vikunja",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.duckdns.org",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];
function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** A host of the local network, where servers usually speak plain HTTP. */
function isLocal(host: string): boolean {
  return !host.includes(".") || ipv4(host) !== undefined || /\.(local|lan|home|home\.arpa|internal)$/.test(host);
}

/** `tasks.home.lan/projects/3` or `…/api/v1` → the server's address: http:// for a local host typed without a scheme. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    const host = url.split(/[/:]/)[0].toLowerCase();
    url = `${isLocal(host) ? "http" : "https"}://${url}`;
  }
  return url
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(
      /\/(api\/v1|projects(\/\d+(\/\d+)?)?|tasks(\/\d+)?|tasks\/by\/upcoming|upcoming|login|user\/settings.*)$/i,
      "",
    )
    .replace(/\/+$/, "");
}
