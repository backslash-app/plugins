// OpenSky Network state vectors: request URLs, parsing, distances from you and
// the mapping from an aircraft to launcher items. Pure, tested in lib_test.ts.

import { type Action, type Color, copy, Icons, type Item, meta, type Metadata, open, type Stat } from "@backslash/api";

export const OPENSKY = "https://opensky-network.org/api";
export const TOKEN_URL = "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token";
export const HOSTS = ["opensky-network.org", "auth.opensky-network.org", "geocoding-api.open-meteo.com"];

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

/** "Lyon, France" → search "Lyon", prefer results in France. */
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
// Geometry

const EARTH_KM = 6371.0088;
const rad = (d: number) => d * Math.PI / 180;
const deg = (r: number) => r * 180 / Math.PI;

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
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function compass(degrees: number): string {
  return POINTS[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

/**
 * How high above your horizon an aircraft at `altitudeM` and `km` away
 * appears, in degrees, with the Earth's curvature (and standard refraction,
 * k = 0.13) taken into account. Negative: below your horizon.
 */
export function elevation(km: number, altitudeM: number): number {
  if (km < 0.001) return 90;
  const R = EARTH_KM * 1000 / (1 - 0.13);
  const theta = km * 1000 / R;
  const h = altitudeM + R;
  // Observer at sea level: the aircraft seen from the center makes angle theta.
  return deg(Math.atan2(h * Math.cos(theta) - R, h * Math.sin(theta)));
}

/**
 * The OpenSky bounding box (`lamin`…`lomax`) holding a circle of `radiusKm`
 * around a point; longitudes are clamped rather than wrapped at ±180°.
 */
export function boundingBox(
  p: Point,
  radiusKm: number,
): { lamin: number; lomin: number; lamax: number; lomax: number } {
  const dLat = deg(radiusKm / EARTH_KM);
  const cos = Math.max(0.01, Math.cos(rad(Math.min(89, Math.abs(p.latitude) + dLat))));
  const dLon = Math.min(180, dLat / cos);
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return {
    lamin: r(Math.max(-90, p.latitude - dLat)),
    lomin: r(Math.max(-180, p.longitude - dLon)),
    lamax: r(Math.min(90, p.latitude + dLat)),
    lomax: r(Math.min(180, p.longitude + dLon)),
  };
}

/**
 * OpenSky's price for an area request, in API credits: up to 25 square
 * degrees 1, 100 → 2, 400 → 3, more (or the whole world) 4.
 */
export function creditCost(box?: { lamin: number; lomin: number; lamax: number; lomax: number }): number {
  if (!box) return 4;
  const area = (box.lamax - box.lamin) * (box.lomax - box.lomin);
  return area <= 25 ? 1 : area <= 100 ? 2 : area <= 400 ? 3 : 4;
}

// ---------------------------------------------------------------------------
// Requests

/** `/states/all` for an area around a point, with the aircraft category. */
export function areaUrl(p: Point, radiusKm: number): string {
  const box = boundingBox(p, radiusKm);
  const q = new URLSearchParams({
    lamin: String(box.lamin),
    lomin: String(box.lomin),
    lamax: String(box.lamax),
    lomax: String(box.lomax),
    extended: "1",
  });
  return `${OPENSKY}/states/all?${q}`;
}

/** `/states/all` for one or more transponders. */
export function icaoUrl(icao24: string[]): string {
  const q = new URLSearchParams(icao24.map((i) => ["icao24", i.toLowerCase()]));
  q.set("extended", "1");
  return `${OPENSKY}/states/all?${q}`;
}

/** Every aircraft in the world: the only way to find a callsign (4 credits). */
export function worldUrl(): string {
  return `${OPENSKY}/states/all?extended=1`;
}

export type Query =
  | { kind: "empty" }
  | { kind: "icao24"; icao24: string }
  | { kind: "callsign"; callsign: string }
  | { kind: "short"; text: string };

/**
 * What was typed in Find Flight: a 24-bit transponder address in hex
 * (`3c6521`, `icao:3c6521`) or a callsign or its start (`AFR`, `afr 1234`,
 * `EZY12AB`). A callsign needs at least 3 characters.
 */
export function parseQuery(text: string): Query {
  const t = text.trim();
  if (!t) return { kind: "empty" };
  const icao = /^(?:icao(?:24)?[:\s]\s*)?([0-9a-f]{6})$/i.exec(t);
  // A six-character string of hex digits that is also a plausible callsign
  // (three letters, then digits: "ABC123") is read as a callsign unless prefixed.
  if (icao && (/^icao/i.test(t) || !/^[a-z]{3}\d/i.test(icao[1]))) {
    return { kind: "icao24", icao24: icao[1].toLowerCase() };
  }
  const callsign = t.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z0-9-]+$/.test(callsign)) return { kind: "short", text: t };
  if (callsign.length < 3) return { kind: "short", text: t };
  return { kind: "callsign", callsign };
}

// ---------------------------------------------------------------------------
// Aircraft

/** An OpenSky state vector, as the API sends it: an array of 17 or 18 values. */
export type StateVector = [
  string, // 0 icao24
  string | null, // 1 callsign
  string, // 2 origin country
  number | null, // 3 time of the last position
  number, // 4 last contact
  number | null, // 5 longitude
  number | null, // 6 latitude
  number | null, // 7 barometric altitude, m
  boolean, // 8 on ground
  number | null, // 9 ground speed, m/s
  number | null, // 10 true track, degrees
  number | null, // 11 vertical rate, m/s
  number[] | null, // 12 sensors
  number | null, // 13 geometric altitude, m
  string | null, // 14 squawk
  boolean, // 15 special purpose indicator
  number, // 16 position source
  number?, // 17 category (with extended=1)
];

export interface StatesResponse {
  time: number;
  states: StateVector[] | null;
}

export interface Aircraft extends Point {
  icao24: string;
  /** Trimmed; empty when the aircraft sends none. */
  callsign: string;
  country: string;
  /** Seconds since 1970. */
  positionTime: number;
  lastContact: number;
  /** Meters; undefined on the ground or when unknown. */
  baroAltitude?: number;
  geoAltitude?: number;
  onGround: boolean;
  /** m/s over the ground. */
  speed?: number;
  /** Degrees from north. */
  track?: number;
  /** m/s, positive when climbing. */
  verticalRate?: number;
  squawk?: string;
  spi: boolean;
  source: number;
  category: number;
  /** From you, when your location is known. */
  distance?: number;
  bearing?: number;
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;

/** Turns an answer into aircraft with a position, nearest first when `from` is given, else by callsign. */
export function parseStates(data: StatesResponse | null | undefined, from?: Point): Aircraft[] {
  const out: Aircraft[] = [];
  const seen = new Set<string>();
  for (const s of data?.states ?? []) {
    const [lon, lat] = [num(s[5]), num(s[6])];
    if (lon === undefined || lat === undefined || seen.has(s[0])) continue;
    seen.add(s[0]);
    const a: Aircraft = {
      icao24: s[0],
      callsign: (s[1] ?? "").trim(),
      country: s[2] ?? "",
      positionTime: num(s[3]) ?? s[4],
      lastContact: s[4],
      latitude: lat,
      longitude: lon,
      baroAltitude: num(s[7]),
      geoAltitude: num(s[13]),
      onGround: s[8] === true,
      speed: num(s[9]),
      track: num(s[10]),
      verticalRate: num(s[11]),
      squawk: s[14] ?? undefined,
      spi: s[15] === true,
      source: s[16] ?? 0,
      category: num(s[17]) ?? 0,
    };
    if (from) {
      a.distance = distanceKm(from, a);
      a.bearing = bearing(from, a);
    }
    out.push(a);
  }
  return from
    ? out.sort((a, b) => a.distance! - b.distance!)
    : out.sort((a, b) => !a.callsign !== !b.callsign ? (a.callsign ? -1 : 1) : a.callsign.localeCompare(b.callsign));
}

/** Adds the distance and bearing from `from`, keeping the order. */
export function measureFrom(aircraft: Aircraft[], from?: Point): Aircraft[] {
  if (!from) return aircraft;
  return aircraft.map((a) => ({ ...a, distance: distanceKm(from, a), bearing: bearing(from, a) }));
}

/** The best altitude we know: barometric (what pilots fly), else GPS. */
export function altitude(a: Aircraft): number | undefined {
  return a.onGround ? undefined : a.baroAltitude ?? a.geoAltitude;
}

/** Aircraft whose callsign starts with `prefix` ("AFR" → every Air France flight). */
export function matchCallsign(aircraft: Aircraft[], prefix: string): Aircraft[] {
  const p = prefix.replace(/\s+/g, "").toUpperCase();
  const exact = aircraft.filter((a) => a.callsign === p);
  const starts = aircraft.filter((a) => a.callsign !== p && a.callsign.startsWith(p));
  return [...exact, ...starts];
}

export type Phase = "ground" | "climbing" | "descending" | "level";

/** On the ground, climbing or descending (more than 1.5 m/s, ~300 ft/min), or level. */
export function phase(a: Aircraft): Phase {
  if (a.onGround) return "ground";
  const v = a.verticalRate ?? 0;
  return v > 1.5 ? "climbing" : v < -1.5 ? "descending" : "level";
}

export const PHASE_TEXT: Record<Phase, string> = {
  ground: "On the ground",
  climbing: "Climbing",
  descending: "Descending",
  level: "Level flight",
};

const PHASE_COLOR: Record<Phase, Color> = { ground: "gray", climbing: "green", descending: "orange", level: "blue" };

/** The emergency transponder codes. */
export const SQUAWKS: Record<string, string> = {
  "7500": "Hijacking",
  "7600": "Radio failure",
  "7700": "General emergency",
};

export function emergency(a: Aircraft): string | undefined {
  return a.squawk ? SQUAWKS[a.squawk] : undefined;
}

/** ADS-B emitter categories, as OpenSky numbers them with `extended=1`. */
export const CATEGORIES: Record<number, string> = {
  2: "Light aircraft (< 7 t)",
  3: "Small aircraft (7–34 t)",
  4: "Large aircraft (34–136 t)",
  5: "Large, high vortex (B757)",
  6: "Heavy aircraft (> 136 t)",
  7: "High performance",
  8: "Helicopter",
  9: "Glider",
  10: "Balloon or airship",
  11: "Parachutist",
  12: "Ultralight",
  14: "Drone",
  15: "Space vehicle",
  16: "Emergency vehicle",
  17: "Service vehicle",
  18: "Obstacle",
  19: "Obstacle",
  20: "Obstacle",
};

export const SOURCES = ["ADS-B", "ASTERIX", "MLAT", "FLARM"];

/**
 * ICAO airline designators: the first three letters of an airline callsign.
 * Only well known ones; the rest show the callsign alone.
 */
export const AIRLINES: Record<string, string> = {
  AAL: "American Airlines",
  ACA: "Air Canada",
  AEA: "Air Europa",
  AEE: "Aegean Airlines",
  AFL: "Aeroflot",
  AFR: "Air France",
  AIC: "Air India",
  ANA: "All Nippon Airways",
  ASA: "Alaska Airlines",
  AUA: "Austrian Airlines",
  AZA: "ITA Airways",
  BAW: "British Airways",
  BEL: "Brussels Airlines",
  BTI: "airBaltic",
  CAL: "China Airlines",
  CCA: "Air China",
  CES: "China Eastern",
  CFG: "Condor",
  CPA: "Cathay Pacific",
  CSN: "China Southern",
  DAL: "Delta Air Lines",
  DLH: "Lufthansa",
  EIN: "Aer Lingus",
  EJU: "easyJet Europe",
  ELY: "El Al",
  ETD: "Etihad Airways",
  ETH: "Ethiopian Airlines",
  EWG: "Eurowings",
  EXS: "Jet2",
  EZS: "easyJet Switzerland",
  EZY: "easyJet",
  FDX: "FedEx",
  FIN: "Finnair",
  GEC: "Lufthansa Cargo",
  HOP: "Air France Hop",
  IBE: "Iberia",
  IBS: "Iberia Express",
  ICE: "Icelandair",
  JAL: "Japan Airlines",
  JBU: "JetBlue",
  KAL: "Korean Air",
  KLM: "KLM",
  LGL: "Luxair",
  LHX: "Lufthansa City Airlines",
  LOT: "LOT Polish Airlines",
  MSR: "EgyptAir",
  NAX: "Norwegian",
  NOZ: "Norwegian",
  NSZ: "Norwegian Air Sweden",
  QFA: "Qantas",
  QTR: "Qatar Airways",
  RAM: "Royal Air Maroc",
  RYR: "Ryanair",
  SAS: "SAS",
  SIA: "Singapore Airlines",
  SWA: "Southwest Airlines",
  SWR: "Swiss",
  SXS: "SunExpress",
  TAP: "TAP Air Portugal",
  THY: "Turkish Airlines",
  TOM: "TUI Airways",
  TRA: "Transavia",
  TVF: "Transavia France",
  UAE: "Emirates",
  UAL: "United Airlines",
  UPS: "UPS Airlines",
  VIR: "Virgin Atlantic",
  VLG: "Vueling",
  VOE: "Volotea",
  WZZ: "Wizz Air",
};

/** The airline of an airline callsign ("RYR679N" → Ryanair), when we know it. */
export function airline(callsign: string): string | undefined {
  const m = /^([A-Z]{3})\d/.exec(callsign);
  return m ? AIRLINES[m[1]] : undefined;
}

// ---------------------------------------------------------------------------
// Units and texts

export type Units = "metric" | "imperial" | "aviation";

/** "metric" (m, km/h), "imperial" (ft, mph) or "aviation" (ft, kt; the default). */
export function unitsOf(pref: unknown): Units {
  const p = String(pref ?? "").trim().toLowerCase();
  return p.startsWith("met") ? "metric" : p.startsWith("imp") ? "imperial" : "aviation";
}

/** A number preference, or its default when it is empty or not a positive number. */
export function numberPref(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim().replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en");

/** "36,000 ft" or "10,973 m". */
export function formatAltitude(m: number, units: Units): string {
  return units === "metric" ? `${fmt(m)} m` : `${fmt(m / 0.3048)} ft`;
}

/** Flight level for altitudes above 3,000 m (~10,000 ft): "FL360". */
export function flightLevel(m: number): string | undefined {
  return m >= 3000 ? `FL${String(Math.round(m / 0.3048 / 100)).padStart(3, "0")}` : undefined;
}

/** "450 kt", "834 km/h" or "518 mph". */
export function formatSpeed(ms: number, units: Units): string {
  if (units === "metric") return `${fmt(ms * 3.6)} km/h`;
  if (units === "imperial") return `${fmt(ms * 2.236936)} mph`;
  return `${fmt(ms * 1.943844)} kt`;
}

/** "+1,200 ft/min" or "−3.6 m/s". */
export function formatVerticalRate(ms: number, units: Units): string {
  const sign = ms > 0 ? "+" : ms < 0 ? "−" : "";
  return units === "metric"
    ? `${sign}${Math.abs(ms).toFixed(1)} m/s`
    : `${sign}${fmt(Math.abs(ms) / 0.3048 * 60)} ft/min`;
}

/** "12 km", "3.4 km", "8 mi" (aviation users get nautical miles: "6.5 NM"). */
export function formatDistance(km: number, units: Units): string {
  const [value, unit] = units === "metric"
    ? [km, "km"]
    : units === "imperial"
    ? [km / 1.609344, "mi"]
    : [km / 1.852, "NM"];
  return value < 10 ? `${value.toFixed(1)} ${unit}` : `${fmt(value)} ${unit}`;
}

/** "just now", "40 s ago", "3 min ago". */
export function ago(seconds: number, nowSeconds: number): string {
  const s = Math.max(0, Math.round(nowSeconds - seconds));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.floor(m / 60)} h ago`;
}

/** The name shown: the callsign, or the transponder address when none is sent. */
export function label(a: Aircraft): string {
  return a.callsign || a.icao24.toUpperCase();
}

/** "120 km NE" from you. */
export function fromYou(a: Aircraft, units: Units): string | undefined {
  if (a.distance === undefined) return undefined;
  const d = formatDistance(a.distance, units);
  return a.distance < 0.5 ? d : `${d} ${compass(a.bearing ?? 0)}`;
}

/** "Look 24° up, to the NE": where to point your eyes. */
export function lookUp(a: Aircraft): string | undefined {
  const alt = altitude(a);
  if (a.distance === undefined || alt === undefined) return undefined;
  const e = elevation(a.distance, alt);
  if (e < 0) return "Below your horizon";
  if (e > 80) return "Almost straight overhead";
  return `Look ${Math.round(e)}° up, to the ${compass(a.bearing ?? 0)}`;
}

export function mapUrl(a: Point): string {
  const [lat, lon] = [a.latitude.toFixed(4), a.longitude.toFixed(4)];
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=10/${lat}/${lon}`;
}

export function adsbExchangeUrl(a: Aircraft): string {
  return `https://globe.adsbexchange.com/?icao=${a.icao24}`;
}

export function flightAwareUrl(callsign: string): string {
  return `https://www.flightaware.com/live/flight/${encodeURIComponent(callsign)}`;
}

/** "RYR679N (Ryanair) · 29,150 ft · 400 kt · 34 km SW of Nice". */
export function shareText(a: Aircraft, units: Units, home?: Place): string {
  const alt = altitude(a);
  const name = airline(a.callsign);
  return [
    `${label(a)}${name ? ` (${name})` : ""}`,
    alt !== undefined ? formatAltitude(alt, units) : PHASE_TEXT.ground,
    ...(a.speed !== undefined && !a.onGround ? [formatSpeed(a.speed, units)] : []),
    a.distance !== undefined && home
      ? `${fromYou(a, units)} of ${home.name}`
      : `${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}`,
  ].join(" · ");
}

/** Footer text: "14 aircraft · 9 in the air". */
export function status(aircraft: Aircraft[]): string {
  if (!aircraft.length) return "No aircraft";
  const flying = aircraft.filter((a) => !a.onGround).length;
  return `${aircraft.length} aircraft · ${flying} in the air`;
}

// ---------------------------------------------------------------------------
// Items

function markdown(a: Aircraft, units: Units, now: number): string {
  const name = airline(a.callsign);
  const lines = [`## ${label(a)}${name ? ` · ${name}` : ""}`, ""];
  const alt = altitude(a);
  const parts = [
    PHASE_TEXT[phase(a)] +
    (alt !== undefined ? ` at ${formatAltitude(alt, units)}${flightLevel(alt) ? ` (${flightLevel(alt)})` : ""}` : ""),
    ...(a.speed !== undefined && a.speed > 0.5
      ? [`${formatSpeed(a.speed, units)} heading ${compass(a.track ?? 0)} (${Math.round(a.track ?? 0)}°)`]
      : []),
  ];
  lines.push(`${parts.join(", ")}.`);
  const look = lookUp(a);
  if (look) lines.push("", `**${look}**, ${fromYou(a, units)} from you.`);
  const sos = emergency(a);
  if (sos) {
    lines.push("", `> **Squawk ${a.squawk}: ${sos.toLowerCase()}.** This transponder code declares an emergency.`);
  }
  if (!a.callsign) lines.push("", "_No callsign: the aircraft does not send its flight number._");
  lines.push("", `_Position from ${SOURCES[a.source] ?? "ADS-B"}, ${ago(a.positionTime, now)}._`);
  return lines.join("\n");
}

function stats(a: Aircraft, units: Units): Stat[] {
  const alt = altitude(a);
  return [
    ...(alt !== undefined ? [{ label: "Altitude", value: formatAltitude(alt, units) }] : []),
    ...(a.speed !== undefined ? [{ label: "Speed", value: formatSpeed(a.speed, units) }] : []),
    ...(a.verticalRate !== undefined && !a.onGround
      ? [{ label: "Vertical", value: formatVerticalRate(a.verticalRate, units), color: PHASE_COLOR[phase(a)] }]
      : []),
    ...(a.distance !== undefined ? [{ label: "From you", value: formatDistance(a.distance, units) }] : []),
  ];
}

function metadata(a: Aircraft, units: Units, now: number): Metadata[] {
  const name = airline(a.callsign);
  const sos = emergency(a);
  return [
    ...(a.callsign ? [meta.text("Callsign", a.callsign, { icon: Icons.tag })] : []),
    ...(name ? [meta.text("Airline", name)] : []),
    meta.text("Transponder (ICAO 24)", a.icao24.toUpperCase(), { icon: Icons.hash }),
    meta.text("Registered in", a.country, { icon: Icons.flag }),
    ...(CATEGORIES[a.category] ? [meta.text("Category", CATEGORIES[a.category])] : []),
    meta.separator(),
    meta.tags("Phase", [{ text: PHASE_TEXT[phase(a)], color: PHASE_COLOR[phase(a)] }]),
    ...(a.baroAltitude !== undefined && !a.onGround
      ? [meta.text("Barometric altitude", formatAltitude(a.baroAltitude, units), { icon: Icons.arrowUp })]
      : []),
    ...(a.geoAltitude !== undefined && !a.onGround
      ? [meta.text("GPS altitude", formatAltitude(a.geoAltitude, units))]
      : []),
    ...(a.speed !== undefined ? [meta.text("Ground speed", formatSpeed(a.speed, units))] : []),
    ...(a.track !== undefined ? [meta.text("Track", `${Math.round(a.track)}° ${compass(a.track)}`)] : []),
    ...(a.verticalRate !== undefined && !a.onGround
      ? [meta.text("Vertical rate", formatVerticalRate(a.verticalRate, units))]
      : []),
    meta.text("Position", `${a.latitude.toFixed(4)}, ${a.longitude.toFixed(4)}`, { icon: Icons.pin }),
    ...(a.distance !== undefined ? [meta.text("From you", fromYou(a, units)!, { icon: Icons.home })] : []),
    meta.separator(),
    ...(a.squawk
      ? [sos ? meta.tags("Squawk", [{ text: `${a.squawk} · ${sos}`, color: "red" }]) : meta.text("Squawk", a.squawk)]
      : []),
    meta.text("Source", SOURCES[a.source] ?? "ADS-B"),
    meta.text("Last seen", ago(a.lastContact, now), { icon: Icons.clock }),
    meta.link("Live map", "globe.adsbexchange.com", adsbExchangeUrl(a)),
  ];
}

export function actions(a: Aircraft, units: Units, home?: Place, extra: Action[] = []): Action[] {
  return [
    open(adsbExchangeUrl(a), "Open on ADS-B Exchange", { icon: Icons.globe }),
    open(mapUrl(a), "Open Position on Map", { icon: Icons.pin, shortcut: "<Ctrl>o" }),
    ...(a.callsign ? [open(flightAwareUrl(a.callsign), "Open on FlightAware", { icon: Icons.external })] : []),
    copy(shareText(a, units, home), "Copy Summary", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(a.callsign ? [copy(a.callsign, "Copy Callsign", { icon: Icons.tag, section: "Copy" })] : []),
    copy(a.icao24, "Copy ICAO 24 Address", { icon: Icons.hash, section: "Copy" }),
    copy(`${a.latitude}, ${a.longitude}`, "Copy Position", { icon: Icons.pin, section: "Copy" }),
    ...extra,
  ];
}

export interface ItemOptions {
  units: Units;
  /** Seconds since 1970, for "40 s ago". */
  now: number;
  home?: Place;
  section?: string;
  extraActions?: Action[];
}

export function aircraftItem(a: Aircraft, o: ItemOptions): Item {
  const alt = altitude(a);
  const p = phase(a);
  const name = airline(a.callsign);
  const sos = emergency(a);
  const where = fromYou(a, o.units);
  return {
    id: a.icao24,
    title: label(a),
    subtitle: [name, a.country].filter(Boolean).join(" · "),
    icon: sos ? { source: Icons.alert, tint: "red" } : a.onGround ? { source: Icons.pin, tint: "gray" } : "✈️",
    section: o.section,
    keywords: [a.icao24, a.country, PHASE_TEXT[p], ...(name ? [name] : []), ...(sos ? ["emergency", sos] : [])],
    accessories: [
      ...(sos ? [{ tag: `${a.squawk} ${sos}`, color: "red" as const }] : []),
      ...(where ? [{ text: where, tooltip: "From you" }] : []),
      ...(a.speed !== undefined && !a.onGround
        ? [{ text: formatSpeed(a.speed, o.units), tooltip: "Ground speed" }]
        : []),
      alt !== undefined
        ? { tag: formatAltitude(alt, o.units), color: PHASE_COLOR[p], tooltip: PHASE_TEXT[p] }
        : { tag: "Ground", color: "gray" as const, tooltip: PHASE_TEXT.ground },
    ],
    detail: { stats: stats(a, o.units), markdown: markdown(a, o.units, o.now), metadata: metadata(a, o.units, o.now) },
    actions: actions(a, o.units, o.home, o.extraActions),
  };
}

/** The views offered as chips in Flights Overhead. */
export const VIEWS = [
  { value: "air", title: "In the Air" },
  { value: "all", title: "All" },
] as const;

export type View = typeof VIEWS[number]["value"];

export function viewOf(value: unknown): View {
  return VIEWS.find((v) => v.value === value)?.value ?? VIEWS[0].value;
}
