// ActivityWatch logic: picking buckets, time periods, the query sent to the
// server and what comes back. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Buckets

export interface Bucket {
  id: string;
  type?: string;
  client?: string;
  hostname?: string;
  last_updated?: string;
  created?: string;
}

export interface Sources {
  hostname: string;
  window: string;
  afk?: string;
  web: string[];
}

/** `GET /api/0/buckets/`: an object keyed by bucket id. */
export function parseBuckets(json: unknown): Bucket[] {
  if (!json || typeof json !== "object") return [];
  return Object.entries(json as Record<string, Partial<Bucket>>).map(([id, b]) => ({ ...b, id: b.id ?? id }));
}

const updated = (b: Bucket) => Date.parse(b.last_updated ?? b.created ?? "") || 0;

/**
 * The window, AFK and browser buckets of one computer: the one asked for, else the
 * one whose window watcher reported last.
 */
export function pickSources(buckets: Bucket[], hostname = ""): Sources | undefined {
  const windows = buckets.filter((b) => b.type === "currentwindow").sort((a, b) => updated(b) - updated(a));
  const host = hostname.trim().toLowerCase();
  const window = host ? windows.find((b) => (b.hostname ?? "").toLowerCase() === host) : windows[0];
  if (!window) return undefined;
  const same = (b: Bucket) => (b.hostname ?? "") === (window.hostname ?? "");
  const afk = buckets.filter((b) => b.type === "afkstatus" && same(b)).sort((a, b) => updated(b) - updated(a))[0];
  // Browser extensions report "unknown" as their hostname unless it is set in the extension.
  const web = buckets.filter((b) => b.type === "web.tab.current" && (same(b) || b.hostname === "unknown"));
  return { hostname: window.hostname ?? "unknown", window: window.id, afk: afk?.id, web: web.map((b) => b.id) };
}

/** Hostnames that have a window watcher, for the error when the one asked for has none. */
export const hostnames = (
  buckets: Bucket[],
) => [...new Set(buckets.filter((b) => b.type === "currentwindow").map((b) => b.hostname ?? "unknown"))];

/** Window class names of each browser, as the web UI matches them with its web buckets. */
const BROWSERS: Record<string, string[]> = {
  firefox: [
    "Firefox",
    "firefox",
    "Firefox Developer Edition",
    "firefox-developer-edition",
    "firefoxdeveloperedition",
    "Firefox Beta",
    "Nightly",
    "firefox-nightly",
    "firefox-esr",
    "Firefox-esr",
    "LibreWolf",
    "librewolf",
    "zen",
    "zen-alpha",
    "zen-beta",
    "Zen Browser",
    "org.mozilla.firefox",
    "io.gitlab.librewolf-community",
    "Waterfox",
    "waterfox",
    "Floorp",
    "floorp",
  ],
  chrome: [
    "Google-chrome",
    "google-chrome",
    "Google-chrome-stable",
    "google-chrome-stable",
    "Google-chrome-beta",
    "google-chrome-unstable",
    "Chromium",
    "chromium",
    "Chromium-browser",
    "chromium-browser",
    "org.chromium.Chromium",
    "com.google.Chrome",
  ],
  chromium: ["Chromium", "chromium", "Chromium-browser", "chromium-browser", "org.chromium.Chromium"],
  brave: ["Brave-browser", "brave-browser", "Brave", "brave", "com.brave.Browser"],
  edge: ["Microsoft-edge", "microsoft-edge", "Microsoft-edge-stable", "microsoft-edge-stable", "com.microsoft.Edge"],
  vivaldi: ["Vivaldi-stable", "vivaldi-stable", "Vivaldi", "vivaldi", "com.vivaldi.Vivaldi"],
  opera: ["Opera", "opera", "com.opera.Opera"],
};

/** The browser of a web bucket: `aw-watcher-web-firefox_host` → firefox. */
export function browserOf(bucketId: string): string | undefined {
  const m = bucketId.match(/^aw-watcher-web-([a-z]+)/i);
  return m ? m[1].toLowerCase() : undefined;
}

// ---------------------------------------------------------------------------
// Categories

/** A category rule as the web UI stores it in the server settings (`classes`). */
export interface Category {
  name: string[];
  rule: { type: string; regex?: string; ignore_case?: boolean };
}

export function parseCategories(json: unknown): Category[] {
  if (!Array.isArray(json)) return [];
  return json.filter((c): c is Category =>
    !!c && Array.isArray(c.name) && c.name.length > 0 && !!c.rule && c.rule.type === "regex" &&
    typeof c.rule.regex === "string" && c.rule.regex.length > 0
  );
}

// ---------------------------------------------------------------------------
// The query

/** A string in the query language: only double quotes need escaping. */
const str = (s: string) => `"${s.replace(/"/g, '\\"')}"`;

/** `[["Work","Programming"], {"type": "regex", "regex": "(?i)code|vim"}]` per category. */
function classesLiteral(categories: Category[]): string {
  const parts = categories.map((c) => {
    const regex = c.rule.ignore_case ? `(?i)${c.rule.regex}` : c.rule.regex!;
    return `[[${c.name.map(str).join(", ")}], {"type": "regex", "regex": ${str(regex)}}]`;
  });
  return `[${parts.join(", ")}]`;
}

/**
 * The query for one period: active window time by app and category, browser time by
 * domain (counted only while that browser is the active window), all without AFK time.
 */
export function buildQuery(s: Sources, categories: Category[], limit = 50): string {
  const q: string[] = [];
  q.push(`window = flood(query_bucket(${str(s.window)}));`);
  if (s.afk) {
    q.push(`afk = flood(query_bucket(${str(s.afk)}));`);
    q.push(`active = filter_keyvals(afk, "status", ["not-afk"]);`);
    q.push(`window = filter_period_intersect(window, active);`);
  }
  if (categories.length) q.push(`window = categorize(window, ${classesLiteral(categories)});`);
  q.push(`apps = limit_events(sort_by_duration(merge_events_by_keys(window, ["app"])), ${limit});`);
  const out = [`"apps": apps`, `"total": sum_durations(window)`];
  if (categories.length) {
    q.push(`cats = sort_by_duration(merge_events_by_keys(window, ["$category"]));`);
    out.push(`"cats": cats`);
  }
  s.web.forEach((id, i) => {
    q.push(`web${i} = flood(query_bucket(${str(id)}));`);
    const names = BROWSERS[browserOf(id) ?? ""];
    if (names) {
      q.push(
        `web${i} = filter_period_intersect(web${i}, filter_keyvals(window, "app", [${names.map(str).join(", ")}]));`,
      );
    } else if (s.afk) {
      q.push(`web${i} = filter_period_intersect(web${i}, active);`);
    }
  });
  if (s.web.length) {
    q.push(`web = web0;`);
    for (let i = 1; i < s.web.length; i++) q.push(`web = concat(web, web${i});`);
    q.push(`web = split_url_events(web);`);
    q.push(`sites = limit_events(sort_by_duration(merge_events_by_keys(web, ["$domain"])), ${limit});`);
    out.push(`"sites": sites`, `"web": sum_durations(web)`);
  }
  q.push(`RETURN = {${out.join(", ")}};`);
  return q.join("\n");
}

// ---------------------------------------------------------------------------
// Periods

/** `2026-10-29T04:00:00+01:00`: local time with its offset, as ActivityWatch wants it. */
export function isoLocal(d: Date): string {
  const p = (n: number) => String(Math.floor(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${
    p(d.getSeconds())
  }${off >= 0 ? "+" : "-"}${p(off / 60)}:${p(off % 60)}`;
}

/** "04:00" → minutes after midnight when the day starts (ActivityWatch's startOfDay setting). */
export function parseStartOfDay(v: unknown): number {
  const m = typeof v === "string" ? v.match(/^(\d{1,2}):(\d{2})/) : null;
  if (!m) return 0;
  return Math.min(23, Number(m[1])) * 60 + Math.min(59, Number(m[2]));
}

/** The start of the day `now` is in, the day starting `offsetMin` after midnight. */
export function dayStart(now: Date, offsetMin = 0): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, offsetMin);
  if (d > now) d.setDate(d.getDate() - 1);
  return d;
}

/** Monday of the week the day is in. */
export function weekStart(now: Date, offsetMin = 0): Date {
  const d = dayStart(now, offsetMin);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

const shift = (d: Date, days: number) => {
  const c = new Date(d);
  c.setDate(c.getDate() + days);
  return c;
};

export type PeriodId = "today" | "yesterdaySoFar" | "yesterday" | "week" | "lastWeekSoFar";

/** Today and this week so far, and the same spans one day and one week earlier, to compare. */
export function periods(now: Date, offsetMin = 0): Record<PeriodId, [Date, Date]> {
  const day = dayStart(now, offsetMin);
  const week = weekStart(now, offsetMin);
  return {
    today: [day, now],
    yesterdaySoFar: [shift(day, -1), shift(now, -1)],
    yesterday: [shift(day, -1), day],
    week: [week, now],
    lastWeekSoFar: [shift(week, -7), shift(now, -7)],
  };
}

export const timeperiod = ([a, b]: [Date, Date]) => `${isoLocal(a)}/${isoLocal(b)}`;

/** `2026-10-29`, for web UI links. */
export const dateOnly = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// ---------------------------------------------------------------------------
// Results

export interface Row {
  key: string;
  seconds: number;
}

export interface Usage {
  total: number;
  web: number;
  apps: Row[];
  sites: Row[];
  categories: Row[];
}

interface AwEvent {
  duration?: number;
  data?: Record<string, unknown>;
}

const rows = (events: unknown, key: (d: Record<string, unknown>) => string | undefined): Row[] => {
  if (!Array.isArray(events)) return [];
  const out = new Map<string, number>();
  for (const e of events as AwEvent[]) {
    const k = key(e.data ?? {});
    if (!k || !(e.duration! > 0)) continue;
    out.set(k, (out.get(k) ?? 0) + e.duration!);
  }
  return [...out].map(([k, seconds]) => ({ key: k, seconds })).sort((a, b) => b.seconds - a.seconds);
};

/** One element of `POST /api/0/query/`'s answer. */
export function parseUsage(result: unknown): Usage {
  const r = (result ?? {}) as Record<string, unknown>;
  return {
    total: Number(r.total) || 0,
    web: Number(r.web) || 0,
    apps: rows(r.apps, (d) => typeof d.app === "string" ? d.app : undefined),
    sites: rows(r.sites, (d) => {
      const domain = typeof d.$domain === "string" ? d.$domain.replace(/^www\./, "") : "";
      return domain || undefined;
    }),
    categories: rows(r.cats, (d) => {
      const c = d.$category;
      if (!Array.isArray(c) || !c.length) return undefined;
      return c.join(" › ");
    }).filter((c) => c.key !== "Uncategorized"),
  };
}

export const EMPTY: Usage = { total: 0, web: 0, apps: [], sites: [], categories: [] };

// ---------------------------------------------------------------------------
// Formatting

/** 18720 → "5 h 12", 2700 → "45 min", 40 → "40 s". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return `${h} h ${String(m).padStart(2, "0")}`;
  if (m) return `${m} min`;
  return `${s} s`;
}

export interface Trend {
  text: string;
  color: "green" | "red" | "gray";
  /** Change in seconds. */
  delta: number;
}

/** "+25 min" / "−10 min" against an earlier period; small changes are "same". */
export function trend(now: number, before: number, label = "yesterday"): Trend {
  const delta = now - before;
  if (Math.abs(delta) < 60 || (before > 0 && Math.abs(delta) / before < 0.05)) {
    return { text: `same as ${label}`, color: "gray", delta };
  }
  const sign = delta > 0 ? "+" : "−";
  return { text: `${sign}${duration(Math.abs(delta))} vs ${label}`, color: delta > 0 ? "green" : "red", delta };
}

/** Share of a total, as "12%" (or "<1%"). */
export function share(part: number, total: number): string {
  if (!total || part <= 0) return "0%";
  const p = (part / total) * 100;
  return p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/** Looks up a row's value in an earlier period. */
export const before = (list: Row[], key: string) => list.find((r) => r.key === key)?.seconds ?? 0;

/** A plain text summary to paste in a standup or journal. */
export function summaryText(label: string, u: Usage, n = 5): string {
  const lines = [`${label}: ${duration(u.total)} active`];
  if (u.categories.length) {
    lines.push("", "Categories:", ...u.categories.slice(0, n).map((r) => `- ${r.key}: ${duration(r.seconds)}`));
  }
  if (u.apps.length) lines.push("", "Apps:", ...u.apps.slice(0, n).map((r) => `- ${r.key}: ${duration(r.seconds)}`));
  if (u.sites.length) {
    lines.push("", "Websites:", ...u.sites.slice(0, n).map((r) => `- ${r.key}: ${duration(r.seconds)}`));
  }
  return lines.join("\n");
}

/** The server's base URL from the preference, without a trailing slash. */
export function baseUrl(pref: unknown): string {
  const raw = String(pref ?? "").trim() || "http://localhost:5600";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "");
}

/** The web UI's activity page for a host and day or week. */
export function activityUrl(base: string, host: string, period: "day" | "week", day: Date): string {
  return `${base}/#/activity/${encodeURIComponent(host)}/${period}/${dateOnly(day)}`;
}

/** A user-facing sentence for a failed request. */
export function connectionError(base: string, e: unknown): string {
  const msg = String((e as Error)?.message ?? e);
  if (/Connection refused|ECONNREFUSED|os error 111|tcp connect/i.test(msg)) {
    return `ActivityWatch isn't running at ${base}: start aw-qt (or aw-server) and try again`;
  }
  if (/NotCapable|Requires net access|permission/i.test(msg)) {
    return `Backslash may only reach ActivityWatch at localhost:5600 or 127.0.0.1:5600`;
  }
  return `ActivityWatch at ${base} didn't answer: ${msg}`;
}
