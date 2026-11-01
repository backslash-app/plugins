import { assert, assertAlmostEquals, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import { moonPosition, sunPosition } from "./astro.ts";
import { ECLIPSES, SHOWERS } from "./data.ts";
import {
  eclipseItem,
  instrument,
  moonPhaseName,
  nasaUrl,
  nightItems,
  settingsFor,
  showerItem,
  summaryText,
  tonight,
  upcomingEclipses,
  upcomingShowers,
  verdictTag,
} from "./lib.ts";
import { eccentricAnomaly, PLANET_IDS, type PlanetId, planetPosition } from "./planets.ts";
import { parseCoordinates, parseQuery, type Place, resolveDay } from "./places.ts";
import {
  expectedRate,
  isActive,
  lunarView,
  minutesOf,
  night,
  outlookOf,
  planetNight,
  showerNight,
  showerPeak,
  solarView,
} from "./sky.ts";

const PARIS: Place = { name: "Paris", latitude: 48.8566, longitude: 2.3522, timezone: "Europe/Paris" };
const SYDNEY: Place = { name: "Sydney", latitude: -33.8688, longitude: 151.2093, timezone: "Australia/Sydney" };
const REYKJAVIK: Place = { name: "Reykjavik", latitude: 64.1466, longitude: -21.9426, timezone: "Atlantic/Reykjavik" };
const LOS_ANGELES: Place = {
  name: "Los Angeles",
  latitude: 34.0522,
  longitude: -118.2437,
  timezone: "America/Los_Angeles",
};
const LONGYEARBYEN: Place = {
  name: "Longyearbyen",
  latitude: 78.2232,
  longitude: 15.6267,
  timezone: "Arctic/Longyearbyen",
};
const TROMSO: Place = { name: "Tromsø", latitude: 69.6492, longitude: 18.9553, timezone: "Europe/Oslo" };

// JPL Horizons, apparent right ascension and declination (degrees), visual magnitude and distance (AU), at 0h UT.
const HORIZONS: [PlanetId, string, number, number, number, number][] = [
  ["mercury", "2026-03-15", 340.83972, -5.49351, 2.299, 0.634392],
  ["mercury", "2029-08-01", 152.43624, 12.29626, -0.25, 1.172362],
  ["venus", "2026-03-15", 10.17747, 3.24264, -3.899, 1.623101],
  ["venus", "2029-08-01", 164.40445, 8.05233, -3.926, 1.302301],
  ["mars", "2026-03-15", 341.73482, -8.91076, 1.118, 2.320942],
  ["mars", "2029-08-01", 204.00724, -10.65373, 0.687, 1.366838],
  ["jupiter", "2026-03-15", 106.44388, 22.93799, -2.331, 4.803605],
  ["jupiter", "2029-08-01", 199.59668, -7.00714, -1.886, 5.675711],
  ["saturn", "2026-03-15", 3.99039, -0.58577, 0.952, 10.476079],
  ["saturn", "2029-08-01", 52.06596, 16.58025, 0.227, 9.361656],
  ["uranus", "2026-03-15", 55.89996, 19.56776, 5.772, 19.89739],
  ["uranus", "2029-08-01", 76.27776, 22.84733, 5.733, 19.861765],
  ["neptune", "2026-03-15", 1.95162, -0.57722, 7.825, 30.869069],
  ["neptune", "2029-08-01", 10.75563, 2.9836, 7.715, 29.368129],
];

const angleDiff = (a: number, b: number) => ((a - b + 540) % 360) - 180;

Deno.test("planets: positions within a tenth of a degree of JPL Horizons", () => {
  for (const [id, date, ra, dec, mag, delta] of HORIZONS) {
    const p = planetPosition(id, Date.parse(`${date}T00:00:00Z`));
    const dRa = angleDiff(p.ra, ra) * Math.cos((dec * Math.PI) / 180);
    assert(Math.abs(dRa) < 0.1, `${id} ${date}: RA off by ${dRa.toFixed(3)}°`);
    assert(Math.abs(p.dec - dec) < 0.1, `${id} ${date}: Dec off by ${(p.dec - dec).toFixed(3)}°`);
    assert(Math.abs(p.magnitude - mag) < 0.35, `${id} ${date}: magnitude ${p.magnitude.toFixed(2)}, expected ${mag}`);
    assertAlmostEquals(p.delta, delta, 0.03);
  }
});

Deno.test("planets: Kepler's equation, phases and sides of the Sun", () => {
  for (const [M, e] of [[0, 0.2], [45, 0.0167], [200, 0.2056], [359, 0.0934]]) {
    const E = eccentricAnomaly(M, e);
    const back = E - (e * 180 / Math.PI) * Math.sin((E * Math.PI) / 180);
    assertAlmostEquals(((back - M + 540) % 360) - 180, 0, 1e-6);
  }
  // Outer planets are always nearly full; Venus near inferior conjunction is a thin crescent.
  const t = Date.parse("2026-03-15T00:00:00Z");
  for (const id of ["jupiter", "saturn", "uranus", "neptune"] as PlanetId[]) {
    assert(planetPosition(id, t).illuminated > 0.98);
  }
  const conj = planetPosition("venus", Date.parse("2026-10-24T00:00:00Z"));
  assert(conj.illuminated < 0.05, `Venus lit ${conj.illuminated}`);
  assert(conj.elongation < 10);
  // Saturn at opposition (4 Oct 2026) is opposite the Sun.
  const opp = planetPosition("saturn", Date.parse("2026-10-04T00:00:00Z"));
  assert(opp.elongation > 175, `elongation ${opp.elongation}`);
  assertEquals(PLANET_IDS.length, 7);
});

Deno.test("night: dark hours, white nights and polar night", () => {
  const n = night("2026-11-01", PARIS);
  assertEquals(n.state, "normal");
  // Civil dusk 18:03, civil dawn 07:06 (Paris time, UTC+1).
  assertAlmostEquals(n.from!, Date.parse("2026-11-01T17:03:00Z"), 3 * 60_000);
  assertAlmostEquals(n.to!, Date.parse("2026-11-02T06:06:00Z"), 3 * 60_000);
  assertEquals(night("2026-06-21", TROMSO).state, "never");
  assertEquals(night("2026-12-21", LONGYEARBYEN).state, "dark");
});

Deno.test("planets tonight: Paris, 1 November 2026", () => {
  const n = night("2026-11-01", PARIS);
  const p = Object.fromEntries(PLANET_IDS.map((id) => [id, planetNight(id, n, PARIS)]));
  assertEquals(p.mercury.verdict, "glare");
  assertEquals(p.venus.verdict, "daytime");
  assertEquals(p.mars.verdict, "morning");
  assertEquals(p.jupiter.verdict, "morning");
  assertEquals(p.uranus.verdict, "all-night");
  // Saturn is due south at 22:44 at 42° and sets before dawn.
  assertAlmostEquals(p.saturn.transit!, Date.parse("2026-11-01T21:44:00Z"), 3 * 60_000);
  assertAlmostEquals(p.saturn.transitAltitude!, 42, 1);
  assert(p.saturn.rise! < p.saturn.transit! && p.saturn.transit! < p.saturn.set!);
  assertEquals(p.saturn.verdict, "night");
  // Rise and set frame the night: Mars rises after midnight and sets the next afternoon.
  assert(p.mars.rise! > n.from! && p.mars.set! > n.to!);
  assertEquals(instrument(p.neptune.magnitude), "Binoculars");
  assertEquals(instrument(p.jupiter.magnitude), "Naked eye");
});

Deno.test("planets tonight: items and summary", () => {
  const now = Date.parse("2026-11-01T20:00:00Z");
  const s = settingsFor(PARIS, "24h", now);
  const t = tonight(PARIS, "2026-11-01");
  const items = nightItems(t, s);
  assertEquals(items[0].id, "night");
  assertStringIncludes(items[0].title, "Dark from 18:03 to 07:0");
  assertEquals(items[1].id, "moon");
  assertStringIncludes(items[1].title, "Last quarter");
  // Visible planets first, brightest first.
  const planets = items.filter((i) => i.id?.startsWith("planet:"));
  assertEquals(planets.length, 7);
  assertEquals(planets[0].id, "planet:jupiter");
  assertEquals(planets.at(-1)!.section, "Not tonight");
  const saturn = planets.find((i) => i.id === "planet:saturn")!;
  assertEquals(verdictTag(t.planets[4], t.night, s).text, "Until 04:19");
  assertStringIncludes(saturn.detail!.markdown!, "a small telescope shows the rings");
  assert(saturn.detail!.metadata!.some((m) => m.label === "Now"));
  assertStringIncludes(summaryText(t, s), "Jupiter (before dawn)");
  // Another night: no "Now" line.
  const later = nightItems(tonight(PARIS, "2026-11-05"), s).find((i) => i.id === "planet:saturn")!;
  assert(!later.detail!.metadata!.some((m) => m.label === "Now"));
});

Deno.test("moon phase names", () => {
  assertEquals(moonPhaseName(0), "New Moon");
  assertEquals(moonPhaseName(45), "Waxing crescent");
  assertEquals(moonPhaseName(90), "First quarter");
  assertEquals(moonPhaseName(180), "Full Moon");
  assertEquals(moonPhaseName(300), "Waning crescent");
  assertEquals(moonPhaseName(358), "New Moon");
});

Deno.test("eclipses: the table agrees with the Sun and the Moon", () => {
  let last = 0;
  for (const e of ECLIPSES) {
    const t = Date.parse(e.greatest);
    assert(t > last, `${e.greatest} out of order`);
    last = t;
    const elong = ((moonPosition(t).lambda - sunPosition(t).lambda) % 360 + 360) % 360;
    const target = e.body === "solar" ? 0 : 180;
    assert(Math.abs(angleDiff(elong, target)) < 0.6, `${e.greatest}: Moon ${elong.toFixed(2)}° from the Sun`);
    // Eclipses happen near the Moon's nodes.
    assert(
      Math.abs(moonPosition(t).beta) < 1.6,
      `${e.greatest}: Moon ${moonPosition(t).beta.toFixed(2)}° off the ecliptic`,
    );
    if (e.body === "lunar") {
      assertEquals(e.kind === "penumbral", e.magnitude < 0);
      assertEquals(e.kind === "total", e.durations.length === 2);
    } else assertEquals(Boolean(e.path), e.kind !== "partial");
  }
  assertEquals(ECLIPSES.length, 24);
  assertEquals(minutesOf("3 h 27 min"), 207);
  assertEquals(minutesOf("58 min"), 58);
  assertEquals(minutesOf(undefined), 0);
});

Deno.test("eclipses: as seen from a place", () => {
  const eclipse = (date: string) => ECLIPSES.find((e) => e.greatest.startsWith(date))!;
  const aug2026 = eclipse("2026-08-12");
  assertEquals(solarView(aug2026, REYKJAVIK).central, "total");
  const paris = solarView(aug2026, PARIS);
  assertEquals(paris.central, undefined);
  assert(paris.obscuration > 0.88 && paris.obscuration < 0.97, `Paris ${paris.obscuration}`);
  // Maximum near 20:18 Paris time, the Sun low in the west.
  assertAlmostEquals(paris.at!, Date.parse("2026-08-12T18:18:00Z"), 5 * 60_000);
  assert(paris.sunAltitude! > 0 && paris.sunAltitude! < 15);
  assertEquals(solarView(aug2026, SYDNEY).magnitude, 0);
  assertEquals(solarView(eclipse("2028-07-22"), SYDNEY).central, "total");

  const mar2026 = eclipse("2026-03-03");
  assertEquals(lunarView(mar2026, LOS_ANGELES).visibility, "visible");
  assertEquals(lunarView(mar2026, PARIS).visibility, "not-visible");
  assertEquals(lunarView(mar2026, PARIS).phases.map((p) => p.label), [
    "Partial eclipse begins",
    "Totality begins",
    "Greatest eclipse",
    "Totality ends",
    "Partial eclipse ends",
  ]);
});

Deno.test("eclipses: items, filters and NASA links", () => {
  const now = Date.parse("2026-08-01T12:00:00Z");
  const entries = upcomingEclipses(now, PARIS);
  assertEquals(entries[0].eclipse.greatest.slice(0, 10), "2026-08-12");
  const s = settingsFor(PARIS, "24h", now);
  const item = eclipseItem(entries[0], s, PARIS);
  assertEquals(item.title, "Total solar eclipse");
  assertStringIncludes(item.subtitle!, "of the Sun at 20:1");
  assertEquals(item.accessories![0].tag, "Visible here");
  assertStringIncludes(item.detail!.markdown!, "eclipse glasses");
  const noPlace = eclipseItem(upcomingEclipses(now)[0], s);
  assertStringIncludes(noPlace.subtitle!, "Greenland");
  assertEquals(nasaUrl(ECLIPSES[2]), "https://eclipse.gsfc.nasa.gov/SEgoogle/SEgoogle2001/SE2026Aug12Tgoogle.html");
  assertEquals(nasaUrl(ECLIPSES[1]), "https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2026Mar03T.pdf");
  assertEquals(nasaUrl(ECLIPSES[5]), "https://eclipse.gsfc.nasa.gov/LEplot/LEplot2001/LE2027Feb20N.pdf");
  const partial = ECLIPSES.find((e) => e.body === "solar" && e.kind === "partial")!;
  assertEquals(nasaUrl(partial), "https://eclipse.gsfc.nasa.gov/SEplot/SEplot2001/SE2029Jan14P.GIF");
  assertEquals(upcomingEclipses(Date.parse("2031-01-01T00:00:00Z")).length, 0);
});

Deno.test("meteor showers: peaks, activity and outlook", () => {
  const shower = (id: string) => SHOWERS.find((s) => s.id === id)!;
  const from = Date.parse("2026-01-01T00:00:00Z");
  const perseids = showerPeak(shower("perseids"), from);
  assert(perseids > Date.parse("2026-08-12T00:00:00Z") && perseids < Date.parse("2026-08-14T00:00:00Z"));
  const geminids = showerPeak(shower("geminids"), from);
  assert(geminids > Date.parse("2026-12-13T00:00:00Z") && geminids < Date.parse("2026-12-15T12:00:00Z"));
  const quadrantids = showerPeak(shower("quadrantids"), Date.parse("2026-12-01T00:00:00Z"));
  assert(quadrantids > Date.parse("2027-01-03T00:00:00Z") && quadrantids < Date.parse("2027-01-05T00:00:00Z"));
  assert(showerPeak(shower("lyrids"), from) > from);

  assert(isActive(shower("quadrantids"), "2026-12-30"));
  assert(isActive(shower("quadrantids"), "2027-01-10"));
  assert(!isActive(shower("quadrantids"), "2026-06-10"));
  assert(isActive(shower("perseids"), "2026-08-01"));

  assertEquals(expectedRate(100, 90, false, 0), 100);
  assertAlmostEquals(expectedRate(100, 30, false, 0), 50, 1e-9);
  assertAlmostEquals(expectedRate(100, 90, true, 1), 30, 1e-9);
  assertEquals(expectedRate(100, -5, false, 0), 0);
  assertEquals(outlookOf(40), "excellent");
  assertEquals(outlookOf(12), "good");
  assertEquals(outlookOf(4), "fair");
  assertEquals(outlookOf(1), "poor");

  // The Geminids are a northern shower, the Eta Aquariids a southern one.
  const gem = showerNight(shower("geminids"), geminids, PARIS);
  assertEquals(gem.outlook, "excellent");
  assert(gem.radiantAltitude > 60);
  const gemSydney = showerNight(shower("geminids"), geminids, SYDNEY);
  assert(gemSydney.radiantAltitude < 30);
  const eta = showerPeak(shower("eta-aquariids"), from);
  assert(
    showerNight(shower("eta-aquariids"), eta, SYDNEY).best!.rate >
      showerNight(shower("eta-aquariids"), eta, PARIS).best!.rate,
  );
  // In June the sky never gets dark in Tromsø.
  assertEquals(showerNight(shower("lyrids"), Date.parse("2026-06-21T00:00:00Z"), TROMSO).outlook, "no-night");
});

Deno.test("meteor showers: active first, past peak kept while active", () => {
  const now = Date.parse("2026-11-01T20:00:00Z");
  const entries = upcomingShowers(now, PARIS);
  assertEquals(entries.length, SHOWERS.length);
  const active = entries.filter((e) => e.active).map((e) => e.shower.id);
  assertEquals(active, ["southern-taurids", "orionids", "northern-taurids"]);
  // The Orionids peaked on 21 October: still this year's peak, not next year's.
  assert(entries[1].peak < now && entries[1].peak > now - 20 * 86_400_000);
  for (let i = active.length + 1; i < entries.length; i++) assert(entries[i].peak >= entries[i - 1].peak);
  const s = settingsFor(PARIS, "24h", now);
  const orionids = showerItem(entries[1], s, PARIS);
  assertStringIncludes(orionids.subtitle!, "Peaked the night of");
  assertStringIncludes(orionids.detail!.markdown!, "peaked");
  const geminids = showerItem(entries.find((e) => e.shower.id === "geminids")!, s, PARIS);
  assertEquals(geminids.section, "Coming up");
  assertStringIncludes(geminids.subtitle!, "Peak night of Mon 14 Dec");
  assert(geminids.accessories!.some((a) => a.tag === "Excellent"));
  // Without a place: the rate under a perfect sky only.
  const plain = showerItem(upcomingShowers(now)[0], { zone: "UTC", clock: "24h", now });
  assert(plain.accessories!.some((a) => a.text?.startsWith("ZHR")));
});

Deno.test("what the user types", () => {
  assertEquals(parseQuery(""), {});
  assertEquals(parseQuery("Tokyo tomorrow"), { offset: 1, place: "Tokyo" });
  assertEquals(parseQuery("demain Lyon, France"), { offset: 1, place: "Lyon, France" });
  assertEquals(parseQuery("48.85, 2.35 +2"), { coordinates: { latitude: 48.85, longitude: 2.35 }, offset: 2 });
  assertEquals(parseQuery("2026-12-13 Reykjavik"), { date: "2026-12-13", place: "Reykjavik" });
  assertEquals(parseQuery("ce soir"), { offset: 0 });
  assertEquals(parseQuery("São Paulo"), { place: "São Paulo" });
  assertEquals(resolveDay({ offset: 2 }, "2026-12-31"), "2027-01-02");
  assertEquals(resolveDay({ date: "2026-12-13" }, "2026-11-01"), "2026-12-13");
  assertEquals(parseCoordinates("33.87S, 151.21E")?.latitude, -33.87);
});

Deno.test("manifest: one host, command files exist", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    extension: { id: string; categories: string[] };
    permissions: { net: string[] };
    commands: { name: string }[];
    preferences: { name: string }[];
  };
  assertEquals(manifest.extension.id, "night-sky");
  assertEquals(manifest.extension.categories, ["everyday"]);
  assertEquals(manifest.permissions, { net: ["geocoding-api.open-meteo.com"] });
  assertEquals(manifest.preferences.map((p) => p.name), ["location", "hour12"]);
  assertEquals(manifest.commands.map((c) => c.name), ["planets", "meteor-showers", "eclipses"]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
