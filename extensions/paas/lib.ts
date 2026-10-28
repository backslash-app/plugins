// flyctl JSON and Railway GraphQL responses as plain data. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type Health = "failed" | "busy" | "ok" | "idle" | "other";

export const HEALTH_COLORS: Record<Health, Color> = {
  failed: "red",
  busy: "yellow",
  ok: "green",
  idle: "gray",
  other: "gray",
};

const pick = (o: any, ...keys: string[]) => {
  for (const k of keys) if (o?.[k] !== undefined && o?.[k] !== null) return o[k];
  return undefined;
};

// ---------------------------------------------------------------------------
// Fly.io

export interface FlyApp {
  name: string;
  status: string;
  deployed: boolean;
  hostname?: string;
  org: string;
  orgSlug?: string;
}

/** `flyctl apps list --json` (PascalCase keys; lower case accepted too). */
export function parseFlyApps(json: string): FlyApp[] {
  const data = JSON.parse(json || "[]") ?? [];
  return (data as any[]).map((a) => {
    const org = pick(a, "Organization", "organization") ?? {};
    return {
      name: String(pick(a, "Name", "name", "ID", "id")),
      status: String(pick(a, "Status", "status") ?? "unknown").toLowerCase(),
      deployed: !!pick(a, "Deployed", "deployed"),
      hostname: pick(a, "Hostname", "hostname") || undefined,
      org: String(pick(org, "Name", "name", "Slug", "slug") ?? "personal"),
      orgSlug: pick(org, "Slug", "slug") || undefined,
    };
  }).filter((a) => a.name && a.name !== "undefined");
}

export interface Machine {
  id: string;
  name: string;
  state: string;
  region: string;
  image?: string;
  processGroup?: string;
  checks: { name: string; status: string }[];
  updated?: Date;
}

export interface FlyStatus {
  machines: Machine[];
  version?: number;
}

/** `flyctl status -a <app> --json` or `flyctl machines list --json`. */
export function parseFlyStatus(json: string): FlyStatus {
  const data = JSON.parse(json || "{}") ?? {};
  const list = Array.isArray(data) ? data : pick(data, "Machines", "machines") ?? [];
  return {
    version: pick(data, "Version", "version"),
    machines: (list as any[]).map((m) => {
      const img = m.image_ref ?? m.ImageRef;
      return {
        id: String(m.id ?? m.ID),
        name: String(m.name ?? m.Name ?? m.id),
        state: String(m.state ?? m.State ?? "unknown"),
        region: String(m.region ?? m.Region ?? ""),
        image: img ? `${img.repository ?? ""}${img.tag ? `:${img.tag}` : ""}` || undefined : undefined,
        processGroup: m.config?.metadata?.fly_process_group || undefined,
        checks: (m.checks ?? []).map((c: any) => ({ name: String(c.name), status: String(c.status) })),
        updated: m.updated_at ? new Date(m.updated_at) : undefined,
      };
    }),
  };
}

export interface MachineSummary {
  total: number;
  started: number;
  stopped: number;
  failing: number;
  regions: string[];
}

export function summarizeMachines(machines: Machine[]): MachineSummary {
  return {
    total: machines.length,
    started: machines.filter((m) => m.state === "started").length,
    stopped: machines.filter((m) => ["stopped", "suspended"].includes(m.state)).length,
    failing:
      machines.filter((m) =>
        ["failed", "destroyed", "replacing"].includes(m.state) || m.checks.some((c) => c.status === "critical")
      ).length,
    regions: [...new Set(machines.map((m) => m.region).filter(Boolean))].sort(),
  };
}

/** The app's health from its status and, when known, its machines. */
export function flyHealth(app: FlyApp, s?: MachineSummary): Health {
  if (app.status === "suspended" || (s && s.total && s.stopped === s.total)) return "idle";
  if (s?.failing) return "failed";
  if (app.status === "pending" || !app.deployed) return app.status === "pending" ? "busy" : "idle";
  if (app.status === "deployed" || app.status === "running") return "ok";
  return "other";
}

export interface Release {
  version: number;
  status: string;
  stable: boolean;
  inProgress: boolean;
  description: string;
  user?: string;
  created?: Date;
  image?: string;
  strategy?: string;
}

/** `flyctl releases -a <app> --json`, newest first. */
export function parseReleases(json: string): Release[] {
  const data = JSON.parse(json || "[]") ?? [];
  return (data as any[]).map((r) => ({
    version: Number(pick(r, "Version", "version")) || 0,
    status: String(pick(r, "Status", "status") ?? "").toLowerCase(),
    stable: !!pick(r, "Stable", "stable"),
    inProgress: !!pick(r, "InProgress", "inProgress"),
    description: String(pick(r, "Description", "description", "Reason", "reason") ?? ""),
    user: pick(pick(r, "User", "user") ?? {}, "Email", "email", "Name", "name"),
    created: pick(r, "CreatedAt", "createdAt") ? new Date(pick(r, "CreatedAt", "createdAt")) : undefined,
    image: pick(r, "ImageRef", "imageRef") || undefined,
    strategy: pick(r, "DeploymentStrategy", "deploymentStrategy") || undefined,
  })).sort((a, b) => b.version - a.version);
}

export const flyUrl = (app: FlyApp) => `https://${app.hostname ?? `${app.name}.fly.dev`}`;
export const flyDashboard = (name: string, page = "") => `https://fly.io/apps/${name}${page}`;

/** What flyctl prints when nobody is signed in. */
export const isFlySignedOut = (message: string) =>
  /no access token|not logged in|flyctl auth login|fly auth login|unauthorized/i.test(message);

// ---------------------------------------------------------------------------
// Railway

export interface RailwayService {
  projectId: string;
  projectName: string;
  serviceId: string;
  serviceName: string;
  icon?: string;
  environmentId: string;
  environmentName: string;
  domains: string[];
  deployment?: RailwayDeployment;
}

export interface RailwayDeployment {
  id: string;
  status: string;
  created?: Date;
  url?: string;
  commitMessage?: string;
  commitHash?: string;
  branch?: string;
  author?: string;
}

export const PROJECTS_QUERY = `query Projects {
  projects(first: 50) {
    edges { node {
      id name updatedAt
      environments { edges { node { id name } } }
      services { edges { node {
        id name icon
        serviceInstances { edges { node {
          environmentId
          domains { serviceDomains { domain } customDomains { domain } }
          latestDeployment { id status createdAt staticUrl url meta }
        } } }
      } } }
    } }
  }
}`;

export const DEPLOYMENTS_QUERY = `query Deployments($serviceId: String!, $environmentId: String!) {
  deployments(first: 15, input: { serviceId: $serviceId, environmentId: $environmentId }) {
    edges { node { id status createdAt staticUrl url meta } }
  }
}`;

export const LOGS_QUERY = `query Logs($deploymentId: String!) {
  deploymentLogs(deploymentId: $deploymentId, limit: 200) { timestamp message severity }
}`;

export const RESTART_MUTATION = `mutation Restart($id: String!) { deploymentRestart(id: $id) }`;
export const REDEPLOY_MUTATION = `mutation Redeploy($id: String!) { deploymentRedeploy(id: $id) { id status } }`;

const edges = (conn: any): any[] => (conn?.edges ?? []).map((e: any) => e.node).filter(Boolean);

export function parseDeployment(d: any): RailwayDeployment | undefined {
  if (!d?.id) return undefined;
  const meta = d.meta ?? {};
  const url = d.staticUrl || d.url;
  return {
    id: String(d.id),
    status: String(d.status ?? "UNKNOWN"),
    created: d.createdAt ? new Date(d.createdAt) : undefined,
    url: url ? (String(url).startsWith("http") ? String(url) : `https://${url}`) : undefined,
    commitMessage: meta.commitMessage ? String(meta.commitMessage).split("\n")[0] : undefined,
    commitHash: meta.commitHash || undefined,
    branch: meta.branch || undefined,
    author: meta.commitAuthor || undefined,
  };
}

/** One row per service and environment it runs in. */
export function parseRailwayProjects(data: any): RailwayService[] {
  const out: RailwayService[] = [];
  for (const project of edges(data?.projects)) {
    const envs = new Map<string, string>(edges(project.environments).map((e: any) => [e.id, e.name]));
    for (const service of edges(project.services)) {
      for (const inst of edges(service.serviceInstances)) {
        const d = inst.domains ?? {};
        const domains = [
          ...(d.customDomains ?? []).map((x: any) => x.domain),
          ...(d.serviceDomains ?? []).map((x: any) => x.domain),
        ].filter(Boolean);
        out.push({
          projectId: project.id,
          projectName: project.name,
          serviceId: service.id,
          serviceName: service.name,
          icon: service.icon || undefined,
          environmentId: inst.environmentId,
          environmentName: envs.get(inst.environmentId) ?? "production",
          domains,
          deployment: parseDeployment(inst.latestDeployment),
        });
      }
    }
  }
  return out.sort((a, b) =>
    a.projectName.localeCompare(b.projectName) || a.serviceName.localeCompare(b.serviceName) ||
    Number(b.environmentName === "production") - Number(a.environmentName === "production")
  );
}

export const parseDeployments = (data: any) =>
  edges(data?.deployments).map(parseDeployment).filter((d): d is RailwayDeployment => !!d);

export function railwayHealth(status?: string): Health {
  switch (status) {
    case "SUCCESS":
      return "ok";
    case "FAILED":
    case "CRASHED":
      return "failed";
    case "BUILDING":
    case "DEPLOYING":
    case "INITIALIZING":
    case "QUEUED":
    case "WAITING":
    case "REMOVING":
      return "busy";
    case "SLEEPING":
    case "REMOVED":
    case "SKIPPED":
      return "idle";
    default:
      return "other";
  }
}

/** `CRASHED` → `Crashed`. */
export const statusLabel = (status: string) =>
  status ? status.charAt(0).toUpperCase() + status.slice(1).toLowerCase().replace(/[_-]/g, " ") : "Unknown";

export const railwayDashboard = (s: { projectId: string; serviceId?: string; environmentId?: string }) =>
  `https://railway.com/project/${s.projectId}${s.serviceId ? `/service/${s.serviceId}` : ""}${
    s.environmentId ? `?environmentId=${s.environmentId}` : ""
  }`;

/** The token the Railway CLI saved with `railway login`. */
export function cliToken(configJson: string): string | undefined {
  try {
    const c = JSON.parse(configJson);
    return c?.user?.token || undefined;
  } catch {
    return undefined;
  }
}

export interface LogLine {
  timestamp: string;
  message: string;
  severity?: string;
}

export const formatLogs = (lines: LogLine[]) =>
  lines.map((l) => `${l.timestamp.slice(11, 19)}  ${l.severity === "error" ? "ERR " : "    "}${l.message}`).join("\n");

// ---------------------------------------------------------------------------
// Formatting and installing

export function ago(date: Date | undefined, now = Date.now()): string {
  if (!date || isNaN(date.getTime())) return "";
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 60) return `${d} d ago`;
  if (d < 730) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} y ago`;
}

export type Family = "debian" | "fedora" | "arch" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

export function flyInstallCommand(family: Family | undefined): string {
  return family === "arch" ? "yay -S flyctl-bin   # AUR" : "curl -L https://fly.io/install.sh | sh";
}
