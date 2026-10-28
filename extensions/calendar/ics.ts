// An iCalendar (RFC 5545) reader: what calendar apps publish as "secret
// address in iCal format". Unfolding, escaping, time zones (IANA, Windows and
// Outlook names), all-day dates, and recurrence rules with exceptions.

// ---------------------------------------------------------------------------
// Lines and properties

export interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
}

/** Joins folded lines (a line starting with a space or tab continues the previous one). */
export function unfold(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/^﻿/, "").split(/\r\n|\n|\r/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && out.length) out[out.length - 1] += raw.slice(1);
    else if (raw.length) out.push(raw);
  }
  return out;
}

/** `NAME;PARAM=a;PARAM2="b:c":value`: parameters may be quoted and hold colons. */
export function parseProp(line: string): Prop | undefined {
  let i = 0;
  const nameEnd = line.search(/[;:]/);
  if (nameEnd <= 0) return undefined;
  const name = line.slice(0, nameEnd).toUpperCase();
  i = nameEnd;
  const params: Record<string, string> = {};
  while (line[i] === ";") {
    i++;
    const eq = line.indexOf("=", i);
    if (eq === -1) return undefined;
    const key = line.slice(i, eq).toUpperCase();
    i = eq + 1;
    const values: string[] = [];
    for (;;) {
      if (line[i] === '"') {
        const close = line.indexOf('"', i + 1);
        if (close === -1) return undefined;
        values.push(line.slice(i + 1, close));
        i = close + 1;
      } else {
        let j = i;
        while (j < line.length && line[j] !== ";" && line[j] !== ":" && line[j] !== ",") j++;
        values.push(line.slice(i, j));
        i = j;
      }
      if (line[i] === ",") i++;
      else break;
    }
    params[key] = values.join(",");
  }
  if (line[i] !== ":") return undefined;
  return { name, params, value: line.slice(i + 1) };
}

/** TEXT values: `\n`, `\,`, `\;` and `\\`. */
export function unescapeText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

// ---------------------------------------------------------------------------
// Time zones

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(zone, f);
  }
  return f;
}

export function isZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** Minutes east of UTC in `zone` at `at`. */
export function zoneOffset(zone: string, at: number): number {
  if (zone === "UTC") return 0;
  const p: Record<string, number> = {};
  for (const part of formatter(zone).formatToParts(new Date(at))) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour === 24 ? 0 : p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
}

/** The instant showing civil time `civil` (a Date.UTC of the wall clock) in `zone`; DST gaps move forward. */
export function civilToInstant(civil: number, zone: string): number {
  if (zone === "UTC") return civil;
  const before = zoneOffset(zone, civil - 86_400_000), after = zoneOffset(zone, civil + 86_400_000);
  const valid = [before, after].map((o) => civil - o * 60000).filter((t) => civil - zoneOffset(zone, t) * 60000 === t);
  return valid.length ? Math.min(...valid) : civil - before * 60000;
}

/** The civil time (as Date.UTC ms) of instant `at` in `zone`. */
export function instantToCivil(at: number, zone: string): number {
  return at + zoneOffset(zone, at) * 60000;
}

/** Windows names that Outlook and Exchange put in TZID. */
const WINDOWS_ZONES: Record<string, string> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Alaskan Standard Time": "America/Anchorage",
  "Pacific Standard Time": "America/Los_Angeles",
  "Pacific Standard Time (Mexico)": "America/Tijuana",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time": "America/Denver",
  "Central Standard Time": "America/Chicago",
  "Central America Standard Time": "America/Guatemala",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Canada Central Standard Time": "America/Regina",
  "SA Pacific Standard Time": "America/Bogota",
  "Eastern Standard Time": "America/New_York",
  "US Eastern Standard Time": "America/Indianapolis",
  "Atlantic Standard Time": "America/Halifax",
  "Newfoundland Standard Time": "America/St_Johns",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Pacific SA Standard Time": "America/Santiago",
  "Venezuela Standard Time": "America/Caracas",
  "UTC": "UTC",
  "Coordinated Universal Time": "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "Morocco Standard Time": "Africa/Casablanca",
  "GTB Standard Time": "Europe/Bucharest",
  "E. Europe Standard Time": "Europe/Chisinau",
  "FLE Standard Time": "Europe/Kiev",
  "Israel Standard Time": "Asia/Jerusalem",
  "Egypt Standard Time": "Africa/Cairo",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Turkey Standard Time": "Europe/Istanbul",
  "Russian Standard Time": "Europe/Moscow",
  "Arab Standard Time": "Asia/Riyadh",
  "E. Africa Standard Time": "Africa/Nairobi",
  "Iran Standard Time": "Asia/Tehran",
  "Arabian Standard Time": "Asia/Dubai",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Kolkata",
  "Nepal Standard Time": "Asia/Kathmandu",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "SE Asia Standard Time": "Asia/Bangkok",
  "China Standard Time": "Asia/Shanghai",
  "Singapore Standard Time": "Asia/Singapore",
  "Taipei Standard Time": "Asia/Taipei",
  "W. Australia Standard Time": "Australia/Perth",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "Tasmania Standard Time": "Australia/Hobart",
  "New Zealand Standard Time": "Pacific/Auckland",
};

/**
 * An IANA zone for a TZID: IANA names as is (also behind prefixes like
 * `/mozilla.org/20050126_1/Europe/Paris`), Windows names, and Outlook's
 * "(UTC+01:00) Brussels, Copenhagen…" labels by their offset.
 */
export function resolveZone(tzid: string | undefined): string | undefined {
  if (!tzid) return undefined;
  const t = tzid.trim().replace(/^"|"$/g, "");
  if (/^(utc|gmt|z|etc\/utc|etc\/gmt)$/i.test(t)) return "UTC";
  if (WINDOWS_ZONES[t]) return WINDOWS_ZONES[t];
  if (t.includes("/") && isZone(t)) return t;
  const iana = /([A-Z][a-zA-Z_]+\/[A-Z][a-zA-Z_+\-]+(?:\/[A-Z][a-zA-Z_]+)?)$/.exec(t);
  if (iana && isZone(iana[1])) return iana[1];
  const label = /^\(?(?:UTC|GMT)\s*([+-])(\d{1,2}):?(\d{2})?\)?/i.exec(t);
  if (label) {
    const minutes = (Number(label[2]) * 60 + Number(label[3] ?? 0)) * (label[1] === "-" ? -1 : 1);
    if (minutes === 0) return "UTC";
    if (minutes % 60 === 0) return `Etc/GMT${minutes > 0 ? "-" : "+"}${Math.abs(minutes / 60)}`;
  }
  return isZone(t) ? t : undefined;
}

// ---------------------------------------------------------------------------
// Dates

export interface DateValue {
  /** The wall clock as a Date.UTC timestamp. */
  civil: number;
  /** IANA zone or "UTC"; undefined for floating times and dates. */
  zone?: string;
  allDay: boolean;
}

/** `20261028`, `20261028T093000`, `20261028T093000Z`, with `TZID` / `VALUE=DATE` parameters. */
export function parseDate(
  value: string,
  params: Record<string, string> = {},
  fallbackZone?: string,
): DateValue | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value.trim());
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s, z] = m;
  const civil = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h ?? 0), Number(mi ?? 0), Number(s ?? 0));
  if (h === undefined || params.VALUE === "DATE") return { civil, allDay: true };
  if (z) return { civil, zone: "UTC", allDay: false };
  return { civil, zone: resolveZone(params.TZID) ?? fallbackZone, allDay: false };
}

/** The instant of a date: floating times and all-day dates are in `localZone`. */
export function instantOf(d: DateValue, localZone: string): number {
  return civilToInstant(d.civil, d.zone ?? localZone);
}

/** `PT1H30M`, `P1D`, `-PT15M`, `P1W` in ms. */
export function parseDuration(value: string): number | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(value.trim());
  if (!m || value.trim() === "P") return undefined;
  const [, sign, w, d, h, mi, s] = m;
  const ms = ((Number(w ?? 0) * 7 + Number(d ?? 0)) * 86400 + Number(h ?? 0) * 3600 + Number(mi ?? 0) * 60 +
    Number(s ?? 0)) * 1000;
  return sign === "-" ? -ms : ms;
}

// ---------------------------------------------------------------------------
// Recurrence rules

export type Freq = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

export interface Rule {
  freq: Freq;
  interval: number;
  count?: number;
  until?: DateValue;
  /** Weekdays (0 = Sunday), with an optional position ("2nd Tuesday" = { day: 2, n: 2 }, last Friday n = -1). */
  byDay?: { day: number; n?: number }[];
  byMonthDay?: number[];
  byMonth?: number[];
  bySetPos?: number[];
  /** Week start, 0 = Sunday (default Monday). */
  wkst: number;
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export function parseRule(value: string, zone?: string): Rule | undefined {
  const parts: Record<string, string> = {};
  for (const kv of value.split(";")) {
    const [k, v] = kv.split("=");
    if (k && v !== undefined) parts[k.toUpperCase()] = v;
  }
  const freq = parts.FREQ?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") return undefined;
  const nums = (s?: string) => s?.split(",").map(Number).filter((n) => Number.isInteger(n) && n !== 0);
  const byDay = parts.BYDAY?.split(",").map((d) => {
    const m = /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/i.exec(d.trim());
    return m ? { day: WEEKDAYS.indexOf(m[2].toUpperCase()), ...(m[1] ? { n: Number(m[1]) } : {}) } : undefined;
  }).filter((d) => d !== undefined) as Rule["byDay"];
  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL ?? 1) || 1),
    ...(parts.COUNT ? { count: Math.max(0, Number(parts.COUNT)) } : {}),
    ...(parts.UNTIL ? { until: parseDate(parts.UNTIL, {}, zone) } : {}),
    ...(byDay?.length ? { byDay } : {}),
    ...(nums(parts.BYMONTHDAY)?.length ? { byMonthDay: nums(parts.BYMONTHDAY) } : {}),
    ...(nums(parts.BYMONTH)?.length ? { byMonth: nums(parts.BYMONTH) } : {}),
    ...(nums(parts.BYSETPOS)?.length ? { bySetPos: nums(parts.BYSETPOS) } : {}),
    wkst: parts.WKST ? Math.max(0, WEEKDAYS.indexOf(parts.WKST.toUpperCase())) : 1,
  };
}

const DAY = 86_400_000;

/** Days in a month (1-12). */
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Days of a month matching BYDAY / BYMONTHDAY (1-based day numbers, sorted). */
function monthDays(y: number, m: number, rule: Rule, startDay: number): number[] {
  const n = daysIn(y, m);
  let days: number[] = [];
  if (rule.byMonthDay) {
    days = rule.byMonthDay.map((d) => (d > 0 ? d : n + d + 1)).filter((d) => d >= 1 && d <= n);
  }
  if (rule.byDay) {
    const first = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const fromDay: number[] = [];
    for (const { day, n: pos } of rule.byDay) {
      const all: number[] = [];
      for (let d = 1 + ((day - first + 7) % 7); d <= n; d += 7) all.push(d);
      if (pos === undefined) fromDay.push(...all);
      else {
        const pick = pos > 0 ? all[pos - 1] : all[all.length + pos];
        if (pick) fromDay.push(pick);
      }
    }
    days = rule.byMonthDay ? days.filter((d) => fromDay.includes(d)) : fromDay;
  }
  if (!rule.byMonthDay && !rule.byDay) days = startDay <= n ? [startDay] : [];
  days = [...new Set(days)].sort((a, b) => a - b);
  if (rule.bySetPos) {
    days = rule.bySetPos.map((p) => (p > 0 ? days[p - 1] : days[days.length + p])).filter((d) => d !== undefined)
      .sort((a, b) => a - b);
  }
  return days;
}

/**
 * Civil start times of a rule's occurrences (DTSTART included) up to
 * `endCivil`; rules without COUNT skip the periods before `skipBefore`.
 */
export function* occurrences(start: number, rule: Rule, endCivil: number, skipBefore = -Infinity): Generator<number> {
  const s = new Date(start);
  const [y0, m0, d0] = [s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate()];
  const time = start - Date.UTC(y0, m0 - 1, d0);
  let emitted = 0;
  const max = rule.count ?? Infinity;
  const untilCivil = rule.until ? rule.until.civil + (rule.until.allDay ? DAY - 1 : 0) : Infinity;
  const done = (c: number) => c > endCivil || c > untilCivil || emitted >= max;

  // Without COUNT, whole periods before the window can be skipped.
  const canSkip = rule.count === undefined && skipBefore > start;
  const periodsToSkip = (periodDays: number) =>
    canSkip ? Math.max(0, Math.floor((skipBefore - start) / (periodDays * DAY * rule.interval)) - 1) : 0;

  yield start;
  emitted++;

  if (rule.freq === "DAILY" || (rule.freq === "WEEKLY" && !rule.byDay)) {
    const step = (rule.freq === "DAILY" ? 1 : 7) * rule.interval;
    let k = periodsToSkip(rule.freq === "DAILY" ? 1 : 7);
    for (let guard = 0; guard < 100_000; guard++) {
      k++;
      const c = start + k * step * DAY;
      if (done(c)) return;
      const d = new Date(c);
      if (rule.byDay && !rule.byDay.some((b) => b.day === d.getUTCDay())) continue;
      if (rule.byMonth && !rule.byMonth.includes(d.getUTCMonth() + 1)) continue;
      emitted++;
      yield c;
    }
    return;
  }

  if (rule.freq === "WEEKLY") {
    const startDow = s.getUTCDay();
    const weekStart = Date.UTC(y0, m0 - 1, d0) - ((startDow - rule.wkst + 7) % 7) * DAY;
    const offsets = [...new Set(rule.byDay!.map((b) => (b.day - rule.wkst + 7) % 7))].sort((a, b) => a - b);
    let w = periodsToSkip(7);
    for (let guard = 0; guard < 100_000; guard++, w++) {
      const base = weekStart + w * 7 * rule.interval * DAY;
      for (const off of offsets) {
        const c = base + off * DAY + time;
        if (c <= start) continue;
        if (done(c)) return;
        if (rule.byMonth && !rule.byMonth.includes(new Date(c).getUTCMonth() + 1)) continue;
        emitted++;
        yield c;
      }
      if (base > endCivil) return;
    }
    return;
  }

  // MONTHLY and YEARLY: each period lists its candidate days.
  const yearly = rule.freq === "YEARLY";
  const months = yearly ? (rule.byMonth ?? [m0]) : undefined;
  let k = 0;
  if (canSkip) {
    const sb = new Date(skipBefore);
    const elapsed = yearly ? sb.getUTCFullYear() - y0 : (sb.getUTCFullYear() - y0) * 12 + sb.getUTCMonth() + 1 - m0;
    k = Math.max(0, Math.floor(elapsed / rule.interval) - 1);
  }
  for (let guard = 0; guard < 20_000; guard++, k++) {
    const periods: [number, number][] = yearly
      ? months!.map((m) => [y0 + k * rule.interval, m])
      : [[y0 + Math.floor((m0 - 1 + k * rule.interval) / 12), ((m0 - 1 + k * rule.interval) % 12) + 1]];
    if (Date.UTC(periods[0][0], periods[0][1] - 1, 1) > endCivil) return;
    for (const [y, m] of periods) {
      if (!yearly && rule.byMonth && !rule.byMonth.includes(m)) continue;
      for (const day of monthDays(y, m, rule, d0)) {
        const c = Date.UTC(y, m - 1, day) + time;
        if (c <= start) continue;
        if (done(c)) return;
        emitted++;
        yield c;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Events

export interface Person {
  name?: string;
  email?: string;
  status?: string;
}

export interface CalEvent {
  uid: string;
  summary: string;
  description: string;
  location: string;
  url?: string;
  status?: string;
  start: DateValue;
  end?: DateValue;
  duration?: number;
  rule?: Rule;
  ruleText?: string;
  rdates: DateValue[];
  exdates: DateValue[];
  recurrenceId?: DateValue;
  organizer?: Person;
  attendees: Person[];
  /** X-GOOGLE-CONFERENCE and Microsoft's online meeting properties. */
  conference?: string;
  transparent: boolean;
}

export interface Calendar {
  name?: string;
  zone?: string;
  events: CalEvent[];
}

function person(p: Prop): Person {
  const email = p.value.replace(/^mailto:/i, "").trim() || undefined;
  return { name: p.params.CN ? unescapeText(p.params.CN) : undefined, email, status: p.params.PARTSTAT };
}

/** All VEVENTs of a calendar file (nested VALARMs ignored). */
export function parseCalendar(text: string): Calendar {
  const lines = unfold(text);
  const cal: Calendar = { events: [] };
  let ev: Partial<CalEvent> & { props?: Prop[] } | undefined;
  let depth = 0; // inside VALARM or other sub-components of an event
  for (const line of lines) {
    const p = parseProp(line);
    if (!p) continue;
    if (p.name === "BEGIN") {
      const what = p.value.toUpperCase();
      if (what === "VEVENT" && !ev) ev = { props: [] };
      else if (ev) depth++;
      continue;
    }
    if (p.name === "END") {
      const what = p.value.toUpperCase();
      if (ev && depth > 0) depth--;
      else if (what === "VEVENT" && ev) {
        const done = buildEvent(ev.props!, cal.zone);
        if (done) cal.events.push(done);
        ev = undefined;
      }
      continue;
    }
    if (ev) {
      if (depth === 0) ev.props!.push(p);
    } else if (p.name === "X-WR-CALNAME") cal.name = unescapeText(p.value);
    else if (p.name === "X-WR-TIMEZONE") cal.zone = resolveZone(p.value);
  }
  return cal;
}

function buildEvent(props: Prop[], calZone?: string): CalEvent | undefined {
  const get = (name: string) => props.find((p) => p.name === name);
  const dtstart = get("DTSTART");
  const start = dtstart && parseDate(dtstart.value, dtstart.params, calZone);
  if (!start) return undefined;
  const dtend = get("DTEND");
  const dur = get("DURATION");
  const rrule = get("RRULE");
  const dates = (name: string) =>
    props.filter((p) => p.name === name).flatMap((p) =>
      p.value.split(",").map((v) => parseDate(v, p.params, start.zone)).filter((d): d is DateValue => !!d)
    );
  const rid = get("RECURRENCE-ID");
  const conference = ["X-GOOGLE-CONFERENCE", "X-MICROSOFT-SKYPETEAMSMEETINGURL", "X-MICROSOFT-ONLINEMEETINGCONFLINK"]
    .map((n) => get(n)?.value).find(Boolean);
  return {
    uid: get("UID")?.value ?? crypto.randomUUID(),
    summary: unescapeText(get("SUMMARY")?.value ?? "").trim() || "(No title)",
    description: unescapeText(get("DESCRIPTION")?.value ?? ""),
    location: unescapeText(get("LOCATION")?.value ?? "").trim(),
    url: get("URL")?.value,
    status: get("STATUS")?.value.toUpperCase(),
    start,
    end: dtend ? parseDate(dtend.value, dtend.params, start.zone) : undefined,
    duration: dur ? parseDuration(dur.value) : undefined,
    rule: rrule ? parseRule(rrule.value, start.zone) : undefined,
    ruleText: rrule?.value,
    rdates: dates("RDATE"),
    exdates: dates("EXDATE"),
    recurrenceId: rid ? parseDate(rid.value, rid.params, start.zone) : undefined,
    organizer: get("ORGANIZER") ? person(get("ORGANIZER")!) : undefined,
    attendees: props.filter((p) => p.name === "ATTENDEE").map(person),
    conference,
    transparent: get("TRANSP")?.value.toUpperCase() === "TRANSPARENT",
  };
}

// ---------------------------------------------------------------------------
// Expansion

export interface Occurrence {
  event: CalEvent;
  /** Instants, ms. All-day events start and end at local midnight. */
  start: number;
  end: number;
  allDay: boolean;
  recurring: boolean;
}

/** Length of an event: DTEND − DTSTART, else DURATION, else one day (dates) or nothing (times). */
function lengthOf(e: CalEvent, localZone: string): { ms: number; days?: number } {
  if (e.start.allDay) {
    const days = e.end ? Math.max(1, Math.round((e.end.civil - e.start.civil) / DAY)) : Math.max(
      1,
      Math.round((e.duration ?? DAY) / DAY),
    );
    return { ms: days * DAY, days };
  }
  if (e.end) return { ms: Math.max(0, instantOf(e.end, localZone) - instantOf(e.start, localZone)) };
  return { ms: Math.max(0, e.duration ?? 0) };
}

function occurrenceAt(e: CalEvent, civil: number, localZone: string, recurring: boolean): Occurrence {
  const len = lengthOf(e, localZone);
  if (e.start.allDay) {
    const start = civilToInstant(civil, localZone);
    return { event: e, start, end: civilToInstant(civil + len.days! * DAY, localZone), allDay: true, recurring };
  }
  const start = civilToInstant(civil, e.start.zone ?? localZone);
  return { event: e, start, end: start + len.ms, allDay: false, recurring };
}

/** The key matching a RECURRENCE-ID or EXDATE to a generated occurrence. */
const keyOf = (d: DateValue, eventStart: DateValue, localZone: string) =>
  d.allDay || eventStart.allDay
    ? `d:${
      new Date(d.allDay ? d.civil : instantToCivil(instantOf(d, localZone), eventStart.zone ?? localZone))
        .toISOString().slice(0, 10)
    }`
    : `t:${instantOf(d, localZone)}`;

/**
 * Occurrences overlapping [from, to): recurring events expanded with their
 * rule, RDATEs and EXDATEs, moved instances (RECURRENCE-ID) replacing the
 * ones they override, cancelled events left out. Sorted by start.
 */
export function expand(events: CalEvent[], from: number, to: number, localZone: string): Occurrence[] {
  const overrides = new Map<string, Set<string>>();
  for (const e of events) {
    if (!e.recurrenceId) continue;
    const master = events.find((m) => m.uid === e.uid && !m.recurrenceId);
    const set = overrides.get(e.uid) ?? new Set<string>();
    set.add(keyOf(e.recurrenceId, master?.start ?? e.start, localZone));
    overrides.set(e.uid, set);
  }
  const out: Occurrence[] = [];
  const keep = (o: Occurrence) =>
    o.end > from && o.start < to || (o.start === o.end && o.start >= from && o.start < to);
  for (const e of events) {
    if (e.status === "CANCELLED") continue;
    if (!e.rule && !e.rdates.length) {
      const o = occurrenceAt(e, e.start.civil, localZone, !!e.recurrenceId);
      if (keep(o)) out.push(o);
      continue;
    }
    const zone = e.start.allDay ? localZone : e.start.zone ?? localZone;
    const len = lengthOf(e, localZone).ms;
    // Civil bounds of the window in the event's zone, with a day of margin for offsets.
    const fromCivil = instantToCivil(from - len, zone) - DAY;
    const toCivil = instantToCivil(to, zone) + DAY;
    const skip = new Set([
      ...e.exdates.map((d) => keyOf(d, e.start, localZone)),
      ...(overrides.get(e.uid) ?? []),
    ]);
    // UNTIL is usually in UTC: compare it in the event's own wall clock.
    const rule = e.rule?.until && e.rule.until.zone && !e.rule.until.allDay
      ? { ...e.rule, until: { civil: instantToCivil(instantOf(e.rule.until, localZone), zone), allDay: false } }
      : e.rule;
    const civils = rule ? [...occurrences(e.start.civil, rule, toCivil, fromCivil)] : [e.start.civil];
    for (const r of e.rdates) {
      civils.push(r.allDay || e.start.allDay ? r.civil : instantToCivil(instantOf(r, localZone), zone));
    }
    for (const civil of new Set(civils)) {
      if (civil < fromCivil - len || civil > toCivil) continue;
      const o = occurrenceAt(e, civil, localZone, true);
      const key = e.start.allDay ? `d:${new Date(civil).toISOString().slice(0, 10)}` : `t:${o.start}`;
      if (skip.has(key)) continue;
      if (keep(o)) out.push(o);
    }
  }
  return out.sort((a, b) => a.start - b.start || Number(b.allDay) - Number(a.allDay) || a.end - b.end);
}
