import { action, copy, Icons, type Item, list, refresh } from "@backslash/api";
import { cachedCatalog, catalog, favorites, randomDrink, searchByName } from "../api.ts";
import {
  canonical,
  EXAMPLES,
  isKnownIngredient,
  knownIngredients,
  parseQuery,
  shoppingList,
  whatCanIMake,
  withIngredient,
} from "../lib.ts";
import { drinkItem, type Prefs, settings } from "../views.ts";

const SYNTAX = [
  "## What you can type",
  "",
  "- A name: `margarita`, `mojito`",
  "- An ingredient: `gin`, `campari`, `rhum`",
  "- What you have: `with rum, lime, mint` (or `avec vodka, citron vert`)",
  "- `random` for a surprise",
  "",
  "Ctrl+S adds a cocktail to your favorites, shown when the search is empty.",
].join("\n");

let status = "";

export default list({
  placeholder: "Margarita · gin · with rum, lime, mint · random",
  empty: {
    title: "No cocktail found",
    description: "Try another name, an ingredient (gin) or what you have (with vodka, lime)",
    icon: "🍸",
  },
  status: () => status,
  async search(query, ctx) {
    const s = settings(ctx.preferences as Prefs);
    const favs = await favorites();
    const isFav = new Set(favs.map((f) => f.drink.id));
    const q = parseQuery(query);

    if (q.kind === "empty" || q.kind === "random") {
      const items: Item[] = [];
      const random = await randomDrink(s.apiKey, ctx.signal).catch((e) => {
        if (ctx.signal.aborted) throw e;
        return undefined;
      });
      if (random) {
        items.push(drinkItem(random, s, {
          favorite: isFav.has(random.id),
          section: "Random Cocktail",
          extra: [action("Another Random Cocktail", () => refresh(), { icon: Icons.shuffle, shortcut: "<Ctrl>r" })],
        }));
      }
      if (q.kind === "empty") {
        const sorted = [...favs].sort((a, b) => a.drink.name.localeCompare(b.drink.name));
        items.push(...sorted.map((f) => drinkItem(f.drink, s, { favorite: true, section: "Favorites" })));
        if (sorted.length) {
          items.push({
            id: "shopping",
            title: "Shopping List for Your Favorites",
            subtitle: `Every ingredient of ${sorted.length} cocktail${sorted.length === 1 ? "" : "s"}`,
            icon: { source: Icons.copy, tint: "blue" },
            section: "Favorites",
            actions: [copy(shoppingList(sorted.map((f) => f.drink)), "Copy Shopping List")],
          });
        }
        items.push(...EXAMPLES.map((e): Item => ({
          id: `example:${e.query}`,
          title: e.query,
          subtitle: e.title,
          icon: { source: Icons.lightbulb, tint: "yellow" },
          section: "Type, for example",
          detail: { markdown: SYNTAX },
          actions: [copy(e.query, "Copy Example")],
        })));
      }
      status = `${favs.length} favorite${favs.length === 1 ? "" : "s"} · TheCocktailDB`;
      return items;
    }

    if (q.kind === "with") {
      const drinks = await catalog(s.apiKey, ctx.signal);
      const matches = whatCanIMake(drinks, q.bar);
      const can = matches.filter((m) => !m.missing.length).length;
      status = `${can} you can make · ${matches.length - can} missing one or two · ${drinks.length} cocktails checked`;
      return matches.slice(0, 80).map((m) =>
        drinkItem(m.drink, s, {
          match: m,
          favorite: isFav.has(m.drink.id),
          section: !m.missing.length ? "You can make" : m.missing.length === 1 ? "Missing one" : "Missing two",
        })
      );
    }

    // A name, and maybe an ingredient too ("gin", "campari").
    const byName = await searchByName(q.text, s.apiKey, ctx.signal);
    const items = byName.map((d) => drinkItem(d, s, { favorite: isFav.has(d.id), section: "By name" }));
    // Name results don't wait for the first catalog download: it starts now and serves the next searches.
    const known = await cachedCatalog(s.apiKey) ?? [];
    if (!known.length) catalog(s.apiKey).catch(() => {});
    let withIt = 0;
    if (known.length && isKnownIngredient(q.text, knownIngredients(known))) {
      const shown = new Set(byName.map((d) => d.id));
      const drinks = withIngredient(known, q.text).filter((d) => !shown.has(d.id));
      withIt = drinks.length;
      const term = canonical(q.text);
      items.push(
        ...drinks.slice(0, 60).map((d) =>
          drinkItem(d, s, { favorite: isFav.has(d.id), section: `With ${term[0].toUpperCase()}${term.slice(1)}` })
        ),
      );
    }
    status = [`${byName.length} by name`, ...(withIt ? [`${withIt} with this ingredient`] : [])].join(" · ");
    return items;
  },
});
