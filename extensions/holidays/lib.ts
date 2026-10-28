// Dates, countdowns, bridge days and the school calendar. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

/** A day as `YYYY-MM-DD`, the format of both APIs. */
export type Day = string;

const DAY_MS = 86_400_000;

/** The local calendar date of a `Date`: `2026-10-28`. */
export function today(now = new Date()): Day {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const utc = (d: Day) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));

export const addDays = (d: Day, n: number): Day => new Date(utc(d) + n * DAY_MS).toISOString().slice(0, 10);

/** Whole days from `a` to `b` (negative when `b` is before). */
export const daysBetween = (a: Day, b: Day) => Math.round((utc(b) - utc(a)) / DAY_MS);

/** 0 = Sunday … 6 = Saturday. */
export const weekday = (d: Day) => new Date(utc(d)).getUTCDay();

export const isWeekend = (d: Day) => weekday(d) === 0 || weekday(d) === 6;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
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

const parts = (d: Day) => ({
  w: WEEKDAYS[weekday(d)],
  day: Number(d.slice(8, 10)),
  m: MONTHS[Number(d.slice(5, 7)) - 1],
});

/** "Thu 14 May". */
export function shortDay(d: Day): string {
  const { w, day, m } = parts(d);
  return `${w.slice(0, 3)} ${day} ${m.slice(0, 3)}`;
}
/** "Thursday 14 May 2026". */
export function longDay(d: Day): string {
  const { w, day, m } = parts(d);
  return `${w} ${day} ${m} ${d.slice(0, 4)}`;
}
export const weekdayName = (d: Day) => WEEKDAYS[weekday(d)];

/** "Today", "Tomorrow", "In 12 days", "Yesterday", "3 days ago". */
export function countdown(from: Day, to: Day): string {
  const n = daysBetween(from, to);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n < 0) return `${-n} days ago`;
  return `In ${n} days`;
}

/** Shorter, for a tag: "today", "1 d", "12 d", "past". */
export function countdownTag(from: Day, to: Day): string {
  const n = daysBetween(from, to);
  if (n === 0) return "today";
  if (n < 0) return "past";
  return n < 100 ? `${n} d` : `${Math.round(n / 7)} wk`;
}

export function countdownColor(from: Day, to: Day): Color {
  const n = daysBetween(from, to);
  if (n < 0) return "gray";
  if (n === 0) return "green";
  if (n <= 7) return "orange";
  if (n <= 30) return "yellow";
  return "blue";
}

// ---------------------------------------------------------------------------
// Public holidays (Nager.Date v3)

/** One entry of `GET /api/v3/PublicHolidays/{year}/{countryCode}`. */
export interface Holiday {
  date: Day;
  localName: string;
  name: string;
  countryCode: string;
  global: boolean;
  counties: string[] | null;
  launchYear: number | null;
  types: string[];
}

export interface Country {
  countryCode: string;
  name: string;
}

/** `fr`, ` France ` (unknown names are kept) → `FR`. */
export function normalizeCountry(input: unknown, fallback = "FR"): string {
  const s = String(input ?? "").trim();
  return /^[a-z]{2}$/i.test(s) ? s.toUpperCase() : fallback;
}

/** `by` with `DE` → `DE-BY`; `de-by` → `DE-BY`; empty → undefined. */
export function normalizeRegion(input: unknown, country: string): string | undefined {
  const s = String(input ?? "").trim().toUpperCase();
  if (!s) return undefined;
  if (/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(s)) return s;
  return /^[A-Z0-9]{1,3}$/.test(s) ? `${country}-${s}` : undefined;
}

/** Holidays everybody in the region gets: national ones, and the region's own. */
export const appliesTo = (h: Holiday, region?: string) =>
  h.global || !h.counties?.length || (!!region && h.counties.includes(region));

/** Days off for everyone (not bank-only or observances). */
export const isDayOff = (h: Holiday) => !h.types?.length || h.types.includes("Public");

const TYPE_LABELS: Record<string, string> = {
  Public: "Public holiday",
  Bank: "Banks closed",
  School: "Schools closed",
  Authorities: "Authorities closed",
  Optional: "Optional",
  Observance: "Observance",
};

export const typeLabel = (t: string) => TYPE_LABELS[t] ?? t;

/** Sorted, deduplicated (Nager lists some days once per region group), filtered for the region. */
export function holidaysFor(all: Holiday[], region?: string): Holiday[] {
  const seen = new Map<string, Holiday>();
  for (const h of all) {
    if (!appliesTo(h, region)) continue;
    const key = `${h.date}|${h.name}`;
    const prev = seen.get(key);
    if (!prev) seen.set(key, h);
    else if (h.global && !prev.global) seen.set(key, h);
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
}

/** The holiday's name, with the local one when it differs: "Ascension Day (Ascension)". */
export function holidayTitle(h: Holiday): string {
  return h.localName && h.localName.toLowerCase() !== h.name.toLowerCase() ? `${h.name} · ${h.localName}` : h.name;
}

/** "Falls on a Saturday" for days off lost to the weekend. */
export function weekendNote(h: Holiday): string | undefined {
  if (!isDayOff(h)) return undefined;
  const w = weekday(h.date);
  return w === 6 ? "Falls on a Saturday" : w === 0 ? "Falls on a Sunday" : undefined;
}

// ---------------------------------------------------------------------------
// Bridge days

export interface Bridge {
  /** The working days to take off, in order. */
  take: Day[];
  /** First and last day of the whole break. */
  start: Day;
  end: Day;
  /** Days in a row away from work. */
  total: number;
  /** The holidays that make it worth it. */
  holidays: Holiday[];
  /** "Pont" (1 day), "Viaduc" (2), "Long bridge" (3+). */
  kind: string;
}

/**
 * Working days that join a public holiday to a weekend (or to another
 * holiday): a Tuesday holiday makes Monday a bridge, a Wednesday one two
 * days for five off. Only gaps of at most `maxTake` days giving at least
 * `minRatio` days off per day taken are kept.
 */
export function bridges(
  holidays: Holiday[],
  from: Day,
  to: Day,
  { maxTake = 4, minRatio = 2.5 }: { maxTake?: number; minRatio?: number } = {},
): Bridge[] {
  const off = new Map<Day, Holiday[]>();
  for (const h of holidays) {
    if (!isDayOff(h)) continue;
    off.set(h.date, [...(off.get(h.date) ?? []), h]);
  }
  // Blocks of consecutive days off, from a weekend before `from` to one after `to`.
  const blocks: { start: Day; end: Day; holidays: Holiday[] }[] = [];
  let current: { start: Day; end: Day; holidays: Holiday[] } | undefined;
  for (let d = addDays(from, -7); d <= addDays(to, 7); d = addDays(d, 1)) {
    const isOff = isWeekend(d) || off.has(d);
    if (isOff) {
      current ??= { start: d, end: d, holidays: [] };
      current.end = d;
      current.holidays.push(...(off.get(d) ?? []));
    } else if (current) {
      blocks.push(current);
      current = undefined;
    }
  }
  if (current) blocks.push(current);

  const out: Bridge[] = [];
  for (let i = 0; i + 1 < blocks.length; i++) {
    const [a, b] = [blocks[i], blocks[i + 1]];
    const gap = daysBetween(a.end, b.start) - 1;
    if (gap < 1 || gap > maxTake) continue;
    const named = [...a.holidays, ...b.holidays];
    if (!named.length) continue;
    const take = Array.from({ length: gap }, (_, k) => addDays(a.end, k + 1));
    if (take[0] < from || take[0] > to) continue;
    const total = daysBetween(a.start, b.end) + 1;
    if (total / gap < minRatio) continue;
    const seen = new Set<string>();
    out.push({
      take,
      start: a.start,
      end: b.end,
      total,
      holidays: named.filter((h) => !seen.has(h.name) && seen.add(h.name)),
      kind: gap === 1 ? "Bridge" : gap === 2 ? "Viaduct" : "Long bridge",
    });
  }
  return out;
}

/** "Mon 13 Jul" or "Mon 4 May – Thu 7 May". */
export function takeLabel(b: Bridge): string {
  return b.take.length === 1 ? shortDay(b.take[0]) : `${shortDay(b.take[0])} – ${shortDay(b.take.at(-1)!)}`;
}

export const ratio = (b: Bridge) => b.total / b.take.length;

export function ratioColor(b: Bridge): Color {
  const r = ratio(b);
  return r >= 4 ? "green" : r >= 3 ? "teal" : "blue";
}

// ---------------------------------------------------------------------------
// French school holidays (data.education.gouv.fr, fr-en-calendrier-scolaire)

/** A record of the dataset. */
export interface SchoolRecord {
  description: string;
  population?: string;
  start_date: string;
  end_date: string | null;
  location?: string;
  zones: string;
  annee_scolaire: string;
}

export interface SchoolPeriod {
  description: string;
  name: string;
  /** First day without classes (the dataset's start: classes end the evening before or that morning). */
  start: Day;
  /** The day classes resume, when known. */
  end?: Day;
  zone: string;
  year: string;
  locations: string[];
}

/** `a`, `zone b`, `Corsica` → the dataset's `Zone A`, `Zone B`, `Corse`; other zones are kept. */
export function normalizeZone(input: unknown): string {
  const s = String(input ?? "").trim();
  const zone = /^(?:zone\s*)?([abc])$/i.exec(s);
  if (zone) return `Zone ${zone[1].toUpperCase()}`;
  if (/^cors(e|ica)$/i.test(s)) return "Corse";
  if (/^r[ée]union$/i.test(s)) return "La Réunion";
  return s || "Zone C";
}

export const ZONES = ["Zone A", "Zone B", "Zone C", "Corse"];

/**
 * The calendar date of a dataset timestamp. They are local midnights in UTC
 * (`2026-10-16T22:00:00+00:00` is Saturday 17 October in Paris, other zones
 * have their own offset): rounding to the nearest UTC day gets the date
 * everywhere from Polynesia to New Caledonia.
 */
export function schoolDay(iso: string): Day {
  return new Date(Date.parse(iso) + 12 * 3_600_000).toISOString().slice(0, 10);
}

const SCHOOL_NAMES: [RegExp, string][] = [
  [/toussaint/i, "All Saints' holidays"],
  [/no[ëe]l/i, "Christmas holidays"],
  [/hiver|f[ée]vrier/i, "Winter holidays"],
  [/printemps|p[âa]ques/i, "Spring holidays"],
  [/ascension/i, "Ascension bridge"],
  [/[ée]t[ée]/i, "Summer holidays"],
  [/carnaval/i, "Carnival holidays"],
  [/rentr[ée]e/i, "Back to school"],
];

export function schoolName(description: string): string {
  return SCHOOL_NAMES.find(([re]) => re.test(description))?.[1] ?? description;
}

/**
 * One period per holiday of the zone: the dataset repeats each for every
 * académie and sometimes for teachers only (who come back earlier).
 */
export function schoolPeriods(records: SchoolRecord[]): SchoolPeriod[] {
  const pupils = records.filter((r) => !/enseignant/i.test(r.population ?? ""));
  const byKey = new Map<string, SchoolPeriod>();
  for (const r of pupils.length ? pupils : records) {
    if (!r.start_date) continue;
    const start = schoolDay(r.start_date);
    const end = r.end_date ? schoolDay(r.end_date) : undefined;
    const key = `${r.description}|${start}|${end ?? ""}|${r.zones}`;
    const p = byKey.get(key) ?? {
      description: r.description.trim(),
      name: schoolName(r.description),
      start,
      end: end && end > start ? end : undefined,
      zone: r.zones,
      year: r.annee_scolaire,
      locations: [],
    };
    if (r.location && !p.locations.includes(r.location)) p.locations.push(r.location);
    byKey.set(key, p);
  }
  return [...byKey.values()]
    .map((p) => ({ ...p, locations: p.locations.sort((a, b) => a.localeCompare(b, "fr")) }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

export type PeriodState = "now" | "upcoming" | "past";

export function periodState(p: SchoolPeriod, on: Day): PeriodState {
  if (on < p.start) return "upcoming";
  // The summer holidays have no end in some years' data: about two months.
  const end = p.end ?? addDays(p.start, 62);
  return on < end ? "now" : "past";
}

/** Days without classes: from the start to the day before classes resume. */
export const periodLength = (p: SchoolPeriod) => p.end ? daysBetween(p.start, p.end) : undefined;

/** "Sat 17 Oct → Mon 2 Nov". */
export function periodRange(p: SchoolPeriod): string {
  return p.end ? `${shortDay(p.start)} → ${shortDay(p.end)}` : `from ${shortDay(p.start)}`;
}

/**
 * The dataset query: periods of a zone starting between `from` and `to`
 * (ODSQL, the `where` of the Opendatasoft Explore API v2.1).
 */
export function schoolQuery(zone: string, from: Day, to: Day): string {
  const quoted = zone.replace(/["\\]/g, "");
  return `zones="${quoted}" and start_date>=date'${from}' and start_date<=date'${to}'`;
}
