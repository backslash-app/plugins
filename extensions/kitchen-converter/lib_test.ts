import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { INGREDIENTS, OVEN, SUBSTITUTIONS } from "./data.ts";
import {
  amountText,
  convert,
  findIngredient,
  findSubstitutions,
  inUnit,
  matchUnit,
  measureWith,
  niceNumber,
  parseAmount,
  parseOven,
  parseQuery,
  scaleLine,
  searchIngredients,
  splitLines,
  unitById,
} from "./lib.ts";
import { itemsFor } from "./ui.ts";

const conv = (q: string, cups: "us" | "metric" | "uk" = "us") => {
  const r = parseQuery(q, cups);
  if (r.kind !== "convert") throw new Error(`${q}: ${r.kind} ${"message" in r ? r.message : ""}`);
  return r.conversion;
};

Deno.test("data: unique ids and names, plausible densities", () => {
  const ids = new Set(INGREDIENTS.map((i) => i.id));
  assertEquals(ids.size, INGREDIENTS.length);
  assert(INGREDIENTS.length >= 60);
  for (const i of INGREDIENTS) {
    // Nothing in a kitchen is lighter than panko or heavier than molasses by volume.
    assert(i.gramsPerCup >= 40 && i.gramsPerCup <= 350, i.id);
    assert(i.fr && i.name, i.id);
  }
  // No name or alias points to two ingredients.
  const owner = new Map<string, string>();
  for (const i of INGREDIENTS) {
    for (const n of [i.name, i.fr, ...i.aliases].map((x) => x.toLowerCase())) {
      const prev = owner.get(n);
      assert(!prev || prev === i.id, `"${n}" is ${prev} and ${i.id}`);
      owner.set(n, i.id);
    }
  }
  assertEquals(new Set(SUBSTITUTIONS.map((s) => s.id)).size, SUBSTITUTIONS.length);
  // The gas mark table rises steadily.
  for (let k = 1; k < OVEN.length; k++) assert(OVEN[k].celsius > OVEN[k - 1].celsius);
});

Deno.test("amounts: fractions, unicode, decimal commas and ranges", () => {
  assertEquals(parseAmount("2 cups")?.value, 2);
  assertEquals(parseAmount("1.5 cups")?.value, 1.5);
  assertEquals(parseAmount("1,5 tasse")?.value, 1.5);
  assertEquals(parseAmount("1/2 cup")?.value, 0.5);
  assertEquals(parseAmount("1 1/2 cups")?.value, 1.5);
  assertEquals(parseAmount("1½ cups")?.value, 1.5);
  assertEquals(parseAmount("1 ½ cups")?.value, 1.5);
  assertEquals(parseAmount("¾ cup")?.value, 0.75);
  assertEquals(parseAmount("2-3 tbsp")?.value, 2.5);
  assertEquals(parseAmount("1 1/2 cups")?.rest, "cups");
  assertEquals(parseAmount("flour"), undefined);
});

Deno.test("units: whole words, longest names first", () => {
  assertEquals(matchUnit("cups flour")?.unit.id, "cup");
  assertEquals(matchUnit("c. à s. de miel")?.unit.id, "tbsp");
  assertEquals(matchUnit("cuillères à café de sel")?.unit.id, "tsp");
  assertEquals(matchUnit("fl oz milk")?.unit.id, "floz");
  assertEquals(matchUnit("oz chocolate")?.unit.id, "oz");
  assertEquals(matchUnit("metric cup flour")?.unit.id, "metric-cup");
  assertEquals(matchUnit("g sugar")?.rest, "sugar");
  // "g" is not the start of "garlic", nor "c" of "cocoa".
  assertEquals(matchUnit("garlic"), undefined);
  assertEquals(matchUnit("cocoa"), undefined);
  assertEquals(matchUnit("l milk")?.unit.id, "l");
  assertEquals(matchUnit("lait"), undefined);
});

Deno.test("numbers: nice fractions and measuring", () => {
  assertEquals(niceNumber(1.6667), "1 ⅔");
  assertEquals(niceNumber(0.25), "¼");
  assertEquals(niceNumber(2), "2");
  assertEquals(niceNumber(2.43), "2.43");
  assertEquals(niceNumber(0.999), "1");
  assertEquals(amountText(1, unitById("cup")), "1 cup");
  assertEquals(amountText(0.5, unitById("cup")), "½ cup");
  assertEquals(amountText(2.5, unitById("cup")), "2 ½ cups");
  assertEquals(amountText(113.4, unitById("g")), "113 g");
  assertEquals(measureWith(236.588), "1 cup");
  assertEquals(measureWith(236.588 * 0.75), "¾ cup");
  assertEquals(measureWith(236.588 * (0.5 + 2 / 16)), "½ cup + 2 tbsp");
  assertEquals(measureWith(236.588 * 1.5), "1 ½ cups");
  assertEquals(measureWith(4.92892), "1 tsp");
  assertEquals(measureWith(0.5), "a pinch");
});

Deno.test("conversions: by volume and by weight", () => {
  assertAlmostEquals(conv("1 cup flour").grams, 120, 0.01);
  assertAlmostEquals(conv("1 cup of all-purpose flour").grams, 120, 0.01);
  assertAlmostEquals(conv("2 cups of sifted flour").grams, 240, 0.01);
  assertAlmostEquals(conv("1 cup sugar").grams, 198, 0.01);
  assertAlmostEquals(conv("1 tbsp butter").grams, 227 / 16, 0.01);
  assertAlmostEquals(conv("1 tsp salt").grams, 6, 0.01);
  assertAlmostEquals(conv("1 tsp baking powder").grams, 4, 0.01);
  // A packet of yeast is 2 ¼ tsp, 7 g.
  assertAlmostEquals(conv("2 1/4 tsp yeast").grams, 7, 0.05);
  assertAlmostEquals(conv("2 sticks butter").grams, 226.8, 0.01);
  assertAlmostEquals(conv("1 stick").grams, 113.4, 0.01);
  // French names and spoons.
  assertEquals(conv("3 c. à s. de miel").ingredient.id, "honey");
  assertEquals(conv("200 g de farine").ingredient.id, "flour");
  assertEquals(conv("100 g sucre glace").ingredient.id, "powdered-sugar");
  assertEquals(conv("250 ml de crème").ingredient.id, "heavy-cream");
  // Weight to volume, with a target unit.
  const sugar = conv("200 g sugar in cups");
  assertEquals(sugar.target?.id, "cup");
  assertAlmostEquals(inUnit(sugar, unitById("cup"), "us"), 200 / 198, 1e-9);
  const butter = conv("100 g butter in tbsp");
  assertAlmostEquals(inUnit(butter, unitById("tbsp"), "us"), 100 / 227 * 16, 1e-4);
  assertEquals(conv("1 tasse de farine en g").target?.id, "g");
  // Cups follow the preference; "metric cup" and "tasse" are always 250 ml.
  assertAlmostEquals(conv("1 cup flour", "metric").grams, 120 * 250 / 236.588, 1e-9);
  assertAlmostEquals(conv("1 cup flour", "uk").grams, 120 * 284.131 / 236.588, 1e-9);
  assertAlmostEquals(conv("1 tasse de farine").grams, 120 * 250 / 236.588, 1e-9);
  assertAlmostEquals(conv("1 US cup flour", "metric").grams, 120, 1e-9);
  // Round trip.
  const c = convert(1, unitById("cup"), findIngredient("honey")!, "us");
  assertAlmostEquals(convert(c.grams, unitById("g"), c.ingredient, "us").ml, 236.588, 1e-9);
});

Deno.test("ingredients: names, plurals, accents and searches", () => {
  assertEquals(findIngredient("flour")?.id, "flour");
  assertEquals(findIngredient("Farine")?.id, "flour");
  assertEquals(findIngredient("almonds")?.id, "almonds");
  assertEquals(findIngredient("walnut")?.id, "walnuts");
  assertEquals(findIngredient("creme fraiche")?.id, "sour-cream");
  assertEquals(findIngredient("of brown sugar")?.id, "brown-sugar");
  assertEquals(findIngredient("flour, sifted")?.id, "flour");
  assertEquals(findIngredient("unicorn dust"), undefined);
  assert(searchIngredients("oil").length >= 3);
  assertEquals(searchIngredients("x"), []);
});

Deno.test("oven: °C, °F, fan, gas marks and thermostats", () => {
  const f = parseOven("350 F")!;
  assertEquals([f.celsius, f.fahrenheit, f.gas?.gas, f.fanCelsius], [177, 350, "4", 157]);
  const c = parseOven("180C")!;
  assertEquals([c.celsius, c.fahrenheit, c.gas?.gas, c.thermostat], [180, 350, "4", 6]);
  const gas = parseOven("gas mark 6")!;
  assertEquals([gas.celsius, gas.fahrenheit], [200, 400]);
  assertEquals(parseOven("gas ½")?.celsius, 120);
  assertEquals(parseOven("gas 1/4")?.celsius, 110);
  const fan = parseOven("180 c fan")!;
  assertEquals([fan.celsius, fan.fromFan, fan.fanCelsius], [200, true, 180]);
  assertEquals(parseOven("160 chaleur tournante")?.celsius, 180);
  assertEquals(parseOven("th 6")?.celsius, 180);
  assertEquals(parseOven("thermostat 7")?.celsius, 210);
  assertEquals(parseOven("425°F")?.gas?.gas, "7");
  assertEquals(parseOven("500 C"), undefined);
  assertEquals(parseOven("gas 10"), undefined);
  assertEquals(parseOven("180"), undefined);
});

Deno.test("scaling: amounts, spoons and counted things", () => {
  assertEquals(scaleLine("200 g flour", 1.5).text, "300 g flour");
  assertEquals(scaleLine("1/2 cup milk", 1.5).text, "¾ cup milk");
  const spoons = scaleLine("2 tsp baking powder", 1.5);
  assertEquals(spoons.text, "1 tbsp baking powder");
  assertEquals(spoons.hint, "3 tsp baking powder");
  assertEquals(scaleLine("2 tbsp sugar", 2).text, "¼ cup sugar");
  assertEquals(scaleLine("800 g flour", 1.5).text, "1.2 kg flour");
  const eggs = scaleLine("3 eggs", 1.5);
  assertEquals(eggs.text, "4 ½ eggs");
  assertEquals(eggs.hint, "About 5 (a little more)");
  assertEquals(scaleLine("salt", 2), { source: "salt", text: "salt", scaled: false });
  assertEquals(splitLines("200 g flour, 3 eggs; 1/2 cup milk\nsalt"), [
    "200 g flour",
    "3 eggs",
    "1/2 cup milk",
    "salt",
  ]);

  const q = parseQuery("scale 4 to 6: 200 g flour, 3 eggs, 1/2 cup milk, salt");
  assert(q.kind === "scale");
  assertEquals(q.factor, 1.5);
  assertEquals(q.lines.map((l) => l.text), ["300 g flour", "4 ½ eggs", "¾ cup milk", "salt"]);
  const fr = parseQuery("pour 6 à 3 personnes : 300 g de farine");
  assert(fr.kind === "scale");
  assertEquals(fr.lines[0].text, "150 g de farine");
  const times = parseQuery("x1.5 2 tsp baking powder, 1 egg");
  assert(times.kind === "scale");
  assertEquals(times.lines.length, 2);
  const half = parseQuery("1/2x 1 cup sugar");
  assert(half.kind === "scale" && half.factor === 0.5);
  assertEquals(half.lines[0].text, "½ cup sugar");
  assertEquals(parseQuery("x2").kind, "scale");
  assertEquals(parseQuery("scale 0 to 4").kind, "error");
});

Deno.test("substitutions and queries", () => {
  assertEquals(findSubstitutions("buttermilk")[0].id, "buttermilk");
  assertEquals(findSubstitutions("oeufs")[0].id, "egg");
  assertEquals(parseQuery("sub buttermilk").kind, "substitute");
  const sans = parseQuery("sans œufs");
  assert(sans.kind === "substitute" && sans.matches[0].id === "egg");
  assertEquals(parseQuery("").kind, "empty");
  assertEquals(parseQuery("flour").kind, "ingredient");
  assertEquals(parseQuery("1 cup").kind, "volume");
  assertEquals(parseQuery("choc").kind, "search");
  assertEquals(parseQuery("200 g").kind, "error");
  assertEquals(parseQuery("1 cup unicorn dust").kind, "error");
  assertEquals(parseQuery("blah").kind, "error");
});

Deno.test("items: every kind renders, every example parses", () => {
  const first = (q: string) => itemsFor(parseQuery(q), "us")[0];
  assertEquals(first("1 cup flour").title, "120 g");
  assertEquals(first("200 g sugar in cups").title, "1 cup");
  assertEquals(first("350 F").title, "177 °C");
  assertEquals(first("scale 4 to 6: 200 g flour").title, "× 1 ½");
  assert(first("sub buttermilk").title.startsWith("Buttermilk:"));
  assertEquals(first("flour").title, "All-purpose flour");
  assertEquals(first("sub dragon").id, "error");
  const empty = itemsFor({ kind: "empty" }, "us");
  assert(empty.length > INGREDIENTS.length + SUBSTITUTIONS.length);
  for (const item of empty.filter((i) => i.id?.startsWith("example:"))) {
    assert(parseQuery(item.title).kind !== "error", item.title);
  }
});

Deno.test("manifest: no permission, command files exist", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions?: unknown;
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions, undefined);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
