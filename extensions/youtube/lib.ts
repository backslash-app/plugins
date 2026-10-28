// YouTube Data API v3 answers, mpv command lines and formatting. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Shapes

interface Thumbs {
  default?: { url: string };
  medium?: { url: string };
  high?: { url: string };
  standard?: { url: string };
  maxres?: { url: string };
}

/** An item of `videos.list?part=snippet,contentDetails,statistics`. */
export interface ApiVideo {
  id: string;
  snippet?: {
    publishedAt?: string;
    channelId?: string;
    title?: string;
    description?: string;
    thumbnails?: Thumbs;
    channelTitle?: string;
    tags?: string[];
    liveBroadcastContent?: "none" | "live" | "upcoming" | string;
    defaultAudioLanguage?: string;
  };
  contentDetails?: { duration?: string; definition?: string; caption?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
  liveStreamingDetails?: { concurrentViewers?: string; scheduledStartTime?: string };
}

/** An item of `search.list?type=video`. */
export interface SearchResult {
  id: { kind?: string; videoId?: string };
  snippet?: ApiVideo["snippet"];
}

/** An item of `playlistItems.list` (a channel's uploads). */
export interface PlaylistItem {
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
}

export interface Video {
  id: string;
  title: string;
  channel: string;
  channelId?: string;
  published?: string;
  description?: string;
  /** Seconds; undefined for live streams and premieres. */
  seconds?: number;
  views?: number;
  likes?: number;
  comments?: number;
  live?: "live" | "upcoming";
  hd?: boolean;
  captions?: boolean;
  tags: string[];
}

// ---------------------------------------------------------------------------
// Mapping

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** search.list escapes titles (`Rock &amp; Roll`, `It&#39;s`); videos.list doesn't. */
export function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** ISO 8601 `PT1H2M3S` → 3723 seconds; `P1DT2H` too; `P0D` (live) → undefined. */
export function parseDuration(iso: string | undefined): number | undefined {
  const m = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(iso ?? "");
  if (!m) return undefined;
  const [d, h, min, s] = m.slice(1).map((x) => Number(x ?? 0));
  const total = d * 86400 + h * 3600 + min * 60 + s;
  return total || undefined;
}

const num = (s: string | undefined) => (s === undefined || s === "" ? undefined : Number(s));

export function fromApi(v: ApiVideo): Video {
  const sn = v.snippet ?? {};
  const live = sn.liveBroadcastContent === "live" || sn.liveBroadcastContent === "upcoming"
    ? sn.liveBroadcastContent
    : undefined;
  return {
    id: v.id,
    title: decode(sn.title ?? v.id),
    channel: decode(sn.channelTitle ?? ""),
    channelId: sn.channelId,
    published: sn.publishedAt,
    description: sn.description || undefined,
    seconds: live ? undefined : parseDuration(v.contentDetails?.duration),
    views: num(v.statistics?.viewCount),
    likes: num(v.statistics?.likeCount),
    comments: num(v.statistics?.commentCount),
    live,
    hd: v.contentDetails?.definition === "hd",
    captions: v.contentDetails?.caption === "true",
    tags: sn.tags ?? [],
  };
}

/** Video ids of search results, in order, without channels or playlists. */
export const searchIds = (
  items: SearchResult[],
) => [...new Set(items.map((i) => i.id?.videoId).filter((id): id is string => !!id))];

/** A channel's uploads playlist: `UCxxxx` → `UUxxxx`. */
export const uploadsPlaylist = (channelId: string) => channelId.replace(/^UC/, "UU");

// ---------------------------------------------------------------------------
// URLs

export const watchUrl = (id: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`;
export const shortUrl = (id: string) => `https://youtu.be/${encodeURIComponent(id)}`;
export const channelUrl = (id: string) => `https://www.youtube.com/channel/${encodeURIComponent(id)}`;
export const thumbnail = (id: string, size: "mqdefault" | "hqdefault" | "sddefault") =>
  `https://i.ytimg.com/vi/${encodeURIComponent(id)}/${size}.jpg`;

/** A video id from what the user pasted: a watch, youtu.be, shorts or embed URL. */
export function videoIdFrom(text: string): string | undefined {
  const t = text.trim();
  const m = /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/.exec(t);
  return m?.[1];
}

// ---------------------------------------------------------------------------
// mpv

export function mpvArgs(url: string, o: { audioOnly?: boolean; title?: string } = {}): string[] {
  return [
    "mpv",
    "--no-terminal",
    ...(o.audioOnly
      ? ["--no-video", "--ytdl-format=bestaudio/best"]
      : ["--force-window=immediate", "--ytdl-format=bestvideo[height<=?1080]+bestaudio/best"]),
    ...(o.title ? [`--title=${o.title}`] : []),
    url,
  ];
}

/** `systemd-run` arguments for a background unit, with the display variables mpv needs. */
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

/** 3723 → "1:02:03"; 75 → "1:15". */
export function clock(seconds: number | undefined): string | undefined {
  if (seconds === undefined) return undefined;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

export function views(n: number | undefined): string | undefined {
  if (n === undefined) return undefined;
  return `${compact(n)} view${n === 1 ? "" : "s"}`;
}

/** "3 hours ago", "2 weeks ago", "5 years ago", as YouTube says it. */
export function ago(iso: string | undefined, now = Date.now()): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  const s = Math.max(0, (now - t) / 1000);
  const units: [number, string][] = [
    [365 * 86400, "year"],
    [30 * 86400, "month"],
    [7 * 86400, "week"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
  ];
  for (const [size, name] of units) {
    const n = Math.floor(s / size);
    if (n >= 1) return `${n} ${name}${n === 1 ? "" : "s"} ago`;
  }
  return "just now";
}

export const longDate = (iso: string | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })
    : "";

/** The first lines of a description, without its link lists and hashtags walls. */
export function excerpt(text: string | undefined, max = 600): string | undefined {
  if (!text) return undefined;
  const kept: string[] = [];
  let length = 0;
  let cut = false;
  for (const line of text.replace(/\r/g, "").split("\n").map((l) => l.trim())) {
    if (/^(#\w+\s*)+$/.test(line)) continue;
    if (length + line.length > max) {
      if (!kept.length) kept.push(line.slice(0, max));
      cut = true;
      break;
    }
    kept.push(line);
    length += line.length + 1;
  }
  const out = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return out ? out + (cut ? "…" : "") : undefined;
}

/** `"us"` → `"US"`; anything else than two letters → `"US"`. */
export function normalizeRegion(input: unknown): string {
  const r = String(input ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(r) ? r : "US";
}

/** The Data API's error body → a sentence and whether it is the key's fault. */
export function apiError(
  status: number,
  body: { error?: { message?: string; errors?: { reason?: string }[] } } | undefined,
): { message: string; auth: boolean; quota?: boolean } {
  const reason = body?.error?.errors?.[0]?.reason ?? "";
  if (reason === "keyInvalid" || (status === 400 && /API key not valid/i.test(body?.error?.message ?? ""))) {
    return { message: "Google rejected the API key", auth: true };
  }
  if (reason === "accessNotConfigured" || /has not been used|is disabled/i.test(body?.error?.message ?? "")) {
    return { message: "Enable the YouTube Data API v3 for this key's Google Cloud project", auth: true };
  }
  if (reason === "quotaExceeded" || reason === "dailyLimitExceeded") {
    return { message: "Today's YouTube API quota is used up", auth: false, quota: true };
  }
  if (reason === "ipRefererBlocked" || reason === "forbidden") {
    return { message: "This API key doesn't allow requests from here (check its restrictions)", auth: true };
  }
  return { message: `YouTube answered ${status}${body?.error?.message ? `: ${body.error.message}` : ""}`, auth: false };
}

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

export function installCommand(family: Family | undefined, packages: string[]): string {
  return family ? `${MANAGERS[family]} ${packages.join(" ")}` : `Install ${packages.join(" and ")}`;
}
