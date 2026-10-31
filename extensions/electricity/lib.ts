// EDF Tempo colors, RTE EcoWatt signals and French day-ahead prices: parsing and formatting, no I/O.

/** Same list as `[permissions] net` in backslash.toml. */
export const HOSTS = ["www.api-couleur-tempo.fr", "digital.iservices.rte-france.com", "api.energy-charts.info"];

export const TEMPO_API = "https://www.api-couleur-tempo.fr/api";
export const RTE_TOKEN_URL = "https://digital.iservices.rte-france.com/token/oauth/";
export const ECOWATT_URL = "https://digital.iservices.rte-france.com/open_api/ecowatt/v5/signals";
export const SPOT_API = "https://api.energy-charts.info/price";

// ---------------------------------------------------------------------------
// Dates (France)

/** "YYYY-MM-DD" of `date` in Paris. */
export function parisDate(date: Date | number = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** The hour (0–23) of `date` in Paris. */
export function parisHour(date: Date | number = new Date()): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23" })
    .format(date);
  return Number(h) % 24;
}

/** "2026-10-31" + n days, calendar arithmetic only. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Saturday 31 October" for a "YYYY-MM-DD" day. */
export function longDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
}

/** "Sat 31" for a "YYYY-MM-DD" day. */
export function shortDay(day: string): string {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/** The Tempo season a day belongs to: from 1 September to 31 August, "2026-2027". */
export function seasonOf(day: string): string {
  const [y, m] = day.split("-").map(Number);
  return m >= 9 ? `${y}-${y + 1}` : `${y - 1}-${y}`;
}

// ---------------------------------------------------------------------------
// Tempo

export type TempoColor = "blue" | "white" | "red" | "unknown";

export interface TempoDay {
  /** "YYYY-MM-DD" */
  date: string;
  color: TempoColor;
  period?: string;
}

export const COLORS: Record<
  TempoColor,
  { title: string; french: string; tint?: "blue" | "red" | "gray"; dot: string }
> = {
  blue: { title: "Blue", french: "Bleu", tint: "blue", dot: "🔵" },
  white: { title: "White", french: "Blanc", dot: "⚪" },
  red: { title: "Red", french: "Rouge", tint: "red", dot: "🔴" },
  unknown: { title: "Not known yet", french: "Non défini", tint: "gray", dot: "◌" },
};

/** codeJour of api-couleur-tempo.fr: 1 blue, 2 white, 3 red, 0 (or anything else) not announced yet. */
export function colorOf(code: unknown, label?: unknown): TempoColor {
  const n = Number(code);
  if (n === 1) return "blue";
  if (n === 2) return "white";
  if (n === 3) return "red";
  const l = String(label ?? "").toLowerCase();
  if (l.startsWith("bleu") || l === "blue") return "blue";
  if (l.startsWith("blanc") || l === "white") return "white";
  if (l.startsWith("rouge") || l === "red") return "red";
  return "unknown";
}

/** `{"dateJour":"2026-10-31","codeJour":1,"periode":"2026-2027","libCouleur":"Bleu"}` → a day. */
export function parseTempoDay(json: unknown): TempoDay | undefined {
  if (!json || typeof json !== "object") return undefined;
  const o = json as Record<string, unknown>;
  const date = String(o.dateJour ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return undefined;
  return { date, color: colorOf(o.codeJour, o.libCouleur), period: o.periode ? String(o.periode) : undefined };
}

/** The days of a season (`/joursTempo?periode=`), sorted, invalid entries dropped. */
export function parseTempoDays(json: unknown): TempoDay[] {
  if (!Array.isArray(json)) return [];
  return json.flatMap((d) => parseTempoDay(d) ?? []).sort((a, b) => a.date.localeCompare(b.date));
}

export interface TempoStats {
  period: string;
  lastIncluded?: string;
  used: Record<"blue" | "white" | "red", number>;
  remaining: Record<"blue" | "white" | "red", number>;
}

const num = (v: unknown) => Number.isFinite(Number(v)) ? Number(v) : 0;

/** `/api/stats`: days used and left this season. */
export function parseStats(json: unknown): TempoStats | undefined {
  if (!json || typeof json !== "object") return undefined;
  const o = json as Record<string, unknown>;
  if (o.joursBleusRestants === undefined && o.joursRougesRestants === undefined) return undefined;
  return {
    period: String(o.periode ?? ""),
    lastIncluded: o.dernierJourInclus ? String(o.dernierJourInclus) : undefined,
    used: { blue: num(o.joursBleusConsommes), white: num(o.joursBlancsConsommes), red: num(o.joursRougesConsommes) },
    remaining: { blue: num(o.joursBleusRestants), white: num(o.joursBlancsRestants), red: num(o.joursRougesRestants) },
  };
}

/** Red days only fall on weekdays from 1 November to 31 March. */
export function canBeRed(day: string): boolean {
  const d = new Date(`${day}T12:00:00Z`);
  const m = d.getUTCMonth() + 1;
  const wd = d.getUTCDay();
  return (m >= 11 || m <= 3) && wd !== 0 && wd !== 6;
}

/** Root search line: "Today Blue · Tomorrow Red". */
export function tempoSubtitle(today?: TempoDay, tomorrow?: TempoDay): string | null {
  if (!today) return null;
  const t = COLORS[today.color].title;
  if (!tomorrow || tomorrow.color === "unknown") return `Today ${t} · tomorrow after 11:00`;
  return `Today ${t} · Tomorrow ${COLORS[tomorrow.color].title}`;
}

/** The last `n` days up to `until` included as colored dots, oldest first. */
export function recentStrip(days: TempoDay[], until: string, n = 14): string {
  const byDate = new Map(days.map((d) => [d.date, d.color]));
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(COLORS[byDate.get(addDays(until, -i)) ?? "unknown"].dot);
  return out.join("");
}

/** Counts of each color in a list of days. */
export function countColors(days: TempoDay[]): Record<TempoColor, number> {
  const out: Record<TempoColor, number> = { blue: 0, white: 0, red: 0, unknown: 0 };
  for (const d of days) out[d.color]++;
  return out;
}

export const TEMPO_HOURS = "A Tempo day runs from 06:00 to 06:00 the next day. Off-peak hours: 22:00–06:00.";

// ---------------------------------------------------------------------------
// EcoWatt

export interface EcowattDay {
  date: string;
  /** 1 green, 2 orange (tight), 3 red (cuts possible). */
  level: number;
  message: string;
  /** 24 hourly levels; 0 means green and low-carbon. */
  hours: number[];
}

export const ECOWATT_LEVELS: Record<number, { title: string; tint: "green" | "orange" | "red" | "teal"; dot: string }> =
  {
    0: { title: "Low carbon", tint: "teal", dot: "🟢" },
    1: { title: "Normal", tint: "green", dot: "🟢" },
    2: { title: "Tight", tint: "orange", dot: "🟠" },
    3: { title: "Cuts possible", tint: "red", dot: "🔴" },
  };

export const ecowattLevel = (n: number) => ECOWATT_LEVELS[n] ?? ECOWATT_LEVELS[1];

/** `{ signals: [{ jour, dvalue, message, values: [{ pas, hvalue }] }] }` → days, soonest first. */
export function parseEcowatt(json: unknown): EcowattDay[] {
  const signals = (json as { signals?: unknown })?.signals;
  if (!Array.isArray(signals)) return [];
  return signals.flatMap((s) => {
    const o = s as Record<string, unknown>;
    const date = String(o.jour ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const hours = new Array(24).fill(Number(o.dvalue) || 1);
    for (const v of Array.isArray(o.values) ? o.values : []) {
      const p = Number((v as Record<string, unknown>).pas);
      const h = Number((v as Record<string, unknown>).hvalue);
      if (p >= 0 && p < 24 && Number.isFinite(h)) hours[p] = h;
    }
    return [{ date, level: Number(o.dvalue) || 1, message: String(o.message ?? "").trim(), hours }];
  }).sort((a, b) => a.date.localeCompare(b.date));
}

/** The secret as RTE wants it in the Basic header: base64 of "client_id:client_secret". Accepts either form. */
export function rteCredentials(raw: unknown): string | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return undefined;
  if (s.includes(":")) return btoa(s);
  return s.replace(/^basic\s+/i, "");
}

/** Hours whose level is above normal: "08:00–10:00, 18:00–20:00". */
export function tightHours(hours: number[]): string {
  const ranges: string[] = [];
  let start = -1;
  for (let h = 0; h <= 24; h++) {
    const tight = h < 24 && hours[h] >= 2;
    if (tight && start < 0) start = h;
    if (!tight && start >= 0) {
      ranges.push(`${pad(start)}:00–${pad(h)}:00`);
      start = -1;
    }
  }
  return ranges.join(", ");
}

const pad = (n: number) => String(n).padStart(2, "0");

// ---------------------------------------------------------------------------
// Day-ahead prices (Energy-Charts, bidding zone FR)

export interface PricePoint {
  /** Start, ms since epoch. */
  start: number;
  /** Length of the slot, ms (15 min since the 15-minute market, 1 h before). */
  length: number;
  /** €/MWh */
  price: number;
}

export function spotUrl(from: string, to: string): string {
  return `${SPOT_API}?bzn=FR&start=${from}&end=${to}`;
}

/** `{ unix_seconds: [...], price: [...], unit }` → slots with a price, in order. */
export function parsePrices(json: unknown): PricePoint[] {
  const o = json as { unix_seconds?: unknown; price?: unknown };
  if (!Array.isArray(o?.unix_seconds) || !Array.isArray(o?.price)) return [];
  const t = o.unix_seconds.map(Number);
  const out: PricePoint[] = [];
  for (let i = 0; i < t.length; i++) {
    const price = o.price[i];
    if (price === null || price === undefined || !Number.isFinite(Number(price)) || !Number.isFinite(t[i])) continue;
    const next = t[i + 1] ?? (i > 0 ? t[i] + (t[i] - t[i - 1]) : t[i] + 3600);
    out.push({ start: t[i] * 1000, length: Math.max(60, next - t[i]) * 1000, price: Number(price) });
  }
  return out;
}

export interface HourPrice {
  hour: number;
  price: number;
}

/** Hourly averages of one Paris day ("YYYY-MM-DD"). */
export function hourlyPrices(points: PricePoint[], day: string): HourPrice[] {
  const sums = new Map<number, { sum: number; n: number }>();
  for (const p of points) {
    if (parisDate(p.start) !== day) continue;
    const h = parisHour(p.start);
    const s = sums.get(h) ?? { sum: 0, n: 0 };
    s.sum += p.price;
    s.n++;
    sums.set(h, s);
  }
  return [...sums].sort((a, b) => a[0] - b[0]).map(([hour, s]) => ({ hour, price: s.sum / s.n }));
}

export interface PriceSummary {
  min: HourPrice;
  max: HourPrice;
  average: number;
  negative: number;
}

export function summarizePrices(hours: HourPrice[]): PriceSummary | undefined {
  if (!hours.length) return undefined;
  let min = hours[0], max = hours[0], sum = 0, negative = 0;
  for (const h of hours) {
    if (h.price < min.price) min = h;
    if (h.price > max.price) max = h;
    if (h.price < 0) negative++;
    sum += h.price;
  }
  return { min, max, average: sum / hours.length, negative };
}

/** The slot containing `now`. */
export function priceAt(points: PricePoint[], now: number): PricePoint | undefined {
  return points.find((p) => p.start <= now && now < p.start + p.length);
}

/** The `n` cheapest consecutive hours of a day, for running the dishwasher: "13:00–16:00". */
export function cheapestWindow(hours: HourPrice[], n = 3): { from: number; to: number; average: number } | undefined {
  let best: { from: number; to: number; average: number } | undefined;
  for (let i = 0; i + n <= hours.length; i++) {
    const slice = hours.slice(i, i + n);
    if (slice[n - 1].hour - slice[0].hour !== n - 1) continue;
    const average = slice.reduce((s, h) => s + h.price, 0) / n;
    if (!best || average < best.average) best = { from: slice[0].hour, to: slice[0].hour + n, average };
  }
  return best;
}

/** 87.3 €/MWh → "87.30 €/MWh". */
export const perMwh = (p: number) => `${p.toFixed(2)} €/MWh`;
/** 87.3 €/MWh → "8.73 c€/kWh". */
export const centsPerKwh = (p: number) => `${(p / 10).toFixed(2)} c€/kWh`;
export const hourRange = (h: number) => `${pad(h)}:00–${pad((h + 1) % 24)}:00`;

/** A text bar for the hourly table, relative to the day's range. */
export function bar(price: number, min: number, max: number, width = 12): string {
  if (max <= min) return "▇".repeat(Math.ceil(width / 2));
  const n = Math.max(1, Math.round(((price - min) / (max - min)) * width));
  return "▇".repeat(n);
}

export function priceTable(hours: HourPrice[], now?: { day: string; hour: number }, day?: string): string {
  const sum = summarizePrices(hours);
  if (!sum) return "_No prices for this day yet. The day-ahead auction closes at noon; prices come out around 13:00._";
  const rows = hours.map((h) => {
    const current = now && day === now.day && h.hour === now.hour;
    const label = current ? `**${hourRange(h.hour)}** ←` : hourRange(h.hour);
    return `| ${label} | ${h.price.toFixed(1)} | ${bar(h.price, sum.min.price, sum.max.price)} |`;
  });
  return ["| Hour | €/MWh | |", "|---|---:|---|", ...rows].join("\n");
}

export const priceTint = (price: number, avg: number) =>
  price < 0 ? "teal" : price <= avg * 0.8 ? "green" : price >= avg * 1.2 ? "red" : "orange";
