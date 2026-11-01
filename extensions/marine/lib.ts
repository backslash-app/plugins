// Open-Meteo Marine API (waves, swell, sea temperature, currents) plus the
// regular forecast for wind: request URLs, parsing, units and a rough surf
// rating. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// Places

/** A place found by the geocoding API, or typed as coordinates. */
export interface Place {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  timezone?: string;
}

export function placeLabel(p: Place): string {
  return [p.name, p.admin1 !== p.name ? p.admin1 : undefined, p.country].filter(Boolean).join(", ");
}

/** A stable key: typed coordinates have no geocoding id. */
export function placeKey(p: Place): string {
  return p.id ? String(p.id) : `${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}`;
}

export function geocodingUrl(name: string, count = 8): string {
  const q = new URLSearchParams({ name, count: String(count), language: "en", format: "json" });
  return `https://geocoding-api.open-meteo.com/v1/search?${q}`;
}

/** "Hossegor, France" → search "Hossegor", keep results in France first. */
export function splitQuery(query: string): { name: string; hint?: string } {
  const [name, ...rest] = query.split(",").map((s) => s.trim()).filter(Boolean);
  return { name: name ?? "", hint: rest.join(" ") || undefined };
}

export function rankPlaces(places: Place[], hint?: string): Place[] {
  if (!hint) return places;
  const h = hint.toLowerCase();
  const matches = (p: Place) =>
    [p.country, p.country_code, p.admin1].some((v) => v && (v.toLowerCase() === h || v.toLowerCase().startsWith(h)));
  return [...places.filter(matches), ...places.filter((p) => !matches(p))];
}

/** "43.66, -1.44" → a place: the precise way to name a surf spot. */
export function parseCoordinates(text: string): Place | undefined {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return undefined;
  const [latitude, longitude] = [Number(m[1]), Number(m[2])];
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { id: 0, name: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`, latitude, longitude };
}

// Requests

export const MARINE_CURRENT = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_period",
  "wind_wave_height",
  "wind_wave_direction",
  "wind_wave_period",
  "sea_surface_temperature",
  "ocean_current_velocity",
  "ocean_current_direction",
  "sea_level_height_msl",
];
export const MARINE_HOURLY = [
  "wave_height",
  "wave_direction",
  "wave_period",
  "swell_wave_height",
  "swell_wave_direction",
  "swell_wave_period",
  "wind_wave_height",
  "sea_surface_temperature",
  "sea_level_height_msl",
];
export const MARINE_DAILY = [
  "wave_height_max",
  "wave_direction_dominant",
  "wave_period_max",
  "swell_wave_height_max",
  "swell_wave_direction_dominant",
  "swell_wave_period_max",
  "wind_wave_height_max",
];

export const DAYS = 7;

export function marineUrl(latitude: number, longitude: number): string {
  const q = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: MARINE_CURRENT.join(","),
    hourly: MARINE_HOURLY.join(","),
    daily: MARINE_DAILY.join(","),
    timezone: "auto",
    forecast_days: String(DAYS),
    // A coastal town's own grid cell is often land: take the nearest sea cell.
    cell_selection: "sea",
  });
  return `https://marine-api.open-meteo.com/v1/marine?${q}`;
}

export function windUrl(latitude: number, longitude: number): string {
  const q = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    current: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    hourly: "wind_speed_10m,wind_direction_10m,wind_gusts_10m",
    daily: "wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset",
    timezone: "auto",
    forecast_days: String(DAYS),
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

type Values = Record<string, (number | null)[] | string[] | undefined>;

export interface MarineResponse {
  timezone?: string;
  current?: Record<string, number | string | null>;
  hourly?: Values & { time?: string[] };
  daily?: Values & { time?: string[] };
}

export interface WindResponse {
  timezone?: string;
  current?: Record<string, number | string | null>;
  hourly?: Values & { time?: string[] };
  daily?: Values & { time?: string[]; sunrise?: string[]; sunset?: string[] };
}

// Conditions

/** Sea and wind at one time. Heights in m, periods in s, speeds in km/h, directions "from", in degrees. */
export interface Conditions {
  time: string;
  waveHeight?: number;
  waveDirection?: number;
  wavePeriod?: number;
  swellHeight?: number;
  swellDirection?: number;
  swellPeriod?: number;
  windWaveHeight?: number;
  windWaveDirection?: number;
  windWavePeriod?: number;
  seaTemperature?: number;
  currentSpeed?: number;
  currentDirection?: number;
  seaLevel?: number;
  wind?: number;
  windDirection?: number;
  gusts?: number;
}

export interface DayConditions {
  date: string;
  waveHeight?: number;
  waveDirection?: number;
  wavePeriod?: number;
  swellHeight?: number;
  swellDirection?: number;
  swellPeriod?: number;
  windWaveHeight?: number;
  wind?: number;
  gusts?: number;
  windDirection?: number;
  sunrise?: string;
  sunset?: string;
}

export interface Sea {
  timezone?: string;
  /** No sea data: the place is inland. */
  inland: boolean;
  now: Conditions;
  /** The next 24 hours, from the current hour. */
  hours: Conditions[];
  days: DayConditions[];
}

const num = (v: unknown): number | undefined => typeof v === "number" && Number.isFinite(v) ? v : undefined;

function at(values: Values | undefined, key: string, i: number): number | undefined {
  return num((values?.[key] as unknown[] | undefined)?.[i]);
}

export function toSea(marine: MarineResponse, wind?: WindResponse, hours = 24): Sea {
  const c = marine.current ?? {};
  const w = wind?.current ?? {};
  const now: Conditions = {
    time: String(c.time ?? w.time ?? ""),
    waveHeight: num(c.wave_height),
    waveDirection: num(c.wave_direction),
    wavePeriod: num(c.wave_period),
    swellHeight: num(c.swell_wave_height),
    swellDirection: num(c.swell_wave_direction),
    swellPeriod: num(c.swell_wave_period),
    windWaveHeight: num(c.wind_wave_height),
    windWaveDirection: num(c.wind_wave_direction),
    windWavePeriod: num(c.wind_wave_period),
    seaTemperature: num(c.sea_surface_temperature),
    currentSpeed: num(c.ocean_current_velocity),
    currentDirection: num(c.ocean_current_direction),
    seaLevel: num(c.sea_level_height_msl),
    wind: num(w.wind_speed_10m),
    windDirection: num(w.wind_direction_10m),
    gusts: num(w.wind_gusts_10m),
  };
  const inland = now.waveHeight === undefined && now.seaTemperature === undefined &&
    !(marine.hourly?.wave_height ?? []).some((v) => num(v) !== undefined);

  const mh = marine.hourly;
  const times = mh?.time ?? [];
  const windIndex = new Map((wind?.hourly?.time ?? []).map((t, i) => [t, i]));
  // The current hour: "2026-11-01T18:30" → "2026-11-01T18:00".
  const hour = now.time.slice(0, 13);
  const start = Math.max(0, times.findIndex((t) => t.slice(0, 13) >= hour));
  const list: Conditions[] = times.slice(start, start + hours).map((time, k) => {
    const i = start + k;
    const j = windIndex.get(time);
    return {
      time,
      waveHeight: at(mh, "wave_height", i),
      waveDirection: at(mh, "wave_direction", i),
      wavePeriod: at(mh, "wave_period", i),
      swellHeight: at(mh, "swell_wave_height", i),
      swellDirection: at(mh, "swell_wave_direction", i),
      swellPeriod: at(mh, "swell_wave_period", i),
      windWaveHeight: at(mh, "wind_wave_height", i),
      seaTemperature: at(mh, "sea_surface_temperature", i),
      seaLevel: at(mh, "sea_level_height_msl", i),
      ...(j === undefined ? {} : {
        wind: at(wind?.hourly, "wind_speed_10m", j),
        windDirection: at(wind?.hourly, "wind_direction_10m", j),
        gusts: at(wind?.hourly, "wind_gusts_10m", j),
      }),
    };
  });

  const md = marine.daily;
  const wd = wind?.daily;
  const windDays = new Map((wd?.time ?? []).map((t, i) => [t, i]));
  const days: DayConditions[] = (md?.time ?? wd?.time ?? []).map((date, i) => {
    const j = windDays.get(date);
    return {
      date,
      waveHeight: at(md, "wave_height_max", i),
      waveDirection: at(md, "wave_direction_dominant", i),
      wavePeriod: at(md, "wave_period_max", i),
      swellHeight: at(md, "swell_wave_height_max", i),
      swellDirection: at(md, "swell_wave_direction_dominant", i),
      swellPeriod: at(md, "swell_wave_period_max", i),
      windWaveHeight: at(md, "wind_wave_height_max", i),
      ...(j === undefined ? {} : {
        wind: at(wd, "wind_speed_10m_max", j),
        gusts: at(wd, "wind_gusts_10m_max", j),
        windDirection: at(wd, "wind_direction_10m_dominant", j),
        sunrise: wd?.sunrise?.[j],
        sunset: wd?.sunset?.[j],
      }),
    };
  });
  return { timezone: marine.timezone ?? wind?.timezone, inland, now, hours: list, days };
}

// Directions

const POINTS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];

/** 306 → "NW". */
export function compass(degrees: number): string {
  return POINTS[Math.round((((degrees % 360) + 360) % 360) / 22.5) % 16];
}

/** The smallest angle between two directions, 0–180. */
export function angle(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export type WindRelation = "offshore" | "onshore" | "cross-shore";

/**
 * Waves come from the sea; wind blowing from the opposite way comes from the
 * land (offshore: clean waves), wind from the same way is onshore (choppy).
 */
export function windRelation(windDirection: number, waveDirection: number): WindRelation {
  const a = angle(windDirection, waveDirection);
  if (a >= 135) return "offshore";
  if (a <= 45) return "onshore";
  return "cross-shore";
}

// Units

export type Units = "metric" | "imperial";
export type WindUnit = "kmh" | "knots" | "mph" | "ms";

export function unitsOf(pref: unknown): Units {
  return String(pref ?? "").trim().toLowerCase().startsWith("imp") ? "imperial" : "metric";
}

export function windUnitOf(pref: unknown): WindUnit {
  const p = String(pref ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  if (p.startsWith("kn") || p === "kt" || p === "kts") return "knots";
  if (p === "mph") return "mph";
  if (p === "ms" || p.startsWith("met")) return "ms";
  return "kmh";
}

export function height(m: number | undefined, units: Units): string {
  if (m === undefined) return "—";
  return units === "imperial" ? `${(m * 3.28084).toFixed(1)} ft` : `${m.toFixed(1)} m`;
}

export function temperature(c: number | undefined, units: Units): string {
  if (c === undefined) return "—";
  return units === "imperial" ? `${Math.round(c * 9 / 5 + 32)} °F` : `${c.toFixed(1)} °C`;
}

export function speed(kmh: number | undefined, unit: WindUnit): string {
  if (kmh === undefined) return "—";
  if (unit === "knots") return `${Math.round(kmh / 1.852)} kn`;
  if (unit === "mph") return `${Math.round(kmh / 1.609344)} mph`;
  if (unit === "ms") return `${(kmh / 3.6).toFixed(1)} m/s`;
  return `${Math.round(kmh)} km/h`;
}

export function period(s: number | undefined): string {
  return s === undefined ? "—" : `${Math.round(s)} s`;
}

/** "1.4 m · 12 s · NW". */
export function swellText(h: number | undefined, p: number | undefined, d: number | undefined, units: Units): string {
  return [height(h, units), p !== undefined ? period(p) : undefined, d !== undefined ? compass(d) : undefined]
    .filter(Boolean).join(" · ");
}

// Surf

export interface Surf {
  score: number;
  label: string;
  color: Color;
  notes: string[];
  relation?: WindRelation;
}

const LABELS = ["Flat", "Poor", "Fair", "Good", "Very good", "Epic"];
const COLORS: Color[] = ["gray", "red", "orange", "yellow", "green", "purple"];

/**
 * A rough 0–5 rating from swell size and period and the wind: a guide to
 * pick a day, not a forecast of a particular break.
 */
export function surf(c: {
  waveHeight?: number;
  swellHeight?: number;
  swellPeriod?: number;
  wavePeriod?: number;
  swellDirection?: number;
  waveDirection?: number;
  wind?: number;
  windDirection?: number;
}): Surf | undefined {
  const h = c.swellHeight ?? c.waveHeight;
  if (h === undefined) return undefined;
  const notes: string[] = [];
  if ((c.waveHeight ?? h) < 0.3) {
    return { score: 0, label: LABELS[0], color: COLORS[0], notes: ["No waves to speak of"] };
  }
  let score = h < 0.6 ? 1 : h < 1.2 ? 2 : 3;
  const p = c.swellPeriod ?? c.wavePeriod;
  if (p !== undefined) {
    if (p >= 12) {
      score += 1;
      notes.push("Long-period groundswell");
    } else if (p < 7) {
      score -= 1;
      notes.push("Short-period wind swell");
    }
  }
  const dir = c.swellDirection ?? c.waveDirection;
  let relation: WindRelation | undefined;
  if (c.wind !== undefined) {
    relation = c.windDirection !== undefined && dir !== undefined ? windRelation(c.windDirection, dir) : undefined;
    if (c.wind < 8) {
      score += 1;
      notes.push("Glassy: almost no wind");
    } else if (relation === "offshore" && c.wind < 25) {
      score += 1;
      notes.push("Offshore wind: clean faces");
    } else if (relation === "onshore") {
      if (c.wind >= 20) score -= 2;
      else if (c.wind >= 10) score -= 1;
      notes.push("Onshore wind: choppy");
    } else if (c.wind >= 25) {
      score -= 1;
      notes.push(relation === "offshore" ? "Strong offshore wind" : "Strong cross-shore wind");
    }
    if (c.wind >= 40) {
      score -= 1;
      notes.push("Very windy");
    }
  }
  if (h >= 3) notes.push("Big waves: experienced surfers only");
  score = Math.max(1, Math.min(5, score));
  return { score, label: LABELS[score], color: COLORS[score], notes, relation };
}

/** The longest run of the best-rated daylight hours: "when to go". */
export function bestHours(hours: Conditions[], sunrise?: string, sunset?: string): Conditions[] {
  const day = hours.filter((h) => (!sunrise || h.time >= sunrise.slice(0, 13)) && (!sunset || h.time < sunset));
  const scored = day.map((h) => ({ h, s: surf(h)?.score ?? 0 }));
  const best = Math.max(0, ...scored.map((x) => x.s));
  if (best === 0) return [];
  let run: Conditions[] = [];
  let longest: Conditions[] = [];
  for (const x of scored) {
    if (x.s === best) run.push(x.h);
    else run = [];
    if (run.length > longest.length) longest = [...run];
  }
  return longest;
}

// Times

/** "2026-11-01T18:00" → "18:00". */
export const hourOf = (time: string) => time.slice(11, 16);

export function dayName(date: string, today: string): string {
  const next = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  if (date === today) return "Today";
  if (date === next) return "Tomorrow";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(Date.parse(`${date}T12:00:00Z`));
}

// Sharing

export function summary(sea: Sea, units: Units, wind: WindUnit): string {
  const n = sea.now;
  const s = surf(n);
  return [
    swellText(n.swellHeight ?? n.waveHeight, n.swellPeriod ?? n.wavePeriod, n.swellDirection ?? n.waveDirection, units),
    n.wind !== undefined
      ? `wind ${speed(n.wind, wind)}${n.windDirection !== undefined ? ` ${compass(n.windDirection)}` : ""}`
      : undefined,
    n.seaTemperature !== undefined ? `water ${temperature(n.seaTemperature, units)}` : undefined,
    s ? s.label : undefined,
  ].filter(Boolean).join(" · ");
}

export function shareText(sea: Sea, place: Place, units: Units, wind: WindUnit): string {
  return `${place.name} now: ${summary(sea, units, wind)} (Open-Meteo)`;
}

export function mapUrl(p: Place): string {
  return `https://www.windy.com/-Waves-waves?waves,${p.latitude.toFixed(3)},${p.longitude.toFixed(3)},10`;
}
