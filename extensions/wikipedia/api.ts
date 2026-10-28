// Requests to Wikipedia. Wikimedia asks API clients to identify themselves.

import {
  articleUrl,
  type DayEntry,
  type LangLink,
  langLinksUrl,
  onThisDayUrl,
  type Page,
  parseArticle,
  parseLangLinks,
  parseOnThisDay,
  parseSearch,
  parseSummary,
  randomUrl,
  searchUrl,
} from "./lib.ts";

const HEADERS = {
  "User-Agent": "Backslash-Wikipedia/1.0 (https://github.com/backslash-app/plugins)",
  "Api-User-Agent": "Backslash-Wikipedia/1.0 (https://github.com/backslash-app/plugins)",
  Accept: "application/json",
};

export class NotFound extends Error {}

async function get(url: string, signal?: AbortSignal): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof TypeError && /dns|lookup|resolve/i.test(e.message)) {
      const lang = new URL(url).hostname.split(".")[0];
      throw new Error(`No Wikipedia in “${lang}”, or you are offline`);
    }
    throw new Error(`Wikipedia can't be reached: ${(e as Error).message}`);
  }
  if (res.status === 404) {
    await res.body?.cancel();
    throw new NotFound("Not found");
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Wikipedia answered ${res.status} ${res.statusText}`);
  }
  const json = await res.json() as { error?: { info?: string } };
  if (json?.error) throw new Error(`Wikipedia: ${json.error.info ?? "error"}`);
  return json;
}

export const search = async (lang: string, text: string, signal?: AbortSignal): Promise<Page[]> =>
  parseSearch(lang, await get(searchUrl(lang, text), signal));

export const article = async (lang: string, title: string, signal?: AbortSignal): Promise<Page | undefined> =>
  parseArticle(lang, await get(articleUrl(lang, title), signal));

export const langLinks = async (lang: string, title: string): Promise<LangLink[]> =>
  parseLangLinks(await get(langLinksUrl(lang, title)));

export const random = async (lang: string, signal?: AbortSignal): Promise<Page> =>
  parseSummary(lang, await get(randomUrl(lang), signal) as Parameters<typeof parseSummary>[1]);

export const onThisDay = async (lang: string, date: Date, signal?: AbortSignal): Promise<DayEntry[]> =>
  parseOnThisDay(lang, await get(onThisDayUrl(lang, date), signal));
