// Pure logic of the Tailwind CSS extension: the utility index, search, values and colors.

import type { Color } from "@backslash/api";
import { type DocPage, DOCS } from "./docs.ts";

/** utilities.json, generated from tailwindcss's own design system (see the comment in backslash.toml). */
export interface Data {
  version: string;
  colors: string[];
  theme: [string, string][];
  /** [class, CSS]: the declarations alone, or a whole rule when the selector is not just `.class`. */
  plain: [string, string][];
  /** [prefix, CSS with {v}, values separated by spaces]: `p` + `padding: calc(var(--spacing) * {v});`. */
  groups: [string, string, string][];
  /** [prefix, CSS with {c}]: one class per palette color and shade, plus black and white. */
  colorGroups: [string, string][];
}

export interface Utility {
  cls: string;
  css: string;
  /** "red-500", "black" for color utilities. */
  color?: string;
}

export const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];

/** Every utility of the index, colors expanded. */
export function expand(data: Data): Utility[] {
  const out: Utility[] = data.plain.map(([cls, css]) => ({ cls, css }));
  for (const [prefix, tpl, values] of data.groups) {
    for (const v of values.split(" ")) out.push({ cls: `${prefix}-${v}`, css: tpl.split("{v}").join(v) });
  }
  const colors = [...data.colors.flatMap((c) => SHADES.map((s) => `${c}-${s}`)), "black", "white"];
  for (const [prefix, tpl] of data.colorGroups) {
    // Tailwind lists font-{color} because font-* takes any theme key; it is not a color utility.
    if (!tpl.includes("--color-{c}")) continue;
    for (const c of colors) out.push({ cls: `${prefix}-${c}`, css: tpl.split("{c}").join(c), color: c });
  }
  return out;
}

/** `.p-4`'s selector, escaped as in CSS (`w-1/2` → `.w-1\/2`). */
export const selector = (cls: string) => "." + cls.replace(/[^a-zA-Z0-9_-]/g, (c) => "\\" + c);

/** The full rule, as Tailwind generates it. */
export function rule(u: Utility): string {
  if (u.css.startsWith(".") || u.css.startsWith(":")) return u.css;
  return `${selector(u.cls)} {\n${u.css.split("\n").map((l) => "  " + l).join("\n")}\n}`;
}

/** Top-level declarations `[property, value]`, nested blocks skipped. */
export function declarations(css: string): [string, string][] {
  let body = css;
  if (css.startsWith(".") || css.startsWith(":")) {
    body = css.slice(css.indexOf("{\n") + 2, css.lastIndexOf("\n}")).split("\n").map((l) => l.replace(/^ {2}/, ""))
      .join("\n");
  }
  const out: [string, string][] = [];
  let depth = 0;
  for (const line of body.split("\n")) {
    const t = line.trim();
    if (t.endsWith("{")) {
      depth++;
      continue;
    }
    if (t === "}") {
      depth--;
      continue;
    }
    if (depth) continue;
    const m = t.match(/^(-{0,2}[a-zA-Z][\w-]*):\s*(.*);$/);
    if (m) out.push([m[1], m[2]]);
  }
  return out;
}

/** The declarations that matter to a reader: without Tailwind's internal `--tw-*` variables. */
export const visible = (css: string) => {
  const all = declarations(css);
  const shown = all.filter(([p]) => !p.startsWith("--tw-"));
  return shown.length ? shown : all;
};

// ---------------------------------------------------------------------------
// Values

const round = (n: number) => String(Math.round(n * 10000) / 10000);

/** `0.25rem` → 4 (px) at the default 16px root size. */
export function px(value: string): string | undefined {
  const m = value.trim().match(/^(-?[\d.]+)rem$/);
  return m ? `${round(parseFloat(m[1]) * 16)}px` : undefined;
}

/** Replaces theme variables by their values and works out the simple calc()s. */
export function resolve(value: string, theme: Map<string, string>): string {
  let v = value;
  for (let i = 0; i < 4; i++) {
    const before = v;
    v = v.replace(/var\((--[\w-]+)\)/g, (all, name) => (name.startsWith("--tw-") ? all : theme.get(name) ?? all));
    if (v === before) break;
  }
  // calc(0.25rem * 4) → 1rem, calc(1 / 2 * 100%) → 50%, calc(1.75 / 1.125) → 1.5556
  for (let i = 0; i < 3; i++) {
    v = v
      .replace(
        /calc\((-?[\d.]+)(rem|px|%)? \* (-?[\d.]+)(rem|px|%)?\)/g,
        (all, a, ua, b, ub) => ua && ub ? all : `${round(parseFloat(a) * parseFloat(b))}${ua ?? ub ?? ""}`,
      )
      .replace(
        /calc\((-?[\d.]+) \/ (-?[\d.]+) \* 100%\)/g,
        (_, a, b) => `${round((parseFloat(a) / parseFloat(b)) * 100)}%`,
      )
      .replace(/calc\((-?[\d.]+) \/ (-?[\d.]+)\)/g, (_, a, b) => round(parseFloat(a) / parseFloat(b)))
      .replace(/calc\((-?[\d.]+)(rem|px|%)\)/g, "$1$2");
  }
  return v;
}

/** Theme variables a CSS text uses, with their values. */
export function themeVars(css: string, theme: Map<string, string>): [string, string][] {
  const names = [...new Set([...css.matchAll(/var\((--[\w-]+)\)/g)].map((m) => m[1]))];
  return names.filter((n) => theme.has(n)).map((n) => [n, theme.get(n)!]);
}

/** A value made only of Tailwind's composition variables: `var(--tw-blur,) var(--tw-brightness,)…`. */
const composed = (value: string) => /^(\s*,?\s*var\(--tw-[\w-]+,?\)\s*)+$/.test(value);

/** The declarations that say what the class does: `--tw-shadow: 0 4px…` rather than `box-shadow: var(--tw-shadow)…`. */
export function telling(css: string): [string, string][] {
  const all = declarations(css).filter(([, v]) => !composed(v));
  const own = all.filter(([p]) => !p.startsWith("--tw-"));
  if (own.length) return own;
  const tw = all.filter(([p, v]) => !/-reverse$/.test(p) && v !== "0" && v !== "initial");
  return tw.length ? tw : declarations(css);
}

/** A short "padding: 1rem" for subtitles; 16px as an accessory when it is a length. */
export function summary(u: Utility, theme: Map<string, string>): { text: string; px?: string } {
  const decls = telling(u.css);
  if (!decls.length) return { text: u.css.split("\n")[0] };
  const [prop, value] = decls[0];
  const resolved = resolve(value, theme);
  const more = decls.length > 1 ? ` (+${decls.length - 1})` : "";
  return { text: `${prop}: ${resolved}${more}`, px: decls.length === 1 ? px(resolved) : undefined };
}

// ---------------------------------------------------------------------------
// Docs

const DOC_SLUGS = new Set(DOCS.map((d) => d.slug));

/** Classes whose docs page can't be told from their CSS. */
const CLASS_DOCS: [RegExp, string][] = [
  [/^space-/, "margin"],
  [/^divide-(x|y)(-|$)/, "border-width"],
  [/^divide-(solid|dashed|dotted|double|hidden|none)$/, "border-style"],
  [/^divide-/, "border-color"],
  [/^(inset-)?(ring|shadow)(-|$)|^inset-shadow|^ring-offset/, "box-shadow"],
  [/^text-shadow/, "text-shadow"],
  [/^(from|via|to)-|^bg-(linear|radial|conic|none)/, "background-image"],
  [/^backdrop-(blur|brightness|contrast|grayscale|hue-rotate|invert|opacity|saturate|sepia)/, "backdrop-filter-$1"],
  [/^backdrop-filter/, "backdrop-filter"],
  [/^(blur|brightness|contrast|drop-shadow|grayscale|hue-rotate|invert|saturate|sepia)(-|$)/, "filter-$1"],
  [/^(inset|top|right|bottom|left|start|end)(-|$)/, "top-right-bottom-left"],
  [/^size-/, "width"],
  [/^container$/, "max-width"],
  [/^(not-)?sr-only$/, "display"],
  [/^truncate$/, "text-overflow"],
  [/^line-clamp-/, "line-clamp"],
  [/^(subpixel-)?antialiased$/, "font-smoothing"],
  [/^mask-(clip|composite|mode|origin|position|repeat|size|type)/, "mask-$1"],
  [/^mask-/, "mask-image"],
  [/^snap-(mandatory|proximity|none|x|y|both)$/, "scroll-snap-type"],
  [/^scroll-m/, "scroll-margin"],
  [/^scroll-p/, "scroll-padding"],
  [/^transform-(3d|flat)$/, "transform-style"],
  [/^animate-/, "animation"],
];

/** CSS property → docs page, for the properties whose page has another name. */
function propertyDoc(prop: string): string | undefined {
  const p = prop.replace(/^-(webkit|moz)-/, "");
  const rules: [RegExp, string][] = [
    [/^margin/, "margin"],
    [/^padding/, "padding"],
    [/^border-.*radius$/, "border-radius"],
    [/^border-.*width$/, "border-width"],
    [/^border-.*color$/, "border-color"],
    [/^border-.*style$/, "border-style"],
    [/^grid-column/, "grid-column"],
    [/^grid-row/, "grid-row"],
    [/^overflow-[xy]$/, "overflow"],
    [/^overscroll-behavior/, "overscroll-behavior"],
    [/^scroll-margin/, "scroll-margin"],
    [/^scroll-padding/, "scroll-padding"],
    [/^(inset|top|right|bottom|left)/, "top-right-bottom-left"],
    [/^(column-|row-)?gap$/, "gap"],
    [/^(min-|max-)?(inline|block)-size$/, "width"],
    [/^line-clamp$/, "line-clamp"],
    [/^font-smoothing$/, "font-smoothing"],
    [/^text-wrap/, "text-wrap"],
    [/^text-decoration$/, "text-decoration-line"],
  ];
  for (const [re, slug] of rules) if (re.test(p)) return slug;
  return DOC_SLUGS.has(p) ? p : undefined;
}

/** Tailwind's own variables → docs page. */
const VARIABLE_DOCS: [RegExp, string][] = [
  [/^--tw-font-weight/, "font-weight"],
  [/^--tw-leading/, "line-height"],
  [/^--tw-tracking/, "letter-spacing"],
  [/^--tw-(ordinal|slashed-zero|numeric)/, "font-variant-numeric"],
  [/^--tw-duration/, "transition-duration"],
  [/^--tw-ease/, "transition-timing-function"],
  [/^--tw-scroll-snap/, "scroll-snap-type"],
  [/^--tw-border-spacing/, "border-spacing"],
  [/^--tw-translate/, "translate"],
  [/^--tw-rotate/, "rotate"],
  [/^--tw-scale/, "scale"],
  [/^--tw-skew/, "skew"],
  [/^--tw-content/, "content"],
  [/^--tw-gradient/, "background-image"],
  [/^--tw-outline-style/, "outline-style"],
  [/^--tw-border-style/, "border-style"],
];

/** The docs page of a utility. */
export function docFor(u: Pick<Utility, "cls" | "css">): DocPage | undefined {
  const page = (slug: string) => DOCS.find((d) => d.slug === slug);
  for (const [re, slug] of CLASS_DOCS) {
    const m = u.cls.match(re);
    if (m) return page(slug.replace("$1", m[1] ?? ""));
  }
  const decls = declarations(u.css);
  // `border-inline-style: var(--tw-border-style)` comes with every border width: look at real values first.
  const ordered = [...decls.filter(([, v]) => !composed(v)), ...decls.filter(([, v]) => composed(v))];
  for (const [prop] of ordered) {
    if (prop.startsWith("--")) continue;
    const slug = propertyDoc(prop);
    if (slug) return page(slug);
  }
  for (const [prop] of decls) {
    for (const [re, slug] of VARIABLE_DOCS) if (re.test(prop)) return page(slug);
  }
  return undefined;
}

export const GROUP_STYLE: Record<string, { icon: string; tint: Color }> = {
  "Layout": { icon: "bs-layers", tint: "blue" },
  "Flexbox & Grid": { icon: "bs-apps", tint: "teal" },
  "Spacing": { icon: "bs-square", tint: "green" },
  "Sizing": { icon: "bs-monitor", tint: "green" },
  "Typography": { icon: "bs-font", tint: "purple" },
  "Backgrounds": { icon: "bs-image", tint: "orange" },
  "Borders": { icon: "bs-square", tint: "yellow" },
  "Effects": { icon: "bs-sparkle", tint: "pink" },
  "Filters": { icon: "bs-eye", tint: "pink" },
  "Tables": { icon: "bs-kanban", tint: "gray" },
  "Transitions & Animation": { icon: "bs-activity", tint: "red" },
  "Transforms": { icon: "bs-cycle", tint: "red" },
  "Interactivity": { icon: "bs-mouse", tint: "blue" },
  "SVG": { icon: "bs-palette", tint: "orange" },
  "Accessibility": { icon: "bs-eye", tint: "gray" },
  "Core Concepts": { icon: "bs-book", tint: "blue" },
  "Getting Started": { icon: "bs-rocket", tint: "green" },
  "Base Styles": { icon: "bs-file", tint: "gray" },
};

export const groupStyle = (group?: string) => GROUP_STYLE[group ?? ""] ?? { icon: "bs-code", tint: "gray" as Color };

// ---------------------------------------------------------------------------
// Search

export interface Indexed extends Utility {
  /** CSS and resolved CSS, lowercased, for matching properties and values. */
  hay: string;
  doc?: DocPage;
}

export function index(utilities: Utility[], theme: Map<string, string>): Indexed[] {
  return utilities.map((u) => {
    const doc = docFor(u);
    const resolved = resolve(u.css, theme);
    const pixels = [...resolved.matchAll(/(-?[\d.]+rem)\b/g)].map((m) => px(m[1])).join(" ");
    const hay = `${u.css}\n${resolved}\n${pixels}\n${doc?.title ?? ""} ${doc?.keywords?.join(" ") ?? ""}`
      .toLowerCase();
    return { ...u, hay, doc };
  });
}

/** `.p-4`, `hover:p-4`, `!p-4`, `p-4!` → `p-4`. */
export const normalizeQuery = (q: string) =>
  q.trim().toLowerCase().replace(/^!|!$/g, "").replace(/^\./, "").replace(/^([\w-]+:)+/, "").replace(/^!/, "");

/** Best utilities for a query: exact class, then prefix, then substring, then CSS and docs matches. */
export function search(all: Indexed[], query: string, limit = 60): Indexed[] {
  const q = normalizeQuery(query);
  if (!q) return [];
  const words = q.split(/\s+/);
  const scored: [number, Indexed][] = [];
  for (const u of all) {
    let score = 0;
    if (words.length === 1) {
      if (u.cls === q) score = 10000;
      else if (u.cls.startsWith(q)) score = 5000 - u.cls.length * 10;
      else if (u.doc && (u.doc.slug === q || u.doc.title === q)) score = 4000 - u.cls.length * 10;
      else if (u.cls.includes(q)) score = 3000 - u.cls.length * 10;
      else if (u.hay.includes(q)) score = 1000 - u.cls.length * 10;
    } else if (words.every((w) => u.cls.includes(w) || u.hay.includes(w))) {
      score = 1000 - u.cls.length * 10 + words.filter((w) => u.cls.includes(w)).length * 500;
    }
    if (score) scored.push([score - (u.color ? 50 : 0), u]);
  }
  scored.sort((a, b) => b[0] - a[0] || naturalCompare(a[1].cls, b[1].cls));
  return scored.slice(0, limit).map(([, u]) => u);
}

/** `p-2` before `p-10`. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true });
}

export const POPULAR = [
  "flex",
  "grid",
  "hidden",
  "items-center",
  "justify-between",
  "gap-4",
  "p-4",
  "px-4",
  "mx-auto",
  "w-full",
  "h-screen",
  "max-w-7xl",
  "text-sm",
  "text-lg",
  "font-semibold",
  "text-center",
  "truncate",
  "bg-white",
  "text-gray-900",
  "rounded-lg",
  "border",
  "shadow-md",
  "ring-2",
  "opacity-50",
  "transition",
  "duration-300",
  "absolute",
  "relative",
  "inset-0",
  "z-10",
  "overflow-hidden",
  "cursor-pointer",
  "sr-only",
];

// ---------------------------------------------------------------------------
// Colors

export interface RGB {
  r: number;
  g: number;
  b: number;
}

/** `oklch(63.7% 0.237 25.331)` → its parts. */
export function parseOklch(text: string): { l: number; c: number; h: number } | undefined {
  const m = text.match(/^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)\s*\)$/);
  if (!m) return undefined;
  return { l: parseFloat(m[1]) / (m[2] ? 100 : 1), c: parseFloat(m[3]), h: parseFloat(m[4]) };
}

/** OKLCH → sRGB (0–255), clipped to the sRGB gamut like browsers do for #hex fallbacks. */
export function oklchToRgb({ l, c, h }: { l: number; c: number; h: number }): RGB {
  const hr = (h * Math.PI) / 180;
  const a = c * Math.cos(hr);
  const b = c * Math.sin(hr);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  const gamma = (x: number) => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
  const [r, g, bb] = lin.map((x) => Math.round(Math.min(1, Math.max(0, gamma(x))) * 255));
  return { r, g, b: bb };
}

export const toHex = ({ r, g, b }: RGB) => "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");

/** `#fff` / `#000` (black and white) or `oklch(…)` → hex. */
export function colorHex(value: string): string {
  if (/^#[0-9a-f]{3}$/i.test(value)) return "#" + [...value.slice(1)].map((x) => x + x).join("").toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const o = parseOklch(value);
  return o ? toHex(oklchToRgb(o)) : "#000000";
}

export interface PaletteColor {
  /** "red-500", "black". */
  name: string;
  family: string;
  shade?: string;
  value: string;
  hex: string;
}

export function palette(data: Data): PaletteColor[] {
  const theme = new Map(data.theme);
  const out: PaletteColor[] = [];
  for (const family of data.colors) {
    for (const shade of SHADES) {
      const value = theme.get(`--color-${family}-${shade}`);
      if (value) out.push({ name: `${family}-${shade}`, family, shade, value, hex: colorHex(value) });
    }
  }
  for (const name of ["black", "white"]) {
    const value = theme.get(`--color-${name}`) ?? "";
    out.push({ name, family: name, value, hex: colorHex(value) });
  }
  return out;
}

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The utilities that take a color, most used first. */
export const COLOR_PREFIXES = [
  "bg",
  "text",
  "border",
  "ring",
  "outline",
  "fill",
  "stroke",
  "from",
  "via",
  "to",
  "shadow",
  "divide",
  "decoration",
  "accent",
  "caret",
  "placeholder",
];
