import { type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { holdings, marketsOf, searchCoins, stale, topMarkets, watchlist } from "../api.ts";
import { type Market, searchToMarket, tickerLine } from "../lib.ts";
import { coinItem, guarded, settings } from "../views.ts";

const ago = (at: number) => {
  const min = Math.round((Date.now() - at) / 60_000);
  return min < 1 ? "just now" : min < 60 ? `${min} min ago` : `${Math.round(min / 60)} h ago`;
};

export default (ctx: Context) => {
  const s = settings(ctx.preferences);
  return list({
    placeholder: "Search coins by name or symbol…",
    empty: { title: "No coin found", description: "Try a name (solana) or a symbol (SOL)", icon: Icons.coin },
    status: (items) =>
      items[0]?.id === "rate-limit"
        ? "Rate limited"
        : `${items.length} coin${items.length === 1 ? "" : "s"} · ${s.currency.toUpperCase()}${
          stale ? ` · CoinGecko is rate limiting, prices from ${ago(stale.at)}` : " · CoinGecko"
        }`,
    search: (query, { signal }) =>
      guarded(async () => {
        const [watched, held] = await Promise.all([watchlist(), holdings()]);
        const heldById = new Map(held.map((h) => [h.id, h]));
        const item = (m: Market, section?: string) =>
          coinItem(m, { currency: s.currency, watched: watched.includes(m.id), held: heldById.get(m.id), section });

        if (query.trim()) {
          const found = (await searchCoins(query, s.apiKey, signal)).slice(0, 20);
          const priced = await marketsOf(found.map((c) => c.id), s.currency, s.apiKey, signal).catch((e) => {
            if ((e as Error).name === "AbortError") throw e;
            return [] as Market[];
          });
          const byId = new Map(priced.map((m) => [m.id, m]));
          return found.map((c) => item(byId.get(c.id) ?? searchToMarket(c)));
        }

        const [mine, top] = await Promise.all([
          marketsOf(watched, s.currency, s.apiKey, signal),
          topMarkets(s.currency, s.apiKey, signal),
        ]);
        const first = mine[0] ?? top[0];
        if (first) updateCommandMetadata({ subtitle: tickerLine(first, s.currency) }).catch(() => {});
        const items: Item[] = mine.map((m) => item(m, "Watchlist"));
        for (const m of top) if (!watched.includes(m.id)) items.push(item(m, "Top Coins"));
        return items;
      }),
  });
};
