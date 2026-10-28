// Pure logic of the Cloudflare extension: API response mapping, DNS record
// validation and display, Pages states. No I/O here.

export interface Envelope<T> {
  success: boolean;
  errors?: { code: number; message: string }[];
  messages?: unknown[];
  result: T;
  result_info?: { page: number; per_page: number; total_pages?: number; count: number; total_count?: number };
}

/** The first error of a failed response, readable. */
export function apiError(body: Partial<Envelope<unknown>> | undefined, status: number): string {
  const e = body?.errors?.[0];
  return e ? `${e.message}${e.code ? ` (${e.code})` : ""}` : `Cloudflare answered ${status}`;
}

/** Whether there is a page after `info`. */
export function hasNextPage(info: Envelope<unknown>["result_info"]): boolean {
  if (!info) return false;
  if (info.total_pages !== undefined) return info.page < info.total_pages;
  return info.count === info.per_page;
}

// --- Zones -------------------------------------------------------------------------------

export interface Zone {
  id: string;
  name: string;
  status: string;
  paused: boolean;
  type: string;
  plan: string;
  accountId: string;
  accountName: string;
  nameServers: string[];
  originalRegistrar?: string;
  developmentMode: number;
  activated?: Date;
}

export function mapZone(z: any): Zone {
  return {
    id: z.id,
    name: z.name,
    status: z.status ?? "unknown",
    paused: !!z.paused,
    type: z.type ?? "full",
    plan: z.plan?.name ?? "",
    accountId: z.account?.id ?? "",
    accountName: z.account?.name ?? "",
    nameServers: z.name_servers ?? [],
    originalRegistrar: z.original_registrar || undefined,
    developmentMode: Number(z.development_mode ?? 0),
    activated: z.activated_on ? new Date(z.activated_on) : undefined,
  };
}

export const ZONE_COLORS: Record<string, "green" | "yellow" | "gray" | "red"> = {
  active: "green",
  pending: "yellow",
  initializing: "yellow",
  moved: "gray",
  deactivated: "gray",
  deleted: "red",
  read_only: "gray",
};

export const zoneColor = (z: Zone) => z.paused ? "orange" as const : ZONE_COLORS[z.status] ?? "gray";
export const zoneStatusLabel = (z: Zone) => z.paused ? "Paused" : capitalize(z.status.replace(/_/g, " "));

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const zoneDashboardUrl = (z: Zone) => `https://dash.cloudflare.com/${z.accountId}/${z.name}`;
export const dnsDashboardUrl = (z: Zone) => `https://dash.cloudflare.com/${z.accountId}/${z.name}/dns/records`;

// --- DNS records ---------------------------------------------------------------------------

export interface DnsRecord {
  id: string;
  zoneId: string;
  zoneName: string;
  name: string;
  type: string;
  content: string;
  proxied: boolean;
  proxiable: boolean;
  ttl: number;
  priority?: number;
  comment?: string;
  tags: string[];
  modified?: Date;
}

export function mapRecord(r: any, zone?: { id: string; name: string }): DnsRecord {
  return {
    id: r.id,
    zoneId: r.zone_id ?? zone?.id ?? "",
    zoneName: r.zone_name ?? zone?.name ?? "",
    name: r.name,
    type: r.type,
    content: r.content ?? "",
    proxied: !!r.proxied,
    proxiable: !!r.proxiable,
    ttl: Number(r.ttl ?? 1),
    priority: typeof r.priority === "number" ? r.priority : undefined,
    comment: r.comment || undefined,
    tags: r.tags ?? [],
    modified: r.modified_on ? new Date(r.modified_on) : undefined,
  };
}

export const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "TXT", "NS", "SRV", "CAA", "PTR", "HTTPS"];

/** Types Cloudflare can proxy. */
export const PROXIABLE = ["A", "AAAA", "CNAME"];

export type RecordFilter = "all" | "address" | "cname" | "mx" | "txt" | "proxied" | "dns-only";

export function filterRecords(all: DnsRecord[], filter: RecordFilter): DnsRecord[] {
  switch (filter) {
    case "address":
      return all.filter((r) => r.type === "A" || r.type === "AAAA");
    case "cname":
      return all.filter((r) => r.type === "CNAME");
    case "mx":
      return all.filter((r) => r.type === "MX");
    case "txt":
      return all.filter((r) => r.type === "TXT");
    case "proxied":
      return all.filter((r) => r.proxied);
    case "dns-only":
      return all.filter((r) => r.proxiable && !r.proxied);
    default:
      return all;
  }
}

const TYPE_ORDER = ["A", "AAAA", "CNAME", "MX", "TXT"];

export function sortRecords(all: DnsRecord[]): DnsRecord[] {
  const rank = (t: string) => (TYPE_ORDER.indexOf(t) + 1) || 99;
  return [...all].sort((a, b) =>
    a.zoneName.localeCompare(b.zoneName) ||
    // The apex first, then by name.
    Number(b.name === b.zoneName) - Number(a.name === a.zoneName) ||
    a.name.localeCompare(b.name) ||
    rank(a.type) - rank(b.type) ||
    (a.priority ?? 0) - (b.priority ?? 0)
  );
}

/** `www.example.com` in `example.com` → `www`; the apex → `@`. */
export function shortName(name: string, zone: string): string {
  if (name === zone) return "@";
  return name.endsWith(`.${zone}`) ? name.slice(0, -zone.length - 1) : name;
}

export const ttlLabel = (ttl: number) =>
  ttl === 1
    ? "Auto"
    : ttl % 86400 === 0
    ? `${ttl / 86400} d`
    : ttl % 3600 === 0
    ? `${ttl / 3600} h`
    : ttl % 60 === 0
    ? `${ttl / 60} min`
    : `${ttl} s`;

/** A BIND zone file line. */
export function zoneFileLine(r: DnsRecord): string {
  const ttl = r.ttl === 1 ? 300 : r.ttl;
  const content = r.type === "TXT" && !r.content.startsWith('"') ? `"${r.content.replace(/"/g, '\\"')}"` : r.content;
  const fqdn = (s: string) =>
    /^[\w.-]+$/.test(s) && ["CNAME", "MX", "NS", "PTR"].includes(r.type) && !s.endsWith(".") ? `${s}.` : s;
  return [`${r.name}.`, ttl, "IN", r.type, ...(r.priority !== undefined ? [r.priority] : []), fqdn(content)].join("\t");
}

export const TYPE_COLORS: Record<string, "blue" | "purple" | "teal" | "orange" | "green" | "gray"> = {
  A: "blue",
  AAAA: "purple",
  CNAME: "teal",
  MX: "orange",
  TXT: "green",
};

export interface RecordInput {
  type?: string;
  name?: string;
  content?: string;
  ttl?: string;
  priority?: string;
  proxied?: boolean | string;
  comment?: string;
}

/** Validates the form and builds the API body. */
export function recordBody(v: RecordInput, zone: string): Record<string, string | number | boolean> {
  const type = (v.type ?? "A").toUpperCase();
  if (!RECORD_TYPES.includes(type)) throw new Error(`Unsupported type ${type}`);
  let name = (v.name ?? "").trim().replace(/\.$/, "");
  if (!name || name === "@") name = zone;
  else if (name !== zone && !name.endsWith(`.${zone}`)) name = `${name}.${zone}`;
  const content = (v.content ?? "").trim();
  if (!content) throw new Error("Content is required");
  if (type === "A" && !/^(\d{1,3}\.){3}\d{1,3}$/.test(content)) throw new Error(`“${content}” is not an IPv4 address`);
  if (type === "AAAA" && !/^[0-9a-f:]+$/i.test(content)) throw new Error(`“${content}” is not an IPv6 address`);
  const ttlText = (v.ttl ?? "").trim().toLowerCase();
  const ttl = !ttlText || ttlText === "auto" ? 1 : Number(ttlText);
  if (!Number.isInteger(ttl) || (ttl !== 1 && (ttl < 60 || ttl > 86400))) {
    throw new Error("TTL is “auto” or a number of seconds from 60 to 86400");
  }
  const proxied = (v.proxied === true || v.proxied === "true") && PROXIABLE.includes(type);
  const body: Record<string, string | number | boolean> = { type, name, content, ttl: proxied ? 1 : ttl, proxied };
  if (type === "MX" || type === "SRV") {
    const p = Number((v.priority ?? "").trim() || "10");
    if (!Number.isInteger(p) || p < 0 || p > 65535) throw new Error("Priority is a number from 0 to 65535");
    body.priority = p;
  }
  const comment = (v.comment ?? "").trim();
  if (comment) body.comment = comment;
  return body;
}

// --- Cache purge -------------------------------------------------------------------------

/** URLs from a text area: one per line or separated by spaces, scheme added when missing. */
export function purgeUrls(text: string, zone: string): string[] {
  const urls = text.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean).map((u) =>
    /^https?:\/\//i.test(u) ? u : `https://${u.startsWith("/") ? zone + u : u}`
  );
  for (const u of urls) {
    let host: string;
    try {
      host = new URL(u).hostname;
    } catch {
      throw new Error(`“${u}” is not a URL`);
    }
    if (host !== zone && !host.endsWith(`.${zone}`)) throw new Error(`${host} is not in ${zone}`);
  }
  if (!urls.length) throw new Error("Enter at least one URL");
  return [...new Set(urls)];
}

/** Cloudflare accepts 30 URLs per purge request. */
export function chunks<T>(all: T[], size = 30): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < all.length; i += size) out.push(all.slice(i, i + size));
  return out;
}

// --- Pages ----------------------------------------------------------------------------------

export interface Deployment {
  id: string;
  shortId: string;
  url: string;
  environment: string;
  stage: string;
  status: string;
  branch?: string;
  commit?: string;
  message?: string;
  trigger?: string;
  created?: Date;
  aliases: string[];
}

export interface PagesProject {
  name: string;
  accountId: string;
  subdomain: string;
  domains: string[];
  productionBranch?: string;
  repo?: string;
  created?: Date;
  latest?: Deployment;
}

export function mapDeployment(d: any): Deployment {
  const meta = d.deployment_trigger?.metadata ?? {};
  return {
    id: d.id,
    shortId: d.short_id ?? String(d.id).slice(0, 8),
    url: d.url ?? "",
    environment: d.environment ?? "production",
    stage: d.latest_stage?.name ?? "",
    status: d.latest_stage?.status ?? "",
    branch: meta.branch || undefined,
    commit: meta.commit_hash ? String(meta.commit_hash).slice(0, 7) : undefined,
    message: meta.commit_message ? String(meta.commit_message).split("\n")[0] : undefined,
    trigger: d.deployment_trigger?.type,
    created: d.created_on ? new Date(d.created_on) : undefined,
    aliases: d.aliases ?? [],
  };
}

export function mapProject(p: any, accountId: string): PagesProject {
  const src = p.source?.config;
  return {
    name: p.name,
    accountId,
    subdomain: p.subdomain ?? `${p.name}.pages.dev`,
    domains: (p.domains ?? []).filter((d: string) => !d.endsWith(".pages.dev")),
    productionBranch: p.production_branch || undefined,
    repo: src?.owner && src?.repo_name ? `${src.owner}/${src.repo_name}` : undefined,
    created: p.created_on ? new Date(p.created_on) : undefined,
    latest: p.latest_deployment ? mapDeployment(p.latest_deployment) : undefined,
  };
}

export type DeployState = "success" | "failure" | "building" | "queued" | "canceled" | "unknown";

/** One state from the latest stage: a finished deploy is a success, any failed stage a failure. */
export function deployState(d: Deployment | undefined): DeployState {
  if (!d) return "unknown";
  if (d.status === "failure") return "failure";
  if (d.status === "canceled") return "canceled";
  if (d.status === "success" && d.stage === "deploy") return "success";
  if (d.stage === "queued" || (d.status === "idle" && d.stage !== "deploy")) return "queued";
  if (d.status === "active" || d.status === "success" || d.status === "idle") return "building";
  return "unknown";
}

export const DEPLOY_COLORS = {
  success: "green",
  failure: "red",
  building: "yellow",
  queued: "blue",
  canceled: "gray",
  unknown: "gray",
} as const;

export const DEPLOY_LABELS = {
  success: "Deployed",
  failure: "Failed",
  building: "Building",
  queued: "Queued",
  canceled: "Canceled",
  unknown: "No deployment",
};

export const pagesDashboardUrl = (p: { accountId: string; name: string }) =>
  `https://dash.cloudflare.com/${p.accountId}/pages/view/${p.name}`;

export const deploymentDashboardUrl = (p: { accountId: string; name: string }, d: Deployment) =>
  `${pagesDashboardUrl(p)}/${d.id}`;

// --- Formatting -------------------------------------------------------------------------------

export function age(date: Date | undefined, now = new Date()): string {
  if (!date || isNaN(date.getTime())) return "";
  const s = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export const formatDate = (d?: Date) =>
  d && !isNaN(d.getTime()) ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";
