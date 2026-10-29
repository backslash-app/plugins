// Window Layouts logic: compositor output parsing, .desktop lookups, matching
// saved windows to open ones and the commands that move them. Pure, tested in
// lib_test.ts.

// ---------------------------------------------------------------------------
// Session

export type Backend = "hyprland" | "sway" | "niri" | "kde" | "x11";

export type Env = Partial<Record<string, string>>;

/** The environment variables we look at, and pass on to the apps we start. */
export const SESSION_ENV = [
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "XAUTHORITY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "SWAYSOCK",
  "NIRI_SOCKET",
  "DBUS_SESSION_BUS_ADDRESS",
] as const;

export const BACKEND_NAMES: Record<Backend, string> = {
  hyprland: "Hyprland",
  sway: "Sway",
  niri: "niri",
  kde: "KDE Plasma (kdotool)",
  x11: "X11 (wmctrl)",
};

/** What each backend can put back. */
export const CAN: Record<Backend, { workspace: boolean; geometry: "floating" | "always" | "never" }> = {
  hyprland: { workspace: true, geometry: "floating" },
  sway: { workspace: true, geometry: "floating" },
  niri: { workspace: true, geometry: "never" },
  kde: { workspace: true, geometry: "always" },
  x11: { workspace: true, geometry: "always" },
};

/** Backends worth trying in this session, best first. Each is confirmed by talking to it. */
export function candidates(env: Env): Backend[] {
  const desktop = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":");
  const type = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const wayland = type === "wayland" || (!!env.WAYLAND_DISPLAY && type !== "x11");
  const out: Backend[] = [];
  if (env.HYPRLAND_INSTANCE_SIGNATURE || desktop.includes("hyprland")) out.push("hyprland");
  if (env.SWAYSOCK || desktop.includes("sway")) out.push("sway");
  if (env.NIRI_SOCKET || desktop.includes("niri")) out.push("niri");
  if (desktop.includes("kde")) out.push("kde");
  if (env.DISPLAY && !wayland) out.push("x11");
  return out;
}

// ---------------------------------------------------------------------------
// Windows

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A window open now, as the compositor describes it. */
export interface LiveWindow {
  /** What the compositor acts on: Hyprland address, Sway con_id, niri id, KWin UUID, X11 id. */
  id: string;
  /** Wayland app_id or X11 WM_CLASS. */
  appId: string;
  title: string;
  /** Workspace name or number, as the compositor takes it back. */
  workspace?: string;
  rect?: Rect;
  floating?: boolean;
}

/** A window of a saved layout. */
export interface SavedWindow {
  appId: string;
  title: string;
  workspace?: string;
  rect?: Rect;
  floating?: boolean;
  /** How to start the app when it isn't open, from its .desktop file or typed by the user. */
  command?: string;
  /** The .desktop file the command came from. */
  desktopId?: string;
}

export interface Layout {
  name: string;
  backend: Backend;
  created: number;
  updated: number;
  windows: SavedWindow[];
  /** URLs to open and commands to run with the layout. */
  extras: string[];
}

/** The launcher's own window is never part of a layout. */
const isOwn = (appId: string) => /backslash/i.test(appId);

function rectOf(x?: number, y?: number, width?: number, height?: number): Rect | undefined {
  if ([x, y, width, height].some((v) => v === undefined)) return undefined;
  if (width! <= 0 || height! <= 0) return undefined;
  return { x: Math.round(x!), y: Math.round(y!), width: Math.round(width!), height: Math.round(height!) };
}

/** `hyprctl -j clients`. */
export function parseHyprClients(json: string): LiveWindow[] {
  const clients = JSON.parse(json || "[]") as {
    address?: string;
    mapped?: boolean;
    hidden?: boolean;
    at?: [number, number];
    size?: [number, number];
    workspace?: { id?: number; name?: string };
    floating?: boolean;
    class?: string;
    initialClass?: string;
    title?: string;
  }[];
  const out: LiveWindow[] = [];
  for (const c of clients) {
    const appId = c.class || c.initialClass || "";
    if (!c.address || c.mapped === false || !appId || isOwn(appId)) continue;
    const ws = c.workspace;
    out.push({
      id: c.address,
      appId,
      title: c.title ?? "",
      workspace: ws?.name || (ws?.id !== undefined && ws.id > 0 ? String(ws.id) : undefined),
      rect: rectOf(c.at?.[0], c.at?.[1], c.size?.[0], c.size?.[1]),
      floating: !!c.floating,
    });
  }
  return out;
}

interface SwayNode {
  id?: number;
  type?: string;
  name?: string | null;
  app_id?: string | null;
  pid?: number;
  window_properties?: { class?: string; instance?: string; title?: string };
  rect?: Rect;
  nodes?: SwayNode[];
  floating_nodes?: SwayNode[];
}

/** `swaymsg -t get_tree -r`: every window, with the workspace it is on. */
export function parseSwayTree(json: string): LiveWindow[] {
  const out: LiveWindow[] = [];
  const walk = (n: SwayNode, ws: string | undefined, floating: boolean) => {
    if (n.type === "workspace") ws = n.name === "__i3_scratch" ? undefined : (n.name ?? undefined);
    const children = [...(n.nodes ?? [])];
    const floats = n.floating_nodes ?? [];
    const appId = n.app_id || n.window_properties?.class || "";
    const isWindow = (n.type === "con" || n.type === "floating_con") && n.pid !== undefined && !children.length &&
      !floats.length;
    if (isWindow && appId && !isOwn(appId) && n.id !== undefined) {
      const r = n.rect;
      out.push({
        id: String(n.id),
        appId,
        title: n.name ?? n.window_properties?.title ?? "",
        workspace: ws,
        rect: r ? rectOf(r.x, r.y, r.width, r.height) : undefined,
        floating: floating || n.type === "floating_con",
      });
    }
    for (const c of children) walk(c, ws, floating);
    for (const f of floats) walk(f, ws, true);
  };
  walk(JSON.parse(json || "{}") as SwayNode, undefined, false);
  return out;
}

/** `niri msg --json windows` and `niri msg --json workspaces`. niri places windows itself: no geometry. */
export function parseNiri(windowsJson: string, workspacesJson: string): LiveWindow[] {
  const workspaces = JSON.parse(workspacesJson || "[]") as { id: number; idx?: number; name?: string | null }[];
  const ws = new Map(workspaces.map((w) => [w.id, w.name || (w.idx !== undefined ? String(w.idx) : undefined)]));
  const windows = JSON.parse(windowsJson || "[]") as {
    id: number;
    title?: string | null;
    app_id?: string | null;
    workspace_id?: number | null;
    is_floating?: boolean;
  }[];
  return windows
    .filter((w) => w.app_id && !isOwn(w.app_id))
    .map((w) => ({
      id: String(w.id),
      appId: w.app_id!,
      title: w.title ?? "",
      workspace: w.workspace_id != null ? ws.get(w.workspace_id) : undefined,
      floating: !!w.is_floating,
    }));
}

/** `kdotool getwindowgeometry`: "Window {…}\n  Position: 10,20\n  Geometry: 800x600". */
export function parseKdotoolGeometry(text: string): Rect | undefined {
  const pos = text.match(/Position:\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/);
  const size = text.match(/Geometry:\s*([\d.]+)\s*x\s*([\d.]+)/);
  if (!pos || !size) return undefined;
  return rectOf(Number(pos[1]), Number(pos[2]), Number(size[1]), Number(size[2]));
}

/** KWin window ids printed by `kdotool search`. */
export const parseKdotoolIds = (text: string) =>
  text.split("\n").map((l) => l.trim()).filter((l) => /^\{?[0-9a-f-]{8,}\}?$/i.test(l));

/**
 * WM_CLASS as wmctrl -x prints it, `instance.Class`, to the class. Both parts may hold
 * dots (`org.gnome.Nautilus.Org.gnome.Nautilus`): when the string is two equal halves,
 * it is cut in the middle, else at the first dot.
 */
export function splitWmClass(s: string): string {
  const dots = [...s.matchAll(/\./g)].map((m) => m.index!);
  for (const i of dots) {
    if (s.slice(0, i).toLowerCase() === s.slice(i + 1).toLowerCase()) return s.slice(i + 1);
  }
  return dots.length ? s.slice(dots[0] + 1) : s;
}

/**
 * `wmctrl -lGx`: id, desktop, x, y, width, height, instance.Class, host, title. Desktop -1
 * holds sticky windows (panels, docks, the desktop), left out.
 */
export function parseWmctrl(text: string): LiveWindow[] {
  const out: LiveWindow[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^(0x[0-9a-f]+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+\S+\s?(.*)$/i);
    if (!m || m[2] === "-1" || m[7] === "N/A") continue;
    const appId = splitWmClass(m[7]);
    if (isOwn(appId)) continue;
    out.push({
      id: m[1],
      appId,
      title: m[8].trim(),
      workspace: String(Number(m[2]) + 1),
      rect: rectOf(Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6])),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Apps (.desktop files)

export interface DesktopApp {
  /** File name without .desktop, e.g. `org.mozilla.firefox`. */
  id: string;
  name: string;
  exec: string;
  wmClass?: string;
  hidden: boolean;
}

/** The [Desktop Entry] group of a .desktop file, or undefined when it can't be launched. */
export function parseDesktopApp(fileName: string, text: string): DesktopApp | undefined {
  const e: Record<string, string> = {};
  let inEntry = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("[")) {
      inEntry = line === "[Desktop Entry]";
      continue;
    }
    const eq = line.indexOf("=");
    if (!inEntry || eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key.includes("[")) e[key] = line.slice(eq + 1).trim();
  }
  if ((e.Type && e.Type !== "Application") || !e.Exec) return undefined;
  return {
    id: fileName.replace(/\.desktop$/, ""),
    name: e.Name ?? fileName,
    exec: cleanExec(e.Exec),
    wmClass: e.StartupWMClass || undefined,
    hidden: e.NoDisplay === "true" || e.Hidden === "true",
  };
}

/** Exec without field codes (%u, %F…) and Flatpak's @@ markers: what to run. */
export function cleanExec(exec: string): string {
  return exec
    .replace(/(^|\s)@@[a-z]?(?=\s|$)/gi, " ")
    .replace(/\s+%[fFuUdDnNickvm]/g, "")
    .replace(/%%/g, "%")
    .replace(/\s+/g, " ")
    .trim();
}

/** The program of a command line: `env FOO=1 /usr/bin/app --x` → `app`. */
export function programName(exec: string): string {
  const words = exec.match(/"[^"]*"|'[^']*'|\S+/g) ?? [];
  let i = 0;
  if (words[i] === "env") i++;
  while (words[i] && /^\w+=/.test(words[i])) i++;
  const prog = (words[i] ?? "").replace(/^["']|["']$/g, "");
  return prog.split("/").pop() ?? prog;
}

const norm = (s: string) => s.toLowerCase().replace(/\.desktop$/, "").trim();

/** The app a window belongs to: StartupWMClass first, then the file name, the program, the name. */
export function resolveApp(appId: string, apps: DesktopApp[]): DesktopApp | undefined {
  const a = norm(appId);
  if (!a) return undefined;
  const last = (id: string) => norm(id).split(".").pop() ?? "";
  const score = (app: DesktopApp): number => {
    let s = 0;
    if (app.wmClass && norm(app.wmClass) === a) s = 10;
    else if (norm(app.id) === a) s = 9;
    else if (last(app.id) === a || last(app.id) === a.split(".").pop()) s = 6;
    else if (norm(programName(app.exec)) === a) s = 5;
    else if (norm(app.name) === a) s = 3;
    // Flatpak exports `org.x.App.desktop`: its program is flatpak, its --command the app.
    else if (app.exec.includes(`--command=${a} `) || app.exec.endsWith(`--command=${a}`)) s = 4;
    return s && !app.hidden ? s + 0.5 : s;
  };
  let best: DesktopApp | undefined;
  let bestScore = 0;
  for (const app of apps) {
    const s = score(app);
    if (s > bestScore) [best, bestScore] = [app, s];
  }
  return best;
}

/** Saved windows from open ones, each with the command that starts its app. */
export function snapshot(windows: LiveWindow[], apps: DesktopApp[], overrides: Record<string, string> = {}) {
  const saved: SavedWindow[] = [];
  for (const w of windows) {
    const app = resolveApp(w.appId, apps);
    const own = overrides[norm(w.appId)];
    saved.push({
      appId: w.appId,
      title: w.title,
      workspace: w.workspace,
      rect: w.rect,
      floating: w.floating,
      command: own ?? app?.exec ?? undefined,
      desktopId: own ? undefined : app?.id,
    });
  }
  return sortWindows(saved);
}

/** By workspace (numbers in order, then names), then app. */
export function sortWindows<T extends { workspace?: string; appId: string }>(windows: T[]): T[] {
  const key = (w: T) => {
    const n = Number(w.workspace);
    return Number.isFinite(n) && w.workspace !== undefined ? n : Infinity;
  };
  return [...windows].sort((a, b) =>
    key(a) - key(b) || (a.workspace ?? "~").localeCompare(b.workspace ?? "~") || a.appId.localeCompare(b.appId)
  );
}

// ---------------------------------------------------------------------------
// Restoring

export interface Plan {
  /** Open windows to move, with where they go. */
  moves: { window: LiveWindow; target: SavedWindow }[];
  /** Saved windows with no open window: their app is started. */
  launch: SavedWindow[];
}

/** How much two titles have in common, 0 to 1. */
export function titleSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const words = (s: string) => new Set(s.toLowerCase().split(/[\s—–\-|·:]+/).filter((w) => w.length > 1));
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.max(wa.size, wb.size);
}

export const sameApp = (a: string, b: string) => norm(a) === norm(b);

/** Pairs each saved window with an open window of the same app, the closest title first. */
export function plan(saved: SavedWindow[], live: LiveWindow[]): Plan {
  const used = new Set<string>();
  const moves: Plan["moves"] = [];
  const launch: SavedWindow[] = [];
  // Exact titles first, so a generic one doesn't take the window another saved window describes better.
  const order = [...saved.keys()].sort((i, j) => {
    const best = (s: SavedWindow) =>
      Math.max(0, ...live.filter((w) => sameApp(w.appId, s.appId)).map((w) => titleSimilarity(w.title, s.title)));
    return best(saved[j]) - best(saved[i]);
  });
  const matched = new Map<number, LiveWindow>();
  for (const i of order) {
    const s = saved[i];
    let pick: LiveWindow | undefined;
    let score = -1;
    for (const w of live) {
      if (used.has(w.id) || !sameApp(w.appId, s.appId)) continue;
      const sim = titleSimilarity(w.title, s.title);
      if (sim > score) [pick, score] = [w, sim];
    }
    if (pick) {
      used.add(pick.id);
      matched.set(i, pick);
    }
  }
  saved.forEach((s, i) => {
    const w = matched.get(i);
    if (w) moves.push({ window: w, target: s });
    else launch.push(s);
  });
  return { moves, launch };
}

export interface RestoreResult {
  moved: number;
  launched: number;
  placed: number;
  /** Apps with no command to start them. */
  skipped: string[];
  /** Started, but no window showed up in time. */
  late: string[];
  extras: number;
  errors: string[];
}

/** What restoring did, in one line: "2 moved, 3 started · kitty didn't open in time". */
export function restoreMessage(name: string, r: RestoreResult): string {
  const done = [
    r.moved ? `${r.moved} moved` : "",
    r.launched ? `${r.launched} started` : "",
    r.extras ? `${r.extras} extra${r.extras === 1 ? "" : "s"} opened` : "",
  ].filter(Boolean);
  const problems = [
    r.skipped.length ? `no command for ${[...new Set(r.skipped)].join(", ")}` : "",
    r.late.length ? `${[...new Set(r.late)].join(", ")} didn't open in time` : "",
    r.errors.length ? `${r.errors.length} error${r.errors.length === 1 ? "" : "s"}: ${r.errors[0]}` : "",
  ].filter(Boolean);
  return `${name}: ${done.length ? done.join(", ") : "already in place"}${
    problems.length ? ` · ${problems.join(" · ")}` : ""
  }`;
}

/** Whether moving `w` to `target` changes anything. */
export function needsMove(backend: Backend, w: LiveWindow, target: SavedWindow): boolean {
  if (target.workspace && w.workspace !== target.workspace) return true;
  return !!geometryFor(backend, target) && !sameRect(w.rect, target.rect);
}

const sameRect = (a?: Rect, b?: Rect) =>
  !!a && !!b && Math.abs(a.x - b.x) < 4 && Math.abs(a.y - b.y) < 4 && Math.abs(a.width - b.width) < 4 &&
  Math.abs(a.height - b.height) < 4;

/** The size and position to give back, if this backend places windows that way. */
export function geometryFor(backend: Backend, target: SavedWindow): Rect | undefined {
  const g = CAN[backend].geometry;
  if (g === "never" || !target.rect) return undefined;
  if (g === "floating" && !target.floating) return undefined;
  return target.rect;
}

/** Hyprland: one `hyprctl --batch` string moving the window silently. */
export function hyprBatch(address: string, target: SavedWindow, current?: LiveWindow): string {
  const w = `address:${address}`;
  const out: string[] = [];
  if (target.workspace) out.push(`dispatch movetoworkspacesilent ${target.workspace},${w}`);
  const r = geometryFor("hyprland", target);
  if (r) {
    if (!current?.floating) out.push(`dispatch setfloating ${w}`);
    out.push(`dispatch resizewindowpixel exact ${r.width} ${r.height},${w}`);
    out.push(`dispatch movewindowpixel exact ${r.x} ${r.y},${w}`);
  } else if (current?.floating && target.floating === false) {
    out.push(`dispatch settiled ${w}`);
  }
  return out.join(" ; ");
}

/** Hyprland window rules for `hyprctl dispatch exec`: the new window opens in place. */
export function hyprExecRules(target: SavedWindow): string {
  const rules: string[] = [];
  if (target.workspace) rules.push(`workspace ${target.workspace} silent`);
  const r = geometryFor("hyprland", target);
  if (r) rules.push("float", `size ${r.width} ${r.height}`, `move ${r.x} ${r.y}`);
  return rules.length ? `[${rules.join("; ")}] ` : "";
}

/** Quotes a Sway workspace name. */
const swayName = (s: string) => /^[\w.-]+$/.test(s) ? s : `"${s.replace(/(["\\])/g, "\\$1")}"`;

/** Sway: a criteria command for the container. */
export function swayCommand(conId: string, target: SavedWindow, current?: LiveWindow): string {
  const parts: string[] = [];
  if (target.workspace) parts.push(`move container to workspace ${swayName(target.workspace)}`);
  const r = geometryFor("sway", target);
  if (r) {
    if (!current?.floating) parts.push("floating enable");
    parts.push(`resize set ${r.width} px ${r.height} px`, `move position ${r.x} px ${r.y} px`);
  } else if (current?.floating && target.floating === false) {
    parts.push("floating disable");
  }
  return parts.length ? `[con_id=${conId}] ${parts.join(", ")}` : "";
}

/** niri: `niri msg action …` arguments, by index or name. */
export function niriArgs(id: string, target: SavedWindow): string[][] {
  if (!target.workspace) return [];
  return [["msg", "action", "move-window-to-workspace", "--window-id", id, "--focus", "false", target.workspace]];
}

/** kdotool: one call per change. */
export function kdotoolArgs(id: string, target: SavedWindow): string[][] {
  const out: string[][] = [];
  const n = Number(target.workspace);
  if (target.workspace && Number.isInteger(n) && n > 0) out.push(["set_desktop_for_window", id, String(n)]);
  const r = geometryFor("kde", target);
  if (r) {
    out.push(["windowsize", id, String(r.width), String(r.height)]);
    out.push(["windowmove", id, String(r.x), String(r.y)]);
  }
  return out;
}

/** wmctrl: unmaximize, then desktop and geometry. */
export function wmctrlArgs(id: string, target: SavedWindow): string[][] {
  const out: string[][] = [];
  const n = Number(target.workspace);
  if (target.workspace && Number.isInteger(n) && n > 0) out.push(["-i", "-r", id, "-t", String(n - 1)]);
  const r = geometryFor("x11", target);
  if (r) {
    out.push(["-i", "-r", id, "-b", "remove,maximized_vert,maximized_horz"]);
    out.push(["-i", "-r", id, "-e", `0,${r.x},${r.y},${r.width},${r.height}`]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extras and edits

export const isUrl = (s: string) => /^(https?|file|mailto):/i.test(s.trim()) || /^[\w-]+:\/\//.test(s.trim());

/** One per line; blank lines and `#` comments dropped. */
export function parseExtras(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
}

/** `app = command` lines, as the edit form shows them. */
export function commandsText(windows: SavedWindow[]): string {
  const seen = new Map<string, string>();
  for (const w of windows) if (!seen.has(norm(w.appId))) seen.set(norm(w.appId), `${w.appId} = ${w.command ?? ""}`);
  return [...seen.values()].join("\n");
}

/** Reads `app = command` lines back: app (lowercased) → command; empty commands mean "don't start it". */
export function parseCommands(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    out[norm(line.slice(0, eq))] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Applies edited commands to a layout's windows. */
export function applyCommands(windows: SavedWindow[], commands: Record<string, string>): SavedWindow[] {
  return windows.map((w) => {
    const c = commands[norm(w.appId)];
    if (c === undefined || c === (w.command ?? "")) return w;
    return { ...w, command: c || undefined, desktopId: undefined };
  });
}

/** A name not taken yet: "Work", "Work 2"… */
export function uniqueName(wanted: string, taken: string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  const base = wanted.trim() || "Layout";
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2;; i++) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export const findLayout = (layouts: Layout[], name: string) =>
  layouts.find((l) => l.name.toLowerCase() === name.trim().toLowerCase()) ??
    layouts.find((l) => l.name.toLowerCase().startsWith(name.trim().toLowerCase()));

/** "3 windows on 2 workspaces". */
export function summary(windows: { workspace?: string }[]): string {
  const ws = new Set(windows.map((w) => w.workspace).filter(Boolean));
  const n = windows.length;
  return `${n} window${n === 1 ? "" : "s"}${ws.size ? ` on ${ws.size} workspace${ws.size === 1 ? "" : "s"}` : ""}`;
}

/** The apps of a layout, most windows first: "firefox ×2, kitty, code". */
export function appsLine(windows: { appId: string }[], max = 6): string {
  const counts = new Map<string, number>();
  for (const w of windows) counts.set(w.appId, (counts.get(w.appId) ?? 0) + 1);
  const parts = [...counts].sort((a, b) => b[1] - a[1]).map(([a, n]) => n > 1 ? `${a} ×${n}` : a);
  return parts.length > max ? `${parts.slice(0, max).join(", ")} +${parts.length - max}` : parts.join(", ");
}

/** The markdown table of a layout's windows, for the preview panel. */
export function windowsMarkdown(windows: SavedWindow[]): string {
  if (!windows.length) return "_No windows: only the extras are opened._";
  const esc = (s: string) => s.replace(/([|\\`*_[\]<>])/g, "\\$1");
  const rows = windows.map((w) => {
    const where = w.workspace ? `ws ${esc(w.workspace)}` : "—";
    const geo = w.rect && (w.floating || w.floating === undefined)
      ? `${w.rect.width}×${w.rect.height} at ${w.rect.x},${w.rect.y}`
      : w.floating === false
      ? "tiled"
      : "—";
    const title = w.title.length > 40 ? `${w.title.slice(0, 39)}…` : w.title;
    return `| ${esc(w.appId)} | ${where} | ${geo} | ${esc(title) || "—"} | ${w.command ? "✓" : "✗"} |`;
  });
  return ["| App | Where | Place | Title | Starts |", "|---|---|---|---|---|", ...rows].join("\n");
}

/** Single-quotes for sh, when needed. */
export const q = (s: string) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;

/** A systemd unit name fragment: `org.mozilla.firefox` → `org.mozilla.firefox`, spaces and odd characters dropped. */
export const unitPart = (s: string) => s.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "app";

/** `systemd-run` arguments starting an app that outlives the launcher (forked children kept). */
export function launchArgs(unit: string, command: string, env: Env = {}): string[] {
  return [
    "--user",
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    `--description=Backslash: ${command.slice(0, 60)}`,
    "--property=KillMode=process",
    "--property=WorkingDirectory=~",
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    command,
  ];
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", or the date. */
export function ago(ms: number, now = Date.now()): string {
  const m = Math.floor((now - ms) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.floor(m / 60)} h ago`;
  if (m < 30 * 1440) return `${Math.floor(m / 1440)} d ago`;
  return new Date(ms).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}
