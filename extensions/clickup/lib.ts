// ClickUp: token, response types and pure mapping (statuses, priorities, dates).

import { type Color, Icons, type Item, meta, type Metadata, open } from "@backslash/api";

export const API = "https://api.clickup.com/api/v2";
export const TOKEN_URL = "https://app.clickup.com/settings/apps";

/** The token is missing or refused: the list shows how to connect. */
export class AuthError extends Error {}

export function tokenOf(prefs: Record<string, unknown>): string {
  const token = String(prefs.token ?? "").trim();
  if (!token) throw new AuthError("Connect your ClickUp account");
  if (!token.startsWith("pk_")) throw new AuthError("A ClickUp personal token starts with pk_");
  return token;
}

/** `{ err, ECODE }` → an Error. */
export function clickupError(status: number, body: unknown): Error {
  const b = body as { err?: string; ECODE?: string } | undefined;
  const message = b?.err ?? "";
  if (status === 401 || b?.ECODE === "OAUTH_017" || b?.ECODE === "OAUTH_019") {
    return new AuthError("ClickUp rejected the API token");
  }
  if (status === 429) return new Error("ClickUp is rate limiting: try again in a minute");
  if (status === 404) return new Error("Not found on ClickUp: it may have been deleted or moved");
  return new Error(`ClickUp answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Types (only the fields used)

export interface Status {
  status: string;
  color: string;
  type: string;
  orderindex: number | string;
}

export interface User {
  id: number;
  username: string | null;
  email?: string;
  initials?: string;
  profilePicture?: string | null;
}

export interface Task {
  id: string;
  custom_id?: string | null;
  name: string;
  text_content?: string | null;
  status: Status;
  date_created?: string;
  date_updated?: string;
  date_closed?: string | null;
  creator?: User;
  assignees: User[];
  tags: { name: string; tag_fg?: string; tag_bg?: string }[];
  parent?: string | null;
  priority: { id: string; priority: string; color?: string } | null;
  due_date: string | null;
  start_date?: string | null;
  time_estimate?: number | null;
  list: { id: string; name: string };
  folder?: { id: string; name: string; hidden?: boolean };
  space?: { id: string };
  url: string;
  team_id?: string;
}

export interface Team {
  id: string;
  name: string;
  color?: string;
}

export interface ListRef {
  id: string;
  name: string;
  statuses?: Status[];
}

// ---------------------------------------------------------------------------
// Statuses and priorities

/** What's moving first: in progress (custom), to do (open), then done and closed. */
const TYPE_ORDER = ["custom", "open", "done", "closed"];

export function typeRank(type: string): number {
  const i = TYPE_ORDER.indexOf(type);
  return i === -1 ? 1.5 : i;
}

/** The palette color closest to a `#rrggbb` color. */
export function colorOf(hex: string | null | undefined): Color {
  // `#f50` is `#ff5500`.
  const full = (hex ?? "").replace(/^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i, "#$1$1$2$2$3$3");
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(full);
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

export function statusIcon(status: Status): { source: string; tint: Color } {
  const tint = colorOf(status.color);
  switch (status.type) {
    case "open":
      return { source: Icons.todo, tint };
    case "done":
    case "closed":
      return { source: Icons.done, tint };
    default:
      return { source: /review|qa|test/i.test(status.status) ? Icons.inReview : Icons.inProgress, tint };
  }
}

/** "in progress" → "In Progress", as ClickUp shows them. */
export function statusName(status: string): string {
  return status.replace(/(^|[\s-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

export const PRIORITIES = [
  { id: 1, name: "Urgent", icon: Icons.urgent, color: "red" as Color },
  { id: 2, name: "High", icon: Icons.high, color: "yellow" as Color },
  { id: 3, name: "Normal", icon: Icons.medium, color: "blue" as Color },
  { id: 4, name: "Low", icon: Icons.low, color: "gray" as Color },
];

export function priorityOf(task: Pick<Task, "priority">) {
  const id = Number(task.priority?.id ?? 0);
  return PRIORITIES.find((p) => p.id === id);
}

export function sortTasks(tasks: Task[]): Task[] {
  const due = (t: Task) => t.due_date ? Number(t.due_date) : Infinity;
  const prio = (t: Task) => priorityOf(t)?.id ?? 5;
  return [...tasks].sort((a, b) =>
    typeRank(a.status.type) - typeRank(b.status.type) ||
    a.status.status.localeCompare(b.status.status) ||
    prio(a) - prio(b) || due(a) - due(b)
  );
}

/** Which tasks a status filter keeps. */
export function matchesFilter(task: Task, filter: string | undefined): boolean {
  const type = task.status.type;
  switch (filter) {
    case "todo":
      return type === "open";
    case "progress":
      return type === "custom";
    case "done":
      return type === "done" || type === "closed";
    default:
      return type !== "done" && type !== "closed";
  }
}

// ---------------------------------------------------------------------------
// Dates and people

/** ClickUp dates are milliseconds as strings. */
export const msDate = (ms: string | null | undefined) => ms ? new Date(Number(ms)) : undefined;

/**
 * ClickUp doesn't say whether a due date has a time: a day without one is
 * stored at 4:00 (or midnight) local time.
 */
export function hasTime(d: Date): boolean {
  return !((d.getHours() === 4 || d.getHours() === 0) && d.getMinutes() === 0);
}

export function dueColor(task: Task, now = new Date()): Color | undefined {
  const due = msDate(task.due_date);
  if (!due || task.status.type === "done" || task.status.type === "closed") return undefined;
  const bucket = dueBucket(due, now, hasTime(due));
  return bucket === "Overdue" ? "red" : bucket === "Today" ? "orange" : undefined;
}

/** "2h 30m" from milliseconds. */
export function estimate(ms: number | null | undefined): string | undefined {
  if (!ms) return undefined;
  const minutes = Math.round(ms / 60_000);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return [h ? `${h}h` : "", m ? `${m}m` : ""].filter(Boolean).join(" ") || "0m";
}

/** A picture only from the host in `net`, else the name for initials. */
export function avatarOf(user: User): string {
  const pic = user.profilePicture ?? "";
  if (pic.startsWith("https://attachments.clickup.com/")) return pic;
  return user.username ?? user.email ?? "?";
}

export const whereOf = (task: Task) =>
  task.folder && !task.folder.hidden ? `${task.folder.name} › ${task.list.name}` : task.list.name;

export function taskMetadata(task: Task, options: { team?: string } = {}, now = new Date()): Metadata[] {
  const icon = statusIcon(task.status);
  const prio = priorityOf(task);
  const lines: Metadata[] = [
    meta.text("Status", statusName(task.status.status), { icon: icon.source, color: icon.tint }),
    prio
      ? meta.text("Priority", prio.name, { icon: prio.icon, color: prio.color })
      : meta.text("Priority", "None", { icon: Icons.noPriority }),
  ];
  const due = msDate(task.due_date);
  if (due) {
    lines.push(
      meta.text("Due", shortDue(due, now, hasTime(due)), { icon: Icons.calendar, color: dueColor(task, now) }),
    );
  }
  const start = msDate(task.start_date);
  if (start) lines.push(meta.text("Start", shortDue(start, now, hasTime(start)), { icon: Icons.calendar }));
  for (const [i, u] of task.assignees.entries()) {
    lines.push(meta.person(i === 0 ? "Assignees" : "", u.username ?? u.email ?? "Someone", avatarOf(u)));
  }
  if (task.tags.length) {
    lines.push(meta.tags("Tags", task.tags.map((t) => ({ text: t.name, color: colorOf(t.tag_bg) }))));
  }
  const est = estimate(task.time_estimate);
  if (est) lines.push(meta.text("Estimate", est, { icon: Icons.timer }));
  lines.push(meta.separator());
  lines.push(meta.text("List", whereOf(task), { icon: Icons.layers }));
  if (options.team) lines.push(meta.text("Workspace", options.team, { icon: Icons.home }));
  if (task.custom_id) lines.push(meta.text("ID", task.custom_id, { icon: Icons.hash }));
  const updated = msDate(task.date_updated);
  if (updated) lines.push(meta.text("Updated", shortDue(updated, now, false)));
  lines.push(meta.link("Link", "Open in ClickUp", task.url));
  return lines;
}

export function excerpt(text: string | null | undefined, max = 500): string | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** `due_date` (ms) and `due_date_time` for the API. */
export function dueFields(when: When | undefined): { due_date: number | null; due_date_time?: boolean } {
  if (!when) return { due_date: null };
  const d = new Date(when.date);
  if (!when.time) d.setHours(4, 0, 0, 0);
  return { due_date: d.getTime(), due_date_time: when.time };
}

export function setupItem(error: AuthError): Item {
  return {
    id: "setup",
    title: error.message,
    subtitle: "A personal API token from ClickUp",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect ClickUp",
        "",
        "1. In ClickUp, open your avatar → **Settings → Apps** (Enter opens it).",
        "2. Under **API Token**, choose **Generate** (or **Copy** if you have one): it starts with `pk_`.",
        "3. Paste it in **Settings → Extensions → ClickUp → Configure → Personal API token**.",
        "",
        "The token acts as you in every workspace you belong to; regenerating it in ClickUp revokes this one.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Get API Token", { icon: Icons.key })],
  };
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
