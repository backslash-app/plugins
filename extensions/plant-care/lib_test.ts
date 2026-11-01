import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  actualRhythm,
  addDays,
  dayOf,
  daysBetween,
  dueSummary,
  every,
  feed,
  feedDue,
  formatDay,
  HISTORY,
  isDay,
  needsWater,
  nextWatering,
  parseDay,
  parseEvery,
  type Plant,
  plantFromForm,
  sanitize,
  section,
  snooze,
  sortPlants,
  undoWater,
  water,
  waterDue,
} from "./lib.ts";
import { SPECIES, speciesById } from "./species.ts";

const TODAY = "2026-11-02";

const plant = (o: Partial<Plant> = {}): Plant => ({
  id: "p1",
  name: "Monstera",
  waterEvery: 7,
  history: [],
  created: 0,
  ...o,
});

Deno.test("manifest", async () => {
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(m.extension.id, "plant-care");
  assertEquals(m.extension.version, "1.0.0");
  assertEquals(m.extension.categories, ["productivity"]);
  assertEquals(m.permissions, undefined);
  assertEquals(m.commands.map((c: { title: string }) => c.title), [
    "Plant Care",
    "Add Plant",
    "Houseplant Care Guide",
    "Plants to Water",
  ]);
  const tray = m.commands.find((c: { name: string }) => c.name === "tray");
  assertEquals([tray.mode, tray.interval], ["menu-bar", "1h"]);
  assert(m.extension.description.includes(String(SPECIES.length)));
  for (const c of m.commands) assertEquals(new Set(c.keywords).size, c.keywords.length, c.name);
});

Deno.test("species presets", () => {
  assertEquals(SPECIES.length, 44);
  assertEquals(new Set(SPECIES.map((s) => s.id)).size, SPECIES.length);
  for (const s of SPECIES) {
    assert(s.waterDays >= 2 && s.waterDays <= 21, s.id);
    assert(s.feedWeeks >= 0 && s.feedWeeks <= 12, s.id);
    assert(s.tip.endsWith("."), s.id);
  }
  // A few well-known ones (ASPCA).
  assertEquals(speciesById("spider-plant")?.toxic, false);
  assertEquals(speciesById("monstera")?.toxic, true);
  assertEquals(speciesById("pothos")?.toxic, true);
  assertEquals(speciesById("calathea")?.toxic, false);
  assert(speciesById("snake-plant")!.waterDays > speciesById("boston-fern")!.waterDays);
});

Deno.test("days", () => {
  assertEquals(dayOf(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assertEquals(addDays("2026-02-27", 2), "2026-03-01");
  assertEquals(addDays("2028-02-28", 1), "2028-02-29");
  assertEquals(addDays("2026-01-01", -1), "2025-12-31");
  // Daylight saving time doesn't shift days.
  assertEquals(daysBetween("2026-03-28", "2026-03-30"), 2);
  assertEquals(daysBetween("2026-11-02", "2026-10-26"), -7);
  assert(isDay("2026-02-28"));
  assert(!isDay("2026-02-30"));
  assert(!isDay("02/11/2026"));
  assertEquals(formatDay(TODAY, TODAY), "today");
  assertEquals(formatDay("2026-11-01", TODAY), "yesterday");
  assertEquals(formatDay("2026-11-03", TODAY), "tomorrow");
  assertEquals(formatDay("2026-11-09", TODAY), "Mon 9 Nov");
  assertEquals(formatDay("2025-12-24", TODAY), "24 Dec 2025");
});

Deno.test("days typed in the form", () => {
  assertEquals(parseDay("", TODAY), TODAY);
  assertEquals(parseDay("today", TODAY), TODAY);
  assertEquals(parseDay("Hier", TODAY), "2026-11-01");
  assertEquals(parseDay("3 days ago", TODAY), "2026-10-30");
  assertEquals(parseDay("il y a 2 jours", TODAY), "2026-10-31");
  assertEquals(parseDay("1 week ago", TODAY), "2026-10-26");
  assertEquals(parseDay("2026-10-28", TODAY), "2026-10-28");
  assertEquals(parseDay("28/10", TODAY), "2026-10-28");
  assertEquals(parseDay("28/10/2025", TODAY), "2025-10-28");
  assertEquals(parseDay("28.10.25", TODAY), "2025-10-28");
  // A day later in the year typed without a year is last year's.
  assertEquals(parseDay("24/12", TODAY), "2025-12-24");
  assertEquals(parseDay("2026-12-01", TODAY), undefined);
  assertEquals(parseDay("31/02", TODAY), undefined);
  assertEquals(parseDay("soon", TODAY), undefined);
});

Deno.test("periods typed in the form", () => {
  assertEquals(parseEvery("7"), 7);
  assertEquals(parseEvery("10 days"), 10);
  assertEquals(parseEvery("2 weeks"), 14);
  assertEquals(parseEvery("2w"), 14);
  assertEquals(parseEvery("3 jours"), 3);
  assertEquals(parseEvery("0"), undefined);
  assertEquals(parseEvery("often"), undefined);
  assertEquals(parseEvery("4", "weeks"), 4);
  assertEquals(parseEvery("1 month", "weeks"), 4);
  assertEquals(parseEvery("14 days", "weeks"), 2);
  assertEquals(parseEvery("0", "weeks"), 0);
  assertEquals(every(1), "every day");
  assertEquals(every(7), "every week");
  assertEquals(every(14), "every 2 weeks");
  assertEquals(every(10), "every 10 days");
});

Deno.test("watering schedule", () => {
  const never = plant();
  assertEquals(waterDue(never, TODAY), { days: 0, label: "Water today", color: "orange" });
  const watered = water(never, "2026-10-30");
  assertEquals(nextWatering(watered, TODAY), "2026-11-06");
  assertEquals(waterDue(watered, TODAY), { days: 4, label: "In 4 days", color: "green" });
  assertEquals(waterDue(water(never, "2026-10-27"), TODAY).label, "Tomorrow");
  assertEquals(waterDue(water(never, "2026-10-26"), TODAY).label, "Water today");
  const late = water(never, "2026-10-20");
  assertEquals(waterDue(late, TODAY), { days: -6, label: "Overdue by 6 days", color: "red" });
  assert(needsWater(late, TODAY));
  assertEquals(section(late, TODAY), "Needs Water");
  assertEquals(section(watered, TODAY), "This Week");
  assertEquals(section(plant({ waterEvery: 21, lastWatered: TODAY }), TODAY), "Later");
});

Deno.test("water, undo, snooze, feed", () => {
  let p = water(plant(), "2026-10-20");
  p = water(p, "2026-10-27");
  p = water(p, "2026-10-27");
  assertEquals(p.history, ["2026-10-27", "2026-10-20"]);
  // Logging an older watering keeps the most recent as the last one.
  p = water(p, "2026-10-24");
  assertEquals(p.lastWatered, "2026-10-27");
  assertEquals(p.history, ["2026-10-27", "2026-10-24", "2026-10-20"]);
  p = undoWater(p);
  assertEquals(p.lastWatered, "2026-10-24");
  // Snoozing moves an overdue plant to tomorrow; watering clears the snooze.
  const s = snooze(water(plant(), "2026-10-20"), TODAY);
  assertEquals(nextWatering(s, TODAY), "2026-11-03");
  assert(!needsWater(s, TODAY));
  assertEquals(water(s, TODAY).snoozedUntil, undefined);
  // A snooze earlier than the due date changes nothing.
  assertEquals(nextWatering(snooze(water(plant(), TODAY), TODAY), TODAY), "2026-11-09");
  // History is capped.
  let long = plant();
  for (let i = 0; i < HISTORY + 10; i++) long = water(long, addDays("2026-01-01", i));
  assertEquals(long.history.length, HISTORY);
  // Feeding.
  assertEquals(feedDue(plant(), TODAY), undefined);
  const f = plant({ feedEvery: 4 });
  assertEquals(feedDue(f, TODAY)?.label, "Feed today");
  assertEquals(feedDue(feed(f, "2026-10-26"), TODAY)?.label, "Feed in 21 days");
  assertEquals(feedDue(feed(f, "2026-09-28"), TODAY)?.label, "Feed (7 days late)");
});

Deno.test("the real rhythm from the history", () => {
  let p = plant();
  assertEquals(actualRhythm(p), undefined);
  for (const d of ["2026-10-01", "2026-10-06", "2026-10-12", "2026-10-17", "2026-10-30"]) p = water(p, d);
  // Gaps 5, 6, 5, 13: the median is 5.5 → 6.
  assertEquals(actualRhythm(p), 6);
  p = water(p, "2026-11-04");
  assertEquals(actualRhythm(p), 5);
});

Deno.test("sorting and summary", () => {
  const plants = [
    plant({ id: "a", name: "Fern", waterEvery: 3, lastWatered: "2026-11-01" }),
    plant({ id: "b", name: "Cactus", waterEvery: 21, lastWatered: "2026-10-01" }),
    plant({ id: "c", name: "Basil", waterEvery: 2, lastWatered: "2026-10-31" }),
    plant({ id: "d", name: "Aloe", waterEvery: 21, lastWatered: "2026-10-30" }),
  ];
  assertEquals(sortPlants(plants, TODAY).map((p) => p.name), ["Cactus", "Basil", "Fern", "Aloe"]);
  assertEquals(dueSummary(plants, TODAY), "2 plants need water");
  assertEquals(dueSummary(plants.slice(0, 1), TODAY), "Next: Fern in 2 days");
  assertEquals(dueSummary(plants.slice(1, 2), TODAY), "Cactus needs water");
  assertEquals(dueSummary([], TODAY), "");
});

Deno.test("form values", () => {
  const p = plantFromForm(
    {
      name: " Big monstera ",
      species: "monstera",
      room: "Living room",
      waterEvery: "",
      feedEvery: "",
      lastWatered: "yesterday",
      notes: "",
    },
    TODAY,
    undefined,
    "x",
    1,
  );
  assertEquals(p, {
    id: "x",
    name: "Big monstera",
    species: "monstera",
    room: "Living room",
    waterEvery: 7,
    feedEvery: 4,
    lastWatered: "2026-11-01",
    history: ["2026-11-01"],
    created: 1,
  });
  // Explicit values win over the species; 0 weeks means never.
  const q = plantFromForm(
    { name: "Cactus", species: "cactus", waterEvery: "4 weeks", feedEvery: "0", lastWatered: "" },
    TODAY,
    undefined,
    "y",
    1,
  );
  assertEquals([q.waterEvery, q.feedEvery, q.lastWatered], [28, undefined, undefined]);
  // Editing keeps the history and the creation date.
  const edited = plantFromForm(
    { name: "Renamed", species: "", waterEvery: "5", feedEvery: "", lastWatered: "" },
    TODAY,
    p,
    p.id,
    99,
  );
  assertEquals([edited.name, edited.waterEvery, edited.history, edited.created, edited.species], [
    "Renamed",
    5,
    ["2026-11-01"],
    1,
    undefined,
  ]);
  assertThrows(() => plantFromForm({ name: " " }, TODAY, undefined, "z", 1), Error, "name");
  assertThrows(() => plantFromForm({ name: "A", waterEvery: "often" }, TODAY, undefined, "z", 1), Error, "days");
  assertThrows(
    () => plantFromForm({ name: "A", lastWatered: "next week" }, TODAY, undefined, "z", 1),
    Error,
    "past day",
  );
});

Deno.test("storage is sanitized", () => {
  assertEquals(sanitize(undefined), []);
  assertEquals(sanitize({}), []);
  const kept = sanitize([
    { id: "a", name: "Fern", waterEvery: 3, history: ["2026-10-01", "bad"], created: 0 },
    { id: "b", name: "No rhythm", waterEvery: 0, history: [], created: 0 },
    { name: "No id", waterEvery: 3 },
    null,
    { id: "c", name: "Old", waterEvery: 5, created: 0 },
  ]);
  assertEquals(kept.map((p) => [p.id, p.history]), [["a", ["2026-10-01"]], ["c", []]]);
});
