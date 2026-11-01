// What the sky holds for a place: when it is dark, where and when each
// planet can be seen, how a meteor shower's peak night looks, and how an
// eclipse looks from there. Pure functions, tested in lib_test.ts.

import {
  type Crossings,
  crossings,
  horizontal,
  illumination,
  moonHorizon,
  moonHorizontal,
  moonPosition,
  refraction,
  siderealTime,
  solarOverlap,
  sunHorizontal,
  sunPosition,
  wrap180,
} from "./astro.ts";
import { type Eclipse, type Shower } from "./data.ts";
import { type PlanetId, planetPosition } from "./planets.ts";
import { addDays, type Day, dayOf, type Place, startOfDay, zoneOf } from "./places.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Stretches of `[start, end]` where the crossed value is above zero. */
export function intervals(c: Crossings, start: number, end: number): [number, number][] {
  const events = [...c.rises.map((t) => [t, 1] as const), ...c.sets.map((t) => [t, -1] as const)]
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let from: number | undefined = c.aboveAtStart ? start : undefined;
  for (const [t, kind] of events) {
    if (kind === 1 && from === undefined) from = t;
    else if (kind === -1 && from !== undefined) {
      out.push([from, t]);
      from = undefined;
    }
  }
  if (from !== undefined) out.push([from, end]);
  return out;
}

// ---------------------------------------------------------------------------
// Darkness

/** The Sun this far below the horizon: planets and bright stars show (end of civil twilight). */
export const DUSK = -6;
/** The Sun this far below the horizon: the sky is dark enough for meteors (end of nautical twilight). */
export const DARK = -12;

export interface Night {
  /** The evening this night starts on. */
  day: Day;
  /** From local noon to the next noon: rise and set times are looked for in it. */
  noon: number;
  nextNoon: number;
  /** When the Sun is below `depth` degrees; missing when it never gets that low (white nights). */
  from?: number;
  to?: number;
  /** "dark" all night long (polar night), "never" dark, or "normal". */
  state: "normal" | "dark" | "never";
}

/** The night that starts on the evening of `day`, at the place, with the Sun below `depth`. */
export function night(day: Day, place: Place, depth = DUSK): Night {
  const zone = zoneOf(place);
  const noon = startOfDay(day, zone) + 12 * HOUR;
  const nextNoon = startOfDay(addDays(day, 1), zone) + 12 * HOUR;
  const f = (t: number) => depth - sunHorizontal(t, place.latitude, place.longitude).altitude;
  const c = crossings(f, noon, nextNoon);
  const dark = intervals(c, noon, nextNoon);
  if (!dark.length) return { day, noon, nextNoon, state: "never" };
  const [from, to] = dark.reduce((a, b) => (b[1] - b[0] > a[1] - a[0] ? b : a));
  return { day, noon, nextNoon, from, to, state: from === noon && to === nextNoon ? "dark" : "normal" };
}

// ---------------------------------------------------------------------------
// Planets

/** A planet this high above the horizon clears trees and haze. */
export const CLEAR = 5;
/** Closer to the Sun than this, a planet is lost in its glare. */
export const GLARE = 10;
/** A planet's rise and set altitude: refraction lifts it by about 34'. */
const PLANET_HORIZON = -0.5667;

/**
 * "all-night": up most of the dark hours; "evening": after dusk; "morning": before dawn; "night": another stretch
 * (from mid-evening to dawn…); "glare": too near the Sun; "daytime": up only while the sky is light; "below": not
 * up at all; "no-night": the sky never gets dark (white nights).
 */
export type Verdict = "all-night" | "evening" | "morning" | "night" | "glare" | "daytime" | "below" | "no-night";

export interface PlanetNight {
  id: PlanetId;
  magnitude: number;
  /** Degrees from the Sun, and whether in the evening (east) side. */
  elongation: number;
  east: boolean;
  /** Lit part of the disk, 0 to 1. */
  illuminated: number;
  /** Distance from the Earth, AU. */
  distance: number;
  rise?: number;
  transit?: number;
  set?: number;
  /** Altitude at transit, degrees (refraction included). */
  transitAltitude?: number;
  /** When it is at least CLEAR degrees up while the sky is dark. */
  visible: [number, number][];
  /** The highest point while visible, with where to look. */
  best?: { at: number; altitude: number; azimuth: number };
  verdict: Verdict;
}

const apparent = (altitude: number) => altitude + refraction(altitude);

/** When the body is due south (or north): its hour angle is zero, found by Newton steps from `guess`. */
function transitOf(ra: (t: number) => number, guess: number, lon: number): number {
  let t = guess;
  for (let i = 0; i < 4; i++) {
    const h = wrap180(siderealTime(t) + lon - ra(t));
    t -= (h / 360.9856) * DAY;
  }
  return Math.round(t);
}

export function planetNight(id: PlanetId, n: Night, place: Place): PlanetNight {
  const { latitude: lat, longitude: lon } = place;
  const mid = n.from !== undefined && n.to !== undefined ? (n.from + n.to) / 2 : (n.noon + n.nextNoon) / 2;
  const p = planetPosition(id, mid);
  const altitude = (t: number) => horizontal(t, lat, lon, planetPosition(id, t)).altitude;

  // Up over the horizon: the stretch that overlaps the night most, looked for half a day either side.
  const span: [number, number] = [n.noon - 12 * HOUR, n.nextNoon + 12 * HOUR];
  const c = crossings((t) => altitude(t) - PLANET_HORIZON, span[0], span[1], 20 * MINUTE);
  const ups = intervals(c, span[0], span[1]);
  const [nightFrom, nightTo] = n.from !== undefined && n.to !== undefined ? [n.from, n.to] : [n.noon, n.nextNoon];
  const overlap = ([a, b]: [number, number]) => Math.min(b, nightTo) - Math.max(a, nightFrom);
  const up = ups.length ? ups.reduce((a, b) => (overlap(b) > overlap(a) ? b : a)) : undefined;
  const rise = up && up[0] > span[0] ? up[0] : undefined;
  const set = up && up[1] < span[1] ? up[1] : undefined;
  // The transit while it is up, else the one nearest the middle of the night.
  let transit: number | undefined = transitOf((t) => planetPosition(id, t).ra, up ? (up[0] + up[1]) / 2 : mid, lon);
  if (up ? transit < up[0] || transit > up[1] : transit < n.noon || transit > n.nextNoon) transit = undefined;
  const transitAltitude = transit !== undefined ? apparent(altitude(transit)) : undefined;

  let visible: [number, number][] = [];
  if (n.from !== undefined && n.to !== undefined) {
    const v = crossings((t) => apparent(altitude(t)) - CLEAR, n.from, n.to, 10 * MINUTE);
    visible = intervals(v, n.from, n.to);
  }
  let best: PlanetNight["best"];
  for (const [from, to] of visible) {
    const candidates = [from, to, ...(transit !== undefined && transit > from && transit < to ? [transit] : [])];
    for (const t of candidates) {
      const h = horizontal(t, lat, lon, planetPosition(id, t));
      const a = apparent(h.altitude);
      if (!best || a > best.altitude) best = { at: t, altitude: a, azimuth: h.azimuth };
    }
  }

  let verdict: Verdict;
  if (p.elongation < GLARE) verdict = "glare";
  else if (n.state === "never") verdict = "no-night";
  else if (!visible.length) {
    const upInDaylight = ups.some(([a, b]) => b > n.noon && a < n.nextNoon);
    verdict = upInDaylight ? "daytime" : "below";
  } else {
    const slack = 20 * MINUTE;
    const length = n.to! - n.from!;
    const seen = visible.reduce((sum, [a, b]) => sum + b - a, 0);
    const atDusk = visible.some(([from]) => from - n.from! <= slack);
    const atDawn = visible.some(([, to]) => n.to! - to <= slack);
    const middle = n.from! + length / 2;
    verdict = seen >= 0.8 * length
      ? "all-night"
      : atDusk && visible[0][1] <= middle + 2 * HOUR
      ? "evening"
      : atDawn && visible[visible.length - 1][0] >= middle - 2 * HOUR
      ? "morning"
      : "night";
  }

  return {
    id,
    magnitude: p.magnitude,
    elongation: p.elongation,
    east: p.east,
    illuminated: p.illuminated,
    distance: p.delta,
    rise,
    transit,
    set,
    transitAltitude,
    visible,
    best,
    verdict,
  };
}

export interface MoonNight {
  /** Lit part at the middle of the night, 0 to 1, and its phase angle (0 new, 180 full). */
  fraction: number;
  angle: number;
  waxing: boolean;
  rise?: number;
  set?: number;
  /** When it is up while the sky is dark. */
  up: [number, number][];
}

export function moonNight(n: Night, place: Place): MoonNight {
  const { latitude: lat, longitude: lon } = place;
  const mid = n.from !== undefined && n.to !== undefined ? (n.from + n.to) / 2 : (n.noon + n.nextNoon) / 2;
  const ill = illumination(mid);
  const f = (t: number) => moonHorizontal(t, lat, lon).altitude - moonHorizon(moonPosition(t).distance);
  const span: [number, number] = [n.noon - 12 * HOUR, n.nextNoon + 12 * HOUR];
  const ups = intervals(crossings(f, span[0], span[1]), span[0], span[1]);
  const [nightFrom, nightTo] = n.from !== undefined && n.to !== undefined ? [n.from, n.to] : [n.noon, n.nextNoon];
  const overlap = ([a, b]: [number, number]) => Math.min(b, nightTo) - Math.max(a, nightFrom);
  const best = ups.length ? ups.reduce((a, b) => (overlap(b) > overlap(a) ? b : a)) : undefined;
  const rise = best && best[0] > span[0] ? best[0] : undefined;
  const set = best && best[1] < span[1] ? best[1] : undefined;
  let up: [number, number][] = [];
  if (n.from !== undefined && n.to !== undefined) up = intervals(crossings(f, n.from, n.to), n.from, n.to);
  return { fraction: ill.fraction, angle: ill.angle, waxing: ill.waxing, rise, set, up };
}

// ---------------------------------------------------------------------------
// Meteor showers

/** The Sun's longitude for the equinox of date, from a J2000 one: the equinox drifts 1.397° a century. */
const ofDate = (j2000: number, ms: number) => j2000 + 1.3972 * ((ms / DAY + 2440587.5 - 2451545) / 36525);

/** When the Sun next reaches the shower's peak longitude after `from`. */
export function showerPeak(shower: Shower, from: number): number {
  const rate = 360 / 365.2422;
  let t = from;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 6; i++) {
      const diff = ((ofDate(shower.peakLongitude, t) - sunPosition(t).lambda) % 360 + 540) % 360 - 180;
      t += (diff / rate) * DAY;
    }
    if (t >= from) break;
    t += 365.2422 * DAY;
  }
  return Math.round(t);
}

/** Whether `day` ("2026-08-12") is within the shower's activity, which may run over the new year. */
export function isActive(shower: Shower, day: Day): boolean {
  const md = day.slice(5);
  return shower.start <= shower.end ? md >= shower.start && md <= shower.end : md >= shower.start || md <= shower.end;
}

export type Outlook = "excellent" | "good" | "fair" | "poor" | "radiant-down" | "no-night";

export interface ShowerNight {
  peak: number;
  night: Night;
  /** Highest the radiant gets while dark, degrees. */
  radiantAltitude: number;
  /** The best hour: when radiant height and moonlight leave the most meteors. */
  best?: { at: number; rate: number; radiantAltitude: number };
  /** The Moon at the peak: lit fraction, and the part of the dark hours it is up. */
  moonFraction: number;
  moonUp: number;
  outlook: Outlook;
}

/** How many meteors an hour, about: fewer with the radiant low and with the Moon up. */
export function expectedRate(zhr: number, radiantAltitude: number, moonUp: boolean, moonFraction: number): number {
  if (radiantAltitude <= 0) return 0;
  const moon = moonUp ? 1 - 0.7 * moonFraction : 1;
  return zhr * Math.sin((radiantAltitude * Math.PI) / 180) * moon;
}

export function outlookOf(rate: number): Outlook {
  return rate >= 30 ? "excellent" : rate >= 10 ? "good" : rate >= 3 ? "fair" : "poor";
}

/** The peak night: the dark hours nearest the peak, sampled every 10 minutes. */
export function showerNight(shower: Shower, peak: number, place: Place): ShowerNight {
  const zone = zoneOf(place);
  const today = dayOf(peak, zone);
  const nights = [night(addDays(today, -1), place, DARK), night(today, place, DARK)];
  const middle = (n: Night) => n.from !== undefined && n.to !== undefined ? (n.from + n.to) / 2 : n.noon + 12 * HOUR;
  const n = nights.reduce((a, b) => (Math.abs(middle(b) - peak) < Math.abs(middle(a) - peak) ? b : a));
  const moonFraction = illumination(peak).fraction;
  if (n.from === undefined || n.to === undefined) {
    return { peak, night: n, radiantAltitude: 0, moonFraction, moonUp: 0, outlook: "no-night" };
  }
  const radiant = { ra: shower.ra, dec: shower.dec, lambda: 0, beta: 0, distance: 0 };
  let radiantAltitude = -90;
  let best: ShowerNight["best"];
  let moonSamples = 0;
  let samples = 0;
  for (let t = n.from; t <= n.to; t += 10 * MINUTE) {
    const alt = horizontal(t, place.latitude, place.longitude, radiant).altitude;
    const moonUp = moonHorizontal(t, place.latitude, place.longitude).altitude > 0;
    samples++;
    if (moonUp) moonSamples++;
    radiantAltitude = Math.max(radiantAltitude, alt);
    const rate = expectedRate(shower.zhr, alt, moonUp, moonFraction);
    if (rate > 0 && (!best || rate > best.rate)) best = { at: t, rate, radiantAltitude: alt };
  }
  const outlook = radiantAltitude <= 0 ? "radiant-down" : outlookOf(best?.rate ?? 0);
  return { peak, night: n, radiantAltitude, best, moonFraction, moonUp: samples ? moonSamples / samples : 0, outlook };
}

// ---------------------------------------------------------------------------
// Eclipses

/** "3 h 27 min" → 207. */
export function minutesOf(text: string | undefined): number {
  if (!text) return 0;
  const h = /(\d+)\s*h/.exec(text);
  const m = /(\d+)\s*min/.exec(text);
  return (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
}

export interface LunarView {
  /** Whether the Moon is up at greatest eclipse, and at each contact of the umbra. */
  atGreatest: boolean;
  phases: { label: string; at: number; up: boolean }[];
  visibility: "visible" | "partly" | "not-visible";
}

export function lunarView(e: Eclipse, place: Place): LunarView {
  const greatest = Date.parse(e.greatest);
  const up = (t: number) =>
    moonHorizontal(t, place.latitude, place.longitude).altitude > moonHorizon(moonPosition(t).distance);
  const partial = minutesOf(e.durations[0]) * MINUTE;
  const total = minutesOf(e.durations[1]) * MINUTE;
  const phases: LunarView["phases"] = [];
  if (partial) phases.push({ label: "Partial eclipse begins", at: greatest - partial / 2, up: false });
  if (total) phases.push({ label: "Totality begins", at: greatest - total / 2, up: false });
  phases.push({ label: "Greatest eclipse", at: greatest, up: false });
  if (total) phases.push({ label: "Totality ends", at: greatest + total / 2, up: false });
  if (partial) phases.push({ label: "Partial eclipse ends", at: greatest + partial / 2, up: false });
  for (const p of phases) p.up = up(p.at);
  const atGreatest = up(greatest);
  const visibility = atGreatest ? "visible" : phases.some((p) => p.up) ? "partly" : "not-visible";
  return { atGreatest, phases, visibility };
}

export interface SolarView {
  /** The most the Moon covers while the Sun is up, and when. */
  magnitude: number;
  obscuration: number;
  central?: "total" | "annular";
  at?: number;
  sunAltitude?: number;
  /** First and last contact seen from the place, while the Sun is up. */
  begins?: number;
  ends?: number;
}

const SUN_UP = -0.833;

/** The eclipse from a place: scanned minute by minute for 3.5 hours each side of greatest eclipse. */
export function solarView(e: Eclipse, place: Place): SolarView {
  const greatest = Date.parse(e.greatest);
  const { latitude: lat, longitude: lon } = place;
  const view: SolarView = { magnitude: 0, obscuration: 0 };
  let peakAt: number | undefined;
  for (let t = greatest - 3.5 * HOUR; t <= greatest + 3.5 * HOUR; t += MINUTE) {
    const o = solarOverlap(t, lat, lon);
    if (o.magnitude <= 0 || o.sunAltitude < SUN_UP) continue;
    view.begins ??= t;
    view.ends = t;
    if (o.magnitude > view.magnitude) {
      view.magnitude = o.magnitude;
      peakAt = t;
    }
  }
  if (peakAt === undefined) return view;
  // Refine the maximum to 5 seconds.
  for (let t = peakAt - MINUTE; t <= peakAt + MINUTE; t += 5000) {
    const o = solarOverlap(t, lat, lon);
    if (o.sunAltitude < SUN_UP || o.magnitude < view.magnitude) continue;
    Object.assign(view, {
      magnitude: o.magnitude,
      obscuration: o.obscuration,
      central: o.central,
      at: t,
      sunAltitude: o.sunAltitude,
    });
  }
  if (view.at === undefined) {
    const o = solarOverlap(peakAt, lat, lon);
    Object.assign(view, { obscuration: o.obscuration, central: o.central, at: peakAt, sunAltitude: o.sunAltitude });
  }
  return view;
}
