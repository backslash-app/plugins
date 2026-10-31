// PageSpeed Insights v5 answers: Lighthouse scores, lab metrics, Chrome UX Report field data. No I/O here.

import type { Color } from "@backslash/api";

export type Strategy = "mobile" | "desktop";
export const STRATEGIES: Strategy[] = ["mobile", "desktop"];

export const CATEGORIES = [
  { key: "performance", id: "performance", title: "Performance", short: "Perf" },
  { key: "accessibility", id: "accessibility", title: "Accessibility", short: "A11y" },
  { key: "bestPractices", id: "best-practices", title: "Best Practices", short: "BP" },
  { key: "seo", id: "seo", title: "SEO", short: "SEO" },
] as const;

export type CategoryKey = typeof CATEGORIES[number]["key"];

// ---------------------------------------------------------------------------
// URLs

/**
 * `example.com/blog` → `https://example.com/blog`. PageSpeed Insights tests
 * public pages from Google's servers: local addresses are refused here with
 * a reason.
 */
export function normalizeUrl(input: string): { url: string } | { error: string } {
  let text = input.trim();
  if (!text) return { error: "Type the address of a page" };
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { error: `“${input.trim()}” is not an address` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return { error: "Only http and https pages can be tested" };
  const host = u.hostname.toLowerCase();
  if (
    host === "localhost" || /\.(local|lan|internal|home\.arpa|localhost)$/.test(host) ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(host) || host.startsWith("[")
  ) {
    return { error: `${host} is not public: PageSpeed Insights tests pages from Google's servers` };
  }
  if (!host.includes(".")) return { error: `“${host}” is not a public domain` };
  u.hash = "";
  return { url: u.toString() };
}

/** Whether what's typed looks like an address rather than a filter. */
export const looksLikeUrl = (text: string) => /^(https?:\/\/)?[\w-]+(\.[\w-]+)+(:\d+)?(\/\S*)?$/i.test(text.trim());

/** `https://www.example.com/` → `example.com`, `https://example.com/blog/` → `example.com/blog`. */
export function shortUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").replace(/\/?\?$/, "");
}

export function apiUrl(url: string, strategy: Strategy, key?: string, locale?: string): string {
  const q = new URLSearchParams({ url, strategy });
  for (const c of CATEGORIES) q.append("category", c.id);
  if (locale) q.set("locale", locale);
  if (key) q.set("key", key);
  return `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${q}`;
}

export const reportUrl = (url: string, strategy: Strategy) =>
  `https://pagespeed.web.dev/analysis?url=${encodeURIComponent(url)}&form_factor=${strategy}`;

// ---------------------------------------------------------------------------
// Results

export type Rating = "good" | "average" | "poor";

export type FieldMetric = { p75: number; rating: Rating };

export type Field = {
  /** `"origin"` when the page has too few visits and PSI fell back to the whole site. */
  scope: "url" | "origin";
  overall?: Rating;
  lcp?: FieldMetric;
  inp?: FieldMetric;
  cls?: FieldMetric;
  fcp?: FieldMetric;
  ttfb?: FieldMetric;
};

export type Opportunity = { title: string; savingsMs: number; display?: string };

export type Run = {
  at: number;
  strategy: Strategy;
  finalUrl: string;
  scores: Partial<Record<CategoryKey, number>>;
  /** Milliseconds, CLS unitless. */
  lab: { fcp?: number; lcp?: number; tbt?: number; cls?: number; si?: number };
  field?: Field;
  opportunities: Opportunity[];
  lighthouse?: string;
  warnings: string[];
};

const num = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : undefined;

const RATING: Record<string, Rating> = { FAST: "good", AVERAGE: "average", SLOW: "poor" };

/** Google's thresholds, for when CrUX gives a percentile without a category. */
export const THRESHOLDS = {
  lcp: [2500, 4000],
  inp: [200, 500],
  cls: [0.1, 0.25],
  fcp: [1800, 3000],
  ttfb: [800, 1800],
  tbt: [200, 600],
  si: [3400, 5800],
} as const;

export function rate(metric: keyof typeof THRESHOLDS, value: number): Rating {
  const [good, poor] = THRESHOLDS[metric];
  return value <= good ? "good" : value <= poor ? "average" : "poor";
}

const CRUX: Record<keyof Omit<Field, "scope" | "overall">, string> = {
  lcp: "LARGEST_CONTENTFUL_PAINT_MS",
  inp: "INTERACTION_TO_NEXT_PAINT",
  cls: "CUMULATIVE_LAYOUT_SHIFT_SCORE",
  fcp: "FIRST_CONTENTFUL_PAINT_MS",
  ttfb: "EXPERIMENTAL_TIME_TO_FIRST_BYTE",
};

/** `loadingExperience` / `originLoadingExperience`: undefined when Chrome has too little data. */
export function parseField(exp: any, scope: "url" | "origin"): Field | undefined {
  const metrics = exp?.metrics;
  if (!metrics || typeof metrics !== "object" || !Object.keys(metrics).length) return undefined;
  const field: Field = { scope, overall: RATING[exp.overall_category] };
  for (const [key, name] of Object.entries(CRUX) as [keyof typeof CRUX, string][]) {
    const m = metrics[name];
    let p75 = num(m?.percentile);
    if (p75 === undefined) continue;
    // CrUX sends CLS × 100 as an integer.
    if (key === "cls") p75 = p75 / 100;
    field[key] = { p75, rating: RATING[m.category] ?? rate(key, p75) };
  }
  return field;
}

const AUDITS = {
  fcp: "first-contentful-paint",
  lcp: "largest-contentful-paint",
  tbt: "total-blocking-time",
  cls: "cumulative-layout-shift",
  si: "speed-index",
} as const;

/** What a `runPagespeed` answer says, or undefined when it has no Lighthouse result. */
export function parseRun(json: any, strategy: Strategy, now = Date.now()): Run | undefined {
  const lh = json?.lighthouseResult;
  if (!lh || typeof lh !== "object") return undefined;
  const scores: Run["scores"] = {};
  for (const c of CATEGORIES) {
    const s = num(lh.categories?.[c.id]?.score);
    if (s !== undefined) scores[c.key] = Math.round(s * 100);
  }
  const lab: Run["lab"] = {};
  for (const [key, id] of Object.entries(AUDITS) as [keyof typeof AUDITS, string][]) {
    const v = num(lh.audits?.[id]?.numericValue);
    if (v !== undefined) lab[key] = v;
  }
  // The page's own field data, else the origin's (PSI marks the fallback).
  const page = json.loadingExperience;
  const field = page?.origin_fallback
    ? parseField(json.originLoadingExperience ?? page, "origin")
    : parseField(page, "url") ?? parseField(json.originLoadingExperience, "origin");
  return {
    at: now,
    strategy,
    finalUrl: String(lh.finalDisplayedUrl ?? lh.finalUrl ?? json.id ?? ""),
    scores,
    lab,
    field,
    opportunities: opportunities(lh.audits),
    lighthouse: typeof lh.lighthouseVersion === "string" ? lh.lighthouseVersion : undefined,
    warnings: Array.isArray(lh.runWarnings) ? lh.runWarnings.map(String).slice(0, 3) : [],
  };
}

/** Failing audits that would save the most time, biggest first. */
export function opportunities(audits: any, max = 6): Opportunity[] {
  if (!audits || typeof audits !== "object") return [];
  const out: Opportunity[] = [];
  for (const a of Object.values(audits) as any[]) {
    const score = num(a?.score);
    if (score === undefined || score >= 0.9) continue;
    const savings = num(a?.details?.overallSavingsMs) ??
      Math.max(0, ...Object.values(a?.metricSavings ?? {}).map((v) => num(v) ?? 0));
    if (!(savings > 0) || typeof a.title !== "string") continue;
    if (a.details?.type && a.details.type !== "opportunity" && !a.metricSavings) continue;
    out.push({
      title: a.title.replace(/`/g, ""),
      savingsMs: savings,
      display: typeof a.displayValue === "string" ? a.displayValue : undefined,
    });
  }
  return out.sort((a, b) => b.savingsMs - a.savingsMs).slice(0, max);
}

/** An error answer (`{ error: { code, message } }`) as a sentence. */
export function psiError(status: number, json: any): string {
  const raw = typeof json?.error?.message === "string" ? json.error.message : "";
  const reason = json?.error?.errors?.[0]?.reason ?? json?.error?.status ?? "";
  if (status === 429 || /quota|rateLimit/i.test(`${reason} ${raw}`)) {
    return "PageSpeed Insights' shared quota ran out: add a free API key in Settings, or try again later";
  }
  if (/API key not valid|API_KEY_INVALID|keyInvalid/i.test(`${reason} ${raw}`)) {
    return "Google refused the API key: check it in Settings";
  }
  if (/SERVICE_DISABLED|has not been used|accessNotConfigured/i.test(`${reason} ${raw}`)) {
    return "Enable the PageSpeed Insights API for your key's project in the Google Cloud console";
  }
  const lh = /Lighthouse returned error: (\w+)\.?\s*(.*)/s.exec(raw);
  if (lh) {
    const why: Record<string, string> = {
      FAILED_DOCUMENT_REQUEST: "Lighthouse couldn't load the page",
      ERRORED_DOCUMENT_REQUEST: "The page answered with an error",
      DNS_FAILURE: "The domain doesn't resolve",
      NO_FCP: "The page didn't paint anything",
      NOT_HTML: "The address isn't an HTML page",
      PROTOCOL_TIMEOUT: "The page took too long",
    };
    const detail = lh[2].replace(/\(Details:.*\)\s*$/s, "").trim();
    return `${why[lh[1]] ?? `Lighthouse failed (${lh[1]})`}${detail ? `: ${detail}` : ""}`;
  }
  if (raw) return `PageSpeed Insights: ${raw.replace(/\s+/g, " ").slice(0, 200)}`;
  return `PageSpeed Insights answered ${status}`;
}

// ---------------------------------------------------------------------------
// Formatting

export function scoreColor(score: number | undefined): Color {
  if (score === undefined) return "gray";
  return score >= 90 ? "green" : score >= 50 ? "orange" : "red";
}

export const RATING_COLOR: Record<Rating, Color> = { good: "green", average: "orange", poor: "red" };
export const RATING_TITLE: Record<Rating, string> = {
  good: "Good",
  average: "Needs improvement",
  poor: "Poor",
};

/** 1234 → "1.2 s", 85 → "85 ms"; CLS → "0.05". */
export function metric(key: string, value: number | undefined): string {
  if (value === undefined) return "–";
  if (key === "cls") return value < 0.01 && value > 0 ? "< 0.01" : value.toFixed(2).replace(/\.?0+$/, "") || "0";
  if (value < 1000) return `${Math.round(value)} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

/** A score trend in blocks, oldest first: "▃▅▆█". */
export function sparkline(values: number[]): string {
  const blocks = "▁▂▃▄▅▆▇█";
  return values.map((v) => blocks[Math.max(0, Math.min(7, Math.floor((v / 100) * 7.99)))]).join("");
}

/** "+5", "-3", "" when equal or unknown. */
export function delta(now?: number, before?: number): string {
  if (now === undefined || before === undefined || now === before) return "";
  return now > before ? `+${now - before}` : `${now - before}`;
}

export function ago(at: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - at) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d} d ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} y ago`;
}

/** "Mobile: Perf 92 · A11y 100 · BP 96 · SEO 100". */
export function scoreLine(run: Run): string {
  const parts = CATEGORIES.filter((c) => run.scores[c.key] !== undefined).map((c) => `${c.short} ${run.scores[c.key]}`);
  return `${run.strategy === "mobile" ? "Mobile" : "Desktop"}: ${parts.join(" · ")}`;
}

// ---------------------------------------------------------------------------
// Saved sites

export type Site = {
  url: string;
  added: number;
  runs: { mobile: Run[]; desktop: Run[] };
};

const key = (url: string) => url.replace(/\/$/, "").toLowerCase();

/** Adds the run to its site (created first), newest first, at most `max` per strategy. */
export function addRun(sites: Site[], url: string, run: Run, max = 20, now = Date.now()): Site[] {
  const existing = sites.find((s) => key(s.url) === key(url));
  const site: Site = existing ?? { url, added: now, runs: { mobile: [], desktop: [] } };
  const updated: Site = {
    ...site,
    runs: { ...site.runs, [run.strategy]: [run, ...(site.runs[run.strategy] ?? []).map(slim)].slice(0, max) },
  };
  return [updated, ...sites.filter((s) => s !== existing)];
}

export function removeSite(sites: Site[], url: string): Site[] {
  return sites.filter((s) => key(s.url) !== key(url));
}

export const latest = (site: Site, strategy: Strategy): Run | undefined => site.runs[strategy]?.[0];

/** Sites by their latest test, newest first. */
export function sortSites(sites: Site[]): Site[] {
  const last = (s: Site) => Math.max(0, ...STRATEGIES.map((st) => latest(s, st)?.at ?? 0));
  return [...sites].sort((a, b) => last(b) - last(a));
}

/** Older runs only keep what the history table shows. */
export function slim(run: Run): Run {
  return { ...run, opportunities: [], warnings: [] };
}
