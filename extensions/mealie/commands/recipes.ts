import { Icons, list } from "@backslash/api";
import { groupSlug, mealie, recipes, searchRecipes, type Server, SetupError, setupItem } from "../api.ts";
import { plural } from "../lib.ts";
import { recipeItem } from "../views.ts";

let footer = "";

export default list({
  placeholder: "Search recipes by name, ingredient or tag…",
  status: () => footer,
  empty: { title: "No recipe found", description: "Try another word, or add recipes in Mealie", icon: Icons.book },
  async search(query, { preferences, signal }) {
    let s: Server;
    try {
      s = mealie(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    try {
      const [found, group] = await Promise.all([searchRecipes(s, query, signal), groupSlug(s, signal)]);
      if (signal.aborted) return [];
      // Ingredients and steps for the preview: the first results, within a couple of seconds.
      const full = await recipes(s, found.slice(0, 12), { signal, deadline: 2500 });
      footer = query.trim() ? plural(found.length, "recipe") : `${plural(found.length, "recipe")} · recently updated`;
      return found.map((r) => recipeItem(s, r, full.get(r.slug), group));
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
  },
});
