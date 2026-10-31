import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  additiveName,
  findBarcode,
  grade,
  HOSTS,
  langOf,
  nutritionTable,
  parseNutrients,
  parseProductResponse,
  parseSearch,
  productMarkdown,
  productUrl,
  searchUrl,
  shareLine,
  subtitle,
  tagName,
  USER_AGENT,
  validBarcode,
} from "./lib.ts";

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  for (const url of [productUrl("3017624010701"), searchUrl("nutella")]) assert(HOSTS.includes(new URL(url).hostname));
});

Deno.test("the User-Agent says who is asking", () => {
  assert(/^[\w-]+\/\d+\.\d+ \(.+\)$/.test(USER_AGENT));
});

// Trimmed from a real /api/v2/product/3017624010701.json answer.
const NUTELLA = {
  code: "3017624010701",
  product: {
    additives_tags: [],
    allergens_tags: ["en:nuts"],
    brands: "Ferrero",
    categories_tags: ["en:breakfasts", "en:spreads", "en:sweet-spreads", "en:hazelnut-spreads"],
    code: "3017624010701",
    ecoscore_grade: "d",
    image_front_small_url: "https://images.openfoodfacts.org/images/products/301/762/401/0701/front_en.100.200.jpg",
    image_front_url: "https://images.openfoodfacts.org/images/products/301/762/401/0701/front_en.100.400.jpg",
    ingredients_text: "sugar, palm oil, hazelnuts, skimmed milk powder, fat reduced cocoa, emulsifier, vanillin",
    ingredients_text_fr:
      "sucre, huile de palme, NOISETTES, LAIT écrémé en poudre, cacao maigre, émulsifiants, vanilline",
    labels_tags: ["en:no-gluten"],
    nutriments: {
      carbohydrates_100g: 57.5,
      "energy-kcal_100g": 539,
      "energy-kj_100g": 2228,
      energy_100g: 2228,
      fat_100g: 30.9,
      proteins_100g: 6.3,
      salt_100g: 0.1075,
      "saturated-fat_100g": 10.6,
      sodium_100g: 0.043,
      sugars_100g: 56.3,
    },
    nutrient_levels: { fat: "high", salt: "low", "saturated-fat": "high", sugars: "high" },
    nutriscore_grade: "e",
    nova_group: 4,
    product_name: "Nutella",
    product_name_fr: "Nutella pâte à tartiner",
    quantity: "400 g",
    traces_tags: ["en:milk", "en:nuts", "en:soybeans"],
  },
  status: 1,
  status_verbose: "product found",
};

Deno.test("a product from the v2 API", () => {
  const p = parseProductResponse(NUTELLA)!;
  assertEquals(p.name, "Nutella");
  assertEquals(p.brands, ["Ferrero"]);
  assertEquals([p.nutriscore, p.nova, p.ecoscore], ["e", 4, "d"]);
  assertEquals(p.allergens, ["Nuts"]);
  assertEquals(p.traces, ["Milk", "Nuts", "Soybeans"]);
  assertEquals(p.additives, []);
  assertEquals(p.labels, ["No gluten"]);
  assertEquals(p.nutrients.map((n) => n.id), [
    "energy-kcal",
    "fat",
    "saturated-fat",
    "carbohydrates",
    "sugars",
    "proteins",
    "salt",
  ]);
  assertEquals(p.nutrients.find((n) => n.id === "sugars")?.level, "high");
  assertEquals(subtitle(p), "Ferrero · 400 g");
  assertEquals(shareLine(p), "Nutella (Ferrero, 400 g): Nutri-Score E, NOVA 4, Eco-Score D");
});

Deno.test("names and ingredients in the user's language", () => {
  const p = parseProductResponse(NUTELLA, "fr")!;
  assertEquals(p.name, "Nutella pâte à tartiner");
  assertStringIncludes(p.ingredients!, "huile de palme");
  assertEquals(langOf("FR-fr"), "fr");
  assertEquals(langOf(""), "en");
  assertEquals(langOf("123"), "en");
});

Deno.test("unknown and empty products", () => {
  assertEquals(
    parseProductResponse({ code: "0000000000000", status: 0, status_verbose: "product not found" }),
    undefined,
  );
  assertEquals(
    parseProductResponse({ code: "1234567890123", product: { code: "1234567890123" }, status: 1 }),
    undefined,
  );
  assertEquals(parseProductResponse("<html>"), undefined);
});

Deno.test("search hits (brands as arrays, unknown grades)", () => {
  const { products, count } = parseSearch({
    hits: [
      {
        code: "80809180",
        brands: ["Ferrero", "Nutella", "ferrero"],
        ecoscore_grade: "unknown",
        nova_group: 4,
        nutriscore_grade: "e",
        product_name: "deko Nutella",
        image_front_small_url: "https://images.openfoodfacts.org/images/products/80809180/front_en.96.200.jpg",
        nutriments: { "energy-kcal_100g": 544, fat_100g: 31.6 },
      },
      { code: "0098008952506", brands: ["Nutella"], nutriscore_grade: "unknown", product_name: "Nutella" },
      { code: "", product_name: "broken" },
    ],
    page: 1,
    page_size: 24,
    page_count: 316,
    count: 631,
    is_count_exact: true,
  });
  assertEquals(count, 631);
  assertEquals(products.map((p) => p.code), ["80809180", "0098008952506"]);
  assertEquals(products[0].brands, ["Ferrero", "Nutella"]);
  assertEquals(products[0].ecoscore, undefined);
  assertEquals(products[1].nutriscore, undefined);
  // No large image in the hit: the thumbnail stands in.
  assertEquals(products[0].image, undefined);
  assert(products[0].thumbnail?.endsWith("200.jpg"));
  assertEquals(parseSearch({ detail: "error" }), { products: [], count: 0 });
});

Deno.test("grades, tags and additives", () => {
  assertEquals(grade("B"), "b");
  assertEquals(grade("not-applicable"), undefined);
  assertEquals(grade("a-plus"), "a+");
  assertEquals(tagName("en:fruits-a-coque"), "Fruits a coque");
  assertEquals(tagName("fr:lait"), "Lait");
  assertEquals(tagName("en:e322i"), "E322i");
  assertEquals(additiveName("en:e322i"), "E322i Lecithin");
  assertEquals(additiveName("en:e150d"), "E150d Sulphite ammonia caramel");
  assertEquals(additiveName("en:e999"), "E999");
});

Deno.test("nutrients: kJ only, junk values", () => {
  const n = parseNutrients({ "energy-kj_100g": 418.4, fat_100g: "", sugars_100g: "abc", salt_100g: 0 });
  assertEquals(n.map((x) => [x.id, x.value]), [["energy-kcal", 100], ["salt", 0]]);
  assertEquals(parseNutrients(undefined), []);
});

Deno.test("nutrition table and preview", () => {
  const p = parseProductResponse(NUTELLA)!;
  const table = nutritionTable(p.nutrients);
  assertStringIncludes(table, "| **Energy** | 539 kcal |");
  assertStringIncludes(table, "| **Fat** | 30.9 g | 🔴 high |");
  assertStringIncludes(table, "| of which saturated fat | 10.6 g | 🔴 high |");
  assertStringIncludes(table, "| **Salt** | 0.11 g | 🟢 low |");
  assertStringIncludes(nutritionTable([]), "No nutrition facts");
  const md = productMarkdown(p);
  assertStringIncludes(md, "**Allergens:** Nuts");
  assertStringIncludes(md, "**May contain:** Milk, Nuts, Soybeans");
  assertStringIncludes(md, "**No additives**");
});

Deno.test("barcodes in text and their check digit", () => {
  assertEquals(findBarcode("3017624010701"), "3017624010701");
  assertEquals(findBarcode(" 3 017624 010701 "), "3017624010701");
  assertEquals(findBarcode("EAN: 3017624010701, lot 12"), "3017624010701");
  assertEquals(findBarcode("80809180"), "80809180");
  assertEquals(findBarcode("12345"), undefined);
  assertEquals(findBarcode("nutella"), undefined);
  assert(validBarcode("3017624010701"));
  assert(validBarcode("96385074")); // EAN-8
  assert(!validBarcode("3017624010702"));
  assert(validBarcode("036000291452")); // UPC-A
});
