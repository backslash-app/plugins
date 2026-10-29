import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  amountText,
  apiError,
  daysUntil,
  dayTitle,
  duration,
  fraction,
  grocyShopping,
  HOSTS,
  ingredientsText,
  ingredientText,
  isAllowedHost,
  type MealPlanEntry,
  normalizeUrl,
  parseItem,
  pickList,
  type Recipe,
  recipeImage,
  recipeMarkdown,
  recipeTimes,
  recipeUrl,
  relativeDays,
  servings,
  shoppingText,
  sortMeals,
  sortShopping,
  sortStock,
  stockItems,
} from "./lib.ts";

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("mealie"));
  assert(isAllowedHost("grocy.home.arpa"));
  assert(isAllowedHost("172.20.0.5"));
  assert(!isAllowedHost("172.32.0.5"));
  assert(!isAllowedHost("recipes.example.com"));
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("mealie.local:9925/g/home"), "http://mealie.local:9925");
  assertEquals(normalizeUrl("http://192.168.1.20:9000/api"), "http://192.168.1.20:9000");
  assertEquals(normalizeUrl("https://nas.lan/grocy/stockoverview"), "https://nas.lan/grocy");
  assertEquals(normalizeUrl(" "), "");
});

Deno.test("ingredients as text", () => {
  assertEquals(fraction(0.5), "½");
  assertEquals(fraction(1.333), "1⅓");
  assertEquals(fraction(2), "2");
  assertEquals(fraction(0.15), "0.15");
  assertEquals(ingredientText({ display: " 2 cups flour " }), "2 cups flour");
  assertEquals(
    ingredientText({
      quantity: 200,
      unit: { name: "gram", abbreviation: "g", useAbbreviation: true },
      food: { name: "flour" },
      note: "sifted",
    }),
    "200 g flour, sifted",
  );
  assertEquals(ingredientText({ quantity: 3, food: { name: "egg", pluralName: "eggs" } }), "3 eggs");
  assertEquals(
    ingredientText({ quantity: 2, unit: { name: "clove", pluralName: "cloves" }, food: { name: "garlic" } }),
    "2 cloves garlic",
  );
  assertEquals(ingredientText({ note: "Salt to taste" }), "Salt to taste");
  assertEquals(ingredientText({ originalText: "a pinch of love" }), "a pinch of love");
});

Deno.test("durations and servings", () => {
  assertEquals(duration("PT1H30M"), "1 h 30 min");
  assertEquals(duration("PT45M"), "45 min");
  assertEquals(duration("1 hour"), "1 hour");
  assertEquals(duration(null), undefined);
  const r = {
    id: "1",
    slug: "s",
    name: "S",
    totalTime: "PT1H",
    prepTime: "15 min",
    performTime: null,
    cookTime: "PT45M",
    recipeServings: 4,
  };
  assertEquals(recipeTimes(r), [{ label: "Total", value: "1 h" }, { label: "Prep", value: "15 min" }, {
    label: "Cook",
    value: "45 min",
  }]);
  assertEquals(servings(r), "4 servings");
  assertEquals(servings({ ...r, recipeYield: "6 crêpes" }), "6 crêpes");
});

const RECIPE: Recipe = {
  id: "abc-123",
  slug: "crepes",
  name: "Crêpes",
  description: "Thin pancakes.",
  image: "Xy12",
  recipeIngredient: [
    {
      title: "Batter",
      quantity: 250,
      unit: { name: "gram", abbreviation: "g", useAbbreviation: true },
      food: { name: "flour" },
    },
    { quantity: 3, food: { name: "egg", pluralName: "eggs" } },
    { note: "" },
  ],
  recipeInstructions: [{ text: "Mix everything.\n\nRest 1 hour." }, { title: "Cook", text: "Cook in a hot pan." }, {
    text: " ",
  }],
};

Deno.test("recipe markdown, images and links", () => {
  assertEquals(
    recipeMarkdown(RECIPE),
    [
      "### Crêpes",
      "",
      "Thin pancakes.",
      "",
      "**Ingredients**",
      "",
      "",
      "_Batter_",
      "",
      "- 250 g flour",
      "- 3 eggs",
      "",
      "**Steps**",
      "",
      "1. Mix everything. Rest 1 hour.",
      "",
      "_Cook_",
      "2. Cook in a hot pan.",
    ].join("\n"),
  );
  assertEquals(ingredientsText(RECIPE), "- 250 g flour\n- 3 eggs");
  assertEquals(
    recipeImage("http://m:9000", RECIPE),
    "http://m:9000/api/media/recipes/abc-123/images/min-original.webp?v=Xy12",
  );
  assertEquals(recipeImage("http://m:9000", { id: "x", image: null }), undefined);
  assertEquals(recipeUrl("http://m", "crepes", "home"), "http://m/g/home/r/crepes");
  assertEquals(recipeUrl("http://m", "crepes"), "http://m/recipe/crepes");
});

Deno.test("meal plan order and days", () => {
  const meals: MealPlanEntry[] = [
    { id: 1, date: "2026-10-30", entryType: "dinner" },
    { id: 2, date: "2026-10-29", entryType: "dinner" },
    { id: 3, date: "2026-10-29", entryType: "breakfast" },
    { id: 4, date: "2026-10-29", entryType: "custom" },
  ];
  assertEquals(sortMeals(meals).map((m) => m.id), [3, 2, 4, 1]);
  const now = new Date(2026, 9, 29, 18);
  assertEquals(dayTitle("2026-10-29", now), "Today");
  assertEquals(dayTitle("2026-10-30", now), "Tomorrow");
  assertEquals(dayTitle("2026-11-02", now), "Monday 2 November");
  assertEquals(daysUntil("2026-11-01", now), 3);
  assertEquals(daysUntil("2026-10-27T00:00:00", now), -2);
  assertEquals(relativeDays(0), "today");
  assertEquals(relativeDays(-3), "3 days ago");
  assertEquals(relativeDays(4), "in 4 days");
});

Deno.test("shopping items", () => {
  assertEquals(parseItem("2 lemons"), { quantity: 2, note: "lemons" });
  assertEquals(parseItem("1,5 x  flour"), { quantity: 1.5, note: "flour" });
  assertEquals(parseItem("milk"), { quantity: 1, note: "milk" });
  assertEquals(parseItem("7up"), { quantity: 1, note: "7up" });
  assertEquals(shoppingText({ id: "1", shoppingListId: "l", checked: false, display: "2 lemons" }), "2 lemons");
  assertEquals(shoppingText({ id: "1", shoppingListId: "l", checked: false, quantity: 1, note: "Bread" }), "Bread");
  assertEquals(
    shoppingText({ id: "1", shoppingListId: "l", checked: false, quantity: 3, food: { name: "apples" } }),
    "3 apples",
  );
  assertEquals(
    sortShopping([{ checked: true, position: 0 }, { checked: false, position: 2 }, { checked: false, position: 1 }])
      .map((x) => x.position),
    [1, 2, 0],
  );
  const lists = [{ name: "Weekly" }, { name: "Épicerie" }];
  assertEquals(pickList(lists, "epicerie")?.name, "Épicerie");
  assertEquals(pickList(lists, "nope")?.name, "Weekly");
  assertEquals(pickList([], "x"), undefined);
  const g = grocyShopping(
    [
      { id: 1, product_id: 5, note: "organic", amount: "2", shopping_list_id: 1, done: "0" },
      { id: 2, product_id: null, note: "Candles", amount: 1, done: 1 },
    ],
    new Map([["5", { id: 5, name: "Milk" }]]),
  );
  assertEquals(g.map((i) => [i.text, i.amount, i.checked, i.productId]), [["Milk (organic)", 2, false, "5"], [
    "Candles",
    1,
    true,
    undefined,
  ]]);
});

Deno.test("grocy stock with its volatile states", () => {
  const names = {
    products: new Map([
      ["1", { id: 1, name: "Milk", qu_id_stock: 2, location_id: 1 }],
      ["2", { id: 2, name: "Yoghurt", qu_id_stock: 3, location_id: 1 }],
      ["3", { id: 3, name: "Rice", qu_id_stock: 4, location_id: 2 }],
      ["4", { id: 4, name: "Coffee", qu_id_stock: 4, location_id: 2 }],
    ]),
    units: new Map([["2", { name: "Pack", name_plural: "Packs" }], ["3", { name: "Piece", name_plural: "Pieces" }], [
      "4",
      { name: "kg" },
    ]]),
    locations: new Map([["1", "Fridge"], ["2", "Pantry"]]),
  };
  const items = stockItems(
    [
      { product_id: 1, amount: "2", amount_opened: "1", best_before_date: "2026-10-30" },
      { product_id: "2", amount: 4, best_before_date: "2026-10-20" },
      { product_id: 3, amount: 1, best_before_date: "2999-12-31" },
    ],
    {
      due_products: [{ product_id: 1, amount: 2 }],
      expired_products: [{ product_id: 2, amount: 4 }],
      missing_products: [{ id: 4, name: "Coffee", amount_missing: "1" }, { id: 3, name: "Rice", amount_missing: 2 }],
    },
    names,
  );
  assertEquals(items.map((i) => [i.name, i.state, i.unit, i.location, i.bestBefore]), [
    ["Milk", "due", "Packs", "Fridge", "2026-10-30"],
    ["Yoghurt", "expired", "Pieces", "Fridge", "2026-10-20"],
    ["Rice", "missing", "kg", "Pantry", undefined],
    ["Coffee", "missing", "kg", "Pantry", undefined],
  ]);
  assertEquals(items[2].missing, 2);
  assertEquals(sortStock(items).map((i) => i.name), ["Yoghurt", "Milk", "Coffee", "Rice"]);
  assertEquals(amountText(items[0]), "2 Packs (1 opened)");
  assertEquals(amountText({ amount: 1.5, opened: 0, unit: "kg" }), "1.5 kg");
});

Deno.test("errors", () => {
  assertEquals(apiError("Mealie", 401, undefined), "Mealie refused the API token: generate a new one in your profile");
  assertEquals(apiError("Mealie", 422, { detail: [{ msg: "field required" }] }), "Mealie answered 422: field required");
  assertEquals(apiError("Grocy", 400, { error_message: "Amount > stock" }), "Grocy answered 400: Amount > stock");
});
