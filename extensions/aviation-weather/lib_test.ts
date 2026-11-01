import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  ceiling,
  compass,
  conditionsSummary,
  dayTime,
  decodeRemarks,
  describeWeather,
  flightCategory,
  groupsTable,
  humidity,
  isTaf,
  looksLikeReport,
  metarInWords,
  metarSummary,
  parseCodes,
  parseMetar,
  parseTaf,
  periodTitle,
  relative,
  stationName,
  visibilityText,
  windText,
  zulu,
} from "./lib.ts";

const REF = new Date("2026-11-01T17:30:00Z");
const meaning = (groups: { raw: string; meaning: string }[], raw: string) => groups.find((g) => g.raw === raw)?.meaning;

Deno.test("times: the day of the month lands next to the reference", () => {
  assertEquals(dayTime(1, 16, 51, REF)?.toISOString(), "2026-11-01T16:51:00.000Z");
  // The 31st seen on November 1st is October 31st.
  assertEquals(dayTime(31, 23, 0, REF)?.toISOString(), "2026-10-31T23:00:00.000Z");
  // Hour 24 is midnight of the next day.
  assertEquals(dayTime(2, 24, 0, REF)?.toISOString(), "2026-11-03T00:00:00.000Z");
  // No 31st in November: the closest is October 31st.
  assertEquals(dayTime(31, 12, 0, new Date("2026-11-20T00:00:00Z"))?.toISOString(), "2026-10-31T12:00:00.000Z");
  assertEquals(dayTime(32, 0, 0, REF), undefined);
  assertEquals(zulu(new Date("2026-11-01T17:00:00Z")), "Sun 1, 17:00Z");
  assertEquals(relative(new Date("2026-11-01T17:18:00Z"), REF), "12 min ago");
  assertEquals(relative(new Date("2026-11-01T20:30:00Z"), REF), "in 3 h");
});

Deno.test("METAR: US report with statute miles, altimeter and remarks", () => {
  const m = parseMetar("METAR KJFK 011651Z 23003KT 10SM FEW200 BKN250 13/02 A3055 RMK SLP343 T01330017 $", REF);
  assertEquals(m.station, "KJFK");
  assertEquals(m.time?.toISOString(), "2026-11-01T16:51:00.000Z");
  assertEquals(m.wind?.direction, 230);
  assertEquals(m.wind?.speed, 3);
  assertEquals(windText(m.wind!), "From 230° (southwest) at 3 kt (6 km/h)");
  assertEquals(m.visibility?.statute, true);
  assertEquals(visibilityText(m.visibility!), "10 SM (16 km)");
  assertEquals(m.clouds.map((c) => [c.cover, c.base]), [["FEW", 20000], ["BKN", 25000]]);
  assertEquals(ceiling(m), 25000);
  assertEquals(m.temperature, 13);
  assertEquals(m.dewpoint, 2);
  assertEquals(m.pressure?.unit, "inHg");
  assertEquals(m.pressure?.inhg, 30.55);
  assertEquals(Math.round(m.pressure!.hpa), 1035);
  assertEquals(flightCategory(m), "VFR");
  assertEquals(m.undecoded, []);
  assertEquals(m.remarks, "SLP343 T01330017 $");
  assertEquals(meaning(m.remarkGroups, "SLP343"), "Sea-level pressure 1034.3 hPa");
  assertEquals(meaning(m.remarkGroups, "T01330017"), "Temperature 13.3 °C, dew point 1.7 °C");
  assertEquals(meaning(m.remarkGroups, "$"), "The station needs maintenance");
  assertEquals(metarSummary(m), "13 °C · 230° 3 kt · 10 SM · FEW 20,000 ft · BKN 25,000 ft · A30.55");
});

Deno.test("METAR: CAVOK, variable direction, QNH and NOSIG", () => {
  const m = parseMetar("METAR LFPG 011700Z 03006KT 360V120 CAVOK 10/05 Q1030 NOSIG", REF);
  assertEquals(m.wind?.from, 360);
  assertEquals(m.wind?.to, 120);
  assertStringIncludes(windText(m.wind!), "varying between 360° and 120°");
  assert(m.cavok);
  assertEquals(m.pressure, { hpa: 1030, inhg: 1030 / 33.8639, unit: "hPa" });
  assertEquals(meaning(m.groups, "Q1030"), "Altimeter setting (QNH) 1030 hPa (30.42 inHg)");
  assertEquals(m.trends.length, 1);
  assertEquals(m.trends[0].kind, "NOSIG");
  assertEquals(flightCategory(m), "VFR");
  assertEquals(humidity(10, 5), 71);
  assertEquals(m.undecoded, []);
});

Deno.test("METAR: automatic station, missing groups and 9999", () => {
  const m = parseMetar("METAR YSSY 011700Z AUTO 07003KT 9999 // SCT047 19/15 Q1016", REF);
  assert(m.auto);
  assertEquals(m.visibility?.meters, 10000);
  assertEquals(visibilityText(m.visibility!), "10 km or more");
  assertEquals(meaning(m.groups, "//"), "Present weather not reported");
  assertEquals(m.clouds[0], { cover: "SCT", base: 4700, type: undefined });
  assertEquals(m.undecoded, []);
});

Deno.test("METAR: low IFR in fog with RVR, vertical visibility and minus temperatures", () => {
  const m = parseMetar(
    "SPECI EGLL 020620Z 00000KT 0150 R27L/0350V0600U R09R/P1500N FG VV001 M01/M01 Q1029 BECMG 0400 BR",
    REF,
  );
  assertEquals(m.type, "SPECI");
  assert(m.wind?.calm);
  assertEquals(windText(m.wind!), "Calm");
  assertEquals(m.visibility?.meters, 150);
  assertEquals(visibilityText(m.visibility!), "150 m (0 SM)");
  assertEquals(meaning(m.groups, "R27L/0350V0600U"), "Runway 27L visual range between 350 m and 600 m, improving");
  assertEquals(meaning(m.groups, "R09R/P1500N"), "Runway 09R visual range more than 1,500 m, no change");
  assertEquals(m.weather, ["fog"]);
  assertEquals(m.clouds[0], { cover: "VV", base: 100, type: undefined });
  assertEquals(ceiling(m), 100);
  assertEquals(m.temperature, -1);
  assertEquals(m.dewpoint, -1);
  assertEquals(flightCategory(m), "LIFR");
  assertEquals(m.trends[0].kind, "BECMG");
  assertEquals(m.trends[0].visibility?.meters, 400);
  assertEquals(m.trends[0].weather, ["mist"]);
  assertEquals(m.undecoded, []);
});

Deno.test("METAR: gusts, thunderstorms, cumulonimbus, fractions of a mile and recent weather", () => {
  const m = parseMetar(
    "METAR KORD 011651Z 27015G28KT 1 1/2SM +TSRA BR SCT008 BKN015CB OVC030 22/20 A2992 RERA RMK AO2 P0012",
    REF,
  );
  assertEquals(m.wind?.gust, 28);
  assertEquals(windText(m.wind!), "From 270° (west) at 15 kt (28 km/h), gusting 28 kt (52 km/h)");
  assertEquals(m.visibility?.meters, Math.round(1.5 * 1609.344));
  assertEquals(meaning(m.groups, "1 1/2SM"), "Visibility 1 1/2 SM (2,414 m)");
  assertEquals(m.weather, ["heavy thunderstorm with rain", "mist"]);
  assertEquals(m.clouds[1].type, "CB");
  assertEquals(meaning(m.groups, "BKN015CB"), "Broken clouds (5–7/8) at 1,500 ft, cumulonimbus");
  assertEquals(ceiling(m), 1500);
  assertEquals(flightCategory(m), "IFR");
  assertEquals(m.recent, ["rain"]);
  assertEquals(meaning(m.remarkGroups, "P0012"), "0.12 in of precipitation in the last hour");
  assertEquals(meaning(m.remarkGroups, "AO2"), "Automated station with a precipitation sensor");
  assertEquals(m.undecoded, []);
});

Deno.test("METAR: metres per second, quarter miles, MVFR and unknown groups", () => {
  const m = parseMetar("METAR UUEE 011700Z 18005MPS 6000 -SHSN OVC025 M03/M05 Q1012 R24/290050=", REF);
  assertEquals(m.wind?.speed, 10);
  assertEquals(m.weather, ["light snow showers"]);
  assertEquals(flightCategory(m), "MVFR");
  assertEquals(m.undecoded, ["R24/290050"]);
  const q = parseMetar("KSFO 011656Z VRB04KT M1/4SM FZFG OVC001 M02/M02 A3001", REF);
  assertEquals(q.type, "METAR");
  assertEquals(q.wind?.variable, true);
  assertEquals(windText(q.wind!), "Variable at 4 kt (7 km/h)");
  assertEquals(q.visibility?.lessThan, true);
  assertEquals(visibilityText(q.visibility!), "Less than 1/4 SM (402 m)");
  assertEquals(q.weather, ["freezing fog"]);
  assertEquals(flightCategory(q), "LIFR");
  const p = parseMetar("KDEN 011653Z 17009KT P6SM CLR 13/07 A2995", REF);
  assertEquals(visibilityText(p.visibility!), "6 SM or more (10 km)");
  assertEquals(meaning(p.groups, "CLR"), "No clouds below 12,000 ft (automatic station)");
  assertThrows(() => parseMetar("hello there"), Error, "Not a METAR");
});

Deno.test("weather phenomena in words", () => {
  assertEquals(describeWeather("-RA"), "light rain");
  assertEquals(describeWeather("+SHRASN"), "heavy rain and snow showers");
  assertEquals(describeWeather("VCSH"), "showers in the vicinity");
  assertEquals(describeWeather("VCTS"), "thunderstorm in the vicinity");
  assertEquals(describeWeather("TS"), "thunderstorm");
  assertEquals(describeWeather("BCFG"), "patches of fog");
  assertEquals(describeWeather("MIFG"), "shallow fog");
  assertEquals(describeWeather("BLSN"), "blowing snow");
  assertEquals(describeWeather("FZDZ"), "freezing drizzle");
  assertEquals(describeWeather("+FC"), "tornado or waterspout");
  assertEquals(describeWeather("RADZ"), "rain and drizzle");
  assertEquals(describeWeather("BKN020"), undefined);
  assertEquals(describeWeather("SH"), undefined);
  assertEquals(describeWeather("CAVOK"), undefined);
});

const LFPG_TAF =
  "TAF LFPG 011700Z 0118/0224 05008KT CAVOK TX12/0214Z TN06/0206Z TEMPO 0123/0204 4000 BR BECMG 0204/0206 4000 BR PROB40 TEMPO 0204/0210 2000 BR BKN002 PROB30 TEMPO 0205/0208 0800 FG VV/// BECMG 0210/0212 9999 NSW PROB40 TEMPO 0217/0220 BKN012";

Deno.test("TAF: base, TEMPO, BECMG, PROB TEMPO, and temperatures", () => {
  const t = parseTaf(LFPG_TAF, REF);
  assertEquals(t.station, "LFPG");
  assertEquals(t.issued?.toISOString(), "2026-11-01T17:00:00.000Z");
  assertEquals(t.from?.toISOString(), "2026-11-01T18:00:00.000Z");
  assertEquals(t.to?.toISOString(), "2026-11-03T00:00:00.000Z");
  assertEquals(t.temperatures.map((x) => [x.kind, x.value, x.at?.toISOString()]), [
    ["max", 12, "2026-11-02T14:00:00.000Z"],
    ["min", 6, "2026-11-02T06:00:00.000Z"],
  ]);
  assertEquals(t.periods.map((p) => p.kind), ["BASE", "TEMPO", "BECMG", "PROB", "PROB", "BECMG", "PROB"]);
  const [base, tempo, , prob40, prob30, becmg] = t.periods;
  assert(base.cavok);
  assertEquals(base.raw, "05008KT CAVOK");
  assertEquals(tempo.raw, "TEMPO 0123/0204 4000 BR");
  assertEquals(tempo.from?.toISOString(), "2026-11-01T23:00:00.000Z");
  assertEquals(tempo.to?.toISOString(), "2026-11-02T04:00:00.000Z");
  assertEquals(prob40.probability, 40);
  assertEquals(prob40.tempo, "TEMPO");
  assertEquals(ceiling(prob40), 200);
  assertEquals(flightCategory(prob40), "LIFR");
  assertEquals(prob30.clouds[0], { cover: "VV", base: undefined, type: undefined });
  assertEquals(flightCategory(prob30), "LIFR");
  assert(becmg.noSignificantWeather);
  for (const p of t.periods) assertEquals(p.undecoded, [], p.raw);
  assertEquals(periodTitle(tempo), "Temporarily, Sun 1, 23:00Z → Mon 2, 04:00Z");
  assertEquals(periodTitle(prob40), "40 % chance, temporarily, Mon 2, 04:00Z → 10:00Z");
  assertEquals(conditionsSummary(prob40), "2000 m · mist · BKN 200 ft");
});

Deno.test("TAF: FM groups last until the next one; multi-line raw text", () => {
  const t = parseTaf(
    `TAF KJFK 011729Z 0118/0224 23006KT P6SM BKN250
  FM012100 22008KT P6SM BKN250
  FM020000 23006KT P6SM SKC
  FM021500 22010KT P6SM SCT150`,
    REF,
  );
  assertEquals(t.periods.map((p) => p.kind), ["BASE", "FM", "FM", "FM"]);
  assertEquals(t.periods[0].to?.toISOString(), "2026-11-01T21:00:00.000Z");
  assertEquals(t.periods[1].from?.toISOString(), "2026-11-01T21:00:00.000Z");
  assertEquals(t.periods[1].to?.toISOString(), "2026-11-02T00:00:00.000Z");
  assertEquals(t.periods[3].to?.toISOString(), "2026-11-03T00:00:00.000Z");
  assertEquals(periodTitle(t.periods[1]), "From Sun 1, 21:00Z");
  assertEquals(flightCategory(t.periods[2]), "VFR");
  for (const p of t.periods) assertEquals(p.undecoded, []);
});

Deno.test("TAF: amended, gusts in a PROB30 alone, month boundary, cancelled", () => {
  const t = parseTaf(
    "TAF AMD EGLL 302256Z 3100/0106 02007KT 9999 BKN020 PROB30 0111/0117 04015G25KT 8000 -SHRA RMK NXT FCST BY 06Z",
    new Date("2026-10-30T23:00:00Z"),
  );
  assert(t.amended);
  assertEquals(t.from?.toISOString(), "2026-10-31T00:00:00.000Z");
  assertEquals(t.to?.toISOString(), "2026-11-01T06:00:00.000Z");
  const prob = t.periods[1];
  assertEquals(prob.kind, "PROB");
  assertEquals(prob.tempo, undefined);
  assertEquals(prob.wind?.gust, 25);
  assertEquals(prob.weather, ["light rain showers"]);
  assertEquals(periodTitle(prob), "30 % chance, Sun 1, 11:00Z → 17:00Z");
  assertEquals(t.remarks, "NXT FCST BY 06Z");
  const nil = parseTaf("TAF LFOB 011100Z 0112/0212 NIL", REF);
  assert(nil.cancelled);
  assertEquals(nil.periods, []);
  assertThrows(() => parseTaf("TAF 12"), Error, "Not a TAF");
});

Deno.test("codes, report detection and names", () => {
  assertEquals(parseCodes("cdg, kjfk ord lfpg").map((c) => [c.icao, c.guessed]), [
    ["LFPG", false],
    ["KJFK", false],
    ["KORD", true],
  ]);
  assertEquals(parseCodes("hnd anc").map((c) => c.icao), ["RJTT", "PANC"]);
  assertEquals(parseCodes("paris 12"), []);
  assert(looksLikeReport("LFPG 011700Z 03006KT CAVOK"));
  assert(!looksLikeReport("LFPG KJFK"));
  assert(isTaf(LFPG_TAF));
  assert(isTaf("LFPG 011700Z 0118/0224 05008KT CAVOK"));
  assert(!isTaf("METAR LFPG 011700Z 03006KT CAVOK 10/05 Q1030"));
  assertEquals(stationName("Paris/De Gaulle Arpt, ID, FR"), "Paris/De Gaulle");
  assertEquals(stationName("New York/JF Kennedy Intl, NY, US"), "New York/JF Kennedy");
  assertEquals(compass(350), "north");
  assertEquals(compass(135), "southeast");
});

Deno.test("words and tables for the detail panel", () => {
  const m = parseMetar("LFPG 011700Z 03006KT CAVOK 10/05 Q1030 NOSIG RMK XYZ", REF);
  const text = metarInWords(m);
  assertStringIncludes(text, "Station LFPG");
  assertStringIncludes(text, "No significant change expected in the next 2 hours");
  const table = groupsTable(m.groups, ["ZZZ|1"]);
  assertStringIncludes(table, "| `CAVOK` | Ceiling and visibility OK");
  assertStringIncludes(table, "| `ZZZ\\|1` | *Not decoded* |");
  assertEquals(decodeRemarks("SLP982 SLPNO"), [
    { raw: "SLP982", meaning: "Sea-level pressure 998.2 hPa" },
    { raw: "SLPNO", meaning: "Sea-level pressure not available" },
  ]);
});

Deno.test("fixtures: the Data API's JSON decodes without leftovers", async () => {
  const metars = JSON.parse(await Deno.readTextFile(new URL("./fixtures/metar.json", import.meta.url)));
  for (const r of metars) {
    const m = parseMetar(r.rawOb, REF);
    assertEquals(m.station, r.icaoId);
    assertEquals(flightCategory(m), r.fltCat, r.rawOb);
    assertEquals(m.undecoded, [], r.rawOb);
  }
  const tafs = JSON.parse(await Deno.readTextFile(new URL("./fixtures/taf.json", import.meta.url)));
  for (const r of tafs) {
    const t = parseTaf(r.rawTAF, REF);
    assertEquals(t.station, r.icaoId);
    for (const p of t.periods) assertEquals(p.undecoded, [], p.raw);
  }
});

Deno.test("manifest: narrow permissions and EN + FR keywords", async () => {
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(m.extension.id, "aviation-weather");
  assertEquals(m.extension.version, "1.0.0");
  assertEquals(m.permissions.net, ["aviationweather.gov"]);
  for (const c of m.commands) assert(c.keywords.some((k: string) => /[éèà]/.test(k)), c.name);
});
