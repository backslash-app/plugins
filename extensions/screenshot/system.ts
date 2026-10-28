// Everything that touches the system: environment, installed tools, folders,
// background jobs (systemd-run), the clipboard.

import { exec, openExternal, storage } from "@backslash/api";
import {
  basename,
  captureName,
  detectSession,
  dirname,
  type Env,
  focusedOutput,
  hyprlandWindows,
  IMAGE,
  type Mode,
  osFamily,
  parseUserDirs,
  pick,
  pngSize,
  recorderCandidates,
  recordScript,
  type RecTool,
  screenshotCandidates,
  screenshotScript,
  type Session,
  SESSION_ENV,
  type ShotTool,
  swayWindows,
  systemdRunArgs,
  VIDEO,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const sessionEnv = (): Env => Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)]));
export const session = (): Session => detectSession(sessionEnv());

/** Whether a program can be started: installed and allowed. */
export async function installed(program: string, args = ["--version"]): Promise<boolean> {
  try {
    await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "null",
      signal: AbortSignal.timeout(3000),
    }).output();
    return true;
  } catch (e) {
    return !(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied ||
      e instanceof Deno.errors.NotCapable);
  }
}

const PROBE: Record<string, string[]> = { import: ["-version"], slurp: ["-h"], grim: ["-h"], slop: ["--version"] };

/** Which of these programs are installed. */
export async function available(programs: string[]): Promise<Set<string>> {
  const found = await Promise.all(programs.map((p) => installed(p, PROBE[p] ?? ["--version"])));
  return new Set(programs.filter((_, i) => found[i]));
}

export interface Tools {
  session: Session;
  shot?: ShotTool;
  recorder?: RecTool;
  slurp: boolean;
  slop: boolean;
}

export async function tools(): Promise<Tools> {
  const s = session();
  const shots = screenshotCandidates(s);
  const recs = recorderCandidates(s);
  const found = await available([...shots, ...recs, "slurp", "slop"]);
  return {
    session: s,
    shot: pick(shots, found),
    recorder: pick(recs, found),
    slurp: found.has("slurp"),
    slop: found.has("slop"),
  };
}

export async function family() {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

// ---------------------------------------------------------------------------
// Folders

export async function folders(): Promise<{ pictures: string; videos: string }> {
  const dirs = parseUserDirs(await Deno.readTextFile(`${HOME}/.config/user-dirs.dirs`).catch(() => ""), HOME);
  return {
    pictures: `${dirs.pictures ?? `${HOME}/Pictures`}/Screenshots`,
    videos: `${dirs.videos ?? `${HOME}/Videos`}/Screencasts`,
  };
}

export interface Capture {
  path: string;
  name: string;
  folder: string;
  kind: "image" | "video";
  size: number;
  modified: number;
  width?: number;
  height?: number;
}

async function readHead(path: string): Promise<Uint8Array> {
  const f = await Deno.open(path, { read: true });
  try {
    const buf = new Uint8Array(24);
    const n = await f.read(buf);
    return buf.subarray(0, n ?? 0);
  } finally {
    f.close();
  }
}

/** Screenshots and recordings, newest first. */
export async function captures(limit = 60): Promise<Capture[]> {
  const { pictures, videos } = await folders();
  const found: Capture[] = [];
  for (const folder of new Set([pictures, videos])) {
    try {
      for await (const e of Deno.readDir(folder)) {
        if (!e.isFile) continue;
        const kind = IMAGE.test(e.name) ? "image" : VIDEO.test(e.name) ? "video" : undefined;
        if (!kind) continue;
        const path = `${folder}/${e.name}`;
        const st = await Deno.stat(path).catch(() => undefined);
        if (st) found.push({ path, name: e.name, folder, kind, size: st.size, modified: st.mtime?.getTime() ?? 0 });
      }
    } catch {
      // The folder doesn't exist yet, or isn't readable.
    }
  }
  const recent = found.sort((a, b) => b.modified - a.modified).slice(0, limit);
  await Promise.all(
    recent.filter((c) => /\.png$/i.test(c.name)).map(async (c) => {
      const size = pngSize(await readHead(c.path).catch(() => new Uint8Array()));
      if (size) Object.assign(c, size);
    }),
  );
  return recent;
}

// ---------------------------------------------------------------------------
// Background jobs

async function detach(
  unit: string,
  script: string,
  o: { description: string; keepChildren?: boolean; killSignal?: string },
) {
  try {
    await exec("systemd-run", systemdRunArgs(unit, script, { ...o, env: sessionEnv() }));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to capture in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: captures run in the background with systemd-run --user");
    }
    throw e;
  }
}

/** Rectangles of the windows to pick from, when the compositor tells us. */
async function windows(s: Session): Promise<string[]> {
  try {
    if (s.desktop === "hyprland") {
      const [clients, monitors] = await Promise.all([
        exec("hyprctl", ["-j", "clients"]),
        exec("hyprctl", ["-j", "monitors"]),
      ]);
      return hyprlandWindows(clients, monitors);
    }
    if (s.desktop === "sway") return swayWindows(await exec("swaymsg", ["-t", "get_tree", "-r"]));
  } catch {
    // Not available: slurp lets the user draw the window's area instead.
  }
  return [];
}

async function output(s: Session): Promise<string | undefined> {
  try {
    if (s.desktop === "hyprland") return focusedOutput(await exec("hyprctl", ["-j", "monitors"]));
    if (s.desktop === "sway") return focusedOutput(await exec("swaymsg", ["-t", "get_outputs", "-r"]));
  } catch {
    // The recorder asks.
  }
  return undefined;
}

export class MissingTool extends Error {}

/** Captures in the background, once the launcher is hidden. Returns the file it will write. */
export async function screenshot(mode: Mode, o: { delay?: number; copy?: boolean } = {}): Promise<string> {
  const t = await tools();
  if (!t.shot) throw new MissingTool("No screenshot tool found");
  if (t.shot === "grim" && mode !== "screen" && !t.slurp) throw new MissingTool("slurp is needed to select an area");
  const file = `${(await folders()).pictures}/${captureName("Screenshot", new Date())}`;
  const script = screenshotScript({
    tool: t.shot,
    mode,
    file,
    wayland: t.session.wayland,
    delay: o.delay,
    copy: o.copy,
    windows: mode === "window" && t.shot === "grim" ? await windows(t.session) : [],
  });
  await detach(`backslash-screenshot-${Date.now()}`, script, {
    description: "Backslash: screenshot",
    keepChildren: true,
  });
  return file;
}

// ---------------------------------------------------------------------------
// Recording

export const RECORDING_UNIT = "backslash-screen-recording";

export interface Recording {
  file: string;
  started: number;
  tool: RecTool;
  area: boolean;
}

/** The recording in progress, if any. */
export async function recording(): Promise<Recording | undefined> {
  const saved = (await storage.get("recording")) as unknown as Recording | undefined;
  if (!saved) return undefined;
  const state = await exec("systemctl", ["--user", "is-active", RECORDING_UNIT]).catch(() => "inactive");
  if (state === "active" || state === "activating") return saved;
  await storage.delete("recording");
  return undefined;
}

export async function startRecording(area: boolean, audio: boolean): Promise<Recording> {
  const t = await tools();
  if (!t.recorder) {
    if (t.session.wayland && t.session.desktop === "gnome") {
      throw new Error("GNOME records the screen itself: press Ctrl + Shift + Alt + R");
    }
    if (t.session.wayland && t.session.desktop === "kde") throw new Error("On KDE Plasma, record with Spectacle");
    throw new MissingTool("No screen recorder found");
  }
  if (area && t.recorder !== "ffmpeg" && !t.slurp) throw new MissingTool("slurp is needed to select an area");
  if (area && t.recorder === "ffmpeg" && !t.slop) throw new MissingTool("slop is needed to select an area on X11");
  const file = `${(await folders()).videos}/${captureName("Recording", new Date())}`;
  const script = recordScript({
    tool: t.recorder,
    area,
    file,
    audio,
    output: area ? undefined : await output(t.session),
  });
  await exec("systemctl", ["--user", "reset-failed", RECORDING_UNIT]).catch(() => {});
  await detach(RECORDING_UNIT, script, { description: "Backslash: screen recording", killSignal: "SIGINT" });
  const rec = { file, started: Date.now() + 800, tool: t.recorder, area };
  await storage.set("recording", rec as any);
  return rec;
}

/** Stops the recorder (SIGINT, so the file is finalized) and waits for it. */
export async function stopRecording(): Promise<Recording | undefined> {
  const rec = await recording();
  await exec("systemctl", ["--user", "stop", RECORDING_UNIT]).catch(() => {});
  await storage.delete("recording");
  return rec;
}

// ---------------------------------------------------------------------------
// Files

async function pipe(program: string, args: string[], input?: Uint8Array): Promise<boolean> {
  try {
    const child = new Deno.Command(program, {
      args,
      stdin: input ? "piped" : "null",
      stdout: "null",
      stderr: "null",
    }).spawn();
    if (input) {
      const w = child.stdin.getWriter();
      await w.write(input);
      await w.close();
    }
    return (await child.status).success;
  } catch {
    return false;
  }
}

/** Copies a picture to the clipboard (wl-copy, then xclip). */
export async function copyImage(c: Capture): Promise<boolean> {
  const type = c.name.toLowerCase().endsWith(".png")
    ? "image/png"
    : c.name.match(/\.jpe?g$/i)
    ? "image/jpeg"
    : "image/png";
  const wayland = session().wayland;
  const wl = async () => pipe("wl-copy", ["--type", type], await Deno.readFile(c.path));
  const x = () => pipe("xclip", ["-selection", "clipboard", "-t", type, "-i", c.path]);
  return wayland ? (await wl()) || (await x()) : (await x()) || (await wl());
}

/** Opens the folder with the file selected (FileManager1), or just the folder. */
export async function showInFolder(path: string): Promise<void> {
  const uri = `file://${path.split("/").map(encodeURIComponent).join("/")}`;
  try {
    await exec("gdbus", [
      "call",
      "--session",
      "--dest",
      "org.freedesktop.FileManager1",
      "--object-path",
      "/org/freedesktop/FileManager1",
      "--method",
      "org.freedesktop.FileManager1.ShowItems",
      `['${uri.replace(/'/g, "%27")}']`,
      "",
    ]);
  } catch {
    await openExternal(dirname(path));
  }
}

export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
export { basename };
