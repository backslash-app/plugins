// Reddit listings and comments → posts, and their formatting. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Shapes

interface Image {
  url: string;
  width: number;
  height: number;
}

/** A `t3` (link) of a listing, with `raw_json=1` (no HTML escaping). */
export interface RedditPost {
  id: string;
  name?: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  num_comments: number;
  created_utc: number;
  permalink: string;
  url?: string;
  url_overridden_by_dest?: string;
  domain?: string;
  is_self?: boolean;
  is_video?: boolean;
  is_gallery?: boolean;
  selftext?: string;
  link_flair_text?: string | null;
  link_flair_background_color?: string | null;
  over_18?: boolean;
  spoiler?: boolean;
  stickied?: boolean;
  locked?: boolean;
  post_hint?: string;
  upvote_ratio?: number;
  thumbnail?: string;
  preview?: { images?: { source: Image; resolutions?: Image[] }[] };
}

export interface RedditComment {
  id: string;
  author: string;
  body?: string;
  score: number;
  created_utc: number;
  stickied?: boolean;
  distinguished?: string | null;
  is_submitter?: boolean;
}

export interface Listing<T> {
  kind: "Listing";
  data: { after?: string | null; children: { kind: string; data: T }[] };
}

export interface Post {
  id: string;
  title: string;
  subreddit: string;
  author: string;
  score: number;
  comments: number;
  created: number;
  permalink: string;
  /** The link, for link posts. */
  link?: string;
  domain?: string;
  self: boolean;
  text?: string;
  flair?: string;
  flairColor?: string;
  nsfw: boolean;
  spoiler: boolean;
  pinned: boolean;
  locked: boolean;
  kind: "text" | "image" | "video" | "gallery" | "link";
  image?: string;
  ratio?: number;
}

export interface Comment {
  author: string;
  body: string;
  score: number;
  created: number;
  op: boolean;
  mod: boolean;
}

// ---------------------------------------------------------------------------
// Subreddits

/** `"r/Linux, programming /r/rust"` → `["Linux", "programming", "rust"]`, deduplicated without case. */
export function parseSubreddits(text: unknown): string[] {
  const seen = new Set<string>();
  return String(text ?? "").split(/[\s,;+]+/).map((s) => s.replace(/^\/?r\//i, "").replace(/\/+$/, "").trim())
    .filter((s) => {
      if (!/^[A-Za-z0-9][A-Za-z0-9_]{1,20}$/.test(s) || seen.has(s.toLowerCase())) return false;
      seen.add(s.toLowerCase());
      return true;
    });
}

/** A subreddit typed by the user, or undefined when it can't be one. */
export const subredditName = (text: string) => parseSubreddits(text)[0];

export type Sort = "hot" | "new" | "top";

export function listingPath(subs: string[], sort: Sort, limit = 50): string {
  const q = new URLSearchParams({ limit: String(limit), raw_json: "1" });
  if (sort === "top") q.set("t", "day");
  return `/r/${subs.map(encodeURIComponent).join("+")}/${sort}.json?${q}`;
}

// ---------------------------------------------------------------------------
// Posts

const IMAGE_HOSTS = ["i.redd.it", "preview.redd.it", "external-preview.redd.it"];

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
};

/** A picture the launcher may show: on Reddit's image hosts, not too big. */
export function pictureOf(p: RedditPost): string | undefined {
  const img = p.preview?.images?.[0];
  if (img) {
    const fit = [...(img.resolutions ?? [])].filter((r) => r.width <= 960).sort((a, b) => b.width - a.width)[0];
    const url = (fit ?? img.source).url;
    if (IMAGE_HOSTS.includes(hostOf(url))) return url;
  }
  const direct = p.url_overridden_by_dest ?? p.url;
  if (direct && hostOf(direct) === "i.redd.it" && /\.(jpe?g|png|gif)$/i.test(direct)) return direct;
  return undefined;
}

export function fromReddit(p: RedditPost): Post {
  const self = !!p.is_self;
  const link = self ? undefined : p.url_overridden_by_dest ?? p.url;
  const kind: Post["kind"] = self
    ? "text"
    : p.is_gallery
    ? "gallery"
    : p.is_video || p.post_hint === "hosted:video" || p.post_hint === "rich:video"
    ? "video"
    : p.post_hint === "image" || (link && hostOf(link) === "i.redd.it")
    ? "image"
    : "link";
  return {
    id: p.id,
    title: p.title.trim(),
    subreddit: p.subreddit,
    author: p.author,
    score: p.score,
    comments: p.num_comments,
    created: p.created_utc * 1000,
    permalink: `https://www.reddit.com${p.permalink}`,
    link,
    domain: self ? undefined : p.domain,
    self,
    text: p.selftext?.trim() || undefined,
    flair: p.link_flair_text?.trim() || undefined,
    flairColor: p.link_flair_background_color || undefined,
    nsfw: !!p.over_18,
    spoiler: !!p.spoiler,
    pinned: !!p.stickied,
    locked: !!p.locked,
    kind,
    image: p.over_18 || p.spoiler ? undefined : pictureOf(p),
    ratio: p.upvote_ratio,
  };
}

export function postsOf(listing: Listing<RedditPost> | undefined, nsfw = false): Post[] {
  return (listing?.data?.children ?? []).filter((c) => c.kind === "t3").map((c) => fromReddit(c.data))
    .filter((p) => nsfw || !p.nsfw);
}

/** `/comments/<id>.json` → the top-level comments, best first, without removed ones and bots' pins. */
export function commentsOf(answer: [unknown, Listing<RedditComment>] | undefined, limit = 8): Comment[] {
  const children = answer?.[1]?.data?.children ?? [];
  return children.filter((c) => c.kind === "t1").map((c) => c.data)
    .filter((c) => c.body && c.body !== "[removed]" && c.body !== "[deleted]" && !(c.stickied && c.distinguished))
    .slice(0, limit)
    .map((c) => ({
      author: c.author,
      body: c.body!.trim(),
      score: c.score,
      created: c.created_utc * 1000,
      op: !!c.is_submitter,
      mod: c.distinguished === "moderator",
    }));
}

// ---------------------------------------------------------------------------
// Formatting

export const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** "5 min", "3 h", "2 d", then a date. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "Wed 28 Oct, 05:37". */
export const fullDate = (ms: number) =>
  new Date(ms).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

/** A flair's background color → the nearest launcher color. */
export function flairColor(hex: string | undefined): Color {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "gray";
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min < 30) return "gray";
  const d = max - min;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return "red";
  if (h < 40) return "orange";
  if (h < 65) return "yellow";
  if (h < 160) return "green";
  if (h < 195) return "teal";
  if (h < 255) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

/** Reddit markdown → the launcher's subset: spoilers hidden, superscripts and tables flattened. */
export function cleanMarkdown(text: string, max = 1500): string {
  let out = text
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/>!(.+?)!</g, "[spoiler]")
    .replace(/\^\(([^)]*)\)/g, "$1")
    .replace(/(^|\s)\^(\S+)/g, "$1$2")
    .replace(/^\|?\s*:?-{3,}.*$/gm, "")
    .replace(/&#x200B;/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (out.length > max) out = out.slice(0, max).replace(/\s+\S*$/, "") + "…";
  return out;
}

export function commentsMarkdown(p: Post, comments: Comment[]): string {
  const head = [`# ${p.title}`, "", `r/${p.subreddit} · u/${p.author} · ${ago(p.created)}`];
  if (p.text) head.push("", cleanMarkdown(p.text, 1200));
  if (!comments.length) return [...head, "", "---", "", "No comments yet."].join("\n");
  const body = comments.map((c) =>
    [
      `**u/${c.author}**${c.op ? " (OP)" : ""}${c.mod ? " (mod)" : ""} · ${compact(c.score)} points · ${
        ago(c.created)
      }`,
      "",
      cleanMarkdown(c.body, 700),
    ].join("\n")
  );
  return [...head, "", "---", "", body.join("\n\n---\n\n")].join("\n");
}

/** Why Reddit refused, from the status and its JSON body. */
export function refusal(
  status: number,
  body: unknown,
  retryAfter?: string | null,
): { message: string; blocked: boolean } {
  const reason = (body as { reason?: string } | undefined)?.reason;
  if (status === 404 || reason === "banned") {
    return { message: "This subreddit doesn't exist or was banned", blocked: false };
  }
  if (reason === "private") return { message: "This subreddit is private", blocked: false };
  if (reason === "quarantined") {
    return { message: "This subreddit is quarantined (only viewable signed in)", blocked: false };
  }
  if (status === 429) {
    const wait = Number(retryAfter);
    return {
      message: `Reddit is rate limiting${wait ? `: try again in ${Math.ceil(wait)} s` : ", try again in a minute"}`,
      blocked: true,
    };
  }
  if (status === 403) return { message: "Reddit blocked this request from your network", blocked: true };
  return { message: `Reddit answered ${status}`, blocked: status >= 500 };
}
