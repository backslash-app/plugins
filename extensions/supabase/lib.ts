// Supabase responses as plain data, URLs and SQL. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Projects

export interface Organization {
  id: string;
  slug?: string;
  name: string;
}

export interface Project {
  id?: string;
  ref: string;
  name: string;
  organization_id?: string;
  organization_slug?: string;
  region: string;
  status: string;
  created_at?: string;
  database?: { host?: string; version?: string; postgres_engine?: string; release_channel?: string };
}

export type Health = "ok" | "busy" | "paused" | "failed" | "other";

export interface StatusInfo {
  label: string;
  color: Color;
  health: Health;
}

/** `ACTIVE_HEALTHY` and friends, as people say them. */
export function statusInfo(status: string): StatusInfo {
  switch (status) {
    case "ACTIVE_HEALTHY":
      return { label: "Healthy", color: "green", health: "ok" };
    case "ACTIVE_UNHEALTHY":
      return { label: "Unhealthy", color: "red", health: "failed" };
    case "INACTIVE":
      return { label: "Paused", color: "gray", health: "paused" };
    case "COMING_UP":
      return { label: "Starting", color: "yellow", health: "busy" };
    case "GOING_DOWN":
    case "PAUSING":
      return { label: "Pausing", color: "yellow", health: "busy" };
    case "RESTORING":
      return { label: "Restoring", color: "yellow", health: "busy" };
    case "UPGRADING":
      return { label: "Upgrading", color: "yellow", health: "busy" };
    case "RESIZING":
      return { label: "Resizing", color: "yellow", health: "busy" };
    case "INIT_FAILED":
      return { label: "Setup failed", color: "red", health: "failed" };
    case "RESTORE_FAILED":
      return { label: "Restore failed", color: "red", health: "failed" };
    case "PAUSE_FAILED":
      return { label: "Pause failed", color: "red", health: "failed" };
    case "REMOVED":
      return { label: "Removed", color: "gray", health: "other" };
    default:
      return {
        label: status ? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ") : "Unknown",
        color: "gray",
        health: "other",
      };
  }
}

const REGIONS: Record<string, string> = {
  "us-east-1": "East US (North Virginia)",
  "us-east-2": "East US (Ohio)",
  "us-west-1": "West US (North California)",
  "us-west-2": "West US (Oregon)",
  "ca-central-1": "Canada (Central)",
  "sa-east-1": "South America (São Paulo)",
  "eu-west-1": "West EU (Ireland)",
  "eu-west-2": "West EU (London)",
  "eu-west-3": "West EU (Paris)",
  "eu-central-1": "Central EU (Frankfurt)",
  "eu-central-2": "Central EU (Zurich)",
  "eu-north-1": "North EU (Stockholm)",
  "ap-south-1": "South Asia (Mumbai)",
  "ap-southeast-1": "Southeast Asia (Singapore)",
  "ap-southeast-2": "Oceania (Sydney)",
  "ap-northeast-1": "Northeast Asia (Tokyo)",
  "ap-northeast-2": "Northeast Asia (Seoul)",
};

export const regionName = (region: string) => REGIONS[region] ?? region;

/** `17.4.1.054` → `17.4`; `15.1.0.147` → `15.1`. */
export const postgresVersion = (version?: string) => version?.split(".").slice(0, 2).join(".") || undefined;

/** Projects of each organization, the organizations by name, then the healthy projects by name. */
export function groupProjects(projects: Project[], orgs: Organization[]): [string, Project[]][] {
  const name = (p: Project) =>
    orgs.find((o) => o.id === p.organization_id || (p.organization_slug && o.slug === p.organization_slug))?.name ??
      p.organization_slug ?? p.organization_id ?? "Projects";
  const groups = new Map<string, Project[]>();
  for (const p of projects.filter((p) => p.status !== "REMOVED")) {
    groups.set(name(p), [...(groups.get(name(p)) ?? []), p]);
  }
  const rank = (p: Project) => ({ failed: 0, busy: 1, ok: 2, paused: 3, other: 4 })[statusInfo(p.status).health];
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([org, ps]) => [org, ps.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))]);
}

// ---------------------------------------------------------------------------
// URLs

export const apiUrl = (ref: string) => `https://${ref}.supabase.co`;
export const dashboardUrl = (ref: string, page = "") => `https://supabase.com/dashboard/project/${ref}${page}`;

/** Studio pages offered in "Open in Studio ›". */
export const STUDIO_PAGES: { title: string; page: string; icon: string }[] = [
  { title: "Table Editor", page: "/editor", icon: "bs-database" },
  { title: "SQL Editor", page: "/sql/new", icon: "bs-code" },
  { title: "Authentication", page: "/auth/users", icon: "bs-user" },
  { title: "Storage", page: "/storage/buckets", icon: "bs-archive" },
  { title: "Edge Functions", page: "/functions", icon: "bs-bolt" },
  { title: "Logs", page: "/logs/explorer", icon: "bs-text" },
  { title: "Database Settings", page: "/database/settings", icon: "bs-settings" },
  { title: "API Settings", page: "/settings/api", icon: "bs-key" },
  { title: "Billing & Usage", page: "/settings/billing/usage", icon: "bs-chart-up" },
];

// ---------------------------------------------------------------------------
// API keys

export interface ApiKey {
  name: string;
  api_key: string;
  type?: string | null;
}

/** The public key: the legacy `anon` JWT, or the new publishable key. */
export const anonKey = (keys: ApiKey[]) =>
  keys.find((k) => k.name === "anon" && k.api_key)?.api_key ??
    keys.find((k) => k.type === "publishable" && k.api_key)?.api_key;

/** `eyJhbGciOiJIUzI1NiIsInR5cCI6…` → `eyJhbG…J9.x`, enough to recognize it. */
export const maskKey = (key: string) => key.length > 16 ? `${key.slice(0, 6)}…${key.slice(-4)}` : "••••";

// ---------------------------------------------------------------------------
// Tables

export const SYSTEM_SCHEMAS = [
  "auth",
  "storage",
  "realtime",
  "supabase_functions",
  "supabase_migrations",
  "extensions",
  "graphql",
  "graphql_public",
  "net",
  "pgsodium",
  "pgsodium_masks",
  "vault",
  "cron",
  "pgbouncer",
  "information_schema",
];

/** Tables of the user's schemas with their size, estimated rows and whether RLS is on. */
export const TABLES_SQL = `select n.nspname as schema, c.relname as name, c.oid::int as id,
  greatest(c.reltuples, 0)::bigint as rows, pg_total_relation_size(c.oid) as bytes,
  c.relrowsecurity as rls, obj_description(c.oid, 'pg_class') as comment
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'p') and n.nspname not like 'pg\\_%'
  and n.nspname not in (${SYSTEM_SCHEMAS.map((s) => `'${s}'`).join(", ")})
order by n.nspname = 'public' desc, n.nspname, c.relname
limit 300`;

export interface Table {
  schema: string;
  name: string;
  id: number;
  rows: number;
  bytes: number;
  rls: boolean;
  comment?: string;
}

/** Rows of TABLES_SQL (numbers may come back as strings). */
export function parseTables(rows: unknown): Table[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((r: any) => ({
    schema: String(r.schema),
    name: String(r.name),
    id: Number(r.id) || 0,
    rows: Math.max(0, Number(r.rows) || 0),
    bytes: Number(r.bytes) || 0,
    rls: r.rls === true || r.rls === "t" || r.rls === "true",
    comment: r.comment || undefined,
  }));
}

/** The Table Editor page of one table. */
export const tableUrl = (ref: string, t: Table) =>
  t.id ? dashboardUrl(ref, `/editor/${t.id}?schema=${encodeURIComponent(t.schema)}`) : dashboardUrl(ref, "/editor");

// ---------------------------------------------------------------------------
// Edge functions

export interface EdgeFunction {
  id: string;
  slug: string;
  name: string;
  status: "ACTIVE" | "REMOVED" | "THROTTLED" | string;
  version: number;
  created_at?: number | string;
  updated_at?: number | string;
  verify_jwt?: boolean;
  import_map?: boolean;
  entrypoint_path?: string;
}

export function functionStatus(status: string): { label: string; color: Color } {
  if (status === "ACTIVE") return { label: "Active", color: "green" };
  if (status === "THROTTLED") return { label: "Throttled", color: "orange" };
  if (status === "REMOVED") return { label: "Removed", color: "gray" };
  return { label: status || "Unknown", color: "gray" };
}

export const functionUrl = (ref: string, slug: string) => `${apiUrl(ref)}/functions/v1/${slug}`;

/** Epoch milliseconds (functions) or an ISO string → Date. */
export function toDate(value: unknown): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const d = typeof value === "number" ? new Date(value) : new Date(String(value));
  return isNaN(d.getTime()) ? undefined : d;
}

// ---------------------------------------------------------------------------
// Logs (Logs Explorer SQL, BigQuery dialect)

export const API_LOGS_SQL = `select id, timestamp, event_message, r.status_code, rq.method, rq.path
from edge_logs cross join unnest(metadata) as m cross join unnest(m.response) as r
cross join unnest(m.request) as rq
order by timestamp desc limit 50`;

export const functionLogsSql = (functionId: string) =>
  `select id, function_logs.timestamp, event_message, metadata.level
from function_logs cross join unnest(metadata) as metadata
where metadata.function_id = '${functionId.replace(/[^\w-]/g, "")}'
order by timestamp desc limit 50`;

export interface LogLine {
  time: Date;
  message: string;
  level?: string;
  status?: number;
  method?: string;
  path?: string;
}

/** `timestamp` is in microseconds. */
export function parseLogs(body: unknown): LogLine[] {
  const result = (body as { result?: unknown[] })?.result;
  if (!Array.isArray(result)) return [];
  return result.map((r: any) => ({
    time: new Date(Number(r.timestamp) / 1000),
    message: String(r.event_message ?? "").trim(),
    level: r.level || undefined,
    status: r.status_code ? Number(r.status_code) : undefined,
    method: r.method || undefined,
    path: r.path || undefined,
  }));
}

/** One line per log entry: `10:04:12  ERROR  message` or `10:04:12  200  GET /rest/v1/todos`. */
export function formatLogs(lines: LogLine[]): string {
  return lines.map((l) => {
    const t = l.time.toISOString().slice(11, 19);
    if (l.method || l.status) return `${t}  ${l.status ?? "   "}  ${l.method ?? ""} ${l.path ?? l.message}`.trimEnd();
    return `${t}  ${(l.level ?? "log").toUpperCase().padEnd(5)}  ${l.message}`;
  }).join("\n");
}

/** The time window the logs endpoint wants (it refuses more than a day). */
export function logWindow(now = new Date(), hours = 1) {
  return {
    iso_timestamp_start: new Date(now.getTime() - hours * 3600_000).toISOString(),
    iso_timestamp_end: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** 1234 → "1.2k", 3_400_000 → "3.4M". */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/** "just now", "5 min ago", "3 h ago", "4 d ago", "2 mo ago", "1 y ago". */
export function ago(date: Date | undefined, now = Date.now()): string {
  if (!date) return "";
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 60) return `${d} d ago`;
  if (d < 730) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} y ago`;
}
