// Channels and messages of Mattermost (API v4) and Zulip (API v1) in one shape: unread
// counts, names of direct messages, links, status presets. No I/O here.

export type BackendId = "mattermost" | "zulip";

export const BACKENDS: Record<BackendId, string> = { mattermost: "Mattermost", zulip: "Zulip" };

/** Raised when the extension isn't set up or the server refuses it: the list shows how to fix it. */
export class SetupError extends Error {}

export type Kind = "channel" | "private" | "direct" | "group" | "stream";

export type Channel = {
  id: string;
  name: string;
  kind: Kind;
  /** Mattermost team. */
  team?: { id: string; name: string; displayName: string };
  unread: number;
  mentions: number;
  /** Milliseconds; 0 when unknown. */
  lastAt: number;
  topic?: string;
  muted: boolean;
  url: string;
  /** Mattermost: when you last read it, in milliseconds. */
  lastViewed?: number;
  /** Zulip: the other people of a direct conversation. */
  userIds?: number[];
  /** Zulip: the topic of the last message, where a new message goes by default. */
  lastTopic?: string;
  /** Zulip: the unread messages, to mark them read. */
  unreadIds?: number[];
  last?: Message;
};

export type Message = {
  id: string;
  author: string;
  /** Markdown, as typed. */
  text: string;
  at: number;
  mine: boolean;
  unread: boolean;
  /** Mattermost: the thread it belongs to (its root post). */
  rootId?: string;
  /** Zulip: its topic. */
  topic?: string;
  url?: string;
  edited?: boolean;
  replies?: number;
};

export function chooseBackend(prefs: Record<string, unknown>): BackendId | undefined {
  const asked = String(prefs.backend ?? "").trim().toLowerCase();
  if (asked === "mattermost" || asked === "zulip") return asked;
  if (asked && asked !== "auto") return undefined;
  if (/zulip/i.test(String(prefs.url ?? "")) || String(prefs.email ?? "").trim()) return "zulip";
  if (String(prefs.url ?? "").trim()) return "mattermost";
  return undefined;
}

/** `chat.example.com/team/channels/town-square` or `…/api/v4` → `https://chat.example.com`. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    const host = url.split(/[/:]/)[0].toLowerCase();
    const local = !host.includes(".") || /^\d+\.\d+\.\d+\.\d+$/.test(host) || /\.(local|lan|home|internal)$/.test(host);
    url = `${local ? "http" : "https"}://${url}`;
  }
  try {
    const u = new URL(url);
    return u.origin;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/** "now", "5m", "3h", "2d", then "28 Oct". */
export function age(ts: number, now = Date.now()): string {
  if (!ts) return "";
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 7 * 1440) return `${Math.floor(m / 1440)}d`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** Mentions first, then unread, then the most recent; muted ones after the others. */
export function sortChannels(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) =>
    Number(b.mentions > 0) - Number(a.mentions > 0) ||
    Number(b.unread > 0 && !b.muted) - Number(a.unread > 0 && !a.muted) ||
    Number(a.muted) - Number(b.muted) ||
    b.lastAt - a.lastAt ||
    a.name.localeCompare(b.name)
  );
}

export function sectionOf(c: Channel): string {
  if (c.mentions > 0) return "Mentions";
  if (c.unread > 0 && !c.muted) return "Unread";
  if (c.kind === "direct" || c.kind === "group") return "Direct Messages";
  return c.kind === "stream" ? "Streams" : "Channels";
}

/** "12 unread in 3 channels · 2 mentions". */
export function unreadSummary(channels: Channel[]): string {
  const unread = channels.filter((c) => c.unread > 0 && !c.muted);
  const messages = unread.reduce((n, c) => n + c.unread, 0);
  const mentions = channels.reduce((n, c) => n + c.mentions, 0);
  if (!unread.length && !mentions) {
    return `${channels.length} conversation${channels.length === 1 ? "" : "s"} · all read`;
  }
  return [
    `${messages} unread in ${unread.length} conversation${unread.length === 1 ? "" : "s"}`,
    ...(mentions ? [`${mentions} mention${mentions === 1 ? "" : "s"}`] : []),
  ].join(" · ");
}

/** One line of a message for a row: markdown and line breaks flattened. */
export function oneLine(text: string, max = 120): string {
  const t = text.replace(/```[\s\S]*?```/g, "[code]").replace(/[*_~`>#]+/g, "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ---------------------------------------------------------------------------
// Mattermost

export type MmUser = { id: string; username: string; first_name?: string; last_name?: string; nickname?: string };
export type MmTeam = { id: string; name: string; display_name: string; delete_at?: number };
export type MmChannel = {
  id: string;
  team_id: string;
  type: "O" | "P" | "D" | "G";
  name: string;
  display_name: string;
  header?: string;
  purpose?: string;
  last_post_at: number;
  total_msg_count: number;
  delete_at?: number;
};
export type MmMember = {
  channel_id: string;
  msg_count: number;
  mention_count: number;
  last_viewed_at?: number;
  notify_props?: { mark_unread?: string };
};
export type MmPost = {
  id: string;
  user_id: string;
  channel_id: string;
  message: string;
  create_at: number;
  edit_at?: number;
  root_id?: string;
  type?: string;
  reply_count?: number;
  props?: { from_webhook?: string; override_username?: string };
};

export function userName(u: MmUser | undefined): string {
  if (!u) return "Someone";
  const full = [u.first_name, u.last_name].filter(Boolean).join(" ").trim();
  return u.nickname?.trim() || full || u.username;
}

/** The other person of a direct channel, named `me__them` or `them__me`. */
export function otherUserId(channelName: string, me: string): string | undefined {
  const ids = channelName.split("__");
  if (ids.length !== 2) return undefined;
  return ids[0] === me ? ids[1] : ids[0];
}

export function mmChannel(
  ch: MmChannel,
  member: MmMember | undefined,
  team: MmTeam,
  users: Map<string, MmUser>,
  me: string,
  base: string,
): Channel {
  const kind: Kind = ch.type === "O" ? "channel" : ch.type === "P" ? "private" : ch.type === "D" ? "direct" : "group";
  let name = ch.display_name || ch.name;
  let url = `${base}/${team.name}/channels/${ch.name}`;
  if (kind === "direct") {
    const other = users.get(otherUserId(ch.name, me) ?? "");
    name = otherUserId(ch.name, me) === me ? `${userName(other)} (you)` : userName(other);
    url = other ? `${base}/${team.name}/messages/@${other.username}` : url;
  } else if (kind === "group") {
    url = `${base}/${team.name}/messages/${ch.name}`;
  }
  return {
    id: ch.id,
    name,
    kind,
    team: kind === "direct" || kind === "group"
      ? undefined
      : { id: team.id, name: team.name, displayName: team.display_name },
    unread: Math.max(0, ch.total_msg_count - (member?.msg_count ?? ch.total_msg_count)),
    mentions: member?.mention_count ?? 0,
    lastAt: ch.last_post_at ?? 0,
    topic: (ch.purpose || ch.header)?.trim() || undefined,
    muted: member?.notify_props?.mark_unread === "mention",
    url,
    lastViewed: member?.last_viewed_at,
  };
}

/** The posts of `GET /channels/{id}/posts`, newest first, without system messages. */
export function mmMessages(
  r: { order: string[]; posts: Record<string, MmPost> },
  users: Map<string, MmUser>,
  me: string,
  lastViewed: number,
  permalink: (id: string) => string,
): Message[] {
  return r.order.map((id) => r.posts[id]).filter((p) => p && !p.type?.startsWith("system_")).map((p) => ({
    id: p.id,
    author: p.props?.override_username || (p.user_id === me ? "You" : userName(users.get(p.user_id))),
    text: p.message,
    at: p.create_at,
    mine: p.user_id === me,
    unread: p.user_id !== me && p.create_at > lastViewed,
    rootId: p.root_id || undefined,
    url: permalink(p.id),
    edited: (p.edit_at ?? 0) > 0,
    replies: p.reply_count,
  }));
}

/** Mattermost keeps the custom status as JSON in the user's props. */
export function mmCustomStatus(props: Record<string, unknown> | undefined): CurrentStatus["custom"] {
  try {
    const raw = props?.customStatus;
    const s = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!s || (!s.text && !s.emoji)) return undefined;
    const expires = s.expires_at && !String(s.expires_at).startsWith("0001") ? Date.parse(s.expires_at) : 0;
    if (expires && expires < Date.now()) return undefined;
    return { text: s.text ?? "", emoji: s.emoji ?? "", expires: expires || undefined };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Zulip

export type ZulipSubscription = {
  stream_id: number;
  name: string;
  description?: string;
  color?: string;
  is_muted?: boolean;
  in_home_view?: boolean;
};

export type ZulipMessage = {
  id: number;
  sender_id: number;
  sender_full_name: string;
  content: string;
  subject?: string;
  timestamp: number;
  flags?: string[];
  type: "stream" | "private";
  stream_id?: number;
  display_recipient: string | { id: number; full_name: string; email?: string }[];
  last_edit_timestamp?: number;
};

/** Zulip's URL fragments: encodeURIComponent with "." for "%". */
export function zulipHash(text: string): string {
  return encodeURIComponent(text).replace(/\./g, "%2E").replace(/%/g, ".");
}

export function zulipStreamUrl(base: string, id: number, name: string, topic?: string): string {
  return `${base}/#narrow/stream/${id}-${zulipHash(name)}${topic ? `/topic/${zulipHash(topic)}` : ""}`;
}

/** The key of a direct conversation: the other people's ids, sorted ("dm:4,9"); yourself alone when it's to you. */
export function dmKey(m: ZulipMessage, me: number): string | undefined {
  if (m.type !== "private" || !Array.isArray(m.display_recipient)) return undefined;
  const ids = m.display_recipient.map((r) => r.id).filter((id) => id !== me).sort((a, b) => a - b);
  return `dm:${(ids.length ? ids : [me]).join(",")}`;
}

export function zulipMessage(m: ZulipMessage, me: number, base: string): Message {
  const unread = !(m.flags ?? []).includes("read");
  return {
    id: String(m.id),
    author: m.sender_id === me ? "You" : m.sender_full_name,
    text: m.content,
    at: m.timestamp * 1000,
    mine: m.sender_id === me,
    unread,
    topic: m.type === "stream" ? m.subject : undefined,
    url: m.type === "stream" && typeof m.display_recipient === "string"
      ? `${zulipStreamUrl(base, m.stream_id ?? 0, m.display_recipient, m.subject)}/near/${m.id}`
      : `${base}/#narrow/near/${m.id}`,
    edited: !!m.last_edit_timestamp,
  };
}

const mentioned = (m: ZulipMessage) =>
  (m.flags ?? []).some((f) => f === "mentioned" || f === "wildcard_mentioned" || f === "stream_wildcard_mentioned");

/**
 * Streams you're subscribed to and your direct conversations, from the recent
 * messages and the unread ones: their counts, mentions and last message.
 */
export function zulipChannels(
  subs: ZulipSubscription[],
  recent: ZulipMessage[],
  unread: ZulipMessage[],
  me: number,
  base: string,
): Channel[] {
  const channels = new Map<string, Channel>();
  for (const s of subs) {
    channels.set(`stream:${s.stream_id}`, {
      id: `stream:${s.stream_id}`,
      name: s.name,
      kind: "stream",
      unread: 0,
      mentions: 0,
      lastAt: 0,
      topic: s.description?.trim() || undefined,
      muted: s.is_muted ?? s.in_home_view === false,
      url: zulipStreamUrl(base, s.stream_id, s.name),
      unreadIds: [],
    });
  }
  const channelOf = (m: ZulipMessage): Channel | undefined => {
    if (m.type === "stream") return channels.get(`stream:${m.stream_id}`);
    const key = dmKey(m, me);
    if (!key || !Array.isArray(m.display_recipient)) return undefined;
    if (!channels.has(key)) {
      const others = m.display_recipient.filter((r) => r.id !== me);
      const ids = (others.length ? others : m.display_recipient).map((r) => r.id).sort((a, b) => a - b);
      channels.set(key, {
        id: key,
        name: others.length ? others.map((r) => r.full_name).join(", ") : "You",
        kind: others.length > 1 ? "group" : "direct",
        unread: 0,
        mentions: 0,
        lastAt: 0,
        muted: false,
        url: `${base}/#narrow/pm-with/${ids.join(",")}-pm`,
        userIds: ids,
        unreadIds: [],
      });
    }
    return channels.get(key);
  };
  for (const m of [...recent, ...unread].sort((a, b) => a.id - b.id)) {
    const c = channelOf(m);
    if (!c) continue;
    if (m.timestamp * 1000 >= c.lastAt) {
      c.lastAt = m.timestamp * 1000;
      c.last = zulipMessage(m, me, base);
      if (m.type === "stream") c.lastTopic = m.subject;
    }
  }
  const seen = new Set<number>();
  for (const m of unread) {
    if (seen.has(m.id) || (m.flags ?? []).includes("read") || m.sender_id === me) continue;
    seen.add(m.id);
    const c = channelOf(m);
    if (!c) continue;
    c.unread++;
    c.unreadIds!.push(m.id);
    // Direct messages notify like mentions.
    if (mentioned(m) || m.type === "private") c.mentions++;
  }
  return [...channels.values()];
}

/** The `narrow` of a conversation, as JSON. */
export function zulipNarrow(c: Pick<Channel, "id" | "userIds" | "name">): string {
  if (c.id.startsWith("stream:")) return JSON.stringify([{ operator: "stream", operand: Number(c.id.slice(7)) }]);
  return JSON.stringify([{ operator: "pm-with", operand: c.userIds ?? [] }]);
}

// ---------------------------------------------------------------------------
// Status

export type CurrentStatus = {
  /** Mattermost: online, away, dnd, offline. */
  availability?: string;
  /** Seconds, Mattermost's Do Not Disturb end. */
  dndEnd?: number;
  custom?: { text: string; emoji: string; expires?: number };
};

export const AVAILABILITY = [
  { value: "online", title: "Online", color: "green" as const },
  { value: "away", title: "Away", color: "yellow" as const },
  { value: "dnd", title: "Do Not Disturb", color: "red" as const },
  { value: "offline", title: "Offline", color: "gray" as const },
];

export type MmDuration = "thirty_minutes" | "one_hour" | "four_hours" | "today" | "this_week" | "";

export const MM_DURATIONS: { value: MmDuration; title: string }[] = [
  { value: "thirty_minutes", title: "30 minutes" },
  { value: "one_hour", title: "1 hour" },
  { value: "four_hours", title: "4 hours" },
  { value: "today", title: "Today" },
  { value: "this_week", title: "This week" },
  { value: "", title: "Don't clear" },
];

export type Preset = { id: string; title: string; glyph: string; emoji: string; code?: string; duration?: MmDuration };

/** Mattermost's own suggestions, with their emoji names and how long they last. */
export const MM_PRESETS: Preset[] = [
  { id: "meeting", title: "In a meeting", glyph: "📅", emoji: "calendar", duration: "one_hour" },
  { id: "lunch", title: "Out for lunch", glyph: "🍔", emoji: "hamburger", duration: "thirty_minutes" },
  { id: "sick", title: "Out sick", glyph: "🤧", emoji: "sneezing_face", duration: "today" },
  { id: "home", title: "Working from home", glyph: "🏠", emoji: "house", duration: "today" },
  { id: "vacation", title: "On a vacation", glyph: "🌴", emoji: "palm_tree", duration: "this_week" },
];

/** Zulip's own suggestions: Zulip checks that the emoji name matches its code. */
export const ZULIP_PRESETS: Preset[] = [
  { id: "busy", title: "Busy", glyph: "🛠", emoji: "working_on_it", code: "1f6e0" },
  { id: "meeting", title: "In a meeting", glyph: "📅", emoji: "calendar", code: "1f4c5" },
  { id: "commuting", title: "Commuting", glyph: "🚌", emoji: "bus", code: "1f68c" },
  { id: "sick", title: "Out sick", glyph: "🤕", emoji: "hurt", code: "1f915" },
  { id: "vacation", title: "Vacationing", glyph: "🌴", emoji: "palm_tree", code: "1f334" },
  { id: "remote", title: "Working remotely", glyph: "🏠", emoji: "house", code: "1f3e0" },
  { id: "office", title: "At the office", glyph: "🏢", emoji: "office", code: "1f3e2" },
];

/** When a Mattermost custom status of `duration` ends: end of today, of Sunday, or so many minutes. */
export function mmExpiry(duration: MmDuration, now = new Date()): Date | undefined {
  switch (duration) {
    case "thirty_minutes":
      return new Date(now.getTime() + 30 * 60_000);
    case "one_hour":
      return new Date(now.getTime() + 60 * 60_000);
    case "four_hours":
      return new Date(now.getTime() + 4 * 60 * 60_000);
    case "today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    case "this_week":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((7 - now.getDay()) % 7), 23, 59, 59, 999);
    default:
      return undefined;
  }
}

export function mmCustomStatusBody(text: string, emoji: string, duration: MmDuration, now = new Date()) {
  const expires = mmExpiry(duration, now);
  return {
    text,
    emoji,
    ...(duration ? { duration } : {}),
    ...(expires ? { expires_at: expires.toISOString() } : {}),
  };
}

/** `:palm_tree:` or `palm_tree` → `palm_tree`. */
export function emojiName(input: string): string {
  return input.trim().replace(/^:|:$/g, "").trim().toLowerCase().replace(/\s+/g, "_");
}

/** Zulip's code of a Unicode emoji: its code points in hex, joined by "-" ("1f3e0"). */
export function emojiCode(glyph: string): string {
  return [...glyph].map((c) => c.codePointAt(0)!).filter((cp) => cp !== 0xfe0f).map((cp) => cp.toString(16))
    .join("-");
}

/** The end of Do Not Disturb for "30 minutes", "1 hour", "2 hours" or "until tomorrow" (9:00): unix seconds. */
export function dndEnd(choice: string, now = new Date()): number {
  const minutes: Record<string, number> = { "30 minutes": 30, "1 hour": 60, "2 hours": 120, "4 hours": 240 };
  if (minutes[choice]) return Math.floor(now.getTime() / 1000) + minutes[choice] * 60;
  if (choice === "until tomorrow") {
    return Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9).getTime() / 1000);
  }
  return 0;
}

export function untilText(ms: number | undefined, now = new Date()): string {
  if (!ms) return "";
  const d = new Date(ms);
  const sameDay = d.toDateString() === now.toDateString();
  const clock = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return sameDay
    ? `until ${clock}`
    : `until ${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} ${clock}`;
}

export function errorText(service: string, status: number, body: unknown): string {
  const b = body as { message?: string; msg?: string } | undefined;
  const message = b?.message ?? b?.msg ?? "";
  if (status === 404) return `${service} doesn't know it${message ? `: ${message}` : ""}`;
  if (status === 429) return `${service} is rate limiting: try again in a minute`;
  return `${service} answered ${status}${message ? `: ${message}` : ""}`;
}
