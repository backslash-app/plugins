// Tenor v2 and Giphy URLs, their answers turned into one Gif shape, the
// rating mapping and formatting. Pure, tested in lib_test.ts.

export type Provider = "tenor" | "giphy";

export interface Gif {
  provider: Provider;
  id: string;
  title: string;
  /** The animated GIF, full size: what gets copied and downloaded. */
  url: string;
  /** A small GIF for the grid. */
  thumbnail: string;
  /** An MP4 of the same animation, when offered (lighter for some chats). */
  mp4?: string;
  /** The GIF's page on Tenor or Giphy. */
  page: string;
  width?: number;
  height?: number;
  /** Bytes of the full GIF. */
  size?: number;
  /** Seconds, Tenor only. */
  duration?: number;
  tags: string[];
  /** Giphy: who uploaded it. */
  author?: string;
}

export interface Settings {
  key: string;
  rating: Rating;
  language: string;
  limit?: number;
}

export type Rating = "g" | "pg" | "pg-13" | "r";

/** "PG13", " pg-13 ", "R" → a Giphy rating, pg-13 when unknown. */
export function parseRating(text: unknown): Rating {
  const t = String(text ?? "").trim().toLowerCase().replace(/[\s_]/g, "");
  if (t === "g") return "g";
  if (t === "pg") return "pg";
  if (t === "r") return "r";
  return "pg-13";
}

/** Tenor's contentfilter for a rating: high is the strictest, off shows everything. */
export function tenorFilter(rating: Rating): "high" | "medium" | "low" | "off" {
  return ({ g: "high", pg: "medium", "pg-13": "low", r: "off" } as const)[rating];
}

/** "fr", "FR_fr", "" → a two-letter language, en by default. */
export function parseLanguage(text: unknown): string {
  const t = String(text ?? "").trim().toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(t) ? t : "en";
}

/** "tenor", "Giphy", anything else → which provider to show first. */
export function parseProvider(text: unknown): Provider {
  return String(text ?? "").trim().toLowerCase() === "giphy" ? "giphy" : "tenor";
}

export const TENOR = "https://tenor.googleapis.com/v2";
export const GIPHY = "https://api.giphy.com/v1/gifs";
/** Tenor asks every app to name itself. */
export const CLIENT_KEY = "backslash";

/** Tenor search, or the featured (trending) GIFs when the query is empty. */
export function tenorUrl(query: string, s: Settings): string {
  const q = query.trim();
  const params = new URLSearchParams({
    key: s.key,
    client_key: CLIENT_KEY,
    limit: String(s.limit ?? 40),
    media_filter: "gif,tinygif,mp4",
    contentfilter: tenorFilter(s.rating),
    locale: s.language,
  });
  if (q) params.set("q", q);
  return `${TENOR}/${q ? "search" : "featured"}?${params}`;
}

/** Tenor counts shares to rank its search: called when a GIF is copied. */
export function tenorShareUrl(id: string, query: string, key: string): string {
  const params = new URLSearchParams({ id, key, client_key: CLIENT_KEY });
  if (query.trim()) params.set("q", query.trim());
  return `${TENOR}/registershare?${params}`;
}

/** Giphy search, or trending when the query is empty. */
export function giphyUrl(query: string, s: Settings): string {
  const q = query.trim();
  const params = new URLSearchParams({
    api_key: s.key,
    limit: String(s.limit ?? 40),
    rating: s.rating,
  });
  if (q) {
    params.set("q", q.slice(0, 50)); // Giphy refuses longer queries
    params.set("lang", s.language);
  }
  return `${GIPHY}/${q ? "search" : "trending"}?${params}`;
}

const num = (v: unknown): number | undefined => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
};
const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** A readable title from Tenor's description: "a cat is dancing" → "A cat is dancing". */
export function cleanTitle(text: string, fallback = "GIF"): string {
  const t = text.replace(/\s+/g, " ").trim().replace(/\s*GIF$/i, "").trim();
  if (!t) return fallback;
  return t[0].toUpperCase() + t.slice(1);
}

// deno-lint-ignore no-explicit-any
type Raw = any;

/** Tenor v2's `results`, skipping those without a GIF. */
export function mapTenor(json: Raw): Gif[] {
  const results: Raw[] = Array.isArray(json?.results) ? json.results : [];
  const out: Gif[] = [];
  for (const r of results) {
    const media = r?.media_formats ?? {};
    const gif = media.gif ?? media.mediumgif;
    const url = str(gif?.url);
    if (!url || !r.id) continue;
    const tags: string[] = Array.isArray(r.tags) ? r.tags.filter((t: unknown) => typeof t === "string") : [];
    out.push({
      provider: "tenor",
      id: String(r.id),
      title: cleanTitle(str(r.title) || str(r.content_description), tags[0] ? cleanTitle(tags[0]) : "GIF"),
      url,
      thumbnail: str(media.tinygif?.url) || str(media.nanogif?.url) || url,
      mp4: str(media.mp4?.url) || undefined,
      page: str(r.itemurl) || str(r.url) || url,
      width: num(gif?.dims?.[0]),
      height: num(gif?.dims?.[1]),
      size: num(gif?.size),
      duration: num(gif?.duration),
      tags,
    });
  }
  return out;
}

/** Giphy's `data`: the original GIF, a small one for the grid. */
export function mapGiphy(json: Raw): Gif[] {
  const data: Raw[] = Array.isArray(json?.data) ? json.data : [];
  const out: Gif[] = [];
  for (const g of data) {
    const images = g?.images ?? {};
    const original = images.original ?? images.downsized ?? {};
    const url = str(original.url);
    if (!url || !g.id) continue;
    out.push({
      provider: "giphy",
      id: String(g.id),
      title: cleanTitle(str(g.title), "GIF"),
      url: stripTracking(url),
      thumbnail: stripTracking(
        str(images.fixed_width_small?.url) || str(images.fixed_width?.url) || str(images.preview_gif?.url) || url,
      ),
      mp4: str(original.mp4) ? stripTracking(str(original.mp4)) : undefined,
      page: str(g.url) || `https://giphy.com/gifs/${g.id}`,
      width: num(original.width),
      height: num(original.height),
      size: num(original.size),
      tags: [],
      author: str(g.user?.display_name) || str(g.username) || undefined,
    });
  }
  return out;
}

/** Giphy appends ?cid=…&rid=… to its media links; the clean link is what people expect to paste. */
export function stripTracking(url: string): string {
  try {
    const u = new URL(url);
    if (!u.hostname.endsWith("giphy.com")) return url;
    for (const k of ["cid", "rid", "ct", "ep"]) u.searchParams.delete(k);
    return u.toString().replace(/\?$/, "");
  } catch {
    return url;
  }
}

/** What an API error answer says, for a human message. */
export function apiError(provider: Provider, status: number, body: string): string {
  const name = provider === "tenor" ? "Tenor" : "Giphy";
  if (status === 401 || status === 403) return `${name} refused the API key: check it in Settings`;
  if (status === 400 && /api key|API_KEY|key not valid/i.test(body)) {
    return `${name} refused the API key: check it in Settings`;
  }
  if (status === 429) return `${name}'s rate limit is reached: wait a minute`;
  let detail = "";
  try {
    const j = JSON.parse(body);
    detail = str(j?.error?.message) || str(j?.meta?.msg) || str(j?.message);
  } catch {
    // Not JSON.
  }
  return `${name} didn't answer (HTTP ${status}${detail ? `: ${detail}` : ""})`;
}

export function formatBytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** A safe file name for a GIF: "Happy Dance" + id → "happy-dance-abc123.gif". */
export function fileName(gif: Pick<Gif, "title" | "id" | "provider">): string {
  const slug = gif.title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);
  const id = gif.id.replace(/[^\w-]/g, "").slice(0, 40);
  return `${slug || gif.provider}-${id}.gif`;
}

export const fileUri = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

/** The picked file name, numbered when taken: "a.gif", "a (2).gif"… */
export function freeName(name: string, exists: (n: string) => boolean): string {
  if (!exists(name)) return name;
  const stem = name.replace(/\.gif$/i, "");
  for (let n = 2;; n++) {
    const candidate = `${stem} (${n}).gif`;
    if (!exists(candidate)) return candidate;
  }
}

/** Recent GIFs first, without duplicates, at most `max`. */
export function addRecent(recent: Gif[], gif: Gif, max = 16): Gif[] {
  return [gif, ...recent.filter((g) => !(g.provider === gif.provider && g.id === gif.id))].slice(0, max);
}
