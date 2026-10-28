// Cron and systemd calendar expressions: parsing, English, next runs, conversion. Pure, tested in lib_test.ts.

export interface Part {
  kind: "any" | "value" | "range" | "step";
  from: number;
  to: number;
  step: number;
}

export interface Field {
  parts: Part[];
  values: number[];
  /** `*` (or `?`): no restriction. */
  star: boolean;
}

export interface Schedule {
  kind: "cron" | "systemd";
  /** The expression as typed. */
  source: string;
  /** `@daily`, `weekly`… when the expression was a shorthand. */
  macro?: string;
  /** `@reboot`: no calendar time at all. */
  reboot?: boolean;
  hasSeconds: boolean;
  second: Field;
  minute: Field;
  hour: Field;
  day: Field;
  month: Field;
  /** 0 = Sunday … 6 = Saturday. */
  weekday: Field;
  year?: Field;
  /** Days counted from the end of the month: 0 = the last day (cron `L`, systemd `~01`). */
  lastDays: number[];
  /** Cron `5#3`: the third Friday. */
  nth: { weekday: number; n: number }[];
  /** Cron `5L`: the last Friday. */
  lastWeekday: number[];
  /** systemd: a time zone after the time (runs are still shown in local time). */
  timezone?: string;
}

interface Range {
  name: string;
  min: number;
  max: number;
  names?: string[];
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const MONTH_NAMES = [
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
export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const R = {
  second: { name: "second", min: 0, max: 59 },
  minute: { name: "minute", min: 0, max: 59 },
  hour: { name: "hour", min: 0, max: 23 },
  day: { name: "day of month", min: 1, max: 31 },
  month: { name: "month", min: 1, max: 12, names: MONTHS },
  weekday: { name: "day of week", min: 0, max: 7, names: DAYS },
  year: { name: "year", min: 1970, max: 2199 },
} satisfies Record<string, Range>;

export const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

const any = (r: Range): Field => ({
  parts: [{ kind: "any", from: r.min, to: r.max, step: 1 }],
  values: span(r.min, r.max, 1),
  star: true,
});
const single = (n: number): Field => ({
  parts: [{ kind: "value", from: n, to: n, step: 1 }],
  values: [n],
  star: false,
});

function span(from: number, to: number, step: number): number[] {
  const out: number[] = [];
  for (let n = from; n <= to; n += step) out.push(n);
  return out;
}

function number(text: string, r: Range): number {
  const lower = text.toLowerCase();
  const named = r.names?.indexOf(lower.slice(0, 3)) ?? -1;
  if (named >= 0 && /^[a-z]+$/.test(lower)) return named + (r.min === 1 ? 1 : 0);
  if (!/^\d+$/.test(text)) throw new Error(`“${text}” is not a valid ${r.name}`);
  const n = Number(text);
  if (n < r.min || n > r.max) {
    throw new Error(`${r.name[0].toUpperCase()}${r.name.slice(1)} ${n} is out of range (${r.min}–${r.max})`);
  }
  return n;
}

function finish(parts: Part[], r: Range, star: boolean): Field {
  const set = new Set<number>();
  for (const p of parts) for (const n of span(p.from, p.to, p.step)) set.add(r === R.weekday && n === 7 ? 0 : n);
  return { parts, values: [...set].sort((a, b) => a - b), star };
}

/** One cron field: `*`, `5`, `1-5`, `*\/15`, `10-50/10`, `MON-FRI`, lists of those. */
export function parseCronField(text: string, r: Range): Field {
  if (text === "*" || text === "?") return any(r);
  const parts = text.split(",").map((piece): Part => {
    if (!piece) throw new Error(`Empty value in the ${r.name} field`);
    const [base, stepText, extra] = piece.split("/");
    if (extra !== undefined) throw new Error(`“${piece}” has two steps`);
    let step = 1;
    if (stepText !== undefined) {
      if (!/^\d+$/.test(stepText) || Number(stepText) === 0) throw new Error(`“/${stepText}” is not a valid step`);
      step = Number(stepText);
    }
    let from: number, to: number;
    if (base === "*" || base === "?") [from, to] = [r.min, r === R.weekday ? 6 : r.max];
    else if (base.includes("-")) {
      const [a, b] = base.split("-");
      [from, to] = [number(a, r), number(b, r)];
      if (from > to) {
        if (r === R.weekday && to === 0) to = 7; // FRI-SUN
        else throw new Error(`Range ${base} goes backwards`);
      }
    } else {
      from = number(base, r);
      // `5/15` (Quartz, Vixie): from 5 to the end.
      to = stepText === undefined ? from : r === R.weekday ? 6 : r.max;
    }
    const kind = stepText !== undefined ? "step" : base === "*" ? "any" : from === to ? "value" : "range";
    return { kind, from, to, step };
  });
  return finish(parts, r, false);
}

const blank = (): Omit<Schedule, "kind" | "source" | "hasSeconds"> => ({
  second: single(0),
  minute: any(R.minute),
  hour: any(R.hour),
  day: any(R.day),
  month: any(R.month),
  weekday: any(R.weekday),
  lastDays: [],
  nth: [],
  lastWeekday: [],
});

/** A cron expression: 5 fields, 6 with seconds first, 7 with a year last, or a `@macro`. */
export function parseCron(input: string): Schedule {
  const source = input.trim();
  if (!source) throw new Error("Type a cron expression, like */5 * * * *");
  const lower = source.toLowerCase();
  if (lower === "@reboot") {
    return { ...blank(), kind: "cron", source, macro: "@reboot", reboot: true, hasSeconds: false };
  }
  if (lower.startsWith("@")) {
    const expanded = MACROS[lower];
    if (!expanded) throw new Error(`Unknown shorthand ${source}: use @yearly, @monthly, @weekly, @daily or @hourly`);
    return { ...parseCron(expanded), source, macro: lower };
  }
  const fields = source.split(/\s+/);
  if (fields.length < 5) throw new Error(`A cron expression has 5 fields, this one has ${fields.length}`);
  if (fields.length > 7) throw new Error(`A cron expression has 5 to 7 fields, this one has ${fields.length}`);
  const hasSeconds = fields.length >= 6;
  const [sec, min, hour, dom, mon, dow, year] = hasSeconds ? fields : ["0", ...fields];
  const s: Schedule = {
    ...blank(),
    kind: "cron",
    source,
    hasSeconds,
    second: parseCronField(sec, R.second),
    minute: parseCronField(min, R.minute),
    hour: parseCronField(hour, R.hour),
    month: parseCronField(mon, R.month),
  };
  // Day of month: `L` (last day), `L-3` (three days before the end).
  const lastDom = dom.toUpperCase().match(/^L(?:-(\d+))?$/);
  if (lastDom) {
    s.day = { parts: [], values: [], star: false };
    s.lastDays = [Number(lastDom[1] ?? 0)];
  } else s.day = parseCronField(dom, R.day);
  // Day of week: `5#3` (third Friday), `5L` / `FRIL` (last Friday).
  const nth = dow.match(/^(\w+)#([1-5])$/);
  const lastDow = dow.match(/^(\w+?)L$/i);
  if (nth) {
    s.weekday = { parts: [], values: [], star: false };
    s.nth = [{ weekday: number(nth[1], R.weekday) % 7, n: Number(nth[2]) }];
  } else if (lastDow && dow.toUpperCase() !== "L") {
    s.weekday = { parts: [], values: [], star: false };
    s.lastWeekday = [number(lastDow[1], R.weekday) % 7];
  } else s.weekday = parseCronField(dow, R.weekday);
  if (year !== undefined && year !== "*") s.year = parseCronField(year, R.year);
  return s;
}

// ---------------------------------------------------------------------------
// systemd calendar events (OnCalendar=)

export const SYSTEMD_SHORTHANDS: Record<string, string> = {
  minutely: "*-*-* *:*:00",
  hourly: "*-*-* *:00:00",
  daily: "*-*-* 00:00:00",
  monthly: "*-*-01 00:00:00",
  weekly: "Mon *-*-* 00:00:00",
  yearly: "*-01-01 00:00:00",
  annually: "*-01-01 00:00:00",
  quarterly: "*-01,04,07,10-01 00:00:00",
  semiannually: "*-01,07-01 00:00:00",
};

const SYSTEMD_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekdayName(text: string): number {
  const i = DAYS.indexOf(text.toLowerCase().slice(0, 3));
  if (i < 0 || !/^[a-z]+$/i.test(text)) throw new Error(`“${text}” is not a day of the week`);
  return i;
}

/** `Mon..Fri,Sun` → weekdays. */
function systemdWeekdays(text: string): Field {
  const parts = text.split(",").map((piece): Part => {
    const [a, b] = piece.split("..");
    const from = weekdayName(a);
    if (b === undefined) return { kind: "value", from, to: from, step: 1 };
    let to = weekdayName(b);
    if (to < from) to += 7; // Sat..Mon
    return { kind: "range", from, to, step: 1 };
  });
  const values = [...new Set(parts.flatMap((p) => span(p.from, p.to, 1).map((n) => n % 7)))].sort((a, b) => a - b);
  return { parts, values, star: false };
}

/** One component of a systemd date or time: `*`, `5`, `1..5`, `0/15`, `1..20/5`, lists. */
export function parseSystemdComponent(text: string, r: Range): Field {
  if (text === "*") return any(r);
  const parts = text.split(",").map((piece): Part => {
    const [base, stepText] = piece.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`“/${stepText}” is not a valid repetition`);
    let from: number, to: number;
    if (base === "*") [from, to] = [r.min, r.max];
    else if (base.includes("..")) {
      const [a, b] = base.split("..");
      [from, to] = [number(a, r), number(b, r)];
      if (from > to) throw new Error(`Range ${base} goes backwards`);
    } else {
      from = number(base, r);
      to = stepText === undefined ? from : r.max;
    }
    const kind = stepText !== undefined ? "step" : base === "*" ? "any" : from === to ? "value" : "range";
    return { kind, from, to, step };
  });
  return finish(parts, r, false);
}

/** `~07/1` → the 7th last day and every day after it: offsets 6…0 from the end. */
function lastDays(text: string): number[] {
  const r = { name: "day from the end", min: 1, max: 31 };
  const out = new Set<number>();
  for (const piece of text.split(",")) {
    const [base, stepText] = piece.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`“/${stepText}” is not a valid repetition`);
    const [a, b] = base.split("..");
    const from = number(a, r);
    // Towards the end of the month: ~07/2 is the 7th, 5th, 3rd and last day.
    const to = b !== undefined ? number(b, r) : stepText !== undefined ? 1 : from;
    const [hi, lo] = from >= to ? [from, to] : [to, from];
    for (let n = hi; n >= lo; n -= step) out.add(n - 1);
  }
  return [...out].sort((x, y) => x - y);
}

const looksLikeZone = (t: string) => /^(UTC|GMT|[A-Z][A-Za-z_]+\/[A-Za-z_/+-]+|[A-Z]{3,4})$/.test(t);

/** A systemd `OnCalendar=` value: `Mon..Fri *-*-* 09:00:00`, `daily`, `*-*~01 12:00`… */
export function parseSystemd(input: string): Schedule {
  const source = input.trim();
  if (!source) throw new Error("Type a calendar event, like Mon..Fri 09:00");
  const tokens = source.split(/\s+/);
  let timezone: string | undefined;
  if (
    tokens.length > 1 && looksLikeZone(tokens[tokens.length - 1]) &&
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/.test(tokens[tokens.length - 1])
  ) {
    timezone = tokens.pop();
  }
  const shorthand = SYSTEMD_SHORTHANDS[tokens.join(" ").toLowerCase()];
  if (shorthand) return { ...parseSystemd(shorthand), source, macro: tokens.join(" ").toLowerCase(), timezone };
  const s: Schedule = { ...blank(), kind: "systemd", source, hasSeconds: true, timezone };
  let i = 0;
  if (/^[a-z]/i.test(tokens[0])) s.weekday = systemdWeekdays(tokens[i++]);
  let date: string | undefined, time: string | undefined;
  for (const t of tokens.slice(i)) {
    if (t.includes(":")) {
      if (time) throw new Error(`Two times in “${source}”`);
      time = t;
    } else if (/[-~]/.test(t)) {
      if (date || time) throw new Error(`Unexpected “${t}”: the date comes before the time`);
      date = t;
    } else throw new Error(`“${t}” is neither a date (*-*-01) nor a time (09:00)`);
  }
  if (date) {
    const m = date.match(/^(?:([^-~]+)-)?([^-~]+)([-~])([^-~]+)$/);
    if (!m) throw new Error(`“${date}” is not a date like *-*-01 or 2026-10-28`);
    const [, y, mon, sep, d] = m;
    if (y !== undefined && y !== "*") s.year = parseSystemdComponent(y, R.year);
    s.month = parseSystemdComponent(mon, R.month);
    if (sep === "~") {
      // `~01` is the last day, `~07/1` the last seven days.
      s.day = { parts: [], values: [], star: false };
      s.lastDays = lastDays(d);
    } else s.day = parseSystemdComponent(d, R.day);
  }
  if (time) {
    const pieces = time.split(":");
    if (pieces.length < 2 || pieces.length > 3) throw new Error(`“${time}” is not a time like 09:00 or 09:00:30`);
    s.hour = parseSystemdComponent(pieces[0], R.hour);
    s.minute = parseSystemdComponent(pieces[1], R.minute);
    // Fractions of seconds can't be scheduled more finely than seconds here.
    s.second = pieces[2] === undefined ? single(0) : parseSystemdComponent(pieces[2].replace(/\.\d+$/, ""), R.second);
  } else {
    s.hour = single(0);
    s.minute = single(0);
    s.second = single(0);
  }
  return s;
}

/** Cron when it looks like cron, else systemd. */
export function parseAny(input: string): Schedule {
  const text = input.trim();
  const cronLike = text.startsWith("@") || /^[\d*?,\/\-a-z#LW]+(\s+[\d*?,\/\-a-z#LW]+){4,6}$/i.test(text);
  if (cronLike && !/\.\.|:|~/.test(text)) {
    try {
      return parseCron(text);
    } catch (e) {
      if (text.startsWith("@") || !/[a-z]{4,}/i.test(text)) throw e;
    }
  }
  try {
    return parseSystemd(text);
  } catch (e) {
    // Only cron characters and no date or time: the cron error is the useful one.
    if (/^[\d*?,\/\s]+$/.test(text) || cronLike) return parseCron(text);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Next runs

const daysIn = (year: number, month0: number) => new Date(year, month0 + 1, 0).getDate();

export function dayMatches(s: Schedule, date: Date): boolean {
  const d = date.getDate(), wd = date.getDay();
  const dim = daysIn(date.getFullYear(), date.getMonth());
  const domRestricted = !s.day.star || s.lastDays.length > 0;
  const dowRestricted = !s.weekday.star || s.nth.length > 0 || s.lastWeekday.length > 0;
  const dom = s.day.values.includes(d) || s.lastDays.includes(dim - d);
  const dow = s.weekday.values.includes(wd) ||
    s.nth.some((x) => x.weekday === wd && Math.ceil(d / 7) === x.n) ||
    s.lastWeekday.some((w) => w === wd && d + 7 > dim);
  if (domRestricted && dowRestricted) return s.kind === "cron" ? dom || dow : dom && dow;
  if (domRestricted) return dom;
  if (dowRestricted) return dow;
  return true;
}

/** The first time strictly after `after` matching the schedule, in local time. */
export function nextRun(s: Schedule, after: Date): Date | undefined {
  if (s.reboot) return undefined;
  let t = new Date(after.getTime());
  t.setMilliseconds(0);
  t = new Date(t.getTime() + 1000);
  const limit = after.getFullYear() + 30;
  for (let i = 0; i < 200_000; i++) {
    const y = t.getFullYear(), mo = t.getMonth(), d = t.getDate(), h = t.getHours(), mi = t.getMinutes();
    const prev = t.getTime();
    if (y > limit || (s.year && y > Math.max(...s.year.values))) return undefined;
    if (s.year && !s.year.values.includes(y)) t = new Date(y + 1, 0, 1);
    else if (!s.month.values.includes(mo + 1)) t = new Date(y, mo + 1, 1);
    else if (!dayMatches(s, t)) t = new Date(y, mo, d + 1);
    else if (!s.hour.values.includes(h)) t = new Date(y, mo, d, h + 1);
    else if (!s.minute.values.includes(mi)) t = new Date(y, mo, d, h, mi + 1);
    else if (!s.second.values.includes(t.getSeconds())) t = new Date(y, mo, d, h, mi, t.getSeconds() + 1);
    else return t;
    // A repeated hour when clocks go back: never move backwards.
    if (t.getTime() <= prev) t = new Date(prev + 1000);
  }
  return undefined;
}

export function nextRuns(s: Schedule, from: Date, count = 10): Date[] {
  const out: Date[] = [];
  let t = from;
  while (out.length < count) {
    const n = nextRun(s, t);
    if (!n) break;
    out.push(n);
    t = n;
  }
  return out;
}

// ---------------------------------------------------------------------------
// English

const pad = (n: number) => String(n).padStart(2, "0");
const clock = (h: number, m: number, sec?: number) => `${pad(h)}:${pad(m)}${sec ? `:${pad(sec)}` : ""}`;

export function joinWords(words: string[], last = "and"): string {
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

const isValues = (f: Field) => !f.star && f.parts.every((p) => p.kind === "value");
const isSingle = (f: Field) => isValues(f) && f.values.length === 1;
const onlyStep = (f: Field, r: Range) =>
  f.parts.length === 1 && f.parts[0].kind === "step" && f.parts[0].from === r.min &&
  f.parts[0].to >= (r === R.weekday ? 6 : r.max);

/** `1-5` → "1 through 5"; lists joined. `name` turns numbers into words. */
function describeParts(f: Field, name: (n: number) => string, unit: string): string {
  return joinWords(f.parts.map((p) => {
    if (p.kind === "value") return name(p.from);
    if (p.kind === "range") return `${name(p.from)} through ${name(p.to)}`;
    if (p.kind === "step") {
      const every = `every ${ordinal(p.step)} ${unit}`;
      return `${every} from ${name(p.from)} through ${name(p.to)}`;
    }
    return `every ${unit}`;
  }));
}

function describeTime(s: Schedule): string {
  const { second: sec, minute: min, hour } = s;
  const secs = s.hasSeconds && !(isSingle(sec) && sec.values[0] === 0);
  // At 09:30, at 09:00 and 17:00.
  if (isValues(min) && isValues(hour) && (!secs || isSingle(sec)) && min.values.length * hour.values.length <= 6) {
    const times = hour.values.flatMap((h) => min.values.map((m) => clock(h, m, secs ? sec.values[0] : undefined)));
    return `At ${joinWords(times)}`;
  }
  let secPart = "";
  if (secs) {
    if (sec.star) secPart = "Every second";
    else if (onlyStep(sec, R.second)) secPart = `Every ${sec.parts[0].step} seconds`;
    else secPart = `At second ${describeParts(sec, String, "second")}`;
  }
  let minPart: string;
  if (min.star) minPart = secs ? "" : "every minute";
  else if (onlyStep(min, R.minute)) minPart = `every ${min.parts[0].step} minutes`;
  else if (isValues(min)) minPart = `at minute${min.values.length > 1 ? "s" : ""} ${joinWords(min.values.map(String))}`;
  else minPart = `at minutes ${describeParts(min, String, "minute")}`;
  let hourPart: string;
  if (hour.star) hourPart = min.star || onlyStep(min, R.minute) ? "" : "past every hour";
  else if (hour.parts.length === 1 && hour.parts[0].kind === "step") {
    const p = hour.parts[0];
    const window = onlyStep(hour, R.hour) ? "" : ` from ${clock(p.from, 0)} through ${clock(p.to, 59)}`;
    hourPart = min.star || onlyStep(min, R.minute)
      ? `every ${p.step} hours${window}`
      : `past every ${ordinal(p.step)} hour${window}`;
  } else if (hour.parts.length === 1 && hour.parts[0].kind === "range") {
    hourPart = `between ${clock(hour.parts[0].from, 0)} and ${clock(hour.parts[0].to, 59)}`;
  } else if (isSingle(hour)) hourPart = `between ${clock(hour.values[0], 0)} and ${clock(hour.values[0], 59)}`;
  else if (isValues(hour)) hourPart = `during hours ${joinWords(hour.values.map(pad))}`;
  else hourPart = `during hours ${describeParts(hour, pad, "hour")}`;
  const words = [secPart, minPart, hourPart].filter(Boolean).join(minPart && secPart ? ", " : " ");
  return words[0].toUpperCase() + words.slice(1);
}

function describeDays(s: Schedule): string {
  const dom: string[] = [];
  if (s.lastDays.length) {
    const sorted = [...s.lastDays].sort((a, b) => a - b);
    if (sorted.length === 1 && sorted[0] === 0) dom.push("on the last day of the month");
    else if (sorted.length === 1) {
      dom.push(`${sorted[0]} day${sorted[0] > 1 ? "s" : ""} before the last day of the month`);
    } else if (sorted.every((n, i) => n === i)) dom.push(`on the last ${sorted.length} days of the month`);
    else dom.push(`on days ${joinWords(sorted.map((n) => n === 0 ? "last" : `last − ${n}`))} of the month`);
  }
  if (!s.day.star && s.day.parts.length) {
    const f = s.day;
    if (onlyStep(f, R.day)) dom.push(`every ${f.parts[0].step} days`);
    else if (isValues(f)) {
      dom.push(`on day${f.values.length > 1 ? "s" : ""} ${joinWords(f.values.map(String))} of the month`);
    } else dom.push(`on days ${describeParts(f, String, "day")} of the month`);
  }
  const dow: string[] = [];
  for (const x of s.nth) {
    dow.push(`on the ${["", "first", "second", "third", "fourth", "fifth"][x.n]} ${DAY_NAMES[x.weekday]} of the month`);
  }
  for (const w of s.lastWeekday) dow.push(`on the last ${DAY_NAMES[w]} of the month`);
  if (!s.weekday.star && s.weekday.parts.length) {
    const f = s.weekday;
    const name = (n: number) => DAY_NAMES[n % 7];
    if (f.values.join() === "1,2,3,4,5") dow.push("on weekdays");
    else if (f.values.join() === "0,6") dow.push("on weekends");
    else if (isValues(f)) dow.push(`on ${joinWords(f.values.map(name))}`);
    else dow.push(`on ${describeParts(f, name, "day of the week")}`);
  }
  if (dom.length && dow.length) {
    if (s.kind === "cron") return `${joinWords(dom)}, or ${joinWords(dow, "or")}`;
    // systemd: both must match, e.g. the last seven days that are a Friday.
    if (s.lastDays.length === 7 && s.lastDays.every((n) => n < 7) && isSingle(s.weekday)) {
      return `on the last ${DAY_NAMES[s.weekday.values[0]]} of the month`;
    }
    const nth = ["01..07", "08..14", "15..21", "22..28"].indexOf(systemdComponent(s.day, R.day));
    if (nth >= 0 && !s.lastDays.length && isSingle(s.weekday)) {
      return `on the ${["first", "second", "third", "fourth"][nth]} ${DAY_NAMES[s.weekday.values[0]]} of the month`;
    }
    return `${joinWords(dom)}, if it is ${joinWords(dow.map((d) => d.replace(/^on /, "a ")), "or")}`;
  }
  return joinWords([...dom, ...dow], dom.length ? "and" : "or");
}

function describeMonths(s: Schedule): string {
  const f = s.month;
  if (f.star) return "";
  if (onlyStep(f, R.month)) return `every ${f.parts[0].step} months`;
  return `in ${describeParts(f, (n) => MONTH_NAMES[n - 1], "month")}`;
}

/** "At 09:00, on weekdays". */
export function explain(s: Schedule): string {
  if (s.reboot) return "Once, when the system starts";
  const parts = [describeTime(s), describeDays(s), describeMonths(s)];
  if (s.year) parts.push(`in ${describeParts(s.year, String, "year")}`);
  return parts.filter(Boolean).join(", ");
}

/** One line per field, for the side panel. */
export function fieldLines(s: Schedule): [string, string][] {
  const text = (f: Field, r: Range, name: (n: number) => string = String) =>
    f.star ? "every" : f.parts.length ? describeParts(f, name, r.name) : "";
  const lines: [string, string][] = [];
  if (s.hasSeconds) lines.push(["Second", text(s.second, R.second)]);
  lines.push(["Minute", text(s.minute, R.minute)], ["Hour", text(s.hour, R.hour)]);
  const days = describeDays({ ...s, weekday: any(R.weekday), nth: [], lastWeekday: [] });
  lines.push(["Day of month", days ? days.replace(/^on /, "") : "every"]);
  lines.push(["Month", text(s.month, R.month, (n) => MONTH_NAMES[n - 1])]);
  const dows = describeDays({ ...s, day: any(R.day), lastDays: [] });
  lines.push(["Day of week", dows ? dows.replace(/^on /, "") : "every"]);
  if (s.year) lines.push(["Year", text(s.year, R.year)]);
  return lines;
}

// ---------------------------------------------------------------------------
// Conversion

function systemdComponent(f: Field, r: Range): string {
  if (f.star) return "*";
  return f.parts.map((p) => {
    const v = (n: number) => r === R.year ? String(n) : pad(n);
    if (p.kind === "value") return v(p.from);
    if (p.kind === "range") return `${v(p.from)}..${v(p.to)}`;
    if (p.kind === "any") return "*";
    return p.to >= r.max ? `${v(p.from)}/${p.step}` : `${v(p.from)}..${v(p.to)}/${p.step}`;
  }).join(",");
}

function systemdWeekdayList(values: number[]): string {
  // Monday first; runs of 3+ days become ranges.
  const order = [1, 2, 3, 4, 5, 6, 0].filter((d) => values.includes(d));
  const out: string[] = [];
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && (order[j + 1] - order[j] + 7) % 7 === 1) j++;
    if (j - i >= 2) out.push(`${SYSTEMD_DAYS[order[i]]}..${SYSTEMD_DAYS[order[j]]}`);
    else for (let k = i; k <= j; k++) out.push(SYSTEMD_DAYS[order[k]]);
    i = j + 1;
  }
  return out.join(",");
}

/** Offsets from the end → `~01`, `~07/1` (the last seven days) or `~01,03`. */
function lastDaysComponent(offsets: number[]): string {
  const sorted = [...offsets].sort((a, b) => a - b);
  if (sorted.length > 1 && sorted.every((n, i) => n === i)) return `~${pad(sorted.length)}/1`;
  return `~${sorted.map((n) => pad(n + 1)).join(",")}`;
}

const NTH_DAYS = ["", "01..07", "08..14", "15..21", "22..28", "29..31"];

/** The `OnCalendar=` lines matching a cron schedule (several when cron's day-of-month OR day-of-week can't be one line). */
export function toSystemd(s: Schedule): string[] {
  if (s.reboot) throw new Error("@reboot has no calendar equivalent: use OnBootSec= in the timer instead");
  const time = `${systemdComponent(s.hour, R.hour)}:${systemdComponent(s.minute, R.minute)}:${
    systemdComponent(s.second, R.second)
  }`;
  const year = s.year ? systemdComponent(s.year, R.year) : "*";
  const month = systemdComponent(s.month, R.month);
  const date = (day: string) => `${year}-${month}${day.startsWith("~") ? day : `-${day}`}`;
  const lines: string[] = [];
  const domRestricted = !s.day.star || s.lastDays.length > 0;
  const plainDow = !s.weekday.star && s.weekday.values.length > 0;
  const dowRestricted = plainDow || s.nth.length > 0 || s.lastWeekday.length > 0;
  const dayFields: string[] = [];
  if (!s.day.star && s.day.parts.length) dayFields.push(systemdComponent(s.day, R.day));
  if (s.lastDays.length) dayFields.push(lastDaysComponent(s.lastDays));
  if (s.kind === "systemd" || !(domRestricted && dowRestricted)) {
    const dow = plainDow ? `${systemdWeekdayList(s.weekday.values)} ` : "";
    if (!dowRestricted || plainDow) {
      if (!dayFields.length) lines.push(`${dow}${date("*")} ${time}`);
      for (const d of dayFields) lines.push(`${dow}${date(d)} ${time}`);
    }
  } else {
    for (const d of dayFields) lines.push(`${date(d)} ${time}`);
    if (plainDow) lines.push(`${systemdWeekdayList(s.weekday.values)} ${date("*")} ${time}`);
  }
  for (const x of s.nth) lines.push(`${SYSTEMD_DAYS[x.weekday]} ${date(NTH_DAYS[x.n])} ${time}`);
  for (const w of s.lastWeekday) lines.push(`${SYSTEMD_DAYS[w]} ${year}-${month}~07/1 ${time}`);
  // `*-*-* 00:00:00` reads better as the shorthand systemd prints.
  return lines.map((l) => l === "*-*-* 00:00:00" ? "daily" : l === "*-*-* *:00:00" ? "hourly" : l);
}

function cronComponent(f: Field, r: Range): string {
  if (f.star) return "*";
  const max = r === R.weekday ? 6 : r.max;
  return f.parts.map((p) => {
    if (p.kind === "value") return String(p.from);
    if (p.kind === "range") return `${p.from}-${p.to}`;
    if (p.kind === "any") return "*";
    if (p.from === r.min && p.to >= max) return `*/${p.step}`;
    return `${p.from}-${Math.min(p.to, max)}/${p.step}`;
  }).join(",");
}

/** The cron line for a systemd schedule; throws when cron can't say it. */
export function toCron(s: Schedule): string {
  if (s.kind === "cron") return s.source;
  if (s.year) throw new Error("Cron has no year field: this calendar event names specific years");
  const sec = cronComponent(s.second, R.second);
  let dom = s.day.star ? "*" : cronComponent(s.day, R.day);
  let dow = s.weekday.star ? "*" : s.weekday.values.join(",");
  const range = s.weekday.parts.length === 1 && s.weekday.parts[0].kind === "range" ? s.weekday.parts[0] : undefined;
  if (range && range.to <= 7) dow = `${range.from}-${range.to}`;
  const last = [...s.lastDays].sort((a, b) => a - b);
  if (last.length) {
    if (!s.day.star && s.day.parts.length) throw new Error("Cron can't combine days from the end with other days");
    if (last.length === 7 && last[6] === 6 && isSingle(s.weekday)) {
      [dom, dow] = ["*", `${s.weekday.values[0]}L`];
    } else if (last.length === 1) dom = last[0] ? `L-${last[0]}` : "L";
    else throw new Error("Cron can only say the last day of the month (L)");
  } else if (!s.day.star && !s.weekday.star) {
    // Cron reads both as OR; only "the Nth weekday" can be said.
    const n = NTH_DAYS.indexOf(systemdComponent(s.day, R.day));
    if (n > 0 && isSingle(s.weekday)) [dom, dow] = ["*", `${s.weekday.values[0]}#${n}`];
    else throw new Error("Cron runs when the day of month OR the weekday matches, systemd when both do");
  }
  const fields = [
    cronComponent(s.minute, R.minute),
    cronComponent(s.hour, R.hour),
    dom,
    cronComponent(s.month, R.month),
    dow,
  ];
  return sec === "0" ? fields.join(" ") : [sec, ...fields].join(" ");
}

// ---------------------------------------------------------------------------
// Presentation

export interface Preset {
  cron: string;
  title: string;
}

export const PRESETS: Preset[] = [
  { cron: "* * * * *", title: "Every minute" },
  { cron: "*/5 * * * *", title: "Every 5 minutes" },
  { cron: "*/15 * * * *", title: "Every 15 minutes" },
  { cron: "0 * * * *", title: "Every hour" },
  { cron: "0 */6 * * *", title: "Every 6 hours" },
  { cron: "0 0 * * *", title: "Every day at midnight" },
  { cron: "0 9 * * *", title: "Every day at 09:00" },
  { cron: "0 9 * * 1-5", title: "Weekdays at 09:00" },
  { cron: "*/30 9-17 * * 1-5", title: "Every 30 minutes during office hours" },
  { cron: "0 0 * * 0", title: "Every Sunday at midnight" },
  { cron: "0 3 * * 6", title: "Every Saturday at 03:00" },
  { cron: "0 0 1 * *", title: "First day of the month" },
  { cron: "0 0 L * *", title: "Last day of the month" },
  { cron: "0 10 * * 1#1", title: "First Monday of the month at 10:00" },
  { cron: "0 0 1 */3 *", title: "Every quarter" },
  { cron: "0 0 1 1 *", title: "Every year on January 1st" },
  { cron: "@reboot", title: "At startup" },
];

/** "in 5 min", "in 3 h", "in 2 days". */
export function until(date: Date, now: Date): string {
  const s = Math.round((date.getTime() - now.getTime()) / 1000);
  if (s < 60) return `in ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 36) return `in ${h} h`;
  const d = Math.round(h / 24);
  if (d < 60) return `in ${d} days`;
  const mo = Math.round(d / 30);
  if (mo < 24) return `in ${mo} months`;
  return `in ${Math.round(d / 365)} years`;
}

/** "Wed 28 Oct 2026, 09:00" in local time. */
export function formatRun(d: Date, seconds = false): string {
  const day = `${DAY_NAMES[d.getDay()].slice(0, 3)} ${d.getDate()} ${
    MONTH_NAMES[d.getMonth()].slice(0, 3)
  } ${d.getFullYear()}`;
  return `${day}, ${clock(d.getHours(), d.getMinutes(), seconds ? d.getSeconds() : undefined)}`;
}

/** A timer unit to paste into `~/.config/systemd/user/<name>.timer`. */
export function timerUnit(lines: string[], description: string): string {
  return [
    "[Unit]",
    `Description=${description}`,
    "",
    "[Timer]",
    ...lines.map((l) => `OnCalendar=${l}`),
    "Persistent=true",
    "",
    "[Install]",
    "WantedBy=timers.target",
  ].join("\n");
}
