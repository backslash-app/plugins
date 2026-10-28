// Folders, thumbnails, setting the wallpaper with the desktop's tool, downloads.

import { exec, storage } from "@backslash/api";
import {
  type Backend,
  BACKEND_PROGRAM,
  backendCandidates,
  backendPreference,
  basename,
  dedupeSizes,
  detectSession,
  dirname,
  downloadName,
  type Env,
  type Family,
  IMAGE,
  imageSize,
  type OnlineWallpaper,
  osFamily,
  parseFolders,
  parseGsettingsUri,
  type Session,
  SESSION_ENV,
  setCommands,
  UNSPLASH,
  type Variant,
  xfceProperties,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/wallpapers`;
export const SYSTEM_FOLDERS = ["/usr/share/backgrounds", "/usr/share/wallpapers"];
export const session = (): Session => detectSession(Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)])) as Env);
export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

export interface Prefs {
  folders?: string;
  backend?: string;
  unsplashKey?: string;
  sketchy?: boolean;
  minResolution?: string;
  system?: boolean;
}

export const folders = (prefs: Prefs) => parseFolders(prefs.folders, HOME);

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

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

const PROBE: Partial<Record<string, string[]>> = {
  "plasma-apply-wallpaperimage": ["--help"],
  hyprctl: ["version"],
  swww: ["query"],
  swaymsg: ["-v"],
  nitrogen: ["--help"],
};

/** swww needs its daemon running; the others just need the program. */
async function usable(b: Backend): Promise<boolean> {
  const program = BACKEND_PROGRAM[b];
  if (b === "swww") {
    try {
      await exec("swww", ["query"]);
      return true;
    } catch {
      return false;
    }
  }
  return await installed(program, PROBE[program]);
}

let picked: Promise<Backend | undefined> | undefined;

/** The backend used to set wallpapers: the preference, else the first usable for the session. */
export function backend(prefs: Prefs): Promise<Backend | undefined> {
  picked ??= (async () => {
    const forced = backendPreference(prefs.backend);
    if (forced) return forced;
    for (const b of backendCandidates(session())) if (await usable(b)) return b;
    return undefined;
  })();
  return picked;
}

// ---------------------------------------------------------------------------
// Wallpapers on disk

export interface Wallpaper {
  path: string;
  name: string;
  folder: string;
  system: boolean;
  size: number;
  modified: number;
  width?: number;
  height?: number;
  thumb?: string;
}

async function head(path: string, n = 256 * 1024): Promise<Uint8Array> {
  const f = await Deno.open(path, { read: true });
  try {
    const buf = new Uint8Array(n);
    let got = 0;
    while (got < n) {
      const r = await f.read(buf.subarray(got));
      if (!r) break;
      got += r;
      if (got >= 32 && buf[0] !== 0xff) break; // only JPEG needs to look further
    }
    return buf.subarray(0, got);
  } finally {
    f.close();
  }
}

async function scan(folder: string, system: boolean, depth: number, out: Wallpaper[]): Promise<void> {
  try {
    for await (const e of Deno.readDir(folder)) {
      const path = `${folder}/${e.name}`;
      if (e.isDirectory && depth > 0 && !e.name.startsWith(".")) {
        await scan(path, system, depth - 1, out);
        continue;
      }
      if (!(e.isFile || e.isSymlink) || !IMAGE.test(e.name) || e.name.startsWith(".")) continue;
      // KDE's themes keep several sizes of one wallpaper: only the biggest is useful.
      const st = await Deno.stat(path).catch(() => undefined);
      if (!st?.isFile) continue;
      out.push({
        path,
        name: e.name,
        folder,
        system,
        size: st.size,
        modified: st.mtime?.getTime() ?? 0,
      });
    }
  } catch {
    // Missing or unreadable folder.
  }
}

/** Your wallpapers (and the system's ones), newest first, with their sizes. */
export async function wallpapers(prefs: Prefs, withSystem: boolean): Promise<Wallpaper[]> {
  const found: Wallpaper[] = [];
  for (const f of folders(prefs)) await scan(f, false, 2, found);
  if (withSystem) { for (const f of SYSTEM_FOLDERS) await scan(f, true, 4, found); }
  const list = dedupeSizes(found).sort((a, b) => Number(a.system) - Number(b.system) || b.modified - a.modified);
  await Promise.all(list.map(async (w) => {
    if (w.width) return;
    const size = imageSize(await head(w.path).catch(() => new Uint8Array()));
    if (size) Object.assign(w, size);
  }));
  return list;
}

// ---------------------------------------------------------------------------
// Thumbnails (ImageMagick), so big pictures don't slow the grid down

let magick: Promise<string | undefined> | undefined;
const magickProgram = () =>
  magick ??= (async () => {
    if (await installed("magick", ["-version"])) return "magick";
    if (await installed("convert", ["-version"])) return "convert";
    return undefined;
  })();

async function thumbKey(w: Wallpaper): Promise<string> {
  const data = new TextEncoder().encode(`${w.path}\u0000${w.size}\u0000${w.modified}`);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  return [...hash].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fills `thumb` for the wallpapers whose thumbnail is already made; returns the others. */
export async function knownThumbs(list: Wallpaper[]): Promise<Wallpaper[]> {
  const missing: Wallpaper[] = [];
  await Promise.all(list.map(async (w) => {
    const file = `${CACHE}/thumbs/${await thumbKey(w)}.jpg`;
    if (await Deno.stat(file).then((s) => s.size > 0).catch(() => false)) w.thumb = file;
    else missing.push(w);
  }));
  return missing;
}

/** Makes the missing thumbnails, a few at a time. False when ImageMagick isn't there. */
export async function makeThumbs(list: Wallpaper[], signal: AbortSignal): Promise<boolean> {
  const program = await magickProgram();
  if (!program) return false;
  await Deno.mkdir(`${CACHE}/thumbs`, { recursive: true });
  const queue = [...list];
  const worker = async () => {
    for (let w = queue.shift(); w && !signal.aborted; w = queue.shift()) {
      const file = `${CACHE}/thumbs/${await thumbKey(w)}.jpg`;
      try {
        // [0]: the first frame only; 512 px wide is plenty for a tile.
        await exec(program, [
          `${w.path}[0]`,
          "-auto-orient",
          "-thumbnail",
          "512x320^",
          "-gravity",
          "center",
          "-extent",
          "512x320",
          "-quality",
          "82",
          file,
        ], { signal });
        w.thumb = file;
      } catch {
        // Unsupported format: the tile shows the original.
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return true;
}

// ---------------------------------------------------------------------------
// Setting the wallpaper

export class NoBackend extends Error {}

export async function currentWallpaper(prefs: Prefs): Promise<string | undefined> {
  const b = await backend(prefs);
  try {
    if (b === "gnome") {
      const dark = await exec("gsettings", ["get", "org.gnome.desktop.interface", "color-scheme"]).catch(() => "");
      const key = dark.includes("prefer-dark") ? "picture-uri-dark" : "picture-uri";
      return parseGsettingsUri(await exec("gsettings", ["get", "org.gnome.desktop.background", key]));
    }
    if (b === "cinnamon") {
      return parseGsettingsUri(await exec("gsettings", ["get", "org.cinnamon.desktop.background", "picture-uri"]));
    }
    if (b === "mate") {
      return parseGsettingsUri(await exec("gsettings", ["get", "org.mate.background", "picture-filename"]));
    }
  } catch {
    // Fall back to what we set last.
  }
  return (await storage.get<string>("current")) ?? undefined;
}

/** Sets the wallpaper; returns the backend used. */
export async function setWallpaper(path: string, prefs: Prefs, variant: Variant = "both"): Promise<Backend> {
  const b = await backend(prefs);
  if (!b) throw new NoBackend(`No way to set the wallpaper found for ${session().desktop}`);
  const xfce = b === "xfce" ? xfceProperties(await exec("xfconf-query", ["-c", "xfce4-desktop", "-l"])) : undefined;
  if (b === "xfce" && !xfce?.length) throw new Error("Xfce has no desktop to set: is xfdesktop running?");
  const steps = setCommands(b, path, { variant, xfce });
  // hyprctl exits with 0 even when hyprpaper answers an error: its answer is "ok" otherwise.
  const hypr = async (args: string[]) => {
    const out = (await exec("hyprctl", args)).trim();
    if (out && !/^ok$/i.test(out)) throw new Error(`hyprpaper: ${out}`);
  };
  try {
    for (const [program, args] of steps) {
      if (program === "hyprctl") await hypr(args);
      else await exec(program, args);
    }
  } catch (e) {
    if (b !== "hyprpaper") throw e;
    // hyprpaper ≥ 0.7.4 also takes a single "reload".
    await hypr(["hyprpaper", "reload", `,${path}`]).catch(() => {
      throw new Error("hyprpaper doesn't answer: start it (exec-once = hyprpaper), or install swww");
    });
  }
  if (b === "hyprpaper") await exec("hyprctl", ["hyprpaper", "unload", "unused"]).catch(() => {});
  await storage.set("current", path);
  const recent = ((await storage.get<string[]>("recent")) ?? []).filter((p) => p !== path);
  await storage.set("recent", [path, ...recent].slice(0, 20));
  return b;
}

export async function recent(): Promise<string[]> {
  return (await storage.get<string[]>("recent")) ?? [];
}

// ---------------------------------------------------------------------------
// Downloads

/** Downloads into the first wallpapers folder; returns the file (already there: not downloaded again). */
export async function download(w: OnlineWallpaper, prefs: Prefs): Promise<string> {
  const folder = folders(prefs)[0];
  await Deno.mkdir(folder, { recursive: true });
  const name = downloadName(w);
  const target = `${folder}/${name}`;
  if (await Deno.stat(target).then((s) => s.size > 0).catch(() => false)) return target;
  if (w.source === "unsplash" && w.downloadLocation && prefs.unsplashKey) {
    // Unsplash's API guidelines: tell them when a photo is downloaded.
    await fetch(w.downloadLocation, { headers: unsplashHeaders(prefs.unsplashKey) }).then((r) => r.body?.cancel())
      .catch(() => {});
  }
  const res = await fetch(w.full);
  if (!res.ok) throw new Error(`Download failed (${res.status})`);
  // Hidden while it downloads, so the grid never shows half a picture.
  const tmp = `${folder}/.${name}.part`;
  await Deno.writeFile(tmp, new Uint8Array(await res.arrayBuffer()));
  await Deno.rename(tmp, target);
  return target;
}

export const unsplashHeaders = (key: string) => ({ Authorization: `Client-ID ${key}`, "Accept-Version": "v1" });

export async function downloadedNames(prefs: Prefs): Promise<Set<string>> {
  const names = new Set<string>();
  try {
    for await (const e of Deno.readDir(folders(prefs)[0])) names.add(e.name);
  } catch {
    // Not created yet.
  }
  return names;
}

export { basename, dirname, UNSPLASH };
