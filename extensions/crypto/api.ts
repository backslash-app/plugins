// The CoinGecko public API (no key needed, ~10-30 calls a minute), with a
// cache so that typing and reopening don't burn the rate limit.

import { storage } from "@backslash/api";
import type { Holding, Market, SearchCoin } from "./lib.ts";

const API = "https://api.coingecko.com/api/v3";

type Json = Parameters<typeof storage.set>[1];

export class RateLimited extends Error {}

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

interface Cached<T> {
  at: number;
  data: T;
}

const memory = new Map<string, Cached<unknown>>();

/** Set when the last answer came from the cache because CoinGecko refused or was unreachable. */
export let stale: { at: number; reason: string } | undefined;

async function request<T>(path: string, apiKey: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      signal,
      headers: { Accept: "application/json", ...(apiKey ? { "x-cg-demo-api-key": apiKey } : {}) },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`CoinGecko is unreachable: ${(e as Error).message}`);
  }
  if (res.status === 429) {
    await res.body?.cancel();
    const wait = Number(res.headers.get("retry-after"));
    throw new RateLimited(
      `CoinGecko's rate limit is reached${wait ? `, try again in ${wait} s` : ", try again in a minute"}`,
    );
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new Error(apiKey ? "CoinGecko rejected the Demo API key" : `CoinGecko refused the request (${res.status})`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`CoinGecko answered ${res.status}`);
  }
  return await res.json() as T;
}

/**
 * A GET answer, fresh for `ttl` seconds. When CoinGecko refuses (rate limit) or
 * can't be reached, the last answer is used, however old, and `stale` says so.
 */
export async function cached<T>(path: string, ttl: number, apiKey: string, signal?: AbortSignal): Promise<T> {
  const key = `cache:${path}`;
  const hit = (memory.get(key) as Cached<T> | undefined) ?? await load<Cached<T>>(key);
  if (hit && Date.now() - hit.at < ttl * 1000) {
    memory.set(key, hit);
    return hit.data;
  }
  try {
    const data = await request<T>(path, apiKey, signal);
    const entry = { at: Date.now(), data };
    memory.set(key, entry);
    await save(key, entry);
    stale = undefined;
    return data;
  } catch (e) {
    if ((e as Error).name === "AbortError" || !hit) throw e;
    stale = { at: hit.at, reason: (e as Error).message };
    return hit.data;
  }
}

const marketsParams = (currency: string) =>
  `vs_currency=${currency}&sparkline=true&price_change_percentage=24h%2C7d&precision=full`;

/** The top coins by market cap. */
export function topMarkets(currency: string, apiKey: string, signal?: AbortSignal, count = 50): Promise<Market[]> {
  return cached<Market[]>(
    `/coins/markets?${marketsParams(currency)}&order=market_cap_desc&per_page=${count}&page=1`,
    90,
    apiKey,
    signal,
  );
}

/** Markets of the given coins, in the given order. */
export async function marketsOf(
  ids: string[],
  currency: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<Market[]> {
  if (!ids.length) return [];
  const sorted = [...new Set(ids)].sort();
  const found = await cached<Market[]>(
    `/coins/markets?${marketsParams(currency)}&ids=${encodeURIComponent(sorted.join(","))}&per_page=250`,
    60,
    apiKey,
    signal,
  );
  const byId = new Map(found.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter((m): m is Market => !!m);
}

export async function searchCoins(query: string, apiKey: string, signal?: AbortSignal): Promise<SearchCoin[]> {
  const res = await cached<{ coins?: SearchCoin[] }>(
    `/search?query=${encodeURIComponent(query.trim().toLowerCase())}`,
    3600,
    apiKey,
    signal,
  );
  return res.coins ?? [];
}

// ---------------------------------------------------------------------------
// Watchlist and portfolio

/** Changes to the watchlist or portfolio, so live lists reload. */
export const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

export const watchlist = async () => await load<string[]>("watchlist") ?? [];

export async function toggleWatch(id: string): Promise<boolean> {
  const list = await watchlist();
  const watched = !list.includes(id);
  await save("watchlist", watched ? [...list, id] : list.filter((x) => x !== id));
  changed();
  return watched;
}

export async function moveWatch(id: string, by: -1 | 1): Promise<void> {
  const list = await watchlist();
  const i = list.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await save("watchlist", list);
  changed();
}

export const holdings = async () => await load<Holding[]>("holdings") ?? [];

export async function setHoldings(list: Holding[]): Promise<void> {
  await save("holdings", list);
  changed();
}

/** Yields `load()` again each time the watchlist or portfolio changes, until `signal` aborts. */
export async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const done = () => {
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}
