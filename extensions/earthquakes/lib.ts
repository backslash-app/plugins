// USGS earthquake feeds: request URLs, parsing the GeoJSON, distances and the
// mapping from an earthquake to launcher items. Pure, tested in lib_test.ts.

import { type Action, type Color, copy, Icons, type Item, meta, type Metadata, open, type Stat } from "@backslash/api";

export const USGS = "https://earthquake.usgs.gov";
export const HOSTS = ["earthquake.usgs.gov", "geocoding-api.open-meteo.com"];

// ---------------------------------------------------------------------------
// Feeds and queries

/** The summary feeds offered as chips in Recent Earthquakes. */
export const FEEDS = [
  { value: "4.5_week", title: "M4.5+ · 7 Days" },
  { value: "4.5_day", title: "M4.5+ · 24 Hours" },
  { value: "2.5_day", title: "M2.5+ · 24 Hours" },
  { value: "significant_month", title: "Significant · 30 Days" },
] as const;

export type Feed = typeof FEEDS[number]["value"];

export function feedOf(value: unknown): Feed {
  return FEEDS.find((f) => f.value === value)?.value ?? FEEDS[0].value;
}

export function feedTitle(feed: Feed): string {
  return FEEDS.find((f) => f.value === feed)!.title;
}

/** `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson` */
export function feedUrl(feed: Feed): string {
  return `${USGS}/earthquakes/feed/v1.0/summary/${feed}.geojson`;
}

/** The periods offered as chips in Earthquakes Near Me. */
export const PERIODS = [
  { value: "week", title: "7 Days", days: 7 },
  { value: "day", title: "24 Hours", days: 1 },
  { value: "month", title: "30 Days", days: 30 },
] as const;

export type Period = typeof PERIODS[number]["value"];

export function periodOf(value: unknown): Period {
  return PERIODS.find((p) => p.value === value)?.value ?? PERIODS[0].value;
}

export function periodDays(period: Period): number {
  return PERIODS.find((p) => p.value === period)!.days;
}

/** The FDSN event query for earthquakes within `radiusKm` of a point since `days` ago. */
export function nearbyUrl(
  point: Point,
  o: { radiusKm: number; minMagnitude: number; days: number; now?: number },
): string {
  const start = new Date((o.now ?? Date.now()) - o.days * 86_400_000);
  const q = new URLSearchParams({
    format: "geojson",
    latitude: point.latitude.toFixed(4),
    longitude: point.longitude.toFixed(4),
    // The service refuses radii above 20 001.6 km (half the circumference).
    maxradiuskm: String(Math.min(20_000, Math.max(1, Math.round(o.radiusKm)))),
    minmagnitude: String(o.minMagnitude),
    starttime: start.toISOString().slice(0, 19),
    orderby: "time",
    limit: "500",
  });
  return `${USGS}/fdsnws/event/1/query?${q}`;
}

// ---------------------------------------------------------------------------
// Location

export interface Point {
  latitude: number;
  longitude: number;
}

/** Where distances are measured from: a city found by name, or typed coordinates. */
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

/** "San Francisco, US" → search "San Francisco", prefer results in the US. */
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

/** The best geocoding result: the first one matching the hint (country or region), else the first. */
export function pickPlace(results: GeoResult[], hint?: string): Place | undefined {
  const matches = (r: GeoResult) =>
    !hint || [r.country, r.country_code, r.admin1].some((v) => v && v.toLowerCase().startsWith(hint));
  const r = results.find(matches) ?? results[0];
  return r && { name: r.name, country: r.country, latitude: r.latitude, longitude: r.longitude };
}

// ---------------------------------------------------------------------------
// Distances

const EARTH_KM = 6371.0088;
const rad = (d: number) => d * Math.PI / 180;

/** Great-circle distance in km. */
export function distanceKm(a: Point, b: Point): number {
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, in degrees from north. */
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

export type Units = "metric" | "imperial";

export function unitsOf(pref: unknown): Units {
  return String(pref ?? "").trim().toLowerCase().startsWith("imp") ? "imperial" : "metric";
}

/** "12 km", "1,240 km", "0.4 mi". */
export function formatDistance(km: number, units: Units): string {
  const value = units === "imperial" ? km / 1.609344 : km;
  const unit = units === "imperial" ? "mi" : "km";
  return value < 10 ? `${value.toFixed(1)} ${unit}` : `${Math.round(value).toLocaleString("en")} ${unit}`;
}

/** A number preference, or its default when it is empty or not a positive number. */
export function numberPref(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 && String(value ?? "").trim() !== "" ? n : fallback;
}

// ---------------------------------------------------------------------------
// Earthquakes

/** One feature of a USGS GeoJSON answer, the fields we read. */
export interface Feature {
  id: string;
  properties: {
    mag: number | null;
    place: string | null;
    time: number;
    updated?: number;
    url?: string;
    felt?: number | null;
    cdi?: number | null;
    mmi?: number | null;
    alert?: string | null;
    status?: string;
    tsunami?: number;
    sig?: number;
    net?: string;
    magType?: string | null;
    type?: string;
    title?: string;
  };
  geometry: { coordinates: [number, number, number?] } | null;
}

export interface FeatureCollection {
  metadata?: { title?: string; count?: number; generated?: number };
  features: Feature[];
}

export type Alert = "green" | "yellow" | "orange" | "red";

export interface Quake extends Point {
  id: string;
  magnitude: number;
  magType: string;
  /** "45 km SW of Ridgecrest, CA" */
  place: string;
  time: number;
  /** km below the surface. */
  depth: number;
  url: string;
  felt: number;
  /** Did You Feel It? intensity and ShakeMap intensity (MMI scale). */
  cdi?: number;
  mmi?: number;
  alert?: Alert;
  tsunami: boolean;
  reviewed: boolean;
  significance: number;
  network: string;
  /** "earthquake", "quarry blast", "explosion"… */
  type: string;
  /** From the user's location, when known. */
  distance?: number;
  bearing?: number;
}

const ALERTS: Alert[] = ["green", "yellow", "orange", "red"];

/** Turns a GeoJSON answer into earthquakes, newest first, skipping features without a magnitude or position. */
export function parseQuakes(data: FeatureCollection, from?: Point): Quake[] {
  const quakes: Quake[] = [];
  for (const f of data.features ?? []) {
    const p = f.properties ?? {};
    const c = f.geometry?.coordinates;
    if (typeof p.mag !== "number" || !c || typeof c[0] !== "number" || typeof c[1] !== "number") continue;
    const q: Quake = {
      id: f.id,
      magnitude: p.mag,
      magType: p.magType ?? "",
      place: p.place?.trim() || (p.title ?? "").replace(/^M\s*[\d.-]+\s*-\s*/, "") || "Unknown location",
      time: p.time,
      latitude: c[1],
      longitude: c[0],
      depth: c[2] ?? 0,
      url: p.url ?? `${USGS}/earthquakes/eventpage/${f.id}`,
      felt: p.felt ?? 0,
      cdi: p.cdi ?? undefined,
      mmi: p.mmi ?? undefined,
      alert: ALERTS.includes(p.alert as Alert) ? p.alert as Alert : undefined,
      tsunami: p.tsunami === 1,
      reviewed: p.status === "reviewed",
      significance: p.sig ?? 0,
      network: p.net ?? "",
      type: p.type ?? "earthquake",
    };
    if (from) {
      q.distance = distanceKm(from, q);
      q.bearing = bearing(from, q);
    }
    quakes.push(q);
  }
  return quakes.sort((a, b) => b.time - a.time);
}

/** The USGS descriptive class of a magnitude. */
export function magnitudeClass(m: number): string {
  if (m >= 8) return "Great";
  if (m >= 7) return "Major";
  if (m >= 6) return "Strong";
  if (m >= 5) return "Moderate";
  if (m >= 4) return "Light";
  if (m >= 3) return "Minor";
  return "Micro";
}

export function magnitudeColor(m: number): Color {
  if (m >= 7) return "purple";
  if (m >= 6) return "red";
  if (m >= 5) return "orange";
  if (m >= 4) return "yellow";
  if (m >= 3) return "green";
  return "gray";
}

/** "M 5.1", one decimal as the USGS shows it. */
export function formatMagnitude(m: number): string {
  return `M ${m.toFixed(1)}`;
}

export function depthClass(km: number): string {
  if (km < 70) return "shallow";
  if (km < 300) return "intermediate";
  return "deep";
}

export function formatDepth(km: number, units: Units): string {
  return units === "imperial" ? `${(km / 1.609344).toFixed(1)} mi` : `${km.toFixed(1)} km`;
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function timeAgo(time: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - time) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** "2026-10-31 14:05:09 UTC" */
export function utcTime(time: number): string {
  return new Date(time).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/** Roman numeral of an MMI / DYFI intensity, rounded: 4.6 → "V". */
export function intensity(value: number): string {
  const roman = ["I", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
  return roman[Math.max(1, Math.min(12, Math.round(value)))];
}

const INTENSITY_WORDS = [
  "",
  "not felt",
  "weak",
  "weak",
  "light shaking",
  "moderate shaking",
  "strong shaking",
  "very strong shaking",
  "severe shaking",
  "violent shaking",
  "extreme shaking",
  "extreme shaking",
  "extreme shaking",
];

export function intensityWords(value: number): string {
  return INTENSITY_WORDS[Math.max(1, Math.min(12, Math.round(value)))];
}

export const ALERT_TEXT: Record<Alert, string> = {
  green: "Green: no or few fatalities and little economic loss expected",
  yellow: "Yellow: some fatalities or damage possible, a local or regional response",
  orange: "Orange: significant casualties or damage likely, a national response",
  red: "Red: high casualties and extensive damage probable, an international response",
};

/** "120 km NE" from the user. */
export function fromYou(q: Quake, units: Units): string | undefined {
  if (q.distance === undefined) return undefined;
  const d = formatDistance(q.distance, units);
  return q.distance < 1 ? d : `${d} ${compass(q.bearing ?? 0)}`;
}

export function mapUrl(q: Point): string {
  const [lat, lon] = [q.latitude.toFixed(4), q.longitude.toFixed(4)];
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=8/${lat}/${lon}`;
}

/** One line to share: "M 5.1 · 45 km SW of Ridgecrest, CA · 10.0 km deep · 2026-10-31 14:05:09 UTC". */
export function shareText(q: Quake, units: Units): string {
  return [
    formatMagnitude(q.magnitude),
    q.place,
    `${formatDepth(q.depth, units)} deep`,
    utcTime(q.time),
    q.url,
  ].join(" · ");
}

/** "M 6.2 · Off the coast of Chile · 3 h ago": the root search subtitle. */
export function summary(q: Quake, now = Date.now()): string {
  return `${formatMagnitude(q.magnitude)} · ${q.place} · ${timeAgo(q.time, now)}`;
}

/** Footer text: "23 earthquakes · largest M 6.1". */
export function status(quakes: Quake[]): string {
  if (!quakes.length) return "No earthquakes";
  const largest = quakes.reduce((a, b) => b.magnitude > a.magnitude ? b : a);
  const n = quakes.length;
  return `${n} earthquake${n === 1 ? "" : "s"} · largest ${formatMagnitude(largest.magnitude)}`;
}

// ---------------------------------------------------------------------------
// Items

const ALERT_COLOR: Record<Alert, Color> = { green: "green", yellow: "yellow", orange: "orange", red: "red" };

/** The sentence at the top of the detail panel. */
export function describe(q: Quake, units: Units, now = Date.now()): string {
  const kind = q.type === "earthquake" ? "earthquake" : q.type;
  const mag = `${formatMagnitude(q.magnitude)}${q.magType ? ` ${q.magType}` : ""}`;
  const where = q.distance !== undefined ? `, ${fromYou(q, units)} from you` : "";
  return `A ${magnitudeClass(q.magnitude).toLowerCase()} ${kind} (${mag}), ${depthClass(q.depth)} at ` +
    `${formatDepth(q.depth, units)} deep, ${timeAgo(q.time, now)}${where}.`;
}

function markdown(q: Quake, units: Units, now: number): string {
  const lines = [`## ${formatMagnitude(q.magnitude)} · ${q.place}`, "", describe(q, units, now)];
  if (q.tsunami) {
    lines.push(
      "",
      "> **Tsunami flag**: the event is in a region a tsunami warning center watches. It does not mean a tsunami " +
        "happened: check [tsunami.gov](https://www.tsunami.gov) for warnings.",
    );
  }
  if (q.alert) lines.push("", `**PAGER alert:** ${ALERT_TEXT[q.alert]}.`);
  if (q.felt) {
    lines.push(
      "",
      `**${q.felt.toLocaleString("en")}** ${q.felt === 1 ? "person" : "people"} reported feeling it` +
        (q.cdi ? `, up to ${intensityWords(q.cdi)} (${intensity(q.cdi)}).` : "."),
    );
  }
  if (!q.reviewed) lines.push("", "_Automatic solution: not yet reviewed by a seismologist, it may change._");
  return lines.join("\n");
}

function stats(q: Quake, units: Units): Stat[] {
  return [
    { label: "Magnitude", value: q.magnitude.toFixed(1), color: magnitudeColor(q.magnitude) },
    { label: "Depth", value: formatDepth(q.depth, units) },
    ...(q.distance !== undefined ? [{ label: "From you", value: formatDistance(q.distance, units) }] : []),
    ...(q.felt ? [{ label: "Felt reports", value: q.felt.toLocaleString("en") }] : []),
  ];
}

function metadata(q: Quake, units: Units, localTime: (t: number) => string): Metadata[] {
  return [
    meta.text("Time", localTime(q.time), { icon: Icons.clock }),
    meta.text("UTC", utcTime(q.time)),
    meta.separator(),
    meta.tags("Magnitude", [{
      text: `${q.magnitude.toFixed(1)} ${magnitudeClass(q.magnitude)}`,
      color: magnitudeColor(q.magnitude),
    }]),
    ...(q.magType ? [meta.text("Magnitude type", q.magType)] : []),
    meta.text("Depth", `${formatDepth(q.depth, units)} · ${depthClass(q.depth)}`, { icon: Icons.arrowDown }),
    meta.text("Coordinates", `${q.latitude.toFixed(3)}, ${q.longitude.toFixed(3)}`, { icon: Icons.pin }),
    ...(q.distance !== undefined ? [meta.text("From you", fromYou(q, units)!, { icon: Icons.home })] : []),
    meta.separator(),
    ...(q.alert ? [meta.tags("PAGER alert", [{ text: q.alert, color: ALERT_COLOR[q.alert] }])] : []),
    ...(q.tsunami ? [meta.tags("Tsunami", [{ text: "Flagged", color: "blue" }])] : []),
    ...(q.mmi ? [meta.text("ShakeMap intensity", `${intensity(q.mmi)} · ${intensityWords(q.mmi)}`)] : []),
    ...(q.cdi ? [meta.text("Felt intensity", `${intensity(q.cdi)} · ${intensityWords(q.cdi)}`)] : []),
    meta.text("Felt reports", q.felt.toLocaleString("en"), { icon: Icons.person }),
    meta.text("Significance", q.significance),
    meta.tags("Status", [q.reviewed ? { text: "Reviewed", color: "green" } : { text: "Automatic", color: "gray" }]),
    ...(q.network ? [meta.text("Network", q.network.toUpperCase())] : []),
    meta.link("Event page", "earthquake.usgs.gov", q.url),
  ];
}

export function actions(q: Quake, units: Units, extra: Action[] = []): Action[] {
  return [
    open(q.url, "Open on USGS", { icon: Icons.globe }),
    open(mapUrl(q), "Open Map", { icon: Icons.pin, shortcut: "<Ctrl>o" }),
    open(`${q.url}/tellus`, "Report Feeling It", { icon: Icons.comment, section: "Did You Feel It?" }),
    copy(shareText(q, units), "Copy Summary", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`${q.latitude}, ${q.longitude}`, "Copy Coordinates", { icon: Icons.pin, section: "Copy" }),
    copy(q.url, "Copy Link", { icon: Icons.link, shortcut: "<Ctrl><Shift>l", section: "Copy" }),
    ...extra,
  ];
}

export interface ItemOptions {
  units: Units;
  section?: string;
  now?: number;
  /** Formats a time for the detail panel; the command passes the user's locale. */
  localTime?: (t: number) => string;
  extraActions?: Action[];
}

export function quakeItem(q: Quake, o: ItemOptions): Item {
  const now = o.now ?? Date.now();
  const where = fromYou(q, o.units);
  return {
    id: q.id,
    title: q.place,
    subtitle: timeAgo(q.time, now),
    icon: { source: Icons.activity, tint: magnitudeColor(q.magnitude) },
    section: o.section,
    keywords: [magnitudeClass(q.magnitude), q.type, ...(q.tsunami ? ["tsunami"] : []), ...(q.alert ? [q.alert] : [])],
    accessories: [
      ...(q.tsunami ? [{ icon: { source: Icons.droplet, tint: "blue" as const }, tooltip: "Tsunami flag" }] : []),
      ...(q.alert
        ? [{ icon: { source: Icons.alert, tint: ALERT_COLOR[q.alert] }, tooltip: `PAGER alert: ${q.alert}` }]
        : []),
      ...(q.felt ? [{ icon: Icons.person, text: q.felt.toLocaleString("en"), tooltip: "Felt reports" }] : []),
      ...(q.type !== "earthquake" ? [{ tag: q.type, color: "gray" as const }] : []),
      ...(where ? [{ text: where, tooltip: "From you" }] : [{ text: `${Math.round(q.depth)} km deep` }]),
      { tag: q.magnitude.toFixed(1), color: magnitudeColor(q.magnitude), tooltip: magnitudeClass(q.magnitude) },
    ],
    detail: {
      stats: stats(q, o.units),
      markdown: markdown(q, o.units, now),
      metadata: metadata(q, o.units, o.localTime ?? utcTime),
    },
    actions: actions(q, o.units, o.extraActions),
  };
}
