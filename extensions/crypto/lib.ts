// CoinGecko answers, money formatting and text sparklines. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Shapes

/** One coin of `GET /coins/markets`. */
export interface Market {
  id: string;
  symbol: string;
  name: string;
  image?: string | null;
  current_price: number | null;
  market_cap: number | null;
  market_cap_rank: number | null;
  fully_diluted_valuation?: number | null;
  total_volume: number | null;
  high_24h?: number | null;
  low_24h?: number | null;
  price_change_24h?: number | null;
  price_change_percentage_24h?: number | null;
  price_change_percentage_24h_in_currency?: number | null;
  price_change_percentage_7d_in_currency?: number | null;
  circulating_supply?: number | null;
  total_supply?: number | null;
  max_supply?: number | null;
  ath?: number | null;
  ath_change_percentage?: number | null;
  ath_date?: string | null;
  last_updated?: string | null;
  sparkline_in_7d?: { price: number[] } | null;
}

/** One coin of `GET /search`. */
export interface SearchCoin {
  id: string;
  name: string;
  symbol: string;
  market_cap_rank: number | null;
  thumb?: string;
  large?: string;
}

/** A holding of the portfolio, as stored. */
export interface Holding {
  id: string;
  symbol: string;
  name: string;
  image?: string;
  amount: number;
}

// ---------------------------------------------------------------------------
// Currency

export const CURRENCIES = ["usd", "eur", "gbp", "jpy", "chf", "cad", "aud", "cny", "inr", "krw", "brl", "btc", "eth"];

/** The `currency` preference, lowercased; anything unknown falls back to usd. */
export function normalizeCurrency(input: unknown): string {
  const c = String(input ?? "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return CURRENCIES.includes(c) ? c : "usd";
}

const CRYPTO_UNITS: Record<string, string> = { btc: "₿", eth: "Ξ" };

/** Enough digits for a price: 67,123.45 · 0.6123 · 0.00001234. */
function priceDigits(value: number): Intl.NumberFormatOptions {
  const abs = Math.abs(value);
  if (abs === 0 || abs >= 1) return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  return { maximumSignificantDigits: 4 };
}

/** `$67,123.45`, `€0.6123`, `₿0.0234`. */
export function money(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const unit = CRYPTO_UNITS[currency];
  if (unit) return `${unit}${new Intl.NumberFormat("en-US", priceDigits(value)).format(value)}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), ...priceDigits(value) })
    .format(value);
}

/** `$1.32T`, `€45.6B`: market caps and volumes. */
export function compactMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const options: Intl.NumberFormatOptions = { notation: "compact", maximumFractionDigits: 2 };
  const unit = CRYPTO_UNITS[currency];
  if (unit) return `${unit}${new Intl.NumberFormat("en-US", options).format(value)}`;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), ...options })
    .format(value);
}

/** `+$209.14`, `−€3.20`: a change of value. */
export function signedMoney(value: number | null | undefined, currency: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value), currency)}`;
}

/** `19.7M`: supplies. */
export const compact = (value: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(value);

/** `+2.31 %`, `−0.84 %`. */
export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2)} %`;
}

/** Green when up, red when down. */
export const changeColor = (value: number | null | undefined): Color | undefined =>
  !value ? undefined : value > 0 ? "green" : "red";

/** An amount of coins: `0.5`, `1,250`, `0.00012`. */
export const amount = (value: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(value);

/** `"1,5"`, `"0.25 "`, `"2e-3"` → a positive number, or undefined. */
export function parseAmount(input: string): number | undefined {
  let text = input.trim().replace(/\s/g, "");
  // One comma and no dot is a decimal comma (1,5); otherwise commas group thousands (1,250,000.5).
  text = /^[^,.]*,[^,.]*$/.test(text) ? text.replace(",", ".") : text.replace(/,/g, "");
  if (!/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return undefined;
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

// ---------------------------------------------------------------------------
// Sparklines

const BARS = "▁▂▃▄▅▆▇█";

/** Prices → `▂▃▅▇█▆▅▃`, averaged into `width` buckets. */
export function sparkline(prices: number[] | null | undefined, width = 28): string {
  const values = (prices ?? []).filter((p) => Number.isFinite(p));
  if (values.length < 2) return "";
  const n = Math.min(width, values.length);
  const buckets: number[] = [];
  for (let i = 0; i < n; i++) {
    const slice = values.slice(Math.floor((i * values.length) / n), Math.floor(((i + 1) * values.length) / n));
    buckets.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  const min = Math.min(...buckets);
  const max = Math.max(...buckets);
  if (max === min) return BARS[3].repeat(n);
  return buckets.map((v) => BARS[Math.round(((v - min) / (max - min)) * (BARS.length - 1))]).join("");
}

/** The change over the sparkline's window, when the API didn't give one. */
export function sparkChange(prices: number[] | null | undefined): number | undefined {
  const values = (prices ?? []).filter((p) => Number.isFinite(p));
  if (values.length < 2 || !values[0]) return undefined;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
}

// ---------------------------------------------------------------------------
// Coins

export const change24h = (m: Market) => m.price_change_percentage_24h_in_currency ?? m.price_change_percentage_24h;
export const change7d = (m: Market) =>
  m.price_change_percentage_7d_in_currency ?? sparkChange(m.sparkline_in_7d?.price);

export const coinUrl = (id: string) => `https://www.coingecko.com/en/coins/${encodeURIComponent(id)}`;

/** The coin's logo in a size, from any of CoinGecko's sizes (`thumb`, `small`, `large`). */
export function logo(url: string | null | undefined, size: "thumb" | "small" | "large"): string | undefined {
  if (!url || !/^https:\/\//.test(url) || url.includes("missing_")) return undefined;
  return url.replace(/\/(thumb|small|large)\//, `/${size}/`);
}

/** "Price · ▲ 2.31 %" for the root search subtitle. */
export function tickerLine(m: Market, currency: string): string {
  const c = change24h(m);
  const arrow = c === null || c === undefined ? "" : c >= 0 ? " ▲" : " ▼";
  return `${m.symbol.toUpperCase()} ${money(m.current_price, currency)}${arrow}${
    c === null || c === undefined ? "" : ` ${Math.abs(c).toFixed(1)}%`
  }`;
}

/** "18 Mar 2024", or empty. */
export function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Portfolio

export interface Valued {
  holding: Holding;
  market?: Market;
  value?: number;
  /** Change of the holding's value over 24 h, in the currency. */
  change?: number;
  share: number;
}

/** Each holding with its value and share of the total, biggest first. */
export function valuePortfolio(
  holdings: Holding[],
  markets: Market[],
): { rows: Valued[]; total: number; change: number } {
  const byId = new Map(markets.map((m) => [m.id, m]));
  const rows: Valued[] = holdings.map((holding) => {
    const market = byId.get(holding.id);
    const price = market?.current_price ?? undefined;
    const value = price === undefined ? undefined : price * holding.amount;
    const pct = market ? change24h(market) : undefined;
    const change = value === undefined || pct === null || pct === undefined
      ? undefined
      : value - value / (1 + pct / 100);
    return { holding, market, value, change, share: 0 };
  });
  const total = rows.reduce((sum, r) => sum + (r.value ?? 0), 0);
  const change = rows.reduce((sum, r) => sum + (r.change ?? 0), 0);
  for (const r of rows) r.share = total > 0 && r.value ? r.value / total : 0;
  rows.sort((a, b) => (b.value ?? -1) - (a.value ?? -1));
  return { rows, total, change };
}

/** Adds to an existing holding of the same coin, or appends it. */
export function upsertHolding(holdings: Holding[], h: Holding, mode: "set" | "add" = "set"): Holding[] {
  const existing = holdings.find((x) => x.id === h.id);
  if (!existing) return [...holdings, h];
  return holdings.map((x) =>
    x.id === h.id ? { ...x, ...h, amount: mode === "add" ? x.amount + h.amount : h.amount } : x
  );
}

/** A market for a coin found by search, before its price is known. */
export function searchToMarket(c: SearchCoin): Market {
  return {
    id: c.id,
    symbol: c.symbol,
    name: c.name,
    image: c.large ?? c.thumb,
    current_price: null,
    market_cap: null,
    market_cap_rank: c.market_cap_rank,
    total_volume: null,
  };
}
