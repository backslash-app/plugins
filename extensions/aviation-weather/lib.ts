// METAR and TAF decoding, flight categories and wording. Pure: no network, no launcher.
//
// Reports are read group by group, as a pilot would: every group the decoder
// understands gets a plain-words meaning, the others are kept as "not decoded"
// rather than guessed. References: WMO Manual on Codes (FM 15 METAR, FM 51 TAF)
// and the US FMH-1 for the statute-mile and remark groups.

export const SITE = "https://aviationweather.gov";
export const API = `${SITE}/api/data`;

// ---------------------------------------------------------------------------
// Types

export interface Group {
  raw: string;
  meaning: string;
}

export interface Wind {
  /** Degrees true; undefined when variable or calm. */
  direction?: number;
  variable: boolean;
  calm: boolean;
  /** In knots, whatever the report's unit. */
  speed: number;
  gust?: number;
  /** Variation of the direction, `240V330`. */
  from?: number;
  to?: number;
}

export interface Visibility {
  meters: number;
  /** `9999`, `P6SM`: at least this much. */
  atLeast?: boolean;
  /** `M1/4SM`: less than this. */
  lessThan?: boolean;
  /** Written in statute miles. */
  statute: boolean;
  direction?: string;
}

export type Cover = "FEW" | "SCT" | "BKN" | "OVC" | "VV";

export interface Cloud {
  cover: Cover;
  /** Feet above the ground; undefined when not reported (`///`). */
  base?: number;
  type?: "CB" | "TCU";
}

export interface Conditions {
  wind?: Wind;
  visibility?: Visibility;
  cavok: boolean;
  weather: string[];
  clouds: Cloud[];
  /** SKC, CLR, NSC or NCD. */
  clear?: string;
  /** `NSW`: the weather ends. */
  noSignificantWeather: boolean;
  groups: Group[];
  undecoded: string[];
}

export interface Pressure {
  hpa: number;
  inhg: number;
  unit: "hPa" | "inHg";
}

export interface Trend extends Conditions {
  kind: "NOSIG" | "BECMG" | "TEMPO";
  raw: string;
}

export interface Metar extends Conditions {
  raw: string;
  type: "METAR" | "SPECI";
  station: string;
  time?: Date;
  auto: boolean;
  corrected: boolean;
  temperature?: number;
  dewpoint?: number;
  pressure?: Pressure;
  recent: string[];
  trends: Trend[];
  remarks?: string;
  remarkGroups: Group[];
}

export type PeriodKind = "BASE" | "FM" | "BECMG" | "TEMPO" | "INTER" | "PROB";

export interface TafPeriod extends Conditions {
  kind: PeriodKind;
  /** For PROB30/PROB40, with `tempo` when followed by TEMPO (or INTER, in Australia). */
  probability?: number;
  tempo?: "TEMPO" | "INTER";
  from?: Date;
  to?: Date;
  raw: string;
}

export interface TafTemperature {
  kind: "max" | "min";
  value: number;
  at?: Date;
}

export interface Taf {
  raw: string;
  station: string;
  issued?: Date;
  from?: Date;
  to?: Date;
  amended: boolean;
  corrected: boolean;
  cancelled: boolean;
  periods: TafPeriod[];
  temperatures: TafTemperature[];
  remarks?: string;
}

export type FlightCategory = "VFR" | "MVFR" | "IFR" | "LIFR";

// ---------------------------------------------------------------------------
// Units

export const KMH_PER_KT = 1.852;
export const METERS_PER_SM = 1609.344;
export const HPA_PER_INHG = 33.8639;

export const ktToKmh = (kt: number) => Math.round(kt * KMH_PER_KT);
export const celsiusToF = (c: number) => Math.round(c * 9 / 5 + 32);

/** Relative humidity in percent from temperature and dew point (Magnus formula). */
export function humidity(temperature: number, dewpoint: number): number {
  const g = (t: number) => Math.exp((17.625 * t) / (243.04 + t));
  return Math.round(Math.min(100, 100 * g(dewpoint) / g(temperature)));
}

const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

/** 230 → "southwest". */
export function compass(degrees: number): string {
  return COMPASS[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}

const DIRECTIONS: Record<string, string> = {
  N: "north",
  NE: "northeast",
  E: "east",
  SE: "southeast",
  S: "south",
  SW: "southwest",
  W: "west",
  NW: "northwest",
};

/** 1/2 → 0.5, "1 1/2" → 1.5. */
function fraction(text: string): number {
  return text.trim().split(/\s+/).reduce((sum, part) => {
    const [a, b] = part.split("/").map(Number);
    return sum + (b ? a / b : a);
  }, 0);
}

const thousands = (n: number) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");

// ---------------------------------------------------------------------------
// Times: reports only give the day of the month.

/** The date with this day, hour and minute closest to `ref` (previous, same or next month). */
export function dayTime(day: number, hour: number, minute: number, ref: Date): Date | undefined {
  if (day < 1 || day > 31 || hour > 24 || minute > 59) return undefined;
  let best: Date | undefined;
  for (const offset of [-1, 0, 1]) {
    const y = ref.getUTCFullYear(), m = ref.getUTCMonth() + offset;
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    if (day > days) continue;
    const d = new Date(Date.UTC(y, m, day, hour, minute));
    if (!best || Math.abs(d.getTime() - ref.getTime()) < Math.abs(best.getTime() - ref.getTime())) best = d;
  }
  return best;
}

/** `0118/0224` → the two dates. */
function validity(token: string, ref: Date): { from: Date; to: Date } | undefined {
  const m = /^(\d{2})(\d{2})\/(\d{2})(\d{2})$/.exec(token);
  if (!m) return undefined;
  const from = dayTime(+m[1], +m[2], 0, ref);
  // The end is placed relative to the start: `3018/0118` crosses a month.
  const to = from && dayTime(+m[3], +m[4], 0, new Date(from.getTime() + 12 * 3600_000));
  if (!from || !to) return undefined;
  return { from, to };
}

/** "Sun 1, 17:00Z" */
export function zulu(d: Date, withDay = true): string {
  const hh = String(d.getUTCHours()).padStart(2, "0"), mm = String(d.getUTCMinutes()).padStart(2, "0");
  if (!withDay) return `${hh}:${mm}Z`;
  const day = d.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
  return `${day} ${d.getUTCDate()}, ${hh}:${mm}Z`;
}

/** "12 min ago", "in 3 h", "2 d ago". */
export function relative(d: Date, now = new Date()): string {
  const minutes = Math.round((d.getTime() - now.getTime()) / 60_000);
  const abs = Math.abs(minutes);
  const text = abs < 1
    ? "now"
    : abs < 60
    ? `${abs} min`
    : abs < 48 * 60
    ? `${Math.round(abs / 60)} h`
    : `${Math.round(abs / 1440)} d`;
  if (text === "now") return "just now";
  return minutes < 0 ? `${text} ago` : `in ${text}`;
}

// ---------------------------------------------------------------------------
// Weather phenomena

const DESCRIPTORS: Record<string, string> = {
  MI: "shallow",
  BC: "patches of",
  PR: "partial",
  DR: "low drifting",
  BL: "blowing",
  SH: "showers",
  TS: "thunderstorm",
  FZ: "freezing",
};

const PHENOMENA: Record<string, string> = {
  DZ: "drizzle",
  RA: "rain",
  SN: "snow",
  SG: "snow grains",
  IC: "ice crystals",
  PL: "ice pellets",
  GR: "hail",
  GS: "small hail",
  UP: "unknown precipitation",
  BR: "mist",
  FG: "fog",
  FU: "smoke",
  VA: "volcanic ash",
  DU: "widespread dust",
  SA: "sand",
  HZ: "haze",
  PY: "spray",
  PO: "dust whirls",
  SQ: "squalls",
  FC: "funnel cloud",
  SS: "sandstorm",
  DS: "duststorm",
};

const WEATHER_RE = new RegExp(
  `^(RE)?(\\+|-|VC)?(${Object.keys(DESCRIPTORS).join("|")})?((?:${Object.keys(PHENOMENA).join("|")})*)$`,
);

/** "-SHRA" → "light rain showers", "+TSRA" → "heavy thunderstorm with rain". Undefined if not a weather group. */
export function describeWeather(token: string): string | undefined {
  const m = WEATHER_RE.exec(token);
  if (!m || (!m[3] && !m[4])) return undefined;
  const [, , intensity, descriptor, phen] = m;
  const kinds = (phen.match(/../g) ?? []).map((p) => PHENOMENA[p]);
  if (descriptor === "SH" && !kinds.length && intensity !== "VC") return undefined;
  let text: string;
  if (phen === "FC" && intensity === "+") text = "tornado or waterspout";
  else if (descriptor === "TS") text = kinds.length ? `thunderstorm with ${kinds.join(" and ")}` : "thunderstorm";
  else if (descriptor === "SH") text = kinds.length ? `${kinds.join(" and ")} showers` : "showers";
  else if (descriptor) text = `${DESCRIPTORS[descriptor]} ${kinds.join(" and ")}`.trim();
  else text = kinds.join(" and ");
  if (intensity === "-") text = `light ${text}`;
  else if (intensity === "+" && !text.startsWith("tornado")) text = `heavy ${text}`;
  else if (intensity === "VC") text = `${text} in the vicinity`;
  return text;
}

// ---------------------------------------------------------------------------
// Wording

export function windText(w: Wind): string {
  if (w.calm) return "Calm";
  const speed = `${w.speed} kt (${ktToKmh(w.speed)} km/h)`;
  let text = w.variable || w.direction === undefined
    ? `Variable at ${speed}`
    : `From ${String(w.direction).padStart(3, "0")}° (${compass(w.direction)}) at ${speed}`;
  if (w.gust) text += `, gusting ${w.gust} kt (${ktToKmh(w.gust)} km/h)`;
  if (w.from !== undefined && w.to !== undefined) {
    text += `, varying between ${String(w.from).padStart(3, "0")}° and ${String(w.to).padStart(3, "0")}°`;
  }
  return text;
}

/** "230° 3 kt", "VRB 4 kt G25", "Calm". */
export function windShort(w: Wind): string {
  if (w.calm) return "Calm";
  const dir = w.variable || w.direction === undefined ? "VRB" : `${String(w.direction).padStart(3, "0")}°`;
  return `${dir} ${w.speed}${w.gust ? `G${w.gust}` : ""} kt`;
}

function statuteText(value: number): string {
  const miles = Math.round(value * 8) / 8;
  const whole = Math.floor(miles), rest = miles - whole;
  const frac = rest
    ? ({ 0.125: "1/8", 0.25: "1/4", 0.375: "3/8", 0.5: "1/2", 0.625: "5/8", 0.75: "3/4" } as Record<number, string>)[
      Math.round(rest * 1000) / 1000
    ] ?? rest.toFixed(2)
    : "";
  return [whole ? String(whole) : "", frac].filter(Boolean).join(" ") || "0";
}

export function visibilityText(v: Visibility): string {
  const prefix = v.lessThan ? "Less than " : "";
  const suffix = v.atLeast ? " or more" : "";
  const dir = v.direction ? ` toward the ${DIRECTIONS[v.direction] ?? v.direction}` : "";
  if (v.statute) {
    const miles = v.meters / METERS_PER_SM;
    const km = v.meters >= 5000 ? `${Math.round(v.meters / 1000)} km` : `${thousands(v.meters)} m`;
    return `${prefix}${statuteText(miles)} SM${suffix} (${km})${dir}`;
  }
  if (v.meters >= 9999) return `10 km or more${dir}`;
  const metric = v.meters >= 5000 ? `${v.meters / 1000} km` : `${thousands(v.meters)} m`;
  return `${prefix}${metric}${suffix} (${statuteText(Math.round(v.meters / METERS_PER_SM * 4) / 4)} SM)${dir}`;
}

/** Short: "10 km+", "6 SM+", "800 m". */
export function visibilityShort(v: Visibility): string {
  if (v.statute) return `${v.lessThan ? "<" : ""}${statuteText(v.meters / METERS_PER_SM)} SM${v.atLeast ? "+" : ""}`;
  if (v.meters >= 9999) return "10 km+";
  return v.meters >= 5000 ? `${v.meters / 1000} km` : `${v.meters} m`;
}

const COVER: Record<Cover, string> = {
  FEW: "Few clouds",
  SCT: "Scattered clouds",
  BKN: "Broken clouds",
  OVC: "Overcast",
  VV: "Sky obscured, vertical visibility",
};

const OKTAS: Record<Cover, string> = { FEW: "1–2/8", SCT: "3–4/8", BKN: "5–7/8", OVC: "8/8", VV: "" };

export function cloudText(c: Cloud): string {
  const base = c.base === undefined ? "base not reported" : `${thousands(c.base)} ft`;
  const type = c.type === "CB" ? ", cumulonimbus" : c.type === "TCU" ? ", towering cumulus" : "";
  const okta = OKTAS[c.cover] ? ` (${OKTAS[c.cover]})` : "";
  return `${COVER[c.cover]}${okta} at ${base}${type}`;
}

const CLEAR: Record<string, string> = {
  SKC: "Sky clear",
  CLR: "No clouds below 12,000 ft (automatic station)",
  NSC: "No significant clouds",
  NCD: "No clouds detected (automatic station)",
};

export function pressureText(p: Pressure): string {
  return p.unit === "hPa"
    ? `${p.hpa} hPa (${p.inhg.toFixed(2)} inHg)`
    : `${p.inhg.toFixed(2)} inHg (${Math.round(p.hpa)} hPa)`;
}

export const temperatureText = (c: number) => `${c} °C (${celsiusToF(c)} °F)`;

// ---------------------------------------------------------------------------
// Groups shared by METAR, TAF and trends

function newConditions(): Conditions {
  return { cavok: false, weather: [], clouds: [], noSignificantWeather: false, groups: [], undecoded: [] };
}

const WIND_RE = /^(\d{3}|VRB|\/\/\/)(\d{2,3}|\/\/)(?:G(\d{2,3}))?(KT|MPS|KMH)$/;

/**
 * Reads the condition group at `tokens[i]` into `c`. Returns how many tokens it
 * used (0 if it isn't one).
 */
function conditionGroup(tokens: string[], i: number, c: Conditions): number {
  const t = tokens[i];
  const add = (raw: string, meaning: string) => c.groups.push({ raw, meaning });

  let m = WIND_RE.exec(t);
  if (m) {
    if (m[2] === "//") {
      add(t, "Wind not reported");
      return 1;
    }
    const factor = m[4] === "MPS" ? 1 / 0.514444 : m[4] === "KMH" ? 1 / KMH_PER_KT : 1;
    const speed = Math.round(Number(m[2]) * factor);
    const gust = m[3] ? Math.round(Number(m[3]) * factor) : undefined;
    const variable = m[1] === "VRB" || m[1] === "///";
    c.wind = {
      direction: variable ? undefined : Number(m[1]),
      variable,
      calm: speed === 0 && !gust,
      speed,
      gust,
    };
    add(t, windText(c.wind));
    return 1;
  }
  m = /^(\d{3})V(\d{3})$/.exec(t);
  if (m && c.wind) {
    c.wind.from = Number(m[1]);
    c.wind.to = Number(m[2]);
    add(t, `Wind direction varying between ${m[1]}° and ${m[2]}°`);
    return 1;
  }
  if (t === "CAVOK") {
    c.cavok = true;
    c.visibility = { meters: 10000, atLeast: true, statute: false };
    add(
      t,
      "Ceiling and visibility OK: 10 km or more, no clouds below 5,000 ft or cumulonimbus, no significant weather",
    );
    return 1;
  }
  m = /^(\d{4})(NDV|N|NE|E|SE|S|SW|W|NW)?$/.exec(t);
  if (m) {
    const meters = Number(m[1]);
    c.visibility = {
      meters: meters === 9999 ? 10000 : meters,
      atLeast: meters === 9999,
      statute: false,
      direction: m[2] && m[2] !== "NDV" ? m[2] : undefined,
    };
    const v = c.visibility;
    // A second, lower visibility in one direction: `4000 1200NE`.
    add(
      t,
      c.groups.some((g) => /^\d{4}$/.test(g.raw)) ? `Minimum ${visibilityText(v)}` : `Visibility ${visibilityText(v)}`,
    );
    return 1;
  }
  // "1 1/2SM": a whole number then a fraction.
  if (/^\d$/.test(t) && /^\d\/\dSM$/.test(tokens[i + 1] ?? "")) {
    const miles = fraction(`${t} ${tokens[i + 1].slice(0, -2)}`);
    c.visibility = { meters: Math.round(miles * METERS_PER_SM), statute: true };
    add(`${t} ${tokens[i + 1]}`, `Visibility ${visibilityText(c.visibility)}`);
    return 2;
  }
  m = /^([PM])?(\d{1,2}(?:\/\d{1,2})?)SM$/.exec(t);
  if (m) {
    const miles = fraction(m[2]);
    c.visibility = {
      meters: Math.round(miles * METERS_PER_SM),
      statute: true,
      atLeast: m[1] === "P",
      lessThan: m[1] === "M",
    };
    add(t, `Visibility ${visibilityText(c.visibility)}`);
    return 1;
  }
  m = /^R(\d{2}[LCR]?)\/([PM])?(\d{4})(?:V([PM])?(\d{4}))?(FT)?(?:\/?([UDN]))?$/.exec(t);
  if (m) {
    const unit = m[6] ? "ft" : "m";
    const value = (p: string | undefined, n: string) =>
      `${p === "P" ? "more than " : p === "M" ? "less than " : ""}${thousands(Number(n))} ${unit}`;
    const range = m[5] ? `between ${value(m[2], m[3])} and ${value(m[4], m[5])}` : value(m[2], m[3]);
    const trend = { U: ", improving", D: ", getting worse", N: ", no change" }[m[7] as "U" | "D" | "N"] ?? "";
    add(t, `Runway ${m[1]} visual range ${range}${trend}`);
    return 1;
  }
  if (t === "NSW") {
    c.noSignificantWeather = true;
    add(t, "No significant weather");
    return 1;
  }
  if (t === "//") {
    add(t, "Present weather not reported");
    return 1;
  }
  if (!t.startsWith("RE")) {
    const w = describeWeather(t);
    if (w) {
      c.weather.push(w);
      add(t, w[0].toUpperCase() + w.slice(1));
      return 1;
    }
  }
  m = /^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/.exec(t);
  if (m) {
    const cloud: Cloud = {
      cover: m[1] as Cover,
      base: m[2] === "///" ? undefined : Number(m[2]) * 100,
      type: m[3] === "CB" || m[3] === "TCU" ? m[3] : undefined,
    };
    c.clouds.push(cloud);
    add(t, cloudText(cloud));
    return 1;
  }
  m = /^\/\/\/(CB|TCU)$/.exec(t);
  if (m) {
    add(
      t,
      m[1] === "CB" ? "Cumulonimbus, amount and base not reported" : "Towering cumulus, amount and base not reported",
    );
    return 1;
  }
  if (t in CLEAR) {
    c.clear = t;
    add(t, CLEAR[t]);
    return 1;
  }
  m = /^WS(?:\d{3}\/\d{5}KT|R(\d{2}[LCR]?)|ALL RWY)$/.exec(t);
  if (m) {
    add(t, m[1] ? `Wind shear on runway ${m[1]}` : "Wind shear");
    return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// Flight category

/** Lowest broken, overcast or obscured layer, in feet. */
export function ceiling(c: Pick<Conditions, "clouds">): number | undefined {
  const bases = c.clouds.filter((l) => l.cover === "BKN" || l.cover === "OVC" || l.cover === "VV")
    .flatMap((l) => l.base === undefined ? [] : [l.base]);
  return bases.length ? Math.min(...bases) : undefined;
}

/** The FAA categories: LIFR below 500 ft or 1 SM, IFR below 1,000 ft or 3 SM, MVFR up to 3,000 ft or 5 SM. */
export function flightCategory(c: Conditions): FlightCategory | undefined {
  const ceil = ceiling(c);
  const miles = c.visibility ? c.visibility.meters / METERS_PER_SM : undefined;
  if (ceil === undefined && miles === undefined && !c.clear && !c.cavok) return undefined;
  const v = miles ?? Infinity, h = ceil ?? Infinity;
  if (h < 500 || v < 1) return "LIFR";
  if (h < 1000 || v < 3) return "IFR";
  if (h <= 3000 || v <= 5) return "MVFR";
  return "VFR";
}

export const CATEGORY: Record<FlightCategory, { color: "green" | "blue" | "red" | "purple"; text: string }> = {
  VFR: { color: "green", text: "Visual flight rules: ceiling above 3,000 ft and visibility above 5 SM" },
  MVFR: { color: "blue", text: "Marginal VFR: ceiling 1,000–3,000 ft or visibility 3–5 SM" },
  IFR: { color: "red", text: "Instrument flight rules: ceiling 500–1,000 ft or visibility 1–3 SM" },
  LIFR: { color: "purple", text: "Low IFR: ceiling below 500 ft or visibility below 1 SM" },
};

// ---------------------------------------------------------------------------
// METAR

function tokenize(raw: string): string[] {
  return raw.replace(/=\s*$/, "").trim().split(/\s+/).filter(Boolean);
}

/** Remarks we can read: automated station type, sea-level pressure, precise temperatures, precipitation. */
export function decodeRemarks(text: string): Group[] {
  const groups: Group[] = [];
  for (const t of text.split(/\s+/)) {
    let m: RegExpExecArray | null;
    if (t === "AO1") groups.push({ raw: t, meaning: "Automated station without a precipitation sensor" });
    else if (t === "AO2") groups.push({ raw: t, meaning: "Automated station with a precipitation sensor" });
    else if ((m = /^SLP(\d{3})$/.exec(t))) {
      const n = Number(m[1]) / 10;
      groups.push({ raw: t, meaning: `Sea-level pressure ${(n < 50 ? 1000 + n : 900 + n).toFixed(1)} hPa` });
    } else if (t === "SLPNO") groups.push({ raw: t, meaning: "Sea-level pressure not available" });
    else if ((m = /^T([01])(\d{3})([01])(\d{3})$/.exec(t))) {
      const v = (s: string, n: string) => (s === "1" ? -1 : 1) * Number(n) / 10;
      groups.push({ raw: t, meaning: `Temperature ${v(m[1], m[2])} °C, dew point ${v(m[3], m[4])} °C` });
    } else if ((m = /^P(\d{4})$/.exec(t))) {
      groups.push({ raw: t, meaning: `${(Number(m[1]) / 100).toFixed(2)} in of precipitation in the last hour` });
    } else if (t === "$") groups.push({ raw: t, meaning: "The station needs maintenance" });
    else if (t === "NOSPECI") groups.push({ raw: t, meaning: "No special reports are issued here" });
  }
  return groups;
}

function readTrends(tokens: string[], start: number): { trends: Trend[]; end: number } {
  const trends: Trend[] = [];
  let i = start;
  while (i < tokens.length && tokens[i] !== "RMK") {
    const t = tokens[i];
    if (t === "NOSIG") {
      trends.push({
        ...newConditions(),
        kind: "NOSIG",
        raw: t,
        groups: [{ raw: t, meaning: "No significant change expected in the next 2 hours" }],
      });
      i++;
      continue;
    }
    if (t !== "BECMG" && t !== "TEMPO") break;
    const trend: Trend = { ...newConditions(), kind: t, raw: t };
    trend.groups.push({
      raw: t,
      meaning: t === "BECMG" ? "Becoming, in the next 2 hours:" : "Temporarily, in the next 2 hours:",
    });
    const words = [t];
    i++;
    while (i < tokens.length && !["NOSIG", "BECMG", "TEMPO", "RMK"].includes(tokens[i])) {
      const m = /^(FM|TL|AT)(\d{2})(\d{2})$/.exec(tokens[i]);
      if (m) {
        const what = { FM: "From", TL: "Until", AT: "At" }[m[1]];
        trend.groups.push({ raw: tokens[i], meaning: `${what} ${m[2]}:${m[3]}Z` });
        words.push(tokens[i++]);
        continue;
      }
      const used = conditionGroup(tokens, i, trend);
      if (!used) trend.undecoded.push(tokens[i]);
      words.push(...tokens.slice(i, i + Math.max(used, 1)));
      i += Math.max(used, 1);
    }
    trend.raw = words.join(" ");
    trends.push(trend);
  }
  return { trends, end: i };
}

/** Decodes a METAR or SPECI. `ref` places the day of the month in time. */
export function parseMetar(raw: string, ref = new Date()): Metar {
  const tokens = tokenize(raw);
  const metar: Metar = {
    ...newConditions(),
    raw: tokens.join(" "),
    type: "METAR",
    station: "",
    auto: false,
    corrected: false,
    recent: [],
    trends: [],
    remarkGroups: [],
  };
  const add = (r: string, meaning: string) => metar.groups.push({ raw: r, meaning });
  let i = 0;
  if (tokens[i] === "METAR" || tokens[i] === "SPECI") {
    metar.type = tokens[i] as "METAR" | "SPECI";
    add(tokens[i], tokens[i] === "SPECI" ? "Special report, issued when conditions change" : "Routine weather report");
    i++;
  }
  if (tokens[i] === "COR") {
    metar.corrected = true;
    add(tokens[i++], "Corrected report");
  }
  if (/^[A-Z][A-Z0-9]{3}$/.test(tokens[i] ?? "")) {
    metar.station = tokens[i];
    add(tokens[i++], `Station ${metar.station}`);
  } else throw new Error("Not a METAR: it should start with a 4-letter station code like LFPG or KJFK");
  const time = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i] ?? "");
  if (time) {
    metar.time = dayTime(+time[1], +time[2], +time[3], ref);
    add(tokens[i++], metar.time ? `Observed ${zulu(metar.time)}` : "Observation time");
  }
  while (tokens[i] === "AUTO" || tokens[i] === "COR" || tokens[i] === "NIL") {
    if (tokens[i] === "AUTO") {
      metar.auto = true;
      add(tokens[i], "Fully automatic observation");
    } else if (tokens[i] === "COR") {
      metar.corrected = true;
      add(tokens[i], "Corrected report");
    } else add(tokens[i], "Missing report");
    i++;
  }
  for (; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "RMK" || t === "NOSIG" || t === "BECMG" || t === "TEMPO") break;
    const used = conditionGroup(tokens, i, metar);
    if (used) {
      i += used - 1;
      continue;
    }
    let m = /^(M?\d{2})\/(M?\d{2})?$/.exec(t);
    if (m) {
      const n = (s: string) => Number(s.replace("M", "-"));
      metar.temperature = n(m[1]);
      metar.dewpoint = m[2] ? n(m[2]) : undefined;
      add(
        t,
        `Temperature ${temperatureText(metar.temperature)}${
          metar.dewpoint !== undefined ? `, dew point ${temperatureText(metar.dewpoint)}` : ""
        }`,
      );
      continue;
    }
    m = /^([QA])(\d{4})$/.exec(t);
    if (m) {
      const n = Number(m[2]);
      metar.pressure = m[1] === "Q"
        ? { hpa: n, inhg: n / HPA_PER_INHG, unit: "hPa" }
        : { hpa: n / 100 * HPA_PER_INHG, inhg: n / 100, unit: "inHg" };
      add(t, `Altimeter setting (QNH) ${pressureText(metar.pressure)}`);
      continue;
    }
    if (t.startsWith("RE")) {
      const w = describeWeather(t.slice(2)) ?? describeWeather(t);
      if (w) {
        metar.recent.push(w);
        add(t, `Recent ${w}`);
        continue;
      }
    }
    if (/^\/+$/.test(t)) {
      add(t, "Not reported");
      continue;
    }
    metar.undecoded.push(t);
  }
  const trends = readTrends(tokens, i);
  metar.trends = trends.trends;
  i = trends.end;
  if (tokens[i] === "RMK") {
    metar.remarks = tokens.slice(i + 1).join(" ");
    metar.remarkGroups = decodeRemarks(metar.remarks);
  }
  return metar;
}

// ---------------------------------------------------------------------------
// TAF

const CHANGE_RE = /^(FM\d{6}|BECMG|TEMPO|INTER|PROB\d{2}|RMK|TX\S+|TN\S+)$/;

/** Decodes a TAF. `ref` (the issue time, or now) places the days of the month in time. */
export function parseTaf(raw: string, ref = new Date()): Taf {
  const tokens = tokenize(raw);
  const taf: Taf = {
    raw: tokens.join(" "),
    station: "",
    amended: false,
    corrected: false,
    cancelled: false,
    periods: [],
    temperatures: [],
  };
  let i = 0;
  if (tokens[i] === "TAF") i++;
  while (tokens[i] === "AMD" || tokens[i] === "COR") {
    if (tokens[i] === "AMD") taf.amended = true;
    else taf.corrected = true;
    i++;
  }
  if (!/^[A-Z][A-Z0-9]{3}$/.test(tokens[i] ?? "")) {
    throw new Error("Not a TAF: it should start with TAF and a 4-letter station code like LFPG");
  }
  taf.station = tokens[i++];
  const issued = /^(\d{2})(\d{2})(\d{2})Z$/.exec(tokens[i] ?? "");
  if (issued) {
    taf.issued = dayTime(+issued[1], +issued[2], +issued[3], ref);
    i++;
  }
  const valid = validity(tokens[i] ?? "", taf.issued ?? ref);
  if (valid) {
    taf.from = valid.from;
    taf.to = valid.to;
    i++;
  }
  if (tokens[i] === "NIL" || tokens[i] === "CNL") {
    taf.cancelled = true;
    return taf;
  }

  const anchor = taf.issued ?? taf.from ?? ref;
  let period: TafPeriod = { ...newConditions(), kind: "BASE", from: taf.from, to: taf.to, raw: "" };
  let words: string[] = [];
  const close = () => {
    period.raw = words.join(" ");
    if (words.length) taf.periods.push(period);
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "RMK") {
      taf.remarks = tokens.slice(i + 1).join(" ");
      break;
    }
    let m = /^T([XN])(M?\d{2})\/(\d{2})(\d{2})Z$/.exec(t);
    if (m) {
      taf.temperatures.push({
        kind: m[1] === "X" ? "max" : "min",
        value: Number(m[2].replace("M", "-")),
        at: dayTime(+m[3], +m[4], 0, anchor),
      });
      i++;
      continue;
    }
    m = /^FM(\d{2})(\d{2})(\d{2})$/.exec(t);
    if (m || t === "BECMG" || t === "TEMPO" || t === "INTER" || /^PROB\d{2}$/.test(t)) {
      close();
      words = [t];
      if (m) {
        period = { ...newConditions(), kind: "FM", from: dayTime(+m[1], +m[2], +m[3], anchor), to: taf.to, raw: t };
        i++;
      } else {
        const kind: PeriodKind = t.startsWith("PROB") ? "PROB" : t as PeriodKind;
        period = { ...newConditions(), kind, raw: t };
        if (kind === "PROB") {
          period.probability = Number(t.slice(4));
          if (tokens[i + 1] === "TEMPO" || tokens[i + 1] === "INTER") {
            period.tempo = tokens[i + 1] as "TEMPO" | "INTER";
            words.push(tokens[++i]);
          }
        }
        i++;
        const v = validity(tokens[i] ?? "", anchor);
        if (v) {
          period.from = v.from;
          period.to = v.to;
          words.push(tokens[i++]);
        }
      }
      continue;
    }
    words.push(t);
    const used = conditionGroup(tokens, i, period);
    if (used) {
      words.push(...tokens.slice(i + 1, i + used));
      i += used;
      continue;
    }
    if (/^(M?\d{2})\/(M?\d{2})$/.test(t) || CHANGE_RE.test(t)) period.undecoded.push(t);
    else if (/^(QNH)?\d{4}INS$/.test(t)) {
      period.groups.push({
        raw: t,
        meaning: `Lowest altimeter ${t.replace(/\D/g, "").replace(/(\d\d)$/, ".$1")} inHg`,
      });
    } else if (/^\d{6}$/.test(t) || /^[56]\d{5}$/.test(t)) {
      period.groups.push({
        raw: t,
        meaning: t[0] === "5" ? "Turbulence forecast" : t[0] === "6" ? "Icing forecast" : "Forecast group",
      });
    } else period.undecoded.push(t);
    i++;
  }
  close();

  // An FM period lasts until the next one.
  const fms = taf.periods.filter((p) => p.kind === "BASE" || p.kind === "FM");
  for (let k = 0; k < fms.length - 1; k++) fms[k].to = fms[k + 1].from ?? fms[k].to;
  return taf;
}

/** "From Sun 1, 21:00Z", "Temporarily Mon 2, 04:00Z → 10:00Z, 40 % chance". */
export function periodTitle(p: TafPeriod): string {
  const span = p.from && p.to
    ? `${zulu(p.from)} → ${p.from.getUTCDate() === p.to.getUTCDate() ? zulu(p.to, false) : zulu(p.to)}`
    : "";
  switch (p.kind) {
    case "BASE":
      return `Initially, ${span}`;
    case "FM":
      return p.from ? `From ${zulu(p.from)}` : "From";
    case "BECMG":
      return `Becoming, ${span}`;
    case "TEMPO":
      return `Temporarily, ${span}`;
    case "INTER":
      return `Intermittently, ${span}`;
    case "PROB":
      return `${p.probability} % chance${
        p.tempo === "TEMPO" ? ", temporarily" : p.tempo === "INTER" ? ", intermittently" : ""
      }, ${span}`;
  }
}

export const PERIOD_TAG: Record<
  PeriodKind,
  { text: (p: TafPeriod) => string; color: "gray" | "blue" | "orange" | "purple" }
> = {
  BASE: { text: () => "Base", color: "gray" },
  FM: { text: () => "FM", color: "gray" },
  BECMG: { text: () => "BECMG", color: "blue" },
  TEMPO: { text: () => "TEMPO", color: "orange" },
  INTER: { text: () => "INTER", color: "orange" },
  PROB: { text: (p) => `PROB${p.probability}${p.tempo ? ` ${p.tempo}` : ""}`, color: "purple" },
};

/** One line for a set of conditions: "CAVOK · 230° 3 kt", "4 km · mist · BKN 200 ft". */
export function conditionsSummary(c: Conditions): string {
  const parts: string[] = [];
  if (c.wind) parts.push(windShort(c.wind));
  if (c.cavok) parts.push("CAVOK");
  else if (c.visibility) parts.push(visibilityShort(c.visibility));
  parts.push(...c.weather);
  if (c.noSignificantWeather) parts.push("weather ending");
  for (const l of c.clouds) {
    parts.push(`${l.cover}${l.base !== undefined ? ` ${thousands(l.base)} ft` : ""}${l.type ? ` ${l.type}` : ""}`);
  }
  if (c.clear && !c.cavok) parts.push(c.clear === "CLR" || c.clear === "SKC" ? "clear sky" : "no significant clouds");
  return parts.join(" · ") || "No change in the decoded groups";
}

export function metarSummary(m: Metar): string {
  const parts: string[] = [];
  if (m.temperature !== undefined) parts.push(`${m.temperature} °C`);
  parts.push(conditionsSummary(m));
  if (m.pressure) parts.push(m.pressure.unit === "hPa" ? `Q${m.pressure.hpa}` : `A${m.pressure.inhg.toFixed(2)}`);
  return parts.join(" · ");
}

/** Markdown table of the groups and their meaning. */
export function groupsTable(groups: Group[], undecoded: string[] = []): string {
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  const rows = groups.map((g) => `| \`${esc(g.raw)}\` | ${esc(g.meaning)} |`);
  for (const u of undecoded) rows.push(`| \`${esc(u)}\` | *Not decoded* |`);
  return rows.length ? ["| Group | Means |", "|---|---|", ...rows].join("\n") : "";
}

/** The whole METAR in words, for copying. */
export function metarInWords(m: Metar): string {
  const lines = m.groups.map((g) => g.meaning);
  for (const t of m.trends) lines.push(...t.groups.map((g) => g.meaning));
  lines.push(...m.remarkGroups.map((g) => g.meaning));
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Airports: ICAO codes, and IATA codes for the airports people type most.

/** IATA → ICAO for large airports. Other 3-letter codes are tried as US airports (JFK → KJFK). */
export const IATA: Record<string, string> = {
  // France and Benelux
  CDG: "LFPG",
  ORY: "LFPO",
  BVA: "LFOB",
  LYS: "LFLL",
  NCE: "LFMN",
  MRS: "LFML",
  TLS: "LFBO",
  BOD: "LFBD",
  NTE: "LFRS",
  LIL: "LFQQ",
  SXB: "LFST",
  MPL: "LFMT",
  BIQ: "LFBZ",
  RNS: "LFRN",
  BRU: "EBBR",
  CRL: "EBCI",
  AMS: "EHAM",
  EIN: "EHEH",
  RTM: "EHRD",
  LUX: "ELLX",
  // Switzerland, Germany, Austria
  GVA: "LSGG",
  ZRH: "LSZH",
  BSL: "LFSB",
  FRA: "EDDF",
  MUC: "EDDM",
  BER: "EDDB",
  HAM: "EDDH",
  DUS: "EDDL",
  CGN: "EDDK",
  STR: "EDDS",
  VIE: "LOWW",
  // United Kingdom and Ireland
  LHR: "EGLL",
  LGW: "EGKK",
  STN: "EGSS",
  LTN: "EGGW",
  LCY: "EGLC",
  MAN: "EGCC",
  EDI: "EGPH",
  GLA: "EGPF",
  BHX: "EGBB",
  BRS: "EGGD",
  DUB: "EIDW",
  // Southern Europe
  MAD: "LEMD",
  BCN: "LEBL",
  AGP: "LEMG",
  PMI: "LEPA",
  VLC: "LEVC",
  SVQ: "LEZL",
  LIS: "LPPT",
  OPO: "LPPR",
  FAO: "LPFR",
  FCO: "LIRF",
  CIA: "LIRA",
  MXP: "LIMC",
  LIN: "LIML",
  BGY: "LIME",
  VCE: "LIPZ",
  NAP: "LIRN",
  BLQ: "LIPE",
  ATH: "LGAV",
  IST: "LTFM",
  SAW: "LTFJ",
  AYT: "LTAI",
  MLA: "LMML",
  // Northern and Eastern Europe
  CPH: "EKCH",
  OSL: "ENGM",
  ARN: "ESSA",
  HEL: "EFHK",
  KEF: "BIKF",
  WAW: "EPWA",
  KRK: "EPKK",
  PRG: "LKPR",
  BUD: "LHBP",
  OTP: "LROP",
  SOF: "LBSF",
  // North Africa and Middle East
  CMN: "GMMN",
  RAK: "GMMX",
  ALG: "DAAG",
  TUN: "DTTA",
  CAI: "HECA",
  TLV: "LLBG",
  DXB: "OMDB",
  AUH: "OMAA",
  DOH: "OTHH",
  RUH: "OERK",
  JED: "OEJN",
  // Africa
  JNB: "FAOR",
  CPT: "FACT",
  NBO: "HKJK",
  ADD: "HAAB",
  LOS: "DNMM",
  DSS: "GOBD",
  ABJ: "DIAP",
  RUN: "FMEE",
  MRU: "FIMP",
  // Asia
  HND: "RJTT",
  NRT: "RJAA",
  KIX: "RJBB",
  ITM: "RJOO",
  ICN: "RKSI",
  GMP: "RKSS",
  PEK: "ZBAA",
  PKX: "ZBAD",
  PVG: "ZSPD",
  SHA: "ZSSS",
  CAN: "ZGGG",
  SZX: "ZGSZ",
  HKG: "VHHH",
  TPE: "RCTP",
  SIN: "WSSS",
  KUL: "WMKK",
  BKK: "VTBS",
  DMK: "VTBD",
  CGK: "WIII",
  DPS: "WADD",
  MNL: "RPLL",
  SGN: "VVTS",
  HAN: "VVNB",
  DEL: "VIDP",
  BOM: "VABB",
  BLR: "VOBL",
  // Oceania
  SYD: "YSSY",
  MEL: "YMML",
  BNE: "YBBN",
  PER: "YPPH",
  AKL: "NZAA",
  CHC: "NZCH",
  PPT: "NTAA",
  NOU: "NWWW",
  HNL: "PHNL",
  // Canada
  YYZ: "CYYZ",
  YUL: "CYUL",
  YVR: "CYVR",
  YYC: "CYYC",
  YOW: "CYOW",
  YQB: "CYQB",
  YEG: "CYEG",
  YHZ: "CYHZ",
  // Mexico, Caribbean, Latin America
  MEX: "MMMX",
  CUN: "MMUN",
  PTP: "TFFR",
  FDF: "TFFF",
  SJU: "TJSJ",
  PUJ: "MDPC",
  HAV: "MUHA",
  PTY: "MPTO",
  BOG: "SKBO",
  LIM: "SPJC",
  SCL: "SCEL",
  EZE: "SAEZ",
  AEP: "SABE",
  GRU: "SBGR",
  GIG: "SBGL",
  CAY: "SOCA",
  // Alaska (not K…)
  ANC: "PANC",
  FAI: "PAFA",
};

export interface Code {
  /** What was typed, upper-cased. */
  typed: string;
  icao: string;
  /** Read as a US airport (`JFK` → `KJFK`) because it isn't in the table. */
  guessed: boolean;
}

/** "cdg, kjfk ord" → LFPG, KJFK, KORD. Unknown words are left out. */
export function parseCodes(text: string): Code[] {
  const seen = new Set<string>();
  const codes: Code[] = [];
  for (const word of text.toUpperCase().split(/[\s,;]+/).filter(Boolean)) {
    let code: Code | undefined;
    if (/^[A-Z][A-Z0-9]{3}$/.test(word)) code = { typed: word, icao: word, guessed: false };
    else if (/^[A-Z]{3}$/.test(word)) {
      code = IATA[word]
        ? { typed: word, icao: IATA[word], guessed: false }
        : { typed: word, icao: `K${word}`, guessed: true };
    }
    if (code && !seen.has(code.icao)) {
      seen.add(code.icao);
      codes.push(code);
    }
  }
  return codes;
}

/** Whether the text looks like a raw report rather than airport codes. */
export function looksLikeReport(text: string): boolean {
  return /\b\d{6}Z\b/.test(text.toUpperCase());
}

export function isTaf(text: string): boolean {
  const t = text.trim().toUpperCase();
  return t.startsWith("TAF") || /^[A-Z][A-Z0-9]{3}\s+\d{6}Z\s+\d{4}\/\d{4}/.test(t);
}

export const metarUrl = (ids: string[]) => `${API}/metar?ids=${ids.join(",")}&format=json`;
export const tafUrl = (ids: string[]) => `${API}/taf?ids=${ids.join(",")}&format=json`;
export const pageUrl = (icao: string) => `${SITE}/data/metar/?ids=${icao}&taf=1`;

/** What the Data API gives for a METAR: the decoder works from `rawOb`. */
export interface MetarRecord {
  icaoId: string;
  rawOb: string;
  name?: string;
  obsTime?: number;
  lat?: number;
  lon?: number;
  elev?: number;
  fltCat?: string;
}

export interface TafRecord {
  icaoId: string;
  rawTAF: string;
  name?: string;
  issueTime?: string;
}

/** "Paris/De Gaulle Arpt, ID, FR" → "Paris/De Gaulle". */
export function stationName(name: string | undefined): string {
  if (!name) return "";
  return name.split(",")[0].replace(/\s+(Arpt|Airport|Intl|Int'l|International|Aero|Apt)\b\.?/gi, "").trim();
}
