// Joplin Data API (https://joplinapp.org/help/api/references/rest_api/)
// responses, links and text. Pure functions, no I/O.

export const BASE = "http://127.0.0.1:41184";
export const NOTE_FIELDS =
  "id,parent_id,title,body,created_time,updated_time,is_todo,todo_completed,todo_due,source_url,author";

export interface Note {
  id: string;
  parent_id: string;
  title: string;
  body?: string;
  created_time?: number;
  updated_time?: number;
  is_todo?: number;
  todo_completed?: number;
  todo_due?: number;
  source_url?: string;
  author?: string;
}

export interface Folder {
  id: string;
  title: string;
  parent_id: string;
}

export interface Tag {
  id: string;
  title: string;
}

export interface Page<T> {
  items: T[];
  has_more: boolean;
}

/** `/search?query=…`, with the token and fields. */
export function apiUrl(path: string, params: Record<string, string | number | undefined>, token: string): string {
  const url = new URL(path, BASE);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  url.searchParams.set("token", token);
  return url.toString();
}

/**
 * What is typed, as a Joplin search: the last word gets a `*` so results
 * come while typing (`proj` finds “project”), unless it is a filter
 * (`tag:x`), a quoted phrase or already ends with `*`.
 */
export function searchQuery(input: string): string {
  const q = input.trim().replace(/\s+/g, " ");
  if (!q) return "";
  const words = q.split(" ");
  const last = words[words.length - 1];
  if (/[:*"]/.test(last) || last.startsWith("-")) return q;
  words[words.length - 1] = `${last}*`;
  return words.join(" ");
}

/** Notebooks with their full path, `Work / Projects / Alpha`, in tree order. */
export function folderPaths(folders: Folder[]): { id: string; path: string; depth: number }[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path = (f: Folder, seen = new Set<string>()): string[] => {
    const parent = byId.get(f.parent_id);
    if (!parent || seen.has(parent.id)) return [f.title];
    seen.add(f.id);
    return [...path(parent, seen), f.title];
  };
  return folders
    .map((f) => {
      const p = path(f);
      return { id: f.id, path: p.join(" / "), depth: p.length - 1, parts: p };
    })
    .sort((a, b) => {
      for (let i = 0; i < Math.min(a.parts.length, b.parts.length); i++) {
        const c = a.parts[i].localeCompare(b.parts[i], undefined, { sensitivity: "base" });
        if (c) return c;
      }
      return a.parts.length - b.parts.length;
    })
    .map(({ id, path, depth }) => ({ id, path, depth }));
}

/** A notebook and every notebook inside it. */
export function descendants(folders: Folder[], root: string): Set<string> {
  const out = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of folders) {
      if (out.has(f.parent_id) && !out.has(f.id)) {
        out.add(f.id);
        grew = true;
      }
    }
  }
  return out;
}

export const openNoteUrl = (id: string) => `joplin://x-callback-url/openNote?id=${encodeURIComponent(id)}`;
export const openFolderUrl = (id: string) => `joplin://x-callback-url/openFolder?id=${encodeURIComponent(id)}`;

/** `[Title](:/id)`, the internal link Joplin itself copies. */
export function markdownLink(note: Pick<Note, "id" | "title">): string {
  const title = (note.title || "Untitled").replace(/([[\]\\])/g, "\\$1");
  return `[${title}](:/${note.id})`;
}

/**
 * The body for the preview panel: Joplin resources (`![](:/id)`) can't be
 * shown outside Joplin, so pictures become their caption and internal
 * links their text.
 */
export function previewBody(body: string, max = 4000): string {
  let text = body
    .replace(/!\[([^\]]*)\]\(:\/[0-9a-f]{32}\)/g, (_, alt) => `*[image${alt ? `: ${alt}` : ""}]*`)
    .replace(/<img[^>]*src=["']:\/[0-9a-f]{32}["'][^>]*>/gi, "*[image]*")
    .replace(/\[([^\]]*)\]\(:\/[0-9a-f]{32}(#[^)]*)?\)/g, "**$1**");
  if (text.length > max) text = `${text.slice(0, max).replace(/\s+\S*$/, "")}\n\n…`;
  return text.trim();
}

/** The first line of text, without markdown marks, for the subtitle. */
export function snippet(body: string | undefined, max = 90): string {
  for (const raw of (body ?? "").split("\n")) {
    const line = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/^\s*([-*+] \[[ x]\]|#+|[-*+]|\d+\.|>)\s*/i, "")
      .replace(/[*_`~]/g, "")
      .trim();
    if (line) return line.length > max ? `${line.slice(0, max - 1)}…` : line;
  }
  return "";
}

export function wordCount(text: string | undefined): number {
  return (text ?? "").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function ago(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.round(d / 30.4);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.round(d / 365)}y ago`;
}

export function when(ms: number | undefined): string {
  return ms ? new Date(ms).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }) : "";
}

export type TodoState = "note" | "open" | "done" | "overdue";

export function todoState(n: Note, now = Date.now()): TodoState {
  if (!n.is_todo) return "note";
  if (n.todo_completed) return "done";
  return n.todo_due && n.todo_due < now ? "overdue" : "open";
}

/** `work, ideas  #later` → `["work", "ideas", "later"]`; Joplin lowercases tags. */
export function parseTags(input: string): string[] {
  return [
    ...new Set(
      input.split(",").flatMap((t) => t.split(/\s+#/)).map((t) => t.trim().replace(/^#/, "").toLowerCase()).filter(
        Boolean,
      ),
    ),
  ];
}

/** Sorts recent notes, most recently updated first. */
export function byUpdated(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => (b.updated_time ?? 0) - (a.updated_time ?? 0));
}
