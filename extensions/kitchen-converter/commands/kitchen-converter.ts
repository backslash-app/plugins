import { Icons, list } from "@backslash/api";
import { cupSystemOf, parseQuery } from "../lib.ts";
import { itemsFor } from "../ui.ts";

export default list({
  placeholder: "1 cup flour · 200 g sugar in cups · 350 F · scale 4 to 6: … · sub buttermilk",
  empty: { title: "Nothing to show", icon: Icons.coffee },
  status: (items) => {
    const first = items[0];
    if (!first) return "";
    if (first.id === "error") return "Not something I can convert";
    if (first.id?.startsWith("example:")) return "Cups and grams by ingredient · oven · scaling · substitutions";
    return [first.title, first.subtitle].filter(Boolean).join(" · ");
  },
  search: (query, ctx) => {
    const cups = cupSystemOf(ctx.preferences.cup);
    return itemsFor(parseQuery(query, cups), cups);
  },
});
