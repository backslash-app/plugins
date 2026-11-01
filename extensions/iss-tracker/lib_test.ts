import { assert, assertAlmostEquals, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { CITIES } from "./cities.ts";
import { ecefToGeodetic, fixAt, geodeticToEcef, inShadow, lookAngles, passes, skyPoint, sunElevation } from "./geo.ts";
import {
  bearing,
  coordinates,
  distanceKm,
  elementAge,
  mapUrl,
  nextVisibleText,
  nowItems,
  passItems,
  passSentence,
  periodMinutes,
  settingsFor,
  waterAt,
  whereabouts,
} from "./lib.ts";
import type { Place } from "./places.ts";
import { gmst, parseTle, propagate, satrec, tleChecksum } from "./sgp4.ts";

const ISS_TLE = await Deno.readTextFile(new URL("./fixtures/iss.tle", import.meta.url));
// Vallado's test satellite (Vanguard 1, "Revisiting Spacetrack Report #3").
const VANGUARD = [
  "1 00005U 58002B   00179.78495062  .00000023  00000-0  28098-4 0  4753",
  "2 00005  34.2682 348.7242 1859667 331.7664  19.3264 10.82419157413667",
].join("\n");

const PARIS: Place = {
  name: "Paris",
  latitude: 48.8566,
  longitude: 2.3522,
  timezone: "Europe/Paris",
  country: "France",
};

const near = (a: number[], b: number[], tolerance: number) => Math.hypot(...a.map((x, i) => x - b[i])) < tolerance;

Deno.test("TLE: reading and checksums", () => {
  const tle = parseTle(ISS_TLE);
  assertEquals(tle.name, "ISS (ZARYA)");
  assertEquals(tle.id, 25544);
  assertEquals(new Date(tle.epoch).toISOString(), "2026-11-01T05:00:23.160Z");
  assertAlmostEquals(tle.bstar, 0.13267e-3, 1e-12);
  assertEquals(tle.inclination, 51.6332);
  assertEquals(tle.eccentricity, 0.0007056);
  assertEquals(tle.meanMotion, 15.49138562);
  assertAlmostEquals(periodMinutes(tle), 92.95, 0.01);
  const lines = ISS_TLE.trim().split("\n");
  assertEquals(tleChecksum(lines[1]), 4);
  assertEquals(tleChecksum(lines[2]), 4);
  // A changed digit breaks the checksum.
  assertThrows(() => parseTle(lines[1].replace("51.6332", "51.6333") + "\n" + lines[2].replace("51.6332", "51.6333")));
  assertThrows(() => parseTle("not a TLE"), Error, "Not a two-line element set");
  assertEquals(parseTle(VANGUARD).epoch, Math.round(Date.UTC(2000, 0, 1) + 178.78495062 * 86_400_000));
  assertAlmostEquals(parseTle(VANGUARD).bstar, 0.28098e-4, 1e-12);
});

Deno.test("SGP4: Vallado's reference vectors for satellite 00005", () => {
  const s = satrec(parseTle(VANGUARD));
  const cases: [number, number[], number[]][] = [
    [0, [7022.465293, -1400.082968, 0.039952], [1.893841015, 6.405893759, 4.53480725]],
    [360, [-7154.031202, -3783.176825, -3536.194123], [4.741887409, -4.151817765, -2.093935425]],
    [1440, [-938.559239, -6268.187488, -4294.029248], [7.536105209, -0.427127707, 0.98987808]],
    [10080, [-2591.255979, -6292.440774, -4558.812186], [6.726917478, -2.048841021, 1.30484889]],
  ];
  for (const [m, r, v] of cases) {
    const sv = propagate(s, m);
    assert(near(sv.position, r, 1e-5), `${m} min: ${sv.position}`);
    assert(near(sv.velocity, v, 1e-8), `${m} min: ${sv.velocity}`);
  }
});

Deno.test("SGP4: the ISS, as satellite.js computes it", () => {
  const s = satrec(parseTle(ISS_TLE));
  const cases: [number, number[], number[]][] = [
    [0, [6462.778599, -2094.793284, 0.004786], [1.462314097, 4.525369457, 6.011727292]],
    [360, [3568.033778, -4396.356275, -3759.936834], [6.209217464, 1.404628245, 4.257719857]],
    [1440, [-6286.786936, 2597.438519, -69.160004], [-1.761455859, -4.411528628, -6.003482745]],
    [10080, [-4435.76937, 5132.315252, -515.663536], [-3.310140068, -3.453811106, -5.975587596]],
  ];
  for (const [m, r, v] of cases) {
    const sv = propagate(s, m);
    assert(near(sv.position, r, 1e-5), `${m} min: ${sv.position}`);
    assert(near(sv.velocity, v, 1e-8), `${m} min: ${sv.velocity}`);
  }
  assertAlmostEquals(gmst(Date.parse("2026-11-01T12:00:00Z")), 3.853520890316446, 1e-12);
  assertThrows(() => satrec({ ...parseTle(ISS_TLE), meanMotion: 1.0027 }), Error, "Deep-space");
});

Deno.test("ground position matches wheretheiss.at", () => {
  // api.wheretheiss.at at 2026-11-01T17:08:18Z: 51.37759° N, 131.10848° E, 427.57 km, 27,576 km/h, eclipsed.
  const fix = fixAt(satrec(parseTle(ISS_TLE)), 1793555298000);
  assertAlmostEquals(fix.latitude, 51.37759, 0.01);
  assertAlmostEquals(fix.longitude, 131.10848, 0.01);
  assertAlmostEquals(fix.altitude, 427.57, 0.5);
  assertAlmostEquals(fix.speed, 27575.9, 5);
  assertEquals(fix.sunlit, false);
});

Deno.test("geometry: round trips, look angles and the Earth's shadow", () => {
  for (const [lat, lon, h] of [[48.85, 2.35, 0], [-33.87, 151.21, 0.05], [0, -179.9, 420]]) {
    const g = ecefToGeodetic(geodeticToEcef(lat, lon, h));
    assertAlmostEquals(g.latitude, lat, 1e-9);
    assertAlmostEquals(g.longitude, lon, 1e-9);
    assertAlmostEquals(g.altitude, h, 1e-6);
  }
  // Straight up, and due north on the horizon side.
  assertAlmostEquals(lookAngles(geodeticToEcef(10, 20, 400), 10, 20).elevation, 90, 1e-6);
  const north = lookAngles(geodeticToEcef(15, 20, 400), 10, 20);
  assertAlmostEquals(north.azimuth, 0, 0.5);
  assert(north.elevation > 0 && north.elevation < 45);
  // Behind the Earth, opposite the Sun: shadow; beside it, lit.
  const sun: [number, number, number] = [1.5e8, 0, 0];
  assert(inShadow([-6800, 0, 0], sun));
  assert(!inShadow([-6800, 6700, 0], sun));
  assert(!inShadow([6800, 0, 0], sun));
  // Noon sun in Paris in June is about 64° high.
  assertAlmostEquals(sunElevation(Date.parse("2026-06-21T11:52:00Z"), PARIS.latitude, PARIS.longitude), 64.6, 0.5);
});

Deno.test("passes over Paris: look angles match satellite.js", () => {
  const s = satrec(parseTle(ISS_TLE));
  const from = Date.parse("2026-11-01T18:00:00Z");
  const ps = passes(s, PARIS.latitude, PARIS.longitude, from, from + 3 * 86_400_000);
  assertEquals(ps.length, 19);
  // satellite.js ecfToLookAngles at the highest points.
  const expected: [string, number, number][] = [
    ["2026-11-01T22:17:29.531Z", 20.99, 140.2],
    ["2026-11-01T23:53:59.531Z", 87.31, 94.53],
    ["2026-11-02T04:44:32.031Z", 25.14, 217.38],
  ];
  for (const [at, el, az] of expected) {
    const p = ps.find((x) => Math.abs(x.culmination.at - Date.parse(at)) < 5000)!;
    assert(p, `no pass at ${at}`);
    assertAlmostEquals(p.culmination.elevation, el, 0.05);
    assertAlmostEquals(p.culmination.azimuth, az, 0.05);
  }
  for (const p of ps) {
    assert(Math.abs(p.rise.elevation) < 0.1 && Math.abs(p.set.elevation) < 0.1);
    assert(p.rise.at < p.culmination.at && p.culmination.at < p.set.at);
    assert(p.visible ? !p.hidden : p.hidden);
  }
  // Only the morning pass of 2 November can be seen: the evening ones are in the Earth's shadow.
  const visible = ps.filter((p) => p.visible);
  assertEquals(visible.length, 1);
  const v = visible[0].visible!;
  assertAlmostEquals(v.from.at, Date.parse("2026-11-02T04:45:27Z"), 10_000);
  assert(v.magnitude < -1.5 && v.magnitude > -3.5, `magnitude ${v.magnitude}`);
  assert(v.from.sunlit && v.from.sunElevation < -6);
  assertEquals(ps.find((p) => p.culmination.elevation > 80 && p.culmination.at < from + 86_400_000)!.hidden, "shadow");
  assertEquals(ps.find((p) => p.culmination.elevation < 3)!.hidden, "low");
});

Deno.test("where it is: cities, oceans, bearings", () => {
  assertAlmostEquals(distanceKm(48.8566, 2.3522, 51.5074, -0.1278), 344, 2);
  assertAlmostEquals(bearing(0, 0, 10, 0), 0, 1e-9);
  assertAlmostEquals(bearing(0, 0, 0, 10), 90, 1e-9);
  assertEquals(whereabouts(48.86, 2.35).title, "Above Paris, France");
  assertEquals(whereabouts(45, 10).title, "Near Milan, Italy");
  assertEquals(whereabouts(45, 10).detail, "82 km SE of Milan, Italy");
  assertEquals(whereabouts(0, -140).title, "Over the Pacific Ocean");
  assertEquals(whereabouts(20, -40).title, "Over the Atlantic Ocean");
  assertEquals(whereabouts(-30, 80).title, "Over the Indian Ocean");
  assertEquals(waterAt(35, 18), "the Mediterranean Sea");
  assertEquals(waterAt(-50.1, -88.8), "the Pacific Ocean");
  assertEquals(coordinates(51.3776, -131.1085), "51.38° N, 131.11° W");
  assertEquals(mapUrl(1, 2), "https://www.openstreetmap.org/?mlat=1.000&mlon=2.000#map=4/1.000/2.000");
  // Every place on land the station flies over is within reach of a listed city.
  for (const [lat, lon] of [[25, 10], [-23, 133], [45, 90], [-10, -60], [40, -100], [5, 20], [50, 60]]) {
    assert(whereabouts(lat, lon).distance < 700, `${lat}, ${lon}`);
  }
  assertEquals(new Set(CITIES.map((c) => `${c[0]}, ${c[1]}`)).size, CITIES.length);
  for (const [, , lat, lon] of CITIES) assert(Math.abs(lat) <= 90 && Math.abs(lon) <= 180);
});

Deno.test("items: now and passes", () => {
  const sat = satrec(parseTle(ISS_TLE));
  const now = Date.parse("2026-11-01T18:00:00Z");
  const s = settingsFor("Europe/Paris", "24h", now);
  const ps = passes(sat, PARIS.latitude, PARIS.longitude, now, now + 10 * 86_400_000);
  const items = nowItems({ sat, now, settings: s, place: PARIS, passes: ps });
  assertEquals(items[0].id, "position");
  assertEquals(items[0].title, "Over the Pacific Ocean");
  assertStringIncludes(items[0].subtitle!, "km up");
  assertEquals(items[0].accessories![0].tag, "In sunlight");
  assertEquals(items[1].title, "Below your horizon");
  assertEquals(items[2].section, "Next visible pass");
  assertStringIncludes(items[2].title, "Mon 2 Nov, 05:45");
  assertEquals(items.filter((i) => i.section === "Next orbit").length, 6);
  // Without a place: position and ground track only.
  assertEquals(nowItems({ sat, now, settings: s }).length, 7);
  // An old copy of the elements says so.
  assert(nowItems({ sat, now, settings: s, stale: "timeout" }).some((i) => i.id === "stale"));
  assertAlmostEquals(elementAge(sat.tle, now), 0.54, 0.01);

  const visible = passItems(ps, s, PARIS, true);
  const all = passItems(ps, s, PARIS, false);
  assert(visible.length >= 1 && all.length > visible.length);
  assertEquals(visible[0].section, "Tomorrow, Mon 2 Nov");
  assertStringIncludes(visible[0].detail!.markdown!, "comes out of the Earth's shadow");
  assertEquals(all[0].accessories!.at(-1)!.tag, "Not visible");
  const first = ps.find((p) => p.visible)!;
  assertStringIncludes(passSentence(first, s), "Appears at 05:45");
  assertStringIncludes(passSentence(ps[1], s), "can't be seen: in the earth's shadow");
  assertStringIncludes(nextVisibleText(ps, s), "Next visible in");
  assertEquals(skyPoint(sat, now, PARIS.latitude, PARIS.longitude).elevation < 0, true);
});

Deno.test("manifest: two hosts, command files exist", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    extension: { id: string; categories: string[] };
    permissions: { net: string[] };
    commands: { name: string }[];
    preferences: { name: string }[];
  };
  assertEquals(manifest.extension.id, "iss-tracker");
  assertEquals(manifest.extension.categories, ["everyday"]);
  assertEquals(manifest.permissions, { net: ["celestrak.org", "geocoding-api.open-meteo.com"] });
  assertEquals(manifest.preferences.map((p) => p.name), ["location", "hour12"]);
  assertEquals(manifest.commands.map((c) => c.name), ["iss-now", "iss-passes"]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
