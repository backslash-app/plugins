// GitHub trending (parsed from its HTML), Lobsters and DEV: parsing and how items look. Tested in
// lib_test.ts.

import { type Action, action, type Color, copy, Icons, type Item, meta, open, type Outcome } from "@backslash/api";

// --- Text helpers -------------------------------------------------------------------

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Tags removed, entities decoded, whitespace collapsed. */
export const htmlText = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** "12,345" or "1.2k" → number. */
export function parseCount(text: string | undefined): number {
  const t = (text ?? "").trim().toLowerCase().replace(/,/g, "");
  const m = /^([\d.]+)\s*([km])?/.exec(t);
  if (!m) return 0;
  const n = Number(m[1]);
  return Math.round(m[2] === "k" ? n * 1000 : m[2] === "m" ? n * 1_000_000 : n);
}

/** 1234 → "1.2k". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  const d = new Date(t);
  if (s < 365 * 86_400) return d.toLocaleDateString("en", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

/** `https://www.example.com/a` → `example.com`. */
export function domain(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- GitHub trending ----------------------------------------------------------------

export type Since = "daily" | "weekly" | "monthly";

export const SINCE_LABELS: Record<Since, { chip: string; period: string }> = {
  daily: { chip: "Today", period: "today" },
  weekly: { chip: "This week", period: "this week" },
  monthly: { chip: "This month", period: "this month" },
};

/** "C++" → "c++", "C#" → "c#", "Jupyter Notebook" → "jupyter-notebook". */
export function languageSlug(language: string): string {
  return language.trim().toLowerCase().replace(/\s+/g, "-");
}

export const parseLanguages = (
  text: unknown,
) => [...new Set(String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(languageSlug))];

export function trendingUrl(since: Since, language = ""): string {
  const path = language ? `/${encodeURIComponent(languageSlug(language))}` : "";
  return `https://github.com/trending${path}?since=${since}`;
}

export interface TrendingRepo {
  owner: string;
  name: string;
  url: string;
  description?: string;
  language?: string;
  languageColor?: string;
  stars: number;
  forks: number;
  starsInPeriod: number;
  builtBy: { login: string; avatar?: string }[];
  rank: number;
}

/**
 * The repositories of a github.com/trending page. Each one is an `<article class="Box-row">`;
 * the parser looks for what each part says (the repository link in the heading, the
 * stargazers and forks links, "N stars today") rather than exact markup, so that small
 * changes to the page don't break it.
 */
export function parseTrending(html: string): TrendingRepo[] {
  const out: TrendingRepo[] = [];
  const blocks = html.split(/<article\b/i).slice(1)
    .filter((b) => /^[^>]*class="[^"]*Box-row/i.test(b))
    .map((b) => b.split(/<\/article>/i)[0]);
  for (const block of blocks) {
    const heading = /<h[12][^>]*>([\s\S]*?)<\/h[12]>/i.exec(block)?.[1] ?? "";
    const href = /href="\/([^"/?#\s]+)\/([^"/?#\s]+)"/i.exec(heading);
    if (!href) continue;
    const [owner, name] = [decodeURIComponent(href[1]), decodeURIComponent(href[2])];
    const base = `/${href[1]}/${href[2]}`;
    const linkText = (suffix: string) => {
      const re = new RegExp(`href="${escapeRe(base)}/${suffix}"[^>]*>([\\s\\S]*?)</a>`, "i");
      return htmlText(re.exec(block)?.[1] ?? "");
    };
    const description = htmlText(/<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(block)?.[1] ?? "") || undefined;
    const language = htmlText(/itemprop="programmingLanguage"[^>]*>([\s\S]*?)</i.exec(block)?.[1] ?? "") ||
      undefined;
    const color = /repo-language-color[^>]*style="[^"]*background-color:\s*(#[0-9a-f]{3,8})/i.exec(block)?.[1];
    const period = /([\d,.]+k?)\s+stars?\s+(today|this\s+week|this\s+month)/i.exec(htmlText(block));
    const builtBy: TrendingRepo["builtBy"] = [];
    const built = /Built by([\s\S]*?)<\/span>/i.exec(block)?.[1] ?? "";
    for (const img of built.matchAll(/<img\b[^>]*>/gi)) {
      const login = /alt="@?([^"]+)"/i.exec(img[0])?.[1];
      const src = /src="([^"]+)"/i.exec(img[0])?.[1];
      if (login) builtBy.push({ login: decodeEntities(login), avatar: src ? decodeEntities(src) : undefined });
    }
    out.push({
      owner,
      name,
      url: `https://github.com/${owner}/${name}`,
      description,
      language,
      languageColor: color,
      stars: parseCount(linkText("stargazers")),
      forks: parseCount(linkText("forks")),
      starsInPeriod: period ? parseCount(period[1]) : 0,
      builtBy,
      rank: out.length + 1,
    });
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Repositories of several languages, each once, by stars gained. */
export function mergeTrending(lists: TrendingRepo[][]): TrendingRepo[] {
  const seen = new Map<string, TrendingRepo>();
  for (const r of lists.flat()) if (!seen.has(r.url)) seen.set(r.url, r);
  return [...seen.values()].sort((a, b) => b.starsInPeriod - a.starsInPeriod);
}

export function repoItem(r: TrendingRepo, since: Since, section?: string): Item {
  const period = SINCE_LABELS[since].period;
  const hot = r.starsInPeriod >= (since === "daily" ? 500 : since === "weekly" ? 2000 : 5000);
  return {
    id: r.url,
    title: `${r.owner}/${r.name}`,
    subtitle: r.description,
    icon: { source: Icons.repository, tint: hot ? "orange" : "blue" },
    section,
    keywords: [r.language ?? "", ...r.builtBy.map((b) => b.login)],
    accessories: [
      ...(r.language ? [{ tag: r.language }] : []),
      {
        icon: { source: Icons.star, tint: (hot ? "orange" : "yellow") as Color },
        text: `+${compact(r.starsInPeriod)}`,
        tooltip: `${r.starsInPeriod.toLocaleString("en")} stars ${period}`,
      },
      { text: compact(r.stars), tooltip: `${r.stars.toLocaleString("en")} stars in total` },
    ],
    detail: {
      stats: [
        {
          label: `Stars ${period}`,
          value: `+${r.starsInPeriod.toLocaleString("en")}`,
          color: hot ? "orange" : undefined,
        },
        { label: "Stars", value: compact(r.stars) },
        { label: "Forks", value: compact(r.forks) },
      ],
      markdown: `**${r.owner}/${r.name}**${r.description ? `\n\n${r.description}` : ""}`,
      metadata: [
        meta.text("Rank", `#${r.rank} ${period}`, { icon: Icons.chartUp }),
        ...(r.language ? [meta.text("Language", r.language, { icon: Icons.code })] : []),
        meta.text("Owner", r.owner, { icon: Icons.person }),
        ...(r.builtBy.length ? [meta.tags("Built by", r.builtBy.map((b) => b.login))] : []),
        meta.link("Repository", `github.com/${r.owner}/${r.name}`, r.url),
      ],
    },
    actions: [
      open(r.url, "Open Repository"),
      open(`${r.url}/stargazers`, "Open Stargazers", { icon: Icons.star }),
      open(`${r.url}/issues`, "Open Issues", { icon: Icons.issue, shortcut: "<Ctrl>i" }),
      open(`https://github.com/${r.owner}`, `Open ${r.owner}`, { icon: Icons.person }),
      copy(r.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(`git clone ${r.url}.git`, "Copy git clone", {
        icon: Icons.terminal,
        shortcut: "<Ctrl>period",
        section: "Copy",
      }),
      copy(`[${r.owner}/${r.name}](${r.url})`, "Copy as Markdown Link", { section: "Copy" }),
    ],
  };
}

// --- Lobsters -----------------------------------------------------------------------

export type LobstersFeed = "hottest" | "newest" | "active";

export const LOBSTERS_FEEDS: Record<LobstersFeed, string> = { hottest: "Hottest", newest: "Newest", active: "Active" };

/** `https://lobste.rs/hottest.json` and the others. */
export interface LobstersStory {
  short_id: string;
  short_id_url?: string;
  created_at: string;
  title: string;
  url: string;
  score: number;
  flags?: number;
  comment_count: number;
  description?: string;
  description_plain?: string;
  comments_url: string;
  /** A name in the current API, an object in older ones. */
  submitter_user: string | { username: string; avatar_url?: string };
  user_is_author?: boolean;
  tags: string[];
}

export const submitter = (s: LobstersStory) =>
  typeof s.submitter_user === "string" ? s.submitter_user : s.submitter_user?.username ?? "";

const TAG_COLORS: Record<string, Color> = {
  show: "teal",
  ask: "purple",
  release: "green",
  security: "red",
  rust: "orange",
  go: "teal",
  python: "blue",
  javascript: "yellow",
  meta: "gray",
  video: "pink",
  pdf: "red",
};

export const tagColor = (t: string): Color | undefined => TAG_COLORS[t];

export function storyItem(s: LobstersStory, rank: number, seen = false): Item {
  const user = submitter(s);
  const link = s.url || s.comments_url;
  const site = domain(s.url);
  const text = (s.description_plain ?? htmlText(s.description ?? "")).trim();
  const hot = s.score >= 40;
  return {
    id: s.short_id,
    title: s.title,
    subtitle: site,
    icon: { source: Icons.arrowUp, tint: seen ? "gray" : hot ? "red" : "orange" },
    keywords: [...s.tags, user, site ?? ""],
    accessories: [
      ...s.tags.slice(0, 3).map((t) => ({ tag: t, color: tagColor(t) })),
      {
        icon: { source: Icons.arrowUp, tint: (hot ? "red" : "gray") as Color },
        text: String(s.score),
        tooltip: plural(s.score, "point"),
      },
      { icon: Icons.comment, text: String(s.comment_count), tooltip: plural(s.comment_count, "comment") },
      { text: ago(s.created_at), tooltip: new Date(s.created_at).toLocaleString("en") },
    ],
    detail: {
      stats: [
        { label: "Score", value: s.score, color: hot ? "red" : undefined },
        { label: "Comments", value: s.comment_count },
        { label: "Rank", value: `#${rank}` },
      ],
      markdown: `**${s.title}**${text ? `\n\n${text.slice(0, 1200)}` : ""}`,
      metadata: [
        meta.tags("Tags", s.tags.map((t) => ({ text: t, color: tagColor(t) }))),
        meta.person("Submitter", user + (s.user_is_author ? " (author)" : "")),
        meta.text("Posted", ago(s.created_at), { icon: Icons.clock }),
        ...(site ? [meta.link("Site", site, s.url)] : []),
        meta.link("Discussion", `lobste.rs/s/${s.short_id}`, s.comments_url),
      ],
    },
    actions: [
      open(link, s.url ? "Open Link" : "Open on Lobsters"),
      open(s.comments_url, "Open Comments", { icon: Icons.comment, shortcut: "<Ctrl>o" }),
      open(`https://lobste.rs/~${user}`, `Open ${user}’s Profile`, { icon: Icons.person }),
      copy(link, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(s.short_id_url ?? s.comments_url, "Copy Lobsters Link", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(`[${s.title}](${link})`, "Copy as Markdown Link", { section: "Copy" }),
    ],
  };
}

// --- DEV ----------------------------------------------------------------------------

export type DevPeriod = "week" | "month" | "year" | "latest";

export const DEV_PERIODS: Record<DevPeriod, { chip: string; top?: number }> = {
  week: { chip: "This week", top: 7 },
  month: { chip: "This month", top: 30 },
  year: { chip: "This year", top: 365 },
  latest: { chip: "Latest" },
};

/** `GET https://dev.to/api/articles?top=7`. */
export interface DevArticle {
  id: number;
  title: string;
  description?: string;
  url: string;
  comments_count: number;
  public_reactions_count: number;
  published_at?: string;
  published_timestamp?: string;
  tag_list: string[] | string;
  reading_time_minutes?: number;
  cover_image?: string | null;
  user: { name: string; username: string; profile_image_90?: string };
  organization?: { name: string; username: string } | null;
}

export function devUrl(period: DevPeriod, tag = "", perPage = 30): string {
  const p = new URLSearchParams({ per_page: String(perPage) });
  const top = DEV_PERIODS[period].top;
  if (top) p.set("top", String(top));
  if (tag) p.set("tag", tag.trim().toLowerCase().replace(/^#/, ""));
  return `https://dev.to/api/articles${period === "latest" ? "/latest" : ""}?${p}`;
}

export const devTags = (a: DevArticle) =>
  Array.isArray(a.tag_list) ? a.tag_list : a.tag_list.split(",").map((t) => t.trim()).filter(Boolean);

export function articleItem(a: DevArticle, extra: Action[] = []): Item {
  const tags = devTags(a);
  const when = a.published_at ?? a.published_timestamp;
  const hot = a.public_reactions_count >= 100;
  return {
    id: String(a.id),
    title: a.title,
    subtitle: a.organization ? `${a.user.name} · ${a.organization.name}` : a.user.name,
    icon: { source: Icons.book, tint: hot ? "purple" : "blue" },
    keywords: [...tags, a.user.username, a.organization?.name ?? ""],
    accessories: [
      ...tags.slice(0, 3).map((t) => ({ tag: `#${t}` })),
      {
        icon: { source: Icons.heart, tint: (hot ? "red" : "gray") as Color },
        text: compact(a.public_reactions_count),
        tooltip: "Reactions",
      },
      { icon: Icons.comment, text: String(a.comments_count), tooltip: plural(a.comments_count, "comment") },
      ...(a.reading_time_minutes
        ? [{ icon: Icons.clock, text: `${a.reading_time_minutes} min`, tooltip: "Reading time" }]
        : []),
    ],
    detail: {
      image: a.cover_image || undefined,
      stats: [
        { label: "Reactions", value: compact(a.public_reactions_count), color: hot ? "red" : undefined },
        { label: "Comments", value: a.comments_count },
        { label: "Reading", value: a.reading_time_minutes ? `${a.reading_time_minutes} min` : "—" },
      ],
      markdown: `**${a.title}**${a.description ? `\n\n${a.description}` : ""}`,
      metadata: [
        meta.person("Author", a.user.name, a.user.profile_image_90),
        ...(a.organization ? [meta.text("Organization", a.organization.name, { icon: Icons.apps })] : []),
        ...(tags.length ? [meta.tags("Tags", tags.map((t) => `#${t}`))] : []),
        ...(when ? [meta.text("Published", ago(when), { icon: Icons.calendar })] : []),
      ],
    },
    actions: [
      open(a.url, "Open Article"),
      open(`${a.url}#comments`, "Open Comments", { icon: Icons.comment, shortcut: "<Ctrl>o" }),
      open(`https://dev.to/${a.user.username}`, `Open ${a.user.name}’s Profile`, { icon: Icons.person }),
      ...extra,
      copy(a.url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(`[${a.title}](${a.url})`, "Copy as Markdown Link", { shortcut: "<Ctrl>period", section: "Copy" }),
    ],
  };
}

/** "Show #rust Articles": opens the articles of one of the tags. */
export const tagActions = (a: DevArticle, view: (tag: string) => Outcome) =>
  devTags(a).slice(0, 4).map((t) =>
    action(`Show #${t} Articles`, () => view(t), { icon: Icons.hash, section: "Tags" })
  );
