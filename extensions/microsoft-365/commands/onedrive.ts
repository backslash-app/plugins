import { action, type Context, copy, Icons, type Item, list, open } from "@backslash/api";
import { type Client, guarded, signOutAction } from "../api.ts";
import {
  DRIVE_FIELDS,
  type DriveItem,
  driveMetadata,
  drivePath,
  fileKind,
  flatten,
  formatSize,
  plural,
  searchPath,
  shortAgo,
} from "../lib.ts";

let count = 0;
let label = "";

function fileItem(api: Client, raw: DriveItem, section?: string): Item {
  const item = flatten(raw);
  const kind = fileKind(item);
  const now = new Date();
  const modified = item.lastModifiedDateTime ? new Date(item.lastModifiedDateTime) : undefined;
  const path = drivePath(item);
  return {
    id: item.id,
    title: item.name,
    subtitle: path,
    icon: { source: kind.icon, tint: kind.tint },
    section,
    keywords: [kind.label],
    accessories: [
      ...(item.shared ? [{ icon: Icons.person, tooltip: "Shared" }] : []),
      { text: item.folder ? plural(item.folder.childCount ?? 0, "item") : formatSize(item.size) },
      ...(modified ? [{ icon: Icons.clock, text: shortAgo(modified, now), tooltip: modified.toLocaleString() }] : []),
    ],
    detail: {
      stats: [
        item.folder
          ? { label: "Items", value: item.folder.childCount ?? 0 }
          : { label: "Size", value: formatSize(item.size) },
        ...(modified ? [{ label: "Modified", value: shortAgo(modified, now) }] : []),
      ],
      metadata: driveMetadata(item, now),
    },
    actions: [
      ...(item.folder
        ? [
          action("Browse Folder", () => folderView(api, item), { icon: Icons.folder }),
          open(item.webUrl, "Open in OneDrive"),
        ]
        : [open(item.webUrl, "Open in Browser")]),
      copy(item.webUrl, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(item.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(`${path === "OneDrive" ? "" : `${path}/`}${item.name}`, "Copy Path", { section: "Copy" }),
    ],
  };
}

function folderView(api: Client, folder: DriveItem) {
  const where = folder.parentReference?.driveId
    ? `/drives/${encodeURIComponent(folder.parentReference.driveId)}/items/${encodeURIComponent(folder.id)}`
    : `/me/drive/items/${encodeURIComponent(folder.id)}`;
  return list({
    title: folder.name,
    placeholder: `Filter ${folder.name}…`,
    empty: { title: "Empty folder", icon: Icons.folder },
    status: (items) => `${plural(items.length, "item")} · ${folder.name}`,
    actions: [open(folder.webUrl, "Open in OneDrive")],
    items: async ({ signal }) => {
      const res = await api.get<{ value: DriveItem[] }>(
        `${where}/children?$top=200&$orderby=name&$select=${DRIVE_FIELDS}`,
        { signal },
      );
      const sorted = [...res.value].sort((a, b) => Number(!!b.folder) - Number(!!a.folder));
      return sorted.map((i) => fileItem(api, i, i.folder ? "Folders" : "Files"));
    },
  });
}

/** OneDrive's recent files; accounts where the endpoint is gone get the last changed files at the root. */
async function recent(api: Client, signal: AbortSignal): Promise<DriveItem[]> {
  try {
    return (await api.get<{ value: DriveItem[] }>("/me/drive/recent?$top=25", { signal })).value;
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return (await api.get<{ value: DriveItem[] }>(
      `/me/drive/root/children?$top=25&$orderby=lastModifiedDateTime desc&$select=${DRIVE_FIELDS}`,
      { signal },
    )).value;
  }
}

export default (ctx: Context) =>
  list({
    placeholder: "Search OneDrive files by name or content…",
    empty: {
      title: "No file found",
      description: "Try another word: OneDrive searches names and content.",
      icon: Icons.search,
    },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : `${plural(count, "file")} · ${label}`,
    actions: [
      open("https://www.microsoft365.com/onedrive", "Open OneDrive", { icon: Icons.cloud }),
      signOutAction(ctx.preferences, () => {}),
    ],
    search: (query, { signal }) =>
      guarded(ctx.preferences, async (api) => {
        const q = query.trim();
        const files = q
          ? (await api.get<{ value: DriveItem[] }>(searchPath(q), { signal })).value
          : await recent(api, signal);
        count = files.length;
        label = q ? `“${q}”` : "recent";
        return files.map((f) => fileItem(api, f, q ? undefined : "Recent"));
      }),
  });
