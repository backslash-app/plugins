import { action, type Context, Icons, list, updateCommandMetadata } from "@backslash/api";
import { readerOf } from "../api.ts";
import { groupEntries, summary, type View } from "../lib.ts";
import { live, notifyChanged } from "../live.ts";
import { entryItem, guarded } from "../views.ts";

let status = "";

export default (ctx: Context) =>
  list({
    placeholder: "Filter articles by title, feed, category…",
    filter: {
      options: [
        { value: "feed", title: "By Feed" },
        { value: "category", title: "By Category" },
        { value: "starred", title: "Starred" },
      ],
      default: "feed",
    },
    empty: { title: "All caught up", description: "No unread article: come back later", icon: Icons.rss },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : status,
    actions: [action("Reload", () => notifyChanged(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    items: ({ signal, filter }) =>
      live(() =>
        guarded(async () => {
          const r = readerOf(ctx.preferences);
          const view: View = filter === "starred" ? "starred" : "unread";
          const entries = await r.entries(view, signal);
          status = `${r.name} · ${summary(entries, view)}`;
          if (view === "unread") {
            updateCommandMetadata({ subtitle: entries.length ? `${entries.length} unread` : null }).catch(() => {});
          }
          const markRead = ctx.preferences.markReadOnOpen !== false;
          const unreadOf = new Map<string, number>();
          for (const e of entries) if (e.unread) unreadOf.set(e.feedId, (unreadOf.get(e.feedId) ?? 0) + 1);
          const key = filter === "category"
            ? (e: { category?: string }) => e.category ?? "Uncategorized"
            : filter === "starred"
            ? () => "Starred"
            : (e: { feedTitle: string }) => e.feedTitle;
          return groupEntries(entries, key).flatMap(([section, group]) =>
            group.map((e) =>
              entryItem(r, e, {
                section: filter === "starred" ? undefined : `${section} · ${group.length}`,
                markRead,
                feedUnread: unreadOf.get(e.feedId),
                showFeed: filter !== "feed",
              })
            )
          );
        }), signal),
  });
