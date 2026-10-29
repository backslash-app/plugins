// LRC parsing, playerctl output, LRCLIB answers and what the views show. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// LRC

export interface Line {
  /** Seconds from the start of the track. */
  time: number;
  text: string;
}

export interface Lrc {
  lines: Line[];
  /** The `[offset:+500]` tag, in seconds (positive shows lines earlier). */
  offset: number;
  tags: Record<string, string>;
}

/** "01:02.5" → 62.5; "1:02.50" → 62.5; "01:02:345" (a colon before the fraction) → 62.345. */
export function stampSeconds(min: string, sec: string, frac?: string): number {
  const f = frac ? Number(frac) / 10 ** frac.length : 0;
  return Number(min) * 60 + Number(sec) + f;
}

/**
 * Parses LRC text: one or more `[mm:ss.xx]` stamps per line (a repeated
 * chorus), `[ar:…]`-style tags, `[offset:±ms]`, and the word timings of
 * enhanced LRC (`<mm:ss.xx>`), which are dropped. Lines come back sorted.
 */
export function parseLrc(text: string): Lrc {
  const lines: Line[] = [];
  const tags: Record<string, string> = {};
  let offset = 0;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const row = raw.trim();
    if (!row) continue;
    const tag = row.match(/^\[([a-z#]+):([^\]]*)\]$/i);
    if (tag && !/^\d+$/.test(tag[1])) {
      const key = tag[1].toLowerCase();
      tags[key] = tag[2].trim();
      if (key === "offset") offset = (Number(tag[2].trim()) || 0) / 1000;
      continue;
    }
    const times: number[] = [];
    let rest = row;
    while (true) {
      const m = rest.match(/^\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/);
      if (!m) break;
      times.push(stampSeconds(m[1], m[2], m[3]));
      rest = rest.slice(m[0].length);
    }
    if (!times.length) continue;
    const words = rest.replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, "").replace(/\s+/g, " ").trim();
    for (const time of times) lines.push({ time, text: words });
  }
  lines.sort((a, b) => a.time - b.time);
  return { lines, offset, tags };
}

/** Whether text has LRC timestamps at all. */
export const isSynced = (text: string | null | undefined) =>
  !!text && /^\s*\[\d{1,3}:\d{1,2}([.:]\d{1,3})?\]/m.test(text);

/** The plain text of LRC: stamps and tags removed. */
export function lrcToPlain(text: string): string {
  return parseLrc(text).lines.map((l) => l.text).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** The index of the line sung at `position` seconds, or -1 before the first one. */
export function currentIndex(lines: Line[], position: number): number {
  let lo = 0, hi = lines.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= position) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// ---------------------------------------------------------------------------
// playerctl

export interface Track {
  player: string;
  status: "Playing" | "Paused" | "Stopped";
  artist: string;
  title: string;
  album: string;
  /** Seconds; 0 when unknown. */
  length: number;
  /** Seconds. */
  position: number;
}

export const SEP = "\x1f";

/** The `--format` given to `playerctl -a metadata`: one line per player. */
export const PLAYERCTL_FORMAT = [
  "{{playerName}}",
  "{{status}}",
  "{{artist}}",
  "{{title}}",
  "{{album}}",
  "{{mpris:length}}",
  "{{position}}",
].join(SEP);

/** Lines printed with {@link PLAYERCTL_FORMAT}; players without a title are skipped. */
export function parsePlayerctl(out: string): Track[] {
  const tracks: Track[] = [];
  for (const line of out.split("\n")) {
    const f = line.split(SEP);
    if (f.length < 7) continue;
    const [player, status, artist, title, album, length, position] = f;
    if (!title.trim()) continue;
    tracks.push({
      player: player.trim(),
      status: (["Playing", "Paused"].includes(status.trim()) ? status.trim() : "Stopped") as Track["status"],
      artist: artist.trim(),
      title: title.trim(),
      album: album.trim(),
      length: (Number(length) || 0) / 1_000_000,
      position: (Number(position) || 0) / 1_000_000,
    });
  }
  return tracks;
}

/** The track to show: the preferred player's, else one playing, else the first paused. */
export function pickTrack(tracks: Track[], preferred = ""): Track | undefined {
  const want = preferred.trim().toLowerCase();
  if (want) {
    const own = tracks.find((t) => t.player.toLowerCase().startsWith(want));
    if (own) return own;
  }
  const rank = { Playing: 0, Paused: 1, Stopped: 2 };
  return [...tracks].sort((a, b) => rank[a.status] - rank[b.status])[0];
}

/** Two snapshots of the same song (a seek or a pause changes nothing). */
export const sameSong = (a: Track | undefined, b: Track | undefined) =>
  !!a && !!b && a.player === b.player && a.title === b.title && a.artist === b.artist;

// ---------------------------------------------------------------------------
// LRCLIB

export interface LrcRecord {
  id: number;
  trackName: string;
  artistName: string;
  albumName?: string | null;
  duration?: number | null;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

export const LRCLIB = "https://lrclib.net/api";

/**
 * What players add to titles and LRCLIB doesn't have: "Song - Remastered
 * 2011", "Song (feat. X)", "Song [Official Video]", "Song - Live at …".
 */
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([](?:feat\.?|ft\.?|featuring|with)\s[^)\]]*[)\]]/gi, "")
    .replace(
      /\s*[([][^)\]]*(?:official|video|audio|lyrics?|visuali[sz]er|remaster(?:ed)?|hd|hq|4k|mv)[^)\]]*[)\]]/gi,
      "",
    )
    .replace(/\s+-\s+(?:\d{4}\s+)?(?:remaster(?:ed)?|live|mono|stereo|single|radio edit|edit|version|mix)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim() || title.trim();
}

/** "Artist - Topic", "ArtistVEVO", "A, B", "A feat. B" → the main artist as LRCLIB knows it. */
export function cleanArtist(artist: string): string {
  return artist
    .replace(/\s+-\s+topic$/i, "")
    .replace(/vevo$/i, "")
    .split(/\s*(?:,|;|\/|\s(?:feat\.?|ft\.?|featuring)\s)\s*/i)[0]
    .trim() || artist.trim();
}

/** Browsers playing a video report "Artist - Title" as the title, with no artist. */
export function splitVideoTitle(t: Pick<Track, "artist" | "title">): { artist: string; title: string } {
  if (t.artist.trim()) return { artist: t.artist, title: t.title };
  const m = t.title.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  return m ? { artist: m[1], title: m[2] } : { artist: "", title: t.title };
}

/** `/api/get`: an exact match, the duration within 2 seconds. */
export function getUrl(t: { artist: string; title: string; album?: string; length?: number }): string {
  const p = new URLSearchParams({ artist_name: t.artist, track_name: t.title });
  if (t.album) p.set("album_name", t.album);
  if (t.length) p.set("duration", String(Math.round(t.length)));
  return `${LRCLIB}/get?${p}`;
}

export function searchUrl(q: { q?: string; artist?: string; title?: string }): string {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.title) p.set("track_name", q.title);
  if (q.artist) p.set("artist_name", q.artist);
  return `${LRCLIB}/search?${p}`;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The best search result for a track: same title and artist, close duration, synced lyrics preferred. */
export function bestMatch(results: LrcRecord[], t: { artist: string; title: string; length?: number }) {
  const title = norm(cleanTitle(t.title));
  const artist = norm(cleanArtist(t.artist));
  let best: { r: LrcRecord; score: number } | undefined;
  for (const r of results) {
    let score = 0;
    const rt = norm(r.trackName), ra = norm(r.artistName);
    if (rt === title) score += 10;
    else if (rt.includes(title) || title.includes(rt)) score += 5;
    else continue;
    if (artist && (ra === artist)) score += 8;
    else if (artist && (ra.includes(artist) || artist.includes(ra))) score += 4;
    else if (artist) score -= 6;
    if (t.length && r.duration) {
      const d = Math.abs(r.duration - t.length);
      score += d <= 2 ? 4 : d <= 6 ? 2 : d > 20 ? -4 : 0;
    }
    if (r.syncedLyrics) score += 3;
    else if (r.plainLyrics) score += 1;
    else if (!r.instrumental) score -= 5;
    if (!best || score > best.score) best = { r, score };
  }
  return best && best.score >= 8 ? best.r : undefined;
}

/** The storage key of a track's lyrics. */
export const lyricsKey = (artist: string, title: string) =>
  `lyrics:${norm(cleanArtist(artist))}|${norm(cleanTitle(title))}`;

// ---------------------------------------------------------------------------
// Formatting

/** 83.4 → "1:23". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Escapes Markdown in a lyric line so `*` and `_` stay text. */
export const escapeMd = (s: string) => s.replace(/([\\`*_[\]#<>|])/g, "\\$1");

/** The whole lyrics, the line sung now in bold with a marker. */
export function lyricsMarkdown(lines: Line[], current: number, heading?: string): string {
  const body = lines.map((l, i) => {
    const text = l.text ? escapeMd(l.text) : "♪";
    return i === current ? `**▶ ${text}**` : text;
  });
  return [heading ? `## ${escapeMd(heading)}\n` : "", ...body.map((b) => `${b}  `)].join("\n").trim();
}

/** Plain lyrics as Markdown with line breaks kept. */
export function plainMarkdown(text: string, heading?: string): string {
  const body = text.split("\n").map((l) => (l.trim() ? `${escapeMd(l.trim())}  ` : ""));
  return [heading ? `## ${escapeMd(heading)}\n` : "", ...body].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * The lines the live view shows around `current`: a few already sung, the
 * current one, and the rest. Indices into `lines`.
 */
export function windowAround(count: number, current: number, before = 2): { start: number; end: number } {
  return { start: Math.max(0, current - before), end: count };
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

export function installCommand(family: Family | undefined, pkg = "playerctl"): string {
  return family ? `${MANAGERS[family]} ${pkg}` : `Install ${pkg} with your package manager`;
}
