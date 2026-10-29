// CheapShark (deals and prices, no key), the Epic Games Store's free games
// feed and GamerPower giveaways; the wishlist and claimed giveaways in storage.

import { storage } from "@backslash/api";
import {
  CHEAPSHARK,
  type Deal,
  dealsUrl,
  type DealView,
  EPIC_URL,
  epicFree,
  type FreeGame,
  fromDeal,
  type GameHit,
  type GameInfo,
  gamesUrl,
  gameUrl,
  type Giveaway,
  giveawaysUrl,
  parseGiveaways,
  type RawDeal,
  searchUrl,
  type Store,
  type WishEntry,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function getJson<T>(url: string, service: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(
      timeout.aborted
        ? `${service} is taking too long to answer`
        : `${service} is unreachable: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 429) throw new Error(`${service} is rate limiting, try again in a minute`);
    throw new Error(`${service} answered ${res.status}`);
  }
  return await res.json() as T;
}

// ---------------------------------------------------------------------------
// CheapShark

/** The stores, kept for a day. */
export async function stores(signal?: AbortSignal): Promise<Store[]> {
  const cached = await load<{ at: number; stores: Store[] }>("stores");
  if (cached && Date.now() - cached.at < 86_400_000) return cached.stores;
  try {
    const list = await getJson<Store[]>(`${CHEAPSHARK}/stores`, "CheapShark", signal);
    await save("stores", { at: Date.now(), stores: list });
    return list;
  } catch (e) {
    if (cached && !signal?.aborted) return cached.stores;
    throw e;
  }
}

export async function deals(
  view: DealView,
  o: { storeIDs?: string[]; maxPrice?: number; signal?: AbortSignal } = {},
): Promise<Deal[]> {
  return (await getJson<RawDeal[]>(dealsUrl(view, o), "CheapShark", o.signal)).map(fromDeal);
}

export const searchGames = (title: string, signal?: AbortSignal) =>
  getJson<GameHit[]>(searchUrl(title), "CheapShark", signal);

export const game = (id: string, signal?: AbortSignal) => getJson<GameInfo>(gameUrl(id), "CheapShark", signal);

/** Several games at once, 25 per request. */
export async function games(ids: string[], signal?: AbortSignal): Promise<Record<string, GameInfo>> {
  const out: Record<string, GameInfo> = {};
  for (let i = 0; i < ids.length; i += 25) {
    Object.assign(out, await getJson<Record<string, GameInfo>>(gamesUrl(ids.slice(i, i + 25)), "CheapShark", signal));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Free games

export async function epic(signal?: AbortSignal): Promise<{ now: FreeGame[]; upcoming: FreeGame[] }> {
  return epicFree(await getJson<unknown>(EPIC_URL, "The Epic Games Store", signal));
}

export async function giveaways(platform: string, signal?: AbortSignal): Promise<Giveaway[]> {
  return parseGiveaways(await getJson<unknown>(giveawaysUrl(platform), "GamerPower", signal));
}

export async function claimed(): Promise<string[]> {
  return (await load<string[]>("claimed")) ?? [];
}

export async function toggleClaimed(id: string): Promise<boolean> {
  const all = await claimed();
  const has = all.includes(id);
  await save("claimed", has ? all.filter((c) => c !== id) : [id, ...all].slice(0, 500));
  return !has;
}

// ---------------------------------------------------------------------------
// Wishlist

export async function wishlist(): Promise<WishEntry[]> {
  return (await load<WishEntry[]>("wishlist")) ?? [];
}

export const saveWishlist = (entries: WishEntry[]) => save("wishlist", entries);

export async function addWish(entry: WishEntry): Promise<void> {
  const all = await wishlist();
  const at = all.findIndex((e) => e.gameID === entry.gameID);
  if (at >= 0) all[at] = { ...all[at], target: entry.target, alerted: undefined };
  else all.unshift(entry);
  await saveWishlist(all);
}

export async function removeWish(gameID: string): Promise<void> {
  await saveWishlist((await wishlist()).filter((e) => e.gameID !== gameID));
}
