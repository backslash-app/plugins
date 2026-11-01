// TheCocktailDB: the free test key "1", or your premium key; the catalog and favorites in storage.

import { storage } from "@backslash/api";
import { type Drink, type Favorite, parseDrink, type RawDrink, SITE, toggleFavorite } from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

/** The v1 API with the public test key, or v2 with a premium key. */
export function baseUrl(apiKey?: string): string {
  const key = (apiKey ?? "").trim();
  return key ? `${SITE}/api/json/v2/${encodeURIComponent(key)}` : `${SITE}/api/json/v1/1`;
}

async function getDrinks(path: string, apiKey: string | undefined, signal?: AbortSignal): Promise<RawDrink[]> {
  const timeout = AbortSignal.timeout(15_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl(apiKey)}/${path}`, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: "application/json" },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(
      timeout.aborted
        ? "TheCocktailDB is taking too long to answer"
        : `TheCocktailDB is unreachable: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    await res.body?.cancel();
    // A wrong premium key answers an HTML 404 page.
    if (res.status === 404 && apiKey) throw new Error("TheCocktailDB refused your API key: check it in Settings");
    if (res.status === 429) throw new Error("TheCocktailDB is rate limiting, try again in a moment");
    throw new Error(`TheCocktailDB answered ${res.status}`);
  }
  const body = await res.json().catch(() => ({})) as { drinks?: RawDrink[] | string | null };
  // No match is `{"drinks": null}`, sometimes `"None Found"`.
  return Array.isArray(body.drinks) ? body.drinks.filter((d) => d?.idDrink && d.strDrink) : [];
}

export async function searchByName(name: string, apiKey?: string, signal?: AbortSignal): Promise<Drink[]> {
  const raw = await getDrinks(`search.php?s=${encodeURIComponent(name.trim())}`, apiKey, signal);
  return raw.map(parseDrink);
}

export async function randomDrink(apiKey?: string, signal?: AbortSignal): Promise<Drink | undefined> {
  const raw = await getDrinks("random.php", apiKey, signal);
  return raw[0] ? parseDrink(raw[0]) : undefined;
}

// ---------------------------------------------------------------------------
// The catalog
//
// The free key's ingredient filter returns one drink, so ingredient searches
// run here on a catalog of full recipes, listed by first letter. The free key
// lists at most 25 per letter (about 440 drinks); a premium key lists them all.

const CATALOG_TTL = 7 * 86_400_000;
const LETTERS = [..."abcdefghijklmnopqrstuvwxyz0123456789"];

interface Cached {
  at: number;
  drinks: Drink[];
}

let memory: { key: string; drinks: Drink[] } | undefined;

const catalogKey = (apiKey?: string) => (apiKey?.trim() ? "catalog:premium" : "catalog:free");

/** The catalog if it is already stored, without any request. */
export async function cachedCatalog(apiKey?: string): Promise<Drink[] | undefined> {
  const key = catalogKey(apiKey);
  if (memory?.key === key) return memory.drinks;
  const cached = await load<Cached>(key);
  if (!cached?.drinks?.length) return undefined;
  memory = { key, drinks: cached.drinks };
  return cached.drinks;
}

let building: { key: string; promise: Promise<Drink[]> } | undefined;

/**
 * The catalog, fetched when missing or older than a week. One build runs at a
 * time and is not tied to a keystroke: typing again does not restart it.
 */
export async function catalog(apiKey?: string, signal?: AbortSignal): Promise<Drink[]> {
  const key = catalogKey(apiKey);
  const cached = await load<Cached>(key);
  if (cached?.drinks?.length && Date.now() - cached.at < CATALOG_TTL) {
    memory = { key, drinks: cached.drinks };
    return cached.drinks;
  }
  if (building?.key !== key) {
    const promise = build(key, apiKey).catch((e) => {
      // A failed build falls back to the old catalog, if any.
      if (cached?.drinks?.length) return cached.drinks;
      throw e;
    }).finally(() => {
      if (building?.promise === promise) building = undefined;
    });
    building = { key, promise };
  }
  const promise = building.promise;
  if (!signal) return await promise;
  return await new Promise<Drink[]>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function build(key: string, apiKey?: string): Promise<Drink[]> {
  const byId = new Map<string, Drink>();
  // Four letters at a time: gentle on a free service.
  for (let i = 0; i < LETTERS.length; i += 4) {
    const batch = await Promise.all(
      LETTERS.slice(i, i + 4).map((l) => getDrinks(`search.php?f=${l}`, apiKey)),
    );
    for (const raw of batch.flat()) byId.set(raw.idDrink, parseDrink(raw));
  }
  const drinks = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (drinks.length) {
    memory = { key, drinks };
    await save(key, { at: Date.now(), drinks } satisfies Cached);
  }
  return drinks;
}

// ---------------------------------------------------------------------------
// Favorites

export const favorites = async () => await load<Favorite[]>("favorites") ?? [];

/** Adds or removes the drink; true when it is now a favorite. */
export async function toggle(drink: Drink): Promise<boolean> {
  const next = toggleFavorite(await favorites(), drink);
  await save("favorites", next);
  return next.some((f) => f.drink.id === drink.id);
}
