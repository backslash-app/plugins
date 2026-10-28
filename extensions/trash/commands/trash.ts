import {
  type Action,
  action,
  close,
  copy,
  exec,
  Icons,
  type Item,
  list,
  meta,
  open,
  openExternal,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  basename,
  daySection,
  dirname,
  formatBytes,
  type Kind,
  kindOf,
  looksLikeText,
  parseDirectorySizes,
  parseTrashInfo,
  previewable,
  restoredName,
  summary,
  textual,
  tilde,
  when,
} from "../lib.ts";

const HOME = (() => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
})();
const DATA = (() => {
  try {
    return Deno.env.get("XDG_DATA_HOME") || `${HOME}/.local/share`;
  } catch {
    return `${HOME}/.local/share`;
  }
})();
const TRASH = `${DATA}/Trash`;
const t = (p: string) => tilde(p, HOME);

interface Trashed {
  /** The name in Trash/files. */
  name: string;
  file: string;
  original: string;
  deleted?: Date;
  isDir: boolean;
  size: number;
  kind: Kind;
  /** Entries inside, for folders. */
  count?: number;
}

const ICONS: Record<Kind, { icon: string; tint: "blue" | "purple" | "pink" | "orange" | "teal" | "gray" | "green" }> = {
  folder: { icon: Icons.folder, tint: "blue" },
  image: { icon: Icons.image, tint: "purple" },
  video: { icon: Icons.film, tint: "pink" },
  audio: { icon: Icons.music, tint: "pink" },
  document: { icon: Icons.file, tint: "orange" },
  archive: { icon: Icons.archive, tint: "teal" },
  code: { icon: Icons.code, tint: "green" },
  text: { icon: Icons.text, tint: "gray" },
  file: { icon: Icons.file, tint: "gray" },
};

async function exists(p: string) {
  try {
    await Deno.lstat(p);
    return true;
  } catch {
    return false;
  }
}

async function folderSize(path: string): Promise<number> {
  const out = await exec("du", ["-s", "-b", path], { signal: AbortSignal.timeout(10000) }).catch(() => "");
  return Number(out.split("\t")[0]) || 0;
}

async function load(): Promise<Trashed[]> {
  const sizes = parseDirectorySizes(await Deno.readTextFile(`${TRASH}/directorysizes`).catch(() => ""));
  const out: Trashed[] = [];
  try {
    for await (const e of Deno.readDir(`${TRASH}/info`)) {
      if (!e.name.endsWith(".trashinfo")) continue;
      const name = e.name.slice(0, -".trashinfo".length);
      const info = parseTrashInfo(await Deno.readTextFile(`${TRASH}/info/${e.name}`).catch(() => ""));
      const file = `${TRASH}/files/${name}`;
      const st = await Deno.lstat(file).catch(() => undefined);
      if (!info || !st) continue;
      const isDir = st.isDirectory;
      out.push({
        name,
        file,
        original: info.path.startsWith("/") ? info.path : `${HOME}/${info.path}`,
        deleted: info.deleted ?? st.mtime ?? undefined,
        isDir,
        size: isDir ? sizes.get(name) ?? -1 : st.size,
        kind: kindOf(name, isDir),
      });
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  await Promise.all(
    out.filter((i) => i.isDir).map(async (i) => {
      if (i.size < 0) i.size = await folderSize(i.file);
      let n = 0;
      for await (const _ of Deno.readDir(i.file)) if (++n > 999) break;
      i.count = n;
    }),
  );
  return out.sort((a, b) => (b.deleted?.getTime() ?? 0) - (a.deleted?.getTime() ?? 0));
}

async function preview(i: Trashed): Promise<string | undefined> {
  if (i.isDir) {
    const names: string[] = [];
    for await (const e of Deno.readDir(i.file)) {
      names.push(`${e.isDirectory ? "▸" : "·"} ${e.name}${e.isDirectory ? "/" : ""}`);
      if (names.length >= 12) break;
    }
    return names.length ? "```\n" + names.join("\n") + "\n```" : "_Empty folder_";
  }
  if (!textual(i.kind) && i.kind !== "file") return undefined;
  if (i.size > 5_000_000) return undefined;
  const f = await Deno.open(i.file).catch(() => undefined);
  if (!f) return undefined;
  try {
    const buf = new Uint8Array(1500);
    const n = (await f.read(buf)) ?? 0;
    const head = buf.subarray(0, n);
    if (!looksLikeText(head)) return undefined;
    const text = new TextDecoder().decode(head).replace(/```/g, "ˋˋˋ");
    return "```\n" + text + (n === buf.length ? "\n…" : "") + "\n```";
  } finally {
    f.close();
  }
}

async function restore(i: Trashed): Promise<string> {
  let dest = i.original;
  if (await exists(dest)) dest = restoredName(dest);
  if (await exists(dest)) throw new Error(`${t(i.original)} already exists`);
  await exec("mkdir", ["-p", dirname(dest)]);
  await exec("mv", ["-n", "-T", i.file, dest]);
  if (await exists(i.file)) throw new Error("The item couldn't be moved back");
  await Deno.remove(`${TRASH}/info/${i.name}.trashinfo`).catch(() => {});
  return dest;
}

async function deleteForever(i: Trashed) {
  await Deno.remove(i.file, { recursive: true });
  await Deno.remove(`${TRASH}/info/${i.name}.trashinfo`).catch(() => {});
}

async function emptyTrash() {
  try {
    await exec("gio", ["trash", "--empty"]);
    return;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  // Without gio: the home trash only.
  for (const dir of ["files", "info"]) {
    for await (const e of Deno.readDir(`${TRASH}/${dir}`)) {
      await Deno.remove(`${TRASH}/${dir}/${e.name}`, { recursive: true }).catch(() => {});
    }
  }
  await Deno.remove(`${TRASH}/directorysizes`).catch(() => {});
}

function emptyAction(count: number, bytes: number): Action {
  return action("Empty Trash", async () => {
    await emptyTrash();
    updateCommandMetadata({ subtitle: "Empty" }).catch(() => {});
    await toast(`Trash emptied, ${formatBytes(bytes)} freed`, { style: "success" });
    return refresh();
  }, {
    icon: Icons.trash,
    destructive: true,
    section: "Danger",
    shortcut: "<Ctrl><Shift>Delete",
    confirm: `Delete ${count} item${count === 1 ? "" : "s"} (${formatBytes(bytes)}) for good?`,
  });
}

async function item(i: Trashed, count: number, total: number): Promise<Item> {
  const { icon, tint } = ICONS[i.kind];
  const where = dirname(i.original);
  const md = await preview(i).catch(() => undefined);
  const gone = !(await exists(where));
  return {
    id: i.name,
    title: basename(i.original),
    subtitle: t(where),
    icon: { source: icon, tint },
    section: daySection(i.deleted),
    keywords: [i.original, i.kind, i.name],
    accessories: [
      ...(i.isDir && i.count !== undefined
        ? [{ text: `${i.count} item${i.count === 1 ? "" : "s"}`, color: "gray" as const }]
        : []),
      { text: formatBytes(i.size) },
      { text: when(i.deleted), color: "gray" as const, tooltip: "Deleted" },
    ],
    detail: {
      image: previewable(i.name) ? i.file : undefined,
      stats: [
        { label: "Size", value: formatBytes(i.size) },
        ...(i.isDir && i.count !== undefined ? [{ label: "Items", value: i.count > 999 ? "999+" : i.count }] : []),
      ],
      markdown: md,
      metadata: [
        meta.text("Original location", t(where), { icon: Icons.folder }),
        ...(gone
          ? [meta.text("Note", "That folder is gone: restoring recreates it", { icon: Icons.info, color: "orange" })]
          : []),
        meta.text("Deleted", i.deleted ? i.deleted.toLocaleString("en-GB") : "Unknown", { icon: Icons.clock }),
        meta.tags("Kind", [{ text: i.kind, color: tint }]),
        meta.separator(),
        meta.progress("Of the trash", total ? i.size / total : 0),
      ],
    },
    actions: [
      action("Restore", async () => {
        const dest = await restore(i);
        await toast(`Restored to ${t(dest)}`, { style: "success" });
        return refresh();
      }, { icon: Icons.history }),
      open(i.file, i.isDir ? "Open Folder" : "Open", { icon: Icons.external, shortcut: "<Ctrl>o" }),
      action("Restore and Show", async () => {
        const dest = await restore(i);
        await toast(`Restored to ${t(dest)}`, { style: "success" });
        await openExternal(dirname(dest));
        return close();
      }, { icon: Icons.folder, shortcut: "<Ctrl>Return" }),
      copy(i.original, "Copy Original Path", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      copy(i.file, "Copy Path in Trash", { section: "Copy" }),
      action("Delete Forever", async () => {
        await deleteForever(i);
        await toast(`${basename(i.original)} deleted`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.cross,
        destructive: true,
        section: "Danger",
        shortcut: "<Ctrl>Delete",
        confirm: `Delete ${basename(i.original)} (${formatBytes(i.size)}) for good? This can't be undone.`,
      }),
      emptyAction(count, total),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
    ],
  };
}

let status = "";

export default list({
  placeholder: "Filter the trash by name or original folder…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "files", title: "Files" },
      { value: "folders", title: "Folders" },
      { value: "images", title: "Pictures & Videos" },
    ],
  },
  empty: { title: "The trash is empty", description: "Deleted files land here until you empty it", icon: Icons.trash },
  status: () => status,
  actions: [open("trash:///", "Open Trash in File Manager", { icon: Icons.folder })],
  async items({ filter }) {
    const all = await load();
    const total = all.reduce((s, i) => s + Math.max(0, i.size), 0);
    status = summary(all.length, total) +
      (all.length ? ` · oldest ${daySection(all.at(-1)?.deleted).toLowerCase()}` : "");
    updateCommandMetadata({ subtitle: summary(all.length, total) }).catch(() => {});
    const f = filter ?? "all";
    const shown = all.filter((i) =>
      f === "all" || (f === "folders" ? i.isDir : f === "files" ? !i.isDir : i.kind === "image" || i.kind === "video")
    );
    return await Promise.all(shown.map((i) => item(i, all.length, total)));
  },
});
