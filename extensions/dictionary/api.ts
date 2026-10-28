// Fetching definitions and translations.

import { storage } from "@backslash/api";
import {
  enrich,
  type Entry,
  type FreeDictEntry,
  fromFreeDictionary,
  fromFrWikitext,
  fromRest,
  type Lang,
  type MyMemoryResponse,
  myMemoryUrl,
  parseTranslation,
  type RestResponse,
  type Translation,
} from "./lib.ts";

// Wikimedia asks API clients to identify themselves.
const HEADERS = { "Api-User-Agent": "Backslash-Dictionary/1.0 (https://github.com/backslash-app/plugins)" };

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T | undefined> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: HEADERS });
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

/** The word as typed, then in lower case ("House" → "house"). */
function variants(word: string): string[] {
  return [...new Set([word, word.toLowerCase()])];
}

async function english(word: string, signal?: AbortSignal): Promise<Entry | undefined> {
  for (const w of variants(word)) {
    const title = encodeURIComponent(w.replaceAll(" ", "_"));
    const [rest, free] = await Promise.all([
      getJson<RestResponse>(`https://en.wiktionary.org/api/rest_v1/page/definition/${title}`, signal),
      // Optional: pronunciation and synonyms.
      getJson<FreeDictEntry[]>(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(w)}`, signal)
        .catch((e) => {
          if ((e as Error).name === "AbortError") throw e;
          return undefined;
        }),
    ]);
    const extra = free ? fromFreeDictionary(w, free) : undefined;
    const main = rest ? fromRest(w, rest, "en") : undefined;
    const entry = main ? enrich(main, extra) : extra;
    if (entry) return entry;
  }
  return undefined;
}

async function french(word: string, signal?: AbortSignal): Promise<Entry | undefined> {
  for (const w of variants(word)) {
    const q = new URLSearchParams({
      action: "parse",
      page: w,
      prop: "wikitext",
      format: "json",
      formatversion: "2",
      redirects: "1",
      origin: "*",
    });
    const res = await getJson<{ parse?: { title: string; wikitext: string }; error?: { code: string } }>(
      `https://fr.wiktionary.org/w/api.php?${q}`,
      signal,
    );
    if (res?.parse) {
      const entry = fromFrWikitext(res.parse.title, res.parse.wikitext);
      if (entry) return entry;
    }
  }
  return undefined;
}

export function lookup(word: string, lang: Lang, signal?: AbortSignal): Promise<Entry | undefined> {
  return lang === "fr" ? french(word, signal) : english(word, signal);
}

export async function translate(text: string, from: string, to: string, signal?: AbortSignal): Promise<Translation> {
  const res = await getJson<MyMemoryResponse>(myMemoryUrl(text, from, to), signal);
  if (!res) throw new Error("MyMemory: no answer");
  return parseTranslation(res);
}

// Recent lookups

export interface Recent {
  word: string;
  lang: Lang;
  at: number;
}

type Json = Parameters<typeof storage.set>[1];

export async function recents(): Promise<Recent[]> {
  return (await storage.get("recent").catch(() => undefined) as Recent[] | undefined) ?? [];
}

export async function remember(word: string, lang: Lang): Promise<void> {
  const list = (await recents()).filter((r) => !(r.word.toLowerCase() === word.toLowerCase() && r.lang === lang));
  await storage.set("recent", [{ word, lang, at: Date.now() }, ...list].slice(0, 30) as unknown as Json);
}

export async function forget(word?: string, lang?: Lang): Promise<void> {
  const list = word ? (await recents()).filter((r) => !(r.word === word && r.lang === lang)) : [];
  await storage.set("recent", list as unknown as Json);
}
