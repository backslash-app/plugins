// Color math: parsing any CSS-ish color, converting between sRGB, HSL, HSV,
// HWB and OKLCH, names, contrast; plus the picker's background script.
// Pure, tested in lib_test.ts.

/** sRGB, channels 0–255 (not rounded), alpha 0–1. */
export interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const round = (v: number, digits = 0) => {
  const f = 10 ** digits;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};
/** A number without trailing zeros: 0.5, 32.3, 100. */
const num = (v: number, digits = 0) => String(round(v, digits));

// ---------------------------------------------------------------------------
// Named colors (CSS Color Module Level 4)

const CSS_NAMES = `aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc
bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887
cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c
cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9
darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000
darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f
darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969
dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc
ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080
honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa
lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff
lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a
lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de
lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa
mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee
mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa
mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23
orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee
palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6
purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072
sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd
slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080
thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5
yellow ffff00 yellowgreen 9acd32`;

export const NAMED: Record<string, string> = Object.fromEntries(
  CSS_NAMES.split(/\s+/).reduce<[string, string][]>((acc, w, i, all) => {
    if (i % 2 === 0) acc.push([w, `#${all[i + 1]}`]);
    return acc;
  }, []),
);

/** A few everyday French names, mapped to CSS ones. */
const FRENCH: Record<string, string> = {
  rouge: "red",
  vert: "green",
  bleu: "blue",
  jaune: "yellow",
  noir: "black",
  blanc: "white",
  gris: "gray",
  rose: "pink",
  marron: "brown",
  violet: "violet",
  argent: "silver",
  "or": "gold",
  "bleu marine": "navy",
  turquoise: "turquoise",
};

/** Hex → its CSS name, the first spelling (gray before grey). */
const BY_HEX: Record<string, string> = Object.entries(NAMED).reduce<Record<string, string>>((acc, [name, hex]) => {
  acc[hex] ??= name;
  return acc;
}, {});

// ---------------------------------------------------------------------------
// Conversions

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const fromLinear = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

export interface OKLab {
  l: number;
  a: number;
  b: number;
}
export interface OKLCH {
  l: number;
  c: number;
  h: number;
}

/** sRGB → OKLab (Björn Ottosson). */
export function rgbToOklab({ r, g, b }: RGB): OKLab {
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255));
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** OKLab → sRGB, clipped to the sRGB gamut. */
export function oklabToRgb({ l: L, a, b }: OKLab, alpha = 1): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const out = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => clamp(fromLinear(v)) * 255);
  return { r: out[0], g: out[1], b: out[2], a: alpha };
}

export function rgbToOklch(c: RGB): OKLCH {
  const { l, a, b } = rgbToOklab(c);
  const chroma = Math.hypot(a, b);
  const h = chroma < 1e-4 ? 0 : (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  return { l, c: chroma, h };
}

export const oklchToRgb = ({ l, c, h }: OKLCH, alpha = 1): RGB =>
  oklabToRgb({ l, a: c * Math.cos(h * Math.PI / 180), b: c * Math.sin(h * Math.PI / 180) }, alpha);

/** Hue (degrees), and max/min channels, shared by HSL, HSV and HWB. */
function hue({ r, g, b }: RGB): { h: number; max: number; min: number } {
  const [R, G, B] = [r / 255, g / 255, b / 255];
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const d = max - min;
  let h = 0;
  if (d > 1e-9) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, max, min };
}

/** h 0–360, s and l 0–1. */
export function rgbToHsl(c: RGB): { h: number; s: number; l: number } {
  const { h, max, min } = hue(c);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d < 1e-9 ? 0 : d / (1 - Math.abs(2 * l - 1));
  return { h, s, l };
}

export function hslToRgb(h: number, s: number, l: number, a = 1): RGB {
  const k = (n: number) => (n + h / 30) % 12;
  const f = (n: number) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: f(0) * 255, g: f(8) * 255, b: f(4) * 255, a };
}

/** h 0–360, s and v 0–1. */
export function rgbToHsv(c: RGB): { h: number; s: number; v: number } {
  const { h, max, min } = hue(c);
  return { h, s: max === 0 ? 0 : (max - min) / max, v: max };
}

export function hsvToRgb(h: number, s: number, v: number, a = 1): RGB {
  const l = v * (1 - s / 2);
  const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return hslToRgb(h, sl, l, a);
}

export function hwbToRgb(h: number, w: number, bl: number, a = 1): RGB {
  if (w + bl >= 1) {
    const gray = (w / (w + bl)) * 255;
    return { r: gray, g: gray, b: gray, a };
  }
  const base = hslToRgb(h, 1, 0.5);
  const f = (v: number) => (v / 255) * (1 - w - bl) * 255 + w * 255;
  return { r: f(base.r), g: f(base.g), b: f(base.b), a };
}

export function rgbToHwb(c: RGB): { h: number; w: number; b: number } {
  const { h, max, min } = hue(c);
  return { h, w: min, b: 1 - max };
}

// ---------------------------------------------------------------------------
// Parsing

/** "120", "120deg", "0.5turn", "3.14rad", "200grad" → degrees. */
function angle(s: string): number {
  const m = s.match(/^(-?[\d.]+(?:e-?\d+)?)(deg|turn|rad|grad)?$/i);
  if (!m) return NaN;
  const v = Number(m[1]);
  const unit = (m[2] ?? "deg").toLowerCase();
  const deg = unit === "turn" ? v * 360 : unit === "rad" ? (v * 180) / Math.PI : unit === "grad" ? v * 0.9 : v;
  return ((deg % 360) + 360) % 360;
}

/** "50%" → 0.5 (or `whole` for a bare number on a 0–`whole` scale). */
function ratio(s: string, whole: number): number {
  if (s === "none") return 0;
  if (s.endsWith("%")) return Number(s.slice(0, -1)) / 100;
  return Number(s) / whole;
}

const alphaOf = (s: string | undefined) => (s === undefined ? 1 : clamp(ratio(s, 1)));

/** "#f63", "#ff6347", "ff6347", "#ff634780", "0xff6347". */
function parseHex(s: string): RGB | undefined {
  const m = s.match(/^(?:#|0x)?([0-9a-f]{3,8})$/i);
  if (!m || ![3, 4, 6, 8].includes(m[1].length)) return undefined;
  // Bare 3- or 4-digit numbers are more likely something else.
  if (!/^(#|0x)/i.test(s) && m[1].length < 6) return undefined;
  let h = m[1];
  if (h.length <= 4) h = [...h].map((c) => c + c).join("");
  const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
  return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? round(n(6) / 255, 3) : 1 };
}

/** Splits "a, b, c / d" or "a b c / d" into the values and the alpha. */
function args(inner: string): { values: string[]; alpha?: string } {
  const [main, slash] = inner.split("/");
  const values = main.trim().split(/\s*,\s*|\s+/).filter(Boolean);
  if (slash !== undefined) return { values, alpha: slash.trim() };
  if (values.length === 4) return { values: values.slice(0, 3), alpha: values[3] };
  return { values };
}

/**
 * Reads hex, `rgb()`, `hsl()`, `hwb()`, `hsv()`, `oklch()`, `oklab()`, CSS
 * names (and a few French ones), or bare "255, 99, 71". Undefined otherwise.
 */
export function parseColor(input: string): RGB | undefined {
  const s = input.trim().toLowerCase().replace(/;$/, "");
  if (!s) return undefined;
  const named = NAMED[s] ?? NAMED[FRENCH[s] ?? ""] ?? NAMED[s.replace(/\s+/g, "")];
  if (named) return parseHex(named);
  if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const hex = parseHex(s.replace(/\s+/g, ""));
  if (hex) return hex;

  const fn = s.match(/^([a-z]+)\s*\((.*)\)$/);
  const [name, inner] = fn ? [fn[1], fn[2]] : ["rgb", s];
  const { values, alpha } = args(inner);
  if (values.length !== 3) return undefined;
  const a = alphaOf(alpha);
  let rgb: RGB | undefined;
  switch (name) {
    case "rgb":
    case "rgba": {
      const [r, g, b] = values.map((v) => clamp(ratio(v, 255)) * 255);
      rgb = { r, g, b, a };
      break;
    }
    case "hsl":
    case "hsla":
      rgb = hslToRgb(angle(values[0]), clamp(ratio(values[1], 100)), clamp(ratio(values[2], 100)), a);
      break;
    case "hsv":
    case "hsb":
      rgb = hsvToRgb(angle(values[0]), clamp(ratio(values[1], 100)), clamp(ratio(values[2], 100)), a);
      break;
    case "hwb":
      rgb = hwbToRgb(angle(values[0]), clamp(ratio(values[1], 100)), clamp(ratio(values[2], 100)), a);
      break;
    case "oklch": {
      const l = clamp(ratio(values[0], 1));
      // In CSS, 100% chroma is 0.4.
      const c = Math.max(0, values[1].endsWith("%") ? ratio(values[1], 1) * 0.4 : Number(values[1]));
      rgb = oklchToRgb({ l, c, h: angle(values[2] === "none" ? "0" : values[2]) }, a);
      break;
    }
    case "oklab": {
      const ab = (v: string) => (v.endsWith("%") ? ratio(v, 1) * 0.4 : Number(v));
      rgb = oklabToRgb({ l: clamp(ratio(values[0], 1)), a: ab(values[1]), b: ab(values[2]) }, a);
      break;
    }
  }
  if (!rgb || [rgb.r, rgb.g, rgb.b, rgb.a].some((v) => !Number.isFinite(v))) return undefined;
  return rgb;
}

// ---------------------------------------------------------------------------
// Formatting

const byte = (v: number) => Math.round(clamp(v, 0, 255));
const hex2 = (v: number) => byte(v).toString(16).padStart(2, "0");
const pct = (v: number) => `${num(v * 100)}%`;
const withAlpha = (c: RGB, sep: string) => (c.a < 1 ? `${sep}${num(c.a, 2)}` : "");

export function toHex(c: RGB, o: { upper?: boolean } = {}): string {
  const h = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}${c.a < 1 ? hex2(c.a * 255) : ""}`;
  return o.upper ? h.toUpperCase() : h;
}

export const toRgb = (c: RGB) =>
  c.a < 1
    ? `rgba(${byte(c.r)}, ${byte(c.g)}, ${byte(c.b)}${withAlpha(c, ", ")})`
    : `rgb(${byte(c.r)}, ${byte(c.g)}, ${byte(c.b)})`;

export function toHsl(c: RGB): string {
  const { h, s, l } = rgbToHsl(c);
  return `${c.a < 1 ? "hsla" : "hsl"}(${num(h) === "360" ? 0 : num(h)}, ${pct(s)}, ${pct(l)}${withAlpha(c, ", ")})`;
}

export function toHsv(c: RGB): string {
  const { h, s, v } = rgbToHsv(c);
  return `hsv(${num(h) === "360" ? 0 : num(h)}, ${pct(s)}, ${pct(v)})`;
}

export function toHwb(c: RGB): string {
  const { h, w, b } = rgbToHwb(c);
  return `hwb(${num(h) === "360" ? 0 : num(h)} ${pct(w)} ${pct(b)}${withAlpha(c, " / ")})`;
}

export function toOklch(c: RGB): string {
  const { l, c: chroma, h } = rgbToOklch(c);
  const hue = chroma < 0.0005 ? "0" : num(h, 1) === "360" ? "0" : num(h, 1);
  return `oklch(${num(l * 100, 1)}% ${num(chroma, 3)} ${hue}${withAlpha(c, " / ")})`;
}

/** For shaders and design tools: "1.000, 0.388, 0.278". */
export const toFloats = (c: RGB) => [c.r, c.g, c.b].map((v) => (byte(v) / 255).toFixed(3)).join(", ");

export interface Format {
  id: string;
  title: string;
  value: string;
}

/** Every way to write a color, the most common first. */
export function formats(c: RGB, o: { upper?: boolean } = {}): Format[] {
  const name = exactName(c);
  return [
    { id: "hex", title: "HEX", value: toHex(c, o) },
    { id: "rgb", title: "RGB", value: toRgb(c) },
    { id: "hsl", title: "HSL", value: toHsl(c) },
    { id: "oklch", title: "OKLCH", value: toOklch(c) },
    { id: "hsv", title: "HSV", value: toHsv(c) },
    { id: "hwb", title: "HWB", value: toHwb(c) },
    { id: "floats", title: "RGB 0–1", value: toFloats(c) },
    ...(name ? [{ id: "name", title: "CSS Name", value: name }] : []),
  ];
}

// ---------------------------------------------------------------------------
// Names, contrast

export const exactName = (c: RGB) => (c.a === 1 ? BY_HEX[toHex(c)] : undefined);

/** The closest CSS name (in OKLab) and how far it is (0 = exact). */
export function nearestName(c: RGB): { name: string; distance: number } {
  const lab = rgbToOklab(c);
  let best = { name: "black", distance: Infinity };
  for (const [hex, name] of Object.entries(BY_HEX)) {
    const o = rgbToOklab(parseHex(hex)!);
    const d = Math.hypot(lab.l - o.l, lab.a - o.a, lab.b - o.b);
    if (d < best.distance) best = { name, distance: d };
  }
  return best;
}

/** "Tomato" or "≈ Light Salmon". */
export function describeName(c: RGB): string {
  const { name, distance } = nearestName(c);
  return `${distance < 0.002 ? "" : "≈ "}${prettyName(name)}`;
}

const WORDS = ["light", "dark", "medium", "pale", "deep", "dim", "hot", "lawn", "sky", "slate", "steel", "rebecca"];
/** "lightgoldenrodyellow" → "Light Goldenrod Yellow". */
export function prettyName(name: string): string {
  let rest = name;
  const parts: string[] = [];
  for (let again = true; again;) {
    again = false;
    for (const w of WORDS) {
      if (rest.startsWith(w) && rest.length > w.length) {
        parts.push(w);
        rest = rest.slice(w.length);
        again = true;
      }
    }
  }
  const tail = rest.match(
    /^(.+?)(blue|green|red|gray|grey|yellow|white|violet|purple|pink|brown|cyan|wood|smoke|rose)$/,
  );
  if (tail && tail[1].length > 2) parts.push(tail[1], tail[2]);
  else parts.push(rest);
  return parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(" ");
}

/** WCAG relative luminance, 0–1. */
export function luminance({ r, g, b }: RGB): number {
  const [R, G, B] = [r, g, b].map((v) => toLinear(byte(v) / 255));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}

export function contrast(a: RGB, b: RGB): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** "AAA", "AA", "AA Large" or "Fail", for normal text. */
export const wcag = (ratio: number) => (ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA Large" : "Fail");

export const WHITE: RGB = { r: 255, g: 255, b: 255, a: 1 };
export const BLACK: RGB = { r: 0, g: 0, b: 0, a: 1 };

/** The swatch icon of a color (alpha is dropped). */
export const swatch = (c: RGB) => `color:${toHex({ ...c, a: 1 })}`;

// ---------------------------------------------------------------------------
// History

export interface Picked {
  hex: string;
  /** Unix ms. */
  at: number;
}

/** Lines "#rrggbb 1730000000" written by the picker script. */
export function parsePicks(text: string): Picked[] {
  return text.split("\n").flatMap((line) => {
    const m = line.trim().match(/^#?([0-9a-f]{6})\s+(\d+)$/i);
    return m ? [{ hex: `#${m[1].toLowerCase()}`, at: Number(m[2]) * 1000 }] : [];
  });
}

/** Newest first, one entry per color, at most `max`. */
export function mergeHistory(history: Picked[], added: Picked[], max = 100): Picked[] {
  const all = [...added, ...history].sort((a, b) => b.at - a.at);
  const seen = new Set<string>();
  return all.filter((p) => !seen.has(p.hex) && seen.add(p.hex)).slice(0, max);
}

// ---------------------------------------------------------------------------
// Picking from the screen

export type Desktop = "gnome" | "kde" | "hyprland" | "sway" | "other";
export interface Session {
  wayland: boolean;
  desktop: Desktop;
}
export type Env = Partial<Record<string, string>>;

export const SESSION_ENV = [
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "XAUTHORITY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "SWAYSOCK",
] as const;

export function detectSession(env: Env): Session {
  const type = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const wayland = type === "wayland" || (!!env.WAYLAND_DISPLAY && type !== "x11");
  const current = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":");
  const desktop: Desktop = env.HYPRLAND_INSTANCE_SIGNATURE || current.includes("hyprland")
    ? "hyprland"
    : env.SWAYSOCK || current.includes("sway")
    ? "sway"
    : current.some((d) => ["gnome", "ubuntu", "unity", "pop"].includes(d))
    ? "gnome"
    : current.includes("kde")
    ? "kde"
    : "other";
  return { wayland, desktop };
}

/** `portal` is xdg-desktop-portal's PickColor, called with gdbus. */
export type Picker = "hyprpicker" | "grim" | "gpick" | "xcolor" | "portal";

export function pickerCandidates(s: Session): Picker[] {
  if (s.wayland) {
    if (s.desktop === "gnome" || s.desktop === "kde") return ["portal"];
    return ["hyprpicker", "grim", "portal"];
  }
  return ["xcolor", "gpick", "portal"];
}

export const PICKER_NAMES: Record<Picker, string> = {
  hyprpicker: "hyprpicker",
  grim: "grim + slurp",
  gpick: "Gpick",
  xcolor: "xcolor",
  portal: "Desktop portal",
};

/** Single-quotes a string for sh. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Sets `$color` to "#rrggbb" (or leaves it empty when cancelled). */
export function pickCommand(tool: Picker): string {
  const firstHex = `grep -oiE '#[0-9a-f]{6}' | head -n 1`;
  switch (tool) {
    case "hyprpicker":
      return `color=$(hyprpicker -f hex 2>/dev/null | ${firstHex})`;
    case "xcolor":
      return `color=$(xcolor 2>/dev/null | ${firstHex})`;
    case "gpick":
      return `color=$(gpick -s -o 2>/dev/null | ${firstHex})`;
    case "grim":
      // One pixel as PPM: the last three bytes are its red, green and blue.
      return [
        `point=$(slurp -p) || exit 0`,
        `color="#$(grim -g "$point" -t ppm - | tail -c 3 | od -An -tx1 | tr -d ' \\n')"`,
      ].join("\n");
    case "portal":
      return [
        `out="\${XDG_RUNTIME_DIR:-/tmp}/backslash-pick-$$"; token="backslash$$"`,
        `buffer=; command -v stdbuf >/dev/null && buffer="stdbuf -oL"`,
        `$buffer gdbus monitor --session --dest org.freedesktop.portal.Desktop > "$out" 2>/dev/null & monitor=$!`,
        `trap 'kill $monitor 2>/dev/null; rm -f "$out"' EXIT`,
        `sleep 0.3`,
        `gdbus call --session --dest org.freedesktop.portal.Desktop --object-path /org/freedesktop/portal/desktop --method org.freedesktop.portal.Screenshot.PickColor '' "{'handle_token': <'$token'>}" >/dev/null || exit 0`,
        `i=0; while [ $i -lt 1200 ] && ! grep -q "$token: org.freedesktop.portal.Request.Response" "$out"; do sleep 0.1; i=$((i + 1)); done`,
        `line=$(grep -m 1 "$token: org.freedesktop.portal.Request.Response" "$out")`,
        `case "$line" in *"(uint32 0,"*) ;; *) exit 0 ;; esac`,
        `color=$(printf '%s' "$line" | sed -n "s/.*'color': <(\\([^)]*\\))>.*/\\1/p" | awk -F', *' '{ printf "#%02x%02x%02x", $1 * 255 + 0.5, $2 * 255 + 0.5, $3 * 255 + 0.5 }')`,
      ].join("\n");
  }
}

export interface PickOptions {
  tool: Picker;
  /** The file new colors are appended to; the extension reads it into its history. */
  log: string;
  wayland: boolean;
  upper?: boolean;
  wait?: number;
}

/** The background script: pick, copy, remember, notify. */
export function pickScript(o: PickOptions): string {
  const copy = o.wayland
    ? `printf '%s' "$text" | wl-copy 2>/dev/null || printf '%s' "$text" | xclip -selection clipboard 2>/dev/null`
    : `printf '%s' "$text" | xclip -selection clipboard 2>/dev/null || printf '%s' "$text" | wl-copy 2>/dev/null`;
  const dir = o.log.split("/").slice(0, -1).join("/");
  return [
    `sleep ${o.wait ?? 0.3}`,
    pickCommand(o.tool),
    `color=$(printf '%s' "$color" | tr 'A-F' 'a-f')`,
    `case "$color" in \\#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]) ;; *) exit 0 ;; esac`,
    `mkdir -p ${q(dir)} && printf '%s %s\\n' "$color" "$(date +%s)" >> ${q(o.log)}`,
    o.upper ? `text=$(printf '%s' "$color" | tr 'a-f' 'A-F')` : `text="$color"`,
    `if ${copy}; then note='Copied to the clipboard'; else note='Saved in Color History'; fi`,
    `notify-send -a Backslash -i color-select "Color $text" "$note" 2>/dev/null`,
    "true",
  ].join("\n");
}

/** `systemd-run` arguments to run the script outside the launcher. */
export function systemdRunArgs(unit: string, script: string, env: Env = {}): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${unit}`,
    "--description=Backslash: color picker",
    "--collect",
    // wl-copy and xclip stay in the background to serve the clipboard.
    "--property=KillMode=process",
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    script,
  ];
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

const MANAGERS: Record<Family, string> = {
  arch: "sudo pacman -S",
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  suse: "sudo zypper install",
};

export const FAMILY_NAMES: Record<Family, string> = {
  arch: "Arch",
  debian: "Debian, Ubuntu",
  fedora: "Fedora",
  suse: "openSUSE",
};

/** What to install to pick colors in this session. */
export function pickerInstall(s: Session, family: Family): string {
  if (s.wayland && (s.desktop === "gnome" || s.desktop === "kde")) {
    const portal = s.desktop === "gnome" ? "xdg-desktop-portal-gnome" : "xdg-desktop-portal-kde";
    return `${MANAGERS[family]} ${portal}`;
  }
  if (s.wayland) {
    return s.desktop === "hyprland" && family === "arch"
      ? "sudo pacman -S hyprpicker"
      : `${MANAGERS[family]} grim slurp`;
  }
  return `${MANAGERS[family]} gpick`;
}
