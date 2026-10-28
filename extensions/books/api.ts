// The Open Library API (no key), and the reading list.

import { storage } from "@backslash/api";
import {
  type Book,
  fromDoc,
  isbnQuery,
  type Saved,
  SEARCH_FIELDS,
  type SearchDoc,
  setStatus,
  type Status,
  type Work,
} from "./lib.ts";

const BASE = "https://openlibrary.org";
// Open Library asks clients to identify themselves.
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "Backslash-Books/1.0 (+https://github.com/backslash-app/plugins)",
};

type Json = Parameters<typeof storage.set>[1];

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: HEADERS,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(
      timeout.aborted
        ? "Open Library is taking too long to answer"
        : `Open Library is unreachable: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 429) throw new Error("Open Library is rate limiting, try again in a moment");
    if (res.status >= 500) throw new Error(`Open Library is having trouble (${res.status}), try again later`);
    throw new Error(`Open Library answered ${res.status}`);
  }
  return await res.json() as T;
}

export async function searchBooks(
  query: string,
  signal?: AbortSignal,
  limit = 25,
): Promise<{ books: Book[]; total: number }> {
  const isbn = isbnQuery(query);
  const params = new URLSearchParams({ fields: SEARCH_FIELDS, limit: String(limit) });
  if (isbn) params.set("isbn", isbn);
  else params.set("q", query.trim());
  const res = await getJson<{ numFound?: number; docs?: SearchDoc[] }>(`/search.json?${params}`, signal);
  return { books: (res.docs ?? []).filter((d) => d.key && d.title).map(fromDoc), total: res.numFound ?? 0 };
}

const works = new Map<string, Work>();

export async function work(key: string, signal?: AbortSignal): Promise<Work> {
  const hit = works.get(key);
  if (hit) return hit;
  const w = await getJson<Work>(`${key}.json`, signal);
  works.set(key, w);
  return w;
}

// ---------------------------------------------------------------------------
// Reading list

export const readingList = async () => await load<Saved[]>("reading-list") ?? [];

export async function setBookStatus(book: Book, status: Status | undefined): Promise<void> {
  await save("reading-list", setStatus(await readingList(), book, status));
}
