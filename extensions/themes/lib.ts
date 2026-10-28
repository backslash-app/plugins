// Finding installed themes, reading their names, and telling the current ones.

export type Kind = "gtk" | "icons" | "cursors" | "style" | "accent" | "colors" | "global";

export const KIND_NAMES: Record<Kind, string> = {
  gtk: "GTK Themes",
  icons: "Icon Themes",
  cursors: "Cursor Themes",
  style: "Style",
  accent: "Accent Color",
  colors: "Color Schemes",
  global: "Global Themes",
};

/** A theme or a setting the user can pick. */
export interface Theme {
  kind: Kind;
  /** What the desktop stores: the folder name, a scheme id, an enum value. */
  id: string;
  /** For humans: the index.theme Name, or the id made readable. */
  name: string;
  comment?: string;
  /** The folder it is installed in. */
  path?: string;
  /** Where it comes from: "System", "Your themes". */
  origin?: string;
  /** GTK versions it supports: "2", "3", "4". */
  gtk?: string[];
  inherits?: string;
  /** A sample icon (a folder) of an icon theme. */
  preview?: string;
  dark?: boolean;
}

// ---------------------------------------------------------------------------
// Desktop

export type Backend = "gnome" | "cinnamon" | "mate" | "xfce" | "kde";

/** Which settings store the session reads its themes from. */
export function detectBackend(xdgCurrentDesktop: string | undefined): Backend {
  const parts = (xdgCurrentDesktop ?? "").toLowerCase().split(":");
  if (parts.includes("kde")) return "kde";
  if (parts.some((p) => p.includes("cinnamon") || p === "x-cinnamon")) return "cinnamon";
  if (parts.includes("mate")) return "mate";
  if (parts.includes("xfce")) return "xfce";
  return "gnome";
}

/** gsettings schema and key of each kind, per desktop. */
export const GSETTINGS: Record<"gnome" | "cinnamon" | "mate", Partial<Record<Kind, [string, string]>>> = {
  gnome: {
    gtk: ["org.gnome.desktop.interface", "gtk-theme"],
    icons: ["org.gnome.desktop.interface", "icon-theme"],
    cursors: ["org.gnome.desktop.interface", "cursor-theme"],
    style: ["org.gnome.desktop.interface", "color-scheme"],
    accent: ["org.gnome.desktop.interface", "accent-color"],
  },
  cinnamon: {
    gtk: ["org.cinnamon.desktop.interface", "gtk-theme"],
    icons: ["org.cinnamon.desktop.interface", "icon-theme"],
    cursors: ["org.cinnamon.desktop.interface", "cursor-theme"],
    style: ["org.gnome.desktop.interface", "color-scheme"],
  },
  mate: {
    gtk: ["org.mate.interface", "gtk-theme"],
    icons: ["org.mate.interface", "icon-theme"],
    cursors: ["org.mate.peripherals-mouse", "cursor-theme"],
    style: ["org.gnome.desktop.interface", "color-scheme"],
  },
};

/** Xfce's xsettings properties. */
export const XFCONF: Partial<Record<Kind, string>> = {
  gtk: "/Net/ThemeName",
  icons: "/Net/IconThemeName",
  cursors: "/Gtk/CursorThemeName",
};

// ---------------------------------------------------------------------------
// Folders

/** The folders themes are installed in, the user's first (they win over the system's). */
export function themeDirs(home: string): { gtk: string[]; icons: string[] } {
  return {
    gtk: [`${home}/.local/share/themes`, `${home}/.themes`, "/usr/local/share/themes", "/usr/share/themes"],
    icons: [`${home}/.local/share/icons`, `${home}/.icons`, "/usr/local/share/icons", "/usr/share/icons"],
  };
}

export const originOf = (dir: string, home: string) =>
  home && dir.startsWith(home + "/") ? "Your themes" : dir.startsWith("/usr/local") ? "Installed locally" : "System";

/** An INI file (index.theme, .colors, kdeglobals): sections of keys, localized keys left out. */
export function parseIni(text: string): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  let section = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const h = /^\[(.+)\]$/.exec(line);
    if (h) {
      section = h[1];
      out[section] ??= {};
      continue;
    }
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (key.includes("[")) continue;
    (out[section] ??= {})[key] = line.slice(eq + 1).trim();
  }
  return out;
}

/** `Yaru-blue-dark` → "Yaru Blue Dark", `BreezeDark` → "Breeze Dark", `breeze_cursors` → "Breeze Cursors". */
export function readable(id: string): string {
  return id
    .replace(/[-_]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b([a-z])/g, (c) => c.toUpperCase())
    .trim();
}

export const isDarkName = (name: string) => /dark|night|black|noir|dracula|nord|mocha|macchiato|frappe/i.test(name);

/**
 * A GTK theme folder, from the names of what it contains and its index.theme.
 * Undefined when it only themes a window manager or GNOME Shell.
 */
export function gtkTheme(id: string, path: string, entries: string[], index?: string): Theme | undefined {
  const gtk = entries
    .map((e) => /^gtk-(\d)\.0$/.exec(e)?.[1])
    .filter((v): v is string => !!v)
    .sort();
  if (!gtk.some((v) => v === "3" || v === "4")) return undefined;
  const ini = index ? parseIni(index) : {};
  const entry = ini["Desktop Entry"] ?? {};
  if (/^true$/i.test(entry.Hidden ?? "")) return undefined;
  const name = entry.Name || readable(id);
  return {
    kind: "gtk",
    id,
    name,
    comment: entry.Comment || undefined,
    path,
    gtk,
    dark: isDarkName(id),
  };
}

/** Folders of /usr/share/icons that are not themes to pick. */
const NOT_THEMES = new Set(["default", "hicolor", "locolor"]);

/** An icon folder: an icon theme, a cursor theme (it has `cursors/`), both, or neither. */
export function iconThemes(id: string, path: string, entries: string[], index?: string): Theme[] {
  if (NOT_THEMES.has(id)) return [];
  const ini = index ? parseIni(index) : {};
  const meta = ini["Icon Theme"] ?? {};
  if (/^true$/i.test(meta.Hidden ?? "")) return [];
  const name = meta.Name || readable(id);
  const out: Theme[] = [];
  const directories = (meta.Directories ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  if (directories.length) {
    out.push({
      kind: "icons",
      id,
      name,
      comment: meta.Comment || undefined,
      path,
      inherits: meta.Inherits || undefined,
      dark: isDarkName(id),
    });
  }
  if (entries.includes("cursors")) {
    out.push({ kind: "cursors", id, name, comment: meta.Comment || undefined, path });
  }
  return out;
}

/** Where a theme's folder icon may be, the best first: scalable, then the biggest size. */
export function previewCandidates(index: string): string[] {
  const meta = parseIni(index)["Icon Theme"] ?? {};
  const dirs = (meta.Directories ?? "").split(",").map((d) => d.trim()).filter((d) => /places/i.test(d));
  const size = (d: string) => {
    if (/scalable/i.test(d)) return 1000;
    const m = /(\d+)(?:x\d+)?(?:@(\d)x?)?/.exec(d);
    const n = m ? Number(m[1]) * Number(m[2] ?? 1) : 0;
    // 48 to 128 look best in a list and a side panel.
    return n >= 48 && n <= 256 ? 500 + n : n;
  };
  const sorted = [...dirs].sort((a, b) => size(b) - size(a));
  return sorted.flatMap((d) => [`${d}/folder.svg`, `${d}/folder.png`, `${d}/inode-directory.svg`]);
}

/** The same theme found in several folders: the first (the user's) wins. */
export function dedupe(themes: Theme[]): Theme[] {
  const seen = new Set<string>();
  return themes.filter((t) => {
    const key = `${t.kind}:${t.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// GNOME and friends

/** A gsettings value: `'Adwaita'` → `Adwaita`. */
export const unquote = (value: string) => value.trim().replace(/^'(.*)'$/s, "$1").replace(/\\'/g, "'");

/** `gsettings range`: `enum\n'blue'\n'teal'` → the values. */
export function parseRange(text: string): string[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  if (lines[0] !== "enum") return [];
  return lines.slice(1).map(unquote);
}

export const STYLES: { id: string; name: string; comment: string; dark: boolean }[] = [
  { id: "default", name: "Default", comment: "Each app picks its own colors, usually light", dark: false },
  { id: "prefer-dark", name: "Dark", comment: "Apps use their dark style", dark: true },
  { id: "prefer-light", name: "Light", comment: "Apps use their light style", dark: false },
];

/** GNOME 47's accent colors and the tint that shows them. */
export const ACCENT_TINTS: Record<
  string,
  "blue" | "teal" | "green" | "yellow" | "orange" | "red" | "pink" | "purple" | "gray"
> = {
  blue: "blue",
  teal: "teal",
  green: "green",
  yellow: "yellow",
  orange: "orange",
  red: "red",
  pink: "pink",
  purple: "purple",
  slate: "gray",
};

/**
 * The GTK theme to use with dark (or light) mode: `Adwaita` ↔ `Adwaita-dark`,
 * `Yaru-blue` ↔ `Yaru-blue-dark`, `Arc` ↔ `Arc-Dark`. Undefined when there is none.
 */
export function counterpart(current: string, installed: string[], dark: boolean): string | undefined {
  const has = (name: string) => installed.find((i) => i.toLowerCase() === name.toLowerCase());
  if (dark) {
    if (isDarkName(current)) return undefined;
    for (const suffix of ["-dark", "-Dark", "_dark", "dark", "Dark"]) {
      const found = has(`${current}${suffix}`);
      if (found) return found;
    }
    // "Orchis-Light" → "Orchis-Dark", "WhiteSur-Light" → "WhiteSur-Dark".
    if (/light/i.test(current)) return has(current.replace(/light/i, "Dark"));
    return undefined;
  }
  if (!isDarkName(current)) return undefined;
  const base = current.replace(/[-_]?dark(er)?$/i, "");
  if (base !== current && has(base)) return has(base);
  return has(current.replace(/dark/i, "Light")) ?? has(current.replace(/[-_]?dark/i, ""));
}

// ---------------------------------------------------------------------------
// KDE Plasma

/** `plasma-apply-colorscheme --list-schemes`: ` * BreezeDark (current color scheme)`. */
export function parseColorSchemes(text: string): { id: string; current: boolean }[] {
  const out: { id: string; current: boolean }[] = [];
  for (const line of text.split("\n")) {
    const m = /^\s*\*\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const current = /\(current color scheme\)$/.test(m[1]);
    out.push({ id: m[1].replace(/\s*\(current color scheme\)$/, ""), current });
  }
  return out;
}

/** `plasma-apply-lookandfeel --list`: one package id per line. */
export function parseLookAndFeel(text: string): string[] {
  return text.split("\n").map((l) => l.trim().replace(/^\*\s*/, "")).filter((l) => /^[\w.-]+$/.test(l));
}

/** A look-and-feel package's metadata.json (Plasma 5.26+ and 6) or metadata.desktop. */
export function lookAndFeelName(id: string, metadata?: string): { name: string; comment?: string } {
  if (metadata) {
    try {
      const plugin = (JSON.parse(metadata) as { KPlugin?: { Name?: string; Description?: string } }).KPlugin;
      if (plugin?.Name) return { name: plugin.Name, comment: plugin.Description || undefined };
    } catch {
      const entry = parseIni(metadata)["Desktop Entry"];
      if (entry?.Name) return { name: entry.Name, comment: entry.Comment || undefined };
    }
  }
  // org.kde.breezedark.desktop → "Breezedark".
  return { name: readable(id.replace(/^org\.kde\./, "").replace(/\.desktop$/, "")) };
}

/** The Plasma color scheme for the other mode: BreezeDark ↔ BreezeLight (or Breeze). */
export function kdeCounterpart(current: string, installed: string[], dark: boolean): string | undefined {
  const has = (name: string) =>
    name.toLowerCase() === current.toLowerCase()
      ? undefined
      : installed.find((i) => i.toLowerCase() === name.toLowerCase());
  if (dark) {
    if (isDarkName(current)) return undefined;
    return has(current.replace(/light$/i, "Dark")) ?? has(`${current}Dark`) ?? has(`${current} Dark`) ??
      has("BreezeDark");
  }
  if (!isDarkName(current)) return undefined;
  return has(current.replace(/dark$/i, "Light")) ?? has(current.replace(/\s*dark$/i, "")) ?? has("BreezeLight") ??
    has("Breeze");
}

/** A `kreadconfig` answer, or the default when the key isn't set. */
export const orDefault = (value: string | undefined, fallback: string) => value?.trim() || fallback;

// ---------------------------------------------------------------------------
// Listing

export const KIND_ORDER: Kind[] = ["style", "accent", "global", "colors", "gtk", "icons", "cursors"];

export function sortThemes(themes: Theme[], current: Partial<Record<Kind, string>>): Theme[] {
  return [...themes].sort((a, b) =>
    KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
    (a.kind === "style" || a.kind === "accent"
      ? 0
      : Number(current[b.kind] === b.id) - Number(current[a.kind] === a.id) || a.name.localeCompare(b.name))
  );
}

/** The chips of the list, for what this desktop has. */
export function filterOptions(backend: Backend, accents: boolean): { value: string; title: string }[] {
  return [
    { value: "all", title: "All" },
    ...(backend === "kde"
      ? [{ value: "global", title: "Global" }, { value: "colors", title: "Colors" }]
      : [{ value: "style", title: accents ? "Style & Accent" : "Style" }]),
    { value: "gtk", title: "GTK" },
    { value: "icons", title: "Icons" },
    { value: "cursors", title: "Cursors" },
  ];
}

export function matchesFilter(kind: Kind, filter: string | undefined): boolean {
  if (!filter || filter === "all") return true;
  if (filter === "style") return kind === "style" || kind === "accent";
  return kind === filter;
}
