import { type Context, Icons, type Item, list } from "@backslash/api";
import { type Account, guarded, search, token, trending, watchKey, watchlist, withDetails } from "../api.ts";
import { type Kind, matches, normalizeLanguage, normalizeRegion, type Title } from "../lib.ts";
import { titleItem } from "../views.ts";

type View = "all" | "movie" | "tv" | "watchlist";

export default (ctx: Context) => {
  const account = (): Account => ({
    token: token(ctx.preferences),
    region: normalizeRegion(ctx.preferences.region),
    language: normalizeLanguage(ctx.preferences.language),
  });
  return list({
    placeholder: "Search movies and TV shows…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "movie", title: "Movies" },
        { value: "tv", title: "TV Shows" },
        { value: "watchlist", title: "Watchlist" },
      ],
    },
    empty: { title: "Nothing found", description: "Try another title, or the original title", icon: Icons.film },
    status: (items) => {
      if (items[0]?.id === "setup") return "Not connected";
      const n = items.length;
      return `${n} title${n === 1 ? "" : "s"} · ${normalizeRegion(ctx.preferences.region)} · TMDB`;
    },
    search: (query, { signal, filter }) =>
      guarded(async (): Promise<Item[]> => {
        const a = account();
        const view = (filter ?? "all") as View;
        const saved = await watchlist();
        const watched = new Set(saved.map((s) => watchKey(s.title)));
        const item = (t: Title, section?: string) =>
          titleItem(t, { watched: watched.has(watchKey(t)), region: a.region, section });

        if (view === "watchlist") {
          const mine = saved.map((s) => s.title).filter((t) => matches(t, query));
          return (await withDetails(a, mine, signal, 30)).map((t) => item(t, "Watchlist"));
        }
        const kind: "all" | Kind = view === "movie" || view === "tv" ? view : "all";
        if (query.trim()) {
          return (await withDetails(a, await search(a, query, kind, signal), signal)).map((t) => item(t));
        }
        const found = await withDetails(a, await trending(a, kind, signal), signal, 20);
        const mine = saved.map((s) => s.title).filter((t) => kind === "all" || t.kind === kind).slice(0, 5);
        return [
          ...(await withDetails(a, mine, signal)).map((t) => item(t, "Watchlist")),
          ...found.map((t) => item(t, "Trending This Week")),
        ];
      }),
  });
};
