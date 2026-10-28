// Nextcloud: WebDAV listings, OCS envelopes, unified search, Notes and Deck,
// in plain shapes, and how to show them.

/** `cloud.example.com/index.php/apps/files/` → `https://cloud.example.com`; a sub-path (`/nextcloud`) is kept. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const u = new URL(url);
    const path = u.pathname
      .replace(/\/(index\.php|remote\.php|ocs|apps|login|s|f)(\/.*)?$/i, "")
      .replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/** Basic auth with the login name and an app password (Settings → Security → Devices & sessions). */
export function basicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/** App passwords are shown as `xxxxx-xxxxx-xxxxx-xxxxx-xxxxx`; pasted with spaces they still work. */
export const cleanSecret = (s: unknown) => String(s ?? "").trim();

// ---------------------------------------------------------------------------
// OCS

export interface OcsEnvelope<T> {
  ocs: { meta: { status: string; statuscode: number; message?: string | null }; data: T };
}

/** The data of an OCS answer, or an error with the server's message. */
export function ocsData<T>(body: OcsEnvelope<T>): T {
  const m = body?.ocs?.meta;
  if (!m) throw new Error("Nextcloud answered something that is not an OCS response");
  // v1 says 100 for OK, v2 says 200.
  if (m.statuscode !== 100 && m.statuscode !== 200) {
    throw new Error(m.message || `Nextcloud error ${m.statuscode}`);
  }
  return body.ocs.data;
}

// ---------------------------------------------------------------------------
// WebDAV

export interface DavEntry {
  /** Path inside the user's files, starting with `/`, without a trailing slash (`/` for the root). */
  path: string;
  name: string;
  folder: boolean;
  size: number;
  /** Unix ms. */
  modified?: number;
  mime?: string;
  fileId?: number;
  etag?: string;
  favorite: boolean;
  hasPreview: boolean;
  shared: boolean;
  owner?: string;
  /** "R" (shared with you), "S" (shareable), "M" (mounted), "W", "D"… */
  permissions?: string;
  mount?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e] ?? all;
  });

/** The text of the first `<prefix:name>` element (any namespace prefix), or `""` for an empty one. */
function prop(xml: string, name: string): string | undefined {
  const m = new RegExp(`<(?:[\\w-]+:)?${name}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</(?:[\\w-]+:)?${name}>)`).exec(xml);
  return m ? decodeXml(m[1] ?? "").trim() : undefined;
}

/** The PROPFIND body asking for what the rows show. */
export const PROPFIND_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind xmlns:d="DAV:" xmlns:oc="http://owncloud.org/ns" xmlns:nc="http://nextcloud.org/ns">
  <d:prop>
    <d:getlastmodified/>
    <d:getcontentlength/>
    <d:getcontenttype/>
    <d:resourcetype/>
    <d:getetag/>
    <oc:fileid/>
    <oc:size/>
    <oc:favorite/>
    <oc:permissions/>
    <oc:owner-display-name/>
    <oc:share-types/>
    <nc:has-preview/>
    <nc:mount-type/>
  </d:prop>
</d:propfind>`;

/**
 * A `207 Multi-Status` answer to PROPFIND, as entries. `root` is the
 * user's files collection (`/remote.php/dav/files/<user>`), stripped from hrefs.
 */
export function parseMultistatus(xml: string, root: string): DavEntry[] {
  const out: DavEntry[] = [];
  const rootPath = decodeURIComponent(root).replace(/\/+$/, "");
  for (const m of xml.matchAll(/<(?:[\w-]+:)?response(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?response>/g)) {
    const block = m[1];
    const href = prop(block, "href");
    if (href === undefined) continue;
    // Only the properties the server found (HTTP 200); the 404 propstat lists the missing ones.
    const props = [...block.matchAll(/<(?:[\w-]+:)?propstat(?:\s[^>]*)?>([\s\S]*?)<\/(?:[\w-]+:)?propstat>/g)]
      .map((p) => p[1])
      .filter((p) => / 200 /.test(prop(p, "status") ?? " 200 "))
      .join("\n");
    let path: string;
    try {
      path = decodeURIComponent(href.replace(/^https?:\/\/[^/]+/, ""));
    } catch {
      path = href;
    }
    const at = path.indexOf(rootPath);
    path = at >= 0 ? path.slice(at + rootPath.length) : path;
    path = `/${path.replace(/^\/+|\/+$/g, "")}`;
    const folder = /collection/.test(prop(props, "resourcetype") ?? "");
    const size = Number(prop(props, "size") ?? prop(props, "getcontentlength") ?? 0);
    const modified = Date.parse(prop(props, "getlastmodified") ?? "");
    const fileId = Number(prop(props, "fileid"));
    const shareTypes = prop(props, "share-types");
    out.push({
      path,
      name: path === "/" ? "/" : path.split("/").pop()!,
      folder,
      size: Number.isFinite(size) ? size : 0,
      modified: Number.isFinite(modified) ? modified : undefined,
      mime: prop(props, "getcontenttype") || undefined,
      fileId: Number.isFinite(fileId) && fileId > 0 ? fileId : undefined,
      etag: prop(props, "getetag")?.replace(/^"|"$/g, ""),
      favorite: prop(props, "favorite") === "1",
      hasPreview: prop(props, "has-preview") === "true",
      shared: /share-type>/.test(shareTypes ?? ""),
      owner: prop(props, "owner-display-name") || undefined,
      permissions: prop(props, "permissions") || undefined,
      mount: prop(props, "mount-type") || undefined,
    });
  }
  return out;
}

/** Folders first, then names in natural order ("2" before "10"). */
export const sortEntries = (list: DavEntry[]) =>
  [...list].sort((a, b) =>
    Number(b.folder) - Number(a.folder) ||
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
  );

/** `/Photos/2024 été` → `Photos/2024%20%C3%A9t%C3%A9`, segment by segment. */
export const encodePath = (path: string) => path.split("/").filter(Boolean).map(encodeURIComponent).join("/");

export const parentOf = (path: string) => {
  const p = path.replace(/\/+$/, "");
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
};

export function filesWebUrl(base: string, e: { path: string; fileId?: number; folder: boolean }): string {
  if (e.fileId && !e.folder) return `${base}/index.php/f/${e.fileId}`;
  return `${base}/index.php/apps/files/?dir=${encodeURIComponent(e.folder ? e.path : parentOf(e.path))}`;
}

export type Glyph = { source: string; tint: Color };

/** A glyph for a file from its type. */
export function fileGlyph(e: { folder: boolean; mime?: string; name: string; shared?: boolean }): Glyph {
  if (e.folder) return { source: "bs-folder", tint: e.shared ? "teal" : "blue" };
  const m = e.mime ?? "";
  const ext = e.name.split(".").pop()?.toLowerCase() ?? "";
  if (m.startsWith("image/")) return { source: "bs-image", tint: "purple" };
  if (m.startsWith("video/")) return { source: "bs-video", tint: "pink" };
  if (m.startsWith("audio/")) return { source: "bs-music", tint: "pink" };
  if (m === "application/pdf") return { source: "bs-file", tint: "red" };
  if (/zip|tar|compressed|x-7z|rar/.test(m)) return { source: "bs-archive", tint: "orange" };
  if (/spreadsheet|excel|csv/.test(m) || ["ods", "xlsx", "csv"].includes(ext)) {
    return { source: "bs-database", tint: "green" };
  }
  if (/presentation|powerpoint/.test(m)) return { source: "bs-monitor", tint: "orange" };
  if (m === "text/markdown" || ext === "md") return { source: "bs-note", tint: "blue" };
  if (m.startsWith("text/") || /document|msword|opendocument\.text/.test(m)) return { source: "bs-text", tint: "blue" };
  return { source: "bs-file", tint: "gray" };
}

// ---------------------------------------------------------------------------
// Unified search

export interface Provider {
  id: string;
  appId?: string;
  name: string;
  order?: number;
}

export interface SearchEntry {
  title: string;
  subline?: string;
  resourceUrl?: string;
  thumbnailUrl?: string;
  icon?: string;
  attributes?: Record<string, string>;
}

export interface SearchResult {
  name: string;
  isPaginated?: boolean;
  entries: SearchEntry[];
  cursor?: number | string | null;
}

/** Providers that only make sense inside the web UI. */
const SKIPPED_PROVIDERS = new Set(["in-folder", "settings_apps"]);

export const searchableProviders = (list: Provider[]) =>
  list.filter((p) => !SKIPPED_PROVIDERS.has(p.id)).sort((a, b) => (a.order ?? 50) - (b.order ?? 50));

const PROVIDER_GLYPHS: [RegExp, Glyph][] = [
  [/^files|^recent-files|^fulltextsearch/, { source: "bs-file", tint: "blue" }],
  [/notes/, { source: "bs-note", tint: "yellow" }],
  [/deck/, { source: "bs-kanban", tint: "blue" }],
  [/talk|spreed|conversations/, { source: "bs-comment", tint: "teal" }],
  [/calendar|event/, { source: "bs-calendar", tint: "red" }],
  [/tasks/, { source: "bs-square-check", tint: "green" }],
  [/contacts|users|people/, { source: "bs-user", tint: "purple" }],
  [/mail/, { source: "bs-mail", tint: "blue" }],
  [/bookmarks/, { source: "bs-bookmark", tint: "orange" }],
  [/photos|memories/, { source: "bs-image", tint: "purple" }],
  [/settings/, { source: "bs-settings", tint: "gray" }],
  [/comments/, { source: "bs-comment", tint: "gray" }],
  [/tags/, { source: "bs-tag", tint: "gray" }],
  [/forms/, { source: "bs-square-check", tint: "purple" }],
  [/collectives|wiki/, { source: "bs-book", tint: "teal" }],
];

export function providerGlyph(id: string): Glyph {
  return PROVIDER_GLYPHS.find(([re]) => re.test(id))?.[1] ?? { source: "bs-search", tint: "gray" };
}

/** Result links are absolute, or relative to the server. */
export function absoluteUrl(base: string, url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  const origin = new URL(base).origin;
  return url.startsWith("/") ? `${origin}${url}` : `${base}/${url}`;
}

// ---------------------------------------------------------------------------
// Notes (API v1)

export interface Note {
  id: number;
  etag?: string;
  readonly?: boolean;
  /** Unix seconds. */
  modified: number;
  title: string;
  category: string;
  content?: string;
  favorite: boolean;
}

export const sortNotes = (list: Note[]) =>
  [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || b.modified - a.modified);

/** The note's text without its first line when that line is the title. */
export function noteBody(n: Note): string {
  const text = (n.content ?? "").replace(/\r/g, "");
  const lines = text.split("\n");
  const first = lines[0]?.replace(/^#+\s*/, "").trim();
  return (first === n.title.trim() ? lines.slice(1) : lines).join("\n").trim();
}

export function noteSnippet(n: Note, max = 80): string {
  const line = noteBody(n).split("\n").map((l) => l.replace(/^[#>*\-\s]+|[*_`]/g, "").trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export const notesWebUrl = (base: string, id?: number) =>
  `${base}/index.php/apps/notes/${id !== undefined ? `note/${id}` : ""}`;

// ---------------------------------------------------------------------------
// Deck

export interface DeckUser {
  uid?: string;
  primaryKey?: string;
  displayname?: string;
}

export interface DeckCard {
  id: number;
  title: string;
  description?: string;
  stackId: number;
  order?: number;
  duedate?: string | null;
  /** Deck 1.12+: when it was marked done. */
  done?: string | null;
  archived?: boolean;
  deletedAt?: number;
  labels?: { id: number; title: string; color?: string }[];
  assignedUsers?: { participant?: DeckUser; type?: number }[];
  owner?: DeckUser | string;
  commentsCount?: number;
  attachmentCount?: number;
  lastModified?: number;
}

export interface DeckStack {
  id: number;
  title: string;
  boardId: number;
  order?: number;
  deletedAt?: number;
  cards?: DeckCard[];
}

export interface DeckBoard {
  id: number;
  title: string;
  color?: string;
  archived?: boolean;
  deletedAt?: number;
}

export interface CardView {
  card: DeckCard;
  board: DeckBoard;
  stack: DeckStack;
  stacks: DeckStack[];
  due?: number;
  assignees: string[];
  mine: boolean;
}

export function deckCards(board: DeckBoard, stacks: DeckStack[], me: string): CardView[] {
  const live = stacks.filter((s) => !s.deletedAt).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  return live.flatMap((stack) =>
    (stack.cards ?? [])
      .filter((c) => !c.archived && !c.deletedAt)
      .map((card) => {
        const users = (card.assignedUsers ?? []).map((a) => a.participant).filter((p): p is DeckUser => !!p);
        const due = card.duedate ? Date.parse(card.duedate) : NaN;
        return {
          card,
          board,
          stack,
          stacks: live,
          due: Number.isFinite(due) ? due : undefined,
          assignees: users.map((u) => u.displayname || u.uid || u.primaryKey || "").filter(Boolean),
          mine: users.some((u) => (u.uid ?? u.primaryKey) === me),
        };
      })
  );
}

export type DueBucket = "Overdue" | "Today" | "Tomorrow" | "This Week" | "Later" | "No Due Date" | "Done";
export const BUCKETS: DueBucket[] = ["Overdue", "Today", "Tomorrow", "This Week", "Later", "No Due Date", "Done"];

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function dueBucket(c: CardView, now = Date.now()): DueBucket {
  if (c.card.done) return "Done";
  if (c.due === undefined) return "No Due Date";
  if (c.due < now) return "Overdue";
  const days = Math.round((startOfDay(c.due) - startOfDay(now)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  if (days < 7) return "This Week";
  return "Later";
}

/** "3 days overdue", "today 17:00", "tomorrow", "Fri", "12 Nov". */
export function dueText(due: number | undefined, now = Date.now()): string {
  if (due === undefined) return "";
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000);
  const d = new Date(due);
  const time = d.getHours() || d.getMinutes()
    ? ` ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
    : "";
  if (due < now) {
    if (days === 0) return `overdue since${time || " today"}`;
    return `${-days} day${days === -1 ? "" : "s"} overdue`;
  }
  if (days === 0) return `today${time}`;
  if (days === 1) return `tomorrow${time}`;
  if (days < 7) return d.toLocaleDateString("en-GB", { weekday: "short" }) + time;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(days > 300 ? { year: "numeric" } : {}) });
}

export const sortCards = (list: CardView[], now = Date.now()) =>
  [...list].sort((a, b) =>
    BUCKETS.indexOf(dueBucket(a, now)) - BUCKETS.indexOf(dueBucket(b, now)) ||
    (a.due ?? Infinity) - (b.due ?? Infinity) ||
    a.board.title.localeCompare(b.board.title) ||
    (a.card.order ?? 0) - (b.card.order ?? 0)
  );

export const deckWebUrl = (base: string, boardId: number, cardId?: number) =>
  `${base}/index.php/apps/deck/board/${boardId}${cardId !== undefined ? `/card/${cardId}` : ""}`;

export type Color = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

/** The launcher's named color closest in hue to `rrggbb` (Deck labels, boards). */
export function nearestColor(hex: string | undefined): Color {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return "gray";
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (max === 0 || d / max < 0.15 || d < 0.08) return "gray";
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return "red";
  if (h < 40) return "orange";
  if (h < 65) return "yellow";
  if (h < 160) return "green";
  if (h < 190) return "teal";
  if (h < 250) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

// ---------------------------------------------------------------------------
// Formatting and files

export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  const v = n / 1000 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function ago(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `name.ext` in `dir`, or `name (2).ext` when taken; never a path outside `dir`. */
export function freePath(dir: string, file: string, exists: (p: string) => boolean): string {
  const safe = file.replace(/[/\\\0]/g, "_").replace(/^\.+/, "") || "download";
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const p = `${dir}/${i === 1 ? safe : `${stem} (${i})${ext}`}`;
    if (!exists(p)) return p;
  }
  return `${dir}/${stem} (${Date.now()})${ext}`;
}
