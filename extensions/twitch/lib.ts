// Twitch Helix answers, the sign-in, playback command lines and formatting.
// Pure, tested in lib_test.ts.

import type { OAuthProvider } from "@backslash/api";

export const API = "https://api.twitch.tv/helix";
export const CONSOLE_URL = "https://dev.twitch.tv/console/apps";
export const DEFAULT_PORT = 43120;
export const SCOPES = ["user:read:follows"];

/** Not connected, or Twitch refused the token: the list shows how to connect. */
export class AuthError extends Error {
  constructor(message: string, readonly kind: "setup" | "expired" = "setup") {
    super(message);
  }
}

export interface Auth {
  clientId: string;
  /** A pasted user access token, used instead of signing in. */
  token?: string;
  provider?: OAuthProvider;
}

/**
 * The user's own Twitch app (Twitch has no public client for desktop apps
 * without a secret): Client ID always, then either a pasted user access token
 * or the Client Secret to sign in through the browser.
 */
export function authFrom(prefs: Record<string, unknown>): Auth {
  const clientId = String(prefs.clientId ?? "").trim();
  if (!clientId) throw new AuthError("Connect your Twitch account");
  const token = String(prefs.accessToken ?? "").trim().replace(/^(oauth:|bearer\s+)/i, "");
  if (token) return { clientId, token };
  const clientSecret = String(prefs.clientSecret ?? "").trim();
  if (!clientSecret) throw new AuthError("Add the Client Secret of your Twitch app, or a user access token");
  const raw = prefs.redirectPort;
  const port = raw === undefined || raw === null || raw === "" ? DEFAULT_PORT : Number(raw);
  return {
    clientId,
    provider: {
      id: "twitch",
      title: "Twitch",
      authorizeUrl: "https://id.twitch.tv/oauth2/authorize",
      tokenUrl: "https://id.twitch.tv/oauth2/token",
      clientId,
      clientSecret,
      scopes: SCOPES,
      redirectPort: port > 0 && port < 65536 ? Math.round(port) : DEFAULT_PORT,
    },
  };
}

export function twitchError(status: number, text: string): Error {
  let message = "";
  try {
    const body = JSON.parse(text);
    message = body.message ?? body.error ?? "";
  } catch {
    message = text.slice(0, 160);
  }
  if (status === 401) {
    if (/client id/i.test(message)) return new AuthError("The access token belongs to another Client ID");
    return new AuthError("Twitch signed you out: the token expired or was revoked", "expired");
  }
  if (status === 429) return new Error("Twitch is rate limiting: try again in a minute");
  return new Error(`Twitch answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Types (only the fields used)

export interface User {
  id: string;
  login: string;
  display_name: string;
  profile_image_url?: string;
}

export interface Stream {
  id: string;
  user_id: string;
  user_login: string;
  user_name: string;
  game_id: string;
  game_name: string;
  type: string;
  title: string;
  viewer_count: number;
  started_at: string;
  language: string;
  thumbnail_url: string;
  tags?: string[] | null;
  is_mature?: boolean;
}

export interface Channel {
  id: string;
  broadcaster_login: string;
  display_name: string;
  game_id?: string;
  game_name: string;
  is_live: boolean;
  thumbnail_url: string;
  title: string;
  started_at: string;
  broadcaster_language?: string;
  tags?: string[] | null;
}

export interface Category {
  id: string;
  name: string;
  box_art_url: string;
}

export interface Page<T> {
  data: T[];
  pagination?: { cursor?: string };
}

// ---------------------------------------------------------------------------
// Pictures

/**
 * A stream preview at a size, with a 5-minute cache key: the launcher caches
 * pictures by address, and previews change while the stream goes on.
 */
export function previewUrl(template: string, now = Date.now(), width = 640, height = 360): string {
  const url = template.replace("{width}", String(width)).replace("{height}", String(height));
  return `${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(now / 300_000)}`;
}

/** Box art: `…/33214-{width}x{height}.jpg` or the fixed `-52x72` of search results → 285×380. */
export function boxArtUrl(url: string, width = 285, height = 380): string {
  return url.replace("{width}", String(width)).replace("{height}", String(height)).replace(
    /-\d+x\d+(\.\w+)$/,
    `-${width}x${height}$1`,
  );
}

// ---------------------------------------------------------------------------
// Addresses

export const channelUrl = (login: string) => `https://www.twitch.tv/${encodeURIComponent(login)}`;
export const chatUrl = (login: string) => `https://www.twitch.tv/popout/${encodeURIComponent(login)}/chat?popout=`;
export const categoryUrl = (name: string) => `https://www.twitch.tv/directory/category/${slug(name)}`;

/** Twitch's directory slugs: "Grand Theft Auto V" → "grand-theft-auto-v". */
export function slug(name: string): string {
  return name.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/['’:.]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

// ---------------------------------------------------------------------------
// Playback

export type Tool = "streamlink" | "mpv";

/** streamlink with its own player (mpv by default), or mpv itself (through yt-dlp). */
export function playArgs(
  tool: Tool,
  login: string,
  o: { audioOnly?: boolean; quality?: string; player?: string } = {},
): string[] {
  const url = `twitch.tv/${login}`;
  if (tool === "streamlink") {
    return [
      "streamlink",
      ...(o.player ? [`--player=${o.player}`] : []),
      "--twitch-disable-ads",
      "--title",
      "{author} – {title}",
      `https://${url}`,
      o.audioOnly ? "audio_only,worst" : `${o.quality || "best"},best`,
    ];
  }
  return [
    "mpv",
    "--no-terminal",
    ...(o.audioOnly ? ["--no-video", "--ytdl-format=audio_only/bestaudio/worst"] : [
      "--force-window=immediate",
      `--ytdl-format=${
        o.quality && o.quality !== "best" ? `best[height<=?${parseInt(o.quality) || 1080}]/best` : "best"
      }`,
    ]),
    `--title=${login}`,
    `https://www.${url}`,
  ];
}

/** `systemd-run` arguments for a background unit, with the display variables a player needs. */
export function unitArgs(unit: string, description: string, env: Record<string, string | undefined>, argv: string[]) {
  return [
    "--user",
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    `--description=${description}`,
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    ...argv,
  ];
}

// ---------------------------------------------------------------------------
// Formatting

/** "2 h 05", "45 min", "just started". */
export function uptime(startedAt: string, now = Date.now()): string {
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return "";
  const min = Math.floor((now - start) / 60_000);
  if (min < 1) return "just started";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

export const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export const viewers = (n: number) => `${compact(n)} viewer${n === 1 ? "" : "s"}`;

/** "3 live", or nothing. */
export const liveSubtitle = (n: number): string | null => (n > 0 ? `${n} live` : null);

/** Live first by viewers; then offline channels by name. */
export function sortStreams(streams: Stream[]): Stream[] {
  return [...streams].sort((a, b) => b.viewer_count - a.viewer_count || a.user_name.localeCompare(b.user_name));
}

/** A search result shown like a stream when it is live. */
export function channelStream(c: Channel): Stream | undefined {
  if (!c.is_live) return undefined;
  return {
    id: c.id,
    user_id: c.id,
    user_login: c.broadcaster_login,
    user_name: c.display_name,
    game_id: c.game_id ?? "",
    game_name: c.game_name,
    type: "live",
    title: c.title,
    viewer_count: 0,
    started_at: c.started_at,
    language: c.broadcaster_language ?? "",
    thumbnail_url: `https://static-cdn.jtvnw.net/previews-ttv/live_user_${c.broadcaster_login}-{width}x{height}.jpg`,
    tags: c.tags,
  };
}

/** The Following view's query: matches the channel, the game or the title. */
export function matches(s: Stream, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${s.user_name} ${s.user_login} ${s.game_name} ${s.title}`.toLowerCase().includes(q);
}

/** Distro family from /etc/os-release, for install hints. */
export type Family = "arch" | "debian" | "fedora" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

const MANAGERS: Record<Family, string> = {
  arch: "sudo pacman -S",
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  suse: "sudo zypper install",
};

export function installCommand(family: Family | undefined, pkg = "streamlink mpv"): string {
  return family ? `${MANAGERS[family]} ${pkg}` : `Install ${pkg} with your package manager`;
}
