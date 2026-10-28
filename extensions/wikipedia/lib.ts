// Wikipedia URLs, response mapping and plain text → markdown. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Languages

/** Languages whose hosts are listed exactly in the manifest, so their pictures show. */
export const LANGUAGES: Record<string, string> = {
  en: "English",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  it: "Italiano",
  pt: "Português",
  nl: "Nederlands",
  pl: "Polski",
  ja: "日本語",
  zh: "中文",
  ru: "Русский",
  sv: "Svenska",
  uk: "Українська",
  ar: "العربية",
  ca: "Català",
  cs: "Čeština",
  fi: "Suomi",
  ko: "한국어",
  no: "Norsk",
  tr: "Türkçe",
  vi: "Tiếng Việt",
  he: "עברית",
  id: "Bahasa Indonesia",
  fa: "فارسی",
  simple: "Simple English",
};

/** A Wikipedia language code: "en", "fr", "zh-yue", "simple". */
export const isLanguage = (code: string) => /^[a-z]{2,3}(?:-[a-z]{2,8})*$|^simple$/.test(code);

/** The preference, else the locale ("fr_FR.UTF-8" → "fr"), else English. */
export function preferredLanguage(pref: string | undefined, locale: string | undefined): string {
  const p = (pref ?? "").trim().toLowerCase();
  if (p && isLanguage(p)) return p;
  const l = (locale ?? "").toLowerCase().match(/^([a-z]{2,3})(?:[_.@-]|$)/)?.[1];
  return l && l !== "c" && isLanguage(l) ? l : "en";
}

/** "fr: Tour Eiffel", "de:Berlin" → the language and the rest. */
export function splitLanguage(query: string, fallback: string): { lang: string; text: string; override: boolean } {
  const m = query.match(/^\s*([a-z]{2,3}(?:-[a-z]{2,8})?|simple)\s*:\s*(.*)$/i);
  if (m && isLanguage(m[1].toLowerCase())) return { lang: m[1].toLowerCase(), text: m[2].trim(), override: true };
  return { lang: fallback, text: query.trim(), override: false };
}

export const languageName = (code: string) => LANGUAGES[code] ?? code;

// ---------------------------------------------------------------------------
// URLs

export const host = (lang: string) => `${lang}.wikipedia.org`;

/** A title as it appears in URLs: underscores, percent-encoded. */
export const titleKey = (title: string) => encodeURIComponent(title.replace(/ /g, "_"));

export const pageUrl = (lang: string, title: string) => `https://${host(lang)}/wiki/${titleKey(title)}`;

const COMMON = { action: "query", format: "json", formatversion: "2", redirects: "1", origin: "*" };

/** One request: search results with their intro, picture and description. */
export function searchUrl(lang: string, text: string, limit = 12): string {
  const p = new URLSearchParams({
    ...COMMON,
    generator: "search",
    gsrsearch: text,
    gsrlimit: String(limit),
    gsrnamespace: "0",
    prop: "extracts|pageimages|description|info",
    exintro: "1",
    explaintext: "1",
    exlimit: String(limit),
    piprop: "thumbnail",
    pithumbsize: "480",
    pilicense: "any",
    pilimit: String(limit),
    inprop: "url",
  });
  return `https://${host(lang)}/w/api.php?${p}`;
}

/** The whole article as plain text with "== Section ==" headings. */
export function articleUrl(lang: string, title: string): string {
  const p = new URLSearchParams({
    ...COMMON,
    titles: title,
    prop: "extracts|pageimages|description|info",
    explaintext: "1",
    exsectionformat: "wiki",
    piprop: "thumbnail",
    pithumbsize: "640",
    pilicense: "any",
    inprop: "url",
  });
  return `https://${host(lang)}/w/api.php?${p}`;
}

/** The same article in other languages. */
export function langLinksUrl(lang: string, title: string): string {
  const p = new URLSearchParams({
    ...COMMON,
    titles: title,
    prop: "langlinks",
    lllimit: "500",
    llprop: "url|autonym",
  });
  return `https://${host(lang)}/w/api.php?${p}`;
}

export const randomUrl = (lang: string) => `https://${host(lang)}/api/rest_v1/page/random/summary`;
export const summaryUrl = (lang: string, title: string) =>
  `https://${host(lang)}/api/rest_v1/page/summary/${titleKey(title)}`;
export const onThisDayUrl = (lang: string, date: Date) =>
  `https://${host(lang)}/api/rest_v1/feed/onthisday/all/${String(date.getMonth() + 1).padStart(2, "0")}/${
    String(date.getDate()).padStart(2, "0")
  }`;

/** Languages with an "On this day" feed. */
export const ON_THIS_DAY = ["en", "de", "fr", "sv", "pt", "ru", "es", "ar", "bs", "uk", "it", "tr", "zh"];

// ---------------------------------------------------------------------------
// Pages

export interface Page {
  lang: string;
  title: string;
  description?: string;
  extract: string;
  url: string;
  image?: { url: string; width?: number; height?: number };
  /** Size of the wikitext in bytes. */
  length?: number;
  /** ISO date of the last edit. */
  edited?: string;
  disambiguation?: boolean;
  coordinates?: { lat: number; lon: number };
}

/** "//upload.wikimedia.org/…" → "https://upload.wikimedia.org/…". */
export const absolute = (url: string | undefined) => (url?.startsWith("//") ? `https:${url}` : url);

interface ApiPage {
  pageid?: number;
  title: string;
  index?: number;
  missing?: boolean;
  invalid?: boolean;
  extract?: string;
  description?: string;
  thumbnail?: { source: string; width?: number; height?: number };
  fullurl?: string;
  canonicalurl?: string;
  length?: number;
  touched?: string;
  pageprops?: Record<string, string>;
}

function fromApi(lang: string, p: ApiPage): Page {
  return {
    lang,
    title: p.title,
    description: p.description || undefined,
    extract: (p.extract ?? "").trim(),
    url: p.canonicalurl ?? p.fullurl ?? pageUrl(lang, p.title),
    image: p.thumbnail
      ? { url: absolute(p.thumbnail.source)!, width: p.thumbnail.width, height: p.thumbnail.height }
      : undefined,
    length: p.length,
    edited: p.touched,
    disambiguation: /disambiguation|homonymie|begriffsklärung|desambiguación|disambigua/i.test(p.description ?? "") ||
      undefined,
  };
}

/** `action=query&generator=search` → pages in search order. */
export function parseSearch(lang: string, json: unknown): Page[] {
  const pages = ((json as { query?: { pages?: ApiPage[] } }).query?.pages ?? [])
    .filter((p) => !p.missing && !p.invalid);
  return pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map((p) => fromApi(lang, p));
}

/** `action=query&titles=…&prop=extracts` → the page, if it exists. */
export function parseArticle(lang: string, json: unknown): Page | undefined {
  const p = (json as { query?: { pages?: ApiPage[] } }).query?.pages?.[0];
  return p && !p.missing && !p.invalid ? fromApi(lang, p) : undefined;
}

export interface LangLink {
  lang: string;
  title: string;
  url: string;
  autonym?: string;
}

export function parseLangLinks(json: unknown): LangLink[] {
  const p = (json as {
    query?: { pages?: { langlinks?: { lang: string; title: string; url?: string; autonym?: string }[] }[] };
  })
    .query?.pages?.[0];
  return (p?.langlinks ?? []).map((l) => ({
    lang: l.lang,
    title: l.title,
    url: l.url ?? pageUrl(l.lang, l.title),
    autonym: l.autonym,
  }));
}

/** Known languages first, in the order of {@link LANGUAGES}, then the rest by code. */
export function sortLangLinks(links: LangLink[], first: string[] = []): LangLink[] {
  const order = [...first, ...Object.keys(LANGUAGES)];
  const rank = (l: LangLink) => {
    const i = order.indexOf(l.lang);
    return i === -1 ? order.length : i;
  };
  return [...links].sort((a, b) => rank(a) - rank(b) || a.lang.localeCompare(b.lang));
}

interface RestSummary {
  type?: string;
  title: string;
  titles?: { normalized?: string; display?: string };
  description?: string;
  extract?: string;
  thumbnail?: { source: string; width?: number; height?: number };
  originalimage?: { source: string; width?: number; height?: number };
  content_urls?: { desktop?: { page?: string } };
  timestamp?: string;
  coordinates?: { lat: number; lon: number };
  lang?: string;
}

/** A REST `page/summary` (also what `page/random/summary` and the feeds return). */
export function parseSummary(lang: string, s: RestSummary): Page {
  const title = s.titles?.normalized ?? s.title.replace(/_/g, " ");
  return {
    lang: s.lang ?? lang,
    title,
    description: s.description || undefined,
    extract: (s.extract ?? "").trim(),
    url: s.content_urls?.desktop?.page ?? pageUrl(lang, title),
    image: s.thumbnail ? { url: s.thumbnail.source, width: s.thumbnail.width, height: s.thumbnail.height } : undefined,
    edited: s.timestamp,
    disambiguation: s.type === "disambiguation" || undefined,
    coordinates: s.coordinates,
  };
}

// ---------------------------------------------------------------------------
// On this day

export type DayKind = "selected" | "events" | "births" | "deaths" | "holidays";

export interface DayEntry {
  kind: DayKind;
  text: string;
  year?: number;
  pages: Page[];
}

export function parseOnThisDay(lang: string, json: unknown): DayEntry[] {
  const j = json as Partial<Record<DayKind, { text: string; year?: number; pages?: RestSummary[] }[]>>;
  const kinds: DayKind[] = ["selected", "events", "births", "deaths", "holidays"];
  return kinds.flatMap((kind) =>
    (j[kind] ?? []).map((e) => ({
      kind,
      text: e.text.trim(),
      year: e.year,
      pages: (e.pages ?? []).map((p) => parseSummary(lang, p)),
    }))
  );
}

// ---------------------------------------------------------------------------
// Text

/** Removes `{\displaystyle …}` blocks (formulas in plain text extracts), braces balanced. */
export function stripMath(text: string): string {
  let out = "";
  let i = 0;
  for (;;) {
    const at = text.indexOf("{\\displaystyle", i);
    if (at === -1) return out + text.slice(i);
    out += text.slice(i, at);
    let depth = 0;
    let j = at;
    for (; j < text.length; j++) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}" && --depth === 0) break;
    }
    i = j + 1;
  }
}

/** Sections with nothing in them in plain text extracts (lists of links, references). */
const EMPTY_SECTIONS =
  /^(see also|references|notes|external links|further reading|bibliography|sources|voir aussi|références|notes et références|liens externes|bibliographie|articles connexes|einzelnachweise|weblinks|literatur|siehe auch|referencias|enlaces externos|véase también)$/i;

/**
 * A plain text extract with "== Heading ==" lines → markdown: headings,
 * paragraphs, no formulas, no empty or link-only sections at the end.
 */
export function extractToMarkdown(text: string): string {
  const lines = stripMath(text).replace(/\r/g, "").split("\n");
  const blocks: { level: number; heading?: string; body: string[] }[] = [{ level: 0, body: [] }];
  for (const line of lines) {
    const h = line.match(/^(={2,6})\s*(.*?)\s*\1\s*$/);
    if (h) blocks.push({ level: h[1].length, heading: h[2], body: [] });
    else if (line.trim()) blocks[blocks.length - 1].body.push(line.trim());
  }
  // A heading is kept when it, or one of its subsections, has text.
  const keep = blocks.map(() => false);
  for (let i = blocks.length - 1; i >= 0; i--) {
    const b = blocks[i];
    if (b.heading && EMPTY_SECTIONS.test(b.heading)) continue;
    if (b.body.length) keep[i] = true;
    for (let j = i + 1; j < blocks.length && blocks[j].level > b.level; j++) {
      if (keep[j] && b.heading) keep[i] = true;
    }
  }
  return blocks
    .filter((_, i) => keep[i])
    .map((b) => {
      const head = b.heading ? `${"#".repeat(Math.min(4, b.level))} ${b.heading}\n\n` : "";
      return head + b.body.join("\n\n");
    })
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The first `max` characters, cut after a sentence when possible. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"));
  return end > max * 0.3 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}

/** The first paragraph only, for list subtitles and the copied summary. */
export const firstParagraph = (text: string) => text.split(/\n+/).find((l) => l.trim())?.trim() ?? "";

/** At 230 words a minute. */
export function readingTime(words: number): string {
  const minutes = Math.max(1, Math.round(words / 230));
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`;
}

export const wordCount = (text: string) => (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;

export function formatDate(iso: string | undefined, locale = "en-GB"): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? undefined
    : d.toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });
}

/** A Markdown link to the page, for notes. */
export const markdownLink = (p: Page) => `[${p.title}](${p.url})`;
