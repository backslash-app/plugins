// Open-Meteo: request URLs, WMO weather codes and the mapping from a
// forecast to launcher items. Pure, tested in lib_test.ts.

import { type Action, type Color, Icons, type Item, meta, type Metadata, type Stat } from "@backslash/api";

export type Units = "metric" | "imperial";

export function unitsOf(pref: unknown): Units {
  return String(pref ?? "").trim().toLowerCase().startsWith("imp") ? "imperial" : "metric";
}

/** A city found by the geocoding API. */
export interface Place {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country?: string;
  country_code?: string;
  admin1?: string;
  timezone?: string;
  population?: number;
  elevation?: number;
}

/** "Lyon, Auvergne-Rhône-Alpes, France". */
export function placeLabel(p: Place): string {
  return [p.name, p.admin1 !== p.name ? p.admin1 : undefined, p.country].filter(Boolean).join(", ");
}

export function geocodingUrl(name: string, count = 8, language = "en"): string {
  const q = new URLSearchParams({ name, count: String(count), language, format: "json" });
  return `https://geocoding-api.open-meteo.com/v1/search?${q}`;
}

/** "Lyon, France" → search "Lyon", keep results in France first. */
export function splitQuery(query: string): { name: string; hint?: string } {
  const [name, ...rest] = query.split(",").map((s) => s.trim()).filter(Boolean);
  return { name: name ?? "", hint: rest.join(" ") || undefined };
}

export function rankPlaces(places: Place[], hint?: string): Place[] {
  if (!hint) return places;
  const h = hint.toLowerCase();
  const matches = (p: Place) =>
    [p.country, p.country_code, p.admin1].some((v) => v && (v.toLowerCase() === h || v.toLowerCase().startsWith(h)));
  return [...places.filter(matches), ...places.filter((p) => !matches(p))];
}

export const CURRENT = [
  "temperature_2m",
  "apparent_temperature",
  "relative_humidity_2m",
  "is_day",
  "weather_code",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "precipitation",
  "cloud_cover",
  "pressure_msl",
];
export const HOURLY = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation_probability",
  "precipitation",
  "weather_code",
  "wind_speed_10m",
  "relative_humidity_2m",
  "uv_index",
  "is_day",
];
export const DAILY = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "apparent_temperature_max",
  "apparent_temperature_min",
  "precipitation_probability_max",
  "precipitation_sum",
  "wind_speed_10m_max",
  "wind_direction_10m_dominant",
  "uv_index_max",
  "sunrise",
  "sunset",
];

export function forecastUrl(lat: number, lon: number, units: Units): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: CURRENT.join(","),
    hourly: HOURLY.join(","),
    daily: DAILY.join(","),
    timezone: "auto",
    forecast_days: "7",
  });
  if (units === "imperial") {
    q.set("temperature_unit", "fahrenheit");
    q.set("wind_speed_unit", "mph");
    q.set("precipitation_unit", "inch");
  }
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** The parts of an Open-Meteo forecast response we use. */
export interface ForecastResponse {
  timezone?: string;
  current: Record<string, number | string>;
  hourly: Record<string, (number | string | null)[]>;
  daily: Record<string, (number | string | null)[]>;
}

// ---------------------------------------------------------------------------
// WMO weather codes

export interface Condition {
  label: string;
  icon: string;
  tint: Color;
}

const WMO: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Freezing fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Heavy drizzle",
  56: "Freezing drizzle",
  57: "Heavy freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with heavy hail",
};

/** Above this (km/h), a dry sky shows the wind glyph instead. */
const WINDY_KMH = 45;

/**
 * Label, glyph and tint of a WMO code. Clear nights show the moon; a dry,
 * very windy sky shows the wind.
 */
export function condition(code: number, isDay = true, windKmh = 0): Condition {
  const label = WMO[code] ?? "Unknown";
  const dry = code <= 3;
  if (dry && windKmh >= WINDY_KMH) return { label: `${label}, windy`, icon: Icons.wind, tint: "teal" };
  if (code <= 1) {
    return isDay ? { label, icon: Icons.sun, tint: "yellow" } : { label, icon: Icons.moon, tint: "purple" };
  }
  // No "cloud-moon" glyph: partly cloudy nights use the plain cloud.
  if (code === 2) {
    return isDay ? { label, icon: Icons.cloudSun, tint: "yellow" } : { label, icon: Icons.cloud, tint: "gray" };
  }
  if (code === 3 || code === 45 || code === 48) return { label, icon: Icons.cloud, tint: "gray" };
  if (code >= 51 && code <= 57) return { label, icon: Icons.droplet, tint: "teal" };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { label, icon: Icons.cloudRain, tint: "blue" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { label, icon: Icons.snowflake, tint: "teal" };
  if (code >= 95) return { label, icon: Icons.bolt, tint: "orange" };
  return { label, icon: Icons.cloud, tint: "gray" };
}

/** Colors a temperature, in °C. */
export function tempColor(celsius: number): Color {
  if (celsius <= 0) return "blue";
  if (celsius < 10) return "teal";
  if (celsius < 20) return "green";
  if (celsius < 28) return "orange";
  return "red";
}

export function uvColor(uv: number): Color {
  if (uv < 3) return "green";
  if (uv < 6) return "yellow";
  if (uv < 8) return "orange";
  if (uv < 11) return "red";
  return "purple";
}

export function uvLabel(uv: number): string {
  const level = uv < 3 ? "low" : uv < 6 ? "moderate" : uv < 8 ? "high" : uv < 11 ? "very high" : "extreme";
  return `${Math.round(uv)} · ${level}`;
}

const COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export function compass(degrees: number): string {
  return COMPASS[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

// ---------------------------------------------------------------------------
// The model shown by the command

export interface Hour {
  time: string;
  temp: number;
  feels: number;
  precipProb: number;
  precip: number;
  code: number;
  wind: number;
  humidity: number;
  uv: number;
  isDay: boolean;
}

export interface Day {
  date: string;
  code: number;
  max: number;
  min: number;
  feelsMax: number;
  feelsMin: number;
  precipProb: number;
  precip: number;
  wind: number;
  windDir: number;
  uv: number;
  sunrise: string;
  sunset: string;
}

export interface Forecast {
  units: Units;
  timezone?: string;
  now: {
    time: string;
    temp: number;
    feels: number;
    humidity: number;
    isDay: boolean;
    code: number;
    wind: number;
    windDir: number;
    gusts: number;
    precip: number;
    clouds: number;
    pressure: number;
  };
  hours: Hour[];
  days: Day[];
}

const num = (v: unknown, fallback = 0) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const str = (v: unknown) => typeof v === "string" ? v : "";

/** The response as plain records, hourly values from the current hour on (24 of them). */
export function toForecast(res: ForecastResponse, units: Units, hours = 24): Forecast {
  const c = res.current ?? {};
  const h = res.hourly ?? {};
  const d = res.daily ?? {};
  const nowTime = str(c.time);
  const thisHour = nowTime.slice(0, 13); // "2026-10-28T10"
  const times = (h.time ?? []).map(str);
  let start = times.findIndex((t) => t.slice(0, 13) >= thisHour);
  if (start < 0) start = 0;
  const at = (key: string, i: number) => num(h[key]?.[i]);
  const hourList: Hour[] = times.slice(start, start + hours).map((time, k) => {
    const i = start + k;
    return {
      time,
      temp: at("temperature_2m", i),
      feels: at("apparent_temperature", i),
      precipProb: at("precipitation_probability", i),
      precip: at("precipitation", i),
      code: at("weather_code", i),
      wind: at("wind_speed_10m", i),
      humidity: at("relative_humidity_2m", i),
      uv: at("uv_index", i),
      isDay: at("is_day", i) === 1,
    };
  });
  const dayAt = (key: string, i: number) => num(d[key]?.[i]);
  const days: Day[] = (d.time ?? []).map((date, i) => ({
    date: str(date),
    code: dayAt("weather_code", i),
    max: dayAt("temperature_2m_max", i),
    min: dayAt("temperature_2m_min", i),
    feelsMax: dayAt("apparent_temperature_max", i),
    feelsMin: dayAt("apparent_temperature_min", i),
    precipProb: dayAt("precipitation_probability_max", i),
    precip: dayAt("precipitation_sum", i),
    wind: dayAt("wind_speed_10m_max", i),
    windDir: dayAt("wind_direction_10m_dominant", i),
    uv: dayAt("uv_index_max", i),
    sunrise: str(d.sunrise?.[i]),
    sunset: str(d.sunset?.[i]),
  }));
  return {
    units,
    timezone: res.timezone,
    now: {
      time: nowTime,
      temp: num(c.temperature_2m),
      feels: num(c.apparent_temperature),
      humidity: num(c.relative_humidity_2m),
      isDay: num(c.is_day, 1) === 1,
      code: num(c.weather_code),
      wind: num(c.wind_speed_10m),
      windDir: num(c.wind_direction_10m),
      gusts: num(c.wind_gusts_10m),
      precip: num(c.precipitation),
      clouds: num(c.cloud_cover),
      pressure: num(c.pressure_msl),
    },
    hours: hourList,
    days,
  };
}

// ---------------------------------------------------------------------------
// Formatting

export const deg = (t: number) => `${Math.round(t)}°`;
export const windUnit = (u: Units) => u === "imperial" ? "mph" : "km/h";
export const precipUnit = (u: Units) => u === "imperial" ? "in" : "mm";
export const toCelsius = (t: number, u: Units) => u === "imperial" ? (t - 32) * 5 / 9 : t;
export const toKmh = (w: number, u: Units) => u === "imperial" ? w * 1.609 : w;

export function wind(speed: number, units: Units, dir?: number): string {
  return `${Math.round(speed)} ${windUnit(units)}${dir === undefined ? "" : ` ${compass(dir)}`}`;
}

export function precipAmount(v: number, units: Units): string {
  return `${units === "imperial" ? v.toFixed(2) : v.toFixed(1)} ${precipUnit(units)}`;
}

/** "2026-10-28T07:52" → "07:52". */
export const clock = (iso: string) => iso.slice(11, 16);

/** "2026-10-28" → "Wednesday 28 October"; relative to `today` ("Today", "Tomorrow"). */
export function dayName(date: string, today: string, style: "long" | "short" = "long"): string {
  const d = new Date(`${date}T12:00:00Z`);
  const diff = Math.round((d.getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-GB", { weekday: style, timeZone: "UTC" });
}

export function fullDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** Daylight length, "10 h 24 min". */
export function daylight(sunrise: string, sunset: string): string {
  const m = (Date.parse(`${sunset}:00Z`) - Date.parse(`${sunrise}:00Z`)) / 60_000;
  if (!Number.isFinite(m) || m <= 0) return "";
  return `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, "0")} min`;
}

/** The root search subtitle: "12° Paris". */
export function summary(f: Forecast, place: Place): string {
  return `${deg(f.now.temp)} ${place.name}`;
}

// ---------------------------------------------------------------------------
// Items

function tint(t: number, units: Units): Color {
  return tempColor(toCelsius(t, units));
}

export function nowItem(f: Forecast, place: Place, actions: Action[], section?: string): Item {
  const n = f.now;
  const today = f.days[0];
  const cond = condition(n.code, n.isDay, toKmh(n.wind, f.units));
  const u = f.units;
  const stats: Stat[] = [
    { label: "Temperature", value: deg(n.temp), color: tint(n.temp, u) },
    { label: "Feels like", value: deg(n.feels), color: tint(n.feels, u) },
    { label: "Wind", value: wind(n.wind, u) },
    { label: "Humidity", value: `${Math.round(n.humidity)} %` },
  ];
  const metadata: Metadata[] = [
    meta.text("Conditions", cond.label, { icon: cond.icon, color: cond.tint }),
    ...(today ? [meta.text("High / Low", `${deg(today.max)} / ${deg(today.min)}`, { icon: Icons.thermometer })] : []),
    meta.text("Wind", `${wind(n.wind, u, n.windDir)} · gusts ${Math.round(n.gusts)} ${windUnit(u)}`, {
      icon: Icons.wind,
    }),
    ...(today
      ? [meta.text("Precipitation", `${Math.round(today.precipProb)} % · ${precipAmount(today.precip, u)} today`, {
        icon: Icons.droplet,
        color: today.precipProb >= 50 ? "blue" : undefined,
      })]
      : []),
    ...(today ? [meta.text("UV index", uvLabel(today.uv), { icon: Icons.sun, color: uvColor(today.uv) })] : []),
    meta.progress("Cloud cover", n.clouds / 100),
    meta.text("Pressure", `${Math.round(n.pressure)} hPa`),
    meta.separator(),
    ...(today
      ? [
        meta.text("Sunrise", clock(today.sunrise), { icon: Icons.sun, color: "orange" }),
        meta.text("Sunset", clock(today.sunset), { icon: Icons.moon, color: "purple" }),
        meta.text("Daylight", daylight(today.sunrise, today.sunset)),
      ]
      : []),
    meta.text("Location", placeLabel(place), { icon: Icons.pin }),
    meta.text("Updated", `${clock(n.time)}${f.timezone ? ` (${f.timezone})` : ""}`, { icon: Icons.clock }),
  ];
  return {
    id: `now:${place.id}`,
    title: `${deg(n.temp)} ${cond.label}`,
    subtitle: placeLabel(place),
    icon: { source: cond.icon, tint: cond.tint },
    section,
    keywords: ["now", "current", "maintenant", place.name],
    accessories: [
      { text: `Feels ${deg(n.feels)}`, icon: { source: Icons.thermometer, tint: tint(n.feels, u) } },
      ...(today ? [{ text: `${deg(today.max)} / ${deg(today.min)}`, tooltip: "High / Low" }] : []),
    ],
    detail: { stats, metadata },
    actions,
  };
}

export function hourItem(h: Hour, f: Forecast, place: Place, actions: Action[]): Item {
  const u = f.units;
  const cond = condition(h.code, h.isDay, toKmh(h.wind, u));
  return {
    id: `hour:${place.id}:${h.time}`,
    title: clock(h.time),
    subtitle: cond.label,
    icon: { source: cond.icon, tint: cond.tint },
    section: "Next 24 Hours",
    keywords: [cond.label, "hourly"],
    accessories: [
      ...(h.precipProb > 0
        ? [{
          text: `${Math.round(h.precipProb)} %`,
          icon: { source: Icons.droplet, tint: h.precipProb >= 50 ? "blue" as const : "gray" as const },
          tooltip: "Chance of precipitation",
        }]
        : []),
      { text: wind(h.wind, u), icon: Icons.wind, tooltip: "Wind" },
      { tag: deg(h.temp), color: tint(h.temp, u) },
    ],
    detail: {
      stats: [
        { label: "Temperature", value: deg(h.temp), color: tint(h.temp, u) },
        { label: "Feels like", value: deg(h.feels), color: tint(h.feels, u) },
        {
          label: "Precipitation",
          value: `${Math.round(h.precipProb)} %`,
          color: h.precipProb >= 50 ? "blue" : undefined,
        },
      ],
      metadata: [
        meta.text("Conditions", cond.label, { icon: cond.icon, color: cond.tint }),
        meta.text("Time", `${dayName(h.time.slice(0, 10), f.now.time.slice(0, 10))} ${clock(h.time)}`, {
          icon: Icons.clock,
        }),
        meta.text("Precipitation", precipAmount(h.precip, u), { icon: Icons.droplet }),
        meta.text("Wind", wind(h.wind, u), { icon: Icons.wind }),
        meta.text("Humidity", `${Math.round(h.humidity)} %`, { icon: Icons.droplet }),
        ...(h.isDay ? [meta.text("UV index", uvLabel(h.uv), { icon: Icons.sun, color: uvColor(h.uv) })] : []),
      ],
    },
    actions,
  };
}

export function dayItem(d: Day, f: Forecast, place: Place, actions: Action[]): Item {
  const u = f.units;
  const cond = condition(d.code, true, toKmh(d.wind, u) * 0.6);
  const name = dayName(d.date, f.now.time.slice(0, 10));
  return {
    id: `day:${place.id}:${d.date}`,
    title: name,
    subtitle: cond.label,
    icon: { source: cond.icon, tint: cond.tint },
    section: "Next 7 Days",
    keywords: [cond.label, d.date, "daily", fullDate(d.date)],
    accessories: [
      ...(d.precipProb > 0
        ? [{
          text: `${Math.round(d.precipProb)} %`,
          icon: { source: Icons.droplet, tint: d.precipProb >= 50 ? "blue" as const : "gray" as const },
          tooltip: "Chance of precipitation",
        }]
        : []),
      { text: deg(d.min), color: tint(d.min, u), tooltip: "Low" },
      { tag: deg(d.max), color: tint(d.max, u) },
    ],
    detail: {
      stats: [
        { label: "High", value: deg(d.max), color: tint(d.max, u) },
        { label: "Low", value: deg(d.min), color: tint(d.min, u) },
        {
          label: "Precipitation",
          value: `${Math.round(d.precipProb)} %`,
          color: d.precipProb >= 50 ? "blue" : undefined,
        },
        { label: "UV", value: Math.round(d.uv), color: uvColor(d.uv) },
      ],
      metadata: [
        meta.text("Date", fullDate(d.date), { icon: Icons.calendar }),
        meta.text("Conditions", cond.label, { icon: cond.icon, color: cond.tint }),
        meta.text("Feels like", `${deg(d.feelsMax)} / ${deg(d.feelsMin)}`, { icon: Icons.thermometer }),
        meta.text("Precipitation", precipAmount(d.precip, u), { icon: Icons.droplet }),
        meta.text("Wind", `up to ${wind(d.wind, u, d.windDir)}`, { icon: Icons.wind }),
        meta.text("UV index", uvLabel(d.uv), { icon: Icons.sun, color: uvColor(d.uv) }),
        meta.separator(),
        meta.text("Sunrise", clock(d.sunrise), { icon: Icons.sun, color: "orange" }),
        meta.text("Sunset", clock(d.sunset), { icon: Icons.moon, color: "purple" }),
        meta.text("Daylight", daylight(d.sunrise, d.sunset)),
      ],
    },
    actions,
  };
}

/** A one-line forecast to copy: "Paris: 12° Partly cloudy, feels 10°, high 14° / low 7°". */
export function shareText(f: Forecast, place: Place): string {
  const cond = condition(f.now.code, f.now.isDay);
  const today = f.days[0];
  return `${place.name}: ${deg(f.now.temp)} ${cond.label}, feels ${deg(f.now.feels)}` +
    (today ? `, high ${deg(today.max)} / low ${deg(today.min)}` : "");
}

/** The forecast map of the place on windy.com. */
export function mapUrl(place: Place): string {
  return `https://www.windy.com/?${place.latitude.toFixed(3)},${place.longitude.toFixed(3)},9`;
}
