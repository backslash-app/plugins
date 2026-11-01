// Coordinates: parsing and formatting of every common notation, and distances.
// Everything is computed here, on the WGS 84 ellipsoid; nothing leaves the computer.

export interface Point {
  lat: number;
  lon: number;
}

const DEG = Math.PI / 180;
const WGS84 = { a: 6378137, f: 1 / 298.257223563 };
/** Mean Earth radius (IUGG), for the spherical formulas. */
export const EARTH_RADIUS_KM = 6371.0088;

export const normLon = (lon: number) => ((((lon + 180) % 360) + 360) % 360) - 180;
const round = (x: number, digits: number) => Math.round(x * 10 ** digits) / 10 ** digits;

// ---------------------------------------------------------------------------
// UTM (Krüger series, accurate to well under a millimetre within a zone)

export interface Utm {
  zone: number;
  /** Latitude band, C to X. */
  band: string;
  hemisphere: "N" | "S";
  easting: number;
  northing: number;
}

const BANDS = "CDEFGHJKLMNPQRSTUVWXX";

const n = WGS84.f / (2 - WGS84.f);
const E = Math.sqrt(WGS84.f * (2 - WGS84.f));
const A = WGS84.a / (1 + n) * (1 + n ** 2 / 4 + n ** 4 / 64 + n ** 6 / 256);
const K0 = 0.9996;
const ALPHA = [
  0,
  n / 2 - 2 / 3 * n ** 2 + 5 / 16 * n ** 3 + 41 / 180 * n ** 4 - 127 / 288 * n ** 5 + 7891 / 37800 * n ** 6,
  13 / 48 * n ** 2 - 3 / 5 * n ** 3 + 557 / 1440 * n ** 4 + 281 / 630 * n ** 5 - 1983433 / 1935360 * n ** 6,
  61 / 240 * n ** 3 - 103 / 140 * n ** 4 + 15061 / 26880 * n ** 5 + 167603 / 181440 * n ** 6,
  49561 / 161280 * n ** 4 - 179 / 168 * n ** 5 + 6601661 / 7257600 * n ** 6,
  34729 / 80640 * n ** 5 - 3418889 / 1995840 * n ** 6,
  212378941 / 319334400 * n ** 6,
];
const BETA = [
  0,
  n / 2 - 2 / 3 * n ** 2 + 37 / 96 * n ** 3 - 1 / 360 * n ** 4 - 81 / 512 * n ** 5 + 96199 / 604800 * n ** 6,
  1 / 48 * n ** 2 + 1 / 15 * n ** 3 - 437 / 1440 * n ** 4 + 46 / 105 * n ** 5 - 1118711 / 3870720 * n ** 6,
  17 / 480 * n ** 3 - 37 / 840 * n ** 4 - 209 / 4480 * n ** 5 + 5569 / 90720 * n ** 6,
  4397 / 161280 * n ** 4 - 11 / 504 * n ** 5 - 830251 / 7257600 * n ** 6,
  4583 / 161280 * n ** 5 - 108847 / 3991680 * n ** 6,
  20648693 / 638668800 * n ** 6,
];

/** The latitude band letter, or undefined outside 80°S–84°N. */
export function bandOf(lat: number): string | undefined {
  if (lat < -80 || lat > 84) return undefined;
  return BANDS[Math.floor(lat / 8 + 10)];
}

/** The UTM zone, with the Norway and Svalbard exceptions. */
export function zoneOf(p: Point): number {
  const lon = normLon(p.lon);
  let zone = Math.floor((lon + 180) / 6) + 1;
  if (zone > 60) zone = 60;
  if (p.lat >= 56 && p.lat < 64 && lon >= 3 && lon < 12) zone = 32;
  if (p.lat >= 72 && p.lat <= 84 && lon >= 0 && lon < 42) {
    zone = lon < 9 ? 31 : lon < 21 ? 33 : lon < 33 ? 35 : 37;
  }
  return zone;
}

const centralMeridian = (zone: number) => (zone - 1) * 6 - 180 + 3;

function project(p: Point, zone: number): { x: number; y: number } {
  const φ = p.lat * DEG;
  const λ = (normLon(p.lon) - centralMeridian(zone)) * DEG;
  const τ = Math.tan(φ);
  const σ = Math.sinh(E * Math.atanh(E * τ / Math.sqrt(1 + τ * τ)));
  const τp = τ * Math.sqrt(1 + σ * σ) - σ * Math.sqrt(1 + τ * τ);
  const ξp = Math.atan2(τp, Math.cos(λ));
  const ηp = Math.asinh(Math.sin(λ) / Math.sqrt(τp * τp + Math.cos(λ) ** 2));
  let ξ = ξp, η = ηp;
  for (let j = 1; j <= 6; j++) {
    ξ += ALPHA[j] * Math.sin(2 * j * ξp) * Math.cosh(2 * j * ηp);
    η += ALPHA[j] * Math.cos(2 * j * ξp) * Math.sinh(2 * j * ηp);
  }
  return { x: K0 * A * η, y: K0 * A * ξ };
}

/** UTM coordinates of a point; throws outside 80°S–84°N (the polar areas use UPS). */
export function toUtm(p: Point, forceZone?: number): Utm {
  const band = bandOf(p.lat);
  if (!band) throw new Error("UTM covers 80°S to 84°N; the poles use UPS");
  const zone = forceZone ?? zoneOf(p);
  const { x, y } = project(p, zone);
  const hemisphere = p.lat >= 0 ? "N" : "S";
  return { zone, band, hemisphere, easting: x + 500000, northing: hemisphere === "S" ? y + 10000000 : y };
}

export function fromUtm(zone: number, hemisphere: "N" | "S", easting: number, northing: number): Point {
  if (zone < 1 || zone > 60) throw new Error("UTM zones go from 1 to 60");
  const x = easting - 500000;
  const y = hemisphere === "S" ? northing - 10000000 : northing;
  const η = x / (K0 * A), ξ = y / (K0 * A);
  let ξp = ξ, ηp = η;
  for (let j = 1; j <= 6; j++) {
    ξp -= BETA[j] * Math.sin(2 * j * ξ) * Math.cosh(2 * j * η);
    ηp -= BETA[j] * Math.cos(2 * j * ξ) * Math.sinh(2 * j * η);
  }
  const sinhηp = Math.sinh(ηp), sinξp = Math.sin(ξp), cosξp = Math.cos(ξp);
  const τp = sinξp / Math.sqrt(sinhηp * sinhηp + cosξp * cosξp);
  let τ = τp;
  for (let i = 0; i < 20; i++) {
    const σ = Math.sinh(E * Math.atanh(E * τ / Math.sqrt(1 + τ * τ)));
    const τi = τ * Math.sqrt(1 + σ * σ) - σ * Math.sqrt(1 + τ * τ);
    const δ = (τp - τi) / Math.sqrt(1 + τi * τi) * (1 + (1 - E * E) * τ * τ) /
      ((1 - E * E) * Math.sqrt(1 + τ * τ));
    τ += δ;
    if (Math.abs(δ) < 1e-12) break;
  }
  const lat = Math.atan(τ) / DEG;
  const lon = normLon(Math.atan2(sinhηp, cosξp) / DEG + centralMeridian(zone));
  return { lat, lon };
}

export function formatUtm(u: Utm): string {
  return `${u.zone}${u.band} ${Math.floor(u.easting)} ${Math.floor(u.northing)}`;
}

// ---------------------------------------------------------------------------
// MGRS

const COLS = ["ABCDEFGH", "JKLMNPQR", "STUVWXYZ"];
const ROWS = "ABCDEFGHJKLMNPQRSTUV";

export interface Mgrs {
  zone: number;
  band: string;
  square: string;
  easting: string;
  northing: string;
}

export function toMgrs(p: Point, digits = 5): Mgrs {
  const u = toUtm(p);
  const col = COLS[(u.zone - 1) % 3][Math.floor(u.easting / 100000) - 1];
  const row = ROWS[(Math.floor(u.northing / 100000) + (u.zone % 2 === 0 ? 5 : 0)) % 20];
  const cut = (v: number) => String(Math.floor(v % 100000)).padStart(5, "0").slice(0, digits);
  return { zone: u.zone, band: u.band, square: col + row, easting: cut(u.easting), northing: cut(u.northing) };
}

export function formatMgrs(m: Mgrs, spaced = true): string {
  const parts = [`${m.zone}${m.band}`, m.square, m.easting, m.northing].filter(Boolean);
  return spaced ? parts.join(" ") : parts.join("");
}

/** The centre of an MGRS square of the given precision. */
export function fromMgrs(zone: number, band: string, square: string, digits: string): Point {
  band = band.toUpperCase();
  square = square.toUpperCase();
  if (!BANDS.includes(band) || band === "X" && zone > 60) throw new Error(`"${band}" is not a latitude band`);
  if (digits.length % 2) throw new Error("An MGRS reference has as many easting digits as northing digits");
  const half = digits.length / 2;
  const col = COLS[(zone - 1) % 3].indexOf(square[0]);
  const rowIndex = ROWS.indexOf(square[1]);
  if (col < 0 || rowIndex < 0) throw new Error(`"${square}" is not a 100 km square of zone ${zone}`);
  const size = 10 ** (5 - half);
  const e = half ? Number(digits.slice(0, half)) * size : 0;
  const nn = half ? Number(digits.slice(half)) * size : 0;
  const easting = (col + 1) * 100000 + e + size / 2;
  const row = (rowIndex - (zone % 2 === 0 ? 5 : 0) + 20) % 20;
  const bandLat = (BANDS.indexOf(band) - 10) * 8;
  const hemisphere = band >= "N" ? "N" : "S";
  const bandBottom = Math.floor(toUtm({ lat: bandLat, lon: centralMeridian(zone) }, zone).northing / 100000) *
    100000;
  let northing = row * 100000 + nn + size / 2;
  while (northing < bandBottom) northing += 2000000;
  return fromUtm(zone, hemisphere, easting, northing);
}

// ---------------------------------------------------------------------------
// Geohash

const BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz";

export function toGeohash(p: Point, length = 9): string {
  let latR = [-90, 90], lonR = [-180, 180];
  let hash = "", bit = 0, ch = 0, even = true;
  const lon = normLon(p.lon);
  while (hash.length < length) {
    const r = even ? lonR : latR;
    const v = even ? lon : p.lat;
    const mid = (r[0] + r[1]) / 2;
    if (v >= mid) {
      ch = ch * 2 + 1;
      r[0] = mid;
    } else {
      ch *= 2;
      r[1] = mid;
    }
    if (even) lonR = r;
    else latR = r;
    even = !even;
    if (++bit === 5) {
      hash += BASE32[ch];
      bit = 0;
      ch = 0;
    }
  }
  return hash;
}

/** The centre of the geohash cell, and its half sizes in degrees. */
export function fromGeohash(hash: string): Point & { latErr: number; lonErr: number } {
  const latR = [-90, 90], lonR = [-180, 180];
  let even = true;
  for (const c of hash.toLowerCase()) {
    const v = BASE32.indexOf(c);
    if (v < 0) throw new Error(`"${c}" is not a geohash character`);
    for (let b = 4; b >= 0; b--) {
      const r = even ? lonR : latR;
      const mid = (r[0] + r[1]) / 2;
      if ((v >> b) & 1) r[0] = mid;
      else r[1] = mid;
      even = !even;
    }
  }
  return {
    lat: (latR[0] + latR[1]) / 2,
    lon: (lonR[0] + lonR[1]) / 2,
    latErr: (latR[1] - latR[0]) / 2,
    lonErr: (lonR[1] - lonR[0]) / 2,
  };
}

// ---------------------------------------------------------------------------
// Open Location Code (Plus Codes)

const OLC = "23456789CFGHJMPQRVWX";
// Integer units: latitude in 1/(8000·5^5) degrees, longitude in 1/(8000·4^5) degrees.
const LAT_GRID = 8000 * 3125;
const LON_GRID = 8000 * 1024;

export function toPlusCode(p: Point, length = 10): string {
  if (length < 2 || length > 15 || (length < 10 && length % 2)) throw new Error("Invalid Plus Code length");
  const lat = Math.min(Math.max(p.lat, -90), 90);
  let latInt = Math.floor(Math.round((lat + 90) * LAT_GRID * 1e6) / 1e6);
  let lonInt = Math.floor(Math.round((normLon(p.lon) + 180) * LON_GRID * 1e6) / 1e6);
  if (latInt >= 180 * LAT_GRID) latInt = 180 * LAT_GRID - 1;
  if (lonInt >= 360 * LON_GRID) lonInt -= 360 * LON_GRID;
  // The grid part: five characters of 5 rows × 4 columns.
  let grid = "";
  for (let i = 0; i < 5; i++) {
    grid = OLC[(latInt % 5) * 4 + (lonInt % 4)] + grid;
    latInt = Math.floor(latInt / 5);
    lonInt = Math.floor(lonInt / 4);
  }
  // The pair part: five pairs of base 20 digits, latitude first.
  let pairs = "";
  for (let i = 0; i < 5; i++) {
    pairs = OLC[latInt % 20] + OLC[lonInt % 20] + pairs;
    latInt = Math.floor(latInt / 20);
    lonInt = Math.floor(lonInt / 20);
  }
  const code = (pairs + grid).slice(0, length);
  return code.length < 8 ? code.padEnd(8, "0") + "+" : code.slice(0, 8) + "+" + code.slice(8);
}

/** The centre of a full Plus Code's area. */
export function fromPlusCode(code: string): Point & { latSize: number; lonSize: number } {
  const clean = code.toUpperCase().replace("+", "").replace(/0+$/, "");
  if (!isFullPlusCode(code)) throw new Error("Not a full Plus Code");
  let lat = 0, lon = 0;
  let latRes = 20, lonRes = 20;
  for (let i = 0; i < Math.min(clean.length, 10); i += 2) {
    lat += OLC.indexOf(clean[i]) * latRes;
    lon += OLC.indexOf(clean[i + 1] ?? "2") * lonRes;
    if (i + 2 < Math.min(clean.length, 10)) {
      latRes /= 20;
      lonRes /= 20;
    }
  }
  for (let i = 10; i < clean.length; i++) {
    latRes /= 5;
    lonRes /= 4;
    const v = OLC.indexOf(clean[i]);
    lat += Math.floor(v / 4) * latRes;
    lon += (v % 4) * lonRes;
  }
  return { lat: lat - 90 + latRes / 2, lon: lon - 180 + lonRes / 2, latSize: latRes, lonSize: lonRes };
}

export function isFullPlusCode(code: string): boolean {
  const c = code.toUpperCase();
  if (!/^[23456789CFGHJMPQRVWX0]{8}\+[23456789CFGHJMPQRVWX]*$/.test(c)) return false;
  const [head, tail] = c.split("+");
  const pad = head.indexOf("0");
  if (pad >= 0 && (pad % 2 || /[^0]/.test(head.slice(pad)) || tail.length)) return false;
  // The first latitude digit is at most 8 (180°), the first longitude digit at most R (360°).
  return OLC.indexOf(c[0]) <= 8 && OLC.indexOf(c[1]) <= 17;
}

// ---------------------------------------------------------------------------
// Degrees, minutes, seconds

function split(value: number, parts: 2 | 3, decimals: number): number[] {
  const abs = Math.abs(value);
  if (parts === 2) {
    let d = Math.floor(abs);
    let m = round((abs - d) * 60, decimals);
    if (m >= 60) {
      d += 1;
      m -= 60;
    }
    return [d, m];
  }
  let d = Math.floor(abs);
  let m = Math.floor((abs - d) * 60);
  let s = round(((abs - d) * 60 - m) * 60, decimals);
  if (s >= 60) {
    s -= 60;
    m += 1;
  }
  if (m >= 60) {
    m -= 60;
    d += 1;
  }
  return [d, m, s];
}

const pad2 = (x: number, decimals: number) => {
  const [int, frac] = x.toFixed(decimals).split(".");
  return int.padStart(2, "0") + (frac ? "." + frac : "");
};

export function formatDms(p: Point, decimals = 1): string {
  const one = (v: number, pos: string, neg: string) => {
    const [d, m, s] = split(v, 3, decimals);
    return `${d}°${String(m).padStart(2, "0")}′${pad2(s, decimals)}″${v < 0 ? neg : pos}`;
  };
  return `${one(p.lat, "N", "S")} ${one(normLon(p.lon), "E", "W")}`;
}

export function formatDdm(p: Point, decimals = 3): string {
  const one = (v: number, pos: string, neg: string) => {
    const [d, m] = split(v, 2, decimals);
    return `${d}°${pad2(m, decimals)}′${v < 0 ? neg : pos}`;
  };
  return `${one(p.lat, "N", "S")} ${one(normLon(p.lon), "E", "W")}`;
}

export function formatDecimal(p: Point, decimals = 6): string {
  const f = (x: number) => String(round(x, decimals));
  return `${f(p.lat)}, ${f(normLon(p.lon))}`;
}

// ---------------------------------------------------------------------------
// Distances

export function haversineKm(a: Point, b: Point): number {
  const φ1 = a.lat * DEG, φ2 = b.lat * DEG;
  const dφ = φ2 - φ1, dλ = (b.lon - a.lon) * DEG;
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial great-circle bearing from a to b, in degrees from north. */
export function bearing(a: Point, b: Point): number {
  const φ1 = a.lat * DEG, φ2 = b.lat * DEG, dλ = (b.lon - a.lon) * DEG;
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

export function midpoint(a: Point, b: Point): Point {
  const φ1 = a.lat * DEG, φ2 = b.lat * DEG, λ1 = a.lon * DEG, dλ = (b.lon - a.lon) * DEG;
  const bx = Math.cos(φ2) * Math.cos(dλ), by = Math.cos(φ2) * Math.sin(dλ);
  const φ = Math.atan2(Math.sin(φ1) + Math.sin(φ2), Math.sqrt((Math.cos(φ1) + bx) ** 2 + by ** 2));
  const λ = λ1 + Math.atan2(by, Math.cos(φ1) + bx);
  return { lat: φ / DEG, lon: normLon(λ / DEG) };
}

export interface Geodesic {
  /** Metres on the WGS 84 ellipsoid. */
  meters: number;
  initial: number;
  final: number;
}

/** Vincenty's inverse formula; undefined when it does not converge (nearly antipodal points). */
export function vincenty(p1: Point, p2: Point): Geodesic | undefined {
  const { a, f } = WGS84;
  const b = a * (1 - f);
  const L = (p2.lon - p1.lon) * DEG;
  const U1 = Math.atan((1 - f) * Math.tan(p1.lat * DEG));
  const U2 = Math.atan((1 - f) * Math.tan(p2.lat * DEG));
  const sinU1 = Math.sin(U1), cosU1 = Math.cos(U1), sinU2 = Math.sin(U2), cosU2 = Math.cos(U2);
  let λ = L, prev: number;
  let sinσ = 0, cosσ = 1, σ = 0, cos2α = 1, cos2σm = 0, sinλ = 0, cosλ = 1;
  let iterations = 0;
  do {
    sinλ = Math.sin(λ);
    cosλ = Math.cos(λ);
    const t = cosU1 * sinU2 - sinU1 * cosU2 * cosλ;
    sinσ = Math.sqrt((cosU2 * sinλ) ** 2 + t * t);
    if (sinσ === 0) return { meters: 0, initial: 0, final: 0 };
    cosσ = sinU1 * sinU2 + cosU1 * cosU2 * cosλ;
    σ = Math.atan2(sinσ, cosσ);
    const sinα = cosU1 * cosU2 * sinλ / sinσ;
    cos2α = 1 - sinα * sinα;
    cos2σm = cos2α !== 0 ? cosσ - 2 * sinU1 * sinU2 / cos2α : 0;
    const C = f / 16 * cos2α * (4 + f * (4 - 3 * cos2α));
    prev = λ;
    λ = L + (1 - C) * f * sinα * (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm ** 2)));
    if (++iterations > 200) return undefined;
  } while (Math.abs(λ - prev) > 1e-12);
  const u2 = cos2α * (a * a - b * b) / (b * b);
  const Acoef = 1 + u2 / 16384 * (4096 + u2 * (-768 + u2 * (320 - 175 * u2)));
  const B = u2 / 1024 * (256 + u2 * (-128 + u2 * (74 - 47 * u2)));
  const Δσ = B * sinσ * (cos2σm + B / 4 * (cosσ * (-1 + 2 * cos2σm ** 2) -
        B / 6 * cos2σm * (-3 + 4 * sinσ ** 2) * (-3 + 4 * cos2σm ** 2)));
  const meters = b * Acoef * (σ - Δσ);
  const α1 = Math.atan2(cosU2 * sinλ, cosU1 * sinU2 - sinU1 * cosU2 * cosλ);
  const α2 = Math.atan2(cosU1 * sinλ, -sinU1 * cosU2 + cosU1 * sinU2 * cosλ);
  return { meters, initial: (α1 / DEG + 360) % 360, final: (α2 / DEG + 360) % 360 };
}

const COMPASS = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
export const compass = (deg: number) => COMPASS[Math.round(deg / 22.5) % 16];

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${round(km, 2)} km`;
  return `${new Intl.NumberFormat("en-US").format(Math.round(km))} km`;
}

export function formatMiles(km: number): string {
  const mi = km / 1.609344, nmi = km / 1.852;
  const f = (x: number) => x < 100 ? String(round(x, 2)) : new Intl.NumberFormat("en-US").format(Math.round(x));
  return `${f(mi)} mi · ${f(nmi)} nmi`;
}

// ---------------------------------------------------------------------------
// Parsing

export type Notation = "decimal" | "dms" | "ddm" | "utm" | "mgrs" | "geohash" | "pluscode";

export const NOTATION_TITLE: Record<Notation, string> = {
  decimal: "Decimal degrees",
  dms: "Degrees, minutes, seconds",
  ddm: "Degrees and decimal minutes",
  utm: "UTM",
  mgrs: "MGRS",
  geohash: "Geohash",
  pluscode: "Plus Code",
};

export interface Parsed {
  point: Point;
  notation: Notation;
  /** Something worth saying about how the input was read. */
  note?: string;
}

const MGRS_RE = /^(\d{1,2})\s*([C-HJ-NP-X])\s*([A-HJ-NP-Z])\s*([A-HJ-NP-V])\s*(\d*)\s*(\d*)$/i;
const UTM_RE = /^(\d{1,2})\s*([A-Z])\s+(\d+(?:\.\d+)?)\s*m?\s*E?\s*[,\s]\s*(\d+(?:\.\d+)?)\s*m?\s*N?$/i;

function parseUtm(text: string): Parsed | undefined {
  const m = UTM_RE.exec(text);
  if (!m) return undefined;
  const zone = Number(m[1]), letter = m[2].toUpperCase();
  const easting = Number(m[3]), northing = Number(m[4]);
  if (zone < 1 || zone > 60) throw new Error("UTM zones go from 1 to 60");
  if (easting < 100000 || easting > 900000) throw new Error("A UTM easting is between 100 000 and 900 000 m");
  if (northing > 10000000) throw new Error("A UTM northing is under 10 000 000 m");
  // A band letter (C–X), unless N or S only makes sense as a hemisphere.
  if (BANDS.includes(letter)) {
    const hemisphere = letter >= "N" ? "N" : "S";
    const p = fromUtm(zone, hemisphere, easting, northing);
    if (bandOf(p.lat) === letter || letter === "X" && p.lat >= 72) return { point: p, notation: "utm" };
  }
  if (letter === "N" || letter === "S") {
    return {
      point: fromUtm(zone, letter, easting, northing),
      notation: "utm",
      note: `Read ${letter} as the hemisphere`,
    };
  }
  throw new Error(`Northing ${northing} is not in latitude band ${letter}`);
}

function parseMgrs(text: string): Parsed | undefined {
  const m = MGRS_RE.exec(text.replace(/\s+/g, " ").trim());
  if (!m) return undefined;
  const digits = m[5] + m[6];
  if (m[5] && m[6] && m[5].length !== m[6].length) {
    throw new Error("MGRS easting and northing need the same number of digits");
  }
  if (digits.length > 10) throw new Error("MGRS references have at most 5 + 5 digits");
  const zone = Number(m[1]);
  if (zone < 1 || zone > 60) throw new Error("UTM zones go from 1 to 60");
  const p = fromMgrs(zone, m[2], m[3] + m[4], digits);
  const precision = ["100 km", "10 km", "1 km", "100 m", "10 m", "1 m"][digits.length / 2];
  return { point: p, notation: "mgrs", note: digits.length < 10 ? `A ${precision} square: its centre` : undefined };
}

const HEMI = /(?<![A-Za-z])([NSEWO])(?![A-Za-z])/gi;

function parseAngle(text: string, kind: "lat" | "lon"): { value: number; style: "decimal" | "dms" | "ddm" } {
  const letter = /(?<![A-Za-z])([NSEWO])(?![A-Za-z])/i.exec(text)?.[1]?.toUpperCase();
  const nums = [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((x) => Number(x[0].replace(",", ".")));
  if (!nums.length || nums.length > 3) throw new Error(`"${text.trim()}" is not an angle`);
  const [d, m = 0, s = 0] = nums;
  if (nums.length > 1 && !Number.isInteger(d)) throw new Error("Only the last number of an angle can have decimals");
  if (m >= 60 || s >= 60) throw new Error("Minutes and seconds are under 60");
  if (nums.length === 3 && !Number.isInteger(m)) throw new Error("Only the last number of an angle can have decimals");
  let value = d + m / 60 + s / 3600;
  const negative = /^\s*[NSEWO]?\s*-/i.test(text) || letter === "S" || letter === "W" || letter === "O";
  if (negative) value = -value;
  if (letter && kind === "lat" && !"NS".includes(letter)) throw new Error("Latitude first, or write N/S and E/W");
  return { value, style: nums.length === 3 ? "dms" : nums.length === 2 ? "ddm" : "decimal" };
}

/** Splits "lat lon" written in degrees into its two halves. */
function halves(text: string): [string, string] | undefined {
  if (text.includes(";")) {
    const [a, b, ...rest] = text.split(";");
    return rest.length ? undefined : [a, b];
  }
  const letters = [...text.matchAll(HEMI)];
  if (letters.length === 2) {
    const [l1, l2] = letters;
    // "N 48 51 E 2 17" (prefix) or "48 51 N 2 17 E" (suffix).
    if (text.slice(0, l1.index).trim() === "") return [text.slice(0, l2.index), text.slice(l2.index)];
    const cut = l1.index! + 1;
    return [text.slice(0, cut), text.slice(cut)];
  }
  if (letters.length > 2) return undefined;
  const simple = /^\s*(-?\d+(?:\.\d+)?)\s*°?\s*[,\s]\s*(-?\d+(?:\.\d+)?)\s*°?\s*$/.exec(text);
  if (simple) return [simple[1], simple[2]];
  const commas = /^\s*(-?\d+,\d+)\s+(-?\d+,\d+)\s*$/.exec(text);
  if (commas) return [commas[1], commas[2]];
  if (/,/.test(text) && text.split(",").length === 2) {
    const [a, b] = text.split(",");
    return [a, b];
  }
  // Symbols: the second angle starts at the second number followed by °.
  const degs = [...text.matchAll(/-?\d+(?:\.\d+)?\s*°/g)];
  if (degs.length === 2) return [text.slice(0, degs[1].index), text.slice(degs[1].index)];
  // Bare numbers: 4 → 2 + 2, 6 → 3 + 3.
  const nums = text.trim().split(/\s+/);
  if (nums.every((x) => /^-?\d+(?:\.\d+)?$/.test(x)) && (nums.length === 4 || nums.length === 6)) {
    const h = nums.length / 2;
    return [nums.slice(0, h).join(" "), nums.slice(h).join(" ")];
  }
  return undefined;
}

function parseDegrees(raw: string): Parsed | undefined {
  const text = raw
    .replace(/[′’‘`´]/g, "'")
    .replace(/[″“”]|''/g, '"')
    .replace(/[º˚]/g, "°")
    .replace(/[−–]/g, "-")
    .replace(/\b(lat(itude)?|lon(gitude)?|lng)\s*[:=]?/gi, " ")
    .replace(/^[([]|[)\]]$/g, "")
    .trim();
  if (!/\d/.test(text) || /[^\d\s.,;°'"NSEWO+-]/i.test(text)) return undefined;
  const h = halves(text);
  if (!h) return undefined;
  let [a, b] = h;
  const firstLetter = /(?<![A-Za-z])([NSEWO])(?![A-Za-z])/i.exec(a)?.[1]?.toUpperCase();
  let note: string | undefined;
  if (firstLetter && "EWO".includes(firstLetter)) [a, b] = [b, a];
  const lat = parseAngle(a, "lat"), lon = parseAngle(b, "lon");
  let point = { lat: lat.value, lon: lon.value };
  if (Math.abs(point.lat) > 90) {
    if (Math.abs(point.lon) <= 90 && !firstLetter) {
      point = { lat: point.lon, lon: point.lat };
      note = "Read as longitude, latitude";
    } else throw new Error("Latitude is between -90 and 90");
  }
  if (Math.abs(point.lon) > 180) throw new Error("Longitude is between -180 and 180");
  const style = lat.style === lon.style ? lat.style : lat.style === "decimal" ? lon.style : lat.style;
  return { point, notation: style, note };
}

/** Reads a point in any notation; undefined when it doesn't look like one, throws when it is wrong. */
export function parsePoint(input: string): Parsed | undefined {
  const text = input.trim().replace(/^geo:/i, "").replace(/\?.*$/, "");
  if (!text) return undefined;
  const plus = text.replace(/\s+/g, "");
  if (/^[23456789CFGHJMPQRVWX0]{2,8}\+[23456789CFGHJMPQRVWX]*$/i.test(plus)) {
    if (!isFullPlusCode(plus)) {
      throw new Error("A short Plus Code (like V75V+8Q Paris) needs its town: type the full code");
    }
    return { point: fromPlusCode(plus), notation: "pluscode" };
  }
  const gh = /^(?:geohash[:\s]+)?([0-9b-hjkmnp-z]{1,12})$/i.exec(text);
  if (gh && (/^geohash/i.test(text) || (gh[1].length >= 4 && /[b-z]/i.test(gh[1]) && /\d/.test(gh[1])))) {
    const p = fromGeohash(gh[1]);
    return { point: { lat: p.lat, lon: p.lon }, notation: "geohash" };
  }
  return parseMgrs(text) ?? parseUtm(text) ?? parseDegrees(text);
}

// ---------------------------------------------------------------------------
// Queries

export type Query =
  | { kind: "empty" }
  | { kind: "point"; parsed: Parsed }
  | { kind: "distance"; from: Parsed; to: Parsed }
  | { kind: "error"; message: string };

export function parseQuery(input: string): Query {
  const text = input.trim();
  if (!text) return { kind: "empty" };
  try {
    const parts = text.split(/\s+(?:to|vers|→|->|=>)\s+|\s*(?:→|->|=>)\s*/i);
    if (parts.length === 2) {
      const from = parsePoint(parts[0]), to = parsePoint(parts[1]);
      if (from && to) return { kind: "distance", from, to };
    }
    const parsed = parsePoint(text);
    if (parsed) return { kind: "point", parsed };
    return { kind: "error", message: "Not a coordinate I can read" };
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
}

export interface Formatted {
  notation: Notation;
  text: string;
  /** Another way to copy it, e.g. MGRS without spaces. */
  compact?: string;
  precision?: string;
}

/** The point in every notation (UTM and MGRS only between 80°S and 84°N). */
export function allFormats(p: Point): Formatted[] {
  const out: Formatted[] = [
    { notation: "decimal", text: formatDecimal(p), compact: `${round(p.lat, 6)} ${round(normLon(p.lon), 6)}` },
    { notation: "dms", text: formatDms(p) },
    { notation: "ddm", text: formatDdm(p) },
  ];
  if (bandOf(p.lat)) {
    const u = toUtm(p);
    out.push({
      notation: "utm",
      text: formatUtm(u),
      compact: `${u.zone}${u.hemisphere} ${Math.floor(u.easting)} ${Math.floor(u.northing)}`,
      precision: "1 m",
    });
    const m = toMgrs(p);
    out.push({ notation: "mgrs", text: formatMgrs(m), compact: formatMgrs(m, false), precision: "1 m" });
  }
  out.push({ notation: "geohash", text: toGeohash(p, 9), compact: toGeohash(p, 12), precision: "about 5 m" });
  out.push({ notation: "pluscode", text: toPlusCode(p, 11), compact: toPlusCode(p, 10), precision: "about 3 m" });
  return out;
}

export function osmUrl(p: Point, zoom = 16): string {
  const lat = round(p.lat, 6), lon = round(normLon(p.lon), 6);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${zoom}/${lat}/${lon}`;
}

export function googleMapsUrl(p: Point): string {
  return `https://www.google.com/maps/search/?api=1&query=${round(p.lat, 6)},${round(normLon(p.lon), 6)}`;
}

export function osmRouteUrl(a: Point, b: Point): string {
  const f = (p: Point) => `${round(p.lat, 6)},${round(normLon(p.lon), 6)}`;
  return `https://www.openstreetmap.org/directions?route=${f(a)};${f(b)}`;
}

export const EXAMPLES = [
  { query: "48.8584, 2.2945", title: "Decimal degrees" },
  { query: `48°51'30"N 2°17'40"E`, title: "Degrees, minutes, seconds" },
  { query: "31U 448251 5411943", title: "UTM" },
  { query: "31UDQ4825111943", title: "MGRS" },
  { query: "u09tunquc", title: "Geohash" },
  { query: "8FW4V75V+8Q", title: "Plus Code" },
  { query: "48.8584, 2.2945 to 40.6892, -74.0445", title: "Distance, bearing and midpoint" },
];
