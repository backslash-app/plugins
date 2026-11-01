// NASA EONET v3: request URLs, parsing events (points and polygons), distances
// from you, magnitudes in words and the mapping to launcher items. Pure,
// tested in lib_test.ts.

import { type Action, type Color, copy, Icons, type Item, meta, type Metadata, open, type Stat } from "@backslash/api";

export const EONET = "https://eonet.gsfc.nasa.gov/api/v3";
export const HOSTS = ["eonet.gsfc.nasa.gov", "geocoding-api.open-meteo.com"];

// ---------------------------------------------------------------------------
// Categories and views

export interface Category {
  id: string;
  title: string;
  /** One word for a tag and the search. */
  short: string;
  icon: string;
  color: Color;
}

/** EONET's categories (`/api/v3/categories`). */
export const CATEGORIES: Category[] = [
  { id: "wildfires", title: "Wildfires", short: "wildfire", icon: "🔥", color: "red" },
  { id: "severeStorms", title: "Severe Storms", short: "storm", icon: "🌀", color: "purple" },
  { id: "volcanoes", title: "Volcanoes", short: "volcano", icon: "🌋", color: "orange" },
  { id: "seaLakeIce", title: "Sea and Lake Ice", short: "ice", icon: "🧊", color: "teal" },
  { id: "floods", title: "Floods", short: "flood", icon: "🌊", color: "blue" },
  { id: "landslides", title: "Landslides", short: "landslide", icon: "⛰️", color: "orange" },
  { id: "drought", title: "Drought", short: "drought", icon: "🏜️", color: "yellow" },
  { id: "dustHaze", title: "Dust and Haze", short: "dust", icon: "🌫️", color: "gray" },
  { id: "snow", title: "Snow", short: "snow", icon: "❄️", color: "teal" },
  { id: "tempExtremes", title: "Temperature Extremes", short: "temperature", icon: "🌡️", color: "red" },
  { id: "waterColor", title: "Water Color", short: "water color", icon: "💧", color: "green" },
  { id: "earthquakes", title: "Earthquakes", short: "earthquake", icon: "📉", color: "orange" },
  { id: "manmade", title: "Manmade", short: "manmade", icon: "🏭", color: "gray" },
];

const UNKNOWN: Category = { id: "", title: "Event", short: "event", icon: "📍", color: "gray" };

export function category(id: string): Category {
  return CATEGORIES.find((c) => c.id === id) ?? { ...UNKNOWN, id, title: id };
}

const OTHER = CATEGORIES.filter((c) => !["wildfires", "severeStorms", "volcanoes", "seaLakeIce"].includes(c.id))
  .map((c) => c.id);

/**
 * The chips of the command, each one or two EONET queries. Wildfire reports
 * stay "open" for months, so they are limited to the recent days; volcanoes,
 * storms and icebergs are listed while they last; floods and the rest close
 * within days, so the recent closed ones are shown too.
 */
export const VIEWS = [
  { value: "active", title: "Active Now" },
  { value: "wildfires", title: "Wildfires" },
  { value: "severeStorms", title: "Storms" },
  { value: "volcanoes", title: "Volcanoes" },
  { value: "seaLakeIce", title: "Icebergs" },
  { value: "other", title: "Floods & More" },
] as const;

export type View = typeof VIEWS[number]["value"];

export function viewOf(value: unknown): View {
  return VIEWS.find((v) => v.value === value)?.value ?? VIEWS[0].value;
}

export interface EventQuery {
  category?: string[];
  status: "open" | "all";
  days?: number;
}

/** The EONET queries behind a view; `days` limits wildfires and closed events. */
export function queries(view: View, days: number): EventQuery[] {
  switch (view) {
    case "active":
      // Everything updated recently, plus the volcanoes still erupting.
      return [{ status: "open", days }, { category: ["volcanoes"], status: "open" }];
    case "wildfires":
      return [{ category: ["wildfires"], status: "open", days }];
    case "other":
      return [{ category: OTHER, status: "all", days }];
    default:
      return [{ category: [view], status: "open" }];
  }
}

/** `https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30` */
export function eventsUrl(q: EventQuery): string {
  const p = new URLSearchParams({ status: q.status });
  if (q.category?.length) p.set("category", q.category.join(","));
  if (q.days) p.set("days", String(q.days));
  return `${EONET}/events?${p}`;
}

// ---------------------------------------------------------------------------
// Location

export interface Point {
  latitude: number;
  longitude: number;
}

export interface Place extends Point {
  name: string;
  country?: string;
}

/** "43.70, 7.27" or "43.70 7.27" → a point; anything else is a city name. */
export function parseCoordinates(text: string): Point | undefined {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!m) return undefined;
  const [latitude, longitude] = [Number(m[1]), Number(m[2])];
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return undefined;
  return { latitude, longitude };
}

export function geocodingUrl(name: string): string {
  const q = new URLSearchParams({ name, count: "5", language: "en", format: "json" });
  return `https://geocoding-api.open-meteo.com/v1/search?${q}`;
}

/** "Portland, US" → search "Portland", prefer results in the US. */
export function splitCity(query: string): { name: string; hint?: string } {
  const [name, ...rest] = query.split(",").map((s) => s.trim()).filter(Boolean);
  return { name: name ?? "", hint: rest.join(" ").toLowerCase() || undefined };
}

export interface GeoResult extends Point {
  name: string;
  country?: string;
  country_code?: string;
  admin1?: string;
}

export function pickPlace(results: GeoResult[], hint?: string): Place | undefined {
  const matches = (r: GeoResult) =>
    !hint || [r.country, r.country_code, r.admin1].some((v) => v && v.toLowerCase().startsWith(hint));
  const r = results.find(matches) ?? results[0];
  return r && { name: r.name, country: r.country, latitude: r.latitude, longitude: r.longitude };
}

const EARTH_KM = 6371.0088;
const rad = (d: number) => d * Math.PI / 180;

export function distanceKm(a: Point, b: Point): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function bearing(a: Point, b: Point): number {
  const y = Math.sin(rad(b.longitude - a.longitude)) * Math.cos(rad(b.latitude));
  const x = Math.cos(rad(a.latitude)) * Math.sin(rad(b.latitude)) -
    Math.sin(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.cos(rad(b.longitude - a.longitude));
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function compass(degrees: number): string {
  return POINTS[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

// ---------------------------------------------------------------------------
// Events

/** One geometry of an EONET event: where it was at `date`. */
export interface RawGeometry {
  date: string;
  type: "Point" | "Polygon" | string;
  coordinates: unknown;
  magnitudeValue?: number | null;
  magnitudeUnit?: string | null;
}

export interface RawEvent {
  id: string;
  title: string;
  description?: string | null;
  link?: string;
  closed?: string | null;
  categories: { id: string; title: string }[];
  sources: { id: string; url: string }[];
  geometry: RawGeometry[];
}

export interface EventsResponse {
  events: RawEvent[];
}

export interface Track extends Point {
  /** ms since 1970. */
  time: number;
  magnitude?: number;
  unit?: string;
}

export interface NaturalEvent extends Point {
  id: string;
  title: string;
  description?: string;
  category: Category;
  /** Where it was each time it was reported, oldest first. */
  track: Track[];
  /** The latest report. */
  time: number;
  first: number;
  magnitude?: number;
  unit?: string;
  /** The largest reported magnitude (a storm's peak wind). */
  peak?: number;
  closed?: number;
  sources: { id: string; url: string }[];
  /** From you, when your location is known. */
  distance?: number;
  bearing?: number;
}

/** The center of a geometry: the point itself, or the average of a polygon's outer ring. */
export function center(g: RawGeometry): Point | undefined {
  const c = g.coordinates;
  const ok = (p: unknown): p is [number, number] =>
    Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number";
  if (g.type === "Point" && ok(c)) return { latitude: c[1], longitude: c[0] };
  if (g.type === "Polygon" && Array.isArray(c) && Array.isArray(c[0])) {
    let ring = (c[0] as unknown[]).filter(ok);
    // A closed ring repeats its first point: count it once.
    const [f, l] = [ring[0], ring.at(-1)];
    if (ring.length > 1 && f && l && f[0] === l[0] && f[1] === l[1]) ring = ring.slice(0, -1);
    if (!ring.length) return undefined;
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    return { latitude: lat, longitude: lon };
  }
  return undefined;
}

/**
 * GDACS titles end with their event number ("Flood in Bhutan 1104265"):
 * it means nothing to a reader, so it is dropped.
 */
export function cleanTitle(title: string): string {
  return title.replace(/\s+\d{6,}$/, "").trim() || title;
}

const time = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

export function parseEvent(e: RawEvent, from?: Point): NaturalEvent | undefined {
  const track: Track[] = [];
  for (const g of e.geometry ?? []) {
    const p = center(g);
    const t = time(g.date);
    if (!p || t === undefined) continue;
    track.push({
      ...p,
      time: t,
      magnitude: typeof g.magnitudeValue === "number" ? g.magnitudeValue : undefined,
      unit: g.magnitudeUnit ?? undefined,
    });
  }
  if (!track.length) return undefined;
  track.sort((a, b) => a.time - b.time);
  const last = track.at(-1)!;
  const magnitudes = track.map((t) => t.magnitude).filter((m): m is number => m !== undefined);
  const ev: NaturalEvent = {
    id: e.id,
    title: cleanTitle(e.title ?? e.id),
    description: e.description?.trim() || undefined,
    category: category(e.categories?.[0]?.id ?? ""),
    track,
    latitude: last.latitude,
    longitude: last.longitude,
    time: last.time,
    first: track[0].time,
    magnitude: last.magnitude,
    unit: last.unit,
    peak: magnitudes.length > 1 ? Math.max(...magnitudes) : undefined,
    closed: time(e.closed),
    sources: (e.sources ?? []).filter((s) => /^https?:\/\//.test(s.url)),
  };
  if (from) {
    ev.distance = distanceKm(from, ev);
    ev.bearing = bearing(from, ev);
  }
  return ev;
}

/** Events of one or more answers, without duplicates, newest report first. */
export function parseEvents(answers: EventsResponse[], from?: Point): NaturalEvent[] {
  const seen = new Map<string, NaturalEvent>();
  for (const a of answers) {
    for (const raw of a.events ?? []) {
      if (seen.has(raw.id)) continue;
      const ev = parseEvent(raw, from);
      if (ev) seen.set(raw.id, ev);
    }
  }
  return [...seen.values()].sort((a, b) => b.time - a.time);
}

// ---------------------------------------------------------------------------
// Magnitudes and texts

export type Units = "metric" | "imperial";

export function unitsOf(pref: unknown): Units {
  return String(pref ?? "").trim().toLowerCase().startsWith("imp") ? "imperial" : "metric";
}

export function numberPref(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const fmt = (n: number, digits = 0) =>
  n.toLocaleString("en", { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** "120 km", "3.4 km", "75 mi". */
export function formatDistance(km: number, units: Units): string {
  const value = units === "imperial" ? km / 1.609344 : km;
  const unit = units === "imperial" ? "mi" : "km";
  return value < 10 ? `${value.toFixed(1)} ${unit}` : `${fmt(Math.round(value))} ${unit}`;
}

/**
 * The Saffir–Simpson category of a sustained wind in knots: "Category 3",
 * "Tropical storm" or "Tropical depression".
 */
export function stormClass(kts: number): string {
  if (kts >= 137) return "Category 5";
  if (kts >= 113) return "Category 4";
  if (kts >= 96) return "Category 3";
  if (kts >= 83) return "Category 2";
  if (kts >= 64) return "Category 1";
  if (kts >= 34) return "Tropical storm";
  return "Tropical depression";
}

export function stormColor(kts: number): Color {
  if (kts >= 113) return "purple";
  if (kts >= 96) return "red";
  if (kts >= 64) return "orange";
  if (kts >= 34) return "yellow";
  return "gray";
}

/**
 * A magnitude in words, converted to your units: winds in knots and km/h or
 * mph, burned areas in acres and hectares, iceberg areas in square nautical
 * miles and km² or mi².
 */
export function formatMagnitude(value: number, unit: string | undefined, units: Units): string {
  switch (unit) {
    case "kts":
      return units === "imperial"
        ? `${fmt(value)} kt (${fmt(value * 1.150779)} mph)`
        : `${fmt(value)} kt (${fmt(value * 1.852)} km/h)`;
    case "acres":
      return units === "imperial" ? `${fmt(value)} acres` : `${fmt(value * 0.404686)} ha (${fmt(value)} acres)`;
    case "NM^2":
      return units === "imperial" ? `${fmt(value * 1.325178)} mi²` : `${fmt(value * 3.429904)} km²`;
    default:
      return unit ? `${fmt(value, 2)} ${unit}` : fmt(value, 2);
  }
}

/** What the magnitude measures, for the detail panel. */
export function magnitudeLabel(ev: NaturalEvent): string {
  switch (ev.unit) {
    case "kts":
      return "Sustained wind";
    case "acres":
      return "Area burned";
    case "NM^2":
      return "Size";
    default:
      return "Magnitude";
  }
}

/** "just now", "3 h ago", "yesterday", "12 days ago". */
export function timeAgo(t: number, now = Date.now()): string {
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 2) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 60) return `${d} days ago`;
  return `${Math.round(d / 30.44)} months ago`;
}

/** "28 Oct 2026" in UTC: EONET dates are days or UTC hours. */
export function day(t: number): string {
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fromYou(ev: NaturalEvent, units: Units): string | undefined {
  if (ev.distance === undefined) return undefined;
  return `${formatDistance(ev.distance, units)} ${compass(ev.bearing ?? 0)}`;
}

/** How far a storm or iceberg moved between its first and last reports. */
export function travelled(ev: NaturalEvent): number | undefined {
  if (ev.track.length < 2) return undefined;
  let km = 0;
  for (let i = 1; i < ev.track.length; i++) km += distanceKm(ev.track[i - 1], ev.track[i]);
  return km;
}

export function mapUrl(p: Point, zoom = 7): string {
  const [lat, lon] = [p.latitude.toFixed(4), p.longitude.toFixed(4)];
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

/**
 * NASA Worldview at the event's place and day: the satellite images of that
 * day, with the fires layer for wildfires.
 */
export function worldviewUrl(ev: NaturalEvent): string {
  const d = 1.5;
  const box = [ev.longitude - d, ev.latitude - d, ev.longitude + d, ev.latitude + d].map((n) => n.toFixed(3)).join(",");
  const layers = ev.category.id === "wildfires"
    ? "MODIS_Terra_CorrectedReflectance_TrueColor,VIIRS_NOAA20_Thermal_Anomalies_375m_All,Coastlines_15m"
    : "MODIS_Terra_CorrectedReflectance_TrueColor,Coastlines_15m";
  const t = new Date(ev.time).toISOString().slice(0, 10);
  return `https://worldview.earthdata.nasa.gov/?v=${box}&l=${layers}&t=${t}`;
}

/** Where a source link goes, by EONET source id. */
export const SOURCES: Record<string, string> = {
  AVO: "Alaska Volcano Observatory",
  ABFIRE: "Alberta Wildfire",
  AU_BOM: "Australian Bureau of Meteorology",
  BYU_ICE: "BYU Antarctic Iceberg Database",
  BCWILDFIRE: "BC Wildfire Service",
  CALFIRE: "CAL FIRE",
  CEMS: "Copernicus Emergency Management",
  EO: "NASA Earth Observatory",
  Earthdata: "NASA Earthdata",
  FEMA: "FEMA",
  FloodList: "FloodList",
  GDACS: "GDACS",
  GLIDE: "GLIDE",
  InciWeb: "InciWeb",
  IRWIN: "IRWIN Observer",
  IDC: "International Charter Space and Major Disasters",
  JTWC: "Joint Typhoon Warning Center",
  MRR: "LANCE Rapid Response",
  MBFIRE: "Manitoba Wildfire Program",
  NASA_ESRS: "NASA Earth Science and Remote Sensing",
  NASA_DISP: "NASA Disasters Program",
  NASA_HURR: "NASA Hurricane Updates",
  NOAA_NHC: "National Hurricane Center",
  NOAA_CPC: "NOAA Climate Prediction Center",
  PDC: "Pacific Disaster Center",
  ReliefWeb: "ReliefWeb",
  SIVolcano: "Smithsonian Global Volcanism Program",
  NATICE: "U.S. National Ice Center",
  UNISYS: "Unisys Weather",
  USGS_EHP: "USGS Earthquake Hazards",
  USGS_CMT: "USGS Emergency Operations",
  HDDS: "USGS Hazards Data Distribution",
  DFES_WA: "Western Australia Fire and Emergency Services",
};

export function sourceName(id: string): string {
  return SOURCES[id] ?? id;
}

/** One line to share. */
export function shareText(ev: NaturalEvent, units: Units): string {
  return [
    ev.title,
    ev.category.title,
    ...(ev.magnitude !== undefined ? [formatMagnitude(ev.magnitude, ev.unit, units)] : []),
    `${ev.latitude.toFixed(3)}, ${ev.longitude.toFixed(3)}`,
    day(ev.time),
    ...(ev.sources[0] ? [ev.sources[0].url] : []),
  ].join(" · ");
}

/** Footer text: "44 events · 31 wildfires, 10 ice, 3 storms". */
export function status(events: NaturalEvent[]): string {
  if (!events.length) return "No events";
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.category.title, (counts.get(e.category.title) ?? 0) + 1);
  const parts = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t, n]) => `${n} ${t.toLowerCase()}`);
  return `${events.length} event${events.length === 1 ? "" : "s"} · ${parts.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Items

function magnitudeAccessory(ev: NaturalEvent, units: Units) {
  if (ev.magnitude === undefined) return [];
  if (ev.unit === "kts") {
    return [{
      tag: stormClass(ev.magnitude),
      color: stormColor(ev.magnitude),
      tooltip: formatMagnitude(ev.magnitude, ev.unit, units),
    }];
  }
  return [{ text: formatMagnitude(ev.magnitude, ev.unit, units).replace(/ \(.*\)$/, ""), tooltip: magnitudeLabel(ev) }];
}

function markdown(ev: NaturalEvent, units: Units, now: number): string {
  const lines = [`## ${ev.category.icon} ${ev.title}`, ""];
  if (ev.description) lines.push(ev.description, "");
  const when = ev.closed
    ? `Ended ${day(ev.closed)}; last reported ${day(ev.time)}.`
    : ev.category.id === "volcanoes"
    ? `In eruption since ${day(ev.first)}, according to the Smithsonian's Global Volcanism Program.`
    : ev.track.length > 1
    ? `Reported ${ev.track.length} times since ${day(ev.first)}, last ${timeAgo(ev.time, now)}.`
    : `Reported ${timeAgo(ev.time, now)} (${day(ev.time)}).`;
  lines.push(when);
  if (ev.distance !== undefined) lines.push("", `**${fromYou(ev, units)}** from you.`);
  if (ev.unit === "kts" && ev.magnitude !== undefined) {
    lines.push(
      "",
      `Winds of **${formatMagnitude(ev.magnitude, ev.unit, units)}**: ${stormClass(ev.magnitude).toLowerCase()}` +
        (ev.peak && ev.peak > ev.magnitude
          ? `, down from a peak of ${formatMagnitude(ev.peak, ev.unit, units)}.`
          : "."),
    );
  }
  const moved = travelled(ev);
  if (moved && moved > 1) lines.push("", `Moved ${formatDistance(moved, units)} along its track.`);
  if (ev.category.id === "wildfires" && !ev.closed && now - ev.time > 14 * 86_400_000) {
    lines.push("", "_Not updated for a while: it may be contained already._");
  }
  return lines.join("\n");
}

function stats(ev: NaturalEvent, units: Units): Stat[] {
  return [
    ...(ev.magnitude !== undefined
      ? [{ label: magnitudeLabel(ev), value: formatMagnitude(ev.magnitude, ev.unit, units).replace(/ \(.*\)$/, "") }]
      : []),
    ...(ev.distance !== undefined ? [{ label: "From you", value: formatDistance(ev.distance, units) }] : []),
    ...(ev.track.length > 1 ? [{ label: "Reports", value: ev.track.length }] : []),
  ];
}

function metadata(ev: NaturalEvent, units: Units): Metadata[] {
  return [
    meta.tags("Category", [{ text: ev.category.title, color: ev.category.color }]),
    meta.tags("Status", [ev.closed ? { text: "Ended", color: "gray" } : { text: "Ongoing", color: "green" }]),
    meta.text("Last report", day(ev.time), { icon: Icons.clock }),
    ...(ev.track.length > 1 ? [meta.text("First report", day(ev.first))] : []),
    ...(ev.closed ? [meta.text("Ended", day(ev.closed))] : []),
    meta.separator(),
    ...(ev.magnitude !== undefined
      ? [meta.text(magnitudeLabel(ev), formatMagnitude(ev.magnitude, ev.unit, units))]
      : []),
    ...(ev.peak !== undefined ? [meta.text("Peak", formatMagnitude(ev.peak, ev.unit, units))] : []),
    meta.text("Position", `${ev.latitude.toFixed(3)}, ${ev.longitude.toFixed(3)}`, { icon: Icons.pin }),
    ...(ev.distance !== undefined ? [meta.text("From you", fromYou(ev, units)!, { icon: Icons.home })] : []),
    meta.separator(),
    ...ev.sources.map((s) => meta.link("Source", sourceName(s.id), s.url)),
    meta.link("EONET", ev.id, `${EONET}/events/${ev.id}`),
  ];
}

export function actions(ev: NaturalEvent, units: Units, extra: Action[] = []): Action[] {
  return [
    ...(ev.sources[0]
      ? [open(ev.sources[0].url, `Open on ${sourceName(ev.sources[0].id)}`, { icon: Icons.globe })]
      : []),
    open(mapUrl(ev), "Open Map", { icon: Icons.pin, shortcut: "<Ctrl>o" }),
    open(worldviewUrl(ev), "Open Satellite View (NASA Worldview)", { icon: Icons.image, shortcut: "<Ctrl><Shift>o" }),
    ...ev.sources.slice(1).map((s) => open(s.url, `Open on ${sourceName(s.id)}`, { section: "Sources" })),
    copy(shareText(ev, units), "Copy Summary", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`${ev.latitude}, ${ev.longitude}`, "Copy Coordinates", { icon: Icons.pin, section: "Copy" }),
    ...extra,
  ];
}

export interface ItemOptions {
  units: Units;
  now?: number;
  section?: string;
  extraActions?: Action[];
}

export function eventItem(ev: NaturalEvent, o: ItemOptions): Item {
  const now = o.now ?? Date.now();
  const where = fromYou(ev, o.units);
  return {
    id: ev.id,
    title: ev.title,
    subtitle: ev.closed
      ? `Ended ${timeAgo(ev.closed, now)}`
      : ev.category.id === "volcanoes"
      ? `Erupting since ${day(ev.first)}`
      : timeAgo(ev.time, now),
    icon: ev.category.icon,
    section: o.section,
    keywords: [ev.category.title, ev.category.short, ...ev.sources.map((s) => s.id), ...(ev.closed ? ["ended"] : [])],
    accessories: [
      ...magnitudeAccessory(ev, o.units),
      ...(where ? [{ text: where, tooltip: "From you" }] : []),
      ...(ev.closed ? [{ tag: "Ended", color: "gray" as const }] : []),
      { tag: ev.category.short, color: ev.category.color },
    ],
    detail: { stats: stats(ev, o.units), markdown: markdown(ev, o.units, now), metadata: metadata(ev, o.units) },
    actions: actions(ev, o.units, o.extraActions),
  };
}

/**
 * Groups the events for the list: those within `nearKm` of you first,
 * nearest first, then the others, newest first.
 */
export function sections(
  events: NaturalEvent[],
  nearKm: number,
  home?: Place,
  units: Units = "metric",
): { title: string; events: NaturalEvent[] }[] {
  if (!home) return [{ title: "Newest first", events }];
  const near = events.filter((e) => e.distance! <= nearKm).sort((a, b) => a.distance! - b.distance!);
  const far = events.filter((e) => e.distance! > nearKm);
  return [
    ...(near.length ? [{ title: `Within ${formatDistance(nearKm, units)} of ${home.name}`, events: near }] : []),
    { title: near.length ? "Elsewhere, newest first" : "Newest first", events: far },
  ].filter((s) => s.events.length);
}
