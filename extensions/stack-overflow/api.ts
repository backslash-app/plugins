// Stack Exchange API 2.3, with a small cache in the extension's storage to spare the daily quota.

import { storage } from "@backslash/api";
import {
  type Answer,
  apiError,
  type Cached,
  cacheKey,
  fresh,
  mapAnswer,
  mapPage,
  mapQuestion,
  type Page,
  type Question,
  searchParams,
  type Site,
  touch,
} from "./lib.ts";

const API = "https://api.stackexchange.com/2.3";
const SEARCH_TTL = 60 * 60 * 1000; // an hour
const ANSWERS_TTL = 6 * 60 * 60 * 1000;
const MAX_CACHED = 120;

export interface Quota {
  remaining: number;
  max: number;
  at: number;
}

async function remember<T>(key: string, value: T) {
  try {
    await storage.set(key, { at: Date.now(), value } as never);
    const keys = (await storage.get<string[]>("cache-keys")) ?? [];
    const { keys: next, evicted } = touch(keys, key, MAX_CACHED);
    await storage.set("cache-keys", next);
    for (const k of evicted) await storage.delete(k);
  } catch {
    // The cache is a convenience.
  }
}

const recall = async <T>(key: string) =>
  (await storage.get(key).catch(() => undefined)) as unknown as Cached<T> | undefined;

async function get(path: string, params: URLSearchParams, signal?: AbortSignal): Promise<any> {
  const until = Number(await storage.get("backoff-until").catch(() => 0)) || 0;
  if (until > Date.now()) {
    throw new Error(`Stack Exchange asked to wait ${Math.ceil((until - Date.now()) / 1000)} s between searches`);
  }
  let res: Response;
  try {
    res = await fetch(`${API}${path}?${params}`, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("Stack Exchange can't be reached: check your connection");
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error_id) throw new Error(apiError(res.status, json));
  if (typeof json.backoff === "number") await storage.set("backoff-until", Date.now() + json.backoff * 1000);
  if (typeof json.quota_remaining === "number") {
    await storage.set("quota", { remaining: json.quota_remaining, max: json.quota_max ?? 300, at: Date.now() })
      .catch(() => {});
  }
  return json;
}

export const quota = async () => (await storage.get("quota").catch(() => undefined)) as unknown as Quota | undefined;

/** Questions matching the query, with their bodies; cached for an hour. */
export async function searchQuestions(
  input: string,
  site: Site,
  key: string | undefined,
  signal?: AbortSignal,
): Promise<Page<Question> & { cached: boolean }> {
  const params = searchParams(input, site, key);
  if (!params) return { items: [], cached: true };
  const ck = cacheKey("search", site, input);
  const cached = await recall<Question[]>(ck);
  if (fresh(cached, SEARCH_TTL)) return { items: cached.value, cached: true };
  const page = mapPage(await get("/search/advanced", params, signal), mapQuestion);
  await remember(ck, page.items);
  return { ...page, cached: false };
}

/** The answers of a question, best first, with their bodies; cached for six hours. */
export async function answersOf(q: Question, site: Site, key: string | undefined, signal?: AbortSignal) {
  const ck = cacheKey("answers", site, String(q.id));
  const cached = await recall<Answer[]>(ck);
  if (fresh(cached, ANSWERS_TTL)) return cached.value;
  const params = new URLSearchParams({
    order: "desc",
    sort: "votes",
    site: site.id,
    filter: "withbody",
    pagesize: "5",
  });
  if (key) params.set("key", key);
  const page = mapPage(await get(`/questions/${q.id}/answers`, params, signal), mapAnswer);
  await remember(ck, page.items);
  return page.items;
}

/** Questions opened lately, most recent first. */
export async function recent(site: Site): Promise<Question[]> {
  return ((await storage.get(`recent:${site.id}`).catch(() => undefined)) as unknown as Question[]) ?? [];
}

export async function addRecent(site: Site, q: Question) {
  const list = (await recent(site)).filter((r) => r.id !== q.id);
  await storage.set(`recent:${site.id}`, [q, ...list].slice(0, 15) as never).catch(() => {});
}

export async function clearRecent(site: Site) {
  await storage.delete(`recent:${site.id}`).catch(() => {});
}
