// Pi-hole v6 and AdGuard Home responses, mapped to one overview. No I/O here.

export type Kind = "pihole" | "adguard";

export interface DomainCount {
  domain: string;
  count: number;
}

export interface Overview {
  kind: Kind;
  version?: string;
  blocking: "enabled" | "disabled" | "unknown";
  /** Seconds until blocking comes back, when paused for a while. */
  timer?: number;
  queries: number;
  blocked: number;
  /** 0..100 */
  percent: number;
  /** "24 h", "7 days"… */
  period: string;
  listed?: number;
  listUpdated?: number;
  clients?: number;
  cached?: number;
  forwarded?: number;
  uniqueDomains?: number;
  avgMs?: number;
  topBlocked: DomainCount[];
  topAllowed: DomainCount[];
  /** Queries per hour (or day), oldest first. */
  history?: number[];
}

export const TITLES: Record<Kind, string> = { pihole: "Pi-hole", adguard: "AdGuard Home" };

// ---------------------------------------------------------------------------
// Pi-hole v6: /api/stats/summary, /api/dns/blocking, /api/stats/top_domains

export interface PiSummary {
  queries: {
    total: number;
    blocked: number;
    percent_blocked: number;
    unique_domains?: number;
    forwarded?: number;
    cached?: number;
  };
  clients?: { active: number; total: number };
  gravity?: { domains_being_blocked: number; last_update?: number };
}

export interface PiBlocking {
  blocking: "enabled" | "disabled" | "failed" | "unknown";
  timer: number | null;
}

export interface PiTopDomains {
  domains: { domain: string; count: number }[];
}

export interface PiVersion {
  version?: { core?: { local?: { version?: string } }; ftl?: { local?: { version?: string } } };
}

export function piOverview(
  summary: PiSummary,
  blocking: PiBlocking,
  blocked: PiTopDomains,
  allowed: PiTopDomains,
  version?: PiVersion,
): Overview {
  const q = summary.queries;
  return {
    kind: "pihole",
    version: version?.version?.core?.local?.version,
    blocking: blocking.blocking === "enabled" ? "enabled" : blocking.blocking === "disabled" ? "disabled" : "unknown",
    timer: blocking.timer ? Math.round(blocking.timer) : undefined,
    queries: q.total,
    blocked: q.blocked,
    percent: q.percent_blocked,
    period: "24 h",
    listed: summary.gravity?.domains_being_blocked,
    listUpdated: summary.gravity?.last_update ? summary.gravity.last_update * 1000 : undefined,
    clients: summary.clients?.active,
    cached: q.cached,
    forwarded: q.forwarded,
    uniqueDomains: q.unique_domains,
    topBlocked: blocked.domains ?? [],
    topAllowed: allowed.domains ?? [],
  };
}

// ---------------------------------------------------------------------------
// AdGuard Home: /control/status, /control/stats

export interface AgStatus {
  protection_enabled: boolean;
  /** Milliseconds left of a pause. */
  protection_disabled_duration?: number;
  running?: boolean;
  version?: string;
}

export interface AgStats {
  time_units?: "hours" | "days";
  num_dns_queries: number;
  num_blocked_filtering: number;
  num_replaced_safebrowsing?: number;
  num_replaced_parental?: number;
  num_replaced_safesearch?: number;
  avg_processing_time?: number;
  top_queried_domains?: Record<string, number>[];
  top_blocked_domains?: Record<string, number>[];
  top_clients?: Record<string, number>[];
  dns_queries?: number[];
}

const pairs = (list: Record<string, number>[] | undefined): DomainCount[] =>
  (list ?? []).flatMap((o) => Object.entries(o).map(([domain, count]) => ({ domain, count })));

export function agOverview(status: AgStatus, stats: AgStats): Overview {
  const blocked = stats.num_blocked_filtering + (stats.num_replaced_safebrowsing ?? 0) +
    (stats.num_replaced_parental ?? 0);
  const n = stats.dns_queries?.length ?? 24;
  return {
    kind: "adguard",
    version: status.version,
    blocking: status.protection_enabled ? "enabled" : "disabled",
    timer: !status.protection_enabled && status.protection_disabled_duration
      ? Math.round(status.protection_disabled_duration / 1000)
      : undefined,
    queries: stats.num_dns_queries,
    blocked,
    percent: stats.num_dns_queries ? blocked / stats.num_dns_queries * 100 : 0,
    period: stats.time_units === "days" ? `${n} days` : `${n} h`,
    avgMs: stats.avg_processing_time !== undefined ? stats.avg_processing_time * 1000 : undefined,
    topBlocked: pairs(stats.top_blocked_domains).slice(0, 10),
    topAllowed: pairs(stats.top_queried_domains).slice(0, 10),
    history: stats.dns_queries,
  };
}

// ---------------------------------------------------------------------------
// AdGuard user rules

const escapeRule = (d: string) => d.replace(/[|^$@]/g, "");

/** `@@||example.com^$important` lets a domain through, `||example.com^` blocks it and its subdomains. */
export function ruleFor(domain: string, list: "allow" | "deny"): string {
  const d = escapeRule(domain);
  return list === "allow" ? `@@||${d}^$important` : `||${d}^`;
}

/** The user rules with `domain` on `list`, dropping its rule on the other list. */
export function withRule(rules: string[], domain: string, list: "allow" | "deny"): string[] {
  const other = ruleFor(domain, list === "allow" ? "deny" : "allow");
  const rule = ruleFor(domain, list);
  const kept = rules.filter((r) => r !== other && r !== rule && r !== `@@||${escapeRule(domain)}^`);
  return [...kept, rule];
}

// ---------------------------------------------------------------------------
// Formatting and input

export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "").replace(/\/admin(\/.*)?$/, "").replace(/\/(api|control)(\/.*)?$/, "")
    .replace(/\/#.*$/, "");
}

export const adminUrl = (base: string, kind: Kind) => kind === "pihole" ? `${base}/admin/` : `${base}/`;

/** `https://ads.example.com/x?y` → `ads.example.com`; undefined when it isn't a domain. */
export function cleanDomain(input: string): string | undefined {
  let d = input.trim().toLowerCase();
  if (!d) return undefined;
  if (/^[a-z]+:\/\//.test(d)) {
    try {
      d = new URL(d).hostname;
    } catch {
      return undefined;
    }
  }
  d = d.replace(/^\*\./, "").replace(/\.$/, "").split(/[/?#:]/)[0];
  return /^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(d) ? d : undefined;
}

export const thousands = (n: number) => Math.round(n).toLocaleString("en");

export function compact(n: number): string {
  if (n < 10_000) return thousands(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 100_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export const percentText = (p: number) => `${p.toFixed(p >= 10 ? 1 : 2)} %`;

/** "4:32", "1:02:00". */
export function countdown(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s % 60;
  const two = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86_400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

/** The line under the command in the root search. */
export function summaryLine(o: Overview): string {
  if (o.blocking === "disabled") return o.timer ? `Paused · ${countdown(o.timer)} left` : "Blocking off";
  if (o.blocking === "unknown") return "Blocking state unknown";
  return `${percentText(o.percent)} blocked`;
}

/** Durations offered to pause blocking, in seconds (0: until resumed). */
export const PAUSES: { title: string; seconds: number }[] = [
  { title: "30 Seconds", seconds: 30 },
  { title: "5 Minutes", seconds: 300 },
  { title: "1 Hour", seconds: 3600 },
  { title: "Until Resumed", seconds: 0 },
];

/** The `duration` argument of the Pause command. */
export function pauseSeconds(arg: unknown): number {
  const v = String(arg ?? "").trim().toLowerCase();
  if (!v) return 300;
  if (/^(0|forever|indefinitely|off|until resumed)$/.test(v)) return 0;
  const m = /^(\d+(?:\.\d+)?)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hours?)?$/.exec(v);
  if (!m) throw new Error(`“${arg}” is not a duration: 30s, 5m, 1h or forever`);
  const n = Number(m[1]), unit = (m[2] ?? "m")[0];
  return Math.round(n * (unit === "s" ? 1 : unit === "h" ? 3600 : 60));
}

export function pauseText(seconds: number): string {
  if (!seconds) return "until resumed";
  if (seconds < 60) return `for ${seconds} s`;
  if (seconds < 3600) return `for ${Math.round(seconds / 60)} min`;
  const h = seconds / 3600;
  return `for ${Number.isInteger(h) ? h : h.toFixed(1)} h`;
}

/** A tiny bar chart of the queries over the period, for the detail panel. */
export function sparkline(values: number[] | undefined): string | undefined {
  if (!values?.length) return undefined;
  const max = Math.max(...values);
  if (!max) return undefined;
  const bars = "▁▂▃▄▅▆▇█";
  return values.map((v) => bars[Math.min(7, Math.floor(v / max * 7.999))]).join("");
}
