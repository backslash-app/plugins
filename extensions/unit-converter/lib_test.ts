import { assertEquals } from "@std/assert";
import { convert, findUnit, format, parse, splitNumber, UNITS } from "./lib.ts";

const conv = (q: string) => {
  const r = parse(q);
  return r && `${format(convert(r.value, r.from, r.to))} ${r.to.symbol}`;
};

Deno.test("units", () => {
  assertEquals(conv("5 km in miles"), "3.10686 mi");
  assertEquals(conv("5km to mi"), "3.10686 mi");
  assertEquals(conv("100 °F en c"), "37.7778 °C");
  assertEquals(conv("-40 c to f"), "-40 °F");
  assertEquals(conv("2 GiB en MB"), "2 147.48 MB");
  assertEquals(conv("1,5 h en min"), "90 min");
  assertEquals(conv("3 mi -> m"), "4 828.03 m");
  assertEquals(conv("90 km/h in mph"), "55.9234 mph");
  assertEquals(conv("1 MB in kb"), "1 000 kB");
  assertEquals(conv("0 K to c"), "-273.15 °C");
});

Deno.test("rejections", () => {
  for (const q of ["5 km in kg", "firefox", "fly to the moon", "5 km", "km to mi", "20 € en $", "100 eur in usd"]) {
    assertEquals(conv(q), undefined, q);
  }
});

Deno.test("numbers and formatting", () => {
  assertEquals(splitNumber("5,5 km"), [5.5, "km"]);
  assertEquals(splitNumber("-40 °F"), [-40, "°F"]);
  assertEquals(splitNumber("km"), undefined);
  assertEquals(splitNumber("-"), undefined);
  assertEquals(format(1609344), "1 609 344");
  assertEquals(format(-1234.5), "-1 234.5");
  assertEquals(format(0.000001234), "0.000001234");
  assertEquals(format(1e-12), "0");
});

Deno.test("every unit is found by each of its names", () => {
  for (const u of UNITS) {
    for (const name of u.names) assertEquals(findUnit(name)?.symbol, u.symbol, name);
  }
});
