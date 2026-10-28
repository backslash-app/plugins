// Talking to the compositor: detection, workspaces, and running an action on
// the window the user was in before opening the launcher.
//
// Extensions aren't told which window that was. So every action runs from a
// short-lived background job (systemd-run) a moment after the launcher has
// hidden, when the focus is back on that window. GNOME is the exception: the
// Window Calls extension lists windows in stacking order, so the target is
// the topmost window under the launcher and is acted on right away.

import { exec } from "@backslash/api";
import {
  type Backend,
  candidates,
  centered,
  delayedScript,
  type Env,
  gdbusNumber,
  gnomeDetails,
  gnomeTarget,
  gvariantString,
  hyprActiveMonitor,
  hyprArea,
  hyprBatch,
  hyprWorkspaces,
  isTile,
  kwinDesktops,
  kwinShortcut,
  kwinShortcutLine,
  numbered,
  osFamily,
  parseRect,
  q,
  type Rect,
  region,
  SESSION_ENV,
  swayArea,
  swayCommand,
  swayWorkspaces,
  systemdRunArgs,
  type WindowAction,
  wmctrlDesktops,
  type Workspace,
  x11Lines,
  xrandrMonitors,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key) || undefined;
  } catch {
    return undefined;
  }
};

export const sessionEnv = (): Env => Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)]));

const missing = (e: unknown) =>
  e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied ||
  e instanceof Deno.errors.NotCapable;

const GNOME_DEST = ["--dest", "org.gnome.Shell", "--object-path", "/org/gnome/Shell/Extensions/Windows"];

function gnomeCall(method: string, ...args: (string | number)[]): Promise<string> {
  return exec("gdbus", [
    "call",
    "--session",
    "--timeout",
    "2",
    ...GNOME_DEST,
    "--method",
    `org.gnome.Shell.Extensions.Windows.${method}`,
    ...args.map(String),
  ]);
}

function kwinProperty(name: string): Promise<string> {
  return exec("gdbus", [
    "call",
    "--session",
    "--timeout",
    "2",
    "--dest",
    "org.kde.KWin",
    "--object-path",
    "/VirtualDesktopManager",
    "--method",
    "org.freedesktop.DBus.Properties.Get",
    "org.kde.KWin.VirtualDesktopManager",
    name,
  ]);
}

/** Whether the backend answers here. */
async function works(b: Backend): Promise<boolean> {
  try {
    switch (b) {
      case "hyprland":
        await exec("hyprctl", ["-j", "version"]);
        return true;
      case "sway":
        await exec("swaymsg", ["-t", "get_version"]);
        return true;
      case "kde":
        await exec("gdbus", [
          "call",
          "--session",
          "--timeout",
          "2",
          "--dest",
          "org.kde.kglobalaccel",
          "--object-path",
          "/component/kwin",
          "--method",
          "org.kde.kglobalaccel.Component.shortcutNames",
        ]);
        return true;
      case "gnome":
        await gnomeCall("List");
        return true;
      case "x11":
        await exec("wmctrl", ["-m"]);
        return true;
    }
  } catch (e) {
    if (missing(e)) return false;
    return false;
  }
}

export interface Session {
  backend?: Backend;
  /** Backends this desktop would use, for the empty state. */
  wanted: Backend[];
  env: Env;
}

export async function detect(): Promise<Session> {
  const e = sessionEnv();
  const wanted = candidates(e);
  for (const b of wanted) {
    if (await works(b)) return { backend: b, wanted, env: e };
  }
  return { wanted, env: e };
}

export async function family() {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

// ---------------------------------------------------------------------------
// Workspaces

export async function workspaces(b: Backend): Promise<Workspace[]> {
  switch (b) {
    case "hyprland": {
      const [list, active] = await Promise.all([
        exec("hyprctl", ["-j", "workspaces"]),
        exec("hyprctl", ["-j", "activeworkspace"]),
      ]);
      return numbered(hyprWorkspaces(list, active));
    }
    case "sway":
      return numbered(swayWorkspaces(await exec("swaymsg", ["-t", "get_workspaces", "-r"])));
    case "kde": {
      const [desktops, current] = await Promise.all([kwinProperty("desktops"), kwinProperty("current")]);
      const found = kwinDesktops(desktops, current);
      if (found.length) return found;
      const count = gdbusNumber(await kwinProperty("count")) ?? 4;
      return numbered([], count);
    }
    case "gnome": {
      // Window Calls doesn't tell which workspace is active; GNOME's settings say how many there are.
      const dynamic = await exec("gsettings", ["get", "org.gnome.mutter", "dynamic-workspaces"]).catch(() => "true");
      const count = dynamic === "false"
        ? Number(
          await exec("gsettings", ["get", "org.gnome.desktop.wm.preferences", "num-workspaces"])
            .catch(() => "4"),
        ) || 4
        : 4;
      return numbered([], count);
    }
    case "x11": {
      const { workspaces } = wmctrlDesktops(await exec("wmctrl", ["-d"]));
      return workspaces;
    }
  }
}

// ---------------------------------------------------------------------------
// Running actions

/** Starts the script in the background once the launcher has hidden. */
async function detach(s: Session, lines: string[], delayMs: number) {
  const script = delayedScript(lines, delayMs);
  try {
    await exec("systemd-run", systemdRunArgs(`backslash-window-${Date.now()}`, script, s.env));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error("systemd-run is needed to act on your window once the launcher has hidden");
    }
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: window actions run in the background with systemd-run --user");
    }
    throw e;
  }
}

async function hyprAreaNow(): Promise<Rect | undefined> {
  const [monitors, active] = await Promise.all([
    exec("hyprctl", ["-j", "monitors"]),
    exec("hyprctl", ["-j", "activewindow"]).catch(() => ""),
  ]);
  return hyprArea(monitors, hyprActiveMonitor(active));
}

async function x11Setup() {
  const [desktops, monitors] = await Promise.all([
    exec("wmctrl", ["-d"]),
    exec("xrandr", ["--listactivemonitors"]).catch(() => ""),
  ]);
  return { workarea: wmctrlDesktops(desktops).workarea, monitors: xrandrMonitors(monitors) };
}

/** The shell lines doing `a` on the focused window, prepared before the launcher hides. */
async function linesFor(s: Session, a: WindowAction): Promise<string[]> {
  switch (s.backend) {
    case "hyprland": {
      const area = isTile(a) ? await hyprAreaNow() : undefined;
      return [`hyprctl --batch ${q(hyprBatch(a, area))} >/dev/null`];
    }
    case "sway": {
      const area = isTile(a) || a === "maximize"
        ? swayArea(await exec("swaymsg", ["-t", "get_workspaces", "-r"]))
        : undefined;
      return [`swaymsg ${q(swayCommand(a, area))} >/dev/null`];
    }
    case "kde":
      return [kwinShortcutLine(kwinShortcut(a))];
    case "x11": {
      const { monitors, workarea } = await x11Setup();
      return x11Lines(a, monitors, workarea);
    }
    default:
      throw new Error("No window manager to talk to");
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gnomeWindow(): Promise<number> {
  const id = gnomeTarget(gvariantString(await gnomeCall("List")));
  if (id === undefined) throw new Error("No window to act on");
  return id;
}

/** GNOME: the target is known, so act at once through Window Calls. */
async function gnomeAct(a: WindowAction) {
  const id = await gnomeWindow();
  switch (a) {
    case "maximize":
      await gnomeCall("Maximize", id);
      return;
    case "minimize":
      await gnomeCall("Minimize", id);
      return;
    case "close":
      await gnomeCall("Close", id);
      return;
    case "fullscreen":
      throw new Error("GNOME's Window Calls extension can't make a window fullscreen: press F11 in the app");
    case "float":
      throw new Error("Floating only means something in a tiling window manager");
  }
  const details = gnomeDetails(gvariantString(await gnomeCall("Details", id)));
  let area = details.area;
  if (!area) {
    // Older Window Calls: a maximized window's frame is the work area.
    await gnomeCall("Maximize", id);
    await sleep(200);
    area = parseRect(gvariantString(await gnomeCall("GetFrameRect", id)));
  }
  if (!area) throw new Error("GNOME didn't tell the size of the screen: update the Window Calls extension");
  if (details.maximized || !details.area) await gnomeCall("Unmaximize", id);
  const r = a === "center"
    ? centered(
      area,
      details.frame?.width ?? Math.round(area.width * 0.6),
      details.frame?.height ?? Math.round(area.height * 0.6),
    )
    : region(area, a);
  await gnomeCall("MoveResize", id, r.x, r.y, r.width, r.height);
}

/** Does `a` to the window the user was in. */
export async function act(s: Session, a: WindowAction, delayMs: number): Promise<void> {
  if (!s.backend) throw new Error("No supported window manager found");
  if (s.backend === "gnome") return await gnomeAct(a);
  await detach(s, await linesFor(s, a), delayMs);
}

/** Moves the window to workspace `n` and follows it. */
export async function moveTo(s: Session, n: number, delayMs: number, follow = true): Promise<void> {
  switch (s.backend) {
    case "hyprland":
      return await detach(s, [
        `hyprctl dispatch ${follow ? "movetoworkspace" : "movetoworkspacesilent"} ${n} >/dev/null`,
      ], delayMs);
    case "sway":
      return await detach(
        s,
        [`swaymsg ${
          q(`move container to workspace number ${n}${follow ? `, workspace number ${n}` : ""}`)
        } >/dev/null`],
        delayMs,
      );
    case "kde":
      return await detach(
        s,
        [
          kwinShortcutLine(kwinShortcut({ move: n })),
          ...(follow ? [kwinShortcutLine(kwinShortcut({ switch: n }))] : []),
        ],
        delayMs,
      );
    case "x11":
      return await detach(s, [`wmctrl -r :ACTIVE: -t ${n - 1}`, ...(follow ? [`wmctrl -s ${n - 1}`] : [])], delayMs);
    case "gnome": {
      const id = await gnomeWindow();
      await gnomeCall("MoveToWorkspace", id, n - 1);
      if (follow) await gnomeCall("Activate", id);
      return;
    }
    default:
      throw new Error("No supported window manager found");
  }
}

/** Shows workspace `n`. Nothing depends on the focused window, so it runs right away. */
export async function switchTo(s: Session, n: number): Promise<void> {
  switch (s.backend) {
    case "hyprland":
      await exec("hyprctl", ["dispatch", "workspace", String(n)]);
      return;
    case "sway":
      await exec("swaymsg", [`workspace number ${n}`]);
      return;
    case "kde":
      return await detach(s, [kwinShortcutLine(kwinShortcut({ switch: n }))], 0);
    case "x11":
      await exec("wmctrl", ["-s", String(n - 1)]);
      return;
    case "gnome":
      throw new Error("GNOME doesn't let apps switch workspaces on Wayland: use Super+Page Up/Down");
    default:
      throw new Error("No supported window manager found");
  }
}
