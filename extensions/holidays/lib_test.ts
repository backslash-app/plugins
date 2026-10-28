import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { HOSTS } from "./api.ts";
import {
  addDays,
  appliesTo,
  bridges,
  countdown,
  countdownTag,
  daysBetween,
  type Holiday,
  holidaysFor,
  holidayTitle,
  normalizeCountry,
  normalizeRegion,
  normalizeZone,
  periodLength,
  periodRange,
  periodState,
  ratio,
  schoolDay,
  schoolName,
  schoolPeriods,
  schoolQuery,
  type SchoolRecord,
  shortDay,
  takeLabel,
  today,
  weekday,
  weekendNote,
} from "./lib.ts";

const h = (date: string, name: string, localName = name, extra: Partial<Holiday> = {}): Holiday => ({
  date,
  localName,
  name,
  countryCode: "FR",
  global: true,
  counties: null,
  launchYear: null,
  types: ["Public"],
  ...extra,
});

// Shaped like `GET https://date.nager.at/api/v3/PublicHolidays/2026/FR`.
const FR_2026: Holiday[] = [
  h("2026-01-01", "New Year's Day", "Jour de l'an"),
  h("2026-04-06", "Easter Monday", "Lundi de Pâques"),
  h("2026-05-01", "Labour Day", "Fête du Travail"),
  h("2026-05-08", "Victory in Europe Day", "Victoire 1945"),
  h("2026-05-14", "Ascension Day", "Ascension"),
  h("2026-05-25", "Whit Monday", "Lundi de Pentecôte"),
  h("2026-07-14", "Bastille Day", "Fête nationale"),
  h("2026-08-15", "Assumption Day", "Assomption"),
  h("2026-11-01", "All Saints' Day", "Toussaint"),
  h("2026-11-11", "Armistice Day", "Armistice 1918"),
  h("2026-12-25", "Christmas Day", "Noël"),
];
const FR_2027_START = [h("2027-01-01", "New Year's Day", "Jour de l'an")];

Deno.test("dates", () => {
  assertEquals(today(new Date(2026, 9, 28, 23, 30)), "2026-10-28");
  assertEquals(addDays("2026-02-28", 1), "2026-03-01");
  assertEquals(addDays("2026-03-29", 1), "2026-03-30"); // DST in Europe does not matter
  assertEquals(daysBetween("2026-10-28", "2026-12-25"), 58);
  assertEquals(weekday("2026-07-14"), 2);
  assertEquals(shortDay("2026-05-14"), "Thu 14 May");
  assertEquals(countdown("2026-10-28", "2026-10-28"), "Today");
  assertEquals(countdown("2026-10-28", "2026-10-29"), "Tomorrow");
  assertEquals(countdown("2026-10-28", "2026-11-11"), "In 14 days");
  assertEquals(countdown("2026-10-28", "2026-10-25"), "3 days ago");
  assertEquals(countdownTag("2026-10-28", "2026-11-11"), "14 d");
  assertEquals(countdownTag("2026-01-01", "2026-12-25"), "51 wk");
});

Deno.test("country and region preferences", () => {
  assertEquals(normalizeCountry(" de "), "DE");
  assertEquals(normalizeCountry("France"), "FR");
  assertEquals(normalizeCountry("", "BE"), "BE");
  assertEquals(normalizeRegion("by", "DE"), "DE-BY");
  assertEquals(normalizeRegion("gb-sct", "GB"), "GB-SCT");
  assertEquals(normalizeRegion("", "DE"), undefined);
  assertEquals(normalizeRegion("Bavaria", "DE"), undefined);
});

Deno.test("regional holidays and duplicates", () => {
  const de = [
    h("2026-01-06", "Epiphany", "Heilige Drei Könige", { global: false, counties: ["DE-BW", "DE-BY", "DE-ST"] }),
    h("2026-10-03", "German Unity Day", "Tag der Deutschen Einheit"),
    h("2026-10-31", "Reformation Day", "Reformationstag", { global: false, counties: ["DE-BB", "DE-SN"] }),
    h("2026-10-31", "Reformation Day", "Reformationstag", { global: false, counties: ["DE-HB", "DE-HH"] }),
  ];
  assert(appliesTo(de[0], "DE-BY"));
  assert(!appliesTo(de[0], "DE-BE"));
  assert(!appliesTo(de[0]));
  assertEquals(holidaysFor(de, "DE-BY").map((x) => x.name), ["Epiphany", "German Unity Day"]);
  assertEquals(holidaysFor(de, "DE-HH").map((x) => x.name), ["German Unity Day", "Reformation Day"]);
  assertEquals(holidaysFor(de).map((x) => x.name), ["German Unity Day"]);
  assertEquals(holidayTitle(FR_2026[4]), "Ascension Day · Ascension");
  assertEquals(holidayTitle(h("2026-12-25", "Christmas Day")), "Christmas Day");
  assertEquals(weekendNote(FR_2026[7]), "Falls on a Saturday");
  assertEquals(weekendNote(FR_2026[8]), "Falls on a Sunday");
  assertEquals(weekendNote(FR_2026[6]), undefined);
});

Deno.test("bridge days of France in 2026", () => {
  const found = bridges([...FR_2026, ...FR_2027_START], "2026-01-01", "2026-12-31");
  const summary = found.map((b) => [takeLabel(b), b.total, b.kind]);
  assertEquals(summary, [
    ["Fri 2 Jan", 4, "Bridge"], // New Year's Day on a Thursday
    ["Mon 4 May – Thu 7 May", 10, "Long bridge"], // between Labour Day and VE Day, both Fridays
    ["Fri 15 May", 4, "Bridge"], // Ascension
    ["Mon 13 Jul", 4, "Bridge"], // Bastille Day on a Tuesday
    ["Mon 9 Nov – Tue 10 Nov", 5, "Viaduct"], // Armistice on a Wednesday
    ["Thu 12 Nov – Fri 13 Nov", 5, "Viaduct"],
    ["Mon 28 Dec – Thu 31 Dec", 10, "Long bridge"], // Christmas to New Year, both Fridays
  ]);
  assertEquals(found[0].holidays.map((x) => x.name), ["New Year's Day"]);
  assertEquals(found[0].start, "2026-01-01");
  assertEquals(found[0].end, "2026-01-04");
  assertEquals(ratio(found[3]), 4);
  assertEquals(found.at(-1)!.holidays.map((x) => x.name), ["Christmas Day", "New Year's Day"]);
});

Deno.test("bridge days: limits and observances", () => {
  const strict = bridges(FR_2026, "2026-01-01", "2026-12-31", { maxTake: 1 });
  assertEquals(strict.map((b) => b.take[0]), ["2026-01-02", "2026-05-15", "2026-07-13"]);
  // A Tuesday that is only a bank holiday gives no bridge.
  const bank = bridges([h("2026-07-14", "Bank Day", "Bank Day", { types: ["Bank"] })], "2026-07-01", "2026-07-31");
  assertEquals(bank, []);
  // Bridges before the range are left out.
  assertEquals(bridges(FR_2026, "2026-07-14", "2026-07-31"), []);
});

// Shaped like `exports/json` of the fr-en-calendrier-scolaire dataset.
const RECORDS: SchoolRecord[] = [
  {
    description: "Vacances de la Toussaint",
    population: "-",
    start_date: "2026-10-16T22:00:00+00:00",
    end_date: "2026-11-01T23:00:00+00:00",
    location: "Paris",
    zones: "Zone C",
    annee_scolaire: "2026-2027",
  },
  {
    description: "Vacances de la Toussaint",
    population: "-",
    start_date: "2026-10-16T22:00:00+00:00",
    end_date: "2026-11-01T23:00:00+00:00",
    location: "Créteil",
    zones: "Zone C",
    annee_scolaire: "2026-2027",
  },
  {
    description: "Vacances de Noël",
    population: "Élèves",
    start_date: "2026-12-18T23:00:00+00:00",
    end_date: "2027-01-03T23:00:00+00:00",
    location: "Versailles",
    zones: "Zone C",
    annee_scolaire: "2026-2027",
  },
  {
    description: "Vacances de Noël",
    population: "Enseignants",
    start_date: "2026-12-18T23:00:00+00:00",
    end_date: "2027-01-02T23:00:00+00:00",
    location: "Versailles",
    zones: "Zone C",
    annee_scolaire: "2026-2027",
  },
  {
    description: "Vacances d'Été",
    population: "-",
    start_date: "2027-07-02T22:00:00+00:00",
    end_date: null,
    location: "Paris",
    zones: "Zone C",
    annee_scolaire: "2026-2027",
  },
];

Deno.test("school calendar dates", () => {
  assertEquals(schoolDay("2026-10-16T22:00:00+00:00"), "2026-10-17"); // Paris, summer time
  assertEquals(schoolDay("2026-12-18T23:00:00+00:00"), "2026-12-19"); // Paris, winter time
  assertEquals(schoolDay("2026-10-16T20:00:00+00:00"), "2026-10-17"); // La Réunion, UTC+4
  assertEquals(schoolDay("2026-10-17T04:00:00+00:00"), "2026-10-17"); // Guadeloupe, UTC-4
  assertEquals(schoolDay("2026-10-16T13:00:00+00:00"), "2026-10-17"); // New Caledonia, UTC+11
  assertEquals(normalizeZone("b"), "Zone B");
  assertEquals(normalizeZone("Zone c"), "Zone C");
  assertEquals(normalizeZone("corsica"), "Corse");
  assertEquals(normalizeZone("Reunion"), "La Réunion");
  assertEquals(normalizeZone("Guadeloupe"), "Guadeloupe");
  assertEquals(normalizeZone(""), "Zone C");
  assertEquals(schoolName("Vacances d'Hiver"), "Winter holidays");
  assertEquals(schoolName("Pont de l'Ascension"), "Ascension bridge");
  assertEquals(schoolName("Vacances de la Toussaint"), "All Saints' holidays");
  assertEquals(
    schoolQuery("Zone C", "2026-07-01", "2027-12-31"),
    `zones="Zone C" and start_date>=date'2026-07-01' and start_date<=date'2027-12-31'`,
  );
  assertEquals(schoolQuery('Zone "C"', "2026-07-01", "2027-12-31").startsWith('zones="Zone C"'), true);
});

Deno.test("school periods are merged per zone, pupils only", () => {
  const periods = schoolPeriods(RECORDS);
  assertEquals(periods.length, 3);
  const [toussaint, noel, ete] = periods;
  assertEquals(toussaint.start, "2026-10-17");
  assertEquals(toussaint.end, "2026-11-02");
  assertEquals(toussaint.locations, ["Créteil", "Paris"]);
  assertEquals(periodLength(toussaint), 16);
  assertEquals(periodRange(toussaint), "Sat 17 Oct → Mon 2 Nov");
  assertEquals(noel.end, "2027-01-04");
  assertEquals(noel.name, "Christmas holidays");
  assertEquals(ete.end, undefined);
  assertEquals(periodRange(ete), "from Sat 3 Jul");
  assertEquals(periodState(toussaint, "2026-10-28"), "now");
  assertEquals(periodState(toussaint, "2026-11-02"), "past");
  assertEquals(periodState(noel, "2026-10-28"), "upcoming");
  assertEquals(periodState(ete, "2027-08-15"), "now");
  assertEquals(periodState(ete, "2027-10-01"), "past");
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, HOSTS);
  for (const c of manifest.commands) {
    await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  }
});
