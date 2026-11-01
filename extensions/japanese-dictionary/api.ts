// Network and cache: Jisho searches are kept a day, kanji forever, recent lookups in storage.

import { storage } from "@backslash/api";
import {
  type JishoResponse,
  jishoUrl,
  type Kanji,
  type KanjiResponse,
  kanjiUrl,
  parseJisho,
  toKanji,
  type Word,
} from "./lib.ts";

const SEARCH_TTL = 24 * 3600_000;
const MAX_RECENT = 15;

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | undefined> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`${new URL(url).host} is unreachable: ${(e as Error).message}`);
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return undefined;
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${new URL(url).host} answered ${res.status}`);
  }
  return await res.json() as T;
}

export async function searchWords(keyword: string, signal?: AbortSignal): Promise<Word[]> {
  const key = `search:${keyword.toLowerCase()}`;
  const cached = await load<{ at: number; data: JishoResponse }>(key);
  if (cached && Date.now() - cached.at < SEARCH_TTL) return parseJisho(cached.data);
  const data = await getJson<JishoResponse>(jishoUrl(keyword), signal) ?? { data: [] };
  // Keep the cache small: the first 20 results are all the list shows.
  const slim = { data: (data.data ?? []).slice(0, 20) };
  await save(key, { at: Date.now(), data: slim });
  return parseJisho(slim);
}

/** Details of one kanji; undefined when kanjiapi.dev doesn't know it. */
export async function kanjiDetails(kanji: string, signal?: AbortSignal): Promise<Kanji | undefined> {
  const key = `kanji:${kanji}`;
  const cached = await load<KanjiResponse>(key);
  if (cached) return toKanji(cached);
  const data = await getJson<KanjiResponse>(kanjiUrl(kanji), signal);
  if (!data) return undefined;
  await save(key, data);
  return toKanji(data);
}

/** Several kanji at once; the ones that fail are left out. */
export async function kanjiList(kanji: string[], signal?: AbortSignal): Promise<Kanji[]> {
  const all = await Promise.all(kanji.map((k) =>
    kanjiDetails(k, signal).catch((e) => {
      if ((e as Error).name === "AbortError") throw e;
      return undefined;
    })
  ));
  return all.filter((k): k is Kanji => !!k);
}

// Recent lookups

export interface Recent {
  query: string;
  word: string;
  reading: string;
  gloss: string;
}

export async function recents(): Promise<Recent[]> {
  return await load<Recent[]>("recent") ?? [];
}

export async function remember(r: Recent): Promise<void> {
  const list = (await recents()).filter((x) => x.query !== r.query);
  await save("recent", [r, ...list].slice(0, MAX_RECENT));
}

export async function forget(query?: string): Promise<void> {
  await save("recent", query === undefined ? [] : (await recents()).filter((x) => x.query !== query));
}
