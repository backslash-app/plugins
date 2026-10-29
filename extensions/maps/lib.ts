// Maps logic: Nominatim requests and answers, addresses, OSM tags and map
// links. Pure, tested in lib_test.ts.

export const NOMINATIM = "https://nominatim.openstreetmap.org";

/** Nominatim's usage policy asks for an identifying User-Agent. */
export const USER_AGENT = "Backslash-Maps/1.0 (+https://github.com/backslash-app/plugins)";

/** A place as Nominatim's `jsonv2` format returns it. */
export interface RawPlace {
  place_id?: number;
  osm_type?: string;
  osm_id?: number;
  lat: string;
  lon: string;
  category?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  name?: string;
  display_name?: string;
  importance?: number;
  address?: Record<string, string>;
  extratags?: Record<string, string> | null;
}

export interface Place {
  /** `node/123`, or the coordinates for a typed position. */
  id: string;
  name: string;
  lat: number;
  lon: number;
  category: string;
  type: string;
  osmType?: "node" | "way" | "relation";
  osmId?: number;
  displayName: string;
  address: Record<string, string>;
  tags: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Requests

export function searchUrl(query: string, o: { language?: string; countries?: string; limit?: number } = {}): string {
  const p = new URLSearchParams({
    q: query.trim(),
    format: "jsonv2",
    addressdetails: "1",
    extratags: "1",
    limit: String(o.limit ?? 10),
  });
  const cc = parseCountries(o.countries ?? "");
  if (cc.length) p.set("countrycodes", cc.join(","));
  p.set("accept-language", languageOf(o.language));
  return `${NOMINATIM}/search?${p}`;
}

export const languageOf = (v: unknown) => {
  const s = String(v ?? "").trim().toLowerCase();
  return /^[a-z]{2,3}(-[a-z]{2})?$/.test(s) ? s : "en";
};

export const parseCountries = (
  s: string,
) => [...new Set(s.toLowerCase().split(/[\s,;]+/).filter((c) => /^[a-z]{2}$/.test(c)))];

/** A cache key: what changes the answer. */
export const cacheKey = (query: string, language: string, countries: string) =>
  `${query.trim().toLowerCase().replace(/\s+/g, " ")}|${languageOf(language)}|${parseCountries(countries).join(",")}`;

/** Worth sending: at least 3 characters that aren't all punctuation. */
export const searchable = (q: string) => q.trim().replace(/[^\p{L}\p{N}]/gu, "").length >= 3;

// ---------------------------------------------------------------------------
// Places

const OSM_TYPES = new Set(["node", "way", "relation"]);

export function toPlace(r: RawPlace): Place | undefined {
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return undefined;
  const osmType = OSM_TYPES.has(r.osm_type ?? "") ? r.osm_type as Place["osmType"] : undefined;
  const address = r.address ?? {};
  const display = r.display_name ?? "";
  const name = r.name?.trim() || streetLine(address) || display.split(",")[0]?.trim() || `${lat}, ${lon}`;
  return {
    id: osmType && r.osm_id ? `${osmType}/${r.osm_id}` : `${lat},${lon}`,
    name,
    lat,
    lon,
    category: r.category ?? r.class ?? "",
    type: r.type ?? "",
    osmType,
    osmId: r.osm_id,
    displayName: display,
    address,
    tags: r.extratags ?? {},
  };
}

/** Nominatim's answer, without duplicates (the same object found twice). */
export function parseResults(json: unknown): Place[] {
  if (!Array.isArray(json)) return [];
  const seen = new Set<string>();
  const out: Place[] = [];
  for (const r of json as RawPlace[]) {
    const p = toPlace(r);
    if (!p || seen.has(p.id)) continue;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

/** "48.8566, 2.3522", "48.8566 2.3522" or "geo:48.8566,2.3522": a position, no search needed. */
export function parseCoordinates(text: string): { lat: number; lon: number } | undefined {
  const m = text.trim().match(/^(?:geo:)?\s*(-?\d{1,2}(?:\.\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:\.\d+)?)(?:[;?].*)?$/i);
  if (!m) return undefined;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { lat, lon };
}

export function coordinatePlace(lat: number, lon: number, name?: string): Place {
  return {
    id: `${lat},${lon}`,
    name: name ?? `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
    lat,
    lon,
    category: "position",
    type: "coordinates",
    displayName: "",
    address: {},
    tags: {},
  };
}

// ---------------------------------------------------------------------------
// Addresses

const first = (a: Record<string, string>, keys: string[]) => keys.map((k) => a[k]).find(Boolean);

/** "12 Rue de Rivoli" (house number first, as most countries but not all write it). */
export function streetLine(a: Record<string, string>): string {
  const road = first(a, ["road", "pedestrian", "footway", "path", "square", "place"]);
  if (!road) return "";
  return a.house_number ? `${a.house_number} ${road}` : road;
}

export const cityOf = (a: Record<string, string>) =>
  first(a, ["city", "town", "village", "municipality", "hamlet", "suburb", "county"]);

/** The address in up to three lines: street, postcode and city, country. */
export function addressLines(p: Place): string[] {
  const a = p.address;
  const street = streetLine(a);
  const city = cityOf(a);
  const lines = [
    street && street !== p.name ? street : "",
    [a.postcode, city].filter(Boolean).join(" "),
    a.country ?? "",
  ].filter(Boolean);
  if (lines.length) return lines;
  return p.displayName ? [p.displayName] : [];
}

/** One line for the list: "Paris, France" or the street and city. */
export function subtitleOf(p: Place): string {
  const a = p.address;
  const city = cityOf(a);
  const street = streetLine(a);
  const parts = [street && street !== p.name ? street : "", city && city !== p.name ? city : "", a.country]
    .filter(Boolean);
  if (parts.length) return parts.join(", ");
  return p.displayName.split(",").slice(1, 3).join(",").trim();
}

/** The full address, to copy. */
export const fullAddress = (p: Place) => p.displayName || [p.name, ...addressLines(p)].filter(Boolean).join(", ");

// ---------------------------------------------------------------------------
// What a place is

const TYPE_NAMES: Record<string, string> = {
  fast_food: "Fast food",
  ice_cream: "Ice cream",
  station: "Station",
  bus_stop: "Bus stop",
  townhall: "Town hall",
  place_of_worship: "Place of worship",
  administrative: "Administrative area",
  residential: "Street",
  primary: "Road",
  secondary: "Road",
  tertiary: "Road",
  unclassified: "Road",
  living_street: "Street",
  house: "Address",
  postcode: "Postcode",
  coordinates: "Coordinates",
};

/** "Restaurant", "Railway station", "City". */
export function typeLabel(p: Pick<Place, "category" | "type">): string {
  if (TYPE_NAMES[p.type]) {
    return p.category === "railway" && p.type === "station" ? "Railway station" : TYPE_NAMES[p.type];
  }
  const raw = p.type && p.type !== "yes" ? p.type : p.category;
  if (!raw) return "Place";
  const words = raw.replace(/_/g, " ");
  return words[0].toUpperCase() + words.slice(1);
}

export type Tint = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

/** A glyph and color for the kind of place. */
export function iconOf(p: Pick<Place, "category" | "type">): { source: string; tint: Tint } {
  const t = p.type;
  switch (p.category) {
    case "amenity":
      if (["restaurant", "cafe", "bar", "pub", "fast_food", "ice_cream", "biergarten"].includes(t)) {
        return { source: "bs-coffee", tint: "orange" };
      }
      if (["hospital", "clinic", "pharmacy", "doctors", "dentist"].includes(t)) {
        return { source: "bs-plus", tint: "red" };
      }
      if (["school", "university", "college", "library", "kindergarten"].includes(t)) {
        return { source: "bs-book", tint: "blue" };
      }
      if (["parking", "fuel", "charging_station", "bicycle_parking"].includes(t)) {
        return { source: "bs-bolt", tint: "gray" };
      }
      return { source: "bs-pin", tint: "orange" };
    case "shop":
      return { source: "bs-package", tint: "purple" };
    case "tourism":
      return t === "hotel" || t === "hostel" || t === "guest_house"
        ? { source: "bs-home", tint: "blue" }
        : { source: "bs-star", tint: "yellow" };
    case "railway":
    case "public_transport":
    case "aeroway":
      return { source: "bs-arrow-right", tint: "teal" };
    case "highway":
      return { source: "bs-arrow-right", tint: "gray" };
    case "leisure":
    case "natural":
    case "landuse":
    case "waterway":
      return { source: "bs-leaf", tint: "green" };
    case "building":
      return { source: "bs-home", tint: "gray" };
    case "place":
    case "boundary":
      return { source: "bs-globe", tint: "blue" };
    case "historic":
      return { source: "bs-flag", tint: "yellow" };
    case "position":
      return { source: "bs-pin", tint: "red" };
    default:
      return { source: "bs-pin", tint: "blue" };
  }
}

// ---------------------------------------------------------------------------
// OSM tags

export interface Contact {
  phone?: string;
  website?: string;
  email?: string;
  openingHours?: string;
  wikipedia?: string;
  cuisine?: string;
  wheelchair?: string;
  operator?: string;
}

export function contactOf(tags: Record<string, string>): Contact {
  const pick = (...keys: string[]) => keys.map((k) => tags[k]?.trim()).find(Boolean);
  const website = pick("website", "contact:website", "url");
  return {
    phone: pick("phone", "contact:phone", "contact:mobile")?.split(";")[0].trim(),
    website: website ? (/^https?:\/\//i.test(website) ? website : `https://${website}`) : undefined,
    email: pick("email", "contact:email")?.split(";")[0].trim(),
    openingHours: pick("opening_hours"),
    wikipedia: pick("wikipedia"),
    cuisine: pick("cuisine")?.split(";").map((c) => c.trim().replace(/_/g, " ")).join(", "),
    wheelchair: pick("wheelchair"),
    operator: pick("operator", "brand"),
  };
}

/** `fr:Tour Eiffel` → its Wikipedia URL. */
export function wikipediaUrl(tag: string): string | undefined {
  const m = tag.match(/^([a-z-]{2,12}):(.+)$/);
  if (!m) return undefined;
  return `https://${m[1]}.wikipedia.org/wiki/${encodeURIComponent(m[2].trim().replace(/ /g, "_"))}`;
}

/** `Mo-Fr 09:00-18:00; Sa 10:00-13:00` → one rule per line. */
export const hoursLines = (oh: string) => oh.split(";").map((s) => s.trim()).filter(Boolean);

/** A phone number as a `tel:` link: digits and a leading +. */
export const telUrl = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

// ---------------------------------------------------------------------------
// Links

const fixed = (n: number) => String(Number(n.toFixed(6)));
export const coords = (p: { lat: number; lon: number }) => `${fixed(p.lat)}, ${fixed(p.lon)}`;
export const geoUri = (p: { lat: number; lon: number; name?: string }) =>
  `geo:${fixed(p.lat)},${fixed(p.lon)}${
    p.name ? `?q=${fixed(p.lat)},${fixed(p.lon)}(${encodeURIComponent(p.name)})` : ""
  }`;

export function osmUrl(p: Place): string {
  if (p.osmType && p.osmId) return `https://www.openstreetmap.org/${p.osmType}/${p.osmId}`;
  return `https://www.openstreetmap.org/?mlat=${fixed(p.lat)}&mlon=${fixed(p.lon)}#map=17/${fixed(p.lat)}/${
    fixed(p.lon)
  }`;
}

export const googleUrl = (p: Place) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${fixed(p.lat)},${fixed(p.lon)}`)}`;

export const appleUrl = (p: Place) =>
  `https://maps.apple.com/?ll=${fixed(p.lat)},${fixed(p.lon)}&q=${encodeURIComponent(p.name)}`;

export type Mode = "car" | "bike" | "foot";

export function modeOf(v: unknown): Mode {
  const s = String(v ?? "").trim().toLowerCase();
  if (["bike", "bicycle", "cycling", "vélo", "velo"].includes(s)) return "bike";
  if (["foot", "walk", "walking", "pied", "à pied"].includes(s)) return "foot";
  return "car";
}

/** openstreetmap.org's directions, with its OSRM engines. */
export function directionsUrl(from: { lat: number; lon: number }, to: { lat: number; lon: number }, mode: Mode) {
  const engine = `fossgis_osrm_${mode}`;
  return `https://www.openstreetmap.org/directions?engine=${engine}&route=${fixed(from.lat)}%2C${fixed(from.lon)}%3B${
    fixed(to.lat)
  }%2C${fixed(to.lon)}`;
}

export function googleDirectionsUrl(from: { lat: number; lon: number }, to: { lat: number; lon: number }, mode: Mode) {
  const travel = mode === "bike" ? "bicycling" : mode === "foot" ? "walking" : "driving";
  const p = new URLSearchParams({
    api: "1",
    origin: `${fixed(from.lat)},${fixed(from.lon)}`,
    destination: `${fixed(to.lat)},${fixed(to.lon)}`,
    travelmode: travel,
  });
  return `https://www.google.com/maps/dir/?${p}`;
}

// ---------------------------------------------------------------------------
// Distances

/** Great-circle distance in metres. */
export function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** 850 → "850 m", 12345 → "12 km", 1500 → "1.5 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000).toLocaleString("en")} km`;
}

/** Sorts results by Nominatim's order, keeping saved places first. */
export function withSavedFirst(results: Place[], saved: Place[]): Place[] {
  const ids = new Set(saved.map((s) => s.id));
  return [...results.filter((r) => ids.has(r.id)), ...results.filter((r) => !ids.has(r.id))];
}
