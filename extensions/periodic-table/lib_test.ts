import { assert, assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { ELEMENTS } from "./elements.ts";
import {
  block,
  CATEGORIES,
  categoryName,
  countByCategory,
  EXAMPLES,
  formatDensity,
  formatDiscovered,
  formatMass,
  formatTemperature,
  FormulaError,
  group,
  hillFormula,
  molarMass,
  parseFormula,
  period,
  prettyConfiguration,
  searchElements,
  shells,
  state,
  subscript,
  wikipedia,
} from "./lib.ts";

const el = (symbol: string) => ELEMENTS.find((e) => e.symbol === symbol)!;
const symbols = new Set(ELEMENTS.map((e) => e.symbol));
const mm = (formula: string) => molarMass(formula, ELEMENTS).total;
const found = (query: string, only?: Parameters<typeof searchElements>[2]) =>
  searchElements(ELEMENTS, query, only).map((e) => e.symbol);

Deno.test("the table: 118 elements, unique numbers, symbols and names", () => {
  assertEquals(ELEMENTS.length, 118);
  ELEMENTS.forEach((e, i) => assertEquals(e.number, i + 1));
  for (const key of ["symbol", "name", "nameFr"] as const) {
    assertEquals(new Set(ELEMENTS.map((e) => e[key])).size, 118, key);
  }
  for (const e of ELEMENTS) {
    assert(/^[A-Z][a-z]?$/.test(e.symbol), e.symbol);
    assert(CATEGORIES.some((c) => c.value === e.category), e.category);
    assert(e.mass > 0, e.symbol);
    assert(e.electronegativity === null || (e.electronegativity > 0.5 && e.electronegativity < 4), e.symbol);
    assert(e.density === null || e.density > 0, e.symbol);
    assert(e.discovered === null || e.discovered <= 2010, e.symbol);
    assert(/^(\[[A-Z][a-z]?\] )?(\d[spdf]\d+ ?)+$/.test(e.configuration), `${e.symbol}: ${e.configuration}`);
  }
});

Deno.test("the table: masses grow with the atomic number, except the known inversions", () => {
  const inversions: string[] = [];
  for (let i = 1; i < ELEMENTS.length; i++) {
    if (ELEMENTS[i].mass < ELEMENTS[i - 1].mass) inversions.push(ELEMENTS[i].symbol);
  }
  // Ar/K, Co/Ni, Te/I, Th/Pa, U/Np, Pu/Am, Hs (269 after Bh 270), Lv/Ts equal (no inversion).
  assertEquals(inversions, ["K", "Ni", "I", "Pa", "Np", "Am", "Hs"]);
});

Deno.test("the table: electron counts match the atomic number", () => {
  for (const e of ELEMENTS) {
    const total = shells(e, ELEMENTS).reduce((a, b) => a + b, 0);
    assertEquals(total, e.number, e.symbol);
  }
  assertEquals(shells(el("Fe"), ELEMENTS), [2, 8, 14, 2]);
  assertEquals(shells(el("Au"), ELEMENTS), [2, 8, 18, 32, 18, 1]);
});

Deno.test("the table: well-known values", () => {
  assertEquals(el("Fe").mass, 55.845);
  assertEquals(el("C").mass, 12.011);
  assertEquals(el("O").nameFr, "Oxygène");
  assertEquals(el("N").nameFr, "Azote");
  assertEquals(el("W").nameFr, "Tungstène");
  assertEquals(el("F").electronegativity, 3.98);
  assertEquals(el("Cu").configuration, "[Ar] 3d10 4s1");
  assertEquals(el("Cr").configuration, "[Ar] 3d5 4s1");
  assertEquals(el("Hg").melting, 234.32);
  assertEquals(el("Os").density, 22.59);
});

Deno.test("radioactive elements show a mass number in brackets", () => {
  assertEquals(formatMass(el("Tc")), "[98]");
  assertEquals(formatMass(el("Ra")), "[226]");
  assertEquals(formatMass(el("Og")), "[294]");
  assertEquals(formatMass(el("U")), "238.03");
  assertEquals(formatMass(el("Th")), "232.04");
  assertEquals(formatMass(el("Bi")), "208.98");
  assertEquals(ELEMENTS.filter((e) => e.massIsMassNumber).length, 118 - 83 + 2 - 3);
});

Deno.test("positions: period, group and block", () => {
  const pos = (s: string) => [period(el(s).number), group(el(s).number), block(el(s).number)];
  assertEquals(pos("H"), [1, 1, "s"]);
  assertEquals(pos("He"), [1, 18, "s"]);
  assertEquals(pos("B"), [2, 13, "p"]);
  assertEquals(pos("Ar"), [3, 18, "p"]);
  assertEquals(pos("Fe"), [4, 8, "d"]);
  assertEquals(pos("Ag"), [5, 11, "d"]);
  assertEquals(pos("Ba"), [6, 2, "s"]);
  assertEquals(pos("La"), [6, null, "f"]);
  assertEquals(pos("Yb"), [6, null, "f"]);
  assertEquals(pos("Lu"), [6, 3, "d"]);
  assertEquals(pos("Hf"), [6, 4, "d"]);
  assertEquals(pos("Rn"), [6, 18, "p"]);
  assertEquals(pos("U"), [7, null, "f"]);
  assertEquals(pos("Lr"), [7, 3, "d"]);
  assertEquals(pos("Og"), [7, 18, "p"]);
  // Groups agree with the families.
  for (const e of ELEMENTS) {
    const g = group(e.number);
    if (e.category === "alkali") assertEquals(g, 1, e.symbol);
    if (e.category === "alkaline-earth") assertEquals(g, 2, e.symbol);
    if (e.category === "halogen") assertEquals(g, 17, e.symbol);
    if (e.category === "noble-gas") assertEquals(g, 18, e.symbol);
  }
});

Deno.test("states at room temperature", () => {
  const by = (s: ReturnType<typeof state>) => ELEMENTS.filter((e) => state(e) === s).map((e) => e.symbol);
  assertEquals(by("gas"), ["H", "He", "N", "O", "F", "Ne", "Cl", "Ar", "Kr", "Xe", "Rn"]);
  assertEquals(by("liquid"), ["Br", "Hg"]);
  assertEquals(state(el("Ga")), "solid");
  assertEquals(state(el("Og")), "unknown");
  assertEquals(by("solid").length, 103 - 13);
});

Deno.test("text forms", () => {
  assertEquals(prettyConfiguration("[Ar] 3d10 4s1"), "[Ar] 3d¹⁰ 4s¹");
  assertEquals(formatTemperature(1811), "1811 K (1537.85 °C)");
  assertEquals(formatTemperature(null), "Unknown");
  assertEquals(formatDensity(7.874), "7.874 g/cm³");
  assertEquals(formatDensity(0.0012506), "1.2506 g/L");
  assertEquals(formatDiscovered(0), "Antiquity");
  assertEquals(formatDiscovered(1250), "c. 1250");
  assertEquals(formatDiscovered(1898), "1898");
  assertEquals(categoryName("transition"), "Transition metal");
  assertEquals(categoryName("noble-gas"), "Noble gas");
  assertEquals(categoryName("alkaline-earth"), "Alkaline earth metal");
  assertEquals(categoryName("lanthanide"), "Lanthanide");
  assertEquals(wikipedia(el("Fe")), "https://en.wikipedia.org/wiki/Iron");
  assertEquals(wikipedia(el("Sn"), "fr"), "https://fr.wikipedia.org/wiki/%C3%89tain");
  assertEquals(subscript("CuSO4·5H2O"), "CuSO₄·5H₂O");
  assertEquals(subscript("2H2O"), "2H₂O");
});

Deno.test("search: numbers, symbols, names in English and French", () => {
  assertEquals(found("26"), ["Fe"]);
  assertEquals(found("Fe")[0], "Fe");
  assertEquals(found("fe")[0], "Fe");
  assertEquals(found("Co")[0], "Co");
  assertEquals(found("iron"), ["Fe"]);
  assertEquals(found("fer")[0], "Fe");
  assertEquals(found("etain"), ["Sn"]);
  assertEquals(found("Étain"), ["Sn"]);
  assertEquals(found("azote"), ["N"]);
  assertEquals(found("aluminum"), ["Al"]);
  assertEquals(found("cesium"), ["Cs"]);
  assertEquals(found("ox"), ["O"]);
  assertEquals(found("999"), []);
  // "noble" finds the noble gases.
  assertEquals(found("noble").length, countByCategory(ELEMENTS)["noble-gas"]);
  assertEquals(found("", "halogen"), ["F", "Cl", "Br", "I", "At"]);
  assertEquals(found("i", "halogen"), ["I"]);
  assertEquals(found("").length, 118);
});

Deno.test("categories: every family has members and the counts add up", () => {
  const counts = countByCategory(ELEMENTS);
  assertEquals(counts.all, 118);
  assertEquals(CATEGORIES.reduce((n, c) => n + counts[c.value], 0), 118);
  for (const c of CATEGORIES) assert(counts[c.value] > 0, c.value);
  assertEquals(counts.lanthanide, 15);
  assertEquals(counts.actinide, 15);
  assertEquals(counts["noble-gas"], 6);
});

Deno.test("formulas: parsing", () => {
  const atoms = (f: string) => Object.fromEntries(parseFormula(f, symbols).atoms);
  assertEquals(atoms("H2O"), { H: 2, O: 1 });
  assertEquals(atoms("H₂SO₄"), { H: 2, S: 1, O: 4 });
  assertEquals(atoms("Ca(OH)2"), { Ca: 1, O: 2, H: 2 });
  assertEquals(atoms("K4[Fe(CN)6]"), { K: 4, Fe: 1, C: 6, N: 6 });
  assertEquals(atoms("Al2(SO4)3"), { Al: 2, S: 3, O: 12 });
  assertEquals(atoms("CuSO4·5H2O"), { Cu: 1, S: 1, O: 9, H: 10 });
  assertEquals(atoms("CuSO4.5H2O"), atoms("CuSO4·5H2O"));
  assertEquals(atoms("CuSO4*5H2O"), atoms("CuSO4·5H2O"));
  assertEquals(atoms("2H2O"), { H: 4, O: 2 });
  assertEquals(atoms(" C6 H12 O6 "), { C: 6, H: 12, O: 6 });
  assertEquals(atoms("CO"), { C: 1, O: 1 });
  assertEquals(atoms("Co"), { Co: 1 });
  assertEquals(parseFormula("CuSO4 . 5H2O", symbols).formula, "CuSO4·5H2O");
});

Deno.test("formulas: errors say what is wrong", () => {
  const bad = (f: string, message: string) => assertThrows(() => parseFormula(f, symbols), FormulaError, message);
  bad("", "Type a formula");
  bad("Xy2", "“Xy” is not an element");
  bad("Q", "“Q” is not an element");
  bad("h2o", "start with a capital");
  bad("Ca(OH", "never closed");
  bad("CaOH)2", "closes nothing");
  bad("K4[Fe(CN)6)", "is closed by");
  bad("()2", "Empty");
  bad("H0", "can't be 0");
  bad("CuSO4·", "Empty part");
  bad("H2O+", "Unexpected “+”");
});

Deno.test("molar mass: known compounds", () => {
  assertAlmostEquals(mm("H2O"), 18.015, 0.001);
  assertAlmostEquals(mm("NaCl"), 58.44, 0.001);
  assertAlmostEquals(mm("CO2"), 44.009, 0.001);
  assertAlmostEquals(mm("H2SO4"), 98.072, 0.001);
  assertAlmostEquals(mm("C6H12O6"), 180.156, 0.001);
  assertAlmostEquals(mm("Ca(OH)2"), 74.092, 0.001);
  assertAlmostEquals(mm("CuSO4·5H2O"), 249.677, 0.001);
  assertAlmostEquals(mm("C8H10N4O2"), 194.194, 0.001);
  for (const x of EXAMPLES) assert(mm(x.formula) > 0, x.formula);
});

Deno.test("molar mass: shares, atoms and the Hill formula", () => {
  const m = molarMass("H2SO4", ELEMENTS);
  assertEquals(m.atoms, 7);
  assertEquals(m.shares.map((s) => s.element.symbol), ["H", "S", "O"]);
  assertAlmostEquals(m.shares.reduce((n, s) => n + s.fraction, 0), 1, 1e-9);
  assertAlmostEquals(m.shares[2].fraction, 0.6525, 0.0001);
  assertEquals(m.hill, "H2O4S");
  assertEquals(m.approximate, false);
  assertEquals(molarMass("C2H5OH", ELEMENTS).hill, "C2H6O");
  assertEquals(hillFormula(new Map([["Cl", 1], ["Na", 1]])), "ClNa");
  assertEquals(molarMass("RaCl2", ELEMENTS).approximate, true);
});

Deno.test("manifest: commands and no permissions", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    extension: { id: string; categories: string[] };
    permissions?: unknown;
    commands: { name: string }[];
  };
  assertEquals(manifest.extension.id, "periodic-table");
  assertEquals(manifest.permissions, undefined);
  for (const c of manifest.commands) {
    await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  }
});
