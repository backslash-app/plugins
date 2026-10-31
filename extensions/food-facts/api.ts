// Network and cache. Open Food Facts allows about 100 product reads and 10 searches a minute per
// user: products are kept a day, searches an hour, and every request says who is asking.

import { storage } from "@backslash/api";
import { parseProductResponse, parseSearch, type Product, productUrl, searchUrl, USER_AGENT } from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];
const HOUR = 3_600_000;

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function getJson(url: string, signal?: AbortSignal): Promise<{ status: number; body: unknown }> {
  const timeout = AbortSignal.timeout(20_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Open Food Facts is unreachable: ${(e as Error).message}`);
  }
  if (res.status === 429) {
    await res.body?.cancel();
    throw new Error("Open Food Facts asks to slow down: wait a minute before searching again");
  }
  const body = await res.json().catch(() => undefined);
  // A missing product is a 404 with a JSON body; anything else without JSON is an outage page.
  if (body === undefined) throw new Error(`Open Food Facts is unavailable right now (${res.status}): try again later`);
  return { status: res.status, body };
}

async function cached<T>(key: string, ttl: number, get: () => Promise<T>): Promise<T> {
  const hit = await load<{ at: number; value: T }>(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await get();
  await save(key, { at: Date.now(), value });
  return value;
}

/** A product by barcode, or undefined when Open Food Facts doesn't know it. */
export async function product(code: string, lang: string, signal?: AbortSignal): Promise<Product | undefined> {
  const found = await cached(`product:${lang}:${code}`, 24 * HOUR, async () => {
    const { body } = await getJson(productUrl(code, lang), signal);
    return parseProductResponse(body, lang) ?? null;
  });
  return found ?? undefined;
}

export async function search(
  query: string,
  lang: string,
  signal?: AbortSignal,
): Promise<{ products: Product[]; count: number }> {
  const q = query.trim().toLowerCase();
  return await cached(`search:${lang}:${q}`, HOUR, async () => {
    const { status, body } = await getJson(searchUrl(q, lang), signal);
    if (status >= 400) throw new Error(`Open Food Facts search answered ${status}`);
    return parseSearch(body, lang);
  });
}

// Recently viewed products, newest first, for the empty search.

const RECENT_MAX = 20;

export async function recent(): Promise<Product[]> {
  return await load<Product[]>("recent") ?? [];
}

export async function remember(p: Product): Promise<void> {
  const list = (await recent()).filter((r) => r.code !== p.code);
  await save("recent", [p, ...list].slice(0, RECENT_MAX));
}

export async function forget(code: string): Promise<void> {
  await save("recent", (await recent()).filter((r) => r.code !== code));
}

export async function clearRecent(): Promise<void> {
  await save("recent", []);
}
