// Kitchen conversions that need to know the ingredient: cups ↔ grams, oven temperatures,
// recipe scaling and substitutions. Plain unit conversions are left to the launcher.

import {
  BUTTER_STICK_G,
  type Ingredient,
  INGREDIENTS,
  OVEN,
  type OvenRow,
  type Substitution,
  SUBSTITUTIONS,
} from "./data.ts";

export type CupSystem = "us" | "metric" | "uk";

export const CUP_ML: Record<CupSystem, number> = { us: 236.588, metric: 250, uk: 284.131 };
export const CUP_TITLE: Record<CupSystem, string> = {
  us: "US cup (236.6 ml)",
  metric: "metric cup (250 ml)",
  uk: "UK cup (284 ml)",
};
const US_CUP = CUP_ML.us;

export function cupSystemOf(value: unknown): CupSystem {
  return value === "metric" || value === "uk" ? value : "us";
}

// ---------------------------------------------------------------------------
// Units

export type UnitKind = "volume" | "weight" | "stick";

export interface Unit {
  id: string;
  kind: UnitKind;
  /** ml for volumes, g for weights; resolved per cup system for cups. */
  size: (cups: CupSystem) => number;
  singular: string;
  plural: string;
  names: string[];
}

const U = (
  id: string,
  kind: UnitKind,
  size: number | ((c: CupSystem) => number),
  singular: string,
  plural: string,
  names: string[],
): Unit => ({ id, kind, size: typeof size === "number" ? () => size : size, singular, plural, names });

export const UNITS: Unit[] = [
  U("tsp", "volume", 4.92892, "tsp", "tsp", [
    "tsp",
    "tsps",
    "teaspoon",
    "teaspoons",
    "c. à c.",
    "c.à.c.",
    "c à c",
    "càc",
    "cac",
    "cc",
    "cuillère à café",
    "cuillères à café",
    "cuillere a cafe",
    "cuilleres a cafe",
  ]),
  U("tbsp", "volume", 14.7868, "tbsp", "tbsp", [
    "tbsp",
    "tbsps",
    "tbs",
    "tbl",
    "tablespoon",
    "tablespoons",
    "c. à s.",
    "c.à.s.",
    "c à s",
    "càs",
    "cas",
    "cs",
    "cuillère à soupe",
    "cuillères à soupe",
    "cuillere a soupe",
    "cuilleres a soupe",
  ]),
  U("cup", "volume", (c) => CUP_ML[c], "cup", "cups", ["cup", "cups", "c"]),
  U("metric-cup", "volume", 250, "metric cup", "metric cups", ["metric cup", "metric cups", "tasse", "tasses"]),
  U("uk-cup", "volume", 284.131, "UK cup", "UK cups", ["uk cup", "uk cups", "imperial cup", "imperial cups"]),
  U("us-cup", "volume", US_CUP, "US cup", "US cups", ["us cup", "us cups"]),
  U("floz", "volume", 29.5735, "fl oz", "fl oz", ["fl oz", "fl. oz.", "fl.oz", "floz", "fluid ounce", "fluid ounces"]),
  U("pint", "volume", 473.176, "pint", "pints", ["pint", "pints", "pt"]),
  U("quart", "volume", 946.353, "quart", "quarts", ["quart", "quarts", "qt"]),
  U("ml", "volume", 1, "ml", "ml", ["ml", "milliliter", "milliliters", "millilitre", "millilitres", "cm3"]),
  U("cl", "volume", 10, "cl", "cl", ["cl", "centiliter", "centilitre", "centilitres"]),
  U("dl", "volume", 100, "dl", "dl", ["dl", "deciliter", "décilitre", "décilitres"]),
  U("l", "volume", 1000, "l", "l", ["l", "liter", "liters", "litre", "litres"]),
  U("g", "weight", 1, "g", "g", ["g", "gr", "gram", "grams", "gramme", "grammes"]),
  U("kg", "weight", 1000, "kg", "kg", ["kg", "kilo", "kilos", "kilogram", "kilograms", "kilogramme", "kilogrammes"]),
  U("mg", "weight", 0.001, "mg", "mg", ["mg"]),
  U("oz", "weight", 28.3495, "oz", "oz", ["oz", "ounce", "ounces", "once", "onces"]),
  U("lb", "weight", 453.592, "lb", "lb", ["lb", "lbs", "pound", "pounds", "livre", "livres"]),
  U("stick", "stick", BUTTER_STICK_G, "stick", "sticks", ["stick", "sticks", "stick of", "sticks of"]),
];

const ALL_UNIT_NAMES = UNITS.flatMap((u) => u.names.map((name) => ({ name, unit: u })))
  .sort((a, b) => b.name.length - a.name.length);

export const unitById = (id: string) => UNITS.find((u) => u.id === id)!;

/** The unit a text starts with, and what follows it. */
export function matchUnit(text: string): { unit: Unit; rest: string } | undefined {
  const lower = text.toLowerCase();
  for (const { name, unit } of ALL_UNIT_NAMES) {
    if (!lower.startsWith(name)) continue;
    const next = lower[name.length];
    // Whole words only: "g" must not match "garlic", "c" not "cocoa".
    if (next !== undefined && /[\p{L}\d]/u.test(next)) continue;
    return { unit, rest: text.slice(name.length).trim() };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Numbers

const VULGAR: Record<string, number> = {
  "¼": 1 / 4,
  "½": 1 / 2,
  "¾": 3 / 4,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
  "⅕": 1 / 5,
  "⅙": 1 / 6,
};

/** A leading amount: 2, 1.5, 1,5, 1/2, 1 1/2, 1½, ½, 2-3 (the average). */
export function parseAmount(text: string): { value: number; rest: string } | undefined {
  const t = text.trim();
  const v = "[¼½¾⅓⅔⅛⅜⅝⅞⅕⅙]";
  const re = new RegExp(
    `^(?:(\\d+)\\s*(${v})|(\\d+)\\s+(\\d+)\\s*/\\s*(\\d+)|(\\d+)\\s*/\\s*(\\d+)|(${v})|(\\d+(?:[.,]\\d+)?)(?:\\s*[-–]\\s*(\\d+(?:[.,]\\d+)?))?)`,
  );
  const m = re.exec(t);
  if (!m) return undefined;
  const num = (s: string) => Number(s.replace(",", "."));
  let value: number;
  if (m[1]) value = Number(m[1]) + VULGAR[m[2]];
  else if (m[3]) value = Number(m[3]) + Number(m[4]) / Number(m[5]);
  else if (m[6]) value = Number(m[6]) / Number(m[7]);
  else if (m[8]) value = VULGAR[m[8]];
  else value = m[10] ? (num(m[9]) + num(m[10])) / 2 : num(m[9]);
  if (!Number.isFinite(value)) return undefined;
  return { value, rest: t.slice(m[0].length).trim() };
}

const FRACTIONS: [number, string][] = [
  [1 / 8, "⅛"],
  [1 / 4, "¼"],
  [1 / 3, "⅓"],
  [3 / 8, "⅜"],
  [1 / 2, "½"],
  [5 / 8, "⅝"],
  [2 / 3, "⅔"],
  [3 / 4, "¾"],
  [7 / 8, "⅞"],
];

/** 1.6667 → "1 ⅔", 0.25 → "¼", 2.43 → "2.43"; fractions only when they are close. */
export function niceNumber(x: number, tolerance = 0.02): string {
  if (x <= 0) return "0";
  const whole = Math.floor(x + tolerance);
  const frac = x - whole;
  if (Math.abs(frac) < tolerance) return String(whole);
  for (const [value, glyph] of FRACTIONS) {
    if (Math.abs(frac - value) < tolerance) return whole ? `${whole} ${glyph}` : glyph;
  }
  return decimal(x);
}

export function decimal(x: number): string {
  const digits = x >= 100 ? 0 : x >= 10 ? 1 : 2;
  return String(Math.round(x * 10 ** digits) / 10 ** digits);
}

export function grams(g: number): string {
  if (g >= 1000) return `${decimal(g / 1000)} kg`;
  return `${g >= 10 ? Math.round(g) : decimal(g)} g`;
}

export function amountText(value: number, unit: Unit): string {
  const nice = unit.kind === "weight" && unit.id !== "oz" && unit.id !== "lb" ? decimal(value) : niceNumber(value);
  const one = value < 1.02;
  return `${nice} ${one ? unit.singular : unit.plural}`;
}

/** How to measure a volume with US cups and spoons: "½ cup + 2 tbsp". */
export function measureWith(ml: number): string {
  const parts: string[] = [];
  let rest = ml / US_CUP;
  const whole = Math.floor(rest + 0.01);
  if (whole) parts.push(`${whole} cup${whole > 1 ? "s" : ""}`);
  rest = Math.max(0, rest - whole);
  for (const [value, glyph] of [[3 / 4, "¾"], [2 / 3, "⅔"], [1 / 2, "½"], [1 / 3, "⅓"], [1 / 4, "¼"]] as const) {
    if (rest + 0.01 >= value) {
      if (whole) parts[0] = `${whole} ${glyph} cup${whole ? "s" : ""}`;
      else parts.push(`${glyph} cup`);
      rest -= value;
      break;
    }
  }
  let tbsp = rest * 16;
  const wholeTbsp = Math.floor(tbsp + 0.05);
  if (wholeTbsp) parts.push(`${wholeTbsp} tbsp`);
  tbsp = Math.max(0, tbsp - wholeTbsp);
  const tsp = Math.round(tbsp * 3 * 4) / 4;
  if (tsp >= 0.25) parts.push(`${niceNumber(tsp, 0.01)} tsp`);
  return parts.join(" + ") || "a pinch";
}

// ---------------------------------------------------------------------------
// Ingredients

const fold = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

const NAMES = INGREDIENTS.flatMap((i) =>
  [i.name, i.fr, i.id.replace(/-/g, " "), ...i.aliases].map((n) => ({ n: fold(n), i }))
);

/** The ingredient named exactly (allowing "of", "de", plurals and accents). */
export function findIngredient(text: string): Ingredient | undefined {
  // "flour, sifted": what follows a comma describes it.
  const t = fold(text).replace(/,.*$/, "").replace(/^(of|de|d'|du|des|of the)\s*/, "").replace(/[.;:!]+$/, "").trim();
  if (!t) return undefined;
  for (const candidate of [t, t.replace(/s$/, ""), t.replace(/es$/, ""), t + "s"]) {
    const hit = NAMES.find((x) => x.n === candidate);
    if (hit) return hit.i;
  }
  // "sifted flour", "flour sifted": drop the first or last word.
  const words = t.split(" ");
  if (words.length > 1) return findIngredient(words.slice(1).join(" ")) ?? findIngredient(words.slice(0, -1).join(" "));
  return undefined;
}

/** Ingredients whose names contain the text, for a search. */
export function searchIngredients(text: string): Ingredient[] {
  const t = fold(text);
  if (t.length < 2) return [];
  const seen = new Set<string>();
  const out: Ingredient[] = [];
  for (const x of NAMES) {
    if (!seen.has(x.i.id) && x.n.includes(t)) {
      seen.add(x.i.id);
      out.push(x.i);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Conversions

export interface Conversion {
  amount: number;
  unit: Unit;
  ingredient: Ingredient;
  grams: number;
  ml: number;
  /** The unit asked for, if any. */
  target?: Unit;
}

export function convert(
  amount: number,
  unit: Unit,
  ingredient: Ingredient,
  cups: CupSystem,
  target?: Unit,
): Conversion {
  let g: number, ml: number;
  if (unit.kind === "volume") {
    ml = amount * unit.size(cups);
    g = ml / US_CUP * ingredient.gramsPerCup;
  } else {
    g = amount * unit.size(cups);
    ml = g / ingredient.gramsPerCup * US_CUP;
  }
  return { amount, unit, ingredient, grams: g, ml, target };
}

/** The converted amount in a unit, e.g. 1.67 cups. */
export function inUnit(c: Conversion, unit: Unit, cups: CupSystem): number {
  return unit.kind === "volume" ? c.ml / unit.size(cups) : c.grams / unit.size(cups);
}

// ---------------------------------------------------------------------------
// Oven temperatures

export interface Oven {
  celsius: number;
  fahrenheit: number;
  /** Nearest gas mark, when within the table. */
  gas?: OvenRow;
  /** French oven thermostat: °C ÷ 30. */
  thermostat: number;
  /** The same heat in a fan (convection) oven. */
  fanCelsius: number;
  fromFan: boolean;
  source: string;
}

const roundTo = (x: number, step: number) => Math.round(x / step) * step;

export function oven(celsius: number, source: string, fromFan = false, typedFahrenheit?: number): Oven {
  const conventional = Math.round(fromFan ? celsius + 20 : celsius);
  const gas = OVEN.reduce((best, row) =>
    Math.abs(row.celsius - conventional) < Math.abs(best.celsius - conventional) ? row : best
  );
  // Cookbooks pair 200 °C with 400 °F, not 392: use the table when the temperature is in it.
  const row = OVEN.find((r) => r.celsius === conventional);
  return {
    celsius: conventional,
    fahrenheit: typedFahrenheit ?? row?.fahrenheit ?? roundTo(conventional * 9 / 5 + 32, 5),
    gas: Math.abs(gas.celsius - conventional) <= 10 ? gas : undefined,
    thermostat: Math.round(conventional / 30 * 2) / 2,
    fanCelsius: conventional - 20,
    fromFan,
    source,
  };
}

const GAS_VALUES: Record<string, string> = { "¼": "¼", "1/4": "¼", "0.25": "¼", "½": "½", "1/2": "½", "0.5": "½" };

export function parseOven(text: string): Oven | undefined {
  const t = text.trim().toLowerCase().replace(",", ".");
  const gas = /^(?:gas(?:\s*mark)?|gas\s*no\.?|mark|thermostat\s*gaz)\s*(¼|½|1\/4|1\/2|0\.25|0\.5|\d)$/.exec(t);
  if (gas) {
    const key = GAS_VALUES[gas[1]] ?? gas[1];
    const row = OVEN.find((r) => r.gas === key);
    if (!row) return undefined;
    return oven(row.celsius, `Gas mark ${row.gas}`);
  }
  const th = /^(?:th\.?|thermostat|thermo)\s*(\d+(?:\.\d+)?)$/.exec(t);
  if (th) return oven(Number(th[1]) * 30, `Thermostat ${th[1]}`);
  const deg =
    /^(\d{2,3})\s*°?\s*(c|f|celsius|fahrenheit)?\s*(fan|convection|chaleur tournante|ventilé|ventile|tournante)?$/
      .exec(t);
  if (!deg || (!deg[2] && !deg[3])) return undefined;
  const value = Number(deg[1]);
  const unit = deg[2]?.[0] ?? "c";
  const fan = Boolean(deg[3]);
  const celsius = unit === "f" ? (value - 32) * 5 / 9 : value;
  if (celsius < 50 || celsius > 320) return undefined;
  return oven(
    celsius,
    `${value} °${unit.toUpperCase()}${fan ? " fan" : ""}`,
    fan,
    unit === "f" && !fan ? value : undefined,
  );
}

// ---------------------------------------------------------------------------
// Scaling

export interface ScaledLine {
  source: string;
  /** The scaled text, or the line unchanged when it has no amount. */
  text: string;
  scaled: boolean;
  /** For counted things (eggs): how to round. */
  hint?: string;
}

export function scaleLine(line: string, factor: number): ScaledLine {
  const a = parseAmount(line);
  if (!a) return { source: line, text: line, scaled: false };
  const value = a.value * factor;
  const unit = matchUnit(a.rest);
  if (unit) {
    // Easier spoons: 3 tsp → 1 tbsp, 4 tbsp → ¼ cup.
    let v = value, u = unit.unit;
    if (u.id === "tsp" && v >= 3) {
      v /= 3;
      u = unitById("tbsp");
    }
    if (u.id === "tbsp" && v >= 4) {
      v /= 16;
      u = unitById("cup");
    }
    if (u.id === "g" && v >= 1000) {
      v /= 1000;
      u = unitById("kg");
    }
    if (u.id === "ml" && v >= 1000) {
      v /= 1000;
      u = unitById("l");
    }
    const changed = u !== unit.unit;
    return {
      source: line,
      text: `${amountText(v, u)} ${unit.rest}`.trim(),
      scaled: true,
      hint: changed ? `${amountText(value, unit.unit)} ${unit.rest}`.trim() : undefined,
    };
  }
  const rounded = Math.round(value);
  const text = `${niceNumber(value, 0.05)} ${a.rest}`.trim();
  const hint = Math.abs(rounded - value) > 0.05
    ? `About ${Math.max(1, rounded)}${value < rounded ? " (a little more)" : " (a little less)"}`
    : undefined;
  return { source: line, text, scaled: true, hint };
}

export function splitLines(text: string): string[] {
  return text.split(/\s*(?:[,;\n•]|\s-\s)\s*/).map((l) => l.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Substitutions

export function findSubstitutions(text: string): Substitution[] {
  const t = fold(text);
  if (!t) return [];
  const exact = SUBSTITUTIONS.filter((s) => s.keywords.some((k) => fold(k) === t) || fold(s.name) === t);
  if (exact.length) return exact;
  return SUBSTITUTIONS.filter((s) =>
    [s.name, s.fr, ...s.keywords].some((k) => fold(k).includes(t) || (t.length > 3 && t.includes(fold(k))))
  );
}

// ---------------------------------------------------------------------------
// Queries

export type Query =
  | { kind: "empty" }
  | { kind: "convert"; conversion: Conversion }
  | { kind: "volume"; amount: number; unit: Unit; target?: Unit; note: string }
  | { kind: "ingredient"; ingredient: Ingredient }
  | { kind: "oven"; oven: Oven }
  | { kind: "scale"; factor: number; from?: number; to?: number; lines: ScaledLine[] }
  | { kind: "substitute"; matches: Substitution[]; text: string }
  | { kind: "search"; text: string; ingredients: Ingredient[]; substitutions: Substitution[] }
  | { kind: "error"; message: string };

const TARGET = /\s+(?:in|into|to|en|→|->|=)\s+(.+)$/i;
const SUB =
  /^(?:sub(?:stitute)?s?(?:\s+for)?|replace|replacement for|instead of|no|without|remplacer|remplacement|sans|pas de)\s+(.+)$/i;
const SCALE =
  /^(?:scale|serves|servings|pour|adapter|portions?)?\s*(\d+(?:[.,]\d+)?)\s*(?:servings?|people|personnes?|persons?|parts?|portions?)?\s*(?:to|→|->|à|pour)\s*(\d+(?:[.,]\d+)?)\s*(?:servings?|people|personnes?|persons?|parts?|portions?)?\s*[:,]?\s*(.*)$/is;
const TIMES =
  /^(?:[x×*]\s*(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+)|(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+)\s*[x×])(?:\s*[:,]?\s+|\s*[:,]\s*|$)(.*)$/is;

function toNumber(s: string): number {
  if (s.includes("/")) {
    const [a, b] = s.split("/").map((x) => Number(x.trim()));
    return a / b;
  }
  return Number(s.replace(",", "."));
}

export function parseQuery(input: string, cups: CupSystem = "us"): Query {
  const text = input.trim();
  if (!text) return { kind: "empty" };

  const ov = parseOven(text);
  if (ov) return { kind: "oven", oven: ov };

  const sub = SUB.exec(text);
  if (sub) return { kind: "substitute", matches: findSubstitutions(sub[1]), text: sub[1] };

  const times = TIMES.exec(text);
  if (times) {
    const factor = toNumber(times[1] ?? times[2]);
    if (factor > 0) return { kind: "scale", factor, lines: splitLines(times[3]).map((l) => scaleLine(l, factor)) };
  }
  const scale = /^(scale|serves|servings|pour|adapter|portions?)\b/i.test(text) || /\d\s*(→|->)\s*\d/.test(text)
    ? SCALE.exec(text)
    : undefined;
  if (scale) {
    const from = toNumber(scale[1]), to = toNumber(scale[2]);
    if (from > 0 && to > 0) {
      const factor = to / from;
      return { kind: "scale", factor, from, to, lines: splitLines(scale[3]).map((l) => scaleLine(l, factor)) };
    }
    return { kind: "error", message: "Servings must be more than 0" };
  }

  // "1 cup flour", "200 g sugar in cups", "2 sticks butter", "1 tasse de farine en g".
  let body = text, target: Unit | undefined;
  const t = TARGET.exec(text);
  if (t) {
    const u = matchUnit(t[1]);
    if (u && !u.rest) {
      target = u.unit;
      body = text.slice(0, t.index);
    }
  }
  const amount = parseAmount(body);
  if (amount) {
    const unit = matchUnit(amount.rest);
    if (unit) {
      const name = unit.rest;
      if (unit.unit.kind === "stick") {
        const butter = INGREDIENTS.find((i) => i.id === "butter")!;
        const ingredient = name ? findIngredient(name) ?? butter : butter;
        return { kind: "convert", conversion: convert(amount.value, unit.unit, ingredient, cups, target) };
      }
      if (!name) {
        if (unit.unit.kind === "volume") {
          return {
            kind: "volume",
            amount: amount.value,
            unit: unit.unit,
            target,
            note: "Add an ingredient to get its weight: 1 cup flour",
          };
        }
        return { kind: "error", message: "Add an ingredient: 200 g sugar, 100 g butter in tbsp" };
      }
      const ingredient = findIngredient(name);
      if (ingredient) {
        return { kind: "convert", conversion: convert(amount.value, unit.unit, ingredient, cups, target) };
      }
      const close = searchIngredients(name);
      if (close.length === 1) {
        return { kind: "convert", conversion: convert(amount.value, unit.unit, close[0], cups, target) };
      }
      return { kind: "error", message: `I don't know the weight of "${name}"` };
    }
    const counted = findIngredient(amount.rest);
    if (counted) return { kind: "ingredient", ingredient: counted };
  }

  const ingredient = findIngredient(text);
  if (ingredient) return { kind: "ingredient", ingredient };
  const ingredients = searchIngredients(text);
  const substitutions = findSubstitutions(text);
  if (ingredients.length || substitutions.length) return { kind: "search", text, ingredients, substitutions };
  return { kind: "error", message: "Not a quantity, a temperature or an ingredient I know" };
}

export const EXAMPLES = [
  { query: "1 cup flour", title: "Cups to grams for an ingredient" },
  { query: "200 g sugar in cups", title: "Grams to cups" },
  { query: "2 sticks butter", title: "Butter sticks" },
  { query: "3 c. à s. de miel", title: "French spoons" },
  { query: "350 F", title: "Oven temperature, °C, gas mark and thermostat" },
  { query: "gas 6", title: "Gas mark" },
  { query: "scale 4 to 6: 200 g flour, 3 eggs, 1/2 cup milk", title: "Scale a recipe" },
  { query: "x1.5 2 tsp baking powder, 1 egg", title: "Multiply quantities" },
  { query: "sub buttermilk", title: "Substitutions" },
];
