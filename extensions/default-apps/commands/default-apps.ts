import {
  type Action,
  action,
  type Color,
  copy,
  exec,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  type App,
  candidates,
  CATEGORIES,
  type Category,
  type Current,
  currentDefault,
  desktopId,
  execProgram,
  fallbackName,
  INSTALL_XDG_UTILS,
  mergeApps,
  osFamily,
  parseApp,
  parseQuery,
  parseTerminalsList,
  plural,
  preferTerminal,
  terminalFromEnv,
} from "../lib.ts";

const HOME = Deno.env.get("HOME") ?? "";
const CONFIG = `${HOME}/.config`;
const TERMINALS_LIST = `${CONFIG}/xdg-terminals.list`;

/** Application folders in XDG order: the user's first. Only those in the manifest can be read. */
function appDirs(): string[] {
  const dataHome = Deno.env.get("XDG_DATA_HOME") || `${HOME}/.local/share`;
  const dataDirs = (Deno.env.get("XDG_DATA_DIRS") || "/usr/local/share:/usr/share").split(":").filter(Boolean);
  return [
    ...new Set([
      `${dataHome}/applications`,
      `${HOME}/.local/share/flatpak/exports/share/applications`,
      ...dataDirs.map((d) => `${d.replace(/\/$/, "")}/applications`),
      "/var/lib/flatpak/exports/share/applications",
      "/var/lib/snapd/desktop/applications",
      `${HOME}/.nix-profile/share/applications`,
      "/run/current-system/sw/share/applications",
    ]),
  ];
}

async function readApps(dir: string): Promise<App[]> {
  const apps: App[] = [];
  const walk = async (path: string, rel: string, depth: number) => {
    let entries: Deno.DirEntry[];
    try {
      entries = await Array.fromAsync(Deno.readDir(path));
    } catch {
      return; // Missing, or not in our read permission.
    }
    await Promise.all(entries.map(async (e) => {
      const full = `${path}/${e.name}`;
      const relative = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory && depth < 3) return walk(full, relative, depth + 1);
      if (!e.name.endsWith(".desktop")) return;
      const text = await Deno.readTextFile(full).catch(() => undefined);
      const app = text === undefined ? undefined : parseApp(desktopId(relative), full, text);
      if (app) apps.push(app);
    }));
  };
  await walk(dir, "", 0);
  return apps;
}

class NoXdgUtils extends Error {}

async function xdg(program: "xdg-mime" | "xdg-settings", args: string[]): Promise<string> {
  try {
    return await exec(program, args);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) throw new NoXdgUtils(program);
    throw err;
  }
}

async function terminalDefault(apps: App[]): Promise<string | undefined> {
  const text = await Deno.readTextFile(TERMINALS_LIST).catch(() => undefined);
  const first = text && parseTerminalsList(text).find((id) => apps.some((a) => a.id === id));
  return first || terminalFromEnv(Deno.env.get("TERMINAL"), apps);
}

interface State {
  apps: Map<string, App>;
  current: Map<string, Current>;
}

async function load(): Promise<State> {
  const apps = mergeApps(await Promise.all(appDirs().map(readApps)));
  const mimes = [...new Set(CATEGORIES.flatMap((c) => c.mimes))];
  const byMime: Record<string, string | undefined> = {};
  // xdg-mime is a shell script: ask in parallel.
  await Promise.all(mimes.map(async (m) => {
    byMime[m] = parseQuery(
      await xdg("xdg-mime", ["query", "default", m]).catch((err) => {
        if (err instanceof NoXdgUtils) throw err;
        return "";
      }),
    );
  }));
  const browser = parseQuery(await xdg("xdg-settings", ["get", "default-web-browser"]).catch(() => ""));
  const terminals = [...apps.values()].filter((a) => a.categories.includes("TerminalEmulator"));
  const terminal = await terminalDefault(terminals);
  const current = new Map(CATEGORIES.map((c) => {
    const setting = c.id === "browser" ? browser : c.id === "terminal" ? terminal : undefined;
    return [c.id, currentDefault(c, byMime, setting)];
  }));
  return { apps, current };
}

async function setDefault(cat: Category, app: App) {
  if (cat.id === "terminal") {
    const text = await Deno.readTextFile(TERMINALS_LIST).catch(() => "");
    await Deno.writeTextFile(TERMINALS_LIST, preferTerminal(text, app.id));
    return;
  }
  if (cat.setting) {
    // xdg-settings also sets the http/https handlers its desktop knows about.
    await xdg("xdg-settings", ["set", cat.setting, app.id]).catch(() => {});
  }
  // Every type of the category the app can open (all of them when it lists none of the extras).
  const own = cat.mimes.filter((m) => app.mimes.includes(m));
  await xdg("xdg-mime", ["default", app.id, ...(own.length ? own : cat.mimes)]);
}

const ICONS: Record<string, [string, Color]> = {
  browser: [Icons.globe, "blue"],
  mail: [Icons.mail, "teal"],
  files: [Icons.folder, "yellow"],
  images: [Icons.image, "green"],
  video: [Icons.film, "red"],
  music: [Icons.music, "pink"],
  pdf: [Icons.file, "orange"],
  text: [Icons.text, "purple"],
  terminal: [Icons.terminal, "gray"],
};

function categoryItem(cat: Category, st: State): Item {
  const cur = st.current.get(cat.id)!;
  const app = cur.id ? st.apps.get(cur.id) : undefined;
  const name = app?.name ?? (cur.id ? fallbackName(cur.id) : undefined);
  const options = candidates(cat, st.apps.values());
  const [glyph, tint] = ICONS[cat.id];
  const nameOf = (id?: string) => (id ? st.apps.get(id)?.name ?? fallbackName(id) : "—");

  const change = submenu(
    "Change Default",
    () =>
      options.map((o) =>
        action(o.name + (o.noDisplay ? " (hidden app)" : ""), async () => {
          await setDefault(cat, o);
          await toast(`${o.name} is your ${cat.title.toLowerCase()}`, { style: "success" });
          return refresh();
        }, { icon: o.id === cur.id ? Icons.check : Icons.apps })
      ),
    { icon: Icons.apps, shortcut: "<Ctrl>e" },
  );

  // The detail's markdown has no tables: one bullet per type.
  const types = cat.mimes.map((m) => {
    const id = cur.byMime[m];
    const odd = id && id !== cur.id;
    return `- \`${m}\` → ${id ? (odd ? `**${nameOf(id)}**` : nameOf(id)) : "*not set*"}`;
  }).join("\n");

  const actions: Action[] = [
    ...(options.length ? [change] : []),
    ...(cur.mixed && app
      ? [action(`Use ${app.name} for All Types`, async () => {
        await setDefault(cat, app);
        await toast(`${app.name} opens every ${cat.title.toLowerCase()} type`, { style: "success" });
        return refresh();
      }, { icon: Icons.check })]
      : []),
    ...(app ? [open(app.path, "Open Desktop File", { icon: Icons.file, section: "Files" })] : []),
    cat.id === "terminal"
      ? open(TERMINALS_LIST, "Open xdg-terminals.list", { icon: Icons.file, section: "Files" })
      : open(`${CONFIG}/mimeapps.list`, "Open mimeapps.list", { icon: Icons.file, section: "Files" }),
    ...(cur.id ? [copy(cur.id, "Copy Desktop ID", { section: "Copy" })] : []),
    ...(cat.mimes.length ? [copy(cat.mimes.join("\n"), "Copy MIME Types", { section: "Copy" })] : []),
  ];

  return {
    id: cat.id,
    title: cat.title,
    subtitle: name ?? "Not set",
    icon: { source: glyph, tint: name ? tint : "gray" },
    keywords: [...cat.mimes, cur.id ?? "", name ?? ""],
    accessories: [
      ...(cur.mixed ? [{ tag: "Mixed", color: "orange" as const, tooltip: "Some types open with another app" }] : []),
      ...(!name ? [{ tag: "Not set", color: "gray" as const }] : []),
      { text: plural(options.length, "app"), tooltip: "Installed apps that can do it" },
    ],
    detail: {
      markdown: [cat.description, types, cur.mixed ? "Types in **bold** open with another app." : ""].filter(Boolean)
        .join("\n\n"),
      metadata: [
        meta.text("Default", name ?? "Not set", { icon: glyph, color: name ? undefined : "gray" }),
        ...(cur.id ? [meta.text("Desktop ID", cur.id)] : []),
        ...(app?.exec ? [meta.text("Program", execProgram(app.exec), { icon: Icons.terminal })] : []),
        ...(cur.id && !app ? [meta.text("Installed", "No .desktop file found", { color: "orange" })] : []),
        meta.separator(),
        ...(cat.mimes.length ? [meta.tags("Types", cat.mimes.map((m) => m.replace("x-scheme-handler/", "")))] : []),
        meta.tags(
          "Can do it",
          options.slice(0, 8).map((o) => ({ text: o.name, color: o.id === cur.id ? "blue" as const : undefined })),
        ),
      ],
    },
    actions,
  };
}

async function setupItem(): Promise<Item> {
  const family = osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
  const commands = family ? [INSTALL_XDG_UTILS[family]] : Object.values(INSTALL_XDG_UTILS);
  return {
    id: "no-xdg-utils",
    title: "xdg-utils isn't installed",
    subtitle: "Default apps are read and changed with xdg-mime and xdg-settings",
    icon: { source: Icons.package, tint: "gray" },
    detail: { markdown: ["Install xdg-utils:", "", "```", ...commands, "```"].join("\n") },
    actions: [copy(commands[0], "Copy Install Command")],
  };
}

export default list({
  placeholder: "Filter default apps or MIME types…",
  status: (items) => {
    const mixed = items.filter((i) => i.accessories?.some((a) => a.tag === "Mixed")).length;
    return `${items.length} ${items.length === 1 ? "category" : "categories"}${mixed ? ` · ${mixed} mixed` : ""}`;
  },
  items: async () => {
    let st: State;
    try {
      st = await load();
    } catch (err) {
      if (err instanceof NoXdgUtils) return [await setupItem()];
      throw err;
    }
    return CATEGORIES.map((c) => categoryItem(c, st));
  },
});
