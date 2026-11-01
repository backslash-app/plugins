// The Aviation Weather Center's Data API, with a short cache: METARs come
// every 30 to 60 minutes, TAFs every 6 hours.

import { storage } from "@backslash/api";
import { type MetarRecord, metarUrl, type TafRecord, tafUrl } from "./lib.ts";

const TTL = 5 * 60_000;

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T[]> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`aviationweather.gov is unreachable: ${(e as Error).message}`);
  }
  // 204: none of these stations has a report.
  if (res.status === 204) return [];
  if (res.status === 429) throw new Error("aviationweather.gov asks to slow down: try again in a minute");
  if (res.status >= 500) throw new Error(`aviationweather.gov is not answering right now (${res.status}): try again`);
  if (!res.ok) throw new Error(`aviationweather.gov answered ${res.status}`);
  const body = await res.json().catch(() => undefined);
  if (!Array.isArray(body)) throw new Error("aviationweather.gov sent something unexpected");
  return body as T[];
}

async function cached<T>(kind: string, ids: string[], url: string, signal?: AbortSignal, fresh = false) {
  const key = `${kind}:${[...ids].sort().join(",")}`;
  const hit = fresh ? undefined : await load<{ at: number; data: T[] }>(key);
  if (hit && Date.now() - hit.at < TTL) return hit.data;
  const data = await getJson<T>(url, signal);
  await save(key, { at: Date.now(), data });
  return data;
}

export function metars(ids: string[], signal?: AbortSignal, fresh = false): Promise<MetarRecord[]> {
  return ids.length ? cached<MetarRecord>("metar", ids, metarUrl(ids), signal, fresh) : Promise.resolve([]);
}

export function tafs(ids: string[], signal?: AbortSignal, fresh = false): Promise<TafRecord[]> {
  return ids.length ? cached<TafRecord>("taf", ids, tafUrl(ids), signal, fresh) : Promise.resolve([]);
}

// Airports saved from the list, on top of the ones in the preferences.

export async function savedAirports(): Promise<string[]> {
  return await load<string[]>("airports") ?? [];
}

export async function saveAirport(icao: string): Promise<void> {
  await save("airports", [...(await savedAirports()).filter((a) => a !== icao), icao]);
}

export async function removeAirport(icao: string): Promise<void> {
  await save("airports", (await savedAirports()).filter((a) => a !== icao));
}
