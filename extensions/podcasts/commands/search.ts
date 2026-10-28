import { action, type Context, Icons, type Item, list, pop } from "@backslash/api";
import { allProgress, searchShows, subscriptions } from "../api.ts";
import { addFeedForm } from "../feeds.ts";
import { normalizeFeedUrl, speedOf } from "../lib.ts";
import { nowPlaying } from "../player.ts";
import { type Ctx, showItem } from "../views.ts";

export default (ctx: Context) => {
  const speed = speedOf(ctx.preferences.speed);
  const country = String(ctx.preferences.country ?? "").trim();
  const context = async (): Promise<Ctx> => ({ progress: await allProgress(), player: await nowPlaying(), speed });
  let count = 0;
  return list({
    placeholder: "Search Apple Podcasts: a show, a host, a topic…",
    empty: {
      title: "No podcast found",
      description: "Try another spelling, or add a feed by its URL",
      icon: Icons.mic,
    },
    status: () => (count ? `${count} shows · Apple Podcasts` : "Apple Podcasts directory"),
    actions: [
      action("Add Podcast by Feed URL", () => addFeedForm(() => pop()), { icon: Icons.rss, shortcut: "<Ctrl>n" }),
    ],
    async search(query, { signal }) {
      const q = query.trim();
      const subscribed = new Set((await subscriptions()).map((s) => s.feedUrl));
      if (/^(https?|itpc|pcast|feed|podcast):\/\//i.test(q)) {
        const url = normalizeFeedUrl(q)!;
        count = 0;
        return [{
          id: "feed-url",
          title: `Subscribe to ${url}`,
          subtitle: "An RSS feed address",
          icon: { source: Icons.rss, tint: "orange" },
          actions: [action("Subscribe", () => addFeedForm(() => pop(), url), { icon: Icons.plus })],
        }];
      }
      if (!q) {
        count = 0;
        return [
          {
            id: "hint",
            title: "Type to search podcasts",
            subtitle: "Shows of the Apple Podcasts directory, or paste a feed URL",
            icon: { source: Icons.search, tint: "blue" },
            actions: [action("Add Podcast by Feed URL", () => addFeedForm(() => pop()), { icon: Icons.rss })],
          } satisfies Item,
        ];
      }
      const shows = await searchShows(q, country, signal);
      count = shows.length;
      return shows.map((s) => showItem(s, context, { subscribed: subscribed.has(s.feedUrl) }));
    },
  });
};
