// Memos (API v1) and Trilium (ETAPI) notes in one shape, Trilium's HTML as
// readable Markdown, titles, tags and links. No network here.

import { Icons, type Item, open } from "@backslash/api";

export type Service = "memos" | "trilium";
export const SERVICE_NAMES: Record<Service, string> = { memos: "Memos", trilium: "Trilium" };

export class SetupError extends Error {
  constructor(message: string, readonly service?: Service, readonly base?: string) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Hosts

export const HOSTS = [
  "demo.usememos.com",
  "localhost",
  "127.0.0.1",
  "memos",
  "trilium",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.duckdns.org",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `memos.lan:5230/explore` or `http://x:8080/etapi` → `http://memos.lan:5230`; a sub-path is kept. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const u = new URL(url);
    const path = u.pathname
      .replace(/\/(api(\/v1)?|etapi|explore|home|auth|setting|login|m\/[^/]+)\/?$/i, "")
      .replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// The shape shown

export interface Note {
  service: Service;
  /** "memos/abc123" for Memos, the note ID for Trilium. */
  id: string;
  title: string;
  /** Markdown. */
  body: string;
  pinned: boolean;
  tags: string[];
  created?: string;
  updated?: string;
  /** Memos: PRIVATE, PROTECTED, PUBLIC. */
  visibility?: string;
  /** Trilium: text, code, book… */
  type?: string;
  url: string;
  /** Trilium: the bookmark label, to remove it. */
  bookmarkAttributeId?: string;
  /** Memos: has unchecked tasks. */
  openTasks?: boolean;
}

/** "#work and #home/garden" → ["work", "home/garden"]; not inside code or links. */
export function tagsIn(text: string): string[] {
  const clean = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ").replace(/\]\([^)]*\)/g, "]");
  const out = new Set<string>();
  for (const m of clean.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_][\p{L}\p{N}_/-]*)/gu)) out.add(m[1]);
  return [...out];
}

/** The first line of a memo without its Markdown, for the list. */
export function titleOf(content: string, max = 90): string {
  const line = content.split("\n").map((l) => l.trim()).find((l) => l && !/^```/.test(l)) ?? "";
  const plain = line
    .replace(/^#{1,6}\s+/, "")
    .replace(/^[-*+]\s+\[[ xX]\]\s+/, "")
    .replace(/^[-*+>]\s+/, "")
    .replace(/^\d+\.\s+/, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(\*\*|__|\*|_|~~|`)/g, "")
    .trim();
  if (!plain) return "Untitled memo";
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

// ---------------------------------------------------------------------------
// Memos

export interface Memo {
  name: string;
  uid?: string;
  creator?: string;
  createTime?: string;
  updateTime?: string;
  displayTime?: string;
  content: string;
  visibility?: string;
  pinned?: boolean;
  tags?: string[];
  state?: string;
  rowStatus?: string;
  property?: { tags?: string[]; hasIncompleteTasks?: boolean };
}

export const memoUid = (m: Pick<Memo, "name" | "uid">) => m.uid || m.name.split("/").pop() || m.name;

export function fromMemo(m: Memo, base: string): Note {
  return {
    service: "memos",
    id: m.name,
    title: titleOf(m.content),
    body: m.content,
    pinned: Boolean(m.pinned),
    tags: m.tags ?? m.property?.tags ?? tagsIn(m.content),
    created: m.displayTime ?? m.createTime,
    updated: m.updateTime,
    visibility: m.visibility,
    url: `${base}/m/${memoUid(m)}`,
    openTasks: m.property?.hasIncompleteTasks ?? /^\s*[-*+]\s+\[ \]/m.test(m.content),
  };
}

/** Visible in the list: not archived, and yours when we know who you are. */
export function isMine(m: Memo, me?: string): boolean {
  const state = m.state ?? m.rowStatus;
  if (state && state !== "NORMAL" && state !== "ACTIVE") return false;
  return !me || !m.creator || m.creator === me;
}

/** The user name in any of the shapes `auth/me`, `auth/sessions/current` and `auth/status` answer. */
export function userName(body: unknown): string | undefined {
  const b = body as { name?: string; user?: { name?: string } } | undefined;
  const name = b?.user?.name ?? b?.name;
  return typeof name === "string" && name.startsWith("users/") ? name : undefined;
}

export const VISIBILITY_LABELS: Record<string, string> = {
  PRIVATE: "Private",
  PROTECTED: "Workspace",
  PUBLIC: "Public",
};

// ---------------------------------------------------------------------------
// Trilium

export interface TriliumAttribute {
  attributeId: string;
  noteId?: string;
  type: "label" | "relation";
  name: string;
  value: string;
}

export interface TriliumNote {
  noteId: string;
  title: string;
  type: string;
  mime?: string;
  isProtected?: boolean;
  attributes?: TriliumAttribute[];
  dateCreated?: string;
  dateModified?: string;
  utcDateCreated?: string;
  utcDateModified?: string;
}

/** Labels Trilium uses for itself: not shown as tags. */
const INTERNAL_LABELS = new Set([
  "bookmarked",
  "iconClass",
  "cssClass",
  "archived",
  "inbox",
  "calendarRoot",
  "dateNote",
  "monthNote",
  "yearNote",
  "weekNote",
  "sorted",
  "workspace",
  "readOnly",
  "autoReadOnlyDisabled",
  "hideChildrenOverview",
  "pageSize",
  "viewType",
]);

/** "2026-10-30 14:02:11.123+0200" → an ISO date. */
export function triliumDate(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(s.trim());
  if (!m) return Number.isNaN(Date.parse(s)) ? undefined : new Date(s).toISOString();
  const zone = !m[4] || m[4] === "Z" ? "Z" : m[4].includes(":") ? m[4] : `${m[4].slice(0, 3)}:${m[4].slice(3)}`;
  const d = new Date(`${m[1]}T${m[2]}.${(m[3] ?? "0").padEnd(3, "0").slice(0, 3)}${zone}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function fromTrilium(n: TriliumNote, base: string, html?: string): Note {
  const labels = (n.attributes ?? []).filter((a) => a.type === "label");
  const bookmark = labels.find((a) => a.name === "bookmarked");
  const body = n.isProtected
    ? "_This note is protected: open it in Trilium to read it._"
    : html === undefined
    ? ""
    : n.type === "code"
    ? `\`\`\`\n${html}\n\`\`\``
    : n.type === "text"
    ? htmlToMarkdown(html)
    : "";
  return {
    service: "trilium",
    id: n.noteId,
    title: n.title || "Untitled",
    body,
    pinned: Boolean(bookmark),
    tags: labels.filter((a) => !INTERNAL_LABELS.has(a.name) && !a.name.startsWith("_"))
      .map((a) => a.value ? `${a.name}=${a.value}` : a.name),
    created: triliumDate(n.utcDateCreated ?? n.dateCreated),
    updated: triliumDate(n.utcDateModified ?? n.dateModified),
    type: n.type,
    url: `${base}/#root/${n.noteId}`,
    bookmarkAttributeId: bookmark?.attributeId,
  };
}

/** Trilium's own notes (options, the hidden tree) are not shown. */
export const isUserNote = (n: TriliumNote) => !n.noteId.startsWith("_") && n.noteId !== "root";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Trilium's (CKEditor) HTML as Markdown good enough for a preview. */
export function htmlToMarkdown(html: string): string {
  let s = html.replace(/\r\n?/g, "\n");
  // Code blocks first, kept as they are.
  const blocks: string[] = [];
  s = s.replace(/<pre[^>]*>\s*(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi, (_, code: string) => {
    blocks.push("```\n" + decodeEntities(code.replace(/<[^>]+>/g, "")).replace(/\n+$/, "") + "\n```");
    return `\n\n@@CODE${blocks.length - 1}@@\n\n`;
  });
  s = s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, t: string) => `\n\n${"#".repeat(Number(n))} ${t}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>\s*<input[^>]*checked[^>]*>/gi, "<li>[x] ")
    .replace(/<li[^>]*>\s*<input[^>]*type="checkbox"[^>]*>/gi, "<li>[ ] ")
    .replace(/<label[^>]*class="todo-list__label"[^>]*>\s*<input[^>]*checked[^>]*>/gi, "[x] ")
    .replace(/<label[^>]*class="todo-list__label"[^>]*>\s*<input[^>]*>/gi, "[ ] ")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/?(ul|ol)[^>]*>/gi, "\n")
    .replace(
      /<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi,
      (_, t: string) =>
        "\n\n" + t.replace(/<\/?p[^>]*>/gi, "\n").trim().split("\n").map((l) => `> ${l.trim()}`).join("\n") + "\n\n",
    )
    .replace(/<(strong|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, "_$2_")
    .replace(/<(s|del|strike)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi, "~~$2~~")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(
      /<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
      (_, href: string, t: string) => href.startsWith("#") ? t : `[${t}](${href})`,
    )
    .replace(/<img[^>]*alt="([^"]+)"[^>]*>/gi, "[image: $1]")
    .replace(/<img[^>]*>/gi, "[image]")
    .replace(/<\/(p|div|figure|table|tr)>/gi, "\n\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<hr[^>]*>/gi, "\n\n---\n\n")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s)
    .split("\n").map((l) => l.replace(/[ \t]+$/g, "").replace(/^[ \t]+(?=[^-\s>])/, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return s.replace(/@@CODE(\d+)@@/g, (_, i: string) => blocks[Number(i)]);
}

/** A typed line as Trilium HTML: paragraphs, line breaks, escaped. */
export function textToHtml(text: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.trim().split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

/** A Trilium note title from what was typed: the first line, without #tags at its end. */
export function noteTitle(text: string): string {
  const first = text.trim().split("\n")[0].replace(/(\s+#[\p{L}\p{N}_/-]+)+\s*$/u, "").trim();
  return (first.length > 80 ? `${first.slice(0, 79).trimEnd()}…` : first) || "Quick note";
}

/** The parent for new notes: "inbox", "today" or a note ID. */
export function parentChoice(pref: unknown): { kind: "inbox" | "today" } | { kind: "note"; id: string } {
  const p = String(pref ?? "").trim();
  if (!p || /^inbox$/i.test(p)) return { kind: "inbox" };
  if (/^(today|journal|aujourd'hui)$/i.test(p)) return { kind: "today" };
  const id = /#(?:root\/)?(?:.*\/)?([A-Za-z0-9_]+)$/.exec(p)?.[1] ?? p;
  return { kind: "note", id };
}

// ---------------------------------------------------------------------------
// Search and order

/** Every word of the query in the title, body or tags, ignoring case and accents. */
export function matches(n: Note, query: string): boolean {
  const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const hay = fold(`${n.title}\n${n.body}\n${n.tags.map((t) => `#${t}`).join(" ")}`);
  return fold(query).split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

/** Pinned first, then the latest. */
export function sortNotes(list: Note[]): Note[] {
  return [...list].sort((a, b) =>
    Number(b.pinned) - Number(a.pinned) ||
    (b.updated ?? b.created ?? "").localeCompare(a.updated ?? a.created ?? "")
  );
}

/** "today", "3d", "2mo", "1y". */
export function age(date: string | undefined, now = Date.now()): string {
  if (!date) return "";
  const days = Math.floor((now - Date.parse(date)) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** What `Search Trilium` should ask for: the words, or the notes changed lately when there are none. */
export function triliumQuery(query: string): { search: string; orderBy: string } {
  const q = query.trim();
  return q
    ? { search: q, orderBy: "dateModified" }
    : { search: "note.dateModified >= MONTH-3", orderBy: "dateModified" };
}

// ---------------------------------------------------------------------------
// Errors and setup

export function apiError(service: Service, status: number, body: unknown): Error {
  const name = SERVICE_NAMES[service];
  const b = body as { message?: string; error?: string; code?: unknown } | undefined;
  const message = b?.message ?? b?.error ?? "";
  if (status === 401) return new SetupError(`${name} refused the token`, service);
  if (status === 403) return new SetupError(`${name} doesn't allow this${message ? `: ${message}` : ""}`, service);
  if (status === 404) {
    return new Error(`Not found on ${name}${message ? `: ${message}` : ": it may have been deleted"}`);
  }
  return new Error(`${name} answered ${status}${message ? `: ${message}` : ""}`);
}

export function setupItem(e: SetupError): Item {
  return {
    id: "setup",
    title: e.message,
    subtitle: e.service ? `${SERVICE_NAMES[e.service]} settings` : "Memos & Trilium settings",
    icon: { source: e.message.includes("token") ? Icons.key : Icons.plug, tint: "orange" },
    detail: {
      markdown: [
        `## ${e.message}`,
        "",
        "Set up one or both, in **Settings → Extensions → Memos & Trilium → Configure**:",
        "",
        "**Memos**: its address as you open it in the browser (`http://memos.lan:5230`), and an access token",
        "from **Settings → My Account → Access Tokens**.",
        "",
        "**Trilium**: its address (`http://trilium.lan:8080`, or `http://localhost:37840` for Trilium Desktop)",
        "and a token from **Options → ETAPI → Create new ETAPI token**.",
        "",
        "Servers can be this computer, local names (`*.local`, `*.lan`, `*.home.arpa`…), private networks",
        "(`192.168.x.x`, `10.x.x.x`), Tailscale (`100.64.x.x`, `*.ts.net`) or DuckDNS.",
      ].join("\n"),
    },
    actions: e.base
      ? [open(e.base, `Open ${e.service ? SERVICE_NAMES[e.service] : "Server"}`, { icon: Icons.globe })]
      : [],
  };
}
