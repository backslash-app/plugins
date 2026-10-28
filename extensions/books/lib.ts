// Open Library answers, citations and the reading list. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Shapes

/** One document of `GET /search.json` (with the `fields` we ask for). */
export interface SearchDoc {
  key: string;
  title: string;
  subtitle?: string;
  author_name?: string[];
  author_key?: string[];
  first_publish_year?: number;
  edition_count?: number;
  cover_i?: number;
  isbn?: string[];
  subject?: string[];
  number_of_pages_median?: number;
  ratings_average?: number;
  ratings_count?: number;
  publisher?: string[];
  language?: string[];
  want_to_read_count?: number;
  already_read_count?: number;
}

/** `GET /works/OL…W.json`, the fields we read. */
export interface Work {
  key: string;
  title: string;
  subtitle?: string;
  description?: string | { type?: string; value: string };
  first_sentence?: string | { value: string };
  subjects?: string[];
  subject_places?: string[];
  subject_times?: string[];
  subject_people?: string[];
  first_publish_date?: string;
  links?: { title: string; url: string }[];
  covers?: number[];
}

export interface Book {
  /** `/works/OL45804W` */
  key: string;
  title: string;
  subtitle?: string;
  authors: string[];
  authorKeys: string[];
  year?: number;
  editions?: number;
  cover?: number;
  isbn?: string;
  subjects: string[];
  pages?: number;
  rating?: number;
  ratings?: number;
  publisher?: string;
  languages: string[];
  wantToRead?: number;
  alreadyRead?: number;
}

export type Status = "want" | "reading" | "read";

export const STATUSES: Record<Status, { title: string; color: Color; icon: string }> = {
  want: { title: "Want to Read", color: "blue", icon: "bs-bookmark" },
  reading: { title: "Reading", color: "orange", icon: "bs-book" },
  read: { title: "Read", color: "green", icon: "bs-circle-check" },
};

export interface Saved {
  book: Book;
  status: Status;
  added: number;
  updated: number;
}

// ---------------------------------------------------------------------------
// Mapping

export const SEARCH_FIELDS = [
  "key",
  "title",
  "subtitle",
  "author_name",
  "author_key",
  "first_publish_year",
  "edition_count",
  "cover_i",
  "isbn",
  "subject",
  "number_of_pages_median",
  "ratings_average",
  "ratings_count",
  "publisher",
  "language",
  "want_to_read_count",
  "already_read_count",
].join(",");

/** ISBN-13 first (the one shops and libraries use), then ISBN-10. */
export function bestIsbn(isbns: string[] | undefined): string | undefined {
  const clean = (isbns ?? []).map((i) => i.replace(/[^\dX]/gi, "").toUpperCase());
  return clean.find((i) => i.length === 13 && /^97[89]/.test(i)) ?? clean.find((i) => i.length === 10);
}

/** Subjects worth showing: no "Fiction, general"-style catalog noise, no duplicates, short. */
export function cleanSubjects(subjects: string[] | undefined, limit = 8): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of subjects ?? []) {
    const s = raw.trim();
    const k = s.toLowerCase();
    if (!s || s.length > 32 || seen.has(k)) continue;
    if (/\b(general|accessible book|protected daisy|in library|nyt:|award|lending library|large type)\b/i.test(s)) {
      continue;
    }
    if (/[=:]/.test(s)) continue;
    seen.add(k);
    out.push(s);
    if (out.length === limit) break;
  }
  return out;
}

export function fromDoc(d: SearchDoc): Book {
  return {
    key: d.key,
    title: d.title,
    subtitle: d.subtitle,
    authors: d.author_name ?? [],
    authorKeys: d.author_key ?? [],
    year: d.first_publish_year,
    editions: d.edition_count,
    cover: d.cover_i,
    isbn: bestIsbn(d.isbn),
    subjects: cleanSubjects(d.subject),
    pages: d.number_of_pages_median,
    rating: d.ratings_count ? d.ratings_average : undefined,
    ratings: d.ratings_count,
    publisher: d.publisher?.[0],
    languages: d.language ?? [],
    wantToRead: d.want_to_read_count,
    alreadyRead: d.already_read_count,
  };
}

export const coverUrl = (id: number | undefined, size: "S" | "M" | "L") =>
  id && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-${size}.jpg` : undefined;

export const workUrl = (key: string) => `https://openlibrary.org${key}`;
export const authorUrl = (key: string) => `https://openlibrary.org/authors/${key}`;

/** Text of a work's description, without Open Library's trailing source notes and link refs. */
export function description(value: Work["description"] | Work["first_sentence"]): string | undefined {
  const text = typeof value === "string" ? value : value?.value;
  if (!text) return undefined;
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n-{3,}\n/)[0]
    .replace(/^\[\d+\]:\s*\S+\s*$/gm, "")
    .replace(/\(\[source\]\[\d+\]\)/gi, "")
    .replace(/\[([^\]]+)\]\[\d+\]/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim() || undefined;
}

/** A query that is an ISBN (with or without dashes) → the ISBN. */
export function isbnQuery(query: string): string | undefined {
  const digits = query.replace(/[\s-]/g, "").toUpperCase();
  return /^(97[89]\d{10}|\d{9}[\dX])$/.test(digits) ? digits : undefined;
}

// ---------------------------------------------------------------------------
// Citations

const PARTICLES = new Set([
  "de",
  "da",
  "di",
  "du",
  "van",
  "von",
  "der",
  "den",
  "le",
  "la",
  "del",
  "della",
  "st.",
  "ter",
]);

/** "J. R. R. Tolkien" → "Tolkien, J. R. R."; "Ursula K. Le Guin" → "Le Guin, U. K.". */
export function apaName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return name.trim();
  let i = parts.length - 1;
  while (i > 1 && PARTICLES.has(parts[i - 1].toLowerCase())) i--;
  const last = parts.slice(i).join(" ");
  const initials = parts.slice(0, i).map((p) =>
    p.split("-").map((x) => `${x.replace(/\./g, "").charAt(0).toUpperCase()}.`).join("-")
  );
  return `${last}, ${initials.join(" ")}`;
}

/** APA 7: `Herbert, F. (1965). Dune. Chilton Books.` */
export function citation(b: Pick<Book, "authors" | "year" | "title" | "subtitle" | "publisher">): string {
  const names = b.authors.slice(0, 20).map(apaName);
  const authors = names.length === 0
    ? ""
    : names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
  const title = b.subtitle ? `${b.title}: ${b.subtitle}` : b.title;
  const parts = [
    authors ? `${authors}${authors.endsWith(".") ? "" : "."}` : "",
    `(${b.year ?? "n.d."}).`,
    `${title}${/[.?!]$/.test(title) ? "" : "."}`,
    b.publisher ? `${b.publisher}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Formatting

export const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** "Frank Herbert", "Terry Pratchett & Neil Gaiman", "A, B & 3 others". */
export function byline(authors: string[]): string {
  if (!authors.length) return "Unknown author";
  if (authors.length <= 2) return authors.join(" & ");
  return `${authors[0]}, ${authors[1]} & ${authors.length - 2} other${authors.length === 3 ? "" : "s"}`;
}

const LANGS: Record<string, string> = {
  eng: "English",
  fre: "French",
  ger: "German",
  spa: "Spanish",
  ita: "Italian",
  por: "Portuguese",
  rus: "Russian",
  jpn: "Japanese",
  chi: "Chinese",
  dut: "Dutch",
  pol: "Polish",
  swe: "Swedish",
  ara: "Arabic",
  kor: "Korean",
  tur: "Turkish",
  gre: "Greek",
  heb: "Hebrew",
  cze: "Czech",
  dan: "Danish",
  fin: "Finnish",
  nor: "Norwegian",
  hun: "Hungarian",
};

export const languageNames = (codes: string[]) => codes.map((c) => LANGS[c] ?? c);

/** Reading list order: reading first, then want to read, then read; recent first. */
export function sortSaved(list: Saved[]): Saved[] {
  const order: Record<Status, number> = { reading: 0, want: 1, read: 2 };
  return [...list].sort((a, b) => order[a.status] - order[b.status] || b.updated - a.updated);
}

export function setStatus(list: Saved[], book: Book, status: Status | undefined, now = Date.now()): Saved[] {
  const rest = list.filter((s) => s.book.key !== book.key);
  if (!status) return rest;
  const prev = list.find((s) => s.book.key === book.key);
  return [{ book, status, added: prev?.added ?? now, updated: now }, ...rest];
}
