// BoardGameGeek's XML API 2. Since 2025 every request must carry the bearer
// token of an application registered at boardgamegeek.com/applications.
// Answers are cached: game details a day, searches an hour, collections and
// plays ten minutes.

import { storage } from "@backslash/api";
import {
  cleanUsername,
  type CollectionFilter,
  type CollectionItem,
  collectionUrl,
  type Game,
  parseCollection,
  parsePlays,
  parseSearch,
  parseThings,
  type Plays,
  playsUrl,
  type SearchHit,
  searchUrl,
  THING_BATCH,
  thingUrl,
  tokenRefused,
} from "./lib.ts";

export interface Prefs {
  token?: string;
  username?: string;
}

const HOUR = 3600_000;

/** No token in the preferences: BGG refuses every request without one. */
export class TokenMissing extends Error {
  constructor() {
    super("BoardGameGeek needs an application token");
  }
}

export class TokenRefused extends Error {
  constructor() {
    super("BoardGameGeek refused the token: check it in Settings → Extensions → BoardGameGeek");
  }
}

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string, ttl: number): Promise<T | undefined> {
  const hit = await storage.get(key).catch(() => undefined) as { at: number; data: T } | undefined;
  return hit && Date.now() - hit.at < ttl ? hit.data : undefined;
}

async function save(key: string, data: unknown): Promise<void> {
  await storage.set(key, { at: Date.now(), data } as Json).catch(() => {});
}

export function tokenOf(prefs: Prefs): string {
  const token = String(prefs.token ?? "").trim().replace(/^Bearer\s+/i, "");
  if (!token) throw new TokenMissing();
  return token;
}

export function usernameOf(prefs: Prefs): string {
  const name = cleanUsername(String(prefs.username ?? ""));
  if (!name) throw new Error("Set your BoardGameGeek username in Settings → Extensions → BoardGameGeek");
  return name;
}

/** Waits `ms`, or rejects when the signal aborts. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

/** One request: the status and body, with BGG's errors turned into messages. */
export async function request(
  url: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ status: number; body: string }> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Authorization: `Bearer ${token}`, Accept: "application/xml" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`BoardGameGeek is unreachable: ${(e as Error).message}`);
  }
  const body = await res.text().catch(() => "");
  if (tokenRefused(res.status)) throw new TokenRefused();
  if (res.status === 429) throw new Error("BoardGameGeek asks to slow down: try again in a minute");
  if (res.status >= 500) throw new Error(`BoardGameGeek is not answering right now (${res.status}): try again`);
  if (!res.ok && res.status !== 202) throw new Error(`BoardGameGeek answered ${res.status}`);
  return { status: res.status, body };
}

export async function search(query: string, token: string, signal?: AbortSignal): Promise<SearchHit[]> {
  const key = `search:${query.trim().toLowerCase()}`;
  const hit = await load<SearchHit[]>(key, HOUR);
  if (hit) return hit;
  const hits = parseSearch((await request(searchUrl(query), token, signal)).body);
  await save(key, hits);
  return hits;
}

/** Details for these games, from the cache when possible, in batches of 20. */
export async function things(ids: number[], token: string, signal?: AbortSignal): Promise<Game[]> {
  const found = new Map<number, Game>();
  const missing: number[] = [];
  for (const id of ids) {
    const g = await load<Game>(`thing:${id}`, 24 * HOUR);
    if (g) found.set(id, g);
    else missing.push(id);
  }
  for (let i = 0; i < missing.length; i += THING_BATCH) {
    const batch = missing.slice(i, i + THING_BATCH);
    for (const g of parseThings((await request(thingUrl(batch), token, signal)).body)) {
      found.set(g.id, g);
      await save(`thing:${g.id}`, g);
    }
  }
  return ids.flatMap((id) => found.get(id) ?? []);
}

/** Delays between tries while BGG prepares a collection (202). */
export const COLLECTION_RETRIES = [2000, 3000, 5000, 8000, 12000];

/**
 * One try at a user's collection. BGG answers 202 the first time in a while,
 * while it builds it: this returns "queued", to try again a few seconds later.
 */
export async function collectionOnce(
  username: string,
  filter: CollectionFilter,
  token: string,
  o: { signal?: AbortSignal; fresh?: boolean } = {},
): Promise<CollectionItem[] | "queued"> {
  const key = `collection:${username.toLowerCase()}:${filter}`;
  const hit = o.fresh ? undefined : await load<CollectionItem[]>(key, HOUR / 6);
  if (hit) return hit;
  const res = await request(collectionUrl(username, filter), token, o.signal);
  if (res.status === 202) return "queued";
  const items = parseCollection(res.body);
  await save(key, items);
  return items;
}

/**
 * A user's collection, trying again while BGG prepares it. Yields "queued"
 * before each wait, then the items.
 */
export async function* collection(
  username: string,
  filter: CollectionFilter,
  token: string,
  o: { signal?: AbortSignal; fresh?: boolean; delays?: number[] } = {},
): AsyncGenerator<"queued" | CollectionItem[]> {
  const delays = o.delays ?? COLLECTION_RETRIES;
  for (let attempt = 0;; attempt++) {
    const result = await collectionOnce(username, filter, token, { ...o, fresh: o.fresh || attempt > 0 });
    if (result !== "queued") {
      yield result;
      return;
    }
    if (attempt >= delays.length) {
      throw new Error("BoardGameGeek is still preparing this collection: try again in a minute");
    }
    yield "queued";
    await wait(delays[attempt], o.signal);
  }
}

export async function plays(username: string, token: string, signal?: AbortSignal, fresh = false): Promise<Plays> {
  const key = `plays:${username.toLowerCase()}`;
  const hit = fresh ? undefined : await load<Plays>(key, HOUR / 6);
  if (hit) return hit;
  const result = parsePlays((await request(playsUrl(username), token, signal)).body);
  await save(key, result);
  return result;
}
