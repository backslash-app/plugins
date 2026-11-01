// Network and cache: EONET answers are kept 15 minutes (its sources update a
// few times a day), your location forever.

import { storage } from "@backslash/api";
import {
  type EventQuery,
  type EventsResponse,
  eventsUrl,
  geocodingUrl,
  type GeoResult,
  parseCoordinates,
  pickPlace,
  type Place,
  splitCity,
} from "./lib.ts";

const TTL = 15 * 60_000;

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
    const text = (await res.text().catch(() => "")).trim().slice(0, 200);
    throw new Error(`${service} answered ${res.status}${text && !text.startsWith("<") ? `: ${text}` : ""}`);
  }
  return await res.json() as T;
}

/** Only what the extension reads is kept: polygons become their first ring, at most 64 points. */
function slim(data: EventsResponse): EventsResponse {
  return {
    events: (data.events ?? []).map((e) => ({
      id: e.id,
      title: e.title,
      description: e.description,
      closed: e.closed,
      categories: e.categories,
      sources: e.sources,
      geometry: e.geometry.map((g) => {
        if (g.type !== "Polygon" || !Array.isArray(g.coordinates)) return g;
        const ring = (g.coordinates as unknown[][])[0] ?? [];
        const step = Math.max(1, Math.ceil(ring.length / 64));
        return { ...g, coordinates: [ring.filter((_, i) => i % step === 0)] };
      }),
    })),
  };
}

export async function events(q: EventQuery, signal?: AbortSignal, fresh = false): Promise<EventsResponse> {
  const url = eventsUrl(q);
  const key = `events:${url}`;
  const hit = fresh ? undefined : await load<{ at: number; data: EventsResponse }>(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = slim(await getJson<EventsResponse>(url, "NASA EONET", signal));
  await save(key, { at: Date.now(), data });
  return data;
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
