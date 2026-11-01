// The Space Devs Launch Library 2 shapes, and how to show them.
// Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// API shapes (2.3.0, with the 2.2.0 field names where they differ)

export interface Named {
  id?: number;
  name: string;
  abbrev?: string | null;
  description?: string | null;
}

export interface Provider {
  id: number;
  name: string;
  abbrev?: string | null;
  type?: Named | string | null;
  country_code?: string | null;
  country?: { name?: string; alpha_2_code?: string }[] | null;
}

export interface VidUrl {
  priority?: number | null;
  title?: string | null;
  url: string;
  live?: boolean | null;
  type?: Named | null;
}

export interface Pad {
  name: string;
  latitude?: string | number | null;
  longitude?: string | number | null;
  map_url?: string | null;
  wiki_url?: string | null;
  country_code?: string | null;
  country?: { name?: string; alpha_2_code?: string } | null;
  location?: {
    name: string;
    country_code?: string | null;
    country?: { name?: string; alpha_2_code?: string } | null;
    timezone_name?: string | null;
  } | null;
}

export interface Launch {
  id: string;
  name: string;
  slug?: string;
  url?: string;
  status?: Named | null;
  net: string;
  net_precision?: Named | null;
  window_start?: string | null;
  window_end?: string | null;
  probability?: number | null;
  weather_concerns?: string | null;
  failreason?: string | null;
  holdreason?: string | null;
  launch_service_provider?: Provider | null;
  rocket?: { configuration?: { name: string; full_name?: string | null; variant?: string | null } | null } | null;
  mission?: {
    name: string;
    type?: string | null;
    description?: string | null;
    orbit?: Named | null;
  } | null;
  pad?: Pad | null;
  webcast_live?: boolean | null;
  vid_urls?: VidUrl[] | null;
  vidURLs?: VidUrl[] | null;
  info_urls?: { url: string; title?: string | null }[] | null;
  infoURLs?: { url: string; title?: string | null }[] | null;
  program?: Named[] | null;
}

export interface SpaceEvent {
  id: number;
  name: string;
  slug?: string;
  url?: string;
  type?: Named | null;
  description?: string | null;
  location?: string | null;
  date: string | null;
  date_precision?: Named | null;
  news_url?: string | null;
  video_url?: string | null;
  vid_urls?: VidUrl[] | null;
  info_urls?: { url: string; title?: string | null }[] | null;
  webcast_live?: boolean | null;
  launches?: { name: string }[] | null;
  spacestations?: { name: string }[] | null;
  program?: Named[] | null;
}

export interface Page<T> {
  count?: number;
  results: T[];
}

// ---------------------------------------------------------------------------
// URLs

export const API = "https://ll.thespacedevs.com/2.3.0";

export type Kind = "upcoming" | "previous";

export function launchesUrl(kind: Kind, limit = 40): string {
  // `detailed` brings the webcast links (vid_urls) and the mission's orbit.
  const params = new URLSearchParams({ limit: String(limit), mode: "detailed" });
  if (kind === "upcoming") params.set("hide_recent_previous", "true");
  return `${API}/launches/${kind}/?${params}`;
}

export const eventsUrl = (limit = 30) => `${API}/events/upcoming/?${new URLSearchParams({ limit: String(limit) })}`;

/** The pad on a map: LL2's own link, or OpenStreetMap from its coordinates. */
export function mapUrl(pad: Pad | null | undefined): string | undefined {
  if (!pad) return undefined;
  if (pad.map_url && /^https?:\/\//.test(pad.map_url)) return pad.map_url;
  const [lat, lon] = [Number(pad.latitude), Number(pad.longitude)];
  if (!pad.latitude || !pad.longitude || Number.isNaN(lat) || Number.isNaN(lon)) return undefined;
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=13/${lat}/${lon}`;
}

/** A throttled answer says how long to wait: "Expected available in 1234 seconds." */
export function throttleWait(detail: string | undefined): number | undefined {
  const m = /available in (\d+) seconds?/i.exec(detail ?? "");
  return m ? Number(m[1]) : undefined;
}

// ---------------------------------------------------------------------------
// Status

export interface Status {
  /** Short label for the tag: Go, TBD, TBC, Hold, In Flight, Success, Failure, Partial Failure. */
  label: string;
  color: Color;
  /** Launch finished (successfully or not). */
  done: boolean;
}

// LL2 status ids: 1 Go, 2 TBD, 3 Success, 4 Failure, 5 Hold, 6 In Flight, 7 Partial Failure, 8 TBC.
const STATUS_BY_ID: Record<number, Status> = {
  1: { label: "Go", color: "green", done: false },
  2: { label: "TBD", color: "gray", done: false },
  3: { label: "Success", color: "green", done: true },
  4: { label: "Failure", color: "red", done: true },
  5: { label: "Hold", color: "orange", done: false },
  6: { label: "In Flight", color: "blue", done: false },
  7: { label: "Partial Failure", color: "orange", done: true },
  8: { label: "TBC", color: "yellow", done: false },
};

export function status(s: Named | null | undefined): Status {
  if (s?.id && STATUS_BY_ID[s.id]) return STATUS_BY_ID[s.id];
  const text = `${s?.abbrev ?? ""} ${s?.name ?? ""}`.toLowerCase();
  const found = Object.values(STATUS_BY_ID).find((x) => text.includes(x.label.toLowerCase()));
  if (found) return found;
  if (text.includes("go for launch")) return STATUS_BY_ID[1];
  return { label: s?.abbrev || s?.name || "Unknown", color: "gray", done: false };
}

// ---------------------------------------------------------------------------
// Dates

/**
 * How precise a date is. LL2 precision ids: 0 second, 1 minute, 2 hour,
 * 3 morning, 4 afternoon, 5 day, 6 week, 7 month, 8–11 quarters, 12–13
 * halves, 14 year, 15 fiscal year, 16 decade.
 */
export type Precision = "exact" | "day" | "week" | "month" | "quarter" | "half" | "year";

export function precision(p: Named | null | undefined): Precision {
  const id = p?.id;
  if (id === undefined || id === null) {
    const name = (p?.name ?? "").toLowerCase();
    if (!name || /second|minute|hour/.test(name)) return "exact";
    if (/morning|afternoon|day/.test(name)) return "day";
    for (const k of ["week", "month", "quarter", "half"] as const) if (name.includes(k)) return k;
    return "year";
  }
  if (id <= 2) return "exact";
  if (id <= 5) return "day";
  if (id === 6) return "week";
  if (id === 7) return "month";
  if (id <= 11) return "quarter";
  if (id <= 13) return "half";
  return "year";
}

/** "T-2d 04h", "T-3h 12m", "T-45m", "T-0", "T+12m": against now, to the minute. */
export function tMinus(iso: string, now = Date.now()): string {
  const diff = Math.round((Date.parse(iso) - now) / 60_000);
  if (diff === 0) return "T-0";
  const sign = diff > 0 ? "-" : "+";
  const m = Math.abs(diff);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (m < 60) return `T${sign}${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `T${sign}${h}h ${pad(m % 60)}m`;
  return `T${sign}${Math.floor(h / 24)}d ${pad(h % 24)}h`;
}

/** "3 hours ago", "yesterday", "5 days ago": for launches that happened. */
export function ago(iso: string, now = Date.now()): string {
  const m = Math.round((now - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

const fmt = (iso: string, timeZone: string | undefined, o: Intl.DateTimeFormatOptions) =>
  new Date(iso).toLocaleString("en-GB", { timeZone, ...o });

/**
 * The date as precise as it is known, in the user's time zone:
 * "Sat 7 Nov 2026, 14:05", "Sat 7 Nov 2026", "Week of 2 Nov 2026",
 * "November 2026", "Q1 2027", "H2 2027", "2027".
 */
export function when(iso: string, p: Precision = "exact", timeZone?: string): string {
  const date = fmt(iso, timeZone, { weekday: "short", day: "numeric", month: "short", year: "numeric" })
    .replace(",", "");
  const year = Number(fmt(iso, timeZone, { year: "numeric" }));
  const month = Number(fmt(iso, timeZone, { month: "numeric" }));
  switch (p) {
    case "exact":
      return `${date}, ${fmt(iso, timeZone, { hour: "2-digit", minute: "2-digit" })}`;
    case "day":
      return date;
    case "week":
      return `Week of ${fmt(iso, timeZone, { day: "numeric", month: "short", year: "numeric" })}`;
    case "month":
      return fmt(iso, timeZone, { month: "long", year: "numeric" });
    case "quarter":
      return `Q${Math.ceil(month / 3)} ${year}`;
    case "half":
      return `H${month <= 6 ? 1 : 2} ${year}`;
    case "year":
      return String(year);
  }
}

/** What to show on the right of a launch: a countdown when the time is known, else the date. */
export function countdown(l: Launch, now = Date.now(), timeZone?: string): string {
  const p = precision(l.net_precision);
  const st = status(l.status);
  if (st.done) return ago(l.net, now);
  if (p !== "exact") return `NET ${when(l.net, p, timeZone)}`;
  return tMinus(l.net, now);
}

/** Launch window length: "instantaneous", "2 h 30 min", "45 min". */
export function windowLength(l: Launch): string | undefined {
  if (!l.window_start || !l.window_end) return undefined;
  const m = Math.round((Date.parse(l.window_end) - Date.parse(l.window_start)) / 60_000);
  if (Number.isNaN(m) || m < 0) return undefined;
  if (m === 0) return "instantaneous";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

// ---------------------------------------------------------------------------
// Launch fields

/** "Falcon 9 Block 5 | Starlink Group 10-12" → rocket and mission. */
export function splitName(name: string): { rocket: string; mission: string } {
  const i = name.indexOf(" | ");
  return i < 0 ? { rocket: name, mission: "" } : { rocket: name.slice(0, i), mission: name.slice(i + 3) };
}

export const rocketName = (l: Launch) =>
  l.rocket?.configuration?.full_name || l.rocket?.configuration?.name || splitName(l.name).rocket;

export const missionName = (l: Launch) => l.mission?.name || splitName(l.name).mission || l.name;

export const providerName = (l: Launch) => l.launch_service_provider?.name ?? "Unknown provider";

/** The short name people use: SpaceX, ISRO, CASC, ULA… */
export function providerShort(p: Provider | null | undefined): string {
  if (!p) return "Unknown";
  if (p.name.length <= 14 || !p.abbrev) return p.name;
  return p.abbrev;
}

export function place(l: Launch): string {
  const pad = l.pad;
  if (!pad) return "Unknown pad";
  return pad.location?.name ? `${pad.name}, ${pad.location.name}` : pad.name;
}

export function country(l: Launch): string | undefined {
  const pad = l.pad;
  return pad?.country?.name ?? pad?.location?.country?.name ?? pad?.location?.country_code ?? pad?.country_code ??
    undefined;
}

export function orbit(l: Launch): string | undefined {
  const o = l.mission?.orbit;
  if (!o) return undefined;
  return o.abbrev && o.abbrev !== o.name ? `${o.name} (${o.abbrev})` : o.name;
}

export interface Link {
  title: string;
  url: string;
  live: boolean;
}

/** Webcasts, best first: live ones, then by the API's priority. */
export function webcasts(x: { vid_urls?: VidUrl[] | null; vidURLs?: VidUrl[] | null; video_url?: string | null }) {
  const vids = [...(x.vid_urls ?? x.vidURLs ?? [])];
  if (x.video_url && !vids.some((v) => v.url === x.video_url)) vids.push({ url: x.video_url, priority: 99 });
  return vids
    .filter((v) => /^https?:\/\//.test(v.url))
    .sort((a, b) => Number(!!b.live) - Number(!!a.live) || (a.priority ?? 50) - (b.priority ?? 50))
    .map((v): Link => ({ title: v.title?.trim() || hostLabel(v.url), url: v.url, live: !!v.live }));
}

export function infoLinks(x: { info_urls?: Launch["info_urls"]; infoURLs?: Launch["infoURLs"] }): Link[] {
  return (x.info_urls ?? x.infoURLs ?? [])
    .filter((v) => /^https?:\/\//.test(v.url))
    .map((v) => ({ title: v.title?.trim() || hostLabel(v.url), url: v.url, live: false }));
}

/** "youtube.com" from "https://www.youtube.com/watch?v=…". */
export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** A launch is happening now: in flight, or its webcast is live. */
export const isLive = (l: Launch) => status(l.status).label === "In Flight" || !!l.webcast_live;

// ---------------------------------------------------------------------------
// Providers

/** Names people type for the big launch providers, matched against the LL2 name and abbreviation. */
export const PROVIDER_ALIASES: Record<string, string[]> = {
  spacex: ["spacex", "space exploration technologies"],
  "rocket lab": ["rocket lab", "rklb"],
  isro: ["isro", "indian space research organization", "nsil"],
  arianespace: ["arianespace", "ariane", "ase"],
  cnsa: ["casc", "china aerospace science and technology corporation", "cnsa", "china national space administration"],
  casc: ["casc", "china aerospace science and technology corporation"],
  china: [
    "casc",
    "china",
    "galactic energy",
    "landspace",
    "ispace",
    "cas space",
    "expace",
    "orienspace",
    "space pioneer",
  ],
  ula: ["ula", "united launch alliance"],
  "blue origin": ["blue origin", "bo"],
  roscosmos: ["roscosmos", "rfsa", "russian federal space agency", "vks", "russian aerospace forces"],
  russia: ["roscosmos", "rfsa", "russian", "vks"],
  jaxa: ["jaxa", "japan aerospace exploration agency", "mhi", "mitsubishi heavy industries"],
  nasa: ["nasa", "national aeronautics and space administration"],
  esa: ["esa", "european space agency", "arianespace", "avio"],
  firefly: ["firefly", "fa"],
  northrop: ["northrop grumman", "ngis"],
};

/** "SpaceX, Rocket Lab ; ISRO" → ["spacex", "rocket lab", "isro"]. */
export const parseProviders = (text: string | undefined) =>
  (text ?? "").split(/[,;]/).map((s) => s.trim().toLowerCase()).filter(Boolean);

/** Words that match a provider, for the launcher's filter and for the preference. */
export function providerWords(p: Provider | null | undefined): string[] {
  if (!p) return [];
  const own = [p.name, p.abbrev ?? ""].map((s) => s.toLowerCase()).filter(Boolean);
  const aliases = Object.entries(PROVIDER_ALIASES)
    .filter(([, names]) => names.some((n) => own.some((o) => o === n || o.includes(n) && n.length > 3)))
    .map(([alias]) => alias);
  return [...new Set([...own, ...aliases])];
}

/** Whether a launch's provider is one of `wanted` (empty: all). */
export function matchesProviders(l: Launch, wanted: string[]): boolean {
  if (!wanted.length) return true;
  const words = providerWords(l.launch_service_provider);
  return wanted.some((w) => words.some((x) => x === w || x.includes(w) && w.length > 3));
}

// ---------------------------------------------------------------------------
// Lists

/** Upcoming launches, soonest first; the ones whose time isn't known keep their place by date. */
export function sortUpcoming(launches: Launch[]): Launch[] {
  return [...launches].sort((a, b) => Date.parse(a.net) - Date.parse(b.net));
}

export function sortRecent(launches: Launch[]): Launch[] {
  return [...launches].sort((a, b) => Date.parse(b.net) - Date.parse(a.net));
}

/** "Today", "Tomorrow", "This week", "This month", "Later", or "Date not set" when only the month is known. */
export function dateSection(iso: string, p: Precision, now = Date.now(), timeZone?: string): string {
  if (p !== "exact" && p !== "day") return "Date not set";
  const day = (t: number) =>
    fmt(new Date(t).toISOString(), timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  const t = Date.parse(iso);
  if (day(t) === day(now) || t < now) return "Today";
  if (day(t) === day(now + 86400_000)) return "Tomorrow";
  if (t - now < 7 * 86400_000) return "This week";
  if (t - now < 31 * 86400_000) return "This month";
  return "Later";
}

/** The section of an upcoming launch: "Now" while it flies or streams, else by date. */
export const upcomingSection = (l: Launch, now = Date.now(), timeZone?: string) =>
  isLive(l) ? "Now" : dateSection(l.net, precision(l.net_precision), now, timeZone);

export function recentSection(l: Launch, now = Date.now()): string {
  const d = (now - Date.parse(l.net)) / 86400_000;
  if (d < 1) return "Last 24 hours";
  if (d < 7) return "This week";
  if (d < 31) return "This month";
  return "Earlier";
}

/** One-line summary for the root search and copying: "Falcon 9 · Starlink Group 10-12 · T-3h 12m". */
export function summary(l: Launch, now = Date.now(), timeZone?: string): string {
  return `${rocketName(l)} · ${missionName(l)} · ${countdown(l, now, timeZone)}`;
}

/** Plain text for "Copy Launch Details". */
export function launchText(l: Launch, timeZone?: string): string {
  const p = precision(l.net_precision);
  return [
    l.name,
    `${status(l.status).label}: ${when(l.net, p, timeZone)}`,
    `Provider: ${providerName(l)}`,
    `Pad: ${place(l)}`,
    ...(orbit(l) ? [`Orbit: ${orbit(l)}`] : []),
    ...(webcasts(l)[0] ? [`Webcast: ${webcasts(l)[0].url}`] : []),
  ].join("\n");
}

/** An event's colored icon, by its type name. */
export function eventKind(e: SpaceEvent): { label: string; color: Color } {
  const t = (e.type?.name ?? "").toLowerCase();
  if (/dock|berth|rendezvous/.test(t)) return { label: e.type!.name, color: "blue" };
  if (/eva|spacewalk/.test(t)) return { label: e.type!.name, color: "purple" };
  if (/landing|splashdown|undock|reentry|re-entry/.test(t)) return { label: e.type!.name, color: "teal" };
  if (/flyby|insertion|lunar|moon|mars|probe/.test(t)) return { label: e.type!.name, color: "orange" };
  if (/test|fire|engine/.test(t)) return { label: e.type!.name, color: "yellow" };
  return { label: e.type?.name ?? "Event", color: "gray" };
}

export function sortEvents(events: SpaceEvent[]): SpaceEvent[] {
  return events.filter((e) => e.date).sort((a, b) => Date.parse(a.date!) - Date.parse(b.date!));
}

/** Escape what markdown would take as formatting in API text. */
export const md = (s: string) => s.replace(/([\\`*_[\]<>|])/g, "\\$1");

// ---------------------------------------------------------------------------
// Caching: `detailed` answers are large, only what is shown is kept.

const named = (n: Named | null | undefined): Named | null =>
  n ? { id: n.id, name: n.name, abbrev: n.abbrev ?? null } : null;

const links = (v: { url: string; title?: string | null }[] | null | undefined) =>
  (v ?? []).map((x) => ({ url: x.url, title: x.title ?? null }));

const vids = (v: VidUrl[] | null | undefined): VidUrl[] =>
  (v ?? []).map((x) => ({ url: x.url, title: x.title ?? null, priority: x.priority ?? null, live: x.live ?? null }));

export function slimLaunch(l: Launch): Launch {
  const p = l.launch_service_provider;
  const pad = l.pad;
  return {
    id: l.id,
    name: l.name,
    slug: l.slug,
    status: l.status ? { ...named(l.status)!, description: l.status.description ?? null } : null,
    net: l.net,
    net_precision: named(l.net_precision),
    window_start: l.window_start ?? null,
    window_end: l.window_end ?? null,
    probability: l.probability ?? null,
    weather_concerns: l.weather_concerns ?? null,
    failreason: l.failreason ?? null,
    holdreason: l.holdreason ?? null,
    launch_service_provider: p
      ? {
        id: p.id,
        name: p.name,
        abbrev: p.abbrev ?? null,
        type: typeof p.type === "string" ? p.type : p.type?.name ?? null,
      }
      : null,
    rocket: l.rocket?.configuration
      ? {
        configuration: {
          name: l.rocket.configuration.name,
          full_name: l.rocket.configuration.full_name ?? null,
          variant: l.rocket.configuration.variant ?? null,
        },
      }
      : null,
    mission: l.mission
      ? {
        name: l.mission.name,
        type: l.mission.type ?? null,
        description: l.mission.description ?? null,
        orbit: named(l.mission.orbit),
      }
      : null,
    pad: pad
      ? {
        name: pad.name,
        latitude: pad.latitude ?? null,
        longitude: pad.longitude ?? null,
        map_url: pad.map_url ?? null,
        wiki_url: pad.wiki_url ?? null,
        country_code: pad.country_code ?? null,
        country: pad.country ? { name: pad.country.name } : null,
        location: pad.location
          ? {
            name: pad.location.name,
            country_code: pad.location.country_code ?? null,
            country: pad.location.country ? { name: pad.location.country.name } : null,
            timezone_name: pad.location.timezone_name ?? null,
          }
          : null,
      }
      : null,
    webcast_live: l.webcast_live ?? null,
    vid_urls: vids(l.vid_urls ?? l.vidURLs),
    info_urls: links(l.info_urls ?? l.infoURLs),
    program: (l.program ?? []).map((x) => ({ name: x.name })),
  };
}

export function slimEvent(e: SpaceEvent): SpaceEvent {
  return {
    id: e.id,
    name: e.name,
    slug: e.slug,
    type: named(e.type),
    description: e.description ?? null,
    location: e.location ?? null,
    date: e.date,
    date_precision: named(e.date_precision),
    news_url: e.news_url ?? null,
    video_url: e.video_url ?? null,
    vid_urls: vids(e.vid_urls),
    info_urls: links(e.info_urls),
    webcast_live: e.webcast_live ?? null,
    launches: (e.launches ?? []).map((x) => ({ name: x.name })),
    spacestations: (e.spacestations ?? []).map((x) => ({ name: x.name })),
    program: (e.program ?? []).map((x) => ({ name: x.name })),
  };
}

export const SECTION_ORDER = [
  "Offline",
  "Now",
  "Today",
  "Tomorrow",
  "This week",
  "This month",
  "Later",
  "Date not set",
];

/** Keeps each section in one block, in SECTION_ORDER, items keeping their order inside it. */
export function bySection<T extends { section?: string }>(items: T[], order = SECTION_ORDER): T[] {
  const rank = (t: T) => {
    const i = order.indexOf(t.section ?? "");
    return i < 0 ? order.length : i;
  };
  return items.map((t, i) => [t, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([t]) => t);
}
