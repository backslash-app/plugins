// Network and cache: places are remembered forever, station prices for five minutes.

import { storage } from "@backslash/api";
import {
  addressSearchUrl,
  apiError,
  type Commune,
  communesByPostcodeUrl,
  type FuelId,
  type FuelRecord,
  isPostcode,
  parseCoordinates,
  type Place,
  placesFromAddresses,
  placesFromCommunes,
  type Station,
  stationsByIdUrl,
  stationsUrl,
  toStation,
} from "./lib.ts";

const PRICES_TTL = 5 * 60_000;

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function getJson<T>(url: string, service: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`${service} is unreachable: ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    throw new Error(service === "Fuel prices" ? apiError(res.status, body) : `${service} answered ${res.status}`);
  }
  return body as T;
}

/** A town, a postcode, an address or coordinates → places, best first. */
export async function findPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim();
  if (!q) return [];
  const coords = parseCoordinates(q);
  if (coords) return [coords];
  const key = `places:${q.toLowerCase()}`;
  const cached = await load<Place[]>(key);
  if (cached) return cached;
  let places: Place[];
  if (isPostcode(q)) {
    const communes = await getJson<Commune[]>(communesByPostcodeUrl(q), "geo.api.gouv.fr", signal);
    places = placesFromCommunes(communes, q);
  } else {
    places = placesFromAddresses(await getJson(addressSearchUrl(q), "The address search", signal));
  }
  if (places.length) await save(key, places);
  return places;
}

interface Records {
  total_count?: number;
  results?: FuelRecord[];
}

/** Stations within `radius` km selling `fuel`, cheapest first, cached a few minutes. */
export async function stationsAround(
  place: Place,
  fuel: FuelId,
  radius: number,
  o: { signal?: AbortSignal; fresh?: boolean } = {},
): Promise<{ stations: Station[]; total: number; at: number }> {
  const url = stationsUrl(place, fuel, radius);
  const key = `stations:${url}`;
  const cached = o.fresh ? undefined : await load<{ at: number; stations: Station[]; total: number }>(key);
  if (cached && Date.now() - cached.at < PRICES_TTL) return cached;
  const body = await getJson<Records>(url, "Fuel prices", o.signal);
  const stations = (body.results ?? []).flatMap((r) => toStation(r) ?? []);
  const out = { at: Date.now(), stations, total: body.total_count ?? stations.length };
  await save(key, out);
  return out;
}

export async function stationsById(ids: string[], signal?: AbortSignal): Promise<Station[]> {
  if (!ids.length) return [];
  const body = await getJson<Records>(stationsByIdUrl(ids), "Fuel prices", signal);
  return (body.results ?? []).flatMap((r) => toStation(r) ?? []);
}

// Favourite stations: just their ids, prices are always fetched.

export async function favourites(): Promise<string[]> {
  return await load<string[]>("favourites") ?? [];
}

export async function toggleFavourite(id: string): Promise<boolean> {
  const list = await favourites();
  const has = list.includes(id);
  await save("favourites", has ? list.filter((x) => x !== id) : [...list, id]);
  return !has;
}

/** The home location of the preferences, geocoded once. */
export async function homePlace(location: unknown, signal?: AbortSignal): Promise<Place | undefined> {
  const q = String(location ?? "").trim();
  if (!q) return undefined;
  return (await findPlaces(q, signal))[0];
}
