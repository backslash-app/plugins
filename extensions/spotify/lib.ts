// Spotify Web API: the OAuth provider, response types and their formatting.
// Pure, tested in lib_test.ts.

import { type Color, Icons, type OAuthProvider } from "@backslash/api";

export const API = "https://api.spotify.com/v1";

export const SCOPES = [
  "user-read-playback-state",
  "user-modify-playback-state",
  "user-read-currently-playing",
  "user-read-recently-played",
  "playlist-read-private",
  "playlist-read-collaborative",
  "user-library-read",
  "user-library-modify",
];

/** The redirect port suggested in the settings: register http://127.0.0.1:43117/callback. */
export const DEFAULT_PORT = 43117;

/**
 * Backslash has no Spotify app of its own: users create one on
 * developer.spotify.com and paste its Client ID. PKCE needs no secret.
 */
export function provider(prefs: Record<string, unknown>): OAuthProvider {
  const clientId = String(prefs.clientId ?? "").trim();
  if (!clientId) {
    throw new Error("Paste the Client ID of your Spotify app in Settings → Extensions → Spotify");
  }
  if (!/^[0-9a-f]{32}$/i.test(clientId)) {
    throw new Error("This doesn't look like a Spotify Client ID (32 hexadecimal characters)");
  }
  const raw = prefs.redirectPort;
  const port = raw === undefined || raw === null || raw === "" ? DEFAULT_PORT : Number(raw);
  return {
    id: "spotify",
    title: "Spotify",
    authorizeUrl: "https://accounts.spotify.com/authorize",
    tokenUrl: "https://accounts.spotify.com/api/token",
    clientId,
    scopes: SCOPES,
    // 0 = any port: register http://127.0.0.1/callback (Spotify accepts any port for loopback IPs).
    ...(port > 0 && port < 65536 ? { redirectPort: Math.round(port) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Types (only the fields used)

export interface Image {
  url: string;
  width?: number | null;
  height?: number | null;
}

export interface ArtistRef {
  id: string;
  name: string;
  uri: string;
}

export interface Album {
  id: string;
  uri: string;
  name: string;
  album_type?: string;
  artists: ArtistRef[];
  images?: Image[];
  release_date?: string;
  total_tracks?: number;
  external_urls?: { spotify?: string };
}

export interface Track {
  id: string;
  uri: string;
  name: string;
  type?: "track";
  artists: ArtistRef[];
  album?: Album;
  duration_ms: number;
  explicit?: boolean;
  popularity?: number;
  track_number?: number;
  is_local?: boolean;
  external_urls?: { spotify?: string };
}

export interface Episode {
  id: string;
  uri: string;
  name: string;
  type: "episode";
  duration_ms: number;
  images?: Image[];
  show?: { name: string; publisher?: string };
  release_date?: string;
  external_urls?: { spotify?: string };
}

export interface Artist {
  id: string;
  uri: string;
  name: string;
  images?: Image[];
  genres?: string[];
  followers?: { total: number };
  popularity?: number;
  external_urls?: { spotify?: string };
}

export interface Playlist {
  id: string;
  uri: string;
  name: string;
  description?: string | null;
  images?: Image[] | null;
  owner?: { id?: string; display_name?: string | null };
  tracks?: { total: number } | null;
  items?: { total: number } | null;
  public?: boolean | null;
  collaborative?: boolean;
  external_urls?: { spotify?: string };
}

export interface Device {
  id: string | null;
  name: string;
  type: string;
  is_active: boolean;
  is_restricted?: boolean;
  volume_percent?: number | null;
}

export interface PlaybackState {
  device?: Device;
  is_playing: boolean;
  progress_ms?: number | null;
  shuffle_state?: boolean;
  repeat_state?: "off" | "track" | "context";
  context?: { type: string; uri: string } | null;
  item?: Track | Episode | null;
  currently_playing_type?: string;
}

export interface Paging<T> {
  items: (T | null)[];
  total?: number;
  next?: string | null;
}

export interface SearchResponse {
  tracks?: Paging<Track>;
  albums?: Paging<Album>;
  artists?: Paging<Artist>;
  playlists?: Paging<Playlist>;
}

export type Kind = "track" | "album" | "artist" | "playlist";

export const KINDS: { value: string; title: string }[] = [
  { value: "all", title: "All" },
  { value: "track", title: "Tracks" },
  { value: "album", title: "Albums" },
  { value: "artist", title: "Artists" },
  { value: "playlist", title: "Playlists" },
];

export function searchUrl(query: string, filter: string | undefined, limit: number): string {
  const types = filter && filter !== "all" ? [filter] : ["track", "album", "artist", "playlist"];
  return `${API}/search?${new URLSearchParams({ q: query, type: types.join(","), limit: String(limit) })}`;
}

/** Spotify sometimes returns `null` entries (removed playlists). */
export const present = <T>(p: Paging<T> | undefined): T[] => (p?.items ?? []).filter((x): x is T => !!x);

// ---------------------------------------------------------------------------
// Formatting

/** The smallest picture at least `min` wide (icons), or the biggest (covers). */
export function pickImage(images: Image[] | null | undefined, size: "small" | "large"): string | undefined {
  const list = (images ?? []).filter((i) => i?.url);
  if (!list.length) return undefined;
  const sorted = [...list].sort((a, b) => (a.width ?? 0) - (b.width ?? 0));
  if (size === "large") return sorted[sorted.length - 1].url;
  return (sorted.find((i) => (i.width ?? 0) >= 64) ?? sorted[0]).url;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

export function totalDuration(ms: number): string {
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

export const artists = (list: ArtistRef[] | undefined) => (list ?? []).map((a) => a.name).join(", ");

export function year(date: string | undefined): string | undefined {
  return date ? date.slice(0, 4) : undefined;
}

/** 1234567 → "1.2M". */
export function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Playlists' descriptions come as HTML. */
export function plainDescription(html: string | null | undefined): string {
  return (html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

export const trackCount = (p: Playlist) => p.tracks?.total ?? p.items?.total ?? 0;

export const webUrl = (kind: string, id: string) => `https://open.spotify.com/${kind}/${id}`;

/** What a device looks like. No phone glyph: phones use the speaker one too. */
export function deviceIcon(type: string): string {
  switch (type.toLowerCase()) {
    case "computer":
    case "tv":
    case "tablet":
    case "game_console":
    case "stb":
      return Icons.monitor;
    case "smartphone":
    case "speaker":
    case "castaudio":
    case "castvideo":
    case "avr":
    case "audiodongle":
    case "automobile":
      return Icons.speaker;
    default:
      return Icons.headphones;
  }
}

export function popularityColor(p: number): Color {
  return p >= 70 ? "green" : p >= 40 ? "yellow" : "gray";
}

// ---------------------------------------------------------------------------
// Errors

/** A readable message for a failed Web API call. */
export function errorMessage(status: number, body: unknown, retryAfter?: string | null): string {
  const err = (body as { error?: { message?: string; reason?: string } | string })?.error;
  const message = typeof err === "string" ? err : err?.message ?? "";
  const reason = typeof err === "object" ? err?.reason ?? "" : "";
  if (status === 401) return "Spotify signed you out: open the command again to sign in";
  if (status === 403) {
    if (/premium/i.test(message) || reason === "PREMIUM_REQUIRED") return "Controlling playback needs Spotify Premium";
    if (/not be registered|not registered|user management/i.test(message)) {
      return "Your Spotify account isn't allowed to use this app yet: add it under User Management in your app on developer.spotify.com";
    }
    if (reason === "UNKNOWN" || /restriction/i.test(message)) {
      return "Spotify refused: the player doesn't allow this right now";
    }
    return `Spotify refused: ${message || "forbidden"}`;
  }
  if (status === 404 && (reason === "NO_ACTIVE_DEVICE" || /active device/i.test(message))) {
    return "No active device: start playing on Spotify somewhere, or pick a device in Play On";
  }
  if (status === 429) return `Spotify asks to slow down${retryAfter ? `: try again in ${retryAfter} s` : ""}`;
  return `Spotify answered ${status}${message ? `: ${message}` : ""}`;
}

/** The request body of "play": a context (album, playlist, artist), optionally from a track, or tracks. */
export function playBody(target: { context?: string; uris?: string[]; offset?: string }): Record<string, unknown> {
  if (target.context) {
    return { context_uri: target.context, ...(target.offset ? { offset: { uri: target.offset } } : {}) };
  }
  return { uris: target.uris ?? [] };
}
