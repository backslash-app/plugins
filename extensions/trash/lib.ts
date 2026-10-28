// The freedesktop.org trash: parsing .trashinfo files and sorting items by
// deletion day. Pure, tested in lib_test.ts.

export interface TrashInfo {
  /** Where the item came from, decoded. */
  path: string;
  /** Local time, as written by the file manager. */
  deleted?: Date;
}

/** A `.trashinfo` file: `Path=` is percent-encoded, `DeletionDate=` local time `YYYY-MM-DDThh:mm:ss`. */
export function parseTrashInfo(text: string): TrashInfo | undefined {
  if (!/^\[Trash Info\]/m.test(text)) return undefined;
  const path = text.match(/^Path=(.*)$/m)?.[1]?.trim();
  if (!path) return undefined;
  const date = text.match(/^DeletionDate=(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})/m);
  return {
    path: decodePath(path),
    deleted: date ? new Date(+date[1], +date[2] - 1, +date[3], +date[4], +date[5], +date[6]) : undefined,
  };
}

export function decodePath(p: string): string {
  try {
    return decodeURIComponent(p);
  } catch {
    return p;
  }
}

/** `~/.local/share/Trash/directorysizes`: `<bytes> <mtime> <percent-encoded name>` per line. */
export function parseDirectorySizes(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const line of text.split("\n")) {
    const m = line.match(/^(\d+) \d+ (.+)$/);
    if (m) out.set(decodePath(m[2]), Number(m[1]));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Kinds

export type Kind = "folder" | "image" | "video" | "audio" | "document" | "archive" | "code" | "text" | "file";

const EXT: Record<Exclude<Kind, "folder" | "file">, RegExp> = {
  image: /\.(png|jpe?g|gif|webp|avif|bmp|svg|heic|tiff?)$/i,
  video: /\.(mp4|mkv|webm|mov|avi|m4v)$/i,
  audio: /\.(mp3|flac|ogg|opus|wav|m4a|aac)$/i,
  document: /\.(pdf|docx?|odt|xlsx?|ods|pptx?|odp|rtf|epub)$/i,
  archive: /\.(zip|tar|gz|tgz|xz|zst|bz2|7z|rar|deb|rpm|appimage|iso)$/i,
  code: /\.(ts|js|py|rs|go|c|h|cpp|java|rb|sh|json|toml|ya?ml|html|css)$/i,
  text: /\.(txt|md|log|csv|ini|conf)$/i,
};

export function kindOf(name: string, isDir: boolean): Kind {
  if (isDir) return "folder";
  for (const [k, re] of Object.entries(EXT)) if (re.test(name)) return k as Kind;
  return "file";
}

/** Pictures the launcher can show in the side panel. */
export const previewable = (name: string) => /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name);
export const textual = (k: Kind) => k === "text" || k === "code";

/** Whether bytes look like text: no NUL, mostly printable. */
export function looksLikeText(bytes: Uint8Array): boolean {
  if (!bytes.length) return true;
  let odd = 0;
  for (const b of bytes) {
    if (b === 0) return false;
    if (b < 9 || (b > 13 && b < 32)) odd++;
  }
  return odd / bytes.length < 0.05;
}

// ---------------------------------------------------------------------------
// Days

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today", "Yesterday", "Monday 26 October", "12 March 2025". */
export function daySection(date: Date | undefined, now = new Date()): string {
  if (!date) return "Unknown Date";
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  const opts: Intl.DateTimeFormatOptions = days < 7
    ? { weekday: "long", day: "numeric", month: "long" }
    : date.getFullYear() === now.getFullYear()
    ? { day: "numeric", month: "long" }
    : { day: "numeric", month: "long", year: "numeric" };
  return date.toLocaleDateString("en-GB", opts);
}

/** "14:03", or "3 Oct, 14:03" outside today. */
export function when(date: Date | undefined, now = new Date()): string {
  if (!date) return "";
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return startOfDay(date) === startOfDay(now)
    ? time
    : `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}, ${time}`;
}

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
export const dirname = (p: string) => p.replace(/\/+$/, "").split("/").slice(0, -1).join("/") || "/";
export const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() ?? p;

/** "N items · size" */
export const summary = (count: number, bytes: number) =>
  count ? `${count} item${count === 1 ? "" : "s"} · ${formatBytes(bytes)}` : "Empty";

/** A name for restoring next to an existing file: `report (restored).pdf`. */
export function restoredName(path: string): string {
  const dir = dirname(path);
  const name = basename(path);
  const dot = name.lastIndexOf(".");
  const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
  return `${dir === "/" ? "" : dir}/${stem} (restored)${ext}`;
}
