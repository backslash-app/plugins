import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  addressSearchUrl,
  age,
  clampRadius,
  communesByPostcodeUrl,
  distanceKm,
  formatDistance,
  type FuelRecord,
  fuelTitle,
  hhmm,
  HOSTS,
  isPostcode,
  mapsUrl,
  normalizePrice,
  openState,
  parseCoordinates,
  parseDate,
  parseFuel,
  parseHours,
  parsePrices,
  placesFromAddresses,
  placesFromCommunes,
  rows,
  stationsByIdUrl,
  stationsUrl,
  summarize,
  titleCase,
  toStation,
  weekHours,
} from "./lib.ts";

const RECORD: FuelRecord = {
  id: 69003001,
  adresse: "12 AVENUE DE LA LIBERATION",
  ville: "LYON",
  cp: "69003",
  pop: "R",
  latitude: "4576000",
  longitude: "485000",
  geom: { lat: 45.76, lon: 4.85 },
  prix: JSON.stringify([
    { "@nom": "Gazole", "@id": "1", "@maj": "2026-10-29 08:15:00", "@valeur": "1.689" },
    { "@nom": "E10", "@id": "5", "@maj": "2026-10-28 18:00:00", "@valeur": "1.759" },
    { "@nom": "SP98", "@id": "6", "@maj": "2026-09-01 10:00:00", "@valeur": "1829" },
  ]),
  horaires: JSON.stringify({
    "@automate-24-24": "",
    jour: [
      { "@id": "1", "@nom": "Lundi", "@ferme": "", horaire: { "@ouverture": "07.00", "@fermeture": "20.00" } },
      {
        "@id": "2",
        "@nom": "Mardi",
        "@ferme": "",
        horaire: [{ "@ouverture": "07.00", "@fermeture": "12.00" }, { "@ouverture": "14.00", "@fermeture": "19.30" }],
      },
      { "@id": "7", "@nom": "Dimanche", "@ferme": "1" },
    ],
  }),
  services_service: ["Lavage automatique", "Boutique alimentaire", "Station de gonflage"],
  rupture: JSON.stringify([{ "@nom": "E85", "@id": "3", "@type": "temporaire" }]),
  horaires_automate_24_24: "Non",
};

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
});

Deno.test("fuel names", () => {
  assertEquals(parseFuel("diesel"), "Gazole");
  assertEquals(parseFuel("Gasoil"), "Gazole");
  assertEquals(parseFuel("SP95-E10"), "E10");
  assertEquals(parseFuel("sp 98"), "SP98");
  assertEquals(parseFuel("SP95"), "SP95");
  assertEquals(parseFuel("GPL"), "GPLc");
  assertEquals(parseFuel("Superéthanol E85"), "E85");
  assertEquals(parseFuel(undefined), "Gazole");
  assertEquals(fuelTitle("E10"), "SP95-E10");
  assertEquals(fuelTitle("gplc"), "GPLc");
});

Deno.test("radius is clamped", () => {
  assertEquals(clampRadius("5"), 5);
  assertEquals(clampRadius(0), 10);
  assertEquals(clampRadius(500), 50);
  assertEquals(clampRadius("abc"), 10);
});

Deno.test("coordinates and postcodes", () => {
  assertEquals(parseCoordinates("45.76, 4.85")?.lat, 45.76);
  assertEquals(parseCoordinates("45,76; 4,85")?.lon, 4.85);
  assertEquals(parseCoordinates("Lyon"), undefined);
  assertEquals(parseCoordinates("120, 4"), undefined);
  assert(isPostcode("69003"));
  assert(isPostcode("2A004"));
  assert(!isPostcode("6900"));
});

Deno.test("geocoding urls and answers", () => {
  assertEquals(
    addressSearchUrl("Lyon 3e"),
    "https://api-adresse.data.gouv.fr/search/?q=Lyon+3e&limit=5&autocomplete=0",
  );
  assert(communesByPostcodeUrl("35000").startsWith("https://geo.api.gouv.fr/communes?codePostal=35000&"));
  const places = placesFromAddresses({
    features: [
      {
        geometry: { coordinates: [4.85, 45.76] },
        properties: { label: "Lyon", type: "municipality", postcode: "69001" },
      },
      { properties: { label: "No geometry" } },
    ],
  });
  assertEquals(places, [{ label: "Lyon", lat: 45.76, lon: 4.85, kind: "municipality", postcode: "69001" }]);
  const communes = placesFromCommunes([
    { nom: "Saint-Grégoire", centre: { coordinates: [-1.68, 48.15] }, population: 10000 },
    { nom: "Rennes", centre: { coordinates: [-1.68, 48.11] }, population: 220000 },
  ], "35000");
  assertEquals(communes.map((c) => c.label), ["Rennes (35000)", "Saint-Grégoire (35000)"]);
});

Deno.test("stations url: geofilter around the point, cheapest first", () => {
  const url = new URL(stationsUrl({ lat: 45.76, lon: 4.85 }, "E10", 7));
  assertEquals(url.hostname, "data.economie.gouv.fr");
  assert(url.pathname.endsWith("/prix-des-carburants-en-france-flux-instantane-v2/records"));
  assertEquals(
    url.searchParams.get("where"),
    "within_distance(geom, geom'POINT(4.850000 45.760000)', 7km) AND e10_prix IS NOT NULL",
  );
  assertEquals(url.searchParams.get("order_by"), "e10_prix ASC");
  assertEquals(url.searchParams.get("limit"), "100");
  assertEquals(new URL(stationsByIdUrl(["12", "x; drop", "34"])).searchParams.get("where"), "id IN (12, 34)");
});

Deno.test("prices, dates and hours", () => {
  assertEquals(normalizePrice("1.789"), 1.789);
  assertEquals(normalizePrice(1789), 1.789);
  assertEquals(normalizePrice("0"), undefined);
  // French summer time, then winter time.
  assertEquals(parseDate("2026-07-01 10:00:00"), Date.parse("2026-07-01T08:00:00Z"));
  assertEquals(parseDate("2026-12-01 10:00:00"), Date.parse("2026-12-01T09:00:00Z"));
  assertEquals(parseDate("2026-10-29T08:00:00+00:00"), Date.parse("2026-10-29T08:00:00Z"));
  assertEquals(hhmm("7.30"), "07:30");
  assertEquals(hhmm("19:00"), "19:00");
  const prices = parsePrices(RECORD.prix);
  assertEquals(prices.map((p) => [p.fuel, p.price]), [["Gazole", 1.689], ["E10", 1.759], ["SP98", 1.829]]);
  // Flat columns when there is no `prix`.
  assertEquals(
    parsePrices(null, { gplc_prix: 0.999, gplc_maj: "2026-10-29T06:00:00+00:00" }).map((p) => p.fuel),
    ["GPLc"],
  );
  const hours = parseHours(RECORD.horaires);
  assertEquals(hours.automat24, false);
  assertEquals(hours.days.length, 3);
  assertEquals(hours.days[1].intervals, [{ open: "07:00", close: "12:00" }, { open: "14:00", close: "19:30" }]);
  assertEquals(weekHours(hours.days), ["Monday: 07:00–20:00", "Tuesday: 07:00–12:00, 14:00–19:30", "Sunday: closed"]);
});

Deno.test("record to station", () => {
  const s = toStation(RECORD)!;
  assertEquals(s.id, "69003001");
  assertEquals(s.address, "12 Avenue de la Liberation");
  assertEquals(s.city, "Lyon");
  assertEquals(s.services, ["Boutique alimentaire", "Lavage automatique", "Station de gonflage"]);
  assertEquals(s.shortages, ["E85"]);
  assertEquals(s.motorway, false);
  // Without geom, the feed's coordinates are degrees × 100000.
  const t = toStation({ ...RECORD, geom: null })!;
  assertAlmostEquals(t.lat, 45.76, 1e-9);
  assertEquals(toStation({ adresse: "x" }), undefined);
  assertEquals(titleCase("ZI DES PRES D'ARENES"), "Zi des Pres d'Arenes");
  assertEquals(titleCase("Rue Déjà Bien"), "Rue Déjà Bien");
});

Deno.test("open now", () => {
  const s = toStation(RECORD)!;
  // 2026-10-26 is a Monday.
  assertEquals(openState(s, new Date(2026, 9, 26, 9, 0)), { open: true, text: "Open until 20:00" });
  assertEquals(openState(s, new Date(2026, 9, 27, 12, 30)), { open: false, text: "Closed · opens 14:00" });
  assertEquals(openState(s, new Date(2026, 9, 27, 21, 0)), { open: false, text: "Closed for today" });
  assertEquals(openState(s, new Date(2026, 10, 1, 10, 0)).text, "Closed today");
  assertEquals(openState({ ...s, automat24: true }, new Date(2026, 10, 1, 10, 0)).text, "24/7 pumps");
  assertEquals(openState({ automat24: false, days: [] }).open, undefined);
  assertEquals(
    openState(
      { automat24: false, days: [{ day: 3, closed: false, intervals: [{ open: "00:00", close: "00:00" }] }] },
      new Date(2026, 9, 28, 3, 0),
    ).text,
    "Open 24 hours",
  );
});

Deno.test("rows: fresh and cheap first, within the radius", () => {
  const base = toStation(RECORD)!;
  const now = Date.parse("2026-10-29T12:00:00Z");
  const cheapFar = {
    ...base,
    id: "2",
    lat: 45.80,
    prices: [{ fuel: "Gazole" as const, price: 1.6, updated: now - 3600_000 }],
  };
  const staleCheap = {
    ...base,
    id: "3",
    prices: [{ fuel: "Gazole" as const, price: 1.5, updated: now - 30 * 86400_000 }],
  };
  const tooFar = { ...base, id: "4", lat: 46.5, prices: [{ fuel: "Gazole" as const, price: 1.4, updated: now }] };
  const noGazole = { ...base, id: "5", prices: [] };
  const list = rows([base, cheapFar, staleCheap, tooFar, noGazole], { lat: 45.76, lon: 4.85 }, "Gazole", {
    radius: 10,
    now,
  });
  assertEquals(list.map((r) => r.station.id), ["2", "69003001", "3"]);
  assertEquals(list[2].stale, true);
  const near = rows([base, cheapFar], { lat: 45.76, lon: 4.85 }, "Gazole", { sort: "distance", now });
  assertEquals(near.map((r) => r.station.id), ["69003001", "2"]);
  const sum = summarize(list);
  assertEquals(sum.count, 3);
  assertEquals(sum.min, 1.6);
  assertAlmostEquals(sum.average!, (1.6 + 1.689) / 2);
});

Deno.test("distances and ages", () => {
  assertAlmostEquals(distanceKm({ lat: 48.8566, lon: 2.3522 }, { lat: 45.764, lon: 4.8357 }), 392, 2);
  assertEquals(formatDistance(0.234), "230 m");
  assertEquals(formatDistance(3.26), "3.3 km");
  assertEquals(formatDistance(23.6), "24 km");
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(age(now - 5 * 60_000, now), "5 min");
  assertEquals(age(now - 5 * 3600_000, now), "5 h");
  assertEquals(age(now - 3 * 86400_000, now), "3 d");
  assertEquals(age(undefined), "unknown");
});

Deno.test("maps links", () => {
  const s = { lat: 45.76, lon: 4.85, address: "12 Avenue", city: "Lyon" };
  assertEquals(mapsUrl(s, "google"), "https://www.google.com/maps/dir/?api=1&destination=45.760000,4.850000");
  assertEquals(mapsUrl(s, "geo"), "geo:45.760000,4.850000?q=45.760000,4.850000");
  assert(mapsUrl(s).startsWith("https://www.openstreetmap.org/?mlat=45.760000&mlon=4.850000"));
  assert(mapsUrl(s, "apple").includes("q=12%20Avenue%2C%20Lyon"));
});
