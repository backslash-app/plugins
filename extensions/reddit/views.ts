// Posts as launcher items, the comments page and a subreddit's list.

import {
  type Accessory,
  type Action,
  action,
  type Color,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  refresh,
} from "@backslash/api";
import { comments, listing, type Loaded, Refused } from "./api.ts";
import { ago, cleanMarkdown, commentsMarkdown, compact, flairColor, fullDate, type Post, type Sort } from "./lib.ts";

export const SORTS: { value: Sort; title: string }[] = [
  { value: "hot", title: "Hot" },
  { value: "new", title: "New" },
  { value: "top", title: "Top Today" },
];

const KIND_ICONS: Record<Post["kind"], string> = {
  text: Icons.text,
  image: Icons.image,
  video: Icons.video,
  gallery: Icons.layers,
  link: Icons.link,
};

export const subUrl = (sub: string, sort: Sort = "hot") =>
  `https://www.reddit.com/r/${encodeURIComponent(sub)}/${sort === "top" ? "top/?t=day" : sort}`;

export async function commentsView(p: Post, signal: AbortSignal): Promise<DetailSpec> {
  const top = await comments(p.id, signal);
  return detail({
    title: p.title,
    markdown: commentsMarkdown(p, top),
    status: `${compact(p.score)} points · ${compact(p.comments)} comments · r/${p.subreddit}`,
    metadata: postMetadata(p),
    actions: [
      open(p.permalink, "Open Post on Reddit"),
      ...(p.link ? [open(p.link, "Open Link")] : []),
      copy(p.permalink, "Copy Post Link", { section: "Copy" }),
    ],
  });
}

function postMetadata(p: Post): Metadata[] {
  const lines: Metadata[] = [
    meta.text("Subreddit", `r/${p.subreddit}`, { icon: Icons.hash }),
    meta.person("Author", `u/${p.author}`, p.author),
    meta.text("Posted", `${ago(p.created)} · ${fullDate(p.created)}`, { icon: Icons.clock }),
  ];
  const badges: { text: string; color?: Color }[] = [];
  if (p.flair) badges.push({ text: p.flair, color: flairColor(p.flairColor) });
  if (p.nsfw) badges.push({ text: "NSFW", color: "red" });
  if (p.spoiler) badges.push({ text: "Spoiler", color: "orange" });
  if (p.pinned) badges.push({ text: "Pinned", color: "green" });
  if (p.locked) badges.push({ text: "Locked", color: "gray" });
  if (badges.length) lines.push(meta.tags("Flair", badges));
  if (p.ratio !== undefined) lines.push(meta.progress("Upvoted", p.ratio));
  if (p.link && p.domain) lines.push(meta.link("Link", p.domain, p.link));
  lines.push(meta.link("Post", `reddit.com/r/${p.subreddit}/comments/${p.id}`, p.permalink));
  return lines;
}

export function postItem(p: Post, o: { multi: boolean; browse?: (sub: string) => ListSpec }): Item {
  const accessories: Accessory[] = [];
  if (p.pinned) accessories.push({ icon: { source: Icons.pin, tint: "green" }, tooltip: "Pinned by the moderators" });
  if (p.flair) accessories.push({ tag: p.flair.slice(0, 20), color: flairColor(p.flairColor) });
  accessories.push(
    {
      text: compact(p.score),
      icon: { source: Icons.arrowUp, tint: p.score >= 1000 ? "orange" : "gray" },
      tooltip: `${p.score} points`,
    },
    { text: compact(p.comments), icon: Icons.comment, tooltip: `${p.comments} comments` },
    { text: ago(p.created), tooltip: fullDate(p.created) },
  );
  const actions: Action[] = [
    open(p.permalink, "Open Post"),
    ...(p.link ? [open(p.link, "Open Link", { shortcut: "<Ctrl>o" })] : []),
    action("Show Top Comments", (ctx) => commentsView(p, ctx.signal), { icon: Icons.comment, shortcut: "<Ctrl>t" }),
    ...(o.multi && o.browse
      ? [action(`Browse r/${p.subreddit}`, () => o.browse!(p.subreddit), { icon: Icons.hash, shortcut: "<Ctrl>r" })]
      : []),
    open(`https://www.reddit.com/user/${encodeURIComponent(p.author)}`, `Open u/${p.author}`, {
      icon: Icons.person,
      section: "Open",
    }),
    copy(p.link ?? p.permalink, "Copy Link", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ...(p.link ? [copy(p.permalink, "Copy Post Link", { section: "Copy" })] : []),
    copy(`[${p.title}](${p.permalink})`, "Copy as Markdown Link", { section: "Copy" }),
  ];
  const text = p.text && !p.spoiler ? cleanMarkdown(p.text, 900) : undefined;
  return {
    id: p.id,
    title: p.title,
    subtitle: o.multi ? `r/${p.subreddit}` : `u/${p.author}`,
    icon: { source: KIND_ICONS[p.kind], tint: p.nsfw ? "red" : p.pinned ? "green" : "orange" },
    keywords: [p.subreddit, p.author, p.flair ?? "", p.domain ?? ""],
    accessories,
    detail: {
      image: p.image,
      stats: [
        { label: "Points", value: compact(p.score), color: p.score >= 1000 ? "orange" : undefined },
        { label: "Comments", value: compact(p.comments) },
        ...(p.ratio !== undefined ? [{ label: "Upvoted", value: `${Math.round(p.ratio * 100)} %` }] : []),
      ],
      markdown: [`**${p.title}**`, ...(text ? ["", text] : p.spoiler ? ["", "*Spoiler hidden*"] : [])].join("\n"),
      metadata: postMetadata(p),
    },
    actions,
  };
}

/** Shown when Reddit refuses and nothing is saved, or for a subreddit that can't be read. */
export function refusedItem(e: Refused, webUrl: string): Item {
  return {
    id: "refused",
    title: e.message,
    subtitle: e.blocked ? "Reddit limits requests without an account" : undefined,
    icon: { source: e.blocked ? Icons.shield : Icons.alert, tint: "orange" },
    detail: {
      markdown: e.blocked
        ? [
          "## Reddit refused the request",
          "",
          "Reddit's public pages are rate limited, and refused outright from some networks",
          "(VPNs, cloud servers, some ISPs). This usually passes after a minute;",
          "otherwise open Reddit in the browser (Enter).",
        ].join("\n")
        : `## ${e.message}`,
    },
    actions: [
      open(webUrl, "Open in Browser"),
      action("Try Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

/** Posts of a listing, or the refusal; `note` receives a status for saved copies. */
export async function loadPosts(
  load: () => Promise<Loaded>,
  webUrl: string,
  item: (p: Post) => Item,
  note: (text: string) => void,
): Promise<Item[]> {
  try {
    const { posts, savedAt, refused } = await load();
    const age = savedAt && ago(savedAt);
    note(savedAt ? `${refused?.message ?? "Reddit refused"} · posts from ${age === "now" ? "a moment" : age} ago` : "");
    return posts.map(item);
  } catch (e) {
    if (e instanceof Refused) {
      note(e.message);
      return [refusedItem(e, webUrl)];
    }
    throw e;
  }
}

/** One subreddit, with the same Hot / New / Top views. */
export function subredditList(sub: string, nsfw: boolean): ListSpec {
  let note = "";
  return list({
    title: `r/${sub}`,
    placeholder: `Filter r/${sub} posts by title, author or flair…`,
    filter: { options: SORTS },
    empty: { title: "No posts", description: `r/${sub} has nothing here`, icon: Icons.comment },
    status: (items) => note || `${items.length} posts · r/${sub}`,
    actions: [open(subUrl(sub), `Open r/${sub} in Browser`)],
    items: ({ filter, signal }) => {
      const sort = (SORTS.some((s) => s.value === filter) ? filter : "hot") as Sort;
      return loadPosts(
        () => listing([sub], sort, nsfw, signal),
        subUrl(sub, sort),
        (p) => postItem(p, { multi: false }),
        (t) => (note = t),
      );
    },
  });
}
