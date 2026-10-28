// Reading the shortcuts from the desktop's own tools and files.

import { exec } from "@backslash/api";
import {
  CUSTOM_SCHEMA,
  customPaths,
  type Desktop,
  detectDesktops,
  GNOME_SCHEMAS,
  gnomeCustom,
  gnomeShortcuts,
  hyprShortcuts,
  i3Shortcuts,
  kdeShortcuts,
  niriShortcuts,
  type Shortcut,
  swayConfigText,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key) || undefined;
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";

export const SESSION_ENV = ["XDG_CURRENT_DESKTOP", "HYPRLAND_INSTANCE_SIGNATURE", "SWAYSOCK", "NIRI_SOCKET", "I3SOCK"];

export const sessionDesktops = () => detectDesktops(Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)])));

const readText = (path: string) => Deno.readTextFile(path).catch(() => undefined);

const missing = (e: unknown) => e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable;

async function gnome(): Promise<Shortcut[]> {
  let found = false;
  const lists = await Promise.all(GNOME_SCHEMAS.map(async (schema) => {
    try {
      const text = await exec("gsettings", ["list-recursively", schema]);
      found = true;
      return text;
    } catch (e) {
      if (missing(e)) throw new Error("gsettings is not installed: GNOME's shortcuts can't be read");
      // This GNOME has no such schema (mutter.wayland on X11, older versions).
      return "";
    }
  }));
  if (!found) throw new Error("GNOME's shortcut settings are not installed on this system");
  const shortcuts = gnomeShortcuts(lists.join("\n"));
  const paths = customPaths(
    await exec("gsettings", ["get", "org.gnome.settings-daemon.plugins.media-keys", "custom-keybindings"]).catch(() =>
      ""
    ),
  );
  const customs = await Promise.all(paths.map(async (path) => {
    const text = await exec("gsettings", ["list-recursively", `${CUSTOM_SCHEMA}:${path}`]).catch(() => "");
    return gnomeCustom(path, text);
  }));
  return [...customs.filter((c): c is Shortcut => !!c), ...shortcuts];
}

async function kde(): Promise<Shortcut[]> {
  const text = await readText(`${HOME}/.config/kglobalshortcutsrc`);
  if (text === undefined) throw new Error("~/.config/kglobalshortcutsrc was not found: has Plasma been started once?");
  return kdeShortcuts(text);
}

async function hyprland(): Promise<Shortcut[]> {
  try {
    return hyprShortcuts(await exec("hyprctl", ["binds", "-j"]));
  } catch (e) {
    if (missing(e)) throw new Error("hyprctl is not installed: Hyprland's shortcuts can't be read");
    throw new Error("Hyprland is not answering: is it running in this session?");
  }
}

async function sway(): Promise<Shortcut[]> {
  try {
    return i3Shortcuts(swayConfigText(await exec("swaymsg", ["-r", "-t", "get_config"])), "sway");
  } catch {
    // Not in a Sway session: read the file.
    const text = await readText(`${HOME}/.config/sway/config`);
    if (text === undefined) throw new Error("Sway is not running and ~/.config/sway/config was not found");
    return i3Shortcuts(text, "sway");
  }
}

async function niri(): Promise<Shortcut[]> {
  const text = await readText(`${HOME}/.config/niri/config.kdl`);
  if (text === undefined) throw new Error("~/.config/niri/config.kdl was not found");
  return niriShortcuts(text);
}

async function i3(): Promise<Shortcut[]> {
  const text = await readText(`${HOME}/.config/i3/config`) ?? await readText(`${HOME}/.i3/config`);
  if (text === undefined) throw new Error("~/.config/i3/config was not found");
  return i3Shortcuts(text, "i3");
}

export const LOADERS: Record<Desktop, () => Promise<Shortcut[]>> = { gnome, kde, hyprland, sway, niri, i3 };

export interface Loaded {
  desktop: Desktop;
  shortcuts: Shortcut[];
  error?: string;
}

/** The session's desktop, or, when it can't be told, every desktop that has shortcuts. */
export async function load(): Promise<Loaded[]> {
  const detected = sessionDesktops();
  const wanted = detected.length ? detected : (Object.keys(LOADERS) as Desktop[]);
  const results = await Promise.all(wanted.map(async (desktop): Promise<Loaded> => {
    try {
      return { desktop, shortcuts: await LOADERS[desktop]() };
    } catch (e) {
      return { desktop, shortcuts: [], error: (e as Error).message };
    }
  }));
  return detected.length ? results : results.filter((r) => r.shortcuts.length);
}
