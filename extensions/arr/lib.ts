// Sonarr, Radarr and Lidarr: their calendar, queue and lookup answers in a
// few shapes, and how to show them.

/**
 * Where the *arr apps usually run, as declared in `[permissions] net`
 * (kept equal by a test, with {@link POSTER_HOSTS} after them): this
 * computer, local names, private networks and Tailscale.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "sonarr",
  "radarr",
  "lidarr",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

/** Posters of search results not in the library yet come from TheTVDB and TMDB. */
export const POSTER_HOSTS = ["artworks.thetvdb.com", "image.tmdb.org"];

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

export type Kind = "sonarr" | "radarr" | "lidarr";

export const APPS: Record<Kind, { title: string; port: number; api: string; noun: string; nouns: string }> = {
  sonarr: { title: "Sonarr", port: 8989, api: "/api/v3", noun: "series", nouns: "series" },
  radarr: { title: "Radarr", port: 7878, api: "/api/v3", noun: "movie", nouns: "movies" },
  lidarr: { title: "Lidarr", port: 8686, api: "/api/v1", noun: "artist", nouns: "artists" },
};

/** `sonarr.local:8989/calendar` → `http://sonarr.local:8989`; a URL base (`/sonarr`) is kept. */
export function normalizeUrl(input: unknown, kind?: Kind): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const u = new URL(url);
    if (!u.port && u.protocol === "http:" && kind && !/^http:\/\/[^/]+:80\b/.test(url)) {
      u.port = String(APPS[kind].port);
    }
    const path = u.pathname
      .replace(
        /\/(calendar|activity(\/queue)?|wanted(\/missing)?|system(\/status)?|settings.*|series|movies?|artist|add\/new)\/?$/i,
        "",
      )
      .replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

// ---------------------------------------------------------------------------
// API shapes (the fields we read)

export interface Image {
  coverType: string;
  url?: string;
  remoteUrl?: string;
}

export interface Series {
  id?: number;
  title: string;
  titleSlug?: string;
  year?: number;
  tvdbId?: number;
  network?: string;
  overview?: string;
  status?: string;
  runtime?: number;
  genres?: string[];
  images?: Image[];
  remotePoster?: string;
  seasons?: { seasonNumber: number; monitored: boolean }[];
  statistics?: { seasonCount?: number; episodeCount?: number; episodeFileCount?: number };
  ratings?: { value?: number };
  certification?: string;
}

export interface Episode {
  id: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  airDateUtc?: string;
  hasFile?: boolean;
  monitored?: boolean;
  overview?: string;
  runtime?: number;
  finaleType?: string;
  series?: Series;
}

export interface Movie {
  id?: number;
  title: string;
  titleSlug?: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  overview?: string;
  studio?: string;
  runtime?: number;
  genres?: string[];
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
  hasFile?: boolean;
  monitored?: boolean;
  isAvailable?: boolean;
  images?: Image[];
  remotePoster?: string;
  certification?: string;
  ratings?: { tmdb?: { value?: number }; imdb?: { value?: number } };
}

export interface Artist {
  id?: number;
  artistName: string;
  foreignArtistId?: string;
  overview?: string;
  images?: Image[];
  remotePoster?: string;
  genres?: string[];
  artistType?: string;
  disambiguation?: string;
}

export interface Album {
  id: number;
  artistId: number;
  title: string;
  albumType?: string;
  releaseDate?: string;
  monitored?: boolean;
  artist?: Artist;
  images?: Image[];
  statistics?: { trackFileCount?: number; trackCount?: number };
}

// ---------------------------------------------------------------------------
// Calendar

export interface CalendarEntry {
  /** Unique across apps: `sonarr:123:air`. */
  id: string;
  kind: Kind;
  /** The series, movie or artist. */
  title: string;
  /** S02E05 · Episode title, "Digital release", the album. */
  what: string;
  /** Unix ms. */
  date: number;
  /** For Sonarr, a time matters; movies and albums have a day only. */
  hasTime: boolean;
  label: string;
  hasFile: boolean;
  overview?: string;
  /** The episode, movie or album: what a search is for. */
  itemId?: number;
  /** Library item id, for the poster and the web page. */
  libraryId?: number;
  slug?: string;
  network?: string;
  runtime?: number;
  genres?: string[];
  finale?: string;
  poster?: { path?: string; remote?: string };
}

export const episodeCode = (season: number, episode: number) =>
  `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;

export function posterOf(images: Image[] | undefined, remotePoster?: string): { path?: string; remote?: string } {
  const p = images?.find((i) => i.coverType === "poster") ?? images?.find((i) => i.coverType === "cover");
  return { path: p?.url, remote: p?.remoteUrl ?? remotePoster };
}

export function fromEpisode(e: Episode): CalendarEntry {
  const s = e.series;
  return {
    id: `sonarr:${e.id}`,
    kind: "sonarr",
    title: s?.title ?? `Series ${e.seriesId}`,
    what: `${episodeCode(e.seasonNumber, e.episodeNumber)}${e.title && e.title !== "TBA" ? ` · ${e.title}` : ""}`,
    date: e.airDateUtc ? Date.parse(e.airDateUtc) : 0,
    hasTime: true,
    label: e.episodeNumber === 1 ? (e.seasonNumber === 1 ? "Series premiere" : "Season premiere") : "Airs",
    hasFile: !!e.hasFile,
    overview: e.overview ?? s?.overview,
    itemId: e.id,
    libraryId: e.seriesId,
    slug: s?.titleSlug,
    network: s?.network,
    runtime: e.runtime || s?.runtime,
    genres: s?.genres,
    finale: e.finaleType ? `${e.finaleType[0].toUpperCase()}${e.finaleType.slice(1)} finale` : undefined,
    poster: posterOf(s?.images),
  };
}

const MOVIE_DATES = [
  ["inCinemas", "In cinemas"],
  ["digitalRelease", "Digital release"],
  ["physicalRelease", "Physical release"],
] as const;

/** One entry per release of the movie that falls in the window. */
export function fromMovie(m: Movie, start: number, end: number): CalendarEntry[] {
  const out: CalendarEntry[] = [];
  for (const [key, label] of MOVIE_DATES) {
    const date = m[key] ? Date.parse(m[key]!) : NaN;
    if (!Number.isFinite(date) || date < start || date >= end) continue;
    out.push({
      id: `radarr:${m.id}:${key}`,
      kind: "radarr",
      title: m.year ? `${m.title} (${m.year})` : m.title,
      what: label,
      date,
      hasTime: false,
      label,
      hasFile: !!m.hasFile,
      overview: m.overview,
      itemId: m.id,
      libraryId: m.id,
      slug: m.titleSlug,
      network: m.studio,
      runtime: m.runtime,
      genres: m.genres,
      poster: posterOf(m.images, m.remotePoster),
    });
  }
  return out;
}

export function fromAlbum(a: Album): CalendarEntry {
  const tracks = a.statistics;
  return {
    id: `lidarr:${a.id}`,
    kind: "lidarr",
    title: a.artist?.artistName ?? `Artist ${a.artistId}`,
    what: `${a.title}${a.albumType && a.albumType !== "Album" ? ` (${a.albumType})` : ""}`,
    date: a.releaseDate ? Date.parse(a.releaseDate) : 0,
    hasTime: false,
    label: "Release",
    hasFile: !!tracks?.trackCount && tracks.trackFileCount === tracks.trackCount,
    overview: a.artist?.overview,
    itemId: a.id,
    libraryId: a.artistId,
    slug: a.artist?.foreignArtistId,
    genres: a.artist?.genres,
    poster: posterOf(a.images ?? a.artist?.images),
  };
}

export const sortCalendar = (entries: CalendarEntry[]) =>
  [...entries].sort((a, b) => a.date - b.date || a.title.localeCompare(b.title));

const DAY = 86_400_000;
export const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "Today", "Tomorrow", "Thursday", then "Monday 4 November". */
export function dayLabel(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(ms) - startOfDay(now)) / DAY);
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days === -1) return "Yesterday";
  const d = new Date(ms);
  const weekday = d.toLocaleDateString("en-GB", { weekday: "long" });
  if (days > 1 && days < 7) return weekday;
  return `${weekday} ${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "long" })}`;
}

export const timeOf = (ms: number) => new Date(ms).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** The web page of a library item. */
export function webUrl(base: string, kind: Kind, slug: string | number | undefined): string {
  if (slug === undefined || slug === "") return base;
  const path = kind === "sonarr" ? "series" : kind === "radarr" ? "movie" : "artist";
  return `${base}/${path}/${encodeURIComponent(String(slug))}`;
}

/** The API's own poster, resized by the server: `/MediaCover/12/poster.jpg?lastWrite=…` → `mediacover/12/poster-250.jpg`. */
export function mediaCoverPath(kind: Kind, imageUrl: string | undefined, id: number | undefined): string | undefined {
  if (id === undefined) return undefined;
  const file = /\/(poster|cover)\.(jpg|png)/i.exec(imageUrl ?? "")?.[0]?.slice(1) ?? "poster.jpg";
  const small = file.replace(/\.(jpg|png)$/i, "-250.$1");
  return kind === "lidarr" ? `/mediacover/artist/${id}/${small}` : `/mediacover/${id}/${small}`;
}

// ---------------------------------------------------------------------------
// Queue

export interface QueueRecord {
  id: number;
  title?: string;
  size?: number;
  sizeleft?: number;
  timeleft?: string;
  estimatedCompletionTime?: string;
  status?: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  statusMessages?: { title?: string; messages?: string[] }[];
  errorMessage?: string;
  downloadClient?: string;
  indexer?: string;
  protocol?: string;
  outputPath?: string;
  quality?: { quality?: { name?: string } };
  series?: Series;
  episode?: Episode;
  movie?: Movie;
  artist?: Artist;
  album?: Album;
  seriesId?: number;
  movieId?: number;
  artistId?: number;
  added?: string;
}

export interface QueueEntry {
  id: string;
  queueId: number;
  kind: Kind;
  /** The series, movie or album it is for. */
  title: string;
  what?: string;
  release: string;
  progress: number;
  size: number;
  left: number;
  /** Seconds. */
  eta?: number;
  status: string;
  state?: string;
  health: "ok" | "warning" | "error";
  messages: string[];
  client?: string;
  indexer?: string;
  protocol?: string;
  quality?: string;
  libraryId?: number;
  slug?: string;
  poster?: { path?: string; remote?: string };
}

/** "1.02:03:04" (days), "02:03:04" → seconds. */
export function parseTimeLeft(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const m = /^(?:(\d+)\.)?(\d+):(\d+):(\d+)/.exec(s);
  if (!m) return undefined;
  return Number(m[1] ?? 0) * 86400 + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

export function fromQueue(kind: Kind, r: QueueRecord): QueueEntry {
  const size = r.size ?? 0;
  const left = r.sizeleft ?? 0;
  const messages = (r.statusMessages ?? []).flatMap((m) => m.messages?.length ? m.messages : m.title ? [m.title] : []);
  if (r.errorMessage) messages.unshift(r.errorMessage);
  const status = (r.trackedDownloadStatus ?? "ok").toLowerCase();
  const failed = (r.status ?? "").toLowerCase() === "failed" || (r.trackedDownloadState ?? "").startsWith("failed");
  let title = r.title ?? "";
  let what: string | undefined;
  let libraryId: number | undefined;
  let slug: string | undefined;
  let poster: QueueEntry["poster"];
  if (kind === "sonarr") {
    title = r.series?.title ?? title;
    if (r.episode) {
      what = `${episodeCode(r.episode.seasonNumber, r.episode.episodeNumber)}${
        r.episode.title ? ` · ${r.episode.title}` : ""
      }`;
    }
    libraryId = r.seriesId ?? r.series?.id;
    slug = r.series?.titleSlug;
    poster = posterOf(r.series?.images);
  } else if (kind === "radarr") {
    title = r.movie ? `${r.movie.title}${r.movie.year ? ` (${r.movie.year})` : ""}` : title;
    libraryId = r.movieId ?? r.movie?.id;
    slug = r.movie?.titleSlug;
    poster = posterOf(r.movie?.images);
  } else {
    title = r.artist?.artistName ?? title;
    what = r.album?.title;
    libraryId = r.artistId ?? r.artist?.id;
    slug = r.artist?.foreignArtistId;
    poster = posterOf(r.artist?.images);
  }
  return {
    id: `${kind}:${r.id}`,
    queueId: r.id,
    kind,
    title: title || r.title || "Unknown",
    what,
    release: r.title ?? "",
    progress: size > 0 ? Math.max(0, Math.min(1, 1 - left / size)) : 0,
    size,
    left,
    eta: parseTimeLeft(r.timeleft) ??
      (r.estimatedCompletionTime
        ? Math.max(0, (Date.parse(r.estimatedCompletionTime) - Date.now()) / 1000) || undefined
        : undefined),
    status: r.status ?? "unknown",
    state: r.trackedDownloadState,
    health: failed || status === "error" ? "error" : status === "warning" ? "warning" : "ok",
    messages: [...new Set(messages)],
    client: r.downloadClient,
    indexer: r.indexer,
    protocol: r.protocol,
    quality: r.quality?.quality?.name,
    libraryId,
    slug,
    poster,
  };
}

/** What a queue item is doing, in words: Sonarr's status and tracked state. */
export function queueState(q: QueueEntry): { label: string; tint: Color; icon: string } {
  const state = q.state ?? "";
  if (q.health === "error") return { label: "Failed", tint: "red", icon: "bs-alert" };
  if (state === "importPending" || state === "importBlocked") {
    return { label: q.health === "warning" ? "Import blocked" : "Import pending", tint: "orange", icon: "bs-alert" };
  }
  if (state === "importing") return { label: "Importing", tint: "teal", icon: "bs-download" };
  if (q.health === "warning") return { label: "Warning", tint: "orange", icon: "bs-alert" };
  switch (q.status.toLowerCase()) {
    case "downloading":
      return { label: "Downloading", tint: "blue", icon: "bs-arrow-down" };
    case "paused":
      return { label: "Paused", tint: "gray", icon: "bs-pause" };
    case "queued":
      return { label: "Queued", tint: "gray", icon: "bs-clock" };
    case "completed":
      return { label: "Completed", tint: "green", icon: "bs-circle-check" };
    case "delay":
      return { label: "Delayed", tint: "gray", icon: "bs-hourglass" };
    case "downloadclientunavailable":
      return { label: "Client unavailable", tint: "red", icon: "bs-plug" };
    case "warning":
      return { label: "Warning", tint: "orange", icon: "bs-alert" };
    case "failed":
      return { label: "Failed", tint: "red", icon: "bs-alert" };
    default:
      return { label: q.status, tint: "gray", icon: "bs-circle" };
  }
}

type Color = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

/** Problems first, then downloads closest to done. */
export const sortQueue = (list: QueueEntry[]) =>
  [...list].sort((a, b) => {
    const rank = (q: QueueEntry) => (q.health === "error" ? 0 : q.health === "warning" ? 1 : 2);
    return rank(a) - rank(b) || (a.eta ?? Infinity) - (b.eta ?? Infinity) || b.progress - a.progress;
  });

// ---------------------------------------------------------------------------
// Formatting

export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  const v = n / 1000 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function duration(seconds: number | undefined): string {
  if (seconds === undefined) return "";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "12 missing episodes · 3 missing movies" for the command subtitle. */
export function missingLine(counts: Partial<Record<Kind, number>>): string | undefined {
  const parts = [
    counts.sonarr ? `${plural(counts.sonarr, "episode")}` : "",
    counts.radarr ? `${plural(counts.radarr, "movie")}` : "",
    counts.lidarr ? `${plural(counts.lidarr, "album")}` : "",
  ].filter(Boolean);
  return parts.length ? `Missing: ${parts.join(", ")}` : undefined;
}

/** Radarr before the wanted/missing API: monitored, released, and no file. */
export const missingMovies = (movies: Movie[]) =>
  movies.filter((m) => m.monitored && m.isAvailable && !m.hasFile).length;

// ---------------------------------------------------------------------------
// Lookup and add

export interface LookupResult {
  id: string;
  kind: Kind;
  title: string;
  year?: number;
  overview?: string;
  /** Already in the library: its id there. */
  libraryId?: number;
  slug?: string;
  network?: string;
  genres?: string[];
  status?: string;
  seasons?: number;
  runtime?: number;
  rating?: number;
  poster?: string;
  raw: Series | Movie | Artist;
}

const POSTER_HOST = new RegExp(`^https://(${POSTER_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")})/`);

export function fromLookup(kind: Kind, r: Series | Movie | Artist): LookupResult {
  const images = (r as Series).images;
  const remote = posterOf(images, (r as Series).remotePoster).remote;
  const base = {
    kind,
    overview: r.overview,
    libraryId: r.id && r.id > 0 ? r.id : undefined,
    genres: r.genres,
    poster: remote && POSTER_HOST.test(remote) ? remote : undefined,
    raw: r,
  };
  if (kind === "sonarr") {
    const s = r as Series;
    return {
      ...base,
      id: `sonarr:${s.tvdbId ?? s.title}`,
      title: s.title,
      year: s.year || undefined,
      slug: s.titleSlug,
      network: s.network,
      status: s.status,
      seasons: s.seasons?.filter((x) => x.seasonNumber > 0).length,
      runtime: s.runtime,
      rating: s.ratings?.value,
    };
  }
  if (kind === "radarr") {
    const m = r as Movie;
    return {
      ...base,
      id: `radarr:${m.tmdbId ?? m.title}`,
      title: m.title,
      year: m.year || undefined,
      slug: m.titleSlug,
      network: m.studio,
      runtime: m.runtime,
      rating: m.ratings?.tmdb?.value ?? m.ratings?.imdb?.value,
    };
  }
  const a = r as Artist;
  return {
    ...base,
    id: `lidarr:${a.foreignArtistId ?? a.artistName}`,
    title: a.disambiguation ? `${a.artistName} (${a.disambiguation})` : a.artistName,
    slug: a.foreignArtistId,
    status: a.artistType,
  };
}

export interface AddOptions {
  qualityProfileId: number;
  rootFolderPath: string;
  monitored: boolean;
  search: boolean;
  languageProfileId?: number;
  metadataProfileId?: number;
  /** Sonarr: which episodes to monitor ("all", "future", "firstSeason"…); Radarr: minimum availability. */
  monitor?: string;
}

/** The body of `POST /series`, `/movie` or `/artist`: the lookup result with the user's choices. */
export function addBody(kind: Kind, r: Series | Movie | Artist, o: AddOptions): Record<string, unknown> {
  const common = {
    ...r,
    qualityProfileId: o.qualityProfileId,
    rootFolderPath: o.rootFolderPath,
    monitored: o.monitored,
  };
  if (kind === "sonarr") {
    return {
      ...common,
      ...(o.languageProfileId ? { languageProfileId: o.languageProfileId } : {}),
      seasonFolder: true,
      seasons: ((r as Series).seasons ?? []).map((s) => ({
        seasonNumber: s.seasonNumber,
        monitored: o.monitored && s.seasonNumber > 0 && o.monitor !== "none",
      })),
      addOptions: {
        monitor: o.monitor ?? "all",
        searchForMissingEpisodes: o.search,
        searchForCutoffUnmetEpisodes: false,
      },
    };
  }
  if (kind === "radarr") {
    return {
      ...common,
      minimumAvailability: o.monitor ?? "released",
      addOptions: { monitor: o.monitored ? "movieOnly" : "none", searchForMovie: o.search },
    };
  }
  return {
    ...common,
    metadataProfileId: o.metadataProfileId,
    addOptions: { monitor: o.monitored ? "all" : "none", searchForMissingAlbums: o.search },
  };
}

/** The *arr apps answer validation failures as `[{ propertyName, errorMessage }]`. */
export function errorMessageOf(body: unknown): string | undefined {
  if (Array.isArray(body)) {
    const msgs = body.map((e) => (e as { errorMessage?: string })?.errorMessage).filter(Boolean);
    if (msgs.length) return [...new Set(msgs)].join("; ");
  }
  if (body && typeof body === "object") {
    const o = body as { message?: string; description?: string };
    if (o.message) return o.description ? `${o.message}: ${o.description}` : o.message;
  }
  return undefined;
}
