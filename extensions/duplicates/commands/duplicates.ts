import {
  type Action,
  action,
  close,
  type Color,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import {
  baseName,
  dirName,
  type FileInfo,
  formatDate,
  formatSize,
  type Group,
  groupMarkdown,
  type Keep,
  parseSize,
  plural,
  relativeTo,
  split,
  trashPlan,
  whereSummary,
  without,
} from "../lib.ts";
import {
  expandHome,
  findDuplicates,
  hashProgram,
  HOME,
  type Progress,
  showInFolder,
  stillThere,
  tilde,
  trash,
  walk,
} from "../system.ts";

interface Scan {
  root: string;
  options: string;
  groups: Group[];
  files: number;
  at: number;
}

/** The last scan, reused when the list refreshes after trashing (files are checked again). */
let last: Scan | undefined;
let status = "";

const sizeColor = (bytes: number): Color => bytes >= 1024 ** 3 ? "red" : bytes >= 100 * 1024 ** 2 ? "orange" : "yellow";

function forget(paths: string[]) {
  if (!last) return;
  const gone = new Set(paths);
  last.groups = last.groups.flatMap((g) => without(g, gone) ?? []);
}

async function trashFiles(files: FileInfo[]): Promise<string> {
  await trash(files.map((f) => f.path));
  forget(files.map((f) => f.path));
  const bytes = files.reduce((s, f) => s + f.size, 0);
  return `${plural(files.length, "file")} moved to the trash, ${formatSize(bytes)} freed`;
}

function keepAction(g: Group, keep: Keep, o: { shortcut?: string; section?: string } = {}): Action {
  const { keep: k, trash: others } = split(g, keep);
  return action(`Keep ${keep === "newest" ? "Newest" : "Oldest"}, Trash Others`, async () => {
    await toast(await trashFiles(others), { style: "success" });
    return refresh();
  }, {
    icon: Icons.trash,
    destructive: true,
    confirm: `Keep ${baseName(k.path)} from ${formatDate(k.mtime)} and move the ${others.length} other ${
      others.length === 1 ? "copy" : "copies"
    } to the trash?`,
    ...o,
  });
}

function fileRow(g: Group, f: FileInfo, root: string): Item {
  const i = g.files.indexOf(f);
  const others = g.files.filter((x) => x !== f);
  return {
    id: f.path,
    title: baseName(f.path),
    subtitle: relativeTo(root, dirName(f.path), HOME) || tilde(root),
    icon: { source: Icons.file, tint: i === 0 ? "green" : "gray" },
    keywords: f.path.split("/"),
    accessories: [
      ...(i === 0 ? [{ tag: "newest", color: "green" as Color }] : []),
      ...(i === g.files.length - 1 ? [{ tag: "oldest", color: "gray" as Color }] : []),
      { text: formatDate(f.mtime), icon: Icons.clock },
    ],
    detail: {
      image: /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.path) ? f.path : undefined,
      metadata: [
        meta.text("Path", tilde(f.path), { icon: Icons.file }),
        meta.text("Modified", formatDate(f.mtime), { icon: Icons.clock }),
        meta.text("Size", formatSize(f.size)),
        meta.text("Copies", g.files.length),
      ],
    },
    actions: [
      action("Keep Only This One", async () => {
        await toast(await trashFiles(others), { style: "success" });
        return pop();
      }, {
        icon: Icons.check,
        destructive: true,
        confirm: `Keep this copy and move the ${plural(others.length, "other")} to the trash?`,
      }),
      open(f.path, "Open File", { shortcut: "<Ctrl>o" }),
      action("Show in Folder", async () => {
        await showInFolder(f.path);
        return close();
      }, { icon: Icons.folder, shortcut: "<Ctrl><Shift>o" }),
      copy(f.path, "Copy Path", { shortcut: "<Ctrl><Shift>c" }),
      action("Move This Copy to Trash", async () => {
        await toast(await trashFiles([f]), { style: "success" });
        return g.files.length > 2 ? refresh() : pop();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Move ${baseName(f.path)} to the trash?`,
        shortcut: "<Ctrl>Delete",
      }),
    ],
  };
}

function groupView(g: Group, root: string): ListSpec {
  return list({
    title: `${baseName(g.files[0].path)} — ${g.files.length} copies`,
    placeholder: "Pick the copy to keep…",
    empty: { title: "No copies left", icon: Icons.check },
    items() {
      const current = last?.groups.find((x) => x.hash === g.hash && x.size === g.size) ?? g;
      return current.files.map((f) => fileRow(current, f, root));
    },
  });
}

function groupRow(g: Group, root: string): Item {
  const newest = g.files[0];
  const image = /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(newest.path);
  return {
    id: `${g.size}:${g.hash}`,
    title: baseName(newest.path),
    subtitle: whereSummary(g, root, HOME),
    icon: { source: image ? Icons.image : Icons.copy, tint: sizeColor(g.wasted) },
    keywords: g.files.flatMap((f) => [baseName(f.path), ...relativeTo(root, f.path, HOME).split("/")]),
    accessories: [
      { text: `${g.files.length} copies`, icon: Icons.layers },
      { tag: formatSize(g.wasted), color: sizeColor(g.wasted), tooltip: "Freed by keeping one copy" },
    ],
    detail: {
      image: image ? newest.path : undefined,
      stats: [
        { label: "Copies", value: g.files.length },
        { label: "Each", value: formatSize(g.size) },
        { label: "Wasted", value: formatSize(g.wasted), color: sizeColor(g.wasted) },
      ],
      markdown: groupMarkdown(g, root, HOME),
      metadata: [meta.text("Hash", `${g.hash.slice(0, 16)}…`, { icon: Icons.hash })],
    },
    actions: [
      keepAction(g, "newest"),
      keepAction(g, "oldest"),
      action("Choose Which to Keep", () => groupView(g, root), { icon: Icons.layers, shortcut: "<Ctrl>l" }),
      open(newest.path, "Open Newest", { shortcut: "<Ctrl>o", section: "Files" }),
      action("Show Newest in Folder", async () => {
        await showInFolder(newest.path);
        return close();
      }, { icon: Icons.folder, shortcut: "<Ctrl><Shift>o", section: "Files" }),
      copy(g.files.map((f) => f.path).join("\n"), "Copy Paths", { shortcut: "<Ctrl><Shift>c", section: "Files" }),
    ],
  };
}

function bulkActions(groups: Group[]): Action[] {
  if (!groups.length) return [];
  return (["newest", "oldest"] as Keep[]).map((keep) => {
    const plan = trashPlan(groups, keep);
    return action(`Keep ${keep === "newest" ? "Newest" : "Oldest"} in Every Group`, async () => {
      await toast(await trashFiles(plan.files), { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Move ${plural(plan.files.length, "file")} (${
        formatSize(plan.bytes)
      }) to the trash, keeping the ${keep} copy of each?`,
      section: "All Groups",
    });
  });
}

/** Waits for `work`, yielding an empty update twice a second so the footer shows the progress. */
async function* ticking<T>(work: Promise<T>): AsyncGenerator<Item[], T> {
  let done = false;
  work.then(() => done = true, () => done = true);
  while (!done) {
    await Promise.race([work.catch(() => {}), new Promise((r) => setTimeout(r, 500))]);
    if (!done) yield [];
  }
  return await work;
}

const progressText = (root: string, p: Progress) =>
  p.phase === "walk"
    ? `Looking through ${tilde(root)}… ${p.done.toLocaleString("en")} files`
    : `Comparing ${p.done.toLocaleString("en")} of ${(p.total ?? 0).toLocaleString("en")} files…`;

export default list({
  placeholder: "Filter duplicates by name or folder…",
  empty: {
    title: "No duplicates",
    description: "Every file here is unique. Try another folder, or a smaller minimum size in the preferences",
    icon: Icons.check,
  },
  status: () => status,
  actions: [
    action("Scan Again", () => {
      last = undefined;
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ],
  async *items({ args, preferences, signal }) {
    const root = expandHome(String(args.folder || preferences.folder || "~"));
    const minSize = parseSize(String(preferences.minSize ?? "1 MB") || "0");
    const hidden = preferences.hidden === true;
    const options = `${minSize}:${hidden}`;

    if (last && last.root === root && last.options === options && Date.now() - last.at < 15 * 60_000) {
      const gone = await stillThere(last.groups.flatMap((g) => g.files));
      last.groups = last.groups.flatMap((g) => without(g, gone) ?? []);
    } else {
      const files = yield* ticking(
        walk(root, { minSize, hidden, signal, progress: (p) => status = progressText(root, p) }),
      );
      status = `Comparing ${files.length.toLocaleString("en")} files…`;
      const groups = yield* ticking(findDuplicates(files, { signal, progress: (p) => status = progressText(root, p) }));
      if (signal.aborted) return;
      last = { root, options, groups, files: files.length, at: Date.now() };
    }

    const groups = last.groups;
    const wasted = groups.reduce((s, g) => s + g.wasted, 0);
    status = groups.length
      ? `${plural(groups.length, "group")} · ${formatSize(wasted)} to free in ${tilde(root)}${
        hashProgram() ? ` · ${hashProgram()}` : ""
      }`
      : `${last.files.toLocaleString("en")} files of ${formatSize(minSize)} or more in ${tilde(root)}, all unique`;
    const bulk = bulkActions(groups);
    yield groups.map((g) => {
      const row = groupRow(g, root);
      row.actions = [...row.actions!, ...bulk];
      return row;
    });
  },
});
