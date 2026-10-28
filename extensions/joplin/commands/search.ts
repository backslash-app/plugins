import { action, type Context, Icons, type Item, list, refresh } from "@backslash/api";
import {
  byUpdated,
  descendants,
  type Folder,
  folderPaths,
  type Note,
  NOTE_FIELDS,
  type Page,
  searchQuery,
} from "../lib.ts";
import {
  type Client,
  connect,
  loadFolders,
  noteForm,
  noteItem,
  noteTags,
  OfflineError,
  setupItems,
  TokenError,
} from "../joplin.ts";

let footer = "";

export default async (ctx: Context) => {
  let client: Client;
  let folders: Folder[];
  try {
    client = await connect(ctx, ctx.signal);
    folders = await loadFolders(client, ctx.signal);
  } catch (e) {
    if (!(e instanceof OfflineError || e instanceof TokenError)) throw e;
    return list({
      items: setupItems(e),
      status: "Joplin Data API · 127.0.0.1:41184",
      actions: [action("Try Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    });
  }
  const c = client;
  const paths = folderPaths(folders);
  const pathOf = new Map(paths.map((p) => [p.id, p.path]));
  const top = paths.filter((p) => p.depth === 0);
  return list({
    placeholder: "Search Joplin notes…",
    filter: top.length > 1
      ? {
        options: [
          { value: "all", title: "All Notebooks" },
          ...top.slice(0, 12).map((p) => ({ value: p.id, title: p.path })),
        ],
      }
      : undefined,
    empty: { title: "No matching note", description: "Press Ctrl+N to create one", icon: Icons.note },
    status: () => footer,
    actions: [
      action("New Note", () => noteForm(c, { title: ctx.query }), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
    async search(query, { filter, signal }) {
      const q = searchQuery(query);
      const inside = filter && filter !== "all" ? descendants(folders, filter) : undefined;
      const params = { fields: NOTE_FIELDS, limit: 100 };
      const page = q
        ? await c.get<Page<Note>>("/search", { ...params, query: q, type: "note" }, signal)
        : await c.get<Page<Note>>("/notes", { ...params, order_by: "updated_time", order_dir: "DESC" }, signal);
      let notes = page.items.filter((n) => !inside || inside.has(n.parent_id));
      if (!q) notes = byUpdated(notes);
      notes = notes.slice(0, 40);
      const tags = await Promise.all(notes.map((n) => noteTags(c, n.id, signal)));
      const where = inside ? pathOf.get(filter!) : undefined;
      footer = q
        ? `${notes.length}${page.has_more ? "+" : ""} note${notes.length === 1 ? "" : "s"}${
          where ? ` in ${where}` : ""
        }`
        : `Recently updated${where ? ` in ${where}` : ""} · ${paths.length} notebooks`;
      const items: Item[] = notes.map((n, i) =>
        noteItem(c, { note: n, notebook: pathOf.get(n.parent_id), tags: tags[i] }, q ? "Notes" : "Recently Updated")
      );
      if (q) {
        items.push({
          id: "create",
          title: `Create “${query.trim()}”`,
          subtitle: `New note${where ? ` in ${where}` : ""}`,
          icon: { source: Icons.plus, tint: "green" },
          section: "Create",
          actions: [
            action("New Note", () => noteForm(c, { title: query.trim(), folder: inside ? filter : undefined }), {
              icon: Icons.plus,
            }),
          ],
        });
      }
      return items;
    },
  });
};
