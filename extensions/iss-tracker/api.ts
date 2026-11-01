// Network and cache: the station's orbital elements (TLE) from CelesTrak,
// kept 6 hours, and cities from Open-Meteo's geocoding, kept forever.
// Positions and passes are then computed locally.

import { storage } from "@backslash/api";
import { coordinatesPlace, geocodingUrl, parseCoordinates, type Place, rankPlaces, splitPlace } from "./places.ts";
import { parseTle, type Tle } from "./sgp4.ts";

type Json = Parameters<typeof storage.set>[1];

const TLE_TTL = 6 * 3600_000;
export const ISS = 25544;
export const tleUrl = (id = ISS) => `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`;

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

export interface Elements {
  tle: Tle;
  /** When it was fetched, and whether this is an old copy because CelesTrak couldn't be reached. */
  fetchedAt: number;
  stale?: string;
}

/** The ISS's latest elements: from the cache when fresh, else CelesTrak, else the last copy we have. */
export async function issElements(signal?: AbortSignal, fresh = false): Promise<Elements> {
  const cached = await load<{ at: number; text: string }>("tle");
  if (cached && !fresh && Date.now() - cached.at < TLE_TTL) return { tle: parseTle(cached.text), fetchedAt: cached.at };
  try {
    const res = await fetch(tleUrl(), { signal });
    const text = await res.text();
    if (!res.ok) throw new Error(`CelesTrak answered ${res.status}`);
    const tle = parseTle(text);
    await save("tle", { at: Date.now(), text });
    return { tle, fetchedAt: Date.now() };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (cached) return { tle: parseTle(cached.text), fetchedAt: cached.at, stale: (e as Error).message };
    throw new Error(`CelesTrak is unreachable: ${(e as Error).message}`);
  }
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
