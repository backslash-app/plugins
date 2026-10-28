// Desktops and how each sets a wallpaper, picture sizes from file headers,
// Wallhaven and Unsplash responses. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Desktops

export type Backend =
  | "gnome"
  | "cinnamon"
  | "mate"
  | "kde"
  | "xfce"
  | "hyprpaper"
  | "swww"
  | "sway"
  | "feh"
  | "nitrogen";

export const BACKENDS: Backend[] = [
  "gnome",
  "cinnamon",
  "mate",
  "kde",
  "xfce",
  "hyprpaper",
  "swww",
  "sway",
  "feh",
  "nitrogen",
];

export type Desktop = "gnome" | "cinnamon" | "mate" | "kde" | "xfce" | "hyprland" | "sway" | "other";

export interface Session {
  desktop: Desktop;
  wayland: boolean;
}

export type Env = Partial<Record<string, string>>;

export const SESSION_ENV = [
  "XDG_CURRENT_DESKTOP",
  "XDG_SESSION_TYPE",
  "DESKTOP_SESSION",
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "SWAYSOCK",
] as const;

/** From XDG_CURRENT_DESKTOP ("ubuntu:GNOME", "X-Cinnamon", "KDE", "Hyprland"…). */
export function detectSession(env: Env): Session {
  const type = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const wayland = type === "wayland" || (!!env.WAYLAND_DISPLAY && type !== "x11");
  const names = `${env.XDG_CURRENT_DESKTOP ?? ""}:${env.DESKTOP_SESSION ?? ""}`.toLowerCase().split(":");
  const has = (...n: string[]) => names.some((d) => n.includes(d));
  const desktop: Desktop = env.HYPRLAND_INSTANCE_SIGNATURE || has("hyprland")
    ? "hyprland"
    : env.SWAYSOCK || has("sway")
    ? "sway"
    : has("x-cinnamon", "cinnamon")
    ? "cinnamon"
    : has("mate")
    ? "mate"
    : has("xfce", "xfce4", "xubuntu")
    ? "xfce"
    : has("kde", "plasma", "plasmawayland")
    ? "kde"
    : has("gnome", "ubuntu", "unity", "pop", "budgie", "budgie-desktop", "zorin", "gnome-classic")
    ? "gnome"
    : "other";
  return { desktop, wayland };
}

export const DESKTOP_NAMES: Record<Desktop, string> = {
  gnome: "GNOME",
  cinnamon: "Cinnamon",
  mate: "MATE",
  kde: "KDE Plasma",
  xfce: "Xfce",
  hyprland: "Hyprland",
  sway: "Sway",
  other: "Desktop",
};

export const sessionName = (s: Session) =>
  s.desktop === "other" ? (s.wayland ? "Wayland" : "X11") : DESKTOP_NAMES[s.desktop];

/** Backends to try for this session, best first. */
export function backendCandidates(s: Session): Backend[] {
  switch (s.desktop) {
    case "gnome":
      return ["gnome"];
    case "cinnamon":
      return ["cinnamon"];
    case "mate":
      return ["mate"];
    case "kde":
      return ["kde"];
    case "xfce":
      return ["xfce"];
    case "hyprland":
      return ["swww", "hyprpaper"];
    case "sway":
      return ["sway", "swww"];
    default:
      return s.wayland ? ["swww"] : ["feh", "nitrogen"];
  }
}

/** The program each backend runs, to check that it is installed. */
export const BACKEND_PROGRAM: Record<Backend, string> = {
  gnome: "gsettings",
  cinnamon: "gsettings",
  mate: "gsettings",
  kde: "plasma-apply-wallpaperimage",
  xfce: "xfconf-query",
  hyprpaper: "hyprctl",
  swww: "swww",
  sway: "swaymsg",
  feh: "feh",
  nitrogen: "nitrogen",
};

export const BACKEND_PACKAGES: Record<Backend, string[]> = {
  gnome: ["gsettings"],
  cinnamon: ["gsettings"],
  mate: ["gsettings"],
  kde: ["plasma-workspace"],
  xfce: ["xfconf"],
  hyprpaper: ["hyprpaper"],
  swww: ["swww"],
  sway: ["swaybg"],
  feh: ["feh"],
  nitrogen: ["nitrogen"],
};

/** Reads the "backend" preference: a backend name, or undefined for automatic. */
export function backendPreference(text: unknown): Backend | undefined {
  const v = String(text ?? "").trim().toLowerCase();
  return (BACKENDS as string[]).includes(v) ? (v as Backend) : undefined;
}

export const fileUri = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

export type Variant = "both" | "light" | "dark";

/** Commands that set the wallpaper, run in order. XFCE takes its monitor properties (see `xfceProperties`). */
export function setCommands(
  backend: Backend,
  path: string,
  o: { variant?: Variant; xfce?: string[] } = {},
): [string, string[]][] {
  const uri = fileUri(path);
  switch (backend) {
    case "gnome": {
      const keys = o.variant === "light" ? ["picture-uri"] : o.variant === "dark" ? ["picture-uri-dark"] : [
        "picture-uri",
        "picture-uri-dark",
      ];
      return [
        ...keys.map((k): [string, string[]] => ["gsettings", ["set", "org.gnome.desktop.background", k, uri]]),
        ["gsettings", ["set", "org.gnome.desktop.background", "picture-options", "zoom"]],
      ];
    }
    case "cinnamon":
      return [
        ["gsettings", ["set", "org.cinnamon.desktop.background", "picture-uri", uri]],
        ["gsettings", ["set", "org.cinnamon.desktop.background", "picture-options", "zoom"]],
      ];
    case "mate":
      return [
        ["gsettings", ["set", "org.mate.background", "picture-filename", path]],
        ["gsettings", ["set", "org.mate.background", "picture-options", "zoom"]],
      ];
    case "kde":
      return [["plasma-apply-wallpaperimage", [path]]];
    case "xfce":
      return (o.xfce ?? []).map((
        p,
      ): [string, string[]] => ["xfconf-query", ["-c", "xfce4-desktop", "-p", p, "-s", path]]);
    case "hyprpaper":
      return [
        ["hyprctl", ["hyprpaper", "preload", path]],
        ["hyprctl", ["hyprpaper", "wallpaper", `,${path}`]],
      ];
    case "swww":
      return [["swww", ["img", path, "--transition-type", "grow", "--transition-duration", "1"]]];
    case "sway":
      return [["swaymsg", ["output", "*", "bg", path, "fill"]]];
    case "feh":
      return [["feh", ["--no-fehbg", "--bg-fill", path]]];
    case "nitrogen":
      return [["nitrogen", ["--set-zoom-fill", "--save", path]]];
  }
}

/** `xfconf-query -c xfce4-desktop -l` → the last-image property of each monitor and workspace. */
export function xfceProperties(list: string): string[] {
  return list.split("\n").map((l) => l.trim()).filter((l) => /\/last-image$/.test(l));
}

/** `gsettings get … picture-uri` output ('file:///…') → a path. */
export function parseGsettingsUri(out: string): string | undefined {
  const v = out.trim().replace(/^'(.*)'$/, "$1");
  if (!v) return undefined;
  if (v.startsWith("/")) return v;
  if (!v.startsWith("file://")) return undefined;
  try {
    return decodeURIComponent(v.slice(7));
  } catch {
    return v.slice(7);
  }
}

/** Whether the change lasts after logging out (or needs the config file of the tool). */
export function persistent(backend: Backend): boolean {
  return !["hyprpaper", "sway", "feh"].includes(backend);
}

export function persistenceHint(backend: Backend, path: string): string | undefined {
  switch (backend) {
    case "hyprpaper":
      return `Set until you log out. To keep it, put in ~/.config/hypr/hyprpaper.conf:\n\n\`preload = ${path}\`\n\`wallpaper = ,${path}\``;
    case "sway":
      return `Set until you log out. To keep it, put in your Sway config:\n\n\`output * bg ${path} fill\``;
    case "feh":
      return `Set until you log out. To keep it, run at login:\n\n\`feh --bg-fill ${path}\``;
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Files

export const IMAGE = /\.(jpe?g|png|webp|avif|bmp|jxl|heic|gif)$/i;

const trim = (s: string) => s.replace(/\/+$/, "");
export const basename = (p: string) => trim(p).split("/").pop() ?? p;
export const dirname = (p: string) => trim(p).split("/").slice(0, -1).join("/") || "/";

/** "mountain_lake-4k.jpg" → "Mountain Lake 4k". */
export function prettyName(file: string): string {
  const stem = basename(file).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return stem ? stem[0].toUpperCase() + stem.slice(1) : basename(file);
}

/** The folders preference: comma or newline separated, `~` expanded. */
export function parseFolders(text: unknown, home: string): string[] {
  const raw = String(text ?? "").trim() || "~/Pictures/Wallpapers";
  return [
    ...new Set(
      raw.split(/[,\n]/).map((s) => s.trim()).filter(Boolean).map((s) => trim(s.replace(/^~(?=\/|$)/, home))),
    ),
  ];
}

/** Width and height from the first bytes of a PNG, JPEG, WebP or GIF. */
export function imageSize(b: Uint8Array): { width: number; height: number } | undefined {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (o: number, n: number) => String.fromCharCode(...b.subarray(o, o + n));
  if (b.length >= 24 && b[0] === 0x89 && ascii(1, 3) === "PNG") {
    return { width: v.getUint32(16), height: v.getUint32(20) };
  }
  if (b.length >= 10 && ascii(0, 3) === "GIF") return { width: v.getUint16(6, true), height: v.getUint16(8, true) };
  if (b.length >= 30 && ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") {
    const kind = ascii(12, 4);
    if (kind === "VP8X") {
      const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
      return { width: w, height: h };
    }
    if (kind === "VP8 ") return { width: v.getUint16(26, true) & 0x3fff, height: v.getUint16(28, true) & 0x3fff };
    if (kind === "VP8L") {
      const bits = v.getUint32(21, true);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return undefined;
  }
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = b[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      const len = v.getUint16(i + 2);
      // SOF0..SOF15 except DHT (C4), JPG (C8) and DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: v.getUint16(i + 7), height: v.getUint16(i + 5) };
      }
      i += 2 + len;
    }
  }
  return undefined;
}

export interface SizedFile {
  path: string;
  name: string;
  folder: string;
  system: boolean;
  width?: number;
  height?: number;
}

/**
 * One wallpaper shipped in several sizes becomes one entry, the largest:
 * KDE packages (<name>/contents/images/1920x1080.jpg) and system folders with
 * Name_1920x1080.png, Name_3840x2160.png…
 */
export function dedupeSizes<T extends SizedFile>(list: T[]): T[] {
  const best = new Map<string, { file: T; area: number }>();
  const out: T[] = [];
  for (const f of list) {
    const kde = f.path.match(/^(.*)\/contents\/(images(?:_dark)?)\/(\d+)x(\d+)\.(\w+)$/);
    const sized = f.system ? f.name.match(/^(.*?)[_ -]?(\d{3,5})x(\d{3,5})(.*)$/) : null;
    if (!kde && !sized) {
      out.push(f);
      continue;
    }
    const key = kde ? `${kde[1]}:${kde[2]}` : `${f.folder}/${sized![1]}${sized![4]}`;
    const [w, h] = kde ? [Number(kde[3]), Number(kde[4])] : [Number(sized![2]), Number(sized![3])];
    const file = kde
      ? { ...f, width: w, height: h, name: `${basename(kde[1])}${kde[2] === "images_dark" ? " (dark)" : ""}.${kde[5]}` }
      : f;
    const cur = best.get(key);
    if (!cur || w * h > cur.area) best.set(key, { file, area: w * h });
  }
  return [...out, ...[...best.values()].map((b) => b.file)];
}

export type Orientation = "landscape" | "portrait" | "square";
export const orientation = (w: number, h: number): Orientation =>
  Math.abs(w - h) / Math.max(w, h) < 0.05 ? "square" : w > h ? "landscape" : "portrait";

/** "16:9", "21:9", "4:3"… the closest common ratio. */
export function aspect(w: number, h: number): string {
  const r = w / h;
  const common: [string, number][] = [
    ["32:9", 32 / 9],
    ["21:9", 64 / 27],
    ["16:9", 16 / 9],
    ["16:10", 1.6],
    ["3:2", 1.5],
    ["4:3", 4 / 3],
    ["5:4", 1.25],
    ["1:1", 1],
    ["9:16", 9 / 16],
    ["3:4", 0.75],
  ];
  const best = common.reduce((a, b) => (Math.abs(b[1] - r) < Math.abs(a[1] - r) ? b : a));
  return Math.abs(best[1] - r) / r < 0.03 ? best[0] : `${r.toFixed(2)}:1`;
}

/** "4K", "QHD", "Full HD"… for the bigger side. */
export function resolutionLabel(w: number, h: number): string | undefined {
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  if (long >= 7680) return "8K";
  if (long >= 5120) return "5K";
  if (long >= 3840 || short >= 2160) return "4K";
  if (long >= 2560) return "QHD";
  if (long >= 1920) return "Full HD";
  if (long >= 1280) return "HD";
  return undefined;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** A random pick that isn't `current` when there is another choice. */
export function pickRandom<T>(items: T[], isCurrent: (t: T) => boolean, random = Math.random): T | undefined {
  const others = items.filter((i) => !isCurrent(i));
  const pool = others.length ? others : items;
  return pool.length ? pool[Math.floor(random() * pool.length)] : undefined;
}

/** A file name that doesn't collide with `taken`. */
export function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  for (let i = 2;; i++) if (!taken.has(`${stem}-${i}${ext}`)) return `${stem}-${i}${ext}`;
}

// ---------------------------------------------------------------------------
// Online: Wallhaven and Unsplash

export interface OnlineWallpaper {
  source: "wallhaven" | "unsplash";
  id: string;
  title: string;
  /** Small picture for the tile. */
  thumb: string;
  /** Bigger picture for the side panel. */
  preview: string;
  /** What to download. */
  full: string;
  /** Unsplash: the endpoint to call when downloading (their API rules). */
  downloadLocation?: string;
  page: string;
  width: number;
  height: number;
  size?: number;
  author?: string;
  authorUrl?: string;
  authorAvatar?: string;
  colors: string[];
  tags: string[];
  views?: number;
  likes?: number;
  category?: string;
  created?: string;
  ext: string;
}

export const WALLHAVEN = "https://wallhaven.cc/api/v1";
export const UNSPLASH = "https://api.unsplash.com";
/** Unsplash asks apps to link back with these parameters. */
export const UTM = "utm_source=backslash&utm_medium=referral";

/** The Wallhaven search URL. Empty query: this month's top list. */
export function wallhavenUrl(query: string, o: { sketchy?: boolean; atleast?: string; page?: number } = {}): string {
  const p = new URLSearchParams({
    categories: "111",
    // SFW only by default; NSFW needs an account and is never asked for.
    purity: o.sketchy ? "110" : "100",
  });
  const q = query.trim();
  if (q) {
    p.set("q", q);
    p.set("sorting", "relevance");
  } else {
    p.set("sorting", "toplist");
    p.set("topRange", "1M");
  }
  if (o.atleast && /^\d+x\d+$/.test(o.atleast)) p.set("atleast", o.atleast);
  if (o.page && o.page > 1) p.set("page", String(o.page));
  return `${WALLHAVEN}/search?${p}`;
}

export function mapWallhaven(json: any): OnlineWallpaper[] {
  return (json?.data ?? []).map((w: any): OnlineWallpaper => {
    const ext = String(w.path ?? "").match(/\.(\w+)$/)?.[1] ?? (w.file_type === "image/png" ? "png" : "jpg");
    return {
      source: "wallhaven",
      id: String(w.id),
      title: `${
        String(w.category ?? "wallpaper").replace(/^./, (c) => c.toUpperCase())
      } · ${w.dimension_x}×${w.dimension_y}`,
      thumb: w.thumbs?.small ?? w.thumbs?.large,
      preview: w.thumbs?.large ?? w.thumbs?.original ?? w.thumbs?.small,
      full: w.path,
      page: w.url ?? `https://wallhaven.cc/w/${w.id}`,
      width: Number(w.dimension_x) || 0,
      height: Number(w.dimension_y) || 0,
      size: Number(w.file_size) || undefined,
      colors: (w.colors ?? []).map((c: string) => c.toLowerCase()),
      tags: (w.tags ?? []).map((t: any) => t.name).filter(Boolean),
      views: w.views,
      likes: w.favorites,
      category: w.category,
      created: w.created_at,
      author: w.uploader?.username,
      ext: ext === "jpeg" ? "jpg" : ext,
    };
  });
}

export function unsplashUrl(query: string, o: { page?: number } = {}): string {
  const q = query.trim();
  if (!q) return `${UNSPLASH}/photos?order_by=popular&per_page=30${o.page && o.page > 1 ? `&page=${o.page}` : ""}`;
  const p = new URLSearchParams({ query: q, per_page: "30", orientation: "landscape", content_filter: "high" });
  if (o.page && o.page > 1) p.set("page", String(o.page));
  return `${UNSPLASH}/search/photos?${p}`;
}

/** /search/photos returns { results }, /photos an array. */
export function mapUnsplash(json: any, width = 3840): OnlineWallpaper[] {
  const photos = Array.isArray(json) ? json : json?.results ?? [];
  return photos.map((p: any): OnlineWallpaper => {
    const name = p.user?.name ?? p.user?.username;
    const description = p.alt_description ?? p.description;
    return {
      source: "unsplash",
      id: String(p.id),
      title: description ? description[0].toUpperCase() + description.slice(1) : `Photo by ${name ?? "Unsplash"}`,
      thumb: p.urls?.small ?? p.urls?.thumb,
      preview: p.urls?.regular ?? p.urls?.small,
      full: p.urls?.raw ? `${p.urls.raw}${p.urls.raw.includes("?") ? "&" : "?"}w=${width}&fm=jpg&q=85` : p.urls?.full,
      downloadLocation: p.links?.download_location,
      page: `${p.links?.html ?? `https://unsplash.com/photos/${p.id}`}?${UTM}`,
      width: Number(p.width) || 0,
      height: Number(p.height) || 0,
      author: name,
      authorUrl: p.user?.links?.html ? `${p.user.links.html}?${UTM}` : undefined,
      authorAvatar: p.user?.profile_image?.medium,
      colors: p.color ? [String(p.color).toLowerCase()] : [],
      tags: (p.tags ?? []).map((t: any) => t.title).filter(Boolean),
      likes: p.likes,
      created: p.created_at,
      ext: "jpg",
    };
  });
}

/** The file name of a downloaded wallpaper. */
export const downloadName = (w: OnlineWallpaper) =>
  w.source === "wallhaven" ? `wallhaven-${w.id}.${w.ext}` : `unsplash-${w.id}.jpg`;

/** Whether a local file is this online wallpaper, already downloaded. */
export const downloadedAs = (w: OnlineWallpaper, names: Set<string>) => names.has(downloadName(w));

export function compact(n: number | undefined): string | undefined {
  if (n === undefined || n === null || Number.isNaN(n)) return undefined;
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}K`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
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

const PACKAGES: Record<string, Partial<Record<Family, string>>> = {
  gsettings: { debian: "libglib2.0-bin", arch: "glib2", fedora: "glib2", suse: "glib2-tools" },
  "plasma-workspace": { debian: "plasma-workspace" },
  xfconf: { debian: "xfconf", arch: "xfconf", fedora: "xfconf", suse: "xfconf" },
  imagemagick: { fedora: "ImageMagick", suse: "ImageMagick" },
};

const MANAGERS: Record<Family, string> = {
  arch: "sudo pacman -S",
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  suse: "sudo zypper install",
};

const FAMILY_NAMES: Record<Family, string> = {
  arch: "Arch",
  debian: "Debian, Ubuntu",
  fedora: "Fedora",
  suse: "openSUSE",
};

export function installCommand(programs: string[], family: Family): string {
  return `${MANAGERS[family]} ${[...new Set(programs.map((p) => PACKAGES[p]?.[family] ?? p))].join(" ")}`;
}

export function installMarkdown(what: string, programs: string[], family?: Family): string {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  return `${what}\n\n${
    families.map((f) => `**${FAMILY_NAMES[f]}**\n\n\`${installCommand(programs, f)}\``).join("\n\n")
  }`;
}
