// Bookmarks of Linkding and Linkwarden in one shape, links and tags typed by the user,
// and the hosts the extension may reach. No I/O here.

export type BackendId = "linkding" | "linkwarden";

export const BACKENDS: Record<BackendId, string> = { linkding: "Linkding", linkwarden: "Linkwarden" };

/** Raised when the extension isn't set up or the server refuses it: the list shows how to fix it. */
export class SetupError extends Error {}

export type Bookmark = {
  id: string;
  url: string;
  title: string;
  description: string;
  notes?: string;
  tags: string[];
  /** Linkding's archive (hidden from the main list). */
  archived: boolean;
  /** Linkding's "unread" flag. */
  unread: boolean;
  shared?: boolean;
  /** Linkwarden: pinned to the dashboard. */
  pinned?: boolean;
  /** ISO 8601. */
  created: string;
  /** Served by the server itself (Linkding), so shown only when its host may be reached. */
  favicon?: string;
  preview?: string;
  collection?: { id: string; name: string };
  /** Linkwarden kept a readable copy. */
  readable?: boolean;
  /** Linkding: the Internet Archive snapshot. */
  snapshot?: string;
};

export type Filter = "all" | "unread" | "archived" | "pinned";

/** The backend of the preferences, else guessed from the address. */
export function chooseBackend(prefs: Record<string, unknown>): BackendId | undefined {
  const asked = String(prefs.backend ?? "").trim().toLowerCase();
  if (asked === "linkding" || asked === "linkwarden") return asked;
  if (asked && asked !== "auto") return undefined;
  if (/linkwarden/i.test(String(prefs.url ?? ""))) return "linkwarden";
  if (String(prefs.url ?? "").trim()) return "linkding";
  return undefined;
}

export function domainOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** A link typed or pasted: `https://…`, or `example.com/page`; nothing for words. */
export function linkIn(text: string): string | undefined {
  const t = text.trim();
  const m = /https?:\/\/[^\s<>"'`]+/i.exec(t);
  if (m) return m[0].replace(/[),.;:!?\]]+$/, "");
  if (!t || /\s/.test(t)) return undefined;
  const bare = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?::\d+)?(?:\/\S*)?$/i.exec(t);
  return bare ? `https://${bare[0]}` : undefined;
}

/** "rust, web dev" → ["rust", "web dev"]; "#rust #cli" → ["rust", "cli"]. Spaces become dashes for Linkding. */
export function parseTags(text: string, spaces = true): string[] {
  const raw = text.includes(",") ? text.split(",") : text.split(/\s+/);
  const tags = raw.map((t) => t.trim().replace(/^#/, "").trim()).filter(Boolean)
    .map((t) => spaces ? t.replace(/\s+/g, " ") : t.replace(/\s+/g, "-"));
  return [...new Set(tags)];
}

/** Two URLs pointing to the same page (scheme, www, trailing slash aside). */
export function sameUrl(a: string, b: string): boolean {
  const norm = (u: string) => u.trim().replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();
  return norm(a) === norm(b);
}

/** "today", "yesterday", "3d", "Oct 25", "Oct 2024". */
export function savedAgo(iso: string | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** The preview panel's text: description, notes. */
export function bookmarkMarkdown(b: Bookmark): string {
  return [
    `### ${b.title}`,
    "",
    b.description ? b.description : "_No description._",
    ...(b.notes?.trim() ? ["", "---", "", b.notes.trim()] : []),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Linkding (REST API, Authorization: Token)

export type LinkdingBookmark = {
  id: number;
  url: string;
  title?: string;
  description?: string;
  notes?: string;
  website_title?: string | null;
  website_description?: string | null;
  web_archive_snapshot_url?: string;
  favicon_url?: string | null;
  preview_image_url?: string | null;
  is_archived: boolean;
  unread?: boolean;
  shared?: boolean;
  tag_names?: string[];
  date_added: string;
};

export function fromLinkding(b: LinkdingBookmark): Bookmark {
  return {
    id: String(b.id),
    url: b.url,
    title: b.title?.trim() || b.website_title?.trim() || domainOf(b.url) || b.url,
    description: b.description?.trim() || b.website_description?.trim() || "",
    notes: b.notes?.trim() || undefined,
    tags: b.tag_names ?? [],
    archived: b.is_archived,
    unread: !!b.unread,
    shared: b.shared,
    created: b.date_added,
    favicon: b.favicon_url || undefined,
    preview: b.preview_image_url || undefined,
    snapshot: b.web_archive_snapshot_url || undefined,
  };
}

/** The path and query of a Linkding search; `!unread` is Linkding's own search operator. */
export function linkdingSearch(query: string, filter: Filter, limit = 100): string {
  const q = [query.trim(), filter === "unread" ? "!unread" : ""].filter(Boolean).join(" ");
  const p = new URLSearchParams({ limit: String(limit) });
  if (q) p.set("q", q);
  return `/api/bookmarks/${filter === "archived" ? "archived/" : ""}?${p}`;
}

export function linkdingBody(b: NewBookmark): Record<string, unknown> {
  return {
    url: b.url,
    // Empty title and description: Linkding reads them from the page.
    ...(b.title ? { title: b.title } : {}),
    ...(b.description ? { description: b.description } : {}),
    ...(b.notes ? { notes: b.notes } : {}),
    // Linkding tags are single words.
    tag_names: [...new Set((b.tags ?? []).map((t) => t.trim().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean))],
    ...(b.unread ? { unread: true } : {}),
  };
}

export type NewBookmark = {
  url: string;
  title?: string;
  description?: string;
  notes?: string;
  tags?: string[];
  unread?: boolean;
  collectionId?: string;
};

// ---------------------------------------------------------------------------
// Linkwarden (API v1, Authorization: Bearer)

export type LinkwardenLink = {
  id: number;
  name?: string;
  url: string;
  description?: string;
  type?: string;
  collectionId?: number;
  collection?: { id: number; name: string; color?: string };
  tags?: { id: number; name: string }[];
  pinnedBy?: unknown[];
  createdAt: string;
  readable?: string | null;
  textContent?: string | null;
};

export type LinkwardenCollection = { id: number; name: string; parentId?: number | null; _count?: { links?: number } };

export function fromLinkwarden(l: LinkwardenLink): Bookmark {
  return {
    id: String(l.id),
    url: l.url,
    title: l.name?.trim() || domainOf(l.url) || l.url,
    description: l.description?.trim() || "",
    tags: (l.tags ?? []).map((t) => t.name),
    archived: false,
    unread: false,
    pinned: (l.pinnedBy?.length ?? 0) > 0,
    created: l.createdAt,
    collection: l.collection
      ? { id: String(l.collection.id), name: l.collection.name }
      : l.collectionId !== undefined
      ? { id: String(l.collectionId), name: "" }
      : undefined,
    readable: !!l.readable && l.readable !== "unavailable",
  };
}

/** The query of `GET /api/v1/links`: newest first, searching names, URLs, descriptions and tags. */
export function linkwardenSearch(query: string, filter: Filter, cursor?: number): string {
  const p = new URLSearchParams({ sort: "0" });
  const q = query.trim().replace(/(^|\s)#/g, "$1");
  if (q) {
    p.set("searchQueryString", q);
    for (const k of ["searchByName", "searchByUrl", "searchByDescription", "searchByTags"]) p.set(k, "true");
  }
  if (filter === "pinned") p.set("pinnedOnly", "true");
  if (cursor !== undefined) p.set("cursor", String(cursor));
  return p.toString();
}

export function linkwardenBody(b: NewBookmark): Record<string, unknown> {
  return {
    url: b.url,
    ...(b.title ? { name: b.title } : {}),
    ...(b.description ? { description: b.description } : {}),
    tags: (b.tags ?? []).map((name) => ({ name })),
    // Without a collection, Linkwarden files it in “Unorganized”.
    ...(b.collectionId ? { collection: { id: Number(b.collectionId) } } : {}),
  };
}

/** Collections as paths ("Dev › Rust"), sorted. */
export function collectionPaths(cs: LinkwardenCollection[]): { id: string; name: string; count: number }[] {
  const byId = new Map(cs.map((c) => [c.id, c]));
  const path = (c: LinkwardenCollection, seen = new Set<number>()): string => {
    const parent = c.parentId ? byId.get(c.parentId) : undefined;
    if (!parent || seen.has(c.id)) return c.name;
    seen.add(c.id);
    return `${path(parent, seen)} › ${c.name}`;
  };
  return cs.map((c) => ({ id: String(c.id), name: path(c), count: c._count?.links ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
}

// ---------------------------------------------------------------------------
// Hosts

/**
 * Where the services run, as declared in `[permissions] net` (kept equal by a
 * test): Linkwarden's hosted service, and a self-hosted Linkding or Linkwarden
 * on this computer, a container, the local network, Tailscale or DuckDNS.
 */
export const HOSTS = [
  "cloud.linkwarden.app",
  "localhost",
  "127.0.0.1",
  "linkding",
  "linkwarden",
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

/** A host of the local network, where servers usually speak plain HTTP. */
function isLocal(host: string): boolean {
  return !host.includes(".") || ipv4(host) !== undefined || /\.(local|lan|home|home\.arpa|internal)$/.test(host);
}

/** `links.home.lan/bookmarks` or `…/api` → the server's address: http:// for a local host typed without a scheme. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    const host = url.split(/[/:]/)[0].toLowerCase();
    url = `${isLocal(host) ? "http" : "https"}://${url}`;
  }
  return url
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\/(api(\/v1)?|bookmarks|dashboard|links|collections|login|settings)$/i, "")
    .replace(/\/+$/, "");
}

/** A picture served by the server itself, when the extension may show it. */
export function allowedImage(url: string | undefined, base: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url, base);
    return isAllowedHost(u.hostname) ? u.href : undefined;
  } catch {
    return undefined;
  }
}
