// The TMDB API (v3 endpoints, with a v4 read access token or a v3 key), and the watchlist.

import { Icons, type Item, open, storage } from "@backslash/api";
import { auth, fromDetails, fromResult, type Kind, type Title, type TmdbDetails, type TmdbResult } from "./lib.ts";

const API = "https://api.themoviedb.org/3";
export const TOKEN_URL = "https://www.themoviedb.org/settings/api";

type Json = Parameters<typeof storage.set>[1];

export class AuthError extends Error {}

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

export interface Account {
  token: string;
  region: string;
  language: string;
}

export function token(preferences: Record<string, unknown>): string {
  const t = String(preferences.token ?? "").trim();
  if (!t) throw new AuthError("Add your TMDB API Read Access Token");
  return t;
}

async function tmdb<T>(a: Account, path: string, signal?: AbortSignal): Promise<T> {
  const { headers, param } = auth(a.token);
  const sep = path.includes("?") ? "&" : "?";
  let res: Response;
  try {
    res = await fetch(`${API}${path}${param ? `${sep}${param}` : ""}`, {
      signal,
      headers: { ...headers, Accept: "application/json" },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`TMDB is unreachable: ${(e as Error).message}`);
  }
  if (res.status === 401) {
    await res.body?.cancel();
    throw new AuthError("TMDB rejected the token");
  }
  if (res.status === 429) {
    await res.body?.cancel();
    throw new Error("TMDB is rate limiting, try again in a few seconds");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => undefined) as { status_message?: string } | undefined;
    throw new Error(`TMDB answered ${res.status}${body?.status_message ? `: ${body.status_message}` : ""}`);
  }
  return await res.json() as T;
}

const page = (r: { results?: TmdbResult[] }, kind?: Kind) =>
  (r.results ?? []).filter((x) => !x.adult).map((x) => fromResult(x, kind)).filter((t): t is Title => !!t);

export async function trending(a: Account, kind: "all" | Kind, signal?: AbortSignal): Promise<Title[]> {
  const r = await tmdb<{ results?: TmdbResult[] }>(a, `/trending/${kind}/week?language=${a.language}`, signal);
  return page(r, kind === "all" ? undefined : kind);
}

export async function search(a: Account, query: string, kind: "all" | Kind, signal?: AbortSignal): Promise<Title[]> {
  const q = encodeURIComponent(query.trim());
  const path = kind === "all" ? "multi" : kind;
  const r = await tmdb<{ results?: TmdbResult[] }>(
    a,
    `/search/${path}?query=${q}&include_adult=false&language=${a.language}&page=1`,
    signal,
  );
  return page(r, kind === "all" ? undefined : kind);
}

const memory = new Map<string, Title>();
const DAY = 86400_000;

/** Runtime, cast, trailer and providers; kept a day. */
export async function details(a: Account, t: Pick<Title, "kind" | "id">, signal?: AbortSignal): Promise<Title> {
  const key = `details:${t.kind}:${t.id}:${a.language}:${a.region}`;
  const hit = memory.get(key) ??
    await load<{ at: number; title: Title }>(key).then((c) => c && Date.now() - c.at < DAY ? c.title : undefined);
  if (hit) {
    memory.set(key, hit);
    return hit;
  }
  const append = t.kind === "movie"
    ? "credits,videos,watch/providers,release_dates"
    : "aggregate_credits,videos,watch/providers,content_ratings,external_ids";
  const lang = a.language.slice(0, 2);
  const d = await tmdb<TmdbDetails>(
    a,
    `/${t.kind}/${t.id}?language=${a.language}&append_to_response=${append}&include_video_language=${lang},en,null`,
    signal,
  );
  const title = fromDetails(d, t.kind, a.region);
  memory.set(key, title);
  await save(key, { at: Date.now(), title });
  return title;
}

/** Details for each title, in parallel; a title whose details fail is kept as it was. */
export function withDetails(a: Account, titles: Title[], signal: AbortSignal, count = 12): Promise<Title[]> {
  return Promise.all(titles.map((t, i) =>
    i < count
      ? details(a, t, signal).catch((e) => {
        if ((e as Error).name === "AbortError" || e instanceof AuthError) throw e;
        return t;
      })
      : Promise.resolve(t)
  ));
}

// ---------------------------------------------------------------------------
// Watchlist

export interface Saved {
  title: Title;
  added: number;
}

export const watchlist = async () => await load<Saved[]>("watchlist") ?? [];
export const watchKey = (t: Pick<Title, "kind" | "id">) => `${t.kind}:${t.id}`;

export async function toggleWatch(t: Title): Promise<boolean> {
  const list = await watchlist();
  const there = list.some((s) => watchKey(s.title) === watchKey(t));
  // Kept small: the list view shows what was saved, details are reloaded.
  const slim: Title = { ...t, cast: undefined, watch: undefined };
  await save(
    "watchlist",
    there ? list.filter((s) => watchKey(s.title) !== watchKey(t)) : [{ title: slim, added: Date.now() }, ...list],
  );
  return !there;
}

// ---------------------------------------------------------------------------
// Setup

export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Free with a TMDB account",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect TMDB",
        "",
        "Movies and shows come from **The Movie Database**, free for personal use:",
        "",
        "1. Sign in or create an account on themoviedb.org.",
        "2. Open **Settings → API** (Enter opens it) and request an API key for personal use.",
        "3. Copy the **API Read Access Token** (the long one; the shorter API key works too).",
        "4. Paste it in **Settings → Extensions → Movies & TV → Configure**, and set your region",
        "   (`US`, `GB`, `FR`…) for streaming services.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Get a TMDB Token", { icon: Icons.key })],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e);
    throw e;
  }
}
