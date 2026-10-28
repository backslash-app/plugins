// XDG folders, file kinds and dates for the Downloads list. Pure, tested in lib_test.ts.

export type XdgDir =
  | "DESKTOP"
  | "DOWNLOAD"
  | "TEMPLATES"
  | "PUBLICSHARE"
  | "DOCUMENTS"
  | "MUSIC"
  | "PICTURES"
  | "VIDEOS";

export const XDG_TITLES: Record<XdgDir, string> = {
  DESKTOP: "Desktop",
  DOWNLOAD: "Downloads",
  TEMPLATES: "Templates",
  PUBLICSHARE: "Public",
  DOCUMENTS: "Documents",
  MUSIC: "Music",
  PICTURES: "Pictures",
  VIDEOS: "Videos",
};

/** `~/.config/user-dirs.dirs` → absolute folders. `$HOME/` alone means the folder is disabled. */
export function parseUserDirs(text: string, home: string): Partial<Record<XdgDir, string>> {
  const out: Partial<Record<XdgDir, string>> = {};
  for (const m of text.matchAll(/^\s*XDG_([A-Z]+)_DIR="([^"]*)"/gm)) {
    const key = m[1] as XdgDir;
    if (!(key in XDG_TITLES)) continue;
    const p = m[2].replace(/^\$HOME/, home).replace(/\/+$/, "");
    if (p && p !== home) out[key] = p;
  }
  return out;
}

export type Kind =
  | "image"
  | "video"
  | "audio"
  | "document"
  | "archive"
  | "installer"
  | "code"
  | "folder"
  | "partial"
  | "other";

const KINDS: [Kind, RegExp][] = [
  ["partial", /\.(crdownload|part|download|partial)$/i],
  ["installer", /\.(deb|rpm|appimage|flatpakref|flatpak|snap|run|pkg\.tar\.zst|exe|msi|dmg)$/i],
  ["image", /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|tiff?|ico)$/i],
  ["video", /\.(mp4|mkv|webm|mov|avi|m4v)$/i],
  ["audio", /\.(mp3|flac|ogg|opus|wav|m4a|aac)$/i],
  ["archive", /\.(zip|tar|gz|tgz|xz|zst|bz2|7z|rar|iso)$/i],
  ["document", /\.(pdf|docx?|odt|xlsx?|ods|pptx?|odp|rtf|epub|txt|md|csv)$/i],
  ["code", /\.(json|toml|ya?ml|sh|py|js|ts|html|css|xml|sql)$/i],
];

export function kindOf(name: string, isDir = false): Kind {
  if (isDir) return "folder";
  for (const [k, re] of KINDS) if (re.test(name)) return k;
  return "other";
}

export const KIND_TITLES: Record<Kind, string> = {
  image: "Picture",
  video: "Video",
  audio: "Audio",
  document: "Document",
  archive: "Archive",
  installer: "Installer",
  code: "Code",
  folder: "Folder",
  partial: "Downloading",
  other: "File",
};

/** Which filter chip shows a kind. */
export function matchesFilter(kind: Kind, filter: string): boolean {
  switch (filter) {
    case "images":
      return kind === "image";
    case "documents":
      return kind === "document";
    case "archives":
      return kind === "archive";
    case "installers":
      return kind === "installer";
    default:
      return true;
  }
}

/** Pictures the launcher can show in the side panel. */
export const previewable = (name: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);

/** The extension in capitals, for the tag: "PDF", "TAR.GZ". */
export function extTag(name: string): string | undefined {
  const m = name.match(/\.(tar\.(?:gz|xz|zst|bz2)|[a-z0-9]{1,8})$/i);
  return m ? m[1].toUpperCase() : undefined;
}

// ---------------------------------------------------------------------------
// Dates

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function section(date: Date, now = new Date()): "Today" | "Yesterday" | "This Week" | "Older" {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This Week";
  return "Older";
}

/** "14:03", "Yesterday 09:12", "Mon 26 Oct", "3 Mar 2025". */
export function when(date: Date, now = new Date()): string {
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const s = section(date, now);
  if (s === "Today") return time;
  if (s === "Yesterday") return `Yesterday ${time}`;
  if (s === "This Week") return date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return date.toLocaleDateString(
    "en-GB",
    date.getFullYear() === now.getFullYear()
      ? { day: "numeric", month: "short" }
      : { day: "numeric", month: "short", year: "numeric" },
  );
}

// ---------------------------------------------------------------------------
// Files

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

/** `file:///home/ada/My%20File.pdf` */
export const fileUri = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

export const tilde = (p: string, home: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

/** A new file name, or why it can't be one. */
export function checkName(name: string): string | undefined {
  const n = name.trim();
  if (!n) return "Type a name";
  if (n.includes("/")) return "A name can't contain “/”";
  if (n === "." || n === "..") return "Not a valid name";
  if (new TextEncoder().encode(n).length > 255) return "That name is too long";
  return undefined;
}

/** The host of the page a file came from, for the subtitle. */
export function hostOf(url?: string): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return u.protocol.startsWith("http") ? u.hostname.replace(/^www\./, "") : undefined;
  } catch {
    return undefined;
  }
}

/** A free name in a folder: `report.pdf` → `report (2).pdf`. */
export function freeName(name: string, taken: (n: string) => boolean): string {
  if (!taken(name)) return name;
  const m = name.match(/^(.*?)(\.(?:tar\.(?:gz|xz|zst|bz2)|[^.]+))?$/)!;
  const [stem, ext] = [m[1] || name, m[2] ?? ""];
  for (let i = 2; i < 1000; i++) {
    const n = `${stem} (${i})${ext}`;
    if (!taken(n)) return n;
  }
  return `${stem} (${Date.now()})${ext}`;
}

/**
 * `getfattr --absolute-names -d -m '^user\.xdg\.' <files>`: attributes per
 * file. Text values are quoted, with octal escapes (`\012`); `0x…`/`0s…`
 * values are hex or base64.
 */
export function parseGetfattr(text: string): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  let current: Record<string, string> | undefined;
  for (const line of text.split("\n")) {
    const file = line.match(/^# file: (.*)$/);
    if (file) {
      current = {};
      out.set(unescapeOctal(file[1]), current);
      continue;
    }
    const kv = line.match(/^([\w.]+)=(.*)$/);
    if (!kv || !current) continue;
    current[kv[1]] = decodeValue(kv[2]);
  }
  return out;
}

function unescapeOctal(s: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const m = s.slice(i).match(/^\\([0-7]{3})/);
    if (m) {
      bytes.push(parseInt(m[1], 8));
      i += 3;
    } else if (s[i] === "\\" && s[i + 1] === "\\") {
      bytes.push(0x5c);
      i++;
    } else bytes.push(...new TextEncoder().encode(s[i]));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function decodeValue(v: string): string {
  if (v.startsWith('"') && v.endsWith('"')) return unescapeOctal(v.slice(1, -1).replace(/\\"/g, '"'));
  if (v.startsWith("0x")) {
    const hex = v.slice(2).match(/../g) ?? [];
    return new TextDecoder().decode(new Uint8Array(hex.map((h) => parseInt(h, 16))));
  }
  if (v.startsWith("0s")) {
    try {
      return new TextDecoder().decode(Uint8Array.from(atob(v.slice(2)), (c) => c.charCodeAt(0)));
    } catch {
      return "";
    }
  }
  return v;
}
