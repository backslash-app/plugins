import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  addressLine,
  areaCode,
  codesText,
  countryOf,
  fromGeocoding,
  fromZippoCode,
  geocodingUrl,
  type GeoResult,
  guessCountry,
  isSpecial,
  looksLikeCode,
  mapUrl,
  parseQuery,
  placeLine,
  sortCodes,
  withCode,
  zippoCode,
  zippoCodesFor,
  zippoPlaceUrl,
  type ZippoResponse,
  zippoUrl,
} from "./lib.ts";
import { findPlaces, http, lookupCode } from "./api.ts";
import { placeItem } from "./items.ts";

const fixture = async <T>(name: string): Promise<T> =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url))) as T;
const geo = async (name: string) => (await fixture<{ results?: GeoResult[] }>(name)).results ?? [];

Deno.test("parseQuery: codes and places, with an optional country first or last", () => {
  assertEquals(parseQuery(""), { kind: "empty" });
  assertEquals(parseQuery("75011"), { kind: "code", country: undefined, code: "75011" });
  assertEquals(parseQuery("us 90210"), { kind: "code", country: "US", code: "90210" });
  assertEquals(parseQuery("90210 us"), { kind: "code", country: "US", code: "90210" });
  assertEquals(parseQuery("de:10115"), { kind: "code", country: "DE", code: "10115" });
  assertEquals(parseQuery("sw1a 1aa"), { kind: "code", country: undefined, code: "SW1A 1AA" });
  assertEquals(parseQuery("ca H2X 1Y4"), { kind: "code", country: "CA", code: "H2X 1Y4" });
  assertEquals(parseQuery("Lyon"), { kind: "place", country: undefined, name: "Lyon" });
  assertEquals(parseQuery("de Berlin"), { kind: "place", country: "DE", name: "Berlin" });
  assertEquals(parseQuery("Springfield, us"), { kind: "place", country: "US", name: "Springfield" });
  // Two-letter first words of place names that aren't country codes stay in the name.
  assertEquals(parseQuery("Le Mans"), { kind: "place", country: undefined, name: "Le Mans" });
  assertEquals(parseQuery("La Paz"), { kind: "place", country: undefined, name: "La Paz" });
  assertEquals(parseQuery("El Paso"), { kind: "place", country: undefined, name: "El Paso" });
  // A country after a place name needs a comma: "Paris tx" could be a name.
  assertEquals(parseQuery("Saint-Denis re").kind, "place");
  assertEquals((parseQuery("Saint-Denis re") as { country?: string }).country, undefined);
});

Deno.test("code shapes", () => {
  assert(looksLikeCode("75011"));
  assert(looksLikeCode("SW1A 1AA"));
  assert(looksLikeCode("100-0001"));
  assert(!looksLikeCode("Lyon"));
  assert(!looksLikeCode("1"));
  assertEquals(guessCountry("SW1A 1AA", "FR"), "GB");
  assertEquals(guessCountry("EC1A", "FR"), "GB");
  assertEquals(guessCountry("H2X 1Y4", "FR"), "CA");
  assertEquals(guessCountry("1012 AB", "FR"), "NL");
  assertEquals(guessCountry("100-0001", "FR"), "JP");
  assertEquals(guessCountry("1000-001", "FR"), "PT");
  assertEquals(guessCountry("00-950", "FR"), "PL");
  assertEquals(guessCountry("01001-000", "FR"), "BR");
  assertEquals(guessCountry("75011", "FR"), "FR");
  assertEquals(guessCountry("90210", "US"), "US");
  assertEquals(zippoCode("GB", "sw1a 1aa"), "SW1A");
  assertEquals(zippoCode("CA", "H2X 1Y4"), "H2X");
  assertEquals(zippoCode("NL", "1012 AB"), "1012");
  assertEquals(zippoCode("JP", "1000001"), "100-0001");
  assertEquals(zippoCode("FR", "75011"), "75011");
  assertEquals(areaCode("BR", "01001-000"), "01000-000");
  assertEquals(areaCode("FR", "75011"), undefined);
  assert(isSpecial("69998 CEDEX 07"));
  assert(isSpecial("75700 SP 07"));
  assert(!isSpecial("75011"));
  assertEquals(sortCodes(["75010", "75002", "75116", "75002"]), ["75002", "75010", "75116"]);
});

Deno.test("country preference", () => {
  assertEquals(countryOf("fr"), "FR");
  assertEquals(countryOf(" US "), "US");
  assertEquals(countryOf("Allemagne"), "DE");
  assertEquals(countryOf("Germany"), "DE");
  assertEquals(countryOf("nowhere"), undefined);
  assertEquals(countryOf(undefined), undefined);
});

Deno.test("URLs", () => {
  assertEquals(zippoUrl("FR", "75011"), "https://api.zippopotam.us/fr/75011");
  assertEquals(zippoUrl("GB", "SW1A 1AA"), "https://api.zippopotam.us/gb/SW1A");
  assertEquals(zippoPlaceUrl("US", "CA", "Beverly Hills"), "https://api.zippopotam.us/us/ca/beverly%20hills");
  const u = new URL(geocodingUrl("Lyon", "FR"));
  assertEquals(u.host, "geocoding-api.open-meteo.com");
  assertEquals(u.searchParams.get("name"), "Lyon");
  assertEquals(u.searchParams.get("countryCode"), "FR");
  assertEquals(new URL(geocodingUrl("Lyon")).searchParams.has("countryCode"), false);
});

Deno.test("Zippopotam: the places of a code", async () => {
  const [paris] = fromZippoCode(await fixture<ZippoResponse>("zippo-fr-75011.json"));
  assertEquals([paris.name, paris.country, paris.countryName, paris.codes], [
    "Paris 11 Popincourt",
    "FR",
    "France",
    ["75011"],
  ]);
  assertEquals(paris.state, "Île-de-France");
  assert(Math.abs(paris.latitude - 48.857) < 0.01);
  const [bh] = fromZippoCode(await fixture<ZippoResponse>("zippo-us-90210.json"));
  assertEquals([bh.name, bh.stateCode, bh.countryName], ["Beverly Hills", "CA", "United States"]);
  assertEquals(fromZippoCode(await fixture<ZippoResponse>("zippo-gb-SW1A.json"))[0].countryName, "United Kingdom");
  assertEquals(fromZippoCode(await fixture<ZippoResponse>("zippo-jp-100-0001.json"))[0].country, "JP");
  assertEquals(fromZippoCode({}), []);
});

Deno.test("Zippopotam: the codes of a place, without other places containing its name", async () => {
  const bh = zippoCodesFor(await fixture<ZippoResponse>("zippo-us-ca-beverly-hills.json"), "Beverly Hills");
  assert(bh.codes.includes("90210"));
  assertEquals(bh.cedex, []);
  const lyon: ZippoResponse = {
    places: [
      { "place name": "Lyon 03", "post code": "69003", latitude: "45.76", longitude: "4.85" },
      { "place name": "Lyon", "post code": "69998 CEDEX 07", latitude: "45.76", longitude: "4.85" },
      { "place name": "Chazelles-sur-Lyon", "post code": "42140", latitude: "45.63", longitude: "4.38" },
      { "place name": "Lyons-la-Forêt", "post code": "27480", latitude: "49.39", longitude: "1.47" },
      { "place name": "Lyon 01", "post code": "69001", latitude: "45.76", longitude: "4.83" },
    ],
  };
  assertEquals(zippoCodesFor(lyon, "Lyon"), { codes: ["69001", "69003"], cedex: ["69998 CEDEX 07"] });
});

Deno.test("Open-Meteo: places with their codes", async () => {
  const lyon = fromGeocoding(await geo("geo-lyon.json"));
  assertEquals(lyon[0].name, "Lyon");
  assertEquals(lyon[0].country, "FR");
  assert(lyon[0].codes.includes("69001"));
  assert(lyon[0].codes.every((c) => !isSpecial(c)));
  assert(lyon[0].cedex.every(isSpecial));
  assertEquals(codesText(lyon[0]), `${lyon[0].codes[0]} – ${lyon[0].codes.at(-1)} (${lyon[0].codes.length} codes)`);
  // Places without any code come last.
  const ranks = lyon.map((p) => p.codes.length ? 0 : p.cedex.length ? 1 : 2);
  assertEquals(ranks, [...ranks].sort());
  // A search by code also finds names and other countries: keep the places that have it.
  const paris = withCode(fromGeocoding(await geo("geo-75011.json")), "75011", "FR");
  assert(paris.length >= 1 && paris.every((p) => p.country === "FR" && p.codes[0] === "75011"));
  const anywhere = withCode(fromGeocoding(await geo("geo-75011.json")), "75011");
  assert(anywhere.some((p) => p.country === "US"));
  assertEquals(fromGeocoding(await geo("geo-nowhere.json")), []);
});

Deno.test("formatting and items", async () => {
  const [bh] = fromZippoCode(await fixture<ZippoResponse>("zippo-us-90210.json"));
  assertEquals(codesText(bh), "90210");
  assertEquals(codesText({ ...bh, codes: [] }), "No code known");
  assertEquals(codesText({ ...bh, codes: [], cedex: ["75700 SP 07"] }), "1 special code");
  assertEquals(placeLine(bh), "California, United States");
  assertEquals(addressLine(bh), "90210 Beverly Hills, United States");
  assert(mapUrl(bh).startsWith("https://www.openstreetmap.org/?mlat=34.09"));
  const item = placeItem(bh, "90210", "90210");
  assertEquals([item.title, item.icon], ["90210 Beverly Hills", "🇺🇸"]);
  assertEquals(item.actions![0].title, "Copy Postal Code");
  const lyon = fromGeocoding(await geo("geo-lyon.json"))[0];
  const many = placeItem(lyon, "Best match");
  assert(many.actions!.some((a) => a.title === "Show All Codes"));
  assert(many.detail!.markdown!.includes("69001"));
});

/** A fake network that answers from the fixtures, and records the URLs asked. */
function fake(routes: Record<string, string>): string[] {
  const asked: string[] = [];
  http.fetch = async (url: string) => {
    asked.push(url);
    const u = new URL(url);
    const key = u.host === "api.zippopotam.us" ? u.pathname : `geo:${u.searchParams.get("name")}`;
    const file = routes[decodeURIComponent(key)];
    if (!file) return new Response("{}", { status: 404 });
    return new Response(await Deno.readTextFile(new URL(`./fixtures/${file}`, import.meta.url)));
  };
  return asked;
}

Deno.test("api: a code at Zippopotam, Open-Meteo for the rest", async () => {
  const real = http.fetch;
  try {
    let asked = fake({ "/fr/75011": "zippo-fr-75011.json" });
    assertEquals((await lookupCode("FR", "75011")).map((p) => p.name), ["Paris 11 Popincourt"]);
    assertEquals(asked, ["https://api.zippopotam.us/fr/75011"]);
    // Morocco isn't covered by Zippopotam: straight to Open-Meteo.
    asked = fake({ "geo:75011": "geo-75011.json" });
    assertEquals(await lookupCode("MA", "75011"), []);
    assertEquals(asked.length, 1);
    assert(asked[0].includes("countryCode=MA"));
    // An unknown code anywhere: nothing, no error.
    fake({});
    assertEquals(await lookupCode("US", "00000"), []);
    // A server error is an error.
    http.fetch = () => Promise.resolve(new Response("down", { status: 503 }));
    let failed = "";
    await lookupCode("DE", "10115").catch((e) => failed = e.message);
    assertEquals(failed, "Zippopotam.us answered 503");
  } finally {
    http.fetch = real;
  }
});

Deno.test("api: a place's full list of codes comes from Zippopotam", async () => {
  const real = http.fetch;
  try {
    const asked = fake({
      "geo:Berlin": "geo-berlin.json",
      "/de/10967": "zippo-de-10967.json",
      "/de/be/berlin": "zippo-de-be-berlin.json",
    });
    const [berlin] = await findPlaces("Berlin", "DE");
    assertEquals(berlin.stateCode, "BE");
    // Open-Meteo's two codes, and those of Berlin and its districts.
    for (const c of ["10967", "13347", "10115", "10243", "10961"]) assert(berlin.codes.includes(c), c);
    assertEquals(asked.length, 3);
    // Zippopotam down: Open-Meteo's codes are kept.
    fake({ "geo:Berlin": "geo-berlin.json" });
    assertEquals((await findPlaces("Berlin", "DE"))[0].codes, ["10967", "13347"]);
  } finally {
    http.fetch = real;
  }
});

Deno.test("manifest", async () => {
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as Record<string, any>;
  assertEquals(m.extension.id, "postal-codes");
  assertEquals(m.permissions, { net: ["api.zippopotam.us", "geocoding-api.open-meteo.com"] });
  assertEquals(m.preferences.map((p: { name: string }) => p.name), ["country"]);
});
