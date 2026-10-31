import { type Context, Icons, list } from "@backslash/api";
import { newestFirst, SOURCE_NAMES } from "../lib.ts";
import { loadAll, sourcesOf } from "../source.ts";
import { highlightItem, problems } from "../views.ts";

let status = "";

export default (ctx: Context) => {
  const wanted = sourcesOf(ctx.preferences);
  return list({
    placeholder: "Search highlights, notes, books, authors, #tags…",
    filter: wanted.length > 1
      ? { options: [{ value: "all", title: "All" }, ...wanted.map((s) => ({ value: s, title: SOURCE_NAMES[s] }))] }
      : undefined,
    status: () => status,
    empty: {
      title: "No highlight",
      description: "Highlight something in Readwise, on your Kindle or with Hypothes.is, then reload with Ctrl+R.",
      icon: Icons.bookmark,
    },
    async *items({ signal, filter }) {
      for await (const l of loadAll(ctx.preferences, signal)) {
        if (!l.partial) {
          const setup = await problems(l);
          if (setup) {
            status = "";
            yield setup;
            return;
          }
        }
        const shown = filter && filter !== "all" ? l.items.filter((h) => h.source === filter) : l.items;
        const many = new Set(l.items.map((h) => h.source)).size > 1;
        status = `${shown.length} highlight${shown.length === 1 ? "" : "s"}${l.partial ? " · syncing…" : ""}`;
        yield newestFirst(shown).map((h) => highlightItem(h, { showSource: many && (!filter || filter === "all") }));
      }
    },
  });
};
