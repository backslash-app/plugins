// Last.fm and ListenBrainz: URLs and parsing into one shape for the views. No I/O.

/** Same list as `[permissions] net` in backslash.toml. */
export const HOSTS = [
  "ws.audioscrobbler.com",
  "lastfm.freetls.fastly.net",
  "api.listenbrainz.org",
  "coverartarchive.org",
  "archive.org",
  "*.archive.org",
];

export type Service = "lastfm" | "listenbrainz";

export const SERVICES: Record<Service, { title: string; site: string }> = {
  lastfm: { title: "Last.fm", site: "https://www.last.fm" },
  listenbrainz: { title: "ListenBrainz", site: "https://listenbrainz.org" },
};

export interface Settings {
  lastfmUser?: string;
  lastfmKey?: string;
  listenbrainzUser?: string;
  period: Period;
  /** Which service the top charts use when both are set. */
  primary: Service;
}

export type Period = "week" | "month" | "year" | "all";

export const PERIODS: Record<Period, { title: string; lastfm: string; listenbrainz: string }> = {
  week: { title: "this week", lastfm: "7day", listenbrainz: "week" },
  month: { title: "this month", lastfm: "1month", listenbrainz: "month" },
  year: { title: "this year", lastfm: "12month", listenbrainz: "year" },
  all: { title: "all time", lastfm: "overall", listenbrainz: "all_time" },
};

const clean = (v: unknown) => String(v ?? "").trim() || undefined;

export function settings(p: Record<string, unknown>): Settings {
  const period = String(p.period ?? "week").toLowerCase().trim();
  const lastfmUser = clean(p.lastfmUser), listenbrainzUser = clean(p.listenbrainzUser);
  const wantsLb = String(p.primary ?? "").toLowerCase().replace(/[^a-z]/g, "") === "listenbrainz";
  const lastfmKey = clean(p.lastfmKey);
  const hasLastfm = !!(lastfmUser && lastfmKey);
  return {
    lastfmUser,
    lastfmKey,
    listenbrainzUser,
    period: (period in PERIODS ? period : "week") as Period,
    primary: (wantsLb && listenbrainzUser) || !hasLastfm ? "listenbrainz" : "lastfm",
  };
}

/** The services with what they need set, the primary one first. */
export function services(s: Settings): Service[] {
  const out: Service[] = [];
  if (s.lastfmUser && s.lastfmKey) out.push("lastfm");
  if (s.listenbrainzUser) out.push("listenbrainz");
  return out.sort((a, b) => (a === s.primary ? -1 : b === s.primary ? 1 : 0));
}

// ---------------------------------------------------------------------------
// One shape for both

export interface Track {
  artist: string;
  title: string;
  album?: string;
  /** ms since epoch; undefined while playing. */
  at?: number;
  playing: boolean;
  image?: string;
  url?: string;
  loved?: boolean;
  recordingMbid?: string;
}

export type Kind = "artists" | "tracks" | "albums";

export interface Top {
  kind: Kind;
  rank: number;
  name: string;
  /** The artist of a track or album. */
  artist?: string;
  plays: number;
  image?: string;
  url?: string;
  mbid?: string;
}

// ---------------------------------------------------------------------------
// Last.fm

const LASTFM = "https://ws.audioscrobbler.com/2.0/";

export function lastfmUrl(method: string, s: Settings, params: Record<string, string | number> = {}): string {
  const q = new URLSearchParams({
    method,
    user: s.lastfmUser ?? "",
    api_key: s.lastfmKey ?? "",
    format: "json",
    ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
  });
  return `${LASTFM}?${q}`;
}

/** Last.fm's grey star stands for "no picture". */
const PLACEHOLDER = "2a96cbd8b46e442fc41c2b86b821562f";

/** The biggest real picture of a Last.fm `image` array. */
export function lastfmImage(images: unknown): string | undefined {
  if (!Array.isArray(images)) return undefined;
  const order = ["mega", "extralarge", "large", "medium", "small"];
  const sorted = [...images].sort((a, b) => order.indexOf(a?.size) - order.indexOf(b?.size));
  for (const i of sorted) {
    const url = String(i?.["#text"] ?? "");
    if (url && !url.includes(PLACEHOLDER)) return url.replace(/^http:/, "https:");
  }
  return undefined;
}

/** A Last.fm field that is sometimes one object, sometimes a list. */
const many = <T>(v: T | T[] | undefined): T[] => v === undefined ? [] : Array.isArray(v) ? v : [v];

const text = (v: unknown): string => {
  if (typeof v === "string") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return String(o["#text"] ?? o.name ?? "");
  }
  return "";
};

/** Last.fm says what went wrong in `{ error, message }`. */
export function lastfmError(json: unknown): string | undefined {
  const o = json as { error?: number; message?: string };
  if (!o || typeof o.error !== "number") return undefined;
  if (o.error === 10 || o.error === 26) {
    return "Last.fm refused the API key: check it in Settings → Extensions → Scrobbles";
  }
  if (o.error === 6) return `Last.fm: ${o.message ?? "user not found"}`;
  if (o.error === 17) return "Last.fm: this profile's listening history is private";
  if (o.error === 29) return "Last.fm asks to slow down: try again in a minute";
  return `Last.fm: ${o.message ?? `error ${o.error}`}`;
}

/** user.getrecenttracks (with extended=1 or not) → tracks, now playing first. */
export function parseLastfmRecent(json: unknown): { tracks: Track[]; total?: number } {
  const r = (json as { recenttracks?: { track?: unknown; "@attr"?: { total?: string } } })?.recenttracks;
  if (!r) return { tracks: [] };
  const tracks = many(r.track as Record<string, unknown>[]).flatMap((t): Track[] => {
    const title = text(t.name);
    const artist = text(t.artist);
    if (!title || !artist) return [];
    const playing = (t["@attr"] as { nowplaying?: string })?.nowplaying === "true";
    const uts = Number((t.date as { uts?: string })?.uts);
    return [{
      artist,
      title,
      album: text(t.album) || undefined,
      at: playing || !Number.isFinite(uts) ? undefined : uts * 1000,
      playing,
      image: lastfmImage(t.image),
      url: t.url ? String(t.url) : undefined,
      loved: t.loved === "1",
      recordingMbid: t.mbid ? String(t.mbid) : undefined,
    }];
  });
  const total = Number(r["@attr"]?.total);
  return { tracks, total: Number.isFinite(total) ? total : undefined };
}

/** user.gettopartists / gettoptracks / gettopalbums → ranked entries. */
export function parseLastfmTop(json: unknown, kind: Kind): Top[] {
  const key = { artists: ["topartists", "artist"], tracks: ["toptracks", "track"], albums: ["topalbums", "album"] }[
    kind
  ];
  const box = (json as Record<string, Record<string, unknown>>)?.[key[0]];
  return many(box?.[key[1]] as Record<string, unknown>[]).flatMap((e, i): Top[] => {
    const name = text(e.name);
    if (!name) return [];
    const rank = Number((e["@attr"] as { rank?: string })?.rank);
    return [{
      kind,
      rank: Number.isFinite(rank) ? rank : i + 1,
      name,
      artist: kind === "artists" ? undefined : text(e.artist) || undefined,
      plays: Number(e.playcount) || 0,
      image: lastfmImage(e.image),
      url: e.url ? String(e.url) : undefined,
      mbid: e.mbid ? String(e.mbid) : undefined,
    }];
  });
}

// ---------------------------------------------------------------------------
// ListenBrainz

const LB = "https://api.listenbrainz.org/1";

export const lbListensUrl = (user: string, count = 50) =>
  `${LB}/user/${encodeURIComponent(user)}/listens?count=${count}`;
export const lbPlayingNowUrl = (user: string) => `${LB}/user/${encodeURIComponent(user)}/playing-now`;
export function lbStatsUrl(user: string, kind: Kind, period: Period, count = 25): string {
  const path = { artists: "artists", tracks: "recordings", albums: "release-groups" }[kind];
  return `${LB}/stats/user/${encodeURIComponent(user)}/${path}?range=${PERIODS[period].listenbrainz}&count=${count}`;
}

/** A Cover Art Archive thumbnail from ListenBrainz's mapping (caa_id + caa_release_mbid). */
export function caaThumb(release?: unknown, caaId?: unknown): string | undefined {
  if (!release || typeof release !== "string") return undefined;
  if (caaId !== undefined && caaId !== null && /^\d+$/.test(String(caaId))) {
    return `https://archive.org/download/mbid-${release}/mbid-${release}-${caaId}_thumb250.jpg`;
  }
  return `https://coverartarchive.org/release/${release}/front-250`;
}

interface LbMeta {
  artist_name?: string;
  track_name?: string;
  release_name?: string;
  additional_info?: Record<string, unknown>;
  mbid_mapping?: {
    recording_mbid?: string;
    release_mbid?: string;
    caa_id?: number;
    caa_release_mbid?: string;
    recording_name?: string;
    artist_credit_name?: string;
  };
}

function lbTrack(
  l: { listened_at?: number; playing_now?: boolean; track_metadata?: LbMeta },
  playing: boolean,
): Track[] {
  const m = l.track_metadata ?? {};
  const artist = m.mbid_mapping?.artist_credit_name ?? m.artist_name;
  const title = m.track_name ?? m.mbid_mapping?.recording_name;
  if (!artist || !title) return [];
  const mbid = m.mbid_mapping?.recording_mbid ?? (m.additional_info?.recording_mbid as string | undefined);
  const release = m.mbid_mapping?.caa_release_mbid ?? m.mbid_mapping?.release_mbid ??
    (m.additional_info?.release_mbid as string | undefined);
  return [{
    artist,
    title,
    album: m.release_name || undefined,
    at: playing || !l.listened_at ? undefined : l.listened_at * 1000,
    playing,
    image: caaThumb(release, m.mbid_mapping?.caa_id),
    url: mbid ? `https://musicbrainz.org/recording/${mbid}` : undefined,
    recordingMbid: mbid,
  }];
}

/** /user/<name>/listens → tracks. */
export function parseLbListens(json: unknown): Track[] {
  const listens = (json as { payload?: { listens?: unknown } })?.payload?.listens;
  return (Array.isArray(listens) ? listens : []).flatMap((l) => lbTrack(l, false));
}

/** /user/<name>/playing-now → the track, if any. */
export function parseLbPlayingNow(json: unknown): Track | undefined {
  const listens = (json as { payload?: { listens?: unknown } })?.payload?.listens;
  return (Array.isArray(listens) ? listens : []).flatMap((l) => lbTrack(l, true))[0];
}

/** /stats/user/<name>/{artists,recordings,release-groups} → ranked entries. */
export function parseLbStats(json: unknown, kind: Kind): Top[] {
  const p = (json as { payload?: Record<string, unknown> })?.payload;
  const list = p?.[{ artists: "artists", tracks: "recordings", albums: "release_groups" }[kind]];
  return (Array.isArray(list) ? list : []).flatMap((e: Record<string, unknown>, i): Top[] => {
    const name = String(
      (kind === "artists" ? e.artist_name : kind === "tracks" ? e.track_name : e.release_group_name) ?? "",
    );
    if (!name) return [];
    const mbid = String(
      (kind === "artists"
        ? e.artist_mbid ?? (e.artist_mbids as string[] | undefined)?.[0]
        : kind === "tracks"
        ? e.recording_mbid
        : e.release_group_mbid) ?? "",
    ) || undefined;
    const path = kind === "artists" ? "artist" : kind === "tracks" ? "recording" : "release-group";
    return [{
      kind,
      rank: i + 1,
      name,
      artist: kind === "artists" ? undefined : String(e.artist_name ?? "") || undefined,
      plays: Number(e.listen_count) || 0,
      image: kind === "artists" ? undefined : caaThumb(e.caa_release_mbid ?? e.release_mbid, e.caa_id),
      url: mbid ? `https://musicbrainz.org/${path}/${mbid}` : undefined,
      mbid,
    }];
  });
}

// ---------------------------------------------------------------------------
// Formatting

/** "just now", "12 min ago", "3 h ago", "yesterday", "5 Oct". */
export function ago(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "now";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86_400) return "yesterday";
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)} days ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Day headers for the recent list: "Today", "Yesterday", "Monday 26 October". */
export function dayLabel(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "Now playing";
  const day = (t: number) => new Date(t).toDateString();
  if (day(ms) === day(now)) return "Today";
  if (day(ms) === day(now - 86_400_000)) return "Yesterday";
  return new Date(ms).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

export const plays = (n: number) => `${n.toLocaleString("en")} play${n === 1 ? "" : "s"}`;

export const trackLine = (t: { artist?: string; title?: string; name?: string }) =>
  `${t.artist ? `${t.artist} – ` : ""}${t.title ?? t.name ?? ""}`;

/** Where to look a track or artist up elsewhere. */
export function searchLinks(q: string): { title: string; url: string }[] {
  const e = encodeURIComponent(q);
  return [
    { title: "Search on YouTube", url: `https://www.youtube.com/results?search_query=${e}` },
    { title: "Search on Spotify", url: `https://open.spotify.com/search/${e}` },
    { title: "Search on Bandcamp", url: `https://bandcamp.com/search?q=${e}` },
  ];
}

export function lastfmProfile(user: string): string {
  return `https://www.last.fm/user/${encodeURIComponent(user)}`;
}

export function lbProfile(user: string): string {
  return `https://listenbrainz.org/user/${encodeURIComponent(user)}/`;
}

/** A track's page on Last.fm from its artist and title, when the API gave none. */
export function lastfmTrackUrl(artist: string, title: string): string {
  const e = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
  return `https://www.last.fm/music/${e(artist)}/_/${e(title)}`;
}
