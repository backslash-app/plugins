// French fuel prices (flux instantané v2 of data.economie.gouv.fr): the query,
// stations out of its records, distances, freshness and opening hours.

/** The hosts of `[permissions] net` (kept equal by a test). */
export const HOSTS = ["data.economie.gouv.fr", "api-adresse.data.gouv.fr", "geo.api.gouv.fr"];

export const DATASET = "prix-des-carburants-en-france-flux-instantane-v2";
export const RECORDS_URL = `https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/${DATASET}/records`;

/** The fuels sold in France, with their column prefix in the dataset and the name in its `prix` field. */
export const FUELS = [
  { id: "Gazole", title: "Gazole", column: "gazole", feed: "Gazole", hint: "Diesel (B7)" },
  { id: "E10", title: "SP95-E10", column: "e10", feed: "E10", hint: "Unleaded 95 with up to 10% ethanol" },
  { id: "SP98", title: "SP98", column: "sp98", feed: "SP98", hint: "Unleaded 98 (E5)" },
  { id: "SP95", title: "SP95", column: "sp95", feed: "SP95", hint: "Unleaded 95 (E5)" },
  { id: "E85", title: "E85", column: "e85", feed: "E85", hint: "Superethanol" },
  { id: "GPLc", title: "GPLc", column: "gplc", feed: "GPLc", hint: "LPG" },
] as const;

export type FuelId = typeof FUELS[number]["id"];

/** "gazole", "diesel", "SP95-E10", "e10", "sp 98", "GPL"… → a fuel id (Gazole by default). */
export function parseFuel(input: unknown): FuelId {
  const s = String(input ?? "").toLowerCase().replace(/[\s_-]+/g, "");
  if (/^(gazole|gasoil|diesel|b7|go)$/.test(s)) return "Gazole";
  if (/e10/.test(s)) return "E10";
  if (/98/.test(s)) return "SP98";
  if (/^(sp)?95(e5)?$/.test(s)) return "SP95";
  if (/e85|ethanol|éthanol/.test(s)) return "E85";
  if (/gpl|lpg/.test(s)) return "GPLc";
  return "Gazole";
}

export const fuelOf = (id: FuelId) => FUELS.find((f) => f.id === id)!;

export function clampRadius(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return 10;
  return Math.min(50, Math.max(1, Math.round(n)));
}

// ---------------------------------------------------------------------------
// Places

export interface Place {
  label: string;
  lat: number;
  lon: number;
  /** "municipality", "street", "housenumber", "postcode", "coordinates". */
  kind: string;
  postcode?: string;
}

/** "48.8566, 2.3522" or "48.8566 2.3522" → a place; anything else → undefined. */
export function parseCoordinates(input: string): Place | undefined {
  const m = /^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/.exec(input);
  if (!m) return undefined;
  const lat = Number(m[1].replace(",", ".")), lon = Number(m[2].replace(",", "."));
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined;
  return { label: `${lat.toFixed(4)}, ${lon.toFixed(4)}`, lat, lon, kind: "coordinates" };
}

export const isPostcode = (input: string) => /^\s*\d{5}\s*$/.test(input) || /^\s*2[ab]\d{3}\s*$/i.test(input);

export function addressSearchUrl(query: string, limit = 5): string {
  const p = new URLSearchParams({ q: query.trim(), limit: String(limit), autocomplete: "0" });
  return `https://api-adresse.data.gouv.fr/search/?${p}`;
}

export function communesByPostcodeUrl(postcode: string): string {
  const p = new URLSearchParams({ codePostal: postcode.trim(), fields: "nom,centre,codesPostaux,population" });
  return `https://geo.api.gouv.fr/communes?${p}`;
}

export interface AddressFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { label?: string; type?: string; postcode?: string; city?: string; score?: number };
}

/** The Base Adresse Nationale's answer as places. */
export function placesFromAddresses(json: { features?: AddressFeature[] } | undefined): Place[] {
  return (json?.features ?? []).flatMap((f) => {
    const [lon, lat] = f.geometry?.coordinates ?? [];
    if (typeof lat !== "number" || typeof lon !== "number" || !f.properties?.label) return [];
    return [{
      label: f.properties.label,
      lat,
      lon,
      kind: f.properties.type ?? "address",
      postcode: f.properties.postcode,
    }];
  });
}

export interface Commune {
  nom?: string;
  centre?: { coordinates?: [number, number] };
  codesPostaux?: string[];
  population?: number;
}

/** The towns of a postcode (geo.api.gouv.fr), the most populated first. */
export function placesFromCommunes(list: Commune[] | undefined, postcode: string): Place[] {
  return [...(list ?? [])]
    .sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    .flatMap((c) => {
      const [lon, lat] = c.centre?.coordinates ?? [];
      if (typeof lat !== "number" || typeof lon !== "number" || !c.nom) return [];
      return [{ label: `${c.nom} (${postcode.trim()})`, lat, lon, kind: "municipality", postcode: postcode.trim() }];
    });
}

/** Great-circle distance in kilometres. */
export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => d * Math.PI / 180;
  const dLat = rad(b.lat - a.lat), dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(10, Math.round(km * 100) * 10)} m`;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

// ---------------------------------------------------------------------------
// The query

/** The records around a point that sell `fuel`, cheapest first (the API returns at most 100). */
export function stationsUrl(place: { lat: number; lon: number }, fuel: FuelId, radiusKm: number, limit = 100): string {
  const col = fuelOf(fuel).column;
  const point = `geom'POINT(${place.lon.toFixed(6)} ${place.lat.toFixed(6)})'`;
  const p = new URLSearchParams({
    where: `within_distance(geom, ${point}, ${clampRadius(radiusKm)}km) AND ${col}_prix IS NOT NULL`,
    order_by: `${col}_prix ASC`,
    limit: String(Math.min(100, limit)),
  });
  return `${RECORDS_URL}?${p}`;
}

/** Given stations by id, for favourites. */
export function stationsByIdUrl(ids: string[]): string {
  const clean = ids.filter((id) => /^\d+$/.test(id)).slice(0, 100);
  const p = new URLSearchParams({ where: `id IN (${clean.join(", ")})`, limit: String(Math.max(1, clean.length)) });
  return `${RECORDS_URL}?${p}`;
}

// ---------------------------------------------------------------------------
// Stations

/** A record of the dataset, as the API returns it (JSON-in-strings included). */
export interface FuelRecord {
  id?: number | string;
  adresse?: string;
  ville?: string;
  cp?: string;
  pop?: string;
  latitude?: string | number;
  longitude?: string | number;
  geom?: { lat?: number; lon?: number } | null;
  prix?: string | null;
  horaires?: string | null;
  services?: string | null;
  services_service?: string[] | string | null;
  rupture?: string | null;
  carburants_indisponibles?: string[] | string | null;
  horaires_automate_24_24?: string | null;
  departement?: string;
  [key: string]: unknown;
}

export interface Price {
  fuel: FuelId;
  price: number;
  updated?: number;
}

export interface Interval {
  open: string;
  close: string;
}

export interface Day {
  /** 1 = Monday … 7 = Sunday. */
  day: number;
  closed: boolean;
  intervals: Interval[];
}

export interface Station {
  id: string;
  address: string;
  city: string;
  postcode: string;
  lat: number;
  lon: number;
  /** On a motorway ("A") or on the road ("R"). */
  motorway: boolean;
  prices: Price[];
  services: string[];
  /** Fuels out of stock right now. */
  shortages: string[];
  automat24: boolean;
  days: Day[];
}

function parseJson<T>(input: unknown): T | undefined {
  if (input && typeof input === "object") return input as T;
  if (typeof input !== "string" || !input.trim()) return undefined;
  try {
    return JSON.parse(input) as T;
  } catch {
    return undefined;
  }
}

const asArray = <T>(v: T | T[] | undefined | null): T[] => v == null ? [] : Array.isArray(v) ? v : [v];

/** Prices are euros per litre (1.789); the old feed used thousandths (1789). */
export function normalizePrice(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n > 20 ? n / 1000 : n;
}

/** "2024-05-12 09:23:00" (French time in the feed's own strings) or ISO → epoch ms. */
export function parseDate(value: unknown): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const s = value.trim();
  const iso = /[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(" ", "T")}${frenchOffset(s)}`;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

/** Paris' UTC offset on a date: +02:00 from the last Sunday of March to the last Sunday of October. */
function frenchOffset(s: string): string {
  const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s);
  if (!m) return "+01:00";
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const lastSunday = (month: number) => {
    const last = new Date(Date.UTC(y, month, 0));
    return last.getUTCDate() - last.getUTCDay();
  };
  const summer = (mo > 3 && mo < 10) || (mo === 3 && d >= lastSunday(3)) || (mo === 10 && d < lastSunday(10));
  return summer ? "+02:00" : "+01:00";
}

/** "07.00" or "07:00" → "07:00". */
export function hhmm(value: unknown): string {
  const m = /^(\d{1,2})[.:h](\d{2})/.exec(String(value ?? "").trim());
  return m ? `${m[1].padStart(2, "0")}:${m[2]}` : "";
}

interface RawDay {
  "@id"?: string;
  "@ferme"?: string;
  horaire?: { "@ouverture"?: string; "@fermeture"?: string } | { "@ouverture"?: string; "@fermeture"?: string }[];
}

export function parseHours(raw: unknown): { automat24: boolean; days: Day[] } {
  const h = parseJson<{ "@automate-24-24"?: string; jour?: RawDay | RawDay[] }>(raw);
  const days = asArray(h?.jour).flatMap((j) => {
    const day = Number(j["@id"]);
    if (!(day >= 1 && day <= 7)) return [];
    const intervals = asArray(j.horaire)
      .map((i) => ({ open: hhmm(i["@ouverture"]), close: hhmm(i["@fermeture"]) }))
      .filter((i) => i.open && i.close);
    return [{ day, closed: j["@ferme"] === "1", intervals }];
  }).sort((a, b) => a.day - b.day);
  return { automat24: h?.["@automate-24-24"] === "1", days };
}

export function parsePrices(raw: unknown, record: FuelRecord = {}): Price[] {
  const out = new Map<FuelId, Price>();
  for (const p of asArray(parseJson<Record<string, string> | Record<string, string>[]>(raw))) {
    const fuel = FUELS.find((f) => f.feed.toLowerCase() === String(p["@nom"] ?? "").toLowerCase());
    const price = normalizePrice(p["@valeur"]);
    if (fuel && price) out.set(fuel.id, { fuel: fuel.id, price, updated: parseDate(p["@maj"]) });
  }
  // The flat columns (gazole_prix, e10_maj…) when `prix` is missing.
  for (const f of FUELS) {
    if (out.has(f.id)) continue;
    const price = normalizePrice(record[`${f.column}_prix`]);
    if (price) out.set(f.id, { fuel: f.id, price, updated: parseDate(record[`${f.column}_maj`]) });
  }
  return FUELS.flatMap((f) => out.get(f.id) ?? []);
}

/** "Boutique alimentaire", "Lavage automatique"… */
export function parseServices(record: FuelRecord): string[] {
  const flat = asArray(record.services_service).flatMap((s) => String(s).split(/\s*\/\/\s*|\s*;\s*/));
  const nested = asArray(parseJson<{ service?: string | string[] }>(record.services)?.service);
  return [...new Set([...flat, ...nested].map((s) => String(s).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
}

export function parseShortages(record: FuelRecord): string[] {
  const names = asArray(parseJson<{ "@nom"?: string } | { "@nom"?: string }[]>(record.rupture))
    .map((r) => String(r["@nom"] ?? ""));
  const unavailable = asArray(record.carburants_indisponibles).flatMap((s) => String(s).split(/\s*;\s*/));
  return [...new Set([...names, ...unavailable].map((n) => fuelTitle(n)).filter(Boolean))];
}

/** Feed name → display name: "E10" → "SP95-E10". */
export function fuelTitle(name: string): string {
  const f = FUELS.find((x) => x.feed.toLowerCase() === name.trim().toLowerCase());
  return f ? f.title : name.trim();
}

/** "1 RUE DE LA PAIX" → "1 Rue de la Paix". */
export function titleCase(s: string): string {
  const small = new Set(["de", "du", "des", "la", "le", "les", "et", "d", "l", "à", "au", "aux", "en", "sur"]);
  const raw = s.trim().replace(/\s+/g, " ");
  if (raw !== raw.toUpperCase()) return raw;
  return raw.toLowerCase().replace(/[\p{L}]+/gu, (w, i) => i > 0 && small.has(w) ? w : w[0].toUpperCase() + w.slice(1))
    .replace(/\b([dl])'(\p{L})/gu, (_, a, b) => `${a}'${b.toUpperCase()}`);
}

export function toStation(r: FuelRecord): Station | undefined {
  const lat = r.geom?.lat ?? coordinate(r.latitude), lon = r.geom?.lon ?? coordinate(r.longitude);
  if (r.id === undefined || lat === undefined || lon === undefined) return undefined;
  const hours = parseHours(r.horaires);
  return {
    id: String(r.id),
    address: titleCase(String(r.adresse ?? "")),
    city: titleCase(String(r.ville ?? "")),
    postcode: String(r.cp ?? ""),
    lat,
    lon,
    motorway: r.pop === "A",
    prices: parsePrices(r.prix, r),
    services: parseServices(r),
    shortages: parseShortages(r),
    automat24: hours.automat24 || /^oui$/i.test(String(r.horaires_automate_24_24 ?? "")),
    days: hours.days,
  };
}

/** The feed gives degrees × 100000 ("4876543"); some exports give degrees. */
function coordinate(value: unknown): number | undefined {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return undefined;
  return Math.abs(n) > 180 ? n / 100000 : n;
}

export const priceOf = (s: Station, fuel: FuelId) => s.prices.find((p) => p.fuel === fuel);

/** A station with the numbers of one search: its distance and the price of the chosen fuel. */
export interface Row {
  station: Station;
  distance: number;
  price?: Price;
  stale: boolean;
}

/** Older than this, a price is shown greyed and sorted after the fresh ones. */
export const STALE_MS = 7 * 24 * 3600_000;

export function rows(
  stations: Station[],
  from: { lat: number; lon: number },
  fuel: FuelId,
  o: { sort?: string; radius?: number; now?: number } = {},
): Row[] {
  const now = o.now ?? Date.now();
  const list = stations.map((station) => {
    const price = priceOf(station, fuel);
    return {
      station,
      distance: distanceKm(from, station),
      price,
      stale: !price?.updated || now - price.updated > STALE_MS,
    };
  }).filter((r) => r.price && (o.radius === undefined || r.distance <= o.radius + 0.5));
  const byDistance = o.sort === "distance";
  return list.sort((a, b) =>
    Number(a.stale) - Number(b.stale) ||
    (byDistance ? a.distance - b.distance : a.price!.price - b.price!.price || a.distance - b.distance)
  );
}

export interface Summary {
  count: number;
  min?: number;
  max?: number;
  average?: number;
}

export function summarize(list: Row[]): Summary {
  const prices = list.filter((r) => !r.stale).map((r) => r.price!.price);
  if (!prices.length) return { count: list.length };
  return {
    count: list.length,
    min: Math.min(...prices),
    max: Math.max(...prices),
    average: prices.reduce((a, b) => a + b, 0) / prices.length,
  };
}

/** 1.789 → "1.789 €". */
export const euros = (n: number) => `${n.toFixed(3)} €`;

/** How long ago a price was set: "12 min", "3 h", "2 d". */
export function age(ts: number | undefined, now = Date.now()): string {
  if (!ts) return "unknown";
  const m = Math.max(0, Math.floor((now - ts) / 60_000));
  if (m < 60) return `${m} min`;
  if (m < 48 * 60) return `${Math.floor(m / 60)} h`;
  return `${Math.floor(m / 1440)} d`;
}

// ---------------------------------------------------------------------------
// Opening hours

export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** Monday = 1 … Sunday = 7. */
export const isoDay = (d: Date) => ((d.getDay() + 6) % 7) + 1;

const minutes = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));

export interface OpenState {
  open: boolean | undefined;
  text: string;
}

/** Open now? With the 24/24 automat, the shop hours, or nothing known. */
export function openState(s: Pick<Station, "automat24" | "days">, now = new Date()): OpenState {
  const today = s.days.find((d) => d.day === isoDay(now));
  const t = now.getHours() * 60 + now.getMinutes();
  if (today && !today.closed && today.intervals.length) {
    for (const i of today.intervals) {
      const [o, c] = [minutes(i.open), minutes(i.close)];
      // "00:00–00:00" or "00:00–23:59" is the whole day.
      if ((o === c) || (o === 0 && c >= 23 * 60 + 59)) return { open: true, text: "Open 24 hours" };
      if (t >= o && t < c) return { open: true, text: `Open until ${i.close}` };
    }
    const next = today.intervals.find((i) => minutes(i.open) > t);
    if (s.automat24) return { open: true, text: next ? `24/7 pumps · shop opens ${next.open}` : "24/7 pumps" };
    return { open: false, text: next ? `Closed · opens ${next.open}` : "Closed for today" };
  }
  if (s.automat24) return { open: true, text: "24/7 pumps" };
  if (today?.closed) return { open: false, text: "Closed today" };
  return { open: undefined, text: "Hours unknown" };
}

/** "Monday: 07:00–19:00", one line per day the feed knows. */
export function weekHours(days: Day[]): string[] {
  return days.map((d) => {
    const name = DAY_NAMES[d.day - 1];
    if (d.closed) return `${name}: closed`;
    if (!d.intervals.length) return `${name}: —`;
    return `${name}: ${d.intervals.map((i) => `${i.open}–${i.close}`).join(", ")}`;
  });
}

// ---------------------------------------------------------------------------
// Links

export function mapsUrl(s: Pick<Station, "lat" | "lon" | "address" | "city">, app = "openstreetmap"): string {
  const ll = `${s.lat.toFixed(6)},${s.lon.toFixed(6)}`;
  switch (app.trim().toLowerCase()) {
    case "google":
      return `https://www.google.com/maps/dir/?api=1&destination=${ll}`;
    case "apple":
      return `https://maps.apple.com/?daddr=${ll}&q=${encodeURIComponent(`${s.address}, ${s.city}`)}`;
    case "geo":
      return `geo:${ll}?q=${ll}`;
    default:
      return `https://www.openstreetmap.org/?mlat=${s.lat.toFixed(6)}&mlon=${s.lon.toFixed(6)}#map=17/${
        s.lat.toFixed(5)
      }/${s.lon.toFixed(5)}`;
  }
}

export function fullAddress(s: Pick<Station, "address" | "postcode" | "city">): string {
  return [s.address, [s.postcode, s.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

/** An Opendatasoft error as a sentence. */
export function apiError(status: number, body: { message?: string; error_code?: string } | undefined): string {
  if (status === 429) return "The fuel price API is rate limiting: try again in a minute";
  if (status >= 500) return `The fuel price API is down (${status}): try again later`;
  return `The fuel price API answered ${status}${body?.message ? `: ${body.message}` : ""}`;
}
