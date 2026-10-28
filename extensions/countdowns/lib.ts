// Countdown arithmetic: next occurrences (yearly repeats, leap days), time
// left in calendar days (safe across daylight saving changes), progress and
// the labels shown. Pure functions on local dates, no I/O.

export type Color = "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" | "gray";
export const COLORS: Color[] = ["blue", "green", "orange", "red", "purple", "pink", "teal", "yellow", "gray"];

export interface Countdown {
  id: string;
  title: string;
  /** YYYY-MM-DD; for a yearly event, its first occurrence (a birth date). */
  date: string;
  /** HH:MM, local time; none for an all-day event. */
  time?: string;
  yearly?: boolean;
  color?: Color;
  /** When it was added (ms), the start of its progress bar. */
  created: number;
}

const DAY = 86_400_000;
const p2 = (n: number) => String(n).padStart(2, "0");

export const isoDay = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;

export const isLeapYear = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Days of a month, `month` from 1. */
export const daysInMonth = (y: number, month: number) => new Date(Date.UTC(y, month, 0)).getUTCDate();

/** Calendar days from `a` to `b`, by their local dates: 23 or 25 hour days still count as one. */
export function calendarDays(a: Date, b: Date): number {
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((ub - ua) / DAY);
}

function parts(c: Pick<Countdown, "date" | "time">) {
  const [y, m, d] = c.date.split("-").map(Number);
  const [hh, mm] = c.time ? c.time.split(":").map(Number) : [0, 0];
  return { y, m, d, hh, mm };
}

/** The event in a given year; Feb 29 falls on Feb 28 in other years. */
export function inYear(c: Pick<Countdown, "date" | "time">, year: number): Date {
  const { m, d, hh, mm } = parts(c);
  return new Date(year, m - 1, Math.min(d, daysInMonth(year, m)), hh, mm);
}

/** The moment of the event; all-day events start at midnight. */
export function eventDate(c: Pick<Countdown, "date" | "time">): Date {
  const { y } = parts(c);
  return inYear(c, y);
}

/** An all-day event lasts until the end of its day, a timed one until its minute. */
function isOver(c: Pick<Countdown, "time">, at: Date, now: Date): boolean {
  return c.time ? at.getTime() <= now.getTime() - 60_000 : calendarDays(now, at) < 0;
}

/** The occurrence counted down to: the date itself, or for a yearly event the next one (today included). */
export function nextOccurrence(c: Pick<Countdown, "date" | "time" | "yearly">, now: Date): Date {
  if (!c.yearly) return eventDate(c);
  const { y } = parts(c);
  let year = Math.max(now.getFullYear(), y);
  let at = inYear(c, year);
  if (isOver(c, at, now)) at = inYear(c, ++year);
  return at;
}

export function previousOccurrence(c: Pick<Countdown, "date" | "time" | "yearly">, now: Date): Date | undefined {
  if (!c.yearly) return undefined;
  const next = nextOccurrence(c, now);
  const { y } = parts(c);
  return next.getFullYear() - 1 >= y ? inYear(c, next.getFullYear() - 1) : undefined;
}

/** For yearly events: how many years the next occurrence marks (30 for a 30th birthday). */
export function yearsAt(c: Countdown, now: Date): number | undefined {
  if (!c.yearly) return undefined;
  const n = nextOccurrence(c, now).getFullYear() - parts(c).y;
  return n > 0 ? n : undefined;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ??
    "th";
  return `${n}${s}`;
}

export interface Left {
  /** Calendar days until the occurrence (negative when past). */
  days: number;
  ms: number;
  past: boolean;
  /** "in 12 days", "tomorrow", "today", "in 3 hours", "now", "2 days ago". */
  label: string;
}

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"}`;

export function timeLeft(c: Countdown, now: Date): Left {
  const at = nextOccurrence(c, now);
  const days = calendarDays(now, at);
  const ms = at.getTime() - now.getTime();
  const past = isOver(c, at, now);
  let label: string;
  if (c.time && (days === 0 || Math.abs(ms) < 6 * 3_600_000)) {
    const minutes = Math.round(Math.abs(ms) / 60_000);
    if (minutes < 1 || (!past && ms <= 0)) label = "now";
    else {
      const span = minutes < 60 ? plural(minutes, "minute") : plural(Math.round(minutes / 60), "hour");
      label = past ? `${span} ago` : `in ${span}`;
    }
  } else if (days === 0) label = "today";
  else if (days === 1) label = "tomorrow";
  else if (days === -1) label = "yesterday";
  else if (days > 0) label = `in ${plural(days, "day")}`;
  else label = `${plural(-days, "day")} ago`;
  return { days, ms, past, label };
}

export type Section = "This Week" | "This Month" | "Later" | "Past";
export const SECTIONS: Section[] = ["This Week", "This Month", "Later", "Past"];

/** Within 7 days, within 31 days, later, or past. */
export function sectionOf(c: Countdown, now: Date): Section {
  const left = timeLeft(c, now);
  if (left.past) return "Past";
  return left.days < 7 ? "This Week" : left.days < 31 ? "This Month" : "Later";
}

/** Soonest first, then the past ones, most recent first. */
export function sortCountdowns(list: Countdown[], now: Date): Countdown[] {
  const key = (c: Countdown) => nextOccurrence(c, now).getTime();
  return [...list].sort((a, b) => {
    const pa = timeLeft(a, now).past;
    const pb = timeLeft(b, now).past;
    if (pa !== pb) return pa ? 1 : -1;
    return pa ? key(b) - key(a) : key(a) - key(b) || a.title.localeCompare(b.title);
  });
}

/** From the creation (or the last yearly occurrence, if later) to the occurrence, 0 to 1. */
export function progress(c: Countdown, now: Date): number {
  const at = nextOccurrence(c, now).getTime();
  const prev = previousOccurrence(c, now)?.getTime();
  const start = Math.max(c.created, prev ?? -Infinity);
  if (at <= start) return now.getTime() >= at ? 1 : 0;
  return Math.max(0, Math.min(1, (now.getTime() - start) / (at - start)));
}

/** "2 months, 1 week, 3 days" in calendar terms, for the detail panel. */
export function breakdown(now: Date, at: Date): string {
  let from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let to = new Date(at.getFullYear(), at.getMonth(), at.getDate());
  if (to < from) [from, to] = [to, from];
  let months = (to.getFullYear() - from.getFullYear()) * 12 + to.getMonth() - from.getMonth();
  const shifted = (n: number) => {
    const first = new Date(from.getFullYear(), from.getMonth() + n, 1);
    first.setDate(Math.min(from.getDate(), daysInMonth(first.getFullYear(), first.getMonth() + 1)));
    return first;
  };
  if (shifted(months) > to) months--;
  let days = calendarDays(shifted(months), to);
  const years = Math.floor(months / 12);
  months %= 12;
  const weeks = Math.floor(days / 7);
  days %= 7;
  const out = [
    years ? plural(years, "year") : "",
    months ? plural(months, "month") : "",
    weeks ? plural(weeks, "week") : "",
    days ? plural(days, "day") : "",
  ].filter(Boolean);
  return out.length ? out.join(", ") : "Today";
}

/** What the root search shows for the pinned countdown: "Vacation in 12 days". */
export function pinnedSubtitle(c: Countdown, now: Date): string {
  return `${c.title} ${timeLeft(c, now).label}`;
}

// --- Input -------------------------------------------------------------------

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** `dec`, `Dec.`, `december` → 12. */
function month(word: string): number | undefined {
  const w = word.toLowerCase().replace(/\.$/, "");
  if (w.length < 3) return undefined;
  const i = MONTHS.findIndex((m) => m.startsWith(w));
  return i >= 0 ? i + 1 : undefined;
}

function valid(y: number, m: number, d: number) {
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

/**
 * A date typed by a person: `2026-12-25`, `12-25` or `Dec 25` / `25 December`
 * (the next one), `Dec 25 2027`, `25 Dec 2027`, `today`, `tomorrow`.
 * Returns YYYY-MM-DD or undefined.
 */
export function parseDateInput(input: string, now: Date): string | undefined {
  const s = input.trim().toLowerCase().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!s) return undefined;
  const iso = (y: number, m: number, d: number) => valid(y, m, d) ? `${y}-${p2(m)}-${p2(d)}` : undefined;
  if (s === "today") return isoDay(now);
  if (s === "tomorrow") return isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  // Without a year: the next one (today included).
  const upcoming = (mo: number, d: number) => {
    const y = now.getFullYear();
    if (!valid(2024, mo, d)) return undefined; // a leap year: Feb 29 exists
    for (let year = y; year < y + 8; year++) {
      if (!valid(year, mo, d)) continue;
      if (calendarDays(now, new Date(year, mo - 1, d)) >= 0) return iso(year, mo, d);
    }
    return undefined;
  };
  m = /^(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) return upcoming(+m[1], +m[2]);
  const words = s.split(" ");
  // "dec 25", "dec 25 2027", "25 dec", "25 dec 2027", "december 25th"
  const num = (w: string | undefined) => w && /^\d{1,2}(st|nd|rd|th)?$/.test(w) ? parseInt(w) : undefined;
  const year = (w: string | undefined) => w && /^\d{4}$/.test(w) ? +w : undefined;
  if (words.length === 2 || words.length === 3) {
    const [a, b, c] = words;
    let mo = month(a), d = num(b);
    if (!mo || !d) [mo, d] = [month(b), num(a)];
    if (mo && d) {
      if (words.length === 2) return upcoming(mo, d);
      const y = year(c);
      if (y) return iso(y, mo, d);
    }
  }
  return undefined;
}

/** `14:30`, `9:05`, `2pm`, `2:30 pm`, `noon`; empty → undefined; throws when not understood. */
export function parseTimeInput(input: string): string | undefined {
  const s = input.trim().toLowerCase().replace(/\s+/g, "");
  if (!s) return undefined;
  if (s === "noon") return "12:00";
  if (s === "midnight") return "00:00";
  const m = /^(\d{1,2})(?:[:h.](\d{2}))?(am|pm)?$/.exec(s);
  if (!m) throw new Error(`“${input}” is not a time (18:30, 6pm)`);
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (m[3]) {
    if (h < 1 || h > 12) throw new Error(`“${input}” is not a time (18:30, 6pm)`);
    h = (h % 12) + (m[3] === "pm" ? 12 : 0);
  }
  if (h > 23 || min > 59) throw new Error(`“${input}” is not a time (18:30, 6pm)`);
  return `${p2(h)}:${p2(min)}`;
}

export function formatDate(c: Pick<Countdown, "time">, at: Date, now: Date, o: { year?: boolean } = {}): string {
  const date = at.toLocaleDateString("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: o.year || at.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
  });
  return c.time ? `${date}, ${c.time}` : date;
}

export function newYear(now: Date): { title: string; date: string } {
  return { title: `New Year ${now.getFullYear() + 1}`, date: `${now.getFullYear() + 1}-01-01` };
}

export function newId(now = Date.now()): string {
  return `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
