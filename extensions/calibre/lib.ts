// Calibre's metadata.db rows, search, citations, calibredb command lines and
// formatting. Pure, tested in lib_test.ts.

export interface Format {
  /** "EPUB", "PDF", "AZW3"… */
  format: string;
  /** The file name without extension, in the book's folder. */
  name: string;
  size?: number;
}

export interface Book {
  id: number;
  title: string;
  /** "Fellowship of the Ring, The". */
  sort: string;
  authors: string[];
  authorSort: string;
  series?: string;
  seriesIndex?: number;
  tags: string[];
  publisher?: string;
  /** Milliseconds; undefined when Calibre has no date. */
  published?: number;
  added: number;
  modified?: number;
  /** 0 to 5 stars, halves allowed. */
  rating?: number;
  languages: string[];
  formats: Format[];
  identifiers: Record<string, string>;
  /** Relative to the library: "J. R. R. Tolkien/The Fellowship of the Ring (12)". */
  path: string;
  hasCover: boolean;
  /** HTML. */
  comments?: string;
  uuid?: string;
}

// ---------------------------------------------------------------------------
// The database

/**
 * Every book with its authors (in order), series, tags, publisher, rating,
 * languages, formats, identifiers and description, newest first.
 */
export const QUERY = `
SELECT b.id AS id, b.title AS title, b.sort AS sort, b.author_sort AS authorSort, b.path AS path,
  b.has_cover AS hasCover, b.timestamp AS added, b.pubdate AS pubdate, b.last_modified AS modified,
  b.series_index AS seriesIndex, b.uuid AS uuid,
  (SELECT json_group_array(name) FROM (SELECT a.name AS name FROM books_authors_link l
     JOIN authors a ON a.id = l.author WHERE l.book = b.id ORDER BY l.id)) AS authors,
  (SELECT s.name FROM books_series_link l JOIN series s ON s.id = l.series WHERE l.book = b.id) AS series,
  (SELECT json_group_array(t.name) FROM books_tags_link l JOIN tags t ON t.id = l.tag WHERE l.book = b.id) AS tags,
  (SELECT p.name FROM books_publishers_link l JOIN publishers p ON p.id = l.publisher WHERE l.book = b.id) AS publisher,
  (SELECT r.rating FROM books_ratings_link l JOIN ratings r ON r.id = l.rating WHERE l.book = b.id) AS rating,
  (SELECT json_group_array(code) FROM (SELECT g.lang_code AS code FROM books_languages_link l
     JOIN languages g ON g.id = l.lang_code WHERE l.book = b.id ORDER BY l.item_order)) AS languages,
  (SELECT json_group_array(json_object('format', d.format, 'name', d.name, 'size', d.uncompressed_size))
     FROM data d WHERE d.book = b.id) AS formats,
  (SELECT json_group_object(i.type, i.val) FROM identifiers i WHERE i.book = b.id) AS identifiers,
  (SELECT c.text FROM comments c WHERE c.book = b.id) AS comments
FROM books b
ORDER BY b.timestamp DESC, b.id DESC
`;

export interface Row {
  id: number;
  title: string;
  sort: string | null;
  authorSort: string | null;
  path: string;
  hasCover: number | boolean | null;
  added: string | null;
  pubdate: string | null;
  modified: string | null;
  seriesIndex: number | null;
  uuid: string | null;
  authors: string | null;
  series: string | null;
  tags: string | null;
  publisher: string | null;
  rating: number | null;
  languages: string | null;
  formats: string | null;
  identifiers: string | null;
  comments: string | null;
}

/**
 * Calibre's dates: "2023-05-01 12:34:56.123456+00:00". Year 101 is how it
 * stores "no date".
 */
export function calibreDate(s: string | null | undefined): number | undefined {
  if (!s) return undefined;
  const t = Date.parse(s.trim().replace(" ", "T").replace(/(\.\d{3})\d+/, "$1"));
  if (!Number.isFinite(t) || new Date(t).getUTCFullYear() <= 101) return undefined;
  return t;
}

const json = <T>(s: string | null, fallback: T): T => {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
};

export function fromRow(r: Row): Book {
  const rating = r.rating ? Math.round(r.rating) / 2 : undefined;
  return {
    id: Number(r.id),
    title: r.title || "Unknown",
    sort: r.sort || r.title || "",
    authors: json<string[]>(r.authors, []).filter(Boolean).map((a) => a.replace(/\|/g, ",")),
    authorSort: r.authorSort || "",
    series: r.series || undefined,
    seriesIndex: r.series && r.seriesIndex !== null ? Number(r.seriesIndex) : undefined,
    tags: json<string[]>(r.tags, []).filter(Boolean),
    publisher: r.publisher || undefined,
    published: calibreDate(r.pubdate),
    added: calibreDate(r.added) ?? 0,
    modified: calibreDate(r.modified),
    rating: rating && rating > 0 ? rating : undefined,
    languages: json<string[]>(r.languages, []).filter(Boolean),
    formats: json<Format[]>(r.formats, []).filter((f) => f?.format && f.name),
    identifiers: json<Record<string, string>>(r.identifiers, {}),
    path: r.path,
    hasCover: !!r.hasCover,
    comments: r.comments || undefined,
    uuid: r.uuid || undefined,
  };
}

// ---------------------------------------------------------------------------
// Paths

/** "~/Calibre Library" → "/home/me/Calibre Library"; trailing slashes removed. */
export function expandHome(path: string, home: string): string {
  const p = path.trim().replace(/\/+$/, "");
  if (p === "~") return home;
  return p.startsWith("~/") ? `${home}${p.slice(1)}` : p;
}

/** The library Calibre opened last, from ~/.config/calibre/global.py.json. */
export function libraryFromGlobal(text: string | undefined): string | undefined {
  if (!text) return undefined;
  try {
    const path = JSON.parse(text)?.library_path;
    return typeof path === "string" && path.trim() ? path.trim() : undefined;
  } catch {
    return undefined;
  }
}

export const bookDir = (library: string, b: Pick<Book, "path">) => `${library}/${b.path}`;
export const formatPath = (library: string, b: Pick<Book, "path">, f: Format) =>
  `${bookDir(library, b)}/${f.name}.${f.format.toLowerCase()}`;
export const coverPath = (library: string, b: Pick<Book, "path" | "hasCover">) =>
  b.hasCover ? `${bookDir(library, b)}/cover.jpg` : undefined;

/** The format users read most: EPUB first, then Kindle formats, then the rest, PDF and comics last. */
export const FORMAT_ORDER = [
  "EPUB",
  "KEPUB",
  "AZW3",
  "MOBI",
  "AZW",
  "FB2",
  "DJVU",
  "PDF",
  "CBZ",
  "CBR",
  "TXT",
  "RTF",
  "DOCX",
  "HTMLZ",
];

/** The `formats` preference ("pdf, epub") as an order, the default one after it. */
export function formatOrder(input: unknown): string[] {
  const own = String(input ?? "").split(/[\s,;]+/).map((f) => f.trim().toUpperCase()).filter(Boolean);
  return [...new Set([...own, ...FORMAT_ORDER])];
}

export function preferredFormat(formats: Format[], order = FORMAT_ORDER): Format | undefined {
  const rank = (f: Format) => {
    const i = order.indexOf(f.format.toUpperCase());
    return i < 0 ? order.length : i;
  };
  return [...formats].sort((a, b) => rank(a) - rank(b))[0];
}

/** Formats e-book-viewer opens. */
export const VIEWABLE = new Set([
  "EPUB",
  "KEPUB",
  "AZW3",
  "AZW",
  "MOBI",
  "FB2",
  "PDF",
  "CBZ",
  "CBR",
  "CB7",
  "TXT",
  "HTMLZ",
  "DOCX",
  "RTF",
  "DJVU",
  "PDB",
  "LIT",
  "ODT",
]);

// ---------------------------------------------------------------------------
// Search

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export interface Query {
  words: string[];
  author: string[];
  series: string[];
  tag: string[];
  format: string[];
  title: string[];
}

/**
 * What is typed: plain words match the title, authors, series, tags and
 * publisher; `author:`, `series:`, `tag:` (or `#tag`), `format:` and `title:`
 * one field. `"quotes"` keep words together.
 */
export function parseQuery(input: string): Query {
  const q: Query = { words: [], author: [], series: [], tag: [], format: [], title: [] };
  for (const m of input.matchAll(/(\w+):"([^"]*)"|(\w+):(\S+)|"([^"]*)"|#(\S+)|(\S+)/g)) {
    const field = (m[1] ?? m[3])?.toLowerCase();
    const value = fold(m[2] ?? m[4] ?? m[5] ?? m[6] ?? m[7] ?? "").trim();
    if (!value) continue;
    if (m[6] !== undefined) q.tag.push(value);
    else if (field === "author" || field === "authors" || field === "by") q.author.push(value);
    else if (field === "series") q.series.push(value);
    else if (field === "tag" || field === "tags") q.tag.push(value);
    else if (field === "format" || field === "fmt") q.format.push(value);
    else if (field === "title") q.title.push(value);
    else q.words.push(fold(m[0].replace(/"/g, "")));
  }
  return q;
}

/** How well a book matches (0: not at all); title matches count most. */
export function score(b: Book, q: Query): number {
  const title = fold(b.title);
  const authors = fold(b.authors.join(" "));
  const series = fold(b.series ?? "");
  const tags = b.tags.map(fold);
  for (const a of q.author) if (!authors.includes(a)) return 0;
  for (const s of q.series) if (!series.includes(s)) return 0;
  for (const t of q.tag) if (!tags.some((x) => x.includes(t))) return 0;
  for (const f of q.format) if (!b.formats.some((x) => x.format.toLowerCase() === f)) return 0;
  for (const t of q.title) if (!title.includes(t)) return 0;
  let total = 1;
  const rest = fold([b.publisher ?? "", ...Object.values(b.identifiers)].join(" "));
  for (const w of q.words) {
    if (title.startsWith(w)) total += 6;
    else if (new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title)) total += 4;
    else if (title.includes(w)) total += 3;
    else if (authors.includes(w)) total += 3;
    else if (series.includes(w)) total += 2;
    else if (tags.some((t) => t.includes(w))) total += 1;
    else if (rest.includes(w)) total += 1;
    else return 0;
  }
  return total;
}

export function search(books: Book[], input: string, limit = 100): Book[] {
  const q = parseQuery(input);
  return books.map((b) => ({ b, s: score(b, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || b.b.added - a.b.added)
    .slice(0, limit)
    .map((x) => x.b);
}

export type Order = "recent" | "title" | "author" | "series";

/** Books in the order of a filter chip. */
export function sortBooks(books: Book[], order: Order): Book[] {
  const by = (k: (b: Book) => string) =>
    [...books].sort((a, b) => k(a).localeCompare(k(b), "en", { sensitivity: "base" }));
  switch (order) {
    case "title":
      return by((b) => b.sort);
    case "author":
      return by((b) =>
        `${b.authorSort}\u0000${b.series ?? ""}\u0000${String(b.seriesIndex ?? 0).padStart(6, "0")}\u0000${b.sort}`
      );
    case "series":
      return [...books].filter((b) => b.series).sort((a, b) =>
        a.series!.localeCompare(b.series!, "en", { sensitivity: "base" }) || (a.seriesIndex ?? 0) - (b.seriesIndex ?? 0)
      );
    default:
      return [...books].sort((a, b) => b.added - a.added);
  }
}

// ---------------------------------------------------------------------------
// Citations

const PARTICLES = new Set(["van", "von", "der", "den", "de", "del", "della", "di", "da", "du", "la", "le"]);

/** "J. R. R. Tolkien" → "Tolkien, J. R. R."; "Ursula K. Le Guin" → "Le Guin, U. K."; "Plato" stays. */
export function apaName(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) return name.trim();
  let start = words.length - 1;
  while (start > 1 && PARTICLES.has(words[start - 1].toLowerCase())) start--;
  const family = words.slice(start).join(" ");
  const initials = words.slice(0, start).map((g) =>
    g.split("-").map((p) => `${p.replace(/\.$/, "")[0]?.toUpperCase() ?? ""}.`).join("-")
  ).join(" ");
  return `${family}, ${initials}`;
}

function apaAuthors(authors: string[]): string {
  const names = authors.filter((a) => a && a !== "Unknown").map(apaName);
  if (names.length <= 1) return names[0] ?? "";
  if (names.length > 20) return `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

/** 1 → "1", 2.5 → "2.5". */
export const seriesNumber = (n: number | undefined) =>
  n === undefined ? "" : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);

/** An APA 7 reference: "Tolkien, J. R. R. (1954). The fellowship of the ring (The Lord of the Rings, 1). Allen & Unwin." */
export function citation(b: Book): string {
  const who = apaAuthors(b.authors);
  const year = b.published ? String(new Date(b.published).getUTCFullYear()) : "n.d.";
  const series = b.series
    ? ` (${b.series}${b.seriesIndex !== undefined ? `, ${seriesNumber(b.seriesIndex)}` : ""})`
    : "";
  const title = `${b.title.replace(/[.\s]+$/, "")}${series}.`;
  const head = who ? `${who.replace(/\.?$/, ".")} (${year}). ${title}` : `${title} (${year}).`;
  return b.publisher ? `${head} ${b.publisher.replace(/\.?$/, ".")}` : head;
}

// ---------------------------------------------------------------------------
// Clipboard and calibredb

/**
 * The files of a copy in a file manager: `file://` URIs (one per line, as
 * text/uri-list or GNOME's "x-special/gnome-copied-files"), or plain absolute paths.
 */
export function copiedFiles(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line || line === "copy" || line === "cut" || line.startsWith("x-special/") || line.startsWith("#")) continue;
    if (line.startsWith("file://")) {
      try {
        out.push(decodeURIComponent(new URL(line).pathname));
      } catch {
        // Not a usable address.
      }
    } else if (line.startsWith("/")) out.push(line);
  }
  return [...new Set(out)];
}

/** Book files Calibre can add. */
export const BOOK_EXTENSIONS =
  /\.(epub|kepub|azw3?|mobi|pdf|fb2|djvu?|cbz|cbr|cb7|txt|rtf|docx?|odt|htmlz?|lit|pdb|lrf|prc|chm)$/i;

/** `--with-library` for a local library, or a content server ("http://host:8080/#Library_ID"). */
export function libraryArg(o: { library: string; server?: string; libraryId?: string }): string {
  if (!o.server) return o.library;
  const base = o.server.replace(/[#?].*$/, "").replace(/\/+$/, "");
  return o.libraryId ? `${base}/#${o.libraryId}` : base;
}

/** Credentials for a content server that needs them. */
export const authArgs = (user?: string, password?: string) =>
  user ? ["--username", user, ...(password ? ["--password", password] : [])] : [];

export const addArgs = (
  target: string,
  files: string[],
  auth: string[] = [],
) => ["add", "--with-library", target, ...auth, "--", ...files];

export const exportArgs = (target: string, id: number, dir: string, auth: string[] = []) => [
  "export",
  "--with-library",
  target,
  ...auth,
  "--single-dir",
  "--dont-save-cover",
  "--dont-write-opf",
  "--template",
  "{title} - {authors}",
  "--to-dir",
  dir,
  String(id),
];

export const removeArgs = (
  target: string,
  id: number,
  auth: string[] = [],
) => ["remove", "--with-library", target, ...auth, String(id)];

/** "Added book ids: 12, 13" → [12, 13]. */
export function addedIds(out: string): number[] {
  const m = out.match(/Added book ids?:\s*([\d,\s]+)/i);
  return m ? m[1].split(/[,\s]+/).filter(Boolean).map(Number) : [];
}

/** calibredb refuses to touch a library the Calibre window has open. */
export const isLocked = (message: string) => /another calibre program|is running/i.test(message);

/** The content server's library id: the folder's name, spaces and punctuation as underscores. */
export const libraryIdOf = (library: string) => (library.split("/").pop() ?? "").replace(/[^\w-]+/g, "_");

export function serverBookUrl(server: string, libraryId: string, id: number): string {
  const base = server.replace(/[#?].*$/, "").replace(/\/+$/, "");
  return `${base}/#book_id=${id}&library_id=${encodeURIComponent(libraryId)}&panel=book_details`;
}

// ---------------------------------------------------------------------------
// Formatting

/** Calibre descriptions are HTML: paragraphs, emphasis, lists and links kept as Markdown. */
export function htmlToMarkdown(html: string | undefined): string {
  if (!html) return "";
  return html
    .replace(/\r/g, "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\s*\/?(p|div|h\d|blockquote)[^>]*>/gi, "\n\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*\/li\s*>/gi, "")
    .replace(/<\s*\/?(ul|ol)[^>]*>/gi, "\n\n")
    .replace(/<\s*(b|strong)[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, "**$2**")
    .replace(/<\s*(i|em)[^>]*>([\s\S]*?)<\s*\/\s*\1\s*>/gi, "*$2*")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\*\*\s*\*\*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 3.5 → "★★★½☆". */
export function stars(rating: number): string {
  const full = Math.floor(rating);
  const half = rating - full >= 0.5;
  return "★".repeat(full) + (half ? "½" : "") + "☆".repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
}

export function size(bytes: number | undefined): string | undefined {
  if (!bytes) return undefined;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const LANGUAGES: Record<string, string> = {
  eng: "English",
  fra: "French",
  fre: "French",
  deu: "German",
  ger: "German",
  spa: "Spanish",
  ita: "Italian",
  por: "Portuguese",
  nld: "Dutch",
  dut: "Dutch",
  rus: "Russian",
  jpn: "Japanese",
  zho: "Chinese",
  chi: "Chinese",
  pol: "Polish",
  swe: "Swedish",
  nor: "Norwegian",
  dan: "Danish",
  fin: "Finnish",
  ces: "Czech",
  tur: "Turkish",
  ara: "Arabic",
  kor: "Korean",
  lat: "Latin",
  grc: "Ancient Greek",
  ell: "Greek",
  heb: "Hebrew",
  hin: "Hindi",
  ukr: "Ukrainian",
  cat: "Catalan",
};

export const languageName = (code: string) => LANGUAGES[code.toLowerCase()] ?? code;

/** "The Lord of the Rings #1". */
export const seriesLabel = (b: Pick<Book, "series" | "seriesIndex">) =>
  b.series ? `${b.series}${b.seriesIndex !== undefined ? ` #${seriesNumber(b.seriesIndex)}` : ""}` : undefined;

export const authorLine = (b: Pick<Book, "authors">) => b.authors.join(", ") || "Unknown author";

/** ISBNs and links for the identifiers Calibre knows. */
export function identifierLinks(ids: Record<string, string>): { label: string; value: string; url?: string }[] {
  const out: { label: string; value: string; url?: string }[] = [];
  for (const [type, val] of Object.entries(ids)) {
    switch (type) {
      case "isbn":
        out.push({ label: "ISBN", value: val, url: `https://openlibrary.org/isbn/${encodeURIComponent(val)}` });
        break;
      case "amazon":
        out.push({ label: "Amazon", value: val, url: `https://www.amazon.com/dp/${encodeURIComponent(val)}` });
        break;
      case "goodreads":
        out.push({
          label: "Goodreads",
          value: val,
          url: `https://www.goodreads.com/book/show/${encodeURIComponent(val)}`,
        });
        break;
      case "google":
        out.push({
          label: "Google Books",
          value: val,
          url: `https://books.google.com/books?id=${encodeURIComponent(val)}`,
        });
        break;
      case "doi":
        out.push({ label: "DOI", value: val, url: `https://doi.org/${val}` });
        break;
      case "uri":
      case "url":
        if (/^https?:\/\//.test(val)) out.push({ label: "Link", value: val, url: val });
        break;
      default:
        out.push({ label: type, value: val });
    }
  }
  return out;
}

/** Distro family from /etc/os-release, for install hints. */
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

export function installCommand(family: Family | undefined, pkg = "calibre"): string {
  return family ? `${MANAGERS[family]} ${pkg}` : `Install ${pkg} with your package manager`;
}
