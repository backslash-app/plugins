import { assertEquals } from "@std/assert";
import {
  ago,
  changeColor,
  dayPosition,
  domain,
  hasQuote,
  marketCap,
  marketLine,
  money,
  move,
  normalizeSymbol,
  percent,
  type Quote,
  rankMatches,
  signed,
  type SymbolMatch,
  tickerLine,
  titleCase,
  yahooUrl,
} from "./lib.ts";
import { stockItem } from "./views.ts";

// Shaped like `GET /quote?symbol=AAPL`.
const aapl: Quote = { c: 189.84, d: 2.2, dp: 1.1724, h: 190.3, l: 187.1, o: 188, pc: 187.64, t: 1793180000 };
const unknown: Quote = { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 };

// Shaped like `GET /search?q=tesla`.
const matches: SymbolMatch[] = [
  { description: "TESLA INC", displaySymbol: "TL0.DE", symbol: "TL0.DE", type: "Common Stock" },
  { description: "DIREXION DAILY TSLA BULL 2X", displaySymbol: "TSLL", symbol: "TSLL", type: "ETP" },
  { description: "TESLA INC", displaySymbol: "TSLA", symbol: "TSLA", type: "Common Stock" },
  { description: "TESLA INC", displaySymbol: "TSLA.MX", symbol: "TSLA.MX", type: "Common Stock" },
  { description: "TESLA INC", displaySymbol: "TSLA", symbol: "TSLA", type: "Common Stock" },
];

Deno.test("quotes", () => {
  assertEquals(hasQuote(aapl), true);
  assertEquals(hasQuote(unknown), false);
  assertEquals(hasQuote(undefined), false);
  assertEquals(dayPosition(aapl)?.toFixed(3), "0.856");
  assertEquals(dayPosition({ ...aapl, h: 10, l: 10 }), undefined);
  assertEquals(tickerLine("AAPL", aapl), "AAPL 189.84 ▲ 1.17%");
  assertEquals(tickerLine("MSFT", { ...aapl, c: 415.5, dp: -0.7406 }), "MSFT 415.50 ▼ 0.74%");
});

Deno.test("formatting", () => {
  assertEquals(money(189.84, "USD"), "$189.84");
  assertEquals(money(12.3, "EUR"), "€12.30");
  assertEquals(money(0.01234, "USD"), "$0.01234");
  assertEquals(money(5, "XX"), "5.00");
  assertEquals(money(5, undefined), "5.00");
  assertEquals(money(null), "—");
  assertEquals(signed(2.2), "+2.20");
  assertEquals(signed(-3.1), "−3.10");
  assertEquals(percent(1.1724), "+1.17 %");
  assertEquals(percent(-0.7406), "−0.74 %");
  assertEquals(percent(null), "—");
  assertEquals(changeColor(-1), "red");
  assertEquals(changeColor(0), undefined);
  assertEquals(marketCap(2905123.4, "USD"), "$2.91T");
  assertEquals(marketCap(412300, "EUR"), "€412.3B");
  assertEquals(marketCap(undefined), "—");
});

Deno.test("market status", () => {
  assertEquals(marketLine({ exchange: "US", holiday: null, isOpen: true, session: "regular" }), "US market open");
  assertEquals(marketLine({ exchange: "US", holiday: null, isOpen: false, session: "pre-market" }), "US pre-market");
  assertEquals(marketLine({ exchange: "US", holiday: null, isOpen: false, session: "post-market" }), "US after hours");
  assertEquals(marketLine({ exchange: "US", holiday: null, isOpen: false, session: null }), "US market closed");
  assertEquals(
    marketLine({ exchange: "US", holiday: "Thanksgiving Day", isOpen: false, session: null }),
    "US market closed (Thanksgiving Day)",
  );
  assertEquals(marketLine(undefined), undefined);
});

Deno.test("search results", () => {
  assertEquals(rankMatches(matches, "tesla").map((m) => m.symbol), ["TSLL", "TSLA"]);
  assertEquals(rankMatches(matches, "tsla").map((m) => m.symbol), ["TSLA", "TSLL"]);
  assertEquals(rankMatches(matches, "tsla.mx").map((m) => m.symbol), ["TSLA.MX", "TL0.DE", "TSLL", "TSLA"]);
  assertEquals(normalizeSymbol(" brk b "), "BRKB");
  assertEquals(titleCase("APPLE INC"), "Apple Inc");
  assertEquals(titleCase("SPDR S&P 500 ETF TRUST"), "Spdr S&P 500 ETF Trust");
  assertEquals(titleCase("Alphabet Inc"), "Alphabet Inc");
});

Deno.test("helpers", () => {
  assertEquals(move(["A", "B", "C"], "B", -1), ["B", "A", "C"]);
  assertEquals(move(["A", "B", "C"], "C", 1), ["A", "B", "C"]);
  assertEquals(domain("https://www.apple.com/"), "apple.com");
  assertEquals(yahooUrl("BRK.B"), "https://finance.yahoo.com/quote/BRK.B");
  const now = 1793180000 * 1000;
  assertEquals(ago(1793180000 - 300, now), "5 min");
  assertEquals(ago(1793180000 - 3 * 86400, now), "3 d");
});

Deno.test("stock item", () => {
  const item = stockItem({
    symbol: "AAPL",
    name: "Apple Inc",
    quote: aapl,
    profile: {
      currency: "USD",
      exchange: "NASDAQ NMS - GLOBAL MARKET",
      finnhubIndustry: "Technology",
      logo: "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png",
      marketCapitalization: 2905123.4,
      name: "Apple Inc",
      weburl: "https://www.apple.com/",
    },
  }, { key: "k", watched: true, section: "Watchlist" });
  assertEquals(item.icon, "https://static2.finnhub.io/file/publicdatany/finnhubimage/stock_logo/AAPL.png");
  assertEquals(item.accessories?.map((a) => a.text), ["+1.17 %", "$189.84"]);
  assertEquals(item.detail?.stats?.[1], { label: "Change", value: "+2.20", color: "green" });
  const range = item.detail?.metadata?.find((m) => m.label === "Day range");
  assertEquals(range?.value, "$187.10 – $190.30");
  assertEquals(range?.progress?.toFixed(2), "0.86");
  assertEquals(item.actions?.map((a) => a.title).slice(0, 5), [
    "Show News",
    "Show Company Details",
    "Remove from Watchlist",
    "Move Up",
    "Move Down",
  ]);

  const foreign = stockItem({ symbol: "TL0.DE", name: "Tesla Inc", quote: unknown, type: "Common Stock" }, {
    key: "k",
    watched: false,
  });
  assertEquals(foreign.icon, { source: "bs-chart-up", tint: "gray" });
  assertEquals(foreign.accessories, [{ tag: "Common Stock" }]);
  assertEquals(foreign.detail?.stats, undefined);
});
