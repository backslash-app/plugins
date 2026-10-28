import {
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  openExternal,
  pop,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { cachedFeed, fetchFeed, itemKey, pruneRead, readState, type SavedFeed, setRead } from "../api.ts";
import { addFeedForm, allFeeds, live, removeFeed } from "../feeds.ts";
import { ago, dateSection, domain, excerpt, type Feed, type FeedItem, fullDate, plural } from "../lib.ts";

type Source = SavedFeed & { fromPreferences: boolean };
interface Result {
  source: Source;
  feed?: Feed;
  error?: string;
}

// Fetched feeds, kept while the launcher runs this extension so that marking
// an article as read doesn't download every feed again.
const memory = new Map<string, { at: number; feed: Feed }>();
const FRESH_FOR = 5 * 60_000;

async function fetchAll(sources: Source[], signal: AbortSignal): Promise<Result[]> {
  return await Promise.all(sources.map(async (source): Promise<Result> => {
    const hit = memory.get(source.url);
    if (hit && Date.now() - hit.at < FRESH_FOR) return { source, feed: hit.feed };
    try {
      const feed = await fetchFeed(source.url, signal);
      memory.set(source.url, { at: Date.now(), feed });
      return { source, feed };
    } catch (e) {
      if (signal.aborted) throw e;
      const cached = await cachedFeed(source.url);
      return { source, feed: cached?.feed, error: (e as Error).message };
    }
  }));
}

const feedTitle = (r: Result) => r.source.title || r.feed?.title || domain(r.source.url) || r.source.url;

const addFeed = action("Add Feed", () => addFeedForm(() => pop()), {
  icon: Icons.plus,
  shortcut: "<Ctrl>n",
  section: "Feeds",
});

const refreshAll = action("Refresh Feeds", () => {
  memory.clear();
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Feeds" });

function manageView(pref: unknown): ListSpec {
  return list({
    title: "Manage Feeds",
    placeholder: "Filter feeds…",
    empty: { title: "No feeds yet", description: "Add one with Ctrl+N", icon: Icons.rss },
    actions: [addFeed],
    status: (items) => plural(items.length, "feed"),
    items: ({ signal }) =>
      live(async function* () {
        const sources = await allFeeds(pref);
        yield sources.map((s): Item => {
          const feed = memory.get(s.url)?.feed;
          const title = s.title || feed?.title || domain(s.url) || s.url;
          return {
            id: s.url,
            title,
            subtitle: s.url,
            icon: { source: Icons.rss, tint: "orange" },
            accessories: [
              ...(feed ? [{ text: plural(feed.items.length, "article") }] : []),
              ...(s.fromPreferences ? [{ tag: "Settings", tooltip: "Listed in the extension settings" }] : []),
            ],
            detail: {
              markdown: feed?.description,
              metadata: [
                meta.text("Feed", s.url, { icon: Icons.rss }),
                ...(feed?.link ? [meta.link("Website", domain(feed.link) ?? feed.link, feed.link)] : []),
                ...(feed ? [meta.text("Articles", feed.items.length)] : []),
                meta.text("Added", s.fromPreferences ? "In the extension settings" : "From the launcher"),
              ],
            },
            actions: [
              ...(feed?.link ? [open(feed.link, "Open Website")] : []),
              copy(s.url, "Copy Feed URL"),
              ...(s.fromPreferences ? [] : [
                action("Remove Feed", async () => {
                  await removeFeed(s.url);
                  memory.delete(s.url);
                  await toast(`Unsubscribed from ${title}`, { style: "success" });
                }, {
                  icon: Icons.trash,
                  destructive: true,
                  confirm: `Unsubscribe from ${title}?`,
                  shortcut: "<Ctrl>x",
                  section: "Feeds",
                }),
              ]),
              addFeed,
            ],
          };
        });
      }, signal),
  });
}

function articleItem(r: Result, it: FeedItem, unread: boolean, section: string, all: Result[], pref: unknown): Item {
  const key = itemKey(r.source.url, it.id);
  const title = feedTitle(r);
  const keysOf = (rs: Result[]) => rs.flatMap((x) => (x.feed?.items ?? []).map((i) => itemKey(x.source.url, i.id)));
  const link = it.link ?? r.feed?.link;
  const actions: Action[] = [
    ...(link
      ? [action("Open Article", async () => {
        await setRead([key], true);
        await openExternal(link);
        return close();
      }, { icon: Icons.external })]
      : []),
    action(unread ? "Mark as Read" : "Mark as Unread", async () => {
      await setRead([key], unread);
      return refresh();
    }, { icon: unread ? Icons.check : Icons.dot, shortcut: "<Ctrl>u" }),
    ...(it.comments ? [open(it.comments, "Open Comments", { icon: Icons.comment })] : []),
    ...(it.enclosure ? [open(it.enclosure.url, "Open Attachment", { icon: Icons.download })] : []),
    action(`Mark All in ${title} as Read`, async () => {
      await setRead(keysOf([r]), true);
      return refresh();
    }, { icon: Icons.check, shortcut: "<Ctrl><Shift>u", section: "Feed" }),
    action("Mark Everything as Read", async () => {
      await setRead(keysOf(all), true);
      return refresh();
    }, { icon: Icons.check, confirm: "Mark every article as read?", section: "Feed" }),
    ...(r.feed?.link ? [open(r.feed.link, `Open ${title} Website`, { icon: Icons.globe, section: "Feed" })] : []),
    ...(r.source.fromPreferences ? [] : [
      action(`Unsubscribe from ${title}`, async () => {
        await removeFeed(r.source.url);
        memory.delete(r.source.url);
        return refresh();
      }, { icon: Icons.trash, destructive: true, confirm: `Unsubscribe from ${title}?`, section: "Feed" }),
    ]),
    addFeed,
    action("Manage Feeds", () => manageView(pref), { icon: Icons.settings, section: "Feeds" }),
    refreshAll,
    ...(link
      ? [
        copy(link, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
        copy(`[${it.title}](${link})`, "Copy as Markdown Link", { section: "Copy" }),
      ]
      : []),
  ];
  const summary = excerpt(it.html);
  return {
    id: key,
    title: it.title,
    subtitle: section === title ? it.author : title,
    icon: { source: Icons.rss, tint: unread ? "orange" : "gray" },
    section,
    keywords: [title, it.author ?? "", ...it.categories],
    accessories: [
      ...(it.categories[0] ? [{ tag: it.categories[0] }] : []),
      ...(unread ? [{ icon: { source: Icons.dot, tint: "blue" as const }, tooltip: "Unread" }] : []),
      ...(it.date ? [{ text: ago(it.date), tooltip: fullDate(it.date) }] : []),
    ],
    detail: {
      markdown: `## ${it.title}${summary ? `\n\n${summary}` : ""}`,
      metadata: [
        meta.text("Feed", title, { icon: Icons.rss, color: "orange" }),
        ...(it.author ? [meta.person("Author", it.author)] : []),
        ...(it.date ? [meta.text("Published", fullDate(it.date), { icon: Icons.calendar })] : []),
        ...(it.categories.length ? [meta.tags("Categories", it.categories.slice(0, 5))] : []),
        ...(link ? [meta.link("Link", domain(link) ?? link, link)] : []),
        meta.text("Status", unread ? "Unread" : "Read", {
          icon: unread ? Icons.dot : Icons.check,
          color: unread ? "blue" : "green",
        }),
      ],
    },
    actions,
  };
}

function build(results: Result[], read: Record<string, number>, filter: string, pref: unknown): Item[] {
  type Row = { r: Result; it: FeedItem; unread: boolean };
  const rows: Row[] = results.flatMap((r) =>
    (r.feed?.items ?? []).map((it) => ({ r, it, unread: !read[itemKey(r.source.url, it.id)] }))
  );
  const byDate = (a: Row, b: Row) => (b.it.date ?? 0) - (a.it.date ?? 0);
  let items: Item[];
  if (filter === "date") {
    items = rows.sort(byDate).map((x) => articleItem(x.r, x.it, x.unread, dateSection(x.it.date), results, pref));
  } else {
    const shown = filter === "unread" ? rows.filter((x) => x.unread) : rows;
    // Feeds in the order they were added; newest first in each.
    items = results.flatMap((r) =>
      shown.filter((x) => x.r === r).sort(byDate).map((x) =>
        articleItem(r, x.it, x.unread, feedTitle(r), results, pref)
      )
    );
    if (filter === "unread" && !items.length && rows.length) {
      items.push({
        id: "caught-up",
        title: "All caught up",
        subtitle: `${plural(rows.length, "article")} read`,
        icon: { source: Icons.check, tint: "green" },
        detail: { markdown: "Nothing new in your feeds. Press **Tab** to see every article." },
        actions: [refreshAll, addFeed, action("Manage Feeds", () => manageView(pref), { icon: Icons.settings })],
      });
    }
  }
  for (const r of results.filter((x) => x.error)) {
    items.push({
      id: `error:${r.source.url}`,
      title: `Couldn't refresh ${feedTitle(r)}`,
      subtitle: r.error,
      icon: { source: Icons.alert, tint: "red" },
      section: "Problems",
      detail: {
        markdown: `**${r.source.url}** ${r.error}.${r.feed ? "\n\nShowing the articles from the last refresh." : ""}`,
      },
      actions: [
        refreshAll,
        open(r.source.url, "Open Feed URL"),
        ...(r.source.fromPreferences ? [] : [
          action("Unsubscribe", async () => {
            await removeFeed(r.source.url);
            return refresh();
          }, { icon: Icons.trash, destructive: true, confirm: `Unsubscribe from ${feedTitle(r)}?` }),
        ]),
      ],
    });
  }
  return items;
}

const onboarding: Item = {
  id: "onboarding",
  title: "Add your first feed",
  subtitle: "Any RSS or Atom feed, or a website that has one",
  icon: { source: Icons.plus, tint: "orange" },
  detail: {
    markdown: "Paste the address of a feed or of a blog: its feed is found automatically.\n\n" +
      "You can also list feed URLs in **Settings → Extensions → Hacker News & RSS**.",
  },
  actions: [addFeed],
};

export default list({
  placeholder: "Filter articles by title, feed, author or category…",
  filter: {
    options: [
      { value: "unread", title: "Unread" },
      { value: "feed", title: "By Feed" },
      { value: "date", title: "By Date" },
    ],
  },
  empty: { title: "No articles", description: "Your feeds have no articles yet", icon: Icons.rss },
  actions: [addFeed, refreshAll],
  status: (items) => {
    const unread = items.filter((i) => i.accessories?.some((a) => a.tooltip === "Unread")).length;
    return items.some((i) => i.id === "onboarding")
      ? "No feeds yet"
      : `${unread} unread · ${plural(items.filter((i) => !i.id?.startsWith("error:")).length, "article")}`;
  },
  items: ({ preferences, filter, signal }) =>
    live(async function* () {
      const sources = await allFeeds(preferences.feeds);
      if (!sources.length) {
        yield [onboarding];
        return;
      }
      const mode = filter ?? "unread";
      // The last copy first, so the list shows up instantly, then the network.
      const cached = await Promise.all(sources.map(async (source) => ({
        source,
        feed: memory.get(source.url)?.feed ?? (await cachedFeed(source.url))?.feed,
      })));
      if (cached.some((c) => c.feed)) yield build(cached, await readState(), mode, preferences.feeds);
      const results = await fetchAll(sources, signal);
      const read = await readState();
      yield build(results, read, mode, preferences.feeds);
      const keys = results.flatMap((r) => (r.feed?.items ?? []).map((i) => itemKey(r.source.url, i.id)));
      const unread = keys.filter((k) => !read[k]).length;
      updateCommandMetadata({ subtitle: unread ? `${unread} unread` : null }).catch(() => {});
      if (results.every((r) => !r.error)) await pruneRead(new Set(keys));
    }, signal),
});
