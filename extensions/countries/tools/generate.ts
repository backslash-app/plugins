// Regenerates ../data.ts from Wikidata (CC0), the extension's only data source.
// Not used at runtime: the extension reads the bundled file and needs no network.
//
//   deno run --allow-net --allow-write extensions/countries/tools/generate.ts
//
// Every place with an ISO 3166-1 alpha-2 code that still exists is included.

import type { Country, Named } from "../lib.ts";

const ENDPOINT = "https://query.wikidata.org/sparql";
const UA = "Backslash-countries/1.0 (https://github.com/backslash-app/plugins)";

type Row = Record<string, string>;

async function sparql(query: string): Promise<Row[]> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`${ENDPOINT}?${new URLSearchParams({ query })}`, {
      headers: { Accept: "application/sparql-results+json", "User-Agent": UA },
    });
    if (res.ok) {
      const body = await res.json() as { results: { bindings: Record<string, { value: string }>[] } };
      return body.results.bindings.map((b) => Object.fromEntries(Object.entries(b).map(([k, v]) => [k, v.value])));
    }
    console.error(`Wikidata answered ${res.status}, retrying`);
    await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
  }
  throw new Error("Wikidata is unavailable");
}

const COUNTRY = `?c wdt:P297 ?a2 . FILTER NOT EXISTS { ?c wdt:P576 ?end }`;

/** "a|b|a" → ["a", "b"] */
const split = (s: string | undefined) => [...new Set((s ?? "").split("|").map((x) => x.trim()).filter(Boolean))];

function group(rows: Row[]): Map<string, Row[]> {
  const map = new Map<string, Row[]>();
  for (const r of rows) map.set(r.a2, [...(map.get(r.a2) ?? []), r]);
  return map;
}

/** Pairs of English and French labels, deduplicated by English label. */
function named(rows: Row[] | undefined, en: string, fr: string): Named[] {
  const out = new Map<string, Named>();
  for (const r of rows ?? []) {
    if (!r[en] || /^Q\d+$/.test(r[en])) continue;
    if (!out.has(r[en])) out.set(r[en], { en: r[en], fr: r[fr] || r[en] });
  }
  return [...out.values()];
}

console.error("Countries…");
const base = await sparql(`
SELECT ?c ?a2 (SAMPLE(?a3_) AS ?a3) (SAMPLE(?en_) AS ?en) (SAMPLE(?fr_) AS ?fr)
  (MAX(?ar) AS ?area) (SAMPLE(?coord_) AS ?coord)
  (GROUP_CONCAT(DISTINCT ?call; separator="|") AS ?calls) (GROUP_CONCAT(DISTINCT ?tld; separator="|") AS ?tlds)
  (GROUP_CONCAT(DISTINCT STR(?drive); separator="|") AS ?drives) WHERE {
  ${COUNTRY}
  OPTIONAL { ?c wdt:P298 ?a3_ }
  OPTIONAL { ?c rdfs:label ?en_ FILTER(LANG(?en_) = "en") }
  OPTIONAL { ?c rdfs:label ?fr_ FILTER(LANG(?fr_) = "fr") }
  OPTIONAL { ?c p:P2046 ?ast . ?ast psn:P2046/wikibase:quantityAmount ?ar .
    ?ast wikibase:rank ?arank . FILTER(?arank != wikibase:DeprecatedRank) }
  OPTIONAL { ?c wdt:P474 ?call }
  OPTIONAL { ?c wdt:P1622 ?drive }
  OPTIONAL { ?c wdt:P625 ?coord_ }
  OPTIONAL { ?c wdt:P78 ?t . ?t rdfs:label ?tld FILTER(LANG(?tld) = "en") }
} GROUP BY ?c ?a2`);

console.error("Populations…");
const populations = group(
  await sparql(`
SELECT ?a2 ?pop ?when WHERE {
  ${COUNTRY}
  ?c p:P1082 ?st . ?st ps:P1082 ?pop .
  ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
  OPTIONAL { ?st pq:P585 ?when }
}`),
);

/** The most recent population figure, and its year. */
function population(rows: Row[] | undefined): { value?: number; year?: number } {
  const best = [...rows ?? []].sort((a, b) => (b.when ?? "").localeCompare(a.when ?? ""))[0];
  if (!best) return {};
  const year = Number(best.when?.slice(0, 4));
  return { value: Math.round(Number(best.pop)), year: Number.isFinite(year) && year > 1800 ? year : undefined };
}

console.error("Capitals…");
const capitals = group(
  await sparql(`
SELECT ?a2 ?en ?fr WHERE {
  ${COUNTRY}
  ?c p:P36 ?st . ?st ps:P36 ?cap . FILTER NOT EXISTS { ?st pq:P582 ?until }
  ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
  ?cap rdfs:label ?en FILTER(LANG(?en) = "en")
  OPTIONAL { ?cap rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
}`),
);

console.error("Continents…");
const continents = group(
  await sparql(`
SELECT ?a2 ?en ?fr WHERE {
  ${COUNTRY}
  ?c wdt:P30 ?x . ?x rdfs:label ?en FILTER(LANG(?en) = "en")
  OPTIONAL { ?x rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
}`),
);

console.error("Languages…");
const languages = group(
  await sparql(`
SELECT ?a2 ?en ?fr WHERE {
  ${COUNTRY}
  ?c wdt:P37 ?x . ?x rdfs:label ?en FILTER(LANG(?en) = "en")
  OPTIONAL { ?x rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
}`),
);

console.error("Currencies…");
const currencies = group(
  await sparql(`
SELECT ?a2 ?code ?en ?fr WHERE {
  ${COUNTRY}
  ?c p:P38 ?st . ?st ps:P38 ?x . FILTER NOT EXISTS { ?st pq:P582 ?until }
  ?st wikibase:rank ?rank . FILTER(?rank != wikibase:DeprecatedRank)
  ?x wdt:P498 ?code . FILTER NOT EXISTS { ?x wdt:P576 ?gone }
  ?x rdfs:label ?en FILTER(LANG(?en) = "en")
  OPTIONAL { ?x rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
}`),
);

console.error("Borders…");
const borders = group(
  await sparql(`
SELECT ?a2 ?b WHERE {
  ${COUNTRY}
  ?c wdt:P47 ?n . ?n wdt:P297 ?b . FILTER NOT EXISTS { ?n wdt:P576 ?end2 }
}`),
);

console.error("Demonyms…");
const demonyms = group(
  await sparql(`
SELECT ?a2 ?d WHERE {
  ${COUNTRY}
  ?c wdt:P1549 ?d . FILTER(LANG(?d) = "en")
}`),
);
const demonymsFr = group(
  await sparql(`
SELECT ?a2 ?d WHERE {
  ${COUNTRY}
  ?c wdt:P1549 ?d . FILTER(LANG(?d) = "fr")
}`),
);

console.error("Time zones…");
const zones = group(
  await sparql(`
SELECT ?a2 ?z ?off WHERE {
  ${COUNTRY}
  ?c wdt:P421 ?x . ?x rdfs:label ?z FILTER(LANG(?z) = "en")
  OPTIONAL { ?x wdt:P2907 ?off }
}`),
);

const RIGHT = "http://www.wikidata.org/entity/Q14565199";
const LEFT = "http://www.wikidata.org/entity/Q13196750";
// Japan and a few others point to a more specific "left-hand traffic" item.
const LEFT_ALT = "http://www.wikidata.org/entity/Q11920728";

/** "UTC+05:30" → "UTC+05:30"; other labels ("Central European Time") are dropped. */
function utc(label: string): string | undefined {
  const m = /^UTC\s*([+−-])\s*(\d{1,2})(?::(\d{2}))?$/.exec(label.replace("±", "+"));
  if (/^UTC(±00:00)?$/.test(label)) return "UTC";
  if (!m) return undefined;
  const sign = m[1] === "+" ? "+" : "−";
  return `UTC${sign}${m[2].padStart(2, "0")}:${m[3] ?? "00"}`;
}

/** 5.5 → "UTC+05:30" */
function offset(hours: number): string | undefined {
  if (!Number.isFinite(hours) || Math.abs(hours) > 14) return undefined;
  if (hours === 0) return "UTC";
  const m = Math.round(Math.abs(hours) * 60);
  return `UTC${hours > 0 ? "+" : "−"}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

const zoneOrder = (z: string) => {
  if (z === "UTC") return 0;
  const m = /UTC([+−])(\d{2}):(\d{2})/.exec(z)!;
  return (m[1] === "+" ? 1 : -1) * (Number(m[2]) * 60 + Number(m[3]));
};

// Exceptionally reserved codes for parts of other territories.
const RESERVED = new Set(["AC", "CP", "CQ", "DG", "EA", "EU", "EZ", "FX", "IC", "TA", "UK", "UN"]);
// Two items share a code (an island and its state): keep the one with the most data.
const score = (r: Row) => Object.keys(r).length + (r.a3 ? 5 : 0) + (populations.has(r.a2) ? 1 : 0);
const byCode = new Map<string, Row>();
for (const r of base) {
  if (!/^[A-Z]{2}$/.test(r.a2) || RESERVED.has(r.a2) || !r.en) continue;
  const other = byCode.get(r.a2);
  if (!other || score(r) > score(other)) byCode.set(r.a2, r);
}
// Units of account and currencies replaced long ago that Wikidata still lists.
const OBSOLETE = new Set(["CLF", "FRF", "LTT", "PLZ", "XAU", "XDR"]);

// Gaps in Wikidata at the time of writing, filled by hand.
const FIXES: Record<string, Partial<Country>> = {
  AG: { capitals: [{ en: "Saint John's", fr: "Saint John's" }], languages: [{ en: "English", fr: "anglais" }] },
  US: {
    languages: [{ en: "English", fr: "anglais" }],
    zones: ["UTC−10:00", "UTC−09:00", "UTC−08:00", "UTC−07:00", "UTC−06:00", "UTC−05:00"],
  },
  CN: { languages: [{ en: "Standard Chinese", fr: "chinois standard" }], zones: ["UTC+08:00"] },
  CA: { zones: ["UTC−08:00", "UTC−07:00", "UTC−06:00", "UTC−05:00", "UTC−04:00", "UTC−03:30"] },
  RU: {
    zones: [
      "UTC+02:00",
      "UTC+03:00",
      "UTC+04:00",
      "UTC+05:00",
      "UTC+06:00",
      "UTC+07:00",
      "UTC+08:00",
      "UTC+09:00",
      "UTC+10:00",
      "UTC+11:00",
      "UTC+12:00",
    ],
  },
  GG: { zones: ["UTC", "UTC+01:00"] },
  IE: { zones: ["UTC", "UTC+01:00"] },
  JE: { zones: ["UTC", "UTC+01:00"] },
  ZW: { currencies: [{ code: "ZWG", name: "Zimbabwe Gold" }, { code: "USD", name: "United States dollar" }] },
  GP: { languages: [{ en: "French", fr: "français" }] },
  MQ: { languages: [{ en: "French", fr: "français" }] },
  UY: { languages: [{ en: "Spanish", fr: "espagnol" }] },
  HK: { zones: ["UTC+08:00"] },
  MO: { zones: ["UTC+08:00"] },
  PE: { zones: ["UTC−05:00"] },
  KY: { zones: ["UTC−05:00"] },
  MS: { zones: ["UTC−04:00"] },
  CX: { zones: ["UTC+07:00"], calling: ["+61"] },
  AX: { calling: ["+358"], continents: [{ en: "Europe", fr: "Europe" }], demonym: { en: "Ålander", fr: "Ålandais" } },
  BN: { demonym: { en: "Bruneian", fr: "Brunéien" } },
  FO: { demonym: { en: "Faroese", fr: "Féroïen" }, currencies: [{ code: "DKK", name: "Danish krone" }] },
  IS: { demonym: { en: "Icelandic", fr: "Islandais" } },
  RE: { demonym: { en: "Réunionese", fr: "Réunionnais" } },
  SA: { demonym: { en: "Saudi", fr: "Saoudien" } },
  UA: { demonym: { en: "Ukrainian", fr: "Ukrainien" } },
};

const countries: Country[] = [];
const codes = new Set(byCode.keys());
for (const r of [...byCode.values()].sort((a, b) => a.a2.localeCompare(b.a2))) {
  const coord = /Point\(([-\d.e]+) ([-\d.e]+)\)/.exec(r.coord ?? "");
  const drives = split(r.drives);
  const fr = (demonymsFr.get(r.a2) ?? []).map((x) => x.d);
  const en = (demonyms.get(r.a2) ?? []).map((x) => x.d);
  countries.push({
    a2: r.a2,
    a3: r.a3 ?? "",
    name: { en: r.en, fr: r.fr || r.en },
    capitals: named(capitals.get(r.a2), "en", "fr"),
    population: population(populations.get(r.a2)).value,
    populationYear: population(populations.get(r.a2)).year,
    area: r.area ? Math.round(Number(r.area) / 1e6 * 10) / 10 : undefined,
    continents: named(continents.get(r.a2), "en", "fr"),
    languages: named(languages.get(r.a2), "en", "fr"),
    currencies: [
      ...new Map(
        (currencies.get(r.a2) ?? []).filter((x) => /^[A-Z]{3}$/.test(x.code) && !OBSOLETE.has(x.code))
          .map((x) => [x.code, { code: x.code, name: x.en }]),
      ).values(),
    ],
    calling: split(r.calls).map((c) => c.replace(/\s+/g, " ")).sort(),
    tld: split(r.tlds).filter((t) => /^\.[a-z]{2,}$/.test(t)).sort(),
    drive: drives.includes(RIGHT) ? "right" : drives.includes(LEFT) || drives.includes(LEFT_ALT) ? "left" : undefined,
    zones: [
      ...new Set(
        (zones.get(r.a2) ?? []).map((x) => x.off !== undefined ? offset(Number(x.off)) : utc(x.z)).filter((
          z,
        ): z is string => !!z),
      ),
    ]
      .sort((a, b) => zoneOrder(a) - zoneOrder(b)),
    borders: [...new Set((borders.get(r.a2) ?? []).map((x) => x.b))].filter((b) => b !== r.a2 && codes.has(b)).sort(),
    demonym: en[0] || fr[0] ? { en: en[0], fr: fr[0] } : undefined,
    lat: coord ? Math.round(Number(coord[2]) * 100) / 100 : undefined,
    lon: coord ? Math.round(Number(coord[1]) * 100) / 100 : undefined,
    ...FIXES[r.a2],
  });
}

const stamp = new Date().toISOString().slice(0, 10);
const out = [
  `// Generated by tools/generate.ts from Wikidata (CC0) on ${stamp}. Do not edit by hand.`,
  "",
  `import type { Country } from "./lib.ts";`,
  "",
  `export const UPDATED = "${stamp}";`,
  "",
  `export const COUNTRIES: Country[] = ${JSON.stringify(countries, null, 2)};`,
  "",
].join("\n");
await Deno.writeTextFile(new URL("../data.ts", import.meta.url), out);
console.error(`${countries.length} countries written`);
