// Sun & Moon: days in a place's time zone, what the user typed, the day's
// events and the launcher items showing them. Pure, tested in lib_test.ts;
// the astronomy is in astro.ts, the network in api.ts.

import { type Action, type Color, copy, Icons, type Item, meta, type Metadata, type Stat } from "@backslash/api";
import {
  type Crossings,
  crossings,
  type Illumination,
  illumination,
  moonHorizon,
  moonHorizontal,
  moonPosition,
  nextPhaseAt,
  refraction,
  solarTransit,
  SUN_HORIZON,
  sunHorizontal,
} from "./astro.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Places

/** A city found by the geocoding API, or coordinates typed by the user. */
export interface Place {
  id?: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  /** IANA time zone; the computer's own when missing. */
  timezone?: string;
}

export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function isValidZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const zoneOf = (p: Place): string => p.timezone && isValidZone(p.timezone) ? p.timezone : localZone();

/** "Lyon, Auvergne-Rhône-Alpes, France". */
export function placeLabel(p: Place): string {
  return [p.name, p.admin1 !== p.name ? p.admin1 : undefined, p.country].filter(Boolean).join(", ");
}

export function geocodingUrl(name: string, count = 8, language = "en"): string {
  const q = new URLSearchParams({ name, count: String(count), language, format: "json" });
  return `https://geocoding-api.open-meteo.com/v1/search?${q}`;
}

/** "Lyon, France" → search "Lyon", keep results in France first. */
export function splitPlace(text: string): { name: string; hint?: string } {
  const [name, ...rest] = text.split(",").map((s) => s.trim()).filter(Boolean);
  return { name: name ?? "", hint: rest.join(" ") || undefined };
}

export function rankPlaces(places: Place[], hint?: string): Place[] {
  if (!hint) return places;
  const h = hint.toLowerCase();
  const matches = (p: Place) =>
    [p.country, p.country_code, p.admin1].some((v) => v && (v.toLowerCase() === h || v.toLowerCase().startsWith(h)));
  return [...places.filter(matches), ...places.filter((p) => !matches(p))];
}

const COORDS = /(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?\s*[,;]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?/i;

/** "48.85, 2.35" or "48.85N, 2.35E": a decimal point somewhere, so that "21, 2026" is not coordinates. */
export function parseCoordinates(text: string): { latitude: number; longitude: number; match: string } | undefined {
  const m = COORDS.exec(text);
  if (!m || !m[0].includes(".")) return undefined;
  let lat = Number(m[1]);
  let lon = Number(m[3]);
  if (m[2]?.toUpperCase() === "S") lat = -Math.abs(lat);
  if (m[4]?.toUpperCase() === "W") lon = -Math.abs(lon);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { latitude: lat, longitude: lon, match: m[0] };
}

export function coordinatesPlace(latitude: number, longitude: number): Place {
  return { name: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`, latitude, longitude };
}

// ---------------------------------------------------------------------------
// Days in a time zone

/** A calendar day, "2026-12-21". */
export type Day = string;

const wallFormatters = new Map<string, Intl.DateTimeFormat>();

function wall(ms: number, zone: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  let f = wallFormatters.get(zone);
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
    wallFormatters.set(zone, f);
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

/** Minutes ahead of UTC in `zone` at `ms`. */
export function zoneOffset(ms: number, zone: string): number {
  const w = wall(ms, zone);
  return Math.round((Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000) / MINUTE);
}

const pad = (n: number) => String(n).padStart(2, "0");
const toDay = (y: number, m: number, d: number): Day => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
};
const dayParts = (day: Day) => day.split("-").map(Number) as [number, number, number];

export function dayOf(ms: number, zone: string): Day {
  const w = wall(ms, zone);
  return toDay(w.y, w.m, w.d);
}

export function addDays(day: Day, n: number): Day {
  const [y, m, d] = dayParts(day);
  return toDay(y, m, d + n);
}

/** 0 for Sunday. */
export const weekday = (day: Day): number => new Date(`${day}T12:00:00Z`).getUTCDay();

export const daysBetween = (a: Day, b: Day): number => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** The first instant of `day` in `zone` (days are 23 or 25 hours long when the clocks change). */
export function startOfDay(day: Day, zone: string): number {
  const [y, m, d] = dayParts(day);
  const utc = Date.UTC(y, m - 1, d);
  let t = utc - zoneOffset(utc, zone) * MINUTE;
  t = utc - zoneOffset(t, zone) * MINUTE;
  // Where midnight doesn't exist (a clock change at 00:00), the day starts at the first instant on that date.
  if (dayOf(t, zone) !== day) t += HOUR;
  return t;
}

// ---------------------------------------------------------------------------
// What the user typed

/** When the user asked about, before knowing which day it is there. */
export type DateSpec =
  | { kind: "day"; day: Day }
  | { kind: "offset"; days: number }
  | { kind: "weekday"; weekday: number }
  | { kind: "monthDay"; month: number; day: number };

export interface Query {
  date?: DateSpec;
  /** Words left once the date is taken out: a city. */
  place?: string;
  coordinates?: { latitude: number; longitude: number };
  error?: string;
}

const MONTHS: [RegExp, number][] = [
  [/^jan(?:uary|v(?:ier)?)?\.?$/, 1],
  [/^f(?:eb(?:ruary)?|e?vr?(?:ier)?)\.?$/, 2],
  [/^mar(?:ch|s)?\.?$/, 3],
  [/^a(?:pr(?:il)?|vr(?:il)?)\.?$/, 4],
  [/^ma(?:y|i)$/, 5],
  [/^ju(?:n[e]?|in)\.?$/, 6],
  [/^ju(?:l[y]?|il(?:let)?)\.?$/, 7],
  [/^a(?:ug(?:ust)?|out)\.?$/, 8],
  [/^sep(?:t(?:ember|embre)?)?\.?$/, 9],
  [/^oct(?:ober|obre)?\.?$/, 10],
  [/^nov(?:ember|embre)?\.?$/, 11],
  [/^d(?:ec|e)(?:ember|embre)?\.?$/, 12],
];

const WEEKDAYS: [RegExp, number][] = [
  [/^(?:sun(?:day)?|dim(?:anche)?)$/, 0],
  [/^(?:mon(?:day)?|lun(?:di)?)$/, 1],
  [/^(?:tue(?:s(?:day)?)?|mar(?:di)?)$/, 2],
  [/^(?:wed(?:nesday)?|mer(?:credi)?)$/, 3],
  [/^(?:thu(?:rs(?:day)?)?|jeu(?:di)?)$/, 4],
  [/^(?:fri(?:day)?|ven(?:dredi)?)$/, 5],
  [/^(?:sat(?:urday)?|sam(?:edi)?)$/, 6],
];

const RELATIVE: [RegExp, number][] = [
  [/^(?:today|now|aujourd'hui|maintenant|auj)$/, 0],
  [/^(?:tomorrow|tmrw|demain)$/, 1],
  [/^(?:yesterday|hier)$/, -1],
  [/^(?:apres-demain)$/, 2],
  [/^(?:avant-hier)$/, -2],
];

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’`]/g, "'").toLowerCase();
const month = (word: string) => MONTHS.find(([re]) => re.test(word))?.[1];
const validDate = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(y, m, 0).getDate();
// Words that only frame the question: "sunrise in Tokyo", "lever du soleil à Paris".
const TOPIC = new Set(["sun", "sunrise", "sunset", "moon", "moonrise", "moonset", "soleil", "lune", "phase"]);
const PREPOSITION = new Set(["in", "at", "for", "on", "a", "pour"]);

/** How many words at `i` only frame the question: "sunrise", "lever du soleil", "in"… (0 if none). */
function fillerAt(w: string[], i: number): number {
  const f = (k: number) => fold(w[i + k] ?? "").replace(/[,:]$/, "");
  if (TOPIC.has(f(0))) return 1;
  const verb = f(0) === "lever" || f(0) === "coucher";
  if (verb && f(1) === "du" && f(2) === "soleil") return 3;
  if (verb && f(1) === "de" && f(2) === "la" && f(3) === "lune") return 4;
  // "à Paris", but not "A Coruña"; never the last word.
  if (PREPOSITION.has(f(0)) && i + 1 < w.length && (f(0) !== "a" || w[i] === "à")) return 1;
  return 0;
}

/** Takes "sunrise in", "lever du soleil à", "moon phase" off the start and end of the words. */
function stripFiller(words: string[]): string[] {
  const w = [...words];
  for (let n = fillerAt(w, 0); n > 0 && w.length; n = fillerAt(w, 0)) w.splice(0, n);
  while (w.length && TOPIC.has(fold(w[w.length - 1]))) w.pop();
  return w;
}

/** "Tokyo tomorrow", "2026-12-21", "21 décembre Lyon", "48.85, 2.35 +3", "friday". */
export function parseQuery(input: string): Query {
  const q: Query = {};
  let text = input.trim();
  const coords = parseCoordinates(text);
  if (coords) {
    q.coordinates = { latitude: coords.latitude, longitude: coords.longitude };
    text = text.replace(coords.match, " ");
  }
  const words = text.split(/\s+/).filter(Boolean);
  const used = new Set<number>();
  const take = (...idx: number[]) => idx.forEach((i) => used.add(i));
  for (let i = 0; i < words.length && !q.date; i++) {
    const w = fold(words[i]).replace(/[,.]$/, "");
    const next = fold(words[i + 1] ?? "").replace(/[,.]$/, "");
    let m: RegExpExecArray | null;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w))) {
      const [y, mo, d] = [+m[1], +m[2], +m[3]];
      if (!validDate(y, mo, d)) return { ...q, error: `${words[i]} is not a date` };
      q.date = { kind: "day", day: toDay(y, mo, d) };
      take(i);
    } else if ((m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/.exec(w))) {
      // Day first, unless that can't be (12/21/2026).
      let [d, mo] = [+m[1], +m[2]];
      if (mo > 12 && d <= 12) [d, mo] = [mo, d];
      const y = +m[3];
      if (!validDate(y, mo, d)) return { ...q, error: `${words[i]} is not a date` };
      q.date = { kind: "day", day: toDay(y, mo, d) };
      take(i);
    } else if (RELATIVE.some(([re]) => re.test(w))) {
      q.date = { kind: "offset", days: RELATIVE.find(([re]) => re.test(w))![1] };
      take(i);
    } else if ((m = /^([+-]\d{1,4})(?:d|j)?$/.exec(w))) {
      q.date = { kind: "offset", days: +m[1] };
      take(i);
    } else if (
      (w === "in" || w === "dans") && /^\d{1,4}$/.test(next) && /^(?:days?|jours?)$/.test(fold(words[i + 2] ?? ""))
    ) {
      q.date = { kind: "offset", days: +next };
      take(i, i + 1, i + 2);
    } else if (/^\d{1,4}$/.test(w) && /^(?:days?)$/.test(next) && fold(words[i + 2] ?? "") === "ago") {
      q.date = { kind: "offset", days: -Number(w) };
      take(i, i + 1, i + 2);
    } else if (WEEKDAYS.some(([re]) => re.test(w))) {
      q.date = { kind: "weekday", weekday: WEEKDAYS.find(([re]) => re.test(w))![1] };
      take(i);
    } else if (/^\d{1,2}(?:st|nd|rd|th|er)?$/.test(w) && month(next) !== undefined) {
      // "21 dec", "21 décembre 2026", "1er mai"
      const d = parseInt(w);
      const mo = month(next)!;
      const year = /^\d{4}$/.test(words[i + 2] ?? "") ? +words[i + 2] : undefined;
      q.date = setMonthDay(mo, d, year);
      take(i, i + 1, ...(year ? [i + 2] : []));
    } else if (month(w) !== undefined && /^\d{1,2}(?:st|nd|rd|th)?,?$/.test(next)) {
      // "dec 21", "December 21, 2026"
      const d = parseInt(next);
      const year = /^\d{4}$/.test(words[i + 2] ?? "") ? +words[i + 2] : undefined;
      q.date = setMonthDay(month(w)!, d, year);
      take(i, i + 1, ...(year ? [i + 2] : []));
    }
    if (q.date?.kind === "monthDay" && !validDate(2024, q.date.month, q.date.day)) {
      return { ...q, date: undefined, error: `${words.filter((_, j) => used.has(j)).join(" ")} is not a date` };
    }
    if (q.date?.kind === "day" && !validDate(...dayParts(q.date.day))) {
      return { ...q, date: undefined, error: `${words.filter((_, j) => used.has(j)).join(" ")} is not a date` };
    }
  }
  const rest = stripFiller(words.filter((_, i) => !used.has(i)));
  const place = rest.join(" ").replace(/^[\s,;:]+|[\s,;:]+$/g, "");
  if (place) q.place = place;
  return q;
}

function setMonthDay(month: number, day: number, year?: number): DateSpec {
  return year ? { kind: "day", day: toDay(year, month, day) } : { kind: "monthDay", month, day };
}

/** The day a {@link DateSpec} means, `today` being the day it is at the place. */
export function resolveDate(spec: DateSpec | undefined, today: Day): Day {
  if (!spec) return today;
  switch (spec.kind) {
    case "day":
      return spec.day;
    case "offset":
      return addDays(today, spec.days);
    case "weekday":
      return addDays(today, (spec.weekday - weekday(today) + 7) % 7);
    case "monthDay": {
      // The next one: "21 jun" in November is next June.
      const y = dayParts(today)[0];
      const day = toDay(y, spec.month, spec.day);
      return day < today ? toDay(y + 1, spec.month, spec.day) : day;
    }
  }
}

// ---------------------------------------------------------------------------
// The day's events

export interface Window {
  from: number;
  to: number;
  part: "morning" | "evening" | "all day";
}

export interface SunDay {
  day: Day;
  start: number;
  end: number;
  sunrise?: number;
  sunset?: number;
  noon: number;
  /** The Sun's altitude at solar noon, degrees. */
  noonAltitude: number;
  /** Time the Sun is above the horizon during the day. */
  length: number;
  /** "up" all day (midnight sun), "down" all day (polar night), or "normal". */
  state: "normal" | "up" | "down";
  /** Twilights begin (dawn) and end (dusk) when the Sun is 6°, 12° and 18° below the horizon. */
  civil: { dawn?: number; dusk?: number };
  nautical: { dawn?: number; dusk?: number };
  astronomical: { dawn?: number; dusk?: number };
  /** The Sun between 4° below and 6° above the horizon: warm, soft light. */
  golden: Window[];
  /** The Sun between 6° and 4° below the horizon: deep blue sky. */
  blue: Window[];
}

const sunAltitude = (lat: number, lon: number) => (t: number) => sunHorizontal(t, lat, lon).altitude;

/** Stretches of `[start, end]` where the crossed value is above zero. */
export function intervals(c: Crossings, start: number, end: number): [number, number][] {
  const events = [...c.rises.map((t) => [t, 1] as const), ...c.sets.map((t) => [t, -1] as const)]
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let from: number | undefined = c.aboveAtStart ? start : undefined;
  for (const [t, kind] of events) {
    if (kind === 1 && from === undefined) from = t;
    else if (kind === -1 && from !== undefined) {
      out.push([from, t]);
      from = undefined;
    }
  }
  if (from !== undefined) out.push([from, end]);
  return out;
}

function windows(
  f: (t: number) => number,
  lo: number,
  hi: number,
  start: number,
  end: number,
  noon: number,
): Window[] {
  // Positive exactly when lo < altitude < hi.
  const c = crossings((t) => Math.min(f(t) - lo, hi - f(t)), start, end);
  return intervals(c, start, end).map(([from, to]) => ({
    from,
    to,
    part: from <= start && to >= end ? "all day" : (from + to) / 2 < noon ? "morning" : "evening",
  }));
}

function twilight(f: (t: number) => number, altitude: number, start: number, end: number) {
  const c = crossings((t) => f(t) - altitude, start, end);
  return { dawn: c.rises[0], dusk: c.sets[c.sets.length - 1] };
}

/** Sunrise, sunset and length of `day` only: what the week's table needs. */
export function sunTimes(day: Day, place: Place): Pick<SunDay, "sunrise" | "sunset" | "length" | "state"> {
  const zone = zoneOf(place);
  const start = startOfDay(day, zone);
  const end = startOfDay(addDays(day, 1), zone);
  const c = crossings((t) => sunAltitude(place.latitude, place.longitude)(t) - SUN_HORIZON, start, end);
  const up = intervals(c, start, end);
  const length = up.reduce((n, [a, b]) => n + b - a, 0);
  return {
    sunrise: c.rises[0],
    sunset: c.sets[c.sets.length - 1],
    length,
    state: c.rises.length || c.sets.length ? "normal" : c.aboveAtStart ? "up" : "down",
  };
}

export function sunDay(day: Day, place: Place): SunDay {
  const zone = zoneOf(place);
  const start = startOfDay(day, zone);
  const end = startOfDay(addDays(day, 1), zone);
  const f = sunAltitude(place.latitude, place.longitude);
  let noon = solarTransit((start + end) / 2, place.longitude);
  if (noon < start) noon += DAY;
  if (noon >= end) noon -= DAY;
  return {
    day,
    start,
    end,
    ...sunTimes(day, place),
    noon,
    noonAltitude: f(noon),
    civil: twilight(f, -6, start, end),
    nautical: twilight(f, -12, start, end),
    astronomical: twilight(f, -18, start, end),
    golden: windows(f, -4, 6, start, end, noon),
    blue: windows(f, -6, -4, start, end, noon),
  };
}

/** The next sunrise (or sunset) after `from`, looking up to half a year ahead: for polar days and nights. */
export function nextSunEvent(from: number, place: Place, kind: "rise" | "set", days = 190): number | undefined {
  const f = sunAltitude(place.latitude, place.longitude);
  for (let d = 0; d < days; d += 10) {
    const c = crossings((t) => f(t) - SUN_HORIZON, from + d * DAY, from + (d + 10) * DAY, HOUR);
    const t = kind === "rise" ? c.rises[0] : c.sets[0];
    if (t !== undefined) return t;
  }
  return undefined;
}

export interface MoonDay {
  moonrise?: number;
  moonset?: number;
  /** Above the horizon at the start of the day. */
  upAtStart: boolean;
  /** The phase at noon (or now, for today). */
  phase: Illumination;
  /** Distance from the Earth, km. */
  distance: number;
}

export function moonDay(day: Day, place: Place, at?: number): MoonDay {
  const zone = zoneOf(place);
  const start = startOfDay(day, zone);
  const end = startOfDay(addDays(day, 1), zone);
  const c = crossings(
    (t) => {
      const p = moonPosition(t);
      return moonHorizontal(t, place.latitude, place.longitude).altitude - moonHorizon(p.distance);
    },
    start,
    end,
  );
  const when = at ?? (start + end) / 2;
  return {
    moonrise: c.rises[0],
    moonset: c.sets[0],
    upAtStart: c.aboveAtStart,
    phase: illumination(when),
    distance: moonPosition(when).distance,
  };
}

export interface PhaseEvent {
  name: string;
  emoji: string;
  at: number;
}

const PRINCIPAL = [
  { angle: 0, name: "New Moon", emoji: "🌑" },
  { angle: 90, name: "First Quarter", emoji: "🌓" },
  { angle: 180, name: "Full Moon", emoji: "🌕" },
  { angle: 270, name: "Last Quarter", emoji: "🌗" },
];

/** The next new moon, first quarter, full moon and last quarter after `from`, soonest first. */
export function nextPhases(from: number): PhaseEvent[] {
  return PRINCIPAL.map((p) => ({ name: p.name, emoji: p.emoji, at: nextPhaseAt(from, p.angle) }))
    .sort((a, b) => a.at - b.at);
}

/** "Waxing Gibbous", with its emoji. The principal phases last about a day (±6° around them). */
export function phaseName(angle: number): { name: string; emoji: string } {
  const near = (target: number) => Math.abs(((angle - target + 540) % 360) - 180) < 6;
  if (near(0)) return { name: "New Moon", emoji: "🌑" };
  if (near(90)) return { name: "First Quarter", emoji: "🌓" };
  if (near(180)) return { name: "Full Moon", emoji: "🌕" };
  if (near(270)) return { name: "Last Quarter", emoji: "🌗" };
  if (angle < 90) return { name: "Waxing Crescent", emoji: "🌒" };
  if (angle < 180) return { name: "Waxing Gibbous", emoji: "🌔" };
  if (angle < 270) return { name: "Waning Gibbous", emoji: "🌖" };
  return { name: "Waning Crescent", emoji: "🌘" };
}

// ---------------------------------------------------------------------------
// Formatting

export type Clock = "24h" | "12h";

export function clockOf(pref: unknown): Clock {
  return pref === true || /^(?:true|12)/.test(String(pref ?? "")) ? "12h" : "24h";
}

/** To the nearest minute, as published tables do. */
export function formatTime(ms: number, zone: string, clock: Clock = "24h"): string {
  return new Intl.DateTimeFormat(clock === "12h" ? "en-US" : "en-GB", {
    timeZone: zone,
    hour: clock === "12h" ? "numeric" : "2-digit",
    minute: "2-digit",
    hourCycle: clock === "12h" ? "h12" : "h23",
  }).format(new Date(ms + 30_000));
}

/** "Mon 21 Dec", with the year when it isn't the current one. */
export function formatDay(day: Day, today?: Day): string {
  const sameYear = today && today.slice(0, 4) === day.slice(0, 4);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  }).formatToParts(new Date(`${day}T12:00:00Z`));
  return parts.filter((p) => p.type !== "literal").map((p) => p.value).join(" ");
}

/** "Today", "Tomorrow", "Yesterday" or the date. */
export function dayLabel(day: Day, today: Day): string {
  const n = daysBetween(today, day);
  const named = n === 0 ? "Today" : n === 1 ? "Tomorrow" : n === -1 ? "Yesterday" : undefined;
  return named ? `${named}, ${formatDay(day, today)}` : formatDay(day, today);
}

/** "Sat 5 Dec, 23:14" */
export function formatMoment(ms: number, zone: string, clock: Clock = "24h", today?: Day): string {
  return `${formatDay(dayOf(ms, zone), today)}, ${formatTime(ms, zone, clock)}`;
}

/** "8 h 15 min" */
export function formatDuration(ms: number): string {
  const total = Math.round(Math.abs(ms) / MINUTE);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${pad(m)} min` : `${h} h`;
}

/** "+2 min 13 s", "−45 s" */
export function formatChange(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s === 0) return "same length";
  const sign = s > 0 ? "+" : "−";
  const a = Math.abs(s);
  const m = Math.floor(a / 60);
  return `${sign}${m ? `${m} min ` : ""}${a % 60} s`;
}

/** "in 2 h 10 min", "3 days ago" */
export function relative(ms: number, now: number): string {
  const d = ms - now;
  const a = Math.abs(d);
  const text = a < MINUTE
    ? "less than a minute"
    : a < DAY
    ? formatDuration(a)
    : `${Math.round(a / DAY)} day${Math.round(a / DAY) === 1 ? "" : "s"}`;
  return d >= 0 ? `in ${text}` : `${text} ago`;
}

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

export function compass(azimuth: number): string {
  return POINTS[Math.round((((azimuth % 360) + 360) % 360) / 22.5) % 16];
}

const direction = (azimuth: number) => `${Math.round(azimuth)}° ${compass(azimuth)}`;
const degrees = (altitude: number) => `${Math.round(altitude)}°`;
const percent = (fraction: number) => `${Math.round(fraction * 100)} %`;

export function suncalcUrl(place: Place, day: Day): string {
  return `https://www.suncalc.org/#/${place.latitude.toFixed(4)},${place.longitude.toFixed(4)},10/${
    day.replaceAll("-", ".")
  }/12:00/1/3`;
}

// ---------------------------------------------------------------------------
// Items

export interface View {
  place: Place;
  day: Day;
  /** The day it is at the place now. */
  today: Day;
  now: number;
  clock: Clock;
  sun: SunDay;
  /** Yesterday's day length, to show the change. */
  yesterdayLength: number;
  moon: MoonDay;
  phases: PhaseEvent[];
  /** For polar days and nights, when the Sun comes back (or sets again). */
  nextSunrise?: number;
  nextSunset?: number;
  /** The next 7 days' sunrise, sunset and day length. */
  week: { day: Day; sunrise?: number; sunset?: number; length: number; state: SunDay["state"] }[];
}

export function computeView(place: Place, day: Day, now: number, clock: Clock = "24h"): View {
  const zone = zoneOf(place);
  const today = dayOf(now, zone);
  const sun = sunDay(day, place);
  const isToday = day === today;
  const week = Array.from({ length: 7 }, (_, i) => ({ day: addDays(day, i), ...sunTimes(addDays(day, i), place) }));
  return {
    place,
    day,
    today,
    now,
    clock,
    sun,
    yesterdayLength: sunTimes(addDays(day, -1), place).length,
    moon: moonDay(day, place, isToday ? now : undefined),
    phases: nextPhases(isToday ? now : sun.start),
    nextSunrise: sun.state === "down" ? nextSunEvent(sun.end, place, "rise") : undefined,
    nextSunset: sun.state === "up" ? nextSunEvent(sun.end, place, "set") : undefined,
    week,
  };
}

/** "Paris, Today, Sun 1 Nov: sunrise 07:30, sunset 17:20 (9 h 50 min of daylight). Moon: Waxing Gibbous, 78 % lit." */
export function summaryText(v: View): string {
  const zone = zoneOf(v.place);
  const t = (ms?: number) => ms === undefined ? "none" : formatTime(ms, zone, v.clock);
  const sun = v.sun.state === "up"
    ? "the Sun doesn't set (midnight sun)"
    : v.sun.state === "down"
    ? "the Sun doesn't rise (polar night)"
    : `sunrise ${t(v.sun.sunrise)}, sunset ${t(v.sun.sunset)} (${formatDuration(v.sun.length)} of daylight)`;
  const phase = phaseName(v.moon.phase.angle);
  return `${v.place.name}, ${dayLabel(v.day, v.today)}: ${sun}. Moon: ${phase.name}, ${
    percent(v.moon.phase.fraction)
  } lit.`;
}

/** What the root search shows next to the command: "↑ 07:30 ↓ 17:20 · 🌔 78 %". */
export function subtitle(v: View): string {
  const zone = zoneOf(v.place);
  const phase = phaseName(v.moon.phase.angle);
  const sun = v.sun.state === "normal"
    ? `↑ ${v.sun.sunrise ? formatTime(v.sun.sunrise, zone, v.clock) : "—"} ↓ ${
      v.sun.sunset ? formatTime(v.sun.sunset, zone, v.clock) : "—"
    }`
    : v.sun.state === "up"
    ? "Midnight sun"
    : "Polar night";
  return `${sun} · ${phase.emoji} ${percent(v.moon.phase.fraction)} · ${v.place.name}`;
}

function sunDetail(v: View, intro: string): Item["detail"] {
  const zone = zoneOf(v.place);
  const t = (ms?: number) => ms === undefined ? "—" : formatTime(ms, zone, v.clock);
  const range = (w: Window) => `${t(w.from)}–${t(w.to)}`;
  const stats: Stat[] = v.sun.state === "normal"
    ? [
      { label: "Sunrise", value: t(v.sun.sunrise), color: "orange" },
      { label: "Sunset", value: t(v.sun.sunset), color: "purple" },
      { label: "Daylight", value: formatDuration(v.sun.length), color: "yellow" },
    ]
    : [
      { label: v.sun.state === "up" ? "Midnight sun" : "Polar night", value: "All day", color: "yellow" },
      { label: "Noon altitude", value: degrees(v.sun.noonAltitude) },
    ];
  const week = [
    "| Day | Sunrise | Sunset | Daylight |",
    "|---|---|---|---|",
    ...v.week.map((w) =>
      `| ${formatDay(w.day, v.today)} | ${w.state === "normal" ? t(w.sunrise) : "—"} | ${
        w.state === "normal" ? t(w.sunset) : "—"
      } | ${w.state === "up" ? "24 h" : w.state === "down" ? "0 min" : formatDuration(w.length)} |`
    ),
  ];
  const metadata: Metadata[] = [
    meta.text("Solar noon", `${t(v.sun.noon)} · ${degrees(v.sun.noonAltitude)} high`, { icon: Icons.sun }),
    meta.text("Change", `${formatChange(v.sun.length - v.yesterdayLength)} vs yesterday`, {
      icon: v.sun.length >= v.yesterdayLength ? Icons.arrowUp : Icons.arrowDown,
    }),
    ...v.sun.golden.map((w) => meta.text(`Golden hour (${w.part})`, range(w), { color: "yellow" })),
    ...v.sun.blue.map((w) => meta.text(`Blue hour (${w.part})`, range(w), { color: "blue" })),
    meta.separator(),
    meta.text("Civil twilight", `${t(v.sun.civil.dawn)} · ${t(v.sun.civil.dusk)}`),
    meta.text("Nautical twilight", `${t(v.sun.nautical.dawn)} · ${t(v.sun.nautical.dusk)}`),
    meta.text("Astronomical twilight", `${t(v.sun.astronomical.dawn)} · ${t(v.sun.astronomical.dusk)}`),
    meta.separator(),
    meta.text("Place", placeLabel(v.place), { icon: Icons.pin }),
    meta.text("Time zone", zone, { icon: Icons.clock }),
  ];
  return { stats, markdown: [intro, "", "### The week", "", ...week].join("\n"), metadata };
}

function moonDetail(v: View, intro: string): Item["detail"] {
  const zone = zoneOf(v.place);
  const phase = phaseName(v.moon.phase.angle);
  const stats: Stat[] = [
    { label: "Lit", value: percent(v.moon.phase.fraction), color: "yellow" },
    { label: "Age", value: `${v.moon.phase.age.toFixed(1)} days` },
    { label: "Distance", value: `${Math.round(v.moon.distance).toLocaleString("en")} km` },
  ];
  const metadata: Metadata[] = [
    meta.text("Phase", `${phase.emoji} ${phase.name}`),
    meta.progress("Lit", v.moon.phase.fraction),
    meta.text("Moonrise", v.moon.moonrise ? formatTime(v.moon.moonrise, zone, v.clock) : "None this day", {
      icon: Icons.arrowUp,
    }),
    meta.text("Moonset", v.moon.moonset ? formatTime(v.moon.moonset, zone, v.clock) : "None this day", {
      icon: Icons.arrowDown,
    }),
    meta.separator(),
    ...v.phases.map((p) => meta.text(`${p.emoji} ${p.name}`, formatMoment(p.at, zone, v.clock, v.today))),
  ];
  return { stats, markdown: intro, metadata };
}

/** Everything about one day at one place: the Sun first, then the Moon. */
export function viewItems(v: View, extra: Action[] = []): Item[] {
  const zone = zoneOf(v.place);
  const t = (ms: number) => formatTime(ms, zone, v.clock);
  const sunSection = `Sun · ${v.place.name} · ${dayLabel(v.day, v.today)}`;
  const moonSection = "Moon";
  const summary = copy(summaryText(v), "Copy Summary", { icon: Icons.text, shortcut: "<Ctrl><Shift>c" });
  const actions = (main?: Action) => [...(main ? [main] : []), summary, ...extra];
  const items: Item[] = [];
  const lat = v.place.latitude;
  const lon = v.place.longitude;

  if (v.day === v.today) {
    const pos = sunHorizontal(v.now, lat, lon);
    const alt = pos.altitude + refraction(pos.altitude);
    const next = [
      ...(v.sun.sunrise && v.sun.sunrise > v.now ? [{ at: v.sun.sunrise, what: "Rises" }] : []),
      ...(v.sun.sunset && v.sun.sunset > v.now ? [{ at: v.sun.sunset, what: "Sets" }] : []),
    ].sort((a, b) => a.at - b.at)[0];
    const up = alt > SUN_HORIZON;
    items.push({
      id: "now",
      title: up ? `${degrees(alt)} above the horizon` : `${degrees(-alt)} below the horizon`,
      subtitle: [
        `Toward ${direction(pos.azimuth)}`,
        next ? `${next.what} ${relative(next.at, v.now)}` : undefined,
      ].filter(Boolean).join(" · "),
      icon: { source: up ? Icons.sun : Icons.moon, tint: up ? "yellow" : "blue" },
      section: sunSection,
      accessories: [{ tag: "Now", color: up ? "yellow" : "blue" }],
      keywords: ["now", "altitude", "azimuth", "position", "elevation"],
      detail: sunDetail(
        v,
        `## The Sun now\n\n${up ? "Up" : "Down"}, ${Math.abs(alt).toFixed(1)}° ${
          up ? "above" : "below"
        } the horizon, toward ${direction(pos.azimuth)}${up ? `: a 1 m pole casts a ${shadow(alt)} shadow` : ""}.`,
      ),
      actions: actions(copy(`${alt.toFixed(1)}° altitude, ${pos.azimuth.toFixed(1)}° azimuth`, "Copy Position")),
    });
  }

  if (v.sun.state === "normal") {
    for (
      const [id, title, at, color, words, text] of [
        ["sunrise", "Sunrise", v.sun.sunrise, "orange", ["lever du soleil", "dawn"], "The top of the Sun appears."],
        ["noon", "Solar Noon", v.sun.noon, "yellow", ["midi solaire", "zenith", "highest"], "The Sun is highest."],
        ["sunset", "Sunset", v.sun.sunset, "purple", ["coucher du soleil"], "The Sun disappears."],
      ] as const
    ) {
      if (at === undefined) {
        items.push({
          id,
          title,
          subtitle: `No ${title.toLowerCase()} this day`,
          icon: { source: Icons.sun, tint: "gray" },
          section: sunSection,
          detail: sunDetail(v, `## No ${title.toLowerCase()} on ${formatDay(v.day, v.today)}`),
          actions: actions(),
        });
        continue;
      }
      const pos = sunHorizontal(at, lat, lon);
      items.push({
        id,
        title,
        subtitle: id === "noon" ? `${degrees(pos.altitude)} above the horizon` : `Toward ${direction(pos.azimuth)}`,
        icon: { source: id === "noon" ? Icons.sun : id === "sunrise" ? Icons.arrowUp : Icons.arrowDown, tint: color },
        section: sunSection,
        keywords: [...words],
        accessories: [
          ...(v.day === v.today ? [{ text: relative(at, v.now) }] : []),
          { tag: t(at), color },
        ],
        detail: sunDetail(v, `## ${title} at ${t(at)}\n\n${text}`),
        actions: actions(copy(t(at), "Copy Time")),
      });
    }
  } else {
    const back = v.sun.state === "down" ? v.nextSunrise : v.nextSunset;
    const name = v.sun.state === "up" ? "Midnight Sun" : "Polar Night";
    const sentence = v.sun.state === "up"
      ? "The Sun stays above the horizon all day."
      : "The Sun stays below the horizon all day.";
    const until = back
      ? `${v.sun.state === "up" ? "It sets again" : "It rises again"} on ${formatMoment(back, zone, v.clock, v.today)}.`
      : "";
    items.push({
      id: "polar",
      title: name,
      subtitle: until || sentence,
      icon: { source: v.sun.state === "up" ? Icons.sun : Icons.moon, tint: v.sun.state === "up" ? "yellow" : "blue" },
      section: sunSection,
      keywords: ["midnight sun", "polar night", "soleil de minuit", "nuit polaire"],
      detail: sunDetail(v, `## ${name}\n\n${sentence} ${until}`),
      actions: actions(back ? copy(formatMoment(back, zone, v.clock, v.today), "Copy Date") : undefined),
    });
  }

  const change = v.sun.length - v.yesterdayLength;
  items.push({
    id: "length",
    title: "Day Length",
    subtitle: `${formatChange(change)} vs yesterday`,
    icon: { source: Icons.hourglass, tint: change >= 0 ? "green" : "orange" },
    section: sunSection,
    keywords: ["daylight", "durée du jour", "longer", "shorter"],
    accessories: [{ tag: v.sun.state === "up" ? "24 h" : formatDuration(v.sun.length), color: "yellow" }],
    detail: sunDetail(
      v,
      `## ${formatDuration(v.sun.length)} of daylight\n\nDays are getting ${change >= 0 ? "longer" : "shorter"}: ${
        formatChange(change)
      } compared with yesterday.`,
    ),
    actions: actions(copy(formatDuration(v.sun.length), "Copy Day Length")),
  });

  const windowItem = (w: Window, kind: "golden" | "blue"): Item => {
    const name = kind === "golden" ? "Golden Hour" : "Blue Hour";
    const range = `${t(w.from)}–${t(w.to)}`;
    return {
      id: `${kind}:${w.part}:${w.from}`,
      title: `${name}${w.part === "all day" ? "" : `, ${w.part}`}`,
      subtitle: kind === "golden"
        ? "Soft, warm light: the Sun between 4° below and 6° above the horizon"
        : "Deep blue sky: the Sun between 6° and 4° below the horizon",
      icon: { source: kind === "golden" ? Icons.camera : Icons.moon, tint: kind === "golden" ? "yellow" : "blue" },
      section: sunSection,
      keywords: kind === "golden" ? ["photo", "heure dorée", "golden"] : ["photo", "heure bleue", "blue"],
      accessories: [{ text: formatDuration(w.to - w.from) }, {
        tag: range,
        color: kind === "golden" ? "yellow" : "blue",
      }],
      detail: sunDetail(v, `## ${name}${w.part === "all day" ? "" : ` (${w.part})`}: ${range}`),
      actions: actions(copy(range, "Copy Times")),
    };
  };
  const windowsInOrder = [
    ...v.sun.golden.map((w) => ({ w, kind: "golden" as const })),
    ...v.sun.blue.map((w) => ({ w, kind: "blue" as const })),
  ].sort((a, b) => a.w.from - b.w.from);
  items.push(...windowsInOrder.map(({ w, kind }) => windowItem(w, kind)));

  for (
    const [id, name, tw, depth, text] of [
      ["civil", "Civil Twilight", v.sun.civil, 6, "Enough light to be outdoors without lights."],
      ["nautical", "Nautical Twilight", v.sun.nautical, 12, "The horizon is still visible at sea."],
      ["astronomical", "Astronomical Twilight", v.sun.astronomical, 18, "After it, the sky is fully dark."],
    ] as const
  ) {
    const parts = [tw.dawn && `dawn ${t(tw.dawn)}`, tw.dusk && `dusk ${t(tw.dusk)}`].filter(Boolean).join(" · ");
    items.push({
      id,
      title: name,
      subtitle: parts
        ? `Sun ${depth}° below the horizon`
        : `The Sun doesn't cross ${depth}° below the horizon this day`,
      icon: { source: Icons.inProgress, tint: "purple" },
      section: sunSection,
      keywords: ["twilight", "crépuscule", "aube", "dawn", "dusk"],
      accessories: parts ? [{ text: parts }] : [{ text: "None" }],
      detail: sunDetail(v, `## ${name}\n\nBetween sunset and the Sun ${depth}° below the horizon. ${text}`),
      actions: actions(parts ? copy(parts, "Copy Times") : undefined),
    });
  }

  // The Moon
  const phase = phaseName(v.moon.phase.angle);
  const moonNow = v.day === v.today ? moonHorizontal(v.now, lat, lon) : undefined;
  items.push({
    id: "phase",
    title: phase.name,
    subtitle: `${percent(v.moon.phase.fraction)} lit · ${v.moon.phase.waxing ? "waxing" : "waning"} · ${
      v.moon.phase.age.toFixed(1)
    } days old`,
    icon: phase.emoji,
    section: moonSection,
    keywords: ["moon phase", "phase de la lune", "illumination", "lune"],
    accessories: [
      ...(moonNow
        ? [{
          text: moonNow.altitude > 0 ? `up, ${direction(moonNow.azimuth)}` : "below the horizon",
          tooltip: `${moonNow.altitude.toFixed(1)}° altitude`,
        }]
        : []),
      { tag: percent(v.moon.phase.fraction), color: "yellow" as Color },
    ],
    detail: moonDetail(
      v,
      `## ${phase.emoji} ${phase.name}\n\n${percent(v.moon.phase.fraction)} of the Moon's disk is lit${
        moonNow
          ? `; it is ${
            moonNow.altitude > 0
              ? `${degrees(moonNow.altitude)} above the horizon, toward ${direction(moonNow.azimuth)}`
              : "below the horizon"
          }`
          : ""
      }.`,
    ),
    actions: actions(copy(`${phase.emoji} ${phase.name}, ${percent(v.moon.phase.fraction)} lit`, "Copy Phase")),
  });
  const moonEvents = [
    { id: "moonrise", title: "Moonrise", at: v.moon.moonrise, icon: Icons.arrowUp },
    { id: "moonset", title: "Moonset", at: v.moon.moonset, icon: Icons.arrowDown },
  ].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
  for (const e of moonEvents) {
    const pos = e.at !== undefined ? moonHorizontal(e.at, lat, lon) : undefined;
    items.push({
      id: e.id,
      title: e.title,
      subtitle: e.at === undefined
        ? `None this day: the Moon is ${v.moon.upAtStart ? "up" : "down"} at midnight`
        : `Toward ${direction(pos!.azimuth)}`,
      icon: { source: e.icon, tint: e.at === undefined ? "gray" : "blue" },
      section: moonSection,
      keywords: [e.id === "moonrise" ? "lever de la lune" : "coucher de la lune"],
      accessories: e.at === undefined
        ? [{ text: "None" }]
        : [...(v.day === v.today ? [{ text: relative(e.at, v.now) }] : []), { tag: t(e.at), color: "blue" }],
      detail: moonDetail(v, `## ${e.title}${e.at === undefined ? ": none this day" : ` at ${t(e.at)}`}`),
      actions: actions(e.at === undefined ? undefined : copy(t(e.at), "Copy Time")),
    });
  }
  for (const p of v.phases) {
    const when = formatMoment(p.at, zone, v.clock, v.today);
    items.push({
      id: `next:${p.name}`,
      title: `Next ${p.name}`,
      subtitle: relative(p.at, v.day === v.today ? v.now : v.sun.start).replace(/^in /, "In "),
      icon: p.emoji,
      section: moonSection,
      keywords: [
        p.name === "Full Moon" ? "pleine lune" : p.name === "New Moon" ? "nouvelle lune" : "quartier",
      ],
      accessories: [{ tag: when }],
      detail: moonDetail(v, `## ${p.emoji} ${p.name}\n\n${when} (${zone}).`),
      actions: actions(copy(when, "Copy Date")),
    });
  }
  return items;
}

/** The length of the shadow of a 1 m pole with the Sun at `altitude` degrees. */
export function shadow(altitude: number): string {
  if (altitude <= 0.5) return "very long";
  const l = 1 / Math.tan((altitude * Math.PI) / 180);
  return l >= 100 ? "very long" : `${l < 10 ? l.toFixed(1) : Math.round(l)} m`;
}
