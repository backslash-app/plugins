// Pure logic of the Nerd Font Icons extension: the glyph list, search,
// sets and the text forms of a glyph. No I/O here.

export const GLYPHNAMES_URL = "https://raw.githubusercontent.com/ryanoasis/nerd-fonts/master/glyphnames.json";

/** `[name without nf-, hex code]`, e.g. `["md-folder_open", "f0770"]`. */
export type Glyph = [string, string];

// A type alias (not an interface) so that it is plain JSON for storage.
export type GlyphData = {
  version: string;
  fetched: number;
  glyphs: Glyph[];
};

/** Reads the official glyphnames.json into a compact list. */
export function parseGlyphnames(json: string, now = Date.now()): GlyphData {
  const data = JSON.parse(json) as Record<string, { char?: string; code?: string; version?: string }>;
  const version = String((data.METADATA as { version?: string } | undefined)?.version ?? "");
  const glyphs: Glyph[] = [];
  for (const [name, g] of Object.entries(data)) {
    if (name === "METADATA" || !g || typeof g.code !== "string" || !/^[0-9a-f]{4,6}$/i.test(g.code)) continue;
    glyphs.push([name, g.code.toLowerCase()]);
  }
  if (glyphs.length < 100) throw new Error("glyphnames.json looks incomplete");
  return { version, fetched: now, glyphs };
}

export function isGlyphData(v: unknown): v is GlyphData {
  const d = v as GlyphData;
  return !!d && typeof d === "object" && Array.isArray(d.glyphs) && d.glyphs.length > 0 &&
    typeof d.fetched === "number";
}

/** Refreshed monthly: Nerd Fonts releases a few times a year. */
export const STALE_AFTER = 30 * 86400 * 1000;

// --- Sets ---------------------------------------------------------------------------

export interface GlyphSet {
  value: string;
  title: string;
  prefixes: string[];
}

export const SETS: GlyphSet[] = [
  { value: "all", title: "All", prefixes: [] },
  { value: "md", title: "Material", prefixes: ["md"] },
  { value: "fa", title: "Font Awesome", prefixes: ["fa", "fae"] },
  { value: "dev", title: "Devicons", prefixes: ["dev"] },
  { value: "cod", title: "Codicons", prefixes: ["cod"] },
  { value: "oct", title: "Octicons", prefixes: ["oct"] },
  { value: "linux", title: "Logos", prefixes: ["linux"] },
  { value: "seti", title: "Seti", prefixes: ["seti", "custom"] },
  { value: "weather", title: "Weather", prefixes: ["weather"] },
  { value: "pl", title: "Powerline", prefixes: ["pl", "ple", "iec", "indent", "indentation", "extra", "pom"] },
];

export const SET_NAMES: Record<string, string> = {
  md: "Material Design",
  fa: "Font Awesome",
  fae: "Font Awesome Extension",
  dev: "Devicons",
  cod: "Codicons",
  oct: "Octicons",
  linux: "Font Logos",
  seti: "Seti UI",
  custom: "Seti UI + Custom",
  weather: "Weather Icons",
  pl: "Powerline",
  ple: "Powerline Extra",
  iec: "IEC Power Symbols",
  indent: "Indent",
  indentation: "Indent",
  extra: "Extra",
  pom: "Pomicons",
};

export const prefixOf = (name: string) => name.split("-")[0];

export function inSet(name: string, set: string | undefined): boolean {
  const s = SETS.find((x) => x.value === set);
  return !s || !s.prefixes.length || s.prefixes.includes(prefixOf(name));
}

// --- Text forms ------------------------------------------------------------------------

export const charOf = (code: string) => String.fromCodePoint(parseInt(code, 16));
export const className = (name: string) => `nf-${name}`;
export const codePoint = (code: string) => `U+${code.toUpperCase()}`;
export const htmlEntity = (code: string) => `&#x${code};`;
export const cssContent = (code: string) => `\\${code}`;
/** ``, or `\u{f0770}` beyond the BMP (JavaScript, Rust, Python 3 use their own forms). */
export const jsEscape = (code: string) => code.length > 4 ? `\\u{${code}}` : `\\u${code}`;

/** `md-folder_open` → `folder open`. */
export const shortTitle = (name: string) => name.slice(name.indexOf("-") + 1).replace(/_/g, " ");

// --- Search ------------------------------------------------------------------------------

/**
 * Finds glyphs by name words (`folder open`, `nf-md-folder`), by code point
 * (`f07c`, `U+F07C`, ``) or by the glyph itself. Best matches first.
 */
export function searchGlyphs(glyphs: Glyph[], query: string, set?: string, limit = 240): Glyph[] {
  const q = query.trim().toLowerCase().replace(/^nf-/, "");
  if (!q) return glyphs.filter((g) => inSet(g[0], set)).slice(0, limit);

  // The glyph itself, pasted.
  const chars = [...q];
  if (chars.length === 1 && q.codePointAt(0)! >= 0xe000) {
    const code = q.codePointAt(0)!.toString(16);
    return glyphs.filter((g) => g[1] === code);
  }
  const hex = /^(?:u\+|\\u\{?|0x|&#x)?([0-9a-f]{4,6})\}?;?$/.exec(q)?.[1];

  const tokens = q.split(/[\s_\-]+/).filter(Boolean);
  const scored: { g: Glyph; score: number }[] = [];
  for (const g of glyphs) {
    if (!inSet(g[0], set)) continue;
    const name = g[0];
    if (hex && g[1] === hex) {
      scored.push({ g, score: -1 });
      continue;
    }
    const bare = name.slice(name.indexOf("-") + 1);
    const words = name.split(/[-_]/);
    let score: number;
    if (name === q || bare === q.replace(/ /g, "_")) score = 0;
    else if (bare.startsWith(q.replace(/ /g, "_"))) score = 1;
    else {
      // Every token must start a word (best) or appear in the name.
      let total = 2;
      let ok = true;
      for (const t of tokens) {
        if (words.some((w) => w === t)) continue;
        if (words.some((w) => w.startsWith(t))) total += 1;
        else if (name.includes(t)) total += 3;
        else {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      score = total;
    }
    scored.push({ g, score });
  }
  scored.sort((a, b) => a.score - b.score || a.g[0].length - b.g[0].length || a.g[0].localeCompare(b.g[0]));
  return scored.slice(0, limit).map((s) => s.g);
}

/** Counts per set, for the status line. */
export function countBySet(glyphs: Glyph[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of SETS) out[s.value] = 0;
  for (const g of glyphs) {
    for (const s of SETS) if (s.value === "all" || s.prefixes.includes(prefixOf(g[0]))) out[s.value]++;
  }
  return out;
}

/** Most recent first, no duplicates, at most `max`. */
export function remember(recent: string[], name: string, max = 24): string[] {
  return [name, ...recent.filter((n) => n !== name)].slice(0, max);
}
