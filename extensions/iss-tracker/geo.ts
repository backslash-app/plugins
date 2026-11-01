// From SGP4's positions to what people want to know: the point of the Earth
// under the station, how high it is in your sky, whether the Sun lights it
// while your sky is dark, and its passes over your place. Pure, tested in
// lib_test.ts.

import { gmst, propagateAt, type Satrec } from "./sgp4.ts";

const DEG = Math.PI / 180;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

// WGS 84, for places on the ground.
const WGS84_A = 6378.137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
/** The Earth's mean radius for the shadow, km. */
const EARTH_RADIUS = 6371;
const AU = 149_597_870.7;

type Vec = [number, number, number];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm = (a: Vec) => Math.hypot(a[0], a[1], a[2]);

/** TEME (inertial) to Earth-fixed: a turn by sidereal time (polar motion ignored). */
export function temeToEcef(r: Vec, ms: number): Vec {
  const g = gmst(ms);
  const c = Math.cos(g);
  const s = Math.sin(g);
  return [c * r[0] + s * r[1], -s * r[0] + c * r[1], r[2]];
}

export interface Geodetic {
  latitude: number;
  longitude: number;
  /** Height above the WGS 84 ellipsoid, km. */
  altitude: number;
}

export function ecefToGeodetic(r: Vec): Geodetic {
  const [x, y, z] = r;
  const p = Math.hypot(x, y);
  const lon = Math.atan2(y, x);
  let lat = Math.atan2(z, p * (1 - WGS84_E2));
  let h = 0;
  for (let i = 0; i < 6; i++) {
    const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(lat) ** 2);
    h = p / Math.cos(lat) - n;
    lat = Math.atan2(z, p * (1 - (WGS84_E2 * n) / (n + h)));
  }
  return { latitude: lat / DEG, longitude: ((lon / DEG + 540) % 360) - 180, altitude: h };
}

export function geodeticToEcef(lat: number, lon: number, altitude = 0): Vec {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
  return [
    (n + altitude) * Math.cos(phi) * Math.cos(lambda),
    (n + altitude) * Math.cos(phi) * Math.sin(lambda),
    (n * (1 - WGS84_E2) + altitude) * Math.sin(phi),
  ];
}

export interface LookAngles {
  /** Degrees above the horizon, degrees from north through east, km. */
  elevation: number;
  azimuth: number;
  range: number;
}

/** Where a point fixed to the Earth (`target`, km) is in the sky of a place. */
export function lookAngles(target: Vec, lat: number, lon: number): LookAngles {
  const obs = geodeticToEcef(lat, lon);
  const [dx, dy, dz] = sub(target, obs);
  const phi = lat * DEG;
  const lambda = lon * DEG;
  // South, East, Zenith.
  const s = Math.sin(phi) * Math.cos(lambda) * dx + Math.sin(phi) * Math.sin(lambda) * dy - Math.cos(phi) * dz;
  const e = -Math.sin(lambda) * dx + Math.cos(lambda) * dy;
  const z = Math.cos(phi) * Math.cos(lambda) * dx + Math.cos(phi) * Math.sin(lambda) * dy + Math.sin(phi) * dz;
  const range = Math.hypot(s, e, z);
  return {
    elevation: Math.asin(z / range) / DEG,
    azimuth: ((Math.atan2(e, -s) / DEG) + 360) % 360,
    range,
  };
}

/** The Sun's direction and distance in the inertial frame, km (NOAA's algorithm, Meeus ch. 25). */
export function sunVector(ms: number): Vec {
  const t = (ms / 86_400_000 + 2440587.5 - 2451545) / 36525;
  const l0 = 280.46646 + t * (36000.76983 + t * 0.0003032);
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = Math.sin(m * DEG) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m * DEG) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m * DEG) * 0.000289;
  const v = m + c;
  const r = ((1.000001018 * (1 - e * e)) / (1 + e * Math.cos(v * DEG))) * AU;
  const omega = 125.04 - 1934.136 * t;
  const lambda = (l0 + c - 0.00569 - 0.00478 * Math.sin(omega * DEG)) * DEG;
  const eps =
    (23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * DEG)) *
    DEG;
  return [r * Math.cos(lambda), r * Math.cos(eps) * Math.sin(lambda), r * Math.sin(eps) * Math.sin(lambda)];
}

/** The Sun's elevation at a place, degrees. */
export function sunElevation(ms: number, lat: number, lon: number): number {
  return lookAngles(temeToEcef(sunVector(ms), ms), lat, lon).elevation;
}

/** Whether a point (inertial frame, km) is in the Earth's shadow: a cylinder behind the Earth, good enough this close. */
export function inShadow(r: Vec, sun: Vec): boolean {
  const toSun = sun.map((x) => x / norm(sun)) as Vec;
  const along = dot(r, toSun);
  if (along > 0) return false;
  const perpendicular = norm(sub(r, toSun.map((x) => x * along) as Vec));
  return perpendicular < EARTH_RADIUS;
}

export interface Fix {
  at: number;
  latitude: number;
  longitude: number;
  /** km above the ground. */
  altitude: number;
  /** km/h, relative to the Earth's center. */
  speed: number;
  sunlit: boolean;
  /** Radius of the area from where it is above the horizon, km. */
  footprint: number;
}

export function fixAt(s: Satrec, ms: number): Fix {
  const sv = propagateAt(s, ms);
  const g = ecefToGeodetic(temeToEcef(sv.position, ms));
  const speed = norm(sv.velocity) * 3600;
  const r = norm(sv.position);
  // The arc of the Earth over which the station is above the horizon.
  const footprint = EARTH_RADIUS * Math.acos(EARTH_RADIUS / r);
  return { at: ms, ...g, speed, sunlit: !inShadow(sv.position, sunVector(ms)), footprint };
}

/** Where the station is in a place's sky, and whether it can be seen. */
export interface SkyPoint {
  at: number;
  elevation: number;
  azimuth: number;
  range: number;
  sunlit: boolean;
  /** The Sun's elevation at the place. */
  sunElevation: number;
}

export function skyPoint(s: Satrec, ms: number, lat: number, lon: number): SkyPoint {
  const sv = propagateAt(s, ms);
  const look = lookAngles(temeToEcef(sv.position, ms), lat, lon);
  const sun = sunVector(ms);
  return {
    at: ms,
    ...look,
    sunlit: !inShadow(sv.position, sun),
    sunElevation: lookAngles(temeToEcef(sun, ms), lat, lon).elevation,
  };
}

/** The sky must be at least this dark (the Sun this far below the horizon) to see the station. */
export const DARK_ENOUGH = -6;
/** Below this elevation it is lost in haze and behind buildings. */
export const LOW = 10;

/** Seen from the ground, the station shines like this at 1000 km, half lit (the usual standard). */
const STANDARD_MAGNITUDE = -1.8;

/** About how bright: farther is fainter, and a station lit from behind shows less of its lit side. */
export function magnitude(s: Satrec, ms: number, lat: number, lon: number): number {
  const sv = propagateAt(s, ms);
  const obs = rotateToInertial(geodeticToEcef(lat, lon), ms);
  const toObserver = sub(obs, sv.position);
  const toSun = sub(sunVector(ms), sv.position);
  const range = norm(toObserver);
  const phase = Math.acos(Math.max(-1, Math.min(1, dot(toObserver, toSun) / (range * norm(toSun)))));
  const lit = (Math.sin(phase) + (Math.PI - phase) * Math.cos(phase)) / Math.PI;
  return STANDARD_MAGNITUDE + 5 * Math.log10(range / 1000) - 2.5 * Math.log10(Math.max(lit, 1e-3) * Math.PI);
}

function rotateToInertial(r: Vec, ms: number): Vec {
  const g = gmst(ms);
  const c = Math.cos(g);
  const s = Math.sin(g);
  return [c * r[0] - s * r[1], s * r[0] + c * r[1], r[2]];
}

export interface Pass {
  rise: SkyPoint;
  culmination: SkyPoint;
  set: SkyPoint;
  /** The part of the pass that can be seen: sunlit station, dark sky, above LOW degrees. */
  visible?: { from: SkyPoint; to: SkyPoint; highest: SkyPoint; magnitude: number };
  /** Why it can't be seen: too low, a daylight sky, or the station in the Earth's shadow. */
  hidden?: "low" | "daylight" | "shadow";
}

/** Refines when `f` changes sign between a and b (f(a) and f(b) differ), to the second. */
function bisect(f: (t: number) => boolean, a: number, b: number): number {
  const fa = f(a);
  while (b - a > 1000) {
    const mid = (a + b) / 2;
    if (f(mid) === fa) a = mid;
    else b = mid;
  }
  return Math.round((a + b) / 2);
}

/** The passes above the horizon between `from` and `to`, found every 30 seconds and refined to the second. */
export function passes(s: Satrec, lat: number, lon: number, from: number, to: number): Pass[] {
  const step = 30_000;
  const up = (t: number) => skyPoint(s, t, lat, lon).elevation > 0;
  const out: Pass[] = [];
  let t = from;
  let wasUp = up(t);
  // A pass already under way: start with its rise.
  if (wasUp) {
    let back = t;
    while (up(back - step) && from - back < HOUR) back -= step;
    t = back;
  }
  let riseAt: number | undefined = wasUp ? t : undefined;
  for (t += step; t <= to + 20 * MINUTE; t += step) {
    const isUp = up(t);
    if (isUp && !wasUp) riseAt = bisect(up, t - step, t);
    if (!isUp && wasUp && riseAt !== undefined) {
      const setAt = bisect(up, t - step, t);
      if (riseAt <= to) out.push(describePass(s, lat, lon, riseAt, setAt));
      riseAt = undefined;
    }
    wasUp = isUp;
  }
  return out;
}

const seeable = (p: SkyPoint) => p.sunlit && p.sunElevation < DARK_ENOUGH && p.elevation >= LOW;

function describePass(s: Satrec, lat: number, lon: number, riseAt: number, setAt: number): Pass {
  const points: SkyPoint[] = [];
  for (let t = riseAt; t < setAt; t += 5000) points.push(skyPoint(s, t, lat, lon));
  points.push(skyPoint(s, setAt, lat, lon));
  const culmination = points.reduce((a, b) => (b.elevation > a.elevation ? b : a));
  const seen = points.filter(seeable);
  let visible: Pass["visible"];
  if (seen.length) {
    const highest = seen.reduce((a, b) => (b.elevation > a.elevation ? b : a));
    const brightest = Math.min(...seen.map((p) => magnitude(s, p.at, lat, lon)));
    visible = { from: seen[0], to: seen[seen.length - 1], highest, magnitude: brightest };
  }
  let hidden: Pass["hidden"];
  if (!visible) {
    const high = points.filter((p) => p.elevation >= LOW);
    hidden = !high.length ? "low" : high.every((p) => p.sunElevation >= DARK_ENOUGH) ? "daylight" : "shadow";
  }
  return { rise: points[0], culmination, set: points[points.length - 1], visible, hidden };
}
