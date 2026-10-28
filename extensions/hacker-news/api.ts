// Hacker News (Firebase and Algolia APIs) and feed storage.

import { storage } from "@backslash/api";
import {
  type AlgoliaItem,
  type Comment,
  discoverFeeds,
  type Feed,
  type FeedName,
  FEEDS,
  type HnItem,
  parseFeed,
  type Story,
  topComments,
  toStory,
} from "./lib.ts";

const FIREBASE = "https://hacker-news.firebaseio.com/v0";
const ALGOLIA = "https://hn.algolia.com/api/v1";

type Json = Parameters<typeof storage.set>[1];

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`${new URL(url).host} is unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${new URL(url).host} answered ${res.status}`);
  }
  return await res.json() as T;
}

/** The first `count` stories of a list, in HN's order. */
export async function stories(feed: FeedName, count: number, signal?: AbortSignal): Promise<Story[]> {
  const ids = await getJson<number[]>(`${FIREBASE}/${FEEDS[feed].path}.json`, signal);
  const items = await Promise.all(
    ids.slice(0, count).map((id) => getJson<HnItem | null>(`${FIREBASE}/item/${id}.json`, signal).catch(() => null)),
  );
  return items.map((item, i) => item && toStory(item, i + 1)).filter((s): s is Story => !!s);
}

/** Top comments, with the whole tree from Algolia in one request; Firebase if Algolia fails. */
export async function comments(story: Story, signal?: AbortSignal, limit = 8): Promise<Comment[]> {
  try {
    const tree = await getJson<AlgoliaItem>(`${ALGOLIA}/items/${story.id}`, signal);
    return topComments(tree, story.kids, limit);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    const kids = await Promise.all(
      story.kids.slice(0, limit).map((id) => getJson<HnItem | null>(`${FIREBASE}/item/${id}.json`, signal)),
    );
    const tree: AlgoliaItem = {
      id: story.id,
      children: kids.filter((k): k is HnItem => !!k && !k.dead && !k.deleted).map((k) => ({
        id: k.id,
        author: k.by,
        text: k.text,
        created_at_i: k.time,
        children: [],
      })),
    };
    return topComments(tree, story.kids, limit);
  }
}

// Stories opened from the launcher, to dim them.
export async function seenStories(): Promise<Set<number>> {
  return new Set(await load<number[]>("hn:seen") ?? []);
}

export async function markSeen(id: number): Promise<void> {
  const seen = (await load<number[]>("hn:seen") ?? []).filter((s) => s !== id);
  await save("hn:seen", [id, ...seen].slice(0, 500));
}

// ---------------------------------------------------------------------------
// Feeds

export interface SavedFeed {
  url: string;
  title?: string;
}

export async function savedFeeds(): Promise<SavedFeed[]> {
  return await load<SavedFeed[]>("rss:feeds") ?? [];
}

export async function setFeeds(feeds: SavedFeed[]): Promise<void> {
  await save("rss:feeds", feeds);
}

const ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5";

async function getText(url: string, signal?: AbortSignal): Promise<{ text: string; type: string; url: string }> {
  const timeout = AbortSignal.timeout(15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: ACCEPT, "User-Agent": "Backslash-RSS/1.0 (+https://github.com/backslash-app/plugins)" },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(timeout.aborted ? "timed out" : (e as Error).message);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`answered ${res.status}`);
  }
  return { text: await res.text(), type: res.headers.get("content-type") ?? "", url: res.url || url };
}

export interface CachedFeed {
  at: number;
  feed: Feed;
}

/** Fetches and parses a feed, and keeps a trimmed copy to show instantly next time. */
export async function fetchFeed(url: string, signal?: AbortSignal): Promise<Feed> {
  const { text } = await getText(url, signal);
  const feed = parseFeed(text, url);
  feed.items = feed.items.slice(0, 50).map((i) => ({ ...i, html: i.html.slice(0, 4000) }));
  await save(`rss:cache:${url}`, { at: Date.now(), feed });
  return feed;
}

export function cachedFeed(url: string): Promise<CachedFeed | undefined> {
  return load<CachedFeed>(`rss:cache:${url}`);
}

/** A feed URL, or a web page advertising one. */
export async function findFeed(url: string, signal?: AbortSignal): Promise<{ url: string; feed: Feed }> {
  const page = await getText(url, signal);
  try {
    return { url: page.url, feed: parseFeed(page.text, page.url) };
  } catch {
    const found = discoverFeeds(page.text, page.url);
    if (!found.length) throw new Error("No RSS or Atom feed found at this address");
    const feedUrl = found[0];
    const { text } = await getText(feedUrl, signal);
    return { url: feedUrl, feed: parseFeed(text, feedUrl) };
  }
}

// Read state: item keys ("<feed url>|<item id>") with when they were read.
export async function readState(): Promise<Record<string, number>> {
  return await load<Record<string, number>>("rss:read") ?? {};
}

export async function setRead(keys: string[], read: boolean): Promise<void> {
  const state = await readState();
  for (const k of keys) {
    if (read) state[k] = Date.now();
    else delete state[k];
  }
  await save("rss:read", state);
}

/** Forgets read marks of items no feed has anymore. */
export async function pruneRead(present: Set<string>): Promise<void> {
  const state = await readState();
  const kept = Object.fromEntries(Object.entries(state).filter(([k]) => present.has(k)));
  if (Object.keys(kept).length !== Object.keys(state).length) await save("rss:read", kept);
}

export const itemKey = (feedUrl: string, id: string) => `${feedUrl}|${id}`;
