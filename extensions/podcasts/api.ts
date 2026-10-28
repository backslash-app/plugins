// Subscriptions, progress and feed cache in the extension's storage; feeds and
// Apple Podcasts search over the network.

import { storage } from "@backslash/api";
import {
  type Episode,
  episodeKey,
  itunesShows,
  parsePodcast,
  type Progress,
  pruneProgress,
  searchUrl,
  type Show,
} from "./lib.ts";

// ---------------------------------------------------------------------------
// Changes: views of this extension run in one process, so a change made in a
// pushed view (mark played, unsubscribe) reloads the lists below it.

const changes = new EventTarget();
export const notifyChanged = () => changes.dispatchEvent(new Event("change"));

/** Yields `load()`, then again after each change, until `signal` aborts. */
export async function* live<T>(load: () => Promise<T> | AsyncIterable<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    const value = load();
    if (Symbol.asyncIterator in (value as object)) {
      for await (const v of value as AsyncIterable<T>) yield v;
    } else yield await value as T;
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

// ---------------------------------------------------------------------------
// Subscriptions

export async function subscriptions(): Promise<Show[]> {
  return (await storage.get<never>("subscriptions") as Show[] | undefined) ?? [];
}

export async function subscribe(show: Show): Promise<boolean> {
  const all = await subscriptions();
  if (all.some((s) => s.feedUrl === show.feedUrl)) return false;
  await storage.set("subscriptions", [...all, show] as never);
  notifyChanged();
  return true;
}

export async function unsubscribe(feedUrl: string): Promise<void> {
  await storage.set("subscriptions", (await subscriptions()).filter((s) => s.feedUrl !== feedUrl) as never);
  await storage.delete(`feed:${feedUrl}`);
  notifyChanged();
}

// ---------------------------------------------------------------------------
// Progress

export async function allProgress(): Promise<Record<string, Progress>> {
  return (await storage.get<never>("progress") as Record<string, Progress> | undefined) ?? {};
}

export async function setProgress(e: Pick<Episode, "feedUrl" | "id">, p: Omit<Progress, "updated"> | null) {
  const all = await allProgress();
  if (p) all[episodeKey(e)] = { ...p, updated: Date.now() };
  else delete all[episodeKey(e)];
  await storage.set("progress", pruneProgress(all) as never);
  notifyChanged();
}

// ---------------------------------------------------------------------------
// Feeds

const UA = { "User-Agent": "Backslash-Podcasts/1.0 (+https://github.com/backslash-app)" };

/** How long a fetched feed is used before fetching it again. */
const FRESH_MS = 30 * 60_000;
/** Episodes kept per cached feed, and notes length: storage stays small. */
const KEEP = 30;
const NOTES = 3_000;

interface Cached {
  fetched: number;
  show: Show;
  episodes: Episode[];
}

export async function fetchFeed(url: string, signal?: AbortSignal): Promise<{ show: Show; episodes: Episode[] }> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal,
      headers: { ...UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Can't reach ${new URL(url).hostname}: ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return parsePodcast(await res.text(), res.url || url);
}

/** A subscription's feed: from the cache while fresh, fetched otherwise (the cache when it fails). */
export async function feed(
  url: string,
  o: { signal?: AbortSignal; force?: boolean } = {},
): Promise<{ show: Show; episodes: Episode[]; error?: string }> {
  const key = `feed:${url}`;
  const cached = await storage.get<never>(key) as Cached | undefined;
  if (cached && !o.force && Date.now() - cached.fetched < FRESH_MS) return cached;
  try {
    const signal = o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000);
    const fresh = await fetchFeed(url, signal);
    const episodes = fresh.episodes.map((e) => ({ ...e, feedUrl: url }));
    const kept = episodes.slice(0, KEEP).map((e) => ({ ...e, notes: e.notes.slice(0, NOTES) }));
    // The cache is a convenience: a full storage only makes the next load slower.
    await storage.set(key, { fetched: Date.now(), show: { ...fresh.show, feedUrl: url }, episodes: kept } as never)
      .catch(() => {});
    return { show: { ...fresh.show, feedUrl: url }, episodes };
  } catch (e) {
    if (o.signal?.aborted) throw e;
    const error = e instanceof Error ? e.message : String(e);
    if (cached) return { ...cached, error };
    throw e;
  }
}

/** Episodes of all subscriptions, and which feeds failed. */
export async function allEpisodes(
  shows: Show[],
  o: { signal?: AbortSignal; force?: boolean } = {},
): Promise<{ episodes: Episode[]; failed: { show: Show; error: string }[] }> {
  const results = await Promise.all(shows.map(async (s) => {
    try {
      const f = await feed(s.feedUrl, o);
      return { show: s, episodes: f.episodes, error: f.error };
    } catch (e) {
      if (o.signal?.aborted) throw e;
      return { show: s, episodes: [] as Episode[], error: e instanceof Error ? e.message : String(e) };
    }
  }));
  return {
    // The subscription's own title and artwork (from Apple) win over the feed's.
    episodes: results.flatMap((r) =>
      r.episodes.map((e) => ({ ...e, show: r.show.title || e.show, image: e.image ?? r.show.artwork }))
    ),
    failed: results.filter((r) => r.error).map((r) => ({ show: r.show, error: r.error! })),
  };
}

export async function searchShows(term: string, country: string, signal: AbortSignal): Promise<Show[]> {
  let res: Response;
  try {
    res = await fetch(searchUrl(term, country), { signal, headers: UA });
  } catch (e) {
    if (signal.aborted) throw e;
    throw new Error(`Can't reach Apple Podcasts (itunes.apple.com): ${e instanceof Error ? e.message : e}`);
  }
  if (!res.ok) throw new Error(`Apple Podcasts search answered ${res.status}`);
  return itunesShows(await res.json());
}
