import { assertEquals, assertThrows } from "@std/assert";
import {
  dayMatches,
  explain,
  fieldLines,
  formatRun,
  joinWords,
  nextRun,
  nextRuns,
  ordinal,
  parseAny,
  parseCron,
  parseCronField,
  parseSystemd,
  timerUnit,
  toCron,
  toSystemd,
  until,
} from "./lib.ts";

// Local time throughout: June and January, away from daylight saving changes.
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0) => new Date(y, mo - 1, d, h, mi, s);
const runs = (expr: string, from: Date, n = 3) =>
  nextRuns(parseAny(expr), from, n).map((d) => formatRun(d, parseAny(expr).hasSeconds));

Deno.test("cron fields: values, ranges, steps, lists and names", () => {
  const r = { name: "minute", min: 0, max: 59 };
  assertEquals(parseCronField("*/15", r).values, [0, 15, 30, 45]);
  assertEquals(parseCronField("10-20/5", r).values, [10, 15, 20]);
  assertEquals(parseCronField("5/20", r).values, [5, 25, 45]);
  assertEquals(parseCronField("1,2,3-5", r).values, [1, 2, 3, 4, 5]);
  const s = parseCron("0 9 * JAN-MAR MON-FRI");
  assertEquals(s.month.values, [1, 2, 3]);
  assertEquals(s.weekday.values, [1, 2, 3, 4, 5]);
  assertEquals(parseCron("0 0 * * 7").weekday.values, [0]);
  assertEquals(parseCron("0 0 * * FRI-SUN").weekday.values, [0, 5, 6]);
  assertEquals(parseCron("0 0 ? * *").day.star, true);
});

Deno.test("cron shapes: 5, 6 and 7 fields, macros", () => {
  assertEquals(parseCron("*/5 * * * *").hasSeconds, false);
  const six = parseCron("*/10 * * * * *");
  assertEquals([six.hasSeconds, six.second.values.length], [true, 6]);
  assertEquals(parseCron("0 0 12 1 1 * 2027").year?.values, [2027]);
  assertEquals(parseCron("@daily").minute.values, [0]);
  assertEquals(parseCron("@weekly").weekday.values, [0]);
  assertEquals(parseCron("@reboot").reboot, true);
  assertEquals(parseCron("0 0 L * *").lastDays, [0]);
  assertEquals(parseCron("0 0 L-2 * *").lastDays, [2]);
  assertEquals(parseCron("0 10 * * 1#2").nth, [{ weekday: 1, n: 2 }]);
  assertEquals(parseCron("0 18 * * FRIL").lastWeekday, [5]);
});

Deno.test("cron errors say what is wrong", () => {
  assertThrows(() => parseCron("* * *"), Error, "5 fields, this one has 3");
  assertThrows(() => parseCron("61 * * * *"), Error, "Minute 61 is out of range (0–59)");
  assertThrows(() => parseCron("* 24 * * *"), Error, "Hour 24 is out of range");
  assertThrows(() => parseCron("5-2 * * * *"), Error, "goes backwards");
  assertThrows(() => parseCron("*/0 * * * *"), Error, "not a valid step");
  assertThrows(() => parseCron("* * * * MON-FOO"), Error, "“FOO” is not a valid day of week");
  assertThrows(() => parseCron("@sometimes"), Error, "Unknown shorthand");
  assertThrows(() => parseCron("1,,2 * * * *"), Error, "Empty value");
  assertThrows(() => parseAny("* * *"), Error, "5 fields");
});

Deno.test("English explanations", () => {
  const cases: [string, string][] = [
    ["* * * * *", "Every minute"],
    ["*/5 * * * *", "Every 5 minutes"],
    ["0 * * * *", "At minute 0 past every hour"],
    ["0,30 * * * *", "At minutes 0 and 30 past every hour"],
    ["0 */6 * * *", "At minute 0 past every 6th hour"],
    ["23 0-20/2 * * *", "At minute 23 past every 2nd hour from 00:00 through 20:59"],
    ["0 9 * * 1-5", "At 09:00, on weekdays"],
    ["0 0 * * SAT,SUN", "At 00:00, on weekends"],
    ["0 0,12 * * *", "At 00:00 and 12:00"],
    ["*/30 9-17 * * 1-5", "Every 30 minutes between 09:00 and 17:59, on weekdays"],
    ["* 9 * * *", "Every minute between 09:00 and 09:59"],
    ["15 14 1 * *", "At 14:15, on day 1 of the month"],
    ["0 0 1 */3 *", "At 00:00, on day 1 of the month, every 3 months"],
    ["5 0 * 8 *", "At 00:05, in August"],
    ["0 4 8-14 * *", "At 04:00, on days 8 through 14 of the month"],
    ["0 0 1,15 * 5", "At 00:00, on days 1 and 15 of the month, or on Friday"],
    ["0 0 L * *", "At 00:00, on the last day of the month"],
    ["0 10 * * 1#1", "At 10:00, on the first Monday of the month"],
    ["0 18 * * 5L", "At 18:00, on the last Friday of the month"],
    ["0 9 * * 1,3,5", "At 09:00, on Monday, Wednesday and Friday"],
    ["*/10 * * * * *", "Every 10 seconds"],
    ["30 0 9 * * *", "At 09:00:30"],
    ["@weekly", "At 00:00, on Sunday"],
    ["@reboot", "Once, when the system starts"],
  ];
  for (const [expr, english] of cases) assertEquals(explain(parseCron(expr)), english, expr);
});

Deno.test("field lines for the side panel", () => {
  assertEquals(fieldLines(parseCron("0 9 * * 1-5")), [
    ["Minute", "0"],
    ["Hour", "9"],
    ["Day of month", "every"],
    ["Month", "every"],
    ["Day of week", "weekdays"],
  ]);
});

Deno.test("next runs in local time", () => {
  const wed = at(2026, 6, 10, 10, 0); // Wednesday 10 June 2026, 10:00
  assertEquals(runs("*/5 * * * *", wed), [
    "Wed 10 Jun 2026, 10:05",
    "Wed 10 Jun 2026, 10:10",
    "Wed 10 Jun 2026, 10:15",
  ]);
  assertEquals(runs("0 9 * * 1-5", wed), [
    "Thu 11 Jun 2026, 09:00",
    "Fri 12 Jun 2026, 09:00",
    "Mon 15 Jun 2026, 09:00",
  ]);
  assertEquals(runs("0 0 L * *", wed), ["Tue 30 Jun 2026, 00:00", "Fri 31 Jul 2026, 00:00", "Mon 31 Aug 2026, 00:00"]);
  assertEquals(runs("0 0 L-1 2 *", wed, 2), ["Sat 27 Feb 2027, 00:00", "Mon 28 Feb 2028, 00:00"]);
  assertEquals(runs("0 10 * * 1#1", wed), ["Mon 6 Jul 2026, 10:00", "Mon 3 Aug 2026, 10:00", "Mon 7 Sep 2026, 10:00"]);
  assertEquals(runs("0 18 * * 5L", wed), [
    "Fri 26 Jun 2026, 18:00",
    "Fri 31 Jul 2026, 18:00",
    "Fri 28 Aug 2026, 18:00",
  ]);
  // Day of month OR day of week, as cron does.
  assertEquals(runs("0 0 1,15 * 5", wed), [
    "Fri 12 Jun 2026, 00:00",
    "Mon 15 Jun 2026, 00:00",
    "Fri 19 Jun 2026, 00:00",
  ]);
  assertEquals(runs("*/20 * * * * *", at(2026, 6, 10, 10, 0, 30)), [
    "Wed 10 Jun 2026, 10:00:40",
    "Wed 10 Jun 2026, 10:01",
    "Wed 10 Jun 2026, 10:01:20",
  ]);
  // Leap years.
  assertEquals(runs("0 0 29 2 *", wed, 2), ["Tue 29 Feb 2028, 00:00", "Sun 29 Feb 2032, 00:00"]);
  // Strictly after: a run at the start time itself is not the next one.
  assertEquals(formatRun(nextRun(parseCron("0 10 * * *"), at(2026, 6, 10, 10, 0))!), "Thu 11 Jun 2026, 10:00");
  assertEquals(nextRun(parseCron("@reboot"), wed), undefined);
  assertEquals(nextRuns(parseCron("0 0 0 1 1 * 2020"), wed), []);
  assertEquals(nextRuns(parseCron("0 0 31 2 *"), wed), []);
});

Deno.test("day matching follows cron and systemd rules", () => {
  const fri12 = at(2026, 6, 12), mon15 = at(2026, 6, 15);
  const cron = parseCron("0 0 15 * 5");
  assertEquals([dayMatches(cron, fri12), dayMatches(cron, mon15)], [true, true]);
  const systemd = parseSystemd("Fri *-*-15 00:00");
  assertEquals([dayMatches(systemd, fri12), dayMatches(systemd, mon15)], [false, false]);
  assertEquals(dayMatches(systemd, at(2026, 5, 15)), true); // Friday 15 May 2026
});

Deno.test("systemd calendar events", () => {
  const s = parseSystemd("Mon..Fri *-*-* 09:00:00");
  assertEquals([s.weekday.values, s.hour.values, s.minute.values, s.second.values], [[1, 2, 3, 4, 5], [9], [0], [0]]);
  assertEquals(parseSystemd("Sat,Sun 10:30").weekday.values, [0, 6]);
  assertEquals(parseSystemd("Sat..Mon 10:30").weekday.values, [0, 1, 6]);
  assertEquals(parseSystemd("*:0/15").minute.values, [0, 15, 30, 45]);
  assertEquals(parseSystemd("*-*~01").lastDays, [0]);
  assertEquals(parseSystemd("Fri *-*~07/1 18:00").lastDays, [0, 1, 2, 3, 4, 5, 6]);
  assertEquals(parseSystemd("*-02~03..01").lastDays, [0, 1, 2]);
  assertEquals(parseSystemd("10-28 12:00").month.values, [10]);
  assertEquals(parseSystemd("2027-01-01").year?.values, [2027]);
  assertEquals(parseSystemd("*-*-* 12:00:00.5").second.values, [0]);
  assertEquals(parseSystemd("Sat *-*-* 10:30 Europe/Paris").timezone, "Europe/Paris");
  assertEquals(parseSystemd("weekly").macro, "weekly");
  assertEquals(parseSystemd("quarterly").month.values, [1, 4, 7, 10]);
  assertThrows(() => parseSystemd("Funday 10:00"), Error, "not a day of the week");
  assertThrows(() => parseSystemd("12:00 *-*-01"), Error, "the date comes before the time");
  assertThrows(() => parseSystemd("*-13-01"), Error, "Month 13 is out of range");
  assertEquals(explain(parseSystemd("Fri *-*~07/1 18:00")), "At 18:00, on the last Friday of the month");
  assertEquals(explain(parseSystemd("Mon *-*-01..07 10:00")), "At 10:00, on the first Monday of the month");
  assertEquals(explain(parseSystemd("Fri *-*-13")), "At 00:00, on day 13 of the month, if it is a Friday");
  assertEquals(runs("Mon..Fri 09:00", at(2026, 1, 9, 12)), [
    "Mon 12 Jan 2026, 09:00",
    "Tue 13 Jan 2026, 09:00",
    "Wed 14 Jan 2026, 09:00",
  ]);
  assertEquals(runs("Fri *-*-13", at(2026, 1, 1), 2), ["Fri 13 Feb 2026, 00:00", "Fri 13 Mar 2026, 00:00"]);
});

Deno.test("parseAny tells cron and systemd apart", () => {
  assertEquals(parseAny("*/5 * * * *").kind, "cron");
  assertEquals(parseAny("0 9 * * MON-FRI").kind, "cron");
  assertEquals(parseAny("@daily").kind, "cron");
  assertEquals(parseAny("daily").kind, "systemd");
  assertEquals(parseAny("Mon..Fri 09:00").kind, "systemd");
  assertEquals(parseAny("*-*-01 00:00").kind, "systemd");
  assertEquals(parseAny("12:30").kind, "systemd");
});

Deno.test("cron → systemd OnCalendar", () => {
  const cases: [string, string[]][] = [
    ["*/5 * * * *", ["*-*-* *:00/5:00"]],
    ["0 * * * *", ["hourly"]],
    ["0 0 * * *", ["daily"]],
    ["0 9 * * 1-5", ["Mon..Fri *-*-* 09:00:00"]],
    ["0 9 * * 1,3,5", ["Mon,Wed,Fri *-*-* 09:00:00"]],
    ["0 0 * * SAT,SUN", ["Sat,Sun *-*-* 00:00:00"]],
    ["*/30 9-17 * * 1-5", ["Mon..Fri *-*-* 09..17:00/30:00"]],
    ["0 0 1 */3 *", ["*-01/3-01 00:00:00"]],
    ["0 4 8-14 * *", ["*-*-08..14 04:00:00"]],
    ["0 0 L * *", ["*-*~01 00:00:00"]],
    ["0 0 L-2 * *", ["*-*~03 00:00:00"]],
    ["0 10 * * 1#1", ["Mon *-*-01..07 10:00:00"]],
    ["0 18 * * 5L", ["Fri *-*~07/1 18:00:00"]],
    ["0 0 1,15 * 5", ["*-*-01,15 00:00:00", "Fri *-*-* 00:00:00"]],
    ["@weekly", ["Sun *-*-* 00:00:00"]],
    ["*/10 * * * * *", ["*-*-* *:*:00/10"]],
    ["0 0 12 1 1 * 2027", ["2027-01-01 12:00:00"]],
  ];
  for (const [expr, lines] of cases) assertEquals(toSystemd(parseCron(expr)), lines, expr);
  assertThrows(() => toSystemd(parseCron("@reboot")), Error, "OnBootSec=");
});

Deno.test("systemd → cron", () => {
  const cases: [string, string][] = [
    ["Mon..Fri 09:00", "0 9 * * 1-5"],
    ["daily", "0 0 * * *"],
    ["weekly", "0 0 * * 1"],
    ["monthly", "0 0 1 * *"],
    ["quarterly", "0 0 1 1,4,7,10 *"],
    ["*:0/15", "*/15 * * * *"],
    ["*-*-* 08..18/2:30", "30 8-18/2 * * *"],
    ["Sat,Sun 10:30", "30 10 * * 0,6"],
    ["*-*~01 12:00", "0 12 L * *"],
    ["Fri *-*~07/1 18:00", "0 18 * * 5L"],
    ["Mon *-*-08..14 10:00", "0 10 * * 1#2"],
    ["*-*-* *:*:00/10", "*/10 * * * * *"],
    ["*-*-* 12:00:30", "30 0 12 * * *"],
  ];
  for (const [expr, cron] of cases) assertEquals(toCron(parseSystemd(expr)), cron, expr);
  assertThrows(() => toCron(parseSystemd("2027-01-01")), Error, "no year field");
  assertThrows(() => toCron(parseSystemd("Fri *-*-13")), Error, "OR");
  // Round trips agree on the runs.
  for (const expr of ["Mon..Fri 09:00", "*-*~01 12:00", "Fri *-*~07/1 18:00", "*:0/15"]) {
    const from = at(2026, 6, 10, 10);
    assertEquals(runs(toCron(parseSystemd(expr)), from, 5), runs(expr, from, 5), expr);
  }
});

Deno.test("words, dates and the timer unit", () => {
  assertEquals([joinWords(["a"]), joinWords(["a", "b"]), joinWords(["a", "b", "c"], "or")], [
    "a",
    "a and b",
    "a, b or c",
  ]);
  assertEquals([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), [
    "1st",
    "2nd",
    "3rd",
    "4th",
    "11th",
    "12th",
    "13th",
    "21st",
    "22nd",
  ]);
  const now = at(2026, 6, 10, 10);
  assertEquals(
    [until(at(2026, 6, 10, 10, 5), now), until(at(2026, 6, 10, 13), now), until(at(2026, 6, 15, 10), now)],
    ["in 5 min", "in 3 h", "in 5 days"],
  );
  assertEquals(formatRun(at(2026, 10, 28, 9, 5, 30), true), "Wed 28 Oct 2026, 09:05:30");
  assertEquals(
    timerUnit(["Mon..Fri *-*-* 09:00:00"], "At 09:00, on weekdays"),
    "[Unit]\nDescription=At 09:00, on weekdays\n\n[Timer]\nOnCalendar=Mon..Fri *-*-* 09:00:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target",
  );
});
