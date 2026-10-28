// Raindrop.io: token, response types and pure mapping (collections, covers, links).

import { type Color, Icons, type Item, meta, type Metadata, open } from "@backslash/api";

export const API = "https://api.raindrop.io/rest/v1";
export const TOKEN_URL = "https://app.raindrop.io/settings/integrations";
export const UNSORTED = -1;
export const TRASH = -99;

/** The token is missing or refused: the list shows how to connect. */
export class AuthError extends Error {}

export function tokenOf(prefs: Record<string, unknown>): string {
  const token = String(prefs.token ?? "").trim();
  if (!token) throw new AuthError("Connect your Raindrop.io account");
  return token;
}

export function raindropError(status: number, body: unknown): Error {
  const b = body as { errorMessage?: string; error?: string } | undefined;
  const message = b?.errorMessage ?? (typeof b?.error === "string" ? b.error : "");
  if (status === 401) return new AuthError("Raindrop.io rejected the token");
  if (status === 429) return new Error("Raindrop.io is rate limiting: try again in a minute");
  if (status === 404) return new Error("Not found on Raindrop.io: it may have been deleted");
  return new Error(`Raindrop.io answered ${status}${message ? `: ${message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Types (only the fields used)

export interface Collection {
  _id: number;
  title: string;
  count?: number;
  color?: string | null;
  parent?: { $id: number } | null;
  sort?: number;
}

export interface Raindrop {
  _id: number;
  title: string;
  excerpt?: string;
  note?: string;
  link: string;
  domain?: string;
  cover?: string;
  type?: string;
  tags?: string[];
  created?: string;
  lastUpdate?: string;
  important?: boolean;
  broken?: boolean;
  collection?: { $id: number };
  collectionId?: number;
  highlights?: { text: string }[];
}

// ---------------------------------------------------------------------------
// Collections

// A type, not an interface, so that it can be kept in storage as JSON.
export type Folder = {
  id: number;
  title: string;
  /** "Dev › Rust". */
  path: string;
  count: number;
  color: Color;
  root: boolean;
};

/** Roots and children as one list of paths, roots by Raindrop's order, children under their parent. */
export function folders(roots: Collection[], children: Collection[]): Folder[] {
  const byParent = new Map<number, Collection[]>();
  for (const c of children) {
    const p = c.parent?.$id;
    if (p === undefined) continue;
    byParent.set(p, [...(byParent.get(p) ?? []), c]);
  }
  const out: Folder[] = [];
  const walk = (c: Collection, prefix: string, depth: number) => {
    const path = prefix ? `${prefix} › ${c.title}` : c.title;
    out.push({ id: c._id, title: c.title, path, count: c.count ?? 0, color: colorOf(c.color), root: depth === 0 });
    if (depth > 5) return;
    for (const child of (byParent.get(c._id) ?? []).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) {
      walk(child, path, depth + 1);
    }
  };
  for (const r of [...roots].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))) walk(r, "", 0);
  return out;
}

export function collectionName(id: number | undefined, all: Folder[]): string {
  if (id === UNSORTED) return "Unsorted";
  if (id === TRASH) return "Trash";
  return all.find((f) => f.id === id)?.path ?? "Unknown collection";
}

/** The chips: all, unsorted, then the biggest top-level collections. */
export function filterOptions(all: Folder[], max = 6): { value: string; title: string }[] {
  const roots = all.filter((f) => f.root).sort((a, b) => b.count - a.count).slice(0, max);
  return [
    { value: "0", title: "All" },
    { value: String(UNSORTED), title: "Unsorted" },
    ...roots.map((f) => ({ value: String(f.id), title: f.title })),
  ];
}

/** The palette color closest to a `#rrggbb` color. */
export function colorOf(hex: string | null | undefined): Color {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return "blue";
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

// ---------------------------------------------------------------------------
// Bookmarks

export const collectionOf = (r: Raindrop) => r.collection?.$id ?? r.collectionId;

/**
 * Covers come from any site; Raindrop's proxy (rdl.ink) serves them all from
 * one host, resized. Covers already on rdl.ink are used as they are.
 */
export function coverUrl(cover: string | undefined, width = 640, height = 360): string | undefined {
  if (!cover || !/^https?:\/\//i.test(cover)) return undefined;
  if (/^https:\/\/rdl\.ink\//.test(cover)) return cover;
  return `https://rdl.ink/render/${encodeURIComponent(cover)}?mode=crop&width=${width}&height=${height}&dpr=2`;
}

export const TYPES: Record<string, { icon: string; tint: Color; name: string }> = {
  link: { icon: Icons.link, tint: "blue", name: "Link" },
  article: { icon: Icons.text, tint: "teal", name: "Article" },
  image: { icon: Icons.image, tint: "pink", name: "Image" },
  video: { icon: Icons.video, tint: "red", name: "Video" },
  document: { icon: Icons.file, tint: "orange", name: "Document" },
  audio: { icon: Icons.music, tint: "purple", name: "Audio" },
};

export const typeOf = (r: Raindrop) => TYPES[r.type ?? "link"] ?? TYPES.link;

export function domainOf(r: Raindrop): string {
  if (r.domain) return r.domain.replace(/^www\./, "");
  try {
    return new URL(r.link).host.replace(/^www\./, "");
  } catch {
    return r.link;
  }
}

/** A link typed or pasted in the search field: https://…, or a bare domain with a path. */
export function linkIn(query: string): string | undefined {
  const q = query.trim();
  if (!q || /\s/.test(q)) return undefined;
  const candidate = /^https?:\/\//i.test(q) ? q : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/\S*)?$/i.test(q) ? `https://${q}` : "";
  if (!candidate) return undefined;
  try {
    const url = new URL(candidate);
    return url.hostname.includes(".") ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** "a, #b  c" → ["a", "b", "c"]. */
export function parseTags(text: string): string[] {
  return [...new Set(text.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean))];
}

/** "today", "yesterday", "3d", "Oct 25", "Oct 2024". */
export function savedAgo(iso: string | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en", { month: "short", day: "numeric" });
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

export function bookmarkMarkdown(r: Raindrop): string | undefined {
  const parts: string[] = [];
  if (r.excerpt?.trim()) parts.push(r.excerpt.trim());
  if (r.note?.trim()) parts.push(r.note.trim().split("\n").map((l) => `> ${l}`).join("\n"));
  const hl = r.highlights ?? [];
  if (hl.length) {
    parts.push(
      `**Highlights**\n\n${hl.slice(0, 3).map((h) => `- “${h.text.trim().slice(0, 200)}”`).join("\n")}${
        hl.length > 3 ? `\n- …and ${hl.length - 3} more` : ""
      }`,
    );
  }
  return parts.join("\n\n") || undefined;
}

export function bookmarkMetadata(r: Raindrop, all: Folder[], now = new Date()): Metadata[] {
  const type = typeOf(r);
  const id = collectionOf(r);
  const folder = all.find((f) => f.id === id);
  const lines: Metadata[] = [
    meta.link("Link", domainOf(r), r.link),
    meta.text("Collection", collectionName(id, all), {
      icon: id === UNSORTED ? Icons.inbox : Icons.folder,
      color: folder?.color,
    }),
  ];
  if (r.tags?.length) lines.push(meta.tags("Tags", r.tags.map((t) => ({ text: `#${t}`, color: "blue" as Color }))));
  lines.push(meta.text("Type", type.name, { icon: type.icon }));
  if (r.important) lines.push(meta.text("Favorite", "Yes", { icon: Icons.heartFilled, color: "red" }));
  if (r.broken) lines.push(meta.text("Status", "Broken link", { icon: Icons.alert, color: "red" }));
  if (r.highlights?.length) lines.push(meta.text("Highlights", r.highlights.length, { icon: Icons.sparkle }));
  if (r.created) {
    lines.push(meta.separator(), meta.text("Saved", `${savedAgo(r.created, now)}`, { icon: Icons.clock }));
  }
  return lines;
}

export function setupItem(error: AuthError): Item {
  return {
    id: "setup",
    title: error.message,
    subtitle: "A test token from Raindrop.io",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Raindrop.io",
        "",
        "1. Open **app.raindrop.io → Settings → Integrations** (Enter opens it).",
        "2. Under **For Developers**, choose **Create new app** (any name, e.g. *Backslash*) and open it.",
        "3. Choose **Create test token** and copy it.",
        "4. Paste it in **Settings → Extensions → Raindrop.io → Configure → Test token**.",
        "",
        "A test token gives access to your own bookmarks only; delete the app to revoke it.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create Test Token", { icon: Icons.key })],
  };
}
