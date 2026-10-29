// Subsonic (Navidrome, Gonic, Airsonic) and Audiobookshelf answers, the
// player's command lines and formatting. Pure, tested in lib_test.ts.

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Hosts: the servers run on the user's own network

/** The networks this extension may reach; same list as `net` in backslash.toml. */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "navidrome",
  "navidrome.local",
  "audiobookshelf",
  "audiobookshelf.local",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
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

/**
 * A server address as typed: "192.168.1.10:4533", "http://music.lan/app/#/album",
 * "https://abs.local/audiobookshelf/library/…" → the base the API hangs from.
 */
export function normalizeUrl(input: unknown, kind: "subsonic" | "abs"): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  url = url.replace(/[?#].*$/, "").replace(/\/+$/, "");
  if (kind === "subsonic") url = url.replace(/\/(app|rest)(\/.*)?$/i, "");
  // The web app's pages, also under a sub-path ("/audiobookshelf/library/…").
  else url = url.replace(/\/(library|item|login|config|author|series|playlist|collection)(\/.*)?$/i, "");
  return url;
}

// ---------------------------------------------------------------------------
// Subsonic

export const API_VERSION = "1.16.1";
export const CLIENT = "Backslash";

/** md5 as lowercase hex. */
export const md5 = (text: string) => createHash("md5").update(text, "utf8").digest("hex");

/** Token authentication: t = md5(password + salt), with a fresh salt each time. */
export function authParams(user: string, password: string, salt: string): Record<string, string> {
  return { u: user, t: md5(password + salt), s: salt, v: API_VERSION, c: CLIENT, f: "json" };
}

export function randomSalt(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** An API address: `base/rest/method?auth&params`. */
export function restUrl(
  base: string,
  method: string,
  auth: Record<string, string>,
  params: Record<string, string | number> = {},
) {
  const p = new URLSearchParams(auth);
  for (const [k, v] of Object.entries(params)) p.set(k, String(v));
  return `${base}/rest/${method}?${p}`;
}

export class SubsonicError extends Error {
  constructor(message: string, readonly code: number) {
    super(message);
  }
}

/** The payload of `{"subsonic-response": {...}}`, or the server's error thrown. */
export function unwrap<T = Record<string, unknown>>(json: unknown): T {
  const r = (json as any)?.["subsonic-response"];
  if (!r) throw new SubsonicError("Not a Subsonic server: check the address", 0);
  if (r.status !== "ok") {
    const code = Number(r.error?.code ?? 0);
    const text = String(r.error?.message ?? "unknown error");
    if (code === 40) throw new SubsonicError("Wrong user name or password", code);
    if (code === 41) {
      throw new SubsonicError(
        "This server doesn't accept token authentication (LDAP users): use a local account",
        code,
      );
    }
    if (code === 50) throw new SubsonicError("This user isn't allowed to do that", code);
    if (code === 70) throw new SubsonicError("Not found on the server", code);
    throw new SubsonicError(`The server refused: ${text}`, code);
  }
  return r as T;
}

export interface Song {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  albumId?: string;
  artistId?: string;
  track?: number;
  disc?: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  /** Seconds. */
  duration?: number;
  bitRate?: number;
  suffix?: string;
  size?: number;
  starred?: boolean;
  playCount?: number;
}

export interface Album {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  year?: number;
  genre?: string;
  created?: string;
  starred?: boolean;
  playCount?: number;
  songs?: Song[];
}

export interface Artist {
  id: string;
  name: string;
  albumCount?: number;
  coverArt?: string;
  starred?: boolean;
}

export interface Playlist {
  id: string;
  name: string;
  songCount?: number;
  duration?: number;
  owner?: string;
  public?: boolean;
  changed?: string;
  comment?: string;
  coverArt?: string;
  songs?: Song[];
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : v ? [v as T] : []);
const opt = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : v);
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

export function toSong(r: any): Song {
  return {
    id: String(r.id),
    title: String(r.title ?? r.name ?? "Untitled"),
    artist: opt(r.artist) as string | undefined,
    album: opt(r.album) as string | undefined,
    albumId: opt(r.albumId) as string | undefined,
    artistId: opt(r.artistId) as string | undefined,
    track: n(r.track),
    disc: n(r.discNumber),
    year: n(r.year) || undefined,
    genre: opt(r.genre) as string | undefined,
    coverArt: opt(r.coverArt) as string | undefined,
    duration: n(r.duration),
    bitRate: n(r.bitRate),
    suffix: opt(r.suffix) as string | undefined,
    size: n(r.size),
    starred: !!r.starred,
    playCount: n(r.playCount),
  };
}

export function toAlbum(r: any): Album {
  return {
    id: String(r.id),
    name: String(r.name ?? r.album ?? r.title ?? "Untitled"),
    artist: opt(r.artist) as string | undefined,
    artistId: opt(r.artistId) as string | undefined,
    coverArt: opt(r.coverArt) as string | undefined,
    songCount: n(r.songCount),
    duration: n(r.duration),
    year: n(r.year) || undefined,
    genre: opt(r.genre) as string | undefined,
    created: opt(r.created) as string | undefined,
    starred: !!r.starred,
    playCount: n(r.playCount),
    songs: r.song ? arr<any>(r.song).map(toSong) : undefined,
  };
}

export const toArtist = (r: any): Artist => ({
  id: String(r.id),
  name: String(r.name ?? "Unknown"),
  albumCount: n(r.albumCount),
  coverArt: opt(r.coverArt) as string | undefined,
  starred: !!r.starred,
});

export const toPlaylist = (r: any): Playlist => ({
  id: String(r.id),
  name: String(r.name ?? "Playlist"),
  songCount: n(r.songCount),
  duration: n(r.duration),
  owner: opt(r.owner) as string | undefined,
  public: !!r.public,
  changed: opt(r.changed) as string | undefined,
  comment: opt(r.comment) as string | undefined,
  coverArt: opt(r.coverArt) as string | undefined,
  songs: r.entry ? arr<any>(r.entry).map(toSong) : undefined,
});

/** `search3`'s `searchResult3`. */
export function searchResult(payload: any): { artists: Artist[]; albums: Album[]; songs: Song[] } {
  const r = payload?.searchResult3 ?? {};
  return {
    artists: arr<any>(r.artist).map(toArtist),
    albums: arr<any>(r.album).map(toAlbum),
    songs: arr<any>(r.song).map(toSong),
  };
}

/** `getStarred2`'s `starred2`. */
export function starredResult(payload: any): { artists: Artist[]; albums: Album[]; songs: Song[] } {
  const r = payload?.starred2 ?? {};
  return {
    artists: arr<any>(r.artist).map(toArtist),
    albums: arr<any>(r.album).map(toAlbum),
    songs: arr<any>(r.song).map(toSong),
  };
}

export const albumList = (payload: any): Album[] => arr<any>(payload?.albumList2?.album).map(toAlbum);
export const playlists = (payload: any): Playlist[] => arr<any>(payload?.playlists?.playlist).map(toPlaylist);
export const artistAlbums = (payload: any): Album[] => arr<any>(payload?.artist?.album).map(toAlbum);
export const randomSongs = (payload: any): Song[] => arr<any>(payload?.randomSongs?.song).map(toSong);

/** Tracks in album order: disc, then track number. */
export const trackOrder = (songs: Song[]) =>
  [...songs].sort((a, b) => (a.disc ?? 1) - (b.disc ?? 1) || (a.track ?? 0) - (b.track ?? 0));

// ---------------------------------------------------------------------------
// Audiobookshelf

export interface AbsLibrary {
  id: string;
  name: string;
  mediaType: "book" | "podcast";
}

export interface Track {
  index: number;
  /** Seconds from the start of the book. */
  startOffset: number;
  duration: number;
  title?: string;
  contentUrl: string;
}

export interface Chapter {
  start: number;
  end: number;
  title: string;
}

export interface Episode {
  id: string;
  title: string;
  subtitle?: string;
  description?: string;
  published?: number;
  duration?: number;
  contentUrl?: string;
  season?: string;
  episode?: string;
}

export interface Progress {
  currentTime: number;
  duration: number;
  progress: number;
  isFinished: boolean;
  lastUpdate?: number;
  episodeId?: string;
}

export interface AbsItem {
  id: string;
  libraryId?: string;
  mediaType: "book" | "podcast";
  title: string;
  subtitle?: string;
  author?: string;
  narrator?: string;
  series?: string;
  year?: string;
  description?: string;
  genres: string[];
  duration?: number;
  hasCover: boolean;
  addedAt?: number;
  numTracks?: number;
  numEpisodes?: number;
  tracks?: Track[];
  chapters?: Chapter[];
  episodes?: Episode[];
  progress?: Progress;
  /** The episode in progress, for podcasts in "Continue Listening". */
  recentEpisode?: Episode;
}

export function toEpisode(e: any): Episode {
  return {
    id: String(e.id),
    title: String(e.title ?? "Episode"),
    subtitle: opt(e.subtitle) as string | undefined,
    description: opt(e.description) as string | undefined,
    published: n(e.publishedAt) ?? (e.pubDate ? Date.parse(e.pubDate) || undefined : undefined),
    duration: n(e.duration) ?? n(e.audioTrack?.duration) ?? n(e.audioFile?.duration),
    contentUrl: opt(e.audioTrack?.contentUrl) as string | undefined,
    season: opt(e.season) as string | undefined,
    episode: opt(e.episode) as string | undefined,
  };
}

export function toProgress(p: any): Progress | undefined {
  if (!p) return undefined;
  return {
    currentTime: n(p.currentTime) ?? 0,
    duration: n(p.duration) ?? 0,
    progress: n(p.progress) ?? 0,
    isFinished: !!p.isFinished,
    lastUpdate: n(p.lastUpdate),
    episodeId: opt(p.episodeId) as string | undefined,
  };
}

/** A library item, minified or expanded. */
export function toAbsItem(r: any): AbsItem {
  const media = r?.media ?? {};
  const m = media.metadata ?? {};
  const series = m.seriesName ||
    (Array.isArray(m.series)
      ? m.series.map((s: any) => (s.sequence ? `${s.name} #${s.sequence}` : s.name)).join(", ")
      : undefined);
  const author = m.authorName || (Array.isArray(m.authors) ? m.authors.map((a: any) => a.name).join(", ") : m.author);
  const narrator = m.narratorName || (Array.isArray(m.narrators) ? m.narrators.join(", ") : undefined);
  return {
    id: String(r.id),
    libraryId: opt(r.libraryId) as string | undefined,
    mediaType: r.mediaType === "podcast" ? "podcast" : "book",
    title: String(m.title ?? "Untitled"),
    subtitle: opt(m.subtitle) as string | undefined,
    author: opt(author) as string | undefined,
    narrator: opt(narrator) as string | undefined,
    series: opt(series) as string | undefined,
    year: opt(m.publishedYear ?? m.releaseDate?.slice?.(0, 4)) as string | undefined,
    description: opt(m.description) as string | undefined,
    genres: arr<string>(m.genres),
    duration: n(media.duration) ??
      (Array.isArray(media.tracks)
        ? media.tracks.reduce((s: number, t: any) => s + (n(t.duration) ?? 0), 0) || undefined
        : undefined),
    hasCover: !!media.coverPath,
    addedAt: n(r.addedAt),
    numTracks: n(media.numTracks) ?? (Array.isArray(media.tracks) ? media.tracks.length : undefined),
    numEpisodes: n(media.numEpisodes) ?? (Array.isArray(media.episodes) ? media.episodes.length : undefined),
    tracks: Array.isArray(media.tracks)
      ? media.tracks.map((t: any, i: number) => ({
        index: n(t.index) ?? i + 1,
        startOffset: n(t.startOffset) ?? 0,
        duration: n(t.duration) ?? 0,
        title: opt(t.title) as string | undefined,
        contentUrl: String(t.contentUrl ?? ""),
      })).filter((t: Track) => t.contentUrl).sort((a: Track, b: Track) => a.startOffset - b.startOffset)
      : undefined,
    chapters: Array.isArray(media.chapters)
      ? media.chapters.map((c: any) => ({ start: n(c.start) ?? 0, end: n(c.end) ?? 0, title: String(c.title ?? "") }))
      : undefined,
    episodes: Array.isArray(media.episodes)
      ? media.episodes.map(toEpisode).sort((a: Episode, b: Episode) => (b.published ?? 0) - (a.published ?? 0))
      : undefined,
    progress: toProgress(r.userMediaProgress),
    recentEpisode: r.recentEpisode ? toEpisode(r.recentEpisode) : undefined,
  };
}

/** `/api/libraries/{id}/search`: books and podcasts found. */
export function absSearchResult(json: any): AbsItem[] {
  return [...arr<any>(json?.book), ...arr<any>(json?.podcast)].map((x) => toAbsItem(x.libraryItem ?? x));
}

/** Where to start a book at `time` seconds: which track, and how far in it. */
export function startPoint(
  tracks: Pick<Track, "startOffset" | "duration">[],
  time: number,
): { index: number; offset: number } {
  if (!tracks.length || time <= 0) return { index: 0, offset: 0 };
  for (let i = tracks.length - 1; i >= 0; i--) {
    if (tracks[i].startOffset <= time) {
      return {
        index: i,
        offset: Math.min(Math.max(0, time - tracks[i].startOffset), Math.max(0, tracks[i].duration - 1)),
      };
    }
  }
  return { index: 0, offset: 0 };
}

/** The position in the whole book of the player at `position` seconds in track `index`. */
export const bookTime = (offsets: number[], index: number, position: number) => (offsets[index] ?? 0) + position;

/** The chapter at `time`, if the book has chapters. */
export function chapterAt(chapters: Chapter[] | undefined, time: number): Chapter | undefined {
  return chapters?.find((c) => c.start <= time && time < c.end);
}

/** Where to resume: nowhere when finished or barely started. */
export function resumeAt(p: Progress | undefined): number {
  if (!p || p.isFinished || p.currentTime < 10) return 0;
  return Math.max(0, p.currentTime - 5);
}

/** The body of `PATCH /api/me/progress/…`. */
export function progressBody(time: number, duration: number, finished = false) {
  const t = finished ? duration : Math.max(0, Math.min(time, duration || time));
  return {
    currentTime: Math.round(t * 10) / 10,
    duration,
    progress: duration ? Math.min(1, t / duration) : 0,
    isFinished: finished || (duration > 0 && duration - t < 30),
  };
}

// ---------------------------------------------------------------------------
// mpv

/** One file to play, and where to start it. */
export interface Entry {
  url: string;
  start?: number;
}

/**
 * Plays `entries` without a window. A start position applies to its file
 * only (mpv's `--{ … --}` groups), not to the whole queue.
 */
export function mpvArgs(
  entries: Entry[],
  o: { socket?: string; script?: string; title?: string; shuffle?: boolean; startIndex?: number; speed?: number } = {},
): string[] {
  const files = entries.flatMap((e) => (e.start ? ["--{", `--start=${Math.floor(e.start)}`, e.url, "--}"] : [e.url]));
  return [
    "mpv",
    "--no-video",
    "--no-terminal",
    "--idle=no",
    "--cache=yes",
    "--force-seekable=yes",
    "--audio-display=no",
    ...(o.shuffle ? ["--shuffle"] : []),
    ...(o.startIndex ? [`--playlist-start=${o.startIndex}`] : []),
    ...(o.speed && o.speed !== 1 ? [`--speed=${o.speed}`] : []),
    ...(o.socket ? [`--input-ipc-server=${o.socket}`] : []),
    ...(o.script ? [`--script=${o.script}`] : []),
    ...(o.title ? [`--title=${o.title}`] : []),
    ...files,
  ];
}

/** `systemd-run` arguments for a background unit running `argv`. */
export function unitArgs(unit: string, description: string, argv: string[]): string[] {
  return ["--user", "--quiet", "--collect", `--unit=${unit}`, `--description=${description}`, ...argv];
}

/** An mpv script saving the track, position and pause state every few seconds and when a file ends. */
export function positionScript(out: string): string {
  return [
    `local out = ${JSON.stringify(out)}`,
    "local pos, idx, count, finished = nil, nil, nil, false",
    'mp.observe_property("time-pos", "number", function(_, v) if v then pos = v end end)',
    'mp.observe_property("playlist-pos", "number", function(_, v) if v and v >= 0 then idx = v end end)',
    'mp.observe_property("playlist-count", "number", function(_, v) if v then count = v end end)',
    "local function save()",
    '  local f = io.open(out, "w")',
    "  if not f then return end",
    '  local paused = mp.get_property_bool("pause") and "true" or "false"',
    '  f:write(string.format(\'{"position":%s,"index":%s,"finished":%s,"paused":%s}\',',
    '    pos and string.format("%.1f", pos) or "null", idx and string.format("%d", idx) or "null",',
    '    finished and "true" or "false", paused))',
    "  f:close()",
    "end",
    "mp.add_periodic_timer(5, save)",
    'mp.observe_property("pause", "bool", function() save() end)',
    'mp.register_event("end-file", function(e)',
    '  if e.reason == "eof" and idx and count and idx >= count - 1 then finished = true end',
    "  save()",
    "end)",
    "",
  ].join("\n");
}

export interface PositionFile {
  position?: number;
  index?: number;
  finished: boolean;
  paused: boolean;
}

export function parsePositionFile(text: string | undefined): PositionFile | undefined {
  if (!text) return undefined;
  try {
    const j = JSON.parse(text);
    return {
      position: n(j.position),
      index: n(j.index),
      finished: j.finished === true,
      paused: j.paused === true,
    };
  } catch {
    return undefined;
  }
}

/** A JSON IPC command line for mpv. */
export const ipcCommand = (command: (string | number | boolean)[], requestId?: number) =>
  `${JSON.stringify(requestId === undefined ? { command } : { command, request_id: requestId })}\n`;

/** The `data` of mpv's answer to `requestId` in its IPC output (events are skipped). */
export function ipcReply(text: string, requestId: number): { ok: boolean; data?: unknown } | undefined {
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const j = JSON.parse(line);
      if (j.request_id === requestId) return { ok: j.error === "success", data: j.data };
    } catch {
      // A partial line.
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Formatting

/** 3723 → "1:02:03"; 75 → "1:15". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** 3723 → "1 h 02 min"; 2700 → "45 min". */
export function duration(seconds: number | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

/** "4 h 12 min left". */
export function left(p: Pick<Progress, "currentTime" | "duration">): string | undefined {
  const d = duration(p.duration - p.currentTime);
  return d ? `${d} left` : undefined;
}

/** HTML descriptions (Audiobookshelf keeps them as HTML) as plain Markdown. */
export function htmlToText(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/?(p|div|li|h\d)[^>]*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*(\n\s*)+/g, "\n\n")
    .trim();
}

/** A file name for a cached picture: a hash of where it comes from. */
export const cacheName = (key: string) => `${md5(key).slice(0, 24)}.jpg`;

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
