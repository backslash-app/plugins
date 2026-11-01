import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  bzVerdict,
  cloudCover,
  cloudsUrl,
  currentKp,
  darkWindow,
  dayName,
  days,
  geomagneticLatitude,
  gScale,
  horizonLatitude,
  kpDuring,
  kpLabel,
  kpNeeded,
  kpText,
  ovationAt,
  overheadLatitude,
  parseCoordinates,
  parseKp,
  parseSolarWind,
  rankPlaces,
  relative,
  speedVerdict,
  splitQuery,
  sunAltitude,
  toClouds,
  utc,
  verdict,
} from "./lib.ts";

const fixture = async (name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url)));

const H = 3_600_000;
const PARIS = { lat: 48.85, lon: 2.35 };
const TROMSO = { lat: 69.65, lon: 18.96 };
// When the fixtures were fetched.
const NOW = Date.parse("2026-11-01T17:30:00Z");

Deno.test("aurora: Kp forecast", async () => {
  const kp = parseKp(await fixture("kp-forecast.json"));
  assertEquals(kp.length, 81);
  assert(kp.every((e, i) => i === 0 || e.time > kp[i - 1].time));
  assertEquals(new Set(kp.map((e) => e.kind)), new Set(["observed", "estimated", "predicted"]));
  assertEquals(utc("2026-11-01T15:00:00"), Date.parse("2026-11-01T15:00:00Z"));
  // The latest measured value, not the future "estimated" ones.
  const now = currentKp(kp, NOW)!;
  assertEquals(now.time, Date.parse("2026-11-01T15:00:00Z"));
  assertEquals(now.kind, "estimated");
  // NOAA's own scale on the G2 period of October 31.
  assertEquals(kp.find((e) => e.time === Date.parse("2026-10-31T18:00:00Z"))?.scale, "G2");
});

Deno.test("aurora: Kp in words", () => {
  assertEquals(kpText(4.33), "4+");
  assertEquals(kpText(4.67), "5-");
  assertEquals(kpText(0.67), "1-");
  assertEquals(kpText(0), "0");
  assertEquals(kpText(9), "9");
  assertEquals(gScale(4.33), undefined);
  assertEquals(gScale(4.67), "G1");
  assertEquals(gScale(6), "G2");
  assertEquals(gScale(7.67), "G4");
  assertEquals(gScale(9), "G5");
  assertEquals(kpLabel(1), "Quiet");
  assertEquals(kpLabel(3), "Unsettled");
  assertEquals(kpLabel(4), "Active");
  assertEquals(kpLabel(5), "Minor storm");
  assertEquals(kpLabel(9), "Extreme storm");
});

Deno.test("aurora: geomagnetic latitude and the oval", () => {
  // Published dipole values: Paris ~50°, Tromsø ~67°, Fairbanks ~65°, Sydney ~-42°.
  assertAlmostEquals(geomagneticLatitude(PARIS.lat, PARIS.lon), 50.4, 1);
  assertAlmostEquals(geomagneticLatitude(TROMSO.lat, TROMSO.lon), 67.3, 1);
  assertAlmostEquals(geomagneticLatitude(64.84, -147.72), 65.4, 1);
  assert(geomagneticLatitude(-33.87, 151.21) < -38);
  assertEquals(overheadLatitude(0), 66.5);
  assert(horizonLatitude(5) < overheadLatitude(5));
  // Tromsø sits under the oval; Paris needs a strong storm.
  assertEquals(kpNeeded(geomagneticLatitude(TROMSO.lat, TROMSO.lon), false), 0);
  assertEquals(kpText(kpNeeded(geomagneticLatitude(PARIS.lat, PARIS.lon), true)!), "6-");
  assertEquals(kpText(kpNeeded(geomagneticLatitude(PARIS.lat, PARIS.lon), false)!), "8");
  // The equator never sees it.
  assertEquals(kpNeeded(geomagneticLatitude(0, 0), true), undefined);
});

Deno.test("aurora: the sun and darkness", () => {
  // Paris at noon on the June solstice: 64.6°.
  assertAlmostEquals(sunAltitude(Date.parse("2026-06-21T11:50:00Z"), PARIS.lat, PARIS.lon), 64.6, 0.5);
  // Paris, November 1: nautical dusk at 18:44 local time, dawn at 06:31.
  const w = darkWindow(NOW, PARIS.lat, PARIS.lon)!;
  assertAlmostEquals(w.start, Date.parse("2026-11-01T17:44:00Z"), 10 * 60_000);
  assertAlmostEquals(w.end, Date.parse("2026-11-02T05:30:00Z"), 15 * 60_000);
  // Already dark: the window starts now.
  assertEquals(
    darkWindow(Date.parse("2026-11-01T22:00:00Z"), PARIS.lat, PARIS.lon)!.start,
    Date.parse("2026-11-01T22:00:00Z"),
  );
  // Midnight sun in Tromsø: never dark.
  assertEquals(darkWindow(Date.parse("2026-06-21T12:00:00Z"), TROMSO.lat, TROMSO.lon), undefined);
  // Polar night: long darkness, but not at noon.
  const polar = darkWindow(Date.parse("2026-12-21T11:00:00Z"), TROMSO.lat, TROMSO.lon)!;
  assert(polar.end - polar.start > 14 * H);
});

Deno.test("aurora: solar wind", async () => {
  const w = parseSolarWind(await fixture("mag.json"), await fixture("speed.json"));
  assertEquals(w.speed, 482);
  assertEquals(w.bz, 1);
  assertEquals(w.bt, 5);
  assertEquals(w.time, Date.parse("2026-11-01T17:25:00Z"));
  assertEquals(parseSolarWind(undefined, []), { speed: undefined, bz: undefined, bt: undefined, time: undefined });
  assertEquals(bzVerdict(-12).color, "green");
  assertEquals(bzVerdict(-1).text, "Slightly south");
  assertEquals(bzVerdict(3).color, "gray");
  assertEquals(speedVerdict(720).text, "Very fast");
  assertEquals(speedVerdict(350).text, "Slow");
});

Deno.test("aurora: OVATION model", async () => {
  const ov = await fixture("ovation.json");
  const tromso = ovationAt(ov, TROMSO.lat, TROMSO.lon);
  assertEquals(tromso.here, 31);
  assert(tromso.poleward >= tromso.here);
  assertEquals(tromso.forecast, Date.parse("2026-11-01T18:21:00Z"));
  // Oslo: little overhead, the oval visible to the north.
  const oslo = ovationAt(ov, 59.9, 10.75);
  assert(oslo.here < 10);
  assert(oslo.poleward >= 20);
  // Negative longitudes wrap around: 359° is -1°.
  const wrap = ovationAt({ coordinates: [[359, 60, 42]] }, 60.2, -1.1);
  assertEquals(wrap.here, 42);
  assertEquals(ovationAt({}, 60, 0), { here: 0, poleward: 0, observed: undefined, forecast: undefined });
});

Deno.test("aurora: clouds", () => {
  const url = new URL(cloudsUrl(PARIS.lat, PARIS.lon));
  assertEquals(url.host, "api.open-meteo.com");
  assertEquals(url.searchParams.get("hourly"), "cloud_cover");
  const clouds = toClouds({
    timezone: "Europe/Paris",
    utc_offset_seconds: 3600,
    hourly: { time: ["2026-11-01T19:00", "2026-11-01T20:00", "2026-11-01T21:00"], cloud_cover: [100, 50, null] },
  });
  assertEquals(clouds.hours, [
    { time: Date.parse("2026-11-01T18:00:00Z"), cover: 100 },
    { time: Date.parse("2026-11-01T19:00:00Z"), cover: 50 },
  ]);
  assertEquals(
    cloudCover(clouds, { start: Date.parse("2026-11-01T18:00:00Z"), end: Date.parse("2026-11-01T20:00:00Z") }),
    75,
  );
  assertEquals(cloudCover(clouds, { start: 0, end: 1 }), undefined);
  assertEquals(cloudCover(undefined, { start: 0, end: 1 }), undefined);
});

Deno.test("aurora: verdict", async () => {
  const kp = parseKp(await fixture("kp-forecast.json"));
  const dark = { start: NOW + H, end: NOW + 12 * H };
  // The highest Kp while dark: the G1 period at 21:00 UTC.
  assertEquals(kpDuring(kp, dark), 4.67);
  assertEquals(kpDuring([], dark, 2), 2);

  const tromso = geomagneticLatitude(TROMSO.lat, TROMSO.lon);
  const paris = geomagneticLatitude(PARIS.lat, PARIS.lon);
  assertEquals(verdict({ magLat: tromso, kp: 2, dark, now: NOW }).chance, "likely");
  assertEquals(verdict({ magLat: paris, kp: 2, dark, now: NOW }).chance, "unlikely");
  assert(verdict({ magLat: paris, kp: 2, dark, now: NOW }).detail.includes("Kp 6- (G2 storm)"));
  assertEquals(verdict({ magLat: paris, kp: 6, dark, now: NOW }).chance, "possible");
  assertEquals(verdict({ magLat: paris, kp: 6, dark, now: NOW }).title, "Possible low on the northern horizon");
  assertEquals(verdict({ magLat: paris, kp: 8, dark, now: NOW }).chance, "likely");
  assertEquals(verdict({ magLat: -52, kp: 6, dark, now: NOW }).title, "Possible low on the southern horizon");
  // Too bright.
  assertEquals(verdict({ magLat: tromso, kp: 9, dark: undefined, now: NOW }).chance, "bright");
  // Clouds spoil it.
  const cloudy = verdict({ magLat: tromso, kp: 3, dark, now: NOW, clouds: 90 });
  assertEquals(cloudy.title, "Good chance of aurora tonight, but cloudy");
  assertEquals(cloudy.color, "orange");
  // The OVATION model counts while it is dark now, not for later tonight.
  const ovation = { here: 40, poleward: 50 };
  assertEquals(
    verdict({ magLat: paris, kp: 2, dark: { start: NOW, end: NOW + H }, now: NOW, ovation }).chance,
    "likely",
  );
  assertEquals(verdict({ magLat: paris, kp: 2, dark, now: NOW, ovation }).chance, "unlikely");
});

Deno.test("aurora: days and times", async () => {
  const kp = parseKp(await fixture("kp-forecast.json"));
  const d = days(kp, NOW, "Europe/Oslo");
  assertEquals(d.map((x) => x.date), ["2026-11-01", "2026-11-02", "2026-11-03"]);
  assertEquals(d[0].max, 4.67);
  assertEquals(d[0].scale, "G1");
  assertEquals(d[1].entries.length, 8);
  assertEquals(dayName("2026-11-01", NOW, "Europe/Oslo"), "Today");
  assertEquals(dayName("2026-11-02", NOW, "Europe/Oslo"), "Tomorrow");
  assertEquals(dayName("2026-11-03", NOW, "Europe/Oslo"), "Tuesday 3 November");
  assertEquals(relative(NOW + 3 * H, NOW), "in 3 h");
  assertEquals(relative(NOW - 12 * 60_000, NOW), "12 min ago");
});

Deno.test("aurora: places", () => {
  assertEquals(parseCoordinates("69.65, 18.96")?.latitude, 69.65);
  assertEquals(parseCoordinates("-33.9 151.2")?.longitude, 151.2);
  assertEquals(parseCoordinates("95, 10"), undefined);
  assertEquals(parseCoordinates("Tromsø"), undefined);
  assertEquals(splitQuery("Québec, Canada"), { name: "Québec", hint: "Canada" });
  const places = [
    { id: 1, name: "Paris", latitude: 33.66, longitude: -95.55, country: "United States", country_code: "US" },
    { id: 2, name: "Paris", latitude: 48.85, longitude: 2.35, country: "France", country_code: "FR" },
  ];
  assertEquals(rankPlaces(places, "France").map((p) => p.id), [2, 1]);
});

Deno.test("aurora: manifest", async () => {
  // deno-lint-ignore no-explicit-any
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(m.extension.id, "aurora");
  assertEquals(m.extension.version, "1.0.0");
  assertEquals(m.extension.categories, ["everyday"]);
  assertEquals(m.permissions.net, ["services.swpc.noaa.gov", "geocoding-api.open-meteo.com", "api.open-meteo.com"]);
  assertEquals(m.commands.map((c: { title: string }) => c.title), ["Aurora Forecast"]);
  const keywords: string[] = m.commands[0].keywords;
  assertEquals(new Set(keywords).size, keywords.length);
});
