/** An English and a French label. */
export interface Named {
  en: string;
  fr: string;
}

export interface Country {
  /** ISO 3166-1 alpha-2, e.g. "FR". */
  a2: string;
  /** ISO 3166-1 alpha-3, e.g. "FRA"; empty when it has none. */
  a3: string;
  name: Named;
  capitals: Named[];
  population?: number;
  /** The year of the population figure, when known. */
  populationYear?: number;
  /** In km². */
  area?: number;
  continents: Named[];
  languages: Named[];
  currencies: { code: string; name: string }[];
  /** "+33" */
  calling: string[];
  /** ".fr" */
  tld: string[];
  drive?: "left" | "right";
  /** "UTC+01:00", sorted west to east. */
  zones: string[];
  /** Alpha-2 codes of the neighbors. */
  borders: string[];
  demonym?: { en?: string; fr?: string };
  lat?: number;
  lon?: number;
}

export type Lang = "en" | "fr";

export function langOf(pref: unknown): Lang {
  return pref === "fr" ? "fr" : "en";
}

/** "fr" → 🇫🇷, from the two regional indicator letters. */
export function flag(a2: string): string {
  if (!/^[A-Za-z]{2}$/.test(a2)) return "🏳️";
  return [...a2.toUpperCase()].map((ch) => String.fromCodePoint(0x1f1e6 + ch.charCodeAt(0) - 65)).join("");
}

/** Lowercase without accents: "États-Unis" → "etats-unis". */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

export const label = (n: Named, lang: Lang) => n[lang] || n.en;

export const nameOf = (c: Country, lang: Lang) => label(c.name, lang);

/** People per km², or undefined without both figures. */
export function density(c: Country): number | undefined {
  if (!c.population || !c.area) return undefined;
  return c.population / c.area;
}

const KM2_PER_MI2 = 2.589988110336;

/** 68605616 → "68.6 million"; 9752 → "9,752". */
export function people(n: number, lang: Lang = "en"): string {
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  if (n < 1e6) return new Intl.NumberFormat(locale).format(n);
  const [value, unit] = n >= 1e9
    ? [n / 1e9, lang === "fr" ? "milliards" : "billion"]
    : [n / 1e6, lang === "fr" ? "millions" : "million"];
  const digits = value >= 100 ? 0 : 1;
  const text = new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(value);
  // "1 milliard" but "1,4 milliard": French uses the singular below 2.
  return `${text} ${lang === "fr" && value < 2 ? unit.slice(0, -1) : unit}`;
}

/** 643801 → "643,801 km² (248,573 mi²)" */
export function areaText(km2: number, lang: Lang = "en"): string {
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  const digits = km2 < 10 ? 2 : km2 < 1000 ? 1 : 0;
  const f = (v: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(v);
  return `${f(km2)} km² (${f(km2 / KM2_PER_MI2)} mi²)`;
}

export function densityText(c: Country, lang: Lang = "en"): string | undefined {
  const d = density(c);
  if (d === undefined) return undefined;
  const locale = lang === "fr" ? "fr-FR" : "en-US";
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: d < 10 ? 1 : 0 }).format(d)} /km²`;
}

/** "Côté droit" / "Right" */
export function driveText(c: Country, lang: Lang): string | undefined {
  if (!c.drive) return undefined;
  if (lang === "fr") return c.drive === "right" ? "à droite" : "à gauche";
  return c.drive === "right" ? "Right" : "Left";
}

export const CONTINENTS: { value: string; en: string; fr: string }[] = [
  { value: "africa", en: "Africa", fr: "Afrique" },
  { value: "asia", en: "Asia", fr: "Asie" },
  { value: "europe", en: "Europe", fr: "Europe" },
  { value: "north-america", en: "North America", fr: "Amérique du Nord" },
  { value: "south-america", en: "South America", fr: "Amérique du Sud" },
  { value: "oceania", en: "Oceania", fr: "Océanie" },
  { value: "antarctica", en: "Antarctica", fr: "Antarctique" },
];

/** Wikidata's continent labels, mapped to the filter values ("Australian continent" is Oceania). */
export function continentValues(c: Country): string[] {
  const out = new Set<string>();
  for (const n of c.continents) {
    const en = fold(n.en);
    if (en.includes("africa")) out.add("africa");
    else if (en.includes("asia")) out.add("asia");
    else if (en.includes("europe")) out.add("europe");
    else if (en.includes("north america") || en.includes("central america") || en.includes("caribbean")) {
      out.add("north-america");
    } else if (en.includes("south america")) out.add("south-america");
    else if (en.includes("oceania") || en.includes("australia") || en.includes("insular")) out.add("oceania");
    else if (en.includes("antarctica")) out.add("antarctica");
  }
  return [...out];
}

/** Words that find a country: both names, codes, capitals, currencies, calling codes, domains, languages. */
export function keywords(c: Country): string[] {
  const words = [
    c.name.en,
    c.name.fr,
    fold(c.name.en),
    fold(c.name.fr),
    c.a2,
    c.a3,
    ...c.capitals.flatMap((x) => [x.en, x.fr]),
    ...c.currencies.flatMap((x) => [x.code, x.name]),
    ...c.calling,
    ...c.calling.map((x) => x.replace("+", "")),
    ...c.tld,
    ...c.languages.flatMap((x) => [x.en, x.fr]),
    ...(c.demonym ? [c.demonym.en ?? "", c.demonym.fr ?? ""] : []),
  ];
  return [...new Set(words.filter(Boolean))];
}

/**
 * Countries matching a typed query, best first: an exact code, calling code or domain, then a name
 * that starts with the query, then any other match.
 */
export function search(countries: Country[], query: string): Country[] {
  const q = fold(query);
  if (!q) return countries;
  const scored: [number, Country][] = [];
  for (const c of countries) {
    const names = [c.name.en, c.name.fr].map(fold);
    let score = 0;
    if (q === c.a2.toLowerCase() || q === c.a3.toLowerCase()) score = 100;
    else if (c.calling.some((x) => x === q || x === `+${q}`)) score = 90;
    else if (c.tld.some((x) => x === q || x === `.${q}`)) score = 90;
    else if (names.some((n) => n === q)) score = 95;
    else if (names.some((n) => n.startsWith(q))) score = 80;
    else if (names.some((n) => n.split(/[\s-]/).some((w) => w.startsWith(q)))) score = 70;
    else if (c.capitals.some((x) => [x.en, x.fr].map(fold).some((n) => n.startsWith(q)))) score = 60;
    else if (c.currencies.some((x) => x.code.toLowerCase() === q)) score = 55;
    else if (q.startsWith("+") && c.calling.some((x) => x.replaceAll(" ", "").startsWith(q.replaceAll(" ", "")))) {
      score = 50;
    } else if (q.length >= 3 && keywords(c).some((k) => fold(k).includes(q))) score = 30;
    if (score) scored.push([score, c]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].name.en.localeCompare(b[1].name.en)).map(([, c]) => c);
}

export function byCode(countries: Country[]): Map<string, Country> {
  return new Map(countries.map((c) => [c.a2, c]));
}

export const wikipediaUrl = (c: Country, lang: Lang) =>
  `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(nameOf(c, lang).replaceAll(" ", "_"))}`;

export function mapUrl(c: Country): string | undefined {
  if (c.lat === undefined || c.lon === undefined) return undefined;
  return `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=5/${c.lat}/${c.lon}`;
}

const T = {
  en: {
    capital: "Capital",
    capitals: "Capitals",
    population: "Population",
    area: "Area",
    density: "Density",
    continent: "Continent",
    languages: "Official languages",
    currencies: "Currencies",
    calling: "Calling code",
    tld: "Internet domain",
    drive: "Driving side",
    zones: "UTC offsets",
    borders: "Neighbors (land and sea)",
    demonym: "Demonym",
    codes: "ISO codes",
    none: "None",
    island: "None listed",
  },
  fr: {
    capital: "Capitale",
    capitals: "Capitales",
    population: "Population",
    area: "Superficie",
    density: "Densité",
    continent: "Continent",
    languages: "Langues officielles",
    currencies: "Monnaies",
    calling: "Indicatif",
    tld: "Domaine internet",
    drive: "Conduite",
    zones: "Décalages UTC",
    borders: "Voisins (terre et mer)",
    demonym: "Gentilé",
    codes: "Codes ISO",
    none: "Aucune",
    island: "Aucun",
  },
};

export const words = (lang: Lang) => T[lang];

/** One line per fact, for the clipboard. */
export function summary(c: Country, all: Map<string, Country>, lang: Lang): string {
  const t = T[lang];
  const lines = [`${flag(c.a2)} ${nameOf(c, lang)} (${[c.a2, c.a3].filter(Boolean).join(" / ")})`];
  const add = (k: string, v: string | undefined) => v && lines.push(`${k}: ${v}`);
  add(c.capitals.length > 1 ? t.capitals : t.capital, c.capitals.map((x) => label(x, lang)).join(", "));
  add(t.population, c.population ? people(c.population, lang) : undefined);
  add(t.area, c.area ? areaText(c.area, lang) : undefined);
  add(t.languages, c.languages.map((x) => label(x, lang)).join(", "));
  add(t.currencies, c.currencies.map((x) => `${x.name} (${x.code})`).join(", "));
  add(t.calling, c.calling.join(", "));
  add(t.tld, c.tld.join(", "));
  add(t.drive, driveText(c, lang));
  add(t.zones, c.zones.join(", "));
  add(t.borders, c.borders.map((b) => all.get(b)).filter((x) => x).map((x) => nameOf(x!, lang)).join(", "));
  return lines.join("\n");
}
