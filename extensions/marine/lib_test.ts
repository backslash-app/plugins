import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  angle,
  bestHours,
  compass,
  type Conditions,
  dayName,
  height,
  hourOf,
  marineUrl,
  parseCoordinates,
  placeKey,
  rankPlaces,
  shareText,
  speed,
  splitQuery,
  summary,
  surf,
  swellText,
  temperature,
  toSea,
  unitsOf,
  windRelation,
  windUnitOf,
  windUrl,
} from "./lib.ts";

const fixture = async (name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url)));

// Biarritz, fetched on November 1, 2026 at 18:30 local time. The wind fixture is shaped like the forecast API's.
const biarritz = async (hours = 24) => toSea(await fixture("marine.json"), await fixture("wind.json"), hours);

Deno.test("marine: request URLs", () => {
  const m = new URL(marineUrl(43.48, -1.56));
  assertEquals(m.host, "marine-api.open-meteo.com");
  assertEquals(m.searchParams.get("cell_selection"), "sea");
  assertEquals(m.searchParams.get("timezone"), "auto");
  for (const p of ["wave_height", "swell_wave_period", "sea_surface_temperature", "ocean_current_velocity"]) {
    assert(m.searchParams.get("current")!.split(",").includes(p), p);
  }
  assert(m.searchParams.get("daily")!.includes("swell_wave_height_max"));
  const w = new URL(windUrl(43.48, -1.56));
  assertEquals(w.host, "api.open-meteo.com");
  assert(w.searchParams.get("daily")!.includes("sunrise"));
});

Deno.test("marine: parsing the sea and wind", async () => {
  const s = await biarritz();
  assertEquals(s.inland, false);
  assertEquals(s.timezone, "Europe/Paris");
  assertEquals(s.now.waveHeight, 1.42);
  assertEquals(s.now.swellPeriod, 10.1);
  assertEquals(s.now.seaTemperature, 17.6);
  assertEquals(s.now.currentDirection, 270);
  assertEquals(s.now.wind, 9.2);
  assertEquals(s.now.windDirection, 115);
  // From the current hour, wind matched by time.
  assertEquals(s.hours.length, 24);
  assertEquals(s.hours[0].time, "2026-11-01T18:00");
  assertEquals(s.hours[0].wind, 8.8);
  assertEquals(s.hours.at(-1)!.time, "2026-11-02T17:00");
  assertEquals(s.days.map((d) => d.date), ["2026-11-01", "2026-11-02", "2026-11-03"]);
  assertEquals(s.days[1].swellHeight, 1.26);
  assertEquals(s.days[1].gusts, 41.2);
  assertEquals(s.days[0].sunset, "2026-11-01T18:03");
});

Deno.test("marine: inland places and missing wind", async () => {
  const inland = toSea(await fixture("inland.json"));
  assertEquals(inland.inland, true);
  assertEquals(inland.now.waveHeight, undefined);
  // Waves without the wind request still parse.
  const s = toSea(await fixture("marine.json"));
  assertEquals(s.inland, false);
  assertEquals(s.now.wind, undefined);
  assertEquals(s.days[0].wind, undefined);
  assertEquals(toSea({}).inland, true);
});

Deno.test("marine: directions", () => {
  assertEquals(compass(0), "N");
  assertEquals(compass(306), "NW");
  assertEquals(compass(292), "WNW");
  assertEquals(compass(359), "N");
  assertEquals(compass(-90), "W");
  assertEquals(angle(350, 10), 20);
  assertEquals(angle(90, 270), 180);
  // Swell from the west-northwest; wind from the east-southeast blows from the land.
  assertEquals(windRelation(115, 304), "offshore");
  assertEquals(windRelation(290, 304), "onshore");
  assertEquals(windRelation(30, 304), "cross-shore");
});

Deno.test("marine: units", () => {
  assertEquals(unitsOf("Imperial"), "imperial");
  assertEquals(unitsOf(undefined), "metric");
  assertEquals(windUnitOf("knots"), "knots");
  assertEquals(windUnitOf("kts"), "knots");
  assertEquals(windUnitOf("m/s"), "ms");
  assertEquals(windUnitOf("MPH"), "mph");
  assertEquals(windUnitOf(""), "kmh");
  assertEquals(height(1.42, "metric"), "1.4 m");
  assertEquals(height(1.42, "imperial"), "4.7 ft");
  assertEquals(height(undefined, "metric"), "—");
  assertEquals(temperature(17.6, "metric"), "17.6 °C");
  assertEquals(temperature(17.6, "imperial"), "64 °F");
  assertEquals(speed(18.52, "knots"), "10 kn");
  assertEquals(speed(36, "ms"), "10.0 m/s");
  assertEquals(speed(16.09, "mph"), "10 mph");
  assertEquals(speed(9.2, "kmh"), "9 km/h");
  assertEquals(swellText(1.38, 10.1, 304, "metric"), "1.4 m · 10 s · NW");
  assertEquals(swellText(1.38, undefined, undefined, "metric"), "1.4 m");
});

Deno.test("marine: surf rating", async () => {
  // Biarritz now: 1.4 m at 10 s with a light offshore breeze.
  const now = surf((await biarritz()).now)!;
  assertEquals(now.label, "Very good");
  assertEquals(now.relation, "offshore");
  assertEquals(surf({ waveHeight: 0.2 })?.label, "Flat");
  assertEquals(surf({}), undefined);
  // Long period, glassy: epic.
  assertEquals(surf({ waveHeight: 1.8, swellHeight: 1.6, swellPeriod: 14, wind: 4 })?.label, "Epic");
  // Same swell blown out by a strong onshore wind.
  const blown = surf({
    waveHeight: 1.8,
    swellHeight: 1.6,
    swellPeriod: 14,
    swellDirection: 300,
    wind: 35,
    windDirection: 290,
  })!;
  assertEquals(blown.label, "Fair");
  assert(blown.notes.includes("Onshore wind: choppy"));
  // Short wind swell.
  assertEquals(surf({ waveHeight: 0.8, wavePeriod: 5, wind: 15, windDirection: 0, waveDirection: 90 })?.label, "Poor");
  // Big days come with a warning.
  assert(surf({ waveHeight: 4, swellPeriod: 15, wind: 5 })!.notes.includes("Big waves: experienced surfers only"));
  // Never below Poor once there are waves.
  assertEquals(surf({ waveHeight: 0.4, wavePeriod: 5, wind: 50, windDirection: 0, waveDirection: 0 })?.score, 1);
});

Deno.test("marine: best hours", async () => {
  const s = await biarritz(72);
  const day = s.days[1];
  const best = bestHours(s.hours.filter((h) => h.time.startsWith(day.date)), day.sunrise, day.sunset);
  assertEquals(best.map((h) => h.time), ["2026-11-02T08:00"]);
  // Only daylight hours count.
  const night: Conditions[] = [{ time: "2026-11-02T03:00", waveHeight: 2, swellPeriod: 14, wind: 2 }];
  assertEquals(bestHours(night, day.sunrise, day.sunset), []);
  // The longest run of the best rating.
  const hours: Conditions[] = ["10", "11", "12", "13"].map((h, i) => ({
    time: `2026-11-02T${h}:00`,
    waveHeight: 1.5,
    swellPeriod: 13,
    wind: i === 0 ? 30 : 3,
  }));
  assertEquals(bestHours(hours).map((h) => hourOf(h.time)), ["11:00", "12:00", "13:00"]);
});

Deno.test("marine: text", async () => {
  const s = await biarritz();
  assertEquals(summary(s, "metric", "knots"), "1.4 m · 10 s · NW · wind 5 kn ESE · water 17.6 °C · Very good");
  const place = { id: 3_032_797, name: "Biarritz", latitude: 43.48, longitude: -1.56 };
  assert(shareText(s, place, "metric", "kmh").startsWith("Biarritz now: 1.4 m"));
  assertEquals(dayName("2026-11-01", "2026-11-01"), "Today");
  assertEquals(dayName("2026-11-02", "2026-11-01"), "Tomorrow");
  assertEquals(dayName("2026-11-03", "2026-11-01"), "Tuesday 3 November");
});

Deno.test("marine: places", () => {
  const spot = parseCoordinates("43.66, -1.44")!;
  assertEquals(spot.latitude, 43.66);
  assertEquals(placeKey(spot), "43.660,-1.440");
  assertEquals(placeKey({ id: 42, name: "X", latitude: 0, longitude: 0 }), "42");
  assertEquals(parseCoordinates("Hossegor"), undefined);
  assertEquals(parseCoordinates("120, 0"), undefined);
  assertEquals(splitQuery("Hossegor, France"), { name: "Hossegor", hint: "France" });
  const places = [
    { id: 1, name: "Newport", latitude: 41.49, longitude: -71.31, country: "United States", country_code: "US" },
    { id: 2, name: "Newport", latitude: 50.58, longitude: -4.99, country: "United Kingdom", country_code: "GB" },
  ];
  assertEquals(rankPlaces(places, "GB").map((p) => p.id), [2, 1]);
});

Deno.test("marine: manifest", async () => {
  // deno-lint-ignore no-explicit-any
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(m.extension.id, "marine");
  assertEquals(m.extension.version, "1.0.0");
  assertEquals(m.extension.categories, ["everyday"]);
  assertEquals(m.permissions.net, ["geocoding-api.open-meteo.com", "marine-api.open-meteo.com", "api.open-meteo.com"]);
  assertEquals(m.commands.map((c: { title: string }) => c.title), ["Marine & Surf"]);
  const keywords: string[] = m.commands[0].keywords;
  assertEquals(new Set(keywords).size, keywords.length);
});
