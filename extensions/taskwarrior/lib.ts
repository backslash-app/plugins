// Taskwarrior's JSON export, dates and command lines, without the launcher.

/** A task as `task export` prints it (2.5, 2.6 and 3.x); unknown fields are kept in `udas`. */
export interface Task {
  id: number;
  uuid: string;
  description: string;
  status: "pending" | "waiting" | "completed" | "deleted" | "recurring";
  project?: string;
  tags: string[];
  priority?: "H" | "M" | "L";
  urgency: number;
  entry?: Date;
  modified?: Date;
  due?: Date;
  scheduled?: Date;
  wait?: Date;
  until?: Date;
  start?: Date;
  end?: Date;
  recur?: string;
  depends: string[];
  annotations: { entry?: Date; description: string }[];
  udas: Record<string, string>;
}

const KNOWN = new Set([
  "id",
  "uuid",
  "description",
  "status",
  "project",
  "tags",
  "priority",
  "urgency",
  "entry",
  "modified",
  "due",
  "scheduled",
  "wait",
  "until",
  "start",
  "end",
  "recur",
  "depends",
  "annotations",
  "mask",
  "imask",
  "parent",
  "rtype",
]);

/** "20261031T120000Z" (Taskwarrior's format) or an ISO string → Date. */
export function parseTwDate(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : new Date(value);
  return isNaN(d.getTime()) ? undefined : d;
}

/** The JSON array printed by `task export`, tolerating hook messages around it and one object per line (old `json.array=off`). */
export function parseExport(output: string): Task[] {
  const text = output.trim();
  if (!text) return [];
  let raw: unknown;
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  try {
    raw = start >= 0 && end > start ? JSON.parse(text.slice(start, end + 1)) : undefined;
  } catch {
    raw = undefined;
  }
  if (!Array.isArray(raw)) {
    raw = text.split("\n").map((line) => line.trim().replace(/,$/, "")).filter((l) => l.startsWith("{")).flatMap(
      (l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      },
    );
  }
  return (raw as unknown[]).filter((t): t is Record<string, unknown> => !!t && typeof t === "object").map(toTask)
    .filter((t) => t.uuid);
}

function toTask(o: Record<string, unknown>): Task {
  const depends = Array.isArray(o.depends)
    ? o.depends.map(String)
    : typeof o.depends === "string" && o.depends
    ? o.depends.split(",")
    : [];
  const udas: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    if (!KNOWN.has(k) && (typeof v === "string" || typeof v === "number")) udas[k] = String(v);
  }
  const priority = typeof o.priority === "string" && /^[HML]$/.test(o.priority)
    ? o.priority as Task["priority"]
    : undefined;
  return {
    id: typeof o.id === "number" ? o.id : 0,
    uuid: String(o.uuid ?? ""),
    description: String(o.description ?? ""),
    status: (String(o.status ?? "pending")) as Task["status"],
    project: typeof o.project === "string" && o.project ? o.project : undefined,
    tags: Array.isArray(o.tags) ? o.tags.map(String) : [],
    priority,
    urgency: typeof o.urgency === "number" ? o.urgency : 0,
    entry: parseTwDate(o.entry),
    modified: parseTwDate(o.modified),
    due: parseTwDate(o.due),
    scheduled: parseTwDate(o.scheduled),
    wait: parseTwDate(o.wait),
    until: parseTwDate(o.until),
    start: parseTwDate(o.start),
    end: parseTwDate(o.end),
    recur: typeof o.recur === "string" ? o.recur : undefined,
    depends,
    annotations: Array.isArray(o.annotations)
      ? o.annotations.filter((a) => a && typeof a === "object").map((a) => ({
        entry: parseTwDate(a.entry),
        description: String(a.description ?? ""),
      }))
      : [],
    udas,
  };
}

/** Hidden until its wait date: status "waiting" (≤ 2.5), or pending with a future wait (2.6+). */
export const isWaiting = (t: Task, now: Date) => t.status === "waiting" || (!!t.wait && t.wait > now);

/** Tasks a `depends` points to that are still open. */
export function blockedBy(t: Task, open: Map<string, Task>): Task[] {
  return t.depends.map((u) => open.get(u)).filter((d): d is Task => !!d);
}

/** Highest urgency first, then due date, then id (Taskwarrior's `next` report order). */
export function sortByUrgency(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) =>
    b.urgency - a.urgency ||
    (a.due?.getTime() ?? Infinity) - (b.due?.getTime() ?? Infinity) ||
    a.id - b.id
  );
}

// --- Dates -------------------------------------------------------------------

const DAY = 86_400_000;
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Whole local days from `now` to `date`: 0 today, 1 tomorrow, -2 two days ago. */
export const daysFrom = (date: Date, now: Date) =>
  Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / DAY);

/** "today", "tomorrow", "yesterday", "in 3d", "5d ago", "Nov 12". */
export function relativeDay(date: Date, now: Date): string {
  const d = daysFrom(date, now);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d > 1 && d < 14) return `in ${d}d`;
  if (d < -1 && d > -14) return `${-d}d ago`;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}

/** A date with its time unless it is midnight or 23:59 (Taskwarrior's `eod`). */
export function longDate(date: Date): string {
  const day = date.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
  const h = date.getHours(), m = date.getMinutes();
  if ((h === 0 && m === 0) || (h === 23 && m === 59)) return day;
  return `${day}, ${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export type DueState = "overdue" | "today" | "soon" | "later" | undefined;

/** Overdue (past its time), due today, due in the next 7 days, or later. */
export function dueState(t: Task, now: Date): DueState {
  if (!t.due) return undefined;
  if (t.due < now) return "overdue";
  const d = daysFrom(t.due, now);
  return d === 0 ? "today" : d <= 7 ? "soon" : "later";
}

/** "2 overdue · 3 due today", for the root search; undefined when nothing is pressing. */
export function dueSummary(tasks: Task[], now: Date): string | undefined {
  const pending = tasks.filter((t) => t.status === "pending" && !isWaiting(t, now));
  const overdue = pending.filter((t) => dueState(t, now) === "overdue").length;
  const today = pending.filter((t) => dueState(t, now) === "today").length;
  const active = pending.filter((t) => t.start).length;
  const parts = [
    overdue ? `${overdue} overdue` : "",
    today ? `${today} due today` : "",
    active ? `${active} active` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

/** "5m", "2h 10m", "3d": how long a task has been started. */
export function elapsed(since: Date, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 60_000));
  if (min < 60) return `${min}m`;
  if (min < 24 * 60) return `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}`;
  return `${Math.floor(min / 1440)}d`;
}

// --- Filters -----------------------------------------------------------------

/** The most used projects (top level) and tags, for the filter chips. */
export function topLabels(tasks: Task[], limit = 6): { projects: string[]; tags: string[] } {
  const count = (values: string[]) => {
    const m = new Map<string, number>();
    for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([v]) => v);
  };
  return {
    projects: count(tasks.flatMap((t) => t.project ? [t.project.split(".")[0]] : [])),
    tags: count(tasks.flatMap((t) => t.tags)),
  };
}

/** Whether a pending task belongs in a filter chip: all, due, active, waiting, project:X or +tag. */
export function matchesFilter(t: Task, filter: string | undefined, now: Date): boolean {
  const waiting = isWaiting(t, now);
  if (filter === "waiting") return waiting;
  if (waiting) return false;
  if (!filter || filter === "all") return true;
  if (filter === "due") {
    const s = dueState(t, now);
    return s === "overdue" || s === "today" || s === "soon";
  }
  if (filter === "active") return !!t.start;
  if (filter.startsWith("project:")) {
    const p = filter.slice(8);
    return t.project === p || !!t.project?.startsWith(`${p}.`);
  }
  if (filter.startsWith("+")) return t.tags.includes(filter.slice(1));
  return true;
}

// --- Command lines -----------------------------------------------------------

/** Options for every call: no prompt, no color, no chatter. */
export const BASE = ["rc.confirmation=off", "rc.color=off", "rc.recurrence.confirmation=no"];

/** Arguments of `task export` for a filter chip. */
export function exportArgs(filter: string | undefined, now: Date): string[] {
  if (filter === "done") {
    const since = new Date(now.getTime() - 14 * DAY);
    return [
      ...BASE,
      "rc.verbose=nothing",
      "rc.json.array=on",
      "status:completed",
      `end.after:${isoDay(since)}`,
      "export",
    ];
  }
  return [
    ...BASE,
    "rc.verbose=nothing",
    "rc.json.array=on",
    "(",
    "status:pending",
    "or",
    "status:waiting",
    ")",
    "export",
  ];
}

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Splits a quick-add line into Taskwarrior words, keeping "quoted parts"
 * together: `Call "Bob Smith" project:Home due:fri +phone`.
 */
export function splitWords(input: string): string[] {
  const words: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of input.matchAll(re)) words.push(m[1] ?? m[2] ?? m[3]);
  return words.filter((w) => w !== "");
}

/** `task add` arguments; the attributes typed (project:, due:, +tag, priority:) are read by Taskwarrior. */
export function addArgs(input: string): string[] {
  const words = splitWords(input.trim());
  if (!words.length) {
    throw new Error("Type the task after the command, e.g. “Buy milk project:Home due:tomorrow +shop”");
  }
  return [...BASE, "rc.verbose=new-id,new-uuid", "add", ...words];
}

/** "Created task 42." / "Created task 3f2a… (recurrence template)." → 42 or the uuid. */
export function createdId(output: string): string | undefined {
  return output.match(/Created task ([0-9a-f]{8}-[0-9a-f-]{27})/)?.[1] ?? output.match(/Created task (\d+)/)?.[1];
}

export interface Edit {
  description: string;
  project: string;
  tags: string;
  priority: string;
  due: string;
}

export function editValues(t: Task): Edit {
  return {
    description: t.description,
    project: t.project ?? "",
    tags: t.tags.join(" "),
    priority: t.priority ?? "",
    due: t.due ? twDateInput(t.due) : "",
  };
}

/** A date written back as Taskwarrior reads it: "2026-11-02", or "2026-11-02T14:30" when it has a time. */
export function twDateInput(d: Date): string {
  const h = d.getHours(), m = d.getMinutes();
  if ((h === 0 && m === 0) || (h === 23 && m === 59)) return isoDay(d);
  return `${isoDay(d)}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const tagList = (text: string) => [...new Set(text.split(/[\s,]+/).map((t) => t.replace(/^\+/, "")).filter(Boolean))];

/** `task <uuid> modify …` arguments for the changes made in the form; empty when nothing changed. */
export function modifyArgs(t: Task, values: Edit): string[] {
  const before = editValues(t);
  const args: string[] = [];
  const project = values.project.trim();
  if (project !== before.project) args.push(`project:${project}`);
  const priority = values.priority.trim().toUpperCase();
  if (priority !== before.priority) {
    if (priority && !/^[HML]$/.test(priority)) throw new Error("Priority is H, M, L or empty");
    args.push(`priority:${priority}`);
  }
  const due = values.due.trim();
  if (due !== before.due) {
    if (/\s/.test(due)) throw new Error("Write the due date without spaces: 2026-11-02, fri, eow, tomorrow, 3d");
    args.push(`due:${due}`);
  }
  const oldTags = new Set(t.tags), newTags = tagList(values.tags);
  for (const tag of newTags) if (!oldTags.has(tag)) args.push(`+${tag}`);
  for (const tag of oldTags) if (!newTags.includes(tag)) args.push(`-${tag}`);
  const description = values.description.trim();
  if (!description) throw new Error("The task needs a description");
  if (description !== t.description) args.push("--", description);
  return args.length ? [...BASE, "rc.verbose=nothing", t.uuid, "modify", ...args] : [];
}

/** `task <uuid> <verb> [words]` with the base options; `--` keeps text literal. */
export function taskArgs(uuid: string, verb: string, ...words: string[]): string[] {
  return [...BASE, "rc.verbose=nothing", uuid, verb, ...(words.length ? ["--", ...words] : [])];
}

// --- Reports -----------------------------------------------------------------

export interface Report {
  name: string;
  description: string;
}

/**
 * The table printed by `task reports`:
 *
 * ```
 * Report      Description
 * ----------- ---------------------------
 * active      Active tasks
 * ...
 * 21 reports
 * ```
 */
export function parseReports(output: string): Report[] {
  const reports: Report[] = [];
  for (const line of output.split("\n")) {
    const m = line.match(/^([a-z][\w.-]*)\s{2,}(\S.*?)\s*$/i);
    if (!m || /^Report$/i.test(m[1])) continue;
    if (/^\d+ reports?$/.test(line.trim())) continue;
    reports.push({ name: m[1], description: m[2] });
  }
  return reports;
}

/** Reports listed first, the ones people open most. */
export const FAVORITE_REPORTS = ["next", "active", "overdue", "ready", "waiting", "completed", "recurring", "summary"];

/** Reports that are not task lists but are worth showing too (they don't appear in `task reports`). */
export const EXTRA_REPORTS: Report[] = [
  { name: "summary", description: "Projects with their remaining tasks and progress" },
  { name: "projects", description: "Projects with their number of tasks" },
  { name: "tags", description: "Tags with their number of tasks" },
  { name: "burndown.weekly", description: "Burndown chart by week" },
  { name: "history.monthly", description: "Tasks added, completed and deleted per month" },
  { name: "ghistory.monthly", description: "History per month, as a chart" },
  { name: "calendar", description: "This month with due dates" },
  { name: "stats", description: "Statistics about your tasks" },
];

export function sortReports(reports: Report[]): Report[] {
  const seen = new Set<string>();
  const all = [...reports, ...EXTRA_REPORTS].filter((r) => !seen.has(r.name) && seen.add(r.name));
  const rank = (r: Report) => {
    const i = FAVORITE_REPORTS.indexOf(r.name);
    return i < 0 ? 100 : i;
  };
  return all.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** Arguments to print a report as plain text for the preview. */
export function reportArgs(name: string, width = 110): string[] {
  return [
    "rc.color=off",
    "rc._forcecolor=off",
    "rc.detection=off",
    `rc.defaultwidth=${width}`,
    "rc.defaultheight=0",
    "rc.hooks=off",
    "rc.confirmation=off",
    name,
  ];
}

/** Keeps a report readable in the preview: no trailing spaces, no ANSI codes, a bounded length. */
export function cleanReport(output: string, maxLines = 120): string {
  // deno-lint-ignore no-control-regex
  const lines = output.replace(/\x1b\[[0-9;]*m/g, "").split("\n").map((l) => l.trimEnd());
  while (lines.length && !lines[0]) lines.shift();
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) shown.push(`… ${lines.length - maxLines} more lines`);
  return shown.join("\n").replace(/```/g, "'''");
}

// --- Display -----------------------------------------------------------------

export const priorityLabel = (p?: string) => p === "H" ? "High" : p === "M" ? "Medium" : p === "L" ? "Low" : "None";

/** Escapes what the preview's markdown would read as formatting. */
export const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]#<>]/g, "\\$&");

/** The preview: the description and annotations, newest last, as `task info` shows them. */
export function taskMarkdown(t: Task, blockers: Task[], now: Date): string {
  const lines = [`### ${escapeMarkdown(t.description)}`];
  if (blockers.length) {
    lines.push(
      "",
      "**Blocked by**",
      ...blockers.map((b) => `- ${b.id ? `${b.id}: ` : ""}${escapeMarkdown(b.description)}`),
    );
  }
  if (t.annotations.length) {
    lines.push("", "**Annotations**");
    for (const a of t.annotations) {
      lines.push(`- ${escapeMarkdown(a.description)}${a.entry ? ` _(${relativeDay(a.entry, now)})_` : ""}`);
    }
  }
  return lines.join("\n");
}
