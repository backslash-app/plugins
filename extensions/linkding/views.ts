// Rows, actions and the save form.

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
  type Metadata,
  open,
  refresh,
  replace,
  toast,
} from "@backslash/api";
import type { Collection, Service } from "./api.ts";
import {
  allowedImage,
  type Bookmark,
  bookmarkMarkdown,
  domainOf,
  type NewBookmark,
  parseTags,
  savedAgo,
  SetupError,
} from "./lib.ts";

export function setupItems(e: SetupError): Item[] {
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Linkding & Linkwarden",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your bookmarks",
        "",
        "Set **Service** to `linkding` or `linkwarden` (or leave it empty for Linkding), then:",
        "",
        "- **Linkding**: the **Server address** and the **REST API token** shown in",
        "  **Settings → Integrations**.",
        "- **Linkwarden**: the **Server address** (empty for cloud.linkwarden.app) and an",
        "  **access token** from **Settings → Access Tokens → New Access Token**.",
        "",
        "Self-hosted servers can be on this computer, your local network (`*.lan`, `*.local`, `192.168.x.x`…)",
        "or Tailscale (`*.ts.net`): an extension declares in advance the hosts it may reach.",
      ].join("\n"),
    },
    actions: [open("https://linkding.link/api/", "Open Linkding API Docs", { icon: Icons.book })],
  }];
}

function metadata(s: Service, b: Bookmark): Metadata[] {
  return [
    meta.link("Link", domainOf(b.url) || b.url, b.url),
    ...(b.tags.length ? [meta.tags("Tags", b.tags.map((t) => ({ text: `#${t}`, color: "blue" as const })))] : []),
    ...(b.collection?.name ? [meta.text("Collection", b.collection.name, { icon: Icons.folder })] : []),
    meta.text("Saved", `${new Date(b.created).toLocaleDateString("en-GB")} (${savedAgo(b.created)})`, {
      icon: Icons.calendar,
    }),
    ...(b.archived ? [meta.text("State", "Archived", { icon: Icons.archive })] : []),
    ...(b.unread ? [meta.text("State", "Unread", { icon: Icons.inbox, color: "blue" })] : []),
    ...(b.pinned ? [meta.text("Pinned", "Yes", { icon: Icons.pin, color: "orange" })] : []),
    ...(b.shared ? [meta.text("Shared", "Yes", { icon: Icons.globe })] : []),
    meta.separator(),
    meta.link(s.name, "Open in web interface", s.webUrl(b)),
    ...(s.copyUrl(b) ? [meta.link("Copy", s.id === "linkding" ? "Web archive" : "Readable", s.copyUrl(b)!)] : []),
  ];
}

export function bookmarkActions(s: Service, b: Bookmark): Action[] {
  const copyUrl = s.copyUrl(b);
  return [
    open(b.url, "Open Link"),
    copy(b.url, "Copy Link"),
    open(s.webUrl(b), `Open in ${s.name}`, { icon: Icons.bookmark, shortcut: "<Ctrl>o", section: "Bookmark" }),
    ...(copyUrl
      ? [open(copyUrl, s.id === "linkding" ? "Open Web Archive Snapshot" : "Open Readable Copy", {
        icon: Icons.book,
        shortcut: "<Ctrl><Shift>o",
        section: "Bookmark",
      })]
      : []),
    ...(s.canArchive
      ? [action(b.archived ? "Unarchive" : "Archive", async () => {
        await s.setArchived(b, !b.archived);
        await toast(b.archived ? "Back in your bookmarks" : "Archived", { style: "success", message: b.title });
        return refresh();
      }, { icon: b.archived ? Icons.inbox : Icons.archive, shortcut: "<Ctrl>e", section: "Bookmark" })]
      : []),
    copy(`[${b.title.replace(/[[\]]/g, "")}](${b.url})`, "Copy as Markdown Link", {
      shortcut: "<Ctrl><Shift>m",
      section: "Copy",
    }),
    copy(b.title, "Copy Title", { shortcut: "<Ctrl>period", section: "Copy" }),
    ...(b.tags.length ? [copy(b.tags.map((t) => `#${t}`).join(" "), "Copy Tags", { section: "Copy" })] : []),
    action("Delete Bookmark", async () => {
      await s.remove(b);
      await toast("Deleted", { style: "success", message: b.title });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete “${b.title}” from ${s.name}? This can't be undone.`,
      shortcut: "<Ctrl><Shift>Delete",
      section: "Danger",
    }),
  ];
}

export function bookmarkItem(s: Service, b: Bookmark): Item {
  const favicon = allowedImage(b.favicon, s.base);
  return {
    id: b.id,
    title: b.title,
    subtitle: b.description ? b.description.split("\n")[0].slice(0, 90) : domainOf(b.url),
    icon: favicon ??
      (b.pinned
        ? { source: Icons.pin, tint: "orange" }
        : { source: b.archived ? Icons.archive : Icons.bookmark, tint: b.unread ? "blue" : "gray" }),
    keywords: [...b.tags, b.url, b.collection?.name ?? "", b.notes ?? ""].filter(Boolean),
    accessories: [
      ...(b.unread ? [{ icon: { source: Icons.dot, tint: "blue" as const }, tooltip: "Unread" }] : []),
      ...b.tags.slice(0, 3).map((t) => ({ text: `#${t}`, color: "blue" as const })),
      ...(b.collection?.name
        ? [{ icon: Icons.folder, text: b.collection.name.split(" › ").pop(), tooltip: b.collection.name }]
        : []),
      { text: savedAgo(b.created), tooltip: `Saved ${new Date(b.created).toLocaleString("en-GB")}` },
    ],
    detail: {
      image: allowedImage(b.preview, s.base),
      markdown: bookmarkMarkdown(b),
      metadata: metadata(s, b),
    },
    actions: bookmarkActions(s, b),
  };
}

function savedPage(s: Service, b: Bookmark) {
  return detail({
    title: "Saved",
    markdown: `# ${b.title}\n\nSaved to **${s.name}**${b.collection?.name ? ` in ${b.collection.name}` : ""}.`,
    metadata: metadata(s, b),
    status: "Bookmark saved",
    actions: [
      open(s.webUrl(b), `Open in ${s.name}`, { icon: Icons.bookmark }),
      open(b.url, "Open Link"),
      copy(b.url, "Copy Link", { shortcut: "<Ctrl><Shift>c" }),
    ],
  });
}

/** Saves, or says it was already there. */
export async function saveOnce(s: Service, b: NewBookmark): Promise<{ bookmark: Bookmark; existed: boolean }> {
  const existing = await s.find(b.url).catch(() => undefined);
  if (existing) return { bookmark: existing, existed: true };
  return { bookmark: await s.save(b), existed: false };
}

export function saveForm(s: Service, url: string, collections: Collection[]) {
  return form({
    title: `Save to ${s.name}`,
    submitTitle: "Save Bookmark",
    fields: [
      field.text("url", "Link", { required: true, value: url }),
      field.text("title", "Title", { placeholder: `Leave empty: ${s.name} reads it from the page` }),
      field.textArea("description", "Description"),
      field.text("tags", "Tags", {
        placeholder: s.id === "linkding" ? "reading rust design" : "reading, rust, design",
      }),
      ...(collections.length
        ? [field.dropdown("collection", "Collection", [
          { value: "", title: "Unorganized" },
          ...collections.map((c) => ({ value: c.id, title: c.name })),
        ], { value: "" })]
        : []),
      ...(s.id === "linkding" ? [field.checkbox("unread", "Mark as unread (to read later)", { value: false })] : []),
    ],
    async submit(values) {
      const { bookmark, existed } = await saveOnce(s, {
        url: String(values.url).trim(),
        title: String(values.title ?? "").trim() || undefined,
        description: String(values.description ?? "").trim() || undefined,
        tags: parseTags(String(values.tags ?? ""), s.id === "linkwarden"),
        collectionId: String(values.collection ?? "") || undefined,
        unread: values.unread === true,
      });
      await toast(existed ? `Already in ${s.name}` : `Saved to ${s.name}`, { style: "success" });
      return replace(savedPage(s, bookmark));
    },
  });
}

/** The first row when the search field holds a link. */
export function saveItem(s: Service, url: string, collections: Collection[], existing?: Bookmark): Item {
  if (existing) return { ...bookmarkItem(s, existing), id: "save", section: "Already Saved" };
  return {
    id: "save",
    title: `Save ${url.replace(/^https?:\/\//, "").replace(/\/$/, "")}`,
    subtitle: `to ${s.name}`,
    icon: { source: Icons.plus, tint: "green" },
    section: "Save",
    actions: [
      action("Save Bookmark", async () => {
        await s.save({ url });
        await toast(`Saved to ${s.name}`, { style: "success" });
        return refresh();
      }, { icon: Icons.bookmark }),
      action("Save with Details…", () => saveForm(s, url, collections), { icon: Icons.settings, shortcut: "<Ctrl>e" }),
      open(url, "Open Link"),
    ],
  };
}
