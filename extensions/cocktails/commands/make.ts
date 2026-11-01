import { Icons, type Item, list } from "@backslash/api";
import { catalog, favorites } from "../api.ts";
import { parseBar, whatCanIMake } from "../lib.ts";
import { drinkItem, type Prefs, settings } from "../views.ts";

let status = "";

export default list({
  placeholder: "Add what else you have: lemon, mint…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "can", title: "Can Make" },
      { value: "one", title: "Missing One" },
    ],
  },
  empty: {
    title: "Nothing to make yet",
    description: "List your bottles in Settings → Extensions → Cocktails → My bar, or type them here: gin, lime, tonic",
    icon: "🍸",
  },
  status: () => status,
  async search(query, ctx) {
    const prefs = ctx.preferences as Prefs;
    const s = settings(prefs);
    const bar = [...parseBar(prefs.bar ?? ""), ...parseBar(query)];
    if (!bar.length) {
      status = "Your bar is empty";
      return [{
        id: "setup",
        title: "Tell Cocktails what is in your bar",
        subtitle: "Settings → Extensions → Cocktails → My bar, or type bottles here",
        icon: { source: Icons.settings, tint: "blue" },
        detail: {
          markdown: [
            "## Your bar",
            "",
            "List what you have, separated by commas: `gin, vodka, triple sec, lime, mint, tonic`.",
            "",
            "English and French both work (`rhum, citron vert, menthe`). Ice, water, salt and sugar are always counted as there.",
          ].join("\n"),
        },
      }];
    }
    const [drinks, favs] = await Promise.all([catalog(s.apiKey, ctx.signal), favorites()]);
    const isFav = new Set(favs.map((f) => f.drink.id));
    const matches = whatCanIMake(drinks, bar, ctx.filter === "can" ? 0 : ctx.filter === "one" ? 1 : 2)
      .filter((m) => ctx.filter !== "one" || m.missing.length === 1);
    const can = matches.filter((m) => !m.missing.length).length;
    status = `${bar.length} in your bar · ${can} you can make · ${drinks.length} cocktails checked`;
    return matches.slice(0, 120).map((m): Item =>
      drinkItem(m.drink, s, {
        match: m,
        favorite: isFav.has(m.drink.id),
        section: !m.missing.length ? "You can make" : m.missing.length === 1 ? "Missing one" : "Missing two",
      })
    );
  },
});
