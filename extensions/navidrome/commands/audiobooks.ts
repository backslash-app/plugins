import { type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { absCover, type CoverRequest, covers } from "../api.ts";
import type { AbsItem } from "../lib.ts";
import { distro, mpvInstalled, nowPlaying } from "../player.ts";
import { bookItem, type Ctx, noMpvItem, nowPlayingItem, problemItem, serversFrom, setupItem } from "../views.ts";

let status = "";

export default (ctx: Context) => {
  const { sub, abs, problems } = serversFrom(ctx.preferences);
  const speed = Number(String(ctx.preferences.speed ?? "1").replace(",", "."));
  const c: Ctx = { sub, abs, pics: new Map(), speed: speed >= 0.5 && speed <= 3 ? speed : 1 };
  const mpv = mpvInstalled();
  return list({
    placeholder: "Search audiobooks, authors, series and podcasts…",
    filter: {
      options: [{ value: "continue", title: "Continue Listening" }, { value: "recent", title: "Recently Added" }],
    },
    empty: { title: "Nothing here", description: "Start a book, or search your libraries", icon: Icons.headphones },
    status: () => status,
    async search(query, { signal, filter }) {
      const head: Item[] = problems.filter((p) => p.id === "problem:abs");
      if (!abs) {
        status = "Not connected";
        return head.length ? head : [setupItem("abs")];
      }
      const q = query.trim();
      const [player, hasMpv] = await Promise.all([nowPlaying(abs), mpv]);
      updateCommandMetadata({ subtitle: player ? `Playing ${player.playing.title}` : null }).catch(() => {});
      if (!hasMpv) head.push(noMpvItem(await distro()));
      if (player && !q) head.push(nowPlayingItem(player, c));
      try {
        const rows: { item: AbsItem; section: string }[] = [];
        if (q || filter === "recent") {
          const libraries = await abs.libraries(signal);
          await Promise.all(libraries.map(async (l) => {
            const found = q ? await abs.search(l, q, signal) : await abs.recent(l, signal);
            for (const item of found) rows.push({ item, section: q ? l.name : `Recently Added · ${l.name}` });
          }));
          rows.sort((a, b) => a.section.localeCompare(b.section));
        } else {
          for (const item of await abs.inProgress(signal)) rows.push({ item, section: "Continue Listening" });
        }
        c.pics = await covers(
          rows.map((r) => absCover(abs, r.item)).filter((r): r is CoverRequest => r !== undefined),
          {
            signal,
            deadline: q ? 2000 : 3000,
          },
        );
        status = `${rows.length} ${q ? "result" : filter === "recent" ? "recent item" : "in progress"}${
          rows.length === 1 || !(q || filter === "recent") ? "" : "s"
        } · Audiobookshelf`;
        return [...head, ...rows.map((r) => bookItem(abs, r.item, c, { section: r.section }))];
      } catch (e) {
        if (signal.aborted) throw e;
        status = "";
        return [...head, problemItem(e as Error, "abs", abs.base)];
      }
    },
  });
};
