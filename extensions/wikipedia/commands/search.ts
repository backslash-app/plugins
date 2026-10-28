import { action, type Context, Icons, type Item, list, open, refresh } from "@backslash/api";
import { search } from "../api.ts";
import { languageName, splitLanguage } from "../lib.ts";
import { articleView, defaultLanguage, forget, pageItem, recentItem, recents } from "../ui.ts";
import { randomView } from "./random.ts";
import { dayView } from "./on-this-day.ts";

let shown = "";

export default (ctx: Context) => {
  const fallback = defaultLanguage(ctx);
  const readFirst = !!(ctx.preferences as { readHere?: boolean }).readHere;
  return list({
    placeholder: `Search ${languageName(fallback)} Wikipedia… (fr: Paris for another language)`,
    status: () => shown,
    empty: {
      title: "No article found",
      description: "Check the spelling, or search another language with a prefix: “de: Berlin”",
      icon: Icons.book,
    },
    async search(query, { signal }) {
      const { lang, text, override } = splitLanguage(query, fallback);
      if (!text) {
        shown = `${languageName(lang)} Wikipedia`;
        const recent = await recents();
        const start: Item[] = [
          {
            id: "random",
            title: "Random Article",
            subtitle: `Something to read on ${languageName(lang)} Wikipedia`,
            icon: { source: Icons.shuffle, tint: "purple" },
            section: "Discover",
            actions: [action("Random Article", () => randomView(lang), { icon: Icons.shuffle })],
          },
          {
            id: "on-this-day",
            title: "On This Day",
            subtitle: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long" }),
            icon: { source: Icons.calendar, tint: "blue" },
            section: "Discover",
            actions: [action("On This Day", () => dayView(lang), { icon: Icons.calendar })],
          },
        ];
        return [
          ...recent.filter((r) => !override || r.lang === lang).map((r) => recentItem(r, readFirst)),
          ...start,
          ...(recent.length
            ? [
              <Item> {
                id: "clear",
                title: "Clear Recently Viewed",
                icon: { source: Icons.trash, tint: "gray" },
                section: "Discover",
                actions: [
                  action("Clear Recently Viewed", async () => {
                    await forget(undefined);
                    return refresh();
                  }, { icon: Icons.trash, destructive: true, confirm: "Forget every recently viewed article?" }),
                ],
              },
            ]
            : []),
        ];
      }
      const pages = await search(lang, text, signal);
      shown = `${pages.length} result${pages.length === 1 ? "" : "s"} · ${languageName(lang)} Wikipedia`;
      const exact = pages.findIndex((p) => p.title.toLowerCase() === text.toLowerCase());
      if (exact > 0) pages.unshift(...pages.splice(exact, 1));
      const items = pages.map((p) => pageItem(p, undefined, readFirst));
      const searchUrl = `https://${lang}.wikipedia.org/w/index.php?search=${encodeURIComponent(text)}&fulltext=1`;
      items.push({
        id: "search-site",
        title: `Search “${text}” on Wikipedia`,
        subtitle: `${languageName(lang)} · in the browser`,
        icon: { source: Icons.search, tint: "gray" },
        actions: [
          open(searchUrl, "Search in Browser", { icon: Icons.globe }),
          action(`Read “${text}” Here`, () => articleView(lang, text), { icon: Icons.book }),
        ],
      });
      return items;
    },
  });
};
