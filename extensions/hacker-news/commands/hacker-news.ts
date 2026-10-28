import {
  type Action,
  action,
  close,
  type Color,
  type Context,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  openExternal,
} from "@backslash/api";
import { comments, markSeen, seenStories, stories } from "../api.ts";
import {
  ago,
  commentsMarkdown,
  type FeedName,
  FEEDS,
  fullDate,
  hnUrl,
  htmlToMarkdown,
  plural,
  type Story,
  userUrl,
} from "../lib.ts";

const KINDS: Record<Story["kind"], { label: string; icon: string; tint: Color }> = {
  story: { label: "Story", icon: Icons.arrowUp, tint: "orange" },
  ask: { label: "Ask HN", icon: Icons.question, tint: "purple" },
  show: { label: "Show HN", icon: Icons.eye, tint: "teal" },
  job: { label: "Job", icon: Icons.ticket, tint: "green" },
  poll: { label: "Poll", icon: Icons.activity, tint: "blue" },
};

/** Opens a page and remembers the story as read. */
const visit = (story: Story, url: string, title: string, options = {}) =>
  action(title, async () => {
    await markSeen(story.id);
    await openExternal(url);
    return close();
  }, { icon: Icons.external, ...options });

async function commentsView(story: Story, ctx: Context) {
  const top = await comments(story, ctx.signal);
  return detail({
    title: story.title,
    markdown: commentsMarkdown(story, top),
    status: `${plural(story.points, "point")} · ${plural(story.comments, "comment")}`,
    metadata: [
      meta.text("Points", story.points, { icon: Icons.arrowUp, color: "orange" }),
      meta.text("Comments", story.comments, { icon: Icons.comment }),
      meta.person("Author", story.author),
      meta.text("Posted", ago(story.time)),
      ...(story.domain ? [meta.link("Site", story.domain, story.url!)] : []),
    ],
    actions: [
      visit(story, hnUrl(story.id), "Open Comments on Hacker News"),
      ...(story.url ? [visit(story, story.url, "Open Link")] : []),
      copy(hnUrl(story.id), "Copy Hacker News Link"),
    ],
  });
}

function storyItem(story: Story, seen: boolean): Item {
  const kind = KINDS[story.kind];
  const hot = story.points >= 300;
  const link = story.url ?? hnUrl(story.id);
  const actions: Action[] = [
    visit(story, link, story.url ? "Open Link" : "Open on Hacker News"),
    visit(story, hnUrl(story.id), "Open Comments", { icon: Icons.comment }),
    action("Show Top Comments", (ctx) => commentsView(story, ctx), {
      icon: Icons.comment,
      shortcut: "<Ctrl>t",
    }),
    visit(story, userUrl(story.author), `Open ${story.author}’s Profile`, {
      icon: Icons.person,
      section: "Hacker News",
    }),
    copy(link, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(hnUrl(story.id), "Copy Hacker News Link", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(`[${story.title}](${link})`, "Copy as Markdown Link", { section: "Copy" }),
  ];
  return {
    id: String(story.id),
    title: story.title,
    subtitle: story.domain,
    icon: { source: kind.icon, tint: seen ? "gray" : kind.tint },
    keywords: [story.author, story.domain ?? "", kind.label],
    accessories: [
      {
        text: String(story.points),
        icon: { source: Icons.arrowUp, tint: hot ? "orange" : "gray" },
        tooltip: plural(story.points, "point"),
      },
      { text: String(story.comments), icon: Icons.comment, tooltip: plural(story.comments, "comment") },
      { text: ago(story.time), tooltip: fullDate(story.time) },
    ],
    detail: {
      stats: [
        { label: "Points", value: story.points, color: hot ? "orange" : undefined },
        { label: "Comments", value: story.comments },
        { label: "Rank", value: `#${story.rank}` },
      ],
      markdown: [`**${story.title}**`, ...(story.text ? ["", htmlToMarkdown(story.text).slice(0, 1200)] : [])].join(
        "\n",
      ),
      metadata: [
        meta.person("Author", story.author),
        meta.text("Posted", `${ago(story.time)} · ${fullDate(story.time)}`, { icon: Icons.clock }),
        meta.tags("Type", [{ text: kind.label, color: kind.tint }]),
        ...(story.domain ? [meta.link("Site", story.domain, story.url!)] : []),
        meta.link("Discussion", `news.ycombinator.com/item?id=${story.id}`, hnUrl(story.id)),
        ...(seen ? [meta.text("Status", "Opened", { icon: Icons.check, color: "green" })] : []),
      ],
    },
    actions,
  };
}

export default list({
  placeholder: "Filter stories by title, site or author…",
  filter: {
    options: (Object.keys(FEEDS) as FeedName[]).map((value) => ({ value, title: FEEDS[value].title })),
  },
  empty: { title: "No stories", description: "Hacker News returned nothing for this list", icon: Icons.arrowUp },
  status: (items) => `${items.length} stories · Hacker News`,
  async items({ filter, signal, preferences }) {
    const count = Math.max(10, Math.min(100, Number(preferences.stories) || 40));
    const feed = (filter && filter in FEEDS ? filter : "top") as FeedName;
    const [found, seen] = await Promise.all([stories(feed, count, signal), seenStories()]);
    return found.map((s) => storyItem(s, seen.has(s.id)));
  },
});
