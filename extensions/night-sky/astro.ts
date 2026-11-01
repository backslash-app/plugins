// Positions of the Sun and the Moon, the times they cross a given altitude,
// and how much of the Sun the Moon hides seen from a place, computed locally.
// The Sun follows the NOAA solar calculator (Meeus, Astronomical Algorithms
// ch. 25), the Moon the main terms of Meeus ch. 47, parallax Meeus ch. 40.
// Pure functions of a timestamp (ms since 1970, UTC); tested in lib_test.ts.

const RAD = Math.PI / 180;
const DAY = 86_400_000;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);
const norm360 = (deg: number) => ((deg % 360) + 360) % 360;
/** An angle in (-180, 180]. */
export const wrap180 = (deg: number) => {
  const d = norm360(deg);
  return d > 180 ? d - 360 : d;
};

/** Mean distance from the Earth to the Sun, in km. */
const AU = 149_597_870.7;
/** The Earth's equatorial radius, in km. */
const EARTH_RADIUS = 6378.14;

export const julianDay = (ms: number) => ms / DAY + 2440587.5;
const centuries = (ms: number) => (julianDay(ms) - 2451545) / 36525;

/** Where a body is on the sky, as seen from the center of the Earth. */
export interface Equatorial {
  /** Ecliptic longitude and latitude, degrees. */
  lambda: number;
  beta: number;
  /** Right ascension and declination, degrees. */
  ra: number;
  dec: number;
  /** Distance from the Earth, km. */
  distance: number;
}

/** Obliquity of the ecliptic, corrected for nutation, degrees. */
function obliquity(t: number): number {
  const omega = 125.04 - 1934.136 * t;
  const mean = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  return mean + 0.00256 * cos(omega);
}

function toEquatorial(lambda: number, beta: number, distance: number, eps: number): Equatorial {
  const ra = norm360(Math.atan2(sin(lambda) * cos(eps) - Math.tan(beta * RAD) * sin(eps), cos(lambda)) / RAD);
  const dec = Math.asin(sin(beta) * cos(eps) + cos(beta) * sin(eps) * sin(lambda)) / RAD;
  return { lambda: norm360(lambda), beta, ra, dec, distance };
}

/** The Sun's apparent position (NOAA). */
export function sunPosition(ms: number): Equatorial {
  const t = centuries(ms);
  const l0 = norm360(280.46646 + t * (36000.76983 + t * 0.0003032));
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const c = sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) + sin(2 * m) * (0.019993 - 0.000101 * t) +
    sin(3 * m) * 0.000289;
  const trueLong = l0 + c;
  const v = m + c;
  const r = (1.000001018 * (1 - e * e)) / (1 + e * cos(v));
  const omega = 125.04 - 1934.136 * t;
  const lambda = trueLong - 0.00569 - 0.00478 * sin(omega);
  return toEquatorial(lambda, 0, r * AU, obliquity(t));
}

// Meeus table 47.A and 47.B, the terms above 0.008° (and 20 km): [D, M, M', F, Σl, Σr].
const LON_DIST: [number, number, number, number, number, number][] = [
  [0, 0, 1, 0, 6.288774, -20905.355],
  [2, 0, -1, 0, 1.274027, -3699.111],
  [2, 0, 0, 0, 0.658314, -2955.968],
  [0, 0, 2, 0, 0.213618, -569.925],
  [0, 1, 0, 0, -0.185116, 48.888],
  [0, 0, 0, 2, -0.114332, -3.149],
  [2, 0, -2, 0, 0.058793, 246.158],
  [2, -1, -1, 0, 0.057066, -152.138],
  [2, 0, 1, 0, 0.053322, -170.733],
  [2, -1, 0, 0, 0.045758, -204.586],
  [0, 1, -1, 0, -0.040923, -129.62],
  [1, 0, 0, 0, -0.03472, 108.743],
  [0, 1, 1, 0, -0.030383, 104.755],
  [2, 0, 0, -2, 0.015327, 10.321],
  [0, 0, 1, 2, -0.012528, 0],
  [0, 0, 1, -2, 0.01098, 79.661],
  [4, 0, -1, 0, 0.010675, -34.782],
  [0, 0, 3, 0, 0.010034, -23.21],
  [4, 0, -2, 0, 0.008548, -21.636],
  [2, 1, -1, 0, -0.007888, 24.208],
  [2, 1, 0, 0, -0.006766, 30.824],
  [1, 0, -1, 0, -0.005163, -8.379],
  [1, 1, 0, 0, 0.004987, -16.675],
  [2, -1, 1, 0, 0.004036, -12.831],
  [2, 0, 2, 0, 0.003994, -10.445],
  [4, 0, 0, 0, 0.003861, -11.65],
  [2, 0, -3, 0, 0.003665, 14.403],
  [0, 1, -2, 0, -0.002689, -7.003],
  [2, -1, -2, 0, 0.002602, 0],
  [2, -2, 0, 0, 0.00239, 10.056],
  [2, 0, -1, -2, -0.002348, 6.322],
  [0, 2, 0, 0, 0.002236, -9.884],
];
// [D, M, M', F, Σb]
const LAT: [number, number, number, number, number][] = [
  [0, 0, 0, 1, 5.128122],
  [0, 0, 1, 1, 0.280602],
  [0, 0, 1, -1, 0.277693],
  [2, 0, 0, -1, 0.173237],
  [2, 0, -1, 1, 0.055413],
  [2, 0, -1, -1, 0.046271],
  [2, 0, 0, 1, 0.032573],
  [0, 0, 2, 1, 0.017198],
  [2, 0, 1, -1, 0.009266],
  [0, 0, 2, -1, 0.008822],
  [2, -1, 0, -1, 0.008216],
  [2, 0, -2, -1, 0.004324],
  [2, 0, 1, 1, 0.0042],
  [2, 1, 0, -1, -0.003359],
  [2, -1, -1, 1, 0.002463],
  [2, -1, 0, 1, 0.002211],
  [2, -1, -1, -1, 0.002065],
];

/** The Moon's geocentric position (Meeus ch. 47, main terms). */
export function moonPosition(ms: number): Equatorial {
  const t = centuries(ms);
  const lp = 218.3164477 + 481267.88123421 * t;
  const d = 297.8501921 + 445267.1114034 * t;
  const m = 357.5291092 + 35999.0502909 * t;
  const mp = 134.9633964 + 477198.8675055 * t;
  const f = 93.272095 + 483202.0175233 * t;
  // Terms with the Sun's anomaly shrink as the Earth's orbit gets rounder.
  const e = 1 - 0.002516 * t - 0.0000074 * t * t;
  const ecc = (k: number) => Math.abs(k) === 1 ? e : Math.abs(k) === 2 ? e * e : 1;
  let l = 0, r = 0, b = 0;
  for (const [cd, cm, cmp, cf, sl, sr] of LON_DIST) {
    const arg = cd * d + cm * m + cmp * mp + cf * f;
    l += sl * ecc(cm) * sin(arg);
    r += sr * ecc(cm) * cos(arg);
  }
  for (const [cd, cm, cmp, cf, sb] of LAT) b += sb * ecc(cm) * sin(cd * d + cm * m + cmp * mp + cf * f);
  // Nutation in longitude, the main term.
  const omega = 125.04452 - 1934.136261 * t;
  const lambda = lp + l - 0.004778 * sin(omega);
  return toEquatorial(lambda, b, 385000.56 + r, obliquity(t));
}

/** Greenwich mean sidereal time, degrees. */
export function siderealTime(ms: number): number {
  const jd = julianDay(ms);
  const t = (jd - 2451545) / 36525;
  return norm360(280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - (t * t * t) / 38710000);
}

/** Altitude above the horizon and azimuth from north through east, degrees (no refraction). */
export interface Horizontal {
  altitude: number;
  azimuth: number;
}

export function horizontal(ms: number, lat: number, lon: number, body: Equatorial): Horizontal {
  const h = siderealTime(ms) + lon - body.ra;
  const alt = Math.asin(sin(lat) * sin(body.dec) + cos(lat) * cos(body.dec) * cos(h)) / RAD;
  const az = norm360(Math.atan2(sin(h), cos(h) * sin(lat) - Math.tan(body.dec * RAD) * cos(lat)) / RAD + 180);
  return { altitude: alt, azimuth: az };
}

/** How much the air lifts a body near the horizon (Bennett), degrees. */
export function refraction(altitude: number): number {
  if (altitude < -1.9) return 0;
  return 1 / Math.tan((altitude + 7.31 / (altitude + 4.4)) * RAD) / 60;
}

export const sunHorizontal = (ms: number, lat: number, lon: number) => horizontal(ms, lat, lon, sunPosition(ms));
export const moonHorizontal = (ms: number, lat: number, lon: number) => horizontal(ms, lat, lon, moonPosition(ms));

/** The Moon's horizontal parallax, degrees. */
export const parallax = (distance: number) => Math.asin(EARTH_RADIUS / distance) / RAD;

/**
 * The Sun's rise and set altitude: its upper edge touches the horizon,
 * refraction included (NOAA's -0.833°).
 */
export const SUN_HORIZON = -0.833;

/**
 * The Moon's rise and set altitude, which depends on its distance: refraction
 * and semi-diameter lower it, parallax raises it (Meeus ch. 15).
 */
export const moonHorizon = (distance: number) => 0.7275 * parallax(distance) - 0.5667;

// ---------------------------------------------------------------------------
// Crossings

export interface Crossings {
  /** When the value goes above zero, then below it, in order. */
  rises: number[];
  sets: number[];
  /** Whether the value is above zero at `start`. */
  aboveAtStart: boolean;
}

/**
 * When `f` crosses zero between `start` and `end`: sampled every `step`, each
 * sign change refined by bisection to the second.
 */
export function crossings(f: (ms: number) => number, start: number, end: number, step = 10 * 60_000): Crossings {
  const rises: number[] = [];
  const sets: number[] = [];
  let t0 = start;
  let v0 = f(t0);
  const aboveAtStart = v0 > 0;
  while (t0 < end) {
    const t1 = Math.min(t0 + step, end);
    const v1 = f(t1);
    if ((v0 > 0) !== (v1 > 0)) {
      let [a, b, va] = [t0, t1, v0];
      while (b - a > 1000) {
        const mid = (a + b) / 2;
        const vm = f(mid);
        if ((vm > 0) === (va > 0)) [a, va] = [mid, vm];
        else b = mid;
      }
      const at = Math.round((a + b) / 2);
      (v1 > 0 ? rises : sets).push(at);
    }
    [t0, v0] = [t1, v1];
  }
  return { rises, sets, aboveAtStart };
}

/** When the Sun is highest: its hour angle is zero, found by Newton steps from `guess`. */
export function solarTransit(guess: number, lon: number): number {
  let t = guess;
  for (let i = 0; i < 4; i++) {
    const h = wrap180(siderealTime(t) + lon - sunPosition(t).ra);
    t -= (h / 360.9856) * DAY;
  }
  return Math.round(t);
}

// ---------------------------------------------------------------------------
// Moon phase

/** Mean length of a lunation, days. */
export const SYNODIC_MONTH = 29.530588853;

/** How far the Moon is ahead of the Sun along the ecliptic: 0 new, 90 first quarter, 180 full, 270 last quarter. */
export function elongation(ms: number): number {
  return norm360(moonPosition(ms).lambda - sunPosition(ms).lambda);
}

export interface Illumination {
  /** 0 to 360, see {@link elongation}. */
  angle: number;
  /** Lit part of the disk, 0 to 1. */
  fraction: number;
  waxing: boolean;
  /** Days since the last new moon, about. */
  age: number;
}

export function illumination(ms: number): Illumination {
  const sun = sunPosition(ms);
  const moon = moonPosition(ms);
  const angle = norm360(moon.lambda - sun.lambda);
  // Geocentric elongation, then the phase angle seen from the Moon (Meeus ch. 48).
  const psi = Math.acos(cos(moon.beta) * cos(moon.lambda - sun.lambda));
  const i = Math.atan2(sun.distance * Math.sin(psi), moon.distance - sun.distance * Math.cos(psi));
  return { angle, fraction: (1 + Math.cos(i)) / 2, waxing: angle < 180, age: (angle / 360) * SYNODIC_MONTH };
}

/** The first time after `from` that the Moon is `target` degrees ahead of the Sun (0 new moon, 180 full…). */
export function nextPhaseAt(from: number, target: number): number {
  const rate = 360 / SYNODIC_MONTH; // degrees a day, on average
  let t = from + (norm360(target - elongation(from)) / rate) * DAY;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 6; i++) t -= (wrap180(elongation(t) - target) / rate) * DAY;
    if (t > from) break;
    t += SYNODIC_MONTH * DAY;
  }
  return Math.round(t);
}

// ---------------------------------------------------------------------------
// The Moon seen from a place, for solar eclipses

/** The Moon's mean radius and the Sun's, km. */
const MOON_RADIUS = 1737.4;
const SUN_RADIUS = 696_000;

/** Where the Moon is seen from a place at sea level: shifted by up to a degree by parallax (Meeus ch. 40). */
export function topocentricMoon(ms: number, lat: number, lon: number): Equatorial {
  const moon = moonPosition(ms);
  // Geocentric latitude of the place, on the WGS 84 ellipsoid.
  const u = Math.atan(0.99664719 * Math.tan(lat * RAD));
  const rhoSin = 0.99664719 * Math.sin(u);
  const rhoCos = Math.cos(u);
  const sinPi = EARTH_RADIUS / moon.distance;
  const h = (siderealTime(ms) + lon - moon.ra) * RAD;
  const dec = moon.dec * RAD;
  const dRa = Math.atan2(-rhoCos * sinPi * Math.sin(h), Math.cos(dec) - rhoCos * sinPi * Math.cos(h));
  const decT = Math.atan2(
    (Math.sin(dec) - rhoSin * sinPi) * Math.cos(dRa),
    Math.cos(dec) - rhoCos * sinPi * Math.cos(h),
  );
  // Distance from the place: the Moon is closer when it is high.
  const x = Math.cos(dec) * Math.cos(h) - rhoCos * sinPi;
  const y = Math.cos(dec) * Math.sin(h);
  const z = Math.sin(dec) - rhoSin * sinPi;
  return { ...moon, ra: norm360(moon.ra + dRa / RAD), dec: decT / RAD, distance: moon.distance * Math.hypot(x, y, z) };
}

/** Angle between two points of the sky, degrees. */
export function separation(a: { ra: number; dec: number }, b: { ra: number; dec: number }): number {
  const c = sin(a.dec) * sin(b.dec) + cos(a.dec) * cos(b.dec) * cos(a.ra - b.ra);
  return Math.acos(Math.max(-1, Math.min(1, c))) / RAD;
}

export interface SolarOverlap {
  /** Fraction of the Sun's diameter covered: above 1 or the Moon inside the Sun means total or annular. */
  magnitude: number;
  /** Fraction of the Sun's disk hidden, 0 to 1. */
  obscuration: number;
  /** "total" when the Moon covers the whole Sun, "annular" when it sits inside it. */
  central?: "total" | "annular";
  /** The Sun's altitude, degrees (no refraction). */
  sunAltitude: number;
}

/** Area shared by two disks of radii r1 and r2 whose centers are d apart. */
function overlapArea(r1: number, r2: number, d: number): number {
  if (d >= r1 + r2) return 0;
  if (d <= Math.abs(r1 - r2)) return Math.PI * Math.min(r1, r2) ** 2;
  const a = r1 * r1 * Math.acos((d * d + r1 * r1 - r2 * r2) / (2 * d * r1));
  const b = r2 * r2 * Math.acos((d * d + r2 * r2 - r1 * r1) / (2 * d * r2));
  const c = 0.5 * Math.sqrt((-d + r1 + r2) * (d + r1 - r2) * (d - r1 + r2) * (d + r1 + r2));
  return a + b - c;
}

/** How much of the Sun the Moon hides, seen from a place. */
export function solarOverlap(ms: number, lat: number, lon: number): SolarOverlap {
  const sun = sunPosition(ms);
  const moon = topocentricMoon(ms, lat, lon);
  const rs = Math.asin(SUN_RADIUS / sun.distance) / RAD;
  const rm = Math.asin(MOON_RADIUS / moon.distance) / RAD;
  const d = separation(sun, moon);
  const magnitude = d >= rs + rm ? 0 : (rs + rm - d) / (2 * rs);
  const obscuration = overlapArea(rs, rm, d) / (Math.PI * rs * rs);
  const central = d <= rm - rs ? "total" : d <= rs - rm ? "annular" : undefined;
  return { magnitude, obscuration, central, sunAltitude: horizontal(ms, lat, lon, sun).altitude };
}
