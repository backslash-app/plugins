// Reading and changing themes with the desktop's own tools.

import { exec } from "@backslash/api";
import {
  ACCENT_TINTS,
  type Backend,
  counterpart,
  dedupe,
  detectBackend,
  GSETTINGS,
  gtkTheme,
  iconThemes,
  kdeCounterpart,
  type Kind,
  lookAndFeelName,
  orDefault,
  originOf,
  parseColorSchemes,
  parseLookAndFeel,
  parseRange,
  previewCandidates,
  readable,
  STYLES,
  type Theme,
  themeDirs,
  unquote,
  XFCONF,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key) || undefined;
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const backend: Backend = detectBackend(env("XDG_CURRENT_DESKTOP"));

const quiet = <T>(p: Promise<T>) => p.catch(() => undefined);
const readText = (path: string) => quiet(Deno.readTextFile(path));
const missing = (e: unknown) => e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable;

/** Runs the first of several programs that is installed (kreadconfig6, then kreadconfig5). */
async function first(programs: string[], args: string[]): Promise<string> {
  for (const p of programs) {
    try {
      return await exec(p, args);
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
  throw new Error(`${programs[0]} is not installed`);
}

async function listDir(path: string): Promise<{ name: string; isDirectory: boolean }[]> {
  const out: { name: string; isDirectory: boolean }[] = [];
  try {
    for await (const e of Deno.readDir(path)) out.push({ name: e.name, isDirectory: e.isDirectory || e.isSymlink });
  } catch {
    // Not there, or not readable.
  }
  return out;
}

const names = async (path: string) => (await listDir(path)).map((e) => e.name);

const isFile = (path: string) => Deno.stat(path).then((i) => i.isFile, () => false);

/** The theme's folders, the gtk-3.0 and gtk-4.0 ones only if they style widgets (not just key themes like Emacs). */
async function gtkEntries(path: string): Promise<string[]> {
  const entries = await names(path);
  const keep = await Promise.all(entries.map(async (e) => {
    if (e !== "gtk-3.0" && e !== "gtk-4.0") return true;
    return await isFile(`${path}/${e}/gtk.css`) || await isFile(`${path}/${e}/gtk-dark.css`);
  }));
  return entries.filter((_, i) => keep[i]);
}

/** GTK's own themes, there even without a folder in /usr/share/themes. */
const BUILT_IN_GTK = ["Adwaita", "Adwaita-dark", "HighContrast", "HighContrastInverse"];

async function gtkThemes(): Promise<Theme[]> {
  const found = await Promise.all(
    themeDirs(HOME).gtk.map(async (dir) => {
      const entries = (await listDir(dir)).filter((e) => e.isDirectory);
      return Promise.all(entries.map(async ({ name }): Promise<Theme | undefined> => {
        const path = `${dir}/${name}`;
        const t = gtkTheme(name, path, await gtkEntries(path), await readText(`${path}/index.theme`));
        return t && { ...t, origin: originOf(dir, HOME) };
      }));
    }),
  );
  const themes = dedupe(found.flat().filter((t): t is Theme => !!t));
  for (const id of BUILT_IN_GTK) {
    if (!themes.some((t) => t.id === id)) {
      themes.push({
        kind: "gtk",
        id,
        name: readable(id),
        origin: "Built into GTK",
        gtk: ["3", "4"],
        dark: /dark|inverse/i.test(id),
      });
    }
  }
  return themes;
}

async function preview(path: string, index: string): Promise<string | undefined> {
  for (const candidate of previewCandidates(index).slice(0, 12)) {
    try {
      if ((await Deno.stat(`${path}/${candidate}`)).isFile) return `${path}/${candidate}`;
    } catch {
      // Next one.
    }
  }
  return undefined;
}

async function iconAndCursorThemes(): Promise<Theme[]> {
  const found = await Promise.all(
    themeDirs(HOME).icons.map(async (dir) => {
      const entries = (await listDir(dir)).filter((e) => e.isDirectory);
      return Promise.all(entries.map(async ({ name }) => {
        const path = `${dir}/${name}`;
        const index = await readText(`${path}/index.theme`);
        const themes = iconThemes(name, path, await names(path), index);
        const origin = originOf(dir, HOME);
        return Promise.all(themes.map(async (t) => ({
          ...t,
          origin,
          preview: t.kind === "icons" && index ? await preview(path, index) : undefined,
        })));
      }));
    }),
  );
  return dedupe(found.flat(2));
}

// --- Current values ------------------------------------------------------------

function gsettingsGet(kind: Kind): Promise<string | undefined> {
  const key = GSETTINGS[backend === "kde" || backend === "xfce" ? "gnome" : backend][kind];
  if (!key) return Promise.resolve(undefined);
  return quiet(exec("gsettings", ["get", ...key]).then(unquote));
}

const xfconfGet = (kind: Kind) =>
  XFCONF[kind] ? quiet(exec("xfconf-query", ["-c", "xsettings", "-p", XFCONF[kind]!])) : Promise.resolve(undefined);

const kread = (file: string, group: string, key: string) =>
  quiet(first(["kreadconfig6", "kreadconfig5"], ["--file", file, "--group", group, "--key", key]));

export interface State {
  backend: Backend;
  themes: Theme[];
  current: Partial<Record<Kind, string>>;
  /** GNOME 47+: the accent colors offered. */
  accents: string[];
  /** Whether the style (color-scheme) key exists. */
  hasStyle: boolean;
}

export async function load(): Promise<State> {
  const [gtk, icons] = await Promise.all([gtkThemes(), iconAndCursorThemes()]);
  const themes = [...gtk, ...icons];
  const current: Partial<Record<Kind, string>> = {};
  let accents: string[] = [];
  let hasStyle = false;

  if (backend === "kde") {
    const [schemes, looks, iconTheme, cursor, look, gtkName] = await Promise.all([
      quiet(exec("plasma-apply-colorscheme", ["--list-schemes"])),
      quiet(exec("plasma-apply-lookandfeel", ["--list"])),
      kread("kdeglobals", "Icons", "Theme"),
      kread("kcminputrc", "Mouse", "cursorTheme"),
      kread("kdeglobals", "KDE", "LookAndFeelPackage"),
      gsettingsGet("gtk"),
    ]);
    for (const s of parseColorSchemes(schemes ?? "")) {
      themes.push({ kind: "colors", id: s.id, name: readable(s.id), dark: /dark/i.test(s.id) });
      if (s.current) current.colors = s.id;
    }
    const lookIds = parseLookAndFeel(looks ?? "");
    themes.push(
      ...await Promise.all(lookIds.map(async (id): Promise<Theme> => {
        const meta = await readText(`${HOME}/.local/share/plasma/look-and-feel/${id}/metadata.json`) ??
          await readText(`/usr/share/plasma/look-and-feel/${id}/metadata.json`) ??
          await readText(`/usr/share/plasma/look-and-feel/${id}/metadata.desktop`);
        return { kind: "global", id, ...lookAndFeelName(id, meta), dark: /dark/i.test(id) };
      })),
    );
    current.icons = orDefault(iconTheme, "breeze");
    current.cursors = orDefault(cursor, "breeze_cursors");
    current.global = orDefault(look, "org.kde.breeze.desktop");
    if (gtkName) current.gtk = gtkName;
  } else {
    const kinds: Kind[] = ["gtk", "icons", "cursors"];
    const values = await Promise.all(kinds.map((k) => backend === "xfce" ? xfconfGet(k) : gsettingsGet(k)));
    kinds.forEach((k, i) => values[i] && (current[k] = values[i]));
    const [style, accent, range] = await Promise.all([
      gsettingsGet("style"),
      gsettingsGet("accent"),
      quiet(exec("gsettings", ["range", "org.gnome.desktop.interface", "accent-color"])),
    ]);
    if (style) {
      hasStyle = true;
      current.style = style;
      for (const s of STYLES) themes.push({ kind: "style", id: s.id, name: s.name, comment: s.comment, dark: s.dark });
    }
    if (accent && range) {
      accents = parseRange(range).filter((a) => a in ACCENT_TINTS);
      current.accent = accent;
      for (const a of accents) themes.push({ kind: "accent", id: a, name: readable(a) });
    }
  }
  return { backend, themes, current, accents, hasStyle };
}

// --- Changes -------------------------------------------------------------------

async function gsettingsSet(kind: Kind, value: string) {
  const key = GSETTINGS[backend === "kde" || backend === "xfce" ? "gnome" : backend][kind];
  if (!key) throw new Error("This desktop has no setting for that");
  try {
    await exec("gsettings", ["set", ...key, value]);
  } catch (e) {
    if (missing(e)) throw new Error("gsettings is not installed: themes can't be changed");
    throw e;
  }
}

/** Whether this kind can be applied here, or the panel that does it instead. */
export function canApply(kind: Kind): boolean {
  return !(backend === "kde" && kind === "gtk");
}

export async function apply(t: Theme): Promise<void> {
  if (backend === "kde") {
    switch (t.kind) {
      case "colors":
        await exec("plasma-apply-colorscheme", [t.id]);
        return;
      case "global":
        await exec("plasma-apply-lookandfeel", ["--apply", t.id]);
        return;
      case "cursors":
        await exec("plasma-apply-cursortheme", [t.id]);
        return;
      case "icons":
        await first(["kwriteconfig6", "kwriteconfig5"], [
          "--file",
          "kdeglobals",
          "--group",
          "Icons",
          "--key",
          "Theme",
          t.id,
        ]);
        // What plasma-changeicons does: tell running apps to reload their icons.
        await quiet(exec("gdbus", [
          "emit",
          "--session",
          "--object-path",
          "/KIconLoader",
          "--signal",
          "org.kde.KIconLoader.iconChanged",
          "0",
        ]));
        return;
      default:
        throw new Error("Change GTK themes in System Settings → Colors & Themes → Application Style");
    }
  }
  if (backend === "xfce" && XFCONF[t.kind]) {
    await exec("xfconf-query", ["-c", "xsettings", "-p", XFCONF[t.kind]!, "-s", t.id]);
    // GTK 4 apps and the portal read gsettings.
    await quiet(gsettingsSet(t.kind, t.id));
    return;
  }
  await gsettingsSet(t.kind, t.id);
}

/** Opens KDE's application style panel, where GTK themes are picked. */
export function openGtkSettings() {
  new Deno.Command("systemsettings", { args: ["kcm_style"], stdin: "null", stdout: "null", stderr: "null" }).spawn()
    .unref();
}

/** Dark or light everywhere it can: the style, the GTK theme's dark variant, Plasma's color scheme. */
export async function setDark(state: State, dark: boolean): Promise<string> {
  if (state.backend === "kde") {
    const schemes = state.themes.filter((t) => t.kind === "colors").map((t) => t.id);
    const target = kdeCounterpart(state.current.colors ?? "BreezeLight", schemes, dark);
    if (!target) return dark ? "Already dark" : "Already light";
    await exec("plasma-apply-colorscheme", [target]);
    return `${readable(target)} colors`;
  }
  const changes: string[] = [];
  if (state.hasStyle) {
    await gsettingsSet("style", dark ? "prefer-dark" : "default");
    changes.push(dark ? "Dark style" : "Default style");
  }
  const gtk = state.current.gtk;
  const installed = state.themes.filter((t) => t.kind === "gtk").map((t) => t.id);
  const other = gtk ? counterpart(gtk, installed, dark) : undefined;
  if (other) {
    await apply({ kind: "gtk", id: other, name: other });
    changes.push(`GTK theme ${other}`);
  }
  if (!changes.length) throw new Error("This desktop has no dark style, and the GTK theme has no dark variant");
  return changes.join(", ");
}

/** Whether the desktop is dark now. */
export function isDark(state: State): boolean {
  if (state.backend === "kde") return /dark/i.test(state.current.colors ?? "");
  if (state.hasStyle) return state.current.style === "prefer-dark";
  return /dark/i.test(state.current.gtk ?? "");
}
