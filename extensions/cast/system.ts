// Finding devices (catt scan, go2tv -l), the copied link or file, casting
// and remote control.

import { clipboard, exec, storage } from "@backslash/api";
import {
  castArgs,
  cattDevice,
  cattError,
  type Device,
  deviceId,
  fileMedia,
  findUrl,
  go2tvArgs,
  go2tvScript,
  type Media,
  parseFileList,
  parseGo2tv,
  parseScan,
  parseStatus,
  type Status,
  subtitleFor,
  urlMedia,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
const wayland = () =>
  env("XDG_SESSION_TYPE") === "wayland" || (!!env("WAYLAND_DISPLAY") && env("XDG_SESSION_TYPE") !== "x11");

async function output(program: string, args: string[], timeout: number): Promise<string | undefined> {
  try {
    const out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(timeout),
    }).output();
    return out.success ? new TextDecoder().decode(out.stdout) : undefined;
  } catch {
    return undefined;
  }
}

async function installed(program: string, args: string[]): Promise<boolean> {
  try {
    await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "null",
      signal: AbortSignal.timeout(5000),
    })
      .output();
    return true;
  } catch (e) {
    return !(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied ||
      e instanceof Deno.errors.NotCapable);
  }
}

export interface Tools {
  catt: boolean;
  go2tv: boolean;
  networkDisplays?: string;
}

/** GNOME Network Displays (Miracast screen mirroring): its desktop file, package or Flatpak. */
const NETWORK_DISPLAYS = () => [
  "/usr/share/applications/org.gnome.NetworkDisplays.desktop",
  "/var/lib/flatpak/exports/share/applications/org.gnome.NetworkDisplays.desktop",
  `${HOME}/.local/share/flatpak/exports/share/applications/org.gnome.NetworkDisplays.desktop`,
];

let found: Promise<Tools> | undefined;
export function tools(): Promise<Tools> {
  found ??= (async () => {
    const [catt, go2tv] = await Promise.all([installed("catt", ["--version"]), installed("go2tv", ["-version"])]);
    let networkDisplays: string | undefined;
    for (const f of NETWORK_DISPLAYS()) {
      if (await Deno.stat(f).then((s) => s.isFile).catch(() => false)) {
        networkDisplays = f;
        break;
      }
    }
    return { catt, go2tv, networkDisplays };
  })();
  return found;
}

export async function openNetworkDisplays(file: string): Promise<void> {
  await exec("gio", ["launch", file]);
}

// ---------------------------------------------------------------------------
// Devices

type Json = Parameters<typeof storage.set>[1];

interface Scan {
  devices: Device[];
  at: number;
}

export async function cachedDevices(): Promise<Scan | undefined> {
  return (await storage.get("scan")) as unknown as Scan | undefined;
}

/** Chromecasts and DLNA renderers on the network (a few seconds). */
export async function scan(t: Tools): Promise<Scan> {
  const [chromecasts, dlna] = await Promise.all([
    t.catt ? exec("catt", ["scan"], { signal: AbortSignal.timeout(20_000) }).catch(() => "") : "",
    t.go2tv ? output("go2tv", ["-l"], 15_000) : "",
  ]);
  const result = { devices: [...parseScan(chromecasts), ...parseGo2tv(dlna ?? "")], at: Date.now() };
  await storage.set("scan", result as unknown as Json);
  return result;
}

export async function defaultDevice(): Promise<Device | undefined> {
  return (await storage.get("device")) as unknown as Device | undefined;
}

export async function setDefault(d: Device): Promise<void> {
  await storage.set("device", d as unknown as Json);
}

/** The device to use when none is picked: the last one used, else the only one. */
export async function pickDevice(): Promise<Device> {
  const d = await defaultDevice();
  if (d) return d;
  const devices = (await cachedDevices())?.devices ?? (await scan(await tools())).devices;
  if (devices.length === 1) return devices[0];
  throw new Error(devices.length ? "Pick a device in Cast to TV first" : "No Chromecast or DLNA TV found");
}

// ---------------------------------------------------------------------------
// What was copied

/** Files copied in the file manager, else a copied link. */
export async function copiedMedia(): Promise<Media | undefined> {
  const tries: [string, string[]][] = [
    ["wl-paste", ["--no-newline", "--type", "text/uri-list"]],
    ["wl-paste", ["--no-newline", "--type", "x-special/gnome-copied-files"]],
    ["xclip", ["-selection", "clipboard", "-t", "text/uri-list", "-o"]],
    ["xclip", ["-selection", "clipboard", "-t", "x-special/gnome-copied-files", "-o"]],
  ];
  if (!wayland()) tries.push(...tries.splice(0, 2));
  for (const [program, args] of tries) {
    const out = await output(program, args, 1500);
    const media = out ? parseFileList(out, HOME).map(fileMedia).find((m) => m) : undefined;
    if (media) return media;
  }
  let text = "";
  try {
    text = await clipboard.read();
  } catch {
    return undefined;
  }
  const file = parseFileList(text, HOME).map(fileMedia).find((m) => m);
  if (file) return file;
  const url = findUrl(text);
  return url ? urlMedia(url) : undefined;
}

async function subtitles(m: Media): Promise<string | undefined> {
  if (m.kind !== "file" || m.type !== "video") return undefined;
  const dir = m.path.split("/").slice(0, -1).join("/") || "/";
  const names: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) if (e.isFile) names.push(e.name);
  } catch {
    return undefined;
  }
  return subtitleFor(m.path, names);
}

// ---------------------------------------------------------------------------
// Casting

export const UNIT = "backslash-cast";

async function unit(description: string, argv: string[]): Promise<void> {
  await exec("systemctl", ["--user", "stop", `${UNIT}.service`]).catch(() => {});
  await exec("systemctl", ["--user", "reset-failed", `${UNIT}.service`]).catch(() => {});
  try {
    await exec("systemd-run", [
      "--user",
      "--quiet",
      "--collect",
      `--unit=${UNIT}`,
      `--description=${description}`,
      ...argv,
    ]);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to cast files in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: files are cast in the background with systemd-run --user");
    }
    throw e;
  }
}

async function unitActive(): Promise<boolean> {
  try {
    return (await exec("systemctl", ["--user", "is-active", `${UNIT}.service`])) === "active";
  } catch {
    return false;
  }
}

/**
 * Casts to a device. Links return once the TV plays them; files are served
 * from this computer by catt or go2tv in a background unit for as long as they play.
 */
export async function cast(d: Device, m: Media, options: { site?: boolean } = {}): Promise<void> {
  const subs = await subtitles(m);
  if (d.kind === "dlna") {
    if (!d.url) throw new Error("This TV has no address: scan again");
    await unit(`Backslash: cast to ${d.name}`, ["sh", "-c", go2tvScript(go2tvArgs(d, m, subs))]);
    await new Promise((r) => setTimeout(r, 2500));
    if (!(await unitActive())) throw new Error(`${d.name} didn't accept it: is it on, and can it play this format?`);
  } else if (m.kind === "file") {
    await unit(`Backslash: cast to ${d.name}`, ["catt", ...castArgs(d, m, { subtitles: subs })]);
    await new Promise((r) => setTimeout(r, 3000));
    if (!(await unitActive())) {
      const st = await status(d).catch(() => undefined);
      if (!st || st.idle) {
        throw new Error(`${d.name} couldn't play the file: Chromecasts play MP4, WebM, MP3 and pictures`);
      }
    }
  } else {
    try {
      await exec("catt", castArgs(d, m, options), { signal: AbortSignal.timeout(90_000) });
    } catch (e) {
      throw new Error(cattError(String((e as Error).message)));
    }
  }
  await setDefault(d);
}

/** Stops what plays on the device, and the file server if one runs. */
export async function stop(d: Device): Promise<void> {
  const served = await unitActive();
  await exec("systemctl", ["--user", "stop", `${UNIT}.service`]).catch(() => {});
  if (d.kind === "chromecast") {
    try {
      await exec("catt", ["-d", cattDevice(d), "stop"], { signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      if (!served) throw new Error(cattError(String((e as Error).message)));
    }
  }
}

/** A catt remote command: play_toggle, volume 40, ffwd 30… */
export async function control(d: Device, ...args: string[]): Promise<void> {
  if (d.kind !== "chromecast") throw new Error("go2tv's TVs are controlled with their own remote");
  try {
    await exec("catt", ["-d", cattDevice(d), ...args], { signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    throw new Error(cattError(String((e as Error).message)));
  }
}

export async function status(d: Device): Promise<Status | undefined> {
  if (d.kind !== "chromecast") return undefined;
  try {
    return parseStatus(await exec("catt", ["-d", cattDevice(d), "status"], { signal: AbortSignal.timeout(10_000) }));
  } catch (e) {
    const msg = String((e as Error).message);
    if (/Nothing is currently playing|idle/i.test(msg)) return { idle: true };
    return undefined;
  }
}

export { deviceId };
