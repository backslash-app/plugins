// Mealie recipes, meal plans and shopping lists, and Grocy stock: their API
// shapes, ingredients as text, dates and the links to them.

/**
 * Where Mealie and Grocy usually run, as declared in `[permissions] net`
 * (kept equal by a test). Extensions declare their hosts statically.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "mealie",
  "grocy",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.duckdns.org",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `mealie.local:9925/g/home` or `…/api` → `http://mealie.local:9925`; a sub-path is kept. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const u = new URL(url);
    const path = u.pathname
      .replace(/\/(api|g\/[\w-]+.*|recipes?.*|login|stockoverview|shoppinglist)\/?$/i, "")
      .replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "";
  }
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "Today", "Tomorrow", "Friday 30 October". */
export function dayTitle(date: string, now = new Date()): string {
  if (date === isoDate(now)) return "Today";
  if (date === isoDate(addDays(now, 1))) return "Tomorrow";
  if (date === isoDate(addDays(now, -1))) return "Yesterday";
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

/** Days from today to a date (negative: in the past). */
export function daysUntil(date: string, now = new Date()): number {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  const target = new Date(y, m - 1, d).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86_400_000);
}

/** "today", "tomorrow", "in 3 days", "2 days ago". */
export function relativeDays(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

// ---------------------------------------------------------------------------
// Mealie

export interface RecipeSummary {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  image?: string | null;
  totalTime?: string | null;
  prepTime?: string | null;
  performTime?: string | null;
  cookTime?: string | null;
  recipeYield?: string | null;
  recipeServings?: number | null;
  rating?: number | null;
  tags?: { name: string }[] | null;
  recipeCategory?: { name: string }[] | null;
  dateUpdated?: string | null;
  updatedAt?: string | null;
}

export interface Ingredient {
  quantity?: number | null;
  unit?: { name?: string; abbreviation?: string; useAbbreviation?: boolean; pluralName?: string | null } | null;
  food?: { name?: string; pluralName?: string | null } | null;
  note?: string | null;
  display?: string | null;
  originalText?: string | null;
  title?: string | null;
}

export interface Recipe extends RecipeSummary {
  recipeIngredient?: Ingredient[];
  recipeInstructions?: { id?: string; title?: string | null; text?: string | null }[];
  orgURL?: string | null;
  notes?: { title?: string; text?: string }[] | null;
}

/** 0.5 → "½", 1.333 → "1⅓", 2 → "2". */
export function fraction(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const rest = n - whole;
  const glyphs: [number, string][] = [[1 / 4, "¼"], [1 / 3, "⅓"], [1 / 2, "½"], [2 / 3, "⅔"], [3 / 4, "¾"]];
  const g = glyphs.find(([v]) => Math.abs(rest - v) < 0.02);
  if (rest < 0.02) return String(whole);
  if (g) return `${whole || ""}${g[1]}`;
  return String(Math.round(n * 100) / 100);
}

/** One ingredient as a line: "200 g flour, sifted". */
export function ingredientText(i: Ingredient): string {
  if (i.display?.trim()) return i.display.trim();
  const parts: string[] = [];
  if (i.quantity) parts.push(fraction(i.quantity));
  if (i.unit?.name) {
    parts.push(
      i.unit.useAbbreviation && i.unit.abbreviation
        ? i.unit.abbreviation
        : i.quantity && i.quantity > 1 && i.unit.pluralName
        ? i.unit.pluralName
        : i.unit.name,
    );
  }
  if (i.food?.name) parts.push(i.quantity && i.quantity > 1 && i.food.pluralName ? i.food.pluralName : i.food.name);
  const main = parts.join(" ");
  const note = i.note?.trim() ?? "";
  if (main && note) return `${main}, ${note}`;
  return main || note || i.originalText?.trim() || "";
}

/** "PT1H30M", "1 hour 30 minutes", "45 min" → "1 h 30 min" (text kept when unknown). */
export function duration(input: string | null | undefined): string | undefined {
  const s = String(input ?? "").trim();
  if (!s) return undefined;
  const iso = /^P(?:T)?(?:(\d+)H)?(?:(\d+)M)?$/i.exec(s);
  if (iso && (iso[1] || iso[2])) {
    const h = Number(iso[1] ?? 0), m = Number(iso[2] ?? 0);
    return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
  }
  return s;
}

/** The recipe picture Mealie serves without a token: `min-original` is about 600 px wide. */
export function recipeImage(
  base: string,
  r: Pick<RecipeSummary, "id" | "image">,
  size: "min" | "tiny" | "full" = "min",
): string | undefined {
  if (!r.image) return undefined;
  const file = size === "full" ? "original.webp" : `${size}-original.webp`;
  return `${base}/api/media/recipes/${r.id}/images/${file}?v=${encodeURIComponent(r.image)}`;
}

/** Recipes live under the group in Mealie 2 (`/g/home/r/slug`), at `/recipe/slug` before. */
export function recipeUrl(base: string, slug: string, groupSlug?: string): string {
  return groupSlug ? `${base}/g/${groupSlug}/r/${slug}` : `${base}/recipe/${slug}`;
}

export function recipeMarkdown(r: Recipe): string {
  const lines: string[] = [`### ${r.name}`];
  if (r.description?.trim()) lines.push("", r.description.trim());
  const ingredients = r.recipeIngredient ?? [];
  if (ingredients.length) {
    lines.push("", "**Ingredients**", "");
    for (const i of ingredients) {
      if (i.title?.trim()) lines.push("", `_${i.title.trim()}_`, "");
      const text = ingredientText(i);
      if (text) lines.push(`- ${text}`);
    }
  }
  const steps = (r.recipeInstructions ?? []).filter((s) => s.text?.trim());
  if (steps.length) {
    lines.push("", "**Steps**", "");
    steps.forEach((s, n) => {
      if (s.title?.trim()) lines.push("", `_${s.title.trim()}_`);
      lines.push(`${n + 1}. ${s.text!.trim().replace(/\n+/g, " ")}`);
    });
  }
  return lines.join("\n");
}

export function recipeTimes(r: RecipeSummary): { label: string; value: string }[] {
  return [
    ["Total", r.totalTime],
    ["Prep", r.prepTime],
    ["Cook", r.performTime ?? r.cookTime],
  ].flatMap(([label, v]) => {
    const d = duration(v);
    return d ? [{ label: label!, value: d }] : [];
  });
}

export function servings(r: RecipeSummary): string | undefined {
  if (r.recipeYield?.trim()) return r.recipeYield.trim();
  return r.recipeServings ? plural(r.recipeServings, "serving") : undefined;
}

/** The ingredient list as plain text, for the clipboard. */
export const ingredientsText = (r: Recipe) =>
  (r.recipeIngredient ?? []).map(ingredientText).filter(Boolean).map((t) => `- ${t}`).join("\n");

export interface MealPlanEntry {
  id: number | string;
  date: string;
  entryType?: string;
  title?: string | null;
  text?: string | null;
  recipeId?: string | null;
  recipe?: RecipeSummary | null;
}

export const ENTRY_ORDER = ["breakfast", "lunch", "dinner", "side", "snack", "drink", "dessert"];

export function sortMeals(list: MealPlanEntry[]): MealPlanEntry[] {
  const rank = (t?: string) => {
    const i = ENTRY_ORDER.indexOf(String(t ?? "").toLowerCase());
    return i < 0 ? ENTRY_ORDER.length : i;
  };
  return [...list].sort((a, b) => a.date.localeCompare(b.date) || rank(a.entryType) - rank(b.entryType));
}

export const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

export interface ShoppingList {
  id: string;
  name: string;
}

export interface ShoppingItem {
  id: string;
  shoppingListId: string;
  checked: boolean;
  position?: number;
  quantity?: number;
  note?: string | null;
  display?: string | null;
  isFood?: boolean;
  food?: { name?: string } | null;
  unit?: { name?: string; abbreviation?: string } | null;
  label?: { name?: string; color?: string } | null;
  [key: string]: unknown;
}

export function shoppingText(i: ShoppingItem): string {
  if (i.display?.trim()) return i.display.trim();
  return ingredientText({
    quantity: i.quantity && i.quantity !== 1 ? i.quantity : undefined,
    unit: i.unit,
    food: i.food,
    note: i.note,
  }) ||
    "(empty)";
}

/** Unchecked first, in the list's order. */
export function sortShopping<T extends { checked: boolean; position?: number }>(list: T[]): T[] {
  return [...list].sort((a, b) => Number(a.checked) - Number(b.checked) || (a.position ?? 0) - (b.position ?? 0));
}

/** "2 eggs" → quantity 2 and note "eggs"; anything else is one item named by the text. */
export function parseItem(input: string): { quantity: number; note: string } {
  const s = input.trim().replace(/\s+/g, " ");
  const m = /^(\d+(?:[.,]\d+)?)\s*[x×]?\s+(.+)$/i.exec(s);
  if (m) return { quantity: Number(m[1].replace(",", ".")), note: m[2] };
  return { quantity: 1, note: s };
}

/** The list a name points to (case and accents aside), or the first one. */
export function pickList<T extends { name: string }>(lists: T[], name: unknown): T | undefined {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
  const wanted = fold(String(name ?? ""));
  return (wanted ? lists.find((l) => fold(l.name) === wanted) : undefined) ?? lists[0];
}

// ---------------------------------------------------------------------------
// Grocy

export interface GrocyProduct {
  id: number | string;
  name: string;
  description?: string | null;
  location_id?: number | string | null;
  qu_id_stock?: number | string | null;
  min_stock_amount?: number | string | null;
}

export interface GrocyStockRow {
  product_id: number | string;
  amount: number | string;
  amount_aggregated?: number | string;
  amount_opened?: number | string;
  amount_opened_aggregated?: number | string;
  best_before_date?: string | null;
  is_aggregated_amount?: number | string | boolean;
  product?: GrocyProduct;
}

export interface GrocyVolatile {
  due_products?: GrocyStockRow[];
  overdue_products?: GrocyStockRow[];
  expired_products?: GrocyStockRow[];
  missing_products?: {
    id: number | string;
    name: string;
    amount_missing: number | string;
    is_partly_in_stock?: number | string;
  }[];
}

export type StockState = "expired" | "overdue" | "due" | "missing" | "ok";

export interface StockItem {
  productId: string;
  name: string;
  amount: number;
  opened: number;
  unit?: string;
  location?: string;
  bestBefore?: string;
  state: StockState;
  missing?: number;
}

/** Grocy's "never expires" date. */
export const NEVER = "2999-12-31";

const num = (v: unknown) => Number(v) || 0;

export function stockItems(
  stock: GrocyStockRow[],
  volatile: GrocyVolatile,
  names: {
    products: Map<string, GrocyProduct>;
    units: Map<string, { name: string; name_plural?: string | null }>;
    locations: Map<string, string>;
  },
): StockItem[] {
  const state = new Map<string, StockState>();
  for (const r of volatile.expired_products ?? []) state.set(String(r.product_id), "expired");
  for (const r of volatile.overdue_products ?? []) {
    if (!state.has(String(r.product_id))) state.set(String(r.product_id), "overdue");
  }
  for (const r of volatile.due_products ?? []) {
    if (!state.has(String(r.product_id))) state.set(String(r.product_id), "due");
  }
  const product = (r: GrocyStockRow) => r.product ?? names.products.get(String(r.product_id));
  const out: StockItem[] = stock.map((r) => {
    const p = product(r);
    const amount = num(r.amount_aggregated ?? r.amount);
    const unit = p?.qu_id_stock != null ? names.units.get(String(p.qu_id_stock)) : undefined;
    return {
      productId: String(r.product_id),
      name: p?.name ?? `Product ${r.product_id}`,
      amount,
      opened: num(r.amount_opened_aggregated ?? r.amount_opened),
      unit: unit ? (amount === 1 ? unit.name : unit.name_plural || unit.name) : undefined,
      location: p?.location_id != null ? names.locations.get(String(p.location_id)) : undefined,
      bestBefore: r.best_before_date && !r.best_before_date.startsWith(NEVER)
        ? r.best_before_date.slice(0, 10)
        : undefined,
      state: state.get(String(r.product_id)) ?? "ok",
    };
  });
  const inStock = new Set(out.map((s) => s.productId));
  for (const m of volatile.missing_products ?? []) {
    const id = String(m.id);
    const existing = out.find((s) => s.productId === id);
    if (existing) {
      if (existing.state === "ok") existing.state = "missing";
      existing.missing = num(m.amount_missing);
      continue;
    }
    if (inStock.has(id)) continue;
    const p = names.products.get(id);
    const unit = p?.qu_id_stock != null ? names.units.get(String(p.qu_id_stock)) : undefined;
    out.push({
      productId: id,
      name: m.name,
      amount: 0,
      opened: 0,
      unit: unit?.name_plural || unit?.name,
      location: p?.location_id != null ? names.locations.get(String(p.location_id)) : undefined,
      state: "missing",
      missing: num(m.amount_missing),
    });
  }
  return out;
}

const STATE_RANK: Record<StockState, number> = { expired: 0, overdue: 1, due: 2, missing: 3, ok: 4 };

export function sortStock(list: StockItem[]): StockItem[] {
  return [...list].sort((a, b) =>
    STATE_RANK[a.state] - STATE_RANK[b.state] ||
    (a.bestBefore ?? NEVER).localeCompare(b.bestBefore ?? NEVER) ||
    a.name.localeCompare(b.name)
  );
}

export const STATE_TITLES: Record<StockState, string> = {
  expired: "Expired",
  overdue: "Past best before",
  due: "Due soon",
  missing: "Below minimum",
  ok: "In stock",
};

/** "3 pieces", "1.5 kg", "2 (1 opened)". */
export function amountText(s: Pick<StockItem, "amount" | "opened" | "unit">): string {
  const n = Math.round(s.amount * 100) / 100;
  return `${n}${s.unit ? ` ${s.unit}` : ""}${s.opened ? ` (${Math.round(s.opened * 100) / 100} opened)` : ""}`;
}

export interface GrocyShoppingRow {
  id: number | string;
  product_id?: number | string | null;
  note?: string | null;
  amount?: number | string;
  shopping_list_id?: number | string;
  done?: number | string | boolean;
}

export interface GrocyShoppingItem {
  id: string;
  listId: string;
  text: string;
  amount: number;
  checked: boolean;
  productId?: string;
}

export function grocyShopping(rows: GrocyShoppingRow[], products: Map<string, GrocyProduct>): GrocyShoppingItem[] {
  return rows.map((r) => {
    const product = r.product_id != null ? products.get(String(r.product_id)) : undefined;
    const name = product?.name ?? "";
    const note = r.note?.trim() ?? "";
    return {
      id: String(r.id),
      listId: String(r.shopping_list_id ?? 1),
      text: name && note ? `${name} (${note})` : name || note || "(empty)",
      amount: num(r.amount) || 1,
      checked: r.done === true || String(r.done) === "1",
      productId: r.product_id != null ? String(r.product_id) : undefined,
    };
  });
}

/** A Mealie or Grocy error as a sentence. */
export function apiError(service: "Mealie" | "Grocy", status: number, body: unknown): string {
  const b = body as { detail?: unknown; error_message?: string; message?: string } | undefined;
  if (status === 401 || status === 403) {
    return service === "Mealie"
      ? "Mealie refused the API token: generate a new one in your profile"
      : "Grocy refused the API key: check it in Settings";
  }
  const detail = typeof b?.detail === "string"
    ? b.detail
    : Array.isArray(b?.detail)
    ? b!.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join(", ")
    : (b?.detail as { message?: string })?.message ?? b?.error_message ?? b?.message;
  return `${service} answered ${status}${detail ? `: ${detail}` : ""}`;
}
