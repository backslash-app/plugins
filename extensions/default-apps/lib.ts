// Pure helpers for Default Apps: categories, .desktop files and MIME handlers.

export interface Category {
  id: string;
  title: string;
  /** Representative MIME types; the first one decides what "the default" is. */
  mimes: string[];
  /** Apps are found by a Categories= value instead of MIME types (terminals). */
  desktopCategory?: string;
  /** Set with `xdg-settings set <setting>` rather than `xdg-mime default`. */
  setting?: string;
  description: string;
}

export const CATEGORIES: Category[] = [
  {
    id: "browser",
    title: "Web Browser",
    mimes: ["x-scheme-handler/http", "x-scheme-handler/https", "text/html", "application/xhtml+xml"],
    setting: "default-web-browser",
    description: "Opens links from every app.",
  },
  {
    id: "mail",
    title: "Mail",
    mimes: ["x-scheme-handler/mailto", "message/rfc822"],
    description: "Opens mailto: links and saved emails.",
  },
  {
    id: "files",
    title: "File Manager",
    mimes: ["inode/directory"],
    description: "Opens folders, e.g. “Show in folder” in apps.",
  },
  {
    id: "images",
    title: "Image Viewer",
    mimes: [
      "image/png",
      "image/jpeg",
      "image/gif",
      "image/webp",
      "image/svg+xml",
      "image/bmp",
      "image/tiff",
      "image/avif",
    ],
    description: "Opens pictures.",
  },
  {
    id: "video",
    title: "Video Player",
    mimes: ["video/mp4", "video/x-matroska", "video/webm", "video/quicktime", "video/x-msvideo", "video/mpeg"],
    description: "Plays video files.",
  },
  {
    id: "music",
    title: "Music Player",
    mimes: ["audio/mpeg", "audio/flac", "audio/ogg", "audio/x-wav", "audio/mp4", "audio/x-vorbis+ogg", "audio/opus"],
    description: "Plays audio files.",
  },
  {
    id: "pdf",
    title: "PDF Viewer",
    mimes: ["application/pdf"],
    description: "Opens PDF documents.",
  },
  {
    id: "text",
    title: "Text Editor",
    mimes: [
      "text/plain",
      "text/markdown",
      "application/x-shellscript",
      "text/x-python",
      "application/json",
      "text/x-csrc",
      "application/xml",
    ],
    description: "Opens plain text, code and config files.",
  },
  {
    id: "terminal",
    title: "Terminal",
    mimes: [],
    desktopCategory: "TerminalEmulator",
    description:
      "Saved in ~/.config/xdg-terminals.list, read by xdg-terminal-exec, which desktops and apps use to open a terminal.",
  },
];

export interface App {
  /** Desktop file id, e.g. `org.gnome.Nautilus.desktop`. */
  id: string;
  name: string;
  exec: string;
  mimes: string[];
  categories: string[];
  noDisplay: boolean;
  path: string;
}

/** The [Desktop Entry] group of a .desktop file, translations left out. */
export function parseDesktop(text: string): Record<string, string> {
  const out: Record<string, string> = {};
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
    if (!key.includes("[")) out[key] = line.slice(eq + 1).trim();
  }
  return out;
}

const list = (v?: string) => (v ?? "").split(";").map((s) => s.trim()).filter(Boolean);

/** An application entry, or undefined for hidden entries, links and directories. */
export function parseApp(id: string, path: string, text: string): App | undefined {
  const e = parseDesktop(text);
  if ((e.Type ?? "Application") !== "Application" || e.Hidden?.toLowerCase() === "true" || !e.Name) return undefined;
  return {
    id,
    name: e.Name,
    exec: e.Exec ?? "",
    mimes: list(e.MimeType),
    categories: list(e.Categories),
    noDisplay: e.NoDisplay?.toLowerCase() === "true",
    path,
  };
}

/** The desktop id of a file below an applications folder: `kde4/okular.desktop` → `kde4-okular.desktop`. */
export function desktopId(relative: string): string {
  return relative.replace(/^\/+/, "").replace(/\//g, "-");
}

/** First folder wins: the user's data folder shadows the system's. */
export function mergeApps(byDir: App[][]): Map<string, App> {
  const out = new Map<string, App>();
  for (const apps of byDir) for (const a of apps) if (!out.has(a.id)) out.set(a.id, a);
  return out;
}

/** Apps able to handle a category, the ones covering the most of its MIME types first. */
export function candidates(cat: Category, apps: Iterable<App>): App[] {
  const scored: { app: App; score: number }[] = [];
  for (const app of apps) {
    const score = cat.desktopCategory
      ? (app.categories.includes(cat.desktopCategory) ? 1 : 0)
      : cat.mimes.filter((m) => app.mimes.includes(m)).length;
    if (score > 0) scored.push({ app, score });
  }
  return scored.sort((a, b) =>
    Number(a.app.noDisplay) - Number(b.app.noDisplay) || b.score - a.score ||
    a.app.name.localeCompare(b.app.name, undefined, { sensitivity: "base" })
  ).map((s) => s.app);
}

export interface Current {
  /** The app most of the category's types open with. */
  id?: string;
  /** Types opening with something else. */
  mixed: boolean;
  byMime: Record<string, string | undefined>;
}

/** The default of a category from each MIME type's default (`xdg-mime query default`). */
export function currentDefault(cat: Category, byMime: Record<string, string | undefined>, setting?: string): Current {
  const ids = cat.mimes.map((m) => byMime[m]).filter((x): x is string => !!x);
  const counts = new Map<string, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  const first = cat.mimes.length ? byMime[cat.mimes[0]] : undefined;
  const id = setting || first || [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const mixed = cat.mimes.some((m) => byMime[m] && byMime[m] !== id);
  return { id, mixed, byMime };
}

/** `xdg-mime query default` output: one desktop id, or nothing. Some setups list several, `;`-separated. */
export function parseQuery(out: string): string | undefined {
  const id = out.trim().split(/[;\n]/)[0]?.trim();
  return id && id.endsWith(".desktop") ? id : undefined;
}

/** xdg-terminals.list: desktop ids (optionally `:action`), comments with #. */
export function parseTerminalsList(text: string): string[] {
  return text.split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean).map((l) => l.split(":")[0]);
}

/** The list with `id` first, the others kept after it. */
export function preferTerminal(text: string, id: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  const rest = lines.filter((l) => l.split(":")[0] !== id);
  return [id, ...rest].join("\n") + "\n";
}

/** The program of an Exec line: `env X=1 /usr/bin/foot --server %U` → `foot`. */
export function execProgram(exec: string): string {
  const words = exec.replace(/%[a-zA-Z]/g, "").trim().split(/\s+/);
  let i = 0;
  if (words[i] === "env") i++;
  while (words[i] && /^\w+=/.test(words[i])) i++;
  return (words[i] ?? "").replace(/^["']|["']$/g, "").split("/").pop() ?? "";
}

/** The terminal app matching $TERMINAL (a program name or path). */
export function terminalFromEnv(env: string | undefined, apps: App[]): string | undefined {
  if (!env) return undefined;
  const prog = env.trim().split(/\s+/)[0].split("/").pop();
  return apps.find((a) => execProgram(a.exec) === prog || a.id === `${prog}.desktop`)?.id;
}

/** A friendly name for an id with no installed .desktop file. */
export function fallbackName(id: string): string {
  const base = id.replace(/\.desktop$/, "").split(".").pop() ?? id;
  return base.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ---------------------------------------------------------------------------
// What to install

export type Family = "arch" | "debian" | "fedora" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

export const INSTALL_XDG_UTILS: Record<Family, string> = {
  debian: "sudo apt install xdg-utils",
  fedora: "sudo dnf install xdg-utils",
  arch: "sudo pacman -S xdg-utils",
  suse: "sudo zypper install xdg-utils",
};
