import { type Context, Icons, type Item, list } from "@backslash/api";
import { SetupError, type Wiki, wikisOf } from "../api.ts";
import { byUpdated, incomplete, interleave, type Page } from "../lib.ts";
import { pageItem, problemItem, setupItems } from "../views.ts";

let status = "";

export default (ctx: Context) => {
  const { wikis } = wikisOf(ctx.preferences);
  return list({
    placeholder: wikis.length ? `Search ${wikis.map((w) => w.name).join(", ")}…` : "Search your wikis…",
    filter: wikis.length > 1
      ? { options: [{ value: "all", title: "All Wikis" }, ...wikis.map((w) => ({ value: w.id, title: w.name }))] }
      : undefined,
    empty: { title: "No page found", description: "Try other words, or another wiki", icon: Icons.book },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : status,
    async search(query, { signal, filter }) {
      const { wikis, problems } = wikisOf(ctx.preferences);
      const half = incomplete(ctx.preferences);
      if (!wikis.length) return setupItems([...problems.map((p) => p.message), ...half]);
      const picked = wikis.filter((w) => w.id === filter);
      // "All", or a remembered chip of a wiki no longer set up: every wiki.
      const chosen = picked.length ? picked : wikis;
      const q = query.trim();
      const results = await Promise.allSettled(chosen.map((w) => q ? w.search(q, signal) : w.recent(signal)));
      if (signal.aborted) return [];
      const ok: { wiki: Wiki; pages: Page[] }[] = [];
      const failed: Item[] = problems.map((p) => problemItem(p.wiki, p));
      results.forEach((r, i) => {
        if (r.status === "fulfilled") ok.push({ wiki: chosen[i], pages: r.value });
        else failed.push(problemItem(chosen[i].id, r.reason instanceof Error ? r.reason : new Error(String(r.reason))));
      });
      // Every wiki failed for a reason the user can fix: show how.
      if (!ok.length && results.every((r) => r.status === "rejected" && r.reason instanceof SetupError)) {
        return setupItems(results.map((r) => ((r as PromiseRejectedResult).reason as Error).message));
      }
      const byWiki = new Map(ok.map((o) => [o.wiki.id, o.wiki]));
      const pages = q ? interleave(ok.map((o) => o.pages)) : byUpdated(ok.flatMap((o) => o.pages));
      const counts = ok.filter((o) => o.pages.length).map((o) => `${o.pages.length} in ${o.wiki.name}`);
      status = counts.length ? counts.join(" · ") : `Nothing in ${ok.map((o) => o.wiki.name).join(", ")}`;
      return [
        ...pages.map((p) => pageItem(byWiki.get(p.wiki)!, p, q ? undefined : "Recently Updated")),
        ...failed,
      ];
    },
  });
};
