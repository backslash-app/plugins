// Items, actions and the save form.

import {
  type Action,
  action,
  copy,
  detail,
  field,
  form,
  Icons,
  type Item,
  meta,
  open,
  refresh,
  replace,
  submenu,
  toast,
} from "@backslash/api";
import { raindrop, save } from "./api.ts";
import {
  bookmarkMarkdown,
  bookmarkMetadata,
  collectionName,
  collectionOf,
  coverUrl,
  domainOf,
  type Folder,
  parseTags,
  type Raindrop,
  savedAgo,
  typeOf,
  UNSORTED,
} from "./lib.ts";

export const appUrl = (r: Raindrop) => `https://app.raindrop.io/my/${collectionOf(r) ?? 0}/item/${r._id}/edit`;

async function update(token: string, r: Raindrop, body: Record<string, unknown>, message: string) {
  await raindrop(token, `/raindrop/${r._id}`, { method: "PUT", body });
  await toast(message, { style: "success" });
  return refresh();
}

export function bookmarkActions(token: string, r: Raindrop, all: Folder[]): Action[] {
  const here = collectionOf(r);
  return [
    open(r.link, "Open Link"),
    open(appUrl(r), "Open in Raindrop.io", { icon: Icons.bookmark, shortcut: "<Ctrl>o" }),
    action(
      r.important ? "Remove from Favorites" : "Add to Favorites",
      () =>
        update(token, r, { important: !r.important }, r.important ? "Removed from favorites" : "Added to favorites"),
      { icon: r.important ? Icons.heart : Icons.heartFilled, shortcut: "<Ctrl>f", section: "Bookmark" },
    ),
    submenu(
      "Move to Collection",
      [
        ...(here === UNSORTED ? [] : [{ id: UNSORTED, path: "Unsorted" }]),
        ...all.filter((f) => f.id !== here),
      ].map((f) =>
        action(f.path, () => update(token, r, { collection: { $id: f.id } }, `Moved to ${f.path}`), {
          icon: f.id === UNSORTED ? Icons.inbox : Icons.folder,
        })
      ),
      { icon: Icons.folder, shortcut: "<Ctrl>m", section: "Bookmark" },
    ),
    copy(r.link, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`[${r.title || domainOf(r)}](${r.link})`, "Copy as Markdown Link", { section: "Copy" }),
    copy(r.title || r.link, "Copy Title", { shortcut: "<Ctrl>period", section: "Copy" }),
    action("Delete Bookmark", async () => {
      await raindrop(token, `/raindrop/${r._id}`, { method: "DELETE" });
      await toast("Moved to Trash", { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Move “${r.title || domainOf(r)}” to the Trash?`,
      shortcut: "<Ctrl><Shift>Delete",
      section: "Danger",
    }),
  ];
}

export function bookmarkItem(token: string, r: Raindrop, all: Folder[], options: { showCollection: boolean }): Item {
  const type = typeOf(r);
  const id = collectionOf(r);
  const folder = all.find((f) => f.id === id);
  const tags = r.tags ?? [];
  return {
    id: String(r._id),
    title: r.title || domainOf(r),
    subtitle: domainOf(r),
    icon: { source: type.icon, tint: type.tint },
    keywords: [...tags, r.link, collectionName(id, all)],
    accessories: [
      ...(r.important ? [{ icon: { source: Icons.heartFilled, tint: "red" as const }, tooltip: "Favorite" }] : []),
      ...(r.broken ? [{ icon: { source: Icons.alert, tint: "red" as const }, tooltip: "Broken link" }] : []),
      ...tags.slice(0, 2).map((t) => ({ text: `#${t}`, color: "blue" as const })),
      ...(options.showCollection
        ? [{
          icon: { source: id === UNSORTED ? Icons.inbox : Icons.folder, tint: folder?.color ?? "gray" },
          text: collectionName(id, all).split(" › ").pop(),
          tooltip: collectionName(id, all),
        }]
        : []),
      ...(r.created ? [{ text: savedAgo(r.created), tooltip: "Saved" }] : []),
    ],
    detail: {
      image: coverUrl(r.cover),
      markdown: bookmarkMarkdown(r),
      metadata: bookmarkMetadata(r, all),
    },
    actions: bookmarkActions(token, r, all),
  };
}

function savedPage(r: Raindrop, all: Folder[]) {
  return detail({
    title: "Saved",
    markdown: `# ${r.title || domainOf(r)}\n\nSaved to **${collectionName(collectionOf(r), all)}**. ` +
      "Raindrop.io fills in the title, excerpt and cover in a moment.",
    metadata: [
      meta.link("Link", domainOf(r), r.link),
      meta.text("Collection", collectionName(collectionOf(r), all), { icon: Icons.folder }),
      ...(r.tags?.length ? [meta.tags("Tags", r.tags.map((t) => `#${t}`))] : []),
    ],
    status: "Bookmark saved",
    actions: [
      open(appUrl(r), "Open in Raindrop.io", { icon: Icons.bookmark }),
      open(r.link, "Open Link"),
      copy(r.link, "Copy Link", { shortcut: "<Ctrl><Shift>c" }),
    ],
  });
}

export function saveForm(token: string, link: string, all: Folder[], collection = UNSORTED) {
  return form({
    title: "Save to Raindrop.io",
    submitTitle: "Save Bookmark",
    fields: [
      field.text("link", "Link", { required: true, value: link }),
      field.text("title", "Title", { placeholder: "Leave empty: Raindrop.io reads it from the page" }),
      field.dropdown(
        "collection",
        "Collection",
        [{ value: String(UNSORTED), title: "Unsorted" }, ...all.map((f) => ({ value: String(f.id), title: f.path }))],
        { value: String(collection) },
      ),
      field.text("tags", "Tags", { placeholder: "reading, rust, design" }),
      field.textArea("note", "Note"),
    ],
    async submit(values) {
      const r = await save(token, {
        link: String(values.link).trim(),
        collection: Number(values.collection),
        title: String(values.title ?? "").trim() || undefined,
        tags: parseTags(String(values.tags ?? "")),
        note: String(values.note ?? "").trim() || undefined,
      });
      await toast("Saved to Raindrop.io", { style: "success" });
      // The search below doesn't reload on its own: show what was saved instead.
      return replace(savedPage(r, all));
    },
  });
}

/** The first row when the search field holds a link. */
export function saveItem(token: string, link: string, all: Folder[], collection: number, existing?: Raindrop): Item {
  const where = collectionName(collection, all);
  if (existing) {
    return {
      ...bookmarkItem(token, existing, all, { showCollection: true }),
      id: "save",
      section: "Already Saved",
    };
  }
  return {
    id: "save",
    title: `Save ${link.replace(/^https?:\/\//, "").replace(/\/$/, "")}`,
    subtitle: `to ${where}`,
    icon: { source: Icons.plus, tint: "green" },
    section: "Save",
    actions: [
      action("Save Bookmark", async () => {
        const r = await save(token, { link, collection });
        await toast(`Saved to ${collectionName(collectionOf(r) ?? collection, all)}`, { style: "success" });
        return refresh();
      }, { icon: Icons.bookmark }),
      action("Save with Details…", () => saveForm(token, link, all, collection), {
        icon: Icons.settings,
        shortcut: "<Ctrl>e",
      }),
      open(link, "Open Link"),
    ],
  };
}
