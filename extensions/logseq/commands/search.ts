import { action, type Context, Icons, type Item, list, open, refresh } from "@backslash/api";
import { pageUri, plural, score } from "../lib.ts";
import { blockItem, clearIndex, indexGraph, loadGraphs, NO_GRAPH, pageItem, todayJournal } from "../graph.ts";

let footer = "";

export default async (ctx: Context) => {
  const graphs = await loadGraphs(ctx);
  const several = graphs.length > 1;
  return list({
    placeholder: "Search pages and blocks…",
    filter: several
      ? { options: [{ value: "all", title: "All Graphs" }, ...graphs.map((g) => ({ value: g.path, title: g.name }))] }
      : undefined,
    empty: graphs.length
      ? { title: "Nothing found", description: "Press Enter on “Create” to start a page", icon: Icons.note }
      : NO_GRAPH,
    status: () => footer,
    actions: [action("Reload Graphs", () => (clearIndex(), refresh()), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    async search(query, { filter }) {
      const shown = !filter || filter === "all" ? graphs : graphs.filter((g) => g.path === filter);
      if (!shown.length) return [];
      const pages = (await Promise.all(shown.map((g) => indexGraph(g)))).flat();
      const q = query.trim();
      const items: Item[] = [];
      if (!q) {
        const journals = pages.filter((p) => p.journal).length;
        footer = `${plural(pages.length - journals, "page")} · ${plural(journals, "journal")}${
          several ? ` in ${shown.length} graphs` : ` · ${shown[0].name}`
        }`;
        const today = await todayJournal(shown[0]);
        items.push({
          id: "today",
          title: today.exists ? "Open Today's Journal" : "Create Today's Journal",
          subtitle: today.title,
          icon: { source: Icons.calendar, tint: "teal" },
          section: "Journal",
          accessories: several ? [{ text: shown[0].name }] : [],
          actions: [open(today.uri, today.exists ? "Open Journal" : "Create Journal", { icon: Icons.calendar })],
        });
        const recent = [...pages].sort((a, b) => b.modified - a.modified).slice(0, 40);
        for (const p of recent) items.push(pageItem(p, { several, section: "Recently Modified" }));
        return items;
      }
      const ranked = pages
        .map((p) => ({
          p,
          s: Math.max(
            score(p.name, q) * 2,
            ...p.aliases.map((a) => score(a, q) * 2),
            ...p.tags.map((t) => score(t, q)),
          ),
        }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || b.p.backlinks - a.p.backlinks || b.p.modified - a.p.modified);
      for (const { p } of ranked.slice(0, 25)) items.push(pageItem(p, { several, section: "Pages" }));
      const blocks = pages
        .flatMap((p) => p.page.blocks.map((b) => ({ p, b, s: score(b.content, q) })))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || b.p.modified - a.p.modified);
      for (const { p, b } of blocks.slice(0, 40)) items.push(blockItem(p, b, { several }));
      footer = `${plural(ranked.length, "page")} · ${plural(blocks.length, "block")}`;
      if (!ranked.some(({ p }) => p.name.toLowerCase() === q.toLowerCase())) {
        items.push({
          id: "create",
          title: `Create “${q}”`,
          subtitle: several ? `New page in ${shown[0].name}` : "New page",
          icon: { source: Icons.plus, tint: "green" },
          section: "Create",
          actions: [open(pageUri(shown[0].name, q), "Create Page in Logseq", { icon: Icons.plus })],
        });
      }
      return items;
    },
  });
};
