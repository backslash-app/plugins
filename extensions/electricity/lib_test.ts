import { assert, assertAlmostEquals, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  addDays,
  bar,
  canBeRed,
  centsPerKwh,
  cheapestWindow,
  colorOf,
  countColors,
  HOSTS,
  hourlyPrices,
  parisDate,
  parisHour,
  parseEcowatt,
  parsePrices,
  parseStats,
  parseTempoDay,
  parseTempoDays,
  perMwh,
  priceAt,
  priceTable,
  recentStrip,
  rteCredentials,
  seasonOf,
  spotUrl,
  summarizePrices,
  tempoSubtitle,
  tightHours,
} from "./lib.ts";

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
});

Deno.test("Paris dates and hours across midnight and DST", () => {
  // 23:30 UTC on 31 October (winter time, UTC+1) is already 1 November in Paris.
  assertEquals(parisDate(Date.parse("2026-10-31T23:30:00Z")), "2026-11-01");
  assertEquals(parisHour(Date.parse("2026-10-31T23:30:00Z")), 0);
  // Summer time, UTC+2.
  assertEquals(parisHour(Date.parse("2026-07-01T10:00:00Z")), 12);
  assertEquals(addDays("2026-12-31", 1), "2027-01-01");
  assertEquals(addDays("2026-03-01", -1), "2026-02-28");
});

Deno.test("Tempo seasons run from September to August", () => {
  assertEquals(seasonOf("2026-09-01"), "2026-2027");
  assertEquals(seasonOf("2026-08-31"), "2025-2026");
  assertEquals(seasonOf("2027-01-15"), "2026-2027");
});

Deno.test("Tempo day colors", () => {
  assertEquals(parseTempoDay({ dateJour: "2026-10-31", codeJour: 1, periode: "2026-2027", libCouleur: "Bleu" }), {
    date: "2026-10-31",
    color: "blue",
    period: "2026-2027",
  });
  assertEquals(parseTempoDay({ dateJour: "2027-01-12", codeJour: 3, libCouleur: "Rouge" })?.color, "red");
  assertEquals(
    parseTempoDay({ dateJour: "2027-01-13", codeJour: 0, periode: "2026-2027", libCouleur: "" })?.color,
    "unknown",
  );
  assertEquals(colorOf(undefined, "Blanc"), "white");
  assertEquals(colorOf("2"), "white");
  assertEquals(parseTempoDay({ codeJour: 1 }), undefined);
  assertEquals(parseTempoDay("oops"), undefined);
});

Deno.test("a season of days, sorted, and the recent strip", () => {
  const days = parseTempoDays([
    { dateJour: "2026-10-30", codeJour: 2, periode: "2026-2027", libCouleur: "Blanc" },
    { dateJour: "2026-10-29", codeJour: 1, periode: "2026-2027", libCouleur: "Bleu" },
    { dateJour: "2026-10-31", codeJour: 3, periode: "2026-2027", libCouleur: "Rouge" },
    { nonsense: true },
  ]);
  assertEquals(days.map((d) => d.date), ["2026-10-29", "2026-10-30", "2026-10-31"]);
  assertEquals(recentStrip(days, "2026-10-31", 4), "◌🔵⚪🔴");
  assertEquals(countColors(days), { blue: 1, white: 1, red: 1, unknown: 0 });
  assertEquals(parseTempoDays({}), []);
});

Deno.test("season stats", () => {
  const stats = parseStats({
    periode: "2026-2027",
    bissextile: false,
    dernierJourInclus: "2026-10-31",
    joursBleusConsommes: 61,
    joursBlancsConsommes: 0,
    joursRougesConsommes: 0,
    joursBleusRestants: 239,
    joursBlancsRestants: 43,
    joursRougesRestants: 22,
  });
  assertEquals(stats?.remaining, { blue: 239, white: 43, red: 22 });
  assertEquals(stats?.used.blue, 61);
  assertEquals(stats?.lastIncluded, "2026-10-31");
  assertEquals(parseStats({ error: "nope" }), undefined);
});

Deno.test("red days are weekdays from November to March", () => {
  assert(canBeRed("2026-11-02")); // Monday
  assert(!canBeRed("2026-11-01")); // Sunday
  assert(!canBeRed("2026-10-30")); // October
  assert(canBeRed("2027-03-31")); // Wednesday
  assert(!canBeRed("2027-04-01"));
});

Deno.test("root search subtitle", () => {
  const today = { date: "2026-10-31", color: "blue" as const };
  assertEquals(tempoSubtitle(today, { date: "2026-11-01", color: "red" }), "Today Blue · Tomorrow Red");
  assertEquals(tempoSubtitle(today, { date: "2026-11-01", color: "unknown" }), "Today Blue · tomorrow after 11:00");
  assertEquals(tempoSubtitle(undefined, undefined), null);
});

Deno.test("EcoWatt signals", () => {
  const days = parseEcowatt({
    signals: [
      {
        GenerationFichier: "2026-11-02T00:00:00+01:00",
        jour: "2026-11-03T00:00:00+01:00",
        dvalue: 2,
        message: "Consommation élevée, pensez à décaler vos usages.",
        values: [{ pas: 8, hvalue: 2 }, { pas: 9, hvalue: 2 }, { pas: 18, hvalue: 3 }, { pas: 3, hvalue: 0 }],
      },
      {
        GenerationFichier: "2026-11-02T00:00:00+01:00",
        jour: "2026-11-02T00:00:00+01:00",
        dvalue: 1,
        message: "Pas d'alerte.",
        values: [],
      },
    ],
  });
  assertEquals(days.map((d) => d.date), ["2026-11-02", "2026-11-03"]);
  assertEquals(days[0].hours.every((h) => h === 1), true);
  assertEquals(days[1].level, 2);
  assertEquals(days[1].hours[3], 0);
  // Hours not listed take the day's level.
  assertEquals(tightHours(days[1].hours), "00:00–03:00, 04:00–24:00");
  assertEquals(parseEcowatt({ error: "invalid_token" }), []);
});

Deno.test("tight hour ranges", () => {
  const h = new Array(24).fill(1);
  h[8] = h[9] = 2;
  h[18] = 3;
  h[19] = 2;
  assertEquals(tightHours(h), "08:00–10:00, 18:00–20:00");
  h[23] = 2;
  assertEquals(tightHours(h), "08:00–10:00, 18:00–20:00, 23:00–24:00");
  assertEquals(tightHours(new Array(24).fill(1)), "");
});

Deno.test("RTE credentials: base64 or id:secret", () => {
  assertEquals(rteCredentials("abc:def"), btoa("abc:def"));
  assertEquals(rteCredentials("  YWJjOmRlZg==  "), "YWJjOmRlZg==");
  assertEquals(rteCredentials("Basic YWJjOmRlZg=="), "YWJjOmRlZg==");
  assertEquals(rteCredentials(""), undefined);
  assertEquals(rteCredentials(undefined), undefined);
});

// 15-minute slots of 31 October 2026 (UTC+1) from 00:00 to 02:00 local, one missing value.
const SPOT = {
  license_info: "CC BY 4.0 (creativecommons.org/licenses/by/4.0) from Bundesnetzagentur | SMARD.de",
  unix_seconds: [
    1793401200,
    1793402100,
    1793403000,
    1793403900,
    1793404800,
    1793405700,
    1793406600,
    1793407500,
  ],
  price: [100, 110, 90, 100, -5, -15, null, -10],
  unit: "EUR / MWh",
  deprecated: false,
};

Deno.test("spot prices: 15-minute slots to hourly averages", () => {
  const points = parsePrices(SPOT);
  assertEquals(points.length, 7);
  assertEquals(points[0].length, 15 * 60_000);
  assertEquals(parisDate(points[0].start), "2026-10-31");
  const hours = hourlyPrices(points, "2026-10-31");
  assertEquals(hours.map((h) => h.hour), [0, 1]);
  assertEquals(hours[0].price, 100);
  assertEquals(hours[1].price, -10);
  const sum = summarizePrices(hours)!;
  assertEquals(sum.min.hour, 1);
  assertEquals(sum.max.hour, 0);
  assertEquals(sum.negative, 1);
  assertAlmostEquals(sum.average, 45);
  assertEquals(hourlyPrices(points, "2026-11-01"), []);
  assertEquals(parsePrices({ message: "error" }), []);
});

Deno.test("hourly data (the old 60-minute market)", () => {
  const points = parsePrices({ unix_seconds: [1793401200, 1793404800], price: [50, 60] });
  assertEquals(points.map((p) => p.length), [3_600_000, 3_600_000]);
  assertEquals(priceAt(points, (1793404800 + 1800) * 1000)?.price, 60);
  assertEquals(priceAt(points, (1793404800 + 7200) * 1000), undefined);
});

Deno.test("cheapest consecutive hours", () => {
  const hours = [10, 8, 3, 2, 4, 9, 1].map((price, hour) => ({ hour, price }));
  assertEquals(cheapestWindow(hours, 3), { from: 2, to: 5, average: 3 });
  // A gap in the hours breaks a window.
  const gap = [{ hour: 0, price: 1 }, { hour: 1, price: 1 }, { hour: 5, price: 1 }];
  assertEquals(cheapestWindow(gap, 3), undefined);
});

Deno.test("price formatting and table", () => {
  assertEquals(perMwh(87.3), "87.30 €/MWh");
  assertEquals(centsPerKwh(87.3), "8.73 c€/kWh");
  assertEquals(bar(10, 0, 10, 4), "▇▇▇▇");
  assertEquals(bar(0, 0, 10, 4), "▇");
  const table = priceTable(
    [{ hour: 0, price: 100 }, { hour: 1, price: -10 }],
    { day: "2026-10-31", hour: 1 },
    "2026-10-31",
  );
  assertStringIncludes(table, "**01:00–02:00** ←");
  assertStringIncludes(table, "| 00:00–01:00 | 100.0 |");
  assertStringIncludes(priceTable([]), "No prices");
  assertEquals(
    spotUrl("2026-10-31", "2026-11-01"),
    "https://api.energy-charts.info/price?bzn=FR&start=2026-10-31&end=2026-11-01",
  );
});
