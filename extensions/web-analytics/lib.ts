// Visitors, pageviews, bounce rate, top pages and sources from Plausible, Umami and PostHog,
// mapped to one shape. Pure, tested in lib_test.ts.

import { type Color, Icons, meta, type Metadata, type Stat } from "@backslash/api";

export type ProviderId = "plausible" | "umami" | "posthog";
export type Period = "today" | "7d" | "30d";

export const PROVIDERS: Record<ProviderId, { title: string; color: Color }> = {
  plausible: { title: "Plausible", color: "blue" },
  umami: { title: "Umami", color: "purple" },
  posthog: { title: "PostHog", color: "orange" },
};

export const PERIODS: { value: Period; title: string }[] = [
  { value: "today", title: "Today" },
  { value: "7d", title: "7 days" },
  { value: "30d", title: "30 days" },
];

export const periodOf = (v: unknown): Period => (v === "7d" || v === "30d" ? v : "today");
export const periodDays = (p: Period) => (p === "today" ? 1 : p === "7d" ? 7 : 30);

export interface Site {
  provider: ProviderId;
  id: string;
  name: string;
  /** The provider's dashboard for this site. */
  url: string;
}

export interface Row {
  label: string;
  value: number;
}

export interface Stats {
  visitors: number;
  pageviews: number;
  visits?: number;
  /** 0 to 1. */
  bounceRate?: number;
  /** Seconds per visit. */
  duration?: number;
  /** The previous period, for 7 and 30 days. */
  previous?: { visitors: number; pageviews: number };
  realtime?: number;
  pages: Row[];
  sources: Row[];
}

// ---------------------------------------------------------------------------
// Periods

export interface Range {
  /** Local midnight that starts the period. */
  start: Date;
  end: Date;
  /** The same number of whole days just before, when the period spans several days. */
  previous?: { start: Date; end: Date };
}

const midnight = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

/** Today so far, or the last 7/30 days including today, with the period before. */
export function range(period: Period, now = new Date()): Range {
  const days = periodDays(period);
  const start = addDays(midnight(now), -(days - 1));
  if (days === 1) return { start, end: now };
  return { start, end: now, previous: { start: addDays(start, -days), end: start } };
}

/** `2026-10-28`, in local time. */
export const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Plausible (Stats API v2: POST /api/v2/query)

export const PLAUSIBLE_METRICS = ["visitors", "pageviews", "visits", "bounce_rate", "visit_duration"];

/** Plausible date ranges are whole days in the site's time zone. */
export function plausibleRange(r: { start: Date; end: Date }, inclusiveEnd = true): [string, string] {
  return [ymd(r.start), ymd(inclusiveEnd ? r.end : addDays(r.end, -1))];
}

export interface PlausibleResponse {
  results: { metrics: (number | null)[]; dimensions: string[] }[];
}

export function plausibleAggregate(res: PlausibleResponse): Omit<Stats, "pages" | "sources"> {
  const m = res.results[0]?.metrics ?? [];
  const at = (k: string) => Number(m[PLAUSIBLE_METRICS.indexOf(k)] ?? 0);
  return {
    visitors: at("visitors"),
    pageviews: at("pageviews"),
    visits: at("visits"),
    bounceRate: at("bounce_rate") / 100,
    duration: at("visit_duration"),
  };
}

export const plausibleRows = (res: PlausibleResponse): Row[] =>
  res.results.map((r) => ({ label: r.dimensions[0] || "(none)", value: Number(r.metrics[0] ?? 0) }));

// ---------------------------------------------------------------------------
// Umami (v2 and v3 shapes)

type UmamiValue = number | { value: number; prev?: number } | undefined;
const val = (v: UmamiValue) => (typeof v === "object" && v ? Number(v.value) : Number(v ?? 0));

export interface UmamiStats {
  pageviews: UmamiValue;
  visitors: UmamiValue;
  visits: UmamiValue;
  bounces: UmamiValue;
  totaltime: UmamiValue;
  comparison?: Record<string, number>;
}

export function umamiAggregate(s: UmamiStats): Omit<Stats, "pages" | "sources"> {
  const visits = val(s.visits);
  return {
    visitors: val(s.visitors),
    pageviews: val(s.pageviews),
    visits,
    bounceRate: visits ? Math.min(1, val(s.bounces) / visits) : undefined,
    duration: visits ? val(s.totaltime) / visits : undefined,
  };
}

/** `[{ x: "/pricing", y: 42 }]`; an empty `x` is a direct visit for referrers. */
export const umamiRows = (rows: { x: string | null; y: number }[], empty = "(none)"): Row[] =>
  (Array.isArray(rows) ? rows : []).map((r) => ({ label: r.x || empty, value: Number(r.y) }));

/** `/websites/:id/active` answered `[{ x: 3 }]`, `{ x: 3 }` and `{ visitors: 3 }` across versions. */
export function umamiActive(body: unknown): number | undefined {
  const b = Array.isArray(body) ? body[0] : body as Record<string, unknown> | undefined;
  const n = Number(
    (b as Record<string, unknown> | undefined)?.visitors ?? (b as Record<string, unknown> | undefined)?.x,
  );
  return Number.isFinite(n) ? n : undefined;
}

/** `/websites` answered an array (v1) or `{ data: [...] }` (v2+). */
export function umamiWebsites(body: unknown): { id: string; name: string; domain?: string }[] {
  const list = Array.isArray(body) ? body : (body as { data?: unknown[] })?.data ?? [];
  return (list as { id: string; name: string; domain?: string }[]).filter((w) => w?.id);
}

// ---------------------------------------------------------------------------
// PostHog (HogQL through POST /api/projects/:id/query/)

const quote = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const at = (d: Date) => `toDateTime(${quote(d.toISOString().slice(0, 19).replace("T", " "))}, 'UTC')`;

/** The `WHERE` bounds of a period, in UTC so they mean the same as in the other providers. */
export const hogWindow = (r: { start: Date; end: Date }, column = "timestamp") =>
  `${column} >= ${at(r.start)} AND ${column} < ${at(r.end)}`;

export function hogQueries(r: Range, limit = 10): Record<string, string> {
  const pv = `event = '$pageview' AND ${hogWindow(r)}`;
  return {
    aggregate:
      `SELECT count(DISTINCT person_id), count(), count(DISTINCT properties.$session_id) FROM events WHERE ${pv}`,
    sessions: `SELECT avg($session_duration), countIf($is_bounce) / greatest(count(), 1) FROM sessions WHERE ${
      hogWindow(r, "$start_timestamp")
    }`,
    pages:
      `SELECT properties.$pathname AS path, count(DISTINCT person_id) AS v FROM events WHERE ${pv} GROUP BY path ORDER BY v DESC LIMIT ${limit}`,
    sources:
      `SELECT properties.$referring_domain AS source, count(DISTINCT person_id) AS v FROM events WHERE ${pv} GROUP BY source ORDER BY v DESC LIMIT ${limit}`,
    realtime: `SELECT count(DISTINCT person_id) FROM events WHERE timestamp > now() - INTERVAL 5 MINUTE`,
    ...(r.previous
      ? {
        previous: `SELECT count(DISTINCT person_id), count() FROM events WHERE event = '$pageview' AND ${
          hogWindow(r.previous)
        }`,
      }
      : {}),
  };
}

export const hogRows = (results: unknown[][] | undefined, empty = "(none)"): Row[] =>
  (results ?? []).map((r) => ({ label: r[0] === "$direct" || !r[0] ? empty : String(r[0]), value: Number(r[1] ?? 0) }));

/** "us", "eu", "https://posthog.example.com" → the API base. */
export function posthogBase(host: unknown): string {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h || h === "us" || h === "us.posthog.com" || h === "app.posthog.com") return "https://us.posthog.com";
  if (h === "eu" || h === "eu.posthog.com") return "https://eu.posthog.com";
  return normalizeBase(h);
}

/** `example.com/`, `https://example.com/umami/` → `https://example.com/umami`. */
export function normalizeBase(url: string): string {
  const t = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export const splitList = (v: unknown) => String(v ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);

// ---------------------------------------------------------------------------
// Formatting

export function compact(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export const thousands = (n: number) => Math.round(n).toLocaleString("en-US");

/** "1m 32s", "45s". */
export function duration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** "+12%", "−8%", or nothing when there's no previous period to compare. */
export function change(now: number, before: number | undefined): { text: string; color: Color } | undefined {
  if (before === undefined) return undefined;
  if (before === 0) return now ? { text: "new", color: "green" } : undefined;
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return { text: "±0%", color: "gray" };
  return pct > 0 ? { text: `+${pct}%`, color: "green" } : { text: `−${Math.abs(pct)}%`, color: "red" };
}

/** A share bar for tables: "▇▇▇▇▇▇▁▁▁▁". */
export function bar(value: number, max: number, width = 10): string {
  const full = max ? Math.round((value / max) * width) : 0;
  return "▇".repeat(full) + "▁".repeat(width - full);
}

export function rowsTable(title: string, rows: Row[], header: string): string {
  if (!rows.length) return `### ${title}\n\nNothing yet.`;
  const max = Math.max(...rows.map((r) => r.value));
  const esc = (s: string) => s.replace(/\|/g, "\\|");
  return [
    `### ${title}`,
    "",
    `| ${header} | Visitors | |`,
    "|---|---:|---|",
    ...rows.map((r) =>
      `| ${esc(r.label.length > 48 ? r.label.slice(0, 47) + "…" : r.label)} | ${thousands(r.value)} | ${
        bar(r.value, max)
      } |`
    ),
  ].join("\n");
}

export function statsCards(s: Stats, period: Period): Stat[] {
  const v = change(s.visitors, s.previous?.visitors);
  const p = change(s.pageviews, s.previous?.pageviews);
  return [
    {
      label: period === "today" ? "Visitors today" : "Visitors",
      value: `${thousands(s.visitors)}${v ? ` ${v.text}` : ""}`,
      color: v?.color,
    },
    { label: "Pageviews", value: `${thousands(s.pageviews)}${p ? ` ${p.text}` : ""}`, color: p?.color },
    { label: "Bounce rate", value: s.bounceRate === undefined ? "—" : `${Math.round(s.bounceRate * 100)}%` },
    { label: "Visit duration", value: duration(s.duration) },
    ...(s.realtime !== undefined
      ? [{ label: "Right now", value: s.realtime, color: s.realtime ? "green" as const : undefined }]
      : []),
  ];
}

export function siteMarkdown(s: Stats): string {
  return [rowsTable("Top pages", s.pages, "Page"), rowsTable("Top sources", s.sources, "Source")].join("\n\n");
}

export function siteMetadata(site: Site, s: Stats, period: Period): Metadata[] {
  const label = PERIODS.find((p) => p.value === period)!.title;
  return [
    meta.text("Provider", PROVIDERS[site.provider].title, {
      icon: { source: Icons.chartUp, tint: PROVIDERS[site.provider].color },
    }),
    meta.text("Period", label + (s.previous ? ` · vs previous ${periodDays(period)} days` : ""), {
      icon: Icons.calendar,
    }),
    ...(s.visits !== undefined ? [meta.text("Visits", thousands(s.visits), { icon: Icons.activity })] : []),
    ...(s.visits ? [meta.text("Pages per visit", (s.pageviews / s.visits).toFixed(1))] : []),
    ...(s.realtime !== undefined
      ? [
        meta.text("Right now", `${s.realtime} visitor${s.realtime === 1 ? "" : "s"}`, {
          icon: { source: Icons.dot, tint: s.realtime ? "green" : "gray" },
        }),
      ]
      : []),
    meta.link("Dashboard", site.url.replace(/^https?:\/\//, ""), site.url),
    meta.text("Site", site.id, { icon: Icons.hash }),
  ];
}

/** Root subtitle: "312 visitors today", "2.1k visitors · 7 days". */
export function subtitle(total: number, period: Period): string {
  const n = total < 10_000 ? thousands(total) : compact(total);
  return period === "today"
    ? `${n} visitor${total === 1 ? "" : "s"} today`
    : `${n} visitors · ${periodDays(period)} days`;
}
