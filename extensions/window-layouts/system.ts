// Talking to the compositor and starting apps. The logic is in lib.ts.

import { exec, openExternal, storage } from "@backslash/api";
import {
  type Backend,
  candidates,
  type DesktopApp,
  type Env,
  hyprBatch,
  hyprExecRules,
  isUrl,
  kdotoolArgs,
  launchArgs,
  type Layout,
  type LiveWindow,
  needsMove,
  niriArgs,
  parseDesktopApp,
  parseHyprClients,
  parseKdotoolGeometry,
  parseKdotoolIds,
  parseNiri,
  parseSwayTree,
  parseWmctrl,
  plan,
  type RestoreResult,
  sameApp,
  type SavedWindow,
  SESSION_ENV,
  swayCommand,
  unitPart,
  wmctrlArgs,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key) || undefined;
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const sessionEnv = (): Env => Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)]));

export interface Session {
  backend?: Backend;
  /** Backends this desktop would use, for the empty state. */
  wanted: Backend[];
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
      case "niri":
        await exec("niri", ["msg", "--json", "version"]);
        return true;
      case "kde":
        await exec("kdotool", ["getactivewindow"]);
        return true;
      case "x11":
        await exec("wmctrl", ["-m"]);
        return true;
    }
  } catch {
    return false;
  }
}

export async function detect(): Promise<Session> {
  const wanted = candidates(sessionEnv());
  for (const b of wanted) if (await works(b)) return { backend: b, wanted };
  return { wanted };
}

// ---------------------------------------------------------------------------
// Windows

async function kdeWindows(): Promise<LiveWindow[]> {
  const ids = parseKdotoolIds(await exec("kdotool", ["search", "--class", "."]).catch(() => ""));
  const one = async (id: string): Promise<LiveWindow | undefined> => {
    const [appId, title, geometry, desktop] = await Promise.all([
      exec("kdotool", ["getwindowclassname", id]).catch(() => ""),
      exec("kdotool", ["getwindowname", id]).catch(() => ""),
      exec("kdotool", ["getwindowgeometry", id]).catch(() => ""),
      exec("kdotool", ["get_desktop_for_window", id]).catch(() => ""),
    ]);
    if (!appId || /backslash|plasmashell|krunner|kwin/i.test(appId)) return undefined;
    const n = Number(desktop);
    return {
      id,
      appId,
      title,
      rect: parseKdotoolGeometry(geometry),
      workspace: Number.isInteger(n) && n > 0 ? String(n) : undefined,
    };
  };
  const out: LiveWindow[] = [];
  // A few at a time: kdotool runs a KWin script per call.
  for (let i = 0; i < ids.length; i += 6) {
    out.push(...(await Promise.all(ids.slice(i, i + 6).map(one))).filter((w): w is LiveWindow => !!w));
  }
  return out;
}

/** The windows open now. */
export async function windows(b: Backend): Promise<LiveWindow[]> {
  switch (b) {
    case "hyprland":
      return parseHyprClients(await exec("hyprctl", ["-j", "clients"]));
    case "sway":
      return parseSwayTree(await exec("swaymsg", ["-t", "get_tree", "-r"]));
    case "niri": {
      const [w, ws] = await Promise.all([
        exec("niri", ["msg", "--json", "windows"]),
        exec("niri", ["msg", "--json", "workspaces"]),
      ]);
      return parseNiri(w, ws);
    }
    case "kde":
      return await kdeWindows();
    case "x11":
      return parseWmctrl(await exec("wmctrl", ["-lGx"]));
  }
}

/** Puts an open window where the layout wants it. */
export async function move(b: Backend, w: LiveWindow, target: SavedWindow): Promise<void> {
  switch (b) {
    case "hyprland": {
      const batch = hyprBatch(w.id, target, w);
      if (batch) await exec("hyprctl", ["--batch", batch]);
      return;
    }
    case "sway": {
      const cmd = swayCommand(w.id, target, w);
      if (cmd) await exec("swaymsg", [cmd]);
      return;
    }
    case "niri":
      for (const args of niriArgs(w.id, target)) await exec("niri", args);
      return;
    case "kde":
      for (const args of kdotoolArgs(w.id, target)) await exec("kdotool", args);
      return;
    case "x11":
      for (const args of wmctrlArgs(w.id, target)) await exec("wmctrl", args);
      return;
  }
}

// ---------------------------------------------------------------------------
// Apps

const APP_DIRS = [
  `${HOME}/.local/share/applications`,
  `${HOME}/.local/share/flatpak/exports/share/applications`,
  "/var/lib/flatpak/exports/share/applications",
  "/var/lib/snapd/desktop/applications",
  "/usr/local/share/applications",
  "/usr/share/applications",
];

/** Installed apps; the user's own .desktop files win over the system's. */
export async function apps(): Promise<DesktopApp[]> {
  const seen = new Map<string, DesktopApp>();
  for (const dir of APP_DIRS) {
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.name.endsWith(".desktop") || seen.has(e.name)) continue;
        const text = await Deno.readTextFile(`${dir}/${e.name}`).catch(() => "");
        const app = parseDesktopApp(e.name, text);
        if (app) seen.set(e.name, app);
      }
    } catch {
      // Missing or not allowed: skipped.
    }
  }
  return [...seen.values()];
}

/** Starts an app; on Hyprland the window opens straight on its workspace. */
export async function launch(b: Backend, w: SavedWindow): Promise<void> {
  const command = w.command!;
  switch (b) {
    case "hyprland":
      await exec("hyprctl", ["dispatch", "exec", `${hyprExecRules(w)}${command}`]);
      return;
    case "sway":
      await exec("swaymsg", [`exec ${command}`]);
      return;
    case "niri":
      await exec("niri", ["msg", "action", "spawn", "--", "/bin/sh", "-c", command]);
      return;
    default:
      await runDetached(`app-backslash-${unitPart(w.desktopId ?? w.appId)}-${Date.now()}`, command);
  }
}

async function runDetached(unit: string, command: string): Promise<void> {
  try {
    await exec("systemd-run", launchArgs(unit, command, sessionEnv()));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to start apps here");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: apps are started with systemd-run --user");
    }
    throw e;
  }
}

/** Opens a URL with the default app, or runs a command. */
async function extra(b: Backend, line: string): Promise<void> {
  if (isUrl(line)) return await openExternal(line.trim());
  switch (b) {
    case "hyprland":
      await exec("hyprctl", ["dispatch", "exec", line]);
      return;
    case "sway":
      await exec("swaymsg", [`exec ${line}`]);
      return;
    case "niri":
      await exec("niri", ["msg", "action", "spawn", "--", "/bin/sh", "-c", line]);
      return;
    default:
      await runDetached(`app-backslash-extra-${Date.now()}`, line);
  }
}

// ---------------------------------------------------------------------------
// Saving and restoring

const KEY = "layouts";

export async function layouts(): Promise<Layout[]> {
  return ((await storage.get(KEY).catch(() => undefined)) ?? []) as unknown as Layout[];
}

export async function saveLayouts(all: Layout[]): Promise<void> {
  await storage.set(KEY, all as any);
}

/** Replaces the layout with the same name (or `previous`), or adds it. */
export async function putLayout(layout: Layout, previous?: string): Promise<void> {
  const all = await layouts();
  const at = all.findIndex((l) => l.name.toLowerCase() === (previous ?? layout.name).toLowerCase());
  if (at >= 0) all[at] = layout;
  else all.push(layout);
  await saveLayouts(all);
}

export async function deleteLayout(name: string): Promise<void> {
  await saveLayouts((await layouts()).filter((l) => l.name !== name));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Moves the open windows of the layout into place, starts the missing apps, waits for
 * their windows (up to `timeoutMs`) and moves those too, then opens the extras.
 */
export async function restore(b: Backend, layout: Layout, timeoutMs: number): Promise<RestoreResult> {
  const r: RestoreResult = { moved: 0, launched: 0, placed: 0, skipped: [], late: [], extras: 0, errors: [] };
  const before = await windows(b);
  const p = plan(layout.windows, before);
  for (const { window, target } of p.moves) {
    if (!needsMove(b, window, target)) continue;
    try {
      await move(b, window, target);
      r.moved++;
    } catch (e) {
      r.errors.push(`${window.appId}: ${(e as Error).message}`);
    }
  }
  const pending: SavedWindow[] = [];
  for (const w of p.launch) {
    if (!w.command) {
      r.skipped.push(w.appId);
      continue;
    }
    try {
      await launch(b, w);
      r.launched++;
      // Hyprland opens it in place with exec rules; the others are moved once they show up.
      if (b === "hyprland") r.placed++;
      else pending.push(w);
    } catch (e) {
      r.errors.push(`${w.appId}: ${(e as Error).message}`);
    }
    // Apps that open several windows (browsers) need a moment between starts.
    await sleep(150);
  }
  const known = new Set(before.map((w) => w.id));
  const deadline = Date.now() + timeoutMs;
  while (pending.length && Date.now() < deadline) {
    await sleep(400);
    const now = await windows(b).catch(() => [] as LiveWindow[]);
    for (const w of now) {
      if (known.has(w.id)) continue;
      const i = pending.findIndex((s) => sameApp(s.appId, w.appId));
      if (i < 0) continue;
      known.add(w.id);
      const [target] = pending.splice(i, 1);
      // Give the app a moment to map its window before moving it.
      await sleep(250);
      try {
        await move(b, w, target);
        r.placed++;
      } catch (e) {
        r.errors.push(`${w.appId}: ${(e as Error).message}`);
      }
    }
  }
  r.late.push(...pending.map((w) => w.appId));
  for (const line of layout.extras) {
    try {
      await extra(b, line);
      r.extras++;
    } catch (e) {
      r.errors.push(`${line}: ${(e as Error).message}`);
    }
  }
  return r;
}
