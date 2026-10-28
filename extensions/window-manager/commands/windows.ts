import {
  type Action,
  action,
  close,
  type Context,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  submenu,
  updateCommandMetadata,
} from "@backslash/api";
import {
  type ActionInfo,
  ACTIONS,
  type Backend,
  BACKEND_NAMES,
  type Family,
  installMarkdown,
  preview,
  supports,
  type Workspace,
} from "../lib.ts";
import { delayOf } from "../perform.ts";
import { act, detect, family, moveTo, type Session, switchTo, workspaces } from "../system.ts";

const WINDOW_CALLS = "https://extensions.gnome.org/extension/4724/window-calls/";

function workspaceActions(s: Session, ws: Workspace[], delay: number): Action[] {
  const out: Action[] = [
    submenu(
      "Move Window to Workspace",
      () =>
        ws.map((w) =>
          action(label(w), async () => {
            await moveTo(s, w.num, delay);
            return close();
          }, { icon: Icons.arrowRight })
        ),
      { icon: Icons.arrowRight, shortcut: "<Ctrl>m", section: "Workspaces" },
    ),
  ];
  if (supports(s.backend!, "switch")) {
    out.push(submenu(
      "Switch to Workspace",
      () =>
        ws.map((w) =>
          action(label(w), async () => {
            await switchTo(s, w.num);
            return close();
          }, { icon: w.active ? Icons.check : Icons.square })
        ),
      { icon: Icons.layers, shortcut: "<Ctrl>w", section: "Workspaces" },
    ));
  }
  return out;
}

const label = (w: Workspace) =>
  `${w.name && w.name !== String(w.num) ? `${w.num} · ${w.name}` : `Workspace ${w.num}`}${
    w.active ? " (current)" : ""
  }`;

function actionItem(info: ActionInfo, s: Session, ws: Workspace[], delay: number): Item {
  const tint = info.section === "Snap" ? "blue" : info.id === "close" ? "red" : "purple";
  const pic = preview(info.id);
  return {
    id: info.id,
    title: info.title,
    icon: { source: info.icon, tint },
    section: info.section,
    keywords: [...info.keywords, "window", "fenêtre"],
    accessories: [{ text: info.command, color: "gray", tooltip: "Also a command of its own: give it a hotkey" }],
    detail: {
      markdown: `${pic ? `${pic}\n\n` : ""}${info.about}`,
      metadata: [
        meta.text("Acts on", "The window you were in", { icon: Icons.window }),
        meta.text("Backend", BACKEND_NAMES[s.backend!], { icon: Icons.monitor }),
        meta.text("Command", info.command, { icon: Icons.keyboard }),
        ...(s.backend === "hyprland" && (info.section === "Snap" || info.id === "center")
          ? [meta.text("Note", "Makes a tiled window float", { icon: Icons.info })]
          : []),
      ],
    },
    actions: [
      action(info.title, async () => {
        await act(s, info.id, delay);
        return close();
      }, { icon: info.icon, destructive: info.id === "close" }),
      ...workspaceActions(s, ws, delay),
    ],
  };
}

function workspaceItem(w: Workspace, s: Session, delay: number): Item {
  const canSwitch = supports(s.backend!, "switch");
  const actions: Action[] = [];
  if (canSwitch) {
    actions.push(action("Switch to Workspace", async () => {
      await switchTo(s, w.num);
      return close();
    }, { icon: Icons.layers }));
  }
  actions.push(
    action("Move Window Here", async () => {
      await moveTo(s, w.num, delay);
      return close();
    }, { icon: Icons.arrowRight }),
  );
  if (s.backend !== "gnome") {
    actions.push(action("Send Window Here and Stay", async () => {
      await moveTo(s, w.num, delay, false);
      return close();
    }, { icon: Icons.upload }));
  }
  actions.push(action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }));
  const windows = w.windows === undefined
    ? undefined
    : w.windows === 0
    ? "Empty"
    : `${w.windows} window${w.windows === 1 ? "" : "s"}`;
  return {
    id: `ws:${w.num}`,
    title: label(w).replace(" (current)", ""),
    subtitle: windows,
    icon: { source: Icons.layers, tint: w.active ? "green" : w.windows ? "blue" : "gray" },
    section: "Workspaces",
    keywords: ["workspace", "espace de travail", "bureau", "desktop", String(w.num)],
    accessories: [
      ...(w.output ? [{ text: w.output, icon: Icons.monitor }] : []),
      ...(w.active ? [{ tag: "Current", color: "green" as const }] : []),
    ],
    detail: {
      stats: [
        { label: "Workspace", value: w.num },
        ...(w.windows !== undefined ? [{ label: "Windows", value: w.windows }] : []),
      ],
      metadata: [
        meta.text("Name", w.name || String(w.num)),
        meta.text("State", w.active ? "Current" : w.windows ? "In use" : "Empty", {
          color: w.active ? "green" : "gray",
          icon: w.active ? Icons.check : Icons.dottedCircle,
        }),
        ...(w.output ? [meta.text("Monitor", w.output, { icon: Icons.monitor })] : []),
        meta.separator(),
        meta.text("Enter", canSwitch ? "Switch to it" : "Move the window here", { icon: Icons.keyboard }),
      ],
    },
    actions,
  };
}

function setupItems(s: Session, fam?: Family): Item[] {
  const need = (b: Backend): Item => {
    const what: Record<Backend, { title: string; md: string; actions: Action[] }> = {
      hyprland: {
        title: "hyprctl doesn't answer",
        md:
          "Backslash talks to Hyprland with `hyprctl`, which ships with it. Make sure the launcher runs inside your Hyprland session (`HYPRLAND_INSTANCE_SIGNATURE` set).",
        actions: [],
      },
      sway: {
        title: "swaymsg doesn't answer",
        md:
          "Backslash talks to Sway with `swaymsg`, which ships with it. Make sure the launcher runs inside your Sway session (`SWAYSOCK` set).",
        actions: [],
      },
      kde: {
        title: "KWin's shortcuts can't be reached",
        md: installMarkdown(
          "Backslash invokes KWin's own window shortcuts over D-Bus with **gdbus**.",
          [fam === "arch" ? "glib2" : fam === "debian" ? "libglib2.0-bin" : "glib2"],
          fam,
        ),
        actions: [],
      },
      gnome: {
        title: "Install the Window Calls extension",
        md:
          "GNOME on Wayland lets apps move windows only through a Shell extension. Install **Window Calls** (by ickyicky), log out and back in, then open this command again.",
        actions: [open(WINDOW_CALLS, "Open Window Calls on extensions.gnome.org", { icon: Icons.globe })],
      },
      x11: {
        title: "Install wmctrl and xdotool",
        md: installMarkdown(
          "On X11, Backslash moves windows with **wmctrl** and finds their size with **xdotool**.",
          ["wmctrl", "xdotool"],
          fam,
        ),
        actions: [],
      },
    };
    const w = what[b];
    return {
      id: `setup:${b}`,
      title: w.title,
      subtitle: BACKEND_NAMES[b],
      icon: { source: Icons.alert, tint: "orange" },
      section: "Setup",
      detail: {
        markdown: w.md,
        metadata: [meta.tags("Supported", ["Hyprland", "Sway", "KDE Plasma", "GNOME + Window Calls", "X11"])],
      },
      actions: [...w.actions, action("Check Again", () => refresh(), { icon: Icons.refresh })],
    };
  };
  if (s.wanted.length) return s.wanted.map(need);
  return [{
    id: "setup:none",
    title: "No supported window manager",
    subtitle: "Hyprland, Sway, KDE Plasma, GNOME or X11",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown:
        "Backslash couldn't tell which desktop this is (`XDG_CURRENT_DESKTOP`, `WAYLAND_DISPLAY` and `DISPLAY` are empty or unknown).",
      metadata: [meta.tags("Supported", ["Hyprland", "Sway", "KDE Plasma", "GNOME + Window Calls", "X11"])],
    },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  }];
}

let summary = "";

export default (ctx: Context) =>
  list({
    placeholder: "Snap, maximize, move to a workspace…",
    empty: { title: "Nothing matches", icon: Icons.window },
    status: () => summary,
    async items() {
      const delay = delayOf(ctx);
      const s = await detect();
      if (!s.backend) {
        summary = "No window manager found";
        return setupItems(s, await family());
      }
      const ws = await workspaces(s.backend).catch(() => [] as Workspace[]);
      const current = ws.find((w) => w.active);
      summary = `${BACKEND_NAMES[s.backend]}${current ? ` · workspace ${current.num}` : ""}${
        ws.length ? ` · ${ws.length} workspaces` : ""
      } · acts on the window you were in`;
      updateCommandMetadata({ subtitle: current ? `Workspace ${current.name || current.num}` : null }).catch(() => {});
      return [
        ...ACTIONS.filter((a) => supports(s.backend!, a.id)).map((a) => actionItem(a, s, ws, delay)),
        ...ws.map((w) => workspaceItem(w, s, delay)),
      ];
    },
  });
