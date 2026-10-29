// Subsonic servers (Navidrome, Gonic, Airsonic…) with token authentication,
// Audiobookshelf with an API token, and their covers cached on disk.

import {
  type AbsItem,
  type AbsLibrary,
  absSearchResult,
  type Album,
  albumList,
  type Artist,
  artistAlbums,
  authParams,
  cacheName,
  isAllowedHost,
  normalizeUrl,
  type Playlist,
  playlists,
  progressBody,
  randomSalt,
  randomSongs,
  restUrl,
  searchResult,
  type Song,
  starredResult,
  toAbsItem,
  toAlbum,
  toPlaylist,
  toProgress,
  unwrap,
} from "./lib.ts";

export type Kind = "subsonic" | "abs";

export class SetupError extends Error {
  constructor(
    message: string,
    readonly server: Kind,
    readonly kind: "missing" | "auth" | "url" | "host",
    readonly base?: string,
  ) {
    super(message);
  }
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));
const PRODUCT: Record<Kind, string> = { subsonic: "the music server", abs: "Audiobookshelf" };

function checkBase(kind: Kind, input: unknown): string {
  const base = normalizeUrl(input, kind);
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${input}” is not a server address`, kind, "url");
  }
  if (!isAllowedHost(host)) {
    throw new SetupError(`${host} is outside the networks this extension may reach`, kind, "host", base);
  }
  return base;
}

async function request(kind: Kind, url: string, init: RequestInit & { signal?: AbortSignal } = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(15_000);
  try {
    return await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(url).hostname} is outside the networks this extension may reach`, kind, "host");
    }
    if (timeout.aborted) throw new Error(`${PRODUCT[kind]} is taking too long to answer`);
    throw new Error(`Can't reach ${PRODUCT[kind]} at ${new URL(url).origin}: ${describe(e)}`);
  }
}

// ---------------------------------------------------------------------------
// Subsonic

export class Subsonic {
  readonly base: string;

  constructor(url: unknown, private readonly user: string, private readonly password: string) {
    this.base = checkBase("subsonic", url);
  }

  static from(p: Record<string, unknown>): Subsonic | undefined {
    const url = String(p.subsonicUrl ?? "").trim();
    if (!url) return undefined;
    const user = String(p.subsonicUser ?? "").trim();
    const password = String(p.subsonicPassword ?? "");
    if (!user || !password) {
      throw new SetupError("Add your user name and password for the music server", "subsonic", "missing");
    }
    return new Subsonic(url, user, password);
  }

  /** An address carrying a fresh token (for the player and covers). */
  url(method: string, params: Record<string, string | number> = {}): string {
    return restUrl(this.base, method, authParams(this.user, this.password, randomSalt()), params);
  }

  async call<T = any>(method: string, params: Record<string, string | number> = {}, signal?: AbortSignal): Promise<T> {
    const res = await request("subsonic", this.url(method, params), {
      signal,
      headers: { Accept: "application/json" },
    });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new SetupError("The music server refused the user name or password", "subsonic", "auth", this.base);
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new Error(`The music server answered ${res.status}`);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new SetupError(
        `${this.base} doesn't look like a Subsonic server (Navidrome, Gonic…)`,
        "subsonic",
        "url",
        this.base,
      );
    }
    try {
      return unwrap<T>(json);
    } catch (e) {
      if ((e as { code?: number }).code === 40 || (e as { code?: number }).code === 41) {
        throw new SetupError((e as Error).message, "subsonic", "auth", this.base);
      }
      throw e;
    }
  }

  async albums(
    type: "newest" | "recent" | "random" | "frequent" | "starred",
    size = 30,
    signal?: AbortSignal,
  ): Promise<Album[]> {
    return albumList(await this.call("getAlbumList2", { type, size }, signal));
  }

  async album(id: string, signal?: AbortSignal): Promise<Album> {
    return toAlbum((await this.call("getAlbum", { id }, signal)).album);
  }

  async artistAlbums(id: string, signal?: AbortSignal): Promise<Album[]> {
    return artistAlbums(await this.call("getArtist", { id }, signal));
  }

  async search(query: string, signal?: AbortSignal): Promise<{ artists: Artist[]; albums: Album[]; songs: Song[] }> {
    return searchResult(
      await this.call("search3", { query, artistCount: 6, albumCount: 20, songCount: 30 }, signal),
    );
  }

  async starred(signal?: AbortSignal) {
    return starredResult(await this.call("getStarred2", {}, signal));
  }

  async playlists(signal?: AbortSignal): Promise<Playlist[]> {
    return playlists(await this.call("getPlaylists", {}, signal));
  }

  async playlist(id: string, signal?: AbortSignal): Promise<Playlist> {
    return toPlaylist((await this.call("getPlaylist", { id }, signal)).playlist);
  }

  async random(size = 50, signal?: AbortSignal): Promise<Song[]> {
    return randomSongs(await this.call("getRandomSongs", { size }, signal));
  }

  async star(id: string, on: boolean, kind: "song" | "album" | "artist"): Promise<void> {
    const key = kind === "album" ? "albumId" : kind === "artist" ? "artistId" : "id";
    await this.call(on ? "star" : "unstar", { [key]: id });
  }

  /** Tells the server what is playing ("now playing", not a play count). */
  async nowPlaying(id: string): Promise<void> {
    await this.call("scrobble", { id, submission: "false" }).catch(() => {});
  }

  streamUrl(id: string): string {
    return this.url("stream", { id });
  }

  coverUrl(coverArt: string, size = 300): string {
    return this.url("getCoverArt", { id: coverArt, size });
  }

  /** The web app's page for an album (Navidrome's address scheme). */
  webUrl(album?: Album): string {
    return album ? `${this.base}/app/#/album/${encodeURIComponent(album.id)}/show` : `${this.base}/app/`;
  }
}

// ---------------------------------------------------------------------------
// Audiobookshelf

export class Abs {
  readonly base: string;

  constructor(url: unknown, private readonly token: string) {
    this.base = checkBase("abs", url);
  }

  static from(p: Record<string, unknown>): Abs | undefined {
    const url = String(p.absUrl ?? "").trim();
    if (!url) return undefined;
    const token = String(p.absToken ?? "").trim();
    if (!token) throw new SetupError("Add an Audiobookshelf API token", "abs", "missing");
    return new Abs(url, token);
  }

  get headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.token}`, Accept: "application/json" };
  }

  async call<T = any>(path: string, o: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
    const res = await request("abs", `${this.base}${path}`, {
      method: o.method ?? "GET",
      signal: o.signal,
      headers: { ...this.headers, ...(o.body ? { "Content-Type": "application/json" } : {}) },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new SetupError("Audiobookshelf refused the API token", "abs", "auth", this.base);
    }
    if (!res.ok) {
      await res.body?.cancel();
      if (res.status === 404) throw new Error("Not found on Audiobookshelf");
      throw new Error(`Audiobookshelf answered ${res.status}`);
    }
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      if (/^\s*</.test(text)) {
        throw new SetupError(`${this.base} doesn't look like Audiobookshelf's address`, "abs", "url", this.base);
      }
      return text as T;
    }
  }

  async libraries(signal?: AbortSignal): Promise<AbsLibrary[]> {
    const j = await this.call<{ libraries?: any[] }>("/api/libraries", { signal });
    return (j?.libraries ?? []).map((l) => ({
      id: String(l.id),
      name: String(l.name ?? "Library"),
      mediaType: l.mediaType === "podcast" ? "podcast" : "book",
    }));
  }

  async inProgress(signal?: AbortSignal): Promise<AbsItem[]> {
    const [j, me] = await Promise.all([
      this.call<{ libraryItems?: any[] }>("/api/me/items-in-progress?limit=25", { signal }),
      this.call<{ mediaProgress?: any[] }>("/api/me", { signal }).catch(() => undefined),
    ]);
    const progress = (me?.mediaProgress ?? []).map(toProgress);
    const raw = me?.mediaProgress ?? [];
    return (j?.libraryItems ?? []).map((r) => {
      const item = toAbsItem(r);
      const at = raw.findIndex((p) =>
        p.libraryItemId === item.id && (item.recentEpisode ? p.episodeId === item.recentEpisode.id : !p.episodeId)
      );
      return { ...item, progress: at >= 0 ? progress[at] : item.progress };
    });
  }

  async recent(library: AbsLibrary, signal?: AbortSignal, limit = 25): Promise<AbsItem[]> {
    const j = await this.call<{ results?: any[] }>(
      `/api/libraries/${library.id}/items?sort=addedAt&desc=1&limit=${limit}&minified=1`,
      { signal },
    );
    return (j?.results ?? []).map(toAbsItem);
  }

  async search(library: AbsLibrary, q: string, signal?: AbortSignal): Promise<AbsItem[]> {
    const j = await this.call(`/api/libraries/${library.id}/search?q=${encodeURIComponent(q)}&limit=12`, { signal });
    return absSearchResult(j);
  }

  /** The item with its tracks, chapters, episodes and the user's progress. */
  async item(id: string, signal?: AbortSignal): Promise<AbsItem> {
    return toAbsItem(await this.call(`/api/items/${id}?expanded=1&include=progress`, { signal }));
  }

  async saveProgress(itemId: string, episodeId: string | undefined, time: number, duration: number, finished = false) {
    await this.call(`/api/me/progress/${itemId}${episodeId ? `/${episodeId}` : ""}`, {
      method: "PATCH",
      body: progressBody(time, duration, finished),
    });
  }

  async markFinished(item: AbsItem, episodeId: string | undefined, finished: boolean): Promise<void> {
    await this.call(`/api/me/progress/${item.id}${episodeId ? `/${episodeId}` : ""}`, {
      method: "PATCH",
      body: finished ? { isFinished: true } : { isFinished: false, currentTime: 0, progress: 0 },
    });
  }

  /** A file the player opens: the token goes in the address, as the web app does for audio. */
  fileUrl(contentUrl: string): string {
    return `${this.base}${contentUrl}${contentUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.token)}`;
  }

  coverRequest(itemId: string): { url: string; headers: Record<string, string> } {
    return { url: `${this.base}/api/items/${itemId}/cover?width=400&format=jpeg`, headers: this.headers };
  }

  webUrl(item?: AbsItem): string {
    return item ? `${this.base}/item/${item.id}` : this.base;
  }
}

// ---------------------------------------------------------------------------
// Covers

const home = () => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
};
export const cacheDir = () => `${home()}/.cache/backslash/navidrome/covers`;

async function exists(path: string) {
  try {
    return (await Deno.stat(path)).size > 0;
  } catch {
    return false;
  }
}

export interface CoverRequest {
  /** Stable across tokens: what the picture is. */
  key: string;
  url: string;
  headers?: Record<string, string>;
}

/**
 * Covers as local files (the launcher shows only pictures from exact hosts,
 * and these need credentials): those already cached at once, the others
 * downloaded until `deadline` ms, a few at a time.
 */
export async function covers(
  requests: CoverRequest[],
  o: { deadline?: number; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!home()) return out;
  await Deno.mkdir(cacheDir(), { recursive: true }).catch(() => {});
  const missing: (CoverRequest & { path: string })[] = [];
  const seen = new Set<string>();
  for (const r of requests) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    const path = `${cacheDir()}/${cacheName(r.key)}`;
    if (await exists(path)) out.set(r.key, path);
    else missing.push({ ...r, path });
  }
  const until = Date.now() + (o.deadline ?? 2500);
  const worker = async () => {
    while (missing.length && Date.now() < until && !o.signal?.aborted) {
      const m = missing.shift()!;
      try {
        const res = await fetch(m.url, {
          headers: m.headers,
          signal: AbortSignal.timeout(Math.max(500, until - Date.now())),
        });
        if (!res.ok || !(res.headers.get("content-type") ?? "image/").startsWith("image/")) {
          await res.body?.cancel();
          continue;
        }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length < 100 || bytes.length > 5_000_000) continue;
        await Deno.writeFile(`${m.path}.tmp`, bytes);
        await Deno.rename(`${m.path}.tmp`, m.path);
        out.set(m.key, m.path);
      } catch {
        // Shown without a cover this time.
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

/** The cover of a Subsonic album or song. */
export const subsonicCover = (s: Subsonic, coverArt: string | undefined): CoverRequest | undefined =>
  coverArt ? { key: `${s.base}#${coverArt}`, url: s.coverUrl(coverArt) } : undefined;

/** The cover of an Audiobookshelf item. */
export const absCover = (a: Abs, item: Pick<AbsItem, "id" | "hasCover">): CoverRequest | undefined =>
  item.hasCover ? { key: `${a.base}#${item.id}`, ...a.coverRequest(item.id) } : undefined;
