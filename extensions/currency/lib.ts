// Currency conversions typed in the search bar: `20 € en $`, `$15 to eur`,
// `100 chf in jpy`, at rates relative to one base currency.

/** ISO codes of the currencies the European Central Bank publishes rates for. */
export const CURRENCIES = [
  "EUR",
  "USD",
  "GBP",
  "JPY",
  "CHF",
  "CAD",
  "AUD",
  "NZD",
  "CNY",
  "HKD",
  "SGD",
  "SEK",
  "NOK",
  "DKK",
  "PLN",
  "CZK",
  "HUF",
  "RON",
  "BGN",
  "TRY",
  "ILS",
  "INR",
  "IDR",
  "KRW",
  "MXN",
  "BRL",
  "ZAR",
  "THB",
  "PHP",
  "MYR",
  "ISK",
];

/** Symbols and the currency each one means. */
export const SYMBOLS: [string, string][] = [
  ["€", "EUR"],
  ["$", "USD"],
  ["£", "GBP"],
  ["¥", "JPY"],
  ["₹", "INR"],
  ["₩", "KRW"],
  ["₺", "TRY"],
  ["₪", "ILS"],
];

/** Words between the amount and the target currency. Tried in this order. */
const SEPARATORS = [" to ", " in ", " en ", " as ", " vers ", "->", "=>", " → ", "→", " = "];

export function findCurrency(name: string): string | undefined {
  const n = name.trim();
  const symbol = SYMBOLS.find(([s]) => s === n);
  if (symbol) return symbol[1];
  const upper = n.replace(/[a-z]/g, (c) => c.toUpperCase());
  return CURRENCIES.includes(upper) ? upper : undefined;
}

/** Splits `"20 €"`, `"20€"`, `"$20"` or `"1,5 chf"` into the amount and the rest. */
export function splitNumber(text: string): [number, string] | undefined {
  const s = text.trim();
  // Symbols may come first: "$20 to €".
  for (const [symbol] of SYMBOLS) {
    if (s.startsWith(symbol)) {
      const inner = splitNumber(s.slice(symbol.length));
      if (inner && inner[1].trim() === "") return [inner[0], symbol];
    }
  }
  let end = 0;
  while (end < s.length && (/[0-9.,]/.test(s[end]) || (end === 0 && s[end] === "-"))) end++;
  const number = s.slice(0, end).trim().replaceAll(",", ".");
  if (!/^-?(\d+\.?\d*|\.\d+)$/.test(number)) return undefined;
  return [Number(number), s.slice(end).trim()];
}

export interface Request {
  amount: number;
  from: string;
  to: string;
}

/** Recognizes a currency conversion; `undefined` for anything else. */
export function parse(query: string): Request | undefined {
  const q = query.trim();
  if (new TextEncoder().encode(q).length > 80) return undefined;
  const lower = q.toLowerCase();
  const sep = SEPARATORS.find((s) => lower.includes(s));
  if (!sep) return undefined;
  const i = lower.indexOf(sep);
  const split = splitNumber(q.slice(0, i));
  if (!split) return undefined;
  const [amount, fromText] = split;
  const toText = q.slice(i + sep.length).trim();
  if (!fromText || !toText) return undefined;
  const from = findCurrency(fromText);
  const to = findCurrency(toText);
  return from && to ? { amount, from, to } : undefined;
}

/** Exchange rates relative to one base currency, as Frankfurter answers them. */
export type Rates = {
  base: string;
  /** Date of the rates, `YYYY-MM-DD`. */
  date: string;
  rates: Record<string, number>;
  /** When they were downloaded, in milliseconds since the epoch. */
  fetched: number;
};

function rate(rates: Rates, code: string): number | undefined {
  return code === rates.base ? 1 : rates.rates[code];
}

export function convert(rates: Rates, amount: number, from: string, to: string): number | undefined {
  const [f, t] = [rate(rates, from), rate(rates, to)];
  return f === undefined || t === undefined ? undefined : amount / f * t;
}

/** Rates are downloaded again after this long. */
export const MAX_AGE = 12 * 3600 * 1000;
/** And not tried again sooner than this after a failure. */
export const RETRY_AFTER = 60 * 1000;

/** Checks a Frankfurter answer before it is used and kept. */
export function parseRates(body: unknown, now: number): Rates {
  const b = body as Partial<Rates> | null;
  const valid = typeof b?.base === "string" && typeof b.date === "string" && typeof b.rates === "object" &&
    b.rates !== null && Object.values(b.rates).every((v) => typeof v === "number" && v > 0);
  if (!valid) throw new Error("unexpected answer from the rates service");
  return { base: b.base!, date: b.date!, rates: b.rates!, fetched: now };
}
