import { assert, assertAlmostEquals, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  crossings,
  elongation,
  illumination,
  moonHorizon,
  moonHorizontal,
  moonPosition,
  nextPhaseAt,
  refraction,
  SUN_HORIZON,
  sunHorizontal,
  sunPosition,
} from "./astro.ts";
import {
  addDays,
  clockOf,
  compass,
  computeView,
  coordinatesPlace,
  dayLabel,
  dayOf,
  formatChange,
  formatDay,
  formatDuration,
  formatTime,
  geocodingUrl,
  intervals,
  moonDay,
  nextPhases,
  parseCoordinates,
  parseQuery,
  phaseName,
  type Place,
  placeLabel,
  rankPlaces,
  relative,
  resolveDate,
  shadow,
  splitPlace,
  startOfDay,
  subtitle,
  summaryText,
  suncalcUrl,
  sunDay,
  viewItems,
  weekday,
  zoneOffset,
} from "./lib.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const paris: Place = {
  id: 2988507,
  name: "Paris",
  latitude: 48.85341,
  longitude: 2.3488,
  country: "France",
  country_code: "FR",
  admin1: "Île-de-France",
  timezone: "Europe/Paris",
};
const sydney: Place = { name: "Sydney", latitude: -33.8688, longitude: 151.2093, timezone: "Australia/Sydney" };
const tokyo: Place = { name: "Tokyo", latitude: 35.6895, longitude: 139.6917, timezone: "Asia/Tokyo" };
const newYork: Place = { name: "New York", latitude: 40.7128, longitude: -74.006, timezone: "America/New_York" };
const tromso: Place = { name: "Tromsø", latitude: 69.6496, longitude: 18.956, timezone: "Europe/Oslo" };

/** Within `minutes` of a local "HH:MM" time. */
function near(ms: number | undefined, place: Place, hhmm: string, minutes = 2) {
  assert(ms !== undefined, `expected a time near ${hhmm}`);
  const [h, m] = formatTime(ms, place.timezone!).split(":").map(Number);
  const [eh, em] = hhmm.split(":").map(Number);
  const diff = Math.abs(h * 60 + m - (eh * 60 + em));
  assert(diff <= minutes, `${formatTime(ms, place.timezone!)} is not within ${minutes} min of ${hhmm}`);
}

Deno.test("astro: sunrise and sunset match published times", () => {
  // Published values (timeanddate.com, NOAA), to the minute.
  const june = sunDay("2024-06-21", paris);
  near(june.sunrise, paris, "05:47");
  near(june.sunset, paris, "21:58");
  near(june.noon, paris, "13:52");
  const december = sunDay("2024-12-21", paris);
  near(december.sunrise, paris, "08:41");
  near(december.sunset, paris, "16:56");
  const equinox = sunDay("2024-03-20", newYork);
  near(equinox.sunrise, newYork, "06:58");
  near(equinox.sunset, newYork, "19:09");
  const summer = sunDay("2024-12-21", sydney);
  near(summer.sunrise, sydney, "05:41");
  near(summer.sunset, sydney, "20:05");
  const newYear = sunDay("2025-01-01", tokyo);
  near(newYear.sunrise, tokyo, "06:51");
  near(newYear.sunset, tokyo, "16:38");
});

Deno.test("astro: day length, solar noon altitude and twilights", () => {
  const june = sunDay("2024-06-21", paris);
  assertEquals(june.state, "normal");
  assertAlmostEquals(june.length, 16 * HOUR + 11 * MINUTE, 3 * MINUTE);
  // 90° - latitude + declination (23.44°)
  assertAlmostEquals(june.noonAltitude, 90 - 48.85 + 23.44, 0.1);
  assert(june.civil.dawn! < june.sunrise! && june.nautical.dawn! < june.civil.dawn!);
  assert(june.civil.dusk! > june.sunset! && june.nautical.dusk! > june.civil.dusk!);
  // Paris never gets fully dark around the June solstice.
  assertEquals(june.astronomical.dawn, undefined);
  assertEquals(june.astronomical.dusk, undefined);
  // Blue hour, then golden hour in the morning; the reverse in the evening.
  assertEquals(june.golden.map((w) => w.part), ["morning", "evening"]);
  assertEquals(june.blue.map((w) => w.part), ["morning", "evening"]);
  assertEquals(june.blue[0].from, june.civil.dawn);
  assertAlmostEquals(june.blue[0].to, june.golden[0].from, 1000);
  assertAlmostEquals(june.golden[1].to, june.blue[1].from, 1000);
  assertEquals(june.blue[1].to, june.civil.dusk);
  assert(june.golden[0].from < june.sunrise! && june.sunrise! < june.golden[0].to);
  const december = sunDay("2024-12-21", paris);
  assert(december.astronomical.dawn !== undefined && december.astronomical.dusk !== undefined);
  assertAlmostEquals(december.length, 8 * HOUR + 15 * MINUTE, 3 * MINUTE);
});

Deno.test("astro: midnight sun and polar night", () => {
  const night = sunDay("2024-12-21", tromso);
  assertEquals(night.state, "down");
  assertEquals(night.length, 0);
  assertEquals(night.sunrise, undefined);
  assert(night.noonAltitude < 0);
  const day = sunDay("2024-06-21", tromso);
  assertEquals(day.state, "up");
  assertEquals(day.length, day.end - day.start);
  // The Sun comes back to Tromsø around January 15, and first sets again in late July.
  const v = computeView(tromso, "2024-12-21", Date.parse("2024-12-21T12:00:00Z"));
  assertEquals(dayOf(v.nextSunrise!, "Europe/Oslo").slice(0, 7), "2025-01");
  assertAlmostEquals(Date.parse(dayOf(v.nextSunrise!, "Europe/Oslo")), Date.parse("2025-01-15"), 2 * 86_400_000);
  const w = computeView(tromso, "2024-06-21", Date.parse("2024-06-21T12:00:00Z"));
  assertEquals(dayOf(w.nextSunset!, "Europe/Oslo").slice(0, 7), "2024-07");
});

Deno.test("astro: sun position", () => {
  // Around the June solstice, the declination is +23.44°.
  assertAlmostEquals(sunPosition(Date.parse("2024-06-20T20:51:00Z")).dec, 23.44, 0.01);
  assertAlmostEquals(sunPosition(Date.parse("2024-03-20T03:06:00Z")).dec, 0, 0.01);
  // At solar noon the Sun is due south of Paris.
  const noon = sunDay("2024-06-21", paris).noon;
  assertAlmostEquals(sunHorizontal(noon, paris.latitude, paris.longitude).azimuth, 180, 0.2);
  // Refraction lifts the Sun about 34 arcminutes at the horizon, nothing high up.
  assertAlmostEquals(refraction(0), 0.57, 0.02);
  assert(refraction(60) < 0.01);
});

Deno.test("astro: moon phases match published times", () => {
  const within = (ms: number, iso: string) => assertAlmostEquals(ms, Date.parse(iso), 10 * MINUTE);
  within(nextPhaseAt(Date.parse("2024-01-01T00:00:00Z"), 0), "2024-01-11T11:57:00Z");
  within(nextPhaseAt(Date.parse("2024-01-15T00:00:00Z"), 180), "2024-01-25T17:54:00Z");
  within(nextPhaseAt(Date.parse("2024-03-25T00:00:00Z"), 0), "2024-04-08T18:21:00Z");
  within(nextPhaseAt(Date.parse("2025-03-01T00:00:00Z"), 180), "2025-03-14T06:55:00Z");
  within(nextPhaseAt(Date.parse("2024-01-12T00:00:00Z"), 90), "2024-01-18T03:53:00Z");
  // Just after a full moon, the next one is a month later.
  const after = nextPhaseAt(Date.parse("2024-01-25T18:30:00Z"), 180);
  within(after, "2024-02-24T12:30:00Z");
  const phases = nextPhases(Date.parse("2024-01-01T00:00:00Z"));
  // The last quarter of January 4 comes first.
  assertEquals(phases.map((p) => p.name), ["Last Quarter", "New Moon", "First Quarter", "Full Moon"]);
  assertAlmostEquals(phases[0].at, Date.parse("2024-01-04T03:30:00Z"), 10 * MINUTE);
  assert(phases.every((p, i) => i === 0 || p.at > phases[i - 1].at));
});

Deno.test("astro: illumination", () => {
  const full = illumination(Date.parse("2024-01-25T17:54:00Z"));
  assert(full.fraction > 0.99);
  assertAlmostEquals(full.angle, 180, 0.5);
  const fresh = illumination(Date.parse("2024-01-11T11:57:00Z"));
  assert(fresh.fraction < 0.01);
  const quarter = illumination(Date.parse("2024-01-18T03:53:00Z"));
  assertAlmostEquals(quarter.fraction, 0.5, 0.02);
  assert(quarter.waxing);
  assertAlmostEquals(quarter.age, 7.4, 0.2);
  assert(!illumination(Date.parse("2024-02-02T23:18:00Z")).waxing);
  assert(elongation(Date.parse("2024-01-20T00:00:00Z")) > 90);
});

Deno.test("astro: moonrise and moonset", () => {
  const m = moonDay("2024-06-21", paris);
  assert(m.moonrise && m.moonset);
  near(m.moonrise, paris, "22:14", 5);
  near(m.moonset, paris, "04:32", 5);
  // At moonrise the Moon is at its rise altitude, and climbing.
  const at = m.moonrise!;
  const alt = (t: number) => moonHorizontal(t, paris.latitude, paris.longitude).altitude;
  assertAlmostEquals(alt(at), moonHorizon(moonPosition(at).distance), 0.01);
  assert(alt(at + 10 * MINUTE) > alt(at));
  // The Moon's rise altitude is a little above the horizon (parallax beats refraction).
  assertAlmostEquals(moonHorizon(384_400), 0.125, 0.02);
});

Deno.test("astro: crossings and intervals", () => {
  // A wave over a day: up from 6 h to 18 h.
  const start = 0;
  const end = 24 * HOUR;
  const f = (t: number) => -Math.cos((t / end) * 2 * Math.PI);
  const c = crossings(f, start, end);
  assertEquals(c.aboveAtStart, false);
  assertAlmostEquals(c.rises[0], 6 * HOUR, 1000);
  assertAlmostEquals(c.sets[0], 18 * HOUR, 1000);
  assertEquals(intervals(c, start, end).length, 1);
  // Up at the start: the first interval starts there.
  const g = crossings((t) => -f(t), start, end);
  assertEquals(intervals(g, start, end).map(([a]) => a)[0], start);
  assertEquals(intervals(g, start, end)[1][1], end);
  // Never crossing.
  assertEquals(intervals(crossings(() => 1, start, end), start, end), [[start, end]]);
  assertEquals(intervals(crossings(() => -1, start, end), start, end), []);
  assertEquals(SUN_HORIZON, -0.833);
});

Deno.test("zones: offsets, days and clock changes", () => {
  assertEquals(zoneOffset(Date.parse("2024-01-15T12:00:00Z"), "Europe/Paris"), 60);
  assertEquals(zoneOffset(Date.parse("2024-07-15T12:00:00Z"), "Europe/Paris"), 120);
  assertEquals(zoneOffset(Date.parse("2024-07-15T12:00:00Z"), "America/New_York"), -240);
  assertEquals(zoneOffset(Date.parse("2024-07-15T12:00:00Z"), "Asia/Kolkata"), 330);
  assertEquals(startOfDay("2024-06-21", "Europe/Paris"), Date.parse("2024-06-20T22:00:00Z"));
  assertEquals(startOfDay("2024-06-21", "Asia/Tokyo"), Date.parse("2024-06-20T15:00:00Z"));
  // Clocks change: 23 and 25 hour days.
  const length = (day: string) => startOfDay(addDays(day, 1), "Europe/Paris") - startOfDay(day, "Europe/Paris");
  assertEquals(length("2024-03-31"), 23 * HOUR);
  assertEquals(length("2024-10-27"), 25 * HOUR);
  assertEquals(dayOf(Date.parse("2024-06-20T23:30:00Z"), "Europe/Paris"), "2024-06-21");
  assertEquals(dayOf(Date.parse("2024-06-20T23:30:00Z"), "America/New_York"), "2024-06-20");
  assertEquals(addDays("2024-12-31", 1), "2025-01-01");
  assertEquals(addDays("2024-03-01", -1), "2024-02-29");
  assertEquals(weekday("2026-11-01"), 0);
});

Deno.test("query: places, coordinates and dates", () => {
  assertEquals(parseQuery(""), {});
  assertEquals(parseQuery("Tokyo"), { place: "Tokyo" });
  assertEquals(parseQuery("Tokyo tomorrow"), { place: "Tokyo", date: { kind: "offset", days: 1 } });
  assertEquals(parseQuery("demain"), { date: { kind: "offset", days: 1 } });
  assertEquals(parseQuery("hier"), { date: { kind: "offset", days: -1 } });
  assertEquals(parseQuery("après-demain"), { date: { kind: "offset", days: 2 } });
  assertEquals(parseQuery("aujourd’hui"), { date: { kind: "offset", days: 0 } });
  assertEquals(parseQuery("2026-12-21"), { date: { kind: "day", day: "2026-12-21" } });
  assertEquals(parseQuery("31/12/2026"), { date: { kind: "day", day: "2026-12-31" } });
  assertEquals(parseQuery("12/21/2026"), { date: { kind: "day", day: "2026-12-21" } });
  assertEquals(parseQuery("21 décembre Lyon"), { place: "Lyon", date: { kind: "monthDay", month: 12, day: 21 } });
  assertEquals(parseQuery("dec 21, 2026"), { date: { kind: "day", day: "2026-12-21" } });
  assertEquals(parseQuery("1er mai"), { date: { kind: "monthDay", month: 5, day: 1 } });
  assertEquals(parseQuery("Reykjavik 21 jun"), { place: "Reykjavik", date: { kind: "monthDay", month: 6, day: 21 } });
  assertEquals(parseQuery("friday"), { date: { kind: "weekday", weekday: 5 } });
  assertEquals(parseQuery("samedi"), { date: { kind: "weekday", weekday: 6 } });
  assertEquals(parseQuery("+3"), { date: { kind: "offset", days: 3 } });
  assertEquals(parseQuery("-7"), { date: { kind: "offset", days: -7 } });
  assertEquals(parseQuery("in 3 days"), { date: { kind: "offset", days: 3 } });
  assertEquals(parseQuery("dans 10 jours"), { date: { kind: "offset", days: 10 } });
  assertEquals(parseQuery("2 days ago"), { date: { kind: "offset", days: -2 } });
  assertEquals(parseQuery("48.85, 2.35 +3"), {
    coordinates: { latitude: 48.85, longitude: 2.35 },
    date: { kind: "offset", days: 3 },
  });
  // Words framing the question go, names that start like them stay.
  assertEquals(parseQuery("sunrise in New York"), { place: "New York" });
  assertEquals(parseQuery("lever du soleil à Paris demain"), { place: "Paris", date: { kind: "offset", days: 1 } });
  assertEquals(parseQuery("coucher de la lune à Nice"), { place: "Nice" });
  assertEquals(parseQuery("moon phase"), {});
  assertEquals(parseQuery("Le Mans"), { place: "Le Mans" });
  assertEquals(parseQuery("A Coruña"), { place: "A Coruña" });
  assertEquals(parseQuery("Lyon, France"), { place: "Lyon, France" });
  // Not dates.
  assertEquals(parseQuery("2026-02-30").error, "2026-02-30 is not a date");
  assertEquals(parseQuery("31 feb").error, "31 feb is not a date");
});

Deno.test("query: resolving a date against today", () => {
  const today = "2026-11-01"; // a Sunday
  assertEquals(resolveDate(undefined, today), today);
  assertEquals(resolveDate({ kind: "offset", days: 1 }, today), "2026-11-02");
  assertEquals(resolveDate({ kind: "weekday", weekday: 0 }, today), today);
  assertEquals(resolveDate({ kind: "weekday", weekday: 5 }, today), "2026-11-06");
  // The next one: June is next year, December this year.
  assertEquals(resolveDate({ kind: "monthDay", month: 6, day: 21 }, today), "2027-06-21");
  assertEquals(resolveDate({ kind: "monthDay", month: 12, day: 21 }, today), "2026-12-21");
  assertEquals(resolveDate({ kind: "monthDay", month: 11, day: 1 }, today), today);
  assertEquals(resolveDate({ kind: "day", day: "2020-01-01" }, today), "2020-01-01");
});

Deno.test("places: coordinates, labels and geocoding", () => {
  assertEquals(parseCoordinates("48.85, 2.35")?.latitude, 48.85);
  const south = parseCoordinates("33.87S, 151.21E")!;
  assertEquals([south.latitude, south.longitude], [-33.87, 151.21]);
  assertEquals(parseCoordinates("40.71N; 74.01W")?.longitude, -74.01);
  assertEquals(parseCoordinates("-12.5, -77.03")?.latitude, -12.5);
  assertEquals(parseCoordinates("21, 2026"), undefined);
  assertEquals(parseCoordinates("95.0, 10"), undefined);
  assertEquals(coordinatesPlace(48.85, 2.35).name, "48.8500, 2.3500");
  assertEquals(placeLabel(paris), "Paris, Île-de-France, France");
  assertEquals(splitPlace("Lyon, France"), { name: "Lyon", hint: "France" });
  const url = new URL(geocodingUrl("Lyon"));
  assertEquals(url.host, "geocoding-api.open-meteo.com");
  assertEquals(url.searchParams.get("name"), "Lyon");
  const ranked = rankPlaces([
    { name: "Paris", latitude: 33.66, longitude: -95.55, country: "United States", country_code: "US" },
    paris,
  ], "France");
  assertEquals(ranked[0], paris);
  assertStringIncludes(suncalcUrl(paris, "2026-12-21"), "/2026.12.21/");
});

Deno.test("formatting", () => {
  assertEquals(formatDuration(8 * HOUR + 15 * MINUTE), "8 h 15 min");
  assertEquals(formatDuration(16 * HOUR + 5 * MINUTE), "16 h 05 min");
  assertEquals(formatDuration(2 * HOUR), "2 h");
  assertEquals(formatDuration(42 * MINUTE), "42 min");
  assertEquals(formatChange(133_000), "+2 min 13 s");
  assertEquals(formatChange(-45_000), "−45 s");
  assertEquals(formatChange(200), "same length");
  assertEquals(compass(0), "N");
  assertEquals(compass(52), "NE");
  assertEquals(compass(236), "SW");
  assertEquals(compass(359), "N");
  const t = Date.parse("2024-06-21T15:30:00Z");
  assertEquals(formatTime(t, "Europe/Paris"), "17:30");
  assertEquals(formatTime(t, "Europe/Paris", "12h"), "5:30 PM");
  assertEquals(clockOf(true), "12h");
  assertEquals(clockOf(false), "24h");
  assertEquals(clockOf(undefined), "24h");
  assertEquals(formatDay("2026-12-21", "2026-11-01"), "Mon 21 Dec");
  assertEquals(formatDay("2027-06-21", "2026-11-01"), "Mon 21 Jun 2027");
  assertEquals(dayLabel("2026-11-02", "2026-11-01"), "Tomorrow, Mon 2 Nov");
  assertEquals(relative(t + 2 * HOUR + 10 * MINUTE, t), "in 2 h 10 min");
  assertEquals(relative(t - 3 * 86_400_000, t), "3 days ago");
  assertEquals(phaseName(0).name, "New Moon");
  assertEquals(phaseName(358).name, "New Moon");
  assertEquals(phaseName(45).name, "Waxing Crescent");
  assertEquals(phaseName(92).name, "First Quarter");
  assertEquals(phaseName(130).emoji, "🌔");
  assertEquals(phaseName(181).name, "Full Moon");
  assertEquals(phaseName(220).name, "Waning Gibbous");
  assertEquals(phaseName(270).name, "Last Quarter");
  assertEquals(phaseName(300).emoji, "🌘");
  assertEquals(shadow(45), "1.0 m");
  assertEquals(shadow(0.1), "very long");
});

Deno.test("items: a day in Paris", () => {
  const now = Date.parse("2024-06-21T14:00:00Z");
  const v = computeView(paris, "2024-06-21", now);
  assertEquals(v.today, "2024-06-21");
  const items = viewItems(v);
  const ids = items.map((i) => i.id);
  for (const id of ["now", "sunrise", "noon", "sunset", "length", "civil", "nautical", "astronomical", "phase"]) {
    assert(ids.includes(id), `missing ${id}`);
  }
  assertEquals(ids.filter((id) => id?.startsWith("golden:")).length, 2);
  assertEquals(ids.filter((id) => id?.startsWith("next:")).length, 4);
  const sunrise = items.find((i) => i.id === "sunrise")!;
  assertEquals(sunrise.accessories?.at(-1)?.tag, "05:47");
  assertEquals(sunrise.actions?.[0].title, "Copy Time");
  assertEquals(items.find((i) => i.id === "now")!.title, "54° above the horizon");
  assertStringIncludes(items.find((i) => i.id === "now")!.subtitle!, "Sets in");
  assertEquals(items.find((i) => i.id === "phase")!.title, "Full Moon");
  assertEquals(items[0].section, "Sun · Paris · Today, Fri 21 Jun");
  assertEquals(items.find((i) => i.id === "astronomical")!.accessories, [{ text: "None" }]);
  // Extra actions come after each item's own.
  const extra = viewItems(v, [{ title: "Next Day" } as never]);
  assertEquals(extra.find((i) => i.id === "length")!.actions?.at(-1)?.title, "Next Day");
  assertEquals(
    summaryText(v),
    "Paris, Today, Fri 21 Jun: sunrise 05:47, sunset 21:58 (16 h 11 min of daylight). Moon: Full Moon, 100 % lit.",
  );
  assertEquals(subtitle(v), "↑ 05:47 ↓ 21:58 · 🌕 100 % · Paris");
  assertEquals(v.week.length, 7);
  // Another day: no "now".
  const other = viewItems(computeView(paris, "2024-12-21", now));
  assert(!other.some((i) => i.id === "now"));
  assertEquals(other[0].section, "Sun · Paris · Sat 21 Dec");
});

Deno.test("items: polar night", () => {
  const v = computeView(tromso, "2024-12-21", Date.parse("2024-12-21T11:00:00Z"));
  const items = viewItems(v);
  const polar = items.find((i) => i.id === "polar")!;
  assertEquals(polar.title, "Polar Night");
  assertStringIncludes(polar.subtitle!, "It rises again on");
  assert(!items.some((i) => i.id === "sunrise"));
  assertStringIncludes(summaryText(v), "the Sun doesn't rise (polar night)");
  assertStringIncludes(subtitle(v), "Polar night");
});

Deno.test("manifest: one host, command files exist", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    extension: { id: string; categories: string[] };
    permissions: { net: string[] };
    commands: { name: string }[];
    preferences: { name: string }[];
  };
  assertEquals(manifest.extension.id, "sun-moon");
  assertEquals(manifest.extension.categories, ["everyday"]);
  assertEquals(manifest.permissions, { net: ["geocoding-api.open-meteo.com"] });
  assertEquals(manifest.preferences.map((p) => p.name), ["location", "hour12"]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
