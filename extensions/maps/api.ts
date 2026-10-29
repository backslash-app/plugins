// Nominatim, politely: no autocomplete (a request only when the user submits a
// search), one request per second at most, answers kept a week. Saved places and the home position live in storage.

import { storage } from "@backslash/api";
import {
  cacheKey,
  coordinatePlace,
  parseCoordinates,
  parseResults,
  type Place,
  searchable,
  searchUrl,
  USER_AGENT,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

const WEEK = 7 * 86_400_000;
const MAX_CACHED = 150;
/** Nominatim allows one request per second; a little margin. */
const GAP_MS = 1100;

let lastRequest = 0;

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      reject(signal.reason);
    }, { once: true });
  });

interface Cached {
  at: number;
  places: Place[];
}

async function cached(key: string): Promise<Place[] | undefined> {
  const all = (await storage.get("cache").catch(() => undefined) ?? {}) as unknown as Record<string, Cached>;
  const hit = all[key];
  return hit && Date.now() - hit.at < WEEK ? hit.places : undefined;
}

async function remember(key: string, places: Place[]) {
  const all = (await storage.get("cache").catch(() => undefined) ?? {}) as unknown as Record<string, Cached>;
  all[key] = { at: Date.now(), places };
  const kept = Object.entries(all).filter(([, v]) => Date.now() - v.at < WEEK).sort((a, b) => b[1].at - a[1].at)
    .slice(0, MAX_CACHED);
  await storage.set("cache", Object.fromEntries(kept) as unknown as Json).catch(() => {});
}

export interface SearchOptions {
  language: string;
  countries: string;
  limit?: number;
}

const keyOf = (query: string, o: SearchOptions) => `${cacheKey(query, o.language, o.countries)}|${o.limit ?? 10}`;

/** What can be shown without a request: typed coordinates, or an answer already cached. */
export async function instant(query: string, o: SearchOptions): Promise<Place[] | undefined> {
  const position = parseCoordinates(query);
  if (position) return [coordinatePlace(position.lat, position.lon)];
  if (!searchable(query)) return [];
  return await cached(keyOf(query, o));
}

/** Asks Nominatim; only call it on an explicit submit, never as the user types. */
export async function search(query: string, o: SearchOptions, signal?: AbortSignal): Promise<Place[]> {
  const known = await instant(query, o);
  if (known) return known;
  const key = keyOf(query, o);
  const gap = lastRequest + GAP_MS - Date.now();
  if (gap > 0) await sleep(gap, signal);
  lastRequest = Date.now();
  let res: Response;
  try {
    res = await fetch(searchUrl(query, o), {
      signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`OpenStreetMap's search is unreachable: ${(e as Error).message}`);
  }
  if (res.status === 429) {
    await res.body?.cancel();
    throw new Error("OpenStreetMap's search is busy: wait a few seconds and search again");
  }
  if (res.status === 403) {
    await res.body?.cancel();
    throw new Error("OpenStreetMap's search refused the request: try again later");
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`OpenStreetMap's search answered ${res.status}`);
  }
  const places = parseResults(await res.json());
  await remember(key, places);
  return places;
}

/** The home position: typed coordinates, or the address looked up once and remembered. */
export async function home(pref: string, o: SearchOptions, signal?: AbortSignal): Promise<Place | undefined> {
  const text = pref.trim();
  if (!text) return undefined;
  const position = parseCoordinates(text);
  if (position) return coordinatePlace(position.lat, position.lon, "Home");
  const saved = await storage.get("home").catch(() => undefined) as unknown as
    | { text: string; place: Place }
    | undefined;
  if (saved?.text === text) return saved.place;
  const place = (await search(text, { ...o, limit: 1 }, signal))[0];
  if (!place) throw new Error(`OpenStreetMap doesn't know the home address “${text}”: check it in the settings`);
  await storage.set("home", { text, place } as unknown as Json).catch(() => {});
  return place;
}

export const optionsOf = (prefs: Record<string, unknown>): SearchOptions => ({
  language: String(prefs.language ?? ""),
  countries: String(prefs.countries ?? ""),
});

// ---------------------------------------------------------------------------
// Saved places

export async function savedPlaces(): Promise<Place[]> {
  return (await storage.get("saved").catch(() => undefined) ?? []) as unknown as Place[];
}

export async function savePlace(p: Place): Promise<void> {
  await storage.set("saved", [...(await savedPlaces()).filter((s) => s.id !== p.id), p] as unknown as Json);
}

export async function removePlace(p: Place): Promise<void> {
  await storage.set("saved", (await savedPlaces()).filter((s) => s.id !== p.id) as unknown as Json);
}

export async function renamePlace(p: Place, name: string): Promise<void> {
  const all = await savedPlaces();
  await storage.set("saved", all.map((s) => s.id === p.id ? { ...s, name } : s) as unknown as Json);
}

export async function movePlace(p: Place, delta: number): Promise<void> {
  const all = await savedPlaces();
  const i = all.findIndex((s) => s.id === p.id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= all.length) return;
  [all[i], all[j]] = [all[j], all[i]];
  await storage.set("saved", all as unknown as Json);
}
