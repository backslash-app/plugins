import { type Context, Icons, list } from "@backslash/api";
import { cachedFolders, loadFolders, raindrop } from "../api.ts";
import { AuthError, filterOptions, type Folder, linkIn, type Raindrop, setupItem, tokenOf } from "../lib.ts";
import { bookmarkItem, saveItem } from "../views.ts";

let total = 0;

export default async (ctx: Context) => {
  let token = "";
  let all: Folder[] = [];
  try {
    token = tokenOf(ctx.preferences);
    // The chips come from the collections saved last time; refreshed for the next time.
    all = await cachedFolders(token);
    loadFolders(token).then((fresh) => (all = fresh)).catch(() => {});
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }
  return list({
    placeholder: "Search bookmarks, #tag, type:article… or paste a link to save it",
    filter: all.length ? { options: filterOptions(all) } : undefined,
    empty: {
      title: "No bookmark found",
      description: "Raindrop.io searches titles, notes, tags and pages.",
      icon: Icons.bookmark,
    },
    status: (items) => {
      if (items[0]?.id === "setup") return "Not connected";
      const shown = items.filter((i) => i.id !== "save").length;
      const n = `${total} bookmark${total === 1 ? "" : "s"}`;
      return shown < total ? `${shown} of ${n}` : n;
    },
    async search(query, { signal, filter }) {
      let t: string;
      try {
        t = tokenOf(ctx.preferences);
      } catch (e) {
        if (e instanceof AuthError) return [setupItem(e)];
        throw e;
      }
      const collection = Number(filter ?? 0) || 0;
      const link = linkIn(query);
      const params = new URLSearchParams({ perpage: "50", page: "0", sort: query.trim() ? "score" : "-created" });
      if (query.trim()) params.set("search", link ?? query.trim());
      try {
        const res = await raindrop<{ items: Raindrop[]; count: number }>(t, `/raindrops/${collection}?${params}`, {
          signal,
        });
        total = res.count;
        const items = res.items.map((r) => bookmarkItem(t, r, all, { showCollection: collection === 0 }));
        if (!link) return items;
        const existing = res.items.find((r) => r.link.replace(/\/$/, "") === link.replace(/\/$/, ""));
        const target = collection > 0 || collection === -1 ? collection : -1;
        return [saveItem(t, link, all, target, existing), ...items.filter((i) => i.id !== String(existing?._id))];
      } catch (e) {
        if (e instanceof AuthError) return [setupItem(e)];
        throw e;
      }
    },
  });
};
