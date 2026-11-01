import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  canonical,
  convertMeasure,
  covers,
  type Drink,
  drinkUrl,
  formatAmount,
  formatMl,
  instructionsIn,
  isKnownIngredient,
  knownIngredients,
  languageOf,
  parseBar,
  parseDrink,
  parseMeasure,
  parseQuery,
  type RawDrink,
  recipeMarkdown,
  recipeText,
  shoppingList,
  thumb,
  toggleFavorite,
  unitsOf,
  whatCanIMake,
  withIngredient,
} from "./lib.ts";

const dir = new URL(".", import.meta.url).pathname;
const fixture = (name: string) =>
  (JSON.parse(Deno.readTextFileSync(`${dir}fixtures/${name}`)) as { drinks: RawDrink[] }).drinks.map(parseDrink);

// Real answers of search.php?s=margarita and search.php?f=n, trimmed.
const margaritas = fixture("margarita.json");
const letterN = fixture("letter-n.json");
const all = [...margaritas, ...letterN];
const byName = (name: string) => all.find((d) => d.name === name)!;

Deno.test("drinks are parsed", () => {
  const m = byName("Margarita");
  assertEquals(m.id, "11007");
  assertEquals(m.alcohol, "alcoholic");
  assertEquals(m.glass, "Cocktail glass");
  assertEquals(m.iba, "Contemporary Classics");
  assertEquals(m.tags, ["IBA", "Contemporary Classic"]);
  assertEquals(m.ingredients.map((i) => i.name), ["Tequila", "Triple sec", "Lime juice", "Salt"]);
  assertEquals(m.ingredients.map((i) => i.measure), ["1 1/2 oz", "1/2 oz", "1 oz", ""]);
  assert(m.instructions.fr?.startsWith("Frotter le bord"));
  assertEquals(thumb(m), `${m.thumb}/small`);
  assertEquals(drinkUrl(m), "https://www.thecocktaildb.com/drink/11007-Margarita");
  assertEquals(drinkUrl(byName("Tommy's Margarita")), "https://www.thecocktaildb.com/drink/17216-Tommy-s-Margarita");
  // Stray newlines and notes in measures are cleaned up.
  const sour = byName("New York Sour");
  assertEquals(sour.ingredients.find((i) => i.name === "Red wine")?.measure, "(Claret)");
  assertEquals(parseDrink({ idDrink: "1", strDrink: "X", strAlcoholic: "Non alcoholic" }).alcohol, "non-alcoholic");
  assertEquals(parseDrink({ idDrink: "1", strDrink: "X", strAlcoholic: "Optional alcohol" }).alcohol, "optional");
});

Deno.test("instructions fall back to English", () => {
  const m = byName("Margarita");
  assertEquals(instructionsIn(m, "fr").lang, "fr");
  const noFr: Drink = { ...m, instructions: { en: "Shake." } };
  assertEquals(instructionsIn(noFr, "fr"), { text: "Shake.", lang: "en" });
  assert(recipeMarkdown(noFr, "both", "fr").includes("Not available in Français"));
  assertEquals(languageOf("French"), "fr");
  assertEquals(languageOf("FR"), "fr");
  assertEquals(languageOf("klingon"), "en");
});

Deno.test("measures", () => {
  assertEquals(parseMeasure("1 1/2 oz"), { amount: 1.5, to: undefined, unit: "oz", rest: "", about: false });
  assertEquals(parseMeasure("1/2 oz"), { amount: 0.5, to: undefined, unit: "oz", rest: "", about: false });
  assertEquals(parseMeasure("3/4-1 cup"), { amount: 0.75, to: 1, unit: "cup", rest: "", about: false });
  assertEquals(parseMeasure("1-2 shot")?.to, 2);
  assertEquals(parseMeasure("2 or 3")?.to, 3);
  assertEquals(parseMeasure("4.5 cl")?.amount, 4.5);
  assertEquals(parseMeasure("About 8 drops")?.about, true);
  assertEquals(parseMeasure("2 oz sweetened")?.rest, "sweetened");
  assertEquals(parseMeasure("1 tblsp")?.unit, "tbsp");
  // A word that isn't a unit stays in the text.
  assertEquals(parseMeasure("2 Wedges"), { amount: 2, to: undefined, unit: undefined, rest: "Wedges", about: false });
  assertEquals(parseMeasure("Juice of 1/2"), undefined);
  assertEquals(parseMeasure("Top up with"), undefined);
  assertEquals(parseMeasure(""), undefined);
  assertEquals(formatAmount(1.5), "1 ½");
  assertEquals(formatAmount(0.25), "¼");
  assertEquals(formatAmount(2), "2");
  assertEquals(formatAmount(1 / 3), "⅓");
  assertEquals(formatMl(45), "45 ml");
  assertEquals(formatMl(7.5), "8 ml");
  assertEquals(formatMl(1000), "1 L");
  assertEquals(formatMl(1500), "1.5 L");
});

Deno.test("unit conversion", () => {
  assertEquals(convertMeasure("1 1/2 oz", "metric"), { text: "45 ml" });
  assertEquals(convertMeasure("1 1/2 oz", "both"), { text: "1 1/2 oz", converted: "45 ml" });
  assertEquals(convertMeasure("4.5 cl", "us"), { text: "1 ½ oz" });
  assertEquals(convertMeasure("4.5 cl", "both"), { text: "4.5 cl", converted: "1 ½ oz" });
  assertEquals(convertMeasure("1-2 shot", "metric"), { text: "45 ml–90 ml" });
  assertEquals(convertMeasure("2 oz sweetened", "metric"), { text: "60 ml sweetened" });
  // Teaspoons stay teaspoons on the US side; counts never change.
  assertEquals(convertMeasure("1 tsp", "us"), { text: "1 tsp" });
  assertEquals(convertMeasure("1 tsp", "both"), { text: "1 tsp", converted: "5 ml" });
  assertEquals(convertMeasure("1 part", "metric"), { text: "1 part" });
  assertEquals(convertMeasure("Juice of 1/2", "metric"), { text: "Juice of 1/2" });
  assertEquals(convertMeasure("1 1/2 oz", "original"), { text: "1 1/2 oz" });
  assertEquals(unitsOf("ML"), "metric");
  assertEquals(unitsOf("imperial"), "us");
  assertEquals(unitsOf(""), "both");
});

Deno.test("what is in your bar", () => {
  assertEquals(parseBar("Gin, citron vert; rhum et menthe"), ["gin", "lime", "rum", "mint"]);
  assertEquals(parseBar("gin, Gin, GIN"), ["gin"]);
  assertEquals(canonical("Whisky"), "whiskey");
  assert(covers("rum", "Light rum"));
  assert(covers("lime", "Lime juice"));
  assert(covers("citron vert", "Lime juice"));
  assert(covers("whiskey", "Blended whiskey"));
  assert(covers("whiskey", "Bourbon"));
  assert(covers("vodka", "Absolut Citron"));
  assert(covers("vermouth", "Sweet Vermouth"));
  assert(covers("triple sec", "Cointreau"));
  assert(covers("egg", "Eggs"));
  assert(covers("strawberry", "Strawberries"));
  // "lemon" is not "lemon-lime soda", "orange" is not "orange bitters".
  assert(!covers("lemon", "Lemon-lime soda"));
  assert(!covers("orange", "Orange bitters"));
  assert(!covers("gin", "Ginger ale"));
});

Deno.test("what can I make", () => {
  const matches = whatCanIMake(all, ["tequila", "triple sec", "lime"]);
  const can = matches.filter((m) => !m.missing.length).map((m) => m.drink.name);
  // Salt is a staple: the Margarita is complete.
  assertEquals(can, ["Margarita"]);
  const blue = matches.find((m) => m.drink.name === "Blue Margarita")!;
  assertEquals(blue.missing, ["Blue Curacao"]);
  const tommy = matches.find((m) => m.drink.name === "Tommy's Margarita")!;
  assertEquals(tommy.missing, ["Agave syrup"]);
  // Drinks using none of your bottles are left out.
  assert(!matches.some((m) => m.drink.name === "Nutty Irishman"));
  assertEquals(
    whatCanIMake(all, ["gin", "campari", "vermouth"]).filter((m) => !m.missing.length)[0].drink.name,
    "Negroni",
  );
  // maxMissing 0: only what you can make.
  assert(whatCanIMake(all, ["tequila", "triple sec", "lime"], 0).every((m) => !m.missing.length));
});

Deno.test("ingredient searches", () => {
  assertEquals(withIngredient(all, "gin").map((d) => d.name), ["Negroni", "National Aquarium"]);
  const known = knownIngredients(all);
  assert(isKnownIngredient("gin", known));
  assert(isKnownIngredient("Tequila", known));
  assert(isKnownIngredient("citron vert", known));
  assert(!isKnownIngredient("margarita", known));
});

Deno.test("queries", () => {
  assertEquals(parseQuery(""), { kind: "empty" });
  assertEquals(parseQuery("random"), { kind: "random" });
  assertEquals(parseQuery("au hasard"), { kind: "random" });
  assertEquals(parseQuery("with rum, lime, mint"), { kind: "with", bar: ["rum", "lime", "mint"] });
  assertEquals(parseQuery("avec vodka, citron vert"), { kind: "with", bar: ["vodka", "lime"] });
  assertEquals(parseQuery("gin, tonic"), { kind: "with", bar: ["gin", "tonic water"] });
  assertEquals(parseQuery("margarita"), { kind: "name", text: "margarita" });
  assertEquals(parseQuery("with"), { kind: "name", text: "with" });
});

Deno.test("text for the clipboard and the panel", () => {
  const m = byName("Margarita");
  const text = recipeText(m, "metric", "en");
  assert(text.startsWith("Margarita\n\n- 45 ml Tequila\n- 15 ml Triple sec\n- 30 ml Lime juice\n- Salt"));
  assert(text.includes("Glass: Cocktail glass"));
  const md = recipeMarkdown(m, "both", "fr");
  assert(md.includes("| 1 1/2 oz (45 ml) | Tequila |"));
  assert(md.includes("Frotter le bord"));
  assertEquals(shoppingList([m, byName("Blue Margarita")]), "- Tequila\n- Triple sec\n- Lime juice\n- Blue Curacao");
});

Deno.test("favorites", () => {
  const m = byName("Margarita");
  const one = toggleFavorite([], m, 1);
  assertEquals(one.map((f) => f.drink.id), ["11007"]);
  assertEquals(toggleFavorite(one, m), []);
});

Deno.test("manifest", () => {
  const manifest = parse(Deno.readTextFileSync(`${dir}backslash.toml`)) as {
    extension: { id: string; categories: string[] };
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.extension.id, "cocktails");
  assertEquals(manifest.permissions.net, ["www.thecocktaildb.com"]);
  for (const c of manifest.commands) Deno.statSync(`${dir}commands/${c.name}.ts`);
});
