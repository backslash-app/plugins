// Network and cache: forecasts are kept 15 minutes, cities forever.

import { storage } from "@backslash/api";
import {
  type Forecast,
  type ForecastResponse,
  forecastUrl,
  geocodingUrl,
  type Place,
  rankPlaces,
  splitQuery,
  toForecast,
  type Units,
} from "./lib.ts";

const FORECAST_TTL = 15 * 60_000;

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

export async function forecast(place: Place, units: Units, signal?: AbortSignal, fresh = false): Promise<Forecast> {
  const key = `forecast:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}:${units}`;
  const cached = fresh ? undefined : await load<{ at: number; data: ForecastResponse }>(key);
  if (cached && Date.now() - cached.at < FORECAST_TTL) return toForecast(cached.data, units);
  const data = await getJson<ForecastResponse>(forecastUrl(place.latitude, place.longitude, units), signal);
  await save(key, { at: Date.now(), data });
  return toForecast(data, units);
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
