// GBFS feeds (versions 1.x, 2.x and 3.0): discovery, stations, live status, distances. No I/O here.

export interface System {
  id: string;
  name: string;
  city: string;
  url: string;
}

/** Systems known by name; any other gbfs.json URL works too if its host is allowed. */
export const SYSTEMS: System[] = [
  {
    id: "velib",
    name: "Vélib' Métropole",
    city: "Paris",
    url: "https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/gbfs.json",
  },
  { id: "velov", name: "Vélo'v", city: "Lyon", url: "https://api.cyclocity.fr/contracts/lyon/gbfs/v3/gbfs.json" },
  { id: "vlille", name: "V'Lille", city: "Lille", url: "https://media.ilevia.fr/opendata/gbfs.json" },
  {
    id: "bicloo",
    name: "Naolib Vélo (ex-Bicloo)",
    city: "Nantes",
    url: "https://api.cyclocity.fr/contracts/nantes/gbfs/v3/gbfs.json",
  },
  {
    id: "velotoulouse",
    name: "VélÔToulouse",
    city: "Toulouse",
    url: "https://api.cyclocity.fr/contracts/toulouse/gbfs/v3/gbfs.json",
  },
  {
    id: "velhop",
    name: "Vélhop",
    city: "Strasbourg",
    url: "https://gbfs.nextbike.net/maps/gbfs/v2/nextbike_ae/gbfs.json",
  },
  {
    id: "velomagg",
    name: "Vélomagg",
    city: "Montpellier",
    url: "https://gbfs.theta.fifteen.eu/gbfs/montpellier/gbfs.json",
  },
  {
    id: "velostanlib",
    name: "VélOstan'lib",
    city: "Nancy",
    url: "https://api.cyclocity.fr/contracts/nancy/gbfs/v3/gbfs.json",
  },
  { id: "velam", name: "Velam", city: "Amiens", url: "https://api.cyclocity.fr/contracts/amiens/gbfs/v3/gbfs.json" },
  {
    id: "velocite",
    name: "VéloCité",
    city: "Besançon",
    url: "https://api.cyclocity.fr/contracts/besancon/gbfs/v3/gbfs.json",
  },
  {
    id: "velo2",
    name: "VélO2",
    city: "Cergy-Pontoise",
    url: "https://api.cyclocity.fr/contracts/cergy/gbfs/v3/gbfs.json",
  },
  {
    id: "villo",
    name: "Villo!",
    city: "Brussels",
    url: "https://api.cyclocity.fr/contracts/bruxelles/gbfs/v3/gbfs.json",
  },
  {
    id: "veloh",
    name: "Vel'OH!",
    city: "Luxembourg",
    url: "https://api.cyclocity.fr/contracts/luxembourg/gbfs/v3/gbfs.json",
  },
  {
    id: "dublinbikes",
    name: "Dublinbikes",
    city: "Dublin",
    url: "https://api.cyclocity.fr/contracts/dublin/gbfs/v3/gbfs.json",
  },
  {
    id: "sevici",
    name: "Sevici",
    city: "Seville",
    url: "https://api.cyclocity.fr/contracts/seville/gbfs/v3/gbfs.json",
  },
  {
    id: "valenbisi",
    name: "Valenbisi",
    city: "Valencia",
    url: "https://api.cyclocity.fr/contracts/valence/gbfs/v3/gbfs.json",
  },
  {
    id: "bicing",
    name: "Bicing",
    city: "Barcelona",
    url: "https://barcelona.publicbikesystem.net/customer/gbfs/v3.0/gbfs.json",
  },
  { id: "citibike", name: "Citi Bike", city: "New York", url: "https://gbfs.citibikenyc.com/gbfs/2.3/gbfs.json" },
  { id: "bixi", name: "BIXI", city: "Montréal", url: "https://gbfs.velobixi.com/gbfs/2-2/gbfs.json" },
  {
    id: "toronto",
    name: "Bike Share Toronto",
    city: "Toronto",
    url: "https://toronto.publicbikesystem.net/customer/gbfs/v3.0/gbfs.json",
  },
];

/**
 * Same list as `[permissions] net`: the hosts of the systems above (Citi Bike's
 * feeds live on gbfs.lyft.com), plus the big operators' feed hosts so that
 * most other gbfs.json URLs work as well.
 */
export const HOSTS = [
  "velib-metropole-opendata.smovengo.cloud",
  "api.cyclocity.fr",
  "media.ilevia.fr",
  "gbfs.nextbike.net",
  "gbfs.theta.fifteen.eu",
  "gbfs.partners.fifteen.eu",
  "*.publicbikesystem.net",
  "gbfs.citibikenyc.com",
  "gbfs.lyft.com",
  "gbfs.velobixi.com",
  "api.gbfs.v3.0.ecovelo.mobi",
  "stables.donkey.bike",
];

/** The system of the preference: a known id or name, else a gbfs.json URL. */
export function resolveSystem(pref: unknown): System | undefined {
  const raw = String(pref ?? "").trim();
  if (!raw) return SYSTEMS[0];
  if (/^https?:\/\//i.test(raw)) {
    const known = SYSTEMS.find((s) => s.url === raw);
    if (known) return known;
    try {
      const u = new URL(raw);
      return { id: "custom", name: u.hostname, city: "", url: raw };
    } catch {
      return undefined;
    }
  }
  const key = fold(raw);
  return SYSTEMS.find((s) => s.id === key || fold(s.name) === key || fold(s.city) === key) ??
    SYSTEMS.find((s) => fold(s.name).includes(key));
}

/** "Vélo'v" → "velov": lower case, no accents or punctuation. */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Whether `host` is allowed by a list with `*.example.com` wildcards. */
export function hostAllowed(host: string, hosts = HOSTS): boolean {
  const h = host.toLowerCase();
  return hosts.some((p) => p.startsWith("*.") ? h.endsWith(p.slice(1)) : h === p);
}

// ---------------------------------------------------------------------------
// Discovery

export interface Feeds {
  station_information?: string;
  station_status?: string;
  vehicle_types?: string;
  system_information?: string;
}

/**
 * gbfs.json → feed URLs. v1/v2 nest feeds by language (`data.en.feeds`), v3
 * lists them directly (`data.feeds`).
 */
export function parseDiscovery(json: unknown, languages = ["en", "fr"]): Feeds {
  const data = (json as { data?: unknown })?.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") return {};
  let feeds: unknown = data.feeds;
  if (!Array.isArray(feeds)) {
    const langs = Object.keys(data);
    const lang = languages.find((l) => langs.includes(l)) ?? langs[0];
    feeds = (data[lang] as { feeds?: unknown })?.feeds;
  }
  const out: Feeds = {};
  for (const f of Array.isArray(feeds) ? feeds : []) {
    const { name, url } = f as { name?: string; url?: string };
    if (
      url && (name === "station_information" || name === "station_status" || name === "vehicle_types" ||
        name === "system_information")
    ) out[name] = url;
  }
  return out;
}

/** A GBFS v3 localized string (`[{ text, language }]`) or a plain one. */
export function localized(v: unknown, languages = ["en", "fr"]): string {
  if (typeof v === "string") return v;
  if (!Array.isArray(v)) return "";
  const items = v as { text?: string; language?: string }[];
  for (const l of languages) {
    const hit = items.find((i) => i.language?.toLowerCase().startsWith(l) && i.text);
    if (hit) return String(hit.text);
  }
  return String(items.find((i) => i.text)?.text ?? "");
}

export function systemName(json: unknown): string | undefined {
  const data = (json as { data?: Record<string, unknown> })?.data;
  const name = localized(data?.name);
  return name || undefined;
}

// ---------------------------------------------------------------------------
// Stations

export interface Station {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address?: string;
  capacity?: number;
  /** Short code users know, e.g. Vélib's "16107". */
  code?: string;
}

export function parseStations(json: unknown): Station[] {
  const list = (json as { data?: { stations?: unknown } })?.data?.stations;
  if (!Array.isArray(list)) return [];
  return list.flatMap((s) => {
    const o = s as Record<string, unknown>;
    const lat = Number(o.lat), lon = Number(o.lon);
    const name = localized(o.name).trim();
    if (o.station_id === undefined || !name || !Number.isFinite(lat) || !Number.isFinite(lon) || (!lat && !lon)) {
      return [];
    }
    const code = o.stationCode ?? o.short_name;
    return [{
      id: String(o.station_id),
      name: cleanName(name),
      lat,
      lon,
      address: o.address ? String(o.address) : undefined,
      capacity: Number.isFinite(Number(o.capacity)) && o.capacity !== null ? Number(o.capacity) : undefined,
      code: code ? String(code) : undefined,
    }];
  });
}

/** "1031 - PLACE DE LA PAIX" → "Place de la Paix"; already mixed-case names are kept. */
export function cleanName(name: string): string {
  const n = name.replace(/^#?\d+\s*-\s*/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  if (n !== n.toUpperCase()) return n;
  const small = new Set(["de", "du", "des", "la", "le", "les", "et", "d", "l", "à", "au", "aux", "sur"]);
  const roman = /^(ii|iii|iv|vi|vii|viii|ix|xi|xii)$/;
  return n.toLowerCase().replace(/[\p{L}\d]+/gu, (w, i: number) => {
    if (roman.test(w)) return w.toUpperCase();
    return i > 0 && small.has(w) ? w : w[0].toUpperCase() + w.slice(1);
  });
}

export type Propulsion = "human" | "electric";

/** vehicle_types.json → id → human or electric. */
export function parseVehicleTypes(json: unknown): Record<string, Propulsion> {
  const list = (json as { data?: { vehicle_types?: unknown } })?.data?.vehicle_types;
  const out: Record<string, Propulsion> = {};
  for (const v of Array.isArray(list) ? list : []) {
    const o = v as { vehicle_type_id?: unknown; propulsion_type?: string; form_factor?: string };
    if (o.vehicle_type_id === undefined) continue;
    out[String(o.vehicle_type_id)] = o.propulsion_type && o.propulsion_type !== "human" ? "electric" : "human";
  }
  return out;
}

export interface Status {
  bikes: number;
  /** Known when the feed splits them. */
  mechanical?: number;
  ebikes?: number;
  docks: number;
  disabledBikes?: number;
  installed: boolean;
  renting: boolean;
  returning: boolean;
  /** ms since epoch */
  reported?: number;
}

const flag = (v: unknown) => v === undefined || v === null ? true : v === true || v === 1 || v === "1" || v === "true";
const count = (v: unknown) => Number.isFinite(Number(v)) && v !== null ? Number(v) : undefined;

function timeOf(v: unknown): number | undefined {
  if (typeof v === "number") return v > 1e12 ? v : v * 1000;
  if (typeof v === "string" && v) {
    const n = Number(v);
    if (Number.isFinite(n)) return n > 1e12 ? n : n * 1000;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

/**
 * station_status.json → id → status. The mechanical / e-bike split comes from
 * `vehicle_types_available` with the vehicle types (GBFS 2.1+), Vélib's
 * `num_bikes_available_types`, or Lyft's `num_ebikes_available`.
 */
export function parseStatus(json: unknown, types: Record<string, Propulsion> = {}): Map<string, Status> {
  const list = (json as { data?: { stations?: unknown } })?.data?.stations;
  const out = new Map<string, Status>();
  for (const s of Array.isArray(list) ? list : []) {
    const o = s as Record<string, unknown>;
    if (o.station_id === undefined) continue;
    const bikes = count(o.num_vehicles_available) ?? count(o.num_bikes_available) ?? 0;
    let mechanical: number | undefined, ebikes: number | undefined;

    if (Array.isArray(o.vehicle_types_available)) {
      // A split only means something when the system has e-bikes at all.
      let human = 0, electric = 0, known = false, hasElectric = false;
      for (const t of o.vehicle_types_available as { vehicle_type_id?: unknown; count?: unknown }[]) {
        const kind = types[String(t.vehicle_type_id)] ?? guessPropulsion(String(t.vehicle_type_id));
        if (!kind) continue;
        known = true;
        if (kind === "electric") hasElectric = true;
        if (kind === "electric") electric += count(t.count) ?? 0;
        else human += count(t.count) ?? 0;
      }
      if (known && hasElectric) [mechanical, ebikes] = [human, electric];
    } else if (Array.isArray(o.num_bikes_available_types)) {
      for (const t of o.num_bikes_available_types as Record<string, unknown>[]) {
        if (t.mechanical !== undefined) mechanical = count(t.mechanical);
        if (t.ebike !== undefined) ebikes = count(t.ebike);
      }
    }
    if (ebikes === undefined && count(o.num_ebikes_available) !== undefined) {
      ebikes = count(o.num_ebikes_available);
      mechanical = Math.max(0, bikes - ebikes!);
    }
    out.set(String(o.station_id), {
      bikes,
      mechanical,
      ebikes,
      docks: count(o.num_docks_available) ?? 0,
      disabledBikes: count(o.num_vehicles_disabled) ?? count(o.num_bikes_disabled),
      installed: flag(o.is_installed),
      renting: flag(o.is_renting),
      returning: flag(o.is_returning),
      reported: timeOf(o.last_reported),
    });
  }
  return out;
}

/** Without vehicle_types.json, some ids say what they are. */
function guessPropulsion(id: string): Propulsion | undefined {
  const i = id.toLowerCase();
  if (/^(e-?bike|electric(al)?|ebike|elec)/.test(i)) return "electric";
  if (/^(mechanical|bike|classic|human|velo|bicycle)$/.test(i)) return "human";
  return undefined;
}

// ---------------------------------------------------------------------------
// Places and distances

export interface Point {
  lat: number;
  lon: number;
}

/** "48.8566, 2.3522" (or with a space, or a geo: URI) → a point. */
export function parseCoordinates(text: unknown): Point | undefined {
  const m = String(text ?? "").trim().replace(/^geo:/i, "").match(
    /^(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)$/,
  );
  if (!m) return undefined;
  const lat = Number(m[1]), lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

/** Great-circle distance in metres. */
export function distance(a: Point, b: Point): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

/** About 12 minutes per kilometre on foot. */
export const walkMinutes = (m: number) => Math.max(1, Math.round(m / 80));

export function age(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "unknown";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

// ---------------------------------------------------------------------------
// Rows

export interface Row {
  station: Station;
  status?: Status;
  /** Metres from home, when it is set. */
  distance?: number;
}

export type Need = "all" | "bikes" | "ebikes" | "docks";

export function matches(row: Row, need: Need): boolean {
  const s = row.status;
  if (need === "all") return true;
  if (!s || !s.installed) return false;
  if (need === "bikes") return s.renting && s.bikes > 0;
  if (need === "ebikes") return s.renting && (s.ebikes ?? 0) > 0;
  return s.returning && s.docks > 0;
}

/** Stations with their status, nearest first when `home` is set, else by name. */
export function rows(stations: Station[], status: Map<string, Status>, home?: Point): Row[] {
  const out = stations.map((station) => ({
    station,
    status: status.get(station.id),
    distance: home ? distance(home, station) : undefined,
  }));
  return out.sort((a, b) =>
    a.distance !== undefined && b.distance !== undefined
      ? a.distance - b.distance
      : a.station.name.localeCompare(b.station.name)
  );
}

export type State = "closed" | "empty" | "full" | "few" | "ok" | "unknown";

export function stateOf(s?: Status): State {
  if (!s) return "unknown";
  if (!s.installed || (!s.renting && !s.returning)) return "closed";
  if (s.bikes === 0) return "empty";
  if (s.docks === 0) return "full";
  if (s.bikes <= 2) return "few";
  return "ok";
}

export const STATE_LOOK: Record<State, { text: string; tint: "green" | "orange" | "red" | "gray" | "yellow" }> = {
  closed: { text: "Closed", tint: "gray" },
  empty: { text: "No bikes", tint: "red" },
  full: { text: "Full, no docks", tint: "orange" },
  few: { text: "Few bikes", tint: "yellow" },
  ok: { text: "Available", tint: "green" },
  unknown: { text: "No live data", tint: "gray" },
};

/** "5 bikes (2 e-bikes) · 12 docks" */
export function summary(s?: Status): string {
  if (!s) return "No live data";
  const split = s.ebikes !== undefined ? ` (${s.ebikes} e-bike${s.ebikes === 1 ? "" : "s"})` : "";
  return `${s.bikes} bike${s.bikes === 1 ? "" : "s"}${split} · ${s.docks} dock${s.docks === 1 ? "" : "s"}`;
}

export function mapsUrl(p: Point): string {
  return `https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lon}#map=18/${p.lat}/${p.lon}`;
}

export function directionsUrl(from: Point | undefined, to: Point): string {
  if (!from) return mapsUrl(to);
  return `https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=${from.lat}%2C${from.lon}%3B${to.lat}%2C${to.lon}`;
}
