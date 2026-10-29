// Rows for bottles, their programs, Wine prefixes and Wine's menu entries, and the Run form.

import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  field,
  form,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  submenu,
  toast,
} from "@backslash/api";
import {
  type Bottle,
  bottlesCli,
  commandText,
  day,
  isWindowsProgram,
  pathFromClipboard,
  type Prefix,
  type Program,
  runExeArgs,
  runnerName,
  runProgramArgs,
  type Tool,
  TOOLS,
  type WineApp,
} from "./lib.ts";
import {
  bottleTool,
  HOME,
  killPrefix,
  openBottles,
  prefixTool,
  runInBottle,
  runInPrefix,
  runWineApp,
  tilde,
  winetricks,
} from "./system.ts";

/** Only a missing file is an error: folders outside the extension's reach can't be checked, Wine will say. */
async function mustExist(path: string) {
  try {
    await Deno.stat(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error(`${tilde(path)} doesn't exist`);
  }
}

/** The path of a Windows program in the clipboard, or an error the user understands. */
async function clipboardProgram(): Promise<string> {
  const path = pathFromClipboard(await clipboard.read(), HOME);
  if (!path) throw new Error("Copy the path of a .exe or .msi file first (Ctrl+C on it in the file manager)");
  if (!isWindowsProgram(path)) throw new Error(`${path.split("/").pop()} isn't a Windows program (.exe, .msi, .bat)`);
  await mustExist(path);
  return path;
}

function toolsMenu(run: (tool: Tool) => Promise<void>): Action {
  return submenu(
    "Wine Tools",
    (Object.keys(TOOLS) as Tool[]).map((t) =>
      action(TOOLS[t].title, async () => {
        await run(t);
        return close(`${TOOLS[t].title} opened`);
      })
    ),
    { icon: Icons.settings, shortcut: "<Ctrl>t", section: "Wine" },
  );
}

// ---------------------------------------------------------------------------
// Bottles

export function bottleItem(b: Bottle): Item {
  const flatpak = b.source === "flatpak";
  const metadata: Metadata[] = [
    meta.text("Environment", b.environment ?? "Custom", { icon: Icons.layers }),
    meta.text("Runner", runnerName(b.runner), { icon: Icons.cpu }),
    meta.text("Architecture", b.arch === "win32" ? "32-bit" : "64-bit", { icon: Icons.hash }),
    ...(b.dxvk ? [meta.text("DXVK", b.dxvk, { icon: Icons.package })] : []),
    ...(b.vkd3d ? [meta.text("VKD3D", b.vkd3d, { icon: Icons.package })] : []),
    ...(b.nvapi ? [meta.text("NVAPI", b.nvapi, { icon: Icons.package })] : []),
    meta.text("Snapshots", b.versioning ? "On" : "Off", { icon: Icons.history }),
    meta.text("Installed by", flatpak ? "Bottles (Flatpak)" : "Bottles", { icon: Icons.box }),
    meta.text("Folder", tilde(b.dir), { icon: Icons.folder }),
    ...(day(b.created) ? [meta.text("Created", day(b.created)!, { icon: Icons.calendar })] : []),
  ];
  if (Object.keys(b.variables).length) {
    metadata.push(meta.tags("Variables", Object.entries(b.variables).map(([k, v]) => `${k}=${v}`)));
  }
  return {
    id: `bottle:${b.source}:${b.name}`,
    title: b.name,
    subtitle: `${b.environment ?? "Custom"} · ${runnerName(b.runner)}`,
    icon: { source: Icons.box, tint: b.environment === "Gaming" ? "purple" : "blue" },
    section: "Bottles",
    keywords: ["bottle", b.environment ?? "", b.runner ?? "", flatpak ? "flatpak" : ""],
    accessories: [
      { text: `${b.programs.length} program${b.programs.length === 1 ? "" : "s"}` },
      ...(flatpak ? [{ tag: "Flatpak", color: "gray" as const }] : []),
    ],
    detail: {
      markdown: b.programs.length
        ? b.programs.map((p) => `- **${p.name}** · \`${p.executable}\``).join("\n")
        : "No program added yet: install one in Bottles, or run an .exe from the clipboard (**Ctrl+Enter**).",
      metadata,
    },
    actions: [
      open(`${b.dir}/drive_c`, "Open C: Drive", { icon: Icons.folder }),
      action("Run .exe from Clipboard", async () => {
        const path = await clipboardProgram();
        await runInBottle(b, runExeArgs(b, path), `${path.split("/").pop()} (${b.name})`);
        return close(`${path.split("/").pop()} started in ${b.name}`);
      }, { icon: Icons.play, shortcut: "<Ctrl>e" }),
      toolsMenu((t) => bottleTool(b, t)),
      action("Open Bottles", async () => {
        await openBottles(b.source);
        return close();
      }, { icon: Icons.external, shortcut: "<Ctrl>o", section: "Wine" }),
      copy(b.name, "Copy Bottle Name", { section: "Copy" }),
      copy(b.dir, "Copy Folder Path", { section: "Copy" }),
    ],
  };
}

export function programItem(b: Bottle, p: Program): Item {
  const cli = bottlesCli(b.source, runProgramArgs(b, p));
  return {
    id: `program:${b.source}:${b.name}:${p.id}`,
    title: p.name,
    subtitle: b.name,
    icon: { source: Icons.play, tint: "green" },
    section: "Programs",
    keywords: [b.name, p.executable, "program"],
    accessories: [{ text: p.executable }],
    detail: {
      metadata: [
        meta.text("Bottle", b.name, { icon: Icons.box }),
        meta.text("Executable", p.executable, { icon: Icons.file }),
        ...(p.arguments ? [meta.text("Arguments", p.arguments, { icon: Icons.code })] : []),
        meta.text("Path", tilde(p.path), { icon: Icons.folder }),
        meta.text("Runner", runnerName(b.runner), { icon: Icons.cpu }),
        meta.separator(),
        meta.text("Command", commandText(cli.program, cli.args), { icon: Icons.terminal }),
      ],
    },
    actions: [
      action("Run", async () => {
        await runInBottle(b, runProgramArgs(b, p), `${p.name} (${b.name})`);
        return close(`${p.name} started`);
      }, { icon: Icons.play }),
      ...(p.folder ? [open(p.folder, "Open Program Folder", { icon: Icons.folder })] : []),
      toolsMenu((t) => bottleTool(b, t)),
      copy(commandText(cli.program, cli.args), "Copy Command", { section: "Copy", icon: Icons.terminal }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Wine prefixes

export function prefixItem(p: Prefix): Item {
  return {
    id: `prefix:${p.path}`,
    title: p.name,
    subtitle: tilde(p.path),
    icon: { source: Icons.folder, tint: "orange" },
    section: "Wine Prefixes",
    keywords: ["wine", "prefix", "wineprefix", p.path],
    accessories: [
      ...(p.programs.length ? [{ text: `${p.programs.length} program${p.programs.length === 1 ? "" : "s"}` }] : []),
      ...(p.arch ? [{ tag: p.arch === "win64" ? "64-bit" : "32-bit", color: "gray" as const }] : []),
    ],
    detail: {
      markdown: p.programs.length ? p.programs.map((a) => `- ${a.name}`).join("\n") : undefined,
      metadata: [
        meta.text("WINEPREFIX", tilde(p.path), { icon: Icons.folder }),
        meta.text("Architecture", p.arch === "win32" ? "32-bit" : p.arch === "win64" ? "64-bit" : "Unknown", {
          icon: Icons.hash,
        }),
        ...(p.modified
          ? [meta.text("Last used", new Date(p.modified).toLocaleDateString(), { icon: Icons.clock })]
          : []),
      ],
    },
    actions: [
      action("Wine Configuration", async () => {
        await prefixTool(p, "winecfg");
        return close("winecfg opened");
      }, { icon: Icons.settings }),
      action("Run .exe from Clipboard", async () => {
        const path = await clipboardProgram();
        await runInPrefix(p, path);
        return close(`${path.split("/").pop()} started`);
      }, { icon: Icons.play, shortcut: "<Ctrl>e" }),
      action("File Explorer", async () => {
        await prefixTool(p, "explorer");
        return close();
      }, { icon: Icons.folder, section: "Wine" }),
      action("Winetricks", async () => {
        await winetricks(p);
        return close("Winetricks opened");
      }, { icon: Icons.package, shortcut: "<Ctrl>w", section: "Wine" }),
      toolsMenu((t) => prefixTool(p, t)),
      open(`${p.path}/drive_c`, "Open C: Drive", { icon: Icons.folder, shortcut: "<Ctrl>o", section: "Wine" }),
      action("Stop All Programs", async () => {
        await killPrefix(p);
        await toast(`Programs of ${p.name} stopped`, { style: "success" });
      }, {
        icon: Icons.stop,
        destructive: true,
        confirm: `Stop every Windows program running in ${p.name}? Unsaved work is lost`,
        section: "Danger",
      }),
      copy(`WINEPREFIX=${p.path}`, "Copy WINEPREFIX", { section: "Copy" }),
    ],
  };
}

export function wineAppItem(a: WineApp, prefix?: Prefix): Item {
  return {
    id: `wineapp:${a.file}`,
    title: a.name,
    subtitle: prefix?.name ?? tilde(a.prefix),
    icon: { source: Icons.play, tint: "orange" },
    section: "Wine Programs",
    keywords: ["wine", a.comment ?? ""],
    detail: {
      markdown: a.comment,
      metadata: [
        meta.text("Prefix", tilde(a.prefix), { icon: Icons.folder }),
        meta.text("Menu entry", tilde(a.file), { icon: Icons.file }),
      ],
    },
    actions: [
      action("Run", async () => {
        await runWineApp(a);
        return close(`${a.name} started`);
      }, { icon: Icons.play }),
      ...(prefix ? [toolsMenu((t) => prefixTool(prefix, t))] : []),
      open(`${a.prefix}/drive_c`, "Open C: Drive", { icon: Icons.folder, section: "Wine" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Run form

export function runForm(bottles: Bottle[], prefixes: Prefix[], path: string) {
  const targets = [
    ...bottles.map((b) => ({ value: `bottle:${b.source}:${b.name}`, title: `${b.name} (Bottles)` })),
    ...prefixes.map((p) => ({ value: `prefix:${p.path}`, title: `${p.name} (Wine)` })),
  ];
  if (!targets.length) {
    throw new Error("No bottle and no Wine prefix found: create a bottle in Bottles, or run winecfg once");
  }
  return form({
    title: "Run Windows Program",
    submitTitle: "Run",
    fields: [
      field.text("path", "Program", { placeholder: "/home/you/Downloads/setup.exe", required: true, value: path }),
      field.dropdown("target", "Run in", targets, { value: targets[0].value }),
    ],
    async submit(values) {
      const file = pathFromClipboard(String(values.path ?? ""), HOME);
      if (!file || !isWindowsProgram(file)) throw new Error("Give the full path of a .exe, .msi or .bat file");
      await mustExist(file);
      const target = String(values.target);
      const name = file.split("/").pop()!;
      const bottle = bottles.find((b) => `bottle:${b.source}:${b.name}` === target);
      if (bottle) {
        await runInBottle(bottle, runExeArgs(bottle, file), `${name} (${bottle.name})`);
        return close(`${name} started in ${bottle.name}`);
      }
      const prefix = prefixes.find((p) => `prefix:${p.path}` === target)!;
      await runInPrefix(prefix, file);
      return close(`${name} started`);
    },
  });
}
