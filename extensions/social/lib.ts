// Mastodon statuses and Bluesky posts as one kind of post, character counts
// as each network counts them, and Bluesky rich text (facets) with their
// UTF-8 byte offsets.

export type Network = "mastodon" | "bluesky";

export const LIMITS: Record<Network, number> = { mastodon: 500, bluesky: 300 };
export const NETWORK_NAMES: Record<Network, string> = { mastodon: "Mastodon", bluesky: "Bluesky" };

export interface Media {
  kind: "image" | "video" | "gif" | "audio" | "link";
  url: string;
  preview?: string;
  alt?: string;
}

/** What Bluesky needs to like, repost or reply to a post. */
export interface StrongRef {
  uri: string;
  cid: string;
}

export interface Post {
  network: Network;
  /** Mastodon status id on your instance; Bluesky at:// uri. */
  id: string;
  /** Where to open it: on your instance for Mastodon, bsky.app for Bluesky. */
  url: string;
  /** The original page (the author's server), when it is elsewhere. */
  originalUrl?: string;
  author: { name: string; handle: string; avatar?: string };
  text: string;
  createdAt: number;
  boostedBy?: string;
  replyTo?: string;
  spoiler?: string;
  visibility?: string;
  replies: number;
  boosts: number;
  likes: number;
  liked: boolean;
  boosted: boolean;
  media: Media[];
  /** Bluesky: the post itself, its thread root, and our like and repost records. */
  ref?: StrongRef;
  root?: StrongRef;
  likeUri?: string;
  repostUri?: string;
}

export interface Notice {
  network: Network;
  id: string;
  kind: string;
  createdAt: number;
  who: { name: string; handle: string; avatar?: string }[];
  /** The post it is about, when it has one. */
  post?: Post;
  /** The text of a reply or mention, or of the post liked. */
  text?: string;
  unread: boolean;
  url: string;
}

// ---------------------------------------------------------------------------
// Text

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Mastodon's HTML (`<p>`, `<br>`, links with invisible parts) → plain text. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<span class="invisible">[^<]*<\/span>/g, "")
      .replace(/<span class="ellipsis">([^<]*)<\/span>/g, "$1…")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n\n")
      .replace(/<[^>]+>/g, ""),
  ).replace(/\n{3,}/g, "\n\n").trim();
}

/** One line for a row. */
export const oneLine = (s: string, max = 140) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** User-perceived characters: 👍🏽 and é count as one, as both networks count them. */
export const graphemes = (s: string) => [...segmenter.segment(s)].length;

export const utf8Length = (s: string) => new TextEncoder().encode(s).length;

/** Trailing punctuation is not part of a link, nor an unbalanced closing parenthesis. */
function trimUrl(url: string): string {
  let u = url.replace(/[.,;:!?'"’”]+$/, "");
  while (u.endsWith(")") && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) {
    u = u.slice(0, -1).replace(/[.,;:!?'"]+$/, "");
  }
  return u;
}

const URL_RE = /(^|[\s(<"'«])(https?:\/\/[^\s<>"«»]+)/giu;

/** Links in a text, with their character index. */
export function findUrls(text: string): { url: string; index: number }[] {
  return [...text.matchAll(URL_RE)].map((m) => ({ url: trimUrl(m[2]), index: m.index! + m[1].length }))
    .filter((u) => u.url.length > "https://".length);
}

/**
 * Characters as Mastodon counts them: every link is 23, and a mention
 * `@ada@example.org` counts as `@ada`.
 */
export function mastodonLength(text: string): number {
  let t = text;
  for (const { url } of findUrls(text).sort((a, b) => b.url.length - a.url.length)) {
    t = t.split(url).join("x".repeat(23));
  }
  t = t.replace(/(^|[^\w@])@(\w+)@[\w.-]+\w/g, "$1@$2");
  return graphemes(t);
}

// ---------------------------------------------------------------------------
// Bluesky rich text

export type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: (
    | { $type: "app.bsky.richtext.facet#link"; uri: string }
    | { $type: "app.bsky.richtext.facet#mention"; did: string }
    | { $type: "app.bsky.richtext.facet#tag"; tag: string }
  )[];
};

export interface Segment {
  kind: "link" | "mention" | "tag";
  /** The URL, the handle (without @) or the tag (without #). */
  value: string;
  /** Positions in the text, in UTF-8 bytes. */
  byteStart: number;
  byteEnd: number;
}

/** "https://www.example.com/some/long/path?x=1" → "example.com/some/long/…", as the Bluesky app shows links. */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, "");
    const rest = `${u.pathname === "/" ? "" : u.pathname}${u.search}${u.hash}`;
    if (!rest) return host;
    return rest.length > 15 ? `${host}${rest.slice(0, 13)}...` : `${host}${rest}`;
  } catch {
    return url;
  }
}

const MENTION_RE =
  /(^|[\s(])@([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+)/g;
const TAG_RE = /(^|\s)[#＃]([\p{L}\p{M}\p{N}_]*[\p{L}\p{M}_][\p{L}\p{M}\p{N}_]*)/gu;

/**
 * The text as Bluesky shows it (long links shortened, their full URL kept in
 * the facet) and its links, mentions and hashtags with UTF-8 byte offsets.
 */
export function richText(input: string, o: { shorten?: boolean } = {}): { text: string; segments: Segment[] } {
  const shorten = o.shorten ?? true;
  let text = "";
  let last = 0;
  const links: { url: string; start: number; end: number }[] = [];
  for (const { url, index } of findUrls(input)) {
    text += input.slice(last, index);
    const shown = shorten ? shortUrl(url) : url;
    links.push({ url, start: text.length, end: text.length + shown.length });
    text += shown;
    last = index + url.length;
  }
  text += input.slice(last);

  const bytes = (charIndex: number) => utf8Length(text.slice(0, charIndex));
  const insideLink = (i: number) => links.some((l) => i >= l.start && i < l.end);
  const segments: Segment[] = links.map((l) => ({
    kind: "link",
    value: l.url,
    byteStart: bytes(l.start),
    byteEnd: bytes(l.end),
  }));
  for (const m of text.matchAll(MENTION_RE)) {
    const start = m.index! + m[1].length;
    const handle = m[2].replace(/\.+$/, "");
    if (insideLink(start) || !/\.[a-z][a-z0-9-]*$/i.test(handle)) continue;
    segments.push({
      kind: "mention",
      value: handle.toLowerCase(),
      byteStart: bytes(start),
      byteEnd: bytes(start + 1 + handle.length),
    });
  }
  for (const m of text.matchAll(TAG_RE)) {
    const start = m.index! + m[1].length;
    const tag = m[2];
    if (insideLink(start) || tag.length > 64) continue;
    segments.push({ kind: "tag", value: tag, byteStart: bytes(start), byteEnd: bytes(start + 1 + tag.length) });
  }
  return { text, segments: segments.sort((a, b) => a.byteStart - b.byteStart) };
}

/** Facets for a post; mentions whose handle didn't resolve to a DID are left as text. */
export function toFacets(segments: Segment[], dids: Map<string, string> = new Map()): Facet[] {
  return segments.flatMap((s): Facet[] => {
    const index = { byteStart: s.byteStart, byteEnd: s.byteEnd };
    if (s.kind === "link") return [{ index, features: [{ $type: "app.bsky.richtext.facet#link", uri: s.value }] }];
    if (s.kind === "tag") return [{ index, features: [{ $type: "app.bsky.richtext.facet#tag", tag: s.value }] }];
    const did = dids.get(s.value);
    return did ? [{ index, features: [{ $type: "app.bsky.richtext.facet#mention", did }] }] : [];
  });
}

/** Bluesky counts the text as shown, with links shortened. */
export const blueskyLength = (text: string) => graphemes(richText(text).text);

export interface Count {
  network: Network;
  used: number;
  limit: number;
  over: boolean;
}

export function counts(text: string, networks: Network[]): Count[] {
  return networks.map((network) => {
    const used = network === "mastodon" ? mastodonLength(text) : blueskyLength(text);
    return { network, used, limit: LIMITS[network], over: used > LIMITS[network] };
  });
}

/** "123/500" */
export const countText = (c: Count) => `${c.used}/${c.limit}`;

// ---------------------------------------------------------------------------
// Settings

export const VISIBILITIES = [
  { value: "public", title: "Public" },
  { value: "unlisted", title: "Quiet public (unlisted)" },
  { value: "private", title: "Followers only" },
  { value: "direct", title: "Mentioned people only" },
];

export function parseVisibility(input: unknown): string {
  const v = String(input ?? "").trim().toLowerCase();
  if (/^(unlisted|quiet)/.test(v)) return "unlisted";
  if (/^(private|followers)/.test(v)) return "private";
  if (/^(direct|mention)/.test(v)) return "direct";
  return "public";
}

/** "mastodon.social", "@ada@mastodon.social", "https://mastodon.social/home" → "https://mastodon.social". */
export function normalizeInstance(input: unknown): string {
  let s = String(input ?? "").trim();
  if (!s) return "";
  const acct = /^@?[\w.-]+@([\w.-]+\.[a-z]{2,})$/i.exec(s);
  if (acct) s = acct[1];
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "";
  }
}

/** "@ada.bsky.social " → "ada.bsky.social"; a DID is kept. */
export function normalizeHandle(input: unknown): string {
  const s = String(input ?? "").trim().replace(/^@/, "");
  return s.startsWith("did:") ? s : s.toLowerCase();
}

export function normalizeService(input: unknown): string {
  const s = String(input ?? "").trim() || "https://bsky.social";
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  return url.replace(/\/+$/, "").replace(/\/xrpc$/, "");
}

/** The PDS of an account, from the DID document createSession returns. */
export function pdsEndpoint(didDoc: unknown): string | undefined {
  const services = (didDoc as { service?: { id?: string; type?: string; serviceEndpoint?: unknown }[] })?.service;
  const pds = services?.find((s) => s.id === "#atproto_pds" || s.type === "AtprotoPersonalDataServer");
  return typeof pds?.serviceEndpoint === "string" && /^https:\/\//.test(pds.serviceEndpoint)
    ? pds.serviceEndpoint.replace(/\/+$/, "")
    : undefined;
}

// ---------------------------------------------------------------------------
// Mastodon

export interface MastodonAccount {
  id: string;
  acct: string;
  username?: string;
  display_name?: string;
  avatar?: string;
  avatar_static?: string;
  url?: string;
}

export interface MastodonStatus {
  id: string;
  created_at: string;
  content: string;
  url?: string | null;
  uri?: string;
  spoiler_text?: string;
  visibility?: string;
  in_reply_to_id?: string | null;
  in_reply_to_account_id?: string | null;
  account: MastodonAccount;
  reblog?: MastodonStatus | null;
  replies_count?: number;
  reblogs_count?: number;
  favourites_count?: number;
  favourited?: boolean;
  reblogged?: boolean;
  media_attachments?: { type: string; url?: string | null; preview_url?: string | null; description?: string | null }[];
  mentions?: { acct: string; id: string }[];
  card?: { url?: string; title?: string; image?: string | null } | null;
}

export interface MastodonNotification {
  id: string;
  type: string;
  created_at: string;
  account: MastodonAccount;
  status?: MastodonStatus | null;
}

const accountName = (a: MastodonAccount) => (a.display_name ?? "").trim() || a.username || a.acct;

/** The custom emoji shortcodes stay as text: `:blobcat:`. */
export function fromMastodon(s: MastodonStatus, instance: string): Post {
  const original = s.reblog ?? s;
  const kind = (t: string): Media["kind"] =>
    t === "gifv" ? "gif" : t === "video" ? "video" : t === "audio" ? "audio" : "image";
  return {
    network: "mastodon",
    id: original.id,
    url: `${instance}/@${original.account.acct}/${original.id}`,
    originalUrl: original.url ?? original.uri ?? undefined,
    author: {
      name: accountName(original.account),
      handle: `@${original.account.acct}`,
      avatar: original.account.avatar_static ?? original.account.avatar,
    },
    text: htmlToText(original.content ?? ""),
    createdAt: Date.parse(original.created_at),
    boostedBy: s.reblog ? accountName(s.account) : undefined,
    replyTo: original.in_reply_to_id ? "a post" : undefined,
    spoiler: original.spoiler_text?.trim() || undefined,
    visibility: original.visibility,
    replies: original.replies_count ?? 0,
    boosts: original.reblogs_count ?? 0,
    likes: original.favourites_count ?? 0,
    liked: !!original.favourited,
    boosted: !!original.reblogged,
    media: [
      ...(original.media_attachments ?? []).flatMap((m) =>
        m.url
          ? [{ kind: kind(m.type), url: m.url, preview: m.preview_url ?? undefined, alt: m.description ?? undefined }]
          : []
      ),
      ...(original.card?.url
        ? [{
          kind: "link" as const,
          url: original.card.url,
          preview: original.card.image ?? undefined,
          alt: original.card.title,
        }]
        : []),
    ],
  };
}

const MASTODON_KINDS: Record<string, string> = {
  mention: "mention",
  status: "post",
  reblog: "boost",
  favourite: "like",
  follow: "follow",
  follow_request: "follow request",
  poll: "poll",
  update: "edit",
  quote: "quote",
};

export function fromMastodonNotification(n: MastodonNotification, instance: string): Notice {
  const post = n.status ? fromMastodon(n.status, instance) : undefined;
  return {
    network: "mastodon",
    id: n.id,
    kind: MASTODON_KINDS[n.type] ?? n.type,
    createdAt: Date.parse(n.created_at),
    who: [{
      name: accountName(n.account),
      handle: `@${n.account.acct}`,
      avatar: n.account.avatar_static ?? n.account.avatar,
    }],
    post,
    text: post?.text,
    unread: false,
    url: post?.url ?? `${instance}/@${n.account.acct}`,
  };
}

// ---------------------------------------------------------------------------
// Bluesky

export interface BskyAuthor {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface BskyPostView {
  uri: string;
  cid: string;
  author: BskyAuthor;
  record: {
    text?: string;
    createdAt?: string;
    reply?: { root?: StrongRef; parent?: StrongRef };
    facets?: Facet[];
  };
  embed?: {
    $type?: string;
    images?: { thumb?: string; fullsize?: string; alt?: string }[];
    external?: { uri?: string; title?: string; thumb?: string };
    playlist?: string;
    thumbnail?: string;
    media?: BskyPostView["embed"];
  };
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  indexedAt?: string;
  viewer?: { like?: string; repost?: string };
}

export interface BskyFeedItem {
  post: BskyPostView;
  reason?: { $type?: string; by?: BskyAuthor };
  reply?: { parent?: { author?: BskyAuthor } };
}

export interface BskyNotification {
  uri: string;
  cid: string;
  author: BskyAuthor;
  reason: string;
  reasonSubject?: string;
  record?: { text?: string; subject?: StrongRef };
  isRead: boolean;
  indexedAt: string;
}

/** at://did:plc:x/app.bsky.feed.post/3k… → its record key. */
export const rkey = (uri: string) => uri.split("/").pop() ?? "";

export const bskyPostUrl = (handle: string, uri: string) => `https://bsky.app/profile/${handle}/post/${rkey(uri)}`;

/** The text with links expanded back to their full URL (facets say where they are). */
export function expandLinks(text: string, facets: Facet[] = []): string {
  const bytes = new TextEncoder().encode(text);
  const decode = (a: Uint8Array) => new TextDecoder().decode(a);
  let out = "";
  let last = 0;
  for (const f of [...facets].sort((a, b) => a.index.byteStart - b.index.byteStart)) {
    const link = f.features.find((x) => x.$type === "app.bsky.richtext.facet#link") as { uri: string } | undefined;
    if (!link || f.index.byteStart < last || f.index.byteEnd > bytes.length) continue;
    out += decode(bytes.slice(last, f.index.byteStart)) + link.uri;
    last = f.index.byteEnd;
  }
  return out + decode(bytes.slice(last));
}

function bskyMedia(embed: BskyPostView["embed"]): Media[] {
  if (!embed) return [];
  if (embed.media) return bskyMedia(embed.media);
  const images = (embed.images ?? []).flatMap((i) =>
    i.fullsize ? [{ kind: "image" as const, url: i.fullsize, preview: i.thumb, alt: i.alt }] : []
  );
  if (images.length) return images;
  if (embed.playlist) return [{ kind: "video", url: embed.playlist, preview: embed.thumbnail }];
  if (embed.external?.uri) {
    return [{ kind: "link", url: embed.external.uri, preview: embed.external.thumb, alt: embed.external.title }];
  }
  return [];
}

export function fromBluesky(item: BskyFeedItem | { post: BskyPostView }): Post {
  const p = item.post;
  const reason = (item as BskyFeedItem).reason;
  const parent = (item as BskyFeedItem).reply?.parent?.author;
  const ref = { uri: p.uri, cid: p.cid };
  return {
    network: "bluesky",
    id: p.uri,
    url: bskyPostUrl(p.author.handle, p.uri),
    author: {
      name: p.author.displayName?.trim() || p.author.handle,
      handle: `@${p.author.handle}`,
      avatar: p.author.avatar,
    },
    text: expandLinks(p.record.text ?? "", p.record.facets),
    createdAt: Date.parse(p.record.createdAt ?? p.indexedAt ?? "") || Date.parse(p.indexedAt ?? "") || 0,
    boostedBy: reason?.$type === "app.bsky.feed.defs#reasonRepost" && reason.by
      ? reason.by.displayName?.trim() || reason.by.handle
      : undefined,
    replyTo: p.record.reply ? parent ? `@${parent.handle}` : "a post" : undefined,
    replies: p.replyCount ?? 0,
    boosts: p.repostCount ?? 0,
    likes: p.likeCount ?? 0,
    liked: !!p.viewer?.like,
    boosted: !!p.viewer?.repost,
    media: bskyMedia(p.embed),
    ref,
    root: p.record.reply?.root ?? ref,
    likeUri: p.viewer?.like,
    repostUri: p.viewer?.repost,
  };
}

const BSKY_KINDS: Record<string, string> = {
  like: "like",
  repost: "boost",
  follow: "follow",
  mention: "mention",
  reply: "reply",
  quote: "quote",
  "like-via-repost": "like",
  "repost-via-repost": "boost",
  "starterpack-joined": "starter pack",
};

/** Notifications, with likes and reposts of the same post grouped like the app does. */
export function fromBlueskyNotifications(list: BskyNotification[], subjects: Map<string, BskyPostView>): Notice[] {
  const out: Notice[] = [];
  const groups = new Map<string, Notice>();
  for (const n of list) {
    const kind = BSKY_KINDS[n.reason] ?? n.reason;
    const who = {
      name: n.author.displayName?.trim() || n.author.handle,
      handle: `@${n.author.handle}`,
      avatar: n.author.avatar,
    };
    const groupKey = (kind === "like" || kind === "boost") && n.reasonSubject ? `${kind} ${n.reasonSubject}` : "";
    const existing = groupKey ? groups.get(groupKey) : undefined;
    if (existing) {
      existing.who.push(who);
      existing.unread ||= !n.isRead;
      continue;
    }
    const subject = n.reasonSubject ? subjects.get(n.reasonSubject) : undefined;
    // Replies, mentions and quotes are posts themselves; likes and reposts are about one of ours.
    const ownPost = ["reply", "mention", "quote"].includes(kind) && n.record?.text !== undefined;
    const post = ownPost
      ? fromBluesky({
        post: { uri: n.uri, cid: n.cid, author: n.author, record: n.record ?? {}, indexedAt: n.indexedAt },
      })
      : subject
      ? fromBluesky({ post: subject })
      : undefined;
    const notice: Notice = {
      network: "bluesky",
      id: n.uri,
      kind,
      createdAt: Date.parse(n.indexedAt),
      who: [who],
      post,
      text: ownPost ? n.record?.text : post?.text,
      unread: !n.isRead,
      url: post?.url ?? `https://bsky.app/profile/${n.author.handle}`,
    };
    if (groupKey) groups.set(groupKey, notice);
    out.push(notice);
  }
  return out;
}

/** The posts liked or reposted that notifications point to, to fetch with getPosts. */
export function subjectUris(list: BskyNotification[]): string[] {
  return [...new Set(list.flatMap((n) => n.reasonSubject?.startsWith("at://") ? [n.reasonSubject] : []))];
}

/** "Ada", "Ada and Bob", "Ada and 3 others". */
export function people(who: { name: string }[]): string {
  if (who.length <= 1) return who[0]?.name ?? "Someone";
  if (who.length === 2) return `${who[0].name} and ${who[1].name}`;
  return `${who[0].name} and ${who.length - 1} others`;
}

export function noticeTitle(n: Notice): string {
  const by = people(n.who);
  switch (n.kind) {
    case "mention":
      return `${by} mentioned you`;
    case "reply":
      return `${by} replied`;
    case "boost":
      return `${by} boosted your post`;
    case "like":
      return `${by} liked your post`;
    case "follow":
      return `${by} followed you`;
    case "follow request":
      return `${by} asked to follow you`;
    case "quote":
      return `${by} quoted your post`;
    case "poll":
      return "A poll you voted in has ended";
    case "edit":
      return `${by} edited a post you boosted`;
    case "post":
      return `${by} posted`;
    case "starter pack":
      return `${by} joined through your starter pack`;
  }
  return `${by}: ${n.kind}`;
}

/** Merge newest first. */
export const byDate = <T extends { createdAt: number }>(a: T, b: T) => b.createdAt - a.createdAt;

/** "now", "5m", "3h", "2d", or a date. */
export function age(ts: number, now = Date.now()): string {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 7 * 1440) return `${Math.floor(m / 1440)}d`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** 1234 → "1.2K". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** The text of a reply, starting with the handles to answer (Mastodon needs them in the text). */
export function replyPrefix(post: Post, me = ""): string {
  if (post.network !== "mastodon") return "";
  const handle = post.author.handle;
  return handle.replace(/^@/, "") === me.replace(/^@/, "") ? "" : `${handle} `;
}

/** A Mastodon or atproto error as a sentence. */
export function apiError(
  network: Network,
  status: number,
  body: { error?: string; message?: string } | undefined,
): string {
  const name = NETWORK_NAMES[network];
  if (network === "mastodon") {
    if (status === 401) return "Mastodon refused the access token: check it in Settings";
    if (status === 403) return `Mastodon: the token lacks a scope${body?.error ? ` (${body.error})` : ""}`;
    if (status === 422) return `Mastodon refused the post: ${body?.error ?? "invalid"}`;
    if (status === 429) return "Mastodon is rate limiting: try again in a few minutes";
  } else {
    if (body?.error === "AuthFactorTokenRequired") return "Bluesky asks for an email code: use an app password instead";
    if (status === 401) return "Bluesky refused the handle or app password: check them in Settings";
    if (status === 429 || body?.error === "RateLimitExceeded") {
      return "Bluesky is rate limiting sign-ins: try again in a few minutes";
    }
    if (body?.error === "AccountTakedown") return "This Bluesky account is suspended";
  }
  return `${name} answered ${status}${body?.message ?? body?.error ? `: ${body?.message ?? body?.error}` : ""}`;
}

/** Values of promises in the order they settle (rejections are thrown when reached). */
export async function* asCompleted<T>(promises: Promise<T>[]): AsyncGenerator<T> {
  const pending = new Map(promises.map((p, i) => [i, p.then((v) => [i, v] as const)]));
  while (pending.size) {
    const [i, v] = await Promise.race(pending.values());
    pending.delete(i);
    yield v;
  }
}
