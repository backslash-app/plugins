import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  breakdown,
  calendarDays,
  type Countdown,
  daysInMonth,
  inYear,
  isLeapYear,
  nextOccurrence,
  ordinal,
  parseDateInput,
  parseTimeInput,
  pinnedSubtitle,
  previousOccurrence,
  progress,
  sectionOf,
  sortCountdowns,
  timeLeft,
  yearsAt,
} from "./lib.ts";

// Local times: the results must not depend on the machine's time zone.
const NOW = new Date(2026, 9, 28, 10, 0); // Wed 28 Oct 2026, 10:00
const cd = (date: string, extra: Partial<Countdown> = {}): Countdown => ({
  id: date,
  title: "Vacation",
  date,
  created: new Date(2026, 9, 18, 10, 0).getTime(),
  ...extra,
});
const day = (d: Date) => [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()];

Deno.test("leap years and month lengths", () => {
  assertEquals([2024, 2025, 2100, 2000].map(isLeapYear), [true, false, false, true]);
  assertEquals(daysInMonth(2024, 2), 29);
  assertEquals(daysInMonth(2026, 2), 28);
  assertEquals(daysInMonth(2026, 12), 31);
});

Deno.test("calendar days ignore daylight saving changes", () => {
  // The night of a DST change is 23 or 25 hours long in many zones; it is still one day.
  assertEquals(calendarDays(new Date(2026, 2, 28, 12), new Date(2026, 2, 29, 12)), 1);
  assertEquals(calendarDays(new Date(2026, 2, 28, 23, 59), new Date(2026, 2, 29, 0, 1)), 1);
  assertEquals(calendarDays(new Date(2026, 9, 24, 0, 30), new Date(2026, 9, 26, 0, 0)), 2);
  assertEquals(calendarDays(new Date(2026, 2, 1), new Date(2026, 9, 31)), 244);
  assertEquals(calendarDays(new Date(2024, 1, 28), new Date(2024, 2, 1)), 2);
  assertEquals(calendarDays(new Date(2026, 1, 28), new Date(2026, 2, 1)), 1);
});

Deno.test("labels for all-day events", () => {
  const label = (date: string) => timeLeft(cd(date), NOW).label;
  assertEquals(label("2026-11-09"), "in 12 days");
  assertEquals(label("2026-10-29"), "tomorrow");
  assertEquals(label("2026-10-28"), "today");
  assertEquals(label("2026-10-27"), "yesterday");
  assertEquals(label("2026-10-20"), "8 days ago");
  assertEquals(label("2026-10-30"), "in 2 days");
  assert(!timeLeft(cd("2026-10-28"), NOW).past, "an all-day event lasts the whole day");
  assert(timeLeft(cd("2026-10-27"), NOW).past);
});

Deno.test("labels for timed events", () => {
  const label = (date: string, time: string, now = NOW) => timeLeft(cd(date, { time }), now).label;
  assertEquals(label("2026-10-28", "13:00"), "in 3 hours");
  assertEquals(label("2026-10-28", "10:20"), "in 20 minutes");
  assertEquals(label("2026-10-28", "10:00"), "now");
  assertEquals(label("2026-10-28", "08:00"), "2 hours ago");
  assertEquals(label("2026-10-29", "02:00", new Date(2026, 9, 28, 23, 0)), "in 3 hours");
  assertEquals(label("2026-10-29", "18:00"), "tomorrow");
  assertEquals(label("2026-11-09", "18:00"), "in 12 days");
  // A DST night between now and the event doesn't change the day count.
  assertEquals(label("2026-03-30", "09:00", new Date(2026, 2, 28, 9, 0)), "in 2 days");
  assertEquals(label("2026-03-29", "12:00", new Date(2026, 2, 28, 12, 0)), "tomorrow");
});

Deno.test("yearly events: next occurrence, today included", () => {
  const birthday = cd("1990-11-09", { yearly: true });
  assertEquals(day(nextOccurrence(birthday, NOW)), [2026, 11, 9, 0, 0]);
  assertEquals(yearsAt(birthday, NOW), 36);
  assertEquals(timeLeft(birthday, NOW).label, "in 12 days");
  const passed = cd("1990-03-02", { yearly: true });
  assertEquals(day(nextOccurrence(passed, NOW)), [2027, 3, 2, 0, 0]);
  assertEquals(day(previousOccurrence(passed, NOW)!), [2026, 3, 2, 0, 0]);
  const today = cd("2000-10-28", { yearly: true });
  assertEquals(timeLeft(today, NOW).label, "today");
  assertEquals(yearsAt(today, NOW), 26);
  // A yearly event set in the future starts that year.
  const future = cd("2027-06-01", { yearly: true });
  assertEquals(day(nextOccurrence(future, NOW)), [2027, 6, 1, 0, 0]);
  assertEquals(yearsAt(future, NOW), undefined);
  assertEquals(previousOccurrence(future, NOW), undefined);
  // A timed yearly event that already happened today moves on to next year.
  const morning = cd("2020-10-28", { yearly: true, time: "08:00" });
  assertEquals(day(nextOccurrence(morning, NOW)), [2027, 10, 28, 8, 0]);
});

Deno.test("leap-day birthdays fall on Feb 28 in other years", () => {
  const leap = cd("2000-02-29", { yearly: true });
  assertEquals(day(inYear(leap, 2027)), [2027, 2, 28, 0, 0]);
  assertEquals(day(inYear(leap, 2028)), [2028, 2, 29, 0, 0]);
  assertEquals(day(nextOccurrence(leap, NOW)), [2027, 2, 28, 0, 0]);
  assertEquals(day(nextOccurrence(leap, new Date(2028, 1, 1))), [2028, 2, 29, 0, 0]);
  assertEquals(timeLeft(leap, new Date(2027, 1, 28, 9)).label, "today");
  assertEquals(yearsAt(leap, NOW), 27);
});

Deno.test("sections and order", () => {
  const list = [
    cd("2026-12-25", { id: "xmas" }),
    cd("2026-10-30", { id: "soon" }),
    cd("2026-11-15", { id: "month" }),
    cd("2026-10-01", { id: "old" }),
    cd("2026-10-20", { id: "recent" }),
    cd("1990-11-01", { id: "bday", yearly: true }),
  ];
  assertEquals(list.map((c) => sectionOf(c, NOW)), ["Later", "This Week", "This Month", "Past", "Past", "This Week"]);
  assertEquals(sortCountdowns(list, NOW).map((c) => c.id), ["soon", "bday", "month", "xmas", "recent", "old"]);
});

Deno.test("progress since creation, or since the last yearly occurrence", () => {
  // Created on Oct 18, due Nov 7 at midnight: half-way on Oct 28 at 00:00.
  const c = cd("2026-11-07");
  const ratio = progress(c, NOW);
  assert(ratio > 0.5 && ratio < 0.53, String(ratio));
  assertEquals(progress(cd("2026-10-01"), NOW), 1);
  assertEquals(progress(cd("2026-12-01", { created: NOW.getTime() }), NOW), 0);
  // Yearly: from last year's occurrence (later than the creation date here).
  const yearly = cd("1990-04-28", { yearly: true, created: new Date(2020, 0, 1).getTime() });
  const r = progress(yearly, NOW);
  assert(r > 0.49 && r < 0.51, String(r));
});

Deno.test("breakdown in calendar units", () => {
  assertEquals(breakdown(NOW, new Date(2026, 9, 28, 18)), "Today");
  assertEquals(breakdown(NOW, new Date(2026, 10, 9)), "1 week, 5 days");
  assertEquals(breakdown(NOW, new Date(2027, 0, 1)), "2 months, 4 days");
  assertEquals(breakdown(NOW, new Date(2028, 0, 1)), "1 year, 2 months, 4 days");
  assertEquals(breakdown(new Date(2026, 0, 31), new Date(2026, 2, 1)), "1 month, 1 day");
  assertEquals(breakdown(new Date(2026, 10, 9), NOW), "1 week, 5 days");
});

Deno.test("dates and times typed in the form", () => {
  assertEquals(parseDateInput("2026-12-24", NOW), "2026-12-24");
  assertEquals(parseDateInput("2026-2-3", NOW), "2026-02-03");
  assertEquals(parseDateInput("12-24", NOW), "2026-12-24");
  assertEquals(parseDateInput("03-01", NOW), "2027-03-01"); // next one
  assertEquals(parseDateInput("10-28", NOW), "2026-10-28"); // today counts
  assertEquals(parseDateInput("Dec 24", NOW), "2026-12-24");
  assertEquals(parseDateInput("24 december", NOW), "2026-12-24");
  assertEquals(parseDateInput("December 24th, 2027", NOW), "2027-12-24");
  assertEquals(parseDateInput("24 Dec. 2027", NOW), "2027-12-24");
  assertEquals(parseDateInput("Feb 29", NOW), "2028-02-29"); // the next leap day
  assertEquals(parseDateInput("2027-02-29", NOW), undefined);
  assertEquals(parseDateInput("tomorrow", NOW), "2026-10-29");
  assertEquals(parseDateInput("soon", NOW), undefined);
  assertEquals(parseDateInput("13-01", NOW), undefined);
  assertEquals(parseTimeInput(""), undefined);
  assertEquals(parseTimeInput("18:30"), "18:30");
  assertEquals(parseTimeInput("9:05"), "09:05");
  assertEquals(parseTimeInput("6pm"), "18:00");
  assertEquals(parseTimeInput("12 am"), "00:00");
  assertEquals(parseTimeInput("12:15pm"), "12:15");
  assertEquals(parseTimeInput("18h30"), "18:30");
  assertThrows(() => parseTimeInput("25:00"));
  assertThrows(() => parseTimeInput("13pm"));
  assertThrows(() => parseTimeInput("later"));
});

Deno.test("root search subtitle and ordinals", () => {
  assertEquals(pinnedSubtitle(cd("2026-11-09"), NOW), "Vacation in 12 days");
  assertEquals(pinnedSubtitle(cd("2026-10-28"), NOW), "Vacation today");
  assertEquals([1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111].map(ordinal), [
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
    "101st",
    "111th",
  ]);
});

Deno.test("item: sections, stats and actions", async () => {
  const { countdownItem } = await import("./countdowns.ts");
  const item = countdownItem(cd("2026-11-09", { color: "green" }), NOW, false);
  assertEquals(item.section, "This Month");
  assertEquals(item.accessories?.at(-1)?.text, "in 12 days");
  assertEquals(item.detail?.stats?.[0], { label: "days left", value: 12, color: "green" });
  assertEquals(item.actions?.map((a) => a.title).slice(0, 3), [
    "Pin to Root Search",
    "Edit Countdown",
    "New Countdown",
  ]);
  assert(item.actions?.some((a) => a.destructive && a.confirm));
});
