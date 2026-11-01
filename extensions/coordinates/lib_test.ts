import { assert, assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  allFormats,
  bandOf,
  bearing,
  compass,
  formatDdm,
  formatDecimal,
  formatDms,
  formatMgrs,
  formatUtm,
  fromGeohash,
  fromMgrs,
  fromPlusCode,
  fromUtm,
  haversineKm,
  isFullPlusCode,
  midpoint,
  osmUrl,
  parsePoint,
  parseQuery,
  toGeohash,
  toMgrs,
  toPlusCode,
  toUtm,
  vincenty,
  zoneOf,
} from "./lib.ts";
import { itemsFor } from "./ui.ts";

const P = (lat: number, lon: number) => ({ lat, lon });

// Reference values from the test suite of Chris Veness's geodesy library (Krüger series, WGS 84).
const UTM_REFERENCES: [number, number, string, string][] = [
  [0, 0, "31N 166021 0", "31N AA 66021 00000"],
  [1, 1, "31N 277438 110597", "31N BB 77438 10597"],
  [-1, -1, "30M 722561 9889402", "30M YD 22561 89402"],
  [-33.857, 151.215, "56H 334873 6252266", "56H LH 34873 52266"],
  [38.8977, -77.0365, "18S 323394 4307395", "18S UJ 23394 07395"],
  [-22.9519, -43.2106, "23K 683466 7460687", "23K PQ 83466 60687"],
];

Deno.test("utm: reference points", () => {
  for (const [lat, lon, utm, mgrs] of UTM_REFERENCES) {
    assertEquals(formatUtm(toUtm(P(lat, lon))), utm, `${lat}, ${lon}`);
    assertEquals(formatMgrs(toMgrs(P(lat, lon))), mgrs, `${lat}, ${lon}`);
  }
});

Deno.test("utm: zones, bands, Norway and Svalbard", () => {
  assertEquals(zoneOf(P(48.85, 2.29)), 31);
  assertEquals(zoneOf(P(0, 179.9)), 60);
  assertEquals(zoneOf(P(0, 180)), 1);
  assertEquals(zoneOf(P(0, -180)), 1);
  // Bergen is in zone 32, not 31.
  assertEquals(zoneOf(P(60.39, 5.32)), 32);
  assertEquals(zoneOf(P(60.39, 2.5)), 31);
  // Svalbard: 31, 33, 35 and 37 only.
  assertEquals(zoneOf(P(78, 5)), 31);
  assertEquals(zoneOf(P(78, 10)), 33);
  assertEquals(zoneOf(P(78, 25)), 35);
  assertEquals(zoneOf(P(78, 40)), 37);
  assertEquals(bandOf(48.85), "U");
  assertEquals(bandOf(-33.8), "H");
  assertEquals(bandOf(84), "X");
  assertEquals(bandOf(-80), "C");
  assertEquals(bandOf(85), undefined);
  assertThrows(() => toUtm(P(89, 0)), Error, "UPS");
});

Deno.test("utm and mgrs: round trips", () => {
  for (
    const [lat, lon] of [[0, 0], [48.8584, 2.2945], [-33.857, 151.215], [64.1, -21.9], [-79.5, 166.7], [83.5, -30]]
  ) {
    const u = toUtm(P(lat, lon));
    const back = fromUtm(u.zone, u.hemisphere, u.easting, u.northing);
    assertAlmostEquals(back.lat, lat, 1e-9);
    assertAlmostEquals(back.lon, lon, 1e-9);
    const m = toMgrs(P(lat, lon));
    const centre = fromMgrs(m.zone, m.band, m.square, m.easting + m.northing);
    // Within the 1 m square.
    assert(haversineKm(centre, P(lat, lon)) < 0.0015, `${lat}, ${lon}`);
  }
  // A 1 km square: its centre.
  const km = fromMgrs(31, "U", "DQ", "482119");
  assert(haversineKm(km, P(48.8584, 2.2945)) < 1);
  assertThrows(() => fromMgrs(31, "U", "DQ", "48211"), Error, "as many");
  assertThrows(() => fromMgrs(31, "U", "IQ", "4821"), Error, "100 km square");
});

Deno.test("geohash: Wikipedia examples and round trip", () => {
  assertEquals(toGeohash(P(57.64911, 10.40744), 11), "u4pruydqqvj");
  const d = fromGeohash("ezs42");
  assertAlmostEquals(d.lat, 42.605, 0.001);
  assertAlmostEquals(d.lon, -5.603, 0.001);
  const p = fromGeohash(toGeohash(P(48.8584, 2.2945), 9));
  assert(Math.abs(p.lat - 48.8584) <= p.latErr && Math.abs(p.lon - 2.2945) <= p.lonErr);
  assertThrows(() => fromGeohash("u09a"), Error, "geohash");
});

Deno.test("plus codes: reference encodings and decoding", () => {
  // From the Open Location Code test data.
  assertEquals(toPlusCode(P(20.3700625, 2.7821875)), "7FG49QCJ+2V");
  assertEquals(toPlusCode(P(47.0000625, 8.0000625)), "8FVC2222+22");
  assertEquals(toPlusCode(P(-41.2730625, 174.7859375)), "4VCPPQGP+Q9");
  assertEquals(toPlusCode(P(20.375, 2.775), 6), "7FG49Q00+");
  const d = fromPlusCode("7FG49QCJ+2V");
  assertAlmostEquals(d.lat, 20.3700625, 1e-9);
  assertAlmostEquals(d.lon, 2.7821875, 1e-9);
  // Eiffel Tower.
  assert(haversineKm(fromPlusCode("8FW4V75V+8Q"), P(48.8584, 2.2945)) < 0.02);
  assert(isFullPlusCode("8FW4V75V+8Q"));
  assert(isFullPlusCode("8FW40000+"));
  assert(!isFullPlusCode("8FW4000V+"));
  assert(!isFullPlusCode("V75V+8Q"));
  // The first characters can't go beyond 90°N / 180°E.
  assert(!isFullPlusCode("XFW4V75V+8Q"));
  // Round trip at 11 characters.
  const p = fromPlusCode(toPlusCode(P(-12.3456, -77.0123), 11));
  assertAlmostEquals(p.lat, -12.3456, 2e-5);
  assertAlmostEquals(p.lon, -77.0123, 2e-5);
});

Deno.test("degrees: formatting with carries", () => {
  assertEquals(formatDms(P(48.8584, 2.2945)), "48°51′30.2″N 2°17′40.2″E");
  assertEquals(formatDms(P(-33.857, -70.65)), "33°51′25.2″S 70°39′00.0″W");
  // 59.99999″ rounds up to the next minute and degree.
  assertEquals(formatDms(P(10.9999999, 0)), "11°00′00.0″N 0°00′00.0″E");
  assertEquals(formatDdm(P(48.8584, 2.2945)), "48°51.504′N 2°17.670′E");
  assertEquals(formatDecimal(P(48.85840001, 362.2945)), "48.8584, 2.2945");
});

Deno.test("parsing: every notation", () => {
  const near = (text: string, lat: number, lon: number, km = 0.02) => {
    const p = parsePoint(text);
    assert(p, text);
    assert(haversineKm(p.point, P(lat, lon)) < km, `${text} → ${JSON.stringify(p.point)}`);
    return p;
  };
  assertEquals(near("48.8584, 2.2945", 48.8584, 2.2945).notation, "decimal");
  near("48.8584 2.2945", 48.8584, 2.2945);
  near("48,8584 2,2945", 48.8584, 2.2945);
  near("48.8584;2.2945", 48.8584, 2.2945);
  near("(48.8584, 2.2945)", 48.8584, 2.2945);
  near("lat 48.8584 lon 2.2945", 48.8584, 2.2945);
  near("geo:48.8584,2.2945?z=17", 48.8584, 2.2945);
  near("-33.857 151.215", -33.857, 151.215);
  near("−33.857, 151.215", -33.857, 151.215);
  assertEquals(near(`48°51'30"N 2°17'40"E`, 48.8583, 2.2944).notation, "dms");
  near("48°51′30″N, 2°17′40″E", 48.8583, 2.2944);
  near("40 26 46 N 79 58 56 W", 40.4461, -79.9822);
  near("40 26 46 79 58 56", 40.4461, 79.9822);
  near(`48°51'30" 2°17'40"`, 48.8583, 2.2944);
  near("2°17'40\"E 48°51'30\"N", 48.8583, 2.2944);
  near("48°51'30\"N 2°17'40\"O", 48.8583, -2.2944);
  assertEquals(near("N 48° 51.504' E 2° 17.670'", 48.8584, 2.2945).notation, "ddm");
  near("48 51.504 N 2 17.670 E", 48.8584, 2.2945);
  near("S 33 51.42 W 70 39", -33.857, -70.65);
  assertEquals(near("31U 448251 5411943", 48.8584, 2.2945).notation, "utm");
  near("31 U 448251 5411943", 48.8584, 2.2945);
  near("31U 448251mE 5411943mN", 48.8584, 2.2945);
  // N and S as hemispheres when they can't be latitude bands.
  assertEquals(near("31N 448251 5411943", 48.8584, 2.2945).note, "Read N as the hemisphere");
  near("56 S 334873 6252266", -33.857, 151.215);
  assertEquals(near("31UDQ4825111943", 48.8584, 2.2945).notation, "mgrs");
  near("31U DQ 48251 11943", 48.8584, 2.2945);
  near("30M YD 22561 89402", -1, -1);
  near("31udq4825111943", 48.8584, 2.2945);
  near("31U DQ", 48.8584, 2.2945, 80);
  assertEquals(near("u09tunquc", 48.8584, 2.2945).notation, "geohash");
  near("geohash ezs42", 42.605, -5.603, 3);
  assertEquals(near("8FW4V75V+8Q", 48.8584, 2.2945, 0.02).notation, "pluscode");
  near("8fw4v75v+8q", 48.8584, 2.2945, 0.02);
});

Deno.test("parsing: swaps and errors", () => {
  const swapped = parsePoint("151.215, -33.857");
  assertEquals(swapped?.point, P(-33.857, 151.215));
  assertEquals(swapped?.note, "Read as longitude, latitude");
  assertThrows(() => parsePoint("95, 200"), Error, "Latitude");
  assertThrows(() => parsePoint("48°61'00\"N 2°17'40\"E"), Error, "under 60");
  assertThrows(() => parsePoint("V75V+8Q"), Error, "short Plus Code");
  assertThrows(() => parsePoint("31UDQ482521193"), Error, "as many");
  assertThrows(() => parsePoint("61U 448251 5411943"), Error, "1 to 60");
  assertThrows(() => parsePoint("31U 448252 1000"), Error, "band U");
  assertEquals(parsePoint("hello world"), undefined);
  assertEquals(parsePoint("42"), undefined);
  assertEquals(parsePoint(""), undefined);
});

Deno.test("distances: Vincenty's own test line and the sphere", () => {
  // Flinders Peak to Buninyong (Vincenty 1975): 54 972.271 m, initial bearing 306°52′05.37″.
  const flinders = P(-(37 + 57 / 60 + 3.7203 / 3600), 144 + 25 / 60 + 29.5244 / 3600);
  const buninyong = P(-(37 + 39 / 60 + 10.1561 / 3600), 143 + 55 / 60 + 35.3839 / 3600);
  const v = vincenty(flinders, buninyong)!;
  assertAlmostEquals(v.meters, 54972.271, 0.001);
  assertAlmostEquals(v.initial, 306 + 52 / 60 + 5.37 / 3600, 1e-5);
  assertAlmostEquals(v.final, 307 + 10 / 60 + 25.07 / 3600, 1e-5);
  // Paris to New York: about 5 837 km.
  const paris = P(48.8566, 2.3522), ny = P(40.7128, -74.006);
  assertAlmostEquals(haversineKm(paris, ny), 5837, 5);
  assertAlmostEquals(vincenty(paris, ny)!.meters / 1000, 5853, 5);
  assertAlmostEquals(bearing(paris, ny), 291.8, 0.2);
  assertEquals(compass(291.8), "WNW");
  assertEquals(compass(359), "N");
  // The midpoint of two points on the equator is on the equator.
  const mid = midpoint(P(0, 10), P(0, 30));
  assertAlmostEquals(mid.lat, 0, 1e-9);
  assertAlmostEquals(mid.lon, 20, 1e-9);
  assertEquals(vincenty(paris, paris)?.meters, 0);
  // Nearly antipodal points: Vincenty gives up, the caller falls back to the sphere.
  assertEquals(vincenty(P(0, 0), P(0.5, 179.7)), undefined);
});

Deno.test("queries and items", () => {
  assertEquals(parseQuery("").kind, "empty");
  assertEquals(parseQuery("nope").kind, "error");
  const d = parseQuery("48.8584, 2.2945 to 31UDQ4825111943");
  assertEquals(d.kind, "distance");
  assertEquals(parseQuery("Paris → 40.6892, -74.0445").kind, "error");
  assertEquals(parseQuery("48.8584, 2.2945 -> 40.6892, -74.0445").kind, "distance");
  const items = itemsFor(parseQuery("48.8584, 2.2945"));
  assertEquals(items[0].title, "48.8584, 2.2945");
  assertEquals(items.map((i) => i.id), [
    "point",
    "format:dms",
    "format:ddm",
    "format:utm",
    "format:mgrs",
    "format:geohash",
    "format:pluscode",
  ]);
  // Near the pole, UTM and MGRS are left out.
  assertEquals(allFormats(P(88, 0)).map((f) => f.notation), ["decimal", "dms", "ddm", "geohash", "pluscode"]);
  const dist = itemsFor(parseQuery("0, 10 to 0, 30"));
  assertEquals(dist[0].id, "distance");
  assertEquals(dist.find((i) => i.id === "midpoint")?.title, "0, 20");
  assertEquals(itemsFor({ kind: "empty" })[0].id?.startsWith("example:"), true);
  assertEquals(
    osmUrl(P(48.8584, 2.2945)),
    "https://www.openstreetmap.org/?mlat=48.8584&mlon=2.2945#map=16/48.8584/2.2945",
  );
  // Every example parses.
  for (const item of itemsFor({ kind: "empty" })) assert(parseQuery(item.title).kind !== "error", item.title);
});

Deno.test("manifest: no permission, command files exist", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions?: unknown;
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions, undefined);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
