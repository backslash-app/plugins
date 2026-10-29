import {
  type Action,
  action,
  close,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  meta,
  pop,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { NoBackend, noBackendMessage, restoreNamed, saveCurrent } from "../layout.ts";
import {
  ago,
  applyCommands,
  appsLine,
  BACKEND_NAMES,
  CAN,
  commandsText,
  isUrl,
  type Layout,
  type LiveWindow,
  parseCommands,
  parseExtras,
  resolveApp,
  sortWindows,
  summary,
  uniqueName,
  windowsMarkdown,
} from "../lib.ts";
import { apps, deleteLayout, detect, layouts, putLayout, type Session, windows } from "../system.ts";

function saveForm(suggested: string): FormSpec {
  return form({
    title: "Save Current Windows",
    submitTitle: "Save Layout",
    fields: [
      field.text("name", "Name", { required: true, value: suggested, placeholder: "Work, Writing, Gaming…" }),
      field.textArea("extras", "Also open", {
        placeholder: "One per line: URLs (https://…) to open, or commands to run",
      }),
    ],
    async submit(values) {
      const name = String(values.name ?? "").trim();
      if (!name) {
        await toast("Give the layout a name", { style: "failure" });
        return;
      }
      const layout = await saveCurrent(name, { extras: parseExtras(String(values.extras ?? "")), replace: true });
      await toast(`${layout.name} saved`, { style: "success", message: summary(layout.windows) });
      return pop();
    },
  });
}

function editForm(l: Layout): FormSpec {
  return form({
    title: `Edit ${l.name}`,
    submitTitle: "Save",
    fields: [
      field.text("name", "Name", { required: true, value: l.name }),
      field.textArea("extras", "Also open", {
        value: l.extras.join("\n"),
        placeholder: "One per line: URLs (https://…) to open, or commands to run",
      }),
      field.textArea("commands", "Commands to start apps", {
        value: commandsText(l.windows),
        placeholder: "app = command; leave the command empty to never start that app",
      }),
    ],
    async submit(values) {
      const name = String(values.name ?? "").trim() || l.name;
      const others = (await layouts()).filter((x) => x.name !== l.name).map((x) => x.name);
      if (others.some((n) => n.toLowerCase() === name.toLowerCase())) {
        await toast(`A layout is already named ${name}`, { style: "failure" });
        return;
      }
      await putLayout({
        ...l,
        name,
        updated: Date.now(),
        extras: parseExtras(String(values.extras ?? "")),
        windows: applyCommands(l.windows, parseCommands(String(values.commands ?? ""))),
      }, l.name);
      await toast(`${name} saved`, { style: "success" });
      return pop();
    },
  });
}

function layoutItem(l: Layout, s: Session, all: Layout[]): Item {
  const ws = new Set(l.windows.map((w) => w.workspace).filter(Boolean));
  const noCommand = l.windows.filter((w) => !w.command).map((w) => w.appId);
  const other = s.backend && l.backend !== s.backend;
  const extras = l.extras.length
    ? `\n\n**Also opens**\n\n${l.extras.map((e) => `- ${isUrl(e) ? e : `\`${e.replace(/`/g, "'")}\``}`).join("\n")}`
    : "";
  const actions: Action[] = [
    action("Restore Layout", async (ctx) => {
      await toast(`Restoring ${l.name}…`);
      return close(await restoreNamed(l.name, ctx));
    }, { icon: Icons.upload }),
    action("Edit Layout…", () => editForm(l), { icon: Icons.settings, shortcut: "<Ctrl>e" }),
    action("Update with Current Windows", async () => {
      const saved = await saveCurrent(l.name, { replace: true });
      await toast(`${saved.name} updated`, { style: "success", message: summary(saved.windows) });
      return refresh();
    }, {
      icon: Icons.refresh,
      shortcut: "<Ctrl>u",
      confirm: `Replace the windows of ${l.name} with the ones open now?`,
    }),
    action("Duplicate", async () => {
      const name = uniqueName(`${l.name} copy`, all.map((x) => x.name));
      await putLayout({ ...l, name, created: Date.now(), updated: Date.now() });
      await toast(`${name} created`, { style: "success" });
      return refresh();
    }, { icon: Icons.copy, shortcut: "<Ctrl>d" }),
    copy(l.name, "Copy Name", { section: "Copy" }),
    copy(JSON.stringify(l, null, 2), "Copy as JSON", { icon: Icons.braces, section: "Copy" }),
    action("Delete Layout", async () => {
      await deleteLayout(l.name);
      await toast(`${l.name} deleted`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete the layout ${l.name}?`,
      shortcut: "<Ctrl>x",
      section: "Danger",
    }),
  ];
  return {
    id: `layout:${l.name}`,
    title: l.name,
    subtitle: appsLine(l.windows) || "Extras only",
    icon: { source: Icons.layers, tint: other ? "gray" : "blue" },
    section: "Layouts",
    keywords: [...new Set(l.windows.map((w) => w.appId))],
    accessories: [
      ...(noCommand.length
        ? [{
          icon: { source: Icons.alert, tint: "orange" as const },
          tooltip: `No command for ${noCommand.join(", ")}`,
        }]
        : []),
      ...(other ? [{ tag: BACKEND_NAMES[l.backend], color: "gray" as const }] : []),
      { text: summary(l.windows), color: "gray" },
    ],
    detail: {
      stats: [
        { label: "Windows", value: l.windows.length },
        { label: "Workspaces", value: ws.size },
        { label: "Extras", value: l.extras.length },
      ],
      markdown: windowsMarkdown(l.windows) + extras,
      metadata: [
        meta.text("Saved on", BACKEND_NAMES[l.backend], { icon: Icons.monitor }),
        meta.text("Updated", ago(l.updated), { icon: Icons.clock }),
        meta.text("Created", new Date(l.created).toLocaleString("en"), { icon: Icons.calendar }),
        ...(noCommand.length
          ? [meta.text("Not started", [...new Set(noCommand)].join(", "), { icon: Icons.alert, color: "orange" })]
          : []),
        ...(other
          ? [meta.text("Note", `Saved on ${BACKEND_NAMES[l.backend]}: workspaces may differ here`, {
            icon: Icons.info,
          })]
          : []),
      ],
    },
    actions,
  };
}

function currentItem(w: LiveWindow, command: string | undefined, s: Session): Item {
  const geo = CAN[s.backend!].geometry;
  return {
    id: `open:${w.id}`,
    title: w.title || w.appId,
    subtitle: w.appId,
    icon: { source: Icons.window, tint: command ? "teal" : "orange" },
    section: "Open Now",
    keywords: [w.appId],
    accessories: [
      ...(w.workspace ? [{ text: `ws ${w.workspace}`, icon: Icons.layers }] : []),
      ...(w.floating ? [{ tag: "floating", color: "purple" as const }] : []),
    ],
    detail: {
      metadata: [
        meta.text("App", w.appId, { icon: Icons.apps }),
        meta.text("Workspace", w.workspace ?? "—", { icon: Icons.layers }),
        ...(w.rect && geo !== "never"
          ? [meta.text("Place", `${w.rect.width}×${w.rect.height} at ${w.rect.x},${w.rect.y}`, { icon: Icons.window })]
          : []),
        ...(geo === "floating"
          ? [meta.text("Placement", w.floating ? "Floating: size and place restored" : "Tiled: the layout places it")]
          : []),
        meta.text("Starts with", command ?? "No .desktop file found: set a command in Edit Layout", {
          icon: Icons.terminal,
          color: command ? undefined : "orange",
        }),
      ],
    },
    actions: [
      action("Save Current Windows…", () => saveForm(""), { icon: Icons.download }),
      copy(w.appId, "Copy App ID"),
      ...(command ? [copy(command, "Copy Launch Command", { icon: Icons.terminal })] : []),
    ],
  };
}

function setupItem(s: Session): Item {
  return {
    id: "setup",
    title: noBackendMessage(s),
    subtitle: s.wanted.length ? BACKEND_NAMES[s.wanted[0]] : "Hyprland, Sway, niri, KDE Plasma, X11",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "Window Layouts reads and moves windows with your compositor's own tool:",
        "",
        "- **Hyprland**: `hyprctl` (ships with it)",
        "- **Sway**: `swaymsg` (ships with it)",
        "- **niri**: `niri msg` (ships with it)",
        "- **KDE Plasma**: [kdotool](https://github.com/jinliu/kdotool) (`kdotool` package, AUR or cargo)",
        "- **X11** (Xfce, Cinnamon, MATE, i3…): `wmctrl`",
        "",
        "GNOME on Wayland doesn't let apps move windows.",
      ].join("\n"),
    },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  };
}

let status = "";

export default list({
  placeholder: "Restore a layout, or save the windows open now…",
  empty: { title: "No layout yet", description: "Save the windows open now to make one", icon: Icons.layers },
  status: () => status,
  async items() {
    const [s, all] = await Promise.all([detect(), layouts()]);
    updateCommandMetadata({ subtitle: all.length ? `${all.length} layout${all.length === 1 ? "" : "s"}` : null })
      .catch(() => {});
    const saved = [...all].sort((a, b) => b.updated - a.updated).map((l) => layoutItem(l, s, all));
    if (!s.backend) {
      status = "No supported window manager";
      return [setupItem(s), ...saved];
    }
    let open: LiveWindow[] = [];
    let error: string | undefined;
    try {
      open = sortWindows(await windows(s.backend));
    } catch (e) {
      if (!(e instanceof NoBackend)) error = (e as Error).message;
    }
    const installed = await apps();
    const suggested = uniqueName(all.length ? "Layout" : "Work", all.map((l) => l.name));
    status = `${BACKEND_NAMES[s.backend]} · ${summary(open)} open`;
    const save: Item = {
      id: "save",
      title: "Save Current Windows…",
      subtitle: error ?? (open.length ? appsLine(open) : "No window open: a layout of extras only"),
      icon: { source: Icons.download, tint: "green" },
      section: "Save",
      keywords: ["save", "new", "sauvegarder", "nouveau"],
      accessories: [{ text: summary(open), color: "gray" }],
      detail: {
        markdown: windowsMarkdown(
          open.map((w) => ({ ...w, command: resolveApp(w.appId, installed)?.exec })),
        ),
        metadata: [
          meta.text("Backend", BACKEND_NAMES[s.backend], { icon: Icons.monitor }),
          meta.text("Saved", "App, workspace, and size and place where the compositor allows", { icon: Icons.info }),
        ],
      },
      actions: [action("Save Current Windows…", () => saveForm(suggested), { icon: Icons.download })],
    };
    return [
      ...saved,
      save,
      ...open.map((w) => currentItem(w, resolveApp(w.appId, installed)?.exec, s)),
    ];
  },
});
