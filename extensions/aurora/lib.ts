// Aurora: NOAA SWPC products (Kp index, solar wind, OVATION aurora model),
// geomagnetic latitude, darkness and the "can I see it tonight?" verdict.
// Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export const SWPC = "https://services.swpc.noaa.gov";
export const KP_FORECAST_URL = `${SWPC}/products/noaa-planetary-k-index-forecast.json`;
export const MAG_URL = `${SWPC}/products/summary/solar-wind-mag-field.json`;
export const SPEED_URL = `${SWPC}/products/summary/solar-wind-speed.json`;
export const OVATION_URL = `${SWPC}/json/ovation_aurora_latest.json`;
export const DASHBOARD_URL = "https://www.swpc.noaa.gov/products/aurora-30-minute-forecast";
export const THREE_DAY_URL = "https://www.swpc.noaa.gov/products/3-day-forecast";

const HOUR = 3_600_000;

// Places

/** A place found by the Open-Meteo geocoding API, or typed as coordinates. */
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

export function geocodingUrl(name: string, count = 8): string {
  const q = new URLSearchParams({ name, count: String(count), language: "en", format: "json" });
  return `https://geocoding-api.open-meteo.com/v1/search?${q}`;
}

/** "Tromsø, Norway" → search "Tromsø", keep results in Norway first. */
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

/** "69.65, 18.96" or "69.65 18.96" → a place, or undefined when it isn't coordinates. */
export function parseCoordinates(text: string): Place | undefined {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return undefined;
  const [latitude, longitude] = [Number(m[1]), Number(m[2])];
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { id: 0, name: `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`, latitude, longitude };
}

// Kp index

export type KpKind = "observed" | "estimated" | "predicted";

/** One 3-hour Kp value. `time` is the start of the period, in ms (UTC). */
export interface KpEntry {
  time: number;
  kp: number;
  kind: KpKind;
  scale?: string;
}

export interface KpForecastRow {
  time_tag: string;
  kp: number;
  observed: string;
  noaa_scale: string | null;
}

/** NOAA times have no zone: they are UTC. */
export function utc(tag: string): number {
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(tag) ? tag : `${tag}Z`);
}

export function parseKp(rows: KpForecastRow[]): KpEntry[] {
  return rows
    .filter((r) => r && typeof r.kp === "number" && r.time_tag)
    .map((r) => ({
      time: utc(r.time_tag),
      kp: r.kp,
      kind: (["observed", "estimated", "predicted"].includes(r.observed) ? r.observed : "predicted") as KpKind,
      scale: r.noaa_scale ?? undefined,
    }))
    .filter((e) => Number.isFinite(e.time))
    .sort((a, b) => a.time - b.time);
}

/** The latest measured (observed or estimated) Kp at `now`. */
export function currentKp(entries: KpEntry[], now: number): KpEntry | undefined {
  const measured = entries.filter((e) => e.kind !== "predicted" && e.time <= now);
  return measured.at(-1) ?? entries.find((e) => e.time <= now && now < e.time + 3 * HOUR);
}

/** The geomagnetic storm level of a Kp value (NOAA G scale; 5- already counts as G1). */
export function gScale(kp: number): string | undefined {
  const k = Math.round(kp * 3) / 3;
  if (k >= 9 - 1 / 3) return "G5";
  if (k >= 8 - 1 / 3) return "G4";
  if (k >= 7 - 1 / 3) return "G3";
  if (k >= 6 - 1 / 3) return "G2";
  if (k >= 5 - 1 / 3) return "G1";
  return undefined;
}

export function kpLabel(kp: number): string {
  const g = gScale(kp);
  if (g === "G5") return "Extreme storm";
  if (g === "G4") return "Severe storm";
  if (g === "G3") return "Strong storm";
  if (g === "G2") return "Moderate storm";
  if (g === "G1") return "Minor storm";
  if (kp >= 4 - 1 / 3) return "Active";
  if (kp >= 3 - 1 / 3) return "Unsettled";
  return "Quiet";
}

export function kpColor(kp: number): Color {
  const g = gScale(kp);
  if (g === "G4" || g === "G5") return "purple";
  if (g === "G2" || g === "G3") return "red";
  if (g === "G1") return "orange";
  if (kp >= 4 - 1 / 3) return "yellow";
  return "green";
}

/** 4.33 → "4+", 4.67 → "5-", 4 → "4": the way NOAA writes thirds. */
export function kpText(kp: number): string {
  const thirds = Math.round(kp * 3);
  const whole = Math.floor(thirds / 3);
  const rest = thirds - whole * 3;
  if (rest === 0) return String(whole);
  return rest === 1 ? `${whole}+` : `${whole + 1}-`;
}

// Geomagnetic latitude and the auroral oval

/** The north geomagnetic pole (IGRF, 2025). */
export const POLE = { latitude: 80.8, longitude: -72.7 };

const rad = (d: number) => d * Math.PI / 180;
const deg = (r: number) => r * 180 / Math.PI;

/** Latitude in a centered dipole model: where you are relative to the auroral oval. */
export function geomagneticLatitude(latitude: number, longitude: number): number {
  const s = Math.sin(rad(latitude)) * Math.sin(rad(POLE.latitude)) +
    Math.cos(rad(latitude)) * Math.cos(rad(POLE.latitude)) * Math.cos(rad(longitude - POLE.longitude));
  return deg(Math.asin(Math.max(-1, Math.min(1, s))));
}

/** How far equatorward the aurora reaches overhead, in geomagnetic latitude, for a Kp. */
export function overheadLatitude(kp: number): number {
  return 66.5 - 2.06 * kp;
}

/** Aurora overhead some 5° away still shows low on the horizon. */
export const HORIZON_MARGIN = 5;

export function horizonLatitude(kp: number): number {
  return overheadLatitude(kp) - HORIZON_MARGIN;
}

/** The Kp it takes to see aurora at a geomagnetic latitude, or undefined when even Kp 9 isn't enough. */
export function kpNeeded(magLat: number, horizon: boolean): number | undefined {
  const k = (66.5 - (horizon ? HORIZON_MARGIN : 0) - Math.abs(magLat)) / 2.06;
  if (k > 9) return undefined;
  return Math.max(0, Math.ceil(k * 3) / 3);
}

// Darkness

/** The sun's altitude in degrees (NOAA's low-precision formulas, good to a fraction of a degree). */
export function sunAltitude(time: number, latitude: number, longitude: number): number {
  const d = time / 86_400_000 + 2440587.5 - 2451545.0;
  const g = rad((357.529 + 0.98560028 * d) % 360);
  const q = (280.459 + 0.98564736 * d) % 360;
  const l = rad(q + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
  const e = rad(23.439 - 0.00000036 * d);
  const ra = Math.atan2(Math.cos(e) * Math.sin(l), Math.cos(l));
  const dec = Math.asin(Math.sin(e) * Math.sin(l));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = rad(gmst * 15 + longitude) - ra;
  const lat = rad(latitude);
  return deg(Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha)));
}

/** Aurora needs at least nautical darkness: the sun 12° below the horizon. */
export const DARK_ALTITUDE = -12;

export interface Window {
  start: number;
  end: number;
}

/**
 * The next dark period within 24 hours (the current one if it is dark now),
 * or undefined when the sun stays too high (summer near the poles).
 */
export function darkWindow(now: number, latitude: number, longitude: number, step = 5 * 60_000): Window | undefined {
  const dark = (t: number) => sunAltitude(t, latitude, longitude) < DARK_ALTITUDE;
  const limit = now + 24 * HOUR;
  let t = now;
  while (t <= limit && !dark(t)) t += step;
  if (t > limit) return undefined;
  const start = t;
  while (t <= start + 24 * HOUR && dark(t)) t += step;
  return { start, end: t };
}

// Solar wind

export interface SolarWind {
  speed?: number;
  bz?: number;
  bt?: number;
  time?: number;
}

export function parseSolarWind(
  mag: { bt?: number; bz_gsm?: number; time_tag?: string }[] | undefined,
  speed: { proton_speed?: number; time_tag?: string }[] | undefined,
): SolarWind {
  const m = mag?.[0];
  const s = speed?.[0];
  const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const times = [m?.time_tag, s?.time_tag].filter(Boolean).map((t) => utc(t!));
  return {
    speed: num(s?.proton_speed),
    bz: num(m?.bz_gsm),
    bt: num(m?.bt),
    time: times.length ? Math.max(...times) : undefined,
  };
}

/** A southward Bz (negative) opens the magnetosphere to the solar wind. */
export function bzVerdict(bz: number): { text: string; color: Color } {
  if (bz <= -10) return { text: "Strongly south: aurora likely to flare up", color: "green" };
  if (bz <= -5) return { text: "South: favorable", color: "green" };
  if (bz < 0) return { text: "Slightly south", color: "yellow" };
  return { text: "North: unfavorable", color: "gray" };
}

export function speedVerdict(speed: number): { text: string; color: Color } {
  if (speed >= 700) return { text: "Very fast", color: "green" };
  if (speed >= 500) return { text: "Fast", color: "green" };
  if (speed >= 400) return { text: "Moderate", color: "yellow" };
  return { text: "Slow", color: "gray" };
}

// OVATION aurora model

export interface OvationResponse {
  "Observation Time"?: string;
  "Forecast Time"?: string;
  coordinates?: [number, number, number][];
}

/** What the model says near one place: small enough to cache. */
export interface Ovation {
  /** Probability of visible aurora overhead, %. */
  here: number;
  /** The highest probability up to 10° poleward: aurora you might see on the horizon. */
  poleward: number;
  observed?: number;
  forecast?: number;
}

const lonKey = (lon: number) => ((Math.round(lon) % 360) + 360) % 360;

export function ovationAt(res: OvationResponse, latitude: number, longitude: number): Ovation {
  const grid = new Map<string, number>();
  for (const c of res.coordinates ?? []) {
    if (Array.isArray(c) && c.length >= 3) grid.set(`${lonKey(c[0])},${Math.round(c[1])}`, c[2]);
  }
  const lat = Math.round(latitude);
  const lon = lonKey(longitude);
  const at = (la: number, lo: number) => grid.get(`${lonKey(lo)},${la}`) ?? 0;
  const dir = latitude >= 0 ? 1 : -1;
  let poleward = 0;
  for (let dl = 0; dl <= 10; dl++) {
    const la = lat + dir * dl;
    if (Math.abs(la) > 90) break;
    for (let dlon = -5; dlon <= 5; dlon++) poleward = Math.max(poleward, at(la, lon + dlon));
  }
  const time = (s?: string) => s ? utc(s) : undefined;
  return {
    here: at(lat, lon),
    poleward,
    observed: time(res["Observation Time"]),
    forecast: time(res["Forecast Time"]),
  };
}

// Clouds (Open-Meteo)

export function cloudsUrl(latitude: number, longitude: number): string {
  const q = new URLSearchParams({
    latitude: latitude.toFixed(4),
    longitude: longitude.toFixed(4),
    hourly: "cloud_cover",
    timezone: "auto",
    forecast_days: "2",
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

export interface CloudsResponse {
  timezone?: string;
  utc_offset_seconds?: number;
  hourly?: { time?: string[]; cloud_cover?: (number | null)[] };
}

export interface Clouds {
  timezone?: string;
  hours: { time: number; cover: number }[];
}

/** Open-Meteo's local times, back to UTC milliseconds. */
export function toClouds(res: CloudsResponse): Clouds {
  const offset = (res.utc_offset_seconds ?? 0) * 1000;
  const times = res.hourly?.time ?? [];
  const cover = res.hourly?.cloud_cover ?? [];
  const hours = times.flatMap((t, i) => {
    const c = cover[i];
    return typeof c === "number" ? [{ time: Date.parse(`${t}:00Z`) - offset, cover: c }] : [];
  });
  return { timezone: res.timezone, hours };
}

/** Average cloud cover over a window, or undefined without data. */
export function cloudCover(clouds: Clouds | undefined, w: Window): number | undefined {
  const inside = (clouds?.hours ?? []).filter((h) => h.time + HOUR > w.start && h.time < w.end);
  if (!inside.length) return undefined;
  return Math.round(inside.reduce((n, h) => n + h.cover, 0) / inside.length);
}

// Verdict

/** The highest Kp expected while it is dark. */
export function kpDuring(entries: KpEntry[], w: Window, fallback?: number): number | undefined {
  const inside = entries.filter((e) => e.time + 3 * HOUR > w.start && e.time < w.end);
  if (!inside.length) return fallback;
  return Math.max(...inside.map((e) => e.kp));
}

export type Chance = "likely" | "possible" | "unlikely" | "bright";

export interface Verdict {
  chance: Chance;
  title: string;
  detail: string;
  color: Color;
}

export interface VerdictInput {
  magLat: number;
  kp: number;
  dark?: Window;
  now: number;
  ovation?: Ovation;
  clouds?: number;
}

export function verdict(v: VerdictInput): Verdict {
  const m = Math.abs(v.magLat);
  const side = v.magLat >= 0 ? "northern" : "southern";
  if (!v.dark) {
    return {
      chance: "bright",
      title: "Too bright for aurora",
      detail: "The sun doesn't go 12° below the horizon in the next 24 hours.",
      color: "gray",
    };
  }
  // The OVATION model only covers the next hour or so: trust it while it is dark now.
  const darkNow = v.dark.start <= v.now;
  const ov = darkNow ? v.ovation : undefined;
  let chance: Chance;
  let title: string;
  let detail: string;
  if (m >= overheadLatitude(v.kp) || (ov?.here ?? 0) >= 30) {
    chance = "likely";
    title = "Good chance of aurora tonight";
    detail = `Kp ${kpText(v.kp)} brings the aurora over your latitude.`;
  } else if (m >= horizonLatitude(v.kp) || (ov?.poleward ?? 0) >= 20) {
    chance = "possible";
    title = `Possible low on the ${side} horizon`;
    detail = `Look ${side === "northern" ? "north" : "south"}, away from city lights.`;
  } else {
    chance = "unlikely";
    title = "Unlikely tonight";
    const need = kpNeeded(v.magLat, true);
    detail = need === undefined
      ? "You are too far from the auroral oval, even in an extreme storm."
      : `It would take Kp ${kpText(need)}${gScale(need) ? ` (${gScale(need)} storm)` : ""} to see it on the horizon.`;
  }
  let color: Color = chance === "likely" ? "green" : chance === "possible" ? "yellow" : "gray";
  if (v.clouds !== undefined && chance !== "unlikely") {
    if (v.clouds >= 80) {
      title += ", but cloudy";
      color = "orange";
      detail += ` Clouds cover ${v.clouds}% of the sky.`;
    } else if (v.clouds >= 50) {
      detail += ` Partly cloudy (${v.clouds}%).`;
    }
  }
  return { chance, title, detail, color };
}

// Days

export interface Day {
  date: string;
  max: number;
  scale?: string;
  entries: KpEntry[];
}

/** "2026-11-01" for a time in a time zone. */
export function localDate(time: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .format(time);
}

/** Today and the next days, grouped in the place's time zone. */
export function days(entries: KpEntry[], now: number, timeZone?: string, count = 3): Day[] {
  const today = localDate(now, timeZone);
  const groups = new Map<string, KpEntry[]>();
  for (const e of entries) {
    const d = localDate(e.time, timeZone);
    if (d < today) continue;
    groups.set(d, [...groups.get(d) ?? [], e]);
  }
  return [...groups.entries()].slice(0, count).map(([date, list]) => {
    const max = Math.max(...list.map((e) => e.kp));
    return { date, max, scale: gScale(max), entries: list };
  });
}

export function dayName(date: string, now: number, timeZone?: string): string {
  const today = localDate(now, timeZone);
  const tomorrow = localDate(Date.parse(`${today}T12:00:00Z`) + 24 * HOUR, "UTC");
  if (date === today) return "Today";
  if (date === tomorrow) return "Tomorrow";
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
    .format(Date.parse(`${date}T12:00:00Z`));
}

export function clock(time: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: timeZone || "UTC" })
    .format(time);
}

/** "in 3 h", "12 min ago". */
export function relative(time: number, now: number): string {
  const min = Math.round((time - now) / 60_000);
  const abs = Math.abs(min);
  const text = abs < 60 ? `${abs} min` : `${Math.round(abs / 60)} h`;
  if (abs < 1) return "now";
  return min > 0 ? `in ${text}` : `${text} ago`;
}

export function formatLatitude(lat: number): string {
  return `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? "N" : "S"}`;
}

/** One line to paste in a chat. */
export function shareText(place: Place, v: Verdict, kpNow: number | undefined, kpTonight: number): string {
  return [
    `Aurora at ${place.name}: ${v.title}.`,
    v.detail,
    `Kp now ${kpNow === undefined ? "?" : kpText(kpNow)}, tonight up to ${kpText(kpTonight)} (NOAA SWPC).`,
  ].join(" ");
}
