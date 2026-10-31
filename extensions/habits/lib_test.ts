import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  addDays,
  applyInput,
  bestStreak,
  checkIn,
  completionRate,
  describeDays,
  describeFrequency,
  doneOn,
  findHabit,
  type Habit,
  habiticaHeaders,
  heatmap,
  isUuid,
  lastDays,
  parseDays,
  parseHabiticaTasks,
  pullHabitica,
  sanitize,
  scoreDirection,
  sortHabits,
  stateToday,
  streak,
  todaySummary,
  toggleToday,
  uncheck,
  weekCount,
  weekStart,
} from "./lib.ts";

const TODAY = "2026-10-28"; // a Wednesday

/** Checked on these days before today: "-1" is yesterday. */
const days = (...offsets: number[]) => Object.fromEntries(offsets.map((o) => [addDays(TODAY, o), 1]));
const habit = (o: Partial<Habit> = {}): Habit => ({
  id: "h1",
  name: "Read 20 minutes",
  frequency: "daily",
  target: 1,
  created: "2026-09-01",
  checks: {},
  ...o,
});

Deno.test("days of the week", () => {
  assertEquals(weekStart(TODAY), "2026-10-26");
  assertEquals(weekStart("2026-11-01"), "2026-10-26"); // Sunday
  assertEquals(addDays("2026-10-31", 1), "2026-11-01");
  assertEquals(parseDays(""), undefined);
  assertEquals(parseDays("every day"), undefined);
  assertEquals(parseDays("weekdays"), [1, 2, 3, 4, 5]);
  assertEquals(parseDays("Mon–Fri"), [1, 2, 3, 4, 5]);
  assertEquals(parseDays("fri-mon"), [0, 1, 5, 6]);
  assertEquals(parseDays("mon, wed, fri"), [1, 3, 5]);
  assertEquals(parseDays("lun mer ven"), [1, 3, 5]);
  assertEquals(parseDays("weekends"), [0, 6]);
  assertEquals(parseDays("mon-sun"), undefined);
  assertThrows(() => parseDays("someday"));
  assertEquals(describeDays([1, 2, 3, 4, 5]), "Mon–Fri");
  assertEquals(describeDays([0, 6]), "Weekends");
  assertEquals(describeDays([1, 3, 5]), "Mon, Wed, Fri");
  assertEquals(describeDays([0, 1, 5, 6]), "Fri–Mon");
  assertEquals(describeDays(undefined), "Every day");
});

Deno.test("frequencies described", () => {
  assertEquals(describeFrequency(habit()), "Every day");
  assertEquals(describeFrequency(habit({ target: 8 })), "8× a day, every day");
  assertEquals(describeFrequency(habit({ frequency: "weekly", target: 3 })), "3× a week");
  assertEquals(describeFrequency(habit({ frequency: "weekly", target: 1 })), "Once a week");
});

Deno.test("daily streak: alive until today is over, broken by a miss", () => {
  const h = habit({ checks: days(-1, -2, -3, -5) });
  assertEquals(streak(h, TODAY), 3); // not done today yet
  assertEquals(streak(checkIn(h, TODAY), TODAY), 4);
  assertEquals(bestStreak(h, TODAY), 3);
  assertEquals(streak(habit(), TODAY), 0);
});

Deno.test("streak skips the days a habit is not due", () => {
  // Mon–Fri: done Fri 23, Mon 26, Tue 27; the weekend doesn't count.
  const h = habit({ days: [1, 2, 3, 4, 5], checks: days(-5, -2, -1) });
  assertEquals(streak(h, TODAY), 3);
  assertEquals(stateToday(h, "2026-10-31"), "rest");
  assertEquals(stateToday(h, TODAY), "todo");
});

Deno.test("several times a day", () => {
  let h = habit({ name: "Water", target: 3 });
  h = checkIn(checkIn(h, TODAY), TODAY);
  assertEquals(h.checks[TODAY], 2);
  assert(!doneOn(h, TODAY));
  assertEquals(toggleToday(h, TODAY).checked, true);
  const full = toggleToday(h, TODAY).habit;
  assert(doneOn(full, TODAY));
  assertEquals(checkIn(full, TODAY).checks[TODAY], 3); // capped
  assertEquals(toggleToday(full, TODAY), { habit: uncheck(full, TODAY), checked: false });
});

Deno.test("weekly goals and streaks", () => {
  // 3× a week: last week Mon/Wed/Fri, the week before twice, this week once.
  const h = habit({ frequency: "weekly", target: 3, checks: days(-9, -7, -5, -14, -12, -1) });
  assertEquals(weekCount(h, "2026-10-19"), 3);
  assertEquals(weekCount(h, weekStart(TODAY)), 1);
  assertEquals(streak(h, TODAY), 1);
  assertEquals(stateToday(h, TODAY), "todo");
  const met = checkIn(checkIn(h, TODAY), "2026-10-29");
  assertEquals(stateToday(met, "2026-10-29"), "done");
  assertEquals(streak(met, "2026-10-29"), 2);
  assertEquals(bestStreak(met, "2026-10-29"), 2);
});

Deno.test("completion over the last 30 days", () => {
  const h = habit({ created: "2026-10-19", checks: days(-1, -2, -3, -4, -5, -7) }); // 9 days, today pending
  assertEquals(completionRate(h, TODAY), 6 / 9);
  assertEquals(completionRate(checkIn(h, TODAY), TODAY), 7 / 10);
  assertEquals(completionRate(habit({ created: TODAY }), TODAY), 0);
});

Deno.test("check-ins before the creation date still count", () => {
  const h = habit({ created: TODAY, checks: days(-1, -2) });
  assertEquals(streak(h, TODAY), 2);
});

Deno.test("summary, sorting and search", () => {
  const habits = [
    habit({ id: "a", name: "Read", checks: days(0) }),
    habit({ id: "b", name: "Exercise" }),
    habit({ id: "c", name: "Stretch", days: [0, 6] }),
    habit({ id: "d", name: "Old", archived: true }),
  ];
  assertEquals(todaySummary(habits, TODAY), "1 of 2 done today");
  assertEquals(todaySummary([habits[0]], TODAY), "All 1 done today");
  assertEquals(todaySummary([habits[2]], TODAY), undefined);
  assertEquals(sortHabits(habits, TODAY).map((h) => h.id), ["b", "a", "c", "d"]);
  assertEquals(findHabit(habits, "read")?.id, "a");
  assertEquals(findHabit(habits, "exer")?.id, "b");
  assertEquals(findHabit(habits, "TRETCH")?.id, "c");
  assertEquals(findHabit(habits, "old"), undefined);
  assertEquals(findHabit([habit({ name: "Méditer" })], "mediter")?.name, "Méditer");
});

Deno.test("heatmap: weeks as columns, Monday on top, the future blank", () => {
  const h = habit({ created: "2026-10-12", checks: days(-1, -2, -9) });
  const map = heatmap(h, TODAY, 4);
  const lines = map.split("\n");
  assertEquals(lines.length, 8);
  assertEquals(lines[0], "    Oct");
  // Columns: weeks of Oct 5, 12, 19, 26. Oct 5–11 is before the habit.
  assertEquals(lines[1], "Mon · □ ■ ■"); // Oct 5, 12, 19 (-9), 26 (-2)
  assertEquals(lines[2], "Tue · □ □ ■"); // Oct 27 (-1)
  assertEquals(lines[3], "Wed · □ □ □"); // today, not done yet
  assertEquals(lines[4], "Thu · □ □"); // Oct 29 is in the future
  assertEquals(lastDays(h, TODAY), "□□□□■■□");
});

Deno.test("heatmap shows month names where months start", () => {
  const map = heatmap(habit(), TODAY, 10);
  assert(map.split("\n")[0].includes("Sep"));
  assert(map.split("\n")[0].includes("Oct"));
});

Deno.test("habits from the form", () => {
  const h = applyInput({ name: "  Run  5k ", frequency: "weekly", days: "mon", target: "" }, TODAY, undefined, "x");
  assertEquals(h, { id: "x", name: "Run 5k", frequency: "weekly", target: 3, created: TODAY, checks: {} });
  const d = applyInput({ name: "Floss", frequency: "daily", days: "mon-fri", target: "2" }, TODAY, undefined, "y");
  assertEquals([d.days, d.target], [[1, 2, 3, 4, 5], 2]);
  const edited = applyInput({ name: "Floss", frequency: "daily", days: "", target: "1" }, TODAY, {
    ...d,
    checks: days(-1),
  });
  assertEquals([edited.id, edited.days, edited.checks], ["y", undefined, days(-1)]);
  assertThrows(() => applyInput({ name: "", frequency: "daily", days: "", target: "" }, TODAY));
  assertThrows(() => applyInput({ name: "X", frequency: "weekly", days: "", target: "8" }, TODAY));
  assertThrows(() => applyInput({ name: "X", frequency: "daily", days: "", target: "1.5" }, TODAY));
});

Deno.test("storage contents are checked", () => {
  assertEquals(sanitize(null), []);
  assertEquals(sanitize([{ id: 1 }, "x"]), []);
  const [h] = sanitize([{ id: "a", name: "A", frequency: "daily", target: 0, created: "bad", checks: null }]);
  assertEquals([h.target, h.checks, /^\d{4}-\d{2}-\d{2}$/.test(h.created)], [1, {}, true]);
});

const HABITICA = {
  success: true,
  data: [
    {
      _id: "5a8d1f6c-0b3e-4f6e-9a3c-1d2e3f4a5b6c",
      type: "daily",
      text: "Read 20 minutes",
      completed: true,
      isDue: true,
      streak: 12,
    },
    { _id: "6b9e2a7d-1c4f-4a7f-8b4d-2e3f4a5b6c7d", type: "habit", text: "Drink water", up: true, down: false },
    { _id: "7c0f3b8e-2d5a-4b8a-9c5e-3f4a5b6c7d8e", type: "todo", text: "Buy milk" },
    { type: "daily" },
  ],
  notifications: [],
};

Deno.test("Habitica tasks", () => {
  const tasks = parseHabiticaTasks(HABITICA);
  assertEquals(tasks.map((t) => [t.type, t.text, t.completed, t.streak]), [
    ["daily", "Read 20 minutes", true, 12],
    ["habit", "Drink water", undefined, undefined],
  ]);
  assertEquals(parseHabiticaTasks({ success: false }), []);
});

Deno.test("Habitica dailies checked today are checked here", () => {
  const linked = habit({ habitica: { id: "5a8d1f6c-0b3e-4f6e-9a3c-1d2e3f4a5b6c", type: "daily" } });
  const other = habit({
    id: "h2",
    name: "Water",
    habitica: { id: "6b9e2a7d-1c4f-4a7f-8b4d-2e3f4a5b6c7d", type: "habit" },
  });
  const { habits, changed } = pullHabitica([linked, other, habit({ id: "h3" })], parseHabiticaTasks(HABITICA), TODAY);
  assertEquals(changed, 1);
  assert(doneOn(habits[0], TODAY));
  assert(!doneOn(habits[1], TODAY));
  assertEquals(pullHabitica(habits, parseHabiticaTasks(HABITICA), TODAY).changed, 0);
});

Deno.test("Habitica requests", () => {
  const user = "1a2b3c4d-1111-4222-8333-444455556666";
  assertEquals(habiticaHeaders(user, "k")["x-client"], `${user}-Backslash`);
  assertEquals(habiticaHeaders(user, "k")["x-api-key"], "k");
  assertEquals(scoreDirection({ type: "daily" }, true), "up");
  assertEquals(scoreDirection({ type: "daily" }, false), "down");
  assertEquals(scoreDirection({ type: "habit" }, false), undefined);
  assert(isUuid(user));
  assert(!isUuid("my-name"));
});

Deno.test("manifest: habitica.com only", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(manifest.permissions, { net: ["habitica.com"] });
  const token = manifest.preferences.find((p: any) => p.name === "habiticaToken");
  assertEquals(token.type, "secret");
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
