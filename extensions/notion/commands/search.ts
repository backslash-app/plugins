import { type Context, list } from "@backslash/api";
import { EMPTY, guarded, needToken } from "../api.ts";
import { resultItem, search, titlesOf } from "../lib.ts";

export default (ctx: Context) =>
  list({
    placeholder: "Search Notion pages and databases…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "page", title: "Pages" },
        { value: "database", title: "Databases" },
      ],
    },
    empty: EMPTY,
    status: (items) =>
      items[0]?.id === "setup" ? "Not connected" : `${items.length} result${items.length === 1 ? "" : "s"}`,
    search: (query, { preferences, signal, filter }) =>
      guarded(async () => {
        const kind = filter === "page" || filter === "database" ? filter : undefined;
        const results = await search(needToken(preferences), query, kind, signal);
        const titles = titlesOf(results);
        const section = query.trim() ? undefined : "Recently edited";
        return results.map((r) => ({ ...resultItem(r, ctx, titles), section }));
      }),
  });
