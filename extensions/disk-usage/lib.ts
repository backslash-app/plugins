// Parsing du, df, find, journalctl and docker output, and choosing what to
// show. Pure, tested in lib_test.ts.

export interface Entry {
  path: string;
  size: number;
}

/** One `du -b` line: `123456\t/home/ada/.cache`. */
export function parseDuLine(line: string): Entry | undefined {
  const m = line.match(/^(\d+)\t(.+)$/);
  return m ? { size: Number(m[1]), path: m[2] } : undefined;
}

export function parseDu(text: string): Entry[] {
  return text.split("\n").map(parseDuLine).filter((e): e is Entry => !!e);
}

export interface Disk {
  size: number;
  used: number;
  available: number;
  mount: string;
}

/** `df -B1 --output=size,used,avail,target <path>`. */
export function parseDf(text: string): Disk | undefined {
  const line = text.trim().split("\n").slice(1).find((l) => l.trim());
  const m = line?.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
  return m ? { size: +m[1], used: +m[2], available: +m[3], mount: m[4] } : undefined;
}

/** `journalctl --disk-usage`: "Archived and active journals take up 1.2G in the file system." */
export function parseJournalUsage(text: string): number | undefined {
  const m = text.match(/take up ([\d.]+)\s*([KMGTP]?)i?B?\b/i);
  if (!m) return undefined;
  const pow = m[2] ? "KMGTP".indexOf(m[2].toUpperCase()) + 1 : 0;
  return Math.round(parseFloat(m[1]) * 1024 ** pow);
}

/** "2.5GB", "512.3MB", "0B", "1.03kB" (docker, decimal units) → bytes. */
export function parseHumanSize(text: string): number {
  const m = text.trim().match(/^([\d.]+)\s*([kKMGTP]?)i?B?/);
  if (!m) return 0;
  const pow = m[2] ? "KMGTP".indexOf(m[2].toUpperCase()) + 1 : 0;
  return Math.round(parseFloat(m[1]) * 1000 ** pow);
}

export interface ContainerUsage {
  type: string;
  total: number;
  active: number;
  size: number;
  reclaimable: number;
}

/** `docker system df --format '{{json .}}'` (podman prints the same fields). */
export function parseSystemDf(text: string): ContainerUsage[] {
  return text.split("\n").filter((l) => l.trim().startsWith("{")).map((l) => {
    const o = JSON.parse(l) as Record<string, string | number>;
    return {
      type: String(o.Type ?? ""),
      total: Number(o.TotalCount ?? o.Total ?? 0),
      active: Number(o.Active ?? 0),
      size: typeof o.Size === "number" ? o.Size : parseHumanSize(String(o.Size ?? "0")),
      reclaimable: typeof o.Reclaimable === "number"
        ? o.Reclaimable
        : parseHumanSize(String(o.Reclaimable ?? "0").replace(/\s*\(.*\)/, "")),
    };
  });
}

export interface BigFile extends Entry {
  modified: number;
}

/** One `find -printf '%s\t%T@\t%p\n'` line. */
export function parseFindLine(line: string): BigFile | undefined {
  const m = line.match(/^(\d+)\t([\d.]+)\t(.+)$/);
  return m ? { size: +m[1], modified: Math.round(parseFloat(m[2]) * 1000), path: m[3] } : undefined;
}

// ---------------------------------------------------------------------------
// Choosing

const depth = (path: string, root: string) =>
  path === root ? 0 : path.slice(root.length).split("/").filter(Boolean).length;

/** The folders right under `root`, biggest first. */
export function topFolders(entries: Entry[], root: string, limit = 20): Entry[] {
  return entries.filter((e) => e.path.startsWith(`${root}/`) && depth(e.path, root) === 1)
    .sort((a, b) => b.size - a.size).slice(0, limit);
}

/** The biggest subfolders of `parent` among the entries. */
export function childrenOf(entries: Entry[], parent: string, limit = 6): Entry[] {
  return entries.filter((e) => e.path.startsWith(`${parent}/`) && !e.path.slice(parent.length + 1).includes("/"))
    .sort((a, b) => b.size - a.size).slice(0, limit);
}

/** Total of the root from du's last line, or the sum of its children while scanning. */
export function rootSize(entries: Entry[], root: string): number {
  const own = entries.find((e) => e.path === root);
  return own?.size ?? topFolders(entries, root, Infinity).reduce((s, e) => s + e.size, 0);
}

/** Keeps the biggest files, without duplicates. */
export function biggest<T extends Entry>(files: T[], limit = 25): T[] {
  const seen = new Set<string>();
  return [...files].sort((a, b) => b.size - a.size).filter((f) => !seen.has(f.path) && seen.add(f.path)).slice(
    0,
    limit,
  );
}

/** What a cache folder belongs to, for a friendlier subtitle. */
export function cacheOwner(name: string): string | undefined {
  const known: Record<string, string> = {
    "mozilla": "Firefox",
    "google-chrome": "Google Chrome",
    "chromium": "Chromium",
    "BraveSoftware": "Brave",
    "thumbnails": "Thumbnails",
    "pip": "Python pip",
    "pypoetry": "Poetry",
    "uv": "uv (Python)",
    "yarn": "Yarn",
    "pnpm": "pnpm",
    "deno": "Deno",
    "go-build": "Go build cache",
    "JetBrains": "JetBrains IDEs",
    "spotify": "Spotify",
    "tracker3": "GNOME search index",
    "fontconfig": "Fonts",
    "mesa_shader_cache": "GPU shaders",
    "nvidia": "NVIDIA shaders",
    "yay": "yay (AUR)",
    "paru": "paru (AUR)",
    "flatpak": "Flatpak",
    "electron": "Electron",
    "ms-playwright": "Playwright browsers",
    "huggingface": "Hugging Face models",
    "torch": "PyTorch",
    "bazel": "Bazel",
    "ccache": "ccache",
    "sccache": "sccache",
    "cargo": "Cargo",
    "npm": "npm",
    "node-gyp": "node-gyp",
    "gstreamer-1.0": "GStreamer",
    "babl": "GIMP",
    "gimp": "GIMP",
    "steam": "Steam",
    "vscode-cpptools": "VS Code C++",
    "typescript": "TypeScript",
  };
  return known[name];
}

/** A cache folder that is safe to empty: everything under ~/.cache is, by definition, except a few. */
export function safeCache(name: string): boolean {
  // Some apps keep things there that aren't recreated without a download or a long rebuild.
  return !["ms-playwright", "huggingface", "torch"].includes(name);
}

// ---------------------------------------------------------------------------
// Package caches

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

/** Where the distribution keeps downloaded packages, and how to clean it. */
export function packageCache(f?: Family): { name: string; path: string; clean: string[] } | undefined {
  switch (f) {
    case "arch":
      return {
        name: "pacman cache",
        path: "/var/cache/pacman/pkg",
        clean: ["sudo", "pacman", "-Sc"],
      };
    case "debian":
      return { name: "APT cache", path: "/var/cache/apt/archives", clean: ["sudo", "apt-get", "clean"] };
    case "fedora":
      return { name: "DNF cache", path: "/var/cache/libdnf5", clean: ["sudo", "dnf", "clean", "all"] };
    case "suse":
      return { name: "Zypper cache", path: "/var/cache/zypp/packages", clean: ["sudo", "zypper", "clean", "--all"] };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export const tilde = (p: string, home: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);
export const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() ?? p;
export const dirname = (p: string) => p.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";

/** "3 days ago", "2 months ago". */
export function ago(ms: number, now = Date.now()): string {
  const d = Math.floor((now - ms) / 86400000);
  if (d < 1) return "today";
  if (d === 1) return "yesterday";
  if (d < 31) return `${d} days ago`;
  const m = Math.floor(d / 30.4);
  if (m < 12) return `${m} month${m === 1 ? "" : "s"} ago`;
  const y = Math.floor(d / 365);
  return `${y} year${y === 1 ? "" : "s"} ago`;
}

/** Color of a share of the disk. */
export function shareColor(ratio: number): "red" | "orange" | "yellow" | "blue" {
  return ratio >= 0.25 ? "red" : ratio >= 0.1 ? "orange" : ratio >= 0.03 ? "yellow" : "blue";
}

/** A tiny text bar for the detail panel: `▓▓▓▓░░░░░░`. */
export function bar(ratio: number, width = 20): string {
  const n = Math.max(0, Math.min(width, Math.round(ratio * width)));
  return "▓".repeat(n) + "░".repeat(width - n);
}
