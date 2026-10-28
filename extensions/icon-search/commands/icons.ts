import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import { CACHE, clearCache, loadSet, NotFound, pool, svgText, viewFile } from "../api.ts";
import {
  cleanSvg,
  dataUri,
  fileUrl,
  type Icon,
  label,
  materialHtml,
  pageUrl,
  react,
  search,
  type SetId,
  setOf,
  SETS,
  svgPath,
  variants,
} from "../lib.ts";

const LIMIT = 64;

/** Copies an SVG fetched when the action runs (it is usually cached already). */
const copySvg = (icon: Icon, title: string, path?: string, o: { shortcut?: string; section?: string } = {}) =>
  action(title, async () => {
    try {
      await clipboard.write(cleanSvg(await svgText(icon, path)));
    } catch (e) {
      if (e instanceof NotFound) throw new Error(`${icon.name} has no such style`);
      throw e;
    }
    return close(`Copied ${icon.name}.svg`);
  }, { icon: Icons.code, ...o });

function iconActions(icon: Icon): Action[] {
  const set = setOf(icon.set)!;
  const r = react(icon);
  const styles = variants(icon);
  return [
    copySvg(icon, "Copy SVG"),
    copy(icon.name, "Copy Name", { icon: Icons.text }),
    ...(r
      ? [
        copy(r.importLine, "Copy React Import", { icon: Icons.braces, shortcut: "<Ctrl>i", section: "Code" }),
        copy(`<${r.component} />`, "Copy JSX", { icon: Icons.braces, shortcut: "<Ctrl>j", section: "Code" }),
      ]
      : [
        copy(materialHtml(icon.name), "Copy HTML", { icon: Icons.braces, shortcut: "<Ctrl>j", section: "Code" }),
      ]),
    action("Copy as Data URI", async () => {
      await clipboard.write(dataUri(await svgText(icon)));
      return close("Copied the data URI");
    }, { icon: Icons.link, shortcut: "<Ctrl>u", section: "Code" }),
    ...(styles.length > 1
      ? [submenu(
        "Copy Style…",
        styles.map(([title, path]) => copySvg(icon, `${title} SVG`, path)),
        { icon: Icons.layers, shortcut: "<Ctrl>s", section: "Code" },
      )]
      : []),
    copy(fileUrl(set, svgPath(icon)), "Copy CDN URL", { icon: Icons.globe, section: "Code" }),
    ...(icon.hex
      ? [
        copy(icon.hex, "Copy Brand Color", { icon: Icons.palette, shortcut: "<Ctrl>h", section: "Code" }),
      ]
      : []),
    open(pageUrl(icon), `Open on ${new URL(pageUrl(icon)).host.replace(/^www\./, "")}`, {
      shortcut: "<Ctrl>o",
      section: "Links",
    }),
    action("Clear Icon Cache", async () => {
      await clearCache();
      await toast("Icon cache cleared", { style: "success", message: "Indexes download again on the next search" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: "Delete the downloaded indexes and SVG files?",
      section: "Cache",
    }),
  ];
}

function iconItem(icon: Icon, file: string | undefined, section?: string): Item {
  const set = setOf(icon.set)!;
  const r = react(icon);
  return {
    id: `${icon.set}:${icon.name}`,
    title: label(icon),
    subtitle: set.title,
    icon: file ?? { source: Icons.image, tint: set.tint },
    section,
    keywords: [icon.name, ...icon.tags.slice(0, 12)],
    detail: {
      ...(file ? { image: file } : {}),
      metadata: [
        meta.text("Name", icon.name, { icon: Icons.tag }),
        meta.tags("Set", [{ text: set.title, color: set.tint }]),
        ...(icon.category ? [meta.text("Category", icon.category, { icon: Icons.folder })] : []),
        ...(icon.hex ? [meta.text("Brand color", icon.hex, { icon: `color:${icon.hex}` })] : []),
        ...(icon.tags.length ? [meta.tags("Tags", icon.tags.slice(0, 10))] : []),
        ...(r ? [meta.text("React", r.component, { icon: Icons.braces })] : []),
        meta.separator(),
        meta.text("License", set.license, { icon: Icons.shield }),
        meta.link("Page", new URL(pageUrl(icon)).host, pageUrl(icon)),
      ],
    },
    actions: iconActions(icon),
  };
}

let last = "";

export default list({
  layout: "grid",
  columns: 8,
  placeholder: "Search icons: camera, arrow right, github…",
  filter: {
    options: [{ value: "all", title: "All" }, ...SETS.map((s) => ({ value: s.id, title: s.title }))],
    default: "lucide",
  },
  empty: { title: "No icon found", description: "Try another word, or All with Tab.", icon: Icons.image },
  status: () => last,
  actions: [open(CACHE, "Open Icon Cache Folder", { icon: Icons.folder })],
  async search(query, { filter, signal }) {
    const ids: SetId[] = filter && filter !== "all" ? [filter as SetId] : SETS.map((s) => s.id);
    const loaded = await Promise.all(ids.map((id) =>
      loadSet(id, signal).then((icons) => ({ id, icons }), (error) => {
        if (signal.aborted) throw error;
        return { id, icons: [] as Icon[], error: error instanceof Error ? error.message : String(error) };
      })
    ));
    const failed = loaded.filter((l) => "error" in l);
    const all = loaded.flatMap((l) => l.icons);
    if (!all.length && failed.length) {
      last = "Offline";
      return [{
        id: "error",
        title: "Icons can't be downloaded",
        subtitle: (failed[0] as { error: string }).error,
        icon: { source: Icons.wifiOff, tint: "red" },
        detail: { markdown: "Indexes and SVG files come from **cdn.jsdelivr.net** and are cached for a week." },
        actions: [action("Try Again", () => refresh(), { icon: Icons.refresh })],
      }];
    }
    const single = ids.length === 1;
    // With every set, the best few of each, so one big set doesn't hide the others.
    const per = single ? LIMIT : Math.ceil(LIMIT / ids.length);
    const found = query.trim()
      ? loaded.flatMap((l) => search(l.icons, query, per))
      : loaded.flatMap((l) => l.icons.slice(0, per));
    const files = await pool(found, 12, (icon) => viewFile(icon, signal));
    const count = all.length.toLocaleString("en");
    last = `${query.trim() ? `${found.length}${found.length === LIMIT ? "+" : ""} of ` : ""}${count} icons${
      single ? ` · ${setOf(ids[0])!.title}` : ""
    }${failed.length ? ` · ${failed.map((f) => setOf(f.id)!.title).join(", ")} unavailable` : ""}`;
    return found.map((icon, i) => iconItem(icon, files[i], single ? undefined : setOf(icon.set)!.title));
  },
});
