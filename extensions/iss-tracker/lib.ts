// ISS Tracker: where the station is (over which place or ocean, how high,
// how fast) and its passes over your place, as launcher items. Pure, tested
// in lib_test.ts; the orbit is in sgp4.ts and geo.ts, the network in api.ts.

import { type Action, type Color, copy, Icons, type Item, meta, type Metadata, open } from "@backslash/api";
import { CITIES, WATERS } from "./cities.ts";
import { type Fix, fixAt, LOW, type Pass, type SkyPoint, skyPoint } from "./geo.ts";
import {
  type Clock,
  compass,
  dayLabel,
  dayOf,
  formatDuration,
  formatMoment,
  formatTime,
  type Place,
  placeLabel,
  relative,
  zoneOf,
} from "./places.ts";
import type { Satrec, Tle } from "./sgp4.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const EARTH_RADIUS = 6371;
const DEG = Math.PI / 180;

export interface Settings {
  zone: string;
  clock: Clock;
  now: number;
}

export const settingsFor = (zone: string, clock: Clock, now: number): Settings => ({ zone, clock, now });
export const zoneFor = (place: Place | undefined, fallback: string) => (place ? zoneOf(place) : fallback);

// ---------------------------------------------------------------------------
// Where it is

/** Great-circle distance, km. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLon = (lon2 - lon1) * DEG;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from the first point to the second, degrees from north. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const y = Math.sin((lon2 - lon1) * DEG) * Math.cos(lat2 * DEG);
  const x = Math.cos(lat1 * DEG) * Math.sin(lat2 * DEG) -
    Math.sin(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.cos((lon2 - lon1) * DEG);
  return ((Math.atan2(y, x) / DEG) + 360) % 360;
}

const POINTS8 = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const compass8 = (deg: number) => POINTS8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];

/** "1,450 km" */
export const km = (n: number) => `${Math.round(n).toLocaleString("en-US")} km`;

export interface Whereabouts {
  /** "Over the Pacific Ocean", "Near Almaty, Kazakhstan"… */
  title: string;
  /** "1,450 km SW of Lima, Peru" */
  detail: string;
  city: string;
  country: string;
  distance: number;
}

/** Far from every city in the list, a point is most likely at sea. */
const AT_SEA = 700;

export function waterAt(lat: number, lon: number): string | undefined {
  return WATERS.find(([, s, n, w, e]) => lat >= s && lat <= n && lon >= w && lon <= e)?.[0];
}

export function whereabouts(lat: number, lon: number): Whereabouts {
  let best = CITIES[0];
  let bestDistance = Infinity;
  for (const c of CITIES) {
    const d = distanceKm(lat, lon, c[2], c[3]);
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  const [city, country] = best;
  const direction = compass8(bearing(best[2], best[3], lat, lon));
  const detail = bestDistance < 50
    ? `Above ${city}, ${country}`
    : `${km(bestDistance)} ${direction} of ${city}, ${country}`;
  const water = bestDistance >= AT_SEA ? waterAt(lat, lon) : undefined;
  const title = water
    ? `Over ${water}`
    : bestDistance < 50
    ? `Above ${city}, ${country}`
    : bestDistance < 300
    ? `Near ${city}, ${country}`
    : `${km(bestDistance)} from ${city}, ${country}`;
  return { title, detail, city, country, distance: bestDistance };
}

/** "51.38° N, 131.11° E" */
export function coordinates(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? "N" : "S"}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? "E" : "W"}`;
}

export function mapUrl(lat: number, lon: number, zoom = 4): string {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(3)}&mlon=${lon.toFixed(3)}#map=${zoom}/${lat.toFixed(3)}/${
    lon.toFixed(3)
  }`;
}

/** Days since the elements were measured: SGP4 drifts by a few km a day after that. */
export const elementAge = (tle: Tle, now: number) => (now - tle.epoch) / DAY;

export const periodMinutes = (tle: Tle) => 1440 / tle.meanMotion;

export function ageText(days: number): string {
  const hours = Math.round(days * 24);
  return hours < 48 ? `${hours} h old` : `${Math.round(days)} days old`;
}

// ---------------------------------------------------------------------------
// Items: now

export interface NowInput {
  sat: Satrec;
  now: number;
  settings: Settings;
  place?: Place;
  /** The next passes over the place, computed once. */
  passes?: Pass[];
  /** Why the elements are an old copy, if they are. */
  stale?: string;
}

function positionItem(fix: Fix, w: Whereabouts, input: NowInput, actions: Action[]): Item {
  const age = elementAge(input.sat.tle, input.now);
  const where = coordinates(fix.latitude, fix.longitude);
  return {
    id: "position",
    title: w.title,
    subtitle: `${where} · ${Math.round(fix.altitude)} km up · ${Math.round(fix.speed).toLocaleString("en-US")} km/h`,
    icon: { source: Icons.rocket, tint: fix.sunlit ? "yellow" : "blue" },
    section: "The ISS now",
    accessories: [{ tag: fix.sunlit ? "In sunlight" : "In the Earth's shadow", color: fix.sunlit ? "yellow" : "blue" }],
    detail: {
      markdown: `## ${w.title}\n\n${w.detail}.`,
      metadata: [
        meta.text("Latitude", `${fix.latitude.toFixed(4)}°`, { icon: Icons.pin }),
        meta.text("Longitude", `${fix.longitude.toFixed(4)}°`, { icon: Icons.pin }),
        meta.text("Altitude", km(fix.altitude), { icon: Icons.arrowUp }),
        meta.text(
          "Speed",
          `${Math.round(fix.speed).toLocaleString("en-US")} km/h · ${(fix.speed / 3600).toFixed(2)} km/s`,
        ),
        meta.text("Sunlight", fix.sunlit ? "In sunlight" : "In the Earth's shadow", {
          icon: fix.sunlit ? Icons.sun : Icons.moon,
        }),
        meta.text("Seen from within", km(fix.footprint)),
        meta.separator(),
        meta.text(
          "Orbit",
          `${periodMinutes(input.sat.tle).toFixed(1)} min, ${input.sat.tle.inclination.toFixed(1)}° inclined`,
        ),
        meta.text("Elements", `${ageText(age)}${input.stale ? " (couldn't update)" : ""}`, {
          color: age > 3 ? "orange" : undefined,
        }),
      ],
    },
    actions: [
      open(mapUrl(fix.latitude, fix.longitude), "Open Map", { icon: Icons.globe }),
      copy(`${fix.latitude.toFixed(4)}, ${fix.longitude.toFixed(4)}`, "Copy Coordinates", { icon: Icons.pin }),
      copy(
        `The ISS is ${w.title.charAt(0).toLowerCase()}${w.title.slice(1)} (${w.detail}), ${
          Math.round(fix.altitude)
        } km up.`,
        "Copy Summary",
        {
          icon: Icons.text,
        },
      ),
      ...actions,
    ],
  };
}

/** Where the station is in the place's sky now. */
export function skyText(p: SkyPoint): string {
  if (p.elevation < 0) return "Below your horizon";
  return `${Math.round(p.elevation)}° up in the ${compass(p.azimuth)}`;
}

export function nowItems(input: NowInput, actions: Action[] = []): Item[] {
  const { sat, now, settings: s, place } = input;
  const fix = fixAt(sat, now);
  const w = whereabouts(fix.latitude, fix.longitude);
  const items: Item[] = [positionItem(fix, w, input, actions)];

  if (input.stale) {
    items.push({
      id: "stale",
      title: "Showing the last orbit we have",
      subtitle: `CelesTrak couldn't be reached: ${input.stale}`,
      icon: { source: Icons.alert, tint: "orange" },
      section: "The ISS now",
      actions,
    });
  }

  if (place) {
    const sky = skyPoint(sat, now, place.latitude, place.longitude);
    const next = input.passes?.find((p) => p.visible && p.visible.to.at > now);
    items.push({
      id: "sky",
      title: skyText(sky),
      subtitle: sky.elevation >= 0
        ? sky.sunlit && sky.sunElevation < -6 ? "Look now: it is lit by the Sun" : "Not visible: daylight or in shadow"
        : `${km(distanceKm(place.latitude, place.longitude, fix.latitude, fix.longitude))} away`,
      icon: { source: sky.elevation >= 0 ? Icons.eye : Icons.eyeOff, tint: sky.elevation >= 0 ? "green" : "gray" },
      section: `From ${place.name}`,
      actions,
    });
    if (next) items.push(passItem(next, s, place, "Next visible pass"));
    else if (input.passes) {
      items.push({
        id: "no-pass",
        title: "No visible pass in the next days",
        subtitle: "The station passes over at night in the Earth's shadow, or in daylight",
        icon: { source: Icons.info, tint: "gray" },
        section: `From ${place.name}`,
        actions,
      });
    }
  }

  // The ground track for the next orbit.
  for (let m = 15; m <= 90; m += 15) {
    const f = fixAt(sat, now + m * MINUTE);
    const wf = whereabouts(f.latitude, f.longitude);
    items.push({
      id: `track:${m}`,
      title: wf.title,
      subtitle: `In ${m} min, ${formatTime(now + m * MINUTE, s.zone, s.clock)} · ${
        coordinates(f.latitude, f.longitude)
      }`,
      icon: { source: Icons.arrowRight, tint: f.sunlit ? "yellow" : "gray" },
      section: "Next orbit",
      accessories: [{ text: f.sunlit ? "Sunlight" : "Shadow" }],
      detail: { markdown: `## In ${m} minutes\n\n${wf.title}: ${wf.detail}.` },
      actions: [open(mapUrl(f.latitude, f.longitude), "Open Map", { icon: Icons.globe }), ...actions],
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Items: passes

const brightness = (m: number): { text: string; color: Color } =>
  m <= -3
    ? { text: "Very bright", color: "green" }
    : m <= -1.5
    ? { text: "Bright", color: "teal" }
    : { text: "Faint", color: "gray" };

const HIDDEN: Record<NonNullable<Pass["hidden"]>, string> = {
  low: `Too low: under ${LOW}° all the way`,
  daylight: "In a daylight sky",
  shadow: "In the Earth's shadow",
};

const signed = (n: number) => (n < 0 ? `−${Math.abs(n).toFixed(1)}` : n.toFixed(1));
const where = (p: SkyPoint) => `${Math.round(p.elevation)}° ${compass(p.azimuth)}`;

export function passSentence(p: Pass, s: Settings): string {
  const t = (ms: number) => formatTime(ms, s.zone, s.clock);
  if (!p.visible) {
    return `Passes over ${t(p.rise.at)}–${t(p.set.at)}, up to ${
      Math.round(p.culmination.elevation)
    }°, but can't be seen: ${HIDDEN[p.hidden!].toLowerCase()}.`;
  }
  const v = p.visible;
  // Starting or ending high in the sky means crossing the edge of the Earth's shadow; low down, it rises or sets.
  const emerges = v.from.at > p.rise.at + 60_000 && v.from.elevation > LOW + 2;
  const fades = v.to.at < p.set.at - 60_000 && v.to.elevation > LOW + 2;
  const appears = `Appears at ${t(v.from.at)}${emerges ? `, ${Math.round(v.from.elevation)}° up` : ""} in the ${
    compass(v.from.azimuth)
  }${emerges ? " as it comes out of the Earth's shadow" : ""}`;
  const ends = `${fades ? "fades into the Earth's shadow" : "disappears"} at ${t(v.to.at)} in the ${
    compass(v.to.azimuth)
  }`;
  if (v.highest.at - v.from.at < 30_000) return `${appears}, then sinks and ${ends}.`;
  return `${appears}, climbs to ${Math.round(v.highest.elevation)}° in the ${compass(v.highest.azimuth)} at ${
    t(v.highest.at)
  }, and ${ends}.`;
}

export function passItem(p: Pass, s: Settings, place: Place, section?: string): Item {
  const today = dayOf(s.now, s.zone);
  const t = (ms: number) => formatTime(ms, s.zone, s.clock);
  const moment = (ms: number) => formatMoment(ms, s.zone, s.clock, today);
  const v = p.visible;
  const start = v ? v.from.at : p.rise.at;
  const tag = v ? brightness(v.magnitude) : { text: "Not visible", color: "gray" as Color };
  const sentence = passSentence(p, s);
  const lines: Metadata[] = v
    ? [
      meta.tags("Brightness", [{ text: `${tag.text}, mag ${signed(v.magnitude)}`, color: tag.color }]),
      meta.text("Appears", `${t(v.from.at)}, ${where(v.from)}`, { icon: Icons.eye }),
      meta.text("Highest", `${t(v.highest.at)}, ${where(v.highest)}`, { icon: Icons.arrowUp }),
      meta.text("Disappears", `${t(v.to.at)}, ${where(v.to)}`, { icon: Icons.eyeOff }),
      meta.text("Visible for", formatDuration(v.to.at - v.from.at)),
      meta.separator(),
    ]
    : [meta.tags("Visibility", [{ text: HIDDEN[p.hidden!], color: "gray" }])];
  lines.push(
    meta.text("Rises", `${t(p.rise.at)}, ${compass(p.rise.azimuth)}`),
    meta.text("Highest point", `${t(p.culmination.at)}, ${where(p.culmination)}`),
    meta.text("Sets", `${t(p.set.at)}, ${compass(p.set.azimuth)}`),
    meta.text("Closest", km(p.culmination.range)),
  );
  return {
    id: `pass:${p.rise.at}`,
    title: v ? `${moment(start)} · ${formatDuration(v.to.at - v.from.at)}` : moment(start),
    subtitle: v
      ? `Up to ${Math.round(v.highest.elevation)}° · ${compass(v.from.azimuth)} → ${compass(v.to.azimuth)}`
      : HIDDEN[p.hidden!],
    icon: { source: v ? Icons.starFilled : Icons.star, tint: v ? tag.color : "gray" },
    section: section ?? dayLabel(dayOf(start, s.zone), today),
    accessories: [
      ...(v ? [{ text: `mag ${signed(v.magnitude)}` }] : [{ text: `max ${Math.round(p.culmination.elevation)}°` }]),
      { tag: tag.text, color: tag.color },
    ],
    detail: { markdown: `## ${moment(start)}\n\n${sentence}\n\nSeen from ${placeLabel(place)}.`, metadata: lines },
    actions: [
      copy(`ISS ${moment(start)}: ${sentence}`, "Copy Pass", { icon: Icons.text }),
      open(
        `https://www.heavens-above.com/PassSummary.aspx?satid=25544&lat=${place.latitude.toFixed(4)}&lng=${
          place.longitude.toFixed(4)
        }`,
        "Open in Heavens-Above",
        { icon: Icons.globe },
      ),
    ],
  };
}

/** The passes as items; with `onlyVisible`, the ones that can be seen. */
export function passItems(passes: Pass[], s: Settings, place: Place, onlyVisible: boolean): Item[] {
  return passes.filter((p) => !onlyVisible || p.visible).filter((p) => (p.visible?.to.at ?? p.set.at) > s.now).map((
    p,
  ) => passItem(p, s, place));
}

/** "Next visible: tomorrow 05:45", for the footer. */
export function nextVisibleText(passes: Pass[], s: Settings): string {
  const next = passes.find((p) => p.visible && p.visible.to.at > s.now);
  if (!next) return "No visible pass in the next days";
  return `Next visible ${relative(next.visible!.from.at, s.now)}`;
}
