// Datamuse requests, remembered for the session: the same word is often looked up again while browsing.

import {
  type DatamuseWord,
  type Entry,
  mergeSynonyms,
  parseWords,
  type Relation,
  relationUrl,
  toEntry,
  wordUrl,
} from "./lib.ts";

const cache = new Map<string, DatamuseWord[]>();

async function getJson(url: string, signal?: AbortSignal): Promise<DatamuseWord[]> {
  const hit = cache.get(url);
  if (hit) return hit;
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Datamuse is unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Datamuse answered ${res.status}`);
  }
  const data = await res.json() as DatamuseWord[];
  if (cache.size > 200) cache.clear();
  cache.set(url, data);
  return data;
}

export async function related(relation: Relation, text: string, signal?: AbortSignal, max = 40): Promise<Entry[]> {
  if (relation === "syn") {
    const [syn, similar] = await Promise.all([
      getJson(relationUrl("syn", text, max), signal),
      getJson(relationUrl("ml", text, max), signal),
    ]);
    return mergeSynonyms(parseWords(syn, text), parseWords(similar, text), Math.min(max, 20));
  }
  // A pattern is not a word to leave out of its own results.
  return parseWords(await getJson(relationUrl(relation, text, max), signal), relation === "sp" ? "" : text);
}

/** The word itself, when Datamuse knows it. */
export async function lookup(word: string, signal?: AbortSignal): Promise<Entry | undefined> {
  const [first] = await getJson(wordUrl(word), signal);
  return first && first.word.toLowerCase() === word.toLowerCase() ? toEntry(first) : undefined;
}
