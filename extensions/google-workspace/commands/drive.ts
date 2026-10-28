import { action, type Context, copy, Icons, type Item, list, open } from "@backslash/api";
import { type Client, guarded, signOutAction } from "../api.ts";
import {
  avatarOf,
  DRIVE,
  type DriveFile,
  driveMetadata,
  driveQuery,
  type DriveView,
  fileKind,
  fileUrl,
  FOLDER,
  folderUrl,
  formatSize,
  ownerName,
  ownerOf,
  plural,
  shortAgo,
} from "../lib.ts";

let summary = "";

function fileItem(api: Client, f: DriveFile, now: Date, section?: string): Item {
  const isFolder = f.mimeType === FOLDER || f.shortcutDetails?.targetMimeType === FOLDER;
  const kind = fileKind(f.shortcutDetails?.targetMimeType ?? f.mimeType);
  const modified = f.modifiedTime ? new Date(f.modifiedTime) : undefined;
  const owner = ownerOf(f);
  const url = fileUrl(f);
  return {
    id: f.id,
    title: f.name,
    subtitle: kind.label,
    icon: { source: kind.icon, tint: kind.tint },
    section,
    keywords: [ownerName(f), kind.label],
    accessories: [
      ...(f.starred ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Starred" }] : []),
      ...(f.shared ? [{ icon: Icons.person, tooltip: "Shared" }] : []),
      ...(f.size ? [{ text: formatSize(f.size) }] : []),
      ...(modified ? [{ text: shortAgo(modified, now), tooltip: `Modified ${modified.toLocaleString()}` }] : []),
      ...(owner && !owner.me ? [{ avatar: avatarOf(owner), tooltip: `Owner: ${ownerName(f)}` }] : []),
    ],
    detail: {
      stats: [
        { label: "Size", value: isFolder ? "—" : formatSize(f.size) },
        ...(modified ? [{ label: "Modified", value: shortAgo(modified, now) }] : []),
      ],
      metadata: driveMetadata(f, now),
    },
    actions: [
      ...(isFolder
        ? [
          action("Browse Folder", () => folderView(api, f.shortcutDetails?.targetId ?? f.id, f.name), {
            icon: Icons.folder,
          }),
          open(url, "Open in Google Drive"),
        ]
        : [open(url, "Open in Browser")]),
      ...(f.parents?.[0] && !isFolder
        ? [open(folderUrl(f.parents[0]), "Open Containing Folder", { icon: Icons.folder, shortcut: "<Ctrl><Shift>o" })]
        : []),
      copy(url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(f.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(`[${f.name}](${url})`, "Copy as Markdown Link", { section: "Copy" }),
    ],
  };
}

function folderView(api: Client, id: string, name: string) {
  return list({
    title: name,
    placeholder: `Filter ${name}…`,
    empty: { title: "Empty folder", icon: Icons.folder },
    status: (items) => `${plural(items.length, "item")} · ${name}`,
    actions: [open(folderUrl(id), "Open in Google Drive")],
    items: async ({ signal }) => {
      const res = await api.get<{ files: DriveFile[] }>(`${DRIVE}/files`, driveQuery("recent", "", id), signal);
      const now = new Date();
      return res.files.map((f) => fileItem(api, f, now, f.mimeType === FOLDER ? "Folders" : "Files"));
    },
  });
}

const VIEWS: Record<DriveView, string> = { recent: "Recent", starred: "Starred", shared: "Shared with me" };

export default (ctx: Context) =>
  list({
    placeholder: "Search Google Drive by name or content…",
    filter: {
      options: Object.entries(VIEWS).map(([value, title]) => ({ value, title })),
    },
    empty: { title: "No file found", description: "Drive searches names and content.", icon: Icons.search },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
    actions: [
      open("https://drive.google.com/drive/my-drive", "Open Google Drive", { icon: Icons.drive }),
      signOutAction(ctx.preferences, () => {}),
    ],
    search: (query, { signal, filter }) =>
      guarded(ctx.preferences, async (api) => {
        const view = (filter && filter in VIEWS ? filter : "recent") as DriveView;
        const q = query.trim();
        const res = await api.get<{ files: DriveFile[] }>(`${DRIVE}/files`, driveQuery(view, q), signal);
        summary = `${plural(res.files.length, "file")} · ${VIEWS[view]}${q ? ` · “${q}”` : ""}`;
        const now = new Date();
        return res.files.map((f) => fileItem(api, f, now));
      }),
  });
