import {
  type Action,
  action,
  close,
  type Color,
  copy,
  exec,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  COLUMNS,
  flathubUrl,
  formatBytes,
  type Grant,
  installMarkdown,
  type Level,
  osFamily,
  parseList,
  parsePermissions,
  type Ref,
  sandboxScore,
  splitRuntime,
  summarize,
  uninstallArgs,
  unusedRuntimes,
} from "../lib.ts";

const HOME = (() => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
})();

const LEVEL_COLOR: Record<Level, Color> = { high: "red", medium: "orange", low: "gray" };
const LEVEL_TEXT: Record<Level, string> = {
  high: "Wide access",
  medium: "Some access",
  low: "Well sandboxed",
};

async function flatpak(args: string[], signal?: AbortSignal): Promise<string> {
  try {
    return await exec("flatpak", args, { signal });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new NotInstalled();
    throw e;
  }
}

class NotInstalled extends Error {}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** The app's own icon from the exported icon theme, if any. */
async function iconOf(r: Ref): Promise<string | undefined> {
  const roots = r.installation === "user"
    ? [`${HOME}/.local/share/flatpak/exports/share/icons/hicolor`]
    : ["/var/lib/flatpak/exports/share/icons/hicolor"];
  for (const root of roots) {
    for (const p of ["128x128/apps", "scalable/apps", "256x256/apps", "64x64/apps", "512x512/apps"]) {
      for (const ext of p.startsWith("scalable") ? ["svg"] : ["png"]) {
        const file = `${root}/${p}/${r.id}.${ext}`;
        if (await exists(file)) return file;
      }
    }
  }
  return undefined;
}

/** Runs `fn` over the items, a few at a time. */
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: n }, async () => {
    for (let t = queue.shift(); t !== undefined; t = queue.shift()) await fn(t);
  }));
}

async function uninstall(r: Ref, deleteData = false) {
  await toast(`Uninstalling ${r.name}…`);
  await flatpak(uninstallArgs(r, deleteData));
  await toast(`${r.name} uninstalled`, { style: "success" });
  return refresh();
}

const removeUnused = action("Remove Unused Runtimes", async () => {
  await toast("Removing unused runtimes…");
  const out = await flatpak(["uninstall", "--unused", "--noninteractive", "-y"]);
  const nothing = /Nothing unused/i.test(out);
  await toast(nothing ? "Nothing unused to remove" : "Unused runtimes removed", { style: "success" });
  return refresh();
}, {
  icon: Icons.trash,
  destructive: true,
  confirm: "Remove every runtime no installed app needs?",
  section: "Danger",
  shortcut: "<Ctrl><Shift>u",
});

function grantTags(grants: Grant[]) {
  return grants.slice(0, 10).map((g) => ({ text: g.text, color: LEVEL_COLOR[g.level] }));
}

function appItem(r: Ref, icon: string | undefined, grants: Grant[] | undefined, hasData: boolean): Item {
  const url = flathubUrl(r);
  const level = grants ? sandboxScore(grants) : undefined;
  const runtime = splitRuntime(r.runtime);
  const dataDir = `${HOME}/.var/app/${r.id}`;
  const metadata: Metadata[] = [
    meta.text("App ID", r.id, { icon: Icons.hash }),
    ...(r.version ? [meta.text("Version", r.version, { icon: Icons.tag })] : []),
    meta.tags("Source", [
      { text: r.origin || "unknown", color: /flathub/i.test(r.origin) ? "blue" : "gray" },
      { text: r.branch, color: r.branch === "stable" ? "green" : "orange" },
      { text: r.installation === "user" ? "User" : r.installation === "system" ? "System" : r.installation },
    ]),
    meta.text("Runtime", `${runtime.id} ${runtime.branch ?? ""}`.trim(), { icon: Icons.layers }),
    meta.text("Size", formatBytes(r.size), { icon: Icons.drive }),
    ...(hasData ? [meta.text("Data", `~/.var/app/${r.id}`, { icon: Icons.folder })] : []),
    meta.separator(),
    ...(grants
      ? [
        meta.text("Sandbox", LEVEL_TEXT[level!], {
          icon: Icons.shield,
          color: LEVEL_COLOR[level!] === "gray" ? "green" : LEVEL_COLOR[level!],
        }),
        ...(grants.length ? [meta.tags("Permissions", grantTags(grants))] : [meta.text("Permissions", "None")]),
      ]
      : [meta.text("Permissions", "Reading…", { icon: Icons.shield })]),
  ];
  const actions: Action[] = [
    action(`Run ${r.name}`, () => {
      try {
        new Deno.Command("flatpak", { args: ["run", r.id], stdin: "null", stdout: "null", stderr: "null" }).spawn()
          .unref();
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) throw new Error("flatpak was not found");
        throw e;
      }
      return close();
    }, { icon: Icons.play }),
    ...(url ? [open(url, "Open in Flathub", { icon: Icons.globe, shortcut: "<Ctrl>o" })] : []),
    ...(hasData ? [open(dataDir, "Show Data Folder", { icon: Icons.folder, shortcut: "<Ctrl>f" })] : []),
    copy(r.id, "Copy App ID", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(`flatpak run ${r.id}`, "Copy Run Command", { section: "Copy" }),
    ...(url ? [copy(url, "Copy Flathub Link", { section: "Copy" })] : []),
    action("Reset Permissions", async () => {
      await flatpak(["override", "--user", "--reset", r.id]);
      await toast(`Permissions of ${r.name} reset to the defaults`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.shield,
      section: "Danger",
      confirm: `Forget every permission you changed for ${r.name} (Flatseal, flatpak override --user)?`,
    }),
    action("Uninstall", () => uninstall(r), {
      icon: Icons.trash,
      destructive: true,
      section: "Danger",
      shortcut: "<Ctrl>Delete",
      confirm: `Uninstall ${r.name}? Its data in ~/.var/app is kept.`,
    }),
    action("Uninstall and Delete Data", () => uninstall(r, true), {
      icon: Icons.trash,
      destructive: true,
      section: "Danger",
      confirm: `Uninstall ${r.name} and delete its data and settings?`,
    }),
    removeUnused,
    action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
  ];
  return {
    id: r.ref,
    title: r.name,
    subtitle: r.description || r.id,
    icon: icon ?? { source: Icons.package, tint: "blue" },
    section: "Apps",
    keywords: [r.id, r.origin, r.branch, "app", "application", "appli"],
    accessories: [
      ...(level === "high" ? [{ icon: { source: Icons.shield, tint: "red" as const }, tooltip: "Wide access" }] : []),
      ...(r.branch !== "stable" ? [{ tag: r.branch, color: "orange" as const }] : []),
      ...(r.installation === "user" ? [{ tag: "User", color: "gray" as const }] : []),
      { text: formatBytes(r.size), tooltip: "Installed size" },
    ],
    detail: {
      image: icon,
      stats: [
        { label: "Size", value: formatBytes(r.size) },
        ...(r.version ? [{ label: "Version", value: r.version }] : []),
        ...(level ? [{ label: "Sandbox", value: LEVEL_TEXT[level], color: LEVEL_COLOR[level] }] : []),
      ],
      metadata,
    },
    actions,
  };
}

function runtimeItem(r: Ref, unused: boolean, usedBy: Ref[]): Item {
  return {
    id: r.ref,
    title: r.name === r.id ? r.id : r.name,
    subtitle: `${r.id} · ${r.branch}`,
    icon: { source: Icons.layers, tint: unused ? "orange" : "gray" },
    section: unused ? "Unused Runtimes" : "Runtimes",
    keywords: [r.id, r.branch, r.origin, "runtime", "platform", unused ? "unused inutilisé" : ""],
    accessories: [
      ...(unused ? [{ tag: "Unused", color: "orange" as const }] : []),
      { text: formatBytes(r.size), tooltip: "Installed size" },
    ],
    detail: {
      stats: [
        { label: "Size", value: formatBytes(r.size) },
        { label: "Used by", value: usedBy.length ? `${usedBy.length} app${usedBy.length === 1 ? "" : "s"}` : "—" },
      ],
      metadata: [
        meta.text("ID", r.id, { icon: Icons.hash }),
        meta.text("Branch", r.branch, { icon: Icons.branch }),
        meta.text("Ref", r.ref, { icon: Icons.code }),
        meta.tags("Source", [
          { text: r.origin || "unknown", color: /flathub/i.test(r.origin) ? "blue" : "gray" },
          { text: r.installation === "user" ? "User" : r.installation === "system" ? "System" : r.installation },
        ]),
        meta.text("State", unused ? "Probably unused" : "In use", {
          icon: unused ? Icons.alert : Icons.check,
          color: unused ? "orange" : "green",
        }),
        ...(usedBy.length ? [meta.tags("Apps", usedBy.slice(0, 8).map((a) => a.name))] : []),
      ],
    },
    actions: [
      ...(unused ? [removeUnused] : []),
      copy(r.ref, "Copy Ref", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      action("Uninstall", () => uninstall(r), {
        icon: Icons.trash,
        destructive: true,
        section: "Danger",
        confirm: usedBy.length
          ? `${usedBy.length} app${usedBy.length === 1 ? " needs" : "s need"} ${r.id}. Uninstall it anyway?`
          : `Uninstall ${r.id} ${r.branch}?`,
      }),
      ...(unused ? [] : [removeUnused]),
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter Flatpak apps and runtimes…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "apps", title: "Apps" },
      { value: "runtimes", title: "Runtimes" },
      { value: "unused", title: "Unused" },
    ],
  },
  empty: { title: "Nothing here", description: "No Flatpak matches this view", icon: Icons.package },
  status: () => summary,
  actions: [removeUnused, open("https://flathub.org", "Browse Flathub", { icon: Icons.globe })],
  async *items({ filter, signal }) {
    let apps: Ref[];
    let runtimes: Ref[];
    try {
      [apps, runtimes] = await Promise.all([
        flatpak(["list", "--app", `--columns=${COLUMNS}`], signal).then((t) => parseList(t, "app")),
        flatpak(["list", "--runtime", `--columns=${COLUMNS}`], signal).then((t) => parseList(t, "runtime")),
      ]);
    } catch (e) {
      if (!(e instanceof NotInstalled)) throw e;
      summary = "Flatpak isn't installed";
      const fam = osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
      yield [{
        id: "install",
        title: "Install Flatpak",
        subtitle: "Then get apps from Flathub",
        icon: { source: Icons.download, tint: "orange" },
        detail: { markdown: installMarkdown(fam) },
        actions: [
          open("https://flathub.org/setup", "Open the Flathub Setup Guide", { icon: Icons.globe }),
          action("Check Again", () => refresh(), { icon: Icons.refresh }),
        ],
      }];
      return;
    }
    const unused = unusedRuntimes(apps, runtimes);
    const total = [...apps, ...runtimes].reduce((s, r) => s + r.size, 0);
    const unusedSize = runtimes.filter((r) => unused.has(r.ref)).reduce((s, r) => s + r.size, 0);
    summary = `${apps.length} app${apps.length === 1 ? "" : "s"} · ${runtimes.length} runtimes · ${formatBytes(total)}${
      unused.size ? ` · ${unused.size} unused (${formatBytes(unusedSize)})` : ""
    }`;
    updateCommandMetadata({ subtitle: `${apps.length} apps · ${formatBytes(total)}` }).catch(() => {});

    const f = filter ?? "all";
    const shownApps = f === "all" || f === "apps" ? [...apps].sort((a, b) => a.name.localeCompare(b.name)) : [];
    const shownRuntimes = (f === "all" || f === "runtimes" || f === "unused" ? runtimes : [])
      .filter((r) => f !== "unused" || unused.has(r.ref))
      .sort((a, b) => Number(unused.has(b.ref)) - Number(unused.has(a.ref)) || b.size - a.size);
    const usedBy = (r: Ref) =>
      apps.filter((a) => splitRuntime(a.runtime).id === r.id && splitRuntime(a.runtime).branch === r.branch);

    const icons = new Map<string, string | undefined>();
    const data = new Map<string, boolean>();
    await Promise.all(shownApps.map(async (a) => {
      icons.set(a.ref, await iconOf(a));
      data.set(a.ref, await exists(`${HOME}/.var/app/${a.id}`));
    }));
    const grants = new Map<string, Grant[]>();
    const render = () => [
      ...shownApps.map((a) => appItem(a, icons.get(a.ref), grants.get(a.ref), data.get(a.ref) ?? false)),
      ...shownRuntimes.map((r) => runtimeItem(r, unused.has(r.ref), usedBy(r))),
    ];
    yield render();
    if (!shownApps.length) return;
    // Permissions take one call per app: show the list first, then fill them in.
    await pool(shownApps, 6, async (a) => {
      if (signal.aborted) return;
      const text = await flatpak(["info", "--show-permissions", a.ref], signal).catch(() => "");
      grants.set(a.ref, summarize(parsePermissions(text)));
    });
    if (!signal.aborted) yield render();
  },
});
