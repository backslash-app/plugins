import { Icons, list, open } from "@backslash/api";
import { groupSlug, guarded, mealie, mealPlan } from "../api.ts";
import { addDays, dayTitle, isoDate, plural, sortMeals } from "../lib.ts";
import { mealItem } from "../views.ts";

let footer = "";

export default list({
  placeholder: "Filter meals…",
  filter: { options: [{ value: "week", title: "This Week" }, { value: "today", title: "Today" }], default: "week" },
  status: () => footer,
  empty: {
    title: "Nothing planned",
    description: "Plan meals in Mealie, or from a recipe with Ctrl+P",
    icon: Icons.calendar,
  },
  items: ({ preferences, filter, signal }) =>
    guarded(async () => {
      const s = mealie(preferences);
      const days = filter === "today" ? 1 : 7;
      const [entries, group] = await Promise.all([mealPlan(s, days, signal), groupSlug(s, signal)]);
      const today = isoDate(new Date());
      const meals = sortMeals(entries).filter((m) =>
        m.date >= today && m.date <= isoDate(addDays(new Date(), days - 1))
      );
      footer = `${plural(meals.length, "meal")} planned${days === 1 ? " today" : " this week"}`;
      if (!meals.length) {
        return [{
          id: "empty",
          title: days === 1 ? "Nothing planned today" : "Nothing planned this week",
          subtitle: "Search Recipes → Plan for Dinner (Ctrl+P), or plan in Mealie",
          icon: { source: Icons.calendar, tint: "gray" },
          actions: [open(`${s.base}/${group ? "household" : "group"}/mealplan/planner/edit`, "Open Meal Planner")],
        }];
      }
      return meals.map((m) => mealItem(s, m, dayTitle(m.date), group));
    }),
});
