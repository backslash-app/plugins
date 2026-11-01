import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  addHour,
  airQualityUrl,
  amount,
  aqiOf,
  aqiText,
  bestWindow,
  CURRENT,
  dayItem,
  dayName,
  dominant,
  geocodingUrl,
  hourItem,
  HOURLY,
  level,
  nowItem,
  type Place,
  placeLabel,
  POLLEN,
  pollenItems,
  pollenLevel,
  pollenSummary,
  pollutantItems,
  rankPlaces,
  type Reading,
  scaleOf,
  shareText,
  splitQuery,
  summary,
  toAirQuality,
  uvLabel,
  worstHour,
} from "./lib.ts";

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

const denver: Place = {
  id: 5419384,
  name: "Denver",
  latitude: 39.73915,
  longitude: -104.9847,
  country: "United States",
  country_code: "US",
  admin1: "Colorado",
};

// Shaped like a real Open-Meteo answer, trimmed to 3 days. The European
// index is 30 at night, climbs to 70 at 18:00 and falls back; ozone drives
// the afternoon, PM2.5 the rest.
const times = Array.from({ length: 72 }, (_, i) => {
  const d = ["2026-10-28", "2026-10-29", "2026-10-30"][Math.floor(i / 24)];
  return `${d}T${String(i % 24).padStart(2, "0")}:00`;
});
const hour = (i: number) => i % 24;
const eu = (i: number) => (i >= 48 ? 15 : 30 + Math.max(0, 40 - Math.abs(hour(i) - 18) * 8));
const pollen = (i: number) => (i < 24 ? 120 : i < 48 ? 8 : null);

function series(f: (i: number) => number | null) {
  return times.map((_, i) => f(i));
}

const RESPONSE = {
  timezone: "Europe/Paris",
  current: {
    time: "2026-10-28T10:00",
    interval: 3600,
    european_aqi: 32,
    us_aqi: 58,
    pm2_5: 12.34,
    pm10: 20.1,
    ozone: 61,
    nitrogen_dioxide: 25.6,
    sulphur_dioxide: 2.1,
    carbon_monoxide: 230,
    european_aqi_pm2_5: 32,
    european_aqi_pm10: 21,
    european_aqi_ozone: 28,
    european_aqi_nitrogen_dioxide: 14,
    european_aqi_sulphur_dioxide: 1,
    us_aqi_pm2_5: 58,
    us_aqi_pm10: 18,
    us_aqi_ozone: 30,
    us_aqi_nitrogen_dioxide: 12,
    us_aqi_sulphur_dioxide: 1,
    us_aqi_carbon_monoxide: 3,
    uv_index: 2.4,
    dust: 0,
    alder_pollen: 0,
    birch_pollen: 120,
    olive_pollen: 0,
    grass_pollen: 6,
    mugwort_pollen: null,
    ragweed_pollen: 0,
  },
  hourly: {
    time: times,
    european_aqi: series(eu),
    us_aqi: series((i) => eu(i) * 2),
    pm2_5: series((i) => eu(i) / 3),
    pm10: series(() => 20),
    ozone: series((i) => (hour(i) >= 12 ? 120 : 40)),
    nitrogen_dioxide: series(() => 20),
    sulphur_dioxide: series(() => 2),
    carbon_monoxide: series(() => 200),
    european_aqi_pm2_5: series((i) => (hour(i) >= 12 ? eu(i) - 10 : eu(i))),
    european_aqi_ozone: series((i) => (hour(i) >= 12 ? eu(i) : 10)),
    us_aqi_pm2_5: series((i) => (hour(i) >= 12 ? eu(i) * 2 - 20 : eu(i) * 2)),
    us_aqi_ozone: series((i) => (hour(i) >= 12 ? eu(i) * 2 : 20)),
    uv_index: series((i) => (hour(i) >= 8 && hour(i) <= 17 ? 3 : 0)),
    birch_pollen: series(pollen),
    grass_pollen: series((i) => (i < 48 ? 6 : null)),
    alder_pollen: series(() => null),
    olive_pollen: series(() => null),
    mugwort_pollen: series(() => null),
    ragweed_pollen: series(() => null),
  },
};

// Outside Europe: no pollen fields at all.
const US_RESPONSE = {
  timezone: "America/Denver",
  current: { ...RESPONSE.current, time: "2026-10-28T10:00" },
  hourly: Object.fromEntries(Object.entries(RESPONSE.hourly).filter(([k]) => !k.endsWith("_pollen"))),
};
for (const p of POLLEN) (US_RESPONSE.current as Record<string, unknown>)[p.key] = null;

Deno.test("manifest: id, version and narrow permissions", async () => {
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(m.extension.id, "air-quality");
  assertEquals(m.extension.version, "1.0.0");
  assertEquals(m.extension.categories, ["everyday"]);
  assertEquals(m.permissions.net, ["geocoding-api.open-meteo.com", "air-quality-api.open-meteo.com"]);
  assertEquals(m.commands.map((c: { title: string }) => c.title), ["Air Quality"]);
  const keywords: string[] = m.commands[0].keywords;
  assertEquals(new Set(keywords).size, keywords.length);
});

Deno.test("scale preference", () => {
  assertEquals(scaleOf(undefined), "european");
  assertEquals(scaleOf("european"), "european");
  assertEquals(scaleOf("EU"), "european");
  assertEquals(scaleOf("us"), "us");
  assertEquals(scaleOf(" US AQI "), "us");
  assertEquals(scaleOf("U.S.A."), "us");
  assertEquals(scaleOf("EPA"), "us");
});

Deno.test("European levels", () => {
  assertEquals(level(0, "european").label, "Good");
  assertEquals(level(20, "european").label, "Good");
  assertEquals(level(21, "european").label, "Fair");
  assertEquals(level(40, "european").label, "Fair");
  assertEquals(level(55, "european").label, "Moderate");
  assertEquals(level(61, "european").label, "Poor");
  assertEquals(level(100, "european").label, "Very poor");
  assertEquals(level(140, "european").label, "Extremely poor");
  assertEquals(level(140, "european").rank, 5);
  assertEquals(level(10, "european").color, "green");
  assertEquals(level(70, "european").color, "orange");
  assertStringIncludes(level(150, "european").sensitive, "Avoid");
  // A band never leaks its upper bound.
  assert(!("max" in level(10, "european")));
});

Deno.test("US levels", () => {
  assertEquals(level(50, "us").label, "Good");
  assertEquals(level(51, "us").label, "Moderate");
  assertEquals(level(101, "us").label, "Unhealthy for sensitive groups");
  assertEquals(level(151, "us").label, "Unhealthy");
  assertEquals(level(250, "us").label, "Very unhealthy");
  assertEquals(level(400, "us").label, "Hazardous");
  assertEquals(level(400, "us").color, "pink");
  assertEquals(level(120, "us").color, "orange");
  assertStringIncludes(level(120, "us").sensitive, "Reduce prolonged");
});

Deno.test("pollen levels by kind", () => {
  assertEquals(pollenLevel(0, "tree").label, "None");
  assertEquals(pollenLevel(10, "tree").label, "Low");
  assertEquals(pollenLevel(50, "tree").label, "Moderate");
  assertEquals(pollenLevel(120, "tree").label, "High");
  assertEquals(pollenLevel(2000, "tree").label, "Very high");
  assertEquals(pollenLevel(10, "grass").label, "Moderate");
  assertEquals(pollenLevel(30, "grass").label, "High");
  assertEquals(pollenLevel(300, "weed").label, "High");
  assertEquals(pollenLevel(600, "weed").label, "Very high");
});

Deno.test("UV", () => {
  assertEquals(uvLabel(2.4), "2 · low");
  assertEquals(uvLabel(7), "7 · high");
  assertEquals(uvLabel(11.2), "11 · extreme");
});

Deno.test("URLs", () => {
  const u = new URL(airQualityUrl(48.85341, 2.3488));
  assertEquals(u.host, "air-quality-api.open-meteo.com");
  assertEquals(u.pathname, "/v1/air-quality");
  assertEquals(u.searchParams.get("latitude"), "48.8534");
  assertEquals(u.searchParams.get("timezone"), "auto");
  assertEquals(u.searchParams.get("forecast_days"), "5");
  const current = u.searchParams.get("current")!.split(",");
  for (const f of ["european_aqi", "us_aqi", "pm2_5", "ozone", "uv_index", "birch_pollen", "us_aqi_carbon_monoxide"]) {
    assert(current.includes(f), f);
  }
  assertEquals(new Set(CURRENT).size, CURRENT.length);
  assertEquals(new Set(HOURLY).size, HOURLY.length);
  const g = new URL(geocodingUrl("Lyon"));
  assertEquals(g.host, "geocoding-api.open-meteo.com");
  assertEquals(g.searchParams.get("name"), "Lyon");
});

Deno.test("queries and places", () => {
  assertEquals(splitQuery("Lyon, France"), { name: "Lyon", hint: "France" });
  assertEquals(splitQuery("  Paris "), { name: "Paris", hint: undefined });
  const places = [{ ...paris, country: "United States", country_code: "US", admin1: "Texas", id: 1 }, paris];
  assertEquals(rankPlaces(places, "fr")[0].id, paris.id);
  assertEquals(rankPlaces(places)[0].id, 1);
  assertEquals(placeLabel(paris), "Paris, Île-de-France, France");
});

Deno.test("toAirQuality: current, hours from now, today and days", () => {
  const a = toAirQuality(RESPONSE, "european");
  assertEquals(a.timezone, "Europe/Paris");
  assertEquals(a.now.values.european_aqi, 32);
  assertEquals(a.now.values.mugwort_pollen, undefined);
  assertEquals(a.hours.length, 24);
  assertEquals(a.hours[0].time, "2026-10-28T10:00");
  assertEquals(a.today.length, 14);
  assertEquals(a.today.at(-1)!.time, "2026-10-28T23:00");
  assertEquals(a.days.map((d) => d.date), ["2026-10-28", "2026-10-29", "2026-10-30"]);
  const d0 = a.days[0];
  assertEquals(d0.max, 70);
  assertEquals(d0.min, 30);
  assertEquals(d0.worst, "2026-10-28T18:00");
  assertEquals(d0.dominant?.short, "O₃");
  assertEquals(d0.uv, 3);
  assertEquals(d0.pollen.birch_pollen, 120);
  assertEquals(a.days[2].pollen, {});
  assertEquals(a.days[2].max, 15);
  assert(a.hasPollen);
});

Deno.test("toAirQuality: US scale and no pollen", () => {
  const a = toAirQuality(US_RESPONSE, "us");
  assertEquals(aqiOf(a.now, "us"), 58);
  assertEquals(a.days[0].max, 140);
  assert(!a.hasPollen);
  assertEquals(a.days[0].pollen, {});
});

Deno.test("toAirQuality: an empty or partial answer does not throw", () => {
  const a = toAirQuality({}, "european");
  assertEquals(a.hours, []);
  assertEquals(a.days, []);
  assertEquals(aqiOf(a.now, "european"), undefined);
  assert(!a.hasPollen);
  assertEquals(nowItem(a, paris, []).title, "No air quality data");
});

Deno.test("dominant pollutant", () => {
  const a = toAirQuality(RESPONSE, "european");
  assertEquals(dominant(a.now, "european")?.short, "PM2.5");
  assertEquals(dominant(a.hours[8], "european")?.short, "O₃"); // 18:00
  assertEquals(dominant({ time: "", values: {} }, "us"), undefined);
});

Deno.test("best window and worst hour", () => {
  const a = toAirQuality(RESPONSE, "european");
  const best = bestWindow(a.today, "european")!;
  assertEquals(best.start, "2026-10-28T10:00");
  assertEquals(best.end, "2026-10-28T13:00");
  assertEquals(best.average, 30);
  assertEquals(worstHour(a.today, "european")?.time, "2026-10-28T18:00");
  // Fewer hours than the window.
  assertEquals(bestWindow(a.today.slice(0, 2), "european"), undefined);
  // Gaps are skipped.
  const gappy: Reading[] = [
    { time: "2026-10-28T20:00", values: { european_aqi: 10 } },
    { time: "2026-10-28T21:00", values: {} },
    { time: "2026-10-28T22:00", values: { european_aqi: 50 } },
    { time: "2026-10-28T23:00", values: { european_aqi: 40 } },
  ];
  assertEquals(bestWindow(gappy, "european", 2)?.start, "2026-10-28T22:00");
  assertEquals(addHour("2026-10-28T23:00"), "2026-10-29T00:00");
});

Deno.test("formatting", () => {
  assertEquals(amount(12.34, "μg/m³"), "12.3 μg/m³");
  assertEquals(amount(230.4, "μg/m³"), "230 μg/m³");
  assertEquals(aqiText(32.4, "european"), "AQI 32 · Fair");
  assertEquals(dayName("2026-10-28", "2026-10-28"), "Today");
  assertEquals(dayName("2026-10-29", "2026-10-28"), "Tomorrow");
  assertEquals(dayName("2026-10-30", "2026-10-28"), "Friday");
  assertEquals(pollenSummary({ birch_pollen: 120, grass_pollen: 6, alder_pollen: 0 }), "Birch high, Grass moderate");
  assertEquals(pollenSummary({ birch_pollen: 3 }), "");
});

Deno.test("summary and share text", () => {
  const a = toAirQuality(RESPONSE, "european");
  assertEquals(summary(a, paris), "AQI 32 Fair · Paris");
  assertEquals(
    shareText(a, paris),
    "Paris: European AQI 32 (Fair), mostly fine particles. Pollen: Birch high, Grass moderate",
  );
  const us = toAirQuality(US_RESPONSE, "us");
  assertEquals(shareText(us, denver), "Denver: US AQI 58 (Moderate), mostly fine particles");
});

Deno.test("now item", () => {
  const a = toAirQuality(RESPONSE, "european");
  const item = nowItem(a, paris, [], "Now");
  assertEquals(item.title, "AQI 32 · Fair");
  assertEquals(item.icon, { source: "bs-wind", tint: "teal" });
  assertEquals(item.detail?.stats?.[0], { label: "European AQI", value: 32, color: "teal" });
  assertStringIncludes(item.detail!.markdown!, "Enjoy your usual outdoor activities");
  const lines = Object.fromEntries(item.detail!.metadata!.map((m) => [m.label, m.value]));
  assertEquals(lines["US AQI"], "AQI 58 · Moderate");
  assertEquals(lines["Main pollutant"], "Fine particles (PM2.5)");
  assertEquals(lines["Best time outside"], "10:00–13:00 · AQI 30");
  assertEquals(lines["Worst today"], "18:00 · AQI 70 · Poor");
  assertEquals(lines["Pollen"], "Birch high, Grass moderate");

  const us = nowItem(toAirQuality(US_RESPONSE, "us"), denver, []);
  const usLines = Object.fromEntries(us.detail!.metadata!.map((m) => [m.label, m.value]));
  assertEquals(usLines["Pollen"], "Not forecast here (Europe only)");
  assertEquals(us.detail?.stats?.[0].label, "US AQI");
});

Deno.test("pollutant items", () => {
  const items = pollutantItems(toAirQuality(RESPONSE, "european"), paris, []);
  assertEquals(items.map((i) => i.subtitle), ["PM2.5", "PM10", "O₃", "NO₂", "SO₂", "CO"]);
  assertEquals(items[0].accessories?.[0].text, "12.3 μg/m³");
  assertEquals(items[0].accessories?.[1], { tag: "Fair", color: "teal" });
  // Carbon monoxide has no European sub-index: its level comes from the US one, and says so.
  const co = items[5];
  assertEquals(co.accessories?.[1], { tag: "Good", color: "green" });
  assert(co.detail!.metadata!.some((m) => m.label === "Note" && m.value?.includes("US AQI")));
});

Deno.test("pollen items", () => {
  const items = pollenItems(toAirQuality(RESPONSE, "european"), paris, []);
  assertEquals(items.map((i) => i.title), ["Alder", "Birch", "Olive", "Grass", "Ragweed"]);
  const birch = items[1];
  assertEquals(birch.accessories?.[1], { tag: "High", color: "orange" });
  const lines = Object.fromEntries(birch.detail!.metadata!.map((m) => [m.label, m.value]));
  assertEquals(lines["Tomorrow"], "Low");
  const none = pollenItems(toAirQuality(US_RESPONSE, "us"), denver, []);
  assertEquals(none.length, 1);
  assertEquals(none[0].title, "No pollen forecast here");
});

Deno.test("hour and day items", () => {
  const a = toAirQuality(RESPONSE, "european");
  const h = hourItem(a.hours[8], a, paris, []);
  assertEquals(h.title, "18:00");
  assertEquals(h.subtitle, "Poor");
  assertEquals(h.accessories?.at(-1), { tag: "70", color: "orange" });
  const d = dayItem(a.days[1], a, paris, []);
  assertEquals(d.title, "Tomorrow");
  assertEquals(d.subtitle, "Up to poor");
  const last = dayItem(a.days[2], a, paris, []);
  assertEquals(last.title, "Friday");
  assertEquals(last.subtitle, "Up to good");
  assert(last.detail!.metadata!.some((m) => m.value === "Not forecast this far"));
});
