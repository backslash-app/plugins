// Prometheus and Alertmanager responses as plain data: alerts, silences, query
// results, targets and rules, plus URLs and durations. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Servers

/** The `net` permission, as in backslash.toml. */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "prometheus",
  "alertmanager",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.internal",
  "*.ts.net",
  "*.grafana.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

const LOCAL = /^(localhost|\d+\.\d+\.\d+\.\d+|[^.]+)$|\.(local|lan|home\.arpa|internal)$/i;

/** Pages of the web UIs, cut off a pasted URL to find the server's root. */
const UI_PAGES =
  /\/(#.*|graph|query|alerts|targets|rules|status|config|flags|tsdb-status|service-discovery|classic\/.*)$/;

/**
 * `prometheus.local:9090/graph` → `http://prometheus.local:9090`;
 * `alertmanager.local:9093/#/alerts` → `http://alertmanager.local:9093`.
 * A sub-path (behind a reverse proxy, Grafana Cloud's `/api/prom`) is kept.
 */
export function normalizeUrl(input: unknown): string {
  let text = String(input ?? "").trim();
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) {
    // Local names and addresses are usually plain HTTP, anything else HTTPS.
    const host = text.split(/[/:]/)[0];
    text = `${LOCAL.test(host) ? "http" : "https"}://${text}`;
  }
  try {
    const u = new URL(text);
    const path = `${u.pathname}${u.hash}`.replace(/\/+$/, "").replace(UI_PAGES, "").replace(/\/(api\/v[12])$/, "")
      .replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "";
  }
}

/** "http://am1:9093, http://am2:9093" (commas, spaces or new lines) → normalized, without duplicates. */
export function parseUrls(input: unknown): string[] {
  const urls = String(input ?? "").split(/[\s,;]+/).map(normalizeUrl).filter(Boolean);
  return [...new Set(urls)];
}

const ipv4 = (h: string) => {
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(h);
  return m ? m.slice(1).reduce((n, x) => n * 256 + Number(x), 0) : undefined;
};

/** Whether `host` matches one of HOSTS (names, `*.` suffixes, IPv4 CIDR ranges). */
export function hostAllowed(host: string, hosts = HOSTS): boolean {
  const h = host.toLowerCase();
  return hosts.some((entry) => {
    if (entry.startsWith("*.")) return h.endsWith(entry.slice(1));
    const cidr = /^(.+)\/(\d+)$/.exec(entry);
    if (cidr) {
      const ip = ipv4(h);
      const net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === entry;
  });
}

/** `http://am1.local:9093` → `am1.local:9093`, to tell servers apart. */
export const hostLabel = (base: string) => base.replace(/^https?:\/\//, "");

/** Basic auth when a user name is set, else a bearer token, else nothing. */
export function authHeader(username?: unknown, password?: unknown, token?: unknown): string | undefined {
  const user = String(username ?? "").trim();
  if (user) {
    const bytes = new TextEncoder().encode(`${user}:${String(password ?? "")}`);
    return `Basic ${btoa(String.fromCharCode(...bytes))}`;
  }
  const t = String(token ?? "").trim();
  return t ? `Bearer ${t}` : undefined;
}

// ---------------------------------------------------------------------------
// Alerts

export interface Alert {
  fingerprint: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  startsAt?: Date;
  endsAt?: Date;
  generatorURL?: string;
  state: "active" | "suppressed" | "unprocessed" | string;
  silencedBy: string[];
  inhibitedBy: string[];
  receivers: string[];
  /** The Alertmanagers that know this alert (an HA pair answers twice). */
  sources: string[];
}

/** Go's zero time (`0001-01-01T00:00:00Z`) means "none". */
function validDate(text: unknown): Date | undefined {
  if (typeof text !== "string" || text.startsWith("0001-")) return undefined;
  const d = new Date(text);
  return isNaN(d.getTime()) ? undefined : d;
}

/** `GET /api/v2/alerts` of one Alertmanager. */
export function parseAlerts(data: unknown, source = ""): Alert[] {
  if (!Array.isArray(data)) return [];
  return data.map((a: any) => ({
    fingerprint: String(a.fingerprint ?? JSON.stringify(a.labels)),
    labels: a.labels ?? {},
    annotations: a.annotations ?? {},
    startsAt: validDate(a.startsAt),
    endsAt: validDate(a.endsAt),
    generatorURL: a.generatorURL || undefined,
    state: String(a.status?.state ?? "active"),
    silencedBy: a.status?.silencedBy ?? [],
    inhibitedBy: a.status?.inhibitedBy ?? [],
    receivers: (a.receivers ?? []).map((r: any) => String(r?.name ?? r)),
    sources: source ? [source] : [],
  }));
}

/** The alerts of several Alertmanagers, each alert once (by fingerprint) with all its sources. */
export function mergeAlerts(lists: Alert[][]): Alert[] {
  const byId = new Map<string, Alert>();
  for (const alert of lists.flat()) {
    const known = byId.get(alert.fingerprint);
    if (!known) byId.set(alert.fingerprint, { ...alert, sources: [...alert.sources] });
    else {
      for (const s of alert.sources) if (!known.sources.includes(s)) known.sources.push(s);
      known.silencedBy = [...new Set([...known.silencedBy, ...alert.silencedBy])];
    }
  }
  return [...byId.values()];
}

export interface AlertGroup {
  /** The route's `group_by` labels. */
  labels: Record<string, string>;
  receiver: string;
  alerts: Alert[];
}

/** `GET /api/v2/alerts/groups`: the groups notifications are sent for. */
export function parseGroups(data: unknown, source = ""): AlertGroup[] {
  if (!Array.isArray(data)) return [];
  return data.map((g: any) => ({
    labels: g.labels ?? {},
    receiver: String(g.receiver?.name ?? ""),
    alerts: parseAlerts(g.alerts, source),
  })).filter((g) => g.alerts.length);
}

/** Groups of several Alertmanagers: the same labels and receiver are one group. */
export function mergeGroups(lists: AlertGroup[][]): AlertGroup[] {
  const byKey = new Map<string, AlertGroup[]>();
  for (const g of lists.flat()) {
    const key = `${g.receiver}|${JSON.stringify(Object.entries(g.labels).sort())}`;
    byKey.set(key, [...(byKey.get(key) ?? []), g]);
  }
  return [...byKey.values()].map((gs) => ({ ...gs[0], alerts: mergeAlerts(gs.map((g) => g.alerts)) }));
}

/** `alertname=HighCPU, job=node`, or `All alerts` for a route without group_by. */
export function groupTitle(g: AlertGroup): string {
  const entries = Object.entries(g.labels);
  if (!entries.length) return "All alerts";
  const name = g.labels.alertname;
  const rest = entries.filter(([k]) => k !== "alertname").map(([k, v]) => `${k}=${v}`).join(", ");
  return name ? (rest ? `${name} · ${rest}` : name) : rest;
}

export type Severity = "critical" | "high" | "warning" | "info" | "none";

export const SEVERITIES: Record<Severity, { title: string; color: Color; rank: number }> = {
  critical: { title: "Critical", color: "red", rank: 0 },
  high: { title: "High", color: "orange", rank: 1 },
  warning: { title: "Warning", color: "yellow", rank: 2 },
  info: { title: "Info", color: "blue", rank: 3 },
  none: { title: "No severity", color: "gray", rank: 4 },
};

/** The `severity` (or `priority`) label, mapped onto five levels. */
export function severityOf(a: Pick<Alert, "labels">): Severity {
  const s = (a.labels.severity ?? a.labels.priority ?? a.labels.level ?? "").toLowerCase();
  if (/^(critical|crit|emergency|fatal|page|p1|sev1|disaster)$/.test(s)) return "critical";
  if (/^(high|error|err|major|p2|sev2)$/.test(s)) return "high";
  if (/^(warning|warn|medium|minor|p3|sev3|average)$/.test(s)) return "warning";
  if (/^(info|low|informational|notice|p4|p5|sev4|none)$/.test(s)) return "info";
  return "none";
}

/** The worst severity among alerts. */
export function worstSeverity(alerts: Pick<Alert, "labels">[]): Severity {
  return alerts.map(severityOf).sort((a, b) => SEVERITIES[a].rank - SEVERITIES[b].rank)[0] ?? "none";
}

/** Worst severity first, then the most recent. */
export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) =>
    SEVERITIES[severityOf(a)].rank - SEVERITIES[severityOf(b)].rank ||
    (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0)
  );
}

export function sortGroups(groups: AlertGroup[]): AlertGroup[] {
  return groups.map((g) => ({ ...g, alerts: sortAlerts(g.alerts) })).sort((a, b) =>
    SEVERITIES[worstSeverity(a.alerts)].rank - SEVERITIES[worstSeverity(b.alerts)].rank ||
    b.alerts.length - a.alerts.length ||
    groupTitle(a).localeCompare(groupTitle(b))
  );
}

export const alertName = (a: Alert) => a.labels.alertname ?? "Alert";

/** Labels worth showing: not the name, not internal ones. */
export const visibleLabels = (a: Pick<Alert, "labels">) =>
  Object.entries(a.labels).filter(([k]) => !k.startsWith("__") && k !== "alertname").sort(([x], [y]) =>
    x.localeCompare(y)
  );

/** The labels all alerts share (what a silence for the whole group matches). */
export function commonLabels(alerts: Pick<Alert, "labels">[]): Record<string, string> {
  if (!alerts.length) return {};
  const [first, ...rest] = alerts;
  return Object.fromEntries(
    Object.entries(first.labels).filter(([k, v]) => !k.startsWith("__") && rest.every((a) => a.labels[k] === v)),
  );
}

// ---------------------------------------------------------------------------
// Silences

export interface Matcher {
  name: string;
  value: string;
  isRegex: boolean;
  isEqual: boolean;
}

export interface Silence {
  id: string;
  state: "active" | "pending" | "expired" | string;
  matchers: Matcher[];
  startsAt?: Date;
  endsAt?: Date;
  createdBy: string;
  comment: string;
  sources: string[];
}

/** `GET /api/v2/silences`. */
export function parseSilences(data: unknown, source = ""): Silence[] {
  if (!Array.isArray(data)) return [];
  return data.map((s: any) => ({
    id: String(s.id),
    state: String(s.status?.state ?? "active"),
    matchers: (s.matchers ?? []).map((m: any) => ({
      name: String(m.name),
      value: String(m.value),
      isRegex: !!m.isRegex,
      isEqual: m.isEqual ?? true,
    })),
    startsAt: validDate(s.startsAt),
    endsAt: validDate(s.endsAt),
    createdBy: String(s.createdBy ?? ""),
    comment: String(s.comment ?? ""),
    sources: source ? [source] : [],
  }));
}

/** An HA cluster shares its silences: the same id is one silence. */
export function mergeSilences(lists: Silence[][]): Silence[] {
  const byId = new Map<string, Silence>();
  for (const s of lists.flat()) {
    const known = byId.get(s.id);
    if (!known) byId.set(s.id, { ...s, sources: [...s.sources] });
    else for (const src of s.sources) if (!known.sources.includes(src)) known.sources.push(src);
  }
  return [...byId.values()];
}

/** Active, then pending, then the 20 most recently expired. */
export function sortSilences(silences: Silence[]): Silence[] {
  const rank = (s: Silence) => s.state === "active" ? 0 : s.state === "pending" ? 1 : 2;
  const sorted = [...silences].sort((a, b) =>
    rank(a) - rank(b) ||
    (rank(a) === 2
      ? (b.endsAt?.getTime() ?? 0) - (a.endsAt?.getTime() ?? 0)
      : (a.endsAt?.getTime() ?? 0) - (b.endsAt?.getTime() ?? 0))
  );
  return [...sorted.filter((s) => rank(s) < 2), ...sorted.filter((s) => rank(s) === 2).slice(0, 20)];
}

/** `alertname="HighCPU"`, `instance=~"web-.*"`, `env!="dev"`: the syntax of amtool and the UI. */
export const matcherText = (m: Matcher) =>
  `${m.name}${m.isEqual ? (m.isRegex ? "=~" : "=") : (m.isRegex ? "!~" : "!=")}${JSON.stringify(m.value)}`;

/** Exact matchers on labels, internal ones left out. */
export function matchersOf(labels: Record<string, string>): Matcher[] {
  return Object.entries(labels)
    .filter(([k]) => !k.startsWith("__"))
    .sort(([a], [b]) => (a === "alertname" ? -1 : b === "alertname" ? 1 : a.localeCompare(b)))
    .map(([name, value]) => ({ name, value, isRegex: false, isEqual: true }));
}

/**
 * Matchers typed one per line (or separated by commas outside quotes):
 * `alertname="HighCPU"`, `instance=~web-.*`, `env!=dev`, `{job="node"}`.
 */
export function parseMatchers(text: string): Matcher[] {
  const body = text.trim();
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "\\" && quoted) {
      current += c + (body[++i] ?? "");
      continue;
    }
    if (c === '"') quoted = !quoted;
    if (!quoted && (c === "," || c === "\n")) {
      parts.push(current);
      current = "";
    } else current += c;
  }
  parts.push(current);
  // Selector braces may wrap a line or the whole text: `{job="node"}`.
  return parts.map((p) => p.trim().replace(/^\{\s*/, "").replace(/\s*\}$/, "")).filter(Boolean).map((p) => {
    const m = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(=~|!~|!=|=)\s*(.*)$/.exec(p);
    if (!m) throw new Error(`“${p}” is not a matcher: write name="value", name=~"regex" or name!="value"`);
    let value = m[3].trim();
    if (value.startsWith('"')) {
      try {
        value = JSON.parse(value);
      } catch {
        throw new Error(`The value of ${m[1]} has an unclosed quote`);
      }
    }
    return { name: m[1], value, isRegex: m[2].includes("~"), isEqual: !m[2].startsWith("!") };
  });
}

export const DURATIONS = [
  { title: "1 Hour", ms: 3600_000 },
  { title: "4 Hours", ms: 4 * 3600_000 },
  { title: "1 Day", ms: 86400_000 },
];

const UNITS: Record<string, number> = { s: 1000, m: 60_000, h: 3600_000, d: 86400_000, w: 7 * 86400_000 };

/**
 * `90m`, `2h30m`, `1d`, `1w`, `3 days`, a bare number of hours (`4`), or an end date
 * (`2026-11-02 18:00`) → milliseconds from `now`. Throws on anything else.
 */
export function parseDuration(text: string, now = Date.now()): number {
  const t = text.trim().toLowerCase();
  if (!t) throw new Error("Type a duration such as 2h, 90m or 3d");
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 3600_000);
  const words = t.replace(/\s*(weeks?)\b/g, "w").replace(/\s*(days?)\b/g, "d").replace(/\s*(hours?|hrs?)\b/g, "h")
    .replace(/\s*(minutes?|mins?)\b/g, "m").replace(/\s*(seconds?|secs?)\b/g, "s").replace(/\s+/g, "");
  if (/^(\d+(\.\d+)?[smhdw])+$/.test(words)) {
    let ms = 0;
    for (const [, n, unit] of words.matchAll(/(\d+(?:\.\d+)?)([smhdw])/g)) ms += Number(n) * UNITS[unit];
    if (ms <= 0) throw new Error("The duration must be longer than zero");
    return Math.round(ms);
  }
  const date = /^\d{4}-\d{2}-\d{2}([ t]\d{2}:\d{2}(:\d{2})?)?$/.test(t) ? new Date(t.replace(" ", "T")) : undefined;
  if (date && !isNaN(date.getTime())) {
    const ms = date.getTime() - now;
    if (ms <= 0) throw new Error("That date is in the past");
    return ms;
  }
  throw new Error(`“${text}” is not a duration: use 2h, 90m, 1d12h, 1w or a date like 2026-11-02 18:00`);
}

/** The `POST /api/v2/silences` body. */
export function silenceBody(
  matchers: Matcher[],
  ms: number,
  createdBy: string,
  comment: string,
  now = new Date(),
) {
  if (!matchers.length) throw new Error("A silence needs at least one matcher");
  if (matchers.every((m) => !m.isEqual || (m.isRegex && /^(\.\*|\.\+)?$/.test(m.value)))) {
    throw new Error("These matchers would silence every alert: add an exact one");
  }
  return {
    matchers,
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + ms).toISOString(),
    createdBy: createdBy.trim() || "Backslash",
    comment: comment.trim() || `Silenced from Backslash for ${duration(ms)}`,
  };
}

// ---------------------------------------------------------------------------
// PromQL

export type Sample = [number, string];

export interface Series {
  metric: Record<string, string>;
  /** One sample for a vector, several for a matrix. */
  values: Sample[];
}

export type QueryResult =
  | { type: "vector" | "matrix"; series: Series[]; warnings: string[] }
  | { type: "scalar" | "string"; value: Sample; warnings: string[] };

/** The `data` of `GET /api/v1/query`, already unwrapped from `{status, data}`. */
export function parseQueryResult(data: any, warnings: string[] = []): QueryResult {
  const type = data?.resultType;
  if (type === "scalar" || type === "string") {
    return { type, value: [Number(data.result?.[0] ?? 0), String(data.result?.[1] ?? "")], warnings };
  }
  if (type === "vector" || type === "matrix") {
    const series = (Array.isArray(data.result) ? data.result : []).map((r: any) => ({
      metric: r.metric ?? {},
      values: type === "vector"
        ? (r.value
          ? [[Number(r.value[0]), String(r.value[1])]]
          : r.histogram
          ? [[Number(r.histogram[0]), "histogram"]]
          : [])
        : (r.values ?? []).map((v: any) => [Number(v[0]), String(v[1])]),
    })) as Series[];
    return { type, series, warnings };
  }
  throw new Error(`Unexpected result type ${type ?? "(none)"}`);
}

/** `up{instance="a:9100",job="node"}`, or `{}` for an expression without labels. */
export function formatMetric(metric: Record<string, string>): string {
  const name = metric.__name__ ?? "";
  const labels = Object.entries(metric).filter(([k]) => k !== "__name__").sort(([a], [b]) => a.localeCompare(b));
  if (!labels.length) return name || "{}";
  return `${name}{${labels.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(", ")}}`;
}

/** A sample value for reading: `0.000123` → `0.000123`, `1234567.891` → `1,234,567.89`, `+Inf` → `+Inf`. */
export function formatValue(value: string): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value === "NaN" ? "NaN" : value;
  if (n !== 0 && Math.abs(n) < 0.001) return n.toPrecision(3);
  return n.toLocaleString("en-US", { maximumFractionDigits: Math.abs(n) < 1 ? 6 : 3 });
}

/** Results sorted like the console: biggest value first for a vector. */
export function sortSeries(series: Series[]): Series[] {
  const last = (s: Series) => Number(s.values[s.values.length - 1]?.[1]);
  return [...series].sort((a, b) => {
    const x = last(a);
    const y = last(b);
    if (Number.isNaN(x) || Number.isNaN(y)) return Number.isNaN(x) ? 1 : -1;
    return y - x || formatMetric(a.metric).localeCompare(formatMetric(b.metric));
  });
}

/** `▁▂▅▇` for a matrix series. */
export function sparkline(values: Sample[], width = 24): string {
  const nums = values.map((v) => Number(v[1])).filter(Number.isFinite);
  if (nums.length < 2) return "";
  const step = Math.max(1, Math.ceil(nums.length / width));
  const points = nums.filter((_, i) => i % step === 0);
  const min = Math.min(...points);
  const max = Math.max(...points);
  const bars = "▁▂▃▄▅▆▇█";
  return points.map((n) => bars[max === min ? 3 : Math.round(((n - min) / (max - min)) * 7)]).join("");
}

/** The expression in the Prometheus UI (table tab). */
export const graphUrl = (base: string, expr: string) =>
  `${base}/graph?g0.expr=${encodeURIComponent(expr)}&g0.tab=1&g0.range_input=1h`;

/**
 * Most recent first, without duplicates, at most `max`. The search runs as
 * the user types, so the beginnings of the new expression (`up`, `up =`) are dropped.
 */
export function remember(history: string[], expr: string, max = 20): string[] {
  const e = expr.trim();
  return e ? [e, ...history.filter((h) => h !== e && !e.startsWith(h))].slice(0, max) : history;
}

// ---------------------------------------------------------------------------
// Targets

export interface Target {
  pool: string;
  url: string;
  health: "up" | "down" | "unknown" | string;
  job: string;
  instance: string;
  labels: Record<string, string>;
  lastError: string;
  lastScrape?: Date;
  /** Seconds. */
  lastScrapeDuration?: number;
  interval?: string;
}

/** `GET /api/v1/targets?state=active`. */
export function parseTargets(data: any): Target[] {
  const active = Array.isArray(data?.activeTargets) ? data.activeTargets : [];
  return active.map((t: any) => ({
    pool: String(t.scrapePool ?? t.labels?.job ?? ""),
    url: String(t.scrapeUrl ?? t.globalUrl ?? ""),
    health: String(t.health ?? "unknown"),
    job: String(t.labels?.job ?? t.scrapePool ?? ""),
    instance: String(t.labels?.instance ?? ""),
    labels: t.labels ?? {},
    lastError: String(t.lastError ?? ""),
    lastScrape: validDate(t.lastScrape),
    lastScrapeDuration: typeof t.lastScrapeDuration === "number" ? t.lastScrapeDuration : undefined,
    interval: t.scrapeInterval || undefined,
  }));
}

const HEALTH_RANK: Record<string, number> = { down: 0, unknown: 1, up: 2 };

/** Down first, then unknown, then by job and instance. */
export function sortTargets(targets: Target[]): Target[] {
  return [...targets].sort((a, b) =>
    (HEALTH_RANK[a.health] ?? 1) - (HEALTH_RANK[b.health] ?? 1) || a.job.localeCompare(b.job) ||
    a.instance.localeCompare(b.instance, undefined, { numeric: true })
  );
}

/** "12 of 40 down" per pool, for the sections. */
export function targetCounts(targets: Target[]): { total: number; up: number; down: number; unknown: number } {
  const c = { total: targets.length, up: 0, down: 0, unknown: 0 };
  for (const t of targets) {
    if (t.health === "up") c.up++;
    else if (t.health === "down") c.down++;
    else c.unknown++;
  }
  return c;
}

// ---------------------------------------------------------------------------
// Rules

export interface Rule {
  group: string;
  file: string;
  name: string;
  type: "alerting" | "recording";
  /** Alerting rules: firing, pending or inactive. Recording rules: "recording". */
  state: string;
  health: "ok" | "err" | "unknown" | string;
  query: string;
  /** `for:` in seconds. */
  duration: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
  /** Alerts this rule currently has. */
  active: number;
  lastError: string;
  lastEvaluation?: Date;
  /** Seconds. */
  evaluationTime?: number;
}

/** `GET /api/v1/rules`. */
export function parseRules(data: any): Rule[] {
  const groups = Array.isArray(data?.groups) ? data.groups : [];
  return groups.flatMap((g: any) =>
    (g.rules ?? []).map((r: any): Rule => ({
      group: String(g.name ?? ""),
      file: String(g.file ?? ""),
      name: String(r.name ?? ""),
      type: r.type === "recording" ? "recording" : "alerting",
      state: r.type === "recording" ? "recording" : String(r.state ?? "inactive"),
      health: String(r.health ?? "unknown"),
      query: String(r.query ?? ""),
      duration: Number(r.duration ?? 0),
      labels: r.labels ?? {},
      annotations: r.annotations ?? {},
      active: Array.isArray(r.alerts) ? r.alerts.length : 0,
      lastError: String(r.lastError ?? ""),
      lastEvaluation: validDate(r.lastEvaluation),
      evaluationTime: typeof r.evaluationTime === "number" ? r.evaluationTime : undefined,
    }))
  );
}

const STATE_RANK: Record<string, number> = { firing: 0, pending: 1, inactive: 3, recording: 4 };

/** Firing, pending, broken (health err), inactive, then recording rules. */
export function sortRules(rules: Rule[]): Rule[] {
  const rank = (r: Rule) =>
    r.health === "err" && r.state !== "firing" && r.state !== "pending" ? 2 : STATE_RANK[r.state] ?? 3;
  return [...rules].sort((a, b) => rank(a) - rank(b) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}

export const RULE_STATES: Record<string, { title: string; color: Color }> = {
  firing: { title: "Firing", color: "red" },
  pending: { title: "Pending", color: "orange" },
  inactive: { title: "Inactive", color: "green" },
  recording: { title: "Recording", color: "blue" },
};

// ---------------------------------------------------------------------------
// Time

/** "45 s", "12 min", "3 h 20 min", "2 d 4 h". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d} d ${h % 24} h` : `${d} d`;
}

export const since = (d: Date | undefined, now = Date.now()) => d ? duration(now - d.getTime()) : "";

/** `0.0123` s → `12 ms`. */
export function seconds(s: number | undefined): string {
  if (s === undefined) return "";
  if (s < 1) return `${Math.round(s * 1000)} ms`;
  return `${s.toFixed(s < 10 ? 2 : 1)} s`;
}
