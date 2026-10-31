// AniList (GraphQL) and MyAnimeList (API v2): queries and parsing into one shape. No I/O.

/** Same list as `[permissions] net` in backslash.toml. */
export const HOSTS = ["graphql.anilist.co", "s4.anilist.co", "api.myanimelist.net", "cdn.myanimelist.net"];

export const ANILIST = "https://graphql.anilist.co";
export const MAL_API = "https://api.myanimelist.net/v2";

export type Source = "anilist" | "myanimelist";
export type TitleLanguage = "romaji" | "english" | "native";

export interface Settings {
  anilistUser?: string;
  anilistToken?: string;
  malUser?: string;
  malClientId?: string;
  titles: TitleLanguage;
  adult: boolean;
}

const clean = (v: unknown) => String(v ?? "").trim() || undefined;

export function settings(p: Record<string, unknown>): Settings {
  const t = String(p.titles ?? "").toLowerCase().trim();
  return {
    anilistUser: clean(p.anilistUser),
    anilistToken: clean(p.anilistToken)?.replace(/^bearer\s+/i, ""),
    malUser: clean(p.malUser),
    malClientId: clean(p.malClientId),
    titles: t === "english" || t === "native" ? t : "romaji",
    adult: p.adult === true,
  };
}

/** Which list to show: AniList when it is set (token or user name), else MyAnimeList. */
export function sourceOf(s: Settings): Source | undefined {
  if (s.anilistToken || s.anilistUser) return "anilist";
  if (s.malUser && s.malClientId) return "myanimelist";
  return undefined;
}

// ---------------------------------------------------------------------------
// GraphQL

const MEDIA = `
  id idMal type format status episodes chapters volumes duration
  title { romaji english native userPreferred }
  coverImage { large medium color }
  siteUrl averageScore popularity genres season seasonYear isAdult countryOfOrigin
  startDate { year month day }
  nextAiringEpisode { episode airingAt timeUntilAiring }
  studios(isMain: true) { nodes { name } }
`;

export const VIEWER_QUERY = `query { Viewer { id name } }`;

export const LIST_QUERY = `query ($userId: Int, $userName: String) {
  MediaListCollection(userId: $userId, userName: $userName, type: ANIME, status_in: [CURRENT, REPEATING]) {
    lists { entries { id status progress score(format: POINT_10_DECIMAL) updatedAt media { ${MEDIA} } } }
  }
}`;

export const SCHEDULE_QUERY = `query ($from: Int, $to: Int, $page: Int) {
  Page(page: $page, perPage: 50) {
    pageInfo { hasNextPage }
    airingSchedules(airingAt_greater: $from, airingAt_lesser: $to, sort: TIME) {
      id episode airingAt media { ${MEDIA} }
    }
  }
}`;

export const SEARCH_QUERY = `query ($search: String, $type: MediaType, $adult: Boolean) {
  Page(perPage: 25) {
    media(search: $search, type: $type, sort: SEARCH_MATCH, isAdult: $adult) {
      ${MEDIA}
      description(asHtml: false)
      mediaListEntry { id status progress }
    }
  }
}`;

/** Next airing episodes of MyAnimeList ids, looked up on AniList (no account needed). */
export const BY_MAL_QUERY = `query ($ids: [Int]) {
  Page(perPage: 50) { media(idMal_in: $ids, type: ANIME) { idMal siteUrl nextAiringEpisode { episode airingAt timeUntilAiring } } }
}`;

export const PROGRESS_MUTATION = `mutation ($id: Int, $progress: Int, $status: MediaListStatus) {
  SaveMediaListEntry(id: $id, progress: $progress, status: $status) { id progress status }
}`;

/** AniList's `{ errors: [{ message, status }] }` as a sentence, or undefined. */
export function anilistError(json: unknown, status?: number): string | undefined {
  const errors = (json as { errors?: { message?: string; status?: number }[] })?.errors;
  const first = Array.isArray(errors) ? errors[0] : undefined;
  if (!first && (!status || status < 400)) return undefined;
  const msg = first?.message ?? `error ${status}`;
  const code = first?.status ?? status;
  if (/invalid token|unauthorized/i.test(msg) || code === 401) {
    return "AniList refused the token: get a new one and paste it in Settings → Extensions → Anime";
  }
  if (code === 404 && /user/i.test(msg)) return "AniList: no user with that name, check it in Settings";
  if (code === 404) return "AniList: not found (is the list private? add a token)";
  if (code === 429) return "AniList asks to slow down: try again in a minute";
  return `AniList: ${msg}`;
}

// ---------------------------------------------------------------------------
// One shape

export interface Media {
  id: number;
  malId?: number;
  type: "ANIME" | "MANGA";
  title: string;
  /** Other titles, for search and the preview. */
  titles: string[];
  native?: string;
  format?: string;
  status?: string;
  episodes?: number;
  chapters?: number;
  cover?: string;
  color?: string;
  url: string;
  score?: number;
  genres: string[];
  season?: string;
  studio?: string;
  next?: { episode: number; at: number };
  adult: boolean;
  description?: string;
  /** Your list entry, from search results with a token. */
  entry?: { id: number; status: string; progress: number };
}

export interface Entry {
  source: Source;
  /** AniList list entry id (needed to save progress). */
  entryId?: number;
  status: string;
  progress: number;
  score?: number;
  updated?: number;
  media: Media;
}

const num = (v: unknown) => Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : undefined;
const cap = (s: string) => s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;

/** "TV_SHORT" → "TV Short", "ONA" → "ONA", "MOVIE" → "Movie". */
export function formatName(f?: string): string | undefined {
  if (!f) return undefined;
  if (["TV", "OVA", "ONA"].includes(f.toUpperCase())) return f.toUpperCase();
  return f.split("_").map((w) => (w === "TV" ? w : cap(w))).join(" ");
}

export function chooseTitle(t: Record<string, unknown> | undefined, lang: TitleLanguage): string {
  const o = t ?? {};
  const s = (k: string) => typeof o[k] === "string" && o[k] ? String(o[k]) : undefined;
  return (lang === "english" ? s("english") : lang === "native" ? s("native") : s("romaji")) ?? s("userPreferred") ??
    s("romaji") ?? s("english") ?? s("native") ?? "Untitled";
}

export function parseMedia(raw: unknown, lang: TitleLanguage): Media | undefined {
  const m = raw as Record<string, any>;
  if (!m || typeof m.id !== "number") return undefined;
  const title = chooseTitle(m.title, lang);
  const titles = [m.title?.romaji, m.title?.english, m.title?.native]
    .filter((t): t is string => typeof t === "string" && !!t && t !== title);
  const next = m.nextAiringEpisode;
  return {
    id: m.id,
    malId: num(m.idMal),
    type: m.type === "MANGA" ? "MANGA" : "ANIME",
    title,
    titles: [...new Set(titles)],
    native: m.title?.native ?? undefined,
    format: formatName(m.format),
    status: m.status ?? undefined,
    episodes: num(m.episodes),
    chapters: num(m.chapters),
    cover: m.coverImage?.large ?? m.coverImage?.medium ?? undefined,
    color: m.coverImage?.color ?? undefined,
    url: m.siteUrl ?? `https://anilist.co/${m.type === "MANGA" ? "manga" : "anime"}/${m.id}`,
    score: num(m.averageScore),
    genres: Array.isArray(m.genres) ? m.genres : [],
    season: m.season && m.seasonYear
      ? `${cap(m.season)} ${m.seasonYear}`
      : m.seasonYear
      ? String(m.seasonYear)
      : undefined,
    studio: m.studios?.nodes?.[0]?.name ?? undefined,
    next: next && num(next.airingAt) ? { episode: Number(next.episode), at: Number(next.airingAt) * 1000 } : undefined,
    adult: m.isAdult === true,
    description: m.description ? plain(m.description) : undefined,
    entry: m.mediaListEntry
      ? { id: m.mediaListEntry.id, status: m.mediaListEntry.status, progress: m.mediaListEntry.progress ?? 0 }
      : undefined,
  };
}

export function parseAniListCollection(json: unknown, lang: TitleLanguage): Entry[] {
  const lists = (json as any)?.data?.MediaListCollection?.lists;
  if (!Array.isArray(lists)) return [];
  const seen = new Set<number>();
  return lists.flatMap((l: any) => Array.isArray(l?.entries) ? l.entries : []).flatMap((e: any): Entry[] => {
    const media = parseMedia(e?.media, lang);
    if (!media || seen.has(media.id)) return [];
    seen.add(media.id);
    return [{
      source: "anilist",
      entryId: num(e.id),
      status: String(e.status ?? "CURRENT"),
      progress: num(e.progress) ?? 0,
      score: num(e.score) || undefined,
      updated: num(e.updatedAt) ? Number(e.updatedAt) * 1000 : undefined,
      media,
    }];
  });
}

export interface Airing {
  id: number;
  episode: number;
  at: number;
  media: Media;
}

export function parseSchedule(json: unknown, lang: TitleLanguage): { airing: Airing[]; more: boolean } {
  const page = (json as any)?.data?.Page;
  const list = Array.isArray(page?.airingSchedules) ? page.airingSchedules : [];
  const airing = list.flatMap((a: any): Airing[] => {
    const media = parseMedia(a?.media, lang);
    if (!media || !num(a.airingAt)) return [];
    return [{ id: Number(a.id), episode: Number(a.episode), at: Number(a.airingAt) * 1000, media }];
  });
  return { airing, more: page?.pageInfo?.hasNextPage === true };
}

export function parseSearch(json: unknown, lang: TitleLanguage): Media[] {
  const list = (json as any)?.data?.Page?.media;
  return (Array.isArray(list) ? list : []).flatMap((m) => parseMedia(m, lang) ?? []);
}

/** BY_MAL_QUERY → MyAnimeList id → next episode and the AniList page. */
export function parseByMal(json: unknown): Map<number, { next?: { episode: number; at: number }; url?: string }> {
  const out = new Map<number, { next?: { episode: number; at: number }; url?: string }>();
  const list = (json as any)?.data?.Page?.media;
  for (const m of Array.isArray(list) ? list : []) {
    if (!num(m?.idMal)) continue;
    const n = m.nextAiringEpisode;
    out.set(Number(m.idMal), {
      next: n && num(n.airingAt) ? { episode: Number(n.episode), at: Number(n.airingAt) * 1000 } : undefined,
      url: m.siteUrl,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// MyAnimeList

const MAL_FIELDS =
  "list_status,num_episodes,status,broadcast,mean,media_type,start_season,alternative_titles,genres,studios";

export function malListUrl(user: string): string {
  return `${MAL_API}/users/${
    encodeURIComponent(user)
  }/animelist?status=watching&sort=list_updated_at&limit=100&nsfw=true&fields=${MAL_FIELDS}`;
}

const MAL_STATUS: Record<string, string> = {
  currently_airing: "RELEASING",
  finished_airing: "FINISHED",
  not_yet_aired: "NOT_YET_RELEASED",
};

/** The next broadcast after `now` from MyAnimeList's day and time, which are in Japan time (UTC+9). */
export function nextBroadcast(day: unknown, time: unknown, now = Date.now()): number | undefined {
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const d = days.indexOf(String(day ?? "").toLowerCase());
  const m = String(time ?? "").match(/^(\d{1,2}):(\d{2})/);
  if (d < 0 || !m) return undefined;
  const jst = new Date(now + 9 * 3_600_000);
  const base = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate(), Number(m[1]), Number(m[2]));
  let t = base + ((d - jst.getUTCDay() + 7) % 7) * 86_400_000 - 9 * 3_600_000;
  if (t <= now) t += 7 * 86_400_000;
  return t;
}

export function parseMalList(json: unknown, lang: TitleLanguage, now = Date.now()): Entry[] {
  const data = (json as any)?.data;
  if (!Array.isArray(data)) return [];
  return data.flatMap((d: any): Entry[] => {
    const n = d?.node;
    if (!n || typeof n.id !== "number") return [];
    const alt = n.alternative_titles ?? {};
    const english = alt.en || undefined, native = alt.ja || undefined;
    const title = (lang === "english" ? english : lang === "native" ? native : undefined) ?? n.title ?? "Untitled";
    const status = MAL_STATUS[n.status] ?? undefined;
    const at = status === "RELEASING"
      ? nextBroadcast(n.broadcast?.day_of_the_week, n.broadcast?.start_time, now)
      : undefined;
    const ls = d.list_status ?? {};
    const progress = num(ls.num_episodes_watched) ?? 0;
    const season = n.start_season
      ? `${cap(String(n.start_season.season ?? ""))} ${n.start_season.year ?? ""}`.trim()
      : undefined;
    return [{
      source: "myanimelist",
      status: ls.is_rewatching ? "REPEATING" : "CURRENT",
      progress,
      score: num(ls.score) || undefined,
      updated: ls.updated_at ? Date.parse(ls.updated_at) : undefined,
      media: {
        id: n.id,
        malId: n.id,
        type: "ANIME",
        title,
        titles: [n.title, english, native].filter((t): t is string => !!t && t !== title),
        native,
        format: formatName(String(n.media_type ?? "").toUpperCase()),
        status,
        episodes: num(n.num_episodes) || undefined,
        cover: n.main_picture?.large ?? n.main_picture?.medium ?? undefined,
        url: `https://myanimelist.net/anime/${n.id}`,
        score: num(n.mean) !== undefined ? Math.round(Number(n.mean) * 10) : undefined,
        genres: Array.isArray(n.genres) ? n.genres.map((g: any) => String(g.name)) : [],
        season: season || undefined,
        studio: n.studios?.[0]?.name ?? undefined,
        // MyAnimeList doesn't number episodes ahead: guess the next one.
        next: at ? { episode: progress + 1, at } : undefined,
        adult: false,
      },
    }];
  });
}

/** Replaces the guessed next episodes of MyAnimeList entries with AniList's real ones. */
export function withAiring(entries: Entry[], byMal: ReturnType<typeof parseByMal>): Entry[] {
  return entries.map((e) => {
    const hit = e.media.malId ? byMal.get(e.media.malId) : undefined;
    if (!hit) return e;
    return {
      ...e,
      media: { ...e.media, next: hit.next ?? (e.media.status === "RELEASING" ? e.media.next : undefined) },
    };
  });
}

// ---------------------------------------------------------------------------
// Progress and time

/** Episodes out so far: the one before the next airing, or all of them. */
export function aired(m: Media): number | undefined {
  if (m.next) return Math.max(0, m.next.episode - 1);
  if (m.status === "FINISHED" || m.status === "CANCELLED") return m.episodes;
  return undefined;
}

/** Episodes out that you haven't watched. */
export function behind(e: Entry): number {
  const a = aired(e.media);
  return a === undefined ? 0 : Math.max(0, a - e.progress);
}

/** "3 / 12", "3 / ?" */
export const progressText = (e: Entry) => `${e.progress} / ${e.media.episodes ?? "?"}`;

/** "in 2d 4h", "in 3h 12m", "in 8m", "aired". */
export function countdown(at: number, now = Date.now()): string {
  const s = Math.round((at - now) / 1000);
  if (s <= 0) return "aired";
  const d = Math.floor(s / 86_400), h = Math.floor((s % 86_400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `in ${d}d ${h}h`;
  if (h) return `in ${h}h ${m}m`;
  return `in ${Math.max(1, m)}m`;
}

/** Ready to watch first (most episodes behind), then the next to air, then the rest by last update. */
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    const ba = behind(a), bb = behind(b);
    if (!!ba !== !!bb) return ba ? -1 : 1;
    if (ba && bb && ba !== bb) return bb - ba;
    const na = a.media.next?.at ?? Infinity, nb = b.media.next?.at ?? Infinity;
    if (na !== nb) return na - nb;
    return (b.updated ?? 0) - (a.updated ?? 0);
  });
}

/** What saving progress `p` should send: COMPLETED once the last episode is watched. */
export function progressUpdate(e: Entry, p: number): { progress: number; status?: string } {
  const total = e.media.episodes;
  const progress = Math.max(0, total ? Math.min(total, p) : p);
  return total && progress >= total && e.media.status === "FINISHED" ? { progress, status: "COMPLETED" } : { progress };
}

/** Local day header of a time: "Today", "Tomorrow", "Monday 2 November". */
export function dayHeader(at: number, now = Date.now()): string {
  const day = (t: number) => new Date(t).toDateString();
  if (day(at) === day(now)) return "Today";
  if (day(at) === day(now + 86_400_000)) return "Tomorrow";
  return new Date(at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export const clock = (at: number) => new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** AniList's cover color (#e4a15d) as a tint, roughly. */
export function tintOf(
  hex?: string,
): "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" | "gray" {
  const m = hex?.match(/^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return "gray";
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.12) return "gray";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return "red";
  if (h < 40) return "orange";
  if (h < 70) return "yellow";
  if (h < 160) return "green";
  if (h < 200) return "teal";
  if (h < 255) return "blue";
  if (h < 300) return "purple";
  return "pink";
}

/** Strips AniList's HTML-ish description to plain text. */
export function plain(html?: string): string {
  return String(html ?? "").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&").replace(/&#039;/g, "'").replace(/\n{3,}/g, "\n\n").trim();
}
