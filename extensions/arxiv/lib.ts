// arXiv's Atom answers, search queries, BibTeX and citations. Pure, tested in lib_test.ts.

export const API = "https://export.arxiv.org/api/query";

export interface Author {
  name: string;
  affiliation?: string;
}

export interface Paper {
  /** "2401.01234" or "hep-th/9901001", without the version. */
  id: string;
  /** 2 for "v2"; 1 when the address has none. */
  version: number;
  title: string;
  abstract: string;
  authors: Author[];
  /** ISO dates: first version, and this version. */
  published: string;
  updated: string;
  primaryCategory?: string;
  categories: string[];
  comment?: string;
  journalRef?: string;
  doi?: string;
}

export interface Feed {
  papers: Paper[];
  total: number;
}

// ---------------------------------------------------------------------------
// Atom

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** `&amp;`, `&#233;`, `&#x00e9;` and the five XML entities. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Spaces and line breaks of titles and abstracts folded into one space. */
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

/** The text of every `<tag …>…</tag>` directly in `xml` (namespaces prefixes included in `tag`). */
function texts(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return [...xml.matchAll(re)].map((m) => decodeEntities(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")));
}

const text = (xml: string, tag: string) => texts(xml, tag)[0];

/** The attributes of each self-closing or opening `<tag …>`. */
function attrs(xml: string, tag: string): Record<string, string>[] {
  const re = new RegExp(`<${tag}\\s([^>]*?)/?>`, "g");
  return [...xml.matchAll(re)].map((m) =>
    Object.fromEntries(
      [...m[1].matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map((a) => [a[1], decodeEntities(a[2] ?? a[3])]),
    )
  );
}

/** "http://arxiv.org/abs/2401.01234v2" → { id: "2401.01234", version: 2 }. */
export function parseId(raw: string): { id: string; version: number } | undefined {
  const m = raw.trim().match(
    /(?:arxiv\.org\/(?:abs|pdf)\/|arxiv:)?((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(?:v(\d+))?(?:\.pdf)?$/i,
  );
  if (!m) return undefined;
  return { id: m[1], version: m[2] ? Number(m[2]) : 1 };
}

function parseEntry(entry: string): Paper | undefined {
  const ident = parseId(text(entry, "id") ?? "");
  if (!ident) return undefined;
  const authors = [...entry.matchAll(/<author>([\s\S]*?)<\/author>/g)].map((m) => ({
    name: squash(text(m[1], "name") ?? ""),
    affiliation: text(m[1], "arxiv:affiliation") ? squash(text(m[1], "arxiv:affiliation")!) : undefined,
  })).filter((a) => a.name);
  const categories = attrs(entry, "category").map((a) => a.term).filter(Boolean);
  const primary = attrs(entry, "arxiv:primary_category")[0]?.term;
  const opt = (tag: string) => {
    const v = text(entry, tag);
    return v && squash(v) ? squash(v) : undefined;
  };
  return {
    ...ident,
    title: squash(text(entry, "title") ?? "Untitled"),
    abstract: squash(text(entry, "summary") ?? ""),
    authors,
    published: (text(entry, "published") ?? "").trim(),
    updated: (text(entry, "updated") ?? "").trim(),
    primaryCategory: primary ?? categories[0],
    categories: [...new Set([...(primary ? [primary] : []), ...categories])],
    comment: opt("arxiv:comment"),
    journalRef: opt("arxiv:journal_ref"),
    doi: opt("arxiv:doi"),
  };
}

/**
 * The papers of an answer of `export.arxiv.org/api/query`. An error comes back
 * as a single entry whose id is `…/api/errors#…`: it is thrown.
 */
export function parseFeed(xml: string): Feed {
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);
  const error = entries.find((e) => /\/api\/errors/.test(text(e, "id") ?? ""));
  if (error) throw new Error(`arXiv refused the search: ${squash(text(error, "summary") ?? "unknown error")}`);
  const total = Number(text(xml, "opensearch:totalResults") ?? entries.length);
  return {
    papers: entries.map(parseEntry).filter((p): p is Paper => p !== undefined),
    total: Number.isFinite(total) ? total : entries.length,
  };
}

// ---------------------------------------------------------------------------
// Queries

export type Sort = "relevance" | "submittedDate" | "lastUpdatedDate";

const FIELD_PREFIXES = ["ti", "au", "abs", "co", "jr", "cat", "rn", "id", "all"];

/** A category code: cs.AI, math.CO, hep-th, astro-ph.GA, q-bio.NC, stat.ML. */
export const isCategory = (s: string) => /^[a-z-]+(\.[A-Za-z-]{2,})?$/.test(s) && s.length >= 4;

/** The `categories` preference: "cs.AI, cs.LG cs.CL" → ["cs.AI", "cs.LG", "cs.CL"]. */
export function parseCategories(input: unknown): string[] {
  const out = String(input ?? "").split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean)
    .map(normalizeCategory).filter((c): c is string => !!c);
  return [...new Set(out)];
}

/** "CS.ai" → "cs.AI", "Cond-Mat.Mes-Hall" → "cond-mat.mes-hall"; anything else is dropped. */
export function normalizeCategory(raw: string): string | undefined {
  const m = raw.trim().match(/^([a-z-]+)(?:\.([a-z-]{2,}))?$/i);
  if (!m) return undefined;
  const archive = m[1].toLowerCase();
  if (!m[2]) return isCategory(archive) ? archive : undefined;
  // Two-letter subjects are upper case (cs.AI, math.CO, stat.ML); longer ones lower case (physics.optics).
  return `${archive}.${m[2].length === 2 ? m[2].toUpperCase() : m[2].toLowerCase()}`;
}

const quote = (s: string) => (/\s/.test(s) ? `"${s.replace(/"/g, "")}"` : s.replace(/"/g, ""));

/**
 * What is typed, as an arXiv `search_query`: words are ANDed in all fields,
 * `"quoted phrases"` stay together, `au:hinton`, `ti:…`, `cat:cs.AI` (or
 * `#cs.AI`) are kept as fields, and `categories` limit the search when set.
 */
export function buildQuery(input: string, categories: string[] = []): string {
  const parts: string[] = [];
  const cats: string[] = [...categories];
  for (const m of input.matchAll(/(\w+:)?"([^"]*)"|(\S+)/g)) {
    const prefix = m[1]?.slice(0, -1).toLowerCase();
    if (m[2] !== undefined) {
      if (!m[2].trim()) continue;
      parts.push(`${prefix && FIELD_PREFIXES.includes(prefix) ? prefix : "all"}:${quote(m[2].trim())}`);
      continue;
    }
    const word = m[3];
    if (word.startsWith("#") && normalizeCategory(word.slice(1))) {
      cats.push(normalizeCategory(word.slice(1))!);
      continue;
    }
    const field = word.match(/^(\w+):(.+)$/);
    if (field && FIELD_PREFIXES.includes(field[1].toLowerCase())) {
      const f = field[1].toLowerCase();
      if (f === "cat") {
        const c = normalizeCategory(field[2]);
        if (c) cats.push(c);
        continue;
      }
      parts.push(`${f}:${quote(field[2])}`);
      continue;
    }
    if (/^(and|or|andnot)$/i.test(word)) continue;
    const clean = word.replace(/[()"]/g, "");
    if (clean) parts.push(`all:${clean}`);
  }
  const unique = [...new Set(cats)];
  const catPart = unique.length === 1
    ? `cat:${unique[0]}`
    : unique.length > 1
    ? `(${unique.map((c) => `cat:${c}`).join(" OR ")})`
    : "";
  return [...parts, ...(catPart ? [catPart] : [])].join(" AND ");
}

/** The API address for a search, or for a list of ids. */
export function queryUrl(
  o: { query?: string; ids?: string[]; sort?: Sort; start?: number; max?: number },
): string {
  const params = new URLSearchParams();
  if (o.query) params.set("search_query", o.query);
  if (o.ids?.length) params.set("id_list", o.ids.join(","));
  params.set("start", String(o.start ?? 0));
  params.set("max_results", String(o.max ?? 30));
  if (o.sort) {
    params.set("sortBy", o.sort);
    params.set("sortOrder", "descending");
  }
  return `${API}?${params}`;
}

// ---------------------------------------------------------------------------
// Links and names

export const absUrl = (p: Pick<Paper, "id">) => `https://arxiv.org/abs/${p.id}`;
export const pdfUrl = (p: Pick<Paper, "id">) => `https://arxiv.org/pdf/${p.id}`;
export const htmlUrl = (p: Pick<Paper, "id">) => `https://arxiv.org/html/${p.id}`;
/** arXiv registers a DataCite DOI for every paper. */
export const arxivDoi = (p: Pick<Paper, "id">) => `10.48550/arXiv.${p.id}`;

const PARTICLES = new Set([
  "van",
  "von",
  "der",
  "den",
  "de",
  "del",
  "della",
  "di",
  "da",
  "du",
  "la",
  "le",
  "dos",
  "das",
  "ten",
  "ter",
  "bin",
  "al",
]);
const SUFFIXES = /^(jr\.?|sr\.?|ii|iii|iv)$/i;

/** "Ludwig van Beethoven Jr." → { given: "Ludwig", family: "van Beethoven", suffix: "Jr." }. */
export function splitName(name: string): { given: string; family: string; suffix?: string } {
  const words = name.replace(/,/g, " ").trim().split(/\s+/).filter(Boolean);
  let suffix: string | undefined;
  if (words.length > 2 && SUFFIXES.test(words[words.length - 1])) suffix = words.pop();
  if (words.length <= 1) return { given: "", family: words[0] ?? "", suffix };
  let start = words.length - 1;
  while (start > 1 && PARTICLES.has(words[start - 1].toLowerCase())) start--;
  return { given: words.slice(0, start).join(" "), family: words.slice(start).join(" "), suffix };
}

/** "Geoffrey E. Hinton" → "Hinton, G. E.". */
function apaName(name: string): string {
  const { given, family, suffix } = splitName(name);
  const initials = given.split(/\s+/).filter(Boolean).map((g) =>
    g.split("-").map((part) => `${part.replace(/\.$/, "")[0]?.toUpperCase() ?? ""}.`).join("-")
  ).join(" ");
  return [family, initials, suffix].filter(Boolean).join(", ");
}

/** APA 7: up to 20 authors, else the first 19, "…" and the last. */
export function apaAuthors(authors: Author[]): string {
  const names = authors.map((a) => apaName(a.name));
  if (!names.length) return "";
  if (names.length === 1) return names[0];
  if (names.length > 20) return `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

export const year = (p: Pick<Paper, "published">) => p.published.slice(0, 4) || "n.d.";

/** An APA 7 reference to the preprint. */
export function citation(p: Paper): string {
  const who = apaAuthors(p.authors);
  const title = p.title.replace(/[.\s]+$/, "");
  const head = who ? `${who} (${year(p)}). ${title}.` : `${title}. (${year(p)}).`;
  return `${head} arXiv. https://doi.org/${arxivDoi(p)}`;
}

/** Characters that BibTeX treats specially, escaped; braces are kept balanced. */
export function bibEscape(s: string): string {
  return s.replace(/\\/g, "\\textbackslash{}").replace(/([&%$#_])/g, "\\$1").replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

const KEY_STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "on",
  "of",
  "for",
  "in",
  "and",
  "to",
  "with",
  "towards",
  "toward",
  "is",
  "are",
  "from",
  "via",
  "by",
  "at",
]);

/** "vaswani2017attention": family name, year and first meaningful word, ASCII only. */
export function citationKey(p: Paper): string {
  const ascii = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const first = p.authors[0] ? ascii(splitName(p.authors[0].name).family.split(/\s+/).pop() ?? "") : "";
  const word = p.title.split(/[\s:,.\-–—?!]+/).map(ascii).find((w) => w && !KEY_STOPWORDS.has(w)) ?? "";
  return `${first || "arxiv"}${year(p) === "n.d." ? "" : year(p)}${word}`;
}

/** A BibTeX entry as arXiv's own "Export BibTeX Citation" writes it (@misc with eprint fields). */
export function bibtex(p: Paper): string {
  const authors = p.authors.map((a) => {
    const { given, family, suffix } = splitName(a.name);
    return bibEscape([family, suffix, given].filter(Boolean).join(", "));
  });
  const fields: [string, string | undefined][] = [
    ["title", `{${bibEscape(p.title)}}`],
    ["author", authors.join(" and ") || undefined],
    ["year", year(p) === "n.d." ? undefined : year(p)],
    ["eprint", p.id],
    ["archivePrefix", "arXiv"],
    ["primaryClass", p.primaryCategory],
    ["doi", p.doi ?? arxivDoi(p)],
    ["note", p.journalRef ? bibEscape(p.journalRef) : undefined],
    ["url", absUrl(p)],
  ];
  const lines = fields.filter(([, v]) => v).map(([k, v]) => `  ${k} = {${v}},`);
  return `@misc{${citationKey(p)},\n${lines.join("\n")}\n}`;
}

/** What the Zotero connector's /connector/saveItems takes for one preprint. */
export function zoteroItem(p: Paper): Record<string, unknown> {
  return {
    itemType: "preprint",
    title: p.title,
    creators: p.authors.map((a) => {
      const { given, family, suffix } = splitName(a.name);
      return { firstName: given, lastName: suffix ? `${family}, ${suffix}` : family, creatorType: "author" };
    }),
    abstractNote: p.abstract,
    date: p.published.slice(0, 10),
    repository: "arXiv",
    archiveID: `arXiv:${p.id}`,
    DOI: p.doi ?? arxivDoi(p),
    url: absUrl(p),
    extra: [p.comment ? `Comment: ${p.comment}` : "", p.journalRef ? `Journal reference: ${p.journalRef}` : ""]
      .filter(Boolean).join("\n"),
    tags: p.categories.map((c) => ({ tag: c, type: 1 })),
    attachments: [{ title: "arXiv Fulltext PDF", url: pdfUrl(p), mimeType: "application/pdf" }],
  };
}

// ---------------------------------------------------------------------------
// Formatting

/** "Ashish Vaswani, Noam Shazeer et al." */
export function authorLine(authors: Author[], max = 3): string {
  if (!authors.length) return "Unknown authors";
  if (authors.length <= max) return authors.map((a) => a.name).join(", ");
  return `${authors.slice(0, max - 1).map((a) => a.name).join(", ")} et al.`;
}

/** "2024-01-02T18:59:59Z" → "2 Jan 2024". */
export function fullDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "today", "3d", "5mo", "2y". */
export function age(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (!Number.isFinite(days)) return "";
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** "Today", "Yesterday", "This Week", "Earlier": the sections of new submissions. */
export function daySection(iso: string, now = Date.now()): string {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const t = Date.parse(iso);
  const day = 86_400_000;
  if (t >= start.getTime()) return "Today";
  if (t >= start.getTime() - day) return "Yesterday";
  if (t >= start.getTime() - 6 * day) return "This Week";
  return "Earlier";
}

/** The abstract with arXiv's TeX-isms made readable in Markdown: $x$ stays, `\emph{x}` → *x*. */
export function abstractMarkdown(abstract: string): string {
  return abstract
    .replace(/\\(?:emph|textit)\{([^}]*)\}/g, "*$1*")
    .replace(/\\textbf\{([^}]*)\}/g, "**$1**")
    .replace(/\\url\{([^}]*)\}/g, "$1")
    .replace(/``|''/g, '"');
}

/** Archives' names, for the category tags. */
export const ARCHIVES: Record<string, string> = {
  cs: "Computer Science",
  math: "Mathematics",
  stat: "Statistics",
  physics: "Physics",
  "astro-ph": "Astrophysics",
  "cond-mat": "Condensed Matter",
  "gr-qc": "General Relativity",
  "hep-ex": "High Energy Physics",
  "hep-lat": "High Energy Physics",
  "hep-ph": "High Energy Physics",
  "hep-th": "High Energy Physics",
  "math-ph": "Mathematical Physics",
  nlin: "Nonlinear Sciences",
  "nucl-ex": "Nuclear Physics",
  "nucl-th": "Nuclear Physics",
  "quant-ph": "Quantum Physics",
  "q-bio": "Quantitative Biology",
  "q-fin": "Quantitative Finance",
  eess: "Electrical Engineering",
  econ: "Economics",
};

export const archiveOf = (category: string) => ARCHIVES[category.split(".")[0]];
