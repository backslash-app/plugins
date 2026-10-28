// Asana: account, response types and pure mapping (due sections, colors, metadata).

import { type Color, Icons, type Item, meta, type Metadata, open } from "@backslash/api";

export const API = "https://app.asana.com/api/1.0";
export const TOKEN_URL = "https://app.asana.com/0/my-apps";

/** The token is missing or refused: the list shows how to connect. */
export class AuthError extends Error {}

export function tokenOf(prefs: Record<string, unknown>): string {
  const token = String(prefs.token ?? "").trim();
  if (!token) throw new AuthError("Connect your Asana account");
  return token;
}

/** `{ errors: [{ message }] }` → an Error. */
export function asanaError(status: number, body: unknown): Error {
  const message = (body as { errors?: { message?: string }[] } | undefined)?.errors?.[0]?.message ?? "";
  if (status === 401) return new AuthError("Asana rejected the personal access token");
  if (status === 402) return new Error(`Asana: ${message || "this needs a paid plan"}`);
  if (status === 403) return new Error(`Asana refused it${message ? `: ${message}` : ""}`);
  if (status === 404) return new Error("Not found on Asana: it may have been deleted");
  if (status === 429) return new Error("Asana is rate limiting: try again in a minute");
  return new Error(`Asana answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Types (only the fields used)

export interface Named {
  gid: string;
  name: string;
}

export interface Workspace extends Named {
  is_organization?: boolean;
}

export interface Task extends Named {
  notes?: string;
  completed?: boolean;
  due_on?: string | null;
  due_at?: string | null;
  start_on?: string | null;
  permalink_url: string;
  modified_at?: string;
  num_subtasks?: number;
  num_likes?: number;
  projects?: (Named & { color?: string | null })[];
  tags?: (Named & { color?: string | null })[];
  memberships?: { project?: Named; section?: Named }[];
  assignee?: Named | null;
}

export interface Project extends Named {
  color?: string | null;
  notes?: string;
  permalink_url?: string;
  due_on?: string | null;
  modified_at?: string;
  owner?: Named | null;
  team?: Named | null;
  archived?: boolean;
  current_status_update?: { status_type?: string; title?: string } | null;
}

/** The workspace named in the preferences (case-insensitive), or the first one. */
export function pickWorkspace(workspaces: Workspace[], wanted: unknown): Workspace {
  if (!workspaces.length) throw new Error("This Asana account has no workspace");
  const name = String(wanted ?? "").trim().toLowerCase();
  if (!name) return workspaces[0];
  const found = workspaces.find((w) => w.name.toLowerCase() === name || w.gid === name) ??
    workspaces.find((w) => w.name.toLowerCase().includes(name));
  if (!found) {
    throw new Error(`No Asana workspace “${String(wanted).trim()}”: ${workspaces.map((w) => w.name).join(", ")}`);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Colors

/** Asana's colors (`dark-green`, `light-warm-gray`…) in the launcher's palette. */
export function asanaColor(color: string | null | undefined): Color {
  const c = (color ?? "").replace(/^(dark|light)-/, "");
  const map: Record<string, Color> = {
    pink: "pink",
    magenta: "pink",
    green: "green",
    blue: "blue",
    indigo: "purple",
    red: "red",
    teal: "teal",
    aqua: "teal",
    brown: "orange",
    orange: "orange",
    coral: "orange",
    yellow: "yellow",
    purple: "purple",
    "warm-gray": "gray",
  };
  return map[c] ?? "gray";
}

/** A project's latest status update: on track, at risk… */
export function projectStatus(p: Project): { text: string; color: Color } | undefined {
  const type = p.current_status_update?.status_type;
  const map: Record<string, { text: string; color: Color }> = {
    on_track: { text: "On track", color: "green" },
    at_risk: { text: "At risk", color: "yellow" },
    off_track: { text: "Off track", color: "red" },
    on_hold: { text: "On hold", color: "blue" },
    complete: { text: "Complete", color: "purple" },
    achieved: { text: "Achieved", color: "green" },
    partial: { text: "Partially achieved", color: "yellow" },
    missed: { text: "Missed", color: "red" },
    dropped: { text: "Dropped", color: "gray" },
  };
  return type ? map[type] : undefined;
}

// ---------------------------------------------------------------------------
// Tasks

/** When the task is due: `due_at` (a time) or `due_on` (a day). */
export function dueOf(task: Task): { date: Date; time: boolean } | undefined {
  if (task.due_at) return { date: new Date(task.due_at), time: true };
  if (task.due_on) return { date: dayOf(task.due_on), time: false };
  return undefined;
}

export const SECTIONS = ["Overdue", "Today", "Upcoming", "Later", "No Due Date"];

/** Overdue, Today, Upcoming (the next 7 days), Later, No Due Date. */
export function taskSection(task: Task, now = new Date()): string {
  const due = dueOf(task);
  const bucket = dueBucket(due?.date, now, due?.time ?? false);
  return bucket === "Tomorrow" || bucket === "This Week" ? "Upcoming" : bucket;
}

export function sortTasks(tasks: Task[], now = new Date()): Task[] {
  const rank = (t: Task) => SECTIONS.indexOf(taskSection(t, now));
  const when = (t: Task) => dueOf(t)?.date.getTime() ?? Infinity;
  return [...tasks].sort((a, b) =>
    rank(a) - rank(b) || when(a) - when(b) || (b.modified_at ?? "").localeCompare(a.modified_at ?? "")
  );
}

export function dueColor(task: Task, now = new Date()): Color | undefined {
  const section = taskSection(task, now);
  if (section === "Overdue") return "red";
  if (section === "Today") return "green";
  return undefined;
}

/** The section of the task in a project ("Doing"), when it has one. */
export function sectionIn(task: Task, projectGid?: string): string | undefined {
  const m = task.memberships?.find((x) => !projectGid || x.project?.gid === projectGid);
  const name = m?.section?.name;
  return name && name !== "(no section)" && name !== "Untitled section" ? name : undefined;
}

export function taskMetadata(task: Task, now = new Date()): Metadata[] {
  const lines: Metadata[] = [];
  const due = dueOf(task);
  lines.push(
    due
      ? meta.text("Due", shortDue(due.date, now, due.time), { icon: Icons.calendar, color: dueColor(task, now) })
      : meta.text("Due", "No due date", { icon: Icons.calendar }),
  );
  if (task.start_on) {
    lines.push(meta.text("Start", shortDue(dayOf(task.start_on), now, false), { icon: Icons.calendar }));
  }
  const projects = task.projects ?? [];
  if (projects.length) {
    lines.push(meta.tags("Projects", projects.map((p) => ({ text: p.name, color: asanaColor(p.color) }))));
  }
  const section = sectionIn(task);
  if (section) lines.push(meta.text("Section", section, { icon: Icons.layers }));
  const tags = task.tags ?? [];
  if (tags.length) lines.push(meta.tags("Tags", tags.map((t) => ({ text: t.name, color: asanaColor(t.color) }))));
  if (task.num_subtasks) lines.push(meta.text("Subtasks", task.num_subtasks, { icon: Icons.squareCheck }));
  if (task.num_likes) lines.push(meta.text("Likes", task.num_likes, { icon: Icons.heart }));
  lines.push(meta.separator());
  if (task.modified_at) lines.push(meta.text("Modified", shortDue(new Date(task.modified_at), now, false)));
  lines.push(meta.link("Link", "Open in Asana", task.permalink_url));
  return lines;
}

export function excerpt(text: string | null | undefined, max = 500): string | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

/** The task as Asana wants it for a due date: a day, a precise time, or none. */
export function dueBody(when: When | undefined): Record<string, string | null> {
  if (!when) return { due_on: null, due_at: null };
  return when.time ? { due_at: when.date.toISOString() } : { due_on: localDate(when.date) };
}

export function setupItem(error: AuthError): Item {
  return {
    id: "setup",
    title: error.message,
    subtitle: "A personal access token from Asana",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Asana",
        "",
        "1. Open **Asana → Settings → Apps → Developer apps** (Enter opens it) and choose",
        "   **Create new token**. Give it a name like *Backslash*.",
        "2. Paste the token in **Settings → Extensions → Asana → Configure → Personal access token**.",
        "3. With several workspaces, type the one to use in **Workspace** (the first one otherwise).",
        "",
        "The token acts as you: Backslash only reads your tasks and projects and changes the tasks you act on.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create Access Token", { icon: Icons.key })],
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
