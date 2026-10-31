// Habits, check-ins, streaks and the heatmap, without the launcher.

export interface Habit {
  id: string;
  name: string;
  frequency: "daily" | "weekly";
  /** Days of the week a daily habit is due (0 = Sunday … 6 = Saturday); all when missing. */
  days?: number[];
  /** Check-ins a day (daily) or days a week (weekly) that count as done. */
  target: number;
  /** YYYY-MM-DD */
  created: string;
  /** Check-ins by day: { "2026-10-28": 1 }. */
  checks: Record<string, number>;
  archived?: boolean;
  /** A linked Habitica task, scored when checking in. */
  habitica?: { id: string; type: string; text?: string };
}

// --- Days --------------------------------------------------------------------

export const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const addDays = (day: string, n: number) => {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return isoDay(d);
};

export const weekday = (day: string) => parseDay(day).getDay();

/** The Monday of the week of `day`. */
export const weekStart = (day: string) => addDays(day, -((weekday(day) + 6) % 7));

export const daysBetween = (a: string, b: string) =>
  Math.round((parseDay(b).getTime() - parseDay(a).getTime()) / 86_400_000);

const NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const FR = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * "mon-fri", "weekdays", "weekends", "mon, wed, fri", "lun-ven", "" (every day) →
 * days of the week, Sunday = 0. Throws on words it doesn't know.
 */
export function parseDays(text: string): number[] | undefined {
  const t = text.trim().toLowerCase();
  if (!t || /^(every ?day|daily|all|tous les jours)$/.test(t)) return undefined;
  if (/^(weekdays?|work ?days?|semaine|en semaine)$/.test(t)) return [1, 2, 3, 4, 5];
  if (/^(weekends?|week-ends?)$/.test(t)) return [0, 6];
  const index = (w: string) => {
    const k = w.slice(0, 3);
    const i = NAMES.indexOf(k) >= 0 ? NAMES.indexOf(k) : FR.indexOf(k);
    if (i < 0) throw new Error(`“${w}” is not a day: write days like mon-fri or mon, wed, fri`);
    return i;
  };
  const out = new Set<number>();
  for (const part of t.split(/[\s,;]+/).filter(Boolean)) {
    const range = part.split(/[-–]/);
    if (range.length === 2) {
      let i = index(range[0]);
      const end = index(range[1]);
      for (let guard = 0; guard < 7; guard++) {
        out.add(i);
        if (i === end) break;
        i = (i + 1) % 7;
      }
    } else out.add(index(part));
  }
  const days = [...out].sort((a, b) => a - b);
  return days.length === 7 ? undefined : days;
}

/** [1,2,3,4,5] → "Mon–Fri", [1,3,5] → "Mon, Wed, Fri", [0,6] → "Weekends". */
export function describeDays(days?: number[]): string {
  if (!days || days.length === 7) return "Every day";
  const set = [...days].sort((a, b) => a - b);
  if (set.join() === "1,2,3,4,5") return "Mon–Fri";
  if (set.join() === "0,6") return "Weekends";
  // A run of days, wrapping around the week ("Fri–Mon"), else a list from Monday.
  const has = new Set(set);
  const start = set.find((d) => !has.has((d + 6) % 7));
  if (set.length > 2 && start !== undefined && set.every((_, i) => has.has((start + i) % 7))) {
    return `${SHORT[start]}–${SHORT[(start + set.length - 1) % 7]}`;
  }
  const ordered = [...set.filter((d) => d > 0), ...set.filter((d) => d === 0)];
  return ordered.map((d) => SHORT[d]).join(", ");
}

/** "Every day", "Mon–Fri", "Twice a day", "3× a week". */
export function describeFrequency(h: Habit): string {
  if (h.frequency === "weekly") return h.target === 1 ? "Once a week" : `${h.target}× a week`;
  const days = describeDays(h.days);
  return h.target > 1 ? `${h.target}× a day, ${days.toLowerCase()}` : days;
}

// --- Check-ins and streaks ---------------------------------------------------

export const isScheduled = (h: Habit, day: string) =>
  h.frequency === "weekly" || !h.days || h.days.includes(weekday(day));

export const count = (h: Habit, day: string) => h.checks[day] ?? 0;

/** Done that day: the daily target reached, or any check-in for a weekly habit. */
export const doneOn = (h: Habit, day: string) => count(h, day) >= (h.frequency === "daily" ? h.target : 1);

/** Days with a check-in in the week starting on Monday `monday`. */
export function weekCount(h: Habit, monday: string): number {
  let n = 0;
  for (let i = 0; i < 7; i++) if (count(h, addDays(monday, i)) > 0) n++;
  return n;
}

const firstDay = (h: Habit) => {
  const days = Object.keys(h.checks).filter((d) => h.checks[d] > 0).sort();
  return days[0] && days[0] < h.created ? days[0] : h.created;
};

/**
 * Current streak, in scheduled days (daily) or weeks (weekly). Today not done
 * yet doesn't break it: the streak is still alive until the day is over.
 */
export function streak(h: Habit, today: string): number {
  const start = firstDay(h);
  if (h.frequency === "weekly") {
    let monday = weekStart(today);
    if (weekCount(h, monday) < h.target) monday = addDays(monday, -7);
    let n = 0;
    while (monday >= weekStart(start) && weekCount(h, monday) >= h.target) {
      n++;
      monday = addDays(monday, -7);
    }
    return n;
  }
  let day = today;
  if (isScheduled(h, day) && !doneOn(h, day)) day = addDays(day, -1);
  let n = 0;
  for (; day >= start; day = addDays(day, -1)) {
    if (!isScheduled(h, day)) continue;
    if (!doneOn(h, day)) break;
    n++;
  }
  return n;
}

/** The longest streak ever. */
export function bestStreak(h: Habit, today: string): number {
  const start = firstDay(h);
  let best = 0, run = 0;
  if (h.frequency === "weekly") {
    for (let monday = weekStart(start); monday <= today; monday = addDays(monday, 7)) {
      run = weekCount(h, monday) >= h.target ? run + 1 : 0;
      best = Math.max(best, run);
    }
    return best;
  }
  for (let day = start; day <= today; day = addDays(day, 1)) {
    if (!isScheduled(h, day)) continue;
    if (doneOn(h, day)) run++;
    else if (day !== today) run = 0;
    best = Math.max(best, run);
  }
  return best;
}

/** Share of the last `days` days (or weeks for a weekly habit) that were done, from its creation; today only when done. */
export function completionRate(h: Habit, today: string, days = 30): number {
  const start = firstDay(h);
  if (h.frequency === "weekly") {
    const weeks = Math.max(1, Math.round(days / 7));
    let met = 0, total = 0;
    for (let i = 0; i < weeks; i++) {
      const monday = addDays(weekStart(today), -7 * i);
      if (addDays(monday, 6) < start) break;
      const ok = weekCount(h, monday) >= h.target;
      if (i === 0 && !ok) continue; // this week is not over
      total++;
      if (ok) met++;
    }
    return total ? met / total : 0;
  }
  let done = 0, total = 0;
  for (let i = 0; i < days; i++) {
    const day = addDays(today, -i);
    if (day < start) break;
    if (!isScheduled(h, day)) continue;
    const ok = doneOn(h, day);
    if (i === 0 && !ok) continue;
    total++;
    if (ok) done++;
  }
  return total ? done / total : 0;
}

export const totalCheckIns = (h: Habit) => Object.values(h.checks).reduce((s, n) => s + n, 0);

export function lastCheckIn(h: Habit): string | undefined {
  return Object.keys(h.checks).filter((d) => h.checks[d] > 0).sort().pop();
}

export type State = "todo" | "done" | "rest";

/** Today: still to do, done (daily target or weekly goal reached), or a rest day. */
export function stateToday(h: Habit, today: string): State {
  if (h.frequency === "weekly") return weekCount(h, weekStart(today)) >= h.target ? "done" : "todo";
  if (!isScheduled(h, today)) return "rest";
  return doneOn(h, today) ? "done" : "todo";
}

/** "3 of 5 done today", for the root search. */
export function todaySummary(habits: Habit[], today: string): string | undefined {
  const due = habits.filter((h) => !h.archived && stateToday(h, today) !== "rest");
  if (!due.length) return undefined;
  const done = due.filter((h) => stateToday(h, today) === "done").length;
  return done === due.length ? `All ${due.length} done today` : `${done} of ${due.length} done today`;
}

/** One more check-in that day (up to the daily target, or one for a weekly habit). */
export function checkIn(h: Habit, day: string): Habit {
  const max = h.frequency === "daily" ? Math.max(1, h.target) : 1;
  return { ...h, checks: { ...h.checks, [day]: Math.min(max, count(h, day) + 1) } };
}

/** Removes that day's check-ins. */
export function uncheck(h: Habit, day: string): Habit {
  const checks = { ...h.checks };
  delete checks[day];
  return { ...h, checks };
}

/** Today's main action: check in, or undo when there is nothing more to check. */
export function toggleToday(h: Habit, day: string): { habit: Habit; checked: boolean } {
  const max = h.frequency === "daily" ? Math.max(1, h.target) : 1;
  return count(h, day) >= max ? { habit: uncheck(h, day), checked: false } : { habit: checkIn(h, day), checked: true };
}

/** Sorting: to do first, then done, then rest days; by name. */
export function sortHabits(habits: Habit[], today: string): Habit[] {
  const rank: Record<State, number> = { todo: 0, done: 1, rest: 2 };
  return [...habits].sort((a, b) =>
    Number(!!a.archived) - Number(!!b.archived) ||
    rank[stateToday(a, today)] - rank[stateToday(b, today)] ||
    a.name.localeCompare(b.name)
  );
}

/** The habit a typed name means: exact, then prefix, then contained, ignoring case and accents. */
export function findHabit(habits: Habit[], name: string): Habit | undefined {
  const norm = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const q = norm(name);
  if (!q) return undefined;
  const open = habits.filter((h) => !h.archived);
  return open.find((h) => norm(h.name) === q) ?? open.find((h) => norm(h.name).startsWith(q)) ??
    open.find((h) => norm(h.name).includes(q));
}

// --- Heatmap -----------------------------------------------------------------

/**
 * A GitHub-style grid of the last `weeks` weeks, Monday on top, for the
 * preview (in a code block, so it lines up):
 *
 * ```
 *      Sep     Oct
 * Mon  ■ ■ □ ■ ■ ■
 * ```
 * ■ done, ▪ partly done, □ missed, · not due or before the habit, blank: the future.
 */
export function heatmap(h: Habit, today: string, weeks = 16): string {
  const first = addDays(weekStart(today), -7 * (weeks - 1));
  const start = firstDay(h);
  const months: string[] = [];
  let lastMonth = -1;
  for (let w = 0; w < weeks; w++) {
    const m = parseDay(addDays(first, 7 * w)).getMonth();
    months.push(m !== lastMonth ? parseDay(addDays(first, 7 * w)).toLocaleDateString("en-US", { month: "short" }) : "");
    lastMonth = m;
  }
  // Month names over two columns at most, without overlapping.
  let header = "    ";
  for (let w = 0; w < weeks; w++) {
    const label = months[w];
    if (label && header.length <= 4 + 2 * w) header = header.padEnd(4 + 2 * w) + label;
  }
  const rows = [header.trimEnd()];
  for (let r = 0; r < 7; r++) {
    const cells: string[] = [];
    for (let w = 0; w < weeks; w++) {
      const day = addDays(first, 7 * w + r);
      if (day > today) cells.push(" ");
      else if (day < start || !isScheduled(h, day)) cells.push(count(h, day) > 0 ? "■" : "·");
      else if (doneOn(h, day)) cells.push("■");
      else if (count(h, day) > 0) cells.push("▪");
      else cells.push(h.frequency === "weekly" ? "·" : "□");
    }
    rows.push(`${SHORT[(r + 1) % 7]} ${cells.join(" ")}`.trimEnd());
  }
  return rows.join("\n");
}

/** The last `n` days as small marks, oldest first: "■■□■■■■". */
export function lastDays(h: Habit, today: string, n = 7): string {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const day = addDays(today, -i);
    out.push(doneOn(h, day) ? "■" : count(h, day) > 0 ? "▪" : isScheduled(h, day) && day >= firstDay(h) ? "□" : "·");
  }
  return out.join("");
}

// --- Creating and editing ----------------------------------------------------

export interface HabitInput {
  name: string;
  frequency: string;
  days: string;
  target: string;
}

export function newId(now = Date.now(), random = Math.random()): string {
  return `${now.toString(36)}${Math.floor(random * 1e6).toString(36)}`;
}

/** A habit from the form, or the edited one. */
export function applyInput(input: HabitInput, today: string, existing?: Habit, id = newId()): Habit {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Give the habit a name");
  const frequency = input.frequency === "weekly" ? "weekly" : "daily";
  const target = input.target.trim() ? Number(input.target) : frequency === "weekly" ? 3 : 1;
  if (!Number.isInteger(target) || target < 1 || target > (frequency === "weekly" ? 7 : 20)) {
    throw new Error(
      frequency === "weekly" ? "Times a week is a number from 1 to 7" : "Times a day is a number from 1 to 20",
    );
  }
  const days = frequency === "daily" ? parseDays(input.days) : undefined;
  const base: Habit = existing ?? { id, name, frequency, target, created: today, checks: {} };
  const habit: Habit = { ...base, name, frequency, target };
  if (days) habit.days = days;
  else delete habit.days;
  return habit;
}

/** Storage can hold anything: keeps the well-formed habits only. */
export function sanitize(value: unknown): Habit[] {
  if (!Array.isArray(value)) return [];
  return value.filter((h): h is Habit =>
    !!h && typeof h === "object" && typeof h.id === "string" && typeof h.name === "string" &&
    (h.frequency === "daily" || h.frequency === "weekly")
  ).map((h) => ({
    ...h,
    target: Number.isInteger(h.target) && h.target > 0 ? h.target : 1,
    created: /^\d{4}-\d{2}-\d{2}$/.test(h.created) ? h.created : isoDay(new Date()),
    checks: h.checks && typeof h.checks === "object" ? h.checks : {},
  }));
}

// --- Habitica ----------------------------------------------------------------

export interface HabiticaTask {
  id: string;
  type: "daily" | "habit" | "todo" | "reward";
  text: string;
  completed?: boolean;
  isDue?: boolean;
  streak?: number;
  up?: boolean;
}

/** `GET /api/v3/tasks/user`: `{ success, data: [{ _id, type, text, completed, isDue, streak, up }] }`. */
export function parseHabiticaTasks(body: unknown): HabiticaTask[] {
  const data = (body as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return data.filter((t) => t && typeof t === "object" && (t._id || t.id) && typeof t.text === "string")
    .map((t) => ({
      id: String(t._id ?? t.id),
      type: t.type,
      text: t.text,
      completed: typeof t.completed === "boolean" ? t.completed : undefined,
      isDue: typeof t.isDue === "boolean" ? t.isDue : undefined,
      streak: typeof t.streak === "number" ? t.streak : undefined,
      up: typeof t.up === "boolean" ? t.up : undefined,
    }))
    .filter((t) => t.type === "daily" || t.type === "habit");
}

/** Habitica dailies checked today that are not checked here yet: they are checked here too. */
export function pullHabitica(
  habits: Habit[],
  tasks: HabiticaTask[],
  today: string,
): { habits: Habit[]; changed: number } {
  let changed = 0;
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const next = habits.map((h) => {
    const t = h.habitica && byId.get(h.habitica.id);
    if (!t || t.type !== "daily" || !t.completed || doneOn(h, today)) return h;
    changed++;
    const max = h.frequency === "daily" ? Math.max(1, h.target) : 1;
    return { ...h, checks: { ...h.checks, [today]: max } };
  });
  return { habits: next, changed };
}

/** Habitica wants `x-client` as "<author user id>-<app name>". */
export function habiticaHeaders(user: string, key: string): Record<string, string> {
  return {
    "x-api-user": user,
    "x-api-key": key,
    "x-client": `${user}-Backslash`,
    "Content-Type": "application/json",
  };
}

/** Score direction after a change here: up when checked; a daily is unchecked with down, a habit isn't touched. */
export function scoreDirection(task: { type: string }, checked: boolean): "up" | "down" | undefined {
  if (checked) return "up";
  return task.type === "daily" ? "down" : undefined;
}

export const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());
