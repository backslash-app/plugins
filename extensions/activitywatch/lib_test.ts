import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  activityUrl,
  baseUrl,
  before,
  browserOf,
  buildQuery,
  connectionError,
  dayStart,
  duration,
  hostnames,
  isoLocal,
  parseBuckets,
  parseCategories,
  parseStartOfDay,
  parseUsage,
  periods,
  pickSources,
  share,
  summaryText,
  timeperiod,
  trend,
  weekStart,
} from "./lib.ts";

// Shaped like GET /api/0/buckets/.
const BUCKETS = parseBuckets({
  "aw-watcher-window_old": {
    id: "aw-watcher-window_old",
    type: "currentwindow",
    hostname: "old",
    last_updated: "2025-01-01T10:00:00+00:00",
  },
  "aw-watcher-window_laptop": {
    id: "aw-watcher-window_laptop",
    type: "currentwindow",
    client: "aw-watcher-window",
    hostname: "laptop",
    last_updated: "2026-10-29T09:00:00.123+00:00",
  },
  "aw-watcher-afk_laptop": { id: "aw-watcher-afk_laptop", type: "afkstatus", hostname: "laptop" },
  "aw-watcher-afk_old": { id: "aw-watcher-afk_old", type: "afkstatus", hostname: "old" },
  "aw-watcher-web-firefox_laptop": { id: "aw-watcher-web-firefox_laptop", type: "web.tab.current", hostname: "laptop" },
  "aw-watcher-web-chrome": { id: "aw-watcher-web-chrome", type: "web.tab.current", hostname: "unknown" },
  "aw-watcher-web-firefox_old": { id: "aw-watcher-web-firefox_old", type: "web.tab.current", hostname: "old" },
  "aw-stopwatch": { id: "aw-stopwatch", type: "general.stopwatch", hostname: "laptop" },
});

Deno.test("buckets of the most recent computer", () => {
  assertEquals(BUCKETS.length, 8);
  assertEquals(pickSources(BUCKETS), {
    hostname: "laptop",
    window: "aw-watcher-window_laptop",
    afk: "aw-watcher-afk_laptop",
    web: ["aw-watcher-web-firefox_laptop", "aw-watcher-web-chrome"],
  });
  assertEquals(pickSources(BUCKETS, "OLD")?.window, "aw-watcher-window_old");
  assertEquals(pickSources(BUCKETS, "nope"), undefined);
  assertEquals(pickSources([]), undefined);
  assertEquals(hostnames(BUCKETS).sort(), ["laptop", "old"]);
  assertEquals(parseBuckets(null), []);
  assertEquals(browserOf("aw-watcher-web-firefox_laptop"), "firefox");
  assertEquals(browserOf("aw-watcher-window_x"), undefined);
});

Deno.test("categories from the server settings", () => {
  const cats = parseCategories([
    { id: 0, name: ["Work"], rule: { type: "none" } },
    { id: 1, name: ["Work", "Programming"], rule: { type: "regex", regex: "code|vim|\\.rs", ignore_case: true } },
    { id: 2, name: ["Media"], rule: { type: "regex", regex: 'You"Tube' } },
    { name: [], rule: { type: "regex", regex: "x" } },
  ]);
  assertEquals(cats.map((c) => c.name.join("/")), ["Work/Programming", "Media"]);
  assertEquals(parseCategories(undefined), []);
});

Deno.test("the query", () => {
  const s = pickSources(BUCKETS)!;
  const cats = parseCategories([
    { name: ["Work", "Programming"], rule: { type: "regex", regex: "code|\\.rs", ignore_case: true } },
    { name: ["Media"], rule: { type: "regex", regex: 'You"Tube' } },
  ]);
  const q = buildQuery(s, cats);
  assertStringIncludes(q, `window = flood(query_bucket("aw-watcher-window_laptop"));`);
  assertStringIncludes(q, `active = filter_keyvals(afk, "status", ["not-afk"]);`);
  assertStringIncludes(q, `window = filter_period_intersect(window, active);`);
  assertStringIncludes(
    q,
    `window = categorize(window, [[["Work", "Programming"], {"type": "regex", "regex": "(?i)code|\\.rs"}], ` +
      `[["Media"], {"type": "regex", "regex": "You\\"Tube"}]]);`,
  );
  assertStringIncludes(q, `web0 = filter_period_intersect(web0, filter_keyvals(window, "app", ["Firefox", "firefox"`);
  assertStringIncludes(q, `web = concat(web, web1);`);
  assertStringIncludes(q, `sites = limit_events(sort_by_duration(merge_events_by_keys(web, ["$domain"])), 50);`);
  assert(q.endsWith(
    `RETURN = {"apps": apps, "total": sum_durations(window), "cats": cats, "sites": sites, "web": sum_durations(web)};`,
  ));
  const bare = buildQuery({ hostname: "h", window: "w", web: [] }, []);
  assert(!bare.includes("afk"));
  assert(!bare.includes("categorize"));
  assert(bare.endsWith(`RETURN = {"apps": apps, "total": sum_durations(window)};`));
});

Deno.test("periods in local time", () => {
  const now = new Date(2026, 9, 29, 15, 30); // Thursday
  const p = periods(now);
  assertEquals(p.today[0], new Date(2026, 9, 29));
  assertEquals(p.yesterdaySoFar, [new Date(2026, 9, 28), new Date(2026, 9, 28, 15, 30)]);
  assertEquals(p.yesterday, [new Date(2026, 9, 28), new Date(2026, 9, 29)]);
  assertEquals(p.week[0], new Date(2026, 9, 26)); // Monday
  assertEquals(p.lastWeekSoFar[0], new Date(2026, 9, 19));
  // The day starts at 04:00: at 02:00 it is still yesterday.
  assertEquals(dayStart(new Date(2026, 9, 29, 2), 240), new Date(2026, 9, 28, 4));
  assertEquals(weekStart(new Date(2026, 10, 1, 12)), new Date(2026, 9, 26)); // Sunday → Monday before
  assertEquals(parseStartOfDay("04:00"), 240);
  assertEquals(parseStartOfDay(undefined), 0);
  const iso = isoLocal(new Date(2026, 9, 29, 4, 5, 6));
  assert(/^2026-10-29T04:05:06[+-]\d\d:\d\d$/.test(iso), iso);
  assertEquals(timeperiod([new Date(2026, 0, 1), new Date(2026, 0, 2)]).split("/").length, 2);
});

// Shaped like one element of POST /api/0/query/'s answer.
const RESULT = {
  apps: [
    { timestamp: "2026-10-29T08:00:00Z", duration: 7200.5, data: { app: "code" } },
    { timestamp: "2026-10-29T08:00:00Z", duration: 3600, data: { app: "firefox" } },
    { timestamp: "2026-10-29T08:00:00Z", duration: 0, data: { app: "zero" } },
  ],
  sites: [
    { duration: 1800, data: { $domain: "github.com" } },
    { duration: 600, data: { $domain: "www.github.com" } },
    { duration: 300, data: { $domain: "" } },
  ],
  cats: [
    { duration: 7000, data: { $category: ["Work", "Programming"] } },
    { duration: 500, data: { $category: ["Uncategorized"] } },
  ],
  total: 10800.5,
  web: 2700,
};

Deno.test("query results", () => {
  const u = parseUsage(RESULT);
  assertEquals(u.total, 10800.5);
  assertEquals(u.web, 2700);
  assertEquals(u.apps, [{ key: "code", seconds: 7200.5 }, { key: "firefox", seconds: 3600 }]);
  assertEquals(u.sites, [{ key: "github.com", seconds: 2400 }]);
  assertEquals(u.categories, [{ key: "Work › Programming", seconds: 7000 }]);
  assertEquals(parseUsage(undefined), { total: 0, web: 0, apps: [], sites: [], categories: [] });
  assertEquals(before(u.apps, "firefox"), 3600);
  assertEquals(before(u.apps, "nope"), 0);
});

Deno.test("formatting", () => {
  assertEquals(duration(18720), "5 h 12");
  assertEquals(duration(2700), "45 min");
  assertEquals(duration(40.4), "40 s");
  assertEquals(trend(3600, 1800), { text: "+30 min vs yesterday", color: "green", delta: 1800 });
  assertEquals(trend(1800, 3600, "last week").text, "−30 min vs last week");
  assertEquals(trend(3610, 3600).text, "same as yesterday");
  assertEquals(share(25, 100), "25%");
  assertEquals(share(0.1, 100), "<1%");
  assertEquals(share(5, 0), "0%");
  const text = summaryText("Today", parseUsage(RESULT));
  assertStringIncludes(text, "Today: 3 h 00 active");
  assertStringIncludes(text, "- code: 2 h 00");
  assertStringIncludes(text, "- github.com: 40 min");
});

Deno.test("urls and errors", () => {
  assertEquals(baseUrl(""), "http://localhost:5600");
  assertEquals(baseUrl("127.0.0.1:5600/"), "http://127.0.0.1:5600");
  assertEquals(
    activityUrl("http://localhost:5600", "my laptop", "day", new Date(2026, 9, 29)),
    "http://localhost:5600/#/activity/my%20laptop/day/2026-10-29",
  );
  assertStringIncludes(
    connectionError(
      "http://localhost:5600",
      new TypeError("error sending request: tcp connect error: Connection refused"),
    ),
    "isn't running",
  );
});
