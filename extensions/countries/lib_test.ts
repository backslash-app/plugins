import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { COUNTRIES, UPDATED } from "./data.ts";
import {
  areaText,
  byCode,
  continentValues,
  densityText,
  driveText,
  flag,
  fold,
  keywords,
  langOf,
  people,
  search,
  summary,
  wikipediaUrl,
} from "./lib.ts";
import { countryItem } from "./items.ts";

const ALL = byCode(COUNTRIES);
const get = (a2: string) => ALL.get(a2)!;
const first = (q: string) => search(COUNTRIES, q)[0]?.a2;

Deno.test("data: every ISO 3166-1 country once, plus Kosovo", () => {
  assertEquals(COUNTRIES.length, 250);
  assertEquals(new Set(COUNTRIES.map((c) => c.a2)).size, COUNTRIES.length);
  assertEquals(new Set(COUNTRIES.map((c) => c.a3)).size, COUNTRIES.length);
  for (const c of COUNTRIES) {
    assert(/^[A-Z]{2}$/.test(c.a2), c.a2);
    assert(/^[A-Z]{3}$/.test(c.a3), `${c.a2} ${c.a3}`);
    assert(c.name.en && c.name.fr, c.a2);
    for (const b of c.borders) assert(ALL.has(b), `${c.a2} borders unknown ${b}`);
    for (const z of c.zones) assert(/^UTC([+−]\d{2}:\d{2})?$/.test(z), `${c.a2} ${z}`);
    for (const x of c.currencies) assert(/^[A-Z]{3}$/.test(x.code), `${c.a2} ${x.code}`);
    for (const x of c.calling) assert(/^\+\d/.test(x), `${c.a2} ${x}`);
    for (const x of c.tld) assert(/^\.[a-z]{2,}$/.test(x), `${c.a2} ${x}`);
    if (c.population) assert(c.population > 0 && c.population < 2e9, c.a2);
  }
  // The reserved codes of parts of other territories are left out.
  for (const reserved of ["AC", "CP", "DG", "TA", "EU"]) assert(!ALL.has(reserved), reserved);
  assert(ALL.has("XK"));
  assert(/^\d{4}-\d{2}-\d{2}$/.test(UPDATED));
});

Deno.test("data: well-known facts", () => {
  const fr = get("FR");
  assertEquals([fr.a3, fr.name.fr, fr.capitals[0].en, fr.calling[0], fr.tld[0], fr.drive], [
    "FRA",
    "France",
    "Paris",
    "+33",
    ".fr",
    "right",
  ]);
  assert(fr.currencies.some((c) => c.code === "EUR"));
  assert(["BE", "CH", "DE", "ES", "IT"].every((b) => fr.borders.includes(b)));
  assertEquals(get("JP").name.fr, "Japon");
  assertEquals(get("JP").drive, "left");
  assertEquals(get("GB").drive, "left");
  assertEquals(get("IN").zones, ["UTC+05:30"]);
  assertEquals(get("NP").zones, ["UTC+05:45"]);
  assertEquals(get("DE").capitals[0].fr, "Berlin");
  assertEquals(get("US").name.fr, "États-Unis");
  assert(get("CH").languages.length === 4);
  assertEquals(get("BO").capitals.map((c) => c.en).sort(), ["La Paz", "Sucre"]);
  assert(get("RU").zones.length >= 10);
  // Neighbors are mostly mutual.
  assert(get("ES").borders.includes("FR") && get("ES").borders.includes("PT"));
  // Areas are in km².
  assert(Math.abs(get("FR").area! - 643_801) < 10_000);
  assert(Math.abs(get("JP").area! - 377_975) < 5_000);
});

Deno.test("flag emoji from the code", () => {
  assertEquals(flag("FR"), "🇫🇷");
  assertEquals(flag("jp"), "🇯🇵");
  assertEquals(flag("??"), "🏳️");
});

Deno.test("formatting", () => {
  assertEquals(people(68_605_616), "68.6 million");
  assertEquals(people(68_605_616, "fr"), "68,6 millions");
  assertEquals(people(1_426_000_000), "1.4 billion");
  assertEquals(people(1_426_000_000, "fr"), "1,4 milliard");
  assertEquals(people(214_211_951), "214 million");
  assertEquals(people(9_752), "9,752");
  assertEquals(people(9_752, "fr"), "9 752");
  assertEquals(areaText(643_801), "643,801 km² (248,573 mi²)");
  assertEquals(areaText(2.02), "2.02 km² (0.78 mi²)");
  assertEquals(densityText({ ...get("FR"), population: 1000, area: 10 }), "100 /km²");
  assertEquals(driveText(get("GB"), "en"), "Left");
  assertEquals(driveText(get("FR"), "fr"), "à droite");
  assertEquals(langOf("fr"), "fr");
  assertEquals(langOf(undefined), "en");
  assertEquals(fold("États-Unis "), "etats-unis");
});

Deno.test("search: names in both languages, codes, capitals, calling codes, domains, currencies", () => {
  assertEquals(first("france"), "FR");
  assertEquals(first("Allemagne"), "DE");
  assertEquals(first("allem"), "DE");
  assertEquals(first("etats-unis"), "US");
  assertEquals(first("Japon"), "JP");
  assertEquals(first("jp"), "JP");
  assertEquals(first("JPN"), "JP");
  assertEquals(first("+81"), "JP");
  assertEquals(first("81"), "JP");
  assertEquals(first(".de"), "DE");
  assertEquals(first("tokyo"), "JP");
  assertEquals(first("Londres"), "GB");
  assertEquals(search(COUNTRIES, "CHF").map((c) => c.a2).sort(), ["CH", "LI"]);
  assertEquals(first("zealand"), "NZ");
  assertEquals(search(COUNTRIES, "").length, COUNTRIES.length);
  assertEquals(search(COUNTRIES, "zzzzqq"), []);
  // "+1" is shared: every match comes back.
  assert(search(COUNTRIES, "+1").length > 5);
  assert(keywords(get("FR")).includes("Français"));
});

Deno.test("continents map to the filter chips", () => {
  assertEquals(continentValues(get("FR")), ["europe"]);
  assertEquals(continentValues(get("BR")), ["south-america"]);
  assertEquals(continentValues(get("AU")), ["oceania"]);
  assert(continentValues(get("TR")).includes("asia"));
  for (const c of COUNTRIES) assert(continentValues(c).length > 0, `${c.a2}: ${JSON.stringify(c.continents)}`);
});

Deno.test("summary, links and items", () => {
  const text = summary(get("FR"), ALL, "en");
  assert(text.startsWith("🇫🇷 France (FR / FRA)"));
  assert(text.includes("Capital: Paris"));
  assert(text.includes("Calling code: +33"));
  assert(text.includes("Neighbors (land and sea): Andorra, Belgium"));
  assert(summary(get("FR"), ALL, "fr").includes("Capitale : ") === false);
  assert(summary(get("DE"), ALL, "fr").includes("Capitale: Berlin"));
  assertEquals(wikipediaUrl(get("CI"), "en"), "https://en.wikipedia.org/wiki/Ivory_Coast");
  assertEquals(wikipediaUrl(get("US"), "fr"), "https://fr.wikipedia.org/wiki/%C3%89tats-Unis");
  const item = countryItem(get("FR"), ALL, "fr");
  assertEquals([item.id, item.title, item.subtitle, item.icon], ["FR", "France", "Paris", "🇫🇷"]);
  assert(item.actions!.some((a) => a.title.startsWith("Neighbors")));
  const lonely = COUNTRIES.find((c) => c.borders.length === 0)!;
  const island = countryItem(lonely, ALL, "en");
  assert(!island.actions!.some((a) => a.title.startsWith("Neighbors")));
});

Deno.test("manifest: no permissions", async () => {
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as Record<string, any>;
  assertEquals(m.extension.id, "countries");
  assertEquals(m.permissions, undefined);
  assertEquals(m.commands.map((c: { name: string }) => c.name), ["countries"]);
});
