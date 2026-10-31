import { type Context, Icons, list } from "@backslash/api";
import { byBook, SOURCE_NAMES } from "../lib.ts";
import { loadAll, sourcesOf } from "../source.ts";
import { bookItem, problems } from "../views.ts";

let status = "";

export default (ctx: Context) => {
  const wanted = sourcesOf(ctx.preferences);
  return list({
    placeholder: "Filter books, articles and pages…",
    filter: wanted.length > 1
      ? { options: [{ value: "all", title: "All" }, ...wanted.map((s) => ({ value: s, title: SOURCE_NAMES[s] }))] }
      : undefined,
    status: () => status,
    empty: {
      title: "Nothing highlighted yet",
      description: "Books and articles show up here once they have a highlight.",
      icon: Icons.book,
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
        const books = byBook(shown);
        const many = new Set(shown.map((h) => h.source)).size > 1;
        status = `${books.length} source${books.length === 1 ? "" : "s"} · ${shown.length} highlights${
          l.partial ? " · syncing…" : ""
        }`;
        yield books.map((b) => bookItem(b, many));
      }
    },
  });
};
