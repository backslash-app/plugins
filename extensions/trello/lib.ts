// Trello: account, response types and pure mapping (colors, due dates, metadata).

import { type Color, Icons, type Item, meta, type Metadata, open } from "@backslash/api";

export const API = "https://api.trello.com/1";
export const KEY_URL = "https://trello.com/power-ups/admin";

/** The key or token is missing or refused: the list shows how to connect. */
export class AuthError extends Error {}

export interface Account {
  key: string;
  token: string;
}

export function account(prefs: Record<string, unknown>): Account {
  const key = String(prefs.apiKey ?? "").trim();
  const token = String(prefs.token ?? "").trim();
  if (!key) throw new AuthError("Connect your Trello account");
  if (!/^[0-9a-f]{32}$/i.test(key)) {
    throw new AuthError("This doesn't look like a Trello API key (32 hexadecimal characters)");
  }
  if (!token) throw new AuthError("Generate a token for your API key");
  return { key, token };
}

/** The page where Trello issues a token for the user's own key. */
export function authorizeUrl(key: string): string {
  const params = new URLSearchParams({
    expiration: "never",
    scope: "read,write",
    response_type: "token",
    name: "Backslash",
    key,
  });
  return `https://trello.com/1/authorize?${params}`;
}

/** Trello answers errors in plain text ("invalid token", "unauthorized card permission requested"). */
export function trelloError(status: number, text: string): Error {
  const message = text.trim().slice(0, 200);
  if (status === 401 && /invalid (key|token)|expired token|unauthorized permission/i.test(message)) {
    return new AuthError("Trello rejected the API key or token");
  }
  if (status === 401) return new Error(`Trello refused it: ${message || "unauthorized"}`);
  if (status === 404) return new Error("Not found on Trello: it may have been deleted or moved");
  if (status === 429) return new Error("Trello is rate limiting: try again in a few seconds");
  return new Error(`Trello answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Types (only the fields used)

export interface Label {
  id: string;
  name: string;
  color: string | null;
}

export interface Member {
  id: string;
  fullName: string;
  username: string;
  avatarUrl?: string | null;
  initials?: string;
}

export interface Card {
  id: string;
  name: string;
  desc: string;
  due: string | null;
  dueComplete: boolean;
  start?: string | null;
  idList: string;
  idBoard: string;
  idMembers: string[];
  labels: Label[];
  url: string;
  shortUrl?: string;
  pos: number;
  dateLastActivity: string;
  members?: Member[];
  badges?: {
    comments?: number;
    attachments?: number;
    checkItems?: number;
    checkItemsChecked?: number;
    description?: boolean;
  };
}

export interface List {
  id: string;
  name: string;
  pos: number;
  closed?: boolean;
}

export interface Board {
  id: string;
  name: string;
  desc?: string;
  url: string;
  shortUrl?: string;
  starred?: boolean;
  closed?: boolean;
  idOrganization?: string | null;
  dateLastActivity?: string | null;
  prefs?: {
    backgroundColor?: string | null;
    backgroundTopColor?: string | null;
    backgroundImageScaled?: { width: number; height: number; url: string }[] | null;
  };
  lists?: List[];
}

export interface Organization {
  id: string;
  displayName: string;
}

// ---------------------------------------------------------------------------
// Colors

/** Trello's label colors (also `green_dark`, `sky_light`…) in the launcher's palette. */
export function labelColor(color: string | null | undefined): Color {
  const base = (color ?? "").replace(/_(dark|light)$/, "");
  const map: Record<string, Color> = {
    green: "green",
    yellow: "yellow",
    orange: "orange",
    red: "red",
    purple: "purple",
    blue: "blue",
    sky: "teal",
    lime: "green",
    pink: "pink",
    black: "gray",
  };
  return map[base] ?? "gray";
}

/** The palette color closest to a `#rrggbb` color. */
export function colorOf(hex: string | null | undefined): Color {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return "gray";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.12) return "gray";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  const hue = (h * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 40) return "orange";
  if (hue < 65) return "yellow";
  if (hue < 160) return "green";
  if (hue < 195) return "teal";
  if (hue < 250) return "blue";
  if (hue < 300) return "purple";
  return "pink";
}

export function boardColor(board: Board): Color {
  return colorOf(board.prefs?.backgroundTopColor ?? board.prefs?.backgroundColor);
}

/** A scaled background around 600px wide, only from the host in `net`. */
export function boardImage(board: Board): string | undefined {
  const scaled = (board.prefs?.backgroundImageScaled ?? [])
    .filter((s) => s.url.startsWith("https://trello-backgrounds.s3.amazonaws.com/"));
  if (!scaled.length) return undefined;
  const fit = [...scaled].sort((a, b) => Math.abs(a.width - 640) - Math.abs(b.width - 640));
  return fit[0].url;
}

/** `https://trello-members.s3.amazonaws.com/<id>/<hash>` → its 50px picture. */
export function avatarOf(member: Member): string {
  const url = member.avatarUrl ?? "";
  if (url.startsWith("https://trello-members.s3.amazonaws.com/")) return /\.png$/.test(url) ? url : `${url}/50.png`;
  return member.fullName || member.username;
}

// ---------------------------------------------------------------------------
// Cards

export const dueOf = (card: Card) => card.due ? new Date(card.due) : undefined;

export function cardSection(card: Card, now = new Date()): string {
  if (card.dueComplete) return "Completed";
  return dueBucket(dueOf(card), now);
}

/** Due first (soonest first), then the most recently active. */
export function sortByDue(cards: Card[]): Card[] {
  const key = (c: Card) => c.dueComplete ? 2 : c.due ? 0 : 1;
  return [...cards].sort((a, b) =>
    key(a) - key(b) || (a.due ?? "").localeCompare(b.due ?? "") ||
    b.dateLastActivity.localeCompare(a.dateLastActivity)
  );
}

/** Cards of a board by list position, then card position. */
export function sortByList(cards: Card[], lists: List[]): Card[] {
  const order = new Map(lists.map((l) => [l.id, l.pos]));
  return [...cards].sort((a, b) => (order.get(a.idList) ?? 1e15) - (order.get(b.idList) ?? 1e15) || a.pos - b.pos);
}

export function checklist(card: Card): { done: number; total: number } {
  return { done: card.badges?.checkItemsChecked ?? 0, total: card.badges?.checkItems ?? 0 };
}

export function dueColor(card: Card, now = new Date()): Color | undefined {
  const due = dueOf(card);
  if (!due) return undefined;
  if (card.dueComplete) return "green";
  if (due < now) return "red";
  if (due.getTime() - now.getTime() < 86_400_000) return "orange";
  return undefined;
}

export function cardIcon(card: Card): { source: string; tint: Color } {
  if (card.dueComplete) return { source: Icons.squareCheck, tint: "green" };
  const first = card.labels.find((l) => l.color);
  return { source: Icons.square, tint: first ? labelColor(first.color) : "gray" };
}

/** Labels without a name show their color, as on the board. */
export const labelText = (l: Label) => l.name || (l.color ?? "label").replace(/_/g, " ");

export function cardMetadata(
  card: Card,
  where: { board?: string; list?: string },
  now = new Date(),
): Metadata[] {
  const lines: Metadata[] = [];
  if (where.board) lines.push(meta.text("Board", where.board, { icon: Icons.kanban }));
  if (where.list) lines.push(meta.text("List", where.list, { icon: Icons.layers }));
  const due = dueOf(card);
  if (due) {
    lines.push(meta.text("Due", `${shortDue(due, now)}${card.dueComplete ? " · complete" : ""}`, {
      icon: card.dueComplete ? Icons.squareCheck : Icons.calendar,
      color: dueColor(card, now),
    }));
  }
  if (card.start) lines.push(meta.text("Start", shortDue(new Date(card.start), now, false), { icon: Icons.calendar }));
  if (card.labels.length) {
    lines.push(meta.tags("Labels", card.labels.map((l) => ({ text: labelText(l), color: labelColor(l.color) }))));
  }
  for (const [i, m] of (card.members ?? []).entries()) {
    lines.push(meta.person(i === 0 ? "Members" : "", m.fullName || m.username, avatarOf(m)));
  }
  const list = checklist(card);
  if (list.total) lines.push(meta.progress("Checklist", list.done / list.total, `${list.done} of ${list.total}`));
  if (card.badges?.comments) lines.push(meta.text("Comments", card.badges.comments, { icon: Icons.comment }));
  if (card.badges?.attachments) lines.push(meta.text("Attachments", card.badges.attachments, { icon: Icons.file }));
  lines.push(meta.separator());
  lines.push(meta.text("Last activity", shortDue(new Date(card.dateLastActivity), now, false)));
  lines.push(meta.link("Link", (card.shortUrl ?? card.url).replace(/^https:\/\//, ""), card.shortUrl ?? card.url));
  return lines;
}

/** The first paragraphs of the description, for the side panel. */
export function excerpt(text: string | null | undefined, max = 500): string | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

export function setupItem(error: AuthError, prefs: Record<string, unknown>): Item {
  const key = String(prefs.apiKey ?? "").trim();
  const hasKey = /^[0-9a-f]{32}$/i.test(key);
  return {
    id: "setup",
    title: error.message,
    subtitle: hasKey ? "Your API key is set: generate a token for it" : "An API key and a token from Trello",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Trello",
        "",
        "Trello gives personal access with an **API key** and a **token**:",
        "",
        "1. Open **trello.com/power-ups/admin**, create a Power-Up (any name, your workspace),",
        "   then **API key → Generate a new API key**.",
        "2. Paste the key in **Settings → Extensions → Trello → Configure → API key**.",
        "3. Come back here: Enter opens Trello's page that **generates a token** for that key",
        "   (read and write, no expiry). Paste it in **Token**.",
        "",
        "You can revoke the token any time in Trello → Settings → Applications.",
      ].join("\n"),
    },
    actions: hasKey
      ? [
        open(authorizeUrl(key), "Generate Token", { icon: Icons.key }),
        open(KEY_URL, "Open Power-Up Admin", { icon: Icons.settings }),
      ]
      : [open(KEY_URL, "Create an API Key", { icon: Icons.key })],
  };
}

// ---------------------------------------------------------------------------
// Dates

/** `YYYY-MM-DD` in local time. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Midnight of a `YYYY-MM-DD` day, local time. */
export function dayOf(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A day typed by a person, or undefined: today, tomorrow, friday, next week, +3d, 2026-11-03, 3 Nov. */
function parseDay(text: string, now: Date): Date | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  const today = addDays(now, 0);
  if (/^(today|tod|tonight)$/.test(t)) return today;
  if (/^(tomorrow|tmr|tom|tmrw)$/.test(t)) return addDays(now, 1);
  if (t === "day after tomorrow") return addDays(now, 2);
  if (t === "next week") return addDays(now, ((8 - now.getDay()) % 7) || 7);
  if (t === "weekend" || t === "this weekend") return addDays(now, now.getDay() === 6 ? 0 : (6 - now.getDay()) || 6);
  const rel = /^(?:in )?\+?(\d{1,3}) ?(d|days?|w|weeks?)$/.exec(t);
  if (rel) return addDays(now, Number(rel[1]) * (rel[2].startsWith("w") ? 7 : 1));
  const wd = /^(?:next |this |on )?([a-z]{3,9})$/.exec(t);
  if (wd) {
    const i = WEEKDAYS.findIndex((w) => w.startsWith(wd[1]) && wd[1].length >= 3);
    if (i >= 0) return addDays(now, ((i - now.getDay() + 7) % 7) || 7);
  }
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (iso) return valid(new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])), Number(iso[3]));
  const dm = /^(\d{1,2}) ([a-z]{3,9})\.?(?: (\d{4}))?$/.exec(t) ??
    swap(/^([a-z]{3,9})\.? (\d{1,2})(?:,? (\d{4}))?$/.exec(t));
  if (dm) {
    const month = MONTHS.indexOf(dm[2].slice(0, 3));
    if (month < 0) return undefined;
    const day = Number(dm[1]);
    let d = new Date(dm[3] ? Number(dm[3]) : now.getFullYear(), month, day);
    if (!dm[3] && d < today) d = new Date(now.getFullYear() + 1, month, day);
    return valid(d, day);
  }
  return undefined;
}

function swap(m: RegExpExecArray | null): string[] | null {
  return m ? [m[0], m[2], m[1], m[3]] : null;
}

function valid(d: Date, day: number): Date | undefined {
  return isNaN(d.getTime()) || d.getDate() !== day ? undefined : d;
}

/** A time of day: 15:00, 3pm, 3:30pm, 15h, 15h30. */
function parseTime(text: string): { h: number; m: number } | undefined {
  const t = text.trim().toLowerCase();
  const m = /^(\d{1,2})(?:[:h.](\d{2}))? ?(am|pm|h)?$/.exec(t);
  if (!m || (!m[2] && !m[3])) return undefined;
  let h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return undefined;
  return { h, m: min };
}

export interface When {
  date: Date;
  /** False for a whole day. */
  time: boolean;
}

/**
 * A due date typed in a form: "tomorrow", "fri 3pm", "next week", "+3d",
 * "2026-11-03 14:30", "3 Nov". Empty → undefined; unreadable → throws.
 */
export function parseWhen(text: string, now = new Date()): When | undefined {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ").replace(/ at /, " ");
  if (!t || t === "none" || t === "no date") return undefined;
  const words = t.split(" ");
  // The time is the last word or two ("3 pm").
  for (const n of [2, 1]) {
    if (words.length < n) continue;
    const time = parseTime(words.slice(-n).join(""));
    if (!time) continue;
    const rest = words.slice(0, -n).join(" ").replace(/ at$/, "");
    let day = rest ? parseDay(rest, now) : addDays(now, 0);
    if (!day) break;
    const date = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.h, time.m);
    // "3pm" alone, already past: tomorrow.
    if (!rest && date <= now) {
      day = addDays(now, 1);
      date.setFullYear(day.getFullYear(), day.getMonth(), day.getDate());
    }
    return { date, time: true };
  }
  const day = parseDay(t, now);
  if (day) return { date: day, time: false };
  throw new Error(`Can't read the date “${text.trim()}”: try today, tomorrow, friday 3pm, +3d or 2026-11-03`);
}

/** "Overdue", "Today", "Tomorrow", "This Week", "Later" or "No Due Date". */
export function dueBucket(due: Date | undefined, now = new Date(), time = true): string {
  if (!due) return "No Due Date";
  const today = localDate(now);
  const day = localDate(due);
  if (time ? due < now && day <= today : day < today) return "Overdue";
  if (day === today) return "Today";
  if (day === localDate(addDays(now, 1))) return "Tomorrow";
  if (due < addDays(now, 7)) return "This Week";
  return "Later";
}

export const BUCKETS = ["Overdue", "Today", "Tomorrow", "This Week", "Later", "No Due Date"];

/** "today 15:00", "tomorrow", "Fri", "Nov 3", "Nov 3, 2027". */
export function shortDue(due: Date, now = new Date(), time = true): string {
  const clock = time ? ` ${due.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : "";
  const day = localDate(due);
  if (day === localDate(now)) return `today${clock}`;
  if (day === localDate(addDays(now, 1))) return `tomorrow${clock}`;
  if (day === localDate(addDays(now, -1))) return `yesterday${clock}`;
  const days = (dayOf(day).getTime() - dayOf(localDate(now)).getTime()) / 86_400_000;
  if (days > 0 && days < 7) return `${due.toLocaleDateString("en", { weekday: "short" })}${clock}`;
  const sameYear = due.getFullYear() === now.getFullYear();
  return due.toLocaleDateString("en", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) }) +
    clock;
}

/** The choices of a "Change Due Date" submenu, as `YYYY-MM-DD`. */
export function dueChoices(now = new Date()): { title: string; date: string | null }[] {
  const monday = addDays(now, ((8 - now.getDay()) % 7) || 7);
  return [
    { title: "Today", date: localDate(now) },
    { title: "Tomorrow", date: localDate(addDays(now, 1)) },
    {
      title: `Next Week (${monday.toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" })})`,
      date: localDate(monday),
    },
    { title: "In Two Weeks", date: localDate(addDays(now, 14)) },
    { title: "No Due Date", date: null },
  ];
}
