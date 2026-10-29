// SANE's scanimage output and options, scan presets, file names and the command lines that
// scan, assemble PDFs and recognize text. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Scanners (scanimage -L)

export interface Scanner {
  /** SANE device name: "airscan:e0:Canon TS5300 series", "pixma:04A91912_123456". */
  id: string;
  /** "Canon TS5300 series", the description without the backend's words. */
  name: string;
  description: string;
  backend: string;
  network: boolean;
}

const NETWORK_BACKENDS = ["airscan", "escl", "net"];

/** "device `airscan:e0:Canon TS5300 series' is a eSCL Canon TS5300 series ip=192.168.1.20". */
export function parseScanners(text: string): Scanner[] {
  const out: Scanner[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^device [`'"](.+?)['"`] is an? (.+?)\s*$/);
    if (!m) continue;
    const id = m[1];
    const backend = id.split(":")[0];
    const description = m[2];
    // Drop the protocol word and the address: "eSCL Canon TS5300 series ip=…" → "Canon TS5300 series".
    const name = description.replace(/\s+ip=\S+$/, "").replace(/^(eSCL|WSD)\s+/, "")
      .replace(/\s+(flatbed scanner|multi-function peripheral|all-in-one|virtual device|sheetfed scanner)$/i, "")
      .trim();
    out.push({
      id,
      name: name || id,
      description,
      backend,
      network: NETWORK_BACKENDS.includes(backend) || /ip=|\d+\.\d+\.\d+\.\d+|[/=]net/i.test(id + description),
    });
  }
  // airscan and escl often both list the same network scanner: keep airscan's.
  const seen = new Set<string>();
  const airscanFirst = [...out].sort((a, b) => Number(b.backend === "airscan") - Number(a.backend === "airscan"));
  return airscanFirst.filter((s) => {
    const key = s.name.toLowerCase();
    if (s.network && seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Options (scanimage -d … -A)

export interface Options {
  modes: string[];
  resolutions: number[];
  /** A continuous range ("50..1200dpi"), when the backend gives one. */
  range?: { min: number; max: number };
  sources: string[];
  defaults: { mode?: string; resolution?: number; source?: string };
}

/** The lines "    --mode Lineart|Gray|Color [Color]" of `scanimage -A`. */
export function parseOptions(text: string): Options {
  const options: Options = { modes: [], resolutions: [], sources: [], defaults: {} };
  for (const line of text.split("\n")) {
    const m = line.match(/^\s+--(mode|resolution|source)\s+(.+?)\s+\[([^\]]*)\]\s*$/);
    if (!m) continue;
    const [, name, values, current] = m;
    const inactive = current === "inactive";
    if (name === "resolution") {
      const range = values.match(/^(\d+)\.\.(\d+)/);
      if (range) options.range = { min: Number(range[1]), max: Number(range[2]) };
      else options.resolutions = values.replace(/dpi.*$/, "").split("|").map(Number).filter((n) => n > 0);
      if (!inactive && Number(current)) options.defaults.resolution = Number(current);
    } else {
      const list = values.split("|").map((v) => v.trim()).filter(Boolean);
      if (name === "mode") options.modes = list;
      else options.sources = list;
      if (!inactive) options.defaults[name as "mode" | "source"] = current;
    }
  }
  if (!options.resolutions.length && options.range) {
    options.resolutions = [75, 100, 150, 200, 300, 600, 1200, 2400]
      .filter((r) => r >= options.range!.min && r <= options.range!.max);
  }
  return options;
}

export type ColorMode = "color" | "gray" | "lineart";
export type Source = "flatbed" | "adf" | "duplex";
export type Format = "pdf" | "png" | "jpeg";

const MODE_PATTERNS: Record<ColorMode, RegExp> = {
  color: /colou?r|rgb/i,
  gray: /gr[ae]y/i,
  lineart: /lineart|binary|black|halftone|monochrome/i,
};

/** The scanner's word for a color mode: "Color", "24bit Color[Fast]", "Gray"… */
export function pickMode(o: Options, want: ColorMode): string | undefined {
  return o.modes.find((m) => MODE_PATTERNS[want].test(m)) ?? o.defaults.mode ?? o.modes[0];
}

export function pickSource(o: Options, want: Source): string | undefined {
  if (!o.sources.length) return undefined;
  const feeder = (s: string) => /adf|feeder|document|automatic|sheet/i.test(s);
  const duplex = (s: string) => /duplex|both/i.test(s);
  if (want === "duplex") return o.sources.find((s) => feeder(s) && duplex(s)) ?? o.sources.find(duplex);
  if (want === "adf") return o.sources.find((s) => feeder(s) && !duplex(s)) ?? o.sources.find(feeder);
  return o.sources.find((s) => /flatbed|platen|normal/i.test(s)) ?? o.sources.find((s) => !feeder(s));
}

/** The closest resolution the scanner offers. */
export function pickResolution(o: Options, want: number): number {
  if (o.range && !o.resolutions.includes(want) && want >= o.range.min && want <= o.range.max) return want;
  if (!o.resolutions.length) return want;
  return o.resolutions.reduce((best, r) => (Math.abs(r - want) < Math.abs(best - want) ? r : best));
}

export const hasFeeder = (o: Options) => o.sources.some((s) => /adf|feeder|document|automatic/i.test(s));

// ---------------------------------------------------------------------------
// Presets and jobs

export interface Preset {
  id: string;
  title: string;
  description: string;
  mode: ColorMode;
  resolution: number;
  format: Format;
}

export const PRESETS: Preset[] = [
  {
    id: "document",
    title: "Document",
    description: "300 dpi, grayscale, PDF",
    mode: "gray",
    resolution: 300,
    format: "pdf",
  },
  {
    id: "color-document",
    title: "Color Document",
    description: "300 dpi, color, PDF",
    mode: "color",
    resolution: 300,
    format: "pdf",
  },
  { id: "photo", title: "Photo", description: "600 dpi, color, PNG", mode: "color", resolution: 600, format: "png" },
  {
    id: "quick",
    title: "Quick Scan",
    description: "150 dpi, color, JPEG",
    mode: "color",
    resolution: 150,
    format: "jpeg",
  },
  {
    id: "text",
    title: "Black & White Text",
    description: "300 dpi, black and white, PDF",
    mode: "lineart",
    resolution: 300,
    format: "pdf",
  },
];

export const preset = (id?: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

export interface Job {
  device: string;
  mode?: string;
  resolution: number;
  source?: string;
  feeder: boolean;
}

function common(j: Job): string[] {
  return [
    "-d",
    j.device,
    ...(j.mode ? ["--mode", j.mode] : []),
    "--resolution",
    String(j.resolution),
    ...(j.source ? ["--source", j.source] : []),
  ];
}

/** One page to a file. PNG for anything turned into a PDF later, as JPEG would lose detail twice. */
export function scanArgs(j: Job, out: string, format: "png" | "jpeg"): string[] {
  return [...common(j), `--format=${format}`, "-o", out];
}

/** Every page of the feeder: page-001.png, page-002.png… until it's empty. */
export function batchArgs(j: Job, dir: string): string[] {
  return [...common(j), "--format=png", `--batch=${dir}/page-%03d.png`];
}

/** "Scan 2026-10-29 14.05.12": sortable, and without characters file managers dislike. */
export function fileName(now: Date, name?: string, ext = "pdf"): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}.${pad(now.getMinutes())}.${pad(now.getSeconds())}`;
  const clean = (name ?? "").replace(/[/\\:*?"<>|\0]+/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  return `${clean || `Scan ${stamp}`}.${ext}`;
}

/** A free name in the folder: "Invoice.pdf", then "Invoice (2).pdf". */
export function freeName(wanted: string, taken: Set<string>): string {
  if (!taken.has(wanted)) return wanted;
  const dot = wanted.lastIndexOf(".");
  const base = dot > 0 ? wanted.slice(0, dot) : wanted, ext = dot > 0 ? wanted.slice(dot) : "";
  for (let i = 2;; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Pages written by --batch, in order. */
export function batchPages(names: string[]): string[] {
  return names.filter((n) => /^page-\d+\.png$/.test(n)).sort();
}

export type PdfTool = "img2pdf" | "magick" | "convert";

/** Images into one PDF: img2pdf keeps them as they are; ImageMagick re-encodes them. */
export function pdfArgs(tool: PdfTool, pages: string[], out: string): string[] {
  return tool === "img2pdf" ? [...pages, "-o", out] : [...pages, out];
}

/** ocrmypdf adds a text layer to the PDF; --skip-text leaves pages that have one already. */
export const ocrmypdfArgs = (input: string, out: string, languages: string) => [
  "-l",
  languages,
  "--skip-text",
  "--deskew",
  input,
  out,
];

/** tesseract reads a list of images and writes a searchable PDF (out.pdf) of them all. */
export const tesseractPdfArgs = (listFile: string, outBase: string, languages: string) => [
  listFile,
  outBase,
  "-l",
  languages,
  "pdf",
];

/** tesseract's plain text next to an image: out.txt. */
export const tesseractTextArgs = (image: string, outBase: string, languages: string) => [
  image,
  outBase,
  "-l",
  languages,
];

/** "eng+fra", "eng, fra" → "eng+fra"; anything odd falls back to English. */
export function languages(pref?: string): string {
  const codes = (pref ?? "").split(/[\s,+]+/).filter((c) => /^[a-z_]{3,}$/i.test(c));
  return codes.length ? codes.join("+") : "eng";
}

// ---------------------------------------------------------------------------
// Results

export interface ScanFile {
  path: string;
  name: string;
  ext: string;
  size: number;
  modified: number;
  /** A sidecar .txt with the recognized text. */
  text?: string;
}

const SCAN_EXTENSIONS = ["pdf", "png", "jpg", "jpeg", "tif", "tiff"];

export const isScan = (name: string) => SCAN_EXTENSIONS.includes(name.split(".").pop()!.toLowerCase());

/** Newest first; .txt files are attached to the image of the same name. */
export function recentScans(entries: { name: string; size: number; modified: number }[], dir: string): ScanFile[] {
  const names = new Set(entries.map((e) => e.name));
  return entries.filter((e) => isScan(e.name)).map((e) => {
    const base = e.name.replace(/\.[^.]+$/, "");
    return {
      path: `${dir}/${e.name}`,
      name: e.name,
      ext: e.name.split(".").pop()!.toLowerCase(),
      size: e.size,
      modified: e.modified,
      text: names.has(`${base}.txt`) ? `${dir}/${base}.txt` : undefined,
    };
  }).sort((a, b) => b.modified - a.modified);
}

export function size(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["kB", "MB", "GB"];
  let n = bytes / 1000, i = 0;
  while (n >= 1000 && i < units.length - 1) {
    n /= 1000;
    i++;
  }
  return `${n >= 100 ? Math.round(n) : n.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

/** "today 14:05", "yesterday", "3 days ago", or the date. */
export function when(at: number, now = Date.now()): string {
  const d = new Date(at), n = new Date(now);
  const day = (x: Date) => Math.floor((x.getTime() - x.getTimezoneOffset() * 60_000) / 86_400_000);
  const diff = day(n) - day(d);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (diff <= 0) return `Today ${time}`;
  if (diff === 1) return `Yesterday ${time}`;
  if (diff < 7) return `${diff} days ago`;
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Errors and install hints

/** scanimage's errors, as a sentence. */
export function explainSane(text: string): string {
  if (/Document feeder out of documents|feeder.*empty|no more documents/i.test(text)) {
    return "The document feeder is empty: put the pages in it";
  }
  if (/Device busy/i.test(text)) return "The scanner is busy: wait for it, or close the other scanning app";
  if (/Document feeder jammed|jammed/i.test(text)) return "Paper jam in the document feeder";
  if (/cover.*open|Scanner cover is open/i.test(text)) return "The scanner's cover is open";
  if (/setting of option --?(\w+) failed/i.test(text)) {
    return `The scanner refused the ${text.match(/setting of option --?(\w+)/i)![1]} setting`;
  }
  if (/open of device .* failed|Invalid argument/i.test(text)) {
    return "The scanner didn't open: it may be off, asleep or on another network";
  }
  if (/Error during device I\/O/i.test(text)) return "The scanner stopped answering (I/O error): try again";
  if (/Access to resource has been denied|Permission denied/i.test(text)) {
    return "No permission to use this scanner: add yourself to the scanner group (sudo usermod -aG scanner $USER)";
  }
  return text.split("\n").map((l) => l.replace(/^scanimage:\s*/, "").trim()).filter(Boolean).pop() ?? "Scanning failed";
}

export type Family = "debian" | "fedora" | "arch" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const get = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${get("ID")} ${get("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

const PACKAGES: Record<Family, { install: string; sane: string; pdf: string; ocr: string }> = {
  debian: {
    install: "sudo apt install",
    sane: "sane-utils sane-airscan",
    pdf: "img2pdf",
    ocr: "ocrmypdf tesseract-ocr",
  },
  fedora: {
    install: "sudo dnf install",
    sane: "sane-backends sane-airscan",
    pdf: "img2pdf",
    ocr: "ocrmypdf tesseract",
  },
  arch: {
    install: "sudo pacman -S",
    sane: "sane sane-airscan",
    pdf: "img2pdf",
    ocr: "ocrmypdf tesseract tesseract-data-eng",
  },
  suse: {
    install: "sudo zypper install",
    sane: "sane-backends sane-airscan",
    pdf: "img2pdf",
    ocr: "ocrmypdf tesseract-ocr",
  },
};

export function installCommand(what: "sane" | "pdf" | "ocr", family?: Family): string {
  const p = PACKAGES[family ?? "debian"];
  return `${p.install} ${p[what]}`;
}
