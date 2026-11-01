// The planets' positions and brightness, computed locally from Paul
// Schlyter's low-precision orbital elements ("How to compute planetary
// positions"), with the main perturbations of Jupiter, Saturn and Uranus:
// good to a few arcminutes between 1900 and 2100, plenty to know where to
// look. Pure functions of a timestamp (ms since 1970, UTC).

import { type Equatorial, type Horizontal, horizontal } from "./astro.ts";

const RAD = Math.PI / 180;
const DAY = 86_400_000;
const sin = (deg: number) => Math.sin(deg * RAD);
const cos = (deg: number) => Math.cos(deg * RAD);
const norm360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Mean distance from the Earth to the Sun, in km. */
export const AU = 149_597_870.7;

export type PlanetId = "mercury" | "venus" | "mars" | "jupiter" | "saturn" | "uranus" | "neptune";

export const PLANET_IDS: PlanetId[] = ["mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];

/** Days since 1999 Dec 31, 0h UT: Schlyter's day number. */
export const dayNumber = (ms: number) => ms / DAY + 2440587.5 - 2451543.5;

interface Elements {
  /** Longitude of the ascending node, inclination, argument of perihelion, degrees. */
  N: number;
  i: number;
  w: number;
  /** Semi-major axis, AU. */
  a: number;
  e: number;
  /** Mean anomaly, degrees. */
  M: number;
}

// [N0, N1, i0, i1, w0, w1, a0, a1, e0, e1, M0, M1]: value = x0 + x1 * d.
const ELEMENTS: Record<PlanetId, number[]> = {
  mercury: [
    48.3313,
    3.24587e-5,
    7.0047,
    5.0e-8,
    29.1241,
    1.01444e-5,
    0.387098,
    0,
    0.205635,
    5.59e-10,
    168.6562,
    4.0923344368,
  ],
  venus: [
    76.6799,
    2.4659e-5,
    3.3946,
    2.75e-8,
    54.891,
    1.38374e-5,
    0.72333,
    0,
    0.006773,
    -1.302e-9,
    48.0052,
    1.6021302244,
  ],
  mars: [
    49.5574,
    2.11081e-5,
    1.8497,
    -1.78e-8,
    286.5016,
    2.92961e-5,
    1.523688,
    0,
    0.093405,
    2.516e-9,
    18.6021,
    0.5240207766,
  ],
  jupiter: [
    100.4542,
    2.76854e-5,
    1.303,
    -1.557e-7,
    273.8777,
    1.64505e-5,
    5.20256,
    0,
    0.048498,
    4.469e-9,
    19.895,
    0.0830853001,
  ],
  saturn: [
    113.6634,
    2.3898e-5,
    2.4886,
    -1.081e-7,
    339.3939,
    2.97661e-5,
    9.55475,
    0,
    0.055546,
    -9.499e-9,
    316.967,
    0.0334442282,
  ],
  uranus: [
    74.0005,
    1.3978e-5,
    0.7733,
    1.9e-8,
    96.6612,
    3.0565e-5,
    19.18171,
    -1.55e-8,
    0.047318,
    7.45e-9,
    142.5905,
    0.011725806,
  ],
  neptune: [
    131.7806,
    3.0173e-5,
    1.77,
    -2.55e-7,
    272.8461,
    -6.027e-6,
    30.05826,
    3.313e-8,
    0.008606,
    2.15e-9,
    260.2471,
    0.005995147,
  ],
};

function elements(id: PlanetId, d: number): Elements {
  const x = ELEMENTS[id];
  return {
    N: x[0] + x[1] * d,
    i: x[2] + x[3] * d,
    w: x[4] + x[5] * d,
    a: x[6] + x[7] * d,
    e: x[8] + x[9] * d,
    M: norm360(x[10] + x[11] * d),
  };
}

/** Solves Kepler's equation, degrees in and out. */
export function eccentricAnomaly(M: number, e: number): number {
  let E = M + (e / RAD) * sin(M) * (1 + e * cos(M));
  for (let k = 0; k < 30; k++) {
    const next = E - (E - (e / RAD) * sin(E) - M) / (1 - e * cos(E));
    if (Math.abs(next - E) < 1e-7) return next;
    E = next;
  }
  return E;
}

interface Vector {
  x: number;
  y: number;
  z: number;
}

/** Position in the orbit's frame turned into heliocentric ecliptic coordinates, AU. */
function orbitPosition(el: Elements): Vector {
  const E = eccentricAnomaly(el.M, el.e);
  const xv = el.a * (cos(E) - el.e);
  const yv = el.a * Math.sqrt(1 - el.e * el.e) * sin(E);
  const v = Math.atan2(yv, xv) / RAD;
  const r = Math.hypot(xv, yv);
  const vw = v + el.w;
  return {
    x: r * (cos(el.N) * cos(vw) - sin(el.N) * sin(vw) * cos(el.i)),
    y: r * (sin(el.N) * cos(vw) + cos(el.N) * sin(vw) * cos(el.i)),
    z: r * sin(vw) * sin(el.i),
  };
}

/** The Sun as seen from the Earth (Schlyter), ecliptic of date, AU. */
function sunVector(d: number): Vector {
  const w = 282.9404 + 4.70935e-5 * d;
  const e = 0.016709 - 1.151e-9 * d;
  const M = norm360(356.047 + 0.9856002585 * d);
  const E = eccentricAnomaly(M, e);
  const xv = cos(E) - e;
  const yv = Math.sqrt(1 - e * e) * sin(E);
  const v = Math.atan2(yv, xv) / RAD;
  const r = Math.hypot(xv, yv);
  return { x: r * cos(v + w), y: r * sin(v + w), z: 0 };
}

/** Longitude and latitude corrections from the giant planets pulling on each other, degrees. */
function perturbations(id: PlanetId, d: number): { lon: number; lat: number } {
  const Mj = norm360(ELEMENTS.jupiter[10] + ELEMENTS.jupiter[11] * d);
  const Ms = norm360(ELEMENTS.saturn[10] + ELEMENTS.saturn[11] * d);
  const Mu = norm360(ELEMENTS.uranus[10] + ELEMENTS.uranus[11] * d);
  if (id === "jupiter") {
    return {
      lon: -0.332 * sin(2 * Mj - 5 * Ms - 67.6) - 0.056 * sin(2 * Mj - 2 * Ms + 21) +
        0.042 * sin(3 * Mj - 5 * Ms + 21) - 0.036 * sin(Mj - 2 * Ms) + 0.022 * cos(Mj - Ms) +
        0.023 * sin(2 * Mj - 3 * Ms + 52) - 0.016 * sin(Mj - 5 * Ms - 69),
      lat: 0,
    };
  }
  if (id === "saturn") {
    return {
      lon: 0.812 * sin(2 * Mj - 5 * Ms - 67.6) - 0.229 * cos(2 * Mj - 4 * Ms - 2) + 0.119 * sin(Mj - 2 * Ms - 3) +
        0.046 * sin(2 * Mj - 6 * Ms - 69) + 0.014 * sin(Mj - 3 * Ms + 32),
      lat: -0.02 * cos(2 * Mj - 4 * Ms - 2) + 0.018 * sin(2 * Mj - 6 * Ms - 49),
    };
  }
  if (id === "uranus") {
    return {
      lon: 0.04 * sin(Ms - 2 * Mu + 6) + 0.035 * sin(Ms - 3 * Mu + 33) - 0.015 * sin(Mj - Mu + 20),
      lat: 0,
    };
  }
  return { lon: 0, lat: 0 };
}

export interface PlanetPosition extends Equatorial {
  /** Distance from the Sun and from the Earth, AU. */
  r: number;
  delta: number;
  /** Angle Sun–planet–Earth, degrees: 0 is full, 180 is new. */
  phaseAngle: number;
  /** Lit part of the disk seen from the Earth, 0 to 1. */
  illuminated: number;
  /** Angular distance from the Sun, degrees, and whether the planet is east of it (evening sky). */
  elongation: number;
  east: boolean;
  /** Apparent visual magnitude: lower is brighter. */
  magnitude: number;
}

/** Saturn's rings tilt: how open they look from the Earth, degrees. */
export function saturnRingTilt(lon: number, lat: number, d: number): number {
  const ir = 28.06;
  const Nr = 169.51 + 3.82e-5 * d;
  return Math.asin(sin(lat) * cos(ir) - cos(lat) * sin(ir) * sin(lon - Nr)) / RAD;
}

function magnitude(id: PlanetId, r: number, delta: number, fv: number, ringTilt: number): number {
  const base = 5 * Math.log10(r * delta);
  switch (id) {
    case "mercury":
      return -0.36 + base + 0.027 * fv + 2.2e-13 * fv ** 6;
    case "venus":
      return -4.34 + base + 0.013 * fv + 4.2e-7 * fv ** 3;
    case "mars":
      return -1.51 + base + 0.016 * fv;
    case "jupiter":
      return -9.4 + base + 0.014 * fv;
    case "saturn":
      return -9.0 + base + 0.044 * fv - 2.6 * Math.abs(sin(ringTilt)) + 1.2 * sin(ringTilt) ** 2;
    case "uranus":
      return -7.15 + base + 0.001 * fv;
    case "neptune":
      return -6.9 + base + 0.001 * fv;
  }
}

/** Where a planet is, seen from the center of the Earth, of date. */
export function planetPosition(id: PlanetId, ms: number): PlanetPosition {
  const d = dayNumber(ms);
  const h = orbitPosition(elements(id, d));
  const r = Math.hypot(h.x, h.y, h.z);
  let lon = Math.atan2(h.y, h.x) / RAD;
  let lat = Math.asin(h.z / r) / RAD;
  const p = perturbations(id, d);
  lon += p.lon;
  lat += p.lat;
  const hx = r * cos(lon) * cos(lat);
  const hy = r * sin(lon) * cos(lat);
  const hz = r * sin(lat);

  const s = sunVector(d);
  const gx = hx + s.x;
  const gy = hy + s.y;
  const gz = hz + s.z;
  const delta = Math.hypot(gx, gy, gz);
  const gLon = norm360(Math.atan2(gy, gx) / RAD);
  const gLat = Math.asin(gz / delta) / RAD;

  const ecl = 23.4393 - 3.563e-7 * d;
  const xe = gx;
  const ye = gy * cos(ecl) - gz * sin(ecl);
  const ze = gy * sin(ecl) + gz * cos(ecl);
  const ra = norm360(Math.atan2(ye, xe) / RAD);
  const dec = Math.atan2(ze, Math.hypot(xe, ye)) / RAD;

  const R = Math.hypot(s.x, s.y);
  const cosFv = (r * r + delta * delta - R * R) / (2 * r * delta);
  const fv = Math.acos(Math.max(-1, Math.min(1, cosFv))) / RAD;
  const cosElong = (R * R + delta * delta - r * r) / (2 * R * delta);
  const elongation = Math.acos(Math.max(-1, Math.min(1, cosElong))) / RAD;
  const sunLon = norm360(Math.atan2(s.y, s.x) / RAD);
  const east = norm360(gLon - sunLon) < 180;
  const ring = id === "saturn" ? saturnRingTilt(gLon, gLat, d) : 0;

  return {
    lambda: gLon,
    beta: gLat,
    ra,
    dec,
    distance: delta * AU,
    r,
    delta,
    phaseAngle: fv,
    illuminated: (1 + cos(fv)) / 2,
    elongation,
    east,
    magnitude: magnitude(id, r, delta, fv, ring),
  };
}

export const planetHorizontal = (id: PlanetId, ms: number, lat: number, lon: number): Horizontal =>
  horizontal(ms, lat, lon, planetPosition(id, ms));
