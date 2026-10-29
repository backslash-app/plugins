import { Icons, list, open } from "@backslash/api";
import { grocy, guarded, stock } from "../api.ts";
import { plural, sortStock } from "../lib.ts";
import { stockItem } from "../views.ts";

let footer = "";

export default list({
  placeholder: "Filter products or locations…",
  filter: {
    options: [{ value: "attention", title: "Needs Attention" }, { value: "all", title: "All Stock" }],
    default: "attention",
  },
  status: () => footer,
  empty: { title: "Nothing here", description: "No product matches: try All Stock", icon: Icons.box },
  items: ({ preferences, filter, signal }) =>
    guarded(async () => {
      const s = grocy(preferences);
      const days = Math.max(1, Math.min(60, Number(preferences.dueSoonDays) || 5));
      const all = sortStock(await stock(s, days, signal));
      const attention = all.filter((p) => p.state !== "ok");
      const count = (state: string) => all.filter((p) => p.state === state).length;
      footer = [
        plural(all.filter((p) => p.amount > 0).length, "product") + " in stock",
        ...(count("expired") ? [`${count("expired")} expired`] : []),
        ...(count("overdue") ? [`${count("overdue")} past best before`] : []),
        ...(count("due") ? [`${count("due")} due soon`] : []),
        ...(count("missing") ? [`${count("missing")} below minimum`] : []),
      ].join(" · ");
      const shown = filter === "all" ? all : attention;
      if (!shown.length && filter !== "all") {
        return [{
          id: "fine",
          title: "Everything is fine",
          subtitle: `Nothing expires in the next ${plural(days, "day")}, nothing is missing`,
          icon: { source: Icons.check, tint: "green" },
          actions: [open(`${s.base}/stockoverview`, "Open Stock Overview")],
        }];
      }
      return shown.map((p) => stockItem(s, p));
    }),
});
