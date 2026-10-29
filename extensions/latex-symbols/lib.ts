// Pure logic of the LaTeX Symbols extension: categories, search ranking and the
// text forms of a symbol. No I/O here; the table itself is in symbols.ts.

export type Category =
  | "greek"
  | "operators"
  | "relations"
  | "arrows"
  | "logic"
  | "delimiters"
  | "accents"
  | "letters";

export interface LatexSymbol {
  /** With the backslash: `\alpha`, `\mathbb{R}`. */
  command: string;
  /** The Unicode character; a combining mark for accents. */
  char: string;
  /** "" when LaTeX has it without a package. */
  package: string;
  category: Category;
  /** Words it is known by, the command's own name first. */
  names: string[];
  /** What the tile shows when the character can't stand alone (accents on a letter). */
  preview?: string;
}

export const CATEGORIES: { value: Category | "all"; title: string }[] = [
  { value: "all", title: "All" },
  { value: "greek", title: "Greek" },
  { value: "operators", title: "Operators" },
  { value: "relations", title: "Relations" },
  { value: "arrows", title: "Arrows" },
  { value: "logic", title: "Logic & Misc" },
  { value: "delimiters", title: "Delimiters" },
  { value: "accents", title: "Accents" },
  { value: "letters", title: "Letters" },
];

export const categoryTitle = (c: Category) => CATEGORIES.find((x) => x.value === c)?.title ?? c;

/** `α` → `U+03B1`; several code points are joined by spaces. */
export function codePoint(char: string): string {
  return [...char].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(" ");
}

/** `α` style escapes for JavaScript, Python or JSON (astral characters as surrogate pairs). */
export function jsEscape(char: string): string {
  return [...char].map((c) => {
    const cp = c.codePointAt(0)!;
    if (cp <= 0xffff) return `\\u${cp.toString(16).padStart(4, "0")}`;
    return `\\u{${cp.toString(16)}}`;
  }).join("");
}

/** `&#x3B1;`. */
export const htmlEntity = (char: string) =>
  [...char].map((c) => `&#x${c.codePointAt(0)!.toString(16).toUpperCase()};`).join("");

/** The line to put in the preamble, or undefined when none is needed. */
export const usePackage = (s: Pick<LatexSymbol, "package">) => s.package ? `\\usepackage{${s.package}}` : undefined;

/** What is shown and copied as "the character". */
export const display = (s: LatexSymbol) => s.preview ?? s.char;

/** The command with an argument placeholder where it takes one: `\hat{}`. */
export const template = (s: LatexSymbol) => s.category === "accents" ? `${s.command}{}` : s.command;

const HEX = /^(?:u\+?|0x|\\u\{?)?([0-9a-f]{4,6})\}?$/i;

/**
 * Ranks symbols for a query: the character itself, then the exact command
 * (case matters: `\Delta` before `\delta`), command prefixes (shortest
 * first), name words, a code point, then command substrings. At most `limit`.
 */
export function searchSymbols(
  symbols: LatexSymbol[],
  query: string,
  category: Category | "all" = "all",
  limit = 400,
): LatexSymbol[] {
  const pool = category === "all" ? symbols : symbols.filter((s) => s.category === category);
  const q = query.trim();
  if (!q) return pool.slice(0, limit);
  const bare = q.replace(/^\\/, "");
  const lower = bare.toLowerCase();
  const words = lower.split(/[\s{}]+/).filter(Boolean);
  const hex = HEX.exec(q)?.[1]?.toLowerCase();

  const score = (s: LatexSymbol): number => {
    if (q === s.char || q === s.preview) return 0;
    const cmd = s.command.slice(1);
    if (cmd === bare) return 1;
    const cmdLower = cmd.toLowerCase();
    if (cmdLower === lower) return 2;
    if (cmd.startsWith(bare)) return 3 + cmd.length / 100;
    if (cmdLower.startsWith(lower)) return 4 + cmd.length / 100;
    if (hex && [...s.char].some((c) => c.codePointAt(0)!.toString(16) === hex.replace(/^0+(?=.)/, ""))) return 5;
    const text = `${s.names.join(" ")} ${cmdLower} ${s.package}`.toLowerCase();
    const tokens = text.split(/[\s{}\\]+/);
    if (words.every((w) => tokens.some((t) => t.startsWith(w)))) return 6;
    if (cmdLower.includes(lower)) return 7;
    if (words.every((w) => text.includes(w))) return 8;
    return Infinity;
  };

  return pool
    .map((s, i) => ({ s, i, score: score(s) }))
    .filter((x) => x.score !== Infinity)
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.s);
}

/** Most recent first, without duplicates, at most `max`. */
export function remember(recent: string[], command: string, max = 24): string[] {
  return [command, ...recent.filter((c) => c !== command)].slice(0, max);
}

/** How many symbols each category has, `all` included. */
export function countByCategory(symbols: LatexSymbol[]): Record<Category | "all", number> {
  const out = Object.fromEntries(CATEGORIES.map((c) => [c.value, 0])) as Record<Category | "all", number>;
  for (const s of symbols) {
    out[s.category]++;
    out.all++;
  }
  return out;
}
