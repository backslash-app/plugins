// Rows, actions and the reading view shared by Unread Articles and RSS Feeds.

import {
  type Action,
  action,
  close,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  openExternal,
  toast,
} from "@backslash/api";
import type { Reader } from "./api.ts";
import {
  age,
  domainOf,
  type Entry,
  excerpt,
  type Feed,
  formatReadingTime,
  htmlToMarkdown,
  htmlToText,
  longDate,
  SetupError,
  sortEntries,
  summary,
} from "./lib.ts";
import { live, notifyChanged } from "./live.ts";

export function setupItems(e: SetupError): Item[] {
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Miniflux & FreshRSS",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your feed reader",
        "",
        "Set **Service** to `miniflux` or `freshrss` (or leave it empty), then:",
        "",
        "- **Miniflux**: the **Server address** (empty for reader.miniflux.app) and an **API key**",
        "  from **Settings → API Keys → Create a new API key**.",
        "- **FreshRSS**: the **Server address**, your **User name** and an **API password**: in",
        "  FreshRSS, **Settings → Authentication → Allow API access** (as administrator), then",
        "  **Settings → Profile → API management**, set a password and submit.",
        "",
        "Self-hosted servers can be on this computer, your local network (`*.lan`, `*.local`, `192.168.x.x`…)",
        "or Tailscale (`*.ts.net`): an extension declares in advance the hosts it may reach.",
      ].join("\n"),
    },
    actions: [open("https://miniflux.app/docs/api.html", "Open Miniflux API Docs", { icon: Icons.book })],
  }];
}

/** Runs `load`, showing how to connect instead when the reader isn't set up or refuses. */
export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e);
    throw e;
  }
}

function entryMetadata(r: Reader, e: Entry): Metadata[] {
  return [
    meta.text("Feed", e.feedTitle, { icon: Icons.rss }),
    ...(e.category ? [meta.text("Category", e.category, { icon: Icons.folder })] : []),
    ...(e.author ? [meta.text("By", e.author, { icon: Icons.person })] : []),
    meta.text("Published", `${longDate(e.published)} (${age(e.published)})`, { icon: Icons.calendar }),
    meta.text("Reading time", formatReadingTime(e.readingTime), { icon: Icons.clock }),
    meta.text("State", e.unread ? "Unread" : "Read", {
      icon: e.unread ? Icons.inbox : Icons.check,
      color: e.unread ? "blue" : undefined,
    }),
    ...(e.starred ? [meta.text("Starred", "Yes", { icon: Icons.starFilled, color: "yellow" })] : []),
    meta.separator(),
    ...(e.url ? [meta.link("Original", domainOf(e.url) || e.url, e.url)] : []),
    ...(e.commentsUrl ? [meta.link("Comments", domainOf(e.commentsUrl), e.commentsUrl)] : []),
    meta.link(r.name, "Open in reader", r.entryUrl(e)),
  ];
}

async function change(what: Promise<void>, message: string, title: string) {
  await what;
  notifyChanged();
  await toast(message, { style: "success", message: title });
}

/** Mark read/unread, star, mark the feed read, copy and open: the actions after the first two. */
function entryActions(r: Reader, e: Entry, feedUnread?: number): Action[] {
  return [
    action(e.unread ? "Mark as Read" : "Mark as Unread", async () => {
      await change(r.setRead([e], e.unread), e.unread ? "Marked as read" : "Marked as unread", e.title);
      e.unread = !e.unread;
    }, { icon: e.unread ? Icons.check : Icons.inbox, shortcut: "<Ctrl>e", section: "Article" }),
    action(e.starred ? "Unstar" : "Star", async () => {
      await change(r.setStarred(e, !e.starred), e.starred ? "Unstarred" : "Starred", e.title);
      e.starred = !e.starred;
    }, { icon: e.starred ? Icons.star : Icons.starFilled, shortcut: "<Ctrl>s", section: "Article" }),
    action(`Mark All of ${e.feedTitle} as Read`, async () => {
      await change(r.markFeedRead(e.feedId), "Feed marked as read", e.feedTitle);
    }, {
      icon: Icons.squareCheck,
      shortcut: "<Ctrl><Shift>e",
      confirm: `Mark ${feedUnread ? `the ${feedUnread} unread articles` : "every article"} of ${e.feedTitle} as read?`,
      section: "Article",
    }),
    ...(e.commentsUrl ? [open(e.commentsUrl, "Open Comments", { icon: Icons.comment, section: "Open" })] : []),
    open(r.entryUrl(e), `Open in ${r.name}`, { icon: Icons.rss, shortcut: "<Ctrl>o", section: "Open" }),
    ...(e.url
      ? [
        copy(e.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
        copy(`[${e.title.replace(/[[\]]/g, "")}](${e.url})`, "Copy as Markdown Link", {
          shortcut: "<Ctrl><Shift>m",
          section: "Copy",
        }),
      ]
      : []),
  ];
}

/** Opens the original in the browser and, with the preference, marks the article read. */
function openOriginal(r: Reader, e: Entry, markRead: boolean): Action {
  return action("Open Original", async () => {
    await openExternal(e.url || r.entryUrl(e));
    if (markRead && e.unread) {
      await r.setRead([e], true);
      e.unread = false;
      notifyChanged();
    }
    return close();
  }, { icon: Icons.external });
}

export function readView(r: Reader, e: Entry, markRead: boolean) {
  const body = htmlToMarkdown(e.content, e.url || undefined);
  const words = body.split(/\s+/).filter(Boolean).length;
  if (markRead && e.unread) {
    // Reading it here counts as reading it; the list behind updates.
    r.setRead([e], true).then(() => {
      e.unread = false;
      notifyChanged();
    }).catch((err) => toast("Couldn't mark it as read", { style: "failure", message: (err as Error).message }));
  }
  return detail({
    title: e.title,
    markdown: [
      `# ${e.title}`,
      "",
      `_${[e.feedTitle, e.author, age(e.published), formatReadingTime(e.readingTime)].filter(Boolean).join(" · ")}_`,
      "",
      body || "_This feed only gives a link: open the original._",
    ].join("\n"),
    metadata: entryMetadata(r, e),
    status: `${words.toLocaleString("en-US")} words`,
    actions: [openOriginal(r, e, markRead), ...entryActions(r, e)],
  });
}

export function entryItem(
  r: Reader,
  e: Entry,
  o: { section?: string; markRead: boolean; feedUnread?: number; showFeed?: boolean },
): Item {
  const text = htmlToText(e.content);
  return {
    id: e.id,
    title: e.title,
    subtitle: o.showFeed === false ? domainOf(e.url) || undefined : e.feedTitle,
    icon: e.starred
      ? { source: Icons.starFilled, tint: "yellow" }
      : { source: e.unread ? Icons.rss : Icons.check, tint: e.unread ? "orange" : "gray" },
    section: o.section,
    keywords: [e.feedTitle, e.category ?? "", e.author ?? "", domainOf(e.url)].filter(Boolean),
    accessories: [
      ...(e.unread ? [] : [{ text: "read", color: "gray" as const }]),
      { text: formatReadingTime(e.readingTime), icon: Icons.clock, tooltip: "Reading time" },
      { text: age(e.published), tooltip: `Published ${longDate(e.published)}` },
    ],
    detail: {
      markdown: `### ${e.title}\n\n${text ? excerpt(text, 420) : "_No text in the feed: open the original._"}`,
      metadata: entryMetadata(r, e),
    },
    actions: [
      action("Read in Launcher", () => readView(r, e, o.markRead), { icon: Icons.book }),
      openOriginal(r, e, o.markRead),
      ...entryActions(r, e, o.feedUnread),
    ],
  };
}

/** The unread articles of one feed, opened from RSS Feeds. */
export function feedEntries(r: Reader, f: Feed, markRead: boolean) {
  let status = "";
  return list({
    title: f.title,
    placeholder: `Filter ${f.title}…`,
    empty: { title: "All read", description: `Nothing new in ${f.title}`, icon: Icons.check },
    status: () => status,
    actions: [
      action("Mark All as Read", async () => {
        await change(r.markFeedRead(f.id), "Feed marked as read", f.title);
      }, { icon: Icons.squareCheck, shortcut: "<Ctrl><Shift>e", confirm: `Mark everything in ${f.title} as read?` }),
    ],
    items: ({ signal }) =>
      live(() =>
        guarded(async () => {
          const entries = sortEntries(await r.entries("unread", signal, f.id));
          status = summary(entries, "unread");
          return entries.map((e) => entryItem(r, e, { markRead, feedUnread: entries.length, showFeed: false }));
        }), signal),
  });
}

export function feedItem(r: Reader, f: Feed, markRead: boolean): Item {
  return {
    id: f.id,
    title: f.title,
    subtitle: domainOf(f.siteUrl ?? f.feedUrl) || undefined,
    icon: f.error ? { source: Icons.alert, tint: "red" } : { source: Icons.rss, tint: f.unread ? "orange" : "gray" },
    section: f.category ?? "Uncategorized",
    keywords: [f.category ?? "", f.feedUrl ?? "", f.siteUrl ?? ""].filter(Boolean),
    accessories: [
      ...(f.disabled ? [{ tag: "disabled", color: "gray" as const }] : []),
      ...(f.unread ? [{ tag: String(f.unread), color: "blue" as const, tooltip: "Unread" }] : []),
    ],
    detail: {
      markdown: `### ${f.title}\n\n${
        f.error ? `> ⚠ The last fetch failed: ${f.error}` : f.unread ? `${f.unread} unread` : "_All read._"
      }`,
      metadata: [
        meta.text("Unread", String(f.unread), { icon: Icons.inbox, color: f.unread ? "blue" : undefined }),
        ...(f.category ? [meta.text("Category", f.category, { icon: Icons.folder })] : []),
        ...(f.siteUrl ? [meta.link("Website", domainOf(f.siteUrl), f.siteUrl)] : []),
        ...(f.feedUrl ? [meta.link("Feed", domainOf(f.feedUrl) || f.feedUrl, f.feedUrl)] : []),
        meta.separator(),
        meta.link(r.name, "Open in reader", r.feedUrl(f.id)),
      ],
    },
    actions: [
      action("Show Unread Articles", () => feedEntries(r, f, markRead), { icon: Icons.inbox }),
      open(r.feedUrl(f.id), `Open in ${r.name}`, { icon: Icons.rss }),
      action("Mark All as Read", async () => {
        await change(r.markFeedRead(f.id), "Feed marked as read", f.title);
      }, {
        icon: Icons.squareCheck,
        shortcut: "<Ctrl>e",
        confirm: `Mark the ${f.unread} unread articles of ${f.title} as read?`,
        section: "Feed",
      }),
      ...(f.siteUrl ? [open(f.siteUrl, "Open Website", { shortcut: "<Ctrl>o", section: "Feed" })] : []),
      ...(f.feedUrl ? [copy(f.feedUrl, "Copy Feed URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
    ],
  };
}
