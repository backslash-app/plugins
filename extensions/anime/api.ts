// Network: AniList's GraphQL API and MyAnimeList's API v2. The airing schedule is cached for
// 30 minutes; lists are always fetched since they change when you watch.

import { storage } from "@backslash/api";
import {
  type Airing,
  ANILIST,
  anilistError,
  BY_MAL_QUERY,
  type Entry,
  LIST_QUERY,
  malListUrl,
  type Media,
  parseAniListCollection,
  parseByMal,
  parseMalList,
  parseSchedule,
  parseSearch,
  PROGRESS_MUTATION,
  SCHEDULE_QUERY,
  SEARCH_QUERY,
  type Settings,
  sortEntries,
  VIEWER_QUERY,
  withAiring,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

export class SetupError extends Error {}

async function send(url: string, init: RequestInit, service: string, signal?: AbortSignal): Promise<Response> {
  const timeout = AbortSignal.timeout(15_000);
  try {
    return await fetch(url, { ...init, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`${service} is unreachable: ${(e as Error).message}`);
  }
}

export async function gql<T = any>(
  query: string,
  variables: Record<string, unknown>,
  o: { token?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  const res = await send(
    ANILIST,
    { method: "POST", headers, body: JSON.stringify({ query, variables }) },
    "AniList",
    o.signal,
  );
  const body = await res.json().catch(() => undefined);
  const error = anilistError(body, res.status);
  if (error) throw new Error(error);
  return body as T;
}

/** A short fingerprint of the token, so the viewer cached for one token isn't used for another. */
function fingerprint(token: string): string {
  let h = 2166136261;
  for (let i = 0; i < token.length; i++) h = Math.imul(h ^ token.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

async function viewer(token: string, signal?: AbortSignal): Promise<{ id: number; name: string }> {
  const key = `viewer:${fingerprint(token)}`;
  const hit = await storage.get(key).catch(() => undefined) as { id: number; name: string } | undefined;
  if (hit) return hit;
  const body = await gql(VIEWER_QUERY, {}, { token, signal });
  const v = body?.data?.Viewer;
  if (!v?.id) throw new SetupError("AniList didn't recognize the token: get a new one in Settings");
  await storage.set(key, { id: v.id, name: v.name } as Json).catch(() => {});
  return v;
}

/** Who the list belongs to, for the status line and links. */
export async function anilistUser(s: Settings, signal?: AbortSignal): Promise<{ id?: number; name: string }> {
  if (s.anilistToken) return await viewer(s.anilistToken, signal);
  return { name: s.anilistUser! };
}

export async function watching(s: Settings, source: "anilist" | "myanimelist", signal?: AbortSignal): Promise<Entry[]> {
  if (source === "anilist") {
    const user = await anilistUser(s, signal);
    const body = await gql(LIST_QUERY, user.id ? { userId: user.id } : { userName: user.name }, {
      token: s.anilistToken,
      signal,
    });
    return sortEntries(parseAniListCollection(body, s.titles));
  }
  const res = await send(
    malListUrl(s.malUser!),
    { headers: { "X-MAL-CLIENT-ID": s.malClientId! } },
    "MyAnimeList",
    signal,
  );
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new SetupError("MyAnimeList refused the Client ID (or the list is private): check Settings");
  }
  if (res.status === 404) {
    await res.body?.cancel();
    throw new SetupError(`MyAnimeList has no user “${s.malUser}”`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`MyAnimeList answered ${res.status}`);
  }
  const entries = parseMalList(await res.json(), s.titles);
  // AniList knows the real next episode and time of most shows by their MyAnimeList id.
  const ids = entries.map((e) => e.media.malId).filter((id): id is number => !!id).slice(0, 50);
  const byMal = ids.length
    ? await gql(BY_MAL_QUERY, { ids }, { signal }).then(parseByMal).catch(() => new Map())
    : new Map();
  return sortEntries(withAiring(entries, byMal));
}

/** Saves progress on AniList and returns the new value. */
export async function saveProgress(token: string, entryId: number, progress: number, status?: string): Promise<number> {
  const body = await gql(PROGRESS_MUTATION, { id: entryId, progress, ...(status ? { status } : {}) }, { token });
  return Number(body?.data?.SaveMediaListEntry?.progress ?? progress);
}

/** Episodes airing in the next `days` days, all pages, cached 30 minutes. */
export async function schedule(s: Settings, days: number, signal?: AbortSignal): Promise<Airing[]> {
  const now = Math.floor(Date.now() / 1000);
  const slot = Math.floor(now / 1800);
  const key = `schedule:${days}:${s.titles}`;
  const hit = await storage.get(key).catch(() => undefined) as { slot: number; airing: Airing[] } | undefined;
  if (hit?.slot === slot) return hit.airing;
  const out: Airing[] = [];
  for (let page = 1; page <= 8; page++) {
    const body = await gql(SCHEDULE_QUERY, { from: now - 3600, to: now + days * 86_400, page }, { signal });
    const { airing, more } = parseSchedule(body, s.titles);
    out.push(...airing);
    if (!more) break;
  }
  await storage.set(key, { slot, airing: out } as unknown as Json).catch(() => {});
  return out;
}

export async function search(
  query: string,
  type: "ANIME" | "MANGA",
  s: Settings,
  signal?: AbortSignal,
): Promise<Media[]> {
  const body = await gql(SEARCH_QUERY, { search: query, type, ...(s.adult ? {} : { adult: false }) }, {
    token: s.anilistToken,
    signal,
  });
  return parseSearch(body, s.titles);
}
