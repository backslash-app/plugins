// Page ranges, pdfinfo output, and the command lines of qpdf, Ghostscript,
// pdftk, poppler (pdfunite, pdfseparate, pdftoppm), img2pdf and ImageMagick
// for each operation. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Files

/** Paths from text/uri-list, x-special/gnome-copied-files or plain paths. */
export function parseFileList(text: string, home = ""): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;
    let path: string | undefined;
    if (line.startsWith("file://")) {
      try {
        const url = new URL(line);
        if (url.host && url.host !== "localhost") continue;
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

export const PDF = /\.pdf$/i;
export const IMAGE = /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|avif)$/i;

const trim = (s: string) => s.replace(/\/+$/, "");
export const basename = (p: string) => trim(p).split("/").pop() ?? p;
export const dirname = (p: string) => trim(p).split("/").slice(0, -1).join("/") || "/";
export const stem = (p: string) => basename(p).replace(/\.[^.]+$/, "");

/** A free path: `/a/report-compressed.pdf`, `/a/report-compressed-2.pdf`… */
export function freePath(dir: string, name: string, ext: string, exists: (p: string) => boolean): string {
  const suffix = ext ? `.${ext}` : "";
  let candidate = `${dir}/${name}${suffix}`;
  for (let i = 2; exists(candidate); i++) candidate = `${dir}/${name}-${i}${suffix}`;
  return candidate;
}

// ---------------------------------------------------------------------------
// Page ranges

/** "1-3, 5, 8-" → [[1,3],[5,5],[8,total]]; validated against the page count. */
export function parseRanges(text: string, total: number): [number, number][] {
  const t = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!t) throw new Error("Type the pages, like 1-3, 5 or 8-");
  const out: [number, number][] = [];
  for (const part of t.split(",").filter(Boolean)) {
    const m = part.match(/^(\d+|last|z)?(?:(-)(\d+|last|z)?)?$/);
    if (!m || (!m[1] && !m[3])) throw new Error(`“${part}” isn't a page or a range`);
    const num = (s: string | undefined, fallback: number) =>
      s === undefined ? fallback : s === "last" || s === "z" ? total : Number(s);
    const from = num(m[1], 1);
    const to = m[2] ? num(m[3], total) : from;
    if (from < 1 || to < 1) throw new Error("Pages start at 1");
    if (total && (from > total || to > total)) {
      throw new Error(`The document has ${total} page${total === 1 ? "" : "s"}`);
    }
    if (from > to) throw new Error(`${from}-${to} goes backwards`);
    out.push([from, to]);
  }
  return out;
}

export const rangeText = (r: [number, number][]) => r.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)).join(",");
export const pageCount = (r: [number, number][]) => r.reduce((s, [a, b]) => s + b - a + 1, 0);
export const pagesOf = (r: [number, number][]) =>
  r.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i));

// ---------------------------------------------------------------------------
// pdfinfo

export interface PdfInfo {
  pages?: number;
  title?: string;
  author?: string;
  subject?: string;
  creator?: string;
  producer?: string;
  created?: string;
  modified?: string;
  pageSize?: string;
  version?: string;
  encrypted?: boolean;
  /** Needs a password to be opened at all. */
  locked?: boolean;
  tagged?: boolean;
  form?: string;
}

/** `pdfinfo file.pdf` output. */
export function parsePdfinfo(out: string): PdfInfo {
  const f: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^([A-Za-z ]+?):\s*(.*)$/);
    if (m) f[m[1].trim()] = m[2].trim();
  }
  const s = (k: string) => (f[k] && f[k] !== "none" ? f[k] : undefined);
  return {
    pages: f.Pages ? Number(f.Pages) : undefined,
    title: s("Title"),
    author: s("Author"),
    subject: s("Subject"),
    creator: s("Creator"),
    producer: s("Producer"),
    created: s("CreationDate"),
    modified: s("ModDate"),
    pageSize: f["Page size"] ? pageSizeName(f["Page size"]) : undefined,
    version: s("PDF version"),
    encrypted: f.Encrypted ? f.Encrypted.startsWith("yes") : undefined,
    tagged: f.Tagged ? f.Tagged === "yes" : undefined,
    form: s("Form"),
  };
}

/** "595.276 x 841.89 pts (A4)" → "A4 (210 × 297 mm)" ; "612 x 792 pts (letter)" → "Letter (8.5 × 11 in)". */
export function pageSizeName(text: string): string {
  const m = text.match(/([\d.]+)\s*x\s*([\d.]+)\s*pts(?:\s*\(([^)]+)\))?/);
  if (!m) return text;
  const [w, h] = [Number(m[1]), Number(m[2])];
  const mm = (pt: number) => Math.round((pt / 72) * 25.4);
  const name = m[3] ? m[3][0].toUpperCase() + m[3].slice(1) : undefined;
  if (name && /letter|legal/i.test(name)) return `${name} (${+(w / 72).toFixed(1)} × ${+(h / 72).toFixed(1)} in)`;
  return `${name ? `${name} ` : ""}(${mm(w)} × ${mm(h)} mm)`.trim();
}

/** "Mon Oct  6 14:03:00 2026 CEST" or ISO → a Date when it can be read. */
export function pdfDate(text: string | undefined): Date | undefined {
  if (!text) return undefined;
  const d = new Date(text.replace(/\s+[A-Z]{3,4}$/, ""));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ---------------------------------------------------------------------------
// Tools and operations

export interface Tools {
  qpdf: boolean;
  gs: boolean;
  pdftk: boolean;
  pdfinfo: boolean;
  pdftoppm: boolean;
  pdfunite: boolean;
  pdfseparate: boolean;
  img2pdf: boolean;
  magick?: "magick" | "convert";
}

export const NO_TOOLS: Tools = {
  qpdf: false,
  gs: false,
  pdftk: false,
  pdfinfo: false,
  pdftoppm: false,
  pdfunite: false,
  pdfseparate: false,
  img2pdf: false,
};

export type Preset = "screen" | "ebook" | "printer" | "prepress" | "lossless";

export const PRESETS: { preset: Preset; title: string; about: string }[] = [
  { preset: "ebook", title: "Balanced (ebook, 150 dpi)", about: "Good quality, much smaller" },
  { preset: "screen", title: "Smallest (screen, 72 dpi)", about: "For reading on screen and sending" },
  { preset: "printer", title: "Print Quality (printer, 300 dpi)", about: "Smaller, still fine to print" },
  { preset: "prepress", title: "Prepress (300 dpi, colors kept)", about: "For professional printing" },
  { preset: "lossless", title: "Lossless Optimization", about: "Same pictures, tidier file (qpdf)" },
];

export type Rotation = 90 | 180 | 270;

export type Op =
  | { kind: "merge"; inputs: string[]; output: string }
  | { kind: "extract"; input: string; ranges: [number, number][]; output: string; tmp: string }
  | { kind: "split"; input: string; dir: string; name: string }
  | { kind: "compress"; input: string; preset: Preset; output: string }
  | { kind: "rotate"; input: string; degrees: Rotation; output: string }
  | { kind: "decrypt"; input: string; password: string; output: string }
  | { kind: "toImages"; input: string; format: "png" | "jpg"; dpi: number; dir: string; name: string }
  | { kind: "fromImages"; inputs: string[]; output: string };

/** One program run; `stdin` is written to it (passwords stay out of the process list). */
export interface Step {
  program: string;
  args: string[];
  stdin?: string;
}

export class MissingTool extends Error {
  constructor(message: string, public packages: string[]) {
    super(message);
  }
}

const gsBase = ["-q", "-dNOPAUSE", "-dBATCH", "-dSAFER"];
const PDFTK_ROT: Record<Rotation, string> = { 90: "east", 180: "south", 270: "west" };

/** The programs that perform an operation, with the best installed tool. */
export function plan(op: Op, t: Tools): Step[] {
  switch (op.kind) {
    case "merge":
      if (t.qpdf) return [{ program: "qpdf", args: ["--empty", "--pages", ...op.inputs, "--", op.output] }];
      if (t.pdfunite) return [{ program: "pdfunite", args: [...op.inputs, op.output] }];
      if (t.pdftk) return [{ program: "pdftk", args: [...op.inputs, "cat", "output", op.output] }];
      if (t.gs) {
        return [{ program: "gs", args: [...gsBase, "-sDEVICE=pdfwrite", `-sOutputFile=${op.output}`, ...op.inputs] }];
      }
      throw new MissingTool("Merging needs qpdf, poppler, pdftk or Ghostscript", ["qpdf"]);
    case "extract": {
      const r = rangeText(op.ranges);
      if (t.qpdf) return [{ program: "qpdf", args: [op.input, "--pages", ".", r, "--", op.output] }];
      if (t.pdftk) {
        return [{
          program: "pdftk",
          args: [op.input, "cat", ...op.ranges.map(([a, b]) => (a === b ? `${a}` : `${a}-${b}`)), "output", op.output],
        }];
      }
      if (t.pdfseparate && t.pdfunite) {
        // One file per page in a temporary folder, then joined in order.
        const pages = pagesOf(op.ranges);
        return [
          ...op.ranges.map(([a, b]) => ({
            program: "pdfseparate",
            args: ["-f", String(a), "-l", String(b), op.input, `${op.tmp}/page-%d.pdf`],
          })),
          { program: "pdfunite", args: [...pages.map((p) => `${op.tmp}/page-${p}.pdf`), op.output] },
        ];
      }
      if (t.gs) {
        return [{
          program: "gs",
          args: [...gsBase, "-sDEVICE=pdfwrite", `-sPageList=${r}`, `-sOutputFile=${op.output}`, op.input],
        }];
      }
      throw new MissingTool("Extracting pages needs qpdf, pdftk, poppler or Ghostscript", ["qpdf"]);
    }
    case "split": {
      const pattern = `${op.dir}/${op.name}-%d.pdf`;
      if (t.qpdf) return [{ program: "qpdf", args: ["--split-pages", op.input, pattern] }];
      if (t.pdfseparate) return [{ program: "pdfseparate", args: [op.input, pattern] }];
      if (t.pdftk) return [{ program: "pdftk", args: [op.input, "burst", "output", `${op.dir}/${op.name}-%d.pdf`] }];
      throw new MissingTool("Splitting needs qpdf, poppler or pdftk", ["qpdf"]);
    }
    case "compress":
      if (op.preset === "lossless") {
        if (!t.qpdf) throw new MissingTool("Lossless optimization needs qpdf", ["qpdf"]);
        return [{
          program: "qpdf",
          args: [
            "--compress-streams=y",
            "--recompress-flate",
            "--compression-level=9",
            "--object-streams=generate",
            op.input,
            op.output,
          ],
        }];
      }
      if (!t.gs) throw new MissingTool("Compressing needs Ghostscript", ["ghostscript"]);
      return [{
        program: "gs",
        args: [
          ...gsBase,
          "-sDEVICE=pdfwrite",
          "-dCompatibilityLevel=1.6",
          `-dPDFSETTINGS=/${op.preset}`,
          "-dDetectDuplicateImages=true",
          `-sOutputFile=${op.output}`,
          op.input,
        ],
      }];
    case "rotate":
      if (t.qpdf) return [{ program: "qpdf", args: [op.input, op.output, `--rotate=+${op.degrees}`] }];
      if (t.pdftk) {
        return [{ program: "pdftk", args: [op.input, "cat", `1-end${PDFTK_ROT[op.degrees]}`, "output", op.output] }];
      }
      throw new MissingTool("Rotating needs qpdf or pdftk", ["qpdf"]);
    case "decrypt":
      if (t.qpdf) {
        return [{ program: "qpdf", args: ["--password-file=-", "--decrypt", op.input, op.output], stdin: op.password }];
      }
      if (t.pdftk) return [{ program: "pdftk", args: [op.input, "input_pw", op.password, "output", op.output] }];
      if (t.gs) {
        return [{
          program: "gs",
          args: [...gsBase, "-sDEVICE=pdfwrite", `-sPDFPassword=${op.password}`, `-sOutputFile=${op.output}`, op.input],
        }];
      }
      throw new MissingTool("Removing a password needs qpdf, pdftk or Ghostscript", ["qpdf"]);
    case "toImages": {
      const prefix = `${op.dir}/${op.name}`;
      if (t.pdftoppm) {
        return [{
          program: "pdftoppm",
          args: [op.format === "png" ? "-png" : "-jpeg", "-r", String(op.dpi), op.input, prefix],
        }];
      }
      if (t.gs) {
        return [{
          program: "gs",
          args: [
            ...gsBase,
            op.format === "png" ? "-sDEVICE=png16m" : "-sDEVICE=jpeg",
            `-r${op.dpi}`,
            ...(op.format === "jpg" ? ["-dJPEGQ=90"] : []),
            `-sOutputFile=${prefix}-%03d.${op.format}`,
            op.input,
          ],
        }];
      }
      throw new MissingTool("Converting pages to pictures needs poppler (pdftoppm) or Ghostscript", ["pdftoppm"]);
    }
    case "fromImages":
      if (t.img2pdf) return [{ program: "img2pdf", args: [...op.inputs, "-o", op.output] }];
      if (t.magick) return [{ program: t.magick, args: [...op.inputs, "-auto-orient", op.output] }];
      throw new MissingTool("Making a PDF from pictures needs img2pdf or ImageMagick", ["img2pdf"]);
  }
}

/** Which tool `plan` picks, for the detail panel. */
export const toolOf = (op: Op, t: Tools): string | undefined => {
  try {
    return plan(op, t)[0]?.program;
  } catch {
    return undefined;
  }
};

/** "Incorrect password" in the tools' messages. */
export const wrongPassword = (message: string) =>
  /incorrect password|invalid password|password.*(incorrect|required)/i.test(message);

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

/** Moves an item of a list up (-1) or down (+1). */
export function move<T>(list: T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || to < 0 || to >= list.length) return list;
  const out = [...list];
  [out[index], out[to]] = [out[to], out[index]];
  return out;
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
  pdftoppm: { debian: "poppler-utils", arch: "poppler", fedora: "poppler-utils", suse: "poppler-tools" },
  pdfinfo: { debian: "poppler-utils", arch: "poppler", fedora: "poppler-utils", suse: "poppler-tools" },
  img2pdf: { debian: "img2pdf", arch: "img2pdf", fedora: "python3-img2pdf", suse: "python3-img2pdf" },
  pdftk: { debian: "pdftk-java", arch: "pdftk", fedora: "pdftk-java", suse: "pdftk" },
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
