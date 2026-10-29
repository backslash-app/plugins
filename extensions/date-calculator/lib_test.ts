import { assert, assertEquals } from "@std/assert";
import {
  addMonths,
  addWorkdays,
  answer,
  calendarDiff,
  countWorkdays,
  easter,
  type Env,
  EXAMPLES,
  fromYmd,
  holidays,
  holidaySet,
  iso,
  isoWeek,
  isoWeeksInYear,
  isoWeekStart,
  long,
  parseDate,
  parsePeriod,
  parseQuery,
  parseSteps,
  type Query,
  weekday,
  weeksAndDays,
  ymdText,
} from "./lib.ts";

// Thursday 29 October 2026.
const env: Env = { today: fromYmd(2026, 10, 29), holidays: "france", order: "dmy" };
const day = (s: string) => fromYmd(+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10));
const q = (text: string, e = env) => parseQuery(text, e) as Query;

Deno.test("days, weekdays and ISO weeks", () => {
  assertEquals(iso(fromYmd(1970, 1, 1)), "1970-01-01");
  assertEquals(weekday(day("2026-10-29")), 3); // Thursday
  assertEquals(weekday(day("2027-07-14")), 2); // Wednesday
  assertEquals(isoWeek(day("2026-10-29")), { year: 2026, week: 44 });
  assertEquals(isoWeek(day("2021-01-03")), { year: 2020, week: 53 });
  assertEquals(isoWeek(day("2024-12-30")), { year: 2025, week: 1 });
  assertEquals(iso(isoWeekStart(2026, 42)), "2026-10-12");
  assertEquals(isoWeeksInYear(2026), 53);
  assertEquals(isoWeeksInYear(2027), 52);
  assertEquals(long(day("2026-12-25")), "Friday 25 December 2026");
});

Deno.test("months are added the calendar way", () => {
  assertEquals(iso(addMonths(day("2026-01-31"), 1)), "2026-02-28");
  assertEquals(iso(addMonths(day("2028-01-31"), 1)), "2028-02-29");
  assertEquals(iso(addMonths(day("2026-03-15"), -3)), "2025-12-15");
  assertEquals(calendarDiff(day("2026-01-31"), day("2026-03-01")), { years: 0, months: 1, days: 1 });
  assertEquals(ymdText(calendarDiff(day("2024-02-29"), day("2026-10-29"))), "2 years 8 months");
  assertEquals(weeksAndDays(57), "8 weeks 1 day");
});

Deno.test("Easter and the French public holidays", () => {
  assertEquals(iso(easter(2024)), "2024-03-31");
  assertEquals(iso(easter(2025)), "2025-04-20");
  assertEquals(iso(easter(2026)), "2026-04-05");
  assertEquals(iso(easter(2027)), "2027-03-28");
  assertEquals(iso(easter(2038)), "2038-04-25");
  const h2026 = holidays(2026, "france");
  assertEquals(h2026.length, 11);
  assertEquals(h2026.find((h) => h.name === "Ascension Day")?.day, day("2026-05-14"));
  assertEquals(h2026.find((h) => h.name === "Whit Monday")?.day, day("2026-05-25"));
  assertEquals(holidays(2026, "alsace").length, 13);
  assertEquals(holidays(2026, "none"), []);
  assertEquals(holidaySet("Alsace-Moselle"), "alsace");
  assertEquals(holidaySet("none"), "none");
  assertEquals(holidaySet(undefined), "france");
});

Deno.test("working days skip weekends and holidays", () => {
  // May 2026: 21 weekdays, minus 1 May (Fri), 8 May (Fri), 14 May (Ascension), 25 May (Whit Monday).
  assertEquals(countWorkdays(day("2026-05-01"), day("2026-05-31"), "none"), 21);
  assertEquals(countWorkdays(day("2026-05-01"), day("2026-05-31"), "france"), 17);
  // Mon–Sat: 26 days minus the 4 holidays.
  assertEquals(countWorkdays(day("2026-05-01"), day("2026-05-31"), "france", "ouvrable"), 22);
  // Friday 24 December 2026 + 1 working day: Christmas is off, then the weekend.
  assertEquals(iso(addWorkdays(day("2026-12-24"), 1, "france")), "2026-12-28");
  assertEquals(iso(addWorkdays(day("2026-12-28"), -1, "france")), "2026-12-24");
  assertEquals(countWorkdays(day("2026-01-01"), day("2026-12-31"), "france"), 252);
});

Deno.test("dates in many spellings", () => {
  const p = (s: string, future = false) => {
    const n = parseDate(s, env, future);
    return n === undefined ? undefined : iso(n);
  };
  assertEquals(p("2026-12-25"), "2026-12-25");
  assertEquals(p("25/12/2026"), "2026-12-25");
  assertEquals(p("12/25/2026"), "2026-12-25"); // 25 can only be the day
  assertEquals(iso(parseDate("03/04/2027", { ...env, order: "mdy" })!), "2027-03-04");
  assertEquals(p("03/04/2027"), "2027-04-03");
  assertEquals(p("14.07.27"), "2027-07-14");
  assertEquals(p("1 jan"), "2026-01-01");
  assertEquals(p("1 jan", true), "2027-01-01");
  assertEquals(p("1er janvier 2027"), "2027-01-01");
  assertEquals(p("14 juillet"), "2026-07-14");
  assertEquals(p("December 25, 2026"), "2026-12-25");
  assertEquals(p("dec. 25"), "2026-12-25");
  assertEquals(p("le 15 août"), "2026-08-15");
  assertEquals(p("today"), "2026-10-29");
  assertEquals(p("demain"), "2026-10-30");
  assertEquals(p("après-demain"), "2026-10-31");
  assertEquals(p("hier"), "2026-10-28");
  assertEquals(p("friday"), "2026-10-30");
  assertEquals(p("thursday"), "2026-10-29");
  assertEquals(p("next thursday"), "2026-11-05");
  assertEquals(p("vendredi prochain"), "2026-10-30");
  assertEquals(p("last monday"), "2026-10-26");
  assertEquals(p("christmas"), "2026-12-25");
  assertEquals(p("noël"), "2026-12-25");
  assertEquals(p("pâques 2027"), "2027-03-28");
  assertEquals(p("easter", true), "2027-03-28");
  assertEquals(p("labour day"), "2026-05-01");
  assertEquals(p("hello"), undefined);
  assertEquals(q("31 february 2027"), { kind: "error", message: "31 February 2027 isn't a date" });
});

Deno.test("steps", () => {
  assertEquals(parseSteps("+ 45 days"), [{ sign: 1, amount: 45, unit: "day" }]);
  assertEquals(parseSteps("2 weeks and 3 days"), [
    { sign: 1, amount: 2, unit: "week" },
    { sign: 1, amount: 3, unit: "day" },
  ]);
  assertEquals(parseSteps("1 mois et 2 jours ouvrés"), [
    { sign: 1, amount: 1, unit: "month" },
    { sign: 1, amount: 2, unit: "business" },
  ]);
  assertEquals(parseSteps("+1y -2d"), [{ sign: 1, amount: 1, unit: "year" }, { sign: -1, amount: 2, unit: "day" }]);
  assertEquals(parseSteps("3 jours ouvrables"), [{ sign: 1, amount: 3, unit: "ouvrable" }]);
  assertEquals(parseSteps("three days"), undefined);
});

Deno.test("queries", () => {
  const until = q("days until 2026-12-25");
  assertEquals(until.kind === "diff" && until.to - until.from, 57);
  assertEquals(q("how many days until christmas").kind, "diff");
  assertEquals(q("combien de jours avant noël").kind, "diff");
  const add = q("2026-03-01 + 45 days");
  assertEquals(add.kind === "add" && iso(add.result), "2026-04-15");
  const between = q("between 1 jan and 14 jul");
  assertEquals(between.kind === "diff" && [iso(between.from), iso(between.to)], ["2026-01-01", "2026-07-14"]);
  const du = q("jours ouvrés du 1 mai au 31 mai");
  assertEquals(du.kind === "diff" && du.focus, "business");
  const period = q("working days in may");
  assertEquals(period.kind === "period" && period.period.label, "May 2026");
  const fr = q("jours ouvrés en juin 2027");
  assertEquals(fr.kind === "period" && fr.period.label, "June 2027");
  assertEquals(q("week 42"), { kind: "week", year: 2026, week: 42 });
  assertEquals(q("semaine 3 2027"), { kind: "week", year: 2027, week: 3 });
  assertEquals(q("2026-W05"), { kind: "week", year: 2026, week: 5 });
  assertEquals(q("week 54").kind, "error");
  const what = q("what day is 14/07/2027");
  assertEquals(what.kind === "date" && [iso(what.day), what.asked], ["2027-07-14", "weekday"]);
  const quel = q("quel jour tombe le 25 décembre 2030");
  assertEquals(quel.kind === "date" && iso(quel.day), "2030-12-25");
  const dans = q("dans 3 semaines");
  assertEquals(dans.kind === "add" && iso(dans.result), "2026-11-19");
  const ago = q("45 days ago");
  assertEquals(ago.kind === "add" && iso(ago.result), "2026-09-14");
  const ilya = q("il y a 2 mois");
  assertEquals(ilya.kind === "add" && iso(ilya.result), "2026-08-29");
  const after = q("10 working days after 2026-12-20");
  assertEquals(after.kind === "add" && iso(after.result), "2027-01-05");
  const work = q("in 3 working days");
  assertEquals(work.kind === "add" && iso(work.result), "2026-11-03"); // Fri 30, (Sun 1 Nov holiday), Mon 2, Tue 3
  assertEquals(q("week number"), { kind: "weekOf", day: env.today });
  assertEquals(q("quelle semaine sommes-nous"), { kind: "weekOf", day: env.today });
  const weekOf = q("week of 14 july");
  assertEquals(weekOf.kind === "weekOf" && iso(weekOf.day), "2026-07-14");
  assertEquals(q("holidays 2027"), { kind: "holidays", year: 2027 });
  assertEquals(q("jours fériés"), { kind: "holidays", year: 2026 });
  assertEquals(q("2027").kind, "period");
  const plain = q("1 jan 2027 to 1 feb 2027");
  assertEquals(plain.kind === "diff" && plain.to - plain.from, 31);
  assertEquals(q("since 1 jan").kind, "diff");
  assertEquals(q("today + 1 month").kind, "add");
  assertEquals(q("blah blah").kind, "error");
  const bare = q("jours ouvrables");
  assertEquals(bare.kind === "period" && [bare.period.label, bare.focus], ["October 2026", "ouvrable"]);
  assertEquals(parseQuery("  ", env), { kind: "empty" });
  assertEquals(parsePeriod("q3 2027", env)?.label, "Q3 2027");
  assertEquals(parsePeriod("next month", env)?.label, "November 2026");
});

Deno.test("answers", () => {
  const until = answer(q("days until 2026-12-25"), env);
  assertEquals(until.rows[0].title, "57 days");
  // From Fri 30 Oct to Fri 25 Dec: 41 weekdays minus 11 Nov (Wed) and 25 Dec (Fri).
  assertEquals(until.rows.find((r) => r.id === "business")?.copy, "39");
  const may = answer(q("working days in may"), env);
  assertEquals(may.rows[0].title, "17 working days");
  assert(may.rows.some((r) => r.title === "Ascension Day"));
  const week = answer(q("week 42"), env);
  assertEquals(week.rows[0].copy, "2026-10-12 – 2026-10-18");
  const focus = answer(q("working days between 1 may and 31 may"), env);
  assertEquals(focus.rows[0].id, "business");
  const weekday = answer(q("what day is 14/07/2027"), env);
  assertEquals(weekday.rows[0].title, "Wednesday");
  assertEquals(answer(q("holidays 2026"), env).rows.length, 11);
  for (const e of EXAMPLES) assert(q(e.query).kind !== "error", e.query);
});
