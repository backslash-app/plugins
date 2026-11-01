// Network and cache: Open-Meteo's geocoding finds cities (with their time
// zone); a city found once is remembered, so the default place costs no
// request after the first time. Everything else is computed locally.

import { storage } from "@backslash/api";
import { coordinatesPlace, geocodingUrl, parseCoordinates, type Place, rankPlaces, splitPlace } from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

export async function findPlaces(text: string, signal?: AbortSignal, count = 6): Promise<Place[]> {
  const q = splitPlace(text);
  if (!q.name) return [];
  let res: Response;
  try {
    res = await fetch(geocodingUrl(q.name, count), { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Open-Meteo is unreachable: ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => ({})) as { results?: Place[]; error?: boolean; reason?: string };
  if (!res.ok || body.error) throw new Error(`Open-Meteo: ${body.reason ?? `answered ${res.status}`}`);
  return rankPlaces(body.results ?? [], q.hint);
}

/** The place set in the preferences: coordinates as they are, a city name looked up once. */
export async function resolvePlace(text: string, signal?: AbortSignal): Promise<Place | undefined> {
  const coords = parseCoordinates(text);
  if (coords) return coordinatesPlace(coords.latitude, coords.longitude);
  const key = `place:${text.trim().toLowerCase()}`;
  const cached = await load<Place>(key);
  if (cached) return cached;
  const place = (await findPlaces(text, signal, 5))[0];
  if (place) await save(key, place);
  return place;
}
