// Mealie's API (Bearer token; households in Mealie 2, groups before) and
// Grocy's API (GROCY-API-KEY header).

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  addDays,
  apiError,
  type GrocyProduct,
  grocyShopping,
  type GrocyShoppingItem,
  type GrocyShoppingRow,
  type GrocyStockRow,
  type GrocyVolatile,
  isAllowedHost,
  isoDate,
  type MealPlanEntry,
  normalizeUrl,
  type Recipe,
  type RecipeSummary,
  type ShoppingItem,
  type ShoppingList,
  type StockItem,
  stockItems,
} from "./lib.ts";

type Service = "Mealie" | "Grocy";

export class SetupError extends Error {
  constructor(message: string, readonly service: Service, readonly base?: string) {
    super(message);
  }
}

/** A route this server doesn't have: an older or newer version. */
export class NotFound extends Error {}

export interface Server {
  service: Service;
  base: string;
  key: string;
}

function server(service: Service, url: unknown, key: unknown): Server {
  const base = normalizeUrl(url);
  if (!base) throw new SetupError(`Add the address of your ${service} server`, service);
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${url}” is not an address`, service);
  }
  if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`, service);
  const k = String(key ?? "").trim().replace(/^Bearer\s+/i, "");
  if (!k) throw new SetupError(service === "Mealie" ? "Add a Mealie API token" : "Add a Grocy API key", service, base);
  return { service, base, key: k };
}

export const mealie = (prefs: Record<string, unknown>) => server("Mealie", prefs.mealieUrl, prefs.mealieToken);
export const grocy = (prefs: Record<string, unknown>) => server("Grocy", prefs.grocyUrl, prefs.grocyApiKey);

export const hasMealie = (prefs: Record<string, unknown>) => !!String(prefs.mealieUrl ?? "").trim();
export const hasGrocy = (prefs: Record<string, unknown>) => !!String(prefs.grocyUrl ?? "").trim();

export async function call<T>(
  s: Server,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  let res: Response;
  try {
    res = await fetch(`${s.base}/api${path}`, {
      method: o.method ?? "GET",
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
      headers: {
        Accept: "application/json",
        ...(s.service === "Mealie" ? { Authorization: `Bearer ${s.key}` } : { "GROCY-API-KEY": s.key }),
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(s.base).hostname} is outside the networks this extension may reach`, s.service);
    }
    throw new SetupError(
      `Can't reach ${s.service} at ${new URL(s.base).host}: ${(e as Error).message}`,
      s.service,
      s.base,
    );
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    if (res.ok) {
      throw new SetupError(`${s.base} answers, but not as ${s.service}: check the address`, s.service, s.base);
    }
  }
  if (!res.ok) {
    const message = apiError(s.service, res.status, json);
    if (res.status === 401 || res.status === 403) throw new SetupError(message, s.service, s.base);
    if (res.status === 404 || res.status === 405) throw new NotFound(message);
    throw new Error(message);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Mealie

type Page<T> = { items: T[]; total?: number };

const households = new Map<string, string>();

/** `/households` (Mealie 2) or `/groups` (Mealie 1), found once per server. */
async function scoped<T>(s: Server, path: string, o: Parameters<typeof call>[2] = {}): Promise<T> {
  const known = households.get(s.base) ?? await storage.get<string>(`scope:${s.base}`).catch(() => undefined);
  const order = known === "groups" ? ["groups", "households"] : ["households", "groups"];
  for (const [i, scope] of order.entries()) {
    try {
      const r = await call<T>(s, `/${scope}${path}`, o);
      if (known !== scope) {
        households.set(s.base, scope);
        await storage.set(`scope:${s.base}`, scope).catch(() => {});
      }
      return r;
    } catch (e) {
      if (!(e instanceof NotFound) || i === order.length - 1) throw e;
    }
  }
  throw new Error("unreachable");
}

export async function searchRecipes(s: Server, query: string, signal?: AbortSignal): Promise<RecipeSummary[]> {
  const p = new URLSearchParams({ page: "1", perPage: "40" });
  if (query.trim()) p.set("search", query.trim());
  else {
    p.set("orderBy", "updated_at");
    p.set("orderDirection", "desc");
  }
  try {
    return (await call<Page<RecipeSummary>>(s, `/recipes?${p}`, { signal })).items;
  } catch (e) {
    if (signal?.aborted || query.trim()) throw e;
    // An older Mealie that doesn't sort by this field.
    return (await call<Page<RecipeSummary>>(s, "/recipes?page=1&perPage=40", { signal })).items;
  }
}

const recipeKey = (s: Server, r: Pick<RecipeSummary, "slug" | "dateUpdated" | "updatedAt">) =>
  `recipe:${s.base}:${r.slug}:${r.dateUpdated ?? r.updatedAt ?? ""}`;

/** A full recipe, cached as long as it isn't updated. */
export async function recipe(
  s: Server,
  r: Pick<RecipeSummary, "slug" | "dateUpdated" | "updatedAt">,
  signal?: AbortSignal,
): Promise<Recipe> {
  const key = recipeKey(s, r);
  const saved = await storage.get(key).catch(() => undefined) as Recipe | undefined;
  if (saved) return saved;
  const full = await call<Recipe>(s, `/recipes/${encodeURIComponent(r.slug)}`, { signal });
  const keep: Recipe = {
    ...full,
    recipeIngredient: full.recipeIngredient?.map((i) => ({
      quantity: i.quantity,
      unit: i.unit
        ? {
          name: i.unit.name,
          abbreviation: i.unit.abbreviation,
          useAbbreviation: i.unit.useAbbreviation,
          pluralName: i.unit.pluralName,
        }
        : null,
      food: i.food ? { name: i.food.name, pluralName: i.food.pluralName } : null,
      note: i.note,
      display: i.display,
      title: i.title,
    })),
    recipeInstructions: full.recipeInstructions?.map((x) => ({ title: x.title, text: x.text })),
  };
  await storage.set(key, keep as unknown as Parameters<typeof storage.set>[1]).catch(() => {});
  return keep;
}

/** Full recipes for the first results, as many as fit before the deadline. */
export async function recipes(s: Server, list: RecipeSummary[], o: { deadline?: number; signal?: AbortSignal } = {}) {
  const out = new Map<string, Recipe>();
  const queue = [...list];
  const until = Date.now() + (o.deadline ?? 2500);
  const worker = async () => {
    while (queue.length && Date.now() < until && !o.signal?.aborted) {
      const r = queue.shift()!;
      try {
        out.set(r.slug, await recipe(s, r, AbortSignal.timeout(Math.max(500, until - Date.now()))));
      } catch {
        // Shown with its description only.
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

/** The group slug of recipe links in Mealie 2. */
export async function groupSlug(s: Server, signal?: AbortSignal): Promise<string | undefined> {
  const key = `group:${s.base}`;
  const saved = await storage.get<string>(key).catch(() => undefined);
  if (saved !== undefined) return saved || undefined;
  const me = await call<{ groupSlug?: string }>(s, "/users/self", { signal }).catch(() => undefined);
  if (!me) return undefined;
  await storage.set(key, me.groupSlug ?? "").catch(() => {});
  return me.groupSlug;
}

export async function mealPlan(s: Server, days = 7, signal?: AbortSignal): Promise<MealPlanEntry[]> {
  const now = new Date();
  const p = new URLSearchParams({
    start_date: isoDate(now),
    end_date: isoDate(addDays(now, days - 1)),
    perPage: "100",
    page: "1",
  });
  const r = await scoped<Page<MealPlanEntry> | MealPlanEntry[]>(s, `/mealplans?${p}`, { signal });
  return Array.isArray(r) ? r : r.items;
}

export async function planRecipe(s: Server, recipeId: string, date: string, entryType = "dinner"): Promise<void> {
  await scoped(s, "/mealplans", { method: "POST", body: { date, entryType, recipeId, title: "", text: "" } });
}

export async function shoppingLists(s: Server, signal?: AbortSignal): Promise<ShoppingList[]> {
  const r = await scoped<Page<ShoppingList>>(s, "/shopping/lists?perPage=50&page=1", { signal });
  return r.items.map((l) => ({ id: l.id, name: l.name }));
}

export async function shoppingItems(s: Server, list: ShoppingList, signal?: AbortSignal): Promise<ShoppingItem[]> {
  const r = await scoped<{ listItems?: ShoppingItem[] }>(s, `/shopping/lists/${list.id}`, { signal });
  return r.listItems ?? [];
}

export async function addShoppingItem(s: Server, list: ShoppingList, note: string, quantity = 1): Promise<void> {
  await scoped(s, "/shopping/items", {
    method: "POST",
    body: { shoppingListId: list.id, note, quantity, isFood: false, checked: false, display: note },
  });
}

export async function setChecked(s: Server, item: ShoppingItem, checked: boolean): Promise<void> {
  await scoped(s, `/shopping/items/${item.id}`, { method: "PUT", body: { ...item, checked } });
}

export async function deleteShoppingItem(s: Server, item: ShoppingItem): Promise<void> {
  await scoped(s, `/shopping/items/${item.id}`, { method: "DELETE" });
}

/** A recipe's ingredients onto a list: the bulk route of Mealie 2, the older per-recipe one otherwise. */
export async function addRecipeToList(s: Server, list: ShoppingList, recipeId: string): Promise<void> {
  try {
    await scoped(s, `/shopping/lists/${list.id}/recipe`, {
      method: "POST",
      body: [{ recipeId, recipeIncrementQuantity: 1 }],
    });
  } catch (e) {
    if (!(e instanceof NotFound) && !/answered 422/.test((e as Error).message)) throw e;
    await scoped(s, `/shopping/lists/${list.id}/recipe/${recipeId}`, { method: "POST", body: {} });
  }
}

// ---------------------------------------------------------------------------
// Grocy

interface GrocyNames {
  products: Map<string, GrocyProduct>;
  units: Map<string, { name: string; name_plural?: string | null }>;
  locations: Map<string, string>;
}

export async function grocyNames(s: Server, signal?: AbortSignal): Promise<GrocyNames> {
  const [products, units, locations] = await Promise.all([
    call<GrocyProduct[]>(s, "/objects/products", { signal }),
    call<{ id: number | string; name: string; name_plural?: string | null }[]>(s, "/objects/quantity_units", { signal })
      .catch(() => []),
    call<{ id: number | string; name: string }[]>(s, "/objects/locations", { signal }).catch(() => []),
  ]);
  return {
    products: new Map(products.map((p) => [String(p.id), p])),
    units: new Map(units.map((u) => [String(u.id), u])),
    locations: new Map(locations.map((l) => [String(l.id), l.name])),
  };
}

export async function stock(s: Server, dueSoonDays: number, signal?: AbortSignal): Promise<StockItem[]> {
  const [rows, volatile, names] = await Promise.all([
    call<GrocyStockRow[]>(s, "/stock", { signal }),
    call<GrocyVolatile>(s, `/stock/volatile?due_soon_days=${dueSoonDays}`, { signal }),
    grocyNames(s, signal),
  ]);
  return stockItems(rows, volatile, names);
}

export async function consume(s: Server, productId: string, amount: number, spoiled = false): Promise<void> {
  await call(s, `/stock/products/${productId}/consume`, {
    method: "POST",
    body: { amount, transaction_type: "consume", spoiled },
  });
}

export async function openProduct(s: Server, productId: string, amount = 1): Promise<void> {
  await call(s, `/stock/products/${productId}/open`, { method: "POST", body: { amount } });
}

export async function grocyAddProductToList(s: Server, productId: string, amount = 1, listId = 1): Promise<void> {
  await call(s, "/stock/shoppinglist/add-product", {
    method: "POST",
    body: { product_id: Number(productId), list_id: listId, product_amount: amount },
  });
}

export async function grocyShoppingList(s: Server, signal?: AbortSignal): Promise<GrocyShoppingItem[]> {
  const [rows, products] = await Promise.all([
    call<GrocyShoppingRow[]>(s, "/objects/shopping_list", { signal }),
    call<GrocyProduct[]>(s, "/objects/products", { signal }),
  ]);
  return grocyShopping(rows, new Map(products.map((p) => [String(p.id), p])));
}

export async function grocyAddNote(s: Server, note: string, amount = 1, listId = 1): Promise<void> {
  await call(s, "/objects/shopping_list", { method: "POST", body: { note, amount, shopping_list_id: listId } });
}

export async function grocySetDone(s: Server, item: GrocyShoppingItem, done: boolean): Promise<void> {
  await call(s, `/objects/shopping_list/${item.id}`, { method: "PUT", body: { done: done ? 1 : 0 } });
}

export async function grocyDeleteItem(s: Server, item: GrocyShoppingItem): Promise<void> {
  await call(s, `/objects/shopping_list/${item.id}`, { method: "DELETE" });
}

export async function grocyAddMissing(s: Server, listId = 1): Promise<void> {
  await call(s, "/stock/shoppinglist/add-missing-products", { method: "POST", body: { list_id: listId } });
}

// ---------------------------------------------------------------------------
// Setup

export function setupItem(e: SetupError): Item {
  const configure = "**Settings → Extensions → Mealie & Grocy → Configure**";
  const how = e.service === "Mealie"
    ? [
      "## Connect Mealie",
      "",
      `In ${configure}, set the address you open in the browser (\`http://mealie.local:9925\`, \`http://192.168.1.20:9000\`)`,
      "and an API token: in Mealie, open your **profile → Manage Your API Tokens**, name one and **Generate**.",
    ]
    : [
      "## Connect Grocy",
      "",
      `In ${configure}, set the address you open in the browser (\`http://grocy.local\`, \`http://192.168.1.20:9283\`)`,
      "and an API key: in Grocy, open **Settings (the wrench) → Manage API keys → Add**.",
    ];
  return {
    id: `setup:${e.service}`,
    title: e.message,
    subtitle: `${e.service} settings`,
    icon: { source: /token|key/i.test(e.message) ? Icons.key : Icons.plug, tint: "orange" },
    detail: {
      markdown: [
        ...how,
        "",
        "Addresses can be this computer, local names (`*.local`, `*.lan`, `*.home.arpa`, `mealie`, `grocy`…), private",
        "networks (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`), Tailscale (`100.64.x.x`, `*.ts.net`) or DuckDNS.",
      ].join("\n"),
    },
    actions: e.base ? [open(e.base, `Open ${e.service}`, { icon: Icons.globe })] : [],
  };
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return [setupItem(e)];
    throw e;
  }
}
