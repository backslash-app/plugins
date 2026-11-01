import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  checkDigit,
  checkDigitRequired,
  componentName,
  country,
  decodeUrl,
  inspectVin,
  manufacturer,
  modelYears,
  normalizeVin,
  parseQuery,
  type RecallsResponse,
  recallsUrl,
  region,
  reportDate,
  summaryText,
  titleCase,
  toDecoded,
  toRecalls,
  vehicleName,
  type VpicResponse,
} from "./lib.ts";

const fixture = async <T>(name: string): Promise<T> =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url))) as T;

const NOW = new Date("2026-11-01T12:00:00Z");

Deno.test("check digit: known VINs", () => {
  assertEquals(checkDigit("1HGCM82633A004352"), "3");
  // Wikipedia's example, whose check digit is X.
  assertEquals(checkDigit("1M8GDM9AXKP042788"), "X");
  assertEquals(checkDigit("11111111111111111"), "1");
  // A made-up Tesla VIN with a wrong 9th character (vPIC says so too).
  assert(checkDigit("5YJ3E1EA7KF317000") !== "7");
  assertThrows(() => checkDigit("1HGCM82633A00435"), Error, "17");
  assertThrows(() => checkDigit("1HGCM82633A0O4352"), Error);
  assert(checkDigitRequired("1HGCM82633A004352"));
  assert(checkDigitRequired("LVSHCAMB1CE012345"));
  assert(!checkDigitRequired("WVWZZZ1KZBW123456"));
});

Deno.test("normalize and invalid characters", () => {
  assertEquals(normalizeVin(" 1hgcm8-2633a 004352 "), "1HGCM82633A004352");
  const v = inspectVin("1HGCM82633AOO4352");
  assert(!v.valid);
  assert(v.problem!.includes("O at 12"));
  assert(v.problem!.includes("never use I, O or Q"));
  const short = inspectVin("1HGCM826");
  assert(!short.valid);
  assertEquals(short.problem, "8 of the 17 characters of a VIN");
});

Deno.test("region, country and maker from the prefix", () => {
  assertEquals(region("1HG"), "North America");
  assertEquals(region("WVW"), "Europe");
  assertEquals(region("JHM"), "Asia");
  assertEquals(region("9BW"), "South America");
  assertEquals(country("1HGCM82633A004352"), "United States");
  assertEquals(country("2HGES"), "Canada");
  assertEquals(country("3VWFE"), "Mexico");
  assertEquals(country("WVWZZZ"), "Germany");
  assertEquals(country("VF1RF"), "France");
  assertEquals(country("VR3UH"), "France");
  assertEquals(country("SALGA"), "United Kingdom");
  assertEquals(country("ZFA31"), "Italy");
  assertEquals(country("TMBJJ"), "Czech Republic");
  assertEquals(country("UU1HS"), "Romania");
  assertEquals(country("KMHD8"), "South Korea");
  assertEquals(country("YV1MS"), "Sweden");
  assertEquals(country("JTDKB"), "Japan");
  assertEquals(country("9BWZZ"), "Brazil");
  assertEquals(country("XZ123"), undefined);
  assertEquals(manufacturer("1HGCM82633A004352"), "Honda");
  assertEquals(manufacturer("JTDKB20U"), "Toyota");
  assertEquals(manufacturer("JTHBA30G"), "Lexus");
  assertEquals(manufacturer("WDDGF8AB"), "Mercedes-Benz");
  assertEquals(manufacturer("WBSPM9C5"), "BMW M");
  assertEquals(manufacturer("XXX"), undefined);
});

Deno.test("model year from the 10th character", () => {
  // North America: the 7th character picks the 30-year cycle.
  assertEquals(modelYears("1HGCM82633A004352", NOW), [2003]);
  assertEquals(modelYears("5YJ3E1EA7KF317000", NOW), [2019]);
  assertEquals(modelYears("1FTFW1ET5DFC10312", NOW), [2013]);
  // Elsewhere both are possible, newest first, never in the future.
  assertEquals(modelYears("WVWZZZ1KZBW123456", NOW), [2011, 1981]);
  assertEquals(modelYears("WVWZZZ1KZTW123456", NOW), [2026, 1996]);
  // A 2027 model is sold from 2026, a 2028 one not yet.
  assertEquals(modelYears("WVWZZZ1KZVW123456", NOW), [2027, 1997]);
  assertEquals(modelYears("WVWZZZ1KZWW123456", NOW), [1998]);
  assertEquals(modelYears("WVWZZZ1KZ0W123456", NOW), []);
});

Deno.test("inspectVin puts it together", () => {
  const v = inspectVin("1HGCM82633A004352", NOW);
  assert(v.valid);
  assertEquals(v.checkDigit, { expected: "3", found: "3", required: true, ok: true });
  assertEquals(v.manufacturer, "Honda");
  assertEquals(v.country, "United States");
  assertEquals(v.wmi, "1HG");
  assertEquals(v.vds, "CM826");
  assertEquals(v.vis, "3A004352");
  assertEquals(v.serial, "004352");
  assert(!v.small);
  assert(inspectVin("1A9AB12345A123456").small);
  const eu = inspectVin("WVWZZZ1KZBW123456", NOW);
  assert(eu.valid);
  assert(!eu.checkDigit!.required);
  assert(!eu.checkDigit!.ok);
});

Deno.test("vPIC: a clean decode", async () => {
  const d = toDecoded(await fixture<VpicResponse>("honda.json"));
  assertEquals(d.quality, "clean");
  assertEquals(d.make, "Honda");
  assertEquals(d.model, "Accord");
  assertEquals(d.year, 2003);
  assertEquals(d.trim, "EX-V6");
  assertEquals(d.body, "Coupe");
  assertEquals(d.doors, "2 doors");
  assertEquals(d.engine, "3.0 L V6 240 hp");
  assertEquals(d.fuel, "Gasoline");
  assertEquals(d.transmission, "Automatic, 5 speeds");
  assertEquals(d.plant, "Marysville, Ohio, United States (USA)");
  assertEquals(d.type, "Passenger Car");
  assertEquals(d.errors, []);
  assertEquals(vehicleName(d), "2003 Honda Accord EX-V6");
  const text = summaryText(d, []);
  assert(text.startsWith("2003 Honda Accord EX-V6 — VIN 1HGCM82633A004352"));
  assert(text.includes("Recalls: 0"));
});

Deno.test("vPIC: an electric car with safety equipment and a bad check digit", async () => {
  const d = toDecoded(await fixture<VpicResponse>("tesla.json"));
  assertEquals(d.quality, "partial");
  assertEquals(d.make, "Tesla");
  assertEquals(d.model, "Model 3");
  assertEquals(d.fuel, "Electric");
  assertEquals(d.electrification, "BEV (Battery Electric Vehicle)");
  assertEquals(d.engine, "Single Motor - Standard");
  assertEquals(d.transmission, "Automatic, 1 speed");
  assert(d.standard.includes("Anti-lock brakes"));
  assert(d.standard.includes("Automatic emergency braking"));
  assert(d.optional.includes("Adaptive cruise control"));
  assertEquals(d.errors[0].code, "1");
});

Deno.test("vPIC: a European VIN decodes in part", async () => {
  const d = toDecoded(await fixture<VpicResponse>("vw.json"));
  assertEquals(d.quality, "partial");
  assertEquals(d.make, "Volkswagen");
  assertEquals(d.model, undefined);
  assertEquals(d.plant, "Wolfsburg, Germany");
  assertEquals(d.errors.map((e) => e.code), ["1", "5", "14", "400"]);
  assert(d.suggestedVin!.includes("!"));
  assertEquals(vehicleName(d), "1981 Volkswagen");
  const failed = toDecoded({
    Count: 1,
    Message: "",
    Results: [{ ErrorCode: "7", ErrorText: "7 - Manufacturer is not registered" }],
  });
  assertEquals(failed.quality, "failed");
  assertEquals(failed.errors, [{ code: "7", text: "Manufacturer is not registered" }]);
});

Deno.test("recalls", async () => {
  const list = toRecalls(await fixture<RecallsResponse>("recalls.json"));
  assertEquals(list.length, 3);
  assert(list.every((r, i) => i === 0 || (list[i - 1].date ?? "") >= (r.date ?? "")));
  const airbag = list.find((r) => r.campaign === "19V182000")!;
  assertEquals(airbag.date, "2019-03-06");
  assertEquals(airbag.component, "Air bags › Frontal › Driver side › Inflator module");
  assert(airbag.summary.includes("Takata"));
  assert(airbag.consequence!.length > 0);
  assertEquals(airbag.parkIt, false);
  // Missing flags read as false, duplicates are dropped.
  const dup = toRecalls({
    Count: 2,
    Message: "",
    results: [{ NHTSACampaignNumber: "X1" }, { NHTSACampaignNumber: "X1", parkIt: true }],
  });
  assertEquals(dup.length, 1);
  assertEquals(dup[0].parkIt, false);
  assertEquals(dup[0].component, "Unspecified component");
  assertEquals(reportDate("16/01/2013"), "2013-01-16");
  assertEquals(reportDate("12/31/2020"), undefined);
  assertEquals(reportDate("2020-12-31"), undefined);
  assertEquals(componentName("STEERING"), "Steering");
  assertEquals(
    componentName("POWER TRAIN:AUTOMATIC TRANSMISSION:CONTROL MODULE (TCM/PCM/TECM)"),
    "Power train › Automatic transmission › Control module (TCM/PCM/TECM)",
  );
});

Deno.test("urls and names", () => {
  assertEquals(
    decodeUrl("1HGCM82633A004352"),
    "https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/1HGCM82633A004352?format=json",
  );
  assertEquals(
    recallsUrl("Land Rover", "Range Rover", 2015),
    "https://api.nhtsa.gov/recalls/recallsByVehicle?make=Land+Rover&model=Range+Rover&modelYear=2015",
  );
  assertEquals(titleCase("MERCEDES-BENZ"), "Mercedes-Benz");
  assertEquals(titleCase("LAND ROVER"), "Land Rover");
  assertEquals(titleCase("BMW"), "BMW");
  assertEquals(titleCase("Model 3"), "Model 3");
});

Deno.test("queries", () => {
  assertEquals(parseQuery("", NOW), { kind: "empty" });
  assertEquals(parseQuery("1HGCM82633A004352", NOW), { kind: "vin", vin: "1HGCM82633A004352" });
  assertEquals(parseQuery("1hgcm 826 33a 004352", NOW), { kind: "vin", vin: "1HGCM82633A004352" });
  assertEquals(parseQuery("honda accord 2003", NOW), { kind: "recalls", make: "honda", model: "accord", year: 2003 });
  assertEquals(parseQuery("2019 tesla model 3", NOW), { kind: "recalls", make: "tesla", model: "model 3", year: 2019 });
  assertEquals(parseQuery("land rover defender 2021", NOW), {
    kind: "recalls",
    make: "land rover",
    model: "defender",
    year: 2021,
  });
  assertEquals(parseQuery("mercedes benz, c300 2016", NOW), {
    kind: "recalls",
    make: "Mercedes-Benz",
    model: "c300",
    year: 2016,
  });
  // 17 characters once the spaces are gone, but it reads as make model year.
  assertEquals(parseQuery("chevrolet volt 2013", NOW).kind, "recalls");
  assertEquals(parseQuery("1HGCM82633A0O4352", NOW).kind, "partial");
  assertEquals(parseQuery("1HGCM8263", NOW).kind, "partial");
  assertEquals(parseQuery("honda", NOW).kind, "help");
  assertEquals(parseQuery("honda 2099", NOW).kind, "help");
});

Deno.test("manifest", async () => {
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(m.extension.id, "vehicle-lookup");
  assertEquals(m.extension.categories, ["everyday"]);
  assertEquals(m.permissions, { net: ["vpic.nhtsa.dot.gov", "api.nhtsa.gov"] });
  for (const c of m.commands) {
    await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  }
});
