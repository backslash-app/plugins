import { action, type Context, Icons, type Item, list, open, updateCommandMetadata } from "@backslash/api";
import { basename, prettyName } from "../lib.ts";
import {
  backend,
  currentWallpaper,
  folders,
  knownThumbs,
  makeThumbs,
  type Prefs,
  tilde,
  wallpapers,
} from "../system.ts";
import { backendName, emptyFoldersItem, localItem, noBackendItem } from "../ui.ts";
import online from "./online.ts";

let shown = 0;
let tool = "";

export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  const first = folders(prefs)[0];
  return list({
    layout: "grid",
    columns: 4,
    placeholder: "Search wallpapers…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "mine", title: "My Wallpapers" },
        { value: "landscape", title: "Landscape" },
        { value: "portrait", title: "Portrait" },
        { value: "system", title: "System" },
      ],
      default: "all",
    },
    empty: { title: "No wallpapers", description: `Add pictures to ${tilde(first)}`, icon: Icons.image },
    actions: [
      action("Search Wallpapers Online", (c) => online(c), { icon: Icons.search, shortcut: "<Ctrl>f" }),
      open(first, "Open Wallpapers Folder", { icon: Icons.folder, shortcut: "<Ctrl><Shift>o" }),
    ],
    status: () => `${shown} wallpaper${shown === 1 ? "" : "s"}${tool ? ` · ${tool}` : ""}`,
    async *items({ filter, signal }) {
      const view = filter ?? "all";
      const withSystem = prefs.system !== false && (view === "all" || view === "system" || view === "landscape" ||
        view === "portrait");
      const [all, b, current] = await Promise.all([
        wallpapers(prefs, withSystem),
        backend(prefs),
        currentWallpaper(prefs),
      ]);
      tool = b ? backendName(b) : "";
      const list = all.filter((w) => {
        if (view === "mine") return !w.system;
        if (view === "system") return w.system;
        if (view === "landscape") return !w.width || w.width > w.height!;
        if (view === "portrait") return !!w.width && w.height! > w.width;
        return true;
      });
      shown = list.length;
      const extra: Item[] = [];
      if (!b) extra.push(await noBackendItem());
      if (!list.some((w) => !w.system) && view !== "system") extra.push(emptyFoldersItem(prefs));
      // The current one first.
      list.sort((a, c) => Number(c.path === current) - Number(a.path === current));
      const items = () => [...extra, ...list.map((w) => localItem(w, current, prefs, b))];
      const missing = await knownThumbs(list);
      yield items();
      updateCommandMetadata({ subtitle: current ? prettyName(basename(current)) : null }).catch(() => {});
      if (missing.length && (await makeThumbs(missing, signal))) yield items();
    },
  });
};
