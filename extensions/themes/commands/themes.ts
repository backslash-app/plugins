import {
  type Accessory,
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
} from "@backslash/api";
import { ACCENT_TINTS, filterOptions, KIND_NAMES, matchesFilter, sortThemes, type Theme } from "../lib.ts";
import { apply, backend, canApply, isDark, load, openGtkSettings, setDark, type State } from "../system.ts";

const KIND_ICONS: Record<Theme["kind"], string> = {
  gtk: Icons.window,
  icons: Icons.image,
  cursors: Icons.mouse,
  style: Icons.moon,
  accent: Icons.palette,
  colors: Icons.palette,
  global: Icons.sparkle,
};

const KIND_SINGULAR: Record<Theme["kind"], string> = {
  gtk: "GTK theme",
  icons: "icon theme",
  cursors: "cursor theme",
  style: "style",
  accent: "accent color",
  colors: "color scheme",
  global: "global theme",
};

function icon(t: Theme, current: boolean): Item["icon"] {
  if (t.kind === "accent") return { source: Icons.dottedCircle, tint: ACCENT_TINTS[t.id] ?? "gray" };
  if (t.kind === "style") return { source: t.dark ? Icons.moon : Icons.sun, tint: current ? "green" : "gray" };
  if (t.preview) return t.preview;
  return { source: KIND_ICONS[t.kind], tint: current ? "green" : t.dark ? "purple" : "gray" };
}

function toggleAction(state: State): Action {
  const dark = isDark(state);
  return action(dark ? "Switch to Light Mode" : "Switch to Dark Mode", async () => {
    // Read again: the list may be older than the desktop's settings.
    const now = await load();
    await toast(await setDark(now, !isDark(now)), { style: "success" });
    return refresh();
  }, { icon: dark ? Icons.sun : Icons.moon, shortcut: "<Ctrl>d", section: "Mode" });
}

function item(t: Theme, state: State): Item {
  const current = state.current[t.kind] === t.id;
  const accessories: Accessory[] = [];
  if (t.dark && t.kind !== "style") accessories.push({ tag: "Dark", color: "purple" });
  if (t.gtk) accessories.push({ text: `GTK ${t.gtk.filter((v) => v !== "2").join(" & ")}` });
  if (current) accessories.push({ tag: "Current", color: "green" });

  const metadata: Metadata[] = [
    meta.text("Kind", KIND_NAMES[t.kind], { icon: KIND_ICONS[t.kind] }),
    meta.text("Name", t.id),
    ...(current ? [meta.text("In use", "Yes", { color: "green" })] : []),
    ...(t.comment ? [meta.text("About", t.comment)] : []),
    ...(t.gtk ? [meta.tags("GTK versions", t.gtk.map((v) => `GTK ${v}`))] : []),
    ...(t.inherits ? [meta.text("Falls back to", t.inherits.split(",").join(", "))] : []),
    ...(t.origin ? [meta.text("Installed", t.origin)] : []),
    ...(t.path ? [meta.text("Folder", t.path, { icon: Icons.folder })] : []),
  ];

  const actions: Action[] = [];
  if (!current) {
    if (canApply(t.kind)) {
      actions.push(action(t.kind === "style" ? `Use ${t.name} Style` : "Apply", async () => {
        await apply(t);
        await toast(`${t.name} ${t.kind === "style" ? "style" : t.kind === "accent" ? "accent" : "applied"}`, {
          style: "success",
        });
        return refresh();
      }, { icon: Icons.check }));
    } else {
      actions.push(action("Open Application Style Settings", () => {
        openGtkSettings();
      }, { icon: Icons.settings }));
    }
  }
  if (t.path) actions.push(open(t.path, "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }));
  actions.push(copy(t.id, "Copy Name", { section: "Copy", shortcut: "<Ctrl><Shift>c" }));
  if (t.path) actions.push(copy(t.path, "Copy Folder Path", { section: "Copy" }));
  actions.push(toggleAction(state));

  return {
    id: `${t.kind}:${t.id}`,
    title: t.name,
    subtitle: t.name !== t.id && t.kind !== "style" && t.kind !== "accent" ? t.id : t.comment,
    icon: icon(t, current),
    section: KIND_NAMES[t.kind],
    keywords: [t.id, KIND_SINGULAR[t.kind], ...(t.dark ? ["dark", "sombre"] : [])],
    accessories,
    detail: {
      ...(t.preview ? { image: t.preview } : {}),
      metadata,
    },
    actions,
  };
}

export default async () => {
  const peek = await load();
  let first = true;
  return list({
    placeholder: "Search themes, icons, cursors…",
    filter: { options: filterOptions(backend, peek.accents.length > 0), default: "all" },
    empty: {
      title: "No themes here",
      description: "Install themes into ~/.local/share/themes or ~/.local/share/icons, or pick another chip",
      icon: Icons.palette,
    },
    status: (items) => {
      const current = items.filter((i) => i.accessories?.some((a) => a.tag === "Current")).length;
      return `${items.length} themes, ${current} in use`;
    },
    actions: [toggleAction(peek)],
    async items({ filter }) {
      // The first load is reused; a refresh reads everything again.
      const state = first ? peek : await load();
      first = false;
      return sortThemes(state.themes.filter((t) => matchesFilter(t.kind, filter)), state.current).map((t) =>
        item(t, state)
      );
    },
  });
};
