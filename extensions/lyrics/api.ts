// LRCLIB (lrclib.net: free, no key), with the lyrics of each track kept in
// storage so a song is looked up once.

import { storage } from "@backslash/api";
import {
  bestMatch,
  cleanArtist,
  cleanTitle,
  getUrl,
  LRCLIB,
  type LrcRecord,
  lyricsKey,
  searchUrl,
  splitVideoTitle,
  type Track,
} from "./lib.ts";

// LRCLIB asks clients to say who they are.
const HEADERS = { "User-Agent": "Backslash Lyrics v1.0 (https://github.com/backslash-app/plugins)" };

type Json = Parameters<typeof storage.set>[1];

async function get<T>(url: string, signal?: AbortSignal): Promise<T | undefined> {
  const timeout = AbortSignal.timeout(15_000);
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(
      timeout.aborted ? "LRCLIB is taking too long to answer" : `LRCLIB is unreachable: ${(e as Error).message}`,
    );
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return undefined;
  }
  if (!res.ok) {
    await res.body?.cancel();
    if (res.status === 429) throw new Error("LRCLIB is rate limiting, try again in a moment");
    throw new Error(`LRCLIB answered ${res.status}`);
  }
  return await res.json() as T;
}

export async function search(q: { q?: string; artist?: string; title?: string }, signal?: AbortSignal) {
  return (await get<LrcRecord[]>(searchUrl(q), signal)) ?? [];
}

export const byId = (id: number, signal?: AbortSignal) => get<LrcRecord>(`${LRCLIB}/get/${id}`, signal);

/** What is saved per track: the record, or that LRCLIB had nothing (retried after a day). */
interface Saved {
  record?: LrcRecord;
  checked: number;
}

const DAY = 86_400_000;

/** The lyrics of a track: saved, exact match, or the best search result. */
export async function lyricsFor(track: Track, signal?: AbortSignal): Promise<LrcRecord | undefined> {
  const { artist, title } = splitVideoTitle(track);
  const key = lyricsKey(artist, title);
  const saved = await storage.get(key).catch(() => undefined) as Saved | undefined;
  if (saved?.record) return saved.record;
  if (saved && Date.now() - saved.checked < DAY) return undefined;
  const clean = { artist: cleanArtist(artist), title: cleanTitle(title), album: track.album, length: track.length };
  let record: LrcRecord | undefined;
  if (clean.artist) {
    record = await get<LrcRecord>(getUrl(clean), signal);
    if (!record && clean.album) record = await get<LrcRecord>(getUrl({ ...clean, album: undefined }), signal);
  }
  if (!record) {
    const found = await search(
      clean.artist ? { title: clean.title, artist: clean.artist } : { q: clean.title },
      signal,
    );
    record = bestMatch(found, clean);
    if (!record && clean.artist) {
      record = bestMatch(await search({ q: `${clean.artist} ${clean.title}` }, signal), clean);
    }
  }
  await storage.set(key, { record, checked: Date.now() } as unknown as Json).catch(() => {});
  return record;
}

/** "Use for This Track" from a manual search. */
export async function pin(track: Pick<Track, "artist" | "title">, record: LrcRecord): Promise<void> {
  const { artist, title } = splitVideoTitle(track);
  await storage.set(lyricsKey(artist, title), { record, checked: Date.now() } as unknown as Json);
}

/** Forgets the saved lyrics, to look them up again. */
export async function forget(track: Pick<Track, "artist" | "title">): Promise<void> {
  const { artist, title } = splitVideoTitle(track);
  await storage.delete(lyricsKey(artist, title));
}
