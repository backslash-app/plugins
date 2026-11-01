// Night Sky: the launcher items for the planets tonight, the meteor showers
// and the eclipses, from the computations in sky.ts. Pure, tested in
// lib_test.ts; the network (finding a city) is in api.ts.

import { type Action, type Color, copy, Icons, type Item, meta, type Metadata, open } from "@backslash/api";
import { horizontal, refraction } from "./astro.ts";
import { type Eclipse, ECLIPSES, PLANETS, type Shower, SHOWERS } from "./data.ts";
import { AU, PLANET_IDS, type PlanetId, planetPosition } from "./planets.ts";
import {
  type Clock,
  compass,
  dayLabel,
  dayOf,
  formatDay,
  formatDuration,
  formatMoment,
  formatTime,
  type Place,
  placeLabel,
  relative,
  zoneOf,
} from "./places.ts";
import {
  isActive,
  type LunarView,
  lunarView,
  type MoonNight,
  moonNight,
  type Night,
  night,
  type Outlook,
  type PlanetNight,
  planetNight,
  type ShowerNight,
  showerNight,
  showerPeak,
  type SolarView,
  solarView,
  type Verdict,
} from "./sky.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const direction = (azimuth: number) => `${Math.round(azimuth)}° ${compass(azimuth)}`;
const percent = (fraction: number) => `${Math.round(fraction * 100)} %`;
const signed = (n: number) => (n < 0 ? `−${Math.abs(n).toFixed(1)}` : n.toFixed(1));

export interface Settings {
  zone: string;
  clock: Clock;
  now: number;
}

export const settingsFor = (place: Place, clock: Clock, now: number): Settings => ({ zone: zoneOf(place), clock, now });

// ---------------------------------------------------------------------------
// Planets tonight

export interface Tonight {
  place: Place;
  night: Night;
  moon: MoonNight;
  planets: PlanetNight[];
}

export function tonight(place: Place, day: string): Tonight {
  const n = night(day, place);
  return { place, night: n, moon: moonNight(n, place), planets: PLANET_IDS.map((id) => planetNight(id, n, place)) };
}

const VISIBLE: Verdict[] = ["all-night", "evening", "morning", "night"];
export const isVisible = (p: PlanetNight) => VISIBLE.includes(p.verdict);

/** The verdict as a short tag: "Evening", "All night", "From 23:10"… */
export function verdictTag(p: PlanetNight, n: Night, s: Settings): { text: string; color: Color } {
  const t = (ms: number) => formatTime(ms, s.zone, s.clock);
  switch (p.verdict) {
    case "all-night":
      return { text: "All night", color: "green" };
    case "evening":
      return { text: "Evening", color: "green" };
    case "morning":
      return { text: "Before dawn", color: "green" };
    case "night": {
      const [from] = p.visible[0];
      const [, to] = p.visible[p.visible.length - 1];
      const fromDusk = from - (n.from ?? from) < 20 * MINUTE;
      const toDawn = (n.to ?? to) - to < 20 * MINUTE;
      return { text: fromDusk ? `Until ${t(to)}` : toDawn ? `From ${t(from)}` : `${t(from)}–${t(to)}`, color: "green" };
    }
    case "glare":
      return { text: "Too near the Sun", color: "gray" };
    case "daytime":
      return { text: "Daytime only", color: "gray" };
    case "below":
      return { text: "Below the horizon", color: "gray" };
    case "no-night":
      return { text: "No dark sky", color: "gray" };
  }
}

/** "Naked eye", "Binoculars", "Telescope". */
export function instrument(magnitude: number): string {
  return magnitude <= 5.5 ? "Naked eye" : magnitude <= 8.5 ? "Binoculars" : "Telescope";
}

/** One sentence: where and when to look. */
export function planetSentence(p: PlanetNight, s: Settings): string {
  const name = PLANETS[p.id].name;
  const t = (ms: number) => formatTime(ms, s.zone, s.clock);
  switch (p.verdict) {
    case "glare":
      return `${name} is ${Math.round(p.elongation)}° from the Sun, lost in its glare.`;
    case "daytime":
      return `${name} is only up while the sky is light${
        p.rise !== undefined && p.set !== undefined ? ` (${t(p.rise)}–${t(p.set)})` : ""
      }.`;
    case "below":
      return `${name} stays below your horizon.`;
    case "no-night":
      return `The sky doesn't get dark enough tonight for ${name} to show.`;
    default: {
      const spans = p.visible.map(([a, b]) => `${t(a)}–${t(b)}`).join(", ");
      const best = p.best
        ? ` Best at ${t(p.best.at)}, ${Math.round(p.best.altitude)}° up in the ${compass(p.best.azimuth)}.`
        : "";
      return `${name} can be seen ${spans}.${best} ${capitalize(PLANETS[p.id].hint)}.`;
    }
  }
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function stellariumUrl(name: string): string {
  return `https://stellarium-web.org/skysource/${encodeURIComponent(name)}`;
}

function nowLine(id: PlanetId, place: Place, now: number): Metadata | undefined {
  const h = horizontal(now, place.latitude, place.longitude, planetPosition(id, now));
  const alt = h.altitude + refraction(h.altitude);
  if (alt < -0.5) return meta.text("Now", "Below the horizon", { icon: Icons.eyeOff });
  return meta.text("Now", `${Math.round(alt)}° up, ${direction(h.azimuth)}`, { icon: Icons.eye });
}

export function planetItem(p: PlanetNight, t: Tonight, s: Settings, extra: Action[] = []): Item {
  const info = PLANETS[p.id];
  const tag = verdictTag(p, t.night, s);
  const time = (ms: number | undefined) => (ms === undefined ? "—" : formatMoment(ms, s.zone, s.clock, t.night.day));
  const visible = isVisible(p);
  const isTonight = s.now >= t.night.noon && s.now < t.night.nextNoon;
  const lines: Metadata[] = [
    meta.tags("Tonight", [tag]),
    ...(p.best
      ? [meta.text("Best", `${time(p.best.at)}, ${Math.round(p.best.altitude)}° up, ${direction(p.best.azimuth)}`, {
        icon: Icons.starFilled,
      })]
      : []),
    ...(isTonight ? [nowLine(p.id, t.place, s.now)].filter((m): m is Metadata => !!m) : []),
    meta.separator(),
    meta.text("Rises", time(p.rise), { icon: Icons.arrowUp }),
    meta.text(
      "Highest",
      p.transit === undefined ? "—" : `${time(p.transit)}, ${Math.round(p.transitAltitude ?? 0)}° up`,
      { icon: Icons.sun },
    ),
    meta.text("Sets", time(p.set), { icon: Icons.arrowDown }),
    meta.separator(),
    meta.text("Magnitude", `${signed(p.magnitude)} · ${instrument(p.magnitude)}`),
    meta.text("From the Sun", `${Math.round(p.elongation)}° ${p.east ? "east (evening side)" : "west (morning side)"}`),
    ...(["mercury", "venus", "mars"].includes(p.id) ? [meta.progress("Lit", p.illuminated)] : []),
    meta.text("Distance", `${p.distance.toFixed(2)} AU · ${Math.round((p.distance * AU) / 1e6)} million km`),
  ];
  const sentence = planetSentence(p, s);
  return {
    id: `planet:${p.id}`,
    title: info.name,
    subtitle: visible && p.best
      ? `Best ${formatTime(p.best.at, s.zone, s.clock)}, ${Math.round(p.best.altitude)}° ${compass(p.best.azimuth)}`
      : sentence.replace(/\.$/, ""),
    icon: { source: visible ? Icons.starFilled : Icons.star, tint: visible ? info.color : "gray" },
    section: visible ? "Planets you can see" : "Not tonight",
    keywords: [info.french, p.id],
    accessories: [{ text: `mag ${signed(p.magnitude)}` }, { tag: tag.text, color: tag.color }],
    detail: { markdown: `## ${info.name}\n\n${sentence}`, metadata: lines },
    actions: [
      open(stellariumUrl(info.name), "Show in Stellarium Web", { icon: Icons.globe }),
      copy(sentence, "Copy Summary", { icon: Icons.text }),
      ...extra,
    ],
  };
}

/** "Waxing gibbous" and the like. */
export function moonPhaseName(angle: number): string {
  const a = ((angle % 360) + 360) % 360;
  if (a < 6 || a >= 354) return "New Moon";
  if (a < 84) return "Waxing crescent";
  if (a < 96) return "First quarter";
  if (a < 174) return "Waxing gibbous";
  if (a < 186) return "Full Moon";
  if (a < 264) return "Waning gibbous";
  if (a < 276) return "Last quarter";
  return "Waning crescent";
}

/** How much the Moon gets in the way: its light washes out faint stars and meteors. */
export function moonNuisance(m: MoonNight, n: Night): string {
  if (n.from === undefined || n.to === undefined) return "";
  const upFor = m.up.reduce((sum, [a, b]) => sum + b - a, 0);
  if (upFor === 0 || m.fraction < 0.1) return "Dark, moonless sky";
  const part = upFor / (n.to - n.from);
  if (m.fraction > 0.6 && part > 0.6) return "Bright Moon most of the night";
  return part > 0.6 ? "Moon up most of the night" : "Moon up part of the night";
}

export function nightItems(t: Tonight, s: Settings, extra: Action[] = []): Item[] {
  const n = t.night;
  const time = (ms: number | undefined) => (ms === undefined ? "—" : formatMoment(ms, s.zone, s.clock, n.day));
  const today = dayOf(s.now, s.zone);
  const section = `${dayLabel(n.day, today)} · ${t.place.name}`;
  const darkTitle = n.state === "never"
    ? "The sky doesn't get dark tonight"
    : n.state === "dark"
    ? "Dark all day and night"
    : `Dark from ${formatTime(n.from!, s.zone, s.clock)} to ${formatTime(n.to!, s.zone, s.clock)}`;
  const nuisance = moonNuisance(t.moon, n);
  const phase = moonPhaseName(t.moon.angle);
  const moonUp = t.moon.up.map(([a, b]) => `${formatTime(a, s.zone, s.clock)}–${formatTime(b, s.zone, s.clock)}`).join(
    ", ",
  );
  const visible = t.planets.filter(isVisible).sort((a, b) => a.magnitude - b.magnitude);
  const hidden = t.planets.filter((p) => !isVisible(p));
  const summary = summaryText(t, s);
  return [
    {
      id: "night",
      title: darkTitle,
      subtitle: n.state === "normal" ? `${formatDuration(n.to! - n.from!)} with the Sun 6° below the horizon` : "",
      icon: { source: Icons.moon, tint: "blue" },
      section,
      accessories: [{ tag: `${visible.length} planet${visible.length === 1 ? "" : "s"}`, color: "blue" }],
      detail: {
        markdown: `## ${darkTitle}\n\n${summary}`,
        metadata: [
          meta.text("Place", placeLabel(t.place), { icon: Icons.pin }),
          meta.text("Dark from", time(n.from), { icon: Icons.moon }),
          meta.text("Until", time(n.to), { icon: Icons.sun }),
        ],
      },
      actions: [copy(summary, "Copy Summary", { icon: Icons.text }), ...extra],
    },
    {
      id: "moon",
      title: `${phase}, ${percent(t.moon.fraction)} lit`,
      subtitle: nuisance,
      icon: { source: Icons.moon, tint: t.moon.fraction > 0.5 ? "yellow" : "gray" },
      section,
      accessories: moonUp ? [{ text: moonUp }] : [{ text: "Not up while dark" }],
      detail: {
        markdown: `## The Moon\n\n${phase}, ${percent(t.moon.fraction)} lit. ${nuisance}.`,
        metadata: [
          meta.progress("Lit", t.moon.fraction),
          meta.text("Rises", time(t.moon.rise), { icon: Icons.arrowUp }),
          meta.text("Sets", time(t.moon.set), { icon: Icons.arrowDown }),
          meta.text("Up while dark", moonUp || "No"),
        ],
      },
      actions: [open(stellariumUrl("Moon"), "Show in Stellarium Web", { icon: Icons.globe }), ...extra],
    },
    ...[...visible, ...hidden].map((p) => planetItem(p, t, s, extra)),
  ];
}

export function summaryText(t: Tonight, s: Settings): string {
  const visible = t.planets.filter(isVisible).sort((a, b) => a.magnitude - b.magnitude);
  const head = `${formatDay(t.night.day)} at ${t.place.name}: `;
  if (t.night.state === "never") return `${head}the sky doesn't get dark.`;
  if (!visible.length) return `${head}no planet to see tonight.`;
  return head + visible.map((p) => `${PLANETS[p.id].name} (${verdictTag(p, t.night, s).text.toLowerCase()})`).join(
    ", ",
  ) + ".";
}

// ---------------------------------------------------------------------------
// Meteor showers

export interface ShowerEntry {
  shower: Shower;
  peak: number;
  active: boolean;
  /** The peak night from the place, when there is one. */
  view?: ShowerNight;
}

/**
 * The showers active now, then the others by their next peak. An active shower
 * whose peak has passed shows that peak, not next year's.
 */
export function upcomingShowers(now: number, place?: Place): ShowerEntry[] {
  const zone = place ? zoneOf(place) : "UTC";
  const today = dayOf(now, zone);
  return SHOWERS.map((shower) => {
    const active = isActive(shower, today);
    const next = showerPeak(shower, now - 2 * DAY);
    const last = showerPeak(shower, now - 60 * DAY);
    const peak = active && last < now - 2 * DAY ? last : next;
    return { shower, peak, active, view: place ? showerNight(shower, peak, place) : undefined };
  }).sort((a, b) => Number(b.active) - Number(a.active) || a.peak - b.peak);
}

const OUTLOOK: Record<Outlook, { text: string; color: Color }> = {
  excellent: { text: "Excellent", color: "green" },
  good: { text: "Good", color: "teal" },
  fair: { text: "Fair", color: "yellow" },
  poor: { text: "Poor", color: "gray" },
  "radiant-down": { text: "Radiant below horizon", color: "gray" },
  "no-night": { text: "No dark sky", color: "gray" },
};

export function outlookTag(o: Outlook): { text: string; color: Color } {
  return OUTLOOK[o];
}

/** "Jul 17 – Aug 24". */
export function activityText(s: Shower): string {
  const f = (md: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: "short" }).format(
      new Date(`2001-${md}T12:00:00Z`),
    );
  return `${f(s.start)} – ${f(s.end)}`;
}

export function showerItem(e: ShowerEntry, s: Settings, place?: Place): Item {
  const { shower, peak, view } = e;
  const zone = s.zone;
  const time = (ms: number) => formatMoment(ms, zone, s.clock, dayOf(s.now, zone));
  const peakDay = view?.night.day ?? dayOf(peak, zone);
  const tag = view ? outlookTag(view.outlook) : undefined;
  const best = view?.best;
  const rate = best ? Math.round(best.rate) : undefined;
  const moon = view ? `Moon ${percent(view.moonFraction)}` : undefined;
  const sentence = [
    `The ${shower.name} ${peak < s.now ? "peaked" : "peak"} ${relative(peak, s.now)}, around ${
      time(peak)
    }, with up to ${shower.zhr} meteors an hour under a perfect sky.`,
    view && place
      ? view.outlook === "no-night"
        ? `The sky doesn't get dark at ${place.name} that night.`
        : view.outlook === "radiant-down"
        ? `From ${place.name} the radiant stays below the horizon during the dark hours.`
        : `From ${place.name}, expect about ${rate} an hour at best, around ${
          formatTime(best!.at, zone, s.clock)
        }, under a dark sky away from city lights.`
      : "",
    shower.note ?? "",
  ].filter(Boolean).join(" ");
  return {
    id: `shower:${shower.id}`,
    title: shower.name,
    subtitle: `${peak < s.now ? "Peaked the night of" : "Peak night of"} ${formatDay(peakDay, dayOf(s.now, zone))}${
      rate ? ` · about ${rate}/h at best` : ""
    }`,
    icon: { source: Icons.sparkle, tint: e.active ? "yellow" : "gray" },
    section: e.active ? "Active now" : "Coming up",
    keywords: [shower.french, shower.parent],
    accessories: [
      ...(moon ? [{ icon: Icons.moon, text: moon.replace("Moon ", "") }] : []),
      ...(tag ? [{ tag: tag.text, color: tag.color }] : [{ text: `ZHR ${shower.zhr}` }]),
    ],
    detail: {
      markdown: `## ${shower.name}\n\n${sentence}`,
      metadata: [
        meta.text("Peak", `${time(peak)} (${relative(peak, s.now)})`, { icon: Icons.starFilled }),
        meta.text("Active", activityText(shower), { icon: Icons.calendar }),
        meta.text("Rate at best (ZHR)", `${shower.zhr} an hour`),
        ...(view && view.outlook !== "no-night"
          ? [
            meta.tags("From your place", [tag!]),
            ...(best
              ? [meta.text("Best hour", `${time(best.at)}, radiant ${Math.round(best.radiantAltitude)}° up`)]
              : []),
            meta.text("Radiant at most", `${Math.round(Math.max(0, view.radiantAltitude))}° up`),
            meta.progress("Moon", view.moonFraction, `${percent(view.moonFraction)} lit`),
          ]
          : []),
        meta.separator(),
        meta.text(
          "Radiant",
          `${shower.constellation}, RA ${shower.ra}°, Dec ${shower.dec > 0 ? "+" : ""}${shower.dec}°`,
        ),
        meta.text("Speed", `${shower.speed} km/s`),
        meta.text("Parent", shower.parent),
      ],
    },
    actions: [
      copy(sentence, "Copy Summary", { icon: Icons.text }),
      open(`https://www.imo.net/resources/calendar/`, "Open the IMO Calendar", { icon: Icons.globe }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Eclipses

export interface EclipseEntry {
  eclipse: Eclipse;
  lunar?: LunarView;
  solar?: SolarView;
}

export function upcomingEclipses(now: number, place?: Place): EclipseEntry[] {
  return ECLIPSES.filter((e) => Date.parse(e.greatest) > now - DAY).map((eclipse) => ({
    eclipse,
    lunar: place && eclipse.body === "lunar" ? lunarView(eclipse, place) : undefined,
    solar: place && eclipse.body === "solar" ? solarView(eclipse, place) : undefined,
  }));
}

export const eclipseTitle = (e: Eclipse) => `${capitalize(e.kind)} ${e.body} eclipse`;

/** NASA's page for the eclipse: the interactive map of a central solar eclipse, the diagram otherwise. */
export function nasaUrl(e: Eclipse): string {
  const d = new Date(e.greatest);
  const month = new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" }).format(d);
  const key = `${d.getUTCFullYear()}${month}${String(d.getUTCDate()).padStart(2, "0")}`;
  const base = "https://eclipse.gsfc.nasa.gov";
  if (e.body === "lunar") {
    const letter = { total: "T", partial: "P", penumbral: "N" }[e.kind as "total" | "partial" | "penumbral"];
    return `${base}/LEplot/LEplot2001/LE${key}${letter}.pdf`;
  }
  const letter = { total: "T", annular: "A", partial: "P", hybrid: "H" }[e.kind as "total" | "annular" | "partial"];
  return e.kind === "partial"
    ? `${base}/SEplot/SEplot2001/SE${key}${letter}.GIF`
    : `${base}/SEgoogle/SEgoogle2001/SE${key}${letter}google.html`;
}

/** Whether the eclipse can be seen from the place at all. */
export function seenFromPlace(e: EclipseEntry): boolean | undefined {
  if (e.lunar) return e.lunar.visibility !== "not-visible";
  if (e.solar) return e.solar.magnitude > 0;
  return undefined;
}

/** "93 % of the Sun at 20:18", "Total at 20:31", "Visible", "Not visible"… */
export function localText(e: EclipseEntry, s: Settings): string | undefined {
  const t = (ms: number) => formatTime(ms, s.zone, s.clock);
  if (e.solar) {
    const v = e.solar;
    if (v.magnitude <= 0 || v.at === undefined) return "Not visible";
    if (v.central) return `${capitalize(v.central)} at ${t(v.at)}`;
    if (v.magnitude > 0.99) return `Near the edge of the path, ${t(v.at)}`;
    return `${percent(v.obscuration)} of the Sun at ${t(v.at)}`;
  }
  if (e.lunar) {
    if (e.lunar.visibility === "not-visible") return "Not visible";
    if (e.lunar.visibility === "partly") return "Partly visible";
    return `Visible, greatest at ${t(Date.parse(e.eclipse.greatest))}`;
  }
  return undefined;
}

const KIND_COLOR: Record<string, Color> = {
  total: "red",
  annular: "orange",
  hybrid: "orange",
  partial: "yellow",
  penumbral: "gray",
};

export function eclipseItem(e: EclipseEntry, s: Settings, place?: Place): Item {
  const ec = e.eclipse;
  const greatest = Date.parse(ec.greatest);
  const today = dayOf(s.now, s.zone);
  const local = localText(e, s);
  const time = (ms: number) => formatMoment(ms, s.zone, s.clock, today);
  const title = eclipseTitle(ec);
  const lines: Metadata[] = [
    meta.tags("Type", [{ text: capitalize(ec.kind), color: KIND_COLOR[ec.kind] }]),
    meta.text("Greatest eclipse", `${time(greatest)} (${relative(greatest, s.now)})`, { icon: Icons.clock }),
    meta.text(ec.body === "solar" ? "Magnitude" : "Umbral magnitude", ec.magnitude.toFixed(3)),
  ];
  if (ec.body === "solar" && ec.durations[0]) {
    lines.push(meta.text(`Longest ${ec.kind === "annular" ? "annularity" : "totality"}`, ec.durations[0]));
  }
  if (ec.body === "lunar" && ec.durations[0]) lines.push(meta.text("Partial phase", ec.durations[0]));
  if (ec.body === "lunar" && ec.durations[1]) lines.push(meta.text("Totality", ec.durations[1]));
  lines.push(meta.text("Seen from", ec.regions, { icon: Icons.globe }));
  if (ec.path) lines.push(meta.text(ec.kind === "annular" ? "Ring of fire over" : "Totality over", ec.path));
  lines.push(meta.text("Saros", String(ec.saros)));

  const md = [`## ${title}`, ""];
  if (ec.path) md.push(`The ${ec.kind === "annular" ? "ring of fire" : "total eclipse"} crosses ${ec.path}.`, "");
  md.push(`Seen from: ${ec.regions}.`, "");
  if (place && local) {
    lines.push(meta.separator(), meta.text(`From ${place.name}`, local, { icon: Icons.pin }));
    if (e.solar && e.solar.magnitude > 0 && e.solar.at !== undefined) {
      const v = e.solar;
      lines.push(
        meta.progress("Sun covered", v.obscuration),
        meta.text("Begins", time(v.begins!)),
        meta.text("Maximum", `${time(v.at!)}, Sun ${Math.round(v.sunAltitude ?? 0)}° up`),
        meta.text("Ends", time(v.ends!)),
      );
      md.push(`From ${place.name}: ${local.charAt(0).toLowerCase()}${local.slice(1)}, computed for your place.`, "");
    }
    if (e.lunar) {
      for (const p of e.lunar.phases) lines.push(meta.text(p.label, `${time(p.at)}${p.up ? "" : " (Moon down)"}`));
      md.push(
        e.lunar.visibility === "visible"
          ? `From ${place.name} the Moon is up at greatest eclipse.`
          : e.lunar.visibility === "partly"
          ? `From ${place.name} the Moon is up for only part of the eclipse.`
          : `From ${place.name} the Moon is below the horizon during the eclipse.`,
        "",
      );
    }
  }
  if (ec.body === "solar") {
    md.push("> Never look at the Sun without certified eclipse glasses, even when it is mostly covered.");
  }
  if (ec.kind === "penumbral") md.push("> A penumbral eclipse only dims the Moon slightly: it is hard to notice.");

  const seen = seenFromPlace(e);
  return {
    id: `eclipse:${ec.greatest}`,
    title,
    subtitle: `${formatDay(dayOf(greatest, s.zone), today)}${local ? ` · ${local}` : ` · ${ec.path ?? ec.regions}`}`,
    icon: { source: ec.body === "solar" ? Icons.sun : Icons.moon, tint: seen === false ? "gray" : KIND_COLOR[ec.kind] },
    section: String(new Date(greatest).getUTCFullYear()),
    keywords: [ec.body === "solar" ? "éclipse solaire soleil" : "éclipse lunaire lune", ec.regions, ec.path ?? ""],
    accessories: [
      ...(seen === undefined
        ? []
        : [{ tag: seen ? "Visible here" : "Not here", color: (seen ? "green" : "gray") as Color }]),
      { text: relative(greatest, s.now) },
    ],
    detail: { markdown: md.join("\n"), metadata: lines },
    actions: [
      open(nasaUrl(ec), ec.body === "solar" && ec.kind !== "partial" ? "Open NASA Map" : "Open NASA Diagram", {
        icon: Icons.globe,
      }),
      copy(`${title}, ${formatDay(dayOf(greatest, s.zone))}${local ? `: ${local}` : ""}`, "Copy Summary", {
        icon: Icons.text,
      }),
    ],
  };
}
