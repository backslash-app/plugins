import {
  type Action,
  action,
  clipboard,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  openExternal,
  refresh,
  toast,
} from "@backslash/api";
import {
  download,
  listFolder,
  previews,
  publicLink,
  type Server,
  server,
  setFavorite,
  SetupError,
  setupItem,
} from "../api.ts";
import { ago, bytes, type DavEntry, fileGlyph, filesWebUrl, parentOf, plural, sortEntries } from "../lib.ts";

const tilde = (p: string) => p.replace(/^\/home\/[^/]+/, "~");

function entryItem(s: Server, e: DavEntry, preview?: string): Item {
  const glyph = fileGlyph(e);
  const metadata: Metadata[] = [
    meta.text("Path", e.path, { icon: Icons.folder }),
    meta.text("Size", bytes(e.size), { icon: Icons.archive }),
  ];
  if (e.modified) metadata.push(meta.text("Modified", ago(e.modified), { icon: Icons.clock }));
  if (e.mime && !e.folder) metadata.push(meta.text("Type", e.mime, { icon: Icons.file }));
  if (e.owner) metadata.push(meta.person("Owner", e.owner));
  if (e.shared) metadata.push(meta.tags("Sharing", [{ text: "Shared", color: "teal" }]));
  if (e.mount === "group" || e.mount === "external") {
    metadata.push(meta.tags("Storage", [e.mount === "group" ? "Group folder" : "External storage"]));
  }
  if (e.favorite) metadata.push(meta.text("Favorite", "Yes", { icon: Icons.starFilled, color: "yellow" }));

  const web = filesWebUrl(s.base, e);
  const actions: Action[] = [];
  if (e.folder) {
    actions.push(action("Open Folder", () => folderView(s, e.path), { icon: Icons.folder }));
    actions.push(open(web, "Open in Nextcloud", { icon: Icons.external }));
  } else {
    actions.push(open(web, "Open in Nextcloud", { icon: Icons.external }));
    actions.push(action("Download and Open", async () => {
      await toast(`Downloading ${e.name}…`);
      const path = await download(s, e);
      await openExternal(path);
    }, { icon: Icons.download, shortcut: "<Ctrl>o" }));
    actions.push(action("Download to Downloads", async () => {
      await toast(`Downloading ${e.name}…`);
      const path = await download(s, e);
      await toast(`Saved ${tilde(path)}`, { style: "success" });
    }, { icon: Icons.download, shortcut: "<Ctrl>d" }));
  }
  actions.push(
    action("Copy Public Link", async () => {
      const url = await publicLink(s, e.path);
      await clipboard.write(url);
      await toast("Public link copied", { style: "success", message: url });
    }, { icon: Icons.link, shortcut: "<Ctrl><Shift>c", section: "Share" }),
    copy(web, "Copy Internal Link", { section: "Share" }),
    action(e.favorite ? "Remove from Favorites" : "Add to Favorites", async () => {
      await setFavorite(s, e.path, !e.favorite);
      await toast(e.favorite ? "Removed from favorites" : "Added to favorites", { style: "success" });
      return refresh();
    }, { icon: e.favorite ? Icons.star : Icons.starFilled, shortcut: "<Ctrl>f", section: "Edit" }),
    copy(e.path, "Copy Path", { section: "Copy" }),
    copy(e.name, "Copy Name", { section: "Copy" }),
  );

  return {
    id: e.path,
    title: e.name,
    subtitle: e.folder ? undefined : e.mime?.split("/").pop(),
    icon: preview ?? glyph,
    section: e.folder ? "Folders" : "Files",
    keywords: [e.mime ?? "", e.owner ?? ""],
    accessories: [
      ...(e.favorite ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Favorite" }] : []),
      ...(e.shared ? [{ icon: { source: Icons.link, tint: "teal" as const }, tooltip: "Shared" }] : []),
      { text: bytes(e.size) },
      ...(e.modified ? [{ text: ago(e.modified), tooltip: new Date(e.modified).toLocaleString("en-GB") }] : []),
    ],
    detail: { image: preview, metadata },
    actions,
  };
}

function folderView(s: Server, path: string): ListSpec {
  let footer = "";
  return list({
    title: path === "/" ? "Nextcloud Files" : path.split("/").pop(),
    placeholder: `Filter ${path === "/" ? "your files" : path}…`,
    empty: { title: "This folder is empty", icon: Icons.folder },
    status: () => footer,
    actions: [
      open(filesWebUrl(s.base, { path, folder: true }), "Open Folder in Nextcloud", { icon: Icons.external }),
      ...(path !== "/"
        ? [action("Parent Folder", () => folderView(s, parentOf(path)), { icon: Icons.arrowUp, shortcut: "<Alt>Up" })]
        : []),
    ],
    async *items({ signal }: Context) {
      let entries: DavEntry[];
      try {
        entries = sortEntries(await listFolder(s, path, signal));
      } catch (e) {
        if (e instanceof SetupError) {
          yield [setupItem(e)];
          return;
        }
        throw e;
      }
      const folders = entries.filter((e) => e.folder).length;
      const total = entries.reduce((n, e) => n + e.size, 0);
      footer = [plural(folders, "folder"), plural(entries.length - folders, "file"), bytes(total)].join(" · ");
      yield entries.map((e) => entryItem(s, e));
      if (!entries.some((e) => e.hasPreview)) return;
      const pics = await previews(s, entries, { signal, deadline: 4000 });
      yield entries.map((e) => entryItem(s, e, pics.get(e.path)));
    },
  });
}

export default (ctx: Context) => {
  try {
    return folderView(server(ctx.preferences), "/");
  } catch (e) {
    if (e instanceof SetupError) return list({ items: [setupItem(e)] });
    throw e;
  }
};
