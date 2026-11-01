// Postal codes: parsing what is typed, the two services' URLs and answers, and formatting.
// Zippopotam.us looks up a code; Open-Meteo's geocoding finds places by name with their codes.

/** Countries Zippopotam.us has postal codes for (https://api.zippopotam.us). */
export const ZIPPOPOTAM = new Set([
  "AD",
  "AR",
  "AS",
  "AT",
  "AU",
  "BD",
  "BE",
  "BG",
  "BR",
  "CA",
  "CH",
  "CZ",
  "DE",
  "DK",
  "DO",
  "ES",
  "FI",
  "FO",
  "FR",
  "GB",
  "GF",
  "GG",
  "GL",
  "GP",
  "GT",
  "GU",
  "HR",
  "HU",
  "IM",
  "IN",
  "IS",
  "IT",
  "JE",
  "JP",
  "LI",
  "LK",
  "LT",
  "LU",
  "MC",
  "MD",
  "MH",
  "MK",
  "MP",
  "MQ",
  "MX",
  "MY",
  "NL",
  "NO",
  "NZ",
  "PH",
  "PK",
  "PL",
  "PM",
  "PR",
  "PT",
  "RE",
  "RU",
  "SE",
  "SI",
  "SJ",
  "SK",
  "SM",
  "TH",
  "TR",
  "US",
  "VA",
  "VI",
  "YT",
  "ZA",
]); // deno-fmt-ignore

/** Country names for the codes users type most, in English and French. */
const NAMES: Record<string, [string, string]> = {
  AD: ["Andorra", "Andorre"],
  AR: ["Argentina", "Argentine"],
  AT: ["Austria", "Autriche"],
  AU: ["Australia", "Australie"],
  BE: ["Belgium", "Belgique"],
  BR: ["Brazil", "Brésil"],
  CA: ["Canada", "Canada"],
  CH: ["Switzerland", "Suisse"],
  CZ: ["Czechia", "Tchéquie"],
  DE: ["Germany", "Allemagne"],
  DK: ["Denmark", "Danemark"],
  ES: ["Spain", "Espagne"],
  FI: ["Finland", "Finlande"],
  FR: ["France", "France"],
  GB: ["United Kingdom", "Royaume-Uni"],
  IE: ["Ireland", "Irlande"],
  IN: ["India", "Inde"],
  IT: ["Italy", "Italie"],
  JP: ["Japan", "Japon"],
  LU: ["Luxembourg", "Luxembourg"],
  MA: ["Morocco", "Maroc"],
  MC: ["Monaco", "Monaco"],
  MX: ["Mexico", "Mexique"],
  NL: ["Netherlands", "Pays-Bas"],
  NO: ["Norway", "Norvège"],
  NZ: ["New Zealand", "Nouvelle-Zélande"],
  PL: ["Poland", "Pologne"],
  PT: ["Portugal", "Portugal"],
  RU: ["Russia", "Russie"],
  SE: ["Sweden", "Suède"],
  TR: ["Turkey", "Turquie"],
  US: ["United States", "États-Unis"],
  ZA: ["South Africa", "Afrique du Sud"],
};

export const flag = (cc: string) =>
  /^[A-Z]{2}$/.test(cc) ? [...cc].map((ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65)).join("") : "";

export function countryName(cc: string, fallback?: string): string {
  return NAMES[cc]?.[0] ?? fallback ?? cc;
}

/** Lowercase without accents. */
export const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();

/** A country preference: "fr", "FR", "France" → "FR"; anything else → undefined. */
export function countryOf(value: unknown): string | undefined {
  const s = String(value ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const f = fold(s);
  for (const [cc, names] of Object.entries(NAMES)) if (names.some((n) => fold(n) === f)) return cc;
  return undefined;
}

export type Query =
  | { kind: "empty" }
  | { kind: "code"; country?: string; code: string }
  | { kind: "place"; country?: string; name: string };

const known = (cc: string) => ZIPPOPOTAM.has(cc) || cc in NAMES;

/**
 * `75011`, `us 90210`, `90210 us`, `de:10115`, `SW1A 1AA`, `Lyon`, `de Berlin`, `Springfield, us`.
 * A two-letter word first or last is a country only when it is a known code, so `Le Mans` and
 * `La Paz` stay places; after a place name it needs a comma (`Springfield, us`).
 */
export function parseQuery(input: string): Query {
  let text = input.trim().replace(/\s+/g, " ");
  if (!text) return { kind: "empty" };
  let country: string | undefined;
  const prefix = /^([A-Za-z]{2})(:\s*|\s+)(.+)$/.exec(text);
  const suffix = /^(.+?)(,\s*|\s+)([A-Za-z]{2})$/.exec(text);
  if (prefix && known(prefix[1].toUpperCase())) {
    country = prefix[1].toUpperCase();
    text = prefix[3];
  } else if (suffix && known(suffix[3].toUpperCase()) && (looksLikeCode(suffix[1]) || suffix[2].includes(","))) {
    country = suffix[3].toUpperCase();
    text = suffix[1];
  }
  return looksLikeCode(text)
    ? { kind: "code", country, code: text.toUpperCase() }
    : { kind: "place", country, name: text };
}

/** Has a digit, or is a British or Canadian code ("SW1A 1AA", "H2X 1Y4"). */
export function looksLikeCode(text: string): boolean {
  const t = text.trim();
  return /\d/.test(t) && /^[A-Za-z0-9 -]{2,10}$/.test(t);
}

/** Guess a country from the code's shape when none was typed and the default does not fit. */
export function guessCountry(code: string, fallback: string): string {
  const c = code.toUpperCase().replace(/\s+/g, " ");
  if (/^[A-Z]{1,2}\d[A-Z\d]?( \d[A-Z]{2})?$/.test(c) && /[A-Z]/.test(c)) return "GB";
  if (/^[A-Z]\d[A-Z]( ?\d[A-Z]\d)?$/.test(c)) return "CA";
  if (/^\d{4} ?[A-Z]{2}$/.test(c)) return "NL";
  if (/^\d{3}-\d{4}$/.test(c)) return "JP";
  if (/^\d{4}-\d{3}$/.test(c)) return "PT";
  if (/^\d{2}-\d{3}$/.test(c)) return "PL";
  if (/^\d{5}-\d{3}$/.test(c)) return "BR";
  return fallback;
}

/** The part of a code Zippopotam knows: the outward code in Britain, the first three characters in Canada. */
export function zippoCode(country: string, code: string): string {
  const c = code.toUpperCase().trim().replace(/\s+/g, " ");
  if (country === "GB" || country === "GG" || country === "JE" || country === "IM") return c.split(" ")[0];
  if (country === "CA") return c.replace(" ", "").slice(0, 3);
  if (country === "NL") return c.replace(/\s?[A-Z]{2}$/, "");
  if (country === "JP" && /^\d{7}$/.test(c)) return `${c.slice(0, 3)}-${c.slice(3)}`;
  if (country === "PT" && /^\d{7}$/.test(c)) return `${c.slice(0, 4)}-${c.slice(4)}`;
  return c;
}

export const zippoUrl = (country: string, code: string) =>
  `https://api.zippopotam.us/${country.toLowerCase()}/${encodeURIComponent(zippoCode(country, code))}`;

export const zippoPlaceUrl = (country: string, state: string, place: string) =>
  `https://api.zippopotam.us/${country.toLowerCase()}/${encodeURIComponent(state.toLowerCase())}/${
    encodeURIComponent(place.toLowerCase())
  }`;

export function geocodingUrl(name: string, country?: string, count = 20, language = "en"): string {
  const q = new URLSearchParams({ name, count: String(count), language, format: "json" });
  if (country) q.set("countryCode", country);
  return `https://geocoding-api.open-meteo.com/v1/search?${q}`;
}

// Answers

export interface ZippoPlace {
  "place name": string;
  longitude: string;
  latitude: string;
  state?: string;
  "state abbreviation"?: string;
  "post code"?: string;
}

/** `/{country}/{code}`, or `/{country}/{state}/{place}` (with the code on each place). */
export interface ZippoResponse {
  country?: string;
  "country abbreviation"?: string;
  "post code"?: string;
  state?: string;
  "state abbreviation"?: string;
  "place name"?: string;
  places?: ZippoPlace[];
}

export interface GeoResult {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country_code?: string;
  country?: string;
  admin1?: string;
  admin2?: string;
  population?: number;
  postcodes?: string[];
  feature_code?: string;
}

/** A place with one or more postal codes. */
export interface Place {
  id: string;
  name: string;
  country: string;
  countryName: string;
  state?: string;
  /** Zippopotam's state code, to ask for all the codes of a place. */
  stateCode?: string;
  county?: string;
  latitude: number;
  longitude: number;
  /** Ordinary codes, sorted. */
  codes: string[];
  /** French CEDEX and SP codes, for large organizations and the military. */
  cedex: string[];
  population?: number;
  feature?: string;
}

/** The places of one postal code. */
export function fromZippoCode(res: ZippoResponse): Place[] {
  const cc = res["country abbreviation"] ?? "";
  const code = res["post code"] ?? "";
  return (res.places ?? []).map((p, i) => ({
    id: `${cc}:${code}:${i}`,
    name: p["place name"],
    country: cc,
    countryName: countryName(cc, res.country),
    state: p.state || undefined,
    stateCode: p["state abbreviation"] || undefined,
    latitude: Number(p.latitude),
    longitude: Number(p.longitude),
    codes: [code],
    cedex: [],
  }));
}

/**
 * The codes of the places Zippopotam returns for a place name, which it matches as a substring
 * ("lyon" also returns Chazelles-sur-Lyon): only `name` itself and its districts ("Lyon 03",
 * "Berlin Kreuzberg", "Paris 11 Popincourt") are kept, French CEDEX codes apart.
 */
export function zippoCodesFor(res: ZippoResponse, name: string): { codes: string[]; cedex: string[] } {
  const target = fold(name);
  const all = (res.places ?? [])
    .filter((p) => {
      const n = fold(p["place name"]);
      return n === target || n.startsWith(`${target} `);
    })
    .map((p) => p["post code"] ?? "")
    .filter(Boolean);
  return {
    codes: sortCodes(all.filter((c) => !isSpecial(c))),
    cedex: sortCodes(all.filter((c) => isSpecial(c))),
  };
}

/** Brazil's codes are known only by area at Zippopotam: "01001-000" → "01000-000". */
export function areaCode(country: string, code: string): string | undefined {
  if (country === "BR" && /^\d{5}-?\d{3}$/.test(code)) return `${code.slice(0, 4)}0-000`;
  return undefined;
}

const isPopulated = (r: GeoResult) => (r.feature_code ?? "").startsWith("PPL");

/** Open-Meteo's places, populated places with codes first, in its order (by size) otherwise. */
export function fromGeocoding(results: GeoResult[]): Place[] {
  const places = results
    .filter((r) => isPopulated(r) || (r.postcodes?.length ?? 0) > 0)
    .map((r): Place => {
      const all = r.postcodes ?? [];
      return {
        id: `geo:${r.id}`,
        name: r.name,
        country: r.country_code ?? "",
        countryName: countryName(r.country_code ?? "", r.country),
        state: r.admin1,
        county: r.admin2,
        latitude: r.latitude,
        longitude: r.longitude,
        codes: sortCodes(all.filter((c) => !isSpecial(c))),
        cedex: sortCodes(all.filter((c) => isSpecial(c))),
        population: r.population,
        feature: r.feature_code,
      };
    });
  const rank = (p: Place) => (p.codes.length ? 0 : p.cedex.length ? 1 : 2);
  return places.map((p, i) => [p, i] as const).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([p]) => p);
}

/** Open-Meteo places that have this code (a search by code also matches names and other countries). */
export function withCode(places: Place[], code: string, country?: string): Place[] {
  const c = code.toUpperCase().replace(/\s+/g, "");
  return places.filter((p) =>
    (!country || p.country === country) &&
    [...p.codes, ...p.cedex].some((x) => x.toUpperCase().replace(/\s+/g, "").startsWith(c))
  ).map((p) => ({ ...p, codes: [code.toUpperCase()], cedex: [] }));
}

/** French codes for large organizations (CEDEX) and the military postal service (SP). */
export const isSpecial = (code: string) => /\b(CEDEX|SP)\b/i.test(code);

/** Numbers in order ("75002" before "75010"), letters too. */
export function sortCodes(codes: string[]): string[] {
  return [...new Set(codes)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
}

/** "69001", "69001 – 69009 (10 codes)" */
export function codesText(p: Place): string {
  if (!p.codes.length) {
    return p.cedex.length ? `${p.cedex.length} special code${p.cedex.length === 1 ? "" : "s"}` : "No code known";
  }
  if (p.codes.length === 1) return p.codes[0];
  return `${p.codes[0]} – ${p.codes[p.codes.length - 1]} (${p.codes.length} codes)`;
}

export function placeLine(p: Place): string {
  return [p.state, p.countryName].filter(Boolean).filter((x, i, a) => a.indexOf(x) === i).join(", ");
}

/** "75011 Paris 11 Popincourt, France", what goes on an envelope. */
export function addressLine(p: Place, code = p.codes[0]): string {
  return `${code ? `${code} ` : ""}${p.name}, ${p.countryName}`;
}

export const mapUrl = (p: Place) =>
  `https://www.openstreetmap.org/?mlat=${p.latitude}&mlon=${p.longitude}#map=13/${p.latitude}/${p.longitude}`;

export const coordinates = (p: Place) => `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`;

/** Same place in both services, close enough to merge. */
export function samePlace(a: Place, b: Place): boolean {
  return a.country === b.country && fold(a.name) === fold(b.name) &&
    Math.abs(a.latitude - b.latitude) < 0.3 && Math.abs(a.longitude - b.longitude) < 0.3;
}
