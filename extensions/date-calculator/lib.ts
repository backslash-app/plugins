// Calendar arithmetic, French public holidays and the query parser. Pure, tested in lib_test.ts.
//
// A day is an integer: the number of days since 1970-01-01, so that adding,
// subtracting and comparing are plain arithmetic, with no time zone or
// daylight saving time in the way.

// ---------------------------------------------------------------------------
// Days

/** Days since 1970-01-01. */
export type Day = number;

export interface Ymd {
  y: number;
  m: number;
  d: number;
}

const DAY_MS = 86_400_000;

export const fromYmd = (y: number, m: number, d: number): Day => Math.round(Date.UTC(y, m - 1, d) / DAY_MS);

export function ymd(n: Day): Ymd {
  const date = new Date(n * DAY_MS);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** The local calendar date of a `Date`. */
export const localDay = (now = new Date()): Day => fromYmd(now.getFullYear(), now.getMonth() + 1, now.getDate());

export const isLeap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const daysInMonth = (y: number, m: number) =>
  [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];

export const isValid = (y: number, m: number, d: number) =>
  y >= 1583 && y <= 9999 && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

/** 0 = Monday … 6 = Sunday (1970-01-01 was a Thursday). */
export const weekday = (n: Day) => (((n + 3) % 7) + 7) % 7;

export const isWeekend = (n: Day) => weekday(n) >= 5;

/** Adds months the way calendars do: 31 January + 1 month = 28 (or 29) February. */
export function addMonths(n: Day, months: number): Day {
  const { y, m, d } = ymd(n);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total - ny * 12 + 1;
  return fromYmd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export const dayOfYear = (n: Day) => n - fromYmd(ymd(n).y, 1, 1) + 1;

export const daysInYear = (y: number) => isLeap(y) ? 366 : 365;

/** The ISO 8601 week: weeks start on Monday, week 1 holds the year's first Thursday. */
export function isoWeek(n: Day): { year: number; week: number } {
  const thursday = n - weekday(n) + 3;
  const year = ymd(thursday).y;
  return { year, week: Math.floor((thursday - fromYmd(year, 1, 1)) / 7) + 1 };
}

/** Monday of ISO week `week` of `year`. */
export function isoWeekStart(year: number, week: number): Day {
  const jan4 = fromYmd(year, 1, 4);
  return jan4 - weekday(jan4) + (week - 1) * 7;
}

/** 52 or 53. */
export const isoWeeksInYear = (year: number) => isoWeek(fromYmd(year, 12, 28)).week;

/** Whole years, months and days from `a` to `b` (`a` ≤ `b`), the way people count ages. */
export function calendarDiff(a: Day, b: Day): { years: number; months: number; days: number } {
  const from = ymd(a), to = ymd(b);
  let months = (to.y - from.y) * 12 + (to.m - from.m);
  if (addMonths(a, months) > b) months--;
  return { years: Math.floor(months / 12), months: months % 12, days: b - addMonths(a, months) };
}

// ---------------------------------------------------------------------------
// Public holidays of France

/** Easter Sunday of a Gregorian year (Meeus/Jones/Butcher algorithm). */
export function easter(y: number): Day {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return fromYmd(y, month, day);
}

/** `none`, `france` (the 11 national holidays) or `alsace` (plus Good Friday and 26 December). */
export type HolidaySet = "none" | "france" | "alsace";

export function holidaySet(pref: unknown): HolidaySet {
  const v = String(pref ?? "").trim().toLowerCase();
  if (/^(none|no|off|aucun|non|false)$/.test(v)) return "none";
  if (/alsace|moselle/.test(v)) return "alsace";
  return "france";
}

export interface Holiday {
  day: Day;
  name: string;
  /** The French name. */
  local: string;
}

export function holidays(year: number, set: HolidaySet): Holiday[] {
  if (set === "none") return [];
  const e = easter(year);
  const list: Holiday[] = [
    { day: fromYmd(year, 1, 1), name: "New Year's Day", local: "Jour de l'an" },
    { day: e + 1, name: "Easter Monday", local: "Lundi de Pâques" },
    { day: fromYmd(year, 5, 1), name: "Labour Day", local: "Fête du Travail" },
    { day: fromYmd(year, 5, 8), name: "Victory in Europe Day", local: "Victoire 1945" },
    { day: e + 39, name: "Ascension Day", local: "Ascension" },
    { day: e + 50, name: "Whit Monday", local: "Lundi de Pentecôte" },
    { day: fromYmd(year, 7, 14), name: "Bastille Day", local: "Fête nationale" },
    { day: fromYmd(year, 8, 15), name: "Assumption Day", local: "Assomption" },
    { day: fromYmd(year, 11, 1), name: "All Saints' Day", local: "Toussaint" },
    { day: fromYmd(year, 11, 11), name: "Armistice Day", local: "Armistice 1918" },
    { day: fromYmd(year, 12, 25), name: "Christmas Day", local: "Noël" },
  ];
  if (set === "alsace") {
    list.push(
      { day: e - 2, name: "Good Friday", local: "Vendredi saint" },
      { day: fromYmd(year, 12, 26), name: "St Stephen's Day", local: "Saint-Étienne" },
    );
  }
  return list.sort((a, b) => a.day - b.day);
}

const holidayCache = new Map<string, Map<Day, Holiday>>();

export function holidayOn(n: Day, set: HolidaySet): Holiday | undefined {
  const year = ymd(n).y;
  const key = `${set}:${year}`;
  let map = holidayCache.get(key);
  if (!map) {
    map = new Map(holidays(year, set).map((h) => [h.day, h]));
    holidayCache.set(key, map);
  }
  return map.get(n);
}

/**
 * `business`: Monday to Friday (jours ouvrés). `ouvrable`: Monday to Saturday
 * (jours ouvrables, the French legal count). Public holidays are off in both.
 */
export type WorkKind = "business" | "ouvrable";

export function isWorkday(n: Day, set: HolidaySet, kind: WorkKind = "business"): boolean {
  const wd = weekday(n);
  if (wd === 6 || (wd === 5 && kind === "business")) return false;
  return !holidayOn(n, set);
}

/** Workdays from `a` to `b`, both included (0 when `b` < `a`). */
export function countWorkdays(a: Day, b: Day, set: HolidaySet, kind: WorkKind = "business"): number {
  let count = 0;
  for (let n = a; n <= b; n++) if (isWorkday(n, set, kind)) count++;
  return count;
}

/** `n` workdays after (or before, when negative) `from`, which itself doesn't count. */
export function addWorkdays(from: Day, n: number, set: HolidaySet, kind: WorkKind = "business"): Day {
  const step = n < 0 ? -1 : 1;
  let day = from;
  for (let left = Math.abs(n); left > 0;) {
    day += step;
    if (isWorkday(day, set, kind)) left--;
  }
  return day;
}

// ---------------------------------------------------------------------------
// Formatting

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export const weekdayName = (n: Day) => WEEKDAYS[weekday(n)];
export const monthName = (m: number) => MONTH_NAMES[m - 1];

const pad = (n: number) => String(n).padStart(2, "0");

/** `2026-12-25`. */
export function iso(n: Day): string {
  const { y, m, d } = ymd(n);
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** `25/12/2026` (day first) or `12/25/2026` (month first). */
export function numeric(n: Day, order: DateOrder): string {
  const { y, m, d } = ymd(n);
  return order === "mdy" ? `${pad(m)}/${pad(d)}/${y}` : `${pad(d)}/${pad(m)}/${y}`;
}

/** `Friday 25 December 2026`. */
export function long(n: Day): string {
  const { y, m, d } = ymd(n);
  return `${weekdayName(n)} ${d} ${monthName(m)} ${y}`;
}

/** `Fri 25 Dec 2026`, or without the year. */
export function short(n: Day, withYear = true): string {
  const { y, m, d } = ymd(n);
  return `${weekdayName(n).slice(0, 3)} ${d} ${monthName(m).slice(0, 3)}${withYear ? ` ${y}` : ""}`;
}

export const plural = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${Math.abs(n) === 1 ? "" : "s"}`;

/** "Today", "Tomorrow", "In 57 days", "3 days ago". */
export function relative(n: Day, today: Day): string {
  const diff = n - today;
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return diff > 0 ? `In ${plural(diff, "day")}` : `${plural(-diff, "day")} ago`;
}

/** "8 weeks 1 day". */
export function weeksAndDays(days: number): string {
  const w = Math.floor(days / 7), d = days % 7;
  if (!w) return plural(d, "day");
  return d ? `${plural(w, "week")} ${plural(d, "day")}` : plural(w, "week");
}

/** "1 year 2 months 3 days". */
export function ymdText(diff: { years: number; months: number; days: number }): string {
  const parts = [
    diff.years ? plural(diff.years, "year") : "",
    diff.months ? plural(diff.months, "month") : "",
    diff.days || (!diff.years && !diff.months) ? plural(diff.days, "day") : "",
  ];
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Parsing

export type DateOrder = "dmy" | "mdy";

export interface Env {
  today: Day;
  holidays: HolidaySet;
  order: DateOrder;
}

/** Lowercase, without accents, typographic quotes or trailing punctuation. */
export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/([a-z])\.(?=\s|$)/g, "$1")
    .replace(/[?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const MONTHS: Record<string, number> = {
  january: 1,
  jan: 1,
  janvier: 1,
  janv: 1,
  february: 2,
  feb: 2,
  fevrier: 2,
  fevr: 2,
  fev: 2,
  march: 3,
  mar: 3,
  mars: 3,
  april: 4,
  apr: 4,
  avril: 4,
  avr: 4,
  may: 5,
  mai: 5,
  june: 6,
  jun: 6,
  juin: 6,
  july: 7,
  jul: 7,
  juillet: 7,
  juil: 7,
  august: 8,
  aug: 8,
  aout: 8,
  september: 9,
  sep: 9,
  sept: 9,
  septembre: 9,
  october: 10,
  oct: 10,
  octobre: 10,
  november: 11,
  nov: 11,
  novembre: 11,
  december: 12,
  dec: 12,
  decembre: 12,
};

const WEEKDAY_WORDS: Record<string, number> = {
  monday: 0,
  mon: 0,
  lundi: 0,
  tuesday: 1,
  tue: 1,
  tues: 1,
  mardi: 1,
  wednesday: 2,
  wed: 2,
  mercredi: 2,
  thursday: 3,
  thu: 3,
  thurs: 3,
  jeudi: 3,
  friday: 4,
  fri: 4,
  vendredi: 4,
  saturday: 5,
  sat: 5,
  samedi: 5,
  sunday: 6,
  sun: 6,
  dimanche: 6,
};

const alternation = (words: string[]) => [...words].sort((a, b) => b.length - a.length).join("|");
const MONTH = alternation(Object.keys(MONTHS));
const WEEKDAY = alternation(Object.keys(WEEKDAY_WORDS));

const RELATIVE: [RegExp, number][] = [
  [/^(today|now|tod|aujourd'?hui|maintenant|ce jour)$/, 0],
  [/^(tomorrow|tmrw|tmr|demain)$/, 1],
  [/^(yesterday|hier)$/, -1],
  [/^((the )?day after tomorrow|apres[- ]demain)$/, 2],
  [/^((the )?day before yesterday|avant[- ]hier)$/, -2],
];

/** Named days: [pattern, month, day] or a function of the year. */
const NAMED: [RegExp, (y: number) => Day][] = [
  [/^(christmas|xmas|christmas day|noel)$/, (y) => fromYmd(y, 12, 25)],
  [/^(christmas eve|reveillon( de noel)?)$/, (y) => fromYmd(y, 12, 24)],
  [/^(new year'?s?( day)?|nouvel an|jour de l'an)$/, (y) => fromYmd(y, 1, 1)],
  [/^(new year'?s eve|saint[- ]sylvestre|reveillon du nouvel an)$/, (y) => fromYmd(y, 12, 31)],
  [/^(easter( sunday)?|paques|dimanche de paques)$/, easter],
  [/^(easter monday|lundi de paques)$/, (y) => easter(y) + 1],
  [/^(good friday|vendredi saint)$/, (y) => easter(y) - 2],
  [/^(ascension( day)?|jeudi de l'ascension)$/, (y) => easter(y) + 39],
  [/^(pentecost|whit sunday|pentecote)$/, (y) => easter(y) + 49],
  [/^(whit monday|lundi de pentecote)$/, (y) => easter(y) + 50],
  [/^(bastille day|fete nationale)$/, (y) => fromYmd(y, 7, 14)],
  [/^(halloween)$/, (y) => fromYmd(y, 10, 31)],
  [/^(valentine'?s?( day)?|saint[- ]valentin)$/, (y) => fromYmd(y, 2, 14)],
  [/^(all saints'?( day)?|toussaint)$/, (y) => fromYmd(y, 11, 1)],
  [/^(labou?r day|fete du travail)$/, (y) => fromYmd(y, 5, 1)],
];

const year4 = (s: string | undefined, fallback: number) => {
  if (!s) return fallback;
  const n = Number(s);
  return s.length <= 2 ? 2000 + n : n;
};

/** Thrown with a sentence the user understands, e.g. "31 February isn't a date". */
export class ParseError extends Error {}

function build(y: number, m: number, d: number, env: Env, future: boolean, yearGiven: boolean): Day {
  if (!isValid(yearGiven ? y : 2000, m, d)) {
    throw new ParseError(`${d} ${monthName(m) ?? `month ${m}`}${yearGiven ? ` ${y}` : ""} isn't a date`);
  }
  if (!isValid(y, m, d)) {
    // 29 February without a year in a non-leap year: the next leap year.
    let yy = y;
    while (!isValid(yy, m, d)) yy++;
    return fromYmd(yy, m, d);
  }
  const n = fromYmd(y, m, d);
  if (!yearGiven && future && n < env.today) return build(y + 1, m, d, env, future, true);
  return n;
}

/**
 * One day, written in any of the usual ways: `2026-12-25`, `25/12/2026`,
 * `25 Dec`, `December 25, 2026`, `1er janvier`, `today`, `demain`,
 * `next friday`, `vendredi prochain`, `christmas`, `paques 2027`…
 * Without a year, the current one, or with `future` the next occurrence.
 */
export function parseDate(text: string, env: Env, future = false): Day | undefined {
  const t = normalize(text).replace(/^(?:(?:the|le|la|on|for|pour|of|du|au|this|ce) |l')/, "").trim();
  if (!t) return undefined;
  const thisYear = ymd(env.today).y;

  for (const [re, offset] of RELATIVE) if (re.test(t)) return env.today + offset;

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return build(+m[1], +m[2], +m[3], env, future, true);

  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{4}|\d{2}))?$/.exec(t);
  if (m) {
    let [a, b] = [+m[1], +m[2]];
    // Day first unless the preference says otherwise; a part above 12 can only be the day.
    let dayFirst = env.order === "dmy";
    if (a > 12 && b <= 12) dayFirst = true;
    else if (b > 12 && a <= 12) dayFirst = false;
    if (!dayFirst) [a, b] = [b, a];
    return build(year4(m[3], thisYear), b, a, env, future, Boolean(m[3]));
  }

  m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th|er|e|eme)? ?(?:of )?(${MONTH})(?:,? (\\d{4}))?$`).exec(t);
  if (m) return build(year4(m[3], thisYear), MONTHS[m[2]], +m[1], env, future, Boolean(m[3]));

  m = new RegExp(`^(${MONTH}) (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?$`).exec(t);
  if (m) return build(year4(m[3], thisYear), MONTHS[m[1]], +m[2], env, future, Boolean(m[3]));

  m = new RegExp(
    `^(?:(next|this|coming|last|previous|ce|cette)\\s+)?(${WEEKDAY})(?:\\s+(prochain|qui vient|dernier|passe))?$`,
  ).exec(t);
  if (m) {
    const target = WEEKDAY_WORDS[m[2]];
    const mode = m[1] ?? m[3] ?? "";
    const wd = weekday(env.today);
    if (/^(last|previous|dernier|passe)$/.test(mode)) {
      const back = (wd - target + 7) % 7 || 7;
      return env.today - back;
    }
    const ahead = (target - wd + 7) % 7;
    // "next friday" on a Friday is in a week; "friday" alone on a Friday is today.
    return env.today + (ahead === 0 && /^(next|prochain|coming|qui vient)$/.test(mode) ? 7 : ahead);
  }

  for (const [re, at] of NAMED) {
    const named = new RegExp(`^(.+?)(?: (\\d{4}))?$`).exec(t);
    if (!named || !re.test(named[1])) continue;
    if (named[2]) return at(+named[2]);
    const n = at(thisYear);
    return future && n < env.today ? at(thisYear + 1) : n;
  }
  return undefined;
}

export interface Period {
  start: Day;
  end: Day;
  label: string;
}

const monthPeriod = (y: number, m: number): Period => ({
  start: fromYmd(y, m, 1),
  end: fromYmd(y, m, daysInMonth(y, m)),
  label: `${monthName(m)} ${y}`,
});

const yearPeriod = (y: number): Period => ({ start: fromYmd(y, 1, 1), end: fromYmd(y, 12, 31), label: String(y) });

const weekPeriod = (y: number, w: number): Period => {
  const start = isoWeekStart(y, w);
  return { start, end: start + 6, label: `Week ${w} of ${y}` };
};

const quarterPeriod = (y: number, q: number): Period => ({
  start: fromYmd(y, q * 3 - 2, 1),
  end: fromYmd(y, q * 3, daysInMonth(y, q * 3)),
  label: `Q${q} ${y}`,
});

/** A month, a year, a week or a quarter: `may`, `mai 2027`, `2027`, `this month`, `week 42`, `q3`. */
export function parsePeriod(text: string, env: Env): Period | undefined {
  const t = normalize(text).replace(/^(?:(?:the|le|la|en|in|for|pour) |l')/, "").trim();
  const { y: thisYear, m: thisMonth } = ymd(env.today);
  let m = new RegExp(`^(${MONTH})(?: (\\d{4}))?$`).exec(t);
  if (m) return monthPeriod(m[2] ? +m[2] : thisYear, MONTHS[m[1]]);
  m = /^(\d{4})$/.exec(t);
  if (m && +m[1] >= 1583) return yearPeriod(+m[1]);
  m = /^(?:(\d{4})-)?(\d{1,2})$/.exec(t);
  if (m && m[1] && +m[2] >= 1 && +m[2] <= 12) return monthPeriod(+m[1], +m[2]);
  m = /^(?:q|t|quarter |trimestre )([1-4])(?: (\d{4}))?$/.exec(t);
  if (m) return quarterPeriod(m[2] ? +m[2] : thisYear, +m[1]);
  const week = parseWeek(t, env);
  if (week) return weekPeriod(week.year, week.week);
  if (/^(this|current) month$|^ce mois(-ci)?$|^mois en cours$/.test(t)) return monthPeriod(thisYear, thisMonth);
  if (/^next month$|^(le )?mois prochain$/.test(t)) {
    const n = ymd(addMonths(fromYmd(thisYear, thisMonth, 1), 1));
    return monthPeriod(n.y, n.m);
  }
  if (/^(last|previous) month$|^(le )?mois (dernier|precedent)$/.test(t)) {
    const n = ymd(addMonths(fromYmd(thisYear, thisMonth, 1), -1));
    return monthPeriod(n.y, n.m);
  }
  if (/^(this|current) year$|^cette annee$|^annee en cours$/.test(t)) return yearPeriod(thisYear);
  if (/^next year$|^(l')?annee prochaine$/.test(t)) return yearPeriod(thisYear + 1);
  if (/^last year$|^(l')?annee derniere$/.test(t)) return yearPeriod(thisYear - 1);
  if (/^(this|current) week$|^cette semaine$/.test(t)) {
    const w = isoWeek(env.today);
    return weekPeriod(w.year, w.week);
  }
  if (/^next week$|^(la )?semaine prochaine$/.test(t)) {
    const w = isoWeek(env.today + 7);
    return weekPeriod(w.year, w.week);
  }
  if (/^last week$|^(la )?semaine (derniere|passee)$/.test(t)) {
    const w = isoWeek(env.today - 7);
    return weekPeriod(w.year, w.week);
  }
  return undefined;
}

/** `week 42`, `semaine 42 2027`, `w42`, `S42`, `2026-W42`. */
export function parseWeek(text: string, env: Env): { year: number; week: number } | undefined {
  const t = normalize(text);
  let m = /^(?:iso )?(?:week|wk|w|semaine|sem|s)\s?(?:number |no |n° ?|#)?(\d{1,2})(?:,? (?:of |de |en )?(\d{4}))?$/
    .exec(t);
  let year: number, week: number;
  if (m) [year, week] = [m[2] ? +m[2] : isoWeek(env.today).year, +m[1]];
  else {
    m = /^(\d{4})-?w(\d{1,2})$/.exec(t);
    if (!m) return undefined;
    [year, week] = [+m[1], +m[2]];
  }
  if (week < 1 || week > isoWeeksInYear(year)) {
    throw new ParseError(`${year} has ${isoWeeksInYear(year)} ISO weeks, not ${week}`);
  }
  return { year, week };
}

// Durations: "45 days", "2 weeks and 3 days", "1 mois et 2 jours", "10 jours ouvres".

export type Unit = "day" | "week" | "month" | "year" | "business" | "ouvrable";

const UNIT_PATTERNS: [Unit, string][] = [
  ["business", "working days?|business days?|work ?days?|week ?days?|jours? ouvres?|j ouvres?|bd"],
  ["ouvrable", "jours? ouvrables?"],
  ["day", "days?|jours?|j|d"],
  ["week", "weeks?|wks?|w|semaines?|sem"],
  ["month", "months?|mos?|mois"],
  ["year", "years?|yrs?|y|ans?|annees?"],
];
const UNIT = UNIT_PATTERNS.map(([, p]) => p).join("|");

function unitOf(word: string): Unit {
  for (const [unit, p] of UNIT_PATTERNS) if (new RegExp(`^(?:${p})$`).test(word)) return unit;
  return "day";
}

export interface Step {
  sign: 1 | -1;
  amount: number;
  unit: Unit;
}

const STEP = new RegExp(
  `(\\+|-|\\bplus\\b|\\bminus\\b|\\bmoins\\b|\\band\\b|\\bet\\b|,)?\\s*(\\d+)\\s*(${UNIT})(?![a-z])`,
  "y",
);

/** `+ 45 days - 1 week`, `2 weeks and 3 days`; a step without a sign takes the previous one. */
export function parseSteps(text: string, firstSign: 1 | -1 = 1): Step[] | undefined {
  const t = normalize(text);
  const steps: Step[] = [];
  let sign = firstSign;
  STEP.lastIndex = 0;
  let pos = 0;
  while (pos < t.length) {
    STEP.lastIndex = pos;
    const m = STEP.exec(t);
    if (!m) return undefined;
    if (m[1] === "+" || m[1] === "plus") sign = 1;
    else if (m[1] === "-" || m[1] === "minus" || m[1] === "moins") sign = -1;
    steps.push({ sign, amount: +m[2], unit: unitOf(m[3]) });
    pos = STEP.lastIndex;
    while (t[pos] === " ") pos++;
  }
  return steps.length ? steps : undefined;
}

export function applySteps(from: Day, steps: Step[], set: HolidaySet): Day {
  let n = from;
  for (const s of steps) {
    const k = s.sign * s.amount;
    if (s.unit === "day") n += k;
    else if (s.unit === "week") n += 7 * k;
    else if (s.unit === "month") n = addMonths(n, k);
    else if (s.unit === "year") n = addMonths(n, 12 * k);
    else n = addWorkdays(n, k, set, s.unit);
  }
  return n;
}

const UNIT_WORDS: Record<Unit, [string, string]> = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
  business: ["working day", "working days"],
  ouvrable: ["jour ouvrable", "jours ouvrables"],
};

export const stepsText = (steps: Step[]) =>
  steps.map((s, i) =>
    `${i || s.sign < 0 ? (s.sign < 0 ? "− " : "+ ") : "+ "}${s.amount} ${UNIT_WORDS[s.unit][s.amount === 1 ? 0 : 1]}`
  ).join(" ");

// ---------------------------------------------------------------------------
// Queries

export type Query =
  | { kind: "today" }
  | { kind: "date"; day: Day; asked?: "weekday" }
  | { kind: "diff"; from: Day; to: Day; mode: "until" | "since" | "between"; focus?: "business" | "ouvrable" | "week" }
  | { kind: "add"; from: Day; steps: Step[]; result: Day }
  | { kind: "week"; year: number; week: number }
  | { kind: "weekOf"; day: Day }
  | { kind: "period"; period: Period; focus?: "ouvrable" }
  | { kind: "holidays"; year: number }
  | { kind: "error"; message: string };

const HOW_MANY = /^(?:how many |how much |number of |nb de |nombre de |combien (?:de |d')?|count )/;
const FOCUS_WORDS =
  "working days?|business days?|work ?days?|weekdays?|jours? ouvres?|jours? ouvrables?|days?|jours?|weeks?|semaines?|months?|mois|time|temps|nights?|nuits?";

function focusOf(word: string | undefined): "business" | "ouvrable" | "week" | undefined {
  if (!word) return undefined;
  if (/ouvrable/.test(word)) return "ouvrable";
  if (/work|business|weekday|ouvre/.test(word)) return "business";
  if (/week|semaine/.test(word)) return "week";
  return undefined;
}

function must(day: Day | undefined, text: string): Day {
  if (day === undefined) throw new ParseError(`“${text.trim()}” isn't a date I can read`);
  return day;
}

/** Reads a query; never throws (problems become `{ kind: "error" }`). */
export function parseQuery(text: string, env: Env): Query | { kind: "empty" } {
  const t = normalize(text);
  if (!t) return { kind: "empty" };
  try {
    return parseOrThrow(t, env) ?? {
      kind: "error",
      message: `I can't read “${text.trim()}”`,
    };
  } catch (e) {
    if (e instanceof ParseError) return { kind: "error", message: e.message };
    throw e;
  }
}

function parseOrThrow(input: string, env: Env): Query | undefined {
  if (/^(today|now|aujourd'?hui|date)$/.test(input)) return { kind: "today" };
  const t = input.replace(HOW_MANY, "");

  // Public holidays of a year.
  let m =
    /^(?:(?:french |france )?(?:public |bank )?holidays?|(?:les )?jours? feries?|feries?)(?: (?:in |en |of |de )?(\d{4}))?$/
      .exec(t);
  if (m) return { kind: "holidays", year: m[1] ? +m[1] : ymd(env.today).y };

  // Week N.
  const week = parseWeek(t, env);
  if (week) return { kind: "week", ...week };

  // Which week is a date in.
  m = /^(?:what |which )?(?:iso )?week(?: number)?(?: (?:is|of|for|was|will be|on))?(?: (.+))?$/.exec(t) ??
    /^(?:quelle |quel )?(?:semaine|numero de (?:la )?semaine|n° de semaine)(?: (?:est|sommes-nous|sommes nous|de|du|pour|le))*(?: (.+))?$/
      .exec(t);
  if (m) {
    const rest = m[1]?.replace(/^(?:it|is it|we are|today)$/, "") ?? "";
    return { kind: "weekOf", day: rest ? must(parseDate(rest, env), rest) : env.today };
  }

  // What day is a date.
  m =
    /^(?:what|which) (?:day|weekday)(?: of the week)?(?: (?:is|was|will be|will|does|did|falls?))?(?: it)? (?:on )?(.+?)(?: (?:fall on|be|fall))?$/
      .exec(t) ??
      /^quel jour(?: de la semaine)?(?: (?:est|sera|etait|tombe|tombera|tombait|c'est|ce sera|etait-ce))?(?: (?:le|ce))? (.+?)$/
        .exec(t) ??
      /^(?:weekday|day|jour) (?:of|de|du) (.+)$/.exec(t);
  if (m) {
    const today = /^(it|it today|today|sommes-nous|sommes nous|on est|nous sommes|aujourd'?hui)$/.test(m[1]);
    return { kind: "date", day: today ? env.today : must(parseDate(m[1], env), m[1]), asked: "weekday" };
  }

  // Between two dates.
  m = new RegExp(
    `^(?:(${FOCUS_WORDS}) )?(?:between|from|entre|du|de|d') ?(.+?) (?:and|to|until|till|et|au|a|jusqu'au|jusqu'a|->|-) (.+)$`,
  ).exec(t);
  if (m) {
    const from = parseDate(m[2], env), to = parseDate(m[3], env);
    if (from !== undefined && to !== undefined) {
      return { kind: "diff", from, to, mode: "between", focus: focusOf(m[1]) };
    }
  }

  // Until / since a date.
  m = new RegExp(
    `^(?:(${FOCUS_WORDS}) )?(?:left |remaining |restants? |qui restent )?(?:until|till|til|to|before|jusqu'au|jusqu'a|jusqu'a la|jusqu'a le|avant|d'ici|countdown to) (.+)$`,
  ).exec(t);
  if (m) {
    const to = must(parseDate(m[2], env, true), m[2]);
    return { kind: "diff", from: env.today, to, mode: "until", focus: focusOf(m[1]) };
  }
  m = new RegExp(`^(?:(${FOCUS_WORDS}) )?(?:since|depuis|from|ago since|passed since|ecoules depuis) (.+)$`).exec(t);
  if (m) {
    const from = must(parseDate(m[2], env), m[2]);
    return { kind: "diff", from, to: env.today, mode: "since", focus: focusOf(m[1]) };
  }

  // Working days in a month, a year, a week.
  m = new RegExp(`^(${FOCUS_WORDS}) (?:are |is )?(?:there )?(?:in|en|of|for|de|dans|pour|du mois de|ce) (.+)$`).exec(
    t,
  );
  if (m) {
    const period = parsePeriod(m[2], env);
    if (period) return { kind: "period", period, focus: focusOf(m[1]) === "ouvrable" ? "ouvrable" : undefined };
  }

  // "jours ouvrés" alone: this month.
  m = /^(working days?|business days?|work ?days?|jours? ouvres?|jours? ouvrables?)$/.exec(t);
  if (m) {
    const period = parsePeriod("this month", env)!;
    return { kind: "period", period, focus: focusOf(m[1]) === "ouvrable" ? "ouvrable" : undefined };
  }

  // In N days, N days ago, N days after X.
  m = /^(?:in|dans|d'ici) (.+)$/.exec(t);
  if (m) {
    const steps = parseSteps(m[1]);
    if (steps) return add(env.today, steps, env);
  }
  m = /^(?:il y a) (.+)$/.exec(t) ?? /^(.+?) ago$/.exec(t);
  if (m) {
    const steps = parseSteps(m[1], -1);
    if (steps) return add(env.today, steps, env);
  }
  m = /^(.+?) (?:from now|from today|later|plus tard|a partir d'aujourd'hui)$/.exec(t);
  if (m) {
    const steps = parseSteps(m[1]);
    if (steps) return add(env.today, steps, env);
  }
  m = /^(.+?) (after|from|apres|before|avant) (.+)$/.exec(t);
  if (m) {
    const steps = parseSteps(m[1], /^(before|avant)$/.test(m[2]) ? -1 : 1);
    const from = parseDate(m[3], env);
    if (steps && from !== undefined) return add(from, steps, env);
  }

  // A date followed by + / - steps.
  m = new RegExp(`^(.*?)\\s*((?:\\+|-|\\bplus\\b|\\bminus\\b|\\bmoins\\b)\\s*\\d+\\s*(?:${UNIT})(?![a-z]).*)$`).exec(t);
  if (m) {
    const steps = parseSteps(m[2]);
    if (steps) {
      const from = m[1] ? parseDate(m[1], env) : env.today;
      if (from !== undefined) return add(from, steps, env);
    }
  }

  // A date alone, or a period alone.
  const day = parseDate(t, env);
  if (day !== undefined) return { kind: "date", day };
  const period = parsePeriod(t, env);
  if (period) return { kind: "period", period };

  // Two dates without a keyword: "1 jan to 14 jul".
  m = /^(.+?) (?:to|->|au|\.\.) (.+)$/.exec(t);
  if (m) {
    const from = parseDate(m[1], env), to = parseDate(m[2], env);
    if (from !== undefined && to !== undefined) return { kind: "diff", from, to, mode: "between" };
  }
  return undefined;
}

function add(from: Day, steps: Step[], env: Env): Query {
  return { kind: "add", from, steps, result: applySteps(from, steps, env.holidays) };
}

// ---------------------------------------------------------------------------
// Answers: what the command shows, one row per useful number

export interface Row {
  id: string;
  title: string;
  subtitle?: string;
  /** What Enter copies. */
  copy: string;
  icon?: "calendar" | "clock" | "hash" | "briefcase" | "flag" | "sun" | "alert" | "info" | "arrow";
  section?: string;
  accessory?: string;
}

export interface Answer {
  heading: string;
  rows: Row[];
  /** Detail panel lines. */
  facts: [string, string][];
}

const SET_TEXT: Record<HolidaySet, string> = {
  none: "Monday to Friday",
  france: "Monday to Friday, without French public holidays",
  alsace: "Monday to Friday, without French and Alsace-Moselle public holidays",
};

const OUVRABLE_TEXT: Record<HolidaySet, string> = {
  none: "Monday to Saturday",
  france: "Monday to Saturday, without French public holidays",
  alsace: "Monday to Saturday, without French and Alsace-Moselle public holidays",
};

function dayFacts(n: Day, env: Env): [string, string][] {
  const w = isoWeek(n);
  const { y, m } = ymd(n);
  const h = holidayOn(n, env.holidays);
  const facts: [string, string][] = [
    ["Date", long(n)],
    ["ISO 8601", iso(n)],
    ["ISO week", `${w.year}-W${pad(w.week)}`],
    ["Day of year", `${dayOfYear(n)} of ${daysInYear(y)}`],
    ["Quarter", `Q${Math.ceil(m / 3)}`],
    ["From today", relative(n, env.today)],
  ];
  if (h) facts.push(["Public holiday", `${h.name} (${h.local})`]);
  return facts;
}

/** Rows describing one day: the long date, ISO, week, day of year, holiday. */
export function dayRows(n: Day, env: Env, section: string, lead?: Row): Row[] {
  const w = isoWeek(n);
  const start = isoWeekStart(w.year, w.week);
  const h = holidayOn(n, env.holidays);
  const { y } = ymd(n);
  const rows: Row[] = [];
  rows.push(
    lead ?? {
      id: "long",
      title: long(n),
      subtitle: relative(n, env.today),
      copy: long(n),
      icon: "calendar",
      section,
    },
  );
  rows.push(
    { id: "iso", title: iso(n), subtitle: "ISO 8601", copy: iso(n), icon: "hash", section },
    {
      id: "numeric",
      title: numeric(n, env.order),
      subtitle: "Numeric",
      copy: numeric(n, env.order),
      icon: "hash",
      section,
    },
    {
      id: "week",
      title: `Week ${w.week}`,
      subtitle: `${w.year}-W${pad(w.week)} · ${short(start, false)} – ${short(start + 6)}`,
      copy: String(w.week),
      icon: "calendar",
      section,
    },
    {
      id: "doy",
      title: `Day ${dayOfYear(n)} of ${daysInYear(y)}`,
      subtitle: `${daysInYear(y) - dayOfYear(n)} days left in ${y}`,
      copy: String(dayOfYear(n)),
      icon: "clock",
      section,
    },
  );
  if (h) {
    rows.push({
      id: "holiday",
      title: h.name,
      subtitle: `${h.local} · public holiday`,
      copy: h.name,
      icon: "flag",
      section,
    });
  } else if (isWeekend(n)) {
    rows.push({
      id: "weekend",
      title: "Weekend",
      subtitle: weekdayName(n),
      copy: weekdayName(n),
      icon: "sun",
      section,
    });
  }
  if (n !== env.today && env.holidays !== "none" && Math.abs(n - env.today) < 3_660) {
    const [a, b] = n > env.today ? [env.today + 1, n] : [n, env.today - 1];
    const count = countWorkdays(a, b, env.holidays);
    rows.push({
      id: "workdays-from-today",
      title: plural(count, "working day"),
      subtitle: n > env.today
        ? "From tomorrow to that day, both included"
        : "From that day to yesterday, both included",
      copy: String(count),
      icon: "briefcase",
      section,
    });
  }
  return rows;
}

function diffAnswer(q: Extract<Query, { kind: "diff" }>, env: Env): Answer {
  const [a, b] = q.from <= q.to ? [q.from, q.to] : [q.to, q.from];
  const days = b - a;
  const future = q.to >= q.from;
  const range = `${short(q.from)} → ${short(q.to)}`;
  const section = q.mode === "until" ? `Until ${short(q.to)}` : q.mode === "since" ? `Since ${short(q.from)}` : range;
  // "Until" counts the days after today; "between" counts both ends.
  const [wa, wb] = q.mode === "until" ? [a + 1, b] : q.mode === "since" ? [a, b - 1] : [a, b];
  const work = countWorkdays(wa, wb, env.holidays);
  const ouvrables = countWorkdays(wa, wb, env.holidays, "ouvrable");
  const span = q.mode === "between" ? "both dates included" : q.mode === "until" ? "from tomorrow" : "until yesterday";
  const offList = holidaysBetween(wa, wb, env.holidays);
  const cal = calendarDiff(a, b);
  const sign = q.mode === "between" ? "" : future ? "" : " ago";

  const rows: Row[] = [
    {
      id: "days",
      title: `${plural(days, "day")}${q.mode === "between" && !future ? " (backwards)" : sign}`,
      subtitle: q.mode === "between" ? `${range} · ${plural(days + 1, "day")} counting both` : range,
      copy: String(days),
      icon: "clock",
      section,
    },
    {
      id: "business",
      title: plural(work, "working day"),
      subtitle: `${SET_TEXT[env.holidays]}, ${span}${
        offList.length ? ` · ${plural(offList.length, "holiday")} off` : ""
      }`,
      copy: String(work),
      icon: "briefcase",
      section,
    },
    {
      id: "ouvrables",
      title: `${ouvrables.toLocaleString("en")} jours ouvrables`,
      subtitle: `${OUVRABLE_TEXT[env.holidays]}, ${span}`,
      copy: String(ouvrables),
      icon: "briefcase",
      section,
    },
    {
      id: "weeks",
      title: weeksAndDays(days),
      subtitle: `${(days / 7).toLocaleString("en", { maximumFractionDigits: 2 })} weeks`,
      copy: weeksAndDays(days),
      icon: "calendar",
      section,
    },
    {
      id: "calendar",
      title: ymdText(cal),
      subtitle: "Calendar months and years",
      copy: ymdText(cal),
      icon: "calendar",
      section,
    },
    {
      id: "hours",
      title: plural(days * 24, "hour"),
      subtitle: `${(days * 1440).toLocaleString("en")} minutes · ${(days * 86_400).toLocaleString("en")} seconds`,
      copy: String(days * 24),
      icon: "clock",
      section,
    },
  ];
  if (q.focus === "business") rows.unshift(rows.splice(1, 1)[0]);
  else if (q.focus === "ouvrable") rows.unshift(rows.splice(2, 1)[0]);
  else if (q.focus === "week") rows.unshift(rows.splice(3, 1)[0]);
  for (const h of offList.slice(0, 20)) rows.push(holidayRow(h, env, "Public holidays in between"));
  return {
    heading: section,
    rows,
    facts: [
      ["From", long(q.from)],
      ["To", long(q.to)],
      ["Days", days.toLocaleString("en")],
      ["Working days", work.toLocaleString("en")],
      ["Weekend days", countWeekend(wa, wb).toLocaleString("en")],
      ["Public holidays", String(offList.length)],
    ],
  };
}

const countWeekend = (a: Day, b: Day) => {
  let n = 0;
  for (let d = a; d <= b; d++) if (isWeekend(d)) n++;
  return n;
};

/** Public holidays from `a` to `b` included that fall on a weekday. */
export function holidaysBetween(a: Day, b: Day, set: HolidaySet, includeWeekends = false): Holiday[] {
  if (b < a || set === "none") return [];
  const out: Holiday[] = [];
  for (let y = ymd(a).y; y <= ymd(b).y; y++) {
    for (const h of holidays(y, set)) {
      if (h.day >= a && h.day <= b && (includeWeekends || !isWeekend(h.day))) out.push(h);
    }
  }
  return out;
}

function holidayRow(h: Holiday, env: Env, section: string): Row {
  return {
    id: `holiday:${h.day}`,
    title: h.name,
    subtitle: `${short(h.day)} · ${h.local}`,
    copy: iso(h.day),
    icon: "flag",
    section,
    accessory: isWeekend(h.day) ? "weekend" : relative(h.day, env.today),
  };
}

function periodAnswer(p: Period, env: Env, focus?: "ouvrable"): Answer {
  const days = p.end - p.start + 1;
  const work = countWorkdays(p.start, p.end, env.holidays);
  const ouvrables = countWorkdays(p.start, p.end, env.holidays, "ouvrable");
  const off = holidaysBetween(p.start, p.end, env.holidays, true);
  const weekend = countWeekend(p.start, p.end);
  let first: Day | undefined, last: Day | undefined;
  for (let d = p.start; d <= p.end; d++) {
    if (isWorkday(d, env.holidays)) {
      first ??= d;
      last = d;
    }
  }
  const section = p.label;
  const rows: Row[] = [
    {
      id: "business",
      title: plural(work, "working day"),
      subtitle: `${p.label} · ${SET_TEXT[env.holidays]}`,
      copy: String(work),
      icon: "briefcase",
      section,
    },
    {
      id: "ouvrables",
      title: `${ouvrables} jours ouvrables`,
      subtitle: `${p.label} · ${OUVRABLE_TEXT[env.holidays]}`,
      copy: String(ouvrables),
      icon: "briefcase",
      section,
    },
    {
      id: "days",
      title: plural(days, "day"),
      subtitle: `${short(p.start)} – ${short(p.end)} · ${plural(weekend, "weekend day")}`,
      copy: String(days),
      icon: "calendar",
      section,
    },
  ];
  if (focus === "ouvrable") rows.unshift(rows.splice(1, 1)[0]);
  if (first !== undefined && last !== undefined) {
    rows.push(
      { id: "first", title: long(first), subtitle: "First working day", copy: iso(first), icon: "arrow", section },
      { id: "last", title: long(last), subtitle: "Last working day", copy: iso(last), icon: "arrow", section },
    );
  }
  for (const h of off) rows.push(holidayRow(h, env, "Public holidays"));
  return {
    heading: p.label,
    rows,
    facts: [
      ["Period", `${long(p.start)} – ${long(p.end)}`],
      ["Days", String(days)],
      ["Working days", String(work)],
      ["Jours ouvrables", String(ouvrables)],
      ["Weekend days", String(weekend)],
      ["Public holidays", `${off.length} (${off.filter((h) => !isWeekend(h.day)).length} on a weekday)`],
    ],
  };
}

function yearExtras(year: number, section: string): Row[] {
  const e = easter(year);
  return [
    {
      id: "leap",
      title: isLeap(year) ? `${year} is a leap year` : `${year} is not a leap year`,
      subtitle: `${daysInYear(year)} days · ${isoWeeksInYear(year)} ISO weeks`,
      copy: String(daysInYear(year)),
      icon: "info",
      section,
    },
    { id: "easter", title: long(e), subtitle: "Easter Sunday", copy: iso(e), icon: "sun", section },
  ];
}

/** Everything the command shows for a query. */
export function answer(q: Query, env: Env): Answer {
  switch (q.kind) {
    case "today": {
      return { heading: "Today", rows: dayRows(env.today, env, "Today"), facts: dayFacts(env.today, env) };
    }
    case "date": {
      const section = q.asked === "weekday" ? `What day is ${iso(q.day)}` : long(q.day);
      const lead: Row | undefined = q.asked === "weekday"
        ? {
          id: "weekday",
          title: weekdayName(q.day),
          subtitle: `${long(q.day)} · ${relative(q.day, env.today)}`,
          copy: weekdayName(q.day),
          icon: "calendar",
          section,
        }
        : undefined;
      return { heading: section, rows: dayRows(q.day, env, section, lead), facts: dayFacts(q.day, env) };
    }
    case "diff":
      return diffAnswer(q, env);
    case "add": {
      const section = `${short(q.from)} ${stepsText(q.steps)}`;
      const lead: Row = {
        id: "result",
        title: long(q.result),
        subtitle: `${section} · ${relative(q.result, env.today)}`,
        copy: iso(q.result),
        icon: "calendar",
        section,
      };
      const rows = dayRows(q.result, env, section, lead);
      rows.splice(1, 0, {
        id: "long",
        title: long(q.result),
        subtitle: "As text",
        copy: long(q.result),
        icon: "calendar",
        section,
      });
      return {
        heading: section,
        rows,
        facts: [["Start", long(q.from)], ["Added", stepsText(q.steps)], ...dayFacts(q.result, env)],
      };
    }
    case "week": {
      const start = isoWeekStart(q.year, q.week);
      const p: Period = { start, end: start + 6, label: `Week ${q.week} of ${q.year}` };
      const a = periodAnswer(p, env);
      a.rows.unshift({
        id: "range",
        title: `${short(start, ymd(start).y !== ymd(start + 6).y)} – ${short(start + 6)}`,
        subtitle: `${q.year}-W${pad(q.week)} · ${relative(start, env.today)}`,
        copy: `${iso(start)} – ${iso(start + 6)}`,
        icon: "calendar",
        section: p.label,
      }, {
        id: "monday",
        title: iso(start),
        subtitle: "Monday",
        copy: iso(start),
        icon: "hash",
        section: p.label,
      }, {
        id: "sunday",
        title: iso(start + 6),
        subtitle: "Sunday",
        copy: iso(start + 6),
        icon: "hash",
        section: p.label,
      });
      return a;
    }
    case "weekOf": {
      const w = isoWeek(q.day);
      const start = isoWeekStart(w.year, w.week);
      const section = `Week of ${short(q.day)}`;
      const rows: Row[] = [
        {
          id: "week",
          title: `Week ${w.week}`,
          subtitle: `${w.year}-W${pad(w.week)} · ${short(start, false)} – ${short(start + 6)}`,
          copy: String(w.week),
          icon: "calendar",
          section,
        },
        {
          id: "isoweek",
          title: `${w.year}-W${pad(w.week)}`,
          subtitle: "ISO 8601 week",
          copy: `${w.year}-W${pad(w.week)}`,
          icon: "hash",
          section,
        },
        {
          id: "isoweekday",
          title: `${w.year}-W${pad(w.week)}-${weekday(q.day) + 1}`,
          subtitle: `ISO week date (${weekdayName(q.day)} is day ${weekday(q.day) + 1})`,
          copy: `${w.year}-W${pad(w.week)}-${weekday(q.day) + 1}`,
          icon: "hash",
          section,
        },
        {
          id: "weeks-left",
          title: `${isoWeeksInYear(w.year) - w.week} weeks left`,
          subtitle: `${w.year} has ${isoWeeksInYear(w.year)} ISO weeks`,
          copy: String(isoWeeksInYear(w.year) - w.week),
          icon: "clock",
          section,
        },
      ];
      return { heading: section, rows, facts: dayFacts(q.day, env) };
    }
    case "period": {
      const a = periodAnswer(q.period, env, q.focus);
      if (/^\d{4}$/.test(q.period.label)) a.rows.splice(3, 0, ...yearExtras(+q.period.label, q.period.label));
      return a;
    }
    case "holidays": {
      const set = env.holidays === "none" ? "france" : env.holidays;
      const list = holidays(q.year, set);
      const section = `Public holidays in France, ${q.year}`;
      return {
        heading: section,
        rows: list.map((h) => holidayRow(h, env, section)),
        facts: [
          ["Year", String(q.year)],
          ["Holidays", String(list.length)],
          ["On a weekday", String(list.filter((h) => !isWeekend(h.day)).length)],
          ["Easter Sunday", long(easter(q.year))],
        ],
      };
    }
    case "error":
      return {
        heading: "Not understood",
        rows: [{ id: "error", title: q.message, subtitle: "Try one of the examples", copy: "", icon: "alert" }],
        facts: [],
      };
  }
}

/** Shown when nothing is typed, and under an error. */
export const EXAMPLES: { query: string; title: string }[] = [
  { query: "days until 2026-12-25", title: "Countdown to a date" },
  { query: "2026-03-01 + 45 days", title: "Add or subtract days, weeks, months, years" },
  { query: "between 1 jan and 14 jul", title: "Days, weeks and working days between two dates" },
  { query: "working days in may", title: "Working days in a month, a year or a quarter" },
  { query: "week 42", title: "The dates of an ISO week" },
  { query: "what day is 14/07/2027", title: "The day of the week" },
  { query: "in 10 working days", title: "Skip weekends and public holidays" },
  { query: "dans 3 semaines", title: "In French too" },
  { query: "jours ouvrés en juin 2027", title: "Jours ouvrés et ouvrables" },
  { query: "holidays 2027", title: "French public holidays of a year" },
  { query: "45 days ago", title: "Back in time" },
  { query: "week number", title: "This week's number" },
];
