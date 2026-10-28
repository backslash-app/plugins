// Pure helpers for the Fonts extension: fc-list parsing, grouping and naming.

/** One font file as fc-list describes it. */
export interface FontFace {
  family: string;
  style: string;
  file: string;
  /** fontconfig spacing: 0 proportional, 90 dual width, 100 monospace, 110 charcell. */
  spacing?: number;
}

/** All the faces of one family. */
export interface Family {
  name: string;
  styles: string[];
  files: string[];
  mono: boolean;
  /** Installed in the user's own font folder. */
  user: boolean;
  /** Formats of its files, e.g. ["TTF", "OTF"]. */
  formats: string[];
}

/** The `fc-list --format` that {@link parseFcList} reads: first family and style, file, spacing. */
export const FC_FORMAT = "%{family[0]}\\t%{style[0]}\\t%{file}\\t%{spacing}\\n";

/** Files fontconfig can install, by extension. */
export const FONT_EXTENSIONS = ["ttf", "otf", "ttc", "otc", "woff", "woff2", "pfb", "pcf", "bdf"];

export function parseFcList(out: string): FontFace[] {
  const faces: FontFace[] = [];
  for (const line of out.split("\n")) {
    const [family, style, file, spacing] = line.split("\t");
    if (!family?.trim() || !file?.trim()) continue;
    const n = Number(spacing);
    faces.push({
      family: family.trim(),
      style: style?.trim() || "Regular",
      file: file.trim(),
      spacing: spacing?.trim() && Number.isFinite(n) ? n : undefined,
    });
  }
  return faces;
}

/** Usual order of styles: weights from thin to black, upright before italic. */
const WEIGHTS = [
  "thin",
  "hairline",
  "extralight",
  "ultralight",
  "light",
  "book",
  "regular",
  "normal",
  "roman",
  "medium",
  "semibold",
  "demibold",
  "bold",
  "extrabold",
  "ultrabold",
  "black",
  "heavy",
];

export function styleRank(style: string): number {
  const s = style.toLowerCase().replace(/[\s-]/g, "");
  const italic = /italic|oblique/.test(s) ? 0.5 : 0;
  const condensed = /condensed|narrow/.test(s) ? 100 : 0;
  const bare = s.replace(/italic|oblique|condensed|narrow/g, "");
  let weight = WEIGHTS.indexOf(bare || "regular");
  if (weight < 0) weight = WEIGHTS.findIndex((w) => bare.startsWith(w));
  if (weight < 0) weight = WEIGHTS.indexOf("regular");
  return condensed + weight + italic;
}

export function sortStyles(styles: string[]): string[] {
  return [...styles].sort((a, b) => styleRank(a) - styleRank(b) || a.localeCompare(b));
}

const isMono = (spacing?: number) => spacing === 90 || spacing === 100 || spacing === 110;

export function fileFormat(file: string): string {
  return (file.split(".").pop() ?? "").toUpperCase();
}

/** Faces grouped into families, sorted by name. `userDirs` are the folders the user installs fonts into. */
export function groupFamilies(faces: FontFace[], userDirs: string[] = []): Family[] {
  const map = new Map<string, Family>();
  for (const f of faces) {
    let fam = map.get(f.family);
    if (!fam) {
      fam = { name: f.family, styles: [], files: [], mono: false, user: false, formats: [] };
      map.set(f.family, fam);
    }
    if (!fam.styles.includes(f.style)) fam.styles.push(f.style);
    if (!fam.files.includes(f.file)) fam.files.push(f.file);
    const format = fileFormat(f.file);
    if (format && !fam.formats.includes(format)) fam.formats.push(format);
    if (isMono(f.spacing)) fam.mono = true;
    if (userDirs.some((d) => f.file.startsWith(d.endsWith("/") ? d : d + "/"))) fam.user = true;
  }
  return [...map.values()]
    .map((f) => ({ ...f, styles: sortStyles(f.styles), files: f.files.sort() }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** The style to preview: Regular when there is one. */
export function regularStyle(styles: string[]): string {
  return styles.find((s) => /^(regular|normal|book|roman)$/i.test(s)) ?? sortStyles(styles)[0] ?? "Regular";
}

/** The file of a family's regular face, for renderers that take a file. */
export function regularFile(faces: FontFace[], family: string): string | undefined {
  const own = faces.filter((f) => f.family === family);
  const style = regularStyle(own.map((f) => f.style));
  return own.find((f) => f.style === style)?.file ?? own[0]?.file;
}

const GENERIC = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

/** `font-family: "Fira Code", monospace;` */
export function cssFontFamily(name: string, mono: boolean): string {
  const quoted = GENERIC.has(name.toLowerCase()) ? name : /^[A-Za-z][\w-]*$/.test(name) ? name : JSON.stringify(name);
  return `font-family: ${quoted}, ${
    mono ? "monospace" : /serif/i.test(name) && !/sans/i.test(name) ? "serif" : "sans-serif"
  };`;
}

/** A file name for the cached preview of a family. */
export function previewName(family: string): string {
  const slug = family.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "font";
  // A short hash keeps families that differ only by punctuation apart.
  let h = 0;
  for (const c of family) h = (h * 31 + c.codePointAt(0)!) >>> 0;
  return `${slug}-${h.toString(36)}.png`;
}

/** The pango font description of a family, safe for families whose name ends in a style word. */
export const pangoFont = (family: string, size: number) => `${family}, ${size}`;

export const SAMPLE = "The quick brown fox jumps over the lazy dog";
export const SAMPLE_EXTRA = "0123456789 ({[<>]}) &@#%?! àéîõü ß Ω";

/** A path typed in the search bar, with `~` and `file://` understood. */
export function expandPath(input: string, home: string): string {
  let p = input.trim().replace(/^["']|["']$/g, "");
  if (p.startsWith("file://")) p = decodeURIComponent(p.slice(7));
  if (p === "~" || p.startsWith("~/")) p = home + p.slice(1);
  return p;
}

export function isFontFile(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return path.includes("/") && FONT_EXTENSIONS.includes(ext);
}

export const basename = (p: string) => p.split("/").pop() ?? p;
export const dirname = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";

export function tilde(p: string, home: string): string {
  return home && (p === home || p.startsWith(home + "/")) ? "~" + p.slice(home.length) : p;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
