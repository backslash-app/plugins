// The YouTube Data API v3 with the user's API key. Searches cost 100 of the
// 10,000 daily quota units, so answers are cached.

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  apiError,
  type ApiVideo,
  fromApi,
  type PlaylistItem,
  searchIds,
  type SearchResult,
  uploadsPlaylist,
  type Video,
} from "./lib.ts";

const API = "https://www.googleapis.com/youtube/v3";
export const KEY_URL = "https://console.cloud.google.com/apis/library/youtube.googleapis.com";
export const CREDENTIALS_URL = "https://console.cloud.google.com/apis/credentials";

type Json = Parameters<typeof storage.set>[1];

export class AuthError extends Error {}
export class QuotaError extends Error {}

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

export interface Account {
  key: string;
  region: string;
}

export function apiKey(preferences: Record<string, unknown>): string {
  const key = String(preferences.apiKey ?? "").trim();
  if (!key) throw new AuthError("Add your YouTube Data API key");
  return key;
}

async function yt<T>(a: Account, path: string, params: Record<string, string>, signal?: AbortSignal): Promise<T> {
  const q = new URLSearchParams({ ...params, key: a.key });
  let res: Response;
  try {
    res = await fetch(`${API}/${path}?${q}`, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`YouTube is unreachable: ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const { message, auth, quota } = apiError(res.status, body);
    throw auth ? new AuthError(message) : quota ? new QuotaError(message) : new Error(message);
  }
  return body as T;
}

const memory = new Map<string, { at: number; data: unknown }>();

/** An answer kept `ttl` seconds in memory and storage (quota is precious). */
async function cached<T>(id: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const hit = (memory.get(id) as { at: number; data: T } | undefined) ?? await load<{ at: number; data: T }>(id);
  if (hit && Date.now() - hit.at < ttl * 1000) return hit.data;
  const data = await fetcher();
  const entry = { at: Date.now(), data };
  memory.set(id, entry);
  await save(id, entry);
  return data;
}

/** Full details (duration, views…) of videos, in the given order. 1 quota unit. */
export async function videos(a: Account, ids: string[], signal?: AbortSignal): Promise<Video[]> {
  if (!ids.length) return [];
  const r = await yt<{ items?: ApiVideo[] }>(a, "videos", {
    part: "snippet,contentDetails,statistics",
    id: ids.slice(0, 50).join(","),
    maxResults: "50",
  }, signal);
  const byId = new Map((r.items ?? []).map((v) => [v.id, fromApi(v)]));
  return ids.map((id) => byId.get(id)).filter((v): v is Video => !!v);
}

export function search(a: Account, query: string, signal?: AbortSignal): Promise<Video[]> {
  const q = query.trim();
  return cached(`search:${a.region}:${q.toLowerCase()}`, 3600, async () => {
    const r = await yt<{ items?: SearchResult[] }>(a, "search", {
      part: "snippet",
      type: "video",
      maxResults: "25",
      q,
      regionCode: a.region,
      safeSearch: "moderate",
    }, signal);
    return videos(a, searchIds(r.items ?? []), signal);
  });
}

export function trending(a: Account, signal?: AbortSignal): Promise<Video[]> {
  return cached(`trending:${a.region}`, 1800, async () => {
    const r = await yt<{ items?: ApiVideo[] }>(a, "videos", {
      part: "snippet,contentDetails,statistics",
      chart: "mostPopular",
      regionCode: a.region,
      maxResults: "25",
    }, signal);
    return (r.items ?? []).map(fromApi);
  });
}

/** A channel's latest uploads. 2 quota units. */
export function channelVideos(a: Account, channelId: string, signal?: AbortSignal): Promise<Video[]> {
  return cached(`channel:${channelId}`, 1800, async () => {
    const r = await yt<{ items?: PlaylistItem[] }>(a, "playlistItems", {
      part: "contentDetails",
      playlistId: uploadsPlaylist(channelId),
      maxResults: "30",
    }, signal);
    const ids = (r.items ?? []).map((i) => i.contentDetails?.videoId).filter((id): id is string => !!id);
    return videos(a, ids, signal);
  });
}

// ---------------------------------------------------------------------------
// Setup

export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Free: a Google Cloud API key with the YouTube Data API v3",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect YouTube",
        "",
        "Searching YouTube reliably needs Google's **YouTube Data API v3** and your own free API key.",
        "Keyless front ends (Invidious, Piped) break or get blocked too often to depend on.",
        "",
        "1. In the Google Cloud console, create a project (any name).",
        "2. Open **YouTube Data API v3** (Enter opens it) and click **Enable**.",
        "3. In **APIs & Services → Credentials**, click **Create credentials → API key**.",
        "   Restricting the key to the YouTube Data API v3 is a good idea.",
        "4. Paste it in **Settings → Extensions → YouTube → Configure**.",
        "",
        "The free quota is 10,000 units a day: a search costs 100, trending and channels 1 or 2.",
        "Results are cached for an hour to make it last.",
      ].join("\n"),
    },
    actions: [
      open(KEY_URL, "Enable the YouTube Data API", { icon: Icons.key }),
      open(CREDENTIALS_URL, "Create an API Key", { icon: Icons.key }),
    ],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e);
    if (e instanceof QuotaError) {
      return [{
        id: "quota",
        title: e.message,
        subtitle: "It resets at midnight Pacific time",
        icon: { source: Icons.hourglass, tint: "orange" },
        detail: {
          markdown: [
            "## Out of quota for today",
            "",
            "Each API key gets 10,000 units a day; a search costs 100 of them. Searches made today",
            "are still cached for an hour. The quota resets at midnight Pacific time, or you can ask",
            "Google for more in the Cloud console (Enter opens it).",
          ].join("\n"),
        },
        actions: [open("https://console.cloud.google.com/apis/api/youtube.googleapis.com/quotas", "Open Quotas")],
      }];
    }
    throw e;
  }
}
