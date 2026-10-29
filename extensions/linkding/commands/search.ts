import { action, type Context, Icons, list } from "@backslash/api";
import { type Collection, type Service, serviceOf, SetupError } from "../api.ts";
import { type Filter, linkIn, sameUrl } from "../lib.ts";
import { bookmarkItem, saveForm, saveItem, setupItems } from "../views.ts";

let status = "";

export default (ctx: Context) => {
  let s: Service | undefined;
  try {
    s = serviceOf(ctx.preferences);
  } catch (e) {
    if (!(e instanceof SetupError)) throw e;
  }
  let collections: Collection[] = [];
  s?.collections().then((c) => (collections = c)).catch(() => {});
  return list({
    placeholder: s?.id === "linkding"
      ? "Search bookmarks, #tag… or paste a link to save it"
      : "Search links by name, URL, tag… or paste a link to save it",
    filter: s ? { options: s.filters } : undefined,
    empty: {
      title: "No bookmark found",
      description: "Searches titles, descriptions, notes, links and tags",
      icon: Icons.bookmark,
    },
    status: (items) => {
      if (items[0]?.id === "setup") return "Not connected";
      return status;
    },
    actions: s
      ? [action("New Bookmark…", () => saveForm(s, "", collections), { icon: Icons.plus, shortcut: "<Ctrl>n" })]
      : [],
    async search(query, { signal, filter }) {
      try {
        const service = serviceOf(ctx.preferences);
        const link = linkIn(query);
        // A pasted link: is it saved already? Search by it, offer to save it.
        const { items, total } = await service.search(link ?? query, (filter ?? "all") as Filter, signal);
        const n = total ?? items.length;
        status = `${service.name} · ${n} bookmark${n === 1 ? "" : "s"}${
          total !== undefined && total > items.length ? `, ${items.length} shown` : ""
        }`;
        const rows = items.map((b) => bookmarkItem(service, b));
        if (!link) return rows;
        const existing = items.find((b) => sameUrl(b.url, link)) ??
          await service.find(link, signal).catch(() => undefined);
        return [saveItem(service, link, collections, existing), ...rows.filter((r) => r.id !== existing?.id)];
      } catch (e) {
        if (e instanceof SetupError) return setupItems(e);
        throw e;
      }
    },
  });
};
