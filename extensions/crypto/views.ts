// Coins as launcher items, the holding form and the coin picker.

import {
  type Action,
  action,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  pop,
  refresh,
  replace,
  toast,
} from "@backslash/api";
import { holdings, RateLimited, searchCoins, setHoldings, stale, toggleWatch } from "./api.ts";
import {
  amount,
  change24h,
  change7d,
  changeColor,
  coinUrl,
  compact,
  compactMoney,
  type Holding,
  logo,
  type Market,
  money,
  normalizeCurrency,
  parseAmount,
  percent,
  searchToMarket,
  shortDate,
  sparkline,
  upsertHolding,
} from "./lib.ts";

export interface Settings {
  currency: string;
  apiKey: string;
}

export const settings = (preferences: Record<string, unknown>): Settings => ({
  currency: normalizeCurrency(preferences.currency),
  apiKey: String(preferences.apiKey ?? "").trim(),
});

export const KEY_URL = "https://www.coingecko.com/en/developers/dashboard";

/** Shown instead of results when CoinGecko refuses and nothing is saved. */
export function rateLimitItem(e: RateLimited): Item {
  return {
    id: "rate-limit",
    title: e.message,
    subtitle: "The public API allows a few calls a minute",
    icon: { source: Icons.hourglass, tint: "orange" },
    detail: {
      markdown: [
        "## CoinGecko is rate limiting",
        "",
        "The free public API allows only a few requests a minute per IP address. Prices are cached",
        "for a minute or two, so this passes quickly.",
        "",
        "For a higher limit, create a free **Demo API key** (Enter opens the dashboard) and paste it in",
        "**Settings → Extensions → Crypto → Configure**.",
      ].join("\n"),
    },
    actions: [open(KEY_URL, "Get a Free Demo API Key", { icon: Icons.key })],
  };
}

/** Runs `load`, turning a rate limit without saved data into an explanation row. */
export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof RateLimited) return [rateLimitItem(e)];
    throw e;
  }
}

export function coinIcon(m: Pick<Market, "image">) {
  return logo(m.image, "small") ?? { source: Icons.coin, tint: "yellow" as const };
}

/** The detail panel's lines for a coin. */
export function coinMetadata(m: Market, currency: string): Metadata[] {
  const spark = sparkline(m.sparkline_in_7d?.price);
  const lines: Metadata[] = [];
  if (spark) lines.push(meta.text("7 days", spark, { color: changeColor(change7d(m)) }));
  if (m.low_24h != null && m.high_24h != null) {
    lines.push(meta.text("24 h range", `${money(m.low_24h, currency)} – ${money(m.high_24h, currency)}`));
  }
  lines.push(
    meta.text("Market cap", compactMoney(m.market_cap, currency), { icon: Icons.coin }),
    meta.text("Volume 24 h", compactMoney(m.total_volume, currency), { icon: Icons.activity }),
  );
  if (m.fully_diluted_valuation) {
    lines.push(meta.text("Fully diluted", compactMoney(m.fully_diluted_valuation, currency)));
  }
  if (m.circulating_supply) {
    const max = m.max_supply ?? m.total_supply;
    lines.push(
      max
        ? meta.progress(
          "Supply",
          m.circulating_supply / max,
          `${compact(m.circulating_supply)} of ${compact(max)} ${m.symbol.toUpperCase()}`,
        )
        : meta.text("Supply", `${compact(m.circulating_supply)} ${m.symbol.toUpperCase()}`),
    );
  }
  if (m.ath) {
    lines.push(
      meta.text(
        "All-time high",
        `${money(m.ath, currency)} · ${percent(m.ath_change_percentage)}${
          m.ath_date ? ` · ${shortDate(m.ath_date)}` : ""
        }`,
        { icon: Icons.flag },
      ),
    );
  }
  lines.push(meta.separator(), meta.link("CoinGecko", `coingecko.com/en/coins/${m.id}`, coinUrl(m.id)));
  return lines;
}

/** A coin in the prices list. */
export function coinItem(
  m: Market,
  o: { currency: string; watched: boolean; held?: Holding; section?: string },
): Item {
  const c24 = change24h(m);
  const c7 = change7d(m);
  const symbol = m.symbol.toUpperCase();
  const priced = m.current_price !== null && m.current_price !== undefined;
  const actions: Action[] = [
    open(coinUrl(m.id), "Open on CoinGecko"),
    action(o.watched ? "Remove from Watchlist" : "Add to Watchlist", async () => {
      const now = await toggleWatch(m.id);
      await toast(now ? `${m.name} added to the watchlist` : `${m.name} removed from the watchlist`, {
        style: "success",
      });
      return refresh();
    }, { icon: o.watched ? Icons.starFilled : Icons.star, shortcut: "<Ctrl>s" }),
    action(o.held ? "Edit Holding…" : "Add to Portfolio…", () => holdingForm(m, o.held), {
      icon: Icons.plus,
      shortcut: "<Ctrl>p",
    }),
    ...(priced
      ? [copy(money(m.current_price, o.currency), "Copy Price", { shortcut: "<Ctrl><Shift>c", section: "Copy" })]
      : []),
    copy(symbol, "Copy Symbol", { section: "Copy" }),
    copy(coinUrl(m.id), "Copy CoinGecko Link", { section: "Copy" }),
  ];
  return {
    id: `${o.section ?? ""}:${m.id}`,
    title: m.name,
    subtitle: symbol,
    icon: coinIcon(m),
    section: o.section,
    keywords: [m.symbol, m.id],
    accessories: [
      ...(o.watched
        ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "In your watchlist" }]
        : []),
      ...(o.held
        ? [{ tag: `${amount(o.held.amount)} ${symbol}`, color: "blue" as const, tooltip: "In your portfolio" }]
        : []),
      ...(priced
        ? [
          {
            text: percent(c24),
            color: changeColor(c24),
            icon: { source: (c24 ?? 0) >= 0 ? Icons.chartUp : Icons.chartDown, tint: changeColor(c24) },
            tooltip: "24 h change",
          },
          {
            text: money(m.current_price, o.currency),
            tooltip: m.market_cap_rank ? `#${m.market_cap_rank}` : undefined,
          },
        ]
        : m.market_cap_rank
        ? [{ text: `#${m.market_cap_rank}`, tooltip: "Market cap rank" }]
        : []),
    ],
    detail: {
      image: logo(m.image, "large"),
      stats: priced
        ? [
          { label: "Price", value: money(m.current_price, o.currency) },
          { label: "24 h", value: percent(c24), color: changeColor(c24) },
          { label: "7 d", value: percent(c7), color: changeColor(c7) },
          ...(m.market_cap_rank ? [{ label: "Rank", value: `#${m.market_cap_rank}` }] : []),
        ]
        : m.market_cap_rank
        ? [{ label: "Rank", value: `#${m.market_cap_rank}` }]
        : undefined,
      markdown: priced ? undefined : "CoinGecko has no current price for this coin.",
      metadata: priced ? coinMetadata(m, o.currency) : [meta.link("CoinGecko", m.id, coinUrl(m.id))],
    },
    actions,
  };
}

/** Amount of a coin to hold; saving goes back to the list (which reloads itself). */
export function holdingForm(m: Pick<Market, "id" | "name" | "symbol" | "image">, held?: Holding): FormSpec {
  const symbol = m.symbol.toUpperCase();
  return form({
    title: held ? `${m.name} Holding` : `Add ${m.name} to Portfolio`,
    submitTitle: held ? "Save Holding" : "Add Holding",
    fields: [
      field.text("amount", `Amount (${symbol})`, {
        placeholder: "e.g. 0.25",
        required: true,
        value: held ? String(held.amount) : "",
      }),
      ...(held ? [] : [field.checkbox("add", "Add to the amount I already hold", { value: true })]),
    ],
    async submit(values) {
      const n = parseAmount(String(values.amount ?? ""));
      if (n === undefined) throw new Error(`“${values.amount}” is not an amount of ${symbol}`);
      const h: Holding = { id: m.id, symbol: m.symbol, name: m.name, image: m.image ?? undefined, amount: n };
      await setHoldings(upsertHolding(await holdings(), h, values.add ? "add" : "set"));
      await toast(`${amount(n)} ${symbol} ${held ? "saved" : "added to the portfolio"}`, { style: "success" });
      return pop();
    },
  });
}

/** Search any coin, then enter the amount (replaces this list, so saving lands back on the portfolio). */
export function coinPicker(s: Settings): ListSpec {
  return list({
    title: "Add Holding",
    placeholder: "Search a coin: bitcoin, sol, usdc…",
    empty: { title: "Type a coin's name or symbol", icon: Icons.search },
    status: () => stale ? "CoinGecko is rate limiting: showing saved results" : "CoinGecko",
    search: (query, { signal }) =>
      guarded(async () => {
        if (!query.trim()) return [];
        const coins = await searchCoins(query, s.apiKey, signal);
        return coins.slice(0, 25).map((c) => {
          const m = searchToMarket(c);
          return {
            id: c.id,
            title: c.name,
            subtitle: c.symbol.toUpperCase(),
            icon: coinIcon({ image: c.thumb }),
            accessories: c.market_cap_rank ? [{ text: `#${c.market_cap_rank}`, tooltip: "Market cap rank" }] : [],
            actions: [action("Choose", () => replace(holdingForm(m)), { icon: Icons.check })],
          };
        });
      }),
  });
}
