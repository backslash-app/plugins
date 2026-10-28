import { type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { apiKey, guarded, marketStatus, newRound, profile, quote, search, stale, watchlist } from "../api.ts";
import { marketLine, rankMatches, tickerLine, titleCase } from "../lib.ts";
import { type Stock, stockItem } from "../views.ts";

const SEARCH_QUOTES = 6;
let market: string | undefined;

/** Quote and profile; a stock still shows if one of them fails. */
async function enrich(key: string, s: Stock, signal: AbortSignal, withProfile: boolean): Promise<Stock> {
  const soft = <T>(p: Promise<T>) =>
    p.catch((e) => {
      if ((e as Error).name === "AbortError") throw e;
      return undefined;
    });
  const [q, p] = await Promise.all([
    soft(quote(key, s.symbol, signal)),
    withProfile ? soft(profile(key, s.symbol, signal)) : Promise.resolve(undefined),
  ]);
  return { ...s, quote: q, profile: p && Object.keys(p).length ? p : undefined, name: p?.name || s.name };
}

export default (ctx: Context) =>
  list({
    placeholder: "Search a symbol or a company: AAPL, tesla, s&p 500 etf…",
    empty: { title: "No symbol found", description: "Try a ticker (MSFT) or a company name", icon: Icons.chartUp },
    status: (items) => {
      if (items[0]?.id === "setup") return "Not connected";
      const watched = items.filter((i) => i.section === "Watchlist").length;
      return [
        watched ? `${watched} in your watchlist` : `${items.length} result${items.length === 1 ? "" : "s"}`,
        market,
        stale ? "some quotes are saved ones (rate limit)" : "Finnhub",
      ].filter(Boolean).join(" · ");
    },
    search: (query, { signal }) =>
      guarded(async (): Promise<Item[]> => {
        const key = apiKey(ctx.preferences);
        newRound();
        const watched = await watchlist();
        if (!query.trim()) {
          const [stocks, status] = await Promise.all([
            Promise.all(watched.map((symbol) => enrich(key, { symbol, name: symbol }, signal, true))),
            marketStatus(key, signal).catch(() => undefined),
          ]);
          market = marketLine(status);
          const first = stocks.find((s) => s.quote && (s.quote.c || s.quote.pc));
          updateCommandMetadata({ subtitle: first ? tickerLine(first.symbol, first.quote!) : null }).catch(() => {});
          return stocks.map((s) => stockItem(s, { key, watched: true, section: "Watchlist" }));
        }
        const matches = rankMatches(await search(key, query, signal), query);
        const stocks = await Promise.all(
          matches.map((m, i) => {
            const s: Stock = { symbol: m.symbol, name: titleCase(m.description), type: m.type || undefined };
            return i < SEARCH_QUOTES ? enrich(key, s, signal, i < 3 || watched.includes(m.symbol)) : Promise.resolve(s);
          }),
        );
        return stocks.map((s) => stockItem(s, { key, watched: watched.includes(s.symbol), section: "Results" }));
      }),
  });
