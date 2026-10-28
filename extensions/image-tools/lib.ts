// Picking files (clipboard URIs), naming outputs, ImageMagick / exiftool /
// cwebp / avifenc command lines and what they report. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Files from the clipboard

/**
 * Paths from what a file manager copies: text/uri-list (file:///…, one per
 * line, # comments), GNOME's x-special/gnome-copied-files ("copy" then URIs),
 * or plain absolute paths.
 */
export function parseFileList(text: string, home = ""): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;
    let path: string | undefined;
    if (line.startsWith("file://")) {
      try {
        const url = new URL(line);
        if (url.host && url.host !== "localhost") continue; // another machine
        path = decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
    } else if (line.startsWith("/")) path = line;
    else if (home && (line === "~" || line.startsWith("~/"))) path = home + line.slice(1);
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

export const IMAGE = /\.(jpe?g|png|webp|avif|gif|bmp|tiff?|heic|heif|jxl)$/i;

const trim = (s: string) => s.replace(/\/+$/, "");
export const basename = (p: string) => trim(p).split("/").pop() ?? p;
export const dirname = (p: string) => trim(p).split("/").slice(0, -1).join("/") || "/";
export const extname = (p: string) => basename(p).match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "";
export const stem = (p: string) => basename(p).replace(/\.[^.]+$/, "");

/** `/a/photo.jpg` + "-1920px" (+ "webp") → `/a/photo-1920px.webp`, never an existing file. */
export function outputPath(
  input: string,
  suffix: string,
  ext: string | undefined,
  exists: (p: string) => boolean,
): string {
  const dir = dirname(input);
  const e = ext ?? extname(input);
  const base = `${dir}/${stem(input)}${suffix}`;
  let candidate = `${base}.${e}`;
  for (let i = 2; exists(candidate) || candidate === input; i++) candidate = `${base}-${i}.${e}`;
  return candidate;
}

// ---------------------------------------------------------------------------
// Operations

export type Format = "png" | "jpg" | "webp" | "avif";
export const FORMATS: Format[] = ["png", "jpg", "webp", "avif"];

export type Operation =
  | { kind: "resize"; geometry: string; label: string }
  | { kind: "convert"; format: Format; quality?: number }
  | { kind: "compress"; quality: number }
  | { kind: "rotate"; degrees: 90 | 180 | 270 }
  | { kind: "flip"; axis: "horizontal" | "vertical" }
  | { kind: "strip" };

/** Validates a custom size: "50%", "1600" (longest side), "1600x900" (fit), "x720" (height). */
export function parseGeometry(text: string): { geometry: string; label: string } {
  const t = text.trim().toLowerCase().replace(/\s+/g, "").replace(/px$/, "");
  let m = t.match(/^(\d{1,3}(?:\.\d+)?)%$/);
  if (m) {
    const pct = Number(m[1]);
    if (pct <= 0 || pct > 400) throw new Error("Use a percentage between 1 and 400");
    return { geometry: `${pct}%`, label: `${pct}pct` };
  }
  m = t.match(/^(\d{1,5})$/);
  if (m) return { geometry: `${m[1]}x${m[1]}>`, label: `${m[1]}px` };
  m = t.match(/^(\d{1,5})?x(\d{1,5})?$/);
  if (m && (m[1] || m[2])) {
    return { geometry: `${m[1] ?? ""}x${m[2] ?? ""}>`, label: `${m[1] ?? ""}x${m[2] ?? ""}`.replace(/^x/, "h") };
  }
  throw new Error("Type a size like 50%, 1600, 1600x900 or x720");
}

export function validQuality(text: string | number): number {
  const q = Number(text);
  if (!Number.isInteger(q) || q < 1 || q > 100) throw new Error("Quality goes from 1 to 100");
  return q;
}

/** The suffix and extension of an operation's output. */
export function outputFor(op: Operation, input: string): { suffix: string; ext: string } {
  const ext = extname(input) === "jpeg" ? "jpg" : extname(input);
  switch (op.kind) {
    case "resize":
      return { suffix: `-${op.label}`, ext };
    case "convert":
      return { suffix: "", ext: op.format };
    case "compress":
      return { suffix: `-q${op.quality}`, ext };
    case "rotate":
      return { suffix: `-rotated`, ext };
    case "flip":
      return { suffix: `-flipped`, ext };
    case "strip":
      return { suffix: "-clean", ext };
  }
}

export function describe(op: Operation): string {
  switch (op.kind) {
    case "resize":
      return op.geometry.endsWith("%") ? `Resized to ${op.geometry}` : `Resized to ${op.label}`;
    case "convert":
      return `Converted to ${op.format.toUpperCase()}`;
    case "compress":
      return `Compressed (quality ${op.quality})`;
    case "rotate":
      return `Rotated ${op.degrees}°`;
    case "flip":
      return `Flipped ${op.axis}ly`;
    case "strip":
      return "Metadata removed";
  }
}

export interface Tools {
  /** `magick` (ImageMagick 7) or `convert` (6). */
  magick?: "magick" | "convert";
  exiftool: boolean;
  cwebp: boolean;
  avifenc: boolean;
  /** ImageMagick can write AVIF (built with libheif). */
  magickAvif: boolean;
}

/** Formats without transparency get a white background instead of black. */
const flatten = (format: string) => (format === "jpg" || format === "jpeg" ? ["-background", "white", "-flatten"] : []);

/** The command that performs `op` on `input`, writing `output`. Throws when no tool can. */
export function command(op: Operation, input: string, output: string, t: Tools): [string, string[]] {
  const outExt = extname(output);
  // [0]: only the first frame of an animation or multi-page file, for formats that hold one.
  const single = /\.(gif|tiff?|webp)$/i.test(input) && !/^(gif|webp|tiff?)$/.test(outExt);
  const im = (args: string[]): [string, string[]] => {
    if (!t.magick) throw new MissingTool("ImageMagick is needed", ["imagemagick"]);
    return [t.magick, [single ? `${input}[0]` : input, ...args, output]];
  };
  switch (op.kind) {
    case "resize":
      return im(["-auto-orient", "-resize", op.geometry]);
    case "convert": {
      const q = op.quality ?? (op.format === "png" ? undefined : op.format === "avif" ? 60 : 85);
      if (op.format === "avif" && !t.magickAvif) {
        if (!t.avifenc) throw new MissingTool("Converting to AVIF needs avifenc or ImageMagick with AVIF", ["avifenc"]);
        return ["avifenc", ["-q", String(q), "--", input, output]];
      }
      if (op.format === "webp" && !t.magick && t.cwebp) return ["cwebp", ["-q", String(q), input, "-o", output]];
      return im(["-auto-orient", ...flatten(op.format), ...(q ? ["-quality", String(q)] : [])]);
    }
    case "compress": {
      if (outExt === "png") return im(["-define", "png:compression-level=9", "-define", "png:compression-filter=5"]);
      if (outExt === "webp" && !t.magick && t.cwebp) return ["cwebp", ["-q", String(op.quality), input, "-o", output]];
      return im(["-quality", String(op.quality)]);
    }
    case "rotate":
      return im(["-auto-orient", "-rotate", String(op.degrees)]);
    case "flip":
      return im(["-auto-orient", op.axis === "horizontal" ? "-flop" : "-flip"]);
    case "strip":
      // exiftool doesn't re-encode the picture; it keeps the color profile and orientation.
      if (t.exiftool) {
        return ["exiftool", [
          "-q",
          "-all=",
          "-tagsFromFile",
          "@",
          "-ColorSpaceTags",
          "-Orientation",
          "-o",
          output,
          input,
        ]];
      }
      return im(["-auto-orient", "-strip"]);
  }
}

export class MissingTool extends Error {
  constructor(message: string, public packages: string[]) {
    super(message);
  }
}

/** Whether `magick -list format` lists AVIF as writable. */
export function canWriteAvif(listFormat: string): boolean {
  return listFormat.split("\n").some((l) => /^\s*AVIF\*?\s+(?:\S+\s+)?[r-]w/i.test(l));
}

// ---------------------------------------------------------------------------
// What the tools tell about a picture

export interface ImageInfo {
  format?: string;
  width?: number;
  height?: number;
  colorspace?: string;
  depth?: number;
  quality?: number;
  alpha?: boolean;
  frames?: number;
  camera?: string;
  lens?: string;
  taken?: string;
  exposure?: string;
  aperture?: string;
  iso?: number;
  focal?: string;
  gps?: { lat: number; lon: number };
  software?: string;
  orientation?: number;
}

/** `identify -format` used by `identifyArgs`, one line per frame. */
export const IDENTIFY_FORMAT =
  "%m\t%w\t%h\t%[colorspace]\t%z\t%Q\t%A\t%[EXIF:Make]\t%[EXIF:Model]\t%[EXIF:DateTimeOriginal]\t%[EXIF:ExposureTime]\t%[EXIF:FNumber]\t%[EXIF:PhotographicSensitivity]\t%[EXIF:FocalLength]\t%[EXIF:GPSLatitude]\t%[EXIF:GPSLatitudeRef]\t%[EXIF:GPSLongitude]\t%[EXIF:GPSLongitudeRef]\t%[EXIF:Software]\t%[EXIF:Orientation]\n";

/** "4/1" → 4, "28/10" → 2.8 */
const rational = (s: string) => {
  const [a, b] = s.split("/").map(Number);
  return b ? a / b : a;
};

/** "48/1, 51/1, 2959/100" + "N" → 48.8582 */
function dms(text: string, ref: string): number | undefined {
  const parts = text.split(",").map((p) => rational(p.trim()));
  if (parts.length < 3 || parts.some((p) => Number.isNaN(p))) return undefined;
  const v = parts[0] + parts[1] / 60 + parts[2] / 3600;
  return /[SW]/i.test(ref) ? -v : v;
}

const exposureText = (sec: number) => (sec >= 1 ? `${sec} s` : `1/${Math.round(1 / sec)} s`);

/** Parses the first line of `identify -format IDENTIFY_FORMAT`. */
export function parseIdentify(out: string): ImageInfo {
  const lines = out.split("\n").filter((l) => l.trim());
  const f = (lines[0] ?? "").split("\t");
  const val = (i: number) => (f[i] ?? "").trim() || undefined;
  const info: ImageInfo = {
    format: val(0),
    width: Number(val(1)) || undefined,
    height: Number(val(2)) || undefined,
    colorspace: val(3),
    depth: Number(val(4)) || undefined,
    quality: Number(val(5)) || undefined,
    alpha: val(6) ? !/^(false|undefined|off)$/i.test(val(6)!) : undefined,
    frames: lines.length > 1 ? lines.length : undefined,
  };
  const make = val(7);
  const model = val(8);
  if (model) {
    info.camera = make && !model.toLowerCase().startsWith(make.toLowerCase().split(" ")[0])
      ? `${make} ${model}`
      : model;
  }
  if (val(9)) info.taken = val(9);
  if (val(10)) info.exposure = exposureText(rational(val(10)!));
  if (val(11)) info.aperture = `ƒ/${+rational(val(11)!).toFixed(1)}`;
  if (val(12)) info.iso = Number(val(12));
  if (val(13)) info.focal = `${+rational(val(13)!).toFixed(1)} mm`;
  if (val(14) && val(16)) {
    const lat = dms(val(14)!, val(15) ?? "N");
    const lon = dms(val(16)!, val(17) ?? "E");
    if (lat !== undefined && lon !== undefined) info.gps = { lat, lon };
  }
  if (val(18)) info.software = val(18);
  if (val(19)) info.orientation = Number(val(19));
  return info;
}

/** `exiftool -json -n …` → info per file path. */
export function parseExiftool(json: string): Map<string, ImageInfo> {
  const out = new Map<string, ImageInfo>();
  let rows: any[];
  try {
    rows = JSON.parse(json);
  } catch {
    return out;
  }
  for (const r of rows) {
    const info: ImageInfo = {
      format: r.FileType,
      width: r.ImageWidth,
      height: r.ImageHeight,
    };
    const make = r.Make ? String(r.Make).trim() : undefined;
    const model = r.Model ? String(r.Model).trim() : undefined;
    if (model) {
      info.camera = make && !model.toLowerCase().startsWith(make.toLowerCase().split(" ")[0])
        ? `${make} ${model}`
        : model;
    }
    if (r.LensModel) info.lens = String(r.LensModel);
    if (r.DateTimeOriginal) info.taken = String(r.DateTimeOriginal);
    if (typeof r.ExposureTime === "number") info.exposure = exposureText(r.ExposureTime);
    if (typeof r.FNumber === "number") info.aperture = `ƒ/${+r.FNumber.toFixed(1)}`;
    if (r.ISO) info.iso = Number(r.ISO);
    if (typeof r.FocalLength === "number") info.focal = `${+r.FocalLength.toFixed(1)} mm`;
    if (typeof r.GPSLatitude === "number" && typeof r.GPSLongitude === "number") {
      info.gps = { lat: r.GPSLatitude, lon: r.GPSLongitude };
    }
    if (r.Software) info.software = String(r.Software);
    if (r.Orientation) info.orientation = Number(r.Orientation);
    if (r.ColorSpace !== undefined) info.colorspace = r.ColorSpace === 1 ? "sRGB" : String(r.ColorSpace);
    if (r.BitsPerSample) info.depth = Number(String(r.BitsPerSample).split(" ")[0]);
    out.set(String(r.SourceFile), info);
  }
  return out;
}

export const EXIFTOOL_TAGS = [
  "-FileType",
  "-ImageWidth",
  "-ImageHeight",
  "-Make",
  "-Model",
  "-LensModel",
  "-DateTimeOriginal",
  "-ExposureTime",
  "-FNumber",
  "-ISO",
  "-FocalLength",
  "-GPSLatitude",
  "-GPSLongitude",
  "-Software",
  "-Orientation",
  "-ColorSpace",
  "-BitsPerSample",
];

/** "2026:07:14 18:32:05" → a Date. */
export function exifDate(text: string | undefined): Date | undefined {
  const m = text?.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return undefined;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

export const mapLink = (gps: { lat: number; lon: number }) =>
  `https://www.openstreetmap.org/?mlat=${gps.lat.toFixed(5)}&mlon=${gps.lon.toFixed(5)}#map=15/${gps.lat.toFixed(5)}/${
    gps.lon.toFixed(5)
  }`;

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
      return { width: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), height: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
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
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { width: v.getUint16(i + 7), height: v.getUint16(i + 5) };
      }
      i += 2 + len;
    }
  }
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

/** "−42 %" / "+8 %" between two sizes. */
export function sizeChange(before: number, after: number): string {
  if (!before) return "";
  const pct = Math.round(((after - before) / before) * 100);
  return pct === 0 ? "same size" : `${pct < 0 ? "−" : "+"}${Math.abs(pct)} %`;
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
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
  imagemagick: { fedora: "ImageMagick", suse: "ImageMagick" },
  exiftool: {
    debian: "libimage-exiftool-perl",
    arch: "perl-image-exiftool",
    fedora: "perl-Image-ExifTool",
    suse: "exiftool",
  },
  cwebp: { debian: "webp", arch: "libwebp", fedora: "libwebp-tools", suse: "libwebp-tools" },
  avifenc: { debian: "libavif-bin", arch: "libavif", fedora: "libavif-tools", suse: "avif-tools" },
  "wl-paste": { debian: "wl-clipboard", arch: "wl-clipboard", fedora: "wl-clipboard", suse: "wl-clipboard" },
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
