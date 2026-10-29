import { action, type Context, Icons, type Item, list, refresh, updateCommandMetadata } from "@backslash/api";
import { newest, saved } from "../api.ts";
import { daySection, parseCategories } from "../lib.ts";
import { paperItem } from "../views.ts";

let footer = "";
/** Set by "Refresh": the next load skips the cache. */
let force = false;

export default (ctx: Context) => {
  const categories = parseCategories(ctx.preferences.categories);
  return list({
    placeholder: "Filter new submissions…",
    filter: { options: [{ value: "all", title: "All Followed" }, ...categories.map((c) => ({ value: c, title: c }))] },
    empty: { title: "No new submission", description: "Nothing new in these categories", icon: Icons.inbox },
    status: () => footer,
    actions: [action("Refresh", () => {
      force = true;
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    async items({ signal, filter }) {
      if (!categories.length) {
        footer = "";
        return [
          {
            id: "setup",
            title: "Follow categories in Settings → Extensions → arXiv",
            subtitle: "For example cs.AI, cs.LG, stat.ML, math.PR or hep-th",
            icon: { source: Icons.settings, tint: "orange" },
            actions: [],
          } satisfies Item,
        ];
      }
      const pick = filter && filter !== "all" && categories.includes(filter) ? [filter] : categories;
      const [{ papers, fetched }, savedPapers] = await Promise.all([
        newest(pick, { signal, force }),
        saved(),
      ]);
      force = false;
      const c = { saved: new Set(savedPapers.map((p) => p.id)) };
      const today = papers.filter((p) => daySection(p.published) === "Today").length;
      if (!filter || filter === "all") {
        updateCommandMetadata({ subtitle: today ? `${today} new today` : null }).catch(() => {});
      }
      const minutes = Math.round((Date.now() - fetched) / 60_000);
      footer = `${papers.length} papers in ${pick.join(", ")} · ${minutes < 1 ? "just updated" : `${minutes} min ago`}`;
      return papers.map((p) => paperItem(p, c, { section: daySection(p.published) }));
    },
  });
};
