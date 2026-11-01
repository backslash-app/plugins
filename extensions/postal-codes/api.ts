// Network and cache: postal codes rarely change, so answers are kept 30 days.

import { storage } from "@backslash/api";
import {
  areaCode,
  fromGeocoding,
  fromZippoCode,
  geocodingUrl,
  type GeoResult,
  type Place,
  sortCodes,
  withCode,
  zippoCodesFor,
  zippoPlaceUrl,
  ZIPPOPOTAM,
  type ZippoResponse,
  zippoUrl,
} from "./lib.ts";

const TTL = 30 * 86_400_000;

type Json = Parameters<typeof storage.set>[1];

/** `fetch`, replaceable in tests. */
export const http = { fetch: (url: string, init?: RequestInit) => fetch(url, init) };

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = await storage.get(key).catch(() => undefined) as { at: number; data: T } | undefined;
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await load();
  await storage.set(key, { at: Date.now(), data } as unknown as Json).catch(() => {});
  return data;
}

/** The JSON at `url`, or undefined on a 404 (an unknown code or place). */
async function getJson<T>(url: string, service: string, signal?: AbortSignal): Promise<T | undefined> {
  let res: Response;
  try {
    res = await http.fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`${service} is unreachable: ${(e as Error).message}`);
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return undefined;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${service} answered ${res.status}`);
  }
  return await res.json() as T;
}

async function geocode(name: string, country: string | undefined, signal?: AbortSignal): Promise<GeoResult[]> {
  const body = await getJson<{ results?: GeoResult[]; error?: boolean; reason?: string }>(
    geocodingUrl(name, country),
    "Open-Meteo",
    signal,
  );
  if (body?.error) throw new Error(`Open-Meteo: ${body.reason ?? "error"}`);
  return body?.results ?? [];
}

/** The places of a postal code: Zippopotam, or Open-Meteo for the countries it doesn't cover. */
export function lookupCode(country: string, code: string, signal?: AbortSignal): Promise<Place[]> {
  return cached(`code:${country}:${code.toUpperCase()}`, async () => {
    if (ZIPPOPOTAM.has(country)) {
      const res = await getJson<ZippoResponse>(zippoUrl(country, code), "Zippopotam.us", signal);
      const places = res ? fromZippoCode(res) : [];
      if (places.length) return places;
      const area = areaCode(country, code);
      const coarse = area ? await getJson<ZippoResponse>(zippoUrl(country, area), "Zippopotam.us", signal) : undefined;
      // The place of the area, under the code typed.
      if (coarse) return fromZippoCode(coarse).map((p) => ({ ...p, codes: [code.toUpperCase()] }));
    }
    return withCode(fromGeocoding(await geocode(code, country, signal)), code, country);
  });
}

/**
 * Places named `name` with their codes. Open-Meteo knows a few codes per place; for the first
 * place, in a country Zippopotam covers, the full list comes from Zippopotam (the state code it
 * needs is read from one of those codes).
 */
export function findPlaces(name: string, country: string | undefined, signal?: AbortSignal): Promise<Place[]> {
  return cached(`place:${country ?? "*"}:${name.toLowerCase()}`, async () => {
    const places = fromGeocoding(await geocode(name, country, signal));
    const first = places[0];
    if (first?.codes.length && ZIPPOPOTAM.has(first.country)) {
      try {
        places[0] = await complete(first, signal);
      } catch (e) {
        if ((e as Error).name === "AbortError") throw e;
        // Keep Open-Meteo's codes.
      }
    }
    return places;
  });
}

async function complete(place: Place, signal?: AbortSignal): Promise<Place> {
  // A city's first code may be one Zippopotam lacks ("69000"): try a few.
  let state: string | undefined;
  for (const code of place.codes.slice(0, 3)) {
    const sample = await getJson<ZippoResponse>(zippoUrl(place.country, code), "Zippopotam.us", signal);
    state = sample?.places?.[0]?.["state abbreviation"];
    if (state) break;
  }
  if (!state) return place;
  const all = await getJson<ZippoResponse>(zippoPlaceUrl(place.country, state, place.name), "Zippopotam.us", signal);
  const found = all ? zippoCodesFor(all, place.name) : { codes: [], cedex: [] };
  if (!found.codes.length) return place;
  return {
    ...place,
    stateCode: state,
    codes: sortCodes([...place.codes, ...found.codes]),
    cedex: sortCodes([...place.cedex, ...found.cedex]),
  };
}
