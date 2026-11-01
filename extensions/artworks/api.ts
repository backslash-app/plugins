// The Met and Art Institute of Chicago APIs (no key), and the daily picks kept in storage.

import { storage } from "@backslash/api";
import {
  type AicArtwork,
  aicHighlightsUrl,
  aicSearchUrl,
  type Artwork,
  DAILY_POOL,
  dailyPick,
  fromAic,
  fromMet,
  mapLimit,
  metHighlightsUrl,
  type MetObject,
  metObjectUrl,
  metSearchUrl,
  type Museum,
  MUSEUMS,
  showable,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

// The Art Institute asks API clients to say who they are in this header.
const AIC_HEADERS = {
  Accept: "application/json",
  "AIC-User-Agent": "Backslash-Artworks (https://github.com/backslash-app/plugins)",
};

async function getJson<T>(url: string, museum: Museum, signal?: AbortSignal): Promise<T> {
  const name = MUSEUMS[museum].short;
  const timeout = AbortSignal.timeout(15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: museum === "aic" ? AIC_HEADERS : { Accept: "application/json" },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(
      timeout.aborted ? `${name} is taking too long to answer` : `${name} is unreachable: ${(e as Error).message}`,
    );
  }
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 404) throw new NotFound();
    if (res.status === 403) {
      throw new Error(`${name} refused the request (403): its firewall may be blocking this network`);
    }
    if (res.status === 429) throw new Error(`${name} is rate limiting, try again in a moment`);
    throw new Error(`${name} answered ${res.status}`);
  }
  return await res.json() as T;
}

class NotFound extends Error {
  constructor() {
    super("Not found");
  }
}

// ---------------------------------------------------------------------------
// The Met: a search gives object ids, each object is a request of its own.

const metObjects = new Map<string, Artwork>();

export async function metObject(id: string | number, signal?: AbortSignal): Promise<Artwork | undefined> {
  const key = String(id);
  const hit = metObjects.get(key);
  if (hit) return hit;
  try {
    const art = fromMet(await getJson<MetObject>(metObjectUrl(id), "met", signal));
    metObjects.set(key, art);
    return art;
  } catch (e) {
    if (e instanceof NotFound) return undefined;
    throw e;
  }
}

export async function searchMet(
  query: string,
  signal?: AbortSignal,
  count = 12,
): Promise<{ artworks: Artwork[]; total: number }> {
  const res = await getJson<{ total?: number; objectIDs?: number[] | null }>(metSearchUrl(query, count), "met", signal);
  const ids = (res.objectIDs ?? []).slice(0, count);
  // Six object requests at a time.
  const found = await mapLimit(ids, 6, (id) => metObject(id, signal));
  if (signal?.aborted) throw signal.reason;
  return { artworks: found.filter((a): a is Artwork => !!a), total: res.total ?? ids.length };
}

// ---------------------------------------------------------------------------
// The Art Institute: one request gives every field.

export async function searchAic(
  query: string,
  signal?: AbortSignal,
  count = 12,
  publicDomainOnly = false,
): Promise<{ artworks: Artwork[]; total: number }> {
  const res = await getJson<{ data?: AicArtwork[]; pagination?: { total?: number } }>(
    aicSearchUrl(query, count, publicDomainOnly),
    "aic",
    signal,
  );
  return { artworks: (res.data ?? []).map(fromAic), total: res.pagination?.total ?? 0 };
}

// ---------------------------------------------------------------------------
// Artwork of the day: the same for everyone on a given day, kept once found.

interface Daily {
  day: string;
  artwork: Artwork;
}

async function highlightAt(museum: Museum, offset: number, signal?: AbortSignal): Promise<Artwork | undefined> {
  if (museum === "met") {
    const res = await getJson<{ objectIDs?: number[] | null }>(metHighlightsUrl(offset), "met", signal);
    const id = res.objectIDs?.[0];
    return id ? await metObject(id, signal) : undefined;
  }
  const res = await getJson<{ data?: AicArtwork[] }>(aicHighlightsUrl(offset), "aic", signal);
  return res.data?.[0] ? fromAic(res.data[0]) : undefined;
}

export async function artworkOfTheDay(day: string, signal?: AbortSignal): Promise<Artwork> {
  const history = await dailyHistory();
  const known = history.find((d) => d.day === day);
  if (known) return known.artwork;
  const pick = dailyPick(day);
  // A few highlights lack a public picture: the next one is used, the same for everyone.
  let artwork: Artwork | undefined;
  for (let i = 0; i < 5 && !artwork; i++) {
    const found = await highlightAt(pick.museum, (pick.offset + i) % DAILY_POOL[pick.museum], signal);
    if (found && showable(found)) artwork = found;
  }
  if (!artwork) throw new Error(`${MUSEUMS[pick.museum].short} has no artwork for today, try again later`);
  // The last 30 days, newest first.
  await save("daily", [{ day, artwork }, ...history.filter((d) => d.day !== day)].slice(0, 30));
  return artwork;
}

export const dailyHistory = async () => await load<Daily[]>("daily") ?? [];
