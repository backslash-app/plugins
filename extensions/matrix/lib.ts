// Matrix client-server API: the sync filter, rooms out of a /sync answer, links and text.

/** What /sync sends back: joined rooms with their name, the last message and the unread counts. */
export const SYNC_FILTER = {
  presence: { types: [] as string[] },
  account_data: { types: ["m.direct"] },
  room: {
    state: {
      types: ["m.room.name", "m.room.canonical_alias", "m.room.encryption", "m.room.member", "m.room.topic"],
      lazy_load_members: true,
    },
    timeline: { limit: 1, types: ["m.room.message", "m.room.encrypted", "m.sticker"] },
    ephemeral: { types: [] as string[] },
    account_data: { types: [] as string[] },
  },
};

export type MatrixEvent = {
  type: string;
  event_id?: string;
  sender?: string;
  state_key?: string;
  origin_server_ts?: number;
  content?: Record<string, any>;
  unsigned?: { redacted_because?: unknown };
};

export type JoinedRoom = {
  summary?: { "m.heroes"?: string[]; "m.joined_member_count"?: number; "m.invited_member_count"?: number };
  state?: { events?: MatrixEvent[] };
  timeline?: { events?: MatrixEvent[] };
  unread_notifications?: { notification_count?: number; highlight_count?: number };
};

export type InvitedRoom = { invite_state?: { events?: MatrixEvent[] } };

export type SyncResponse = {
  next_batch?: string;
  account_data?: { events?: MatrixEvent[] };
  rooms?: { join?: Record<string, JoinedRoom>; invite?: Record<string, InvitedRoom> };
};

export type LastMessage = {
  eventId: string;
  sender: string;
  senderName: string;
  text: string;
  ts: number;
  encrypted: boolean;
};

export type Room = {
  id: string;
  name: string;
  alias?: string;
  topic?: string;
  encrypted: boolean;
  direct: boolean;
  invite: boolean;
  /** Who invited us, for invites. */
  inviter?: string;
  members?: number;
  unread: number;
  highlights: number;
  last?: LastMessage;
};

/** `@ada:matrix.org` → `ada`. */
export function localpart(userId: string): string {
  return userId.replace(/^@/, "").split(":")[0];
}

/** The latest state event of a type (and key) among `events`. */
function stateOf(events: MatrixEvent[], type: string, key = ""): MatrixEvent | undefined {
  let found: MatrixEvent | undefined;
  for (const e of events) if (e.type === type && (e.state_key ?? "") === key) found = e;
  return found;
}

/** Display name of a member, from the member events at hand. */
export function memberName(events: MatrixEvent[], userId: string): string {
  const m = stateOf(events, "m.room.member", userId);
  const name = m?.content?.displayname;
  return typeof name === "string" && name.trim() ? name.trim() : localpart(userId);
}

/** Room name per the spec: name, canonical alias, then the heroes' names. */
export function roomName(events: MatrixEvent[], heroes: string[] = [], joined = 0, invited = 0): string {
  const name = stateOf(events, "m.room.name")?.content?.name;
  if (typeof name === "string" && name.trim()) return name.trim();
  const alias = stateOf(events, "m.room.canonical_alias")?.content?.alias;
  if (typeof alias === "string" && alias) return alias;
  if (heroes.length) {
    const names = heroes.slice(0, 5).map((h) => memberName(events, h));
    const others = joined + invited - 1 - names.length;
    if (others > 0) return `${names.join(", ")} and ${others} other${others === 1 ? "" : "s"}`;
    if (names.length === 1) return names[0];
    return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }
  return "Empty Room";
}

/** Removes the quoted reply fallback ("> <@bob:x> …") that replies start with. */
export function stripReplyFallback(body: string): string {
  const lines = body.split("\n");
  if (!lines[0]?.startsWith("> ")) return body;
  let i = 0;
  while (i < lines.length && lines[i].startsWith(">")) i++;
  if (lines[i] === "") i++;
  return lines.slice(i).join("\n") || body;
}

/** One line for a message: its text, or what was sent. */
export function messageText(e: MatrixEvent, senderName = "Someone"): string {
  if (e.type === "m.room.encrypted") return "Encrypted message";
  const c = e.content ?? {};
  if (!Object.keys(c).length || e.unsigned?.redacted_because) return "Message deleted";
  if (e.type === "m.sticker") return `sent a sticker${c.body ? `: ${c.body}` : ""}`;
  const body = typeof c.body === "string" ? stripReplyFallback(c.body).trim() : "";
  switch (c.msgtype) {
    case "m.image":
      return `sent an image${body && !/\.\w{3,4}$/.test(body) ? `: ${body}` : ""}`;
    case "m.video":
      return "sent a video";
    case "m.audio":
      return c["org.matrix.msc3245.voice"] !== undefined ? "sent a voice message" : "sent an audio file";
    case "m.file":
      return `sent a file${body ? `: ${body}` : ""}`;
    case "m.location":
      return "shared a location";
    case "m.emote":
      return `* ${senderName} ${body}`;
    default:
      return body.replace(/\s+/g, " ") || "(empty message)";
  }
}

/** Rooms that `m.direct` lists as direct chats. */
export function directRooms(sync: SyncResponse): Set<string> {
  const direct = sync.account_data?.events?.find((e) => e.type === "m.direct")?.content ?? {};
  return new Set(Object.values(direct).flatMap((ids) => Array.isArray(ids) ? ids.map(String) : []));
}

/** Joined rooms and invites of a /sync answer (made with {@link SYNC_FILTER}). */
export function roomsOf(sync: SyncResponse, me = ""): Room[] {
  const direct = directRooms(sync);
  const rooms: Room[] = [];
  for (const [id, r] of Object.entries(sync.rooms?.join ?? {})) {
    const state = r.state?.events ?? [];
    const timeline = r.timeline?.events ?? [];
    // Members of the timeline senders may come in the timeline too.
    const events = [...state, ...timeline.filter((e) => e.state_key !== undefined)];
    const s = r.summary ?? {};
    const lastEvent = [...timeline].reverse().find((e) =>
      ["m.room.message", "m.room.encrypted", "m.sticker"].includes(e.type)
    );
    const senderName = lastEvent?.sender ? memberName(events, lastEvent.sender) : "";
    const alias = stateOf(events, "m.room.canonical_alias")?.content?.alias;
    const topic = stateOf(events, "m.room.topic")?.content?.topic;
    rooms.push({
      id,
      name: roomName(
        events,
        (s["m.heroes"] ?? []).filter((h) => h !== me),
        s["m.joined_member_count"],
        s["m.invited_member_count"],
      ),
      alias: typeof alias === "string" ? alias : undefined,
      topic: typeof topic === "string" && topic.trim() ? topic.trim() : undefined,
      encrypted: !!stateOf(events, "m.room.encryption"),
      direct: direct.has(id),
      invite: false,
      members: s["m.joined_member_count"],
      unread: r.unread_notifications?.notification_count ?? 0,
      highlights: r.unread_notifications?.highlight_count ?? 0,
      last: lastEvent?.event_id
        ? {
          eventId: lastEvent.event_id,
          sender: lastEvent.sender ?? "",
          senderName: lastEvent.sender === me && me ? "You" : senderName,
          text: messageText(lastEvent, senderName),
          ts: lastEvent.origin_server_ts ?? 0,
          encrypted: lastEvent.type === "m.room.encrypted",
        }
        : undefined,
    });
  }
  for (const [id, r] of Object.entries(sync.rooms?.invite ?? {})) {
    const events = r.invite_state?.events ?? [];
    const mine = stateOf(events, "m.room.member", me);
    const inviter = mine?.sender;
    const name = stateOf(events, "m.room.name")?.content?.name ??
      stateOf(events, "m.room.canonical_alias")?.content?.alias ??
      (inviter ? memberName(events, inviter) : "Invitation");
    rooms.push({
      id,
      name: String(name),
      encrypted: !!stateOf(events, "m.room.encryption"),
      direct: !!mine?.content?.is_direct,
      invite: true,
      inviter: inviter ? memberName(events, inviter) : undefined,
      unread: 0,
      highlights: 0,
    });
  }
  return rooms;
}

/** Invites, then mentions, then unread, then the most recent. */
export function sortRooms(rooms: Room[]): Room[] {
  const rank = (r: Room) => r.invite ? 0 : r.highlights > 0 ? 1 : r.unread > 0 ? 2 : 3;
  return [...rooms].sort((a, b) => rank(a) - rank(b) || (b.last?.ts ?? 0) - (a.last?.ts ?? 0));
}

// ---------------------------------------------------------------------------

/** `matrix.org` → `https://matrix.org`; keeps a scheme and port. */
export function normalizeHomeserver(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "").replace(/\/_matrix.*$/, "");
}

/** The base URL of `/.well-known/matrix/client`, if it names one. */
export function wellKnownBase(json: unknown): string | undefined {
  const base = (json as { "m.homeserver"?: { base_url?: unknown } })?.["m.homeserver"]?.base_url;
  return typeof base === "string" && /^https?:\/\//.test(base) ? base.replace(/\/+$/, "") : undefined;
}

export function matrixToUrl(room: Room): string {
  return `https://matrix.to/#/${encodeURIComponent(room.alias ?? room.id)}`;
}

export function webClientUrl(room: Room, client = "https://app.element.io"): string {
  return `${client.replace(/\/+$/, "")}/#/room/${encodeURIComponent(room.alias ?? room.id)}`;
}

/** "now", "5m", "3h", "2d", or a date. */
export function age(ts: number, now = Date.now()): string {
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 7 * 1440) return `${Math.floor(m / 1440)}d`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

/** A transaction id, unique per message sent. */
export function txnId(now = Date.now()): string {
  return `bs${now.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** The body of a text message, with a reply relation when answering an event. */
export function textMessage(body: string, replyTo?: string): Record<string, unknown> {
  return {
    msgtype: "m.text",
    body,
    ...(replyTo ? { "m.relates_to": { "m.in_reply_to": { event_id: replyTo } } } : {}),
  };
}

/** An error of the Matrix API as a sentence. */
export function errorText(status: number, json: { errcode?: string; error?: string } | undefined): string {
  switch (json?.errcode) {
    case "M_UNKNOWN_TOKEN":
    case "M_MISSING_TOKEN":
      return "The homeserver refused the access token: copy a new one from Element → Settings → Help & About";
    case "M_LIMIT_EXCEEDED":
      return "The homeserver is rate limiting: try again in a moment";
    case "M_FORBIDDEN":
      return `Not allowed${json.error ? `: ${json.error}` : ""}`;
  }
  return `The homeserver answered ${status}${json?.error ? `: ${json.error}` : ""}`;
}
