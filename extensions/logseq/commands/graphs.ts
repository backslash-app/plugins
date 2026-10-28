import { type Context, copy, Icons, list, meta, open } from "@backslash/api";
import { ago, graphUri, plural } from "../lib.ts";
import { indexGraph, loadGraphs, NO_GRAPH, pickGraph, tildify, todayJournal } from "../graph.ts";

export default async (ctx: Context) => {
  const graphs = await loadGraphs(ctx);
  const current = pickGraph(graphs, ctx);
  return list({
    placeholder: "Logseq graphs…",
    empty: NO_GRAPH,
    status: `${graphs.length} graph${graphs.length === 1 ? "" : "s"}`,
    items: await Promise.all(graphs.map(async (g) => {
      const pages = await indexGraph(g);
      const journals = pages.filter((p) => p.journal).length;
      const blocks = pages.reduce((n, p) => n + p.page.blocks.length, 0);
      const today = await todayJournal(g);
      return {
        id: g.path,
        title: g.name,
        subtitle: tildify(g.path),
        icon: { source: Icons.layers, tint: g === current ? "teal" as const : "gray" as const },
        accessories: [
          ...(g === current ? [{ tag: "Journal & capture", color: "teal" as const }] : []),
          { text: plural(pages.length - journals, "page") },
          ...(g.used && Number.isFinite(g.used) ? [{ text: ago(g.used), tooltip: "Last opened in Logseq" }] : []),
        ],
        detail: {
          stats: [
            { label: "Pages", value: pages.length - journals },
            { label: "Journals", value: journals },
            { label: "Blocks", value: blocks.toLocaleString("en") },
          ],
          metadata: [
            meta.text("Folder", tildify(g.path), { icon: Icons.folder }),
            meta.text("Today", `${today.title}${today.exists ? "" : " (not created yet)"}`, { icon: Icons.calendar }),
            ...(g === current
              ? [meta.text("Used for", "Today's journal and captures", { icon: Icons.bolt, color: "teal" })]
              : []),
          ],
        },
        actions: [
          open(graphUri(g.name), "Open in Logseq", { icon: Icons.external }),
          open(today.uri, "Open Today's Journal", { icon: Icons.calendar, shortcut: "<Ctrl>j" }),
          open(g.path, "Show in Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
          copy(g.path, "Copy Folder Path", { shortcut: "<Ctrl><Shift>c" }),
        ],
      };
    })),
  });
};
