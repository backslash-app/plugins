// Datadog sites, monitors, dashboards and incidents: parsing, order and formatting.

import type { Color } from "@backslash/api";

// --- Sites --------------------------------------------------------------------------------

export interface Site {
  id: string;
  label: string;
  api: string;
  app: string;
}

export const SITES: Site[] = [
  { id: "datadoghq.com", label: "US1", api: "api.datadoghq.com", app: "app.datadoghq.com" },
  { id: "us3.datadoghq.com", label: "US3", api: "api.us3.datadoghq.com", app: "us3.datadoghq.com" },
  { id: "us5.datadoghq.com", label: "US5", api: "api.us5.datadoghq.com", app: "us5.datadoghq.com" },
  { id: "datadoghq.eu", label: "EU1", api: "api.datadoghq.eu", app: "app.datadoghq.eu" },
  { id: "ap1.datadoghq.com", label: "AP1", api: "api.ap1.datadoghq.com", app: "ap1.datadoghq.com" },
  { id: "ddog-gov.com", label: "US1-FED", api: "api.ddog-gov.com", app: "app.ddog-gov.com" },
];

/**
 * What users paste: "datadoghq.eu", "https://app.datadoghq.eu/monitors", "us3", "EU1"…
 * Undefined when it is no Datadog site.
 */
export function findSite(input: unknown): Site | undefined {
  const text = String(input ?? "").trim().toLowerCase() || "datadoghq.com";
  const host = text.replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/^(app|api)\./, "");
  return SITES.find((s) =>
    s.id === host || s.label.toLowerCase() === host || s.id.split(".")[0] === host ||
    (host === "us1" && s.id === "datadoghq.com") || (host === "eu" && s.id === "datadoghq.eu") ||
    (host === "gov" && s.id === "ddog-gov.com")
  );
}

// --- Monitors -----------------------------------------------------------------------------

export type MonitorState = "Alert" | "Warn" | "No Data" | "OK" | "Ignored" | "Skipped" | "Unknown";

export interface RawMonitor {
  id: number;
  name: string;
  type: string;
  query?: string;
  message?: string;
  tags?: string[];
  priority?: number | null;
  overall_state?: string;
  overall_state_modified?: string | null;
  created?: string;
  modified?: string;
  creator?: { name?: string | null; handle?: string; email?: string } | null;
  options?: { silenced?: Record<string, number | null> | null } | null;
  state?: { groups?: Record<string, { status?: string; last_triggered_ts?: number; name?: string }> | null } | null;
}

export interface Monitor {
  id: number;
  name: string;
  type: string;
  query?: string;
  message?: string;
  tags: string[];
  priority?: number;
  state: MonitorState;
  stateSince?: string;
  creator?: string;
  /** Groups not OK, the worst first. */
  groups: { name: string; status: MonitorState; since?: number }[];
  /** Muted until (ms), Infinity for "until unmuted"; undefined when not muted. */
  mutedUntil?: number;
}

const STATES: MonitorState[] = ["Alert", "Warn", "No Data", "OK", "Ignored", "Skipped", "Unknown"];
const toState = (s?: string): MonitorState => STATES.find((x) => x === s) ?? "Unknown";

/** Legacy silencing (`options.silenced`): `{"*": null}` = until unmuted, or a unix time. */
function legacyMute(silenced?: Record<string, number | null> | null): number | undefined {
  const all = silenced?.["*"];
  if (silenced && "*" in silenced) return all === null || all === undefined ? Infinity : all * 1000;
  return undefined;
}

export function toMonitor(m: RawMonitor): Monitor {
  const groups = Object.entries(m.state?.groups ?? {})
    .map(([name, g]) => ({
      name,
      status: toState(g.status),
      since: g.last_triggered_ts ? g.last_triggered_ts * 1000 : undefined,
    }))
    .filter((g) => ["Alert", "Warn", "No Data"].includes(g.status))
    .sort((a, b) => STATES.indexOf(a.status) - STATES.indexOf(b.status) || a.name.localeCompare(b.name));
  return {
    id: m.id,
    name: m.name,
    type: m.type,
    query: m.query,
    message: m.message,
    tags: m.tags ?? [],
    priority: m.priority ?? undefined,
    state: toState(m.overall_state),
    stateSince: m.overall_state_modified ?? undefined,
    creator: m.creator?.name || m.creator?.handle || m.creator?.email,
    groups,
    mutedUntil: legacyMute(m.options?.silenced),
  };
}

export interface Downtime {
  id: string;
  monitorId?: number;
  monitorTags?: string[];
  end?: number;
  status?: string;
  scope?: string;
}

interface RawDowntime {
  id: string;
  attributes?: {
    status?: string;
    scope?: string;
    canceled?: string | null;
    monitor_identifier?: { monitor_id?: number; monitor_tags?: string[] };
    schedule?: { end?: string | null; current_downtime?: { end?: string | null } } | null;
  };
}

/** `GET /api/v2/downtime`: the active ones. */
export function parseDowntimes(body: { data?: RawDowntime[] }): Downtime[] {
  return (body.data ?? []).filter((d) => d.attributes?.status === "active" && !d.attributes?.canceled).map((d) => {
    const a = d.attributes!;
    const end = a.schedule?.current_downtime?.end ?? a.schedule?.end;
    return {
      id: d.id,
      monitorId: a.monitor_identifier?.monitor_id,
      monitorTags: a.monitor_identifier?.monitor_tags,
      end: end ? Date.parse(end) : Infinity,
      status: a.status,
      scope: a.scope,
    };
  });
}

/** The downtimes muting a monitor: by its id, or by tags it all carries. */
export function downtimesOf(m: Monitor, downtimes: Downtime[]): Downtime[] {
  return downtimes.filter((d) =>
    d.monitorId === m.id || (d.monitorTags?.length && d.monitorTags.every((t) => m.tags.includes(t)))
  );
}

/** Adds the mute coming from downtimes to the legacy one. */
export function withDowntimes(monitors: Monitor[], downtimes: Downtime[]): Monitor[] {
  return monitors.map((m) => {
    const ends = downtimesOf(m, downtimes).map((d) => d.end ?? Infinity);
    if (!ends.length) return m;
    return { ...m, mutedUntil: Math.max(m.mutedUntil ?? 0, ...ends) };
  });
}

export const MONITOR_COLORS: Record<MonitorState, Color> = {
  Alert: "red",
  Warn: "orange",
  "No Data": "purple",
  OK: "green",
  Ignored: "gray",
  Skipped: "gray",
  Unknown: "gray",
};

export const isTriggered = (m: Monitor) => m.state === "Alert" || m.state === "Warn" || m.state === "No Data";

/** Alert, Warn, No Data, then the rest; by priority (P1 first), then name. */
export function sortMonitors(monitors: Monitor[]): Monitor[] {
  return [...monitors].sort((a, b) =>
    STATES.indexOf(a.state) - STATES.indexOf(b.state) || (a.priority ?? 6) - (b.priority ?? 6) ||
    a.name.localeCompare(b.name)
  );
}

export type MonitorFilter = "triggered" | "muted" | "all";

export function filterMonitors(monitors: Monitor[], filter: MonitorFilter, now = Date.now()): Monitor[] {
  if (filter === "triggered") return monitors.filter(isTriggered);
  if (filter === "muted") return monitors.filter((m) => isMuted(m, now));
  return monitors;
}

export const isMuted = (m: Monitor, now = Date.now()) => m.mutedUntil !== undefined && m.mutedUntil > now;

/** "Muted for 3h", "Muted" (until unmuted). */
export function muteLabel(m: Monitor, now = Date.now()): string {
  if (!isMuted(m, now)) return "";
  if (m.mutedUntil === Infinity) return "Muted";
  return `Muted ${duration(m.mutedUntil! - now)}`;
}

/** Datadog messages carry notification handles and template blocks; keep the text. */
export function cleanMessage(message?: string): string {
  return (message ?? "")
    .replace(/\{\{[#^/][^}]*\}\}/g, "")
    .replace(/(^|\s)@[\w.+-]+(@[\w.-]+)?/g, "$1")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const notifiedHandles = (message?: string) => [...new Set((message ?? "").match(/@[\w.+-]+(@[\w.-]+)?/g) ?? [])];

// --- Dashboards ---------------------------------------------------------------------------

export interface Dashboard {
  id: string;
  title: string;
  description?: string;
  author?: string;
  url: string;
  layout?: string;
  readOnly: boolean;
  created?: string;
  modified?: string;
}

interface RawDashboard {
  id: string;
  title: string;
  description?: string | null;
  author_handle?: string;
  url: string;
  layout_type?: string;
  is_read_only?: boolean;
  created_at?: string;
  modified_at?: string;
}

/** `GET /api/v1/dashboard`: the most recently modified first. */
export function parseDashboards(body: { dashboards?: RawDashboard[] }): Dashboard[] {
  return (body.dashboards ?? []).map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description || undefined,
    author: d.author_handle,
    url: d.url,
    layout: d.layout_type,
    readOnly: d.is_read_only === true,
    created: d.created_at,
    modified: d.modified_at,
  })).sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
}

// --- Incidents ----------------------------------------------------------------------------

export interface Incident {
  id: string;
  publicId?: number;
  title: string;
  severity: string;
  state: string;
  created?: string;
  modified?: string;
  resolved?: string;
  detected?: string;
  customerImpacted: boolean;
  impactScope?: string;
  commander?: string;
  createdBy?: string;
  timeToResolve?: number;
  fields: { name: string; value: string }[];
}

interface RawIncident {
  id: string;
  attributes?: {
    title?: string;
    public_id?: number;
    severity?: string;
    state?: string;
    created?: string;
    modified?: string;
    resolved?: string | null;
    detected?: string | null;
    customer_impacted?: boolean;
    customer_impact_scope?: string | null;
    time_to_resolve?: number | null;
    fields?: Record<string, { type?: string; value?: unknown } | null> | null;
  };
  relationships?: {
    commander_user?: { data?: { id?: string } | null } | null;
    created_by_user?: { data?: { id?: string } | null } | null;
  };
}

interface RawUser {
  id: string;
  type: string;
  attributes?: { name?: string | null; handle?: string; email?: string };
}

const fieldValue = (v: unknown) => Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "" : String(v);

export type IncidentsBody = {
  data?: RawIncident[] | { attributes?: { incidents?: { data: RawIncident }[] } };
  included?: RawUser[];
};

/** `GET /api/v2/incidents/search` (or the plain `/api/v2/incidents` list), with the users included. */
export function parseIncidents(body: IncidentsBody): Incident[] {
  const data = Array.isArray(body.data) ? body.data : (body.data?.attributes?.incidents ?? []).map((i) => i.data);
  const users = new Map(
    (body.included ?? []).filter((u) => u.type === "users").map((u) => [
      u.id,
      u.attributes?.name || u.attributes?.handle || u.attributes?.email || "",
    ]),
  );
  return data.map((d) => {
    const a = d.attributes ?? {};
    const fields = a.fields ?? {};
    const severity = fieldValue(fields.severity?.value) || a.severity || "UNKNOWN";
    const state = (fieldValue(fields.state?.value) || a.state || "active").toLowerCase();
    return {
      id: d.id,
      publicId: a.public_id,
      title: a.title ?? "Untitled incident",
      severity,
      state,
      created: a.created,
      modified: a.modified,
      resolved: a.resolved ?? undefined,
      detected: a.detected ?? undefined,
      customerImpacted: a.customer_impacted === true,
      impactScope: a.customer_impact_scope ?? undefined,
      commander: users.get(d.relationships?.commander_user?.data?.id ?? "") || undefined,
      createdBy: users.get(d.relationships?.created_by_user?.data?.id ?? "") || undefined,
      timeToResolve: a.time_to_resolve ?? undefined,
      fields: Object.entries(fields)
        .filter(([k, f]) => !["severity", "state"].includes(k) && fieldValue(f?.value))
        .map(([name, f]) => ({ name, value: fieldValue(f?.value) })),
    };
  });
}

const STATE_ORDER = ["active", "stable", "resolved", "completed"];

/** "SEV-1" → 1; unknown last. */
export const severityRank = (s: string) => Number(/(\d)/.exec(s)?.[1] ?? 9);

/** Active first, then stable, resolved; worst severity first; newest first. */
export function sortIncidents(incidents: Incident[]): Incident[] {
  const rank = (s: string) => STATE_ORDER.indexOf(s) === -1 ? 1 : STATE_ORDER.indexOf(s);
  return [...incidents].sort((a, b) =>
    rank(a.state) - rank(b.state) || severityRank(a.severity) - severityRank(b.severity) ||
    (b.created ?? "").localeCompare(a.created ?? "")
  );
}

export function severityColor(s: string): Color {
  switch (severityRank(s)) {
    case 1:
      return "red";
    case 2:
      return "orange";
    case 3:
      return "yellow";
    case 4:
    case 5:
      return "blue";
    default:
      return "gray";
  }
}

export const STATE_COLORS: Record<string, Color> = {
  active: "red",
  stable: "orange",
  resolved: "green",
  completed: "gray",
};

// --- Formatting ---------------------------------------------------------------------------

/** 90 min → "1h 30m", 3 days → "3d". */
export function duration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

export function age(date: string | number | undefined, now = Date.now()): string {
  const t = typeof date === "number" ? date : date ? Date.parse(date) : NaN;
  if (isNaN(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export const formatDate = (date?: string | number) => {
  const t = typeof date === "number" ? date : date ? Date.parse(date) : NaN;
  return isNaN(t) ? "" : new Date(t).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
};

export const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;
