// Crontab and systemd timer parsing, schedules in words and next/previous runs. No I/O here.

// ---------------------------------------------------------------------------
// Cron expressions

export const MONTHS = [
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
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const MONTH_ABBR = MONTHS.map((m) => m.slice(0, 3).toLowerCase());
const DAY_ABBR = WEEKDAYS.map((d) => d.slice(0, 3).toLowerCase());

/** The `@…` shortcuts of cron, as five fields. */
export const MACROS: Record<string, string> = {
  "@yearly": "0 0 1 1 *",
  "@annually": "0 0 1 1 *",
  "@monthly": "0 0 1 * *",
  "@weekly": "0 0 * * 0",
  "@daily": "0 0 * * *",
  "@midnight": "0 0 * * *",
  "@hourly": "0 * * * *",
};

interface Range {
  min: number;
  max: number;
  names?: string[];
}

const RANGES: Range[] = [
  { min: 0, max: 59 },
  { min: 0, max: 23 },
  { min: 1, max: 31 },
  { min: 1, max: 12, names: MONTH_ABBR },
  { min: 0, max: 7, names: DAY_ABBR },
];

export interface CronSchedule {
  /** `@reboot`: runs once when cron starts, no next run. */
  reboot?: boolean;
  /** Allowed values, sorted. */
  minutes: number[];
  hours: number[];
  days: number[];
  months: number[];
  /** 0 = Sunday (7 is folded into 0). */
  weekdays: number[];
  /** `*` (or `*` with a step) in the day-of-month / day-of-week field. */
  anyDay: boolean;
  anyWeekday: boolean;
  /** The five fields as written (macros expanded). */
  fields: string[];
}

function value(text: string, r: Range): number {
  const lower = text.toLowerCase();
  const named = r.names?.indexOf(lower) ?? -1;
  if (named >= 0) return named + (r.min === 1 ? 1 : 0);
  if (!/^\d+$/.test(text)) throw new Error(`“${text}” is not a number`);
  const n = Number(text);
  if (n < r.min || n > r.max) throw new Error(`${n} is out of range ${r.min}–${r.max}`);
  return n;
}

/** One cron field (`*`, `1-5`, `*\/15`, `mon,wed`, `0-30/10`) → its values. */
export function parseField(text: string, r: Range): number[] {
  const out = new Set<number>();
  for (const part of text.split(",")) {
    const [base, stepText] = part.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in “${part}”`);
    let from: number, to: number;
    if (base === "*") [from, to] = [r.min, r.max];
    else if (base.includes("-")) {
      const [a, b] = base.split("-");
      [from, to] = [value(a, r), value(b, r)];
      if (from > to) throw new Error(`Range “${base}” goes backwards`);
    } else {
      from = value(base, r);
      to = stepText === undefined ? from : r.max;
    }
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return [...out].sort((a, b) => a - b);
}

/** A cron expression (five fields or an `@` macro) → its schedule; throws on a bad one. */
export function parseCron(expr: string): CronSchedule {
  const text = expr.trim().toLowerCase();
  if (text === "@reboot") {
    return {
      reboot: true,
      minutes: [],
      hours: [],
      days: [],
      months: [],
      weekdays: [],
      anyDay: true,
      anyWeekday: true,
      fields: [],
    };
  }
  const fields = (MACROS[text] ?? expr.trim()).split(/\s+/);
  if (fields.length !== 5) throw new Error("A cron schedule has five fields");
  const [minutes, hours, days, months, weekdaysRaw] = fields.map((f, i) => parseField(f, RANGES[i]));
  const weekdays = [...new Set(weekdaysRaw.map((d) => d % 7))].sort((a, b) => a - b);
  return {
    minutes,
    hours,
    days,
    months,
    weekdays,
    anyDay: fields[2].startsWith("*"),
    anyWeekday: fields[4].startsWith("*"),
    fields,
  };
}

/** Cron's rule: when both day fields are restricted, either one matching is enough. */
export function dayMatches(s: CronSchedule, d: Date): boolean {
  if (!s.months.includes(d.getMonth() + 1)) return false;
  const dom = s.days.includes(d.getDate());
  const dow = s.weekdays.includes(d.getDay());
  if (s.anyDay && s.anyWeekday) return true;
  if (s.anyDay) return dow;
  if (s.anyWeekday) return dom;
  return dom || dow;
}

/** The first run strictly after `after` (local time), within eight years. */
export function nextRun(s: CronSchedule, after: Date): Date | undefined {
  if (s.reboot) return undefined;
  const start = new Date(after.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);
  const day = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  for (let i = 0; i < 366 * 8; i++, day.setDate(day.getDate() + 1)) {
    if (!dayMatches(s, day)) continue;
    const sameDay = i === 0;
    for (const h of s.hours) {
      if (sameDay && h < start.getHours()) continue;
      for (const m of s.minutes) {
        if (sameDay && h === start.getHours() && m < start.getMinutes()) continue;
        return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      }
    }
  }
  return undefined;
}

/** The last run at or before `before` (local time), within eight years. */
export function previousRun(s: CronSchedule, before: Date): Date | undefined {
  if (s.reboot) return undefined;
  const end = new Date(before.getTime());
  end.setSeconds(0, 0);
  const day = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  for (let i = 0; i < 366 * 8; i++, day.setDate(day.getDate() - 1)) {
    if (!dayMatches(s, day)) continue;
    const sameDay = i === 0;
    for (const h of [...s.hours].reverse()) {
      if (sameDay && h > end.getHours()) continue;
      for (const m of [...s.minutes].reverse()) {
        if (sameDay && h === end.getHours() && m > end.getMinutes()) continue;
        return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m);
      }
    }
  }
  return undefined;
}

export function joinWords(words: string[], last = "and"): string {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;
}

export function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${s}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A cron field in words: `1-5` on weekdays → "Monday to Friday", `*\/2` → "every 2nd". */
function fieldWords(text: string, name: (n: number) => string): string {
  return joinWords(
    text.split(",").map((part) => {
      const [base, step] = part.split("/");
      const n = (t: string) => {
        const i = MONTH_ABBR.indexOf(t.toLowerCase());
        const j = DAY_ABBR.indexOf(t.toLowerCase());
        return i >= 0 ? i + 1 : j >= 0 ? j : Number(t);
      };
      const range = base === "*"
        ? ""
        : base.includes("-")
        ? `${name(n(base.split("-")[0]))} to ${name(n(base.split("-")[1]))}`
        : name(n(base));
      if (step === undefined) return range;
      return range ? `every ${step} from ${range}` : `every ${step}`;
    }),
  );
}

/** "At 05:30, Monday to Friday", "Every 15 minutes", "At 00:00 on day 1 of the month". */
export function explainCron(expr: string): string {
  const s = parseCron(expr);
  if (s.reboot) return "At startup";
  const [mi, ho, dom, mo, dow] = s.fields;
  let time: string;
  const allMinutes = mi === "*";
  const minuteStep = /^\*\/(\d+)$/.exec(mi);
  const fixedTimes = s.minutes.length * s.hours.length;
  if (allMinutes && ho === "*") time = "Every minute";
  else if (minuteStep && ho === "*") time = `Every ${minuteStep[1]} minutes`;
  else if (allMinutes) time = `Every minute during hour${s.hours.length > 1 ? "s" : ""} ${fieldWords(ho, pad)}`;
  else if (ho === "*") {
    time = s.minutes.length === 1 && s.minutes[0] === 0
      ? "Every hour"
      : `At minute ${fieldWords(mi, String)} of every hour`;
  } else if (/^\*\/\d+$/.test(ho) && s.minutes.length === 1) {
    const n = ho.slice(2);
    time = `Every ${n} hours${s.minutes[0] ? ` at minute ${s.minutes[0]}` : ""}`;
  } else if (fixedTimes <= 6) {
    time = `At ${joinWords(s.hours.flatMap((h) => s.minutes.map((m) => `${pad(h)}:${pad(m)}`)))}`;
  } else {
    time = `At minute ${fieldWords(mi, String)} past hour ${fieldWords(ho, pad)}`;
  }
  const parts = [time];
  const domStep = /^\*\/(\d+)$/.exec(dom);
  const days = dom === "*"
    ? ""
    : domStep
    ? `every ${domStep[1]} days`
    : `on day${s.days.length === 1 ? "" : "s"} ${fieldWords(dom, String)}${mo === "*" ? " of the month" : ""}`;
  const weekdays = dow === "*" ? "" : `on ${fieldWords(dow, (d) => WEEKDAYS[d % 7])}`;
  if (days && weekdays) parts.push(`${days} or ${weekdays}`);
  else if (days || weekdays) parts.push(days || weekdays);
  if (mo !== "*") parts.push(`in ${fieldWords(mo, (m) => MONTHS[m - 1])}`);
  return parts.join(", ").replace(/, on /g, " on ");
}

// ---------------------------------------------------------------------------
// Crontab files

export interface CronEntry {
  /** 0-based line number in the file. */
  line: number;
  /** The line exactly as written, to check nothing changed before rewriting the file. */
  raw: string;
  /** False when the line is commented out. */
  enabled: boolean;
  schedule: string;
  /** System crontabs (`/etc/crontab`, `/etc/cron.d`) name the user who runs it. */
  user?: string;
  command: string;
  /** The comment line right above, often a description of the job. */
  note?: string;
}

export interface Crontab {
  entries: CronEntry[];
  /** `MAILTO=…`, `PATH=…` and other variables set in the file. */
  env: Record<string, string>;
}

const SCHEDULE_FIELD = /^[\d*,/\-a-zA-Z]+$/;

/** One line → an entry, or undefined when it is not a job. */
function parseJob(text: string, system: boolean): Omit<CronEntry, "line" | "raw" | "enabled" | "note"> | undefined {
  const words = text.trim().split(/\s+/);
  let schedule: string, rest: string[];
  if (words[0]?.startsWith("@")) {
    if (words[0].toLowerCase() !== "@reboot" && !MACROS[words[0].toLowerCase()]) return undefined;
    schedule = words[0];
    rest = words.slice(1);
  } else {
    if (words.length < 6 || !words.slice(0, 5).every((w) => SCHEDULE_FIELD.test(w))) return undefined;
    schedule = words.slice(0, 5).join(" ");
    rest = words.slice(5);
  }
  try {
    parseCron(schedule);
  } catch {
    return undefined;
  }
  if (system) {
    if (rest.length < 2 || !/^[a-z_][\w.-]*\$?$/i.test(rest[0])) return undefined;
    return { schedule, user: rest[0], command: afterWords(text, words.length - rest.length + 1) };
  }
  if (!rest.length) return undefined;
  return { schedule, command: afterWords(text, words.length - rest.length) };
}

/** The text after the first `n` words, spacing kept. */
function afterWords(text: string, n: number): string {
  const m = new RegExp(`^\\s*(?:\\S+\\s+){${n}}`).exec(text);
  return m ? text.slice(m[0].length).trimEnd() : "";
}

/**
 * A crontab file. With `system`, lines have a user field (`/etc/crontab`, `/etc/cron.d/*`).
 * Commented-out jobs (`# 0 5 * * * backup`) are kept as disabled entries.
 */
export function parseCrontab(text: string, system = false): Crontab {
  const entries: CronEntry[] = [];
  const env: Record<string, string> = {};
  const lines = text.split("\n");
  // A leading block of comments is documentation (Debian's template shows an example job in it).
  let header = 0;
  while (lines[header]?.trim().startsWith("#")) header++;
  if (header < 3) header = 0;
  lines.forEach((raw, line) => {
    const trimmed = raw.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("#")) {
      if (line < header || /user-name|command to be executed/.test(trimmed)) return;
      const job = parseJob(trimmed.replace(/^#+\s*/, ""), system);
      if (job) entries.push({ ...job, line, raw, enabled: false, note: noteAbove(lines, line, system) });
      return;
    }
    const assign = /^([A-Za-z_]\w*)\s*=\s*(.*)$/.exec(trimmed);
    if (assign) {
      env[assign[1]] = assign[2].replace(/^(["'])(.*)\1$/, "$2");
      return;
    }
    const job = parseJob(trimmed, system);
    if (job) entries.push({ ...job, line, raw, enabled: true, note: noteAbove(lines, line, system) });
  });
  return { entries, env };
}

function noteAbove(lines: string[], line: number, system: boolean): string | undefined {
  const above = lines[line - 1]?.trim();
  if (!above?.startsWith("#")) return undefined;
  const text = above.replace(/^#+\s*/, "");
  if (!text || parseJob(text, system) || /^m\s+h\s+dom/i.test(text) || /^[-=#*\s]+$/.test(text)) return undefined;
  return text.length > 120 ? `${text.slice(0, 119)}…` : text;
}

/**
 * The crontab with one job commented out (`enable = false`) or back in.
 * Throws when the line changed since it was read, so nothing is overwritten by mistake.
 */
export function toggleEntry(text: string, entry: CronEntry, enable: boolean): string {
  const lines = text.split("\n");
  if (lines[entry.line] !== entry.raw) {
    throw new Error("The crontab changed since it was loaded: refresh and try again");
  }
  const indent = /^\s*/.exec(entry.raw)![0];
  const body = entry.raw.trim();
  lines[entry.line] = enable ? indent + body.replace(/^#+\s*/, "") : `${indent}# ${body}`;
  const out = lines.join("\n");
  return out.endsWith("\n") ? out : `${out}\n`;
}

/**
 * What cron really runs: the text before the first unescaped `%` (the rest
 * goes to stdin, `%` becoming newlines), with `\%` turned back into `%`.
 */
export function cronCommand(command: string): { command: string; stdin?: string } {
  const m = /(^|[^\\])%/.exec(command);
  const unescape = (s: string) => s.replace(/\\%/g, "%");
  if (!m) return { command: unescape(command) };
  const at = m.index + m[1].length;
  return { command: unescape(command.slice(0, at)), stdin: unescape(command.slice(at + 1)).replace(/%/g, "\n") };
}

/** A shell script that runs a job in a terminal and waits for Enter before closing. */
export function terminalScript(command: string, user?: string, me?: string): string[] {
  const { command: cmd, stdin } = cronCommand(command);
  const body = stdin === undefined ? cmd : `printf '%s\\n' ${shQuote(stdin)} | { ${cmd}; }`;
  const script = `${body}\ncode=$?\necho\nprintf 'Finished with exit code %s. Press Enter to close.' "$code"\nread _`;
  if (user && me && user !== me) return ["sudo", "-u", user, "sh", "-c", script];
  return ["sh", "-c", script];
}

export const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

// ---------------------------------------------------------------------------
// systemd timers

export interface TimerTimes {
  unit: string;
  activates?: string;
  /** Milliseconds since the epoch. */
  next?: number;
  last?: number;
}

const usec = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  // 0 means never; 2^64-1 (USEC_INFINITY) can come as a huge number.
  return Number.isFinite(n) && n > 0 && n < 1e18 ? Math.round(n / 1000) : undefined;
};

/** `systemctl list-timers --all --output=json`. */
export function parseTimerList(json: string): TimerTimes[] {
  const rows = JSON.parse(json || "[]") as Record<string, unknown>[];
  return rows.filter((r) => typeof r.unit === "string").map((r) => ({
    unit: String(r.unit),
    activates: typeof r.activates === "string" && r.activates && r.activates !== "-" ? r.activates : undefined,
    next: usec(r.next),
    last: usec(r.last),
  }));
}

/** `systemctl list-unit-files --type=timer --output=json` → unit → state (`enabled`, `disabled`, `static`…). */
export function parseUnitFiles(json: string): Record<string, string> {
  const rows = JSON.parse(json || "[]") as { unit_file?: string; state?: string }[];
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (r.unit_file?.endsWith(".timer")) out[r.unit_file.split("/").pop()!] = r.state ?? "";
  }
  return out;
}

export interface TimerProps {
  id: string;
  description?: string;
  unit?: string;
  unitFileState?: string;
  activeState?: string;
  persistent?: boolean;
  fragmentPath?: string;
  /** `OnCalendar=` values. */
  calendar: string[];
  /** `OnBootSec=15min`-like values, from `TimersMonotonic`. */
  monotonic: { base: string; value: string }[];
}

/** `systemctl show a.timer b.timer -p …`: blocks separated by blank lines. */
export function parseShow(text: string): TimerProps[] {
  return text.split(/\n\s*\n/).map((block) => {
    const p: TimerProps = { id: "", calendar: [], monotonic: [] };
    for (const line of block.split("\n")) {
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq), val = line.slice(eq + 1);
      if (key === "Id") p.id = val;
      else if (key === "Description") p.description = val || undefined;
      else if (key === "Unit") p.unit = val || undefined;
      else if (key === "UnitFileState") p.unitFileState = val || undefined;
      else if (key === "ActiveState") p.activeState = val || undefined;
      else if (key === "Persistent") p.persistent = val === "yes";
      else if (key === "FragmentPath") p.fragmentPath = val || undefined;
      else if (key === "TimersCalendar") {
        for (const m of val.matchAll(/\{\s*OnCalendar=(.*?)\s*;\s*next_elapse=/g)) p.calendar.push(m[1]);
      } else if (key === "TimersMonotonic") {
        for (const m of val.matchAll(/\{\s*(\w+?)(?:USec)?=(.*?)\s*;\s*next_elapse=/g)) {
          p.monotonic.push({ base: m[1], value: m[2] });
        }
      }
    }
    return p;
  }).filter((p) => p.id);
}

export const CALENDAR_SHORTHANDS: Record<string, string> = {
  minutely: "Every minute",
  hourly: "Every hour",
  daily: "Every day at midnight",
  weekly: "Every Monday at midnight",
  monthly: "On the 1st of every month at midnight",
  yearly: "On 1 January at midnight",
  annually: "On 1 January at midnight",
  quarterly: "On the 1st of January, April, July and October at midnight",
  semiannually: "On 1 January and 1 July at midnight",
};

const SYSTEMD_DAYS: Record<string, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

function systemdDays(spec: string): string {
  return joinWords(
    spec.split(",").map((part) => {
      const [a, b] = part.split("..").map((d) => SYSTEMD_DAYS[d.slice(0, 3).toLowerCase()] ?? d);
      return b ? `${a} to ${b}` : a;
    }),
  );
}

function systemdTime(spec: string): string {
  const [h = "*", m = "00", s = "00"] = spec.split(":");
  const minuteStep = /^(\d+)\/(\d+)$/.exec(m);
  if (h === "*" && m === "*") return "every minute";
  if (h === "*" && minuteStep) return `every ${minuteStep[2]} minutes`;
  if (h === "*") return /^0+$/.test(m) ? "every hour" : `at minute ${Number(m)} of every hour`;
  const hourStep = /^(\d+)\/(\d+)$/.exec(h);
  if (hourStep && /^\d+$/.test(m)) return `every ${hourStep[2]} hours from ${pad(Number(hourStep[1]))}:${m}`;
  if (/^[\d,]+$/.test(h) && /^[\d,]+$/.test(m)) {
    const times = h.split(",").flatMap((hh) => m.split(",").map((mm) => `${pad(Number(hh))}:${pad(Number(mm))}`));
    const sec = /^\d+$/.test(s) && Number(s) ? `:${pad(Number(s))}` : "";
    return `at ${joinWords(times.map((t) => t + sec))}`;
  }
  return `at ${spec}`;
}

function systemdDate(spec: string): string {
  const parts = spec.split("-");
  if (parts.length < 3) return `on ${spec}`;
  const [y, mo, d] = parts;
  const year = y === "*" ? "" : ` ${y}`;
  const day = d === "*"
    ? ""
    : d.includes("/")
    ? `every ${d.split("/")[1]} days from the ${ordinal(Number(d.split("/")[0]))}`
    : `on the ${joinWords(d.split(",").map((x) => ordinal(Number(x))))}`;
  if (mo === "*") return day ? `${day} of every month${year}` : year ? `in${year}` : "";
  const months = joinWords(mo.split(",").map((x) => MONTHS[Number(x) - 1] ?? x));
  return `${day || "every day"} of ${months}${year}`;
}

/** `Mon..Fri *-*-* 06:30:00` → "Monday to Friday at 06:30". Unknown shapes come back as written. */
export function explainCalendar(spec: string): string {
  const text = spec.trim().replace(/\s+(UTC|[A-Z][a-z]+\/[A-Za-z_]+)$/, "");
  const zone = text === spec.trim() ? "" : ` (${spec.trim().slice(text.length).trim()})`;
  const short = CALENDAR_SHORTHANDS[text.toLowerCase()];
  if (short) return short + zone;
  let days = "", date = "", time = "";
  for (const token of text.split(/\s+/)) {
    if (/^[A-Za-z]/.test(token)) days = systemdDays(token);
    else if (token.includes(":")) time = systemdTime(token);
    else if (token.includes("-")) date = systemdDate(token);
    else return spec;
  }
  const when = [days ? `${days}` : "", date, time || "at 00:00"].filter(Boolean).join(" ");
  const everyDay = !days && !date && !/^every/.test(time);
  const out = everyDay ? `Every day ${when}` : when;
  return out[0].toUpperCase() + out.slice(1) + zone;
}

const MONOTONIC_BASES: Record<string, string> = {
  OnBoot: "after boot",
  OnStartup: "after the service manager starts",
  OnActive: "after the timer starts",
  OnUnitActive: "after the last run started",
  OnUnitInactive: "after the last run ended",
};

/** `OnUnitActive`, `1d` → "1 day after the last run started". */
export function explainMonotonic(base: string, span: string): string {
  const words = span.replace(/(\d+)\s*(us|ms|s|min|h|d|w|month|y)\b/g, (_, n, u) => {
    const unit = {
      us: "µs",
      ms: "ms",
      s: "second",
      min: "minute",
      h: "hour",
      d: "day",
      w: "week",
      month: "month",
      y: "year",
    }[
      u as string
    ]!;
    return unit.length > 2 ? `${n} ${unit}${n === "1" ? "" : "s"}` : `${n} ${unit}`;
  });
  return `${words} ${MONOTONIC_BASES[base] ?? base}`;
}

export function timerSchedule(p: TimerProps): string {
  const parts = [...p.calendar.map(explainCalendar), ...p.monotonic.map((m) => explainMonotonic(m.base, m.value))];
  return parts.join("; ") || "No schedule";
}

/** The service a timer starts: its `Unit=`, else the timer's name with `.service`. */
export function serviceOf(timer: string, activates?: string): string {
  return activates || timer.replace(/\.timer$/, ".service");
}

// ---------------------------------------------------------------------------
// Formatting

/** "in 3 h", "5 min ago", "in 2 d". */
export function relative(ms: number, now = Date.now()): string {
  const d = ms - now, a = Math.abs(d);
  const text = a < 60_000
    ? "<1 min"
    : a < 3_600_000
    ? `${Math.round(a / 60_000)} min`
    : a < 86_400_000
    ? `${Math.round(a / 3_600_000)} h`
    : a < 86_400_000 * 60
    ? `${Math.round(a / 86_400_000)} d`
    : `${Math.round(a / (86_400_000 * 30))} mo`;
  return d >= 0 ? `in ${text}` : `${text} ago`;
}

export function dateTime(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Journal lines that mention a cron command, for its logs. */
export function cronLogLines(journal: string, command: string, limit = 80): string[] {
  const needle = cronCommand(command).command.trim().slice(0, 40);
  const lines = journal.split("\n").filter((l) => l.includes(needle));
  return lines.slice(-limit);
}
