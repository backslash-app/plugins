// v4l2-ctl and ffmpeg, the snapshot folder and the trash.

import { exec } from "@backslash/api";
import {
  bestCapture,
  type Control,
  type Device,
  explain,
  ffmpegArgs,
  type Format,
  type Info,
  parseControls,
  parseDevices,
  parseFormats,
  parseInfo,
  parseResolution,
  snapshotName,
} from "./lib.ts";

const env = (key: string) => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const tilde = (p: string) => (HOME && (p === HOME || p.startsWith(`${HOME}/`)) ? `~${p.slice(HOME.length)}` : p);
export const expandHome = (p: string) => p.trim().replace(/^~(?=\/|$)/, HOME).replace(/(.)\/+$/, "$1");

/** v4l2-ctl's output, even when it exits with an error for one of several devices. */
async function v4l2(args: string[], signal?: AbortSignal): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command("v4l2-ctl", { args, stdin: "null", stdout: "piped", stderr: "piped", signal })
      .output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error("v4l2-ctl is not installed: install v4l-utils");
    }
    throw e;
  }
  const stdout = new TextDecoder().decode(out.stdout);
  if (!out.success && !stdout.trim()) throw new Error(explain(new TextDecoder().decode(out.stderr)));
  return stdout;
}

export interface Camera {
  device: Device;
  /** The node that captures video. */
  node: string;
  info: Info;
  formats: Format[];
}

/** Every camera, with the node that captures (not the metadata one). */
export async function cameras(signal?: AbortSignal): Promise<Camera[]> {
  const devices = parseDevices(await v4l2(["--list-devices"], signal));
  const found = await Promise.all(devices.map(async (device) => {
    for (const node of device.nodes) {
      const info = parseInfo(await v4l2(["-d", node, "--info"], signal).catch(() => ""));
      if (!info.capture) continue;
      const formats = parseFormats(await v4l2(["-d", node, "--list-formats-ext"], signal).catch(() => ""));
      return { device, node, info, formats };
    }
    return undefined;
  }));
  return found.filter((c) => c !== undefined);
}

export async function controls(node: string, signal?: AbortSignal): Promise<Control[]> {
  return parseControls(await v4l2(["-d", node, "--list-ctrls-menus"], signal));
}

export async function setControls(node: string, values: [string, number][]): Promise<void> {
  try {
    await exec("v4l2-ctl", ["-d", node, `--set-ctrl=${values.map(([k, v]) => `${k}=${v}`).join(",")}`]);
  } catch (e) {
    throw new Error(explain(e instanceof Error ? e.message : String(e)));
  }
}

/** Takes one picture with ffmpeg into `folder`; returns its path. */
export async function snapshot(
  cam: Camera,
  folder: string,
  prefs: Record<string, unknown>,
): Promise<string> {
  const dir = expandHome(folder);
  try {
    await Deno.mkdir(dir, { recursive: true });
  } catch (e) {
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new Error(`Snapshots can only be saved inside ~/Pictures: change the folder in the preferences`);
    }
    throw e;
  }
  const path = `${dir}/${snapshotName(new Date())}`;
  const capture = bestCapture(cam.formats, parseResolution(String(prefs.resolution ?? "")));
  const skip = Number(prefs.skipFrames ?? 10);
  try {
    await exec("ffmpeg", ffmpegArgs(cam.node, path, capture, Number.isFinite(skip) ? skip : 10), {
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("ffmpeg is needed to take snapshots: install it");
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error("The camera sent no picture within 20 seconds");
    }
    throw new Error(explain(e instanceof Error ? e.message : String(e)));
  }
  const st = await Deno.stat(path).catch(() => undefined);
  if (!st?.size) throw new Error("ffmpeg didn't write a picture: try another resolution in the preferences");
  return path;
}

export interface Shot {
  path: string;
  name: string;
  size: number;
  mtime: number;
}

/** Pictures in the snapshot folder, newest first. */
export async function shots(folder: string): Promise<Shot[]> {
  const dir = expandHome(folder);
  const out: Shot[] = [];
  try {
    for await (const e of Deno.readDir(dir)) {
      if (!e.isFile || !/\.(jpe?g|png|webp)$/i.test(e.name)) continue;
      const st = await Deno.stat(`${dir}/${e.name}`).catch(() => undefined);
      if (st) out.push({ path: `${dir}/${e.name}`, name: e.name, size: st.size, mtime: st.mtime?.getTime() ?? 0 });
    }
  } catch {
    return [];
  }
  return out.sort((a, b) => b.mtime - a.mtime);
}

export async function trash(path: string): Promise<void> {
  try {
    await exec("gio", ["trash", "--", path]);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("gio (GLib) is needed to move files to the trash");
    throw e;
  }
}

/** The camera from the preferences (/dev/video2 or part of its name), else the first. */
export function pickCamera(list: Camera[], wanted?: string): Camera | undefined {
  const w = wanted?.trim().toLowerCase();
  if (!w) return list[0];
  return list.find((c) => c.node === w || c.device.nodes.includes(w)) ??
    list.find((c) => c.device.name.toLowerCase().includes(w)) ?? list[0];
}

export const DEFAULT_FOLDER = "~/Pictures/Webcam";
