// TMDB answers → one compact `Title` shape, and their formatting. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// TMDB shapes (the fields we read)

/** A result of `/search/multi` or `/trending/all/week`. */
export interface TmdbResult {
  id: number;
  media_type?: "movie" | "tv" | "person" | string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  overview?: string;
  genre_ids?: number[];
  original_language?: string;
  popularity?: number;
  adult?: boolean;
}

interface Provider {
  provider_id: number;
  provider_name: string;
  logo_path?: string;
  display_priority?: number;
}

interface RegionProviders {
  link?: string;
  flatrate?: Provider[];
  free?: Provider[];
  ads?: Provider[];
  rent?: Provider[];
  buy?: Provider[];
}

interface Video {
  key: string;
  name?: string;
  site: string;
  type: string;
  official?: boolean;
  published_at?: string;
  iso_639_1?: string;
}

/** `/movie/{id}` or `/tv/{id}` with `append_to_response=credits,videos,watch/providers,…`. */
export interface TmdbDetails extends TmdbResult {
  genres?: { id: number; name: string }[];
  runtime?: number | null;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  tagline?: string;
  status?: string;
  imdb_id?: string | null;
  homepage?: string | null;
  created_by?: { name: string }[];
  networks?: { name: string }[];
  last_air_date?: string | null;
  next_episode_to_air?: { air_date?: string; season_number?: number; episode_number?: number; name?: string } | null;
  credits?: { cast?: { name: string; character?: string; order?: number }[]; crew?: { name: string; job: string }[] };
  aggregate_credits?: { cast?: { name: string; roles?: { character?: string }[]; order?: number }[] };
  videos?: { results?: Video[] };
  "watch/providers"?: { results?: Record<string, RegionProviders> };
  external_ids?: { imdb_id?: string | null };
  release_dates?: { results?: { iso_3166_1: string; release_dates: { certification?: string; type?: number }[] }[] };
  content_ratings?: { results?: { iso_3166_1: string; rating?: string }[] };
}

// ---------------------------------------------------------------------------
// Our shape

export type Kind = "movie" | "tv";

export interface Watch {
  link?: string;
  stream: string[];
  free: string[];
  rent: string[];
  buy: string[];
}

export interface Title {
  kind: Kind;
  id: number;
  title: string;
  originalTitle?: string;
  date?: string;
  year?: string;
  poster?: string;
  rating?: number;
  votes?: number;
  overview?: string;
  genres: string[];
  language?: string;
  /** Present once the details were loaded. */
  full?: boolean;
  tagline?: string;
  status?: string;
  runtime?: number;
  seasons?: number;
  episodes?: number;
  certification?: string;
  directors?: string[];
  cast?: { name: string; character?: string }[];
  trailer?: { key: string; name?: string };
  watch?: Watch;
  imdb?: string;
  homepage?: string;
  network?: string;
  nextEpisode?: string;
}

export const MOVIE_GENRES: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Science Fiction",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
};

export const TV_GENRES: Record<number, string> = {
  10759: "Action & Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  10762: "Kids",
  9648: "Mystery",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
  37: "Western",
};

export const IMAGE = "https://image.tmdb.org/t/p";
export const poster = (path: string | undefined, size: "w92" | "w185" | "w342" | "w500") =>
  path ? `${IMAGE}/${size}${path}` : undefined;

/** A search or trending result; undefined for people and nameless entries. */
export function fromResult(r: TmdbResult, kind?: Kind): Title | undefined {
  const k = (kind ?? r.media_type) as Kind;
  if (k !== "movie" && k !== "tv") return undefined;
  const title = (k === "movie" ? r.title : r.name) ?? r.title ?? r.name;
  if (!title) return undefined;
  const original = k === "movie" ? r.original_title : r.original_name;
  const date = (k === "movie" ? r.release_date : r.first_air_date) || undefined;
  const genres = k === "movie" ? MOVIE_GENRES : TV_GENRES;
  return {
    kind: k,
    id: r.id,
    title,
    originalTitle: original && original !== title ? original : undefined,
    date,
    year: date?.slice(0, 4),
    poster: r.poster_path ?? undefined,
    rating: r.vote_count ? r.vote_average : undefined,
    votes: r.vote_count,
    overview: r.overview || undefined,
    genres: (r.genre_ids ?? []).map((g) => genres[g]).filter(Boolean),
    language: r.original_language,
  };
}

/** Prefers an official YouTube trailer, then a teaser, then any YouTube video. */
export function pickTrailer(videos: Video[] | undefined): { key: string; name?: string } | undefined {
  const yt = (videos ?? []).filter((v) => v.site === "YouTube" && v.key);
  const rank = (v: Video) => (v.type === "Trailer" ? 0 : v.type === "Teaser" ? 2 : 4) + (v.official ? 0 : 1);
  const best =
    [...yt].sort((a, b) => rank(a) - rank(b) || (b.published_at ?? "").localeCompare(a.published_at ?? ""))[0];
  return best ? { key: best.key, name: best.name } : undefined;
}

const names = (list: Provider[] | undefined) =>
  [...(list ?? [])].sort((a, b) => (a.display_priority ?? 99) - (b.display_priority ?? 99)).map((p) => p.provider_name);

export function watchIn(details: TmdbDetails, region: string): Watch | undefined {
  const r = details["watch/providers"]?.results?.[region];
  if (!r) return undefined;
  return {
    link: r.link,
    stream: names(r.flatrate),
    free: [...new Set([...names(r.free), ...names(r.ads)])],
    rent: names(r.rent),
    buy: names(r.buy),
  };
}

/** A title with its details: runtime, cast, trailer, where to watch in `region`. */
export function fromDetails(d: TmdbDetails, kind: Kind, region: string): Title {
  const base = fromResult({ ...d, genre_ids: [] }, kind)!;
  const cast = kind === "tv" && d.aggregate_credits?.cast?.length
    ? d.aggregate_credits.cast.map((c) => ({ name: c.name, character: c.roles?.[0]?.character, order: c.order }))
    : (d.credits?.cast ?? []);
  const runtime = kind === "movie" ? d.runtime ?? undefined : d.episode_run_time?.[0];
  const certification = kind === "movie"
    ? d.release_dates?.results?.find((r) => r.iso_3166_1 === region)?.release_dates.map((x) => x.certification)
      .find(Boolean)
    : d.content_ratings?.results?.find((r) => r.iso_3166_1 === region)?.rating;
  const next = d.next_episode_to_air;
  return {
    ...base,
    full: true,
    genres: (d.genres ?? []).map((g) => g.name),
    tagline: d.tagline || undefined,
    status: d.status || undefined,
    runtime: runtime || undefined,
    seasons: d.number_of_seasons,
    episodes: d.number_of_episodes,
    certification: certification || undefined,
    directors: kind === "movie"
      ? (d.credits?.crew ?? []).filter((c) => c.job === "Director").map((c) => c.name)
      : (d.created_by ?? []).map((c) => c.name),
    cast: [...cast].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).slice(0, 5).map((c) => ({
      name: c.name,
      character: c.character || undefined,
    })),
    trailer: pickTrailer(d.videos?.results),
    watch: watchIn(d, region),
    imdb: d.imdb_id ?? d.external_ids?.imdb_id ?? undefined,
    homepage: d.homepage || undefined,
    network: d.networks?.[0]?.name,
    nextEpisode: next?.air_date
      ? `S${next.season_number}E${next.episode_number}${next.name ? ` “${next.name}”` : ""} · ${
        longDate(next.air_date)
      }`
      : undefined,
  };
}

// ---------------------------------------------------------------------------
// Formatting

/** 155 → "2 h 35 min". */
export function duration(minutes: number | undefined): string | undefined {
  if (!minutes) return undefined;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")} min` : ""}` : `${m} min`;
}

export const rating = (r: number | undefined) => (r === undefined ? "—" : r.toFixed(1));

export function ratingColor(r: number | undefined): Color | undefined {
  if (r === undefined) return undefined;
  return r >= 7.5 ? "green" : r >= 6 ? "yellow" : "red";
}

/** "2024-02-27" → "27 Feb 2024". */
export function longDate(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Movie · 2024 · 2 h 46 min" or "TV · 2019 · 4 seasons". */
export function summaryLine(t: Title): string {
  return [
    t.kind === "movie" ? "Movie" : "TV",
    t.year,
    t.kind === "movie" ? duration(t.runtime) : t.seasons ? plural(t.seasons, "season") : undefined,
  ].filter(Boolean).join(" · ");
}

export const tmdbUrl = (t: Pick<Title, "kind" | "id">) => `https://www.themoviedb.org/${t.kind}/${t.id}`;
export const youtubeUrl = (key: string) => `https://www.youtube.com/watch?v=${encodeURIComponent(key)}`;
export const imdbUrl = (id: string) => `https://www.imdb.com/title/${encodeURIComponent(id)}/`;

/** v4 read access tokens are JWTs; v3 keys are 32 hex characters. */
export function auth(token: string): { headers: Record<string, string>; param?: string } {
  const t = token.trim();
  if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(t)) return { headers: { Authorization: `Bearer ${t}` } };
  return { headers: {}, param: `api_key=${encodeURIComponent(t)}` };
}

/** `"fr"` → `"FR"`; anything else than two letters → `"US"`. */
export function normalizeRegion(input: unknown): string {
  const r = String(input ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(r) ? r : "US";
}

/** `"fr"` → `"fr-FR"`, `"pt-br"` → `"pt-BR"`; default en-US. */
export function normalizeLanguage(input: unknown): string {
  const l = String(input ?? "").trim();
  const m = /^([a-z]{2})(?:[-_]([a-z]{2}))?$/i.exec(l);
  if (!m) return "en-US";
  const lang = m[1].toLowerCase();
  return `${lang}-${(m[2] ?? (lang === "en" ? "US" : lang)).toUpperCase()}`;
}

/** Watchlist entries match the query on titles, original titles and genres. */
export function matches(t: Title, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [t.title, t.originalTitle ?? "", t.year ?? "", ...t.genres].some((s) => s.toLowerCase().includes(q));
}
