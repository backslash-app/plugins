// Rows of posts and notifications, their actions, and the compose form.

import {
  type Action,
  action,
  close,
  type Color,
  copy,
  field,
  form,
  Icons,
  type Item,
  meta,
  open,
  refresh,
  toast,
} from "@backslash/api";
import {
  type Accounts,
  bskyPost,
  bskyToggle,
  mastodonPost,
  mastodonToggle,
  networksOf,
  postEverywhere,
  SetupError,
} from "./api.ts";
import {
  age,
  compact,
  counts,
  countText,
  type Network,
  NETWORK_NAMES,
  type Notice,
  noticeTitle,
  oneLine,
  type Post,
  replyPrefix,
  VISIBILITIES,
} from "./lib.ts";

export const NETWORK_TINT: Record<Network, Color> = { mastodon: "purple", bluesky: "blue" };

export function setupItems(e: SetupError): Item[] {
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Mastodon & Bluesky",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your accounts",
        "",
        "One or both, in **Settings → Extensions → Mastodon & Bluesky → Configure**:",
        "",
        "**Mastodon**: set your **instance** (`mastodon.social`, `fosstodon.org`…). On its website, open",
        "**Preferences → Development → New application**, tick `read`, `write:statuses` and",
        "`write:favourites`, save, and copy **Your access token**.",
        "",
        "**Bluesky**: set your **handle** (`ada.bsky.social` or your domain) and an **app password**:",
        "**Settings → Privacy and security → App passwords → Add App Password**. Never your account password:",
        "an app password can be revoked on its own.",
      ].join("\n"),
    },
    actions: [
      open("https://bsky.app/settings/app-passwords", "Create a Bluesky App Password", { icon: Icons.key }),
      open("https://joinmastodon.org/servers", "Find a Mastodon Server", { icon: Icons.globe }),
    ],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Posts

function postMarkdown(p: Post): string {
  const lines = [
    `**${p.author.name}** ${p.author.handle}`,
    ...(p.boostedBy ? [`_${p.network === "mastodon" ? "Boosted" : "Reposted"} by ${p.boostedBy}_`] : []),
    ...(p.replyTo ? [`_Reply to ${p.replyTo}_`] : []),
    "",
    ...(p.spoiler ? [`> **Content warning:** ${p.spoiler}`, ""] : []),
    p.text || "_No text_",
  ];
  const others = p.media.slice(1);
  for (const m of p.media.length && p.media[0].kind !== "image" ? p.media : others) {
    lines.push(
      "",
      m.kind === "link" ? `[${m.alt || m.url}](${m.url})` : `[${m.kind}${m.alt ? `: ${m.alt}` : ""}](${m.url})`,
    );
  }
  if (p.media[0]?.kind === "image" && p.media[0].alt) lines.push("", `_Picture: ${p.media[0].alt}_`);
  return lines.join("\n");
}

export function postDetail(p: Post) {
  const picture = p.media.find((m) => m.kind === "image" || m.kind === "gif" || m.kind === "video");
  return {
    image: picture ? picture.preview ?? picture.url : undefined,
    stats: [
      { label: "Replies", value: compact(p.replies) },
      {
        label: p.network === "mastodon" ? "Boosts" : "Reposts",
        value: compact(p.boosts),
        color: p.boosted ? "green" as const : undefined,
      },
      {
        label: p.network === "mastodon" ? "Favourites" : "Likes",
        value: compact(p.likes),
        color: p.liked ? "pink" as const : undefined,
      },
    ],
    markdown: postMarkdown(p),
    metadata: [
      meta.text("Network", NETWORK_NAMES[p.network], { icon: { source: Icons.globe, tint: NETWORK_TINT[p.network] } }),
      meta.text("Posted", new Date(p.createdAt).toLocaleString("en-GB"), { icon: Icons.clock }),
      ...(p.visibility && p.visibility !== "public"
        ? [meta.text("Visibility", p.visibility, { icon: Icons.lock })]
        : []),
    ],
  };
}

export function replyForm(a: Accounts, p: Post, me = "") {
  const limit = p.network === "mastodon" ? 500 : 300;
  return form({
    title: `Reply to ${p.author.name} on ${NETWORK_NAMES[p.network]}`,
    submitTitle: "Reply",
    fields: [
      field.textArea("text", `Reply (${limit} characters)`, { required: true, value: replyPrefix(p, me) }),
      ...(p.network === "mastodon"
        ? [field.dropdown("visibility", "Visibility", VISIBILITIES, {
          value: p.visibility === "direct" ? "direct" : a.mastodon?.visibility,
        })]
        : []),
    ],
    async submit(values) {
      const text = String(values.text ?? "").trim();
      if (!text) throw new Error("Write a reply first");
      const [c] = counts(text, [p.network]);
      if (c.over) throw new Error(`${countText(c)}: too long for ${NETWORK_NAMES[p.network]}`);
      if (p.network === "mastodon") {
        await mastodonPost(a.mastodon!, text, { replyTo: p.id, visibility: String(values.visibility || "public") });
      } else {
        await bskyPost(a.bluesky!, text, { reply: { root: p.root ?? p.ref!, parent: p.ref! } });
      }
      return close(`Replied to ${p.author.name}`);
    },
  });
}

export function postActions(a: Accounts, p: Post, me = ""): Action[] {
  const boost = p.network === "mastodon" ? "Boost" : "Repost";
  const like = p.network === "mastodon" ? "Favourite" : "Like";
  const toggle = (what: "boost" | "like", on: boolean) => async () => {
    if (p.network === "mastodon") {
      await mastodonToggle(a.mastodon!, p.id, what === "boost" ? "reblog" : "favourite", on);
    } else await bskyToggle(a.bluesky!, p, what === "boost" ? "repost" : "like", on);
    const name = what === "boost" ? boost : like;
    await toast(on ? `${name.replace(/e$/, "")}ed` : `${name} undone`, { style: "success" });
    return refresh();
  };
  return [
    open(p.url, `Open on ${p.network === "mastodon" ? new URL(a.mastodon?.base ?? "https://x").host : "bsky.app"}`),
    action("Reply", () => replyForm(a, p, me), { icon: Icons.comment, shortcut: "<Ctrl>r" }),
    action(p.boosted ? `Undo ${boost}` : boost, toggle("boost", !p.boosted), {
      icon: Icons.repeat,
      shortcut: "<Ctrl>b",
      section: "Post",
    }),
    action(p.liked ? `Undo ${like}` : like, toggle("like", !p.liked), {
      icon: p.liked ? Icons.heart : Icons.heartFilled,
      shortcut: "<Ctrl>l",
      section: "Post",
    }),
    ...(p.originalUrl && p.originalUrl !== p.url
      ? [open(p.originalUrl, "Open Original", { icon: Icons.external, shortcut: "<Ctrl>o" })]
      : []),
    ...p.media.filter((m) => m.kind === "link").map((m) =>
      open(m.url, "Open Link", { icon: Icons.link, section: "Post" })
    ),
    copy(p.originalUrl ?? p.url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(p.text ? [copy(p.text, "Copy Text", { section: "Copy" })] : []),
  ];
}

export function postItem(a: Accounts, p: Post, me = ""): Item {
  return {
    id: `${p.network}:${p.id}`,
    title: p.spoiler
      ? `CW: ${p.spoiler}`
      : oneLine(p.text || (p.media.length ? `(${p.media[0].kind})` : "(empty)"), 120),
    subtitle: `${p.author.name}${p.boostedBy ? ` · ↻ ${p.boostedBy}` : ""}`,
    icon: p.author.avatar ?? { source: Icons.person, tint: NETWORK_TINT[p.network] },
    keywords: [p.author.handle, p.author.name, NETWORK_NAMES[p.network], p.text.slice(0, 300)],
    accessories: [
      ...(p.media.some((m) => m.kind !== "link")
        ? [{ icon: Icons.image, tooltip: `${p.media.length} attachment(s)` }]
        : []),
      ...(p.liked ? [{ icon: { source: Icons.heartFilled, tint: "pink" as const }, tooltip: "You liked it" }] : []),
      ...(p.boosted ? [{ icon: { source: Icons.repeat, tint: "green" as const }, tooltip: "You boosted it" }] : []),
      { tag: p.network === "mastodon" ? "M" : "B", color: NETWORK_TINT[p.network], tooltip: NETWORK_NAMES[p.network] },
      { text: age(p.createdAt), tooltip: new Date(p.createdAt).toLocaleString("en-GB") },
    ],
    detail: postDetail(p),
    actions: postActions(a, p, me),
  };
}

// ---------------------------------------------------------------------------
// Notifications

const NOTICE_ICONS: Record<string, { source: string; tint: Color }> = {
  mention: { source: Icons.comment, tint: "blue" },
  reply: { source: Icons.comment, tint: "blue" },
  quote: { source: Icons.comment, tint: "teal" },
  boost: { source: Icons.repeat, tint: "green" },
  like: { source: Icons.heartFilled, tint: "pink" },
  follow: { source: Icons.person, tint: "purple" },
  "follow request": { source: Icons.person, tint: "orange" },
  poll: { source: Icons.check, tint: "gray" },
  edit: { source: Icons.text, tint: "gray" },
  post: { source: Icons.bell, tint: "gray" },
};

export function noticeItem(a: Accounts, n: Notice, me = ""): Item {
  const answerable = n.post && ["mention", "reply", "quote", "post"].includes(n.kind);
  return {
    id: `${n.network}:${n.id}`,
    title: noticeTitle(n),
    subtitle: n.text ? oneLine(n.text, 100) : n.who.length === 1 ? n.who[0].handle : undefined,
    icon: NOTICE_ICONS[n.kind] ?? { source: Icons.bell, tint: "gray" },
    section: n.unread ? "New" : undefined,
    keywords: [...n.who.map((w) => w.handle), n.kind, NETWORK_NAMES[n.network]],
    accessories: [
      ...(n.who.length > 1 ? [{ text: `+${n.who.length - 1}`, tooltip: n.who.map((w) => w.name).join(", ") }] : []),
      { avatar: n.who[0]?.avatar ?? n.who[0]?.name, tooltip: n.who[0]?.handle },
      { tag: n.network === "mastodon" ? "M" : "B", color: NETWORK_TINT[n.network], tooltip: NETWORK_NAMES[n.network] },
      { text: age(n.createdAt), tooltip: new Date(n.createdAt).toLocaleString("en-GB") },
    ],
    detail: n.post ? postDetail(n.post) : {
      markdown: `### ${noticeTitle(n)}\n\n${n.who.map((w) => `- **${w.name}** ${w.handle}`).join("\n")}`,
      metadata: [meta.text("Network", NETWORK_NAMES[n.network])],
    },
    actions: [
      open(n.url, "Open"),
      ...(answerable
        ? [action("Reply", () => replyForm(a, n.post!, me), { icon: Icons.comment, shortcut: "<Ctrl>r" })]
        : []),
      ...(answerable && n.post ? postActions(a, n.post, me).slice(2) : []),
      ...(n.who.length === 1 && n.post ? [copy(n.who[0].handle, "Copy Handle", { section: "Copy" })] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Compose

export const TARGETS = (a: Accounts) => {
  const nets = networksOf(a);
  return [
    ...(nets.length === 2 ? [{ value: "both", title: "Mastodon and Bluesky" }] : []),
    ...nets.map((n) => ({ value: n, title: NETWORK_NAMES[n] })),
  ];
};

export const targetNetworks = (a: Accounts, target: string): Network[] =>
  target === "both" ? networksOf(a) : networksOf(a).filter((n) => n === target);

/** Posts and closes with what happened; throws when nothing went out. */
export async function publish(
  a: Accounts,
  networks: Network[],
  text: string,
  o: { visibility?: string; spoiler?: string } = {},
) {
  const t = text.trim();
  if (!t) throw new Error("Write something first");
  const tooLong = counts(o.spoiler ? `CW: ${o.spoiler}\n\n${t}` : t, networks.filter((n) => n === "bluesky"))
    .concat(counts(t, networks.filter((n) => n === "mastodon")))
    .filter((c) => c.over);
  if (tooLong.length) {
    throw new Error(
      `Too long for ${tooLong.map((c) => `${NETWORK_NAMES[c.network]} (${countText(c)})`).join(" and ")}`,
    );
  }
  const { posted, failed } = await postEverywhere(a, networks, t, o);
  if (!posted.length) throw new Error(failed.map((f) => f.error).join(" · "));
  if (failed.length) {
    await toast(`Not posted to ${failed.map((f) => NETWORK_NAMES[f.network]).join(", ")}`, {
      style: "failure",
      message: failed.map((f) => f.error).join(" · "),
    });
  }
  return close(`Posted to ${posted.map((p) => NETWORK_NAMES[p.network]).join(" and ")}`);
}

export function composeForm(a: Accounts, initial = "", target = "") {
  const targets = TARGETS(a);
  const nets = networksOf(a);
  const c = counts(initial, nets).map((x) => `${NETWORK_NAMES[x.network]} ${countText(x)}`).join(" · ");
  return form({
    title: "New Post",
    submitTitle: "Post",
    fields: [
      field.textArea("text", initial ? `Post (${c})` : "Post (Mastodon 500 · Bluesky 300 characters)", {
        required: true,
        placeholder: "What's on your mind?",
        ...(initial ? { value: initial } : {}),
      }),
      field.dropdown("target", "Post to", targets, { value: target || targets[0].value }),
      ...(a.mastodon
        ? [
          field.dropdown("visibility", "Mastodon visibility", VISIBILITIES, { value: a.mastodon.visibility }),
          field.text("spoiler", "Content warning", { placeholder: "Optional: hides the post behind it" }),
        ]
        : []),
    ],
    async submit(values) {
      return await publish(a, targetNetworks(a, String(values.target || targets[0].value)), String(values.text ?? ""), {
        visibility: String(values.visibility || a.mastodon?.visibility || "public"),
        spoiler: String(values.spoiler ?? "").trim() || undefined,
      });
    },
  });
}
