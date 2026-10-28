// Zotero items from the local API (Zotero 7) or from the zotero.sqlite
// database, and their citations (APA-like and BibTeX). Pure functions.

export const API = "http://127.0.0.1:23119/api";

export interface Creator {
  creatorType: string;
  firstName?: string;
  lastName?: string;
  /** Single-field names: organizations. */
  name?: string;
}

export interface Attachment {
  key: string;
  title: string;
  contentType?: string;
  linkMode?: string;
  /** Absolute path of the file, when it is on this computer. */
  path?: string;
}

export interface ZItem {
  key: string;
  /** Zotero's group id for group libraries; undefined for "My Library". */
  groupId?: number;
  itemType: string;
  title: string;
  creators: Creator[];
  fields: Record<string, string>;
  tags: string[];
  attachments: Attachment[];
  dateAdded?: string;
  dateModified?: string;
}

// --- Mapping -----------------------------------------------------------------

const NOT_FIELDS = new Set([
  "key",
  "version",
  "itemType",
  "creators",
  "tags",
  "collections",
  "relations",
  "dateAdded",
  "dateModified",
  "parentItem",
  "deleted",
]);

/** An item of the local (or web) API, `format=json`. */
export function fromApi(raw: any, children: any[] = [], storageDir = ""): ZItem {
  const d = raw?.data ?? {};
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(d)) {
    if (!NOT_FIELDS.has(k) && typeof v === "string" && v) fields[k] = v;
  }
  const library = raw?.library ?? {};
  return {
    key: String(raw?.key ?? d.key ?? ""),
    groupId: library.type === "group" ? Number(library.id) : undefined,
    itemType: String(d.itemType ?? "document"),
    title: String(d.title ?? d.caseName ?? d.subject ?? d.nameOfAct ?? ""),
    creators: Array.isArray(d.creators) ? d.creators : [],
    fields,
    tags: Array.isArray(d.tags) ? d.tags.map((t: any) => String(t.tag ?? t)).filter(Boolean) : [],
    attachments: children.filter((c) => c?.data?.itemType === "attachment").map((c) =>
      attachmentFrom({
        key: c.key ?? c.data.key,
        title: c.data.title,
        contentType: c.data.contentType,
        linkMode: c.data.linkMode,
        path: c.data.path,
        filename: c.data.filename,
      }, storageDir)
    ),
    dateAdded: d.dateAdded,
    dateModified: d.dateModified,
  };
}

/** Where an attachment's file is: `storage:paper.pdf` and imported files are in `<data dir>/storage/<key>/`. */
export function attachmentFrom(
  a: {
    key: string;
    title?: string;
    contentType?: string;
    linkMode?: string | number;
    path?: string;
    filename?: string;
  },
  storageDir: string,
): Attachment {
  const mode = typeof a.linkMode === "number" ? LINK_MODES[a.linkMode] : a.linkMode;
  let path: string | undefined;
  if (a.path?.startsWith("storage:")) path = `${storageDir}/${a.key}/${a.path.slice(8)}`;
  else if (a.path?.startsWith("/")) path = a.path;
  else if (a.filename && (mode === "imported_file" || mode === "imported_url")) {
    path = `${storageDir}/${a.key}/${a.filename}`;
  }
  return {
    key: a.key,
    title: a.title || a.filename || a.path?.replace(/^storage:/, "") || "Attachment",
    contentType: a.contentType || undefined,
    linkMode: mode,
    path,
  };
}

/** Zotero's `itemAttachments.linkMode` numbers. */
const LINK_MODES = ["imported_file", "imported_url", "linked_file", "linked_url", "embedded_image"];

/** A row of the SQL query in `db.ts` (JSON columns as text, as `sqlite3 -json` prints them). */
export interface DbRow {
  key: string;
  groupID: number | null;
  typeName: string;
  fields: string | null;
  creators: string | null;
  tags: string | null;
  attachments: string | null;
  dateAdded: string;
  dateModified: string;
}

const json = <T>(s: string | null | undefined, fallback: T): T => {
  try {
    return s ? JSON.parse(s) ?? fallback : fallback;
  } catch {
    return fallback;
  }
};

export function fromDb(row: DbRow, storageDir: string): ZItem {
  const fields = json<Record<string, string>>(row.fields, {});
  const creators = json<{ first: string; last: string; mode: number; type: string; i: number }[]>(row.creators, [])
    .sort((a, b) => a.i - b.i)
    .map((c) =>
      c.mode === 1
        ? { creatorType: c.type, name: c.last }
        : { creatorType: c.type, firstName: c.first, lastName: c.last }
    );
  const attachments = json<{ key: string; path: string; contentType: string; linkMode: number; title: string }[]>(
    row.attachments,
    [],
  ).map((a) => attachmentFrom(a, storageDir));
  const title = fields.title ?? fields.caseName ?? fields.subject ?? fields.nameOfAct ?? "";
  return {
    key: row.key,
    groupId: row.groupID ?? undefined,
    itemType: row.typeName,
    title,
    creators,
    fields,
    tags: json<string[]>(row.tags, []).filter(Boolean).sort((a, b) => a.localeCompare(b)),
    attachments,
    dateAdded: row.dateAdded ? `${row.dateAdded.replace(" ", "T")}Z` : undefined,
    dateModified: row.dateModified ? `${row.dateModified.replace(" ", "T")}Z` : undefined,
  };
}

// --- Fields ------------------------------------------------------------------

/** `2019-03-00 March 2019` (Zotero's stored dates), `2019-03-15`, `March 2019` → `2019`. */
export function year(item: Pick<ZItem, "fields">): string | undefined {
  return /\b(1[5-9]\d\d|2\d\d\d)\b/.exec(item.fields.date ?? "")?.[1];
}

/** Where it was published: the journal, book, proceedings, website… */
export function publication(item: Pick<ZItem, "fields" | "itemType">): string | undefined {
  const f = item.fields;
  return f.publicationTitle ?? f.bookTitle ?? f.proceedingsTitle ?? f.websiteTitle ?? f.blogTitle ?? f.forumTitle ??
    f.encyclopediaTitle ?? f.dictionaryTitle ?? f.programTitle ?? f.seriesTitle ??
    (item.itemType === "thesis" ? f.university : undefined) ?? (item.itemType === "book" ? f.publisher : undefined);
}

const TYPE_NAMES: Record<string, string> = {
  journalArticle: "Journal Article",
  bookSection: "Book Section",
  conferencePaper: "Conference Paper",
  webpage: "Web Page",
  blogPost: "Blog Post",
  forumPost: "Forum Post",
  magazineArticle: "Magazine Article",
  newspaperArticle: "Newspaper Article",
  computerProgram: "Software",
  preprint: "Preprint",
  tvBroadcast: "TV Broadcast",
};

export function typeName(t: string): string {
  return TYPE_NAMES[t] ?? t.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}

/** The people credited first: authors, else editors, else whoever comes first. */
export function mainCreators(item: Pick<ZItem, "creators">): Creator[] {
  const pick = (types: string[]) => item.creators.filter((c) => types.includes(c.creatorType));
  const a = pick([
    "author",
    "inventor",
    "artist",
    "director",
    "programmer",
    "podcaster",
    "presenter",
    "sponsor",
    "cartographer",
    "composer",
    "performer",
    "interviewee",
  ]);
  if (a.length) return a;
  const e = pick(["editor"]);
  return e.length ? e : item.creators.slice(0, 1);
}

export const fullName = (c: Creator) => c.name ?? [c.firstName, c.lastName].filter(Boolean).join(" ");

/** "Lovelace", "Lovelace and Babbage", "Lovelace et al.", as Zotero shows them. */
export function creatorSummary(item: Pick<ZItem, "creators">): string {
  const people = mainCreators(item).map((c) => c.lastName || c.name || c.firstName || "").filter(Boolean);
  if (people.length === 0) return "";
  if (people.length === 1) return people[0];
  if (people.length === 2) return `${people[0]} and ${people[1]}`;
  return `${people[0]} et al.`;
}

/** Zotero stores dates as `1843-00-00 1843` (sortable, then as typed): the typed part. */
export function displayDate(date: string | undefined): string | undefined {
  if (!date) return undefined;
  const m = /^\d{4}-\d{2}-\d{2} (.+)$/.exec(date);
  return m ? m[1] : date;
}

// --- Citations ---------------------------------------------------------------

/** `Ada King` → `A. K.`; `Jean-Paul` → `J.-P.` */
export function initials(first: string): string {
  return first.trim().split(/\s+/).filter(Boolean).map((w) =>
    w.split("-").map((p) => (p ? `${[...p][0].toUpperCase()}.` : "")).join("-")
  ).join(" ");
}

function apaName(c: Creator): string {
  if (c.name || !c.lastName) return c.name ?? c.firstName ?? "";
  return c.firstName ? `${c.lastName}, ${initials(c.firstName)}` : c.lastName;
}

/** APA 7: up to 20 names, the last one after “&”; 21+: the first 19, “…”, the last. */
export function apaAuthors(creators: Creator[]): string {
  const names = creators.map(apaName).filter(Boolean);
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length > 20) return `${names.slice(0, 19).join(", ")}, … ${names[names.length - 1]}`;
  return `${names.slice(0, -1).join(", ")}, & ${names[names.length - 1]}`;
}

const end = (s: string) => (/[.?!]$/.test(s) ? s : `${s}.`);

function doiUrl(doi: string | undefined): string | undefined {
  if (!doi) return undefined;
  const clean = doi.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "");
  return `https://doi.org/${clean}`;
}

/**
 * An APA-style reference in plain text, close to what Zotero's APA 7 style
 * gives for the common types (articles, books, chapters, papers, pages).
 */
export function apaCitation(item: ZItem): string {
  const f = item.fields;
  const authors = mainCreators(item);
  const editorsOnly = authors.length > 0 && authors.every((c) => c.creatorType === "editor");
  let who = apaAuthors(authors);
  if (who && editorsOnly) who += authors.length > 1 ? " (Eds.)" : " (Ed.)";
  const y = year(item) ?? "n.d.";
  const title = (item.title || "Untitled").trim();
  const parts: string[] = [];
  const dateText = `(${y}).`;
  if (who) parts.push(end(who), dateText, end(title));
  else parts.push(end(title), dateText);
  const pub = publication(item);
  const pages = f.pages?.replace(/-+/g, "–");
  switch (item.itemType) {
    case "journalArticle":
    case "magazineArticle":
    case "newspaperArticle": {
      let source = pub ?? "";
      if (f.volume) source += `${source ? ", " : ""}${f.volume}`;
      if (f.issue) source += `(${f.issue})`;
      if (pages) source += `${source ? ", " : ""}${pages}`;
      if (source) parts.push(end(source));
      break;
    }
    case "book": {
      if (f.edition && !/^1(st)?$/i.test(f.edition)) {
        parts[parts.length - 1] = `${title} (${ordinalEdition(f.edition)} ed.).`;
      }
      if (f.publisher) parts.push(end(f.publisher));
      break;
    }
    case "bookSection":
    case "encyclopediaArticle":
    case "dictionaryEntry": {
      const editors = item.creators.filter((c) => c.creatorType === "editor");
      const eds = editors.length
        ? `${
          editors.map((c) => [c.firstName ? initials(c.firstName) : "", c.lastName ?? c.name].filter(Boolean).join(" "))
            .join(", ")
        } (${editors.length > 1 ? "Eds." : "Ed."}), `
        : "";
      if (pub) parts.push(`In ${eds}${pub}${pages ? ` (pp. ${pages})` : ""}.`);
      if (f.publisher) parts.push(end(f.publisher));
      break;
    }
    case "conferencePaper": {
      if (pub) parts.push(`${pub}${pages ? ` (pp. ${pages})` : ""}.`);
      if (f.publisher) parts.push(end(f.publisher));
      break;
    }
    case "thesis": {
      const kind = f.thesisType || "Thesis";
      parts[parts.length - 1] = `${title} [${kind}${f.university ? `, ${f.university}` : ""}].`;
      break;
    }
    case "report": {
      if (f.reportNumber) parts[parts.length - 1] = `${title} (${f.reportNumber}).`;
      if (f.institution) parts.push(end(f.institution));
      break;
    }
    default:
      if (pub) parts.push(end(pub));
      else if (f.publisher) parts.push(end(f.publisher));
  }
  const link = doiUrl(f.DOI) ?? f.url;
  if (link) parts.push(link);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function ordinalEdition(e: string): string {
  if (!/^\d+$/.test(e)) return e;
  const n = Number(e);
  const s = n % 100 >= 11 && n % 100 <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${s}`;
}

/** Author-year in the text: `(Lovelace, 1843)`, `(Lovelace & Babbage, 1843)`, `(Lovelace et al., 1843)`. */
export function inTextCitation(item: ZItem): string {
  const people = mainCreators(item).map((c) => c.lastName || c.name || "").filter(Boolean);
  const who = people.length === 0
    ? item.title.split(/\s+/).slice(0, 3).join(" ")
    : people.length === 1
    ? people[0]
    : people.length === 2
    ? `${people[0]} & ${people[1]}`
    : `${people[0]} et al.`;
  return `(${who}, ${year(item) ?? "n.d."})`;
}

const BIBTEX_TYPES: Record<string, string> = {
  journalArticle: "article",
  magazineArticle: "article",
  newspaperArticle: "article",
  book: "book",
  bookSection: "incollection",
  conferencePaper: "inproceedings",
  thesis: "phdthesis",
  report: "techreport",
  manuscript: "unpublished",
  preprint: "misc",
};

/** A citation key: `Citation Key:` in Extra (Better BibTeX), else `lovelace1843sketch`. */
export function citationKey(item: ZItem): string {
  const pinned = item.fields.citationKey ?? /^\s*citation key:\s*(\S+)/im.exec(item.fields.extra ?? "")?.[1];
  if (pinned) return pinned;
  const ascii = (s: string) =>
    s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const first = mainCreators(item)[0];
  const who = ascii(first?.lastName ?? first?.name?.split(/\s+/)[0] ?? "") || "anon";
  const STOP = new Set([
    "a",
    "an",
    "the",
    "on",
    "of",
    "in",
    "and",
    "for",
    "to",
    "le",
    "la",
    "les",
    "un",
    "une",
    "de",
    "der",
    "die",
    "das",
  ]);
  const word = item.title.split(/\s+/).map(ascii).find((w) => w && !STOP.has(w)) ?? "";
  return `${who}${year(item) ?? ""}${word}`;
}

/** Braces for case, and LaTeX's special characters escaped. */
function bibValue(s: string): string {
  return s.replace(/\\/g, "\\textbackslash{}").replace(/([{}&%$#_])/g, "\\$1").replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

const bibName = (c: Creator) =>
  c.name ? `{${bibValue(c.name)}}` : [c.lastName, c.firstName].filter(Boolean).map((s) => bibValue(s!)).join(", ");

export function bibtex(item: ZItem): string {
  const f = item.fields;
  const type = item.itemType === "thesis" && /master/i.test(f.thesisType ?? "")
    ? "mastersthesis"
    : BIBTEX_TYPES[item.itemType] ?? "misc";
  const authors = item.creators.filter((c) => c.creatorType !== "editor" && c.creatorType !== "seriesEditor");
  const editors = item.creators.filter((c) => c.creatorType === "editor");
  const pub = publication(item);
  const entries: [string, string | undefined][] = [
    ["title", item.title ? `{${bibValue(item.title)}}` : undefined],
    ["author", authors.length ? authors.map(bibName).join(" and ") : undefined],
    ["editor", editors.length ? editors.map(bibName).join(" and ") : undefined],
    [
      type === "article"
        ? "journal"
        : type === "incollection" || type === "inproceedings"
        ? "booktitle"
        : "howpublished",
      type === "book" || type.endsWith("thesis") ? undefined : pub,
    ],
    ["year", year(item)],
    ["volume", f.volume],
    ["number", f.issue ?? f.reportNumber],
    ["pages", f.pages?.replace(/[–—-]+/g, "--")],
    ["edition", f.edition],
    ["publisher", f.publisher],
    ["address", f.place],
    ["school", type.endsWith("thesis") ? f.university : undefined],
    ["institution", type === "techreport" ? f.institution : undefined],
    ["doi", f.DOI],
    ["isbn", f.ISBN],
    ["issn", f.ISSN],
    ["url", f.url],
    ["urldate", f.accessDate?.slice(0, 10)],
    ["keywords", item.tags.length ? item.tags.join(", ") : undefined],
  ];
  const lines = entries
    .filter(([, v]) => v)
    .map(([k, v]) =>
      `  ${k} = {${
        k === "url" || k === "doi" ? v : k === "title" || k === "author" || k === "editor" ? v : bibValue(v!)
      }},`
    );
  return `@${type}{${citationKey(item)},\n${lines.join("\n")}\n}`;
}

// --- Searching (database mode) ----------------------------------------------

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Every word must match the title, a creator, the year, a tag or the
 * publication; `#word` must match a tag. Title matches rank first.
 */
export function matchScore(item: ZItem, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  const title = fold(item.title);
  const people = fold(item.creators.map(fullName).join(" "));
  const tags = item.tags.map(fold);
  const rest = fold([year(item), publication(item), item.fields.DOI, citationKey(item)].filter(Boolean).join(" "));
  let score = 0;
  for (const w of words) {
    if (w.startsWith("#")) {
      const t = w.slice(1);
      if (!t) continue;
      if (tags.some((x) => x === t)) score += 4;
      else if (tags.some((x) => x.startsWith(t))) score += 2;
      else return 0;
    } else if (new RegExp(`(^|\\W)${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(title)) score += 5;
    else if (title.includes(w)) score += 3;
    else if (people.includes(w)) score += 4;
    else if (tags.some((x) => x.includes(w))) score += 2;
    else if (rest.includes(w)) score += 1;
    else return 0;
  }
  return score;
}

export function search(items: ZItem[], query: string, limit = 50): ZItem[] {
  if (!query.trim()) {
    return [...items].sort((a, b) => (b.dateAdded ?? "").localeCompare(a.dateAdded ?? "")).slice(0, limit);
  }
  return items
    .map((item) => ({ item, s: matchScore(item, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.item.dateModified ?? "").localeCompare(a.item.dateModified ?? ""))
    .slice(0, limit)
    .map((x) => x.item);
}

/** Local API parameters for what is typed: `#tag` words become tag filters. */
export function apiParams(query: string): Record<string, string | string[]> {
  const words = query.trim().split(/\s+/).filter(Boolean);
  const tags = words.filter((w) => w.startsWith("#") && w.length > 1).map((w) => w.slice(1));
  const text = words.filter((w) => !w.startsWith("#")).join(" ");
  const params: Record<string, string | string[]> = { format: "json", limit: "40", itemType: "-attachment" };
  if (text) Object.assign(params, { q: text, qmode: "titleCreatorYear", sort: "dateModified", direction: "desc" });
  else Object.assign(params, { sort: "dateAdded", direction: "desc" });
  if (tags.length) params.tag = tags;
  return params;
}

// --- Links -------------------------------------------------------------------

export function selectUrl(item: Pick<ZItem, "key" | "groupId">): string {
  return item.groupId
    ? `zotero://select/groups/${item.groupId}/items/${item.key}`
    : `zotero://select/library/items/${item.key}`;
}

export function openPdfUrl(item: Pick<ZItem, "groupId">, attachment: Pick<Attachment, "key">): string {
  return item.groupId
    ? `zotero://open-pdf/groups/${item.groupId}/items/${attachment.key}`
    : `zotero://open-pdf/library/items/${attachment.key}`;
}

/** The PDF to open: the first one with a file, else the first PDF. */
export function mainPdf(item: Pick<ZItem, "attachments">): Attachment | undefined {
  const pdfs = item.attachments.filter((a) => a.contentType === "application/pdf" || /\.pdf$/i.test(a.path ?? ""));
  return pdfs.find((a) => a.path) ?? pdfs[0];
}

export { doiUrl };
