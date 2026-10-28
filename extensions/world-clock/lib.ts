// World clock logic: time zone arithmetic with Intl (no network, no tz
// database of our own), city lookup and "3pm NY in Paris" conversions.

import { CITIES, type City } from "./cities.ts";

export type { City };
export { CITIES };

/** A clock the user keeps: a city, or "local" for this computer's zone. */
export interface Place {
  id: string;
  name: string;
  zone: string;
  country?: string;
  local?: boolean;
}

export const LOCAL_ID = "local";

export const localZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

export function localPlace(zone = localZone()): Place {
  return { id: LOCAL_ID, name: "Local", zone, local: true };
}

export const cityId = (c: City) => `${c.zone}#${c.name}`;

export function placeOf(c: City): Place {
  return { id: cityId(c), name: c.name, zone: c.zone, country: c.country };
}

export const DEFAULT_PLACES = [LOCAL_ID, "America/New_York#New York", "Europe/London#London", "Asia/Tokyo#Tokyo"];

/** Resolves stored ids (unknown ones are dropped). */
export function placesFromIds(ids: string[], zone = localZone()): Place[] {
  const out: Place[] = [];
  for (const id of ids) {
    if (id === LOCAL_ID) out.push(localPlace(zone));
    else {
      const city = CITIES.find((c) => cityId(c) === id);
      if (city) out.push(placeOf(city));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Time zone arithmetic

export interface Wall {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

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

export function isValidZone(zone: string): boolean {
  try {
    formatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** The wall clock in `zone` at instant `at` (ms). */
export function wallClock(zone: string, at: number): Wall {
  const parts: Record<string, number> = {};
  for (const p of formatter(zone).formatToParts(new Date(at))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const hour = parts.hour === 24 ? 0 : parts.hour;
  const weekday = new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour,
    minute: parts.minute,
    second: parts.second,
    weekday,
  };
}

/** Minutes east of UTC in `zone` at instant `at`: Paris in summer is 120. */
export function zoneOffset(zone: string, at: number): number {
  const w = wallClock(zone, at);
  const asUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return Math.round((asUtc - Math.floor(at / 1000) * 1000) / 60000);
}

/**
 * The instant at which the wall clock in `zone` shows this date and time.
 * In a DST gap the time is moved forward, in an overlap the first one wins.
 */
export function zonedToInstant(zone: string, year: number, month: number, day: number, hour = 0, minute = 0): number {
  const civil = Date.UTC(year, month - 1, day, hour, minute);
  const before = zoneOffset(zone, civil - 86_400_000), after = zoneOffset(zone, civil + 86_400_000);
  const valid = [before, after]
    .map((off) => civil - off * 60000)
    .filter((t) => civil - zoneOffset(zone, t) * 60000 === t);
  if (valid.length) return Math.min(...valid);
  // In a gap: the offset from before the jump moves the time forward (2:30 → 3:30).
  return civil - before * 60000;
}

/** "UTC+2", "UTC−5", "UTC+5:30". */
export function formatUtcOffset(minutes: number): string {
  if (minutes === 0) return "UTC";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60), m = abs % 60;
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, "0")}` : ""}`;
}

/** Difference with the local clock: "+9h", "−5h", "+5h30", "Same time". */
export function formatDiff(minutes: number): string {
  if (minutes === 0) return "Same time";
  const sign = minutes > 0 ? "+" : "−";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60), m = abs % 60;
  return `${sign}${h}h${m ? String(m).padStart(2, "0") : ""}`;
}

/** Calendar days between the wall dates of two zones at `at`: Tokyo vs Paris late evening is 1. */
export function dayDiff(zone: string, reference: string, at: number): number {
  const a = wallClock(zone, at), b = wallClock(reference, at);
  return Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000);
}

export function dayLabel(diff: number): string | undefined {
  if (diff === 0) return undefined;
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return diff > 0 ? `+${diff} days` : `${diff} days`;
}

/** Daytime is 6:00 to 18:59, for the sun and moon icons. */
export const isDaytime = (hour: number) => hour >= 6 && hour < 19;

/** Office hours, for "a good time to call". */
export const isWorkingHours = (w: Wall) => w.weekday >= 1 && w.weekday <= 5 && w.hour >= 9 && w.hour < 18;

export function formatTime(zone: string, at: number, hour12 = false): string {
  return new Date(at).toLocaleTimeString(hour12 ? "en-US" : "en-GB", {
    timeZone: zone,
    hour: hour12 ? "numeric" : "2-digit",
    minute: "2-digit",
    hour12,
  });
}

export function formatDate(zone: string, at: number): string {
  return new Date(at).toLocaleDateString("en-GB", {
    timeZone: zone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function shortDate(zone: string, at: number): string {
  return new Date(at).toLocaleDateString("en-GB", { timeZone: zone, weekday: "short", day: "numeric", month: "short" });
}

/** The zone's abbreviation where Intl knows one ("CET", "EST"), else its offset. */
export function zoneAbbreviation(zone: string, at: number): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(new Date(at)).find((p) => p.type === "timeZoneName")?.value ?? "";
  return part.replace(/^GMT(?=[+-])/, "UTC");
}

/** The next change of UTC offset (DST) within a year, if any. */
export function nextTransition(zone: string, from: number): { at: number; before: number; after: number } | undefined {
  const start = zoneOffset(zone, from);
  const HOUR = 3_600_000;
  let lo = from;
  for (let t = from + 24 * HOUR; t <= from + 366 * 24 * HOUR; t += 24 * HOUR) {
    const off = zoneOffset(zone, t);
    if (off !== start) {
      let hi = t;
      while (hi - lo > 60_000) {
        const mid = Math.floor((lo + hi) / 2 / 60_000) * 60_000;
        if (zoneOffset(zone, mid) === start) lo = mid;
        else hi = mid;
      }
      return { at: hi, before: start, after: off };
    }
    lo = t;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Cities

/** Lowercase without accents: "São Paulo" → "sao paulo". */
export const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.'’]/g, "").replace(/\s+/g, " ").trim();

const HERE = new Set(["local", "here", "me", "ici", "home", "my time"]);

/** Cities matching a query, best first: exact name, alias, prefix, then substring. */
export function searchCities(query: string, cities = CITIES): City[] {
  const q = fold(query);
  if (!q) return [...cities];
  const scored: [number, City][] = [];
  for (const c of cities) {
    const name = fold(c.name);
    const aliases = c.aliases.map(fold);
    const zone = fold(c.zone.replace(/_/g, " "));
    let score = 0;
    if (name === q) score = 100;
    else if (aliases.includes(q)) score = 90;
    else if (name.startsWith(q)) score = 80;
    else if (fold(c.country) === q) score = 70;
    else if (aliases.some((a) => a.startsWith(q))) score = 60;
    else if (name.split(/[\s-]/).some((w) => w.startsWith(q))) score = 50;
    else if (fold(c.country).startsWith(q)) score = 40;
    else if (zone.includes(q)) score = 30;
    else if (name.includes(q)) score = 20;
    if (score) scored.push([score, c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([, c]) => c);
}

/** The place a piece of text names: a city, an alias, a zone id, or "local". */
export function resolvePlace(text: string, zone = localZone()): Place | undefined {
  const q = fold(text);
  if (!q) return undefined;
  if (HERE.has(q)) return localPlace(zone);
  const exactZone = CITIES.find((c) => fold(c.zone) === q);
  if (exactZone) return placeOf(exactZone);
  if (text.includes("/") && isValidZone(text.trim())) {
    const z = text.trim();
    return { id: z, name: z.split("/").pop()!.replace(/_/g, " "), zone: z };
  }
  const [best] = searchCities(q);
  if (!best) return undefined;
  // Fuzzy matches (substring) only count for words long enough to mean something.
  const name = fold(best.name);
  const strong = name === q || best.aliases.map(fold).includes(q) || name.startsWith(q) ||
    fold(best.country) === q;
  return strong || q.length >= 4 ? placeOf(best) : undefined;
}

// ---------------------------------------------------------------------------
// "15:00 paris to tokyo"

export interface TimeOfDay {
  hour: number;
  minute: number;
}

const TIME_RE =
  /(?:^|\s)(now|maintenant|noon|midday|midi|midnight|minuit|(\d{1,2})(?:[:.h](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.|h)?)(?=\s|$)/i;

/** A time in free text: "15:00", "3pm", "3:30 pm", "15h30", "15h", "noon". `undefined` hour means now. */
export function findTime(text: string): { time: TimeOfDay | "now"; rest: string } | undefined {
  const m = TIME_RE.exec(text);
  if (!m) return undefined;
  const word = m[1].toLowerCase();
  const rest = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).replace(/\s+/g, " ").trim();
  if (word === "now" || word === "maintenant") return { time: "now", rest };
  if (word === "noon" || word === "midday" || word === "midi") return { time: { hour: 12, minute: 0 }, rest };
  if (word === "midnight" || word === "minuit") return { time: { hour: 0, minute: 0 }, rest };
  const suffix = (m[4] ?? "").toLowerCase().replace(/\./g, "");
  // A bare number is not a time ("3 tokyo" means nothing); "15:00", "3pm" and "15h" are.
  if (!m[3] && !suffix && !/[:h]/i.test(m[1])) return undefined;
  let hour = Number(m[2]);
  const minute = m[3] ? Number(m[3]) : 0;
  if (minute > 59) return undefined;
  if (suffix === "am" || suffix === "pm") {
    if (hour < 1 || hour > 12) return undefined;
    if (suffix === "am" && hour === 12) hour = 0;
    if (suffix === "pm" && hour !== 12) hour += 12;
  } else if (hour > 23) return undefined;
  return { time: { hour, minute }, rest };
}

export interface Conversion {
  /** The instant meant. */
  at: number;
  from: Place;
  /** Undefined: convert to every saved clock. */
  to?: Place;
  /** The time as typed, `now` when none was. */
  time: TimeOfDay | "now";
}

const SEPARATOR = /\s+(?:to|in|into|->|→|=>|en|à|vers)\s+|\s*(?:->|→|=>)\s*/i;

/**
 * Parses "15:00 paris to tokyo", "3pm NY in Paris", "noon in london",
 * "9am tokyo" (to every clock), "paris to tokyo" (now). Undefined when the
 * query is not a conversion.
 */
export function parseConversion(query: string, now: number, zone = localZone()): Conversion | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const parts = q.split(SEPARATOR);
  const left = parts[0] ?? "";
  const right = parts.length > 1 ? parts.slice(1).join(" ") : undefined;
  const found = findTime(left);
  let to: Place | undefined;
  if (right !== undefined) {
    to = resolvePlace(right, zone);
    if (!to) return undefined;
  }
  let from: Place | undefined;
  let time: TimeOfDay | "now";
  if (found) {
    time = found.time;
    from = found.rest ? resolvePlace(found.rest, zone) : localPlace(zone);
    if (!from) return undefined;
  } else {
    // "paris to tokyo" converts the current time; a city alone is a search, not a conversion.
    if (right === undefined) return undefined;
    from = resolvePlace(left, zone);
    if (!from) return undefined;
    time = "now";
  }
  if (time === "now") return { at: now, from, to, time };
  const today = wallClock(from.zone, now);
  const at = zonedToInstant(from.zone, today.year, today.month, today.day, time.hour, time.minute);
  return { at, from, to, time };
}

/** Moves the clock `id` to the top, or up/down by one. */
export function move(ids: string[], id: string, where: "top" | "up" | "down" | "bottom"): string[] {
  const i = ids.indexOf(id);
  if (i === -1) return ids;
  const out = ids.filter((x) => x !== id);
  const at = where === "top" ? 0 : where === "bottom" ? out.length : where === "up" ? Math.max(0, i - 1) : i + 1;
  out.splice(Math.min(at, out.length), 0, id);
  return out;
}
