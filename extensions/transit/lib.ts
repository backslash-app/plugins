// Navitia shapes, times, delays, lines and journeys. Pure, tested in lib_test.ts.

import { type Color, Icons } from "@backslash/api";

// ---------------------------------------------------------------------------
// Navitia datetimes are local to the coverage, without a zone: 20261028T143000.

/** `20261028T143000` → minutes since the epoch, read as if it were UTC (only differences matter). */
export function navMinutes(dt: string | undefined): number | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/.exec(dt ?? "");
  if (!m) return undefined;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] ?? 0)) / 60_000;
}

/** `20261028T143000` → `14:30`. */
export const clock = (
  dt: string | undefined,
) => (dt && dt.length >= 13 ? `${dt.slice(9, 11)}:${dt.slice(11, 13)}` : "");

/** `20261028T143000` → `2026-10-28`. */
export const navDay = (dt: string) => `${dt.slice(0, 4)}-${dt.slice(4, 6)}-${dt.slice(6, 8)}`;

/** A local `Date` → `20261028T143000` (the user and the network are assumed to share a time zone). */
export function toNav(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${
    p(d.getSeconds())
  }`;
}

/** Minutes from `now` to `dt`, both Navitia datetimes. */
export function minutesUntil(dt: string, now: string): number {
  return Math.round((navMinutes(dt) ?? 0) - (navMinutes(now) ?? 0));
}

/** "now", "4 min", "1 h 05". */
export function wait(minutes: number): string {
  if (minutes <= 0) return "now";
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}`;
}

/** Seconds → "45 min", "1 h 07", "2 h". */
export function duration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${String(m % 60).padStart(2, "0")}` : `${h} h`;
}

// ---------------------------------------------------------------------------
// Lines

export interface DisplayInfo {
  code?: string;
  color?: string;
  text_color?: string;
  direction?: string;
  headsign?: string;
  label?: string;
  name?: string;
  network?: string;
  commercial_mode?: string;
  physical_mode?: string;
  trip_short_name?: string;
  links?: { type: string; id: string; rel?: string }[];
}

/** Navitia's `E2231A` → `#e2231a`; nothing for missing or white-on-white colors. */
export function lineColor(color: string | undefined): string | undefined {
  if (!color || !/^[0-9a-f]{6}$/i.test(color)) return undefined;
  const c = color.toLowerCase();
  return c === "ffffff" ? undefined : `#${c}`;
}

/** "RER B", "Métro 4", "TER 886123", "Bus 38". */
export function lineName(d: DisplayInfo): string {
  const mode = d.commercial_mode ?? d.physical_mode ?? "";
  const code = d.code || d.label || d.trip_short_name || d.name || "";
  if (!code) return mode || "Line";
  if (!mode || code.toLowerCase().startsWith(mode.toLowerCase())) return code;
  return `${mode} ${code}`;
}

/** "Châtelet (Paris)" → "Châtelet": Navitia adds the city to every stop name; search results keep it. */
export function shortStop(name: string | undefined): string {
  const n = (name ?? "").trim();
  return /^(.*\S)\s+\([^)]+\)$/.exec(n)?.[1] ?? n;
}

// ---------------------------------------------------------------------------
// Places (`/coverage/{region}/places?q=`)

export interface NavPlace {
  id: string;
  name: string;
  quality?: number;
  embedded_type: "stop_area" | "stop_point" | "address" | "administrative_region" | "poi" | string;
  stop_area?: {
    id: string;
    name: string;
    label?: string;
    coord?: Coord;
    administrative_regions?: { name: string; zip_code?: string }[];
  };
  address?: { coord?: Coord; label?: string; administrative_regions?: { name: string }[] };
  administrative_region?: { coord?: Coord; name?: string; zip_code?: string };
  poi?: { coord?: Coord; poi_type?: { name?: string } };
}

export interface Coord {
  lon: string;
  lat: string;
}

/** A place the user picked, saved with the coverage it came from. */
export interface Place {
  id: string;
  name: string;
  kind: string;
  coverage: string;
  coord?: Coord;
  city?: string;
}

export function toPlace(p: NavPlace, coverage: string): Place {
  const coord = p.stop_area?.coord ?? p.address?.coord ?? p.administrative_region?.coord ?? p.poi?.coord;
  const city = p.stop_area?.administrative_regions?.[0]?.name ?? p.address?.administrative_regions?.[0]?.name;
  return { id: p.id, name: p.name, kind: p.embedded_type, coverage, coord, city };
}

const KINDS: Record<string, string> = {
  stop_area: "Stop",
  stop_point: "Platform",
  address: "Address",
  administrative_region: "City",
  poi: "Place",
};
export const kindLabel = (kind: string) => KINDS[kind] ?? kind;

export function kindIcon(kind: string): string {
  return kind === "stop_area" || kind === "stop_point"
    ? Icons.pin
    : kind === "address"
    ? Icons.home
    : kind === "administrative_region"
    ? Icons.globe
    : Icons.flag;
}

/** Results of several coverages, best first, one per id. */
export function mergePlaces(lists: Place[][], scores: Map<string, number>): Place[] {
  const seen = new Set<string>();
  return lists.flat()
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
    .filter((p) => !seen.has(p.id) && seen.add(p.id));
}

/** `lon;lat`, what Navitia takes for any point. */
export const coordId = (c: Coord) => `${c.lon};${c.lat}`;

// ---------------------------------------------------------------------------
// Departures (`/coverage/{region}/stop_areas/{id}/departures`)

export interface NavDeparture {
  display_informations: DisplayInfo;
  stop_point?: { id: string; name: string };
  route?: { id: string; name?: string; direction?: { name?: string } };
  stop_date_time: {
    departure_date_time: string;
    base_departure_date_time?: string;
    data_freshness?: "realtime" | "base_schedule" | string;
    additional_informations?: string[];
  };
}

export interface Disruption {
  id: string;
  disruption_id?: string;
  status?: "active" | "future" | "past" | string;
  severity?: { name?: string; effect?: string; color?: string; priority?: number };
  messages?: { text: string; channel?: { name?: string; content_type?: string; types?: string[] } }[];
  application_periods?: { begin: string; end: string }[];
  cause?: string;
  updated_at?: string;
}

export interface Departure {
  line: string;
  code: string;
  color?: string;
  textColor?: string;
  direction: string;
  mode: string;
  network?: string;
  time: string;
  base?: string;
  /** Minutes late (negative: early); undefined without real time. */
  delay?: number;
  realtime: boolean;
  /** Platform or stop point. */
  platform?: string;
  disruptions: Disruption[];
  extra: string[];
}

export function toDeparture(d: NavDeparture, disruptions: Map<string, Disruption>): Departure {
  const info = d.display_informations;
  const sdt = d.stop_date_time;
  const realtime = sdt.data_freshness === "realtime";
  const base = sdt.base_departure_date_time;
  const delay = realtime && base ? minutesUntil(sdt.departure_date_time, base) : undefined;
  const linked = (info.links ?? []).filter((l) => l.type === "disruption").map((l) => disruptions.get(l.id))
    .filter((x): x is Disruption => !!x && x.status !== "past");
  return {
    line: lineName(info),
    code: info.code || info.label || info.name || "",
    color: lineColor(info.color),
    textColor: lineColor(info.text_color),
    direction: shortStop(info.direction || info.headsign || d.route?.direction?.name || ""),
    mode: info.commercial_mode ?? info.physical_mode ?? "",
    network: info.network,
    time: sdt.departure_date_time,
    base,
    delay,
    realtime,
    platform: d.stop_point?.name,
    disruptions: linked,
    extra: (sdt.additional_informations ?? []).filter(Boolean),
  };
}

export function delayLook(d: Pick<Departure, "delay" | "realtime">): { text: string; color: Color } {
  if (!d.realtime || d.delay === undefined) return { text: "scheduled", color: "gray" };
  if (d.delay >= 1) return { text: `+${d.delay} min`, color: d.delay >= 5 ? "red" : "orange" };
  if (d.delay <= -1) return { text: `${d.delay} min`, color: "blue" };
  return { text: "on time", color: "green" };
}

/** Disruptions that cancel or reduce service come first. */
export function disruptionColor(d: Disruption): Color {
  const effect = d.severity?.effect ?? "";
  if (/NO_SERVICE|REDUCED_SERVICE|SIGNIFICANT_DELAYS/.test(effect)) return "red";
  if (/DETOUR|MODIFIED_SERVICE|STOP_MOVED|ADDITIONAL/.test(effect)) return "orange";
  return "yellow";
}

/** The plain text of a disruption: the longest message, HTML stripped. */
export function disruptionText(d: Disruption): string {
  const texts = (d.messages ?? []).map((m) => stripHtml(m.text)).filter(Boolean);
  return texts.sort((a, b) => b.length - a.length)[0] ?? d.cause ?? d.severity?.name ?? "Disruption";
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// Journeys (`/journeys`)

export interface NavSection {
  id?: string;
  type: string;
  mode?: string;
  duration: number;
  departure_date_time?: string;
  arrival_date_time?: string;
  from?: { name: string };
  to?: { name: string };
  display_informations?: DisplayInfo;
  transfer_type?: string;
  geojson?: unknown;
  stop_date_times?: unknown[];
  data_freshness?: string;
}

export interface NavJourney {
  duration: number;
  nb_transfers: number;
  departure_date_time: string;
  arrival_date_time: string;
  type?: string;
  status?: string;
  tags?: string[];
  co2_emission?: { value: number; unit: string };
  durations?: { total?: number; walking?: number; bike?: number; car?: number };
  distances?: { walking?: number };
  fare?: { found?: boolean; total?: { value: string | number; currency?: string } };
  sections: NavSection[];
}

export interface Leg {
  kind: "transit" | "walk" | "bike" | "car" | "wait" | "transfer" | "other";
  label: string;
  duration: number;
  from?: string;
  to?: string;
  depart?: string;
  arrive?: string;
  color?: string;
  direction?: string;
  line?: string;
  stops?: number;
}

const STREET: Record<string, Leg["kind"]> = {
  walking: "walk",
  bike: "bike",
  bss: "bike",
  car: "car",
  ridesharing: "car",
  taxi: "car",
};

/** The sections worth showing: rides, walks, waits; empty transfers and crow flies of 0 s are dropped. */
export function legs(j: NavJourney): Leg[] {
  const out: Leg[] = [];
  for (const s of j.sections) {
    const base = {
      duration: s.duration,
      from: shortStop(s.from?.name),
      to: shortStop(s.to?.name),
      depart: s.departure_date_time,
      arrive: s.arrival_date_time,
    };
    if (s.type === "public_transport" || s.type === "on_demand_transport") {
      const d = s.display_informations ?? {};
      out.push({
        ...base,
        kind: "transit",
        label: lineName(d),
        line: d.code || d.label,
        color: lineColor(d.color),
        direction: shortStop(d.direction || d.headsign),
        stops: Math.max(0, (s.stop_date_times?.length ?? 1) - 1) || undefined,
      });
    } else if (s.type === "waiting") {
      if (s.duration >= 60) out.push({ ...base, kind: "wait", label: "Wait" });
    } else if (s.duration < 30) {
      continue;
    } else if (s.type === "transfer") {
      out.push({ ...base, kind: "transfer", label: "Transfer" });
    } else if (s.type === "street_network" || s.type === "crow_fly" || s.type.startsWith("bss_") || s.type === "park") {
      const kind = STREET[s.mode ?? "walking"] ?? "walk";
      out.push({ ...base, kind, label: kind === "bike" ? "Bike" : kind === "car" ? "Drive" : "Walk" });
    }
  }
  return out;
}

/** "Walk 4 min › RER B › Métro 4 › Walk 3 min". */
export function legsSummary(list: Leg[]): string {
  return list
    .filter((l) => l.kind !== "wait")
    .map((l) => (l.kind === "transit" ? l.label : `${l.label} ${duration(l.duration)}`))
    .join(" › ");
}

/** "1.2 kg CO₂", "450 g CO₂". */
export function co2(j: Pick<NavJourney, "co2_emission">): string | undefined {
  const v = j.co2_emission?.value;
  if (v === undefined || v === null || !Number.isFinite(v)) return undefined;
  return v >= 1000 ? `${(v / 1000).toFixed(1)} kg CO₂` : `${Math.round(v)} g CO₂`;
}

const TYPES: Record<string, string> = {
  best: "Best",
  rapid: "Fast",
  fastest: "Fastest",
  comfort: "Fewer changes",
  less_fallback_walk: "Less walking",
  non_pt_walk: "On foot",
  non_pt_bike: "By bike",
  non_pt_bss: "Bike sharing",
  car: "By car",
};
export const journeyType = (t: string | undefined) => (t ? TYPES[t] ?? t.replace(/_/g, " ") : undefined);

export function transfers(n: number): string {
  return n === 0 ? "direct" : n === 1 ? "1 change" : `${n} changes`;
}

/** The journey as Markdown: each leg with its times. */
export function journeyMarkdown(j: NavJourney): string {
  const lines = legs(j).map((l) => {
    const times = l.depart && l.arrive ? `**${clock(l.depart)} → ${clock(l.arrive)}**` : "";
    if (l.kind === "transit") {
      const dir = l.direction ? ` towards *${l.direction}*` : "";
      const stops = l.stops ? ` · ${l.stops} stop${l.stops === 1 ? "" : "s"}` : "";
      return `- ${times} **${l.label}**${dir}\n  ${l.from} → ${l.to} (${duration(l.duration)}${stops})`;
    }
    if (l.kind === "wait") return `- ${duration(l.duration)} wait`;
    return `- ${times} ${l.label} ${duration(l.duration)}${l.to ? ` to ${l.to}` : ""}`;
  });
  return lines.join("\n");
}

/** Navitia's error ids, as sentences. */
export function navError(id: string | undefined, message: string | undefined): string {
  switch (id) {
    case "no_solution":
      return "No journey found at this time";
    case "unknown_object":
      return `Navitia doesn't know this place or region${message ? ` (${message})` : ""}`;
    case "date_out_of_bounds":
      return "This date is outside the timetables Navitia has";
    case "no_origin":
    case "no_destination":
    case "no_origin_nor_destination":
      return "Navitia can't reach this place from the transport network";
    default:
      return message ? `Navitia: ${message}` : "Navitia couldn't answer";
  }
}

/** The coverage preference: `auto` (or empty) searches the French national and Paris networks. */
export function coverages(input: unknown): string[] {
  const s = String(input ?? "").trim().toLowerCase();
  if (!s || s === "auto") return ["sncf", "fr-idf"];
  return [...new Set(s.split(/[\s,]+/).filter((c) => /^[a-z0-9_-]+$/.test(c)))];
}

/** A line color as an icon tint: the launcher takes `#rrggbb` there too (the SDK type only lists names). */
export const tint = (hex: string | undefined): Color => (hex ?? "gray") as Color;
