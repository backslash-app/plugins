// The radio-browser.info API: a community directory with several mirrors.

import { storage } from "@backslash/api";
import type { Station } from "./lib.ts";

/** Mirrors in `[permissions] net`, tried in order; the one that answered is used first next time. */
export const MIRRORS = [
  "de1.api.radio-browser.info",
  "fi1.api.radio-browser.info",
  "de2.api.radio-browser.info",
  "all.api.radio-browser.info",
];
const HEADERS = {
  "User-Agent": "Backslash-Radio/1.0 (+https://github.com/backslash-app/plugins)",
  Accept: "application/json",
};

type Json = Parameters<typeof storage.set>[1];

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

let preferred: string | undefined;

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  preferred ??= await load<string>("mirror");
  const order = [...new Set([preferred, ...MIRRORS].filter((m): m is string => !!m && MIRRORS.includes(m)))];
  let last = "";
  for (const host of order) {
    const timeout = AbortSignal.timeout(8000);
    try {
      const res = await fetch(`https://${host}${path}`, {
        headers: HEADERS,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
      if (!res.ok) {
        await res.body?.cancel();
        last = `${host} answered ${res.status}`;
        if (res.status >= 500 || res.status === 429) continue;
        throw new Error(`radio-browser.info answered ${res.status}`);
      }
      const data = await res.json() as T;
      if (host !== preferred) {
        preferred = host;
        await save("mirror", host);
      }
      return data;
    } catch (e) {
      if (signal?.aborted) throw e;
      if ((e as Error).message.startsWith("radio-browser.info answered")) throw e;
      last = timeout.aborted ? `${host} timed out` : `${host}: ${(e as Error).message}`;
    }
  }
  throw new Error(`radio-browser.info is unreachable (${last})`);
}

const base = { hidebroken: "true", order: "votes", reverse: "true" };

export function searchStations(params: Record<string, string>, signal?: AbortSignal, limit = 40): Promise<Station[]> {
  const q = new URLSearchParams({ ...base, limit: String(limit), ...params });
  return get<Station[]>(`/json/stations/search?${q}`, signal);
}

export function topStations(signal?: AbortSignal, limit = 50): Promise<Station[]> {
  return get<Station[]>(`/json/stations/topvote/${limit}?hidebroken=true`, signal);
}

/** Counts a play, as radio-browser asks clients to, and returns the stream URL it resolved. */
export async function click(s: Station): Promise<string> {
  try {
    const r = await get<{ ok?: boolean; url?: string }>(`/json/url/${encodeURIComponent(s.stationuuid)}`);
    return r.ok && r.url ? r.url : s.url_resolved || s.url;
  } catch {
    return s.url_resolved || s.url;
  }
}

// ---------------------------------------------------------------------------
// Favorites

export const favorites = async () => await load<Station[]>("favorites") ?? [];

export async function toggleFavorite(s: Station): Promise<boolean> {
  const list = await favorites();
  const there = list.some((f) => f.stationuuid === s.stationuuid);
  await save("favorites", there ? list.filter((f) => f.stationuuid !== s.stationuuid) : [...list, s]);
  return !there;
}
