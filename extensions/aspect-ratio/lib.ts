// Aspect ratios, resolutions, crops, scaling and screen density, computed locally.

// ---------------------------------------------------------------------------
// Reference data

export interface KnownRatio {
  /** As people write it: "16:9", "2.39:1". */
  text: string;
  value: number;
  name: string;
  uses: string;
}

export const RATIOS: KnownRatio[] = [
  { text: "1:1", value: 1, name: "Square", uses: "Instagram posts, profile pictures, album covers" },
  { text: "5:4", value: 5 / 4, name: "5:4", uses: "Old LCD monitors (1280 × 1024), 8 × 10 prints" },
  { text: "4:3", value: 4 / 3, name: "Standard", uses: "SD TV, iPad, most phone and compact camera photos" },
  { text: "3:2", value: 3 / 2, name: "Classic 35 mm", uses: "DSLR and mirrorless photos, 6 × 4 prints, Surface" },
  { text: "16:10", value: 16 / 10, name: "Widescreen computer", uses: "MacBook and many laptop screens" },
  { text: "16:9", value: 16 / 9, name: "Widescreen", uses: "HD and 4K video, TVs, YouTube, most monitors" },
  { text: "1.85:1", value: 1.85, name: "Flat (cinema)", uses: "American and British theatrical films" },
  { text: "2:1", value: 2, name: "Univisium", uses: "Streaming series, 18:9 phones" },
  { text: "19.5:9", value: 19.5 / 9, name: "Tall phone", uses: "iPhone X and later, many Android phones" },
  { text: "21:9", value: 64 / 27, name: "Ultrawide", uses: "Ultrawide monitors (2560 × 1080, 3440 × 1440)" },
  { text: "2.39:1", value: 2.39, name: "Anamorphic scope", uses: "Widescreen cinema (CinemaScope)" },
  { text: "32:9", value: 32 / 9, name: "Super ultrawide", uses: "Dual-QHD monitors (5120 × 1440)" },
  { text: "3:1", value: 3, name: "Banner", uses: "X (Twitter) header (1500 × 500)" },
  { text: "4:1", value: 4, name: "Wide banner", uses: "LinkedIn banner (1584 × 396)" },
  { text: "1.91:1", value: 1.91, name: "Link preview", uses: "Open Graph images (1200 × 628), Facebook link posts" },
  { text: "4:5", value: 4 / 5, name: "Portrait", uses: "Instagram portrait posts (1080 × 1350)" },
  { text: "2:3", value: 2 / 3, name: "Portrait photo", uses: "Pinterest pins, portrait 35 mm photos" },
  { text: "3:4", value: 3 / 4, name: "Portrait standard", uses: "Portrait phone photos" },
  { text: "9:16", value: 9 / 16, name: "Vertical video", uses: "Stories, Reels, TikTok, YouTube Shorts" },
];

export type Category = "Screen" | "Video" | "Cinema" | "Photo" | "Social";

export interface Resolution {
  width: number;
  height: number;
  name: string;
  category: Category;
  aliases?: string[];
  /** The ratio it's sold as, when that's not the nearest one: 3440 × 1440 is 2.39:1 but called 21:9. */
  ratio?: string;
}

export const RESOLUTIONS: Resolution[] = [
  { width: 640, height: 480, name: "VGA", category: "Screen" },
  { width: 800, height: 600, name: "SVGA", category: "Screen" },
  { width: 1024, height: 768, name: "XGA", category: "Screen" },
  { width: 1280, height: 800, name: "WXGA", category: "Screen" },
  { width: 1280, height: 1024, name: "SXGA", category: "Screen" },
  { width: 1366, height: 768, name: "HD (laptop)", category: "Screen" },
  { width: 1440, height: 900, name: "WXGA+", category: "Screen" },
  { width: 1600, height: 900, name: "HD+", category: "Screen" },
  { width: 1680, height: 1050, name: "WSXGA+", category: "Screen" },
  { width: 1920, height: 1200, name: "WUXGA", category: "Screen" },
  { width: 2560, height: 1080, name: "UW-FHD", category: "Screen", aliases: ["ultrawide"], ratio: "21:9" },
  { width: 2560, height: 1440, name: "QHD", category: "Screen", aliases: ["1440p", "2k", "wqhd"] },
  { width: 2560, height: 1600, name: "WQXGA", category: "Screen" },
  { width: 2880, height: 1800, name: "Retina 15″", category: "Screen" },
  { width: 3440, height: 1440, name: "UWQHD", category: "Screen", aliases: ["ultrawide"], ratio: "21:9" },
  { width: 5120, height: 1440, name: "DQHD", category: "Screen", aliases: ["super ultrawide"] },
  { width: 5120, height: 2880, name: "5K", category: "Screen" },
  { width: 6016, height: 3384, name: "6K (Pro Display XDR)", category: "Screen" },
  { width: 720, height: 480, name: "SD (NTSC)", category: "Video", aliases: ["480p", "dvd"] },
  { width: 720, height: 576, name: "SD (PAL)", category: "Video", aliases: ["576p"] },
  { width: 1280, height: 720, name: "HD", category: "Video", aliases: ["720p"] },
  { width: 1920, height: 1080, name: "Full HD", category: "Video", aliases: ["1080p", "fhd"] },
  { width: 3840, height: 2160, name: "4K UHD", category: "Video", aliases: ["2160p", "uhd", "4k"] },
  { width: 7680, height: 4320, name: "8K UHD", category: "Video", aliases: ["4320p", "8k"] },
  { width: 2048, height: 1080, name: "DCI 2K", category: "Cinema" },
  { width: 1998, height: 1080, name: "DCI 2K Flat", category: "Cinema" },
  { width: 2048, height: 858, name: "DCI 2K Scope", category: "Cinema" },
  { width: 4096, height: 2160, name: "DCI 4K", category: "Cinema" },
  { width: 3996, height: 2160, name: "DCI 4K Flat", category: "Cinema" },
  { width: 4096, height: 1716, name: "DCI 4K Scope", category: "Cinema" },
  { width: 4000, height: 3000, name: "12 MP (4:3)", category: "Photo" },
  { width: 4032, height: 3024, name: "12 MP (iPhone)", category: "Photo" },
  { width: 6000, height: 4000, name: "24 MP (3:2)", category: "Photo" },
  { width: 8256, height: 5504, name: "45 MP (3:2)", category: "Photo" },
  { width: 1080, height: 1080, name: "Instagram square", category: "Social" },
  { width: 1080, height: 1350, name: "Instagram portrait", category: "Social" },
  { width: 1080, height: 1920, name: "Stories, Reels, TikTok, Shorts", category: "Social" },
  { width: 1280, height: 720, name: "YouTube thumbnail", category: "Social" },
  { width: 2560, height: 1440, name: "YouTube channel banner", category: "Social" },
  { width: 1200, height: 630, name: "Open Graph link preview", category: "Social" },
  { width: 1500, height: 500, name: "X (Twitter) header", category: "Social" },
  { width: 1584, height: 396, name: "LinkedIn banner", category: "Social" },
  { width: 1000, height: 1500, name: "Pinterest pin", category: "Social" },
  { width: 820, height: 312, name: "Facebook cover", category: "Social" },
];

// ---------------------------------------------------------------------------
// Ratios

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

/** 1920 × 1080 → [16, 9]; non-integers are scaled to integers first (2.39:1 → 239:100). */
export function reduce(width: number, height: number): [number, number] {
  let scale = 1;
  while ((!Number.isInteger(width * scale) || !Number.isInteger(height * scale)) && scale < 1e6) scale *= 10;
  const w = Math.round(width * scale), h = Math.round(height * scale);
  const g = gcd(w, h) || 1;
  return [w / g, h / g];
}

/** The well-known ratio within 1 % of `value` (1366 × 768 is "16:9"), if any. */
export function nearestRatio(value: number, tolerance = 0.01): KnownRatio | undefined {
  let best: KnownRatio | undefined;
  for (const r of RATIOS) {
    const off = Math.abs(r.value - value) / r.value;
    if (off <= tolerance && (!best || off < Math.abs(best.value - value) / best.value)) best = r;
  }
  return best;
}

/** How to write the ratio of a size: "16:9", or "≈ 16:9" when it's only close, or "683:384". */
export function ratioText(width: number, height: number): { exact: string; common?: KnownRatio; approximate: boolean } {
  const [a, b] = reduce(width, height);
  const exact = `${a}:${b}`;
  const common = nearestRatio(width / height);
  return {
    exact,
    common,
    approximate: !!common && common.text !== exact && Math.abs(common.value - width / height) > 1e-9,
  };
}

/** "16:9" for a well-known ratio, else the decimal "2.40:1". */
export function ratioLabel(width: number, height: number): string {
  const sold = RESOLUTIONS.find((r) => r.width === width && r.height === height && r.ratio)?.ratio;
  if (sold) return `≈ ${sold}`;
  const r = ratioText(width, height);
  if (r.common) return r.approximate ? `≈ ${r.common.text}` : r.common.text;
  const [a, b] = reduce(width, height);
  return a <= 50 && b <= 50 ? `${a}:${b}` : `${decimal(width / height)}:1`;
}

export const decimal = (value: number, digits = 2) => (Math.round(value * 10 ** digits) / 10 ** digits).toFixed(digits);

export function resolutionsOf(width: number, height: number): Resolution[] {
  return RESOLUTIONS.filter((r) => r.width === width && r.height === height);
}

/** Known resolutions with the same ratio (to 0.5 %), smallest first. */
export function sameRatio(value: number, tolerance = 0.005): Resolution[] {
  const seen = new Set<string>();
  return RESOLUTIONS
    .filter((r) => Math.abs(r.width / r.height - value) / value <= tolerance)
    .filter((r) => {
      const key = `${r.width}x${r.height}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.width * a.height - b.width * b.height);
}

// ---------------------------------------------------------------------------
// Sizes

export interface Size {
  width: number;
  height: number;
}

/** Rounds a computed dimension: to an integer, or to an even integer for video encoders. */
export function dim(value: number, even = false): number {
  return even ? Math.max(2, Math.round(value / 2) * 2) : Math.max(1, Math.round(value));
}

export const megapixels = (s: Size) => s.width * s.height / 1e6;

export function mpText(s: Size): string {
  const mp = megapixels(s);
  return mp < 0.1 ? `${(mp * 1000).toFixed(0)} K pixels` : `${mp >= 10 ? mp.toFixed(1) : mp.toFixed(2)} MP`;
}

export const sizeText = (s: Size) => `${s.width} × ${s.height}`;
export const sizeCode = (s: Size) => `${s.width}x${s.height}`;

/** The other dimension for a ratio: width from height or height from width. */
export function complete(ratio: number, given: { width?: number; height?: number }, even = false): Size {
  if (given.width !== undefined) return { width: given.width, height: dim(given.width / ratio, even) };
  return { width: dim(given.height! * ratio, even), height: given.height! };
}

/** Sizes of the same ratio at common widths, for "16:9 at other sizes". */
export function scaled(s: Size, even = false): { factor: number; size: Size }[] {
  return [0.25, 0.5, 0.75, 1.5, 2].map((factor) => ({
    factor,
    size: { width: dim(s.width * factor, even), height: dim(s.height * factor, even) },
  }));
}

export interface Reframe {
  /** The biggest part of the picture with the target ratio. */
  crop: Size & { cutX: number; cutY: number };
  /** The picture whole, on a canvas of the target ratio. */
  pad: Size & { barX: number; barY: number; kind: "letterbox" | "pillarbox" | "none" };
}

/** Crop or pad `s` to `ratio`. */
export function reframe(s: Size, ratio: number, even = false): Reframe {
  const current = s.width / s.height;
  if (Math.abs(current - ratio) / ratio < 1e-6) {
    return {
      crop: { ...s, cutX: 0, cutY: 0 },
      pad: { ...s, barX: 0, barY: 0, kind: "none" },
    };
  }
  if (current > ratio) {
    // Wider than the target: crop the sides, or add bars above and below.
    const cw = Math.min(s.width, dim(s.height * ratio, even));
    const ph = dim(s.width / ratio, even);
    return {
      crop: { width: cw, height: s.height, cutX: (s.width - cw) / 2, cutY: 0 },
      pad: { width: s.width, height: ph, barX: 0, barY: (ph - s.height) / 2, kind: "letterbox" },
    };
  }
  const ch = Math.min(s.height, dim(s.width / ratio, even));
  const pw = dim(s.height * ratio, even);
  return {
    crop: { width: s.width, height: ch, cutX: 0, cutY: (s.height - ch) / 2 },
    pad: { width: pw, height: s.height, barX: (pw - s.width) / 2, barY: 0, kind: "pillarbox" },
  };
}

export interface Fit {
  /** Scaled to fit inside the box, nothing cut. */
  contain: Size & { scale: number };
  /** Scaled to fill the box, the overflow cut. */
  cover: Size & { scale: number; cutX: number; cutY: number };
}

export function fit(s: Size, box: Size, even = false): Fit {
  const contain = Math.min(box.width / s.width, box.height / s.height);
  const cover = Math.max(box.width / s.width, box.height / s.height);
  const cw = dim(s.width * cover, even), ch = dim(s.height * cover, even);
  return {
    contain: { width: dim(s.width * contain, even), height: dim(s.height * contain, even), scale: contain },
    cover: {
      width: cw,
      height: ch,
      scale: cover,
      cutX: Math.max(0, cw - box.width),
      cutY: Math.max(0, ch - box.height),
    },
  };
}

// ---------------------------------------------------------------------------
// Screens

export interface Screen {
  diagonal: number;
  ppi: number;
  /** Inches. */
  width: number;
  height: number;
  /** Millimeters between pixel centers. */
  dotPitch: number;
  /** Inches: farther than this, a 20/20 eye can't see single pixels (one arcminute per pixel). */
  retinaDistance: number;
}

export function screen(s: Size, diagonal: number): Screen {
  const pixels = Math.hypot(s.width, s.height);
  const ppi = pixels / diagonal;
  return {
    diagonal,
    ppi,
    width: diagonal * s.width / pixels,
    height: diagonal * s.height / pixels,
    dotPitch: 25.4 / ppi,
    retinaDistance: 1 / ppi / Math.tan(Math.PI / 180 / 60),
  };
}

export const cm = (inches: number) => inches * 2.54;

// ---------------------------------------------------------------------------
// Query

export type Query =
  | { kind: "empty" }
  | { kind: "size"; size: Size }
  | { kind: "ratio"; ratio: number; text: string }
  | { kind: "complete"; ratio: number; text: string; given: { width?: number; height?: number } }
  | { kind: "reframe"; size: Size; ratio: number; text: string }
  | { kind: "fit"; size: Size; box: Size }
  | { kind: "screen"; size: Size; diagonal: number }
  | { kind: "named"; matches: Resolution[] }
  | { kind: "error"; message: string };

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const SIZE = String.raw`(${NUM})\s*(?:x|×|\*|by|par)\s*(${NUM})`;
const RATIO = String.raw`(${NUM})\s*[:/]\s*(${NUM})`;
const num = (s: string) => Number(s.replace(",", "."));

function sizeOf(w: string, h: string): Size | string {
  const width = num(w), height = num(h);
  if (!(width > 0 && height > 0)) return "Width and height must be above zero";
  if (width > 1e6 || height > 1e6) return "That's more than a million pixels on a side";
  return { width, height };
}

function ratioOf(a: string, b: string): { ratio: number; text: string } | string {
  const x = num(a), y = num(b);
  if (!(x > 0 && y > 0)) return "A ratio needs two numbers above zero";
  return { ratio: x / y, text: `${a.replace(",", ".")}:${b.replace(",", ".")}` };
}

/** A ratio written "16:9", "16/9", "2.39" or the name of a known one ("scope", "widescreen"). */
function ratioWord(text: string): { ratio: number; text: string } | string | undefined {
  const m = new RegExp(`^${RATIO}$`).exec(text);
  if (m) return ratioOf(m[1], m[2]);
  if (new RegExp(`^${NUM}$`).test(text) && num(text) > 0 && num(text) < 10) {
    return { ratio: num(text), text: `${num(text)}:1` };
  }
  const known = RATIOS.find((r) => r.name.toLowerCase() === text.toLowerCase());
  return known ? { ratio: known.value, text: known.text } : undefined;
}

export function parseQuery(input: string): Query {
  const q = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return { kind: "empty" };

  // fit 4000x3000 in 1920x1080
  let m = new RegExp(`^(?:fit|scale|resize)?\\s*${SIZE}\\s+(?:in|into|to fit|within|dans)\\s+${SIZE}$`).exec(q);
  if (m) {
    const size = sizeOf(m[1], m[2]), box = sizeOf(m[3], m[4]);
    if (typeof size === "string") return { kind: "error", message: size };
    if (typeof box === "string") return { kind: "error", message: box };
    return { kind: "fit", size, box };
  }

  // 1920x1080 to 4:3
  m = new RegExp(`^${SIZE}\\s+(?:to|as|en|vers|->|→)\\s+(.+)$`).exec(q);
  if (m) {
    const size = sizeOf(m[1], m[2]);
    if (typeof size === "string") return { kind: "error", message: size };
    const r = ratioWord(m[3].trim());
    if (r === undefined) return { kind: "error", message: `“${m[3].trim()}” isn't a ratio` };
    if (typeof r === "string") return { kind: "error", message: r };
    return { kind: "reframe", size, ratio: r.ratio, text: r.text };
  }

  // 27" 2560x1440, 2560x1440 27in, 13.3 inch 2560x1600
  const DIAG = String.raw`(${NUM})\s*(?:"|″|''|in\b|inch(?:es)?|pouces?)`;
  m = new RegExp(`^${DIAG}\\s*${SIZE}$`).exec(q) ?? new RegExp(`^${SIZE}\\s*(?:@|at)?\\s*${DIAG}$`).exec(q);
  if (m) {
    const diagFirst = new RegExp(`^${DIAG}`).test(q);
    const [d, w, h] = diagFirst ? [m[1], m[2], m[3]] : [m[3], m[1], m[2]];
    const size = sizeOf(w, h);
    if (typeof size === "string") return { kind: "error", message: size };
    const diagonal = num(d);
    if (!(diagonal > 0)) return { kind: "error", message: "The diagonal must be above zero" };
    return { kind: "screen", size, diagonal };
  }

  m = new RegExp(`^${SIZE}$`).exec(q);
  if (m) {
    const size = sizeOf(m[1], m[2]);
    return typeof size === "string" ? { kind: "error", message: size } : { kind: "size", size };
  }

  // 16:9 1280, 16:9 w1280, 16:9 h720, 16:9 x 720, 16:9 ? x 720
  m = new RegExp(`^${RATIO}\\s+(?:(w|h|width|height|largeur|hauteur)\\s*=?\\s*)?(${NUM})(?:\\s*(?:px|p))?$`).exec(q);
  if (m) {
    const r = ratioOf(m[1], m[2]);
    if (typeof r === "string") return { kind: "error", message: r };
    const value = num(m[4]);
    if (!(value > 0)) return { kind: "error", message: "The size must be above zero" };
    // "720p" means a height.
    const isHeight = /^(h|height|hauteur)$/.test(m[3] ?? "") || /p$/.test(q);
    return { kind: "complete", ...r, given: isHeight ? { height: value } : { width: value } };
  }
  m = new RegExp(`^${RATIO}\\s+(?:\\?|_)\\s*(?:x|×)\\s*(${NUM})$`).exec(q);
  if (m) {
    const r = ratioOf(m[1], m[2]);
    if (typeof r === "string") return { kind: "error", message: r };
    return { kind: "complete", ...r, given: { height: num(m[3]) } };
  }
  m = new RegExp(`^${RATIO}\\s+(${NUM})\\s*(?:x|×)\\s*(?:\\?|_)$`).exec(q);
  if (m) {
    const r = ratioOf(m[1], m[2]);
    if (typeof r === "string") return { kind: "error", message: r };
    return { kind: "complete", ...r, given: { width: num(m[3]) } };
  }

  m = new RegExp(`^${RATIO}$`).exec(q);
  if (m) {
    const r = ratioOf(m[1], m[2]);
    return typeof r === "string" ? { kind: "error", message: r } : { kind: "ratio", ...r };
  }

  // A bare decimal is a ratio to 1: "2.39", "1.85".
  if (new RegExp(`^${NUM}$`).test(q) && num(q) >= 0.2 && num(q) <= 10) {
    return { kind: "ratio", ratio: num(q), text: `${num(q)}:1` };
  }

  // Names: "4k", "1080p", "full hd", "instagram".
  const byAlias = RESOLUTIONS.filter((r) => r.aliases?.includes(q));
  const matches = byAlias.length
    ? byAlias
    : RESOLUTIONS.filter((r) => r.name.toLowerCase().includes(q) || `${r.height}p` === q);
  if (matches.length) return { kind: "named", matches };
  const ratio = RATIOS.find((r) => r.name.toLowerCase() === q);
  if (ratio) return { kind: "ratio", ratio: ratio.value, text: ratio.text };

  return { kind: "error", message: "Not a size or a ratio" };
}

export const EXAMPLES: { query: string; title: string }[] = [
  { query: "1920x1080", title: "Ratio, megapixels and the same ratio at other sizes" },
  { query: "16:9 1280", title: "The height for a width" },
  { query: "16:9 h720", title: "The width for a height" },
  { query: "1920x1080 to 4:3", title: "Crop or letterbox to another ratio" },
  { query: "fit 4000x3000 in 1920x1080", title: "Scale to fit or fill a box" },
  { query: '27" 2560x1440', title: "Pixel density and size of a screen" },
  { query: "21:9", title: "What a ratio is used for, and its resolutions" },
];
