// Network and cache. NOAA updates the Kp forecast every few hours and the
// solar wind every minute; the OVATION file is close to 1 MB, so only the
// values around a place are kept.

import { storage } from "@backslash/api";
import {
  type Clouds,
  type CloudsResponse,
  cloudsUrl,
  geocodingUrl,
  KP_FORECAST_URL,
  type KpEntry,
  type KpForecastRow,
  MAG_URL,
  type Ovation,
  OVATION_URL,
  ovationAt,
  type OvationResponse,
  parseCoordinates,
  parseKp,
  parseSolarWind,
  type Place,
  rankPlaces,
  type SolarWind,
  SPEED_URL,
  splitQuery,
  toClouds,
} from "./lib.ts";

const MINUTE = 60_000;

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function getJson<T>(url: string, service: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`${service} is unreachable: ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => undefined) as { error?: boolean; reason?: string } | undefined;
  if (!res.ok || body === undefined || (body && !Array.isArray(body) && body.error)) {
    throw new Error(`${service}: ${body?.reason ?? `answered ${res.status}`}`);
  }
  return body as T;
}

/** A value kept for `ttl` ms; `fresh` skips the cache. */
async function cached<T>(key: string, ttl: number, fresh: boolean, get: () => Promise<T>): Promise<T> {
  const hit = fresh ? undefined : await load<{ at: number; data: T }>(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await get();
  await save(key, { at: Date.now(), data });
  return data;
}

const coords = (p: Place) => `${p.latitude.toFixed(1)},${p.longitude.toFixed(1)}`;

export async function kpForecast(signal?: AbortSignal, fresh = false): Promise<KpEntry[]> {
  return parseKp(
    await cached(
      "kp",
      15 * MINUTE,
      fresh,
      () => getJson<KpForecastRow[]>(KP_FORECAST_URL, "NOAA SWPC", signal),
    ),
  );
}

export async function solarWind(signal?: AbortSignal, fresh = false): Promise<SolarWind> {
  return await cached("wind", 5 * MINUTE, fresh, async () => {
    const [mag, speed] = await Promise.all([
      getJson<{ bt?: number; bz_gsm?: number; time_tag?: string }[]>(MAG_URL, "NOAA SWPC", signal),
      getJson<{ proton_speed?: number; time_tag?: string }[]>(SPEED_URL, "NOAA SWPC", signal),
    ]);
    return parseSolarWind(mag, speed);
  });
}

export async function ovation(place: Place, signal?: AbortSignal, fresh = false): Promise<Ovation> {
  return await cached(
    `ovation:${coords(place)}`,
    10 * MINUTE,
    fresh,
    async () =>
      ovationAt(await getJson<OvationResponse>(OVATION_URL, "NOAA SWPC", signal), place.latitude, place.longitude),
  );
}

export async function clouds(place: Place, signal?: AbortSignal, fresh = false): Promise<Clouds> {
  return toClouds(
    await cached(
      `clouds:${coords(place)}`,
      30 * MINUTE,
      fresh,
      () => getJson<CloudsResponse>(cloudsUrl(place.latitude, place.longitude), "Open-Meteo", signal),
    ),
  );
}

export async function findPlaces(query: string, signal?: AbortSignal, count = 8): Promise<Place[]> {
  const typed = parseCoordinates(query);
  if (typed) return [typed];
  const q = splitQuery(query);
  if (!q.name) return [];
  const res = await getJson<{ results?: Place[] }>(geocodingUrl(q.name, count), "Open-Meteo", signal);
  return rankPlaces(res.results ?? [], q.hint);
}

/** The place in the settings, remembered so it costs no request. */
export async function resolvePlace(name: string, signal?: AbortSignal): Promise<Place | undefined> {
  const typed = parseCoordinates(name);
  if (typed) return typed;
  const key = `place:${name.trim().toLowerCase()}`;
  const hit = await load<Place>(key);
  if (hit) return hit;
  const place = (await findPlaces(name, signal, 5))[0];
  if (place) await save(key, place);
  return place;
}
