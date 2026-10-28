// Slack: pure logic (status presets and expiry, mrkdwn cleanup, response mapping).

import { type Color, Icons, type Item, open } from "@backslash/api";

export const APPS_URL = "https://api.slack.com/apps";

export const SCOPES = [
  "users.profile:read",
  "users.profile:write",
  "dnd:read",
  "dnd:write",
  "channels:read",
  "groups:read",
  "im:read",
  "mpim:read",
  "users:read",
  "search:read",
];

/** The token is missing or Slack refused it: the list shows how to connect. */
export class AuthError extends Error {}

export function userToken(prefs: Record<string, unknown>): string {
  const token = String(prefs.token ?? "").trim();
  if (!token) throw new AuthError("Connect your Slack account");
  if (/^xox[baer]-/.test(token)) {
    throw new AuthError("This is not a user token: paste the “User OAuth Token” (xoxp-…)");
  }
  if (!token.startsWith("xoxp-")) throw new AuthError("A Slack user token starts with xoxp-");
  return token;
}

/** The message of a `{ ok: false }` answer. */
export function slackError(body: { error?: string; needed?: string }): Error {
  const code = body.error ?? "unknown_error";
  switch (code) {
    case "not_authed":
    case "invalid_auth":
    case "token_revoked":
    case "token_expired":
    case "account_inactive":
      return new AuthError("Slack rejected the token");
    case "missing_scope":
      return new Error(
        `The token lacks the ${
          body.needed ?? "needed"
        } scope: add it to your Slack app's User Token Scopes and reinstall it`,
      );
    case "ratelimited":
      return new Error("Slack is rate limiting: try again in a minute");
    case "profile_status_set_failed_not_valid_emoji":
      return new Error("Slack doesn't know this emoji: use a code like :palm_tree:");
    case "too_long":
      return new Error("The status is too long (100 characters at most)");
    default:
      return new Error(`Slack: ${code.replaceAll("_", " ")}`);
  }
}

/** Form-encoded parameters; objects (a profile) go as JSON, as Slack expects. */
export function encodeParams(params: Record<string, unknown>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    body.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
  }
  return body;
}

// ---------------------------------------------------------------------------
// Emoji

/** Common shortcodes; anything else (custom emoji) stays as :code:. */
const EMOJI: Record<string, string> = {
  spiral_calendar_pad: "🗓️",
  calendar: "📆",
  date: "📅",
  bus: "🚌",
  train: "🚆",
  train2: "🚆",
  car: "🚗",
  red_car: "🚗",
  bike: "🚲",
  airplane: "✈️",
  knife_fork_plate: "🍽️",
  fork_and_knife: "🍴",
  sandwich: "🥪",
  hamburger: "🍔",
  pizza: "🍕",
  coffee: "☕",
  headphones: "🎧",
  dart: "🎯",
  brain: "🧠",
  palm_tree: "🌴",
  face_with_thermometer: "🤒",
  house: "🏠",
  house_with_garden: "🏡",
  computer: "💻",
  speech_balloon: "💬",
  no_bell: "🔕",
  zzz: "💤",
  red_circle: "🔴",
  large_green_circle: "🟢",
  white_check_mark: "✅",
  eyes: "👀",
  wave: "👋",
  rocket: "🚀",
  books: "📚",
  phone: "☎️",
  telephone_receiver: "📞",
  movie_camera: "🎥",
  video_camera: "📹",
  hospital: "🏥",
  baby: "👶",
  sunny: "☀️",
  christmas_tree: "🎄",
  tada: "🎉",
  thinking_face: "🤔",
  writing_hand: "✍️",
  hammer_and_wrench: "🛠️",
};

/** `:palm_tree:` → 🌴 (unknown codes are returned as typed). */
export function emojiOf(code: string | undefined): string {
  const name = (code ?? "").trim().replace(/^:|:$/g, "");
  if (!name) return "";
  return EMOJI[name] ?? `:${name}:`;
}

/** `palm_tree`, `:palm_tree:` or `🌴` → `:palm_tree:` (or the emoji itself when unknown). */
export function emojiCode(input: string): string {
  const text = input.trim();
  if (!text) return "";
  const known = Object.entries(EMOJI).find(([, glyph]) => glyph === text || glyph.replace("️", "") === text);
  if (known) return `:${known[0]}:`;
  if (/^:?[a-z0-9_+'-]+:?$/i.test(text)) return `:${text.replace(/^:|:$/g, "").toLowerCase()}:`;
  return text;
}

// ---------------------------------------------------------------------------
// Status

export interface Status {
  text: string;
  emoji: string;
  /** Unix seconds; 0 = doesn't clear. */
  expiration: number;
}

export interface Preset {
  id: string;
  title: string;
  text: string;
  emoji: string;
  duration: Duration;
  icon: { source: string; tint: Color };
  /** Also pause notifications for the same time. */
  dnd?: boolean;
}

export type Duration = "30m" | "1h" | "2h" | "4h" | "today" | "week" | "never";

export const DURATIONS: { value: Duration; title: string }[] = [
  { value: "30m", title: "30 minutes" },
  { value: "1h", title: "1 hour" },
  { value: "2h", title: "2 hours" },
  { value: "4h", title: "4 hours" },
  { value: "today", title: "Today" },
  { value: "week", title: "This week" },
  { value: "never", title: "Don't clear" },
];

export const PRESETS: Preset[] = [
  {
    id: "meeting",
    title: "In a meeting",
    text: "In a meeting",
    emoji: ":spiral_calendar_pad:",
    duration: "1h",
    icon: { source: Icons.calendar, tint: "red" },
  },
  {
    id: "commuting",
    title: "Commuting",
    text: "Commuting",
    emoji: ":bus:",
    duration: "30m",
    icon: { source: Icons.arrowRight, tint: "blue" },
  },
  {
    id: "lunch",
    title: "Lunch",
    text: "Out for lunch",
    emoji: ":knife_fork_plate:",
    duration: "1h",
    icon: { source: Icons.coffee, tint: "orange" },
  },
  {
    id: "focus",
    title: "Focus",
    text: "Focusing",
    emoji: ":headphones:",
    duration: "2h",
    dnd: true,
    icon: { source: Icons.headphones, tint: "purple" },
  },
  {
    id: "remote",
    title: "Working remotely",
    text: "Working remotely",
    emoji: ":house_with_garden:",
    duration: "today",
    icon: { source: Icons.home, tint: "green" },
  },
  {
    id: "sick",
    title: "Out sick",
    text: "Out sick",
    emoji: ":face_with_thermometer:",
    duration: "today",
    icon: { source: Icons.thermometer, tint: "pink" },
  },
  {
    id: "vacation",
    title: "Vacationing",
    text: "Vacationing",
    emoji: ":palm_tree:",
    duration: "never",
    icon: { source: Icons.sun, tint: "yellow" },
  },
];

/** Unix seconds when a status of this duration clears (0: never). */
export function expiryFor(duration: Duration, now = new Date()): number {
  const minutes: Record<string, number> = { "30m": 30, "1h": 60, "2h": 120, "4h": 240 };
  if (duration in minutes) return Math.floor(now.getTime() / 1000) + minutes[duration] * 60;
  if (duration === "never") return 0;
  const end = new Date(now);
  end.setHours(23, 59, 59, 0);
  if (duration === "week") {
    // Until Sunday night (today when it's Sunday).
    end.setDate(end.getDate() + ((7 - end.getDay()) % 7));
  }
  return Math.floor(end.getTime() / 1000);
}

export function durationTitle(duration: Duration): string {
  return DURATIONS.find((d) => d.value === duration)?.title ?? duration;
}

/** Minutes of Do Not Disturb for a choice; "until tomorrow" ends at 9:00 tomorrow. */
export function snoozeMinutes(choice: string, now = new Date()): number {
  const c = choice.trim().toLowerCase();
  if (/^30/.test(c)) return 30;
  if (/^1\s*h|^1 hour|^60/.test(c)) return 60;
  if (/^2\s*h|^2 hours|^120/.test(c)) return 120;
  if (/tomorrow/.test(c)) {
    const morning = new Date(now);
    morning.setDate(morning.getDate() + 1);
    morning.setHours(9, 0, 0, 0);
    return Math.max(1, Math.round((morning.getTime() - now.getTime()) / 60_000));
  }
  const n = Number(c.replace(/\s*(min|minutes?)$/, ""));
  if (Number.isFinite(n) && n > 0) return Math.round(n);
  throw new Error(`Unknown duration “${choice}”: 30 minutes, 1 hour, 2 hours or until tomorrow`);
}

/** "15:30", "tomorrow 09:00" or "Mon 18:00". */
export function clock(unix: number, now = new Date()): string {
  const d = new Date(unix * 1000);
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = (x: Date) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  if (day(d) === day(now)) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (day(d) === day(tomorrow)) return `tomorrow ${time}`;
  const days = (d.getTime() - now.getTime()) / 86_400_000;
  if (days > 0 && days < 7) return `${d.toLocaleDateString("en", { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString("en", { day: "numeric", month: "short" })} ${time}`;
}

/** "until 15:30", "doesn't clear". */
export function untilText(expiration: number, now = new Date()): string {
  return expiration > 0 ? `until ${clock(expiration, now)}` : "doesn't clear";
}

/** The root search subtitle: "🗓️ In a meeting · until 15:30". */
export function statusSubtitle(status: Status | undefined, now = new Date()): string | null {
  if (!status || (!status.text && !status.emoji)) return null;
  const head = [emojiOf(status.emoji), status.text].filter(Boolean).join(" ");
  return status.expiration > 0 ? `${head} · ${untilText(status.expiration, now)}` : head;
}

// ---------------------------------------------------------------------------
// Messages

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/**
 * Slack's mrkdwn to readable text: `<@U1|ada>` → @ada, `<#C1|general>` →
 * #general, `<https://x|label>` → label (a markdown link with `links`).
 */
export function cleanText(text: string, options: { links?: boolean; users?: Map<string, string> } = {}): string {
  return text
    .replace(/<([^>]+)>/g, (_, inner: string) => {
      const [target, label] = inner.split("|", 2);
      if (target.startsWith("@")) {
        const id = target.slice(1);
        return `@${label ?? options.users?.get(id) ?? id}`;
      }
      if (target.startsWith("#")) return `#${label ?? target.slice(1)}`;
      if (target.startsWith("!subteam^")) return `@${label?.replace(/^@/, "") ?? "group"}`;
      if (target.startsWith("!")) return `@${(label ?? target.slice(1)).replace(/^@/, "").split("^")[0]}`;
      if (target.startsWith("mailto:")) return label ?? target.slice(7);
      if (options.links) return `[${label ?? target}](${target})`;
      return label ?? target;
    })
    .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m);
}

/** The first non-empty line, shortened. */
export function firstLine(text: string, max = 110): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max).trimEnd()}…` : line;
}

/** Slack timestamps ("1730123456.000200") as dates. */
export const tsDate = (ts: string) => new Date(Number(ts.split(".")[0]) * 1000);

/** "14:05", "yesterday", "3d", "Oct 25", "Oct 2024". */
export function shortDate(date: Date, now = new Date()): string {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days <= 0) return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString("en", { day: "numeric", month: "short" });
  }
  return date.toLocaleDateString("en", { month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Conversations

export interface Conversation {
  id: string;
  name?: string;
  is_channel?: boolean;
  is_group?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
  is_archived?: boolean;
  is_general?: boolean;
  is_ext_shared?: boolean;
  is_shared?: boolean;
  user?: string;
  created?: number;
  num_members?: number;
  topic?: { value: string };
  purpose?: { value: string };
  unread_count?: number;
  unread_count_display?: number;
}

export interface User {
  id: string;
  name: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { display_name?: string; real_name?: string; image_48?: string; image_72?: string; title?: string };
}

export type Kind = "channel" | "private" | "dm" | "group";

export function kindOf(c: Conversation): Kind {
  if (c.is_im) return "dm";
  if (c.is_mpim) return "group";
  if (c.is_private || c.is_group) return "private";
  return "channel";
}

/** Who a person is to show: the display name, else the full name. */
export function personName(user: User | undefined, fallback = "Someone"): string {
  if (!user) return fallback;
  return user.profile?.display_name || user.profile?.real_name || user.real_name || user.name || fallback;
}

/** `mpdm-ada--grace--linus-1` → `ada, grace, linus` (without `me`). */
export function groupName(name: string | undefined, me?: string): string {
  const m = /^mpdm-(.+)-\d+$/.exec(name ?? "");
  if (!m) return name ?? "Group";
  const people = m[1].split("--");
  const others = people.filter((p) => p !== me);
  return (others.length ? others : people).join(", ");
}

export function conversationTitle(c: Conversation, users: Map<string, User>, me?: string): string {
  switch (kindOf(c)) {
    case "dm":
      return personName(users.get(c.user ?? ""), c.user ?? "Direct message");
    case "group":
      return groupName(c.name, me);
    default:
      return `#${c.name ?? c.id}`;
  }
}

/** Pictures only from the hosts in `net`. */
export function avatarOf(user: User | undefined): string | undefined {
  const url = user?.profile?.image_72 ?? user?.profile?.image_48;
  if (!url) return undefined;
  try {
    const host = new URL(url).host;
    return ["avatars.slack-edge.com", "secure.gravatar.com", "a.slack-edge.com"].includes(host) ? url : undefined;
  } catch {
    return undefined;
  }
}

export const appUrl = (team: string, channel: string) =>
  `slack://channel?team=${encodeURIComponent(team)}&id=${encodeURIComponent(channel)}`;

/** `https://acme.slack.com/` + `C1` → `https://acme.slack.com/archives/C1`. */
export function webUrl(teamUrl: string, channel: string): string {
  const base = teamUrl.endsWith("/") ? teamUrl : `${teamUrl}/`;
  return `${base}archives/${channel}`;
}

const KIND_ORDER: Kind[] = ["channel", "private", "group", "dm"];

/** Channels first, by name; then group and direct messages. */
export function sortConversations(list: Conversation[], users: Map<string, User>): Conversation[] {
  return [...list].sort((a, b) =>
    KIND_ORDER.indexOf(kindOf(a)) - KIND_ORDER.indexOf(kindOf(b)) ||
    conversationTitle(a, users).localeCompare(conversationTitle(b, users))
  );
}

/** Direct messages with deactivated people or bots are noise in a launcher. */
export function isUseful(c: Conversation, users: Map<string, User>): boolean {
  if (c.is_archived) return false;
  if (kindOf(c) !== "dm") return true;
  const u = users.get(c.user ?? "");
  return !u?.deleted && (c.user !== "USLACKBOT");
}

export function unreadOf(c: Conversation): number | undefined {
  const n = c.unread_count_display ?? c.unread_count;
  return typeof n === "number" ? n : undefined;
}

export const kindColor: Record<Kind, Color> = { channel: "gray", private: "orange", group: "purple", dm: "blue" };

export function setupItem(error: AuthError): Item {
  return {
    id: "setup",
    title: error.message,
    subtitle: "A user token of your own Slack app",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Slack",
        "",
        "Backslash talks to Slack with a **user token** of an app you create in your workspace:",
        "",
        "1. Open **api.slack.com/apps** (Enter) → **Create New App** → **From scratch**, and pick your workspace.",
        "2. In **OAuth & Permissions → User Token Scopes**, add:",
        ...SCOPES.map((s) => `   - \`${s}\``),
        "3. **Install to Workspace** (some workspaces need an admin's approval), then copy the",
        "   **User OAuth Token**: it starts with `xoxp-`.",
        "4. Paste it in **Settings → Extensions → Slack → Configure → User token**.",
        "",
        "The token stays in your system keyring.",
      ].join("\n"),
    },
    actions: [open(APPS_URL, "Create a Slack App", { icon: Icons.key })],
  };
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return [setupItem(e)];
    throw e;
  }
}
