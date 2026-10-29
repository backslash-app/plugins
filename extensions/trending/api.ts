// Fetching github.com/trending, lobste.rs and dev.to, with a small cache for a fast first paint.

import { storage } from "@backslash/api";
import {
  type DevArticle,
  type DevPeriod,
  devUrl,
  type LobstersFeed,
  type LobstersStory,
  parseTrending,
  type Since,
  type TrendingRepo,
  trendingUrl,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

async function get(url: string, signal: AbortSignal, accept: string): Promise<Response> {
  const name = new URL(url).hostname;
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: accept } });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error(`Can't reach ${name}: check your connection`);
  }
  if (res.status === 429) throw new Error(`${name} is rate limiting: try again in a minute`);
  if (res.status === 404) throw new Error(`${name} has no such page (a language or tag that doesn't exist?)`);
  if (!res.ok) throw new Error(`${name} answered ${res.status}`);
  return res;
}

export async function githubTrending(since: Since, language: string, signal: AbortSignal): Promise<TrendingRepo[]> {
  const res = await get(trendingUrl(since, language), signal, "text/html");
  const html = await res.text();
  const repos = parseTrending(html);
  if (!repos.length && !/Box-row/.test(html) && !/It looks like we don.t have any trending/i.test(html)) {
    throw new Error("GitHub's trending page changed and couldn't be read: update the extension");
  }
  return repos;
}

export async function lobsters(feed: LobstersFeed, signal: AbortSignal): Promise<LobstersStory[]> {
  const res = await get(`https://lobste.rs/${feed}.json`, signal, "application/json");
  return await res.json() as LobstersStory[];
}

export async function devArticles(period: DevPeriod, tag: string, signal: AbortSignal): Promise<DevArticle[]> {
  const res = await get(devUrl(period, tag), signal, "application/vnd.forem.api-v1+json");
  return await res.json() as DevArticle[];
}

/**
 * Yields the cached copy first (when there is one), then the fresh one, saved for next
 * time. A failing refresh keeps the cached copy on screen and only throws without one.
 */
export async function* cached<T>(key: string, load: () => Promise<T>): AsyncGenerator<{ value: T; fresh: boolean }> {
  const old = await storage.get(key).catch(() => undefined) as { at: number; value: T } | undefined;
  if (old) yield { value: old.value, fresh: false };
  try {
    const value = await load();
    await storage.set(key, { at: Date.now(), value } as unknown as Json).catch(() => {});
    yield { value, fresh: true };
  } catch (e) {
    if (!old) throw e;
    console.error(`Refreshing ${key} failed:`, e);
  }
}
