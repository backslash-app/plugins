// The Finnhub REST API (free plan: 60 calls a minute, US quotes), with caches
// so that typing and reopening stay under the limit.

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  isoDay,
  type MarketStatus,
  type Metrics,
  type News,
  type Profile,
  type Quote,
  type SymbolMatch,
} from "./lib.ts";

const API = "https://finnhub.io/api/v1";
export const REGISTER_URL = "https://finnhub.io/register";
export const DASHBOARD_URL = "https://finnhub.io/dashboard";

type Json = Parameters<typeof storage.set>[1];

export class AuthError extends Error {}
export class RateLimited extends Error {}

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

export function apiKey(preferences: Record<string, unknown>): string {
  const key = String(preferences.apiKey ?? "").trim();
  if (!key) throw new AuthError("Add your free Finnhub API key");
  return key;
}

async function request<T>(key: string, path: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { signal, headers: { "X-Finnhub-Token": key, Accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Finnhub is unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (res.status === 401) throw new AuthError("Finnhub rejected the API key");
  if (res.status === 429) throw new RateLimited("Finnhub's limit of 60 calls a minute is reached, try again shortly");
  if (res.status === 403) {
    throw new Error("Finnhub's free plan doesn't include this (only US stocks have quotes on the free plan)");
  }
  if (!res.ok) throw new Error(`Finnhub answered ${res.status}${text ? `: ${text.slice(0, 120)}` : ""}`);
  return JSON.parse(text) as T;
}

interface Cached<T> {
  at: number;
  data: T;
}

const memory = new Map<string, Cached<unknown>>();

/** Set when the last answer came from the cache because Finnhub refused or was unreachable. */
export let stale = false;

/** Starts a new load: `stale` then says whether any of its answers was a saved one. */
export function newRound(): void {
  stale = false;
}

/** A GET answer, fresh for `ttl` seconds; the saved one when Finnhub refuses (rate limit) or is unreachable. */
async function cached<T>(
  key: string,
  path: string,
  ttl: number,
  signal?: AbortSignal,
  persist = true,
): Promise<T> {
  const id = `cache:${path}`;
  const hit = (memory.get(id) as Cached<T> | undefined) ?? (persist ? await load<Cached<T>>(id) : undefined);
  if (hit && Date.now() - hit.at < ttl * 1000) {
    memory.set(id, hit);
    return hit.data;
  }
  try {
    const data = await request<T>(key, path, signal);
    const entry = { at: Date.now(), data };
    memory.set(id, entry);
    if (persist) await save(id, entry);
    return data;
  } catch (e) {
    if ((e as Error).name === "AbortError" || e instanceof AuthError || !hit) throw e;
    stale = true;
    return hit.data;
  }
}

const q = (symbol: string) => encodeURIComponent(symbol);

export const quote = (key: string, symbol: string, signal?: AbortSignal) =>
  cached<Quote>(key, `/quote?symbol=${q(symbol)}`, 30, signal);

/** Company profiles hardly change: kept a week. Empty for funds and foreign listings. */
export const profile = (key: string, symbol: string, signal?: AbortSignal) =>
  cached<Profile>(key, `/stock/profile2?symbol=${q(symbol)}`, 7 * 86400, signal);

export const metrics = (key: string, symbol: string, signal?: AbortSignal) =>
  cached<Metrics>(key, `/stock/metric?symbol=${q(symbol)}&metric=all`, 86400, signal);

export const marketStatus = (key: string, signal?: AbortSignal) =>
  cached<MarketStatus>(key, `/stock/market-status?exchange=US`, 300, signal, false);

export async function search(key: string, query: string, signal?: AbortSignal): Promise<SymbolMatch[]> {
  const res = await cached<{ count: number; result: SymbolMatch[] }>(
    key,
    `/search?q=${encodeURIComponent(query.trim())}`,
    86400,
    signal,
    false,
  );
  return res.result ?? [];
}

/** The last two weeks of headlines, newest first. */
export async function news(key: string, symbol: string, signal?: AbortSignal): Promise<News[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 14 * 86400_000);
  const list = await cached<News[]>(
    key,
    `/company-news?symbol=${q(symbol)}&from=${isoDay(from)}&to=${isoDay(to)}`,
    1800,
    signal,
    false,
  );
  return [...(list ?? [])].sort((a, b) => b.datetime - a.datetime);
}

// ---------------------------------------------------------------------------
// Watchlist

/** Shown until the user changes the watchlist. */
export const DEFAULT_WATCHLIST = ["AAPL", "MSFT", "NVDA", "GOOGL", "AMZN"];

export const watchlist = async () => await load<string[]>("watchlist") ?? DEFAULT_WATCHLIST;
export const setWatchlist = (list: string[]) => save("watchlist", list);

// ---------------------------------------------------------------------------
// Setup

export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Free at finnhub.io: 60 calls a minute, US stocks",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Finnhub",
        "",
        "Quotes come from **Finnhub**, whose free plan needs an API key:",
        "",
        "1. Create a free account on **finnhub.io/register** (Enter opens it).",
        "2. Copy the **API key** shown on your Finnhub dashboard.",
        "3. Paste it in **Settings → Extensions → Stocks → Configure**.",
        "",
        "The free plan allows 60 calls a minute and has real-time quotes for US stocks.",
      ].join("\n"),
    },
    actions: [
      open(REGISTER_URL, "Create a Free Finnhub Account", { icon: Icons.key }),
      open(DASHBOARD_URL, "Open Finnhub Dashboard", { icon: Icons.external }),
    ],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e);
    if (e instanceof RateLimited) {
      return [{
        id: "rate-limit",
        title: e.message,
        icon: { source: Icons.hourglass, tint: "orange" },
        detail: { markdown: "Finnhub's free plan allows 60 calls a minute. Quotes are cached for 30 seconds." },
      }];
    }
    throw e;
  }
}
