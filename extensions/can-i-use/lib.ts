// Can I Use: trimming caniuse's full data to what the extension shows, and support summaries.
// Pure, tested in lib_test.ts.

export type Tint = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

export const DATA_URL = "https://raw.githubusercontent.com/Fyrd/caniuse/main/fulldata-json/data-2.0.json";
/** A week. */
export const TTL_MS = 7 * 24 * 3600 * 1000;

export const BROWSERS = [
  { id: "chrome", name: "Chrome" },
  { id: "edge", name: "Edge" },
  { id: "firefox", name: "Firefox" },
  { id: "safari", name: "Safari" },
  { id: "ios_saf", name: "iOS Safari" },
  { id: "samsung", name: "Samsung Internet" },
  { id: "and_chr", name: "Chrome Android" },
] as const;

export type BrowserId = typeof BROWSERS[number]["id"];

/** y = supported, a = partial, n = not, p = polyfill, u = unknown. */
export type Level = "y" | "a" | "n" | "p" | "u";

export interface Support {
  /** The current released version. */
  current: string;
  level: Level;
  /** Needs a vendor prefix (in the current version). */
  prefix: boolean;
  /** Behind a flag (in the current version). */
  flag: boolean;
  /** Note numbers on the current version. */
  notes: number[];
  /** First version of the unbroken full, unprefixed support up to now. */
  since?: string;
  /** First version of the unbroken full support, prefixed or not, when earlier than `since`. */
  prefixedSince?: string;
  /** First version of the unbroken partial-or-full support, when earlier than both. */
  partialSince?: string;
  /** caniuse only tracks the current version (Chrome Android): "since" means nothing. */
  onlyCurrent?: boolean;
}

export interface Feature {
  id: string;
  title: string;
  description: string;
  spec: string;
  status: string;
  categories: string[];
  keywords: string[];
  notes: string;
  notesByNum: Record<string, string>;
  links: { url: string; title: string }[];
  /** Global usage share with full support, in %. */
  usageY: number;
  /** With partial support, in %. */
  usageA: number;
  support: Partial<Record<BrowserId, Support>>;
}

export interface Dataset {
  /** When caniuse last updated the data (unix seconds). */
  updated: number;
  /** When we downloaded it (ms). */
  fetched: number;
  statuses: Record<string, string>;
  features: Feature[];
}

/** `"a x #1 #3"` → its parts. */
export function parseCell(cell: string | undefined): { level: Level; prefix: boolean; flag: boolean; notes: number[] } {
  const parts = (cell ?? "u").trim().split(/\s+/);
  const level = (["y", "a", "n", "p", "u"].includes(parts[0]) ? parts[0] : "u") as Level;
  return {
    level,
    prefix: parts.includes("x"),
    flag: parts.includes("d"),
    notes: parts.filter((p) => /^#\d+$/.test(p)).map((p) => Number(p.slice(1))),
  };
}

interface AgentVersion {
  version: string;
  era: number;
}

/** Support in one browser, from its released versions (oldest first) and the feature's stats. */
export function summarize(versions: AgentVersion[], stats: Record<string, string> | undefined): Support | undefined {
  if (!stats) return undefined;
  const released = versions.filter((v) => v.era <= 0 && v.version in stats);
  if (!released.length) return undefined;
  const cells = released.map((v) => ({ version: v.version, ...parseCell(stats[v.version]) }));
  const now = cells[cells.length - 1];
  /** First version of the trailing run matching `ok`. */
  const runStart = (ok: (c: typeof cells[number]) => boolean) => {
    let i = cells.length;
    while (i > 0 && ok(cells[i - 1])) i--;
    return i < cells.length ? cells[i].version : undefined;
  };
  const since = runStart((c) => c.level === "y" && !c.prefix);
  const prefixedSince = runStart((c) => c.level === "y");
  const partialSince = runStart((c) => c.level === "y" || c.level === "a");
  return {
    current: now.version,
    level: now.level,
    prefix: now.prefix,
    flag: now.flag,
    notes: now.notes,
    ...(since ? { since } : {}),
    ...(prefixedSince && prefixedSince !== since ? { prefixedSince } : {}),
    ...(partialSince && partialSince !== prefixedSince ? { partialSince } : {}),
    ...(released.length === 1 ? { onlyCurrent: true } : {}),
  };
}

/** caniuse descriptions and notes have some HTML: keep the markdown subset the launcher shows. */
export function cleanText(s: string | undefined): string {
  return (s ?? "")
    .replace(/<code>(.*?)<\/code>/gi, "`$1`")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(em|i)>/gi, "*")
    .replace(/<\/?(strong|b)>/gi, "**")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Keeps only what the extension shows: about a sixth of the 4.8 MB download. */
export function trim(raw: any, fetched = Date.now()): Dataset {
  const agents = raw?.agents ?? {};
  const features: Feature[] = Object.entries(raw?.data ?? {}).map(([id, f]: [string, any]) => {
    const support: Partial<Record<BrowserId, Support>> = {};
    for (const b of BROWSERS) {
      const s = summarize(agents[b.id]?.version_list ?? [], f.stats?.[b.id]);
      if (s) support[b.id] = s;
    }
    return {
      id,
      title: cleanText(f.title),
      description: cleanText(f.description),
      spec: f.spec ?? "",
      status: f.status ?? "other",
      categories: f.categories ?? [],
      keywords: String(f.keywords ?? "").split(",").map((k: string) => k.trim()).filter(Boolean),
      notes: cleanText(f.notes),
      notesByNum: Object.fromEntries(
        Object.entries(f.notes_by_num ?? {}).map(([n, t]) => [n, cleanText(String(t))]),
      ),
      links: (f.links ?? []).map((l: any) => ({ url: String(l.url), title: cleanText(String(l.title ?? l.url)) })),
      usageY: Number(f.usage_perc_y ?? 0),
      usageA: Number(f.usage_perc_a ?? 0),
      support,
    };
  }).sort((a, b) => a.title.localeCompare(b.title, "en", { sensitivity: "base" }));
  return { updated: Number(raw?.updated ?? 0), fetched, statuses: raw?.statuses ?? {}, features };
}

export const isFresh = (d: Dataset | undefined, now = Date.now()) => !!d && now - d.fetched < TTL_MS;

// ---------------------------------------------------------------------------
// Presentation

export interface Tag {
  text: string;
  color?: Tint;
}

/** Colored tags for one browser: `121+`, `partial 105`, `prefix 9`, `flag`, `No`. */
export function supportTags(s: Support | undefined): Tag[] {
  if (!s) return [{ text: "No data", color: "gray" }];
  const tags: Tag[] = [];
  const notes = s.notes.map((n) => ({ text: `note ${n}`, color: "gray" as const }));
  switch (s.level) {
    case "y":
      if (s.onlyCurrent) tags.push({ text: s.prefix ? "Yes, prefixed" : "Yes", color: s.prefix ? "orange" : "green" });
      else if (s.since) tags.push({ text: `${s.since}+`, color: "green" });
      else if (s.prefixedSince) tags.push({ text: `${s.prefixedSince}+ prefixed`, color: "orange" });
      if (s.since && s.prefixedSince) tags.push({ text: `prefixed ${s.prefixedSince}`, color: "orange" });
      if (s.partialSince) tags.push({ text: `partial ${s.partialSince}`, color: "yellow" });
      break;
    case "a":
      tags.push({ text: s.onlyCurrent ? "Partial" : `Partial ${s.partialSince ?? s.current}+`, color: "yellow" });
      if (s.prefix) tags.push({ text: "prefixed", color: "orange" });
      break;
    case "n":
      tags.push({ text: "No", color: "red" });
      if (s.flag) tags.push({ text: "behind a flag", color: "purple" });
      break;
    case "p":
      tags.push({ text: "Polyfill", color: "purple" });
      break;
    default:
      tags.push({ text: "Unknown", color: "gray" });
  }
  return [...tags, ...notes];
}

/** One word for an accessory: ✓ 121, ◐ 105, ✕. */
export function shortSupport(s: Support | undefined): { text: string; color: Tint } {
  if (!s) return { text: "?", color: "gray" };
  if (s.level === "y") {
    return {
      text: s.onlyCurrent ? "yes" : s.since ?? s.prefixedSince ?? s.current,
      color: s.prefix ? "orange" : "green",
    };
  }
  if (s.level === "a") return { text: s.partialSince ?? s.current, color: "yellow" };
  if (s.level === "n") return { text: s.flag ? "flag" : "no", color: s.flag ? "purple" : "red" };
  return { text: s.level === "p" ? "polyfill" : "?", color: "gray" };
}

export function usageColor(percent: number): Tint {
  if (percent >= 95) return "green";
  if (percent >= 85) return "teal";
  if (percent >= 70) return "yellow";
  if (percent >= 40) return "orange";
  return "red";
}

export const percent = (n: number) => `${n >= 10 ? n.toFixed(1) : n.toFixed(2)} %`.replace(/\.0 %$/, " %");

/** Short labels for the spec status. */
export const STATUS_SHORT: Record<string, string> = {
  rec: "REC",
  pr: "PR",
  cr: "CR",
  wd: "WD",
  ls: "Living",
  other: "Other",
  unoff: "Unofficial",
};

/** The filter chip a feature belongs to. */
export function group(f: Feature): "css" | "html" | "js" | "other" {
  const c = f.categories;
  if (c.some((x) => x.startsWith("CSS"))) return "css";
  if (c.includes("HTML5")) return "html";
  if (c.some((x) => x === "JS" || x === "JS API" || x === "DOM")) return "js";
  return "other";
}

export const caniuseUrl = (id: string) => `https://caniuse.com/${id}`;

export const mdnLink = (f: Feature) => f.links.find((l) => l.url.includes("developer.mozilla.org"));

export function markdown(f: Feature): string {
  const nums = Object.entries(f.notesByNum);
  return [
    f.description,
    ...(f.notes ? ["", "**Notes**", "", f.notes] : []),
    ...(nums.length ? ["", ...nums.map(([n, t]) => `${n}. ${t}`)] : []),
  ].join("\n");
}
