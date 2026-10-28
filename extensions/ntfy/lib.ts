// ntfy and Gotify messages: parsing, priorities, tag emojis and what to send. No I/O here.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Messages

export interface NtfyAction {
  action: "view" | "http" | "broadcast" | string;
  label: string;
  url?: string;
  method?: string;
}

/** One line of `/<topic>/json?poll=1`. */
export interface NtfyMessage {
  id: string;
  time: number;
  expires?: number;
  event: string;
  topic: string;
  message?: string;
  title?: string;
  tags?: string[];
  priority?: number;
  click?: string;
  icon?: string;
  actions?: NtfyAction[];
  attachment?: { name: string; url: string; type?: string; size?: number; expires?: number };
}

/** The NDJSON stream of a poll: only `message` events, newest first. */
export function parseNdjson(text: string): NtfyMessage[] {
  const out: NtfyMessage[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const m = JSON.parse(line) as NtfyMessage;
      if (m.event === "message" && m.id) out.push(m);
    } catch {
      // A truncated line; skip it.
    }
  }
  return out.sort((a, b) => b.time - a.time);
}

export interface GotifyMessage {
  id: number;
  appid: number;
  message: string;
  title?: string;
  priority?: number;
  date: string;
  extras?: Record<string, any>;
}

/** A message of either service, as the list shows it. */
export interface Notification {
  id: string;
  service: "ntfy" | "gotify";
  /** ntfy topic, or Gotify application name. */
  source: string;
  title?: string;
  message: string;
  time: number;
  /** 1 (min) to 5 (max), ntfy's scale. */
  priority: number;
  tags: string[];
  click?: string;
  actions: NtfyAction[];
  attachment?: NtfyMessage["attachment"];
  gotifyId?: number;
  markdown?: boolean;
}

export function fromNtfy(m: NtfyMessage): Notification {
  return {
    id: `ntfy:${m.id}`,
    service: "ntfy",
    source: m.topic,
    title: m.title || undefined,
    message: m.message ?? "",
    time: m.time * 1000,
    priority: m.priority ?? 3,
    tags: m.tags ?? [],
    click: m.click || undefined,
    actions: (m.actions ?? []).filter((a) => a.label),
    attachment: m.attachment,
  };
}

/** Gotify's 0–10 priority on ntfy's 1–5 scale (its Android app: 0 silent, 1–3 quiet, 4–7 sound, 8+ urgent). */
export function gotifyPriority(p = 0): number {
  if (p >= 8) return 5;
  if (p >= 4) return 4;
  if (p >= 1) return 3;
  return 2;
}

export function fromGotify(m: GotifyMessage, apps: Record<number, string>): Notification {
  const click = m.extras?.["client::notification"]?.click?.url;
  return {
    id: `gotify:${m.id}`,
    service: "gotify",
    source: apps[m.appid] ?? `App ${m.appid}`,
    title: m.title || undefined,
    message: m.message ?? "",
    time: Date.parse(m.date),
    priority: gotifyPriority(m.priority),
    tags: [],
    click: typeof click === "string" ? click : undefined,
    actions: [],
    gotifyId: m.id,
    markdown: m.extras?.["client::display"]?.contentType === "text/markdown",
  };
}

// ---------------------------------------------------------------------------
// Priorities and tags

export const PRIORITIES = [
  { value: "1", title: "Min", color: "gray" as Color, icon: "bs-priority-low" },
  { value: "2", title: "Low", color: "gray" as Color, icon: "bs-priority-low" },
  { value: "3", title: "Default", color: "blue" as Color, icon: "bs-priority-medium" },
  { value: "4", title: "High", color: "orange" as Color, icon: "bs-priority-high" },
  { value: "5", title: "Urgent", color: "red" as Color, icon: "bs-priority-urgent" },
];

export const priorityInfo = (p: number) => PRIORITIES[Math.min(5, Math.max(1, Math.round(p))) - 1];

/** `max`, `urgent`, `high`, `4`… as ntfy accepts them, to a number. */
export function parsePriority(text: string | undefined): number | undefined {
  const t = (text ?? "").trim().toLowerCase();
  if (!t) return undefined;
  const names: Record<string, number> = { min: 1, low: 2, default: 3, high: 4, max: 5, urgent: 5 };
  if (t in names) return names[t];
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= 5) return n;
  throw new Error(`Priority is 1 to 5, or min, low, default, high, urgent (got “${text}”)`);
}

/** The emoji shortcodes ntfy turns into emojis (the most used ones). Other tags stay words. */
export const TAG_EMOJIS: Record<string, string> = {
  "+1": "👍",
  "-1": "👎",
  thumbsup: "👍",
  thumbsdown: "👎",
  warning: "⚠️",
  rotating_light: "🚨",
  triangular_flag_on_post: "🚩",
  x: "❌",
  heavy_check_mark: "✔️",
  white_check_mark: "✅",
  heavy_multiplication_x: "✖️",
  no_entry: "⛔",
  no_entry_sign: "🚫",
  skull: "💀",
  fire: "🔥",
  boom: "💥",
  bug: "🐛",
  tada: "🎉",
  partying_face: "🥳",
  loudspeaker: "📢",
  mega: "📣",
  bell: "🔔",
  no_bell: "🔕",
  information_source: "ℹ️",
  question: "❓",
  exclamation: "❗",
  bangbang: "‼️",
  zap: "⚡",
  rocket: "🚀",
  computer: "💻",
  desktop_computer: "🖥️",
  floppy_disk: "💾",
  cd: "💿",
  package: "📦",
  lock: "🔒",
  unlock: "🔓",
  key: "🔑",
  shield: "🛡️",
  house: "🏠",
  door: "🚪",
  bulb: "💡",
  electric_plug: "🔌",
  battery: "🔋",
  thermometer: "🌡️",
  sunny: "☀️",
  cloud: "☁️",
  umbrella: "☔",
  snowflake: "❄️",
  droplet: "💧",
  calendar: "📅",
  clock: "🕐",
  alarm_clock: "⏰",
  hourglass: "⌛",
  hourglass_flowing_sand: "⏳",
  stopwatch: "⏱️",
  email: "📧",
  envelope: "✉️",
  inbox_tray: "📥",
  outbox_tray: "📤",
  bar_chart: "📊",
  chart_with_upwards_trend: "📈",
  chart_with_downwards_trend: "📉",
  moneybag: "💰",
  dollar: "💵",
  credit_card: "💳",
  shopping_cart: "🛒",
  truck: "🚚",
  car: "🚗",
  camera: "📷",
  movie_camera: "🎥",
  tv: "📺",
  musical_note: "🎵",
  headphones: "🎧",
  phone: "☎️",
  iphone: "📱",
  link: "🔗",
  paperclip: "📎",
  memo: "📝",
  pencil: "✏️",
  wrench: "🔧",
  hammer: "🔨",
  gear: "⚙️",
  robot: "🤖",
  ghost: "👻",
  eyes: "👀",
  heart: "❤️",
  star: "⭐",
  sparkles: "✨",
  smile: "😄",
  slightly_smiling_face: "🙂",
  cry: "😢",
  sob: "😭",
  rage: "😡",
  scream: "😱",
  sweat_smile: "😅",
  joy: "😂",
  dog: "🐶",
  cat: "🐱",
  pig: "🐷",
  cow: "🐮",
  green_circle: "🟢",
  yellow_circle: "🟡",
  red_circle: "🔴",
  large_blue_circle: "🔵",
  white_circle: "⚪",
  black_circle: "⚫",
  arrow_up: "⬆️",
  arrow_down: "⬇️",
  recycle: "♻️",
  hospital: "🏥",
  pill: "💊",
  coffee: "☕",
  beer: "🍺",
  pizza: "🍕",
  cake: "🍰",
  gift: "🎁",
  trophy: "🏆",
  medal_sports: "🏅",
  checkered_flag: "🏁",
  construction: "🚧",
};

/** Tags as ntfy shows them: emojis first (the shortcodes it knows), the other tags as words. */
export function splitTags(tags: string[]): { emojis: string[]; words: string[] } {
  const emojis: string[] = [], words: string[] = [];
  for (const t of tags) {
    const e = TAG_EMOJIS[t.toLowerCase()];
    if (e) emojis.push(e);
    else words.push(t);
  }
  return { emojis, words };
}

/** `warning, backup  ,cron` → `["warning", "backup", "cron"]`. */
export const parseTags = (text: string | undefined) =>
  (text ?? "").split(/[,\s]+/).map((t) => t.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Topics and servers

/** ntfy topic names: letters, digits, `_` and `-`, up to 64. */
export function validTopic(topic: string): string | undefined {
  if (!topic) return "Give a topic name";
  if (!/^[-_A-Za-z0-9]{1,64}$/.test(topic)) return "A topic is up to 64 letters, digits, - or _";
  return undefined;
}

/** `ntfy.sh/mytopic` or `https://ntfy.example.lan/alerts` → server and topic, when a topic is in it. */
export function splitTopicUrl(input: string): { server?: string; topic: string } {
  const t = input.trim().replace(/\/+$/, "");
  const m = /^(?:(https?:\/\/)?([^/\s]+))\/([-_A-Za-z0-9]{1,64})$/.exec(t);
  if (m && (m[1] || m[2].includes("."))) return { server: `${m[1] ?? "https://"}${m[2]}`, topic: m[3] };
  return { topic: t };
}

/** `ntfy.sh/` → `https://ntfy.sh`. */
export function normalizeServer(input: unknown, fallback = ""): string {
  let url = String(input ?? "").trim();
  if (!url) return fallback;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "");
}

/** `24h`, `30m`, `2d`, `all`, a Unix time or a message id, as ntfy's `since=` takes. */
export function sinceParam(input: unknown): string {
  const t = String(input ?? "").trim().toLowerCase();
  if (!t) return "24h";
  if (t === "all" || /^\d+[smhd]$/.test(t) || /^\d{9,}$/.test(t)) return t;
  return "24h";
}

/** An access token (`tk_…`) as a bearer, `user:password` as Basic auth. */
export function ntfyAuth(token: string): string | undefined {
  const t = token.trim();
  if (!t) return undefined;
  if (!t.startsWith("tk_") && t.includes(":")) return `Basic ${btoa(t)}`;
  return `Bearer ${t}`;
}

/** The JSON body ntfy's `POST /` takes. */
export function publishBody(o: {
  topic: string;
  message: string;
  title?: string;
  priority?: number;
  tags?: string[];
  click?: string;
  markdown?: boolean;
}): Record<string, unknown> {
  const body: Record<string, unknown> = { topic: o.topic, message: o.message };
  if (o.title) body.title = o.title;
  if (o.priority && o.priority !== 3) body.priority = o.priority;
  if (o.tags?.length) body.tags = o.tags;
  if (o.click) body.click = o.click;
  if (o.markdown) body.markdown = true;
  return body;
}

/** Gotify's `POST /message` body, priorities scaled from ntfy's 1–5. */
export function gotifyBody(o: { message: string; title?: string; priority?: number; click?: string }) {
  const scale: Record<number, number> = { 1: 0, 2: 2, 3: 5, 4: 7, 5: 10 };
  return {
    message: o.message,
    ...(o.title ? { title: o.title } : {}),
    priority: scale[o.priority ?? 3] ?? 5,
    ...(o.click ? { extras: { "client::notification": { click: { url: o.click } } } } : {}),
  };
}

/** A URL alone in the text, to make it the notification's click target. */
export function soleUrl(text: string): string | undefined {
  const t = text.trim();
  return /^https?:\/\/\S+$/i.test(t) ? t : undefined;
}

/** ntfy turns messages over 4 KB into attachments; keep clipboard pushes readable. */
export function clip(text: string, max = 4000): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return text;
  let out = text.slice(0, max);
  while (new TextEncoder().encode(out).length > max - 3) out = out.slice(0, -1);
  return `${out}…`;
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export function bytes(n: number): string {
  if (n >= 1 << 20) return `${(n / (1 << 20)).toFixed(1)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} kB`;
  return `${n} B`;
}

/** The detail panel's text: emojis, title, message, links. */
export function notificationMarkdown(n: Notification): string {
  const { emojis } = splitTags(n.tags);
  const head = [emojis.join(" "), n.title ? `**${n.title}**` : ""].filter(Boolean).join(" ");
  const body = n.markdown || n.service === "ntfy" ? n.message : n.message.replace(/[\\`*_[\]#>]/g, (c) => `\\${c}`);
  return [
    ...(head ? [head, ""] : []),
    body || "_No text._",
    ...(n.attachment
      ? [
        "",
        `📎 [${n.attachment.name}](${n.attachment.url})${n.attachment.size ? ` (${bytes(n.attachment.size)})` : ""}`,
      ]
      : []),
    ...(n.actions.length
      ? ["", ...n.actions.map((a) => `- ${a.label}${a.url ? `: ${a.url}` : ""} (${a.action})`)]
      : []),
  ].join("\n");
}
