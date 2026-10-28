import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  compass,
  condition,
  dayItem,
  daylight,
  dayName,
  forecastUrl,
  geocodingUrl,
  hourItem,
  nowItem,
  type Place,
  placeLabel,
  rankPlaces,
  shareText,
  splitQuery,
  summary,
  tempColor,
  toForecast,
  unitsOf,
  uvLabel,
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
  population: 2138551,
};

// Shaped like a real Open-Meteo answer (trimmed to 2 days).
const hours = Array.from({ length: 48 }, (_, i) => {
  const d = i < 24 ? "2026-10-28" : "2026-10-29";
  return `${d}T${String(i % 24).padStart(2, "0")}:00`;
});
const RESPONSE = {
  timezone: "Europe/Paris",
  current: {
    time: "2026-10-28T10:15",
    interval: 900,
    temperature_2m: 12.4,
    apparent_temperature: 10.1,
    relative_humidity_2m: 81,
    is_day: 1,
    weather_code: 2,
    wind_speed_10m: 14.8,
    wind_direction_10m: 225,
    wind_gusts_10m: 31.2,
    precipitation: 0,
    cloud_cover: 60,
    pressure_msl: 1016.3,
  },
  hourly: {
    time: hours,
    temperature_2m: hours.map((_, i) => 8 + (i % 24) / 2),
    apparent_temperature: hours.map((_, i) => 6 + (i % 24) / 2),
    precipitation_probability: hours.map((_, i) => (i * 7) % 100),
    precipitation: hours.map(() => 0.2),
    weather_code: hours.map((_, i) => (i % 2 ? 61 : 0)),
    wind_speed_10m: hours.map(() => 12),
    relative_humidity_2m: hours.map(() => 75),
    uv_index: hours.map(() => 2),
    is_day: hours.map((t) => (Number(t.slice(11, 13)) >= 8 && Number(t.slice(11, 13)) < 18 ? 1 : 0)),
  },
  daily: {
    time: ["2026-10-28", "2026-10-29"],
    weather_code: [2, 95],
    temperature_2m_max: [14.2, 11],
    temperature_2m_min: [7.1, -1.4],
    apparent_temperature_max: [12, 9],
    apparent_temperature_min: [5, -4],
    precipitation_probability_max: [20, 80],
    precipitation_sum: [0.4, 12.3],
    wind_speed_10m_max: [22, 40],
    wind_direction_10m_dominant: [230, 270],
    uv_index_max: [2.4, 6.5],
    sunrise: ["2026-10-28T07:21", "2026-10-29T07:23"],
    sunset: ["2026-10-28T17:45", "2026-10-29T17:43"],
  },
};

Deno.test("WMO codes map to glyphs, day and night", () => {
  assertEquals(condition(0), { label: "Clear sky", icon: "bs-sun", tint: "yellow" });
  assertEquals(condition(0, false).icon, "bs-moon");
  assertEquals(condition(2).icon, "bs-cloud-sun");
  assertEquals(condition(2, false).icon, "bs-cloud");
  assertEquals(condition(3).icon, "bs-cloud");
  assertEquals(condition(45).label, "Fog");
  assertEquals(condition(53).icon, "bs-droplet");
  assertEquals(condition(63).icon, "bs-cloud-rain");
  assertEquals(condition(81).icon, "bs-cloud-rain");
  assertEquals(condition(75).icon, "bs-snowflake");
  assertEquals(condition(86).icon, "bs-snowflake");
  assertEquals(condition(95).icon, "bs-bolt");
  assertEquals(condition(99).label, "Thunderstorm with heavy hail");
  assertEquals(condition(1, true, 60), { label: "Mainly clear, windy", icon: "bs-wind", tint: "teal" });
  // Wind never hides rain.
  assertEquals(condition(63, true, 80).icon, "bs-cloud-rain");
  assertEquals(condition(42).label, "Unknown");
});

Deno.test("formatting helpers", () => {
  assertEquals([compass(0), compass(225), compass(350), compass(-90)], ["N", "SW", "N", "W"]);
  assertEquals([tempColor(-3), tempColor(5), tempColor(15), tempColor(25), tempColor(33)], [
    "blue",
    "teal",
    "green",
    "orange",
    "red",
  ]);
  assertEquals(uvLabel(6.5), "7 · high");
  assertEquals(daylight("2026-10-28T07:21", "2026-10-28T17:45"), "10 h 24 min");
  assertEquals(dayName("2026-10-28", "2026-10-28"), "Today");
  assertEquals(dayName("2026-10-29", "2026-10-28"), "Tomorrow");
  assertEquals(dayName("2026-10-31", "2026-10-28"), "Saturday");
  assertEquals([unitsOf("Imperial"), unitsOf(undefined), unitsOf("metric")], ["imperial", "metric", "metric"]);
});

Deno.test("city queries", () => {
  assertEquals(splitQuery(" Lyon , France "), { name: "Lyon", hint: "France" });
  assertEquals(splitQuery("Paris"), { name: "Paris", hint: undefined });
  const texas = { ...paris, id: 1, country: "United States", country_code: "US", admin1: "Texas" };
  assertEquals(rankPlaces([texas, paris], "fr")[0].id, paris.id);
  assertEquals(rankPlaces([texas, paris], "texas")[0].id, 1);
  assertEquals(placeLabel(paris), "Paris, Île-de-France, France");
  assertEquals(placeLabel({ ...paris, admin1: "Paris" }), "Paris, France");
  assertStringIncludes(geocodingUrl("São Paulo"), "name=S%C3%A3o+Paulo");
});

Deno.test("forecast URL asks for everything shown, in the right units", () => {
  const metric = new URL(forecastUrl(48.85341, 2.3488, "metric"));
  assertEquals(metric.searchParams.get("latitude"), "48.8534");
  assertEquals(metric.searchParams.get("timezone"), "auto");
  assertStringIncludes(metric.searchParams.get("daily")!, "sunrise");
  assertStringIncludes(metric.searchParams.get("hourly")!, "precipitation_probability");
  assertEquals(metric.searchParams.get("temperature_unit"), null);
  const imperial = new URL(forecastUrl(1, 2, "imperial"));
  assertEquals(imperial.searchParams.get("temperature_unit"), "fahrenheit");
  assertEquals(imperial.searchParams.get("wind_speed_unit"), "mph");
});

Deno.test("response: 24 hours from the current one, 7 days", () => {
  const f = toForecast(RESPONSE, "metric");
  assertEquals(f.hours.length, 24);
  assertEquals(f.hours[0].time, "2026-10-28T10:00");
  assertEquals(f.hours[23].time, "2026-10-29T09:00");
  assertEquals(f.hours[0].isDay, true);
  assertEquals(f.hours[13].isDay, false);
  assertEquals(f.days.length, 2);
  assertEquals(f.days[1].min, -1.4);
  assertEquals(f.now.temp, 12.4);
  assertEquals(summary(f, paris), "12° Paris");
  assertEquals(shareText(f, paris), "Paris: 12° Partly cloudy, feels 10°, high 14° / low 7°");
  // Missing blocks don't throw.
  const empty = toForecast({ current: {}, hourly: {}, daily: {} }, "metric");
  assertEquals([empty.hours.length, empty.days.length, empty.now.isDay], [0, 0, true]);
});

Deno.test("items: current conditions as stats, hours and days with glyphs", () => {
  const f = toForecast(RESPONSE, "metric");
  const now = nowItem(f, paris, [], "Now");
  assertEquals(now.title, "12° Partly cloudy");
  assertEquals(now.icon, { source: "bs-cloud-sun", tint: "yellow" });
  assertEquals(now.detail?.stats?.map((s) => s.label), ["Temperature", "Feels like", "Wind", "Humidity"]);
  assertEquals(now.detail?.stats?.map((s) => s.value), ["12°", "10°", "15 km/h", "81 %"]);
  const labels = now.detail?.metadata?.map((m) => m.label) ?? [];
  assertEquals(labels.includes("Sunrise") && labels.includes("UV index"), true);

  const night = hourItem(f.hours[12], f, paris, []);
  assertEquals([night.title, night.icon], ["22:00", { source: "bs-moon", tint: "purple" }]);
  const rainy = hourItem(f.hours[1], f, paris, []);
  assertEquals(rainy.icon, { source: "bs-cloud-rain", tint: "blue" });
  assertEquals(rainy.accessories?.at(-1), { tag: "14°", color: "green" });

  const storm = dayItem(f.days[1], f, paris, []);
  assertEquals([storm.title, storm.subtitle], ["Tomorrow", "Thunderstorm"]);
  assertEquals(storm.icon, { source: "bs-bolt", tint: "orange" });
  assertEquals(storm.accessories?.[0].icon, { source: "bs-droplet", tint: "blue" });
  assertEquals(storm.detail?.stats?.find((s) => s.label === "Low")?.color, "blue");
});

Deno.test("imperial units", () => {
  const f = toForecast(RESPONSE, "imperial");
  const now = nowItem(f, paris, []);
  assertEquals(now.detail?.stats?.[2].value, "15 mph");
  // 12.4 °F is below freezing.
  assertEquals(now.detail?.stats?.[0].color, "blue");
});
