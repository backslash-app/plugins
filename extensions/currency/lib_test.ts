import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { convert, findCurrency, parse, parseRates, type Rates } from "./lib.ts";

Deno.test("currency conversions are recognized", () => {
  assertEquals(parse("20 € en $"), { amount: 20, from: "EUR", to: "USD" });
  assertEquals(parse("$15 to eur"), { amount: 15, from: "USD", to: "EUR" });
  assertEquals(parse("100 chf in jpy"), { amount: 100, from: "CHF", to: "JPY" });
  assertEquals(parse("1,5 £ vers €"), { amount: 1.5, from: "GBP", to: "EUR" });
  assertEquals(findCurrency(" usd "), "USD");
});

Deno.test("anything else is not", () => {
  for (const q of ["5 km in miles", "firefox", "fly to the moon", "20 €", "eur to usd", "20 abc en def", "$ to €"]) {
    assertEquals(parse(q), undefined, q);
  }
});

Deno.test("rates convert across currencies", () => {
  const rates: Rates = { base: "EUR", date: "2026-10-27", rates: { USD: 1.1, GBP: 0.85 }, fetched: 0 };
  assertAlmostEquals(convert(rates, 20, "EUR", "USD")!, 22, 1e-9);
  assertAlmostEquals(convert(rates, 11, "USD", "EUR")!, 10, 1e-9);
  assertAlmostEquals(convert(rates, 1.1, "USD", "GBP")!, 0.85, 1e-9);
  assertEquals(convert(rates, 1, "EUR", "XXX"), undefined);
});

Deno.test("only a well-formed answer is kept", () => {
  const body = { amount: 1, base: "EUR", date: "2026-10-30", rates: { USD: 1.08, JPY: 162.3 } };
  assertEquals(parseRates(body, 42), {
    base: "EUR",
    date: "2026-10-30",
    rates: { USD: 1.08, JPY: 162.3 },
    fetched: 42,
  });
  for (const bad of [null, {}, { base: "EUR", date: "x", rates: { USD: "1" } }, { ...body, rates: { USD: 0 } }]) {
    assertThrows(() => parseRates(bad, 0));
  }
});
