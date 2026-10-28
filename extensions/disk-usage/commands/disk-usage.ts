import {
  type Action,
  action,
  type Context,
  copy,
  exec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  refresh,
  storage,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  ago,
  bar,
  basename,
  type BigFile,
  biggest,
  cacheOwner,
  childrenOf,
  type ContainerUsage,
  type Disk,
  type Entry,
  formatBytes,
  packageCache,
  parseDuLine,
  rootSize,
  safeCache,
  shareColor,
  tilde,
  topFolders,
} from "../lib.ts";
import {
  bigFiles,
  containers,
  disk,
  du,
  emptyFolder,
  family,
  HOME,
  installed,
  inTerminal,
  journalSize,
  showInFolder,
  sizeOf,
  stream as streamLines,
  trash,
} from "../system.ts";

interface Prefs {
  terminal?: string;
  timeout?: number;
  minFileMb?: number;
}

interface Extras {
  trash?: number;
  journal?: number;
  docker?: ContainerUsage[];
  podman?: ContainerUsage[];
  pkg?: { name: string; path: string; clean: string[]; size?: number };
  flatpak?: number;
}

interface Saved {
  at: number;
  entries: [string, number][];
  files: [string, number, number][];
}

const CACHE = `${HOME}/.cache`;
const t = (p: string) => tilde(p, HOME);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function shareMeta(size: number, d?: Disk): Metadata[] {
  return d
    ? [meta.progress("Of the disk", size / d.size, `${((size / d.size) * 100).toFixed(1)} % of ${formatBytes(d.size)}`)]
    : [];
}

function terminalAction(title: string, argv: string[], prefs: Prefs, o: { icon?: string; confirm?: string } = {}) {
  return action(title, async () => {
    const term = inTerminal(argv, prefs.terminal);
    await toast(`Opened in ${term}`, { message: argv.join(" ") });
  }, { icon: o.icon ?? Icons.terminal, confirm: o.confirm, section: "Clean Up" });
}

function fileActions(path: string, isDir: boolean, prefs: Prefs): Action[] {
  return [
    open(path, isDir ? "Open Folder" : "Open", { icon: isDir ? Icons.folder : Icons.external }),
    ...(isDir
      ? [
        action("Show Contents by Size", () => folderView(path, prefs), {
          icon: Icons.chartDown,
          shortcut: "<Ctrl>Return",
        }),
      ]
      : []),
    action("Show in Folder", async () => {
      await showInFolder(path);
    }, { icon: Icons.folder, shortcut: "<Ctrl>f" }),
    copy(path, "Copy Path", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    action("Move to Trash", async () => {
      await trash(path);
      await toast(`${basename(path)} moved to the trash`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      section: "Danger",
      shortcut: "<Ctrl>Delete",
      confirm: `Move ${t(path)} to the trash?`,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Drilling into a folder

function folderView(root: string, prefs: Prefs): ListSpec {
  let status = "Scanning…";
  return list({
    title: t(root),
    placeholder: `Filter ${t(root)}…`,
    status: () => status,
    empty: { title: "Empty folder", icon: Icons.folder },
    async *items({ signal }) {
      const d = await disk(root);
      const found: Entry[] = [];
      const stop = AbortSignal.any([signal, AbortSignal.timeout((prefs.timeout || 60) * 1000)]);
      let finished = false;
      const scan = stream(root, stop, (e) => found.push(e)).then(() => (finished = true));
      const render = async () => {
        const total = rootSize(found, root);
        const kids = found.filter((e) => e.path !== root).sort((a, b) => b.size - a.size).slice(0, 80);
        status = `${finished ? "" : "Scanning… "}${formatBytes(total)} in ${plural(kids.length, "item")}${
          finished && stop.aborted && !signal.aborted ? " · stopped at the time limit" : ""
        }`;
        return await Promise.all(kids.map(async (e) => {
          const isDir = (await Deno.stat(e.path).catch(() => undefined))?.isDirectory ?? false;
          const ratio = total ? e.size / total : 0;
          return {
            id: e.path,
            title: basename(e.path),
            icon: { source: isDir ? Icons.folder : Icons.file, tint: shareColor(ratio) },
            keywords: [e.path],
            accessories: [{ text: `${Math.round(ratio * 100)} %`, color: "gray" as const }, {
              text: formatBytes(e.size),
            }],
            detail: {
              stats: [{ label: "Size", value: formatBytes(e.size), color: shareColor(ratio) }, {
                label: `Of ${basename(root)}`,
                value: `${Math.round(ratio * 100)} %`,
              }],
              metadata: [
                meta.progress(`Of ${basename(root)}`, ratio),
                ...shareMeta(e.size, d),
                meta.text("Path", t(e.path), { icon: isDir ? Icons.folder : Icons.file }),
              ],
            },
            actions: fileActions(e.path, isDir, prefs),
          } satisfies Item;
        }));
      };
      while (!finished) {
        await Promise.race([scan, new Promise((r) => setTimeout(r, 700))]);
        yield await render();
      }
    },
  });
}

/** `du -a -d 1`: the files and folders right inside. */
function stream(root: string, signal: AbortSignal, onEntry: (e: Entry) => void) {
  return streamLines("du", ["-x", "-a", "-d", "1", "-b", root], signal, (l) => {
    const e = parseDuLine(l);
    if (e) onEntry(e);
  });
}

// ---------------------------------------------------------------------------
// Overview

function diskItem(d: Disk | undefined, home: number, scanning: boolean, savedAt?: number): Item {
  const ratio = d ? d.used / d.size : 0;
  return {
    id: "disk",
    title: d ? `${formatBytes(d.available)} free` : "Home folder",
    subtitle: d ? `of ${formatBytes(d.size)} on ${d.mount}` : undefined,
    icon: { source: Icons.drive, tint: ratio > 0.9 ? "red" : ratio > 0.75 ? "orange" : "green" },
    section: "Disk",
    keywords: ["disk", "disque", "free", "libre", "space", "espace"],
    accessories: [{ text: `${Math.round(ratio * 100)} % used`, color: ratio > 0.9 ? "red" : undefined }],
    detail: {
      stats: d
        ? [
          {
            label: "Used",
            value: formatBytes(d.used),
            color: ratio > 0.9 ? "red" : ratio > 0.75 ? "orange" : undefined,
          },
          { label: "Free", value: formatBytes(d.available), color: "green" },
          { label: "Total", value: formatBytes(d.size) },
        ]
        : [],
      metadata: [
        ...(d ? [meta.progress("Disk used", ratio, `${formatBytes(d.used)} · ${Math.round(ratio * 100)} %`)] : []),
        ...(home ? [meta.progress("Home folder", d ? home / d.size : 0, formatBytes(home))] : []),
        meta.separator(),
        meta.text("Mount point", d?.mount ?? "?", { icon: Icons.drive }),
        meta.text("Home", t(HOME) || HOME, { icon: Icons.home }),
        meta.text("Scan", scanning ? "In progress…" : savedAt ? `Saved ${ago(savedAt)}` : "Done", {
          icon: scanning ? Icons.hourglass : Icons.check,
        }),
      ],
    },
    actions: [
      action("Rescan", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      open(HOME, "Open Home Folder", { icon: Icons.home }),
    ],
  };
}

function folderItem(e: Entry, entries: Entry[], d: Disk | undefined, home: number, prefs: Prefs): Item {
  const ratio = d ? e.size / d.size : 0;
  const kids = childrenOf(entries, e.path);
  const md = kids.length
    ? `**Biggest inside**\n\n${
      kids.map((k) => `\`${bar(e.size ? k.size / e.size : 0, 12)}\` ${formatBytes(k.size)} · ${basename(k.path)}`).join(
        "\n\n",
      )
    }`
    : undefined;
  return {
    id: `folder:${e.path}`,
    title: basename(e.path),
    subtitle: t(e.path),
    icon: { source: Icons.folder, tint: shareColor(ratio) },
    section: "Biggest Folders",
    keywords: [e.path, "folder", "dossier"],
    accessories: [
      { text: `${home ? Math.round((e.size / home) * 100) : 0} %`, color: "gray", tooltip: "Of your home folder" },
      { text: formatBytes(e.size) },
    ],
    detail: {
      stats: [
        { label: "Size", value: formatBytes(e.size), color: shareColor(ratio) },
        { label: "Of home", value: `${home ? Math.round((e.size / home) * 100) : 0} %` },
      ],
      markdown: md,
      metadata: [
        ...shareMeta(e.size, d),
        ...(home ? [meta.progress("Of home", e.size / home)] : []),
        meta.text("Path", t(e.path), { icon: Icons.folder }),
      ],
    },
    actions: fileActions(e.path, true, prefs).filter((a) => a.title !== "Move to Trash"),
  };
}

function fileItem(f: BigFile, d: Disk | undefined, prefs: Prefs): Item {
  const ratio = d ? f.size / d.size : 0;
  return {
    id: `file:${f.path}`,
    title: basename(f.path),
    subtitle: t(f.path.split("/").slice(0, -1).join("/")),
    icon: { source: Icons.file, tint: shareColor(ratio) },
    section: "Biggest Files",
    keywords: [f.path, "file", "fichier"],
    accessories: [{ text: ago(f.modified), color: "gray" }, { text: formatBytes(f.size) }],
    detail: {
      stats: [{ label: "Size", value: formatBytes(f.size), color: shareColor(ratio) }, {
        label: "Modified",
        value: ago(f.modified),
      }],
      metadata: [
        ...shareMeta(f.size, d),
        meta.text("Path", t(f.path), { icon: Icons.file }),
        meta.text("Modified", new Date(f.modified).toLocaleString(), { icon: Icons.clock }),
      ],
    },
    actions: fileActions(f.path, false, prefs),
  };
}

function cacheItem(e: Entry, d: Disk | undefined, prefs: Prefs): Item {
  const name = basename(e.path);
  const owner = cacheOwner(name);
  const safe = safeCache(name);
  return {
    id: `cache:${e.path}`,
    title: name,
    subtitle: owner,
    icon: { source: Icons.archive, tint: safe ? "teal" : "orange" },
    section: "Caches",
    keywords: ["cache", e.path, owner ?? ""],
    accessories: [
      ...(safe ? [] : [{ tag: "Re-download", color: "orange" as const }]),
      { text: formatBytes(e.size) },
    ],
    detail: {
      stats: [{ label: "Size", value: formatBytes(e.size) }],
      markdown: safe
        ? "Apps rebuild their cache as needed. Emptying it frees the space now; the app may be slower the first time."
        : "This folder holds downloads (models, browsers) that take long to get back.",
      metadata: [
        ...shareMeta(e.size, d),
        meta.text("Path", t(e.path), { icon: Icons.folder }),
        ...(owner ? [meta.text("Used by", owner, { icon: Icons.apps })] : []),
      ],
    },
    actions: [
      action(`Empty ${name}`, async () => {
        await emptyFolder(e.path);
        await toast(`Freed about ${formatBytes(e.size)}`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete everything in ${t(e.path)} (${formatBytes(e.size)})? Close ${owner ?? "the app"} first.`,
      }),
      action("Show Contents by Size", () => folderView(e.path, prefs), {
        icon: Icons.chartDown,
        shortcut: "<Ctrl>Return",
      }),
      open(e.path, "Open Folder", { icon: Icons.folder }),
      copy(e.path, "Copy Path", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

function cleanupItems(x: Extras, caches: Entry[], d: Disk | undefined, prefs: Prefs): Item[] {
  const out: Item[] = [];
  const cleanup = (
    id: string,
    title: string,
    size: number | undefined,
    icon: string,
    md: string,
    actions: Action[],
    extra: Metadata[] = [],
  ): Item => ({
    id: `cleanup:${id}`,
    title,
    subtitle: size === undefined ? "Measuring…" : undefined,
    icon: { source: icon, tint: size && size > 1024 ** 3 ? "orange" : "teal" },
    section: "Clean Up",
    keywords: ["clean", "nettoyer", "free", "libérer", id],
    accessories: size === undefined ? [] : [{ text: formatBytes(size) }],
    detail: {
      stats: size === undefined ? [] : [{ label: "Size", value: formatBytes(size) }],
      markdown: md,
      metadata: [...(size ? shareMeta(size, d) : []), ...extra],
    },
    actions,
  });

  out.push(cleanup(
    "trash",
    "Trash",
    x.trash,
    Icons.trash,
    "Files you deleted are kept here until you empty it.",
    [
      action("Empty Trash", async () => {
        await exec("gio", ["trash", "--empty"]);
        await toast("Trash emptied", { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete everything in the trash for good${x.trash ? ` (${formatBytes(x.trash)})` : ""}?`,
      }),
      open("trash:///", "Open Trash", { icon: Icons.folder }),
    ],
  ));

  const cacheTotal = caches.reduce((s, c) => s + c.size, 0);
  const safe = caches.filter((c) => safeCache(basename(c.path)));
  out.push(cleanup(
    "cache",
    "App Caches",
    caches.length ? cacheTotal : undefined,
    Icons.archive,
    `**${plural(caches.length, "folder")}** in \`~/.cache\`. Emptying them is safe: apps rebuild what they need.`,
    [
      action("Empty All Caches", async () => {
        for (const c of safe) await emptyFolder(c.path);
        await toast(`Freed about ${formatBytes(safe.reduce((s, c) => s + c.size, 0))}`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Empty ${plural(safe.length, "cache folder")} (${
          formatBytes(safe.reduce((s, c) => s + c.size, 0))
        })? Close your apps first.`,
      }),
      open(CACHE, "Open ~/.cache", { icon: Icons.folder }),
    ],
    [meta.tags("Biggest", caches.slice(0, 5).map((c) => basename(c.path)))],
  ));

  if (x.journal !== undefined) {
    out.push(cleanup(
      "journal",
      "System Journal",
      x.journal,
      Icons.book,
      "Logs kept by systemd. Vacuuming removes the oldest ones; it asks for your password in a terminal.",
      [
        terminalAction("Vacuum to 200 MB", ["sudo", "journalctl", "--vacuum-size=200M"], prefs),
        submenu(
          "Vacuum…",
          [
            terminalAction("Keep 100 MB", ["sudo", "journalctl", "--vacuum-size=100M"], prefs),
            terminalAction("Keep 500 MB", ["sudo", "journalctl", "--vacuum-size=500M"], prefs),
            terminalAction("Keep 2 Weeks", ["sudo", "journalctl", "--vacuum-time=2weeks"], prefs),
            terminalAction("Keep 1 Month", ["sudo", "journalctl", "--vacuum-time=1month"], prefs),
          ],
          { icon: Icons.terminal, section: "Clean Up" },
        ),
      ],
    ));
  }

  for (const tool of ["docker", "podman"] as const) {
    const usage = x[tool];
    if (!usage) continue;
    const size = usage.reduce((s, u) => s + u.size, 0);
    const reclaim = usage.reduce((s, u) => s + u.reclaimable, 0);
    out.push(cleanup(
      tool,
      tool === "docker" ? "Docker" : "Podman",
      size,
      Icons.box,
      `**${
        formatBytes(reclaim)
      }** can be reclaimed: stopped containers, unused networks, dangling images and build cache.`,
      [
        terminalAction("Prune Unused Data", [tool, "system", "prune"], prefs, { icon: Icons.trash }),
        terminalAction("Prune Everything Unused, Images Included", [tool, "system", "prune", "-a"], prefs, {
          icon: Icons.trash,
        }),
      ],
      usage.map((u) =>
        meta.text(
          u.type,
          `${formatBytes(u.size)} · ${u.total} (${u.active} active) · ${formatBytes(u.reclaimable)} reclaimable`,
          {
            icon: Icons.layers,
          },
        )
      ),
    ));
  }

  if (x.pkg) {
    out.push(cleanup(
      "packages",
      x.pkg.name,
      x.pkg.size,
      Icons.package,
      `Downloaded packages kept in \`${x.pkg.path}\` after installing. Cleaning asks for your password in a terminal.`,
      [terminalAction(`Clean ${x.pkg.name}`, x.pkg.clean, prefs, { icon: Icons.trash })],
      [meta.text("Command", x.pkg.clean.join(" "), { icon: Icons.terminal })],
    ));
  }

  if (x.flatpak !== undefined) {
    out.push(cleanup(
      "flatpak",
      "Unused Flatpak Runtimes",
      x.flatpak,
      Icons.layers,
      "Flatpak keeps runtimes after the apps that needed them are gone. The terminal lists them before removing anything.",
      [terminalAction("Remove Unused Runtimes", ["flatpak", "uninstall", "--unused"], prefs, { icon: Icons.trash })],
      [meta.text("Size", "All of Flatpak, apps included", { icon: Icons.info })],
    ));
  }
  return out;
}

let status = "";

export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  return list({
    placeholder: "Filter folders, files and caches…",
    filter: {
      options: [
        { value: "all", title: "Overview" },
        { value: "folders", title: "Folders" },
        { value: "files", title: "Files" },
        { value: "cleanup", title: "Clean Up" },
      ],
    },
    empty: { title: "Nothing here yet", description: "Still scanning, or nothing big enough", icon: Icons.drive },
    status: () => status,
    async *items({ signal, filter }) {
      const f = filter ?? "all";
      const fam = await family();
      const [d, saved] = await Promise.all([
        disk(HOME),
        (storage.get("scan") as Promise<unknown>).then((v) => v as Saved | undefined).catch(() => undefined),
      ]);
      const entries = new Map<string, number>();
      const files: BigFile[] = [];
      const x: Extras = {};
      let scanning = true;
      let savedAt: number | undefined;

      if (saved && saved.entries?.length) {
        for (const [p, s] of saved.entries) entries.set(p, s);
        for (const [p, s, m] of saved.files ?? []) files.push({ path: p, size: s, modified: m });
        savedAt = saved.at;
      }

      const render = (): Item[] => {
        const list = [...entries].map(([path, size]) => ({ path, size }));
        const home = rootSize(list, HOME);
        const caches = childrenOf(list, CACHE, 40).filter((c) => c.size >= 1024);
        const out: Item[] = [];
        if (f === "all") out.push(diskItem(d, home, scanning, savedAt));
        if (f === "all" || f === "cleanup") out.push(...cleanupItems(x, caches, d, prefs));
        if (f === "all" || f === "folders") {
          out.push(...topFolders(list, HOME, f === "all" ? 12 : 40).map((e) => folderItem(e, list, d, home, prefs)));
        }
        if (f === "all" || f === "files") {
          out.push(...biggest(files, f === "all" ? 12 : 50).map((b) => fileItem(b, d, prefs)));
        }
        if (f === "cleanup" || f === "folders") out.push(...caches.map((c) => cacheItem(c, d, prefs)));
        status = `${scanning ? (savedAt ? `Last scan ${ago(savedAt)}, rescanning… ` : "Scanning… ") : ""}${
          home ? `Home ${formatBytes(home)}` : ""
        }${d ? ` · ${formatBytes(d.available)} free of ${formatBytes(d.size)}` : ""}`;
        return out;
      };
      yield render();

      // The scan replaces what was saved.
      const stop = AbortSignal.any([signal, AbortSignal.timeout((prefs.timeout || 60) * 1000)]);
      const fresh = new Map<string, number>();
      const freshFiles: BigFile[] = [];
      let first = true;
      const swap = () => {
        // Keep the saved results on screen until the scan has something to show.
        if (first && !fresh.size && !freshFiles.length) return;
        first = false;
        savedAt = undefined;
        entries.clear();
        for (const [p, s] of fresh) entries.set(p, s);
        files.splice(0, files.length, ...freshFiles);
      };
      const pkg = packageCache(fam);
      const jobs = [
        du(HOME, 2, stop, (e) => fresh.set(e.path, e.size)),
        bigFiles(HOME, prefs.minFileMb || 100, stop, (b) => freshFiles.push(b)),
        sizeOf(`${HOME}/.local/share/Trash`).then((s) => (x.trash = s ?? 0)),
        journalSize().then((s) => (x.journal = s)),
        containers("docker").then((u) => (x.docker = u)),
        containers("podman").then((u) => (x.podman = u)),
        ...(pkg ? [sizeOf(pkg.path).then((s) => (x.pkg = s === undefined ? undefined : { ...pkg, size: s }))] : []),
        installed("flatpak").then(async (yes) => {
          if (!yes) return;
          const [sys, user] = await Promise.all([sizeOf("/var/lib/flatpak"), sizeOf(`${HOME}/.local/share/flatpak`)]);
          x.flatpak = (sys ?? 0) + (user ?? 0);
        }),
      ].map((p) => p.catch(() => {}));
      const all = Promise.all(jobs);
      let done = false;
      all.then(() => (done = true));
      while (!done && !signal.aborted) {
        await Promise.race([all, new Promise((r) => setTimeout(r, 800))]);
        swap();
        if (!done) yield render();
      }
      if (signal.aborted) return;
      scanning = false;
      swap();
      const final = render();
      const partial = stop.aborted;
      if (partial) status += " · stopped at the time limit";
      yield final;
      const homeSize = fresh.get(HOME);
      if (homeSize !== undefined || fresh.size) {
        updateCommandMetadata({
          subtitle: d ? `${formatBytes(d.available)} free` : homeSize ? `Home ${formatBytes(homeSize)}` : null,
        }).catch(() => {});
      }
      // Saved for next time: the top-level folders, their children, and the big files.
      const keep = [...fresh].sort((a, b) => b[1] - a[1]).slice(0, 400);
      await storage.set("scan", {
        at: Date.now(),
        entries: keep,
        files: biggest(freshFiles, 60).map((b) => [b.path, b.size, b.modified]),
      }).catch(() => {});
    },
  });
};
