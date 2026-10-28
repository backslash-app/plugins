import {
  type Action,
  action,
  clipboard,
  type Color,
  copy,
  exec,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  openExternal,
  pop,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  checkName,
  extTag,
  fileUri,
  formatBytes,
  freeName,
  hostOf,
  type Kind,
  KIND_TITLES,
  kindOf,
  matchesFilter,
  parseGetfattr,
  parseUserDirs,
  previewable,
  section,
  tilde,
  when,
  XDG_TITLES,
  type XdgDir,
} from "../lib.ts";

const env = (k: string) => {
  try {
    return Deno.env.get(k) || undefined;
  } catch {
    return undefined;
  }
};
const HOME = env("HOME") ?? "";
const t = (p: string) => tilde(p, HOME);

interface Download {
  name: string;
  path: string;
  size: number;
  modified: Date;
  kind: Kind;
  isDir: boolean;
  url?: string;
  referrer?: string;
}

const ICONS: Record<Kind, { icon: string; tint: Color }> = {
  image: { icon: Icons.image, tint: "purple" },
  video: { icon: Icons.film, tint: "pink" },
  audio: { icon: Icons.music, tint: "pink" },
  document: { icon: Icons.file, tint: "orange" },
  archive: { icon: Icons.archive, tint: "teal" },
  installer: { icon: Icons.package, tint: "green" },
  code: { icon: Icons.code, tint: "blue" },
  folder: { icon: Icons.folder, tint: "blue" },
  partial: { icon: Icons.download, tint: "yellow" },
  other: { icon: Icons.file, tint: "gray" },
};

/** Things that changed the folder from here: the list reloads at once. */
const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

/** The XDG folders; the usual English names where user-dirs.dirs says nothing and they exist. */
async function folders(): Promise<Partial<Record<XdgDir, string>>> {
  const dirs = parseUserDirs(await Deno.readTextFile(`${HOME}/.config/user-dirs.dirs`).catch(() => ""), HOME);
  for (const key of Object.keys(XDG_TITLES) as XdgDir[]) {
    const fallback = `${HOME}/${XDG_TITLES[key]}`;
    if (!dirs[key] && (key === "DOWNLOAD" || await exists(fallback))) dirs[key] = fallback;
  }
  return dirs;
}

let getfattrMissing = false;

/** Where files came from, as browsers record it (`user.xdg.origin.url`), in one getfattr call. */
async function origins(paths: string[]): Promise<Map<string, Record<string, string>>> {
  if (!paths.length || getfattrMissing) return new Map();
  try {
    const out = await exec("getfattr", ["--absolute-names", "-d", "-m", "^user\\.xdg\\.", ...paths], {
      signal: AbortSignal.timeout(5000),
    }).catch((e) => {
      if (e instanceof Deno.errors.NotFound) throw e;
      // Non-zero when one file has no attribute support; the rest is still printed.
      return String(e?.message ?? "");
    });
    return parseGetfattr(out);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) getfattrMissing = true;
    return new Map();
  }
}

async function load(dir: string): Promise<Download[]> {
  const out: Download[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (e.name.startsWith(".")) continue;
      const path = `${dir}/${e.name}`;
      const st = await Deno.stat(path).catch(() => undefined);
      if (!st) continue;
      out.push({
        name: e.name,
        path,
        size: st.size,
        modified: st.mtime ?? new Date(0),
        kind: kindOf(e.name, st.isDirectory),
        isDir: st.isDirectory,
      });
    }
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
  out.sort((a, b) => b.modified.getTime() - a.modified.getTime());
  const recent = out.slice(0, 250);
  const attrs = await origins(recent.filter((d) => !d.isDir).slice(0, 120).map((d) => d.path));
  for (const d of recent) {
    const a = attrs.get(d.path);
    d.url = a?.["user.xdg.origin.url"];
    d.referrer = a?.["user.xdg.referrer.url"];
  }
  return recent;
}

async function pipe(program: string, args: string[], input: string): Promise<boolean> {
  try {
    const child = new Deno.Command(program, { args, stdin: "piped", stdout: "null", stderr: "null" }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(input));
    await w.close();
    // wl-copy and xclip stay in the background to serve the clipboard.
    const done = await Promise.race([
      child.status.then((s) => s.success),
      new Promise((r) => setTimeout(r, 400, true)),
    ]);
    return Boolean(done);
  } catch {
    return false;
  }
}

/** Puts the file on the clipboard as a file (text/uri-list), so a file manager or chat app pastes the file. */
async function copyFile(path: string): Promise<boolean> {
  const uri = `${fileUri(path)}\r\n`;
  const wayland = !!env("WAYLAND_DISPLAY");
  const wl = () => pipe("wl-copy", ["--type", "text/uri-list"], uri);
  const x = () => pipe("xclip", ["-selection", "clipboard", "-t", "text/uri-list"], uri);
  return wayland ? (await wl()) || (await x()) : (await x()) || (await wl());
}

async function showInFolder(path: string): Promise<void> {
  try {
    await exec("gdbus", [
      "call",
      "--session",
      "--dest",
      "org.freedesktop.FileManager1",
      "--object-path",
      "/org/freedesktop/FileManager1",
      "--method",
      "org.freedesktop.FileManager1.ShowItems",
      `['${fileUri(path).replace(/'/g, "%27")}']`,
      "",
    ]);
  } catch {
    await openExternal(path.split("/").slice(0, -1).join("/") || "/");
  }
}

async function exists(p: string) {
  try {
    await Deno.lstat(p);
    return true;
  } catch {
    return false;
  }
}

/** Moves without overwriting: mv -n, then checks it really moved. */
async function move(from: string, to: string) {
  if (await exists(to)) throw new Error(`${t(to)} already exists`);
  await exec("mv", ["-n", "-T", from, to]);
  if (await exists(from)) throw new Error(`Couldn't move ${t(from)}`);
}

async function moveInto(d: Download, folder: string): Promise<string> {
  const names = new Set<string>();
  try {
    for await (const e of Deno.readDir(folder)) names.add(e.name);
  } catch {
    await exec("mkdir", ["-p", folder]);
  }
  const dest = `${folder}/${freeName(d.name, (n) => names.has(n))}`;
  await move(d.path, dest);
  return dest;
}

function renameForm(d: Download) {
  return form({
    title: `Rename ${d.name}`,
    submitTitle: "Rename",
    fields: [field.text("name", "Name", { value: d.name, required: true })],
    async submit(values) {
      const name = String(values.name ?? "").trim();
      const problem = checkName(name);
      if (problem) throw new Error(problem);
      if (name === d.name) return pop();
      const dest = `${d.path.split("/").slice(0, -1).join("/")}/${name}`;
      await move(d.path, dest);
      changed();
      await toast(`Renamed to ${name}`, { style: "success" });
      return pop();
    },
  });
}

function moveForm(d: Download) {
  return form({
    title: `Move ${d.name}`,
    submitTitle: "Move",
    fields: [field.text("folder", "Folder", { placeholder: "~/Projects/invoices", required: true })],
    async submit(values) {
      const raw = String(values.folder ?? "").trim().replace(/\/+$/, "");
      if (!raw) throw new Error("Type a folder");
      const folder = raw.startsWith("~") ? `${HOME}${raw.slice(1)}` : raw.startsWith("/") ? raw : `${HOME}/${raw}`;
      const dest = await moveInto(d, folder);
      changed();
      await toast(`Moved to ${t(dest)}`, { style: "success" });
      return pop();
    },
  });
}

function actionsFor(d: Download, dirs: Partial<Record<XdgDir, string>>): Action[] {
  const targets = (Object.keys(XDG_TITLES) as XdgDir[]).filter((k) => k !== "DOWNLOAD" && dirs[k]);
  return [
    open(d.path, d.isDir ? "Open Folder" : "Open", { icon: Icons.external }),
    action("Show in Folder", async () => {
      await showInFolder(d.path);
    }, { icon: Icons.folder, shortcut: "<Ctrl>f" }),
    action("Copy File", async () => {
      if (await copyFile(d.path)) {
        await toast(`${d.name} copied: paste it in a file manager or a chat`, { style: "success" });
      } else {
        await clipboard.write(fileUri(d.path));
        await toast("Copied as a link (install wl-clipboard or xclip to copy the file itself)");
      }
    }, { icon: Icons.copy, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(d.path, "Copy Path", { section: "Copy", shortcut: "<Ctrl><Alt>c" }),
    copy(d.name, "Copy Name", { section: "Copy" }),
    ...(d.url ? [copy(d.url, "Copy Download Link", { section: "Copy", icon: Icons.link })] : []),
    ...(d.referrer ? [open(d.referrer, "Open Source Page", { icon: Icons.globe, section: "Copy" })] : []),
    submenu(
      "Move to…",
      targets.map((k) =>
        action(XDG_TITLES[k], async () => {
          const dest = await moveInto(d, dirs[k]!);
          changed();
          await toast(`Moved to ${t(dest)}`, { style: "success" });
          return refresh();
        }, { icon: Icons.folder })
      ).concat([action("Other Folder…", () => moveForm(d), { icon: Icons.plus })]),
      { icon: Icons.arrowRight, shortcut: "<Ctrl>m", section: "Organize" },
    ),
    action("Rename…", () => renameForm(d), { icon: Icons.text, shortcut: "F2", section: "Organize" }),
    action("Move to Trash", async () => {
      try {
        await exec("gio", ["trash", d.path]);
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) throw new Error("gio (GLib) is needed to move files to the trash");
        throw e;
      }
      changed();
      await toast(`${d.name} moved to the trash`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      section: "Danger",
      shortcut: "<Ctrl>Delete",
      confirm: `Move ${d.name} to the trash?`,
    }),
  ];
}

function item(d: Download, dirs: Partial<Record<XdgDir, string>>): Item {
  const { icon, tint } = ICONS[d.kind];
  const host = hostOf(d.url) ?? hostOf(d.referrer);
  const ext = d.isDir ? undefined : extTag(d.name);
  const metadata: Metadata[] = [
    meta.text("Downloaded", d.modified.toLocaleString("en-GB"), { icon: Icons.clock }),
    meta.tags("Type", [
      { text: KIND_TITLES[d.kind], color: tint },
      ...(ext ? [{ text: ext }] : []),
    ]),
    ...(d.url ? [meta.link("From", hostOf(d.url) ?? d.url, d.url)] : []),
    ...(d.referrer && d.referrer !== d.url ? [meta.link("Page", hostOf(d.referrer) ?? d.referrer, d.referrer)] : []),
    ...(!d.url && getfattrMissing
      ? [meta.text("Source", "Install getfattr (attr) to see it", { icon: Icons.info, color: "gray" })]
      : []),
    meta.separator(),
    meta.text("Path", t(d.path), { icon: Icons.folder }),
  ];
  return {
    id: d.path,
    title: d.name,
    subtitle: host,
    icon: { source: icon, tint },
    section: section(d.modified),
    keywords: [d.kind, KIND_TITLES[d.kind], host ?? "", ext ?? ""],
    accessories: [
      ...(d.kind === "partial" ? [{ tag: "Downloading", color: "yellow" as const }] : []),
      ...(d.isDir ? [] : [{ text: formatBytes(d.size) }]),
      { text: when(d.modified), color: "gray" as const },
    ],
    detail: {
      image: previewable(d.name) ? d.path : undefined,
      stats: d.isDir ? [{ label: "Kind", value: "Folder" }] : [
        { label: "Size", value: formatBytes(d.size) },
        { label: "Kind", value: ext ?? KIND_TITLES[d.kind], color: tint },
      ],
      metadata,
    },
    actions: actionsFor(d, dirs),
  };
}

const sleepUntil = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });

let status = "";

export default async () => {
  const dirs = await folders();
  const dir = dirs.DOWNLOAD ?? `${HOME}/Downloads`;
  return list({
    placeholder: "Filter recent downloads…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "images", title: "Images" },
        { value: "documents", title: "Documents" },
        { value: "archives", title: "Archives" },
        { value: "installers", title: "Installers" },
      ],
    },
    empty: { title: "Nothing downloaded here", description: "Files you download show up here", icon: Icons.download },
    status: () => status,
    // New downloads appear by themselves; changes made here show at once.
    async *items({ filter, signal }) {
      let last = "";
      while (!signal.aborted) {
        const all = await load(dir);
        const key = all.map((d) => `${d.name}:${d.size}:${d.modified.getTime()}`).join("|");
        if (key !== last) {
          last = key;
          const total = all.reduce((s, d) => s + (d.isDir ? 0 : d.size), 0);
          const today = all.filter((d) => section(d.modified) === "Today").length;
          status = `${all.length} item${all.length === 1 ? "" : "s"} · ${formatBytes(total)} · ${t(dir)}`;
          updateCommandMetadata({ subtitle: today ? `${today} today` : all[0] ? `Latest: ${all[0].name}` : null })
            .catch(() => {});
          yield all.filter((d) => matchesFilter(d.kind, filter ?? "all")).map((d) => item(d, dirs));
        }
        await sleepUntil(3000, signal);
      }
    },
    actions: [open(dir, "Open Downloads Folder", { icon: Icons.folder, shortcut: "<Ctrl><Shift>o" })],
  });
};
