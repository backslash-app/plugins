// Open-Meteo Air Quality: request URLs, index levels and health advice, the
// mapping from a response to launcher items. Pure, tested in lib_test.ts.

import { type Action, type Color, Icons, type Item, meta, type Metadata, type Stat } from "@backslash/api";

// ---------------------------------------------------------------------------
// Cities (the same geocoding API as the Weather extension)

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

// ---------------------------------------------------------------------------
// Index scales

export type Scale = "european" | "us";

export const SCALE_TITLE: Record<Scale, string> = { european: "European AQI", us: "US AQI" };

/** "us", "USA", "EPA", "AirNow" → US; anything else → European. */
export function scaleOf(pref: unknown): Scale {
  const s = String(pref ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return ["us", "usa", "unitedstates", "usaqi", "epa", "airnow", "american"].includes(s) ? "us" : "european";
}

export interface Level {
  /** 0 (best) to 5 (worst). */
  rank: number;
  label: string;
  color: Color;
  /** Advice for everyone. */
  advice: string;
  /** Advice for sensitive people: asthma, heart or lung conditions, children, older adults. */
  sensitive: string;
}

interface Band extends Level {
  /** Values up to this one (included) are in the band. */
  max: number;
}

/** European Environment Agency bands and advice, as Open-Meteo computes the index. */
const EUROPEAN: Band[] = [
  {
    max: 20,
    rank: 0,
    label: "Good",
    color: "green",
    advice: "The air quality is good. Enjoy your usual outdoor activities.",
    sensitive: "Enjoy your usual outdoor activities.",
  },
  {
    max: 40,
    rank: 1,
    label: "Fair",
    color: "teal",
    advice: "Enjoy your usual outdoor activities.",
    sensitive: "Enjoy your usual outdoor activities.",
  },
  {
    max: 60,
    rank: 2,
    label: "Moderate",
    color: "yellow",
    advice: "Enjoy your usual outdoor activities.",
    sensitive: "Consider reducing intense outdoor activities if you experience symptoms.",
  },
  {
    max: 80,
    rank: 3,
    label: "Poor",
    color: "orange",
    advice:
      "Consider reducing intense outdoor activities if you experience symptoms such as sore eyes, a cough or sore throat.",
    sensitive: "Consider reducing physical activities, particularly outdoors, especially if you experience symptoms.",
  },
  {
    max: 100,
    rank: 4,
    label: "Very poor",
    color: "red",
    advice:
      "Consider reducing physical activities outdoors if you experience symptoms such as sore eyes, a cough or sore throat.",
    sensitive: "Reduce physical activities, particularly outdoors, especially if you experience symptoms.",
  },
  {
    max: Infinity,
    rank: 5,
    label: "Extremely poor",
    color: "purple",
    advice: "Reduce physical activities outdoors.",
    sensitive: "Avoid physical activities outdoors.",
  },
];

/** US EPA (AirNow) bands and advice. */
const US: Band[] = [
  {
    max: 50,
    rank: 0,
    label: "Good",
    color: "green",
    advice: "Air quality is satisfactory, and air pollution poses little or no risk.",
    sensitive: "Enjoy your usual outdoor activities.",
  },
  {
    max: 100,
    rank: 1,
    label: "Moderate",
    color: "yellow",
    advice: "Air quality is acceptable. Enjoy your usual outdoor activities.",
    sensitive: "Unusually sensitive people should consider reducing prolonged or heavy exertion outdoors.",
  },
  {
    max: 150,
    rank: 2,
    label: "Unhealthy for sensitive groups",
    color: "orange",
    advice: "Most people are not likely to be affected.",
    sensitive: "Reduce prolonged or heavy exertion outdoors, and take more breaks.",
  },
  {
    max: 200,
    rank: 3,
    label: "Unhealthy",
    color: "red",
    advice: "Reduce prolonged or heavy exertion outdoors, and take more breaks.",
    sensitive: "Avoid prolonged or heavy exertion; move activities indoors or reschedule them.",
  },
  {
    max: 300,
    rank: 4,
    label: "Very unhealthy",
    color: "purple",
    advice: "Avoid prolonged or heavy exertion outdoors.",
    sensitive: "Avoid all physical activity outdoors; move activities indoors or reschedule them.",
  },
  {
    max: Infinity,
    rank: 5,
    label: "Hazardous",
    color: "pink",
    advice: "Avoid all physical activity outdoors.",
    sensitive: "Remain indoors and keep activity levels low.",
  },
];

export function level(aqi: number, scale: Scale): Level {
  const bands = scale === "us" ? US : EUROPEAN;
  // Open-Meteo rounds to integers; anything between two bands goes to the upper one.
  const { max: _max, ...band } = bands.find((b) => aqi <= b.max) ?? bands[bands.length - 1];
  return band;
}

// ---------------------------------------------------------------------------
// Pollutants and pollen

export interface Pollutant {
  key: string;
  short: string;
  name: string;
  unit: string;
  /** The response field of the pollutant's sub-index on each scale, if it has one. */
  european?: string;
  us?: string;
}

export const POLLUTANTS: Pollutant[] = [
  {
    key: "pm2_5",
    short: "PM2.5",
    name: "Fine particles",
    unit: "μg/m³",
    european: "european_aqi_pm2_5",
    us: "us_aqi_pm2_5",
  },
  { key: "pm10", short: "PM10", name: "Particles", unit: "μg/m³", european: "european_aqi_pm10", us: "us_aqi_pm10" },
  { key: "ozone", short: "O₃", name: "Ozone", unit: "μg/m³", european: "european_aqi_ozone", us: "us_aqi_ozone" },
  {
    key: "nitrogen_dioxide",
    short: "NO₂",
    name: "Nitrogen dioxide",
    unit: "μg/m³",
    european: "european_aqi_nitrogen_dioxide",
    us: "us_aqi_nitrogen_dioxide",
  },
  {
    key: "sulphur_dioxide",
    short: "SO₂",
    name: "Sulphur dioxide",
    unit: "μg/m³",
    european: "european_aqi_sulphur_dioxide",
    us: "us_aqi_sulphur_dioxide",
  },
  // The European index leaves carbon monoxide out.
  { key: "carbon_monoxide", short: "CO", name: "Carbon monoxide", unit: "μg/m³", us: "us_aqi_carbon_monoxide" },
];

export type PollenKind = "tree" | "grass" | "weed";

export interface Pollen {
  key: string;
  name: string;
  kind: PollenKind;
}

export const POLLEN: Pollen[] = [
  { key: "alder_pollen", name: "Alder", kind: "tree" },
  { key: "birch_pollen", name: "Birch", kind: "tree" },
  { key: "olive_pollen", name: "Olive", kind: "tree" },
  { key: "grass_pollen", name: "Grass", kind: "grass" },
  { key: "mugwort_pollen", name: "Mugwort", kind: "weed" },
  { key: "ragweed_pollen", name: "Ragweed", kind: "weed" },
];

export interface PollenLevel {
  rank: number;
  label: string;
  color: Color;
}

/** Upper bounds (grains/m³) of low, moderate and high, from the US National Allergy Bureau's scale. */
const POLLEN_BANDS: Record<PollenKind, [number, number, number]> = {
  tree: [14, 89, 1499],
  grass: [4, 19, 199],
  weed: [9, 49, 499],
};

export function pollenLevel(grains: number, kind: PollenKind): PollenLevel {
  const [low, moderate, high] = POLLEN_BANDS[kind];
  if (grains < 1) return { rank: 0, label: "None", color: "gray" };
  if (grains <= low) return { rank: 1, label: "Low", color: "green" };
  if (grains <= moderate) return { rank: 2, label: "Moderate", color: "yellow" };
  if (grains <= high) return { rank: 3, label: "High", color: "orange" };
  return { rank: 4, label: "Very high", color: "red" };
}

export function uvColor(uv: number): Color {
  if (uv < 3) return "green";
  if (uv < 6) return "yellow";
  if (uv < 8) return "orange";
  if (uv < 11) return "red";
  return "purple";
}

export function uvLabel(uv: number): string {
  const word = uv < 3 ? "low" : uv < 6 ? "moderate" : uv < 8 ? "high" : uv < 11 ? "very high" : "extreme";
  return `${Math.round(uv)} · ${word}`;
}

// ---------------------------------------------------------------------------
// Request

const SUB_INDICES = POLLUTANTS.flatMap((p) => [p.european, p.us]).filter((k): k is string => !!k);

export const CURRENT = [
  "european_aqi",
  "us_aqi",
  ...POLLUTANTS.map((p) => p.key),
  ...SUB_INDICES,
  "uv_index",
  "dust",
  ...POLLEN.map((p) => p.key),
];

export const HOURLY = [
  "european_aqi",
  "us_aqi",
  ...POLLUTANTS.map((p) => p.key),
  ...SUB_INDICES,
  "uv_index",
  ...POLLEN.map((p) => p.key),
];

/** Pollen forecasts go 4 days ahead, the rest 5. */
export const FORECAST_DAYS = 5;

export function airQualityUrl(lat: number, lon: number): string {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current: CURRENT.join(","),
    hourly: HOURLY.join(","),
    timezone: "auto",
    forecast_days: String(FORECAST_DAYS),
  });
  return `https://air-quality-api.open-meteo.com/v1/air-quality?${q}`;
}

/** The parts of an Open-Meteo air quality response we use. */
export interface AirQualityResponse {
  timezone?: string;
  current?: Record<string, number | string | null>;
  hourly?: Record<string, (number | string | null)[]>;
}

// ---------------------------------------------------------------------------
// The model shown by the command

/** One reading: the indices, pollutants, UV and pollen, any of which can be missing. */
export interface Reading {
  time: string;
  values: Record<string, number | undefined>;
}

export interface DaySummary {
  date: string;
  /** Highest and lowest index of the day, on the chosen scale. */
  max?: number;
  min?: number;
  /** The hour of the highest index. */
  worst?: string;
  /** The pollutant behind the highest index. */
  dominant?: Pollutant;
  uv?: number;
  /** Highest pollen count of the day, by pollen key. */
  pollen: Record<string, number>;
}

export interface AirQuality {
  scale: Scale;
  timezone?: string;
  now: Reading;
  /** From the current hour on, 24 of them. */
  hours: Reading[];
  /** The hours left today, the current one included. */
  today: Reading[];
  days: DaySummary[];
  /** Pollen is forecast in Europe only. */
  hasPollen: boolean;
}

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;
const str = (v: unknown) => typeof v === "string" ? v : "";

export function aqiOf(r: Reading, scale: Scale): number | undefined {
  return r.values[scale === "us" ? "us_aqi" : "european_aqi"];
}

/** The pollutant with the highest sub-index, the one driving the index. */
export function dominant(r: Reading, scale: Scale): Pollutant | undefined {
  let best: Pollutant | undefined;
  let top = -1;
  for (const p of POLLUTANTS) {
    const field = p[scale];
    const v = field ? r.values[field] : undefined;
    if (v !== undefined && v > top) [best, top] = [p, v];
  }
  return best;
}

export function toAirQuality(res: AirQualityResponse, scale: Scale, count = 24): AirQuality {
  const c = res.current ?? {};
  const h = res.hourly ?? {};
  const nowTime = str(c.time);
  const now: Reading = { time: nowTime, values: {} };
  for (const key of CURRENT) now.values[key] = num(c[key]);

  const times = (h.time ?? []).map(str);
  const readings: Reading[] = times.map((time, i) => {
    const values: Record<string, number | undefined> = {};
    for (const key of HOURLY) values[key] = num(h[key]?.[i]);
    return { time, values };
  });
  const thisHour = nowTime.slice(0, 13); // "2026-10-28T10"
  let start = readings.findIndex((r) => r.time.slice(0, 13) >= thisHour);
  if (start < 0) start = nowTime ? readings.length : 0;
  const upcoming = readings.slice(start);
  const todayDate = nowTime.slice(0, 10) || readings[0]?.time.slice(0, 10) || "";

  const byDate = new Map<string, Reading[]>();
  for (const r of readings) {
    const date = r.time.slice(0, 10);
    // Past days are dropped; today keeps its earlier hours for the day's high and low.
    if (todayDate && date < todayDate) continue;
    byDate.set(date, [...byDate.get(date) ?? [], r]);
  }
  const days: DaySummary[] = [];
  for (const [date, rs] of byDate) {
    const withAqi = rs.filter((r) => aqiOf(r, scale) !== undefined);
    const pollen: Record<string, number> = {};
    for (const p of POLLEN) {
      const vals = rs.map((r) => r.values[p.key]).filter((v): v is number => v !== undefined);
      if (vals.length) pollen[p.key] = Math.max(...vals);
    }
    const uvs = rs.map((r) => r.values.uv_index).filter((v): v is number => v !== undefined);
    if (!withAqi.length && !Object.keys(pollen).length) continue;
    const worst = withAqi.reduce<Reading | undefined>(
      (w, r) => !w || aqiOf(r, scale)! > aqiOf(w, scale)! ? r : w,
      undefined,
    );
    days.push({
      date,
      max: worst ? aqiOf(worst, scale) : undefined,
      min: withAqi.length ? Math.min(...withAqi.map((r) => aqiOf(r, scale)!)) : undefined,
      worst: worst?.time,
      dominant: worst ? dominant(worst, scale) : undefined,
      uv: uvs.length ? Math.max(...uvs) : undefined,
      pollen,
    });
  }

  const hasPollen = POLLEN.some((p) =>
    now.values[p.key] !== undefined || readings.some((r) => r.values[p.key] !== undefined)
  );
  return {
    scale,
    timezone: res.timezone,
    now,
    hours: upcoming.slice(0, count),
    today: upcoming.filter((r) => r.time.slice(0, 10) === todayDate),
    days,
    hasPollen,
  };
}

export interface Window {
  start: string;
  /** The end of the last hour: "09:00" for 06:00, 07:00 and 08:00. */
  end: string;
  average: number;
}

/** The `size` consecutive hours with the lowest average index, among `hours`. */
export function bestWindow(hours: Reading[], scale: Scale, size = 3): Window | undefined {
  let best: Window | undefined;
  for (let i = 0; i + size <= hours.length; i++) {
    const slice = hours.slice(i, i + size);
    const values = slice.map((r) => aqiOf(r, scale));
    if (values.some((v) => v === undefined)) continue;
    const average = values.reduce((a, b) => a! + b!, 0)! / size;
    if (!best || average < best.average) best = { start: slice[0].time, end: addHour(slice[size - 1].time), average };
  }
  return best;
}

/** The hour with the highest index among `hours`. */
export function worstHour(hours: Reading[], scale: Scale): Reading | undefined {
  return hours.reduce<Reading | undefined>((w, r) => {
    const v = aqiOf(r, scale);
    return v !== undefined && (!w || v > aqiOf(w, scale)!) ? r : w;
  }, undefined);
}

/** "2026-10-28T08:00" → "2026-10-28T09:00" (local times, no time zone). */
export function addHour(iso: string): string {
  const d = new Date(`${iso}:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Date(d.getTime() + 3_600_000).toISOString().slice(0, 16);
}

// ---------------------------------------------------------------------------
// Formatting

/** "2026-10-28T07:52" → "07:52". */
export const clock = (iso: string) => iso.slice(11, 16);

/** "2026-10-28" → "Wednesday"; relative to `today` ("Today", "Tomorrow"). */
export function dayName(date: string, today: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const diff = Math.round((d.getTime() - new Date(`${today}T12:00:00Z`).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
}

export function fullDate(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** "12.3 μg/m³", without decimals from 100 on. */
export function amount(v: number, unit: string): string {
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${unit}`;
}

/** "AQI 23 · Fair". */
export function aqiText(aqi: number, scale: Scale): string {
  return `AQI ${Math.round(aqi)} · ${level(aqi, scale).label}`;
}

/** The pollen at a "High" level or above, worst first: "Birch high, Grass moderate". */
export function pollenSummary(values: Record<string, number | undefined>, minRank = 2): string {
  return POLLEN
    .map((p) => ({ p, v: values[p.key] }))
    .filter((x): x is { p: Pollen; v: number } => x.v !== undefined)
    .map(({ p, v }) => ({ p, l: pollenLevel(v, p.kind), v }))
    .filter((x) => x.l.rank >= minRank)
    .sort((a, b) => b.l.rank - a.l.rank || b.v - a.v)
    .map((x) => `${x.p.name} ${x.l.label.toLowerCase()}`)
    .join(", ");
}

/** The root search subtitle: "AQI 23 Fair · Paris". */
export function summary(a: AirQuality, place: Place): string {
  const aqi = aqiOf(a.now, a.scale);
  return aqi === undefined ? place.name : `AQI ${Math.round(aqi)} ${level(aqi, a.scale).label} · ${place.name}`;
}

/** A line to copy: "Paris: European AQI 23 (Fair), mostly ozone. Pollen: Birch high". */
export function shareText(a: AirQuality, place: Place): string {
  const aqi = aqiOf(a.now, a.scale);
  if (aqi === undefined) return `${place.name}: no air quality data`;
  const main = dominant(a.now, a.scale);
  const pollen = pollenSummary(a.now.values);
  return `${place.name}: ${SCALE_TITLE[a.scale]} ${Math.round(aqi)} (${level(aqi, a.scale).label})` +
    (main ? `, mostly ${main.name.toLowerCase()}` : "") + (pollen ? `. Pollen: ${pollen}` : "");
}

/** The air quality map of the place on windy.com. */
export function mapUrl(place: Place): string {
  return `https://www.windy.com/-PM2-5-pm2p5?pm2p5,${place.latitude.toFixed(3)},${place.longitude.toFixed(3)},9`;
}

// ---------------------------------------------------------------------------
// Items

function subIndex(r: Reading, p: Pollutant, scale: Scale): { value: number; scale: Scale } | undefined {
  const own = p[scale];
  if (own && r.values[own] !== undefined) return { value: r.values[own]!, scale };
  const other: Scale = scale === "us" ? "european" : "us";
  const field = p[other];
  return field && r.values[field] !== undefined ? { value: r.values[field]!, scale: other } : undefined;
}

export function nowItem(a: AirQuality, place: Place, actions: Action[], section?: string): Item {
  const n = a.now;
  const aqi = aqiOf(n, a.scale);
  const otherScale: Scale = a.scale === "us" ? "european" : "us";
  const other = aqiOf(n, otherScale);
  if (aqi === undefined) {
    return {
      id: `now:${place.id}`,
      title: "No air quality data",
      subtitle: placeLabel(place),
      icon: { source: Icons.wind, tint: "gray" },
      section,
      actions,
    };
  }
  const lvl = level(aqi, a.scale);
  const main = dominant(n, a.scale);
  const best = bestWindow(a.today, a.scale);
  const worst = worstHour(a.today, a.scale);
  const pollen = pollenSummary(n.values);
  const pm25 = n.values.pm2_5;
  const uv = n.values.uv_index;
  const stats: Stat[] = [
    { label: SCALE_TITLE[a.scale], value: Math.round(aqi), color: lvl.color },
    ...(pm25 !== undefined ? [{ label: "PM2.5 μg/m³", value: Math.round(pm25 * 10) / 10 }] : []),
    ...(n.values.ozone !== undefined ? [{ label: "Ozone μg/m³", value: Math.round(n.values.ozone) }] : []),
    ...(uv !== undefined ? [{ label: "UV", value: Math.round(uv), color: uvColor(uv) }] : []),
  ];
  const metadata: Metadata[] = [
    meta.tags("Level", [{ text: lvl.label, color: lvl.color }]),
    ...(main ? [meta.text("Main pollutant", `${main.name} (${main.short})`, { icon: Icons.wind })] : []),
    ...(other !== undefined ? [meta.text(SCALE_TITLE[otherScale], aqiText(other, otherScale))] : []),
    ...(best
      ? [meta.text("Best time outside", `${clock(best.start)}–${clock(best.end)} · AQI ${Math.round(best.average)}`, {
        icon: Icons.check,
        color: level(best.average, a.scale).color,
      })]
      : []),
    ...(worst && aqiOf(worst, a.scale)! > aqi
      ? [meta.text("Worst today", `${clock(worst.time)} · ${aqiText(aqiOf(worst, a.scale)!, a.scale)}`, {
        icon: Icons.alert,
        color: level(aqiOf(worst, a.scale)!, a.scale).color,
      })]
      : []),
    ...(uv !== undefined ? [meta.text("UV index", uvLabel(uv), { icon: Icons.sun, color: uvColor(uv) })] : []),
    meta.text("Pollen", a.hasPollen ? pollen || "Low" : "Not forecast here (Europe only)", { icon: Icons.sparkle }),
    meta.separator(),
    meta.text("Location", placeLabel(place), { icon: Icons.pin }),
    meta.text("Updated", `${clock(n.time)}${a.timezone ? ` (${a.timezone})` : ""}`, { icon: Icons.clock }),
  ];
  return {
    id: `now:${place.id}`,
    title: aqiText(aqi, a.scale),
    subtitle: placeLabel(place),
    icon: { source: Icons.wind, tint: lvl.color },
    section,
    keywords: ["now", "current", "maintenant", place.name, lvl.label],
    accessories: [
      ...(main ? [{ text: main.short, tooltip: "Main pollutant" }] : []),
      ...(pollen ? [{ icon: { source: Icons.sparkle, tint: "orange" as const }, tooltip: `Pollen: ${pollen}` }] : []),
      { tag: lvl.label, color: lvl.color },
    ],
    detail: {
      stats,
      markdown: [`**Everyone:** ${lvl.advice}`, "", `**Sensitive people:** ${lvl.sensitive}`].join("\n"),
      metadata,
    },
    actions,
  };
}

export function pollutantItems(a: AirQuality, place: Place, actions: Action[]): Item[] {
  return POLLUTANTS.flatMap((p): Item[] => {
    const value = a.now.values[p.key];
    if (value === undefined) return [];
    const sub = subIndex(a.now, p, a.scale);
    const lvl = sub ? level(sub.value, sub.scale) : undefined;
    const next = a.hours.map((h) => h.values[p.key]).filter((v): v is number => v !== undefined);
    return [{
      id: `pollutant:${place.id}:${p.key}`,
      title: p.name,
      subtitle: p.short,
      icon: { source: Icons.wind, tint: lvl?.color ?? "gray" },
      section: "Pollutants",
      keywords: [p.short, p.key],
      accessories: [
        { text: amount(value, p.unit) },
        ...(lvl ? [{ tag: lvl.label, color: lvl.color }] : []),
      ],
      detail: {
        stats: [
          { label: p.unit, value: Math.round(value * 10) / 10, color: lvl?.color },
          ...(sub ? [{ label: SCALE_TITLE[sub.scale], value: Math.round(sub.value), color: lvl?.color }] : []),
        ],
        metadata: [
          ...(lvl ? [meta.tags("Level", [{ text: lvl.label, color: lvl.color }])] : []),
          ...(sub && sub.scale !== a.scale
            ? [meta.text("Note", `Not part of the ${SCALE_TITLE[a.scale]}: level from the ${SCALE_TITLE[sub.scale]}`)]
            : []),
          ...(next.length
            ? [
              meta.text(
                "Next 24 hours",
                `${amount(Math.min(...next), p.unit)} to ${amount(Math.max(...next), p.unit)}`,
                {
                  icon: Icons.clock,
                },
              ),
            ]
            : []),
          meta.text("Location", placeLabel(place), { icon: Icons.pin }),
        ],
      },
      actions,
    }];
  });
}

export function pollenItems(a: AirQuality, place: Place, actions: Action[]): Item[] {
  if (!a.hasPollen) {
    return [{
      id: `pollen:${place.id}:none`,
      title: "No pollen forecast here",
      subtitle: "Open-Meteo forecasts pollen in Europe only",
      icon: { source: Icons.sparkle, tint: "gray" },
      section: "Pollen",
      actions,
    }];
  }
  const today = a.days[0];
  return POLLEN.flatMap((p): Item[] => {
    const value = a.now.values[p.key];
    if (value === undefined) return [];
    const lvl = pollenLevel(value, p.kind);
    const peak = today?.pollen[p.key];
    return [{
      id: `pollen:${place.id}:${p.key}`,
      title: p.name,
      subtitle: `${p.kind === "tree" ? "Tree" : p.kind === "grass" ? "Grass" : "Weed"} pollen`,
      icon: { source: Icons.sparkle, tint: lvl.color },
      section: "Pollen",
      keywords: ["pollen", "allergy", p.kind],
      accessories: [{ text: `${Math.round(value)} grains/m³` }, { tag: lvl.label, color: lvl.color }],
      detail: {
        metadata: [
          meta.tags("Level now", [{ text: lvl.label, color: lvl.color }]),
          meta.text("Now", `${Math.round(value)} grains/m³`),
          ...(peak !== undefined
            ? [meta.text("Today's peak", `${Math.round(peak)} grains/m³ · ${pollenLevel(peak, p.kind).label}`)]
            : []),
          ...a.days.slice(1).filter((d) => d.pollen[p.key] !== undefined).map((d) =>
            meta.text(dayName(d.date, a.days[0].date), pollenLevel(d.pollen[p.key], p.kind).label, {
              color: pollenLevel(d.pollen[p.key], p.kind).color,
            })
          ),
        ],
      },
      actions,
    }];
  });
}

export function hourItem(r: Reading, a: AirQuality, place: Place, actions: Action[]): Item {
  const aqi = aqiOf(r, a.scale);
  const lvl = aqi === undefined ? undefined : level(aqi, a.scale);
  const main = dominant(r, a.scale);
  const uv = r.values.uv_index;
  const today = a.now.time.slice(0, 10) || r.time.slice(0, 10);
  return {
    id: `hour:${place.id}:${r.time}`,
    title: clock(r.time),
    subtitle: lvl?.label ?? "No data",
    icon: { source: Icons.wind, tint: lvl?.color ?? "gray" },
    section: "Next 24 Hours",
    keywords: ["hourly", dayName(r.time.slice(0, 10), today)],
    accessories: [
      ...(main ? [{ text: main.short, tooltip: "Main pollutant" }] : []),
      ...(aqi !== undefined && lvl ? [{ tag: String(Math.round(aqi)), color: lvl.color }] : []),
    ],
    detail: {
      stats: [
        ...(aqi !== undefined && lvl
          ? [{ label: SCALE_TITLE[a.scale], value: Math.round(aqi), color: lvl.color }]
          : []),
        ...(uv !== undefined ? [{ label: "UV", value: Math.round(uv), color: uvColor(uv) }] : []),
      ],
      metadata: [
        meta.text("Time", `${dayName(r.time.slice(0, 10), today)} ${clock(r.time)}`, { icon: Icons.clock }),
        ...(main ? [meta.text("Main pollutant", `${main.name} (${main.short})`, { icon: Icons.wind })] : []),
        ...POLLUTANTS.filter((p) => r.values[p.key] !== undefined).map((p) =>
          meta.text(p.short, amount(r.values[p.key]!, p.unit))
        ),
        ...(pollenSummary(r.values) ? [meta.text("Pollen", pollenSummary(r.values), { icon: Icons.sparkle })] : []),
      ],
    },
    actions,
  };
}

export function dayItem(d: DaySummary, a: AirQuality, place: Place, actions: Action[]): Item {
  const lvl = d.max === undefined ? undefined : level(d.max, a.scale);
  const today = a.days[0]?.date ?? d.date;
  const pollen = pollenSummary(d.pollen);
  return {
    id: `day:${place.id}:${d.date}`,
    title: dayName(d.date, today),
    subtitle: lvl ? `Up to ${lvl.label.toLowerCase()}` : "No index",
    icon: { source: Icons.wind, tint: lvl?.color ?? "gray" },
    section: "Next Days",
    keywords: ["daily", d.date, fullDate(d.date)],
    accessories: [
      ...(pollen ? [{ icon: { source: Icons.sparkle, tint: "orange" as const }, tooltip: `Pollen: ${pollen}` }] : []),
      ...(d.dominant ? [{ text: d.dominant.short, tooltip: "Main pollutant" }] : []),
      ...(d.min !== undefined ? [{ text: String(Math.round(d.min)), tooltip: "Lowest" }] : []),
      ...(d.max !== undefined && lvl ? [{ tag: String(Math.round(d.max)), color: lvl.color }] : []),
    ],
    detail: {
      stats: [
        ...(d.max !== undefined && lvl ? [{ label: "Highest", value: Math.round(d.max), color: lvl.color }] : []),
        ...(d.min !== undefined
          ? [{ label: "Lowest", value: Math.round(d.min), color: level(d.min, a.scale).color }]
          : []),
        ...(d.uv !== undefined ? [{ label: "UV", value: Math.round(d.uv), color: uvColor(d.uv) }] : []),
      ],
      markdown: lvl ? `**At worst:** ${lvl.advice}\n\n**Sensitive people:** ${lvl.sensitive}` : undefined,
      metadata: [
        meta.text("Date", fullDate(d.date), { icon: Icons.calendar }),
        ...(d.worst ? [meta.text("Worst hour", clock(d.worst), { icon: Icons.alert, color: lvl?.color })] : []),
        ...(d.dominant ? [meta.text("Main pollutant", `${d.dominant.name} (${d.dominant.short})`)] : []),
        ...(d.uv !== undefined
          ? [meta.text("UV index", uvLabel(d.uv), { icon: Icons.sun, color: uvColor(d.uv) })]
          : []),
        meta.separator(),
        ...(Object.keys(d.pollen).length
          ? POLLEN.filter((p) => d.pollen[p.key] !== undefined).map((p) => {
            const l = pollenLevel(d.pollen[p.key], p.kind);
            return meta.text(`${p.name} pollen`, l.label, { color: l.color });
          })
          : [meta.text("Pollen", a.hasPollen ? "Not forecast this far" : "Not forecast here (Europe only)")]),
      ],
    },
    actions,
  };
}
