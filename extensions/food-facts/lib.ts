// Open Food Facts: URLs, product parsing, scores, allergens, additives and the nutrition table. No I/O.

/** Same list as `[permissions] net` in backslash.toml. */
export const HOSTS = ["world.openfoodfacts.org", "search.openfoodfacts.org", "images.openfoodfacts.org"];

/** Open Food Facts asks every app to say who it is: name/version (contact). */
export const USER_AGENT = "Backslash-FoodFacts/1.0 (https://github.com/backslash-app/plugins)";

const FIELDS = [
  "code",
  "product_name",
  "generic_name",
  "brands",
  "quantity",
  "nutriscore_grade",
  "nova_group",
  "ecoscore_grade",
  "environmental_score_grade",
  "image_front_url",
  "image_front_small_url",
  "allergens_tags",
  "traces_tags",
  "additives_tags",
  "labels_tags",
  "categories_tags",
  "countries_tags",
  "nutriments",
  "nutrient_levels",
  "ingredients_text",
  "serving_size",
  "stores",
];

/** Product names in the user's language come as product_name_<lc>. */
export function fields(lang: string): string {
  return [...FIELDS, `product_name_${lang}`, `generic_name_${lang}`, `ingredients_text_${lang}`].join(",");
}

export function productUrl(code: string, lang = "en"): string {
  return `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?lc=${lang}&fields=${
    fields(lang)
  }`;
}

export function searchUrl(query: string, lang = "en", size = 24): string {
  const langs = lang === "en" ? "en" : `${lang},en`;
  return `https://search.openfoodfacts.org/search?q=${
    encodeURIComponent(query)
  }&page_size=${size}&langs=${langs}&fields=${fields(lang)}`;
}

export const pageUrl = (code: string) => `https://world.openfoodfacts.org/product/${code}`;
export const editUrl = (code: string) => `https://world.openfoodfacts.org/cgi/product.pl?type=edit&code=${code}`;

/** The user's language from the preference: a two-letter code, "en" by default. */
export function langOf(pref: unknown): string {
  const l = String(pref ?? "").trim().toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(l) ? l : "en";
}

// ---------------------------------------------------------------------------
// Barcodes

/** An EAN-8, UPC-A, EAN-13 or GTIN-14 in some text: spaces and dashes ignored. */
export function findBarcode(text: unknown): string | undefined {
  const s = String(text ?? "").trim();
  const m = s.replace(/[\s-]/g, "").match(/^\d{8}$|^\d{12,14}$/) ??
    s.match(/(?:^|\D)(\d{13}|\d{12}|\d{8}|\d{14})(?:\D|$)/);
  if (!m) return undefined;
  return (m[1] ?? m[0]).replace(/[\s-]/g, "");
}

/** GS1 check digit of an EAN/UPC. */
export function validBarcode(code: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(code)) return false;
  const digits = code.split("").map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

// ---------------------------------------------------------------------------
// Products

export interface Nutrient {
  id: string;
  title: string;
  value: number;
  unit: string;
  level?: "low" | "moderate" | "high";
  indent?: boolean;
}

export interface Product {
  code: string;
  name: string;
  generic?: string;
  brands: string[];
  quantity?: string;
  nutriscore?: string;
  nova?: number;
  ecoscore?: string;
  image?: string;
  thumbnail?: string;
  allergens: string[];
  traces: string[];
  additives: string[];
  labels: string[];
  categories: string[];
  nutrients: Nutrient[];
  ingredients?: string;
  serving?: string;
}

const list = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map(String).filter(Boolean)
    : typeof v === "string" && v
    ? v.split(",").map((s) => s.trim())
    : [];

const text = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : undefined;

/** "a" … "e"; "unknown", "not-applicable" and the rest are dropped. */
export function grade(v: unknown): string | undefined {
  const g = String(v ?? "").toLowerCase();
  return /^[a-e]$/.test(g) ? g : g === "a-plus" ? "a+" : undefined;
}

/** "en:nuts" → "Nuts", "fr:fruits-a-coque" → "Fruits a coque", "en:e322i" → "E322i". */
export function tagName(tag: string): string {
  const t = tag.replace(/^[a-z]{2}:/, "").replace(/-/g, " ").trim();
  if (/^e\d{3}/i.test(t)) return t.toUpperCase().replace(/(\d)([A-Z]+)$/, (_, d, s) => d + s.toLowerCase());
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** The common additives by E number, for a readable list. */
export const ADDITIVES: Record<string, string> = {
  E100: "Curcumin",
  E150a: "Plain caramel",
  E150d: "Sulphite ammonia caramel",
  E160a: "Carotenes",
  E170: "Calcium carbonate",
  E202: "Potassium sorbate",
  E211: "Sodium benzoate",
  E250: "Sodium nitrite",
  E252: "Potassium nitrate",
  E270: "Lactic acid",
  E290: "Carbon dioxide",
  E300: "Ascorbic acid",
  E301: "Sodium ascorbate",
  E306: "Tocopherol-rich extract",
  E322: "Lecithins",
  E322i: "Lecithin",
  E330: "Citric acid",
  E331: "Sodium citrates",
  E338: "Phosphoric acid",
  E407: "Carrageenan",
  E412: "Guar gum",
  E415: "Xanthan gum",
  E422: "Glycerol",
  E440: "Pectins",
  E450: "Diphosphates",
  E466: "Carboxymethyl cellulose",
  E471: "Mono- and diglycerides of fatty acids",
  E500: "Sodium carbonates",
  E503: "Ammonium carbonates",
  E621: "Monosodium glutamate",
  E950: "Acesulfame K",
  E951: "Aspartame",
  E955: "Sucralose",
};

export function additiveName(tag: string): string {
  const code = tagName(tag);
  const name = ADDITIVES[code];
  return name ? `${code} ${name}` : code;
}

const NUTRIENTS: { id: string; title: string; unit?: string; indent?: boolean; level?: string }[] = [
  { id: "energy-kcal", title: "Energy", unit: "kcal" },
  { id: "fat", title: "Fat", level: "fat" },
  { id: "saturated-fat", title: "Saturated fat", indent: true, level: "saturated-fat" },
  { id: "carbohydrates", title: "Carbohydrates" },
  { id: "sugars", title: "Sugars", indent: true, level: "sugars" },
  { id: "fiber", title: "Fibre" },
  { id: "proteins", title: "Proteins" },
  { id: "salt", title: "Salt", level: "salt" },
];

/** Values per 100 g (or 100 ml) from `nutriments`, with the traffic-light levels. */
export function parseNutrients(nutriments: unknown, levels: unknown = {}): Nutrient[] {
  if (!nutriments || typeof nutriments !== "object") return [];
  const n = nutriments as Record<string, unknown>;
  const lv = (levels ?? {}) as Record<string, string>;
  const out: Nutrient[] = [];
  for (const d of NUTRIENTS) {
    let raw = n[`${d.id}_100g`];
    const unit = d.unit ?? "g";
    if (d.id === "energy-kcal" && (raw === undefined || raw === "")) {
      // Only kJ given (energy_100g is in kJ too): convert.
      const kj = Number(n["energy-kj_100g"] ?? n["energy_100g"]);
      if (Number.isFinite(kj) && kj > 0) raw = Math.round(kj / 4.184);
    }
    const value = Number(raw);
    // The *_100g values are normalized by Open Food Facts: grams, whatever the label said.
    if (raw === undefined || raw === null || raw === "" || !Number.isFinite(value)) continue;
    const level = d.level ? lv[d.level] : undefined;
    out.push({
      id: d.id,
      title: d.title,
      value,
      unit,
      indent: d.indent,
      level: level === "low" || level === "moderate" || level === "high" ? level : undefined,
    });
  }
  return out;
}

/** One product of the API (v2 product or search hit). */
export function parseProduct(raw: unknown, lang = "en"): Product | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const p = raw as Record<string, unknown>;
  const code = String(p.code ?? "").trim();
  if (!code) return undefined;
  const name = text(p[`product_name_${lang}`]) ?? text(p.product_name) ?? text(p.generic_name);
  const nutrients = parseNutrients(p.nutriments, p.nutrient_levels);
  const brands = list(p.brands).filter((b, i, a) => a.findIndex((x) => x.toLowerCase() === b.toLowerCase()) === i);
  // An entry with nothing in it is as good as unknown.
  if (!name && !brands.length && !nutrients.length) return undefined;
  const nova = Number(p.nova_group);
  return {
    code,
    name: name ?? `Product ${code}`,
    generic: text(p[`generic_name_${lang}`]) ?? text(p.generic_name),
    brands,
    quantity: text(p.quantity),
    nutriscore: grade(p.nutriscore_grade),
    nova: nova >= 1 && nova <= 4 ? nova : undefined,
    ecoscore: grade(p.environmental_score_grade) ?? grade(p.ecoscore_grade),
    image: text(p.image_front_url),
    thumbnail: text(p.image_front_small_url) ?? text(p.image_front_url),
    allergens: list(p.allergens_tags).map(tagName),
    traces: list(p.traces_tags).map(tagName),
    additives: list(p.additives_tags).map(additiveName),
    labels: list(p.labels_tags).map(tagName),
    categories: list(p.categories_tags).map(tagName),
    nutrients,
    ingredients: text(p[`ingredients_text_${lang}`]) ?? text(p.ingredients_text),
    serving: text(p.serving_size),
  };
}

/** `{ status: 1, product }` → the product, `{ status: 0 }` → undefined. */
export function parseProductResponse(json: unknown, lang = "en"): Product | undefined {
  const o = json as { status?: unknown; product?: unknown };
  if (!o || Number(o.status) !== 1) return undefined;
  return parseProduct(o.product, lang);
}

/** search.openfoodfacts.org → products and the total count. */
export function parseSearch(json: unknown, lang = "en"): { products: Product[]; count: number } {
  const o = json as { hits?: unknown; count?: unknown };
  const products = (Array.isArray(o?.hits) ? o.hits : []).flatMap((h) => parseProduct(h, lang) ?? []);
  return { products, count: Number(o?.count) || products.length };
}

// ---------------------------------------------------------------------------
// Looks

export type Tint = "green" | "teal" | "yellow" | "orange" | "red" | "gray";

export const GRADE_TINT: Record<string, Tint> = {
  "a+": "green",
  a: "green",
  b: "teal",
  c: "yellow",
  d: "orange",
  e: "red",
};

export const NOVA: Record<number, { title: string; tint: Tint }> = {
  1: { title: "Unprocessed or minimally processed", tint: "green" },
  2: { title: "Processed culinary ingredients", tint: "yellow" },
  3: { title: "Processed foods", tint: "orange" },
  4: { title: "Ultra-processed foods", tint: "red" },
};

export const LEVEL: Record<string, { dot: string; title: string }> = {
  low: { dot: "🟢", title: "low" },
  moderate: { dot: "🟠", title: "moderate" },
  high: { dot: "🔴", title: "high" },
};

const fmt = (v: number) =>
  v >= 100 ? String(Math.round(v)) : v >= 10 ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v * 100) / 100);

export function nutritionTable(nutrients: Nutrient[]): string {
  if (!nutrients.length) return "_No nutrition facts yet._";
  return [
    "| Per 100 g | | |",
    "|---|---:|---|",
    ...nutrients.map((n) =>
      `| ${n.indent ? `of which ${n.title.toLowerCase()}` : `**${n.title}**`} | ${fmt(n.value)} ${n.unit} | ${
        n.level ? `${LEVEL[n.level].dot} ${LEVEL[n.level].title}` : ""
      } |`
    ),
  ].join("\n");
}

/** "Ferrero · 400 g" */
export function subtitle(p: Product): string {
  return [p.brands.slice(0, 2).join(", "), p.quantity].filter(Boolean).join(" · ");
}

/** The markdown of the preview panel. */
export function productMarkdown(p: Product): string {
  const lines = [`## ${p.name}`];
  if (p.generic && p.generic !== p.name) lines.push(`_${p.generic}_`);
  lines.push("", nutritionTable(p.nutrients));
  if (p.allergens.length) lines.push("", `**Allergens:** ${p.allergens.join(", ")}`);
  if (p.traces.length) lines.push("", `**May contain:** ${p.traces.join(", ")}`);
  lines.push(
    "",
    p.additives.length ? `**Additives (${p.additives.length}):** ${p.additives.join(", ")}` : "**No additives**",
  );
  if (p.ingredients) {
    lines.push(
      "",
      "**Ingredients**",
      "",
      p.ingredients.length > 900 ? `${p.ingredients.slice(0, 900)}…` : p.ingredients,
    );
  }
  return lines.join("\n");
}

/** A line to share: "Nutella (Ferrero, 400 g): Nutri-Score E, NOVA 4, Eco-Score D". */
export function shareLine(p: Product): string {
  const scores = [
    p.nutriscore ? `Nutri-Score ${p.nutriscore.toUpperCase()}` : "",
    p.nova ? `NOVA ${p.nova}` : "",
    p.ecoscore ? `Eco-Score ${p.ecoscore.toUpperCase()}` : "",
  ].filter(Boolean);
  const sub = subtitle(p);
  return `${p.name}${sub ? ` (${sub.replace(" · ", ", ")})` : ""}${scores.length ? `: ${scores.join(", ")}` : ""}`;
}
