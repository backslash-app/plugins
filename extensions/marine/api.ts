// Network and cache: the sea is kept 30 minutes (the models update hourly),
// places forever.

import { storage } from "@backslash/api";
import {
  geocodingUrl,
  type MarineResponse,
  marineUrl,
  parseCoordinates,
  type Place,
  placeKey,
  rankPlaces,
  type Sea,
  splitQuery,
  toSea,
  type WindResponse,
  windUrl,
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
  const typed = parseCoordinates(query);
  if (typed) return [typed];
  const q = splitQuery(query);
  if (!q.name) return [];
  const res = await getJson<{ results?: Place[] }>(geocodingUrl(q.name, count), signal);
  return rankPlaces(res.results ?? [], q.hint);
}

/** The spot in the settings, remembered so it costs no request. */
export async function resolvePlace(name: string, signal?: AbortSignal): Promise<Place | undefined> {
  const typed = parseCoordinates(name);
  if (typed) return typed;
  const key = `place:${name.trim().toLowerCase()}`;
  const cached = await load<Place>(key);
  if (cached) return cached;
  const place = (await findPlaces(name, signal, 5))[0];
  if (place) await save(key, place);
  return place;
}

/** Waves from the marine API and wind from the forecast API, together. */
export async function sea(place: Place, signal?: AbortSignal, fresh = false): Promise<Sea> {
  const key = `sea:${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
  const cached = fresh ? undefined : await load<{ at: number; marine: MarineResponse; wind?: WindResponse }>(key);
  if (cached && Date.now() - cached.at < TTL) return toSea(cached.marine, cached.wind);
  const [marine, wind] = await Promise.all([
    getJson<MarineResponse>(marineUrl(place.latitude, place.longitude), signal),
    // Waves without wind are still worth showing.
    getJson<WindResponse>(windUrl(place.latitude, place.longitude), signal).catch((e) => {
      if ((e as Error).name === "AbortError") throw e;
      return undefined;
    }),
  ]);
  await save(key, { at: Date.now(), marine, wind });
  return toSea(marine, wind);
}

// Saved spots

export async function savedSpots(): Promise<Place[]> {
  return await load<Place[]>("spots") ?? [];
}

export async function saveSpot(place: Place): Promise<void> {
  await save("spots", [...(await savedSpots()).filter((s) => placeKey(s) !== placeKey(place)), place]);
}

export async function removeSpot(place: Place): Promise<void> {
  await save("spots", (await savedSpots()).filter((s) => placeKey(s) !== placeKey(place)));
}
