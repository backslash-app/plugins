// TickTick Open API: the sign-in, response types and pure logic (quick add, dates, priorities).

import { type Color, Icons, meta, type Metadata, type OAuthProvider } from "@backslash/api";

export const API = "https://api.ticktick.com/open/v1";
export const DEVELOPER_URL = "https://developer.ticktick.com/manage";
export const DEFAULT_PORT = 43118;

/** The app isn't set up, or TickTick refused the token: the list shows how to connect. */
export class AuthError extends Error {}

/** The user's own TickTick app (TickTick has no personal tokens). */
export function provider(prefs: Record<string, unknown>): OAuthProvider {
  const clientId = String(prefs.clientId ?? "").trim();
  const clientSecret = String(prefs.clientSecret ?? "").trim();
  if (!clientId) throw new AuthError("Connect your TickTick account");
  if (!clientSecret) throw new AuthError("Add the Client Secret of your TickTick app");
  const raw = prefs.redirectPort;
  const port = raw === undefined || raw === null || raw === "" ? DEFAULT_PORT : Number(raw);
  return {
    id: "ticktick",
    title: "TickTick",
    authorizeUrl: "https://ticktick.com/oauth/authorize",
    tokenUrl: "https://ticktick.com/oauth/token",
    clientId,
    clientSecret,
    clientAuth: "basic",
    scopes: ["tasks:read", "tasks:write"],
    redirectPort: port > 0 && port < 65536 ? Math.round(port) : DEFAULT_PORT,
  };
}

export function tickError(status: number, text: string): Error {
  if (status === 401) return new AuthError("TickTick signed you out");
  if (status === 403) return new Error("TickTick refused it: the app needs the tasks:read and tasks:write scopes");
  if (status === 404) return new Error("Not found on TickTick: it may have been deleted");
  if (status === 429) return new Error("TickTick is rate limiting: try again in a minute");
  let message = "";
  try {
    const body = JSON.parse(text);
    message = body.errorMessage ?? body.error_description ?? body.message ?? "";
  } catch {
    message = text.slice(0, 160);
  }
  return new Error(`TickTick answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Types (only the fields used)

export interface Project {
  id: string;
  name: string;
  color?: string | null;
  closed?: boolean | null;
  kind?: string;
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  content?: string;
  desc?: string;
  isAllDay?: boolean;
  startDate?: string | null;
  dueDate?: string | null;
  timeZone?: string;
  repeatFlag?: string | null;
  priority: number;
  status: number;
  items?: { id: string; title: string; status: number }[];
  tags?: string[];
  sortOrder?: number;
}

export const INBOX: Project = { id: "inbox", name: "Inbox" };

// ---------------------------------------------------------------------------
// Dates

/** `2026-10-29T15:00:00.000+0000` (TickTick's format) → a Date. */
export function tickDate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined;
  const d = new Date(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return isNaN(d.getTime()) ? undefined : d;
}

/** A Date in TickTick's format, UTC. */
export function toTick(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, ".000+0000");
}

export function dueOf(task: Task): { date: Date; time: boolean } | undefined {
  const date = tickDate(task.dueDate) ?? tickDate(task.startDate);
  return date ? { date, time: !task.isAllDay } : undefined;
}

/** The date fields of a task due at `when` (all day or at a time). */
export function dateFields(when: When, timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  const at = when.time ? when.date : new Date(when.date.getFullYear(), when.date.getMonth(), when.date.getDate());
  return { startDate: toTick(at), dueDate: toTick(at), isAllDay: !when.time, timeZone };
}

export function taskSection(task: Task, now = new Date()): string {
  const due = dueOf(task);
  return dueBucket(due?.date, now, due?.time ?? false);
}

export function sortTasks(tasks: Task[], now = new Date()): Task[] {
  const rank = (t: Task) => BUCKETS.indexOf(taskSection(t, now));
  const when = (t: Task) => dueOf(t)?.date.getTime() ?? Infinity;
  return [...tasks].sort((a, b) =>
    rank(a) - rank(b) || when(a) - when(b) || b.priority - a.priority || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
  );
}

// ---------------------------------------------------------------------------
// Priorities and colors

export const PRIORITIES = [
  { value: 5, name: "High", color: "red" as Color },
  { value: 3, name: "Medium", color: "yellow" as Color },
  { value: 1, name: "Low", color: "blue" as Color },
  { value: 0, name: "None", color: "gray" as Color },
];

export const priorityOf = (n: number) => PRIORITIES.find((p) => p.value === n) ?? PRIORITIES[3];

/** The palette color closest to a `#rrggbb` color. */
export function colorOf(hex: string | null | undefined): Color {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return "gray";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.12) return "gray";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  const hue = (h * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 40) return "orange";
  if (hue < 65) return "yellow";
  if (hue < 160) return "green";
  if (hue < 195) return "teal";
  if (hue < 250) return "blue";
  if (hue < 300) return "purple";
  return "pink";
}

export const taskUrl = (t: Pick<Task, "id" | "projectId">) =>
  `https://ticktick.com/webapp/#p/${t.projectId}/tasks/${t.id}`;

/** "Every week" from `RRULE:FREQ=WEEKLY;INTERVAL=1`. */
export function repeatText(rule: string | null | undefined): string | undefined {
  if (!rule) return undefined;
  const freq = /FREQ=(\w+)/.exec(rule)?.[1];
  const interval = Number(/INTERVAL=(\d+)/.exec(rule)?.[1] ?? 1);
  const unit = { DAILY: "day", WEEKLY: "week", MONTHLY: "month", YEARLY: "year" }[freq ?? ""];
  if (!unit) return "Repeats";
  return interval > 1 ? `Every ${interval} ${unit}s` : `Every ${unit}`;
}

export function checklist(task: Task): { done: number; total: number } {
  const items = task.items ?? [];
  return { done: items.filter((i) => i.status !== 0).length, total: items.length };
}

export function taskMetadata(task: Task, project: Project | undefined, now = new Date()): Metadata[] {
  const lines: Metadata[] = [];
  const due = dueOf(task);
  lines.push(
    due
      ? meta.text("Due", shortDue(due.date, now, due.time), {
        icon: Icons.calendar,
        color: taskSection(task, now) === "Overdue" ? "red" : undefined,
      })
      : meta.text("Due", "No date", { icon: Icons.calendar }),
  );
  const repeat = repeatText(task.repeatFlag);
  if (repeat) lines.push(meta.text("Repeats", repeat, { icon: Icons.repeat }));
  const p = priorityOf(task.priority);
  lines.push(meta.text("Priority", p.name, { icon: Icons.flag, color: p.value ? p.color : undefined }));
  if (project) lines.push(meta.text("List", project.name, { icon: Icons.dot, color: colorOf(project.color) }));
  if (task.tags?.length) lines.push(meta.tags("Tags", task.tags));
  const list = checklist(task);
  if (list.total) lines.push(meta.progress("Checklist", list.done / list.total, `${list.done} of ${list.total}`));
  return lines;
}

/** The note, and the checklist as a markdown list. */
export function taskMarkdown(task: Task): string | undefined {
  const parts: string[] = [];
  const note = (task.content || task.desc || "").trim();
  if (note) parts.push(note.length > 600 ? `${note.slice(0, 600).trimEnd()}…` : note);
  const items = task.items ?? [];
  if (items.length) {
    parts.push(items.map((i) => `- ${i.status !== 0 ? "~~" : ""}${i.title}${i.status !== 0 ? "~~" : ""}`).join("\n"));
  }
  return parts.join("\n\n") || undefined;
}

// ---------------------------------------------------------------------------
// Quick add

export interface QuickAdd {
  title: string;
  when?: When;
  priority: number;
  /** The list typed after ^ or ~, as typed. */
  project?: string;
}

const PRIORITY_WORDS: Record<string, number> = { high: 5, h: 5, medium: 3, med: 3, m: 3, low: 1, l: 1, none: 0 };

/** Words that are a date on their own, safe to take out of a title. */
const SAFE_SINGLE =
  /^(today|tonight|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}(:\d{2})?(am|pm)|\d{1,2}:\d{2}|\d{1,2}h\d{2}|\d{4}-\d{2}-\d{2}|\+\d{1,3}[dw])$/i;

const TIME_ONLY = /^\d{1,2}([:h.]\d{2})? ?(am|pm)?$/i;

/**
 * The longest, rightmost run of words that reads as a date, taken out of
 * `words`. `want` limits it to a time alone or a day alone.
 */
function takeWhen(words: string[], now: Date, want?: "time" | "day"): { when: When; timeOnly: boolean } | undefined {
  for (let len = Math.min(4, words.length); len >= 1; len--) {
    for (let start = words.length - len; start >= 0; start--) {
      const window = words.slice(start, start + len);
      if (window.some((w) => /^[!#^~]/.test(w))) continue;
      const text = window.join(" ");
      if (len === 1 && !SAFE_SINGLE.test(text)) continue;
      const timeOnly = TIME_ONLY.test(text);
      if ((want === "time" && !timeOnly) || (want === "day" && timeOnly)) continue;
      let when: When | undefined;
      try {
        when = parseWhen(text, now);
      } catch {
        continue;
      }
      if (!when || (want === "day" && when.time)) continue;
      // "at 3pm", "on friday", "by monday", "due tomorrow".
      const from = start > 0 && /^(at|on|by|due|@)$/i.test(words[start - 1]) ? start - 1 : start;
      words.splice(from, start + len - from);
      return { when, timeOnly };
    }
  }
  return undefined;
}

/**
 * "Call Bob tomorrow 3pm ^Work !high" → title "Call Bob", tomorrow at 15:00,
 * list "Work", high priority. `#tags` stay in the title (the Open API takes no tags).
 */
export function parseQuickAdd(input: string, now = new Date()): QuickAdd {
  let words = input.trim().split(/\s+/).filter(Boolean);
  let priority = 0;
  let project: string | undefined;
  words = words.filter((w) => {
    // !high, !med, !low, !none, or ! / !! / !!! for low, medium, high.
    const bangs = /^!{1,3}$/.exec(w);
    const word = /^!([a-z]+)$/i.exec(w);
    const value = bangs ? [1, 3, 5][w.length - 1] : word ? PRIORITY_WORDS[word[1].toLowerCase()] : undefined;
    if (value !== undefined) {
      priority = value;
      return false;
    }
    const list = /^[\^~](.+)$/.exec(w);
    if (list) {
      project = list[1].replace(/_/g, " ");
      return false;
    }
    return true;
  });
  const found = takeWhen(words, now);
  let when = found?.when;
  // A day and, elsewhere, a time: "tomorrow call Bob at 3pm".
  if (found && (found.timeOnly || !found.when.time)) {
    const other = takeWhen(words, now, found.timeOnly ? "day" : "time");
    if (other) {
      const [day, time] = found.timeOnly ? [other.when.date, found.when.date] : [found.when.date, other.when.date];
      when = {
        date: new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.getHours(), time.getMinutes()),
        time: true,
      };
    }
  }
  const title = words.join(" ").trim();
  return { title: title || input.trim(), when, priority, project };
}

/** The list a quick add names: exact name, then a prefix, ignoring case and emoji. */
export function findProject(projects: Project[], name: string | undefined): Project | undefined {
  if (!name) return undefined;
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").trim();
  const n = norm(name);
  return projects.find((p) => norm(p.name) === n) ?? projects.find((p) => norm(p.name).startsWith(n));
}

// ---------------------------------------------------------------------------
// Dates

/** `YYYY-MM-DD` in local time. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Midnight of a `YYYY-MM-DD` day, local time. */
export function dayOf(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A day typed by a person, or undefined: today, tomorrow, friday, next week, +3d, 2026-11-03, 3 Nov. */
function parseDay(text: string, now: Date): Date | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  const today = addDays(now, 0);
  if (/^(today|tod|tonight)$/.test(t)) return today;
  if (/^(tomorrow|tmr|tom|tmrw)$/.test(t)) return addDays(now, 1);
  if (t === "day after tomorrow") return addDays(now, 2);
  if (t === "next week") return addDays(now, ((8 - now.getDay()) % 7) || 7);
  if (t === "weekend" || t === "this weekend") return addDays(now, now.getDay() === 6 ? 0 : (6 - now.getDay()) || 6);
  const rel = /^(?:in )?\+?(\d{1,3}) ?(d|days?|w|weeks?)$/.exec(t);
  if (rel) return addDays(now, Number(rel[1]) * (rel[2].startsWith("w") ? 7 : 1));
  const wd = /^(?:next |this |on )?([a-z]{3,9})$/.exec(t);
  if (wd) {
    const i = WEEKDAYS.findIndex((w) => w.startsWith(wd[1]) && wd[1].length >= 3);
    if (i >= 0) return addDays(now, ((i - now.getDay() + 7) % 7) || 7);
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return valid(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])), Number(iso[3]));
  const dm = /^(\d{1,2}) ([a-z]{3,9})\.?(?: (\d{4}))?$/.exec(t) ??
    swap(/^([a-z]{3,9})\.? (\d{1,2})(?:,? (\d{4}))?$/.exec(t));
  if (dm) {
    const month = MONTHS.indexOf(dm[2].slice(0, 3));
    if (month < 0) return undefined;
    const day = Number(dm[1]);
    let d = new Date(dm[3] ? Number(dm[3]) : now.getFullYear(), month, day);
    if (!dm[3] && d < today) d = new Date(now.getFullYear() + 1, month, day);
    return valid(d, day);
  }
  return undefined;
}

function swap(m: RegExpExecArray | null): string[] | null {
  return m ? [m[0], m[2], m[1], m[3]] : null;
}

function valid(d: Date, day: number): Date | undefined {
  return isNaN(d.getTime()) || d.getDate() !== day ? undefined : d;
}

/** A time of day: 15:00, 3pm, 3:30pm, 15h, 15h30. */
function parseTime(text: string): { h: number; m: number } | undefined {
  const t = text.trim().toLowerCase();
  const m = /^(\d{1,2})(?:[:h.](\d{2}))? ?(am|pm|h)?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return { h, m: min };
}

export interface When {
  date: Date;
  /** False for a whole day. */
  time: boolean;
}

/**
 * A due date typed in a form: "tomorrow", "fri 3pm", "next week", "+3d",
 * "2026-11-03 14:30", "3 Nov". Empty → undefined; unreadable → throws.
 */
export function parseWhen(text: string, now = new Date()): When | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/ at /, " ");
  if (!t || t === "none" || t === "no date") return undefined;
  const words = t.split(" ");
  // The time is the last word or two ("3 pm").
  for (const n of [2, 1]) {
    if (words.length < n) continue;
    const time = parseTime(words.slice(-n).join(""));
    if (!time) continue;
    const rest = words.slice(0, -n).join(" ").replace(/ at$/, "");
    let day = rest ? parseDay(rest, now) : addDays(now, 0);
    if (!day) break;
    const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m);
    // "3pm" alone, already past: tomorrow.
    if (!rest && date <= now) {
      day = addDays(now, 1);
      date.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    }
    return { date, time: true };
  }
  const day = parseDay(t, now);
  if (day) return { date: day, time: false };
  throw new Error(`Can't read the date “${text.trim()}”: try today, tomorrow, friday 3pm, +3d or 2026-11-03`);
}

/** "Overdue", "Today", "Tomorrow", "This Week", "Later" or "No Due Date". */
export function dueBucket(due: Date | undefined, now = new Date(), time = true): string {
  if (!due) return "No Due Date";
  const today = localDate(now);
  const day = localDate(due);
  if (time ? due < now && day <= today : day < today) return "Overdue";
  if (day === today) return "Today";
  if (day === localDate(addDays(now, 1))) return "Tomorrow";
  if (due < addDays(now, 7)) return "This Week";
  return "Later";
}

export const BUCKETS = ["Overdue", "Today", "Tomorrow", "This Week", "Later", "No Due Date"];

/** "today 15:00", "tomorrow", "Fri", "Nov 3", "Nov 3, 2027". */
export function shortDue(due: Date, now = new Date(), time = true): string {
  const clock = time ? ` ${due.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "";
  const day = localDate(due);
  if (day === localDate(now)) return `today${clock}`;
  if (day === localDate(addDays(now, 1))) return `tomorrow${clock}`;
  if (day === localDate(addDays(now, -1))) return `yesterday${clock}`;
  const days = (dayOf(day).getTime() - dayOf(localDate(now)).getTime()) / 86_400_000;
  if (days > 0 && days < 7) return `${due.toLocaleDateString("en", { weekday: "short" })}${clock}`;
  const sameYear = due.getFullYear() === now.getFullYear();
  return due.toLocaleDateString("en", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }) +
    clock;
}

/** The choices of a "Change Due Date" submenu, as `YYYY-MM-DD`. */
export function dueChoices(now = new Date()): { title: string; date: string | null }[] {
  const monday = addDays(now, ((8 - now.getDay()) % 7) || 7);
  return [
    { title: "Today", date: localDate(now) },
    { title: "Tomorrow", date: localDate(addDays(now, 1)) },
    {
      title: `Next Week (${monday.toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" })})`,
      date: localDate(monday),
    },
    { title: "In Two Weeks", date: localDate(addDays(now, 14)) },
    { title: "No Due Date", date: null },
  ];
}
