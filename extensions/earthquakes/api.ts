// Network and cache: feeds are kept 5 minutes (the USGS updates them every
// minute), your location forever.

import { storage } from "@backslash/api";
import {
  type FeatureCollection,
  type Feed,
  feedUrl,
  geocodingUrl,
  type GeoResult,
  nearbyUrl,
  parseCoordinates,
  pickPlace,
  type Place,
  splitCity,
} from "./lib.ts";

const FEED_TTL = 5 * 60_000;

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
    res = await fetch(url, { signal, headers: { accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`${service} is unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim().split("\n").find((l) => l.trim()) ?? "";
    throw new Error(`${service} answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return await res.json() as T;
}

async function cached(key: string, url: string, signal?: AbortSignal, fresh = false): Promise<FeatureCollection> {
  const hit = fresh ? undefined : await load<{ at: number; data: FeatureCollection }>(key);
  if (hit && Date.now() - hit.at < FEED_TTL) return hit.data;
  const data = await getJson<FeatureCollection>(url, "The USGS", signal);
  await save(key, { at: Date.now(), data });
  return data;
}

export function feed(name: Feed, signal?: AbortSignal, fresh = false): Promise<FeatureCollection> {
  return cached(`feed:${name}`, feedUrl(name), signal, fresh);
}

export function nearby(
  place: Place,
  o: { radiusKm: number; minMagnitude: number; days: number },
  signal?: AbortSignal,
  fresh = false,
): Promise<FeatureCollection> {
  const at = `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
  const key = `near:${at}:${o.radiusKm}:${o.minMagnitude}:${o.days}`;
  return cached(key, nearbyUrl(place, o), signal, fresh);
}

/** The location preference as a point: typed coordinates, or a city looked up once and remembered. */
export async function resolveLocation(text: string, signal?: AbortSignal): Promise<Place | undefined> {
  const value = text.trim();
  if (!value) return undefined;
  const point = parseCoordinates(value);
  if (point) return { ...point, name: `${point.latitude}, ${point.longitude}` };
  const key = `place:${value.toLowerCase()}`;
  const known = await load<Place>(key);
  if (known) return known;
  const { name, hint } = splitCity(value);
  const res = await getJson<{ results?: GeoResult[] }>(geocodingUrl(name), "Open-Meteo", signal);
  const place = pickPlace(res.results ?? [], hint);
  if (!place) throw new Error(`No city named “${value}”: check the location in the extension settings`);
  await save(key, place);
  return place;
}
