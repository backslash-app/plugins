// Network and cache: air quality is kept 30 minutes (Open-Meteo updates it
// hourly), cities forever.

import { storage } from "@backslash/api";
import {
  type AirQuality,
  type AirQualityResponse,
  airQualityUrl,
  geocodingUrl,
  type Place,
  rankPlaces,
  type Scale,
  splitQuery,
  toAirQuality,
} from "./lib.ts";

const TTL = 30 * 60_000;

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Open-Meteo is unreachable: ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => ({})) as { error?: boolean; reason?: string };
  if (!res.ok || body.error) throw new Error(`Open-Meteo: ${body.reason ?? `answered ${res.status}`}`);
  return body as T;
}

export async function findPlaces(query: string, signal?: AbortSignal, count = 8): Promise<Place[]> {
  const q = splitQuery(query);
  if (!q.name) return [];
  const res = await getJson<{ results?: Place[] }>(geocodingUrl(q.name, count), signal);
  return rankPlaces(res.results ?? [], q.hint);
}

/** The first city matching `name`, remembered so the default city costs no request. */
export async function resolvePlace(name: string, signal?: AbortSignal): Promise<Place | undefined> {
  const key = `place:${name.trim().toLowerCase()}`;
  const cached = await load<Place>(key);
  if (cached) return cached;
  const place = (await findPlaces(name, signal, 5))[0];
  if (place) await save(key, place);
  return place;
}

export async function airQuality(place: Place, scale: Scale, signal?: AbortSignal, fresh = false): Promise<AirQuality> {
  const key = `air:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
  const cached = fresh ? undefined : await load<{ at: number; data: AirQualityResponse }>(key);
  if (cached && Date.now() - cached.at < TTL) return toAirQuality(cached.data, scale);
  const data = await getJson<AirQualityResponse>(airQualityUrl(place.latitude, place.longitude), signal);
  await save(key, { at: Date.now(), data });
  return toAirQuality(data, scale);
}

// Saved cities

export async function savedCities(): Promise<Place[]> {
  return await load<Place[]>("cities") ?? [];
}

export async function saveCity(place: Place): Promise<void> {
  await save("cities", [...(await savedCities()).filter((c) => c.id !== place.id), place]);
}

export async function removeCity(place: Place): Promise<void> {
  await save("cities", (await savedCities()).filter((c) => c.id !== place.id));
}

export async function moveCity(place: Place, delta: number): Promise<void> {
  const cities = await savedCities();
  const i = cities.findIndex((c) => c.id === place.id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= cities.length) return;
  [cities[i], cities[j]] = [cities[j], cities[i]];
  await save("cities", cities);
}
