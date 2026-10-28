import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  bar,
  change,
  compact,
  duration,
  hogQueries,
  hogRows,
  hogWindow,
  normalizeBase,
  periodOf,
  plausibleAggregate,
  plausibleRange,
  plausibleRows,
  posthogBase,
  range,
  rowsTable,
  type Site,
  siteMetadata,
  splitList,
  type Stats,
  statsCards,
  subtitle,
  umamiActive,
  umamiAggregate,
  umamiRows,
  umamiWebsites,
  ymd,
} from "./lib.ts";

const NOW = new Date(2026, 9, 28, 15, 30); // local time

Deno.test("periods", () => {
  const today = range("today", NOW);
  assertEquals(ymd(today.start), "2026-10-28");
  assertEquals(today.start.getHours(), 0);
  assertEquals(today.previous, undefined);
  const week = range("7d", NOW);
  assertEquals(ymd(week.start), "2026-10-22");
  assertEquals(ymd(week.previous!.start), "2026-10-15");
  assertEquals(week.previous!.end, week.start);
  assertEquals(plausibleRange(week), ["2026-10-22", "2026-10-28"]);
  assertEquals(plausibleRange(week.previous!, false), ["2026-10-15", "2026-10-21"]);
  assertEquals(ymd(range("30d", NOW).start), "2026-09-29");
  assertEquals(periodOf("7d"), "7d");
  assertEquals(periodOf(undefined), "today");
});

Deno.test("plausible", () => {
  // POST /api/v2/query with metrics visitors, pageviews, visits, bounce_rate, visit_duration.
  const agg = plausibleAggregate({ results: [{ metrics: [312, 790, 380, 52, 71], dimensions: [] }] });
  assertEquals(agg, { visitors: 312, pageviews: 790, visits: 380, bounceRate: 0.52, duration: 71 });
  assertEquals(plausibleAggregate({ results: [] }).visitors, 0);
  assertEquals(
    plausibleRows({ results: [{ dimensions: ["/pricing"], metrics: [41] }, { dimensions: [""], metrics: [2] }] }),
    [{ label: "/pricing", value: 41 }, { label: "(none)", value: 2 }],
  );
});

Deno.test("umami, v2 and v3 shapes", () => {
  const v2 = umamiAggregate({
    pageviews: { value: 420, prev: 380 },
    visitors: { value: 133, prev: 120 },
    visits: { value: 150, prev: 140 },
    bounces: { value: 60, prev: 50 },
    totaltime: { value: 9000, prev: 8000 },
  });
  assertEquals(v2, { visitors: 133, pageviews: 420, visits: 150, bounceRate: 0.4, duration: 60 });
  const v3 = umamiAggregate({
    pageviews: 90,
    visitors: 40,
    visits: 45,
    bounces: 20,
    totaltime: 3000,
    comparison: { pageviews: 80 },
  });
  assertEquals(v3.visitors, 40);
  assertEquals(Math.round(v3.bounceRate! * 100), 44);
  assertEquals(
    umamiAggregate({ pageviews: 0, visitors: 0, visits: 0, bounces: 0, totaltime: 0 }).bounceRate,
    undefined,
  );
  assertEquals(umamiRows([{ x: "", y: 70 }, { x: "duckduckgo.com", y: 20 }], "Direct"), [
    { label: "Direct", value: 70 },
    { label: "duckduckgo.com", value: 20 },
  ]);
  assertEquals(umamiActive({ visitors: 2 }), 2);
  assertEquals(umamiActive([{ x: 1 }]), 1);
  assertEquals(umamiActive({ x: 3 }), 3);
  assertEquals(umamiActive(undefined), undefined);
  assertEquals(umamiWebsites({ data: [{ id: "a", name: "Docs", domain: "docs.example.com" }] }).length, 1);
  assertEquals(umamiWebsites([{ id: "b", name: "Shop" }])[0].id, "b");
  assertEquals(normalizeBase("umami.example.com/"), "https://umami.example.com");
  assertEquals(normalizeBase("http://10.0.0.2:3000/umami/"), "http://10.0.0.2:3000/umami");
});

Deno.test("posthog", () => {
  assertEquals(posthogBase(""), "https://us.posthog.com");
  assertEquals(posthogBase("EU"), "https://eu.posthog.com");
  assertEquals(posthogBase("https://posthog.example.com/"), "https://posthog.example.com");
  const r = { start: new Date("2026-10-28T00:00:00Z"), end: new Date("2026-10-28T15:30:00Z") };
  assertEquals(
    hogWindow(r),
    "timestamp >= toDateTime('2026-10-28 00:00:00', 'UTC') AND timestamp < toDateTime('2026-10-28 15:30:00', 'UTC')",
  );
  const q = hogQueries({ ...r, previous: { start: new Date("2026-10-27T00:00:00Z"), end: r.start } }, 5);
  assertStringIncludes(q.pages, "properties.$pathname");
  assertStringIncludes(q.pages, "LIMIT 5");
  assertStringIncludes(q.sessions, "$start_timestamp >=");
  assertStringIncludes(q.previous, "2026-10-27 00:00:00");
  assertEquals(hogQueries(r).previous, undefined);
  assertEquals(hogRows([["$direct", 40], ["www.reddit.com", 22], [null, 1]], "Direct"), [
    { label: "Direct", value: 40 },
    { label: "www.reddit.com", value: 22 },
    { label: "Direct", value: 1 },
  ]);
});

const stats: Stats = {
  visitors: 2140,
  pageviews: 5320,
  visits: 2600,
  bounceRate: 0.48,
  duration: 95,
  previous: { visitors: 1900, pageviews: 5400 },
  realtime: 7,
  pages: [{ label: "/", value: 140 }, { label: "/blog/a|b", value: 70 }],
  sources: [],
};

Deno.test("formatting", () => {
  assertEquals(compact(312), "312");
  assertEquals(compact(2140), "2.1k");
  assertEquals(compact(48_000), "48k");
  assertEquals(compact(1_250_000), "1.3M");
  assertEquals(duration(95), "1m 35s");
  assertEquals(duration(42), "42s");
  assertEquals(duration(undefined), "—");
  assertEquals(change(2140, 1900), { text: "+13%", color: "green" });
  assertEquals(change(5320, 5400), { text: "−1%", color: "red" });
  assertEquals(change(10, 0), { text: "new", color: "green" });
  assertEquals(change(10, undefined), undefined);
  assertEquals(bar(5, 10, 4), "▇▇▁▁");
  assertEquals(splitList("a.com, b.com\nc.com,"), ["a.com", "b.com", "c.com"]);
});

Deno.test("site detail", () => {
  const cards = statsCards(stats, "7d");
  assertEquals(cards.map((c) => c.value), ["2,140 +13%", "5,320 −1%", "48%", "1m 35s", 7]);
  assertEquals(cards[0].color, "green");
  assertEquals(statsCards({ ...stats, previous: undefined }, "today")[0], {
    label: "Visitors today",
    value: "2,140",
    color: undefined,
  });
  const table = rowsTable("Top pages", stats.pages, "Page");
  assertStringIncludes(table, "| /blog/a\\|b | 70 | ▇▇▇▇▇▁▁▁▁▁ |");
  assertStringIncludes(rowsTable("Top sources", [], "Source"), "Nothing yet.");
  const site: Site = {
    provider: "plausible",
    id: "example.com",
    name: "example.com",
    url: "https://plausible.io/example.com",
  };
  const md = siteMetadata(site, stats, "7d");
  assert(md.some((m) => m.label === "Period" && m.value === "7 days · vs previous 7 days"));
  assert(md.some((m) => m.label === "Pages per visit" && m.value === "2.0"));
});

Deno.test("root subtitle", () => {
  assertEquals(subtitle(312, "today"), "312 visitors today");
  assertEquals(subtitle(1, "today"), "1 visitor today");
  assertEquals(subtitle(2140, "7d"), "2,140 visitors · 7 days");
  assertEquals(subtitle(48_000, "30d"), "48k visitors · 30 days");
});
