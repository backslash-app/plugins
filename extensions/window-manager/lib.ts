// Window geometry, compositor output parsing and the command lines that act
// on the focused window. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Session

export type Backend = "hyprland" | "sway" | "kde" | "gnome" | "x11";

export type Env = Partial<Record<string, string>>;

/** The environment variables we look at, and pass on to the background job. */
export const SESSION_ENV = [
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "XAUTHORITY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "SWAYSOCK",
  "DBUS_SESSION_BUS_ADDRESS",
] as const;

/** Backends worth trying in this session, best first. Each is confirmed by talking to it. */
export function candidates(env: Env): Backend[] {
  const desktop = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":");
  const type = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const wayland = type === "wayland" || (!!env.WAYLAND_DISPLAY && type !== "x11");
  const out: Backend[] = [];
  if (env.HYPRLAND_INSTANCE_SIGNATURE || desktop.includes("hyprland")) out.push("hyprland");
  if (env.SWAYSOCK || desktop.includes("sway")) out.push("sway");
  if (desktop.includes("kde")) out.push("kde");
  // On GNOME under X11, wmctrl does more than the Shell extension (fullscreen, workspaces).
  const gnome = desktop.some((d) => ["gnome", "ubuntu", "unity", "pop"].includes(d));
  if (gnome && wayland) out.push("gnome");
  if (env.DISPLAY && !wayland) out.push("x11");
  if (gnome && !wayland) out.push("gnome");
  return out;
}

export const BACKEND_NAMES: Record<Backend, string> = {
  hyprland: "Hyprland",
  sway: "Sway",
  kde: "KDE Plasma (KWin)",
  gnome: "GNOME (Window Calls)",
  x11: "X11 (wmctrl)",
};

// ---------------------------------------------------------------------------
// Actions

export type Tile = "left" | "right" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export type WindowAction = Tile | "maximize" | "center" | "fullscreen" | "float" | "minimize" | "close";

export interface ActionInfo {
  id: WindowAction;
  title: string;
  /** The no-view command with the same effect, for the shortcut hint. */
  command: string;
  icon: string;
  section: "Snap" | "Window";
  about: string;
  keywords: string[];
}

export const ACTIONS: ActionInfo[] = [
  {
    id: "left",
    title: "Left Half",
    command: "left-half",
    icon: "bs-window",
    section: "Snap",
    about: "Fills the left half of the screen.",
    keywords: ["tile", "snap", "gauche", "moitié"],
  },
  {
    id: "right",
    title: "Right Half",
    command: "right-half",
    icon: "bs-window",
    section: "Snap",
    about: "Fills the right half of the screen.",
    keywords: ["tile", "snap", "droite", "moitié"],
  },
  {
    id: "top",
    title: "Top Half",
    command: "top-half",
    icon: "bs-window",
    section: "Snap",
    about: "Fills the top half of the screen.",
    keywords: ["tile", "snap", "haut", "moitié"],
  },
  {
    id: "bottom",
    title: "Bottom Half",
    command: "bottom-half",
    icon: "bs-window",
    section: "Snap",
    about: "Fills the bottom half of the screen.",
    keywords: ["tile", "snap", "bas", "moitié"],
  },
  {
    id: "top-left",
    title: "Top Left Quarter",
    command: "top-left",
    icon: "bs-window",
    section: "Snap",
    about: "Fills the top left quarter of the screen.",
    keywords: ["tile", "corner", "coin", "quart", "haut gauche"],
  },
  {
    id: "top-right",
    title: "Top Right Quarter",
    command: "top-right",
    icon: "bs-window",
    section: "Snap",
    about: "Fills the top right quarter of the screen.",
    keywords: ["tile", "corner", "coin", "quart", "haut droite"],
  },
  {
    id: "bottom-left",
    title: "Bottom Left Quarter",
    command: "bottom-left",
    icon: "bs-window",
    section: "Snap",
    about: "Fills the bottom left quarter of the screen.",
    keywords: ["tile", "corner", "coin", "quart", "bas gauche"],
  },
  {
    id: "bottom-right",
    title: "Bottom Right Quarter",
    command: "bottom-right",
    icon: "bs-window",
    section: "Snap",
    about: "Fills the bottom right quarter of the screen.",
    keywords: ["tile", "corner", "coin", "quart", "bas droite"],
  },
  {
    id: "maximize",
    title: "Maximize",
    command: "maximize",
    icon: "bs-monitor",
    section: "Window",
    about: "Fills the screen, panels and bars excepted.",
    keywords: ["maximise", "agrandir", "plein", "fill"],
  },
  {
    id: "center",
    title: "Center",
    command: "center",
    icon: "bs-dot",
    section: "Window",
    about: "Moves the window to the middle of the screen, keeping its size.",
    keywords: ["centrer", "middle", "milieu"],
  },
  {
    id: "fullscreen",
    title: "Toggle Fullscreen",
    command: "fullscreen",
    icon: "bs-monitor",
    section: "Window",
    about: "Covers the whole screen, bars included. Run it again to leave fullscreen.",
    keywords: ["plein écran", "full screen", "kiosk"],
  },
  {
    id: "float",
    title: "Toggle Floating",
    command: "toggle-floating",
    icon: "bs-layers",
    section: "Window",
    about: "Takes the window out of the tiling layout, or puts it back.",
    keywords: ["float", "flottant", "tiling", "pseudo"],
  },
  {
    id: "minimize",
    title: "Minimize",
    command: "minimize",
    icon: "bs-minus",
    section: "Window",
    about: "Hides the window to the taskbar or dock.",
    keywords: ["minimise", "réduire", "hide", "cacher"],
  },
  {
    id: "close",
    title: "Close Window",
    command: "close-window",
    icon: "bs-x",
    section: "Window",
    about: "Asks the window to close, as its close button does.",
    keywords: ["fermer", "kill", "quit", "quitter"],
  },
];

export const actionInfo = (id: WindowAction) => ACTIONS.find((a) => a.id === id)!;

/** What each backend can do. */
export function supports(backend: Backend, a: WindowAction | "switch" | "move"): boolean {
  if (a === "float") return backend === "hyprland" || backend === "sway";
  if (a === "minimize") return backend !== "hyprland" && backend !== "sway";
  if (a === "fullscreen") return backend !== "gnome";
  if (a === "switch") return backend !== "gnome";
  return true;
}

// ---------------------------------------------------------------------------
// Geometry

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The part of the work area a tile (or maximize) covers. */
export function region(area: Rect, a: Tile | "maximize"): Rect {
  const w1 = Math.floor(area.width / 2);
  const h1 = Math.floor(area.height / 2);
  const left = { x: area.x, width: w1 };
  const right = { x: area.x + w1, width: area.width - w1 };
  const full = { x: area.x, width: area.width };
  const top = { y: area.y, height: h1 };
  const bottom = { y: area.y + h1, height: area.height - h1 };
  const all = { y: area.y, height: area.height };
  switch (a) {
    case "left":
      return { ...left, ...all };
    case "right":
      return { ...right, ...all };
    case "top":
      return { ...full, ...top };
    case "bottom":
      return { ...full, ...bottom };
    case "top-left":
      return { ...left, ...top };
    case "top-right":
      return { ...right, ...top };
    case "bottom-left":
      return { ...left, ...bottom };
    case "bottom-right":
      return { ...right, ...bottom };
    case "maximize":
      return { ...area };
  }
}

/** A window of this size in the middle of the area. */
export function centered(area: Rect, width: number, height: number): Rect {
  const w = Math.min(width, area.width);
  const h = Math.min(height, area.height);
  return {
    x: area.x + Math.round((area.width - w) / 2),
    y: area.y + Math.round((area.height - h) / 2),
    width: w,
    height: h,
  };
}

export const isTile = (a: WindowAction): a is Tile =>
  ["left", "right", "top", "bottom", "top-left", "top-right", "bottom-left", "bottom-right"].includes(a);

/** A small picture of the screen with the covered part filled, for the detail panel. */
export function preview(a: WindowAction): string {
  const W = 24;
  const H = 8;
  const r = isTile(a) || a === "maximize"
    ? region({ x: 0, y: 0, width: W, height: H }, a as Tile | "maximize")
    : a === "center"
    ? centered({ x: 0, y: 0, width: W, height: H }, 12, 4)
    : a === "fullscreen"
    ? { x: 0, y: 0, width: W, height: H }
    : undefined;
  if (!r) return "";
  const rows: string[] = [];
  for (let y = 0; y < H; y++) {
    let line = "";
    for (let x = 0; x < W; x++) {
      line += x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height ? "█" : "░";
    }
    rows.push(line);
  }
  return "```\n" + rows.join("\n") + "\n```";
}

// ---------------------------------------------------------------------------
// Workspaces

export interface Workspace {
  /** The number used to switch to it. */
  num: number;
  name: string;
  active: boolean;
  /** Windows on it, when known. */
  windows?: number;
  /** The output it is on, when known. */
  output?: string;
}

/** Workspaces 1…n, filled with what the compositor reports; dynamic ones up to `min`. */
export function numbered(known: Workspace[], min = 9): Workspace[] {
  const byNum = new Map(known.filter((w) => w.num > 0).map((w) => [w.num, w]));
  const max = Math.max(min, ...byNum.keys());
  const out: Workspace[] = [];
  for (let n = 1; n <= max; n++) {
    out.push(byNum.get(n) ?? { num: n, name: String(n), active: false, windows: 0 });
  }
  return out;
}

/** `hyprctl -j workspaces` + `hyprctl -j activeworkspace` (special workspaces left out). */
export function hyprWorkspaces(workspacesJson: string, activeJson: string): Workspace[] {
  const active = (JSON.parse(activeJson || "{}") as { id?: number }).id;
  const list = JSON.parse(workspacesJson) as { id: number; name: string; windows?: number; monitor?: string }[];
  return list
    .filter((w) => w.id > 0)
    .map((w) => ({ num: w.id, name: w.name, active: w.id === active, windows: w.windows, output: w.monitor }))
    .sort((a, b) => a.num - b.num);
}

/** `swaymsg -t get_workspaces -r`. */
export function swayWorkspaces(json: string): Workspace[] {
  const list = JSON.parse(json) as { num: number; name: string; focused: boolean; output?: string }[];
  return list
    .filter((w) => w.num > 0)
    .map((w) => ({ num: w.num, name: w.name, active: w.focused, output: w.output }))
    .sort((a, b) => a.num - b.num);
}

/** `wmctrl -d`: desktops, and the work area of the current one. */
export function wmctrlDesktops(text: string): { workspaces: Workspace[]; workarea?: Rect } {
  const workspaces: Workspace[] = [];
  let workarea: Rect | undefined;
  for (const line of text.split("\n")) {
    const m = line.match(/^(\d+)\s+([*-])\s+DG:\s*\S+\s+VP:\s*\S+\s+WA:\s*(-?\d+),(-?\d+)\s+(\d+)x(\d+)\s+(.*)$/);
    if (!m) continue;
    const active = m[2] === "*";
    workspaces.push({ num: Number(m[1]) + 1, name: m[7].trim() || `Workspace ${Number(m[1]) + 1}`, active });
    if (active) workarea = { x: +m[3], y: +m[4], width: +m[5], height: +m[6] };
  }
  return { workspaces, workarea };
}

/** `gdbus … VirtualDesktopManager desktops` and `current` (KWin, Plasma 5.25+). */
export function kwinDesktops(desktopsOut: string, currentOut: string): Workspace[] {
  const current = currentOut.match(/'([^']*)'/)?.[1];
  const out: Workspace[] = [];
  for (const m of desktopsOut.matchAll(/\('([^']*)',\s*(?:uint32\s+)?(\d+),\s*'((?:[^'\\]|\\.)*)'\)/g)) {
    out.push({ num: Number(m[2]) + 1, name: m[3].replace(/\\(.)/g, "$1"), active: m[1] === current });
  }
  return out.sort((a, b) => a.num - b.num);
}

/** A number from gdbus output such as `(<uint32 4>,)` or `(4,)`. */
export function gdbusNumber(out: string): number | undefined {
  const m = out.match(/(?:u?int\d+\s+)?(-?\d+)/);
  return m ? Number(m[1]) : undefined;
}

// ---------------------------------------------------------------------------
// Hyprland

interface HyprMonitor {
  id: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  scale?: number;
  transform?: number;
  focused?: boolean;
  reserved?: [number, number, number, number];
  activeWorkspace?: { id: number };
}

/** The usable area of a monitor from `hyprctl -j monitors` (logical pixels, bars excepted). */
export function hyprArea(monitorsJson: string, monitorId?: number): Rect | undefined {
  const monitors = JSON.parse(monitorsJson) as HyprMonitor[];
  const m = monitors.find((m) => monitorId !== undefined && m.id === monitorId) ?? monitors.find((m) => m.focused) ??
    monitors[0];
  if (!m) return undefined;
  const scale = m.scale || 1;
  const rotated = (m.transform ?? 0) % 2 === 1;
  const w = Math.round((rotated ? m.height : m.width) / scale);
  const h = Math.round((rotated ? m.width : m.height) / scale);
  const [l, t, r, b] = m.reserved ?? [0, 0, 0, 0];
  return { x: m.x + l, y: m.y + t, width: w - l - r, height: h - t - b };
}

/** The monitor of the focused window from `hyprctl -j activewindow`, unless it is the launcher. */
export function hyprActiveMonitor(json: string): number | undefined {
  try {
    const w = JSON.parse(json) as { monitor?: number; class?: string };
    if (typeof w.monitor !== "number" || /backslash/i.test(w.class ?? "")) return undefined;
    return w.monitor;
  } catch {
    return undefined;
  }
}

/** `hyprctl --batch` argument for an action on the active window. */
export function hyprBatch(a: WindowAction, area?: Rect): string {
  const d = (s: string) => `dispatch ${s}`;
  if (isTile(a)) {
    if (!area) throw new Error("Unknown screen size");
    const r = region(area, a);
    return [
      d("setfloating"),
      d(`resizeactive exact ${r.width} ${r.height}`),
      d(`moveactive exact ${r.x} ${r.y}`),
    ].join(" ; ");
  }
  switch (a) {
    case "maximize":
      return d("fullscreen 1");
    case "fullscreen":
      return d("fullscreen 0");
    case "center":
      return [d("setfloating"), d("centerwindow 1")].join(" ; ");
    case "float":
      return d("togglefloating");
    case "close":
      return d("killactive");
    default:
      throw new Error(`${actionInfo(a).title} isn't available on Hyprland`);
  }
}

// ---------------------------------------------------------------------------
// Sway

/** The focused workspace's usable rectangle from `swaymsg -t get_workspaces -r` (bars excepted). */
export function swayArea(json: string): Rect | undefined {
  const list = JSON.parse(json) as { focused: boolean; rect: Rect }[];
  return (list.find((w) => w.focused) ?? list[0])?.rect;
}

/** A `swaymsg` command for an action on the focused window. */
export function swayCommand(a: WindowAction, area?: Rect): string {
  if (isTile(a) || a === "maximize") {
    if (!area) throw new Error("Unknown screen size");
    const r = region(area, a);
    return `floating enable, resize set width ${r.width} px height ${r.height} px, move absolute position ${r.x} px ${r.y} px`;
  }
  switch (a) {
    case "fullscreen":
      return "fullscreen toggle";
    case "center":
      return "floating enable, move position center";
    case "float":
      return "floating toggle";
    case "close":
      return "kill";
    default:
      throw new Error(`${actionInfo(a).title} isn't available on Sway`);
  }
}

// ---------------------------------------------------------------------------
// KDE Plasma: KWin's own global shortcuts, invoked over D-Bus

export function kwinShortcut(a: WindowAction | { move: number } | { switch: number }): string {
  if (typeof a === "object") return "move" in a ? `Window to Desktop ${a.move}` : `Switch to Desktop ${a.switch}`;
  const names: Partial<Record<WindowAction, string>> = {
    left: "Window Quick Tile Left",
    right: "Window Quick Tile Right",
    top: "Window Quick Tile Top",
    bottom: "Window Quick Tile Bottom",
    "top-left": "Window Quick Tile Top Left",
    "top-right": "Window Quick Tile Top Right",
    "bottom-left": "Window Quick Tile Bottom Left",
    "bottom-right": "Window Quick Tile Bottom Right",
    maximize: "Window Maximize",
    center: "Window Move Center",
    fullscreen: "Window Fullscreen",
    minimize: "Window Minimize",
    close: "Window Close",
  };
  const name = names[a];
  if (!name) throw new Error(`${actionInfo(a).title} isn't available on KDE Plasma`);
  return name;
}

/** Shell line invoking a KWin shortcut, with gdbus or one of the qdbus spellings. */
export function kwinShortcutLine(name: string): string {
  const n = q(name);
  return [
    `gdbus call --session --dest org.kde.kglobalaccel --object-path /component/kwin --method org.kde.kglobalaccel.Component.invokeShortcut ${n}`,
    `qdbus6 org.kde.kglobalaccel /component/kwin invokeShortcut ${n}`,
    `qdbus org.kde.kglobalaccel /component/kwin invokeShortcut ${n}`,
  ].map((l) => `${l} >/dev/null 2>&1`).join(" || ");
}

// ---------------------------------------------------------------------------
// X11: wmctrl + xdotool, computed in the background job once the window has the focus back

export interface Monitor extends Rect {
  name: string;
}

/** `xrandr --listactivemonitors`: ` 0: +*eDP-1 1920/344x1080/194+0+0  eDP-1`. */
export function xrandrMonitors(text: string): Monitor[] {
  const out: Monitor[] = [];
  for (const m of text.matchAll(/^\s*\d+:\s+\S+\s+(\d+)\/\d+x(\d+)\/\d+\+(-?\d+)\+(-?\d+)\s+(\S+)/gm)) {
    out.push({ width: +m[1], height: +m[2], x: +m[3], y: +m[4], name: m[5] });
  }
  return out;
}

/**
 * Shell lines that find the active window's monitor (the one under its
 * center), keep the part inside the desktop's work area (panels excepted),
 * then move it with wmctrl. Sets L T W H for the usable area, X Y WIDTH HEIGHT for the window.
 */
export function x11Lines(a: WindowAction, monitors: Monitor[], workarea?: Rect): string[] {
  const ACTIVE = "wmctrl -r :ACTIVE:";
  const unmax = `${ACTIVE} -b remove,maximized_vert,maximized_horz,fullscreen`;
  switch (a) {
    case "maximize":
      return [`${ACTIVE} -b remove,fullscreen`, `${ACTIVE} -b add,maximized_vert,maximized_horz`];
    case "fullscreen":
      return [`${ACTIVE} -b toggle,fullscreen`];
    case "close":
      return ["wmctrl -c :ACTIVE:"];
    case "minimize":
      return ["xdotool getactivewindow windowminimize"];
    case "float":
      throw new Error("Floating only means something in a tiling window manager");
  }
  const first = monitors[0] ?? workarea ?? { x: 0, y: 0, width: 1920, height: 1080 };
  const wa = workarea ?? first;
  const lines = [
    `eval "$(xdotool getactivewindow getwindowgeometry --shell 2>/dev/null)"`,
    `cx=$(( \${X:-0} + \${WIDTH:-0} / 2 )); cy=$(( \${Y:-0} + \${HEIGHT:-0} / 2 ))`,
    `MX=${first.x}; MY=${first.y}; MW=${first.width}; MH=${first.height}`,
    ...monitors.slice(1).map((m) =>
      `if [ $cx -ge ${m.x} ] && [ $cx -lt ${m.x + m.width} ] && [ $cy -ge ${m.y} ] && [ $cy -lt ${
        m.y + m.height
      } ]; then MX=${m.x}; MY=${m.y}; MW=${m.width}; MH=${m.height}; fi`
    ),
    // Panels: what the work area takes off this monitor.
    `L=$(( MX > ${wa.x} ? MX : ${wa.x} )); T=$(( MY > ${wa.y} ? MY : ${wa.y} ))`,
    `R=$(( MX + MW < ${wa.x + wa.width} ? MX + MW : ${wa.x + wa.width} )); B=$(( MY + MH < ${
      wa.y + wa.height
    } ? MY + MH : ${wa.y + wa.height} ))`,
    `W=$(( R - L )); H=$(( B - T ))`,
    unmax,
  ];
  if (a === "center") {
    return [...lines, `${ACTIVE} -e 0,$(( L + (W - \${WIDTH:-W}) / 2 )),$(( T + (H - \${HEIGHT:-H}) / 2 )),-1,-1`];
  }
  const geometry: Record<Tile, string> = {
    left: "$L,$T,$(( W / 2 )),$H",
    right: "$(( L + W / 2 )),$T,$(( W - W / 2 )),$H",
    top: "$L,$T,$W,$(( H / 2 ))",
    bottom: "$L,$(( T + H / 2 )),$W,$(( H - H / 2 ))",
    "top-left": "$L,$T,$(( W / 2 )),$(( H / 2 ))",
    "top-right": "$(( L + W / 2 )),$T,$(( W - W / 2 )),$(( H / 2 ))",
    "bottom-left": "$L,$(( T + H / 2 )),$(( W / 2 )),$(( H - H / 2 ))",
    "bottom-right": "$(( L + W / 2 )),$(( T + H / 2 )),$(( W - W / 2 )),$(( H - H / 2 ))",
  };
  return [...lines, `${ACTIVE} -e 0,${geometry[a as Tile]}`];
}

// ---------------------------------------------------------------------------
// GNOME: the "Window Calls" Shell extension

/** The string inside gdbus's `('…',)`, unescaped. */
export function gvariantString(out: string): string {
  const t = out.trim();
  const m = t.match(/^\((['"])([\s\S]*)\1,\)$/);
  if (!m) throw new Error(`Unexpected gdbus output: ${t.slice(0, 80)}`);
  return m[2].replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_, e: string) => {
    if (e[0] === "u" && e.length === 5) return String.fromCharCode(parseInt(e.slice(1), 16));
    if (e[0] === "x" && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    return ({ n: "\n", t: "\t", r: "\r" } as Record<string, string>)[e] ?? e;
  });
}

interface GnomeWindow {
  id: number;
  wm_class?: string;
  wm_class_instance?: string;
  focus?: boolean;
  window_type?: number;
  in_current_workspace?: boolean;
}

/**
 * The window the user was in, from Window Calls' `List` (in stacking order,
 * bottom to top): the focused one, or the topmost below the launcher.
 */
export function gnomeTarget(listJson: string): number | undefined {
  const all = (JSON.parse(listJson) as GnomeWindow[])
    .filter((w) => (w.window_type ?? 0) === 0 && w.in_current_workspace !== false);
  const others = all.filter((w) => !/backslash/i.test(`${w.wm_class ?? ""} ${w.wm_class_instance ?? ""}`));
  return (others.find((w) => w.focus) ?? others.at(-1))?.id;
}

const isRect = (r: any): r is Rect =>
  r && typeof r === "object" && [r.x, r.y, r.width, r.height].every((n) => typeof n === "number") && r.width > 0;

/** Work area and frame from Window Calls' `Details` (fields vary between versions). */
export function gnomeDetails(json: string): { area?: Rect; frame?: Rect; maximized: boolean } {
  const d = JSON.parse(json) as Record<string, any>;
  const frame = { x: d.x, y: d.y, width: d.width, height: d.height };
  return {
    area: [d.area, d.area_cust, d.work_area].find(isRect),
    frame: isRect(frame) ? frame : undefined,
    maximized: !!d.maximized,
  };
}

/** A JSON rectangle from Window Calls' `GetFrameRect`. */
export function parseRect(json: string): Rect | undefined {
  const r = JSON.parse(json);
  return isRect(r) ? r : undefined;
}

// ---------------------------------------------------------------------------
// Background job

export const q = (s: string) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;

/** The shell script run once the launcher is hidden. */
export function delayedScript(lines: string[], delayMs: number): string {
  const s = Math.max(0, delayMs) / 1000;
  return [...(s ? [`sleep ${s}`] : []), ...lines].join("\n");
}

/** `systemd-run` arguments to run a script in the background, outside the launcher. */
export function systemdRunArgs(unit: string, script: string, env: Env = {}): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${unit}`,
    "--description=Backslash: window action",
    "--collect",
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    script,
  ];
}

// ---------------------------------------------------------------------------
// What to install

export type Family = "arch" | "debian" | "fedora" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

const MANAGERS: Record<Family, [string, string]> = {
  arch: ["Arch", "sudo pacman -S"],
  debian: ["Debian, Ubuntu", "sudo apt install"],
  fedora: ["Fedora", "sudo dnf install"],
  suse: ["openSUSE", "sudo zypper install"],
};

export function installMarkdown(what: string, packages: string[], family?: Family): string {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  const lines = families.map((f) => `**${MANAGERS[f][0]}**\n\n\`${MANAGERS[f][1]} ${packages.join(" ")}\``);
  return `${what}\n\n${lines.join("\n\n")}`;
}
