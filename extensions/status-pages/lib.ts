// Atlassian Statuspage summaries (`/api/v2/summary.json`) as launcher items. Pure, tested in lib_test.ts.

import { type Color, Icons, meta, type Metadata, type Stat } from "@backslash/api";

// ---------------------------------------------------------------------------
// Services

export interface Service {
  id: string;
  name: string;
  /** Host serving the Statuspage feed; must be in `[permissions] net`. */
  host: string;
  /** Words that find it: "gh", "git"… */
  keywords?: string[];
}

/** Built-in pages, all hosted on Atlassian Statuspage. Hosts mirror the manifest. */
export const SERVICES: Service[] = [
  { id: "github", name: "GitHub", host: "www.githubstatus.com", keywords: ["git", "actions", "copilot"] },
  { id: "cloudflare", name: "Cloudflare", host: "www.cloudflarestatus.com", keywords: ["cdn", "dns", "workers"] },
  { id: "vercel", name: "Vercel", host: "www.vercel-status.com", keywords: ["deploy", "next"] },
  { id: "netlify", name: "Netlify", host: "www.netlifystatus.com", keywords: ["deploy"] },
  { id: "npm", name: "npm", host: "status.npmjs.org", keywords: ["registry", "node", "packages"] },
  { id: "discord", name: "Discord", host: "discordstatus.com", keywords: ["chat"] },
  { id: "jira", name: "Jira", host: "jira-software.status.atlassian.com", keywords: ["atlassian"] },
  { id: "confluence", name: "Confluence", host: "confluence.status.atlassian.com", keywords: ["atlassian", "wiki"] },
  { id: "bitbucket", name: "Bitbucket", host: "bitbucket.status.atlassian.com", keywords: ["atlassian", "git"] },
  { id: "anthropic", name: "Anthropic", host: "status.anthropic.com", keywords: ["claude", "ai", "api"] },
  { id: "digitalocean", name: "DigitalOcean", host: "status.digitalocean.com", keywords: ["droplets", "cloud"] },
  { id: "sentry", name: "Sentry", host: "status.sentry.io", keywords: ["errors", "monitoring"] },
  { id: "twilio", name: "Twilio", host: "status.twilio.com", keywords: ["sms", "sendgrid"] },
  { id: "reddit", name: "Reddit", host: "www.redditstatus.com" },
  { id: "dropbox", name: "Dropbox", host: "status.dropbox.com", keywords: ["files"] },
  { id: "zoom", name: "Zoom", host: "status.zoom.us", keywords: ["meetings", "video"] },
  { id: "figma", name: "Figma", host: "status.figma.com", keywords: ["design"] },
  { id: "circleci", name: "CircleCI", host: "status.circleci.com", keywords: ["ci"] },
  { id: "supabase", name: "Supabase", host: "status.supabase.com", keywords: ["postgres", "database"] },
  { id: "flyio", name: "Fly.io", host: "status.flyio.net", keywords: ["fly", "deploy"] },
];

/**
 * The "Custom status pages" preference: `Acme=abc123, Beta=https://x.statuspage.io`.
 * Only `<id>.statuspage.io` can be reached (net permissions are exact hosts).
 */
export function parseCustom(input: unknown): { services: Service[]; errors: string[] } {
  const services: Service[] = [];
  const errors: string[] = [];
  for (const raw of String(input ?? "").split(/[,\n]/)) {
    const entry = raw.trim();
    if (!entry) continue;
    const eq = entry.indexOf("=");
    const name = eq > 0 ? entry.slice(0, eq).trim() : "";
    let id = (eq > 0 ? entry.slice(eq + 1) : entry).trim().toLowerCase();
    id = id.replace(/^https?:\/\//, "").split(/[/?#]/)[0].replace(/\.statuspage\.io$/, "");
    if (!/^[a-z0-9-]+$/.test(id)) {
      errors.push(entry);
      continue;
    }
    services.push({ id: `custom-${id}`, name: name || id, host: `${id}.statuspage.io` });
  }
  return { services, errors };
}

// ---------------------------------------------------------------------------
// Shapes of summary.json

export type ComponentStatus =
  | "operational"
  | "degraded_performance"
  | "partial_outage"
  | "major_outage"
  | "under_maintenance";

export interface Component {
  id: string;
  name: string;
  status: ComponentStatus | string;
  description?: string | null;
  position?: number;
  group_id?: string | null;
  group?: boolean;
  only_show_if_degraded?: boolean;
  components?: string[];
  updated_at?: string;
}

export interface IncidentUpdate {
  id: string;
  status: string;
  body: string;
  created_at: string;
  display_at?: string;
  affected_components?: { code: string; name: string; old_status: string; new_status: string }[] | null;
}

export interface Incident {
  id: string;
  name: string;
  status: string;
  impact: "none" | "minor" | "major" | "critical" | "maintenance" | string;
  shortlink?: string;
  created_at: string;
  updated_at?: string;
  started_at?: string;
  scheduled_for?: string | null;
  scheduled_until?: string | null;
  incident_updates: IncidentUpdate[];
  components?: { id: string; name: string; status: string }[];
}

export interface Summary {
  page: { id: string; name: string; url: string; updated_at?: string; time_zone?: string };
  status: { indicator: "none" | "minor" | "major" | "critical" | "maintenance" | string; description: string };
  components: Component[];
  incidents: Incident[];
  scheduled_maintenances?: Incident[];
}

// ---------------------------------------------------------------------------
// Looks

export interface Look {
  label: string;
  color: Color;
  icon: string;
  /** Higher is worse; used to sort. */
  rank: number;
}

const COMPONENT: Record<string, Look> = {
  major_outage: { label: "Major outage", color: "red", icon: Icons.cross, rank: 4 },
  partial_outage: { label: "Partial outage", color: "orange", icon: Icons.alert, rank: 3 },
  degraded_performance: { label: "Degraded", color: "yellow", icon: Icons.alert, rank: 2 },
  under_maintenance: { label: "Maintenance", color: "blue", icon: Icons.settings, rank: 1 },
  operational: { label: "Operational", color: "green", icon: Icons.done, rank: 0 },
};

export const componentLook = (status: string): Look =>
  COMPONENT[status] ?? { label: humanize(status), color: "gray", icon: Icons.question, rank: 0 };

const INDICATOR: Record<string, Look> = {
  critical: { label: "Major outage", color: "red", icon: Icons.cross, rank: 4 },
  major: { label: "Partial outage", color: "orange", icon: Icons.alert, rank: 3 },
  minor: { label: "Degraded", color: "yellow", icon: Icons.alert, rank: 2 },
  maintenance: { label: "Maintenance", color: "blue", icon: Icons.settings, rank: 1 },
  none: { label: "Operational", color: "green", icon: Icons.done, rank: 0 },
};

export const UNREACHABLE: Look = { label: "Unreachable", color: "gray", icon: Icons.wifiOff, rank: -1 };
export const LOADING: Look = { label: "Checking…", color: "gray", icon: Icons.dottedCircle, rank: -2 };

/**
 * How a service is doing. The page indicator only counts incidents, so a
 * component marked down without an incident still makes the service red.
 */
export function overall(s: Summary): Look {
  const byIndicator = INDICATOR[s.status?.indicator] ?? INDICATOR.none;
  const worst = s.components.filter((c) => !c.group).reduce(
    (w, c) => (componentLook(c.status).rank > w.rank ? componentLook(c.status) : w),
    INDICATOR.none,
  );
  return worst.rank > byIndicator.rank ? worst : byIndicator;
}

export const impactColor = (impact: string): Color =>
  impact === "critical" ? "red" : impact === "major" ? "orange" : impact === "minor" ? "yellow" : "blue";

/** The short word for the root subtitle: "GitHub: degraded". */
export const shortWord = (look: Look) =>
  look.rank >= 3 ? (look.rank === 4 ? "outage" : "partial outage") : look.label.toLowerCase();

// ---------------------------------------------------------------------------
// Formatting

export function humanize(word: string): string {
  const s = String(word ?? "").replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "just now", "5m ago", "3h ago", "2d ago". */
export function ago(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const s = Math.round((now.getTime() - new Date(iso).getTime()) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** "28 Oct, 14:05" in the local time zone. */
export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const date = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

/** Real components (not groups), worst first, then in page order. */
export function components(s: Summary): Component[] {
  return s.components
    .filter((c) => !c.group)
    .map((c, i) => ({ c, i }))
    .sort((a, b) =>
      componentLook(b.c.status).rank - componentLook(a.c.status).rank ||
      (a.c.position ?? a.i) - (b.c.position ?? b.i)
    )
    .map(({ c }) => c);
}

export const affected = (s: Summary) => components(s).filter((c) => c.status !== "operational");

/** Group name of each component id, for "API Requests · Codespaces". */
export function groups(s: Summary): Map<string, string> {
  const names = new Map(s.components.filter((c) => c.group).map((g) => [g.id, g.name]));
  return new Map(
    s.components.filter((c) => c.group_id && names.has(c.group_id)).map((c) => [c.id, names.get(c.group_id!)!]),
  );
}

/** Statuspage bodies are plain text with the odd HTML link. */
export function cleanBody(body: string): string {
  return String(body ?? "")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/gi, "[$2]($1)")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

/** An incident with its updates, newest first. */
export function incidentMarkdown(incident: Incident, o: { updates?: number } = {}): string {
  const updates = [...incident.incident_updates]
    .sort((a, b) => Date.parse(b.display_at ?? b.created_at) - Date.parse(a.display_at ?? a.created_at))
    .slice(0, o.updates ?? Infinity);
  const lines = [`### ${incident.name}`, ""];
  const window = incident.scheduled_for
    ? ` · ${when(incident.scheduled_for)} → ${when(incident.scheduled_until)}`
    : ` · since ${when(incident.started_at ?? incident.created_at)}`;
  lines.push(`**${humanize(incident.status)}** · impact ${incident.impact}${window}`, "");
  for (const u of updates) {
    lines.push(`**${humanize(u.status)}** — ${when(u.display_at ?? u.created_at)}`, "");
    lines.push(cleanBody(u.body), "");
  }
  const hidden = incident.incident_updates.length - updates.length;
  if (hidden > 0) lines.push(`_${hidden} earlier update${hidden === 1 ? "" : "s"}_`, "");
  return lines.join("\n").trim();
}

/** Maintenance that is running or starts within two days. */
export function upcomingMaintenance(s: Summary, now = new Date()): Incident[] {
  return (s.scheduled_maintenances ?? []).filter((m) =>
    m.status === "in_progress" || m.status === "verifying" ||
    (m.scheduled_for && Date.parse(m.scheduled_for) - now.getTime() < 2 * 86_400_000)
  );
}

export function serviceMarkdown(service: Service, s: Summary, now = new Date()): string {
  const parts: string[] = [];
  if (s.incidents.length) {
    parts.push(...s.incidents.map((i) => incidentMarkdown(i, { updates: 3 })));
  } else {
    parts.push(`**${s.status.description}**`);
  }
  const maintenance = upcomingMaintenance(s, now);
  if (maintenance.length) {
    parts.push("---", ...maintenance.map((m) => incidentMarkdown(m, { updates: 1 })));
  }
  if (!s.incidents.length && !maintenance.length) {
    parts.push(`No open incident on ${service.name}'s status page.`);
  }
  return parts.join("\n\n");
}

export function serviceStats(s: Summary): Stat[] {
  const look = overall(s);
  const real = components(s);
  const down = real.filter((c) => c.status !== "operational").length;
  return [
    { label: "Status", value: look.label, color: look.color },
    {
      label: "Components",
      value: down ? `${down} of ${real.length} affected` : `${real.length} OK`,
      color: down ? look.color : "green",
    },
    {
      label: "Incidents",
      value: s.incidents.length,
      color: s.incidents.length ? impactColor(s.incidents[0].impact) : undefined,
    },
  ];
}

/** Affected components first, then a handful of the healthy ones. */
export function serviceMetadata(service: Service, s: Summary, now = new Date()): Metadata[] {
  const all = components(s);
  const bad = all.filter((c) => c.status !== "operational");
  const group = groups(s);
  const line = (c: Component) => {
    const look = componentLook(c.status);
    const label = group.has(c.id) ? `${group.get(c.id)} · ${c.name}` : c.name;
    return meta.text(label, look.label, { icon: { source: look.icon, tint: look.color }, color: look.color });
  };
  const shown = bad.length > 12
    ? bad.slice(0, 12)
    : [...bad, ...all.filter((c) => c.status === "operational")].slice(0, 12);
  const rest = all.length - shown.length;
  return [
    ...shown.map(line),
    ...(rest > 0 ? [meta.text(`${rest} more`, "Show Components (Ctrl+Enter)", { icon: Icons.layers })] : []),
    meta.separator(),
    meta.link("Status page", s.page.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), s.page.url),
    ...(s.page.updated_at ? [meta.text("Updated", ago(s.page.updated_at, now), { icon: Icons.clock })] : []),
    meta.text("Feed", service.host, { icon: Icons.globe }),
  ];
}

/** "GitHub: degraded", "GitHub: outage · +2", or "All systems operational". */
export function subtitle(results: { service: Service; look: Look }[]): string | null {
  if (!results.length) return null;
  const bad = results.filter((r) => r.look.rank >= 1).sort((a, b) => b.look.rank - a.look.rank);
  if (!bad.length) {
    return results.every((r) => r.look.rank === 0) ? "All systems operational" : null;
  }
  const first = `${bad[0].service.name}: ${shortWord(bad[0].look)}`;
  return bad.length > 1 ? `${first} · +${bad.length - 1}` : first;
}
