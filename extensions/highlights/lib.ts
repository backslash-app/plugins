// Highlights from Readwise, Kindle's My Clippings.txt and Hypothes.is in one
// shape, the clippings parser, and citations. No network or files here.

import { Icons, type Item, open } from "@backslash/api";

export type Source = "readwise" | "kindle" | "hypothesis";
export const SOURCE_NAMES: Record<Source, string> = {
  readwise: "Readwise",
  kindle: "Kindle",
  hypothesis: "Hypothes.is",
};

export interface Highlight {
  /** Unique across sources: "readwise:123", "kindle:k3f9a", "hypothesis:AbC". */
  id: string;
  source: Source;
  text: string;
  note?: string;
  /** The book, article or page. */
  title: string;
  author?: string;
  page?: string;
  location?: string;
  /** ISO date, or a local "YYYY-MM-DDTHH:MM:SS" for Kindle. */
  date?: string;
  /** Where Open goes: Readwise, Hypothes.is in context. */
  url?: string;
  /** The original article or page, when there is one. */
  sourceUrl?: string;
  tags: string[];
  /** books, articles, tweets, podcasts, supplementals (Readwise). */
  category?: string;
  favorite?: boolean;
  color?: string;
  /** Position inside the book, to read highlights in order. */
  order?: number;
}

export class SetupError extends Error {}

// ---------------------------------------------------------------------------
// Kindle: My Clippings.txt
//
// Each clipping is 4+ lines followed by "==========":
//
//   The Pragmatic Programmer (David Thomas;Andrew Hunt)
//   - Your Highlight on page 12 | Location 170-172 | Added on Sunday, 3 March 2024 10:15:32
//
//   The text of the highlight
//   ==========
//
// The second line is in the Kindle's language; older Kindles write
// "- Highlight Loc. 170-72  | Added on …".

export interface Clipping {
  title: string;
  author?: string;
  kind: "highlight" | "note" | "bookmark" | "clip";
  page?: string;
  /** Start and end of the location range. */
  start?: number;
  end?: number;
  date?: string;
  text: string;
  /** Position in the file. */
  index: number;
}

const KINDS: [RegExp, Clipping["kind"]][] = [
  [/highlight|surlignement|markierung|subrayado|evidenziazione|destaque|markering|ハイライト|标注/i, "highlight"],
  [/bookmark|signet|lesezeichen|marcador|segnalibro|bladwijzer|ブックマーク|书签/i, "bookmark"],
  [/\bnote\b|notiz|\bnota\b|notitie|メモ|笔记/i, "note"],
  [/clip|article/i, "clip"],
];

const MONTHS: Record<string, number> = {};
[
  ["january", "jan", "janvier", "janv", "januar", "jänner", "enero", "gennaio", "janeiro", "januari"],
  ["february", "feb", "février", "fevrier", "févr", "februar", "febrero", "febbraio", "fevereiro", "februari"],
  ["march", "mar", "mars", "märz", "marz", "marzo", "março", "maart"],
  ["april", "apr", "avril", "abril", "aprile"],
  ["may", "mai", "mayo", "maggio", "maio", "mei"],
  ["june", "jun", "juin", "juni", "junio", "giugno", "junho"],
  ["july", "jul", "juillet", "juil", "juli", "julio", "luglio", "julho"],
  ["august", "aug", "août", "aout", "agosto", "augustus"],
  ["september", "sep", "sept", "septembre", "septiembre", "settembre", "setembro"],
  ["october", "oct", "octobre", "oktober", "octubre", "ottobre", "outubro"],
  ["november", "nov", "novembre", "noviembre", "novembro"],
  ["december", "dec", "décembre", "decembre", "dezember", "diciembre", "dicembre", "dezembro"],
].forEach((names, i) => names.forEach((n) => (MONTHS[n] = i + 1)));

const pad = (n: number) => String(n).padStart(2, "0");

/** "Sunday, 3 March 2024 10:15:32", "Thursday, March 7, 2024 9:15:32 PM", "dimanche 3 mars 2024 10:15:32" → local ISO. */
export function parseKindleDate(input: string): string | undefined {
  const s = input.toLowerCase().replace(/ /g, " ");
  // Japanese and Chinese: 2024年3月7日 21:15:32
  const cjk = /(\d{4})年(\d{1,2})月(\d{1,2})日[^\d]*(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(s);
  let year: number, month: number | undefined, day: number | undefined;
  let hour = 0, minute = 0, second = 0;
  if (cjk) {
    [year, month, day] = [Number(cjk[1]), Number(cjk[2]), Number(cjk[3])];
    [hour, minute, second] = [Number(cjk[4]), Number(cjk[5]), Number(cjk[6] ?? 0)];
  } else {
    const y = /\b(\d{4})\b/.exec(s);
    if (!y) return undefined;
    year = Number(y[1]);
    for (const word of s.match(/[a-zà-ÿ]+\.?/g) ?? []) {
      const m = MONTHS[word.replace(/\.$/, "")];
      if (m) {
        month = m;
        break;
      }
    }
    const time = /(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/.exec(s);
    if (time) {
      hour = Number(time[1]);
      minute = Number(time[2]);
      second = Number(time[3] ?? 0);
      const ampm = time[4]?.replace(/\./g, "");
      if (ampm === "pm" && hour < 12) hour += 12;
      if (ampm === "am" && hour === 12) hour = 0;
    }
    const noTime = time ? s.replace(time[0], " ") : s;
    const d = /(?:^|[^\d:])(\d{1,2})(?:st|nd|rd|th|er|\.)?(?![\d:])/.exec(noTime.replace(String(year), " "));
    day = d ? Number(d[1]) : undefined;
    if (!month) {
      // 03/07/2024 or 2024-03-07: numbers only.
      const iso = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
      if (iso) [month, day] = [Number(iso[2]), Number(iso[3])];
    }
  }
  if (!month || !day || day > 31 || month > 12) return undefined;
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/** "170-72" → [170, 172]; "1520" → [1520, 1520]. */
export function locationRange(text: string): [number, number] | undefined {
  const m = /(\d+)(?:\s*-\s*(\d+))?/.exec(text);
  if (!m) return undefined;
  const start = Number(m[1]);
  if (!m[2]) return [start, start];
  let end = m[2];
  // Old Kindles shorten the end: 1520-24 means 1520-1524.
  if (end.length < m[1].length) end = m[1].slice(0, m[1].length - end.length) + end;
  return [start, Math.max(start, Number(end))];
}

/** "David Thomas;Andrew Hunt" → "David Thomas, Andrew Hunt"; "Orwell, George" → "George Orwell". */
export function cleanAuthor(raw: string): string {
  return raw.split(/\s*;\s*|\s+&\s+/).filter(Boolean).map((a) => {
    const m = /^([^,]+),\s*([^,]+)$/.exec(a.trim());
    return m ? `${m[2]} ${m[1]}` : a.trim();
  }).join(", ");
}

/** "Title (Series 2) (Author)" → title and author: the last group in parentheses is the author. */
export function splitTitle(line: string): { title: string; author?: string } {
  const s = line.replace(/^﻿/, "").trim();
  const m = /^(.*\S)\s*\(([^()]+)\)$/.exec(s);
  if (!m || /^\s*(?:book|vol(?:ume)?|tome|band|#)?\s*\d+\s*$/i.test(m[2])) return { title: s || "Untitled" };
  return { title: m[1].trim(), author: cleanAuthor(m[2]) };
}

const LIMIT_RE = /^<.*(?:clipping limit|limite d'extraits|limite de|Clip-Limit|límite).*>$/i;

export function parseClippings(text: string): Clipping[] {
  const out: Clipping[] = [];
  const entries = text.replace(/\r\n?/g, "\n").replace(/﻿/g, "").split(/^={6,}\s*$/m);
  entries.forEach((entry, index) => {
    const lines = entry.split("\n");
    while (lines.length && !lines[0].trim()) lines.shift();
    if (lines.length < 2) return;
    const head = lines[0], info = lines[1];
    if (!/^\s*-\s/.test(info)) return;
    const body = lines.slice(2).join("\n").trim();
    const parts = info.replace(/^\s*-\s*/, "").split("|").map((p) => p.trim());
    const first = parts[0] ?? "";
    const kind = KINDS.find(([re]) => re.test(first))?.[1] ?? "highlight";
    const pageMatch = /(?:page|seite|página|pagina|pag\.|стр|ページ|第)\s*([\divxlcdm]+(?:-[\divxlcdm]+)?)/i.exec(info);
    const locPart = parts.find((p) =>
      /(?:location|loc\.|emplacement|position|posición|posizione|posição|positie|位置|Pos\.)/i.test(p)
    );
    const range = locPart
      ? locationRange(
        locPart.replace(
          /^.*?(?:location|loc\.|emplacement|position|posición|posizione|posição|positie|位置|Pos\.)/i,
          "",
        ),
      )
      : undefined;
    // The date is always last: "Added on …" in the Kindle's language.
    const datePart = parts.length > 1 ? parts[parts.length - 1] : "";
    const { title, author } = splitTitle(head);
    if (kind !== "bookmark" && (!body || LIMIT_RE.test(body))) return;
    out.push({
      title,
      author,
      kind,
      page: pageMatch?.[1],
      start: range?.[0],
      end: range?.[1],
      date: parseKindleDate(
        datePart.replace(
          /^.*?(?:added on|ajouté le|hinzugefügt am|añadido el|aggiunto in data|adicionado em|toegevoegd op)\s*/i,
          "",
        ),
      ),
      text: body,
      index,
    });
  });
  return out;
}

/** A short stable id for a string. */
export function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const overlaps = (a: Clipping, b: Clipping) =>
  a.start !== undefined && b.start !== undefined && a.end !== undefined && b.end !== undefined &&
  a.start <= b.end && b.start <= a.end;

/**
 * Highlights with their notes, without the stale copies Kindle leaves when a
 * highlight is extended or shortened (the latest one wins), bookmarks dropped.
 */
export function kindleHighlights(clips: Clipping[]): Highlight[] {
  const highlights = clips.filter((c) => c.kind === "highlight" || c.kind === "clip");
  const kept: Clipping[] = [];
  for (const c of highlights) {
    const i = kept.findIndex((k) =>
      k.title === c.title && overlaps(k, c) && (k.text.includes(c.text) || c.text.includes(k.text))
    );
    if (i >= 0) kept[i] = c; // later in the file: the edited one
    else kept.push(c);
  }
  const notes = clips.filter((c) => c.kind === "note");
  const used = new Set<Clipping>();
  const out: Highlight[] = kept.map((c) => {
    // A note sits at the end location of the highlight it belongs to.
    const note = notes.find((n) =>
      !used.has(n) && n.title === c.title && n.start !== undefined && c.start !== undefined && c.end !== undefined &&
      n.start >= c.start && n.start <= c.end
    );
    if (note) used.add(note);
    return fromClipping(c, note?.text);
  });
  // Notes on their own (no highlight there) are kept as highlights of their own.
  for (const n of notes) {
    if (!used.has(n)) out.push({ ...fromClipping(n, undefined), text: n.text, note: undefined, tags: ["note"] });
  }
  return out;
}

function fromClipping(c: Clipping, note: string | undefined): Highlight {
  const loc = c.start === undefined ? undefined : c.end && c.end !== c.start ? `${c.start}-${c.end}` : String(c.start);
  return {
    id: `kindle:${hash(`${c.title}|${loc ?? c.page ?? ""}|${c.text}`)}`,
    source: "kindle",
    text: c.text,
    note: note?.trim() || undefined,
    title: c.title,
    author: c.author,
    page: c.page,
    location: loc,
    date: c.date,
    tags: [],
    category: "books",
    order: c.start ?? (c.page ? Number.parseInt(c.page) || undefined : undefined) ?? c.index,
  };
}

// ---------------------------------------------------------------------------
// Readwise: GET /api/v2/export/

export interface ReadwiseHighlight {
  id: number;
  text: string;
  location?: number | null;
  location_type?: string | null;
  note?: string | null;
  color?: string | null;
  highlighted_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  url?: string | null;
  tags?: { id?: number; name: string }[];
  is_favorite?: boolean;
  is_discard?: boolean;
  is_deleted?: boolean;
  readwise_url?: string | null;
}

export interface ReadwiseBook {
  user_book_id: number;
  title: string;
  readable_title?: string | null;
  author?: string | null;
  source?: string | null;
  category?: string | null;
  source_url?: string | null;
  unique_url?: string | null;
  readwise_url?: string | null;
  book_tags?: { name: string }[];
  highlights: ReadwiseHighlight[];
}

export function fromReadwise(books: ReadwiseBook[]): { keep: Highlight[]; drop: string[] } {
  const keep: Highlight[] = [];
  const drop: string[] = [];
  for (const b of books) {
    for (const h of b.highlights) {
      const id = `readwise:${h.id}`;
      if (h.is_discard || h.is_deleted || !h.text?.trim()) {
        drop.push(id);
        continue;
      }
      const type = h.location_type ?? "";
      const loc = h.location ?? undefined;
      keep.push({
        id,
        source: "readwise",
        text: h.text.trim(),
        note: h.note?.trim() || undefined,
        title: b.readable_title || b.title || "Untitled",
        author: b.author?.trim() || undefined,
        page: type === "page" && loc !== undefined ? String(loc) : undefined,
        location: type === "location" && loc !== undefined ? String(loc) : undefined,
        date: h.highlighted_at ?? h.created_at ?? undefined,
        url: h.readwise_url ?? `https://readwise.io/open/${h.id}`,
        sourceUrl: h.url || b.source_url || b.unique_url || undefined,
        tags: (h.tags ?? []).map((t) => t.name).filter((t) => !/^(favorite|discard)$/i.test(t)),
        category: b.category ?? undefined,
        favorite: h.is_favorite || undefined,
        color: h.color || undefined,
        order: typeof loc === "number" ? loc : undefined,
      });
    }
  }
  return { keep, drop };
}

/** Last sync's highlights updated with what changed since. */
export function mergeHighlights(old: Highlight[], update: { keep: Highlight[]; drop: string[] }): Highlight[] {
  const by = new Map(old.map((h) => [h.id, h]));
  for (const id of update.drop) by.delete(id);
  for (const h of update.keep) by.set(h.id, h);
  return [...by.values()];
}

// ---------------------------------------------------------------------------
// Hypothes.is: GET /api/search

export interface HypothesisRow {
  id: string;
  created: string;
  updated?: string;
  user: string;
  uri: string;
  text?: string;
  tags?: string[];
  references?: string[];
  target?: { source?: string; selector?: { type: string; exact?: string; start?: number }[] }[];
  document?: { title?: string[] };
  links?: { html?: string; incontext?: string };
}

/** "acct:ada@hypothes.is", "ada", "@ada" → "acct:ada@hypothes.is". */
export function hypothesisAccount(user: string): string | undefined {
  const u = user.trim().replace(/^@/, "");
  if (!u) return undefined;
  if (/^acct:/.test(u)) return u;
  if (u.includes("@")) return `acct:${u}`;
  return `acct:${u}@hypothes.is`;
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

export function fromHypothesis(rows: HypothesisRow[]): Highlight[] {
  const out: Highlight[] = [];
  for (const r of rows) {
    if (r.references?.length) continue; // a reply in a thread
    const selectors = r.target?.flatMap((t) => t.selector ?? []) ?? [];
    const quote = selectors.find((s) => s.type === "TextQuoteSelector")?.exact?.trim();
    const note = r.text?.trim();
    if (!quote && !note) continue;
    const position = selectors.find((s) => s.type === "TextPositionSelector")?.start;
    out.push({
      id: `hypothesis:${r.id}`,
      source: "hypothesis",
      text: quote ?? note!,
      note: quote ? note || undefined : undefined,
      title: r.document?.title?.[0]?.trim() || hostOf(r.uri),
      author: undefined,
      date: r.created,
      url: r.links?.incontext ?? r.links?.html ?? `https://hyp.is/${r.id}`,
      sourceUrl: /^https?:/.test(r.uri) ? r.uri : undefined,
      tags: r.tags ?? [],
      category: quote ? "articles" : "notes",
      order: position,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Showing and citing

/** One line for the list. */
export function oneLine(text: string, max = 140): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** "p. 12", "loc. 170-172", "p. 12 · loc. 170-172". */
export function whereIn(h: Highlight): string {
  return [h.page ? `p. ${h.page}` : "", h.location ? `loc. ${h.location}` : ""].filter(Boolean).join(" · ");
}

/** “Text” — Author, Title, p. 12. */
export function citation(h: Highlight): string {
  const page = h.page ? `p. ${h.page}` : h.location ? `loc. ${h.location}` : "";
  const ref = [h.author, h.title, page].filter(Boolean).join(", ");
  const link = h.sourceUrl && h.category !== "books" ? ` ${h.sourceUrl}` : "";
  return `“${h.text.trim()}”\n— ${ref}${link}`;
}

/** A Markdown block quote with its source, linked when there is a link. */
export function markdownQuote(h: Highlight): string {
  const quote = h.text.trim().split("\n").map((l) => `> ${l}`).join("\n");
  const title = h.sourceUrl ? `[${h.title}](${h.sourceUrl})` : `*${h.title}*`;
  const ref = [h.author, title, h.page ? `p. ${h.page}` : h.location ? `loc. ${h.location}` : ""].filter(Boolean)
    .join(", ");
  return `${quote}\n>\n> — ${ref}${h.note ? `\n\n${h.note}` : ""}`;
}

export function highlightMarkdown(h: Highlight): string {
  const lines = [h.text.trim().split("\n").map((l) => `> ${l}`).join("\n")];
  if (h.note) lines.push("", `**Note:** ${h.note}`);
  lines.push("", `— ${[h.author, `*${h.title}*`].filter(Boolean).join(", ")}${whereIn(h) ? ` (${whereIn(h)})` : ""}`);
  return lines.join("\n");
}

export function iconOf(
  h: Pick<Highlight, "source" | "category">,
): { source: string; tint: "blue" | "orange" | "green" | "purple" | "gray" | "teal" } {
  if (h.source === "hypothesis") return { source: h.category === "notes" ? Icons.note : Icons.globe, tint: "purple" };
  switch (h.category) {
    case "articles":
      return { source: Icons.file, tint: "blue" };
    case "tweets":
      return { source: Icons.comment, tint: "teal" };
    case "podcasts":
      return { source: Icons.headphones, tint: "green" };
    default:
      return { source: Icons.book, tint: h.source === "kindle" ? "orange" : "blue" };
  }
}

/** Newest first; undated ones last, in their file order. */
export function newestFirst(list: Highlight[]): Highlight[] {
  return [...list].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || (b.order ?? 0) - (a.order ?? 0));
}

/** "3d", "2mo", "1y". */
export function age(date: string | undefined, now = Date.now()): string {
  if (!date) return "";
  const t = Date.parse(date);
  if (Number.isNaN(t)) return "";
  const days = Math.floor((now - t) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export interface Book {
  key: string;
  source: Source;
  title: string;
  author?: string;
  category?: string;
  sourceUrl?: string;
  count: number;
  last?: string;
  highlights: Highlight[];
}

/** Highlights by book (and source), the most recently highlighted first; each book's highlights in reading order. */
export function byBook(list: Highlight[]): Book[] {
  const books = new Map<string, Book>();
  for (const h of list) {
    const key = `${h.source}:${h.title}`;
    let b = books.get(key);
    if (!b) {
      b = { key, source: h.source, title: h.title, author: h.author, category: h.category, count: 0, highlights: [] };
      books.set(key, b);
    }
    b.count++;
    b.highlights.push(h);
    b.author ??= h.author;
    if (h.category !== "books") b.sourceUrl ??= h.sourceUrl;
    if (h.date && (!b.last || h.date > b.last)) b.last = h.date;
  }
  for (const b of books.values()) {
    b.highlights.sort((x, y) => (x.order ?? 0) - (y.order ?? 0) || (x.date ?? "").localeCompare(y.date ?? ""));
  }
  return [...books.values()].sort((a, b) =>
    (b.last ?? "").localeCompare(a.last ?? "") || a.title.localeCompare(b.title)
  );
}

/** Every highlight of a book as Markdown, to paste in notes. */
export function bookMarkdown(b: Book): string {
  return [
    `# ${b.title}`,
    ...(b.author ? ["", `*${b.author}*`] : []),
    "",
    ...b.highlights.flatMap((h) => [
      h.text.trim().split("\n").map((l) => `> ${l}`).join("\n"),
      ...(whereIn(h) ? [`> — ${whereIn(h)}`] : []),
      ...(h.note ? ["", h.note] : []),
      "",
    ]),
  ].join("\n").trim() + "\n";
}

// ---------------------------------------------------------------------------
// Files

export const expandHome = (path: string, home: string) => path.replace(/^~(?=\/|$)/, home);

/** Where a Kindle and its clippings usually are, then the copies people keep. */
export function clippingCandidates(home: string, user: string, mounts: string[] = []): string[] {
  return [
    ...mounts.map((m) => `${m}/documents/My Clippings.txt`),
    `/run/media/${user}/Kindle/documents/My Clippings.txt`,
    `/media/${user}/Kindle/documents/My Clippings.txt`,
    `${home}/My Clippings.txt`,
    `${home}/Documents/My Clippings.txt`,
    `${home}/Downloads/My Clippings.txt`,
  ].filter((p, i, all) => all.indexOf(p) === i);
}

// ---------------------------------------------------------------------------
// Setup

export function setupItem(message = "Connect a source of highlights"): Item {
  return {
    id: "setup",
    title: message,
    subtitle: "Readwise, Kindle or Hypothes.is",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        `## ${message}`,
        "",
        "Any of these, in **Settings → Extensions → Highlights → Configure**:",
        "",
        "**Readwise**: your access token from **readwise.io/access_token** (Enter opens it).",
        "",
        "**Kindle**: plug it in (its *My Clippings.txt* is found on its own), or copy that file to your",
        "home folder, *Documents* or *Downloads*. Highlights stay searchable once the Kindle is unplugged.",
        "",
        "**Hypothes.is**: your username for public annotations, and a token from",
        "**hypothes.is/account/developer** for private ones too.",
      ].join("\n"),
    },
    actions: [
      open("https://readwise.io/access_token", "Get a Readwise Token", { icon: Icons.key }),
      open("https://hypothes.is/account/developer", "Get a Hypothes.is Token", { icon: Icons.key }),
    ],
  };
}
