import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  amount,
  change7d,
  changeColor,
  compactMoney,
  type Holding,
  logo,
  type Market,
  money,
  normalizeCurrency,
  parseAmount,
  percent,
  searchToMarket,
  signedMoney,
  sparkChange,
  sparkline,
  tickerLine,
  upsertHolding,
  valuePortfolio,
} from "./lib.ts";
import { coinItem, coinMetadata } from "./views.ts";

// Shaped like `GET /coins/markets?vs_currency=usd&sparkline=true&price_change_percentage=24h,7d`.
const bitcoin: Market = {
  id: "bitcoin",
  symbol: "btc",
  name: "Bitcoin",
  image: "https://coin-images.coingecko.com/coins/images/1/large/bitcoin.png?1696501400",
  current_price: 67123.45,
  market_cap: 1323456789012,
  market_cap_rank: 1,
  fully_diluted_valuation: 1409876543210,
  total_volume: 28123456789,
  high_24h: 67890,
  low_24h: 65432.1,
  price_change_24h: 1512.3,
  price_change_percentage_24h: 2.305,
  price_change_percentage_24h_in_currency: 2.305,
  price_change_percentage_7d_in_currency: -1.42,
  circulating_supply: 19765431,
  total_supply: 21000000,
  max_supply: 21000000,
  ath: 73738,
  ath_change_percentage: -8.97,
  ath_date: "2024-03-14T07:10:36.635Z",
  last_updated: "2026-10-28T09:58:12.123Z",
  sparkline_in_7d: { price: [68000, 67500, 66000, 65000, 65500, 66500, 67000, 67123] },
};

const ethereum: Market = {
  ...bitcoin,
  id: "ethereum",
  symbol: "eth",
  name: "Ethereum",
  image: "https://coin-images.coingecko.com/coins/images/279/large/ethereum.png?1696501628",
  current_price: 2500,
  market_cap_rank: 2,
  price_change_percentage_24h_in_currency: -4,
  price_change_percentage_7d_in_currency: null,
  max_supply: null,
  total_supply: 120000000,
  sparkline_in_7d: { price: [2400, 2450, 2500] },
};

Deno.test("currency preference", () => {
  assertEquals(normalizeCurrency("EUR"), "eur");
  assertEquals(normalizeCurrency(" usd "), "usd");
  assertEquals(normalizeCurrency("dogecoin"), "usd");
  assertEquals(normalizeCurrency(undefined), "usd");
});

Deno.test("money", () => {
  assertEquals(money(67123.45, "usd"), "$67,123.45");
  assertEquals(money(0.61234567, "usd"), "$0.6123");
  assertEquals(money(0.0000123456, "eur"), "€0.00001235");
  assertEquals(money(0.0234, "btc"), "₿0.0234");
  assertEquals(money(1234, "jpy"), "¥1,234.00");
  assertEquals(money(null, "usd"), "—");
  assertEquals(compactMoney(1323456789012, "usd"), "$1.32T");
  assertEquals(compactMoney(45600000000, "eur"), "€45.6B");
  assertEquals(compactMoney(undefined, "usd"), "—");
  assertEquals(signedMoney(209.14, "usd"), "+$209.14");
  assertEquals(signedMoney(-3.2, "eur"), "−€3.20");
});

Deno.test("percent and colors", () => {
  assertEquals(percent(2.305), "+2.31 %");
  assertEquals(percent(-0.844), "−0.84 %");
  assertEquals(percent(0), "0.00 %");
  assertEquals(percent(null), "—");
  assertEquals(changeColor(1), "green");
  assertEquals(changeColor(-1), "red");
  assertEquals(changeColor(0), undefined);
});

Deno.test("amounts typed by the user", () => {
  assertEquals(parseAmount("0.25"), 0.25);
  assertEquals(parseAmount("1,5"), 1.5);
  assertEquals(parseAmount("1,250"), 1.25);
  assertEquals(parseAmount("1,250,000"), 1250000);
  assertEquals(parseAmount(" 3 "), 3);
  assertEquals(parseAmount("2e-3"), 0.002);
  assertEquals(parseAmount("-1"), undefined);
  assertEquals(parseAmount("0"), undefined);
  assertEquals(parseAmount("abc"), undefined);
  assertEquals(amount(0.00012345), "0.00012345");
  assertEquals(amount(1250), "1,250");
});

Deno.test("sparklines", () => {
  assertEquals(sparkline([1, 2, 3, 4, 5, 6, 7, 8]), "▁▂▃▄▅▆▇█");
  assertEquals(sparkline([5, 5, 5]), "▄▄▄");
  assertEquals(sparkline([1]), "");
  assertEquals(sparkline(undefined), "");
  const week = Array.from({ length: 168 }, (_, i) => 100 + Math.sin(i / 10) * 5);
  assertEquals([...sparkline(week)].length, 28);
  assertEquals(sparkChange([100, 110]), 10);
  assertEquals(change7d(ethereum)?.toFixed(2), "4.17");
  assertEquals(change7d(bitcoin), -1.42);
});

Deno.test("logos in any size", () => {
  assertEquals(
    logo(bitcoin.image, "small"),
    "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png?1696501400",
  );
  assertEquals(
    logo("https://assets.coingecko.com/coins/images/1/thumb/bitcoin.png", "large"),
    "https://assets.coingecko.com/coins/images/1/large/bitcoin.png",
  );
  assertEquals(logo("missing_large.png", "large"), undefined);
  assertEquals(logo(null, "large"), undefined);
});

Deno.test("ticker line", () => {
  assertEquals(tickerLine(bitcoin, "usd"), "BTC $67,123.45 ▲ 2.3%");
  assertEquals(tickerLine(ethereum, "eur"), "ETH €2,500.00 ▼ 4.0%");
});

Deno.test("portfolio values", () => {
  const held: Holding[] = [
    { id: "ethereum", symbol: "eth", name: "Ethereum", amount: 2 },
    { id: "bitcoin", symbol: "btc", name: "Bitcoin", amount: 0.1 },
    { id: "gone-coin", symbol: "gone", name: "Gone", amount: 10 },
  ];
  const { rows, total, change } = valuePortfolio(held, [bitcoin, ethereum]);
  assertEquals(rows.map((r) => r.holding.id), ["bitcoin", "ethereum", "gone-coin"]);
  assertEquals(Math.round(total * 100) / 100, 11712.35);
  assertEquals(Math.round(rows[0].share * 1000) / 1000, 0.573);
  assertEquals(rows[2].value, undefined);
  assertEquals(rows[2].share, 0);
  // +2.305 % on 6712.35, −4 % on 5000.
  assertEquals(Math.round(change), Math.round(6712.345 - 6712.345 / 1.02305 + 5000 - 5000 / 0.96));
});

Deno.test("adding to a holding", () => {
  const h: Holding = { id: "bitcoin", symbol: "btc", name: "Bitcoin", amount: 0.1 };
  assertEquals(upsertHolding([], h), [h]);
  assertEquals(upsertHolding([h], { ...h, amount: 0.2 }, "add")[0].amount, 0.30000000000000004);
  assertEquals(upsertHolding([h], { ...h, amount: 0.5 })[0].amount, 0.5);
});

Deno.test("coin item", () => {
  const item = coinItem(bitcoin, { currency: "usd", watched: true, section: "Watchlist" });
  assertEquals(item.title, "Bitcoin");
  assertEquals(item.subtitle, "BTC");
  assertEquals(item.icon, "https://coin-images.coingecko.com/coins/images/1/small/bitcoin.png?1696501400");
  assertEquals(item.detail?.image, bitcoin.image);
  assertEquals(item.detail?.stats?.[1], { label: "24 h", value: "+2.31 %", color: "green" });
  assertEquals(item.accessories?.at(-1)?.text, "$67,123.45");
  assertEquals(item.actions?.[1].title, "Remove from Watchlist");
  const lines = coinMetadata(bitcoin, "usd");
  assertEquals(lines[0].label, "7 days");
  assertEquals(lines[0].color, "red");
  assertStringIncludes(lines.find((l) => l.label === "Supply")?.value ?? "", "19.77M of 21M BTC");
  assertStringIncludes(lines.find((l) => l.label === "All-time high")?.value ?? "", "14 Mar 2024");

  const unpriced = coinItem(searchToMarket({ id: "new-coin", name: "New", symbol: "NEW", market_cap_rank: null }), {
    currency: "usd",
    watched: false,
  });
  assertEquals(unpriced.icon, { source: "bs-coin", tint: "yellow" });
  assertEquals(unpriced.detail?.stats, undefined);
});
