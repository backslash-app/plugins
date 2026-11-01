// Artworks from The Met and the Art Institute of Chicago: parsing, the daily pick, text. No I/O here.

export type Museum = "met" | "aic";

export const MUSEUMS: Record<Museum, { title: string; short: string; site: string }> = {
  met: { title: "The Metropolitan Museum of Art", short: "The Met", site: "https://www.metmuseum.org" },
  aic: { title: "Art Institute of Chicago", short: "Art Institute", site: "https://www.artic.edu" },
};

export const MET_API = "https://collectionapi.metmuseum.org/public/collection/v1";
/** The paginated search, since the Met retired `/v1/search` on 2026-10-01. */
export const MET_SEARCH = "https://collectionapi.metmuseum.org/public/collection/v1.1/search";
export const AIC_API = "https://api.artic.edu/api/v1";
export const AIC_IIIF = "https://www.artic.edu/iiif/2";

export interface Artwork {
  museum: Museum;
  id: string;
  title: string;
  artist?: string;
  /** "Dutch, Zundert 1853–1890 Auvers-sur-Oise" */
  artistBio?: string;
  date?: string;
  medium?: string;
  dimensions?: string;
  department?: string;
  /** Culture or place of origin. */
  origin?: string;
  classification?: string;
  style?: string;
  credit?: string;
  publicDomain: boolean;
  /** A big picture for the panel, and a small one for the list. */
  image?: string;
  thumb?: string;
  url: string;
  description?: string;
  /** Alt text the museum wrote. */
  alt?: string;
}

// ---------------------------------------------------------------------------
// The Met

export interface MetObject {
  objectID: number;
  title?: string;
  isPublicDomain?: boolean;
  primaryImage?: string;
  primaryImageSmall?: string;
  artistDisplayName?: string;
  artistDisplayBio?: string;
  objectDate?: string;
  medium?: string;
  dimensions?: string;
  department?: string;
  culture?: string;
  country?: string;
  classification?: string;
  objectName?: string;
  creditLine?: string;
  objectURL?: string;
  message?: string;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim() || undefined;

/** The Met's small web size of a picture, "web-large" → "web-additional". */
export function metThumb(url: string): string {
  return url.replace("/web-large/", "/web-additional/").replace("/original/", "/web-additional/");
}

export function fromMet(o: MetObject): Artwork {
  const image = clean(o.primaryImageSmall) ?? clean(o.primaryImage);
  return {
    museum: "met",
    id: String(o.objectID),
    title: clean(o.title) ?? clean(o.objectName) ?? "Untitled",
    artist: clean(o.artistDisplayName),
    artistBio: clean(o.artistDisplayBio),
    date: clean(o.objectDate),
    medium: clean(o.medium),
    dimensions: clean(o.dimensions),
    department: clean(o.department),
    origin: clean(o.culture) ?? clean(o.country),
    classification: clean(o.classification) ?? clean(o.objectName),
    credit: clean(o.creditLine),
    publicDomain: !!o.isPublicDomain,
    image,
    thumb: image ? metThumb(image) : undefined,
    url: clean(o.objectURL) ?? `${MUSEUMS.met.site}/art/collection/search/${o.objectID}`,
  };
}

export function metSearchUrl(query: string, limit: number, offset = 0): string {
  const q = new URLSearchParams({ q: query.trim() || "*", hasImages: "true", limit: String(limit) });
  if (offset) q.set("offset", String(offset));
  return `${MET_SEARCH}?${q}`;
}

/** Highlights with pictures, for the daily pick. */
export function metHighlightsUrl(offset: number): string {
  const q = new URLSearchParams({
    q: "*",
    isHighlight: "true",
    hasImages: "true",
    offset: String(offset),
    limit: "1",
  });
  return `${MET_SEARCH}?${q}`;
}

export const metObjectUrl = (id: string | number) => `${MET_API}/objects/${id}`;

// ---------------------------------------------------------------------------
// The Art Institute of Chicago

export interface AicArtwork {
  id: number;
  title?: string;
  artist_display?: string;
  artist_title?: string | null;
  date_display?: string | null;
  medium_display?: string | null;
  dimensions?: string | null;
  department_title?: string | null;
  is_public_domain?: boolean;
  image_id?: string | null;
  place_of_origin?: string | null;
  credit_line?: string | null;
  artwork_type_title?: string | null;
  classification_title?: string | null;
  style_title?: string | null;
  description?: string | null;
  thumbnail?: { alt_text?: string | null } | null;
}

export const AIC_FIELDS = [
  "id",
  "title",
  "artist_display",
  "artist_title",
  "date_display",
  "medium_display",
  "dimensions",
  "department_title",
  "is_public_domain",
  "image_id",
  "place_of_origin",
  "credit_line",
  "artwork_type_title",
  "classification_title",
  "style_title",
  "description",
  "thumbnail",
].join(",");

export const aicImage = (imageId: string, width: number) => `${AIC_IIIF}/${imageId}/full/${width},/0/default.jpg`;

/** HTML of a description to plain text with paragraphs. */
export function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*p\s*>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function fromAic(a: AicArtwork): Artwork {
  // "Vincent van Gogh (Dutch, 1853–1890)": the name, then the rest as the bio.
  const display = clean(a.artist_display);
  const artist = clean(a.artist_title) ?? clean(a.artist_display?.split("\n")[0]);
  const bio = display && artist && display.startsWith(artist)
    ? clean(display.slice(artist.length).replace(/^\s*\(|\)\s*$/g, ""))
    : undefined;
  const imageId = clean(a.image_id);
  return {
    museum: "aic",
    id: String(a.id),
    title: clean(a.title) ?? "Untitled",
    artist,
    artistBio: bio,
    date: clean(a.date_display),
    medium: clean(a.medium_display),
    dimensions: clean(a.dimensions),
    department: clean(a.department_title),
    origin: clean(a.place_of_origin),
    classification: clean(a.artwork_type_title) ?? clean(a.classification_title),
    style: clean(a.style_title),
    credit: clean(a.credit_line),
    publicDomain: !!a.is_public_domain,
    image: imageId ? aicImage(imageId, 843) : undefined,
    thumb: imageId ? aicImage(imageId, 200) : undefined,
    url: `${MUSEUMS.aic.site}/artworks/${a.id}`,
    description: a.description ? stripHtml(a.description) || undefined : undefined,
    alt: clean(a.thumbnail?.alt_text),
  };
}

export function aicSearchUrl(query: string, limit: number, publicDomainOnly = false): string {
  const q = new URLSearchParams({ q: query.trim(), limit: String(limit), fields: AIC_FIELDS });
  if (publicDomainOnly) q.set("query[term][is_public_domain]", "true");
  return `${AIC_API}/artworks/search?${q}`;
}

/** Highlights ("boosted") in the public domain with a picture, one at `offset`. */
export function aicHighlightsUrl(offset: number): string {
  const params = {
    query: {
      bool: {
        must: [
          { term: { is_public_domain: true } },
          { term: { is_boosted: true } },
          { exists: { field: "image_id" } },
        ],
      },
    },
    from: offset,
    size: 1,
  };
  return `${AIC_API}/artworks/search?${new URLSearchParams({ params: JSON.stringify(params), fields: AIC_FIELDS })}`;
}

// ---------------------------------------------------------------------------
// Artwork of the day

/** How many highlights each museum's daily pick draws from (both have a bit more). */
export const DAILY_POOL: Record<Museum, number> = { met: 2000, aic: 200 };

/** "2026-11-01" in local time. */
export function dayKey(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** A stable 32-bit hash (FNV-1a). */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The same museum and offset for everyone on a given day; the museums take turns. */
export function dailyPick(day: string): { museum: Museum; offset: number } {
  const n = Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);
  const museum: Museum = n % 2 === 0 ? "met" : "aic";
  return { museum, offset: hash(`artwork:${day}`) % DAILY_POOL[museum] };
}

/** A daily pick must be in the public domain and have a picture. */
export const showable = (a: Artwork) => a.publicDomain && !!a.image;

// ---------------------------------------------------------------------------
// Searching both

export type Source = "all" | Museum | "public";

export function sourceOf(filter: string | undefined): Source {
  return filter === "met" || filter === "aic" || filter === "public" ? filter : "all";
}

/** One from each museum in turn, so neither crowds out the other. */
export function interleave<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

/** Runs `fn` on every item, `limit` at a time, keeping the order; failures become undefined. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Text

export function byline(a: Artwork): string {
  return [a.artist ?? a.origin ?? "Unknown artist", a.date].filter(Boolean).join(", ");
}

/** "Vincent van Gogh, Sunflowers, 1887. Oil on canvas. The Metropolitan Museum of Art." */
export function citation(a: Artwork): string {
  return [
    `${a.artist ? `${a.artist}, ` : ""}${a.title}${a.date ? `, ${a.date}` : ""}.`,
    a.medium ? `${a.medium}.` : "",
    `${MUSEUMS[a.museum].title}.`,
    a.url,
  ].filter(Boolean).join(" ");
}

export function markdown(a: Artwork): string {
  const lines = [`## ${a.title}`, "", `**${a.artist ?? "Unknown artist"}**${a.artistBio ? ` · ${a.artistBio}` : ""}`];
  if (a.date || a.medium) lines.push("", [a.date, a.medium].filter(Boolean).join(" · "));
  if (a.description) {
    lines.push("", a.description.length > 1200 ? `${a.description.slice(0, 1200).trimEnd()}…` : a.description);
  } else if (a.alt) lines.push("", `*${a.alt}*`);
  if (!a.image) {
    lines.push(
      "",
      a.publicDomain
        ? "*No picture in the museum's open data.*"
        : "*Still under copyright: the museum doesn't share its picture.*",
    );
  }
  return lines.join("\n");
}
