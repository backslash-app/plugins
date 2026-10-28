// The todo.txt format (http://todotxt.org): parsing, writing, dates,
// recurrence and the views of a task list. Pure functions, no I/O.

export interface Task {
  /** The line as found in the file (without the line break). */
  raw: string;
  done: boolean;
  /** YYYY-MM-DD */
  completed?: string;
  created?: string;
  /** "A"…"Z"; for completed tasks, taken from `pri:A` when the priority was moved there. */
  priority?: string;
  /** Everything after the completion mark, dates and priority. */
  text: string;
  /** The words of `text` without +projects, @contexts and key:value pairs. */
  title: string;
  projects: string[];
  contexts: string[];
  /** key:value pairs, keys lowercased (`due`, `t`, `rec`, `pri`, …). */
  tags: Record<string, string>;
  due?: string;
  threshold?: string;
  rec?: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s: string): boolean => DATE_RE.test(s) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);
export const isDate = (s: string | undefined): s is string => {
  try {
    return !!s && validDate(s);
  } catch {
    return false;
  }
};

/** `due:2026-10-01`, `rec:+1w`, never URLs (`https://…`) nor times (`10:30`). */
export function keyValue(word: string): [string, string] | undefined {
  const m = /^([^\s:]+):([^\s:]+)$/.exec(word);
  if (!m || m[2].startsWith("//") || /^\d+$/.test(m[1])) return undefined;
  return [m[1].toLowerCase(), m[2]];
}

export function parseTask(raw: string): Task {
  let rest = raw.trim();
  const take = (re: RegExp): string | undefined => {
    const m = re.exec(rest);
    if (!m) return undefined;
    rest = rest.slice(m[0].length);
    return m[1];
  };
  const DATE = /^(\d{4}-\d{2}-\d{2})(?:\s+|$)/;
  const PRI = /^\(([A-Z])\)(?:\s+|$)/;
  let done = false;
  let completed: string | undefined;
  let created: string | undefined;
  let priority: string | undefined;
  if (/^x(\s|$)/.test(rest)) {
    done = true;
    rest = rest.slice(1).trimStart();
    completed = take(DATE);
    // Lenient: some apps keep the priority before or after the dates.
    priority = take(PRI);
    if (completed) created = take(DATE);
    priority ??= take(PRI);
  } else {
    priority = take(PRI);
    created = take(DATE);
  }
  const text = rest.trim();
  const projects: string[] = [];
  const contexts: string[] = [];
  const tags: Record<string, string> = {};
  const words: string[] = [];
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (/^\+\S+$/.test(word)) {
      if (!projects.includes(word.slice(1))) projects.push(word.slice(1));
    } else if (/^@\S+$/.test(word)) {
      if (!contexts.includes(word.slice(1))) contexts.push(word.slice(1));
    } else {
      const kv = keyValue(word);
      if (kv) tags[kv[0]] = kv[1];
      else words.push(word);
    }
  }
  if (done && !priority && /^[A-Z]$/.test(tags.pri ?? "")) priority = tags.pri;
  return {
    raw,
    done,
    completed: isDate(completed) ? completed : undefined,
    created: isDate(created) ? created : undefined,
    priority,
    text,
    title: words.join(" ") || text,
    projects,
    contexts,
    tags,
    due: isDate(tags.due) ? tags.due : undefined,
    threshold: isDate(tags.t) ? tags.t : undefined,
    rec: tags.rec,
  };
}

/** Lines of a file: blank lines dropped, `\r` removed. */
export function parseFile(content: string): Task[] {
  return content.split("\n").map((l) => l.replace(/\r$/, "")).filter((l) => l.trim()).map(parseTask);
}

export interface TaskParts {
  done?: boolean;
  completed?: string;
  created?: string;
  priority?: string;
  text: string;
}

/** Builds a line; for completed tasks the priority becomes `pri:X`, as todo.sh does. */
export function formatTask(p: TaskParts): string {
  const parts: string[] = [];
  let text = p.text.trim();
  if (p.done) {
    parts.push("x");
    if (p.completed) parts.push(p.completed);
    if (p.completed && p.created) parts.push(p.created);
    if (p.priority && !/(^|\s)pri:[A-Z](\s|$)/.test(text)) text = `${text} pri:${p.priority}`.trim();
  } else {
    if (p.priority) parts.push(`(${p.priority})`);
    if (p.created) parts.push(p.created);
  }
  if (text) parts.push(text);
  return parts.join(" ");
}

/** Replaces (or removes, with `undefined`) one key:value in a description. */
export function setTag(text: string, key: string, value: string | undefined): string {
  const words = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let set = false;
  for (const w of words) {
    const kv = keyValue(w);
    if (kv && kv[0] === key.toLowerCase()) {
      if (value !== undefined && !set) out.push(`${key}:${value}`);
      set = true;
    } else out.push(w);
  }
  if (!set && value !== undefined) out.push(`${key}:${value}`);
  return out.join(" ");
}

// --- Dates (calendar days, no time zone involved) ----------------------------

/** Local date as YYYY-MM-DD. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const toUtc = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Days from `a` to `b` (both YYYY-MM-DD). */
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);

export function addDays(iso: string, n: number): string {
  return fromUtc(toUtc(iso) + n * 86_400_000);
}

/** Months added with the day kept, or the month's last day (Jan 31 + 1m = Feb 28). */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(d, last));
  return first.toISOString().slice(0, 10);
}

/** 0 = Sunday. */
export const weekday = (iso: string) => new Date(toUtc(iso)).getUTCDay();

export function addBusinessDays(iso: string, n: number): string {
  let day = iso;
  let left = n;
  while (left > 0) {
    day = addDays(day, 1);
    if (weekday(day) !== 0 && weekday(day) !== 6) left--;
  }
  return day;
}

export interface Recurrence {
  /** `+`: from the due date (strict), else from the completion day. */
  strict: boolean;
  amount: number;
  unit: "d" | "b" | "w" | "m" | "y";
}

/** `rec:1w`, `rec:+2m`, `rec:3d`, `rec:5b` (business days), `rec:1y`; a bare `rec:w` means 1. */
export function parseRecurrence(value: string | undefined): Recurrence | undefined {
  const m = /^(\+)?(\d*)([dbwmy])$/i.exec(value ?? "");
  if (!m) return undefined;
  const amount = m[2] ? Number(m[2]) : 1;
  if (amount < 1) return undefined;
  return { strict: !!m[1], amount, unit: m[3].toLowerCase() as Recurrence["unit"] };
}

export function addInterval(iso: string, r: Pick<Recurrence, "amount" | "unit">): string {
  switch (r.unit) {
    case "d":
      return addDays(iso, r.amount);
    case "b":
      return addBusinessDays(iso, r.amount);
    case "w":
      return addDays(iso, 7 * r.amount);
    case "m":
      return addMonths(iso, r.amount);
    case "y":
      return addMonths(iso, 12 * r.amount);
  }
}

export function describeRecurrence(value: string | undefined): string | undefined {
  const r = parseRecurrence(value);
  if (!r) return value;
  const names = { d: "day", b: "business day", w: "week", m: "month", y: "year" };
  const every = r.amount === 1 ? `Every ${names[r.unit]}` : `Every ${r.amount} ${names[r.unit]}s`;
  return `${every}${r.strict ? ", from the due date" : ", from completion"}`;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/**
 * A date typed by a person: `2026-11-03`, `today`, `tomorrow`, `mon`…`sunday`
 * (the next one, never today), `3d`, `+2w`, `1m`, `1y`, `next week`.
 * Returns YYYY-MM-DD, or undefined if not understood.
 */
export function parseDateInput(input: string, today: string): string | undefined {
  const s = input.trim().toLowerCase();
  if (!s) return undefined;
  if (isDate(input.trim())) return s;
  if (["today", "tod", "now"].includes(s)) return today;
  if (["tomorrow", "tom", "tmr"].includes(s)) return addDays(today, 1);
  if (s === "yesterday") return addDays(today, -1);
  if (s === "next week") return addDays(today, 7);
  if (s === "next month") return addMonths(today, 1);
  const wd = s.length >= 3 ? WEEKDAYS.findIndex((w) => w.startsWith(s)) : -1;
  if (wd >= 0) {
    const diff = (wd - weekday(today) + 7) % 7 || 7;
    return addDays(today, diff);
  }
  const rel = /^\+?(\d+)\s*([dbwmy])$/.exec(s);
  if (rel) return addInterval(today, { amount: Number(rel[1]), unit: rel[2] as Recurrence["unit"] });
  return undefined;
}

/**
 * What `add` writes: relative `due:`/`t:` values made absolute
 * (`due:tomorrow` → `due:2026-10-29`) and, with `addCreated`, today's date
 * after the priority when the task has none.
 */
export function normalizeNewTask(input: string, today: string, addCreated: boolean): string {
  const t = parseTask(input.trim());
  let text = t.text;
  for (const key of ["due", "t"]) {
    const v = t.tags[key];
    if (v && !isDate(v)) {
      const d = parseDateInput(v, today);
      if (d) text = setTag(text, key, d);
    }
  }
  if (t.done) return formatTask({ ...t, text, completed: t.completed ?? today });
  return formatTask({ priority: t.priority, created: t.created ?? (addCreated ? today : undefined), text });
}

// --- Completing, with recurrence ---------------------------------------------

export interface Completion {
  /** The completed line. */
  done: string;
  /** The next occurrence of a `rec:` task, to add to the list. */
  next?: string;
}

export function completeTask(task: Task, today: string): Completion {
  const done = formatTask({
    done: true,
    completed: today,
    created: task.created,
    priority: task.priority,
    text: task.text,
  });
  const r = parseRecurrence(task.rec);
  if (!r) return { done };
  let text = task.text;
  if (task.due) {
    const due = addInterval(r.strict ? task.due : today, r);
    text = setTag(text, "due", due);
    // The threshold keeps its distance to the due date.
    if (task.threshold) text = setTag(text, "t", addDays(due, -daysBetween(task.threshold, task.due)));
  } else if (task.threshold) {
    text = setTag(text, "t", addInterval(r.strict ? task.threshold : today, r));
  } else {
    text = setTag(text, "due", addInterval(today, r));
  }
  const next = formatTask({ priority: task.priority, created: task.created ? today : undefined, text });
  return { done, next };
}

/** Back to an open task: the completion mark and date go, `pri:X` becomes the priority again. */
export function uncompleteTask(task: Task): string {
  const pri = task.tags.pri && /^[A-Z]$/.test(task.tags.pri) ? task.tags.pri : task.priority;
  return formatTask({ priority: pri, created: task.created, text: setTag(task.text, "pri", undefined) });
}

export function setPriority(task: Task, priority: string | undefined): string {
  if (task.done) {
    return formatTask({ ...task, priority: undefined, text: setTag(task.text, "pri", priority) });
  }
  return formatTask({ priority, created: task.created, text: task.text });
}

export function setDue(task: Task, due: string | undefined): string {
  return formatTask({ ...task, text: setTag(task.text, "due", due) });
}

// --- Editing -----------------------------------------------------------------

export interface EditValues {
  description: string;
  priority: string;
  due: string;
  threshold: string;
  rec: string;
}

/** The form's fields for a task: the dates and recurrence apart from the description. */
export function editValues(task: Task): EditValues {
  let description = task.text;
  for (const key of ["due", "t", "rec"]) description = setTag(description, key, undefined);
  if (task.done) description = setTag(description, "pri", undefined);
  return {
    description,
    priority: task.priority ?? "",
    due: task.tags.due ?? "",
    threshold: task.tags.t ?? "",
    rec: task.tags.rec ?? "",
  };
}

/** Builds the line from the form; throws a readable error on a bad date or recurrence. */
export function applyEdit(task: Task | undefined, v: EditValues, today: string, addCreated: boolean): string {
  const description = v.description.trim().replace(/\s+/g, " ");
  if (!description) throw new Error("The task needs a description");
  const date = (label: string, s: string) => {
    if (!s.trim()) return undefined;
    const d = parseDateInput(s, today);
    if (!d) throw new Error(`${label}: “${s}” is not a date (2026-11-03, tomorrow, fri, 3d…)`);
    return d;
  };
  const rec = v.rec.trim();
  if (rec && !parseRecurrence(rec)) throw new Error(`Recurrence: “${rec}” is not valid (1d, 2w, +1m, 1y, 5b)`);
  const priority = v.priority.trim().toUpperCase();
  if (priority && !/^[A-Z]$/.test(priority)) throw new Error("Priority: a letter from A to Z");
  // A description typed with its own due:/t:/rec: wins over empty fields.
  const typed = parseTask(description);
  let text = description;
  const due = date("Due", v.due) ?? (typed.tags.due ? date("Due", typed.tags.due) : undefined);
  const t = date("Threshold", v.threshold) ?? (typed.tags.t ? date("Threshold", typed.tags.t) : undefined);
  text = setTag(text, "due", due);
  text = setTag(text, "t", t);
  if (rec) text = setTag(text, "rec", rec);
  if (!task) return formatTask({ priority: priority || undefined, created: addCreated ? today : undefined, text });
  return formatTask({
    done: task.done,
    completed: task.completed,
    created: task.created,
    priority: priority || undefined,
    text,
  });
}

// --- Views -------------------------------------------------------------------

export type Section = "Overdue" | "Today" | "Upcoming" | "No Date" | "Completed";
export const SECTIONS: Section[] = ["Overdue", "Today", "Upcoming", "No Date", "Completed"];

export function sectionOf(task: Task, today: string): Section {
  if (task.done) return "Completed";
  if (task.due) {
    const d = daysBetween(today, task.due);
    return d < 0 ? "Overdue" : d === 0 ? "Today" : "Upcoming";
  }
  // Not before a future threshold date: it is planned, so "Upcoming".
  if (task.threshold && daysBetween(today, task.threshold) > 0) return "Upcoming";
  return "No Date";
}

const priRank = (t: Task) => t.priority ? t.priority.charCodeAt(0) - 65 : 26;

/** By section, then due date, then priority, then the order in the file. */
export function sortTasks<T extends { task: Task; index: number }>(rows: T[], today: string): T[] {
  return [...rows].sort((a, b) => {
    const sa = SECTIONS.indexOf(sectionOf(a.task, today));
    const sb = SECTIONS.indexOf(sectionOf(b.task, today));
    if (sa !== sb) return sa - sb;
    if (a.task.done && b.task.done) {
      return (b.task.completed ?? "").localeCompare(a.task.completed ?? "") || b.index - a.index;
    }
    const da = a.task.due ?? a.task.threshold ?? "9999";
    const db = b.task.due ?? b.task.threshold ?? "9999";
    return da.localeCompare(db) || priRank(a.task) - priRank(b.task) || a.index - b.index;
  });
}

/** `today`, `tomorrow`, `yesterday`, `in 3 days`, `2 days ago`, then `Nov 14`. */
export function relativeDay(iso: string, today: string): string {
  const d = daysBetween(today, iso);
  if (d === 0) return "today";
  if (d === 1) return "tomorrow";
  if (d === -1) return "yesterday";
  if (d > 1 && d < 7) return `in ${d} days`;
  if (d < -1 && d > -14) return `${-d} days ago`;
  const date = new Date(toUtc(iso));
  const sameYear = iso.slice(0, 4) === today.slice(0, 4);
  return date.toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
    timeZone: "UTC",
  });
}

export function longDate(iso: string): string {
  return new Date(toUtc(iso)).toLocaleDateString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export type Tint = "red" | "orange" | "yellow" | "blue" | "green" | "gray" | "purple" | "teal";

export function priorityColor(p: string | undefined): Tint {
  if (!p) return "gray";
  return ({ A: "red", B: "orange", C: "yellow" } as Record<string, Tint>)[p] ?? "blue";
}

/** Filter chips: `all`, `due`, `pri`, `done`, `+project`, `@context`. */
export function matchesFilter(task: Task, filter: string | undefined, today: string): boolean {
  if (!filter || filter === "all") return !task.done;
  if (filter === "done") return task.done;
  if (task.done) return false;
  if (filter === "due") return !!task.due && daysBetween(today, task.due) <= 7;
  if (filter === "pri") return !!task.priority;
  if (filter.startsWith("+")) return task.projects.some((p) => p.toLowerCase() === filter.slice(1).toLowerCase());
  if (filter.startsWith("@")) return task.contexts.some((c) => c.toLowerCase() === filter.slice(1).toLowerCase());
  return true;
}

/** The most used projects and contexts of the open tasks, for the filter chips. */
export function topLabels(tasks: Task[], max = 6): { projects: string[]; contexts: string[] } {
  const count = (pick: (t: Task) => string[]) => {
    const n = new Map<string, number>();
    for (const t of tasks) if (!t.done) { for (const x of pick(t)) n.set(x, (n.get(x) ?? 0) + 1); }
    return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([k]) => k);
  };
  return { projects: count((t) => t.projects), contexts: count((t) => t.contexts).slice(0, Math.ceil(max / 2)) };
}

/** "3 overdue · 2 due today", or undefined when nothing is due. */
export function dueSummary(tasks: Task[], today: string): string | undefined {
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => sectionOf(t, today) === "Overdue").length;
  const due = open.filter((t) => sectionOf(t, today) === "Today").length;
  const parts = [overdue ? `${overdue} overdue` : "", due ? `${due} due today` : ""].filter(Boolean);
  return parts.length ? parts.join(" · ") : undefined;
}

// --- Files -------------------------------------------------------------------

/**
 * Replaces the first line equal to `old` by `replacement` (removed when
 * empty), or appends `replacement` when `old` is undefined. Keeps the file's
 * line endings and its final line break. Returns undefined when `old` is not
 * there any more (the file changed meanwhile).
 */
export function replaceLine(
  content: string,
  old: string | undefined,
  replacement: string[],
): string | undefined {
  const eol = content.includes("\r\n") ? "\r\n" : "\n";
  const lines = content === "" ? [] : content.split(/\r?\n/);
  const trailing = lines.length > 0 && lines[lines.length - 1] === "";
  if (trailing) lines.pop();
  if (old === undefined) {
    lines.push(...replacement);
  } else {
    const i = lines.findIndex((l) => l.trimEnd() === old.trimEnd());
    if (i < 0) return undefined;
    lines.splice(i, 1, ...replacement);
  }
  return lines.length ? lines.join(eol) + eol : "";
}

/** `~/x` → `/home/me/x`. */
export function expandHome(path: string, home: string): string {
  return path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
}

export function tildify(path: string, home: string): string {
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export const dirname = (path: string) => path.replace(/\/[^/]*$/, "") || "/";
