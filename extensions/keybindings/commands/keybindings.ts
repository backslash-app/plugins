import { type Action, action, close, copy, Icons, type Item, list, meta, type Metadata, open } from "@backslash/api";
import {
  configFile,
  type Desktop,
  DESKTOP_NAMES,
  searchWords,
  settingsPanel,
  type Shortcut,
  sortShortcuts,
} from "../lib.ts";
import { HOME, load, type Loaded } from "../system.ts";

const CATEGORY_ICONS: Record<string, string> = {
  "Custom Shortcuts": Icons.star,
  Apps: Icons.apps,
  Applications: Icons.apps,
  Launchers: Icons.apps,
  Windows: Icons.window,
  Switching: Icons.layers,
  Focus: Icons.eye,
  Move: Icons.arrowRight,
  Resize: Icons.square,
  Tiling: Icons.kanban,
  Workspaces: Icons.layers,
  "Virtual Desktops": Icons.layers,
  Displays: Icons.monitor,
  Screenshots: Icons.camera,
  "Sound & Media": Icons.speaker,
  Typing: Icons.keyboard,
  Accessibility: Icons.eye,
  Mouse: Icons.mouse,
  System: Icons.settings,
  Session: Icons.power,
};

function editActions(desktop: Desktop): Action[] {
  const actions: Action[] = [];
  const panel = settingsPanel(desktop);
  if (panel) {
    actions.push(action("Open Shortcut Settings", () => {
      try {
        // Detached: the settings window outlives the launcher.
        new Deno.Command(panel[0], { args: panel.slice(1), stdin: "null", stdout: "null", stderr: "null" }).spawn()
          .unref();
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) throw new Error(`${panel[0]} is not installed`);
        throw e;
      }
      return close();
    }, { icon: Icons.settings, shortcut: "<Ctrl>o", section: "Edit" }));
  }
  const file = HOME ? configFile(desktop, HOME) : undefined;
  if (file) {
    actions.push(
      open(file, "Open Configuration File", {
        icon: Icons.file,
        shortcut: panel ? "<Ctrl><Shift>o" : "<Ctrl>o",
        section: "Edit",
      }),
    );
  }
  return actions;
}

function item(s: Shortcut, multi: boolean): Item {
  const keys = s.keys.join("  or  ");
  const metadata: Metadata[] = [
    meta.tags("Keys", s.keys.map((k) => ({ text: k, color: "blue" as const }))),
    meta.text("Section", s.category),
    meta.separator(),
    meta.text("Action", s.action, { icon: Icons.code }),
    ...(s.command ? [meta.text("Runs", s.command, { icon: Icons.terminal })] : []),
    ...(s.scope
      ? [meta.text(s.desktop === "gnome" ? "Schema" : s.desktop === "kde" ? "Component" : "Mode", s.scope)]
      : []),
    meta.text("As written", s.raw.join(", ")),
    meta.text("Desktop", DESKTOP_NAMES[s.desktop]),
  ];
  return {
    id: s.id,
    title: s.name,
    icon: {
      source: CATEGORY_ICONS[s.category] ?? (s.category.startsWith("Mode: ") ? Icons.layers : Icons.keyboard),
      tint: "blue",
    },
    section: multi ? `${DESKTOP_NAMES[s.desktop]}: ${s.category}` : s.category,
    keywords: searchWords(s),
    accessories: s.keys.slice(0, 2).map((k) => ({ tag: k })),
    detail: { metadata },
    actions: [
      copy(keys, "Copy Shortcut"),
      ...editActions(s.desktop),
      copy(s.name, "Copy Action Name", { section: "Copy" }),
      copy(`${keys}: ${s.name}`, "Copy as Line", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      ...(s.command ? [copy(s.command, "Copy Command", { section: "Copy", icon: Icons.terminal })] : []),
    ],
  };
}

function problem(l: Loaded): Item {
  return {
    id: `error:${l.desktop}`,
    title: `${DESKTOP_NAMES[l.desktop]}: shortcuts unavailable`,
    subtitle: l.error,
    icon: { source: Icons.alert, tint: "orange" },
    section: "Problems",
    detail: { markdown: l.error ?? "" },
    actions: editActions(l.desktop),
  };
}

export default list({
  placeholder: "Search shortcuts by action or key…",
  empty: {
    title: "No shortcuts found",
    description: "Supported: GNOME, KDE Plasma, Hyprland, Sway, niri and i3",
    icon: Icons.keyboard,
  },
  status: (items) => {
    const n = items.filter((i) => !i.id?.startsWith("error:")).length;
    return `${n} shortcut${n === 1 ? "" : "s"}`;
  },
  async items() {
    const loaded = await load();
    const multi = loaded.filter((l) => l.shortcuts.length).length > 1;
    return [
      ...loaded.flatMap((l) => sortShortcuts(l.shortcuts).map((s) => item(s, multi))),
      ...loaded.filter((l) => l.error && !l.shortcuts.length).map(problem),
    ];
  },
});
