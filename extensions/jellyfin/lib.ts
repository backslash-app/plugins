// Jellyfin and Plex answers mapped to one media item, the hosts this extension
// may reach, stream and web addresses, player command lines and formatting.
// Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Hosts

/**
 * Where media servers usually live, as declared in `[permissions] net` (kept
 * equal by a test). Extensions declare their hosts statically, so instead of
 * any website this is the local network (mDNS names, private IPv4 ranges),
 * Tailscale, DuckDNS and Plex's own `*.plex.direct` addresses.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "jellyfin",
  "jellyfin.local",
  "plex",
  "plex.local",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.plex.direct",
  "*.duckdns.org",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `192.168.1.5:8096/web/#/home` → `http://192.168.1.5:8096`. */
export function normalizeUrl(input: unknown, kind: Kind): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/[?#].*$/, "").replace(/\/+$/, "");
  url = url.replace(/\/web(\/.*)?$/i, "");
  // A Plex address without a port is almost always the default one.
  if (kind === "plex" && /^http:\/\/[^/:]+$/i.test(url) && !/plex\.direct$/i.test(url)) url += ":32400";
  return url;
}

// ---------------------------------------------------------------------------
// Items

export type Kind = "jellyfin" | "plex";
export type MediaType = "movie" | "series" | "season" | "episode" | "album" | "track" | "artist" | "other";

export interface MediaItem {
  server: Kind;
  id: string;
  type: MediaType;
  title: string;
  seriesTitle?: string;
  seriesId?: string;
  season?: number;
  episode?: number;
  year?: number;
  /** Community rating, out of 10. */
  rating?: number;
  /** Critics' rating, out of 100. */
  criticRating?: number;
  /** PG-13, TV-MA… */
  contentRating?: string;
  /** Seconds. */
  runtime?: number;
  genres: string[];
  overview?: string;
  played: boolean;
  /** Seconds watched, when in progress. */
  position?: number;
  added?: number;
  premiered?: number;
  artist?: string;
  /** Episodes or tracks. */
  childCount?: number;
  unplayedCount?: number;
  /** The server path of the picture, to fetch with the token. */
  image?: string;
  /** Plex: the file to stream. */
  partKey?: string;
  container?: string;
  resolution?: string;
  studio?: string;
  people?: string[];
}

const TICKS = 10_000_000;
const date = (s: unknown) => {
  const t = typeof s === "string" ? Date.parse(s) : NaN;
  return Number.isFinite(t) ? t : undefined;
};
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

const JELLYFIN_TYPES: Record<string, MediaType> = {
  Movie: "movie",
  Series: "series",
  Season: "season",
  Episode: "episode",
  MusicAlbum: "album",
  Audio: "track",
  MusicArtist: "artist",
};

/** A `BaseItemDto` of the Jellyfin API. */
export function fromJellyfin(i: Record<string, any>): MediaItem {
  const type = JELLYFIN_TYPES[i.Type] ?? "other";
  const ud = i.UserData ?? {};
  const tags = i.ImageTags ?? {};
  // Episodes show their series' poster; the rest their own.
  let image: string | undefined;
  if (type === "episode" && i.SeriesId && i.SeriesPrimaryImageTag) {
    image = `/Items/${i.SeriesId}/Images/Primary?fillHeight=480&quality=85&tag=${i.SeriesPrimaryImageTag}`;
  } else if (tags.Primary) image = `/Items/${i.Id}/Images/Primary?fillHeight=480&quality=85&tag=${tags.Primary}`;
  else if (i.AlbumId && i.AlbumPrimaryImageTag) {
    image = `/Items/${i.AlbumId}/Images/Primary?fillHeight=480&quality=85&tag=${i.AlbumPrimaryImageTag}`;
  }
  const video = (i.MediaStreams ?? []).find((s: any) => s.Type === "Video");
  return {
    server: "jellyfin",
    id: String(i.Id),
    type,
    title: String(i.Name ?? "Untitled"),
    seriesTitle: i.SeriesName ?? undefined,
    seriesId: i.SeriesId ?? undefined,
    season: num(i.ParentIndexNumber),
    episode: num(i.IndexNumber),
    year: num(i.ProductionYear),
    rating: num(i.CommunityRating),
    criticRating: num(i.CriticRating),
    contentRating: i.OfficialRating ?? undefined,
    runtime: num(i.RunTimeTicks) ? Math.round(i.RunTimeTicks / TICKS) : undefined,
    genres: Array.isArray(i.Genres) ? i.Genres : [],
    overview: i.Overview ?? undefined,
    played: !!ud.Played,
    position: num(ud.PlaybackPositionTicks) ? Math.round(ud.PlaybackPositionTicks / TICKS) : undefined,
    added: date(i.DateCreated),
    premiered: date(i.PremiereDate),
    artist: i.AlbumArtist ?? (Array.isArray(i.Artists) ? i.Artists[0] : undefined),
    childCount: num(i.ChildCount) ?? num(i.RecursiveItemCount),
    unplayedCount: num(ud.UnplayedItemCount),
    image,
    container: i.Container ?? undefined,
    resolution: video?.Height ? resolutionName(video.Height) : undefined,
    studio: i.Studios?.[0]?.Name ?? undefined,
    people: Array.isArray(i.People)
      ? i.People.filter((p: any) => p.Type === "Actor").slice(0, 5).map((p: any) => String(p.Name))
      : undefined,
  };
}

const PLEX_TYPES: Record<string, MediaType> = {
  movie: "movie",
  show: "series",
  season: "season",
  episode: "episode",
  album: "album",
  track: "track",
  artist: "artist",
};

/** A `Metadata` entry of the Plex Media Server API (JSON). */
export function fromPlex(m: Record<string, any>): MediaItem {
  const type = PLEX_TYPES[m.type] ?? "other";
  const media = m.Media?.[0];
  const part = media?.Part?.[0];
  const image = type === "episode"
    ? (m.grandparentThumb ?? m.parentThumb ?? m.thumb)
    : type === "track"
    ? (m.parentThumb ?? m.thumb)
    : m.thumb;
  const seconds = (ms: unknown) => (num(ms) ? Math.round((ms as number) / 1000) : undefined);
  const leaf = num(m.leafCount);
  return {
    server: "plex",
    id: String(m.ratingKey),
    type,
    title: String(m.title ?? "Untitled"),
    seriesTitle: type === "episode" ? m.grandparentTitle : type === "season" ? m.parentTitle : undefined,
    seriesId: type === "episode" ? m.grandparentRatingKey : type === "season" ? m.parentRatingKey : undefined,
    season: type === "episode" ? num(m.parentIndex) : type === "season" ? num(m.index) : undefined,
    episode: type === "episode" ? num(m.index) : undefined,
    year: num(m.year),
    rating: num(m.audienceRating) ?? num(m.rating),
    criticRating: undefined,
    contentRating: m.contentRating ?? undefined,
    runtime: seconds(m.duration),
    genres: Array.isArray(m.Genre) ? m.Genre.map((g: any) => String(g.tag)) : [],
    overview: m.summary || undefined,
    played: type === "series" || type === "season" || type === "album"
      ? leaf !== undefined && leaf > 0 && num(m.viewedLeafCount) === leaf
      : (num(m.viewCount) ?? 0) > 0 && !m.viewOffset,
    position: seconds(m.viewOffset),
    added: num(m.addedAt) ? m.addedAt * 1000 : undefined,
    premiered: date(m.originallyAvailableAt),
    artist: type === "album" ? m.parentTitle : type === "track" ? m.grandparentTitle : undefined,
    childCount: leaf ?? num(m.childCount),
    unplayedCount: leaf !== undefined && num(m.viewedLeafCount) !== undefined ? leaf - m.viewedLeafCount : undefined,
    image: typeof image === "string" ? image : undefined,
    partKey: part?.key,
    container: part?.container ?? media?.container,
    resolution: media?.videoResolution ? plexResolution(String(media.videoResolution)) : undefined,
    studio: m.studio ?? undefined,
    people: Array.isArray(m.Role) ? m.Role.slice(0, 5).map((r: any) => String(r.tag)) : undefined,
  };
}

function resolutionName(height: number): string {
  if (height >= 2000) return "4K";
  if (height >= 1000) return "1080p";
  if (height >= 700) return "720p";
  return `${height}p`;
}

const plexResolution = (r: string) => (r === "4k" ? "4K" : /^\d+$/.test(r) ? `${r}p` : r.toUpperCase());

/** Plex hubs/search answer → items of the wanted types. */
export function plexSearchItems(json: any): MediaItem[] {
  const hubs: any[] = json?.MediaContainer?.Hub ?? [];
  return hubs.flatMap((h) => (h.Metadata ?? []).map(fromPlex)).filter((i) => WANTED.includes(i.type));
}

/** What search and Recently Added show. */
export const WANTED: MediaType[] = ["movie", "series", "episode", "album"];

// ---------------------------------------------------------------------------
// Addresses

/** The Jellyfin `Authorization` header (token optional before signing in). */
export function jellyfinAuth(deviceId: string, token?: string): string {
  return `MediaBrowser Client="Backslash", Device="Backslash Launcher", DeviceId="${deviceId}", Version="1.0.0"${
    token ? `, Token="${token}"` : ""
  }`;
}

export function jellyfinStreamUrl(base: string, i: Pick<MediaItem, "id" | "type">, token: string): string {
  const kind = i.type === "track" ? "Audio" : "Videos";
  return `${base}/${kind}/${i.id}/stream?static=true&api_key=${encodeURIComponent(token)}`;
}

export const jellyfinWebUrl = (base: string, id: string, serverId?: string) =>
  `${base}/web/#/details?id=${id}${serverId ? `&serverId=${serverId}` : ""}`;

export function plexStreamUrl(base: string, partKey: string, token: string): string {
  return `${base}${partKey}${partKey.includes("?") ? "&" : "?"}X-Plex-Token=${encodeURIComponent(token)}`;
}

export const plexWebUrl = (base: string, machineId: string, id: string) =>
  `${base}/web/index.html#!/server/${machineId}/details?key=${encodeURIComponent(`/library/metadata/${id}`)}`;

/** A Plex picture resized by the server. */
export const plexImagePath = (thumb: string) =>
  `/photo/:/transcode?width=320&height=480&minSize=1&upscale=1&url=${encodeURIComponent(thumb)}`;

// ---------------------------------------------------------------------------
// Players

export type Player = "mpv" | "vlc";

export function playerChoice(input: unknown): Player[] {
  const p = String(input ?? "").trim().toLowerCase();
  return p === "vlc" ? ["vlc", "mpv"] : ["mpv", "vlc"];
}

/** The command line playing `urls` (a movie, an episode, or an album's tracks). */
export function playerArgs(p: Player, urls: string[], o: { title?: string; start?: number } = {}): string[] {
  if (p === "mpv") {
    return [
      "mpv",
      "--force-window=immediate",
      "--no-terminal",
      ...(o.start ? [`--start=${Math.floor(o.start)}`] : []),
      ...(o.title ? [`--force-media-title=${o.title}`, `--title=${o.title}`] : []),
      ...urls,
    ];
  }
  return [
    "vlc",
    "--no-video-title-show",
    "--play-and-exit",
    ...(o.start ? [`--start-time=${Math.floor(o.start)}`] : []),
    ...(o.title && urls.length === 1 ? [`--meta-title=${o.title}`] : []),
    ...urls,
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

/** 7260 → "2 h 01"; 2700 → "45 min". */
export function runtime(seconds: number | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

/** "S02E05". */
export function episodeCode(i: Pick<MediaItem, "season" | "episode">): string | undefined {
  if (i.season === undefined && i.episode === undefined) return undefined;
  const pad = (n: number | undefined) => String(n ?? 0).padStart(2, "0");
  return `S${pad(i.season)}E${pad(i.episode)}`;
}

/** Share watched, 0 to 1. */
export function progressOf(i: Pick<MediaItem, "position" | "runtime">): number | undefined {
  if (!i.position || !i.runtime) return undefined;
  return Math.max(0, Math.min(1, i.position / i.runtime));
}

/** 2700 → "1:15:00" style resume point: "45:00". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "The Expanse · S02E05", "Dune (2021)", "Rumours · Fleetwood Mac". */
export function subtitleOf(i: MediaItem): string {
  switch (i.type) {
    case "episode":
      return [i.seriesTitle, episodeCode(i)].filter(Boolean).join(" · ");
    case "album":
      return [i.artist, i.year].filter(Boolean).join(" · ");
    case "series":
      return [i.year, i.childCount ? `${i.childCount} episodes` : ""].filter(Boolean).join(" · ");
    default:
      return [i.year, runtime(i.runtime)].filter(Boolean).join(" · ");
  }
}

export const TYPE_NAMES: Record<MediaType, string> = {
  movie: "Movie",
  series: "Series",
  season: "Season",
  episode: "Episode",
  album: "Album",
  track: "Track",
  artist: "Artist",
  other: "Item",
};

export function ago(ms: number, now = Date.now()): string {
  const d = Math.floor((now - ms) / 86_400_000);
  if (d < 1) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} d ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** A file name for a cached picture: a hash of where it comes from. */
export async function cacheName(key: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("") + ".jpg";
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

export function installCommand(family: Family | undefined, pkg = "mpv"): string {
  return family ? `${MANAGERS[family]} ${pkg}` : `Install ${pkg} with your package manager`;
}
