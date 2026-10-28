// Pure logic of the Icon Search extension: icon sets, their index files, search and SVG helpers.

import type { Color } from "@backslash/api";

export type SetId = "lucide" | "material" | "tabler" | "heroicons" | "phosphor" | "simple";

export interface IconSet {
  id: SetId;
  title: string;
  /** npm package whose files jsDelivr serves. */
  pkg: string;
  version: string;
  /** The index file in the package, if it has one. */
  index?: string;
  license: string;
  site: string;
  tint: Color;
}

const CDN = "https://cdn.jsdelivr.net/npm";

export const SETS: IconSet[] = [
  {
    id: "lucide",
    title: "Lucide",
    pkg: "lucide-static",
    version: "latest",
    index: "tags.json",
    license: "ISC",
    site: "https://lucide.dev/icons/",
    tint: "pink",
  },
  {
    id: "material",
    title: "Material Symbols",
    pkg: "@material-symbols/svg-400",
    version: "latest",
    license: "Apache-2.0",
    site: "https://fonts.google.com/icons",
    tint: "blue",
  },
  {
    id: "tabler",
    title: "Tabler",
    pkg: "@tabler/icons",
    version: "latest",
    index: "icons.json",
    license: "MIT",
    site: "https://tabler.io/icons",
    tint: "teal",
  },
  {
    id: "heroicons",
    title: "Heroicons",
    pkg: "heroicons",
    version: "2.2.0",
    license: "MIT",
    site: "https://heroicons.com",
    tint: "purple",
  },
  {
    id: "phosphor",
    title: "Phosphor",
    pkg: "@phosphor-icons/core",
    version: "latest",
    index: "dist/index.mjs",
    license: "MIT",
    site: "https://phosphoricons.com",
    tint: "green",
  },
  {
    id: "simple",
    title: "Simple Icons",
    pkg: "simple-icons",
    version: "latest",
    index: "data/simple-icons.json",
    license: "CC0-1.0",
    site: "https://simpleicons.org",
    tint: "orange",
  },
];

export const setOf = (id: string) => SETS.find((s) => s.id === id);

/** Material Symbols' names come from the font package's typings, published with the SVGs. */
export const MATERIAL_NAMES_URL = `${CDN}/material-symbols@latest/index.d.ts`;

export const fileUrl = (set: IconSet, path: string) => `${CDN}/${set.pkg}@${set.version}/${path}`;

export interface Icon {
  set: SetId;
  /** File name without .svg: `camera`, `photo_camera`, `github`. */
  name: string;
  /** Brand name for Simple Icons ("GitHub"). */
  title?: string;
  tags: string[];
  category?: string;
  /** The React component name when the set says it (Phosphor). */
  pascal?: string;
  /** Brand color, Simple Icons only. */
  hex?: string;
  /** Tabler: whether a filled version exists. */
  filled?: boolean;
}

// ---------------------------------------------------------------------------
// Index files

/** lucide-static/tags.json: `{ "camera": ["photo", "webcam", …] }`. */
export function parseLucide(json: Record<string, string[]>): Icon[] {
  return Object.entries(json).map(([name, tags]) => ({ set: "lucide", name, tags: tags ?? [] }));
}

/** @tabler/icons/icons.json: `{ "camera": { name, category, tags, styles: { outline, filled } } }`. */
export function parseTabler(json: Record<string, any>): Icon[] {
  return Object.values(json).filter((i) => i?.name && (!i.styles || i.styles.outline)).map((i) => ({
    set: "tabler" as const,
    name: i.name,
    tags: (i.tags ?? []).map(String),
    ...(i.category ? { category: i.category } : {}),
    ...(i.styles?.filled ? { filled: true } : {}),
  }));
}

/** simple-icons/data/simple-icons.json: `[{ title, slug, hex, aliases }]`. */
export function parseSimple(json: any[]): Icon[] {
  return json.filter((i) => i?.title).map((i) => ({
    set: "simple" as const,
    name: i.slug ?? titleToSlug(i.title),
    title: i.title,
    tags: [
      ...(i.aliases?.aka ?? []),
      ...Object.values(i.aliases?.dup ?? {}).map((d: any) => d.title ?? "").filter(Boolean),
      ...Object.values(i.aliases?.loc ?? {}),
    ].map(String),
    hex: `#${String(i.hex ?? "000000").toLowerCase()}`,
  }));
}

/** Simple Icons' own slug rule, for older data files without `slug`. */
export function titleToSlug(title: string): string {
  const replacements: Record<string, string> = { "+": "plus", ".": "dot", "&": "and" };
  return title.toLowerCase()
    .replace(/[+.&]/g, (c) => replacements[c])
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/** material-symbols/index.d.ts: `type MaterialSymbols = ["123", "360", "10k", …]`. */
export function parseMaterial(dts: string): Icon[] {
  const names = [...new Set([...dts.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]))];
  return names.map((name) => ({ set: "material", name, tags: name.split("_") }));
}

/** @phosphor-icons/core/dist/index.mjs: `{ name: "acorn", pascal_name: "Acorn", categories: [e.FINANCE], tags: [...] }`. */
export function parsePhosphor(js: string): Icon[] {
  // The category enums: `e = /* @__PURE__ */ ((i) => (i.MEDIA = "media", …))(e || {})`.
  const enums: Record<string, Record<string, string>> = {};
  for (const m of js.matchAll(/(\w+)\s*=\s*\/\*\s*@__PURE__\s*\*\/\s*\(\(\w+\)\s*=>\s*\(([\s\S]*?)\)\)\(/g)) {
    enums[m[1]] = Object.fromEntries([...m[2].matchAll(/\.(\w+)\s*=\s*"([^"]*)"/g)].map((x) => [x[1], x[2]]));
  }
  const out: Icon[] = [];
  const re =
    /name:\s*"([^"]+)",\s*pascal_name:\s*"([^"]+)",\s*(?:alias:[\s\S]*?,\s*)?categories:\s*\[([^\]]*)\][\s\S]*?tags:\s*\[([^\]]*)\]/g;
  for (const m of js.matchAll(re)) {
    const tags = [...m[4].matchAll(/"([^"]*)"/g)].map((t) => t[1]).filter((t) => !t.startsWith("*"));
    const [owner, key] = (m[3].split(",")[0] ?? "").trim().split(".");
    const category = key ? enums[owner]?.[key] ?? key.toLowerCase().replace(/_/g, " ") : undefined;
    out.push({ set: "phosphor", name: m[1], pascal: m[2], tags, ...(category ? { category } : {}) });
  }
  return out;
}

export function parseHeroicons(names: string[]): Icon[] {
  return names.map((name) => ({ set: "heroicons", name, tags: [] }));
}

// ---------------------------------------------------------------------------
// Files and names

/** The SVG shown and copied by default. */
export function svgPath(icon: Icon): string {
  switch (icon.set) {
    case "lucide":
      return `icons/${icon.name}.svg`;
    case "material":
      return `outlined/${icon.name}.svg`;
    case "tabler":
      return `icons/outline/${icon.name}.svg`;
    case "heroicons":
      return `24/outline/${icon.name}.svg`;
    case "phosphor":
      return `assets/regular/${icon.name}.svg`;
    case "simple":
      return `icons/${icon.name}.svg`;
  }
}

/** The other styles of an icon: [title, path in the package]. */
export function variants(icon: Icon): [string, string][] {
  const n = icon.name;
  switch (icon.set) {
    case "material":
      return [
        ["Outlined", `outlined/${n}.svg`],
        ["Outlined, Filled", `outlined/${n}-fill.svg`],
        ["Rounded", `rounded/${n}.svg`],
        ["Rounded, Filled", `rounded/${n}-fill.svg`],
        ["Sharp", `sharp/${n}.svg`],
        ["Sharp, Filled", `sharp/${n}-fill.svg`],
      ];
    case "tabler":
      return [["Outline", `icons/outline/${n}.svg`], ...(icon.filled ? [["Filled", `icons/filled/${n}.svg`]] : [])] as [
        string,
        string,
      ][];
    case "heroicons":
      return [
        ["Outline 24", `24/outline/${n}.svg`],
        ["Solid 24", `24/solid/${n}.svg`],
        ["Mini 20", `20/solid/${n}.svg`],
        ["Micro 16", `16/solid/${n}.svg`],
      ];
    case "phosphor":
      return ["thin", "light", "regular", "bold", "fill", "duotone"].map((w) => [
        w[0].toUpperCase() + w.slice(1),
        `assets/${w}/${n}${w === "regular" ? "" : `-${w}`}.svg`,
      ]);
    default:
      return [["Default", svgPath(icon)]];
  }
}

/** `arrow-down-0-1` → `ArrowDown01`, `photo_camera` → `PhotoCamera`. */
export const pascal = (name: string) =>
  name.split(/[-_\s]+/).filter(Boolean).map((p) => p[0].toUpperCase() + p.slice(1)).join("");

/** The component name and its import, in each set's React package. */
export function react(icon: Icon): { component: string; importLine: string } | undefined {
  switch (icon.set) {
    case "lucide": {
      const c = pascal(icon.name);
      return { component: c, importLine: `import { ${c} } from "lucide-react";` };
    }
    case "tabler": {
      const c = `Icon${pascal(icon.name)}`;
      return { component: c, importLine: `import { ${c} } from "@tabler/icons-react";` };
    }
    case "heroicons": {
      const c = `${pascal(icon.name)}Icon`;
      return { component: c, importLine: `import { ${c} } from "@heroicons/react/24/outline";` };
    }
    case "phosphor": {
      const c = icon.pascal ?? pascal(icon.name);
      return { component: c, importLine: `import { ${c} } from "@phosphor-icons/react";` };
    }
    case "simple": {
      const c = `Si${icon.name[0].toUpperCase()}${icon.name.slice(1)}`;
      return { component: c, importLine: `import { ${c} } from "@icons-pack/react-simple-icons";` };
    }
    default:
      return undefined;
  }
}

/** Material Symbols are used through their font. */
export const materialHtml = (name: string) => `<span class="material-symbols-outlined">${name}</span>`;

export function pageUrl(icon: Icon): string {
  const n = encodeURIComponent(icon.name);
  switch (icon.set) {
    case "lucide":
      return `https://lucide.dev/icons/${n}`;
    case "material":
      return `https://fonts.google.com/icons?selected=Material+Symbols+Outlined:${n}`;
    case "tabler":
      return `https://tabler.io/icons/icon/${n}`;
    case "heroicons":
      return "https://heroicons.com/outline";
    case "phosphor":
      return `https://phosphoricons.com/?q=${n}`;
    case "simple":
      return `https://simpleicons.org/?q=${n}`;
  }
}

/** A readable name: `photo_camera` → "photo camera". */
export const label = (icon: Icon) => icon.title ?? icon.name.replace(/[-_]/g, " ");

// ---------------------------------------------------------------------------
// SVG

/** Strips comments and XML prologs, so what is copied starts with `<svg`. */
export const cleanSvg = (svg: string) => svg.replace(/<\?xml[^>]*>/g, "").replace(/<!--[\s\S]*?-->/g, "").trim();

/**
 * The SVG drawn in the launcher: currentColor (and the default black fill)
 * replaced by a color visible on light and dark themes, rendered big enough
 * for the preview to be crisp.
 */
export function viewSvg(svg: string, color: string, size = 256): string {
  const clean = cleanSvg(svg).replaceAll("currentColor", color);
  return clean.replace(/<svg\b([^>]*)>/, (_, attrs: string) => {
    let a = attrs.replace(/\s(width|height)="[^"]*"/g, "");
    if (!/\sfill="/.test(a)) a += ` fill="${color}"`;
    return `<svg${a} width="${size}" height="${size}">`;
  });
}

/** Relative luminance (0–1) of `#rrggbb`. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

/** Brands in their color unless it would vanish on a dark or light background. */
export function displayColor(icon: Icon, neutral = "#8e8e96"): string {
  if (!icon.hex) return neutral;
  const l = luminance(icon.hex);
  return l < 0.03 || l > 0.85 ? neutral : icon.hex;
}

/** `data:image/svg+xml;base64,…`, for CSS and <img src>. */
export function dataUri(svg: string): string {
  const bytes = new TextEncoder().encode(cleanSvg(svg));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

// ---------------------------------------------------------------------------
// Search

const tokens = (s: string) => s.toLowerCase().split(/[-_\s]+/).filter(Boolean);

/** Score of an icon for a query; 0 when it doesn't match. */
export function score(icon: Icon, query: string): number {
  const q = query.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return 1;
  const name = icon.name.toLowerCase();
  const title = icon.title?.toLowerCase();
  const joined = q.replace(/[\s_]+/g, "-");
  const under = q.replace(/[\s-]+/g, "_");
  if (name === joined || name === under || title === q) return 1000;
  if (name.startsWith(joined) || name.startsWith(under) || title?.startsWith(q)) return 800 - name.length;
  const words = tokens(q);
  const nameWords = tokens(icon.name);
  if (words.every((w) => nameWords.some((n) => n.startsWith(w)))) return 600 - name.length;
  if (name.includes(joined) || name.includes(under) || title?.includes(q)) return 400 - name.length;
  const tags = icon.tags.map((t) => t.toLowerCase());
  if (tags.includes(q)) return 300 - name.length;
  if (words.every((w) => tags.some((t) => t.includes(w)) || nameWords.some((n) => n.startsWith(w)))) {
    return 150 - name.length;
  }
  if (icon.category && icon.category.toLowerCase().includes(q)) return 50;
  return 0;
}

export function search(icons: Icon[], query: string, limit: number): Icon[] {
  if (!query.trim()) return icons.slice(0, limit);
  const scored: [number, Icon][] = [];
  for (const i of icons) {
    const s = score(i, query);
    if (s > 0) scored.push([s, i]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].name.localeCompare(b[1].name));
  return scored.slice(0, limit).map(([, i]) => i);
}
