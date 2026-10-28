// Podcast feeds (RSS with the iTunes tags), Apple Podcasts search results,
// playback progress, the mpv command line and formatting. Pure, tested in lib_test.ts.

import { child, children, decodeEntities, htmlToText, parseDate, parseXml, textOf, type XmlNode } from "./xml.ts";

export { ago, fullDate, htmlToMarkdown, htmlToText } from "./xml.ts";

// ---------------------------------------------------------------------------
// Shows and episodes

export interface Show {
  feedUrl: string;
  title: string;
  author?: string;
  artwork?: string;
  link?: string;
  description?: string;
  genres?: string[];
  /** Apple Podcasts id, for its page. */
  itunesId?: number;
  episodeCount?: number;
  lastRelease?: number;
}

export interface Episode {
  /** The guid (or the audio URL): stable within its feed. */
  id: string;
  feedUrl: string;
  show: string;
  title: string;
  date?: number;
  /** Seconds. */
  duration?: number;
  audio: string;
  type?: string;
  bytes?: number;
  image?: string;
  /** HTML show notes. */
  notes: string;
  link?: string;
  season?: number;
  number?: number;
  explicit?: boolean;
  /** "full", "trailer" or "bonus". */
  kind?: string;
}

/** `itunes:duration`: "1:02:03", "62:10", "3723", "3723.5". */
export function parseDuration(raw: string | undefined): number | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(Number(s)) || undefined;
  const parts = s.split(":").map(Number);
  if (parts.length > 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return parts.reduce((total, p) => total * 60 + p, 0) || undefined;
}

function resolve(href: string | undefined, base?: string): string | undefined {
  const h = href?.trim();
  if (!h) return undefined;
  try {
    return new URL(h, base).href;
  } catch {
    return undefined;
  }
}

const image = (n: XmlNode | undefined, base?: string) =>
  resolve(child(n, "itunes:image")?.attrs.href ?? textOf(child(child(n, "image"), "url")), base);

const int = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : undefined);

function episodeOf(it: XmlNode, show: Show, base: string): Episode | undefined {
  const enclosure = child(it, "enclosure") ?? child(it, "media:content");
  const audio = resolve(enclosure?.attrs.url, base);
  if (!audio) return undefined;
  const title = htmlToText(textOf(child(it, "title", "itunes:title")));
  const notes = textOf(child(it, "content:encoded")) || textOf(child(it, "description")) ||
    textOf(child(it, "itunes:summary"));
  const bytes = Number(enclosure?.attrs.length);
  return {
    id: textOf(child(it, "guid")) || audio,
    feedUrl: show.feedUrl,
    show: show.title,
    title: title || "Untitled episode",
    date: parseDate(textOf(child(it, "pubDate", "dc:date"))),
    duration: parseDuration(textOf(child(it, "itunes:duration"))) ??
      parseDuration(enclosure?.attrs.duration),
    audio,
    type: enclosure?.attrs.type,
    bytes: Number.isFinite(bytes) && bytes > 1000 ? bytes : undefined,
    image: image(it, base) ?? show.artwork,
    notes,
    link: resolve(textOf(child(it, "link")), base),
    season: int(textOf(child(it, "itunes:season"))),
    number: int(textOf(child(it, "itunes:episode"))),
    explicit: /^(yes|true|explicit)$/i.test(textOf(child(it, "itunes:explicit"))) || undefined,
    kind: textOf(child(it, "itunes:episodeType")).toLowerCase() || undefined,
  };
}

/** A podcast RSS feed: the show and its episodes (those with audio), newest first. */
export function parsePodcast(xml: string, feedUrl: string): { show: Show; episodes: Episode[] } {
  const doc = parseXml(xml);
  const rss = doc.children.find((c) => c.name.toLowerCase() === "rss");
  const channel = child(rss, "channel");
  if (!channel) throw new Error("Not a podcast feed (no RSS channel)");
  const link = resolve(textOf(child(channel, "link")), feedUrl);
  const categories = [...children(channel, "itunes:category")].map((c) => decodeEntities(c.attrs.text ?? ""))
    .filter(Boolean);
  const show: Show = {
    feedUrl,
    title: htmlToText(textOf(child(channel, "title", "itunes:title"))) || new URL(feedUrl).hostname,
    author: htmlToText(textOf(child(channel, "itunes:author", "author", "managingEditor"))) || undefined,
    artwork: image(channel, feedUrl),
    link,
    description: textOf(child(channel, "description", "itunes:summary")) || undefined,
    genres: categories.length ? [...new Set(categories)] : undefined,
  };
  const episodes = children(channel, "item")
    .map((it) => episodeOf(it, show, link ?? feedUrl))
    .filter((e): e is Episode => !!e)
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0));
  show.episodeCount = episodes.length;
  show.lastRelease = episodes[0]?.date;
  return { show, episodes };
}

// ---------------------------------------------------------------------------
// Apple Podcasts search

export interface ItunesResult {
  collectionId?: number;
  collectionName?: string;
  trackName?: string;
  artistName?: string;
  feedUrl?: string;
  artworkUrl600?: string;
  artworkUrl100?: string;
  primaryGenreName?: string;
  genres?: string[];
  trackCount?: number;
  releaseDate?: string;
  collectionViewUrl?: string;
}

export const searchUrl = (term: string, country = "") =>
  `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=30&term=${encodeURIComponent(term)}${
    /^[a-z]{2}$/i.test(country) ? `&country=${country.toLowerCase()}` : ""
  }`;

/** Search results with a feed (some shows are Apple-only), as shows. */
export function itunesShows(json: { results?: ItunesResult[] }): Show[] {
  const seen = new Set<string>();
  return (json.results ?? []).flatMap((r) => {
    if (!r.feedUrl || seen.has(r.feedUrl)) return [];
    seen.add(r.feedUrl);
    const released = r.releaseDate ? Date.parse(r.releaseDate) : NaN;
    return [{
      feedUrl: r.feedUrl,
      title: r.collectionName ?? r.trackName ?? "Podcast",
      author: r.artistName,
      artwork: r.artworkUrl600 ?? r.artworkUrl100,
      genres: (r.genres ?? (r.primaryGenreName ? [r.primaryGenreName] : [])).filter((g) => g !== "Podcasts"),
      itunesId: r.collectionId,
      episodeCount: r.trackCount,
      lastRelease: Number.isFinite(released) ? released : undefined,
      link: r.collectionViewUrl,
    }];
  });
}

// ---------------------------------------------------------------------------
// Progress

export interface Progress {
  /** Seconds. */
  position: number;
  duration?: number;
  played?: boolean;
  updated: number;
}

export const episodeKey = (e: Pick<Episode, "feedUrl" | "id">) => `${e.feedUrl}#${e.id}`;

/** The last minute counts as the end: outros and ads. */
export function isFinished(position: number, duration: number | undefined): boolean {
  return !!duration && duration > 0 && position >= duration - Math.min(60, duration * 0.05);
}

/** Where to start: the saved position minus a few seconds of context; 0 when played or nearly done. */
export function resumeAt(p: Progress | undefined): number {
  if (!p || p.played || p.position < 30 || isFinished(p.position, p.duration)) return 0;
  return Math.max(0, Math.floor(p.position - 5));
}

export type EpisodeState = "new" | "inProgress" | "played";

export function stateOf(p: Progress | undefined): EpisodeState {
  if (p?.played) return "played";
  if (p && p.position >= 30) return "inProgress";
  return "new";
}

/** Keeps the progress map small: the `max` most recently updated. */
export function pruneProgress(all: Record<string, Progress>, max = 600): Record<string, Progress> {
  const entries = Object.entries(all);
  if (entries.length <= max) return all;
  return Object.fromEntries(entries.sort((a, b) => b[1].updated - a[1].updated).slice(0, max));
}

/** The position file written by the mpv script → progress. */
export function parsePositionFile(
  text: string | undefined,
): { position: number; duration?: number; ended: boolean; paused: boolean } | undefined {
  if (!text) return undefined;
  try {
    const j = JSON.parse(text);
    if (typeof j.position !== "number") return j.ended ? { position: 0, ended: true, paused: false } : undefined;
    return {
      position: j.position,
      duration: typeof j.duration === "number" ? j.duration : undefined,
      ended: !!j.ended,
      paused: !!j.paused,
    };
  } catch {
    return undefined;
  }
}

/** New episodes across subscriptions: unplayed, of the last `days`, newest first. */
export function newEpisodes(
  episodes: Episode[],
  progress: Record<string, Progress>,
  o: { now?: number; days?: number; limit?: number } = {},
): Episode[] {
  const since = (o.now ?? Date.now()) - (o.days ?? 30) * 86_400_000;
  return episodes
    .filter((e) => !progress[episodeKey(e)]?.played && (e.date ?? 0) >= since && e.kind !== "trailer")
    .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
    .slice(0, o.limit ?? 150);
}

// ---------------------------------------------------------------------------
// mpv

/** An mpv script saving the position, duration and pause state every few seconds and at the end. */
export function positionScript(out: string): string {
  return [
    `local out = ${JSON.stringify(out)}`,
    "local pos, dur = nil, nil",
    'mp.observe_property("time-pos", "number", function(_, v) if v then pos = v end end)',
    'mp.observe_property("duration", "number", function(_, v) if v then dur = v end end)',
    "local function save(ended)",
    '  local f = io.open(out, "w")',
    "  if not f then return end",
    '  local paused = mp.get_property_bool("pause") and "true" or "false"',
    '  f:write(string.format(\'{"position":%s,"duration":%s,"ended":%s,"paused":%s}\',',
    '    pos and string.format("%.1f", pos) or "null", dur and string.format("%.1f", dur) or "null",',
    '    ended and "true" or "false", paused))',
    "  f:close()",
    "end",
    "mp.add_periodic_timer(5, function() save(false) end)",
    'mp.observe_property("pause", "bool", function() save(false) end)',
    'mp.register_event("end-file", function(e) save(e.reason == "eof") end)',
    "",
  ].join("\n");
}

export function mpvArgs(
  url: string,
  o: { start?: number; speed?: number; socket?: string; script?: string; title?: string } = {},
): string[] {
  return [
    "mpv",
    "--no-video",
    "--no-terminal",
    "--idle=no",
    "--cache=yes",
    "--force-seekable=yes",
    ...(o.start ? [`--start=${Math.floor(o.start)}`] : []),
    ...(o.speed && o.speed !== 1 ? [`--speed=${o.speed}`] : []),
    ...(o.socket ? [`--input-ipc-server=${o.socket}`] : []),
    ...(o.script ? [`--script=${o.script}`] : []),
    ...(o.title ? [`--title=${o.title}`, `--force-media-title=${o.title}`] : []),
    url,
  ];
}

/** `systemd-run` arguments for a background unit running `argv`. */
export function unitArgs(unit: string, description: string, argv: string[]): string[] {
  return ["--user", "--quiet", "--collect", `--unit=${unit}`, `--description=${description}`, ...argv];
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

/** The `speed` preference: 0.5 to 3, 1 by default. */
export function speedOf(input: unknown): number {
  const n = Number(String(input ?? "").replace(",", ".").replace(/x$/i, ""));
  return Number.isFinite(n) && n >= 0.5 && n <= 3 ? Math.round(n * 100) / 100 : 1;
}

// ---------------------------------------------------------------------------
// Formatting

/** 3723 → "1 h 02 min"; 2700 → "45 min"; 40 → "1 min". */
export function duration(seconds: number | undefined): string | undefined {
  if (!seconds || seconds <= 0) return undefined;
  const min = Math.max(1, Math.round(seconds / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

/** 3723 → "1:02:03"; 75 → "1:15". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** "12 min left". */
export function left(p: Pick<Progress, "position" | "duration">): string | undefined {
  if (!p.duration) return undefined;
  const d = duration(p.duration - p.position);
  return d ? `${d} left` : undefined;
}

export function megabytes(bytes: number | undefined): string | undefined {
  return bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : undefined;
}

/** "S2 · E14", "E14", "". */
export function episodeNumber(e: Pick<Episode, "season" | "number">): string {
  return [e.season ? `S${e.season}` : "", e.number ? `E${e.number}` : ""].filter(Boolean).join(" · ");
}

/** "Today", "Yesterday", "This Week", "This Month", "Older". */
export function dateSection(ms: number | undefined, now = Date.now()): string {
  if (ms === undefined) return "Older";
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  if (ms >= start.getTime()) return "Today";
  if (ms >= start.getTime() - day) return "Yesterday";
  if (ms >= start.getTime() - 6 * day) return "This Week";
  if (ms >= start.getTime() - 30 * day) return "This Month";
  return "Older";
}

export function shortDate(ms: number | undefined, now = Date.now()): string | undefined {
  if (ms === undefined) return undefined;
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** One line of the show notes, for subtitles. */
export function summary(html: string | undefined, max = 140): string {
  const text = htmlToText(html ?? "");
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
}

/** The feed preference or a pasted address: http(s) only. */
export function normalizeFeedUrl(input: string): string | undefined {
  let s = input.trim();
  if (!s) return undefined;
  if (/^(itpc|pcast|feed|podcast):\/\//i.test(s)) s = s.replace(/^[a-z]+:\/\//i, "https://");
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    return new URL(s).href;
  } catch {
    return undefined;
  }
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
