import { type Context, Icons, list } from "@backslash/api";
import { readerOf } from "../api.ts";
import { sortFeeds } from "../lib.ts";
import { live } from "../live.ts";
import { feedItem, guarded } from "../views.ts";

let status = "";

export default (ctx: Context) =>
  list({
    placeholder: "Filter feeds by name, category, address…",
    filter: { options: [{ value: "unread", title: "With Unread" }, { value: "all", title: "All Feeds" }] },
    empty: { title: "No feed", description: "Nothing unread: pick All Feeds to see them all", icon: Icons.rss },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : status,
    items: ({ signal, filter }) =>
      live(() =>
        guarded(async () => {
          const r = readerOf(ctx.preferences);
          const feeds = sortFeeds(await r.feeds(signal));
          const unread = feeds.reduce((n, f) => n + f.unread, 0);
          const failing = feeds.filter((f) => f.error).length;
          status = [
            r.name,
            `${feeds.length} feed${feeds.length === 1 ? "" : "s"}`,
            `${unread} unread`,
            ...(failing ? [`${failing} failing`] : []),
          ].join(" · ");
          const shown = filter === "all" ? feeds : feeds.filter((f) => f.unread > 0 || f.error);
          // Categories with the most unread first.
          const weight = new Map<string, number>();
          for (const f of shown) weight.set(f.category ?? "", (weight.get(f.category ?? "") ?? 0) + f.unread);
          const markRead = ctx.preferences.markReadOnOpen !== false;
          return [...shown]
            .sort((a, b) =>
              (weight.get(b.category ?? "") ?? 0) - (weight.get(a.category ?? "") ?? 0) ||
              (a.category ?? "").localeCompare(b.category ?? "")
            )
            .map((f) => feedItem(r, f, markRead));
        }), signal),
  });
