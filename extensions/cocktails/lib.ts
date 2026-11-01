// TheCocktailDB drinks: parsing, measures and unit conversion, what you can make with your bar. No I/O here.

export const SITE = "https://www.thecocktaildb.com";

/** A drink as TheCocktailDB sends it: numbered `strIngredientN` / `strMeasureN` fields, up to 15. */
export interface RawDrink {
  idDrink: string;
  strDrink: string;
  strDrinkAlternate?: string | null;
  strTags?: string | null;
  strCategory?: string | null;
  strIBA?: string | null;
  strAlcoholic?: string | null;
  strGlass?: string | null;
  strInstructions?: string | null;
  strInstructionsFR?: string | null;
  strInstructionsDE?: string | null;
  strInstructionsES?: string | null;
  strInstructionsIT?: string | null;
  strDrinkThumb?: string | null;
  strImageAttribution?: string | null;
  [key: string]: string | null | undefined;
}

export type Alcohol = "alcoholic" | "non-alcoholic" | "optional";
export type Language = "en" | "fr" | "de" | "es" | "it";
export const LANGUAGES: Record<Language, string> = {
  en: "English",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  it: "Italiano",
};

export interface Ingredient {
  name: string;
  /** As written: "1 1/2 oz", "Juice of 1/2", or empty. */
  measure: string;
}

export interface Drink {
  id: string;
  name: string;
  category?: string;
  alcohol: Alcohol;
  glass?: string;
  /** "Contemporary Classics" when the drink is an IBA official cocktail. */
  iba?: string;
  tags: string[];
  thumb?: string;
  ingredients: Ingredient[];
  instructions: Partial<Record<Language, string>>;
  attribution?: string;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

export function alcoholOf(s: string | null | undefined): Alcohol {
  const v = clean(s).toLowerCase();
  if (v.startsWith("non")) return "non-alcoholic";
  if (v.startsWith("optional")) return "optional";
  return "alcoholic";
}

export function parseDrink(raw: RawDrink): Drink {
  const ingredients: Ingredient[] = [];
  for (let i = 1; i <= 15; i++) {
    const name = clean(raw[`strIngredient${i}`]);
    if (!name) continue;
    // Some measures carry a note in parentheses or a stray newline: "(Claret)\n".
    ingredients.push({ name, measure: clean(raw[`strMeasure${i}`]) });
  }
  const instructions: Partial<Record<Language, string>> = {};
  const texts: [Language, string | null | undefined][] = [
    ["en", raw.strInstructions],
    ["fr", raw.strInstructionsFR],
    ["de", raw.strInstructionsDE],
    ["es", raw.strInstructionsES],
    ["it", raw.strInstructionsIT],
  ];
  for (const [lang, text] of texts) {
    const t = (text ?? "").replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").trim();
    if (t) instructions[lang] = t;
  }
  return {
    id: raw.idDrink,
    name: clean(raw.strDrink),
    category: clean(raw.strCategory) || undefined,
    alcohol: alcoholOf(raw.strAlcoholic),
    glass: clean(raw.strGlass) || undefined,
    iba: clean(raw.strIBA) || undefined,
    tags: clean(raw.strTags).split(",").map((t) => t.trim()).filter(Boolean).map(splitCamel),
    thumb: clean(raw.strDrinkThumb) || undefined,
    ingredients,
    instructions,
    attribution: clean(raw.strImageAttribution) || undefined,
  };
}

/** "ContemporaryClassic" → "Contemporary Classic". */
function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Instructions in the wanted language, else in English (always there). */
export function instructionsIn(d: Drink, lang: Language): { text: string; lang: Language } {
  const text = d.instructions[lang];
  if (text) return { text, lang };
  return { text: d.instructions.en ?? "", lang: "en" };
}

export function languageOf(value: unknown): Language {
  const v = String(value ?? "").trim().toLowerCase().slice(0, 2);
  return (v in LANGUAGES ? v : "en") as Language;
}

// ---------------------------------------------------------------------------
// Measures

export type Units = "both" | "metric" | "us" | "original";

export function unitsOf(value: unknown): Units {
  const v = String(value ?? "").trim().toLowerCase();
  if (v === "metric" || v === "ml") return "metric";
  if (v === "us" || v === "imperial" || v === "oz") return "us";
  if (v === "original" || v === "none") return "original";
  return "both";
}

interface Unit {
  /** How the unit is written back, singular and plural. */
  one: string;
  many: string;
  /** Milliliters in one unit; undefined for counts (parts, dashes, slices). */
  ml?: number;
  /** A unit the US side keeps as it is (teaspoons, cups…). */
  us?: boolean;
}

// One US fluid ounce is 29.57 ml; bartenders, and this table, use 30.
const UNITS: Record<string, Unit> = {
  oz: { one: "oz", many: "oz", ml: 30 },
  cl: { one: "cl", many: "cl", ml: 10 },
  ml: { one: "ml", many: "ml", ml: 1 },
  dl: { one: "dl", many: "dl", ml: 100 },
  l: { one: "L", many: "L", ml: 1000 },
  shot: { one: "shot", many: "shots", ml: 45 },
  jigger: { one: "jigger", many: "jiggers", ml: 45 },
  tsp: { one: "tsp", many: "tsp", ml: 5, us: true },
  tbsp: { one: "tbsp", many: "tbsp", ml: 15, us: true },
  cup: { one: "cup", many: "cups", ml: 240, us: true },
  pint: { one: "pint", many: "pints", ml: 473, us: true },
  qt: { one: "qt", many: "qt", ml: 946, us: true },
  fifth: { one: "fifth", many: "fifths", ml: 750 },
  gal: { one: "gallon", many: "gallons", ml: 3785, us: true },
  part: { one: "part", many: "parts" },
  measure: { one: "measure", many: "measures" },
  dash: { one: "dash", many: "dashes" },
  drop: { one: "drop", many: "drops" },
  splash: { one: "splash", many: "splashes" },
  g: { one: "g", many: "g" },
};

const UNIT_WORDS: Record<string, string> = {
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  cl: "cl",
  ml: "ml",
  dl: "dl",
  l: "l",
  liter: "l",
  litre: "l",
  liters: "l",
  litres: "l",
  shot: "shot",
  shots: "shot",
  jigger: "jigger",
  jiggers: "jigger",
  tsp: "tsp",
  teaspoon: "tsp",
  teaspoons: "tsp",
  tblsp: "tbsp",
  tbsp: "tbsp",
  tablespoon: "tbsp",
  tablespoons: "tbsp",
  cup: "cup",
  cups: "cup",
  pint: "pint",
  pints: "pint",
  qt: "qt",
  quart: "qt",
  quarts: "qt",
  fifth: "fifth",
  gal: "gal",
  gallon: "gal",
  part: "part",
  parts: "part",
  measure: "measure",
  measures: "measure",
  dash: "dash",
  dashes: "dash",
  drop: "drop",
  drops: "drop",
  splash: "splash",
  splashes: "splash",
  g: "g",
  gr: "g",
  gram: "g",
  grams: "g",
};

export interface Measure {
  amount: number;
  /** The upper bound of "1-2 shots", "2 or 3". */
  to?: number;
  unit?: string;
  /** Words after the unit: "sweetened", "Bacardi". */
  rest: string;
  about: boolean;
}

const NUMBER = String.raw`(\d+/\d+|\d+(?:[.,]\d+)?(?:\s+\d+/\d+)?)`;
const MEASURE_RE = new RegExp(
  String.raw`^(about\s+)?${NUMBER}(?:\s*(?:-|–|or|to)\s*${NUMBER})?\s*([a-zA-Z]+\.?)?\s*(.*)$`,
  "i",
);

export function parseNumber(s: string): number {
  const t = s.trim().replace(",", ".");
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(t);
}

/** "1 1/2 oz", "1-2 shots", "About 8 drops", "4.5 cl"; undefined for "Juice of 1", "Top up with", "". */
export function parseMeasure(text: string): Measure | undefined {
  const m = MEASURE_RE.exec(text.trim());
  if (!m) return undefined;
  const amount = parseNumber(m[2]);
  if (!Number.isFinite(amount) || amount <= 0) return undefined;
  const to = m[3] ? parseNumber(m[3]) : undefined;
  const word = (m[4] ?? "").replace(/\.$/, "").toLowerCase();
  const unit = UNIT_WORDS[word];
  // An unknown word is not a unit: "1 Slice", "2 Wedges", "4 fresh".
  const rest = unit ? m[5].trim() : [m[4] ?? "", m[5]].join(" ").trim();
  return { amount, to: to && Number.isFinite(to) ? to : undefined, unit, rest, about: !!m[1] };
}

const FRACTIONS: [number, string][] = [[0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];

/** 1.5 → "1 ½", 0.25 → "¼", 2 → "2", 0.4 → "0.4". */
export function formatAmount(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const frac = n - whole;
  if (frac < 0.02) return String(whole);
  const near = FRACTIONS.find(([v]) => Math.abs(v - frac) < 0.02);
  if (near) return whole ? `${whole} ${near[1]}` : near[1];
  return String(Math.round(n * 10) / 10);
}

/** Milliliters, rounded the way a recipe says them: 7 ml, 15 ml, 45 ml, 250 ml, 1.5 L. */
export function formatMl(ml: number): string {
  if (ml >= 1000) return `${Math.round(ml / 100) / 10} L`.replace(".0 L", " L");
  if (ml >= 100) return `${Math.round(ml / 10) * 10} ml`;
  if (ml >= 10) return `${Math.round(ml / 5) * 5} ml`;
  return `${Math.max(1, Math.round(ml))} ml`;
}

/** Ounces to the nearest quarter, for the US side. */
export function formatOz(ml: number): string {
  const oz = Math.max(0.25, Math.round((ml / 30) * 4) / 4);
  return `${formatAmount(oz)} oz`;
}

function unitText(unit: string, n: number): string {
  const u = UNITS[unit];
  return n > 1 ? u.many : u.one;
}

function amountText(m: Measure): string {
  return m.to ? `${formatAmount(m.amount)}–${formatAmount(m.to)}` : formatAmount(m.amount);
}

/** The measure in the wanted units; `converted` is the other system, for "both". */
export function convertMeasure(text: string, units: Units): { text: string; converted?: string } {
  if (units === "original") return { text };
  const m = parseMeasure(text);
  if (!m || !m.unit) return { text };
  const u = UNITS[m.unit];
  if (!u.ml) return { text };
  const rest = m.rest ? ` ${m.rest}` : "";
  const about = m.about ? "about " : "";
  const metric = (n: number) => formatMl(n * u.ml!);
  const metricText = `${about}${m.to ? `${metric(m.amount)}–${metric(m.to)}` : metric(m.amount)}${rest}`;
  // Teaspoons, cups and quarts stay as they are on the US side.
  const usText = u.us
    ? `${about}${amountText(m)} ${unitText(m.unit, m.to ?? m.amount)}${rest}`
    : `${about}${
      m.to ? `${formatOz(m.amount * u.ml)}–${formatOz(m.to * u.ml)}`.replace(/ oz–/, "–") : formatOz(m.amount * u.ml)
    }${rest}`;
  const isMetric = ["cl", "ml", "dl", "l"].includes(m.unit);
  if (units === "metric") return { text: metricText };
  if (units === "us") return { text: usText };
  // Both: as written, with the other system in brackets when it says something new.
  const other = isMetric ? usText : metricText;
  return other === text ? { text } : { text, converted: other };
}

// ---------------------------------------------------------------------------
// What you can make

/** lowercase, no accents, words separated by single spaces. */
export function norm(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** French (and a few other) words people type for what is in their bar. */
const ALIASES: Record<string, string> = {
  "citron vert": "lime",
  "citrons verts": "lime",
  citron: "lemon",
  citrons: "lemon",
  limes: "lime",
  lemons: "lemon",
  rhum: "rum",
  whisky: "whiskey",
  "whisky ecossais": "scotch",
  scotch: "scotch",
  sucre: "sugar",
  "sirop de sucre": "sugar syrup",
  "simple syrup": "sugar syrup",
  "sirop": "syrup",
  menthe: "mint",
  glace: "ice",
  glacons: "ice",
  eau: "water",
  "eau gazeuse": "soda water",
  "eau petillante": "soda water",
  soda: "soda water",
  "club soda": "soda water",
  tonic: "tonic water",
  lait: "milk",
  creme: "cream",
  "creme fraiche": "cream",
  cafe: "coffee",
  oeuf: "egg",
  oeufs: "egg",
  eggs: "egg",
  orange: "orange",
  oranges: "orange",
  "jus d orange": "orange juice",
  "jus de citron": "lemon juice",
  "jus de citron vert": "lime juice",
  "jus d ananas": "pineapple juice",
  "jus de canneberge": "cranberry juice",
  ananas: "pineapple",
  fraise: "strawberries",
  fraises: "strawberries",
  framboise: "raspberries",
  framboises: "raspberries",
  pamplemousse: "grapefruit",
  gingembre: "ginger",
  "biere de gingembre": "ginger beer",
  biere: "beer",
  vin: "wine",
  "vin rouge": "red wine",
  "vin blanc": "white wine",
  champagne: "champagne",
  cognac: "cognac",
  cointreau: "triple sec",
  "grenadine": "grenadine",
  amaretto: "amaretto",
  angostura: "angostura bitters",
  bitters: "bitters",
  coke: "coca cola",
  coca: "coca cola",
  cola: "coca cola",
  "coca cola": "coca cola",
};

/** A bottle covers its kinds: "rum" covers light, dark and spiced rum; "whiskey" covers bourbon. */
const FAMILIES: Record<string, string[]> = {
  whiskey: ["bourbon", "scotch", "rye whiskey", "irish whiskey", "blended whiskey", "blended scotch", "jack daniels"],
  rum: ["bacardi", "malibu rum", "cachaca"],
  vodka: ["absolut", "smirnoff", "stolichnaya"],
  brandy: ["cognac", "armagnac", "pisco"],
  "triple sec": ["cointreau", "grand marnier"],
  "sugar syrup": ["simple syrup"],
  "soda water": ["club soda", "carbonated water", "sparkling water"],
  "coca cola": ["coca-cola", "cola"],
  wine: ["red wine", "white wine", "rose wine"],
};

/** Things everyone has: they never count as missing. */
export const STAPLES = ["ice", "water", "salt", "sugar", "ice cubes", "crushed ice"];

/** What a typed bottle means: "Citron vert" → "lime", "rhum" → "rum". */
export function canonical(term: string): string {
  const n = norm(term);
  return ALIASES[n] ?? n;
}

/** "gin, lime; triple sec" → ["gin", "lime", "triple sec"], deduplicated. */
export function parseBar(text: string): string[] {
  const out: string[] = [];
  for (const part of text.split(/[,;\n]+|\s+(?:and|et|&|\+)\s+/i)) {
    const c = canonical(part);
    if (c && !out.includes(c)) out.push(c);
  }
  return out;
}

const SUFFIXES = ["juice", "peel", "wedge", "wedges", "slice", "slices", "twist", "zest", "wheel", "leaves", "sprig"];

/** Whether a bottle in your bar covers a recipe's ingredient. */
export function covers(have: string, ingredient: string): boolean {
  const h = canonical(have);
  const i = norm(ingredient);
  if (!h) return false;
  if (i === h) return true;
  // "light rum", "sweet vermouth", "blended whiskey", "lemon lime soda"
  if (i.endsWith(` ${h}`)) return true;
  // "lime juice", "lemon peel", "mint leaves"
  if (i.startsWith(`${h} `) && SUFFIXES.includes(i.slice(h.length + 1))) return true;
  // Plurals: "strawberry" / "strawberries", "egg" / "eggs"
  if (i === `${h}s` || h === `${i}s` || i.replace(/ies$/, "y") === h || h.replace(/ies$/, "y") === i) return true;
  return (FAMILIES[h] ?? []).some((kind) => i === kind || i.startsWith(`${kind} `) || i.endsWith(` ${kind}`));
}

export function isStaple(ingredient: string): boolean {
  return STAPLES.includes(norm(ingredient));
}

export interface Match {
  drink: Drink;
  /** Recipe ingredients your bar has no bottle for (staples excluded). */
  missing: string[];
  /** How many of the recipe's non-staple ingredients you have. */
  have: number;
}

/** Drinks you can make, then those missing one or two ingredients; each must use at least one of your bottles. */
export function whatCanIMake(drinks: Drink[], bar: string[], maxMissing = 2): Match[] {
  const out: Match[] = [];
  for (const drink of drinks) {
    const needed = uniqueNames(drink.ingredients.map((i) => i.name)).filter((n) => !isStaple(n));
    if (!needed.length) continue;
    const missing = needed.filter((n) => !bar.some((b) => covers(b, n)));
    const have = needed.length - missing.length;
    if (have === 0 || missing.length > maxMissing) continue;
    out.push({ drink, missing, have });
  }
  return out.sort((a, b) =>
    a.missing.length - b.missing.length || b.have - a.have || a.drink.name.localeCompare(b.drink.name)
  );
}

/** Drinks with an ingredient matching `term`, IBA classics first. */
export function withIngredient(drinks: Drink[], term: string): Drink[] {
  return drinks
    .filter((d) => d.ingredients.some((i) => covers(term, i.name)))
    .sort((a, b) => Number(!!b.iba) - Number(!!a.iba) || a.name.localeCompare(b.name));
}

function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const k = norm(n);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Ingredient names known to the catalog, for recognizing "gin" as an ingredient search. */
export function knownIngredients(drinks: Drink[]): Set<string> {
  const out = new Set<string>();
  for (const d of drinks) for (const i of d.ingredients) out.add(norm(i.name));
  return out;
}

export function isKnownIngredient(term: string, known: Set<string>): boolean {
  const c = canonical(term);
  if (!c) return false;
  if (known.has(c)) return true;
  return [...known].some((k) => covers(c, k));
}

// ---------------------------------------------------------------------------
// Queries

export type Query =
  | { kind: "empty" }
  | { kind: "random" }
  | { kind: "with"; bar: string[] }
  | { kind: "name"; text: string };

export function parseQuery(query: string): Query {
  const q = query.trim();
  if (!q) return { kind: "empty" };
  if (/^(random|surprise( me)?|au hasard|hasard|surprise-moi|\?)$/i.test(q)) return { kind: "random" };
  const w = /^(?:with|avec|using|i have|j'ai)\s*:?\s+(.+)$/i.exec(q);
  if (w) {
    const bar = parseBar(w[1]);
    if (bar.length) return { kind: "with", bar };
  }
  if (/[,;+]/.test(q)) {
    const bar = parseBar(q);
    if (bar.length > 1) return { kind: "with", bar };
  }
  return { kind: "name", text: q };
}

// ---------------------------------------------------------------------------
// Text

export const drinkUrl = (d: Drink) =>
  `${SITE}/drink/${d.id}-${d.name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;

/** The small picture, for list icons (TheCocktailDB serves /small, /medium and /large). */
export const thumb = (d: Drink, size: "small" | "medium" | "large" = "small") =>
  d.thumb ? `${d.thumb}/${size}` : undefined;

export const ALCOHOL_TITLE: Record<Alcohol, string> = {
  alcoholic: "Alcoholic",
  "non-alcoholic": "Non-alcoholic",
  optional: "Optional alcohol",
};

export function ingredientLine(i: Ingredient, units: Units): string {
  if (!i.measure) return i.name;
  const m = convertMeasure(i.measure, units);
  return `${m.text}${m.converted ? ` (${m.converted})` : ""} ${i.name}`;
}

/** The recipe as plain text, for the clipboard. */
export function recipeText(d: Drink, units: Units, lang: Language): string {
  const lines = [d.name, ""];
  for (const i of d.ingredients) lines.push(`- ${ingredientLine(i, units)}`);
  if (d.glass) lines.push("", `Glass: ${d.glass}`);
  const how = instructionsIn(d, lang).text;
  if (how) lines.push("", how);
  return lines.join("\n");
}

/** One line per ingredient, deduplicated: a shopping list. */
export function shoppingList(drinks: Drink[]): string {
  const names = uniqueNames(drinks.flatMap((d) => d.ingredients.map((i) => i.name)));
  return names.filter((n) => !isStaple(n)).map((n) => `- ${n}`).join("\n");
}

/** Markdown for the side panel. */
export function recipeMarkdown(d: Drink, units: Units, lang: Language): string {
  const how = instructionsIn(d, lang);
  const lines = [`## ${d.name}`, ""];
  if (d.ingredients.length) {
    lines.push("| Amount | Ingredient |", "|---|---|");
    for (const i of d.ingredients) {
      const m = i.measure ? convertMeasure(i.measure, units) : undefined;
      const amount = m ? `${m.text}${m.converted ? ` (${m.converted})` : ""}` : "";
      lines.push(`| ${amount.replace(/\|/g, "/")} | ${i.name} |`);
    }
    lines.push("");
  }
  if (how.text) {
    lines.push(how.text);
    if (how.lang !== lang) lines.push("", `*Not available in ${LANGUAGES[lang]}: shown in English.*`);
  }
  return lines.join("\n");
}

/** A favorite, kept with the whole drink so the list works offline. */
export interface Favorite {
  drink: Drink;
  added: number;
}

export function toggleFavorite(list: Favorite[], drink: Drink, now = Date.now()): Favorite[] {
  return list.some((f) => f.drink.id === drink.id)
    ? list.filter((f) => f.drink.id !== drink.id)
    : [...list, { drink, added: now }];
}

export const EXAMPLES: { query: string; title: string }[] = [
  { query: "margarita", title: "Search by name" },
  { query: "gin", title: "Cocktails with an ingredient" },
  { query: "with rum, lime, mint", title: "What you can make with these" },
  { query: "avec vodka, citron vert", title: "Same, in French" },
  { query: "random", title: "A random cocktail" },
];
