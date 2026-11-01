// Pure logic of the Periodic Table extension: positions in the table, states, search ranking and the
// molar mass calculator. No I/O here; the elements themselves are in elements.ts.

export type Category =
  | "alkali"
  | "alkaline-earth"
  | "transition"
  | "post-transition"
  | "metalloid"
  | "nonmetal"
  | "halogen"
  | "noble-gas"
  | "lanthanide"
  | "actinide"
  | "unknown";

export type Color = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

export interface Element {
  number: number;
  symbol: string;
  name: string;
  nameFr: string;
  /** Standard atomic weight, or the mass number of the longest-lived isotope (see `massIsMassNumber`). */
  mass: number;
  massIsMassNumber: boolean;
  category: Category;
  configuration: string;
  electronegativity: number | null;
  /** Kelvin. */
  melting: number | null;
  /** Kelvin. */
  boiling: number | null;
  /** g/cm³. */
  density: number | null;
  /** 0: known since antiquity. */
  discovered: number | null;
}

export const CATEGORIES: { value: Category; title: string; titleFr: string; color: Color; hex: string }[] = [
  { value: "alkali", title: "Alkali Metals", titleFr: "Métaux alcalins", color: "red", hex: "#ef6b6b" },
  {
    value: "alkaline-earth",
    title: "Alkaline Earth Metals",
    titleFr: "Métaux alcalino-terreux",
    color: "orange",
    hex: "#f5a35c",
  },
  {
    value: "transition",
    title: "Transition Metals",
    titleFr: "Métaux de transition",
    color: "yellow",
    hex: "#e8c95a",
  },
  {
    value: "post-transition",
    title: "Post-transition Metals",
    titleFr: "Métaux pauvres",
    color: "teal",
    hex: "#5fbfb0",
  },
  { value: "metalloid", title: "Metalloids", titleFr: "Métalloïdes", color: "green", hex: "#8cc46b" },
  { value: "nonmetal", title: "Nonmetals", titleFr: "Non-métaux", color: "blue", hex: "#5b9bd9" },
  { value: "halogen", title: "Halogens", titleFr: "Halogènes", color: "teal", hex: "#4fc1d9" },
  { value: "noble-gas", title: "Noble Gases", titleFr: "Gaz nobles", color: "purple", hex: "#a07de0" },
  { value: "lanthanide", title: "Lanthanides", titleFr: "Lanthanides", color: "pink", hex: "#e384c4" },
  { value: "actinide", title: "Actinides", titleFr: "Actinides", color: "pink", hex: "#c86fa8" },
  {
    value: "unknown",
    title: "Unknown Properties",
    titleFr: "Propriétés inconnues",
    color: "gray",
    hex: "#9a9a9a",
  },
];

export const category = (c: Category) => CATEGORIES.find((x) => x.value === c)!;

/** The singular, for one element: "Transition metal". */
export function categoryName(c: Category): string {
  const title = category(c).title;
  if (c === "unknown") return "Unknown chemical properties";
  const singular = title.replace(/(Metal|Gas|Halogen|Metalloid|Nonmetal|Lanthanide|Actinide)(e?s)$/, "$1");
  return singular.charAt(0) + singular.slice(1).toLowerCase();
}

// Position in the table

const PERIOD_ENDS = [2, 10, 18, 36, 54, 86, 118];

export function period(z: number): number {
  return PERIOD_ENDS.findIndex((end) => z <= end) + 1;
}

/**
 * The IUPAC group (1–18), or null for La–Yb and Ac–No, which sit in the f-block below the table
 * (lutetium and lawrencium are in group 3, as IUPAC recommends).
 */
export function group(z: number): number | null {
  const p = period(z);
  const i = z - (p === 1 ? 1 : PERIOD_ENDS[p - 2] + 1);
  if (p === 1) return z === 1 ? 1 : 18;
  if (p <= 3) return i < 2 ? i + 1 : i + 11;
  if (p <= 5) return i + 1;
  if (i < 2) return i + 1;
  if (i < 16) return null;
  return i - 13;
}

export function block(z: number): "s" | "p" | "d" | "f" {
  if (z === 2) return "s";
  const g = group(z);
  if (g === null) return "f";
  return g <= 2 ? "s" : g <= 12 ? "d" : "p";
}

/** At 25 °C and 1 atm, from the melting and boiling points. */
export function state(e: Element): "solid" | "liquid" | "gas" | "unknown" {
  const room = 298.15;
  if (e.boiling !== null && e.boiling < room) return "gas";
  if (e.melting !== null && e.melting > room) return "solid";
  if (e.melting !== null && e.boiling !== null) return "liquid";
  return "unknown";
}

// Text

/** `55.845`, or `[226]` for a mass number. */
export const formatMass = (e: Element) => e.massIsMassNumber ? `[${e.mass}]` : String(e.mass);

const round = (n: number, digits: number) =>
  Number(n.toFixed(digits)).toLocaleString("en-US", {
    maximumFractionDigits: digits,
    useGrouping: false,
  });

/** `1811 K (1538 °C)`. */
export function formatTemperature(kelvin: number | null): string {
  if (kelvin === null) return "Unknown";
  return `${round(kelvin, 2)} K (${round(kelvin - 273.15, 2)} °C)`;
}

/** Gases are easier to read in g/L. */
export function formatDensity(density: number | null): string {
  if (density === null) return "Unknown";
  return density < 0.1 ? `${round(density * 1000, 4)} g/L` : `${round(density, 3)} g/cm³`;
}

export const formatDiscovered = (year: number | null) =>
  year === null ? "Unknown" : year === 0 ? "Antiquity" : year < 1500 ? `c. ${year}` : String(year);

/** Superscripts for the electron configuration: `[Ar] 3d⁶ 4s²`. */
export function prettyConfiguration(configuration: string): string {
  const sup = "⁰¹²³⁴⁵⁶⁷⁸⁹";
  return configuration.replace(/([spdf])(\d+)/g, (_, l: string, n: string) => l + [...n].map((d) => sup[+d]).join(""));
}

/** Electrons per shell, from the full configuration: Fe → 2, 8, 14, 2. */
export function shells(e: Element, all: Element[]): number[] {
  const counts: number[] = [];
  const add = (config: string) => {
    for (const m of config.matchAll(/\[(\w+)\]/g)) add(all.find((x) => x.symbol === m[1])!.configuration);
    for (const m of config.matchAll(/(\d)[spdf](\d+)/g)) {
      const n = Number(m[1]);
      counts[n - 1] = (counts[n - 1] ?? 0) + Number(m[2]);
    }
  };
  add(e.configuration);
  return Array.from(counts, (c) => c ?? 0);
}

export const wikipedia = (e: Element, lang: "en" | "fr" = "en") =>
  `https://${lang}.wikipedia.org/wiki/${encodeURIComponent((lang === "en" ? e.name : e.nameFr).replace(/ /g, "_"))}`;

// Search

export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * Elements matching the query, best first: the atomic number, the exact symbol (case-sensitive
 * first, so "Co" is cobalt and "CO" still finds it), names in English or French by prefix, then
 * anywhere in a name, the category or the configuration.
 */
export function searchElements(all: Element[], query: string, only?: Category | "all"): Element[] {
  const pool = only && only !== "all" ? all.filter((e) => e.category === only) : all;
  const raw = query.trim();
  if (!raw) return pool;
  const q = fold(raw);
  const scored: [number, Element][] = [];
  for (const e of pool) {
    const names = [fold(e.name), fold(e.nameFr), ...(e.symbol === "Cs" ? ["cesium"] : [])];
    if (e.symbol === "Al") names.push("aluminum");
    if (e.symbol === "S") names.push("sulphur");
    let score = 0;
    if (/^\d+$/.test(raw)) score = e.number === Number(raw) ? 100 : 0;
    else if (e.symbol === raw) score = 95;
    else if (e.symbol.toLowerCase() === q) score = 90;
    else if (names.includes(q)) score = 85;
    else if (names.some((n) => n.startsWith(q))) score = 70;
    else if (q.length >= 3 && names.some((n) => n.includes(q))) score = 50;
    else if (q.length >= 3 && fold(category(e.category).title + " " + category(e.category).titleFr).includes(q)) {
      score = 30;
    } else if (raw.includes(" ") && e.configuration.toLowerCase() === q) score = 30;
    if (score) scored.push([score, e]);
  }
  return scored.sort((a, b) => b[0] - a[0] || a[1].number - b[1].number).map(([, e]) => e);
}

export function countByCategory(all: Element[]): Record<Category | "all", number> {
  const counts = { all: all.length } as Record<Category | "all", number>;
  for (const c of CATEGORIES) counts[c.value] = all.filter((e) => e.category === c.value).length;
  return counts;
}

// Molar mass

export interface Composition {
  /** The formula as typed, tidied: subscripts as digits, `·` between hydrate parts. */
  formula: string;
  /** Symbol → number of atoms, in order of first appearance. */
  atoms: Map<string, number>;
}

export class FormulaError extends Error {}

const SUBSCRIPTS = "₀₁₂₃₄₅₆₇₈₉";
const CLOSE: Record<string, string> = { "(": ")", "[": "]", "{": "}" };

/**
 * Parses `H2SO4`, `Ca(OH)2`, `K4[Fe(CN)6]`, `CuSO4·5H2O` (or `CuSO4.5H2O`, `CuSO4*5H2O`), `H₂O`
 * and a leading count like `2H2O`. Symbols must be capitalized as usual: `CO` is carbon monoxide,
 * `Co` is cobalt.
 */
export function parseFormula(input: string, symbols: Set<string>): Composition {
  const text = [...input.trim()].map((c) => {
    const i = SUBSCRIPTS.indexOf(c);
    return i >= 0 ? String(i) : c;
  }).join("").replace(/\s+/g, "");
  if (!text) throw new FormulaError("Type a formula, like H2SO4");
  const atoms = new Map<string, number>();
  const parts = text.split(/[·•*.⋅]/);
  if (parts.some((p) => !p)) throw new FormulaError("Empty part around a “·”");
  for (const part of parts) {
    const lead = /^(\d+)(.*)$/.exec(part);
    const times = lead ? Number(lead[1]) : 1;
    const body = lead ? lead[2] : part;
    if (!body) throw new FormulaError(`“${part}” has a count but no element`);
    if (times === 0) throw new FormulaError("A count can't be 0");
    for (const [symbol, n] of parseGroup(body, symbols)) atoms.set(symbol, (atoms.get(symbol) ?? 0) + n * times);
  }
  return { formula: parts.join("·"), atoms };
}

function parseGroup(text: string, symbols: Set<string>): Map<string, number> {
  const stack: { atoms: Map<string, number>; open: string }[] = [{ atoms: new Map(), open: "" }];
  let i = 0;
  const count = () => {
    const m = /^\d+/.exec(text.slice(i));
    if (!m) return 1;
    i += m[0].length;
    const n = Number(m[0]);
    if (n === 0) throw new FormulaError("A count can't be 0");
    return n;
  };
  while (i < text.length) {
    const c = text[i];
    if (c in CLOSE) {
      stack.push({ atoms: new Map(), open: c });
      i++;
    } else if (Object.values(CLOSE).includes(c)) {
      const top = stack.pop()!;
      if (!top.open) throw new FormulaError(`“${c}” closes nothing`);
      if (CLOSE[top.open] !== c) throw new FormulaError(`“${top.open}” is closed by “${c}”`);
      if (!top.atoms.size) throw new FormulaError(`Empty “${top.open}${c}”`);
      i++;
      const n = count();
      const into = stack[stack.length - 1].atoms;
      for (const [s, k] of top.atoms) into.set(s, (into.get(s) ?? 0) + k * n);
    } else if (/[A-Z]/.test(c)) {
      const symbol = /^[A-Z][a-z]?/.exec(text.slice(i))![0];
      if (!symbols.has(symbol)) throw new FormulaError(`“${symbol}” is not an element`);
      i += symbol.length;
      const n = count();
      const into = stack[stack.length - 1].atoms;
      into.set(symbol, (into.get(symbol) ?? 0) + n);
    } else if (/[a-z]/.test(c)) {
      throw new FormulaError(`Element symbols start with a capital: “${c.toUpperCase()}${text[i + 1] ?? ""}”?`);
    } else if (/\d/.test(c)) {
      throw new FormulaError("A count must follow an element or a parenthesis");
    } else throw new FormulaError(`Unexpected “${c}”`);
  }
  if (stack.length > 1) throw new FormulaError(`“${stack[stack.length - 1].open}” is never closed`);
  return stack[0].atoms;
}

export interface Share {
  element: Element;
  count: number;
  /** g/mol contributed by these atoms. */
  mass: number;
  /** 0–1 of the molar mass. */
  fraction: number;
}

export interface MolarMass {
  formula: string;
  hill: string;
  /** g/mol. */
  total: number;
  atoms: number;
  shares: Share[];
  /** Some element has no standard atomic weight: the result uses mass numbers. */
  approximate: boolean;
}

export function molarMass(input: string, all: Element[]): MolarMass {
  const bySymbol = new Map(all.map((e) => [e.symbol, e]));
  const { formula, atoms } = parseFormula(input, new Set(bySymbol.keys()));
  const shares: Share[] = [...atoms].map(([symbol, count]) => {
    const element = bySymbol.get(symbol)!;
    return { element, count, mass: element.mass * count, fraction: 0 };
  });
  const total = shares.reduce((s, x) => s + x.mass, 0);
  for (const s of shares) s.fraction = s.mass / total;
  return {
    formula,
    hill: hillFormula(atoms),
    total,
    atoms: shares.reduce((s, x) => s + x.count, 0),
    shares,
    approximate: shares.some((s) => s.element.massIsMassNumber),
  };
}

/** Carbon first, then hydrogen, then the rest alphabetically; without carbon, all alphabetically. */
export function hillFormula(atoms: Map<string, number>): string {
  const symbols = [...atoms.keys()].sort();
  const order = atoms.has("C")
    ? ["C", ...(atoms.has("H") ? ["H"] : []), ...symbols.filter((s) => s !== "C" && s !== "H")]
    : symbols;
  return order.map((s) => s + (atoms.get(s) === 1 ? "" : atoms.get(s))).join("");
}

/** `H₂SO₄`, `CuSO₄·5H₂O`. */
export const subscript = (formula: string) =>
  formula.replace(
    /(^|·)(\d+)|(\d+)/g,
    (_m, sep: string, lead: string, digits: string) =>
      lead !== undefined ? sep + lead : [...digits].map((d) => SUBSCRIPTS[+d]).join(""),
  );

/** `98.079`, keeping three decimals. */
export const formatGrams = (n: number) => n.toFixed(3);

export const EXAMPLES: { formula: string; title: string }[] = [
  { formula: "H2O", title: "Water" },
  { formula: "NaCl", title: "Table salt" },
  { formula: "CO2", title: "Carbon dioxide" },
  { formula: "H2SO4", title: "Sulfuric acid" },
  { formula: "C6H12O6", title: "Glucose" },
  { formula: "Ca(OH)2", title: "Slaked lime" },
  { formula: "CuSO4·5H2O", title: "Copper sulfate pentahydrate" },
  { formula: "K4[Fe(CN)6]", title: "Potassium ferrocyanide" },
  { formula: "C8H10N4O2", title: "Caffeine" },
];
