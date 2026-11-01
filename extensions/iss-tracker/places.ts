// Places and days: cities from Open-Meteo's geocoding or typed coordinates,
// calendar days in the place's time zone, and how times are written.
// Pure, tested in lib_test.ts.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

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
