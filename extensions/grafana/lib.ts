// Grafana responses as plain data, silences and hosts. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// The server

/** The `net` permission, as in backslash.toml. */
export const HOSTS = [
  "*.grafana.net",
  "localhost",
  "127.0.0.1",
  "grafana",
  "grafana.local",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.internal",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

const LOCAL = /^(localhost|\d+\.\d+\.\d+\.\d+|[^.]+)$|\.(local|lan|home\.arpa|internal)$/i;

/** `acme.grafana.net/` → `https://acme.grafana.net`; `grafana.local:3000/d/x` → `http://grafana.local:3000`. */
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
    // A Grafana served under a sub-path (root_url) keeps it, minus the page.
    const path = u.pathname.replace(/\/(d|dashboards|alerting|explore|login|a)(\/.*)?$/, "").replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "";
  }
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

// ---------------------------------------------------------------------------
// Dashboards

export interface Dashboard {
  uid: string;
  title: string;
  url: string;
  folderTitle?: string;
  folderUid?: string;
  tags: string[];
  isStarred: boolean;
}

/** `/api/search?type=dash-db`. */
export function parseDashboards(data: unknown): Dashboard[] {
  if (!Array.isArray(data)) return [];
  return data.filter((d: any) => d.type === "dash-db" || d.type === undefined).map((d: any) => ({
    uid: String(d.uid),
    title: String(d.title),
    url: String(d.url ?? `/d/${d.uid}`),
    folderTitle: d.folderTitle || undefined,
    folderUid: d.folderUid || undefined,
    tags: d.tags ?? [],
    isStarred: !!d.isStarred,
  }));
}

/** Starred first, then folders by name (General last), dashboards by title. */
export function sortDashboards(dashboards: Dashboard[]): Dashboard[] {
  const folder = (d: Dashboard) => d.folderTitle ?? "￿";
  return [...dashboards].sort((a, b) =>
    Number(b.isStarred) - Number(a.isStarred) ||
    (a.isStarred ? 0 : folder(a).localeCompare(folder(b))) ||
    a.title.localeCompare(b.title)
  );
}

/** Grafana gives URLs relative to its root; a sub-path root is already in them. */
export function absolute(base: string, url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const origin = new URL(base).origin;
  const path = new URL(base).pathname.replace(/\/$/, "");
  return url.startsWith(path + "/") && path ? `${origin}${url}` : `${base}${url.startsWith("/") ? "" : "/"}${url}`;
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
}

/** `/api/alertmanager/grafana/api/v2/alerts`. */
export function parseAlerts(data: unknown): Alert[] {
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
    receivers: (a.receivers ?? []).map((r: any) => String(r.name ?? r)),
  }));
}

/** Go's zero time (`0001-01-01T00:00:00Z`) means "none". */
function validDate(text: unknown): Date | undefined {
  if (typeof text !== "string" || text.startsWith("0001-")) return undefined;
  const d = new Date(text);
  return isNaN(d.getTime()) ? undefined : d;
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
export function severityOf(a: Alert): Severity {
  const s = (a.labels.severity ?? a.labels.priority ?? a.labels.level ?? "").toLowerCase();
  if (/^(critical|crit|emergency|fatal|page|p1|sev1|disaster)$/.test(s)) return "critical";
  if (/^(high|error|err|major|p2|sev2)$/.test(s)) return "high";
  if (/^(warning|warn|medium|minor|p3|sev3|average)$/.test(s)) return "warning";
  if (/^(info|low|informational|notice|p4|p5|sev4|none)$/.test(s)) return "info";
  return "none";
}

export function sortAlerts(alerts: Alert[]): Alert[] {
  return [...alerts].sort((a, b) =>
    SEVERITIES[severityOf(a)].rank - SEVERITIES[severityOf(b)].rank ||
    (b.startsAt?.getTime() ?? 0) - (a.startsAt?.getTime() ?? 0)
  );
}

export const alertName = (a: Alert) => a.labels.alertname ?? a.labels.__alert_rule_title__ ?? "Alert";

/** Labels worth showing: not Grafana's internal ones, not the name. */
export const visibleLabels = (a: Alert) =>
  Object.entries(a.labels).filter(([k]) => !k.startsWith("__") && k !== "alertname").sort(([x], [y]) =>
    x.localeCompare(y)
  );

/** The dashboard panel an alert rule is linked to. */
export function panelUrl(base: string, a: Alert): string | undefined {
  const uid = a.annotations.__dashboardUid__;
  if (!uid) return undefined;
  const panel = a.annotations.__panelId__;
  return `${base}/d/${uid}${panel ? `?viewPanel=${panel}` : ""}`;
}

// ---------------------------------------------------------------------------
// Silences

export interface Matcher {
  name: string;
  value: string;
  isRegex: boolean;
  isEqual?: boolean;
}

export interface Silence {
  id: string;
  state: "active" | "pending" | "expired" | string;
  matchers: Matcher[];
  startsAt?: Date;
  endsAt?: Date;
  createdBy: string;
  comment: string;
}

export function parseSilences(data: unknown): Silence[] {
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
  }));
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
  const live = sorted.filter((s) => rank(s) < 2);
  return [...live, ...sorted.filter((s) => rank(s) === 2).slice(0, 20)];
}

/** `alertname=HighCPU, instance=~web-.*` */
export const matcherText = (m: Matcher) =>
  `${m.name}${m.isEqual === false ? "!" : ""}${m.isRegex ? "=~" : "="}${m.value}`;

/** What a silence created from an alert matches: every label, exactly. */
export function matchersFor(a: Alert): Matcher[] {
  return Object.entries(a.labels)
    .filter(([k]) => !k.startsWith("__") || k === "__alert_rule_uid__")
    .map(([name, value]) => ({ name, value, isRegex: false, isEqual: true }));
}

export const DURATIONS = [
  { title: "1 Hour", hours: 1 },
  { title: "4 Hours", hours: 4 },
  { title: "1 Day", hours: 24 },
];

export function silenceBody(a: Alert, hours: number, createdBy: string, now = new Date()) {
  return {
    matchers: matchersFor(a),
    startsAt: now.toISOString(),
    endsAt: new Date(now.getTime() + hours * 3600_000).toISOString(),
    createdBy,
    comment: `Silenced from Backslash for ${hours === 24 ? "1 day" : `${hours} h`}: ${alertName(a)}`,
  };
}

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
