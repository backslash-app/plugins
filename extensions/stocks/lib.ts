// Finnhub answers and their formatting. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Shapes

/** `GET /quote`: c current, d change, dp change %, h/l day high/low, o open, pc previous close, t time (s). */
export interface Quote {
  c: number;
  d: number | null;
  dp: number | null;
  h: number;
  l: number;
  o: number;
  pc: number;
  t: number;
}

/** `GET /stock/profile2`. `marketCapitalization` is in millions of `currency`. */
export interface Profile {
  country?: string;
  currency?: string;
  exchange?: string;
  finnhubIndustry?: string;
  ipo?: string;
  logo?: string;
  marketCapitalization?: number;
  name?: string;
  phone?: string;
  shareOutstanding?: number;
  ticker?: string;
  weburl?: string;
}

/** One result of `GET /search`. */
export interface SymbolMatch {
  description: string;
  displaySymbol: string;
  symbol: string;
  type: string;
}

/** One article of `GET /company-news`. */
export interface News {
  category?: string;
  datetime: number;
  headline: string;
  id: number;
  image?: string;
  related?: string;
  source?: string;
  summary?: string;
  url: string;
}

/** `GET /stock/metric?metric=all`, the few values we show. */
export interface Metrics {
  metric?: {
    "52WeekHigh"?: number;
    "52WeekLow"?: number;
    "52WeekHighDate"?: string;
    "52WeekLowDate"?: string;
    peBasicExclExtraTTM?: number;
    peTTM?: number;
    beta?: number;
    dividendYieldIndicatedAnnual?: number;
    epsTTM?: number;
  };
}

/** `GET /stock/market-status?exchange=US`. */
export interface MarketStatus {
  exchange: string;
  holiday: string | null;
  isOpen: boolean;
  session: "pre-market" | "regular" | "post-market" | null | string;
  timezone?: string;
  t?: number;
}

// ---------------------------------------------------------------------------
// Formatting

/** Finnhub answers zeros for a symbol it has no quote for. */
export const hasQuote = (q: Quote | undefined): q is Quote => !!q && (q.c !== 0 || q.pc !== 0);

/** `189.84`, `0.0123`: prices without a currency sign (Finnhub mixes exchanges). */
export function price(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const digits = abs > 0 && abs < 1
    ? { maximumSignificantDigits: 4 }
    : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return new Intl.NumberFormat("en-US", digits).format(value);
}

/** `$189.84`, `€12.30`, or a bare price for unknown currencies. */
export function money(value: number | null | undefined, currency?: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (!currency || !/^[A-Z]{3}$/.test(currency)) return price(value);
  try {
    const abs = Math.abs(value);
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      ...(abs > 0 && abs < 1
        ? { maximumSignificantDigits: 4 }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    }).format(value);
  } catch {
    return price(value);
  }
}

export function signed(value: number | null | undefined, suffix = ""): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${price(Math.abs(value))}${suffix}`;
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(2)} %`;
}

export const changeColor = (value: number | null | undefined): Color | undefined =>
  !value ? undefined : value > 0 ? "green" : "red";

/** Market cap in millions → `$2.9T`, `€412.3B`. */
export function marketCap(millions: number | undefined, currency = "USD"): string {
  if (!millions || !Number.isFinite(millions)) return "—";
  const value = millions * 1e6;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);
  }
}

/** Where the price is between the day's low and high, from 0 to 1. */
export function dayPosition(q: Quote): number | undefined {
  if (!(q.h > q.l)) return undefined;
  return Math.max(0, Math.min(1, (q.c - q.l) / (q.h - q.l)));
}

/** `AAPL 189.84 ▲ 1.17%` for the root search subtitle. */
export function tickerLine(symbol: string, q: Quote): string {
  const arrow = q.dp === null ? "" : q.dp >= 0 ? " ▲" : " ▼";
  return `${symbol} ${price(q.c)}${arrow}${q.dp === null ? "" : ` ${Math.abs(q.dp).toFixed(2)}%`}`;
}

/** "5 min", "3 h", "2 d", then a date, from Unix seconds. */
export function ago(seconds: number, now = Date.now()): string {
  const s = Math.max(0, Math.round(now / 1000 - seconds));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(seconds * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "Wed 28 Oct, 16:00" from Unix seconds. */
export function quoteTime(seconds: number): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `YYYY-MM-DD` in UTC. */
export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** "Open", "Pre-market", "After hours", "Closed (Thanksgiving)". */
export function marketLine(m: MarketStatus | undefined): string | undefined {
  if (!m) return undefined;
  if (m.holiday) return `US market closed (${m.holiday})`;
  if (m.session === "regular" || (m.isOpen && !m.session)) return "US market open";
  if (m.session === "pre-market") return "US pre-market";
  if (m.session === "post-market") return "US after hours";
  return "US market closed";
}

// ---------------------------------------------------------------------------
// Symbols

/** What the user typed → a symbol to look up: ` aapl ` → `AAPL`. */
export const normalizeSymbol = (s: string) => s.trim().toUpperCase().replace(/\s+/g, "");

/**
 * Search results worth showing: stocks and funds, the primary listing first
 * (`AAPL` before `AAPL.MX`), unless the query names an exchange suffix.
 */
export function rankMatches(matches: SymbolMatch[], query: string, limit = 12): SymbolMatch[] {
  const q = normalizeSymbol(query);
  const seen = new Set<string>();
  const kept = matches.filter((m) => {
    if (!m.symbol || seen.has(m.symbol)) return false;
    seen.add(m.symbol);
    return q.includes(".") || !m.symbol.includes(".");
  });
  const score = (m: SymbolMatch) => (m.symbol === q ? 0 : m.symbol.startsWith(q) ? 1 : 2);
  return kept.map((m, i) => ({ m, i })).sort((a, b) => score(a.m) - score(b.m) || a.i - b.i).slice(0, limit).map((
    x,
  ) => x.m);
}

/** "APPLE INC" → "Apple Inc", leaving short tickers-like words (ETF, AG) upper case. */
export function titleCase(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name.toLowerCase().replace(
    /\b([a-z])([a-z]*)/g,
    (w, first: string, rest: string) =>
      ["etf", "ag", "se", "sa", "nv", "plc", "spa", "usd", "ii", "iii"].includes(w)
        ? w.toUpperCase()
        : first.toUpperCase() + rest,
  );
}

export const domain = (url: string | undefined) => {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

export const yahooUrl = (symbol: string) => `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`;

/** Moves `symbol` one place up or down. */
export function move(list: string[], symbol: string, by: -1 | 1): string[] {
  const i = list.indexOf(symbol);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
