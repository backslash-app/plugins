import { assert, assertEquals } from "@std/assert";
import {
  CITIES,
  dayDiff,
  dayLabel,
  findTime,
  formatDiff,
  formatTime,
  formatUtcOffset,
  isDaytime,
  move,
  nextTransition,
  parseConversion,
  placesFromIds,
  resolvePlace,
  searchCities,
  wallClock,
  zonedToInstant,
  zoneOffset,
} from "./lib.ts";
import { clockItem, localName, region } from "./clocks.ts";

const SUMMER = Date.UTC(2026, 6, 15, 12, 0); // 15 July 2026, 12:00 UTC
const WINTER = Date.UTC(2026, 0, 15, 12, 0);

Deno.test("offsets follow daylight saving time", () => {
  assertEquals(zoneOffset("Europe/Paris", SUMMER), 120);
  assertEquals(zoneOffset("Europe/Paris", WINTER), 60);
  assertEquals(zoneOffset("America/New_York", SUMMER), -240);
  assertEquals(zoneOffset("America/New_York", WINTER), -300);
  assertEquals(zoneOffset("Asia/Kolkata", SUMMER), 330);
  assertEquals(zoneOffset("Asia/Kathmandu", SUMMER), 345);
  assertEquals(zoneOffset("Australia/Sydney", WINTER), 660);
  assertEquals(zoneOffset("UTC", SUMMER), 0);
});

Deno.test("wall clock and its inverse", () => {
  const w = wallClock("Asia/Tokyo", SUMMER);
  assertEquals([w.year, w.month, w.day, w.hour, w.minute, w.weekday], [2026, 7, 15, 21, 0, 3]);
  assertEquals(zonedToInstant("Asia/Tokyo", 2026, 7, 15, 21, 0), SUMMER);
  assertEquals(zonedToInstant("Europe/Paris", 2026, 1, 15, 13, 0), WINTER);
  // 29 March 2026: Paris jumps from 2:00 to 3:00; 2:30 does not exist and moves forward.
  const gap = zonedToInstant("Europe/Paris", 2026, 3, 29, 2, 30);
  assertEquals(wallClock("Europe/Paris", gap).hour, 3);
  // 25 October 2026: 2:30 happens twice; the first one (still summer time) wins.
  assertEquals(zonedToInstant("Europe/Paris", 2026, 10, 25, 2, 30), Date.UTC(2026, 9, 25, 0, 30));
});

Deno.test("formatting offsets, differences and days", () => {
  assertEquals(formatUtcOffset(120), "UTC+2");
  assertEquals(formatUtcOffset(-300), "UTC−5");
  assertEquals(formatUtcOffset(330), "UTC+5:30");
  assertEquals(formatUtcOffset(0), "UTC");
  assertEquals(formatDiff(420), "+7h");
  assertEquals(formatDiff(-360), "−6h");
  assertEquals(formatDiff(210), "+3h30");
  assertEquals(formatDiff(0), "Same time");
  // 23:00 in Paris is the next morning in Tokyo, the previous afternoon in Los Angeles.
  const late = Date.UTC(2026, 6, 15, 21, 0);
  assertEquals(dayDiff("Asia/Tokyo", "Europe/Paris", late), 1);
  assertEquals(dayDiff("America/Los_Angeles", "Europe/Paris", Date.UTC(2026, 6, 15, 3, 0)), -1);
  assertEquals([dayLabel(0), dayLabel(1), dayLabel(-1)], [undefined, "Tomorrow", "Yesterday"]);
  assertEquals(formatTime("Europe/Paris", SUMMER), "14:00");
  assertEquals(formatTime("Europe/Paris", SUMMER, true), "2:00 PM");
  assert(isDaytime(12) && !isDaytime(23) && !isDaytime(5));
});

Deno.test("next clock change", () => {
  const t = nextTransition("Europe/Paris", SUMMER)!;
  assertEquals(new Date(t.at).toISOString(), "2026-10-25T01:00:00.000Z");
  assertEquals([t.before, t.after], [120, 60]);
  assertEquals(nextTransition("Asia/Tokyo", SUMMER), undefined);
});

Deno.test("city table: about 200 cities, all zones valid, unique ids", () => {
  assert(CITIES.length >= 200, `${CITIES.length} cities`);
  const ids = new Set<string>();
  for (const c of CITIES) {
    new Intl.DateTimeFormat("en", { timeZone: c.zone }); // throws on an unknown zone
    const id = `${c.zone}#${c.name}`;
    assert(!ids.has(id), `duplicate ${id}`);
    ids.add(id);
  }
});

Deno.test("searching and resolving cities", () => {
  assertEquals(searchCities("paris")[0].name, "Paris");
  assertEquals(searchCities("nyc")[0].name, "New York");
  assertEquals(searchCities("sao")[0].name, "São Paulo");
  assertEquals(searchCities("japan")[0].zone, "Asia/Tokyo");
  assertEquals(resolvePlace("NY")?.name, "New York");
  assertEquals(resolvePlace("münchen")?.name, "Munich");
  assertEquals(resolvePlace("sf")?.zone, "America/Los_Angeles");
  assertEquals(resolvePlace("here", "Europe/Paris")?.local, true);
  assertEquals(resolvePlace("Europe/Paris")?.zone, "Europe/Paris");
  assertEquals(resolvePlace("America/Argentina/Cordoba")?.name, "Cordoba");
  assertEquals(resolvePlace("zz"), undefined);
  assertEquals(resolvePlace("xyzzyville"), undefined);
});

Deno.test("finding a time in text", () => {
  assertEquals(findTime("15:00 paris"), { time: { hour: 15, minute: 0 }, rest: "paris" });
  assertEquals(findTime("3pm NY"), { time: { hour: 15, minute: 0 }, rest: "NY" });
  assertEquals(findTime("3:30 pm"), { time: { hour: 15, minute: 30 }, rest: "" });
  assertEquals(findTime("12am")?.time, { hour: 0, minute: 0 });
  assertEquals(findTime("12pm")?.time, { hour: 12, minute: 0 });
  assertEquals(findTime("15h30 lyon")?.time, { hour: 15, minute: 30 });
  assertEquals(findTime("9h")?.time, { hour: 9, minute: 0 });
  assertEquals(findTime("noon london")?.time, { hour: 12, minute: 0 });
  assertEquals(findTime("london midnight")?.rest, "london");
  assertEquals(findTime("now")?.time, "now");
  assertEquals(findTime("3 tokyo"), undefined);
  assertEquals(findTime("25:00"), undefined);
  assertEquals(findTime("13pm"), undefined);
  assertEquals(findTime("tokyo"), undefined);
});

Deno.test("conversions", () => {
  const now = SUMMER; // 14:00 in Paris
  const a = parseConversion("15:00 paris to tokyo", now, "Europe/Paris")!;
  assertEquals([a.from.name, a.to?.name], ["Paris", "Tokyo"]);
  assertEquals(a.at, Date.UTC(2026, 6, 15, 13, 0));
  assertEquals(formatTime("Asia/Tokyo", a.at), "22:00");

  const b = parseConversion("3pm NY in Paris", now, "Europe/Paris")!;
  assertEquals(formatTime("Europe/Paris", b.at), "21:00");

  const c = parseConversion("9am to tokyo", now, "Europe/Paris")!;
  assertEquals(c.from.local, true);
  assertEquals(formatTime("Asia/Tokyo", c.at), "16:00");

  const d = parseConversion("noon london", now, "Europe/Paris")!;
  assertEquals([d.from.name, d.to], ["London", undefined]);

  const e = parseConversion("paris to tokyo", now, "Europe/Paris")!;
  assertEquals([e.time, e.at], ["now", now]);

  const f = parseConversion("new york 9:30am → los angeles", now, "Europe/Paris")!;
  assertEquals(formatTime("America/Los_Angeles", f.at), "06:30");

  const g = parseConversion("15h en tokyo", now, "Europe/Paris")!;
  assertEquals(g.to?.name, "Tokyo");

  assertEquals(parseConversion("tokyo", now, "Europe/Paris"), undefined);
  assertEquals(parseConversion("paris", now, "Europe/Paris"), undefined);
  assertEquals(parseConversion("3pm to nowhereland", now, "Europe/Paris"), undefined);
  assertEquals(parseConversion("", now, "Europe/Paris"), undefined);
});

Deno.test("stored clocks and reordering", () => {
  const places = placesFromIds(["local", "Asia/Tokyo#Tokyo", "Nope/Nope#Nowhere"], "Europe/Paris");
  assertEquals(places.map((p) => p.name), ["Local", "Tokyo"]);
  assertEquals(localName("Europe/Paris"), "Paris");
  assertEquals(localName("America/Argentina/Cordoba"), "Cordoba");
  const ids = ["a", "b", "c", "d"];
  assertEquals(move(ids, "c", "top"), ["c", "a", "b", "d"]);
  assertEquals(move(ids, "c", "up"), ["a", "c", "b", "d"]);
  assertEquals(move(ids, "a", "down"), ["b", "a", "c", "d"]);
  assertEquals(move(ids, "a", "bottom"), ["b", "c", "d", "a"]);
  assertEquals(move(ids, "x", "top"), ids);
  assertEquals([region("Europe/Paris"), region("America/Lima"), region("Pacific/Auckland")], [
    "Europe",
    "Americas",
    "Oceania",
  ]);
});

Deno.test("a clock item", () => {
  const [tokyo] = placesFromIds(["Asia/Tokyo#Tokyo"]);
  const item = clockItem(tokyo, { at: SUMMER, hour12: false, section: "Your Clocks", ids: ["local", tokyo.id] });
  assertEquals(item.title, "Tokyo");
  assertEquals(item.icon, { source: "bs-moon", tint: "blue" }); // 21:00
  assertEquals(item.accessories?.at(-1)?.text, "21:00");
  const titles = item.actions?.map((a) => a.title) ?? [];
  assert(titles.includes("Move to Top"));
  assert(titles.includes("Remove Clock"));
  assert(!titles.includes("Move Down"));
  assertEquals(item.detail?.stats?.[0], { label: "Time", value: "21:00" });
});
