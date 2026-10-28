// AppImages: recognising them, naming them from their file name, and their menu entries.

/** An AppImage file found on disk. */
export interface AppImage {
  path: string;
  file: string;
  name: string;
  version?: string;
  arch?: string;
  size: number;
  modified?: number;
  executable: boolean;
  /** 1 (ISO 9660) or 2 (squashfs), from the magic bytes; undefined when only the name says it is one. */
  type?: 1 | 2;
  /** The menu entry that starts it, if any. */
  entry?: DesktopFile;
}

/** `AI\x02` at offset 8 of an ELF file marks a type 2 AppImage, `AI\x01` a type 1. */
export function appImageType(head: Uint8Array): 1 | 2 | undefined {
  if (head.length < 11) return undefined;
  const elf = head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46;
  if (!elf || head[8] !== 0x41 || head[9] !== 0x49) return undefined;
  return head[10] === 1 ? 1 : head[10] === 2 ? 2 : undefined;
}

export const hasAppImageExtension = (file: string) => /\.appimage$/i.test(file);

const ARCHES: Record<string, string> = {
  x64: "x86_64",
  amd64: "x86_64",
  aarch64: "aarch64",
  arm64: "aarch64",
  armhf: "armhf",
  armv7l: "armhf",
  i386: "i386",
  i686: "i386",
  x86: "i386",
};

const NOISE = /^(linux|gnu|appimage|portable|release|setup|installer|gtk3|qt5|qt6)$/i;

/** `MuseScore-Studio-4.4.2.242570931-x86_64.AppImage` → name, version and architecture. */
export function parseFileName(file: string): { name: string; version?: string; arch?: string } {
  const base = file.replace(/\.appimage$/i, "").replace(/x86[_-]64/gi, "amd64");
  const tokens = base.split(/[-_ ]+/).filter(Boolean);
  const name: string[] = [];
  let version: string | undefined;
  let arch: string | undefined;
  for (const t of tokens) {
    const lower = t.toLowerCase();
    if (ARCHES[lower]) {
      arch = ARCHES[lower];
      continue;
    }
    const v = t.match(/^v?(\d+(?:\.\d+)+[\w.+~]*|\d{1,4}(?:[a-z]\w*)?)$/i);
    if (!version && v && name.length) {
      version = v[1].replace(/\+linux.*$/i, "");
      continue;
    }
    if (version) continue; // build numbers, flavours: "standard", "GTK3", dates
    if (NOISE.test(t)) continue;
    name.push(t);
  }
  const pretty = name.join(" ").trim();
  return { name: pretty || base, version, arch };
}

// --- Desktop entries ---------------------------------------------------------------------

export interface DesktopFile {
  /** Absolute path of the .desktop file. */
  file: string;
  name?: string;
  exec?: string;
  tryExec?: string;
  icon?: string;
  comment?: string;
  /** Who wrote it: Backslash, AppImageLauncher, Gear Lever, appimaged, or someone else. */
  by: "backslash" | "appimagelauncher" | "gearlever" | "appimaged" | "other";
  hidden: boolean;
}

/** The `[Desktop Entry]` group of a .desktop file. */
export function parseDesktopEntry(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let inMain = false;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inMain = line === "[Desktop Entry]";
      continue;
    }
    if (!inMain || !line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

/** The string escapes of the desktop entry spec: `\s`, `\n`, `\t`, `\r`, `\\`. */
function unescapeValue(v: string): string {
  return v.replace(/\\([sntr\\])/g, (_, c: string) => ({ s: " ", n: "\n", t: "\t", r: "\r", "\\": "\\" })[c]!);
}

/** The program of an `Exec=` line: `env X=1 "/home/me/My Apps/App.AppImage" %U` → the AppImage. */
export function execProgram(exec: string): string | undefined {
  const value = unescapeValue(exec);
  const args: string[] = [];
  let cur = "", quoted = false, any = false;
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (quoted) {
      if (c === "\\" && i + 1 < value.length) cur += value[++i];
      else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') {
      quoted = true;
      any = true;
    } else if (/\s/.test(c)) {
      if (cur || any) args.push(cur);
      cur = "";
      any = false;
    } else cur += c;
  }
  if (cur || any) args.push(cur);
  let i = 0;
  if (args[0] === "env") {
    i = 1;
    while (i < args.length && /^-|^\w+=/.test(args[i])) i++;
  }
  return args[i];
}

export function describeDesktop(file: string, text: string): DesktopFile {
  const e = parseDesktopEntry(text);
  const base = file.split("/").pop() ?? file;
  const by: DesktopFile["by"] = e["X-Backslash-AppImage"] === "true"
    ? "backslash"
    : /^appimagekit_/.test(base) && /X-AppImage-Integrate|X-AppImageLauncher/i.test(text)
    ? "appimagelauncher"
    : /^appimagekit_/.test(base)
    ? "appimaged"
    : /^gearlever_/i.test(base) || /X-GearLever/i.test(text)
    ? "gearlever"
    : "other";
  return {
    file,
    name: e.Name,
    exec: e.Exec ? execProgram(e.Exec) : undefined,
    tryExec: e.TryExec,
    icon: e.Icon,
    comment: e.Comment,
    by,
    hidden: e.Hidden === "true" || e.NoDisplay === "true",
  };
}

export const INTEGRATOR_LABELS: Record<DesktopFile["by"], string> = {
  backslash: "Backslash",
  appimagelauncher: "AppImageLauncher",
  gearlever: "Gear Lever",
  appimaged: "appimaged",
  other: "a menu entry",
};

/** The menu entry that starts this AppImage. */
export function findEntry(path: string, entries: DesktopFile[]): DesktopFile | undefined {
  return entries.find((e) => e.exec === path || e.tryExec === path);
}

export function slug(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "app";
}

export const desktopFileName = (name: string) => `backslash-appimage-${slug(name)}.desktop`;

/** Quotes an argument for `Exec=`, then escapes it as a desktop entry string. */
export function execQuote(arg: string): string {
  const inner = /[\s"'`$\\<>~|&;*?#()]/.test(arg) ? `"${arg.replace(/(["`$\\])/g, "\\$1")}"` : arg;
  return inner.replace(/\\/g, "\\\\");
}

/** A menu entry that starts the AppImage. */
export function desktopEntry(a: { name: string; path: string; version?: string; icon?: string }): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${a.name.replace(/\n/g, " ")}`,
    `Comment=${a.version ? `${a.name} ${a.version} (AppImage)` : `${a.name} (AppImage)`}`,
    `Exec=${execQuote(a.path)} %U`,
    `TryExec=${a.path}`,
    `Icon=${a.icon || "application-x-executable"}`,
    "Terminal=false",
    "Categories=Utility;",
    "StartupNotify=true",
    "X-Backslash-AppImage=true",
    ...(a.version ? [`X-AppImage-Version=${a.version}`] : []),
    "",
  ].join("\n");
}

// --- Formatting -------------------------------------------------------------------------------

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 31) return d === 1 ? "yesterday" : `${d} days ago`;
  const mo = Math.floor(d / 30.44);
  if (mo < 12) return mo === 1 ? "a month ago" : `${mo} months ago`;
  const y = Math.floor(d / 365.25);
  return y === 1 ? "a year ago" : `${y} years ago`;
}

export function tildify(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

export function expandHome(path: string, home: string): string {
  return path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
}

/** The folders searched: the usual ones, then the user's extra ones. */
export function searchFolders(home: string, extra: string): { path: string; deep: boolean; sniff: boolean }[] {
  const base = [
    { path: `${home}/Applications`, deep: true, sniff: true },
    { path: `${home}/AppImages`, deep: true, sniff: true },
    { path: `${home}/.local/bin`, deep: false, sniff: true },
    { path: `${home}/Downloads`, deep: false, sniff: false },
    { path: "/opt", deep: true, sniff: false },
  ];
  const more = extra.split(/[,\n]/).map((p) => p.trim()).filter(Boolean).map((p) => ({
    path: expandHome(p, home).replace(/\/+$/, ""),
    deep: true,
    sniff: true,
  }));
  const seen = new Set<string>();
  return [...base, ...more].filter((f) => !seen.has(f.path) && seen.add(f.path));
}

/** Where a file ends up in ~/Applications, without overwriting another one. */
export function moveTarget(file: string, existing: string[]): string {
  if (!existing.includes(file)) return file;
  const m = file.match(/^(.*?)(\.appimage)?$/i)!;
  for (let i = 2;; i++) {
    const candidate = `${m[1]} (${i})${m[2] ?? ""}`;
    if (!existing.includes(candidate)) return candidate;
  }
}

/** A unit name for `systemd-run`: `app-backslash-obsidian-1709290000`. */
export function runUnit(name: string, stamp: number): string {
  return `app-backslash-${slug(name).slice(0, 40)}-${stamp}`;
}
