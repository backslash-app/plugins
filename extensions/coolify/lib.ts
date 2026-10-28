// Coolify (API v1) and Dokploy payloads as one list of resources and deployments. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type Platform = "coolify" | "dokploy";
export const PLATFORM_NAMES: Record<Platform, string> = { coolify: "Coolify", dokploy: "Dokploy" };

export type Kind = "application" | "service" | "database" | "compose";
export type State = "running" | "degraded" | "deploying" | "stopped" | "error" | "unknown";

export interface Status {
  state: State;
  /** Coolify's health half: healthy, unhealthy, unknown. */
  health: string;
  /** As the platform says it. */
  raw: string;
}

export interface Deployment {
  id: string;
  status: "success" | "failed" | "running" | "queued" | "cancelled" | "unknown";
  commit: string;
  message: string;
  created: string;
  finished: string;
  /** The deployment's page in the web UI. */
  url: string;
  trigger: string;
}

export interface Resource {
  platform: Platform;
  kind: Kind;
  /** Coolify uuid, Dokploy applicationId / composeId. */
  id: string;
  name: string;
  description: string;
  /** Docker image or database engine (Coolify's type, e.g. standalone-postgresql). */
  type: string;
  status: Status;
  urls: string[];
  project: string;
  environment: string;
  /** The resource's page in the web UI. */
  ui: string;
  repository: string;
  branch: string;
  buildPack: string;
  updated: string;
}

type Raw = Record<string, any>;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** `coolify.example.com/` → `https://coolify.example.com`; an `/api/v1` suffix is dropped. */
export function normalizeUrl(input: unknown): string {
  let text = String(input ?? "").trim();
  if (!text) return "";
  if (!/^[a-z]+:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    const path = url.pathname.replace(/\/+$/, "").replace(/\/api(\/v1)?$/, "").replace(/\/dashboard.*$/, "");
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return "";
  }
}

/** Coolify's `fqdn` ("https://a.example.com,https://b.example.com:8080") → URLs. */
export function splitFqdn(fqdn: unknown): string[] {
  return str(fqdn).split(",").map((u) => u.trim()).filter(Boolean).map((u) =>
    /^[a-z]+:\/\//i.test(u) ? u : `https://${u}`
  );
}

// ---------------------------------------------------------------------------
// Statuses

/** Coolify: "running:healthy", "exited:unhealthy", "running:unknown", "degraded:unhealthy", "restarting"… */
export function coolifyStatus(raw: unknown): Status {
  const text = str(raw).toLowerCase();
  const [main, health = ""] = text.replace(/[()]/g, ":").split(":").map((s) => s.trim());
  let state: State = "unknown";
  if (main.startsWith("running")) state = health === "unhealthy" ? "degraded" : "running";
  else if (main.startsWith("degraded")) state = "degraded";
  else if (main.startsWith("restarting") || main.startsWith("starting") || main.startsWith("in_progress")) {
    state = "deploying";
  } else if (main.startsWith("exited") || main.startsWith("stopped") || main.startsWith("paused")) state = "stopped";
  else if (main.startsWith("dead") || main.startsWith("removing") || main.startsWith("failed")) state = "error";
  return { state, health, raw: str(raw) };
}

/** Dokploy: "idle" (not deployed or stopped), "running" (deploying), "done" (deployed), "error". */
export function dokployStatus(raw: unknown): Status {
  const text = str(raw).toLowerCase();
  const map: Record<string, State> = { done: "running", running: "deploying", error: "error", idle: "stopped" };
  return { state: map[text] ?? "unknown", health: "", raw: str(raw) };
}

export const STATE_LOOK: Record<State, { label: string; color: Color; icon: string }> = {
  running: { label: "Running", color: "green", icon: "bs-circle-check" },
  degraded: { label: "Unhealthy", color: "orange", icon: "bs-alert" },
  deploying: { label: "Deploying", color: "blue", icon: "bs-circle-half" },
  stopped: { label: "Stopped", color: "gray", icon: "bs-circle" },
  error: { label: "Failed", color: "red", icon: "bs-circle-x" },
  unknown: { label: "Unknown", color: "gray", icon: "bs-question" },
};

export const DEPLOYMENT_LOOK: Record<Deployment["status"], { label: string; color: Color }> = {
  success: { label: "Finished", color: "green" },
  failed: { label: "Failed", color: "red" },
  running: { label: "In progress", color: "blue" },
  queued: { label: "Queued", color: "yellow" },
  cancelled: { label: "Cancelled", color: "gray" },
  unknown: { label: "Unknown", color: "gray" },
};

// ---------------------------------------------------------------------------
// Coolify

export interface CoolifyEnvironment {
  projectUuid: string;
  projectName: string;
  name: string;
  /** Recent Coolify versions route by environment uuid, older ones by name. */
  uuid: string;
}

/** `GET /projects/{uuid}` for each project → environment id → where it is. */
export function coolifyEnvironments(projects: Raw[]): Map<number, CoolifyEnvironment> {
  const map = new Map<number, CoolifyEnvironment>();
  for (const p of projects) {
    for (const e of (p.environments ?? []) as Raw[]) {
      if (e.id === undefined) continue;
      map.set(Number(e.id), {
        projectUuid: str(p.uuid),
        projectName: str(p.name),
        name: str(e.name),
        uuid: str(e.uuid),
      });
    }
  }
  return map;
}

/** The kind of a `/resources` entry: `application`, `service`, or a database (`standalone-postgresql`…). */
export function coolifyKind(type: unknown): Kind {
  const t = str(type).toLowerCase();
  if (t === "application") return "application";
  if (t === "service") return "service";
  return "database";
}

export function coolifyUi(base: string, env: CoolifyEnvironment | undefined, kind: Kind, uuid: string): string {
  if (!env?.projectUuid) return `${base}/projects`;
  const where = env.uuid ? `environment/${env.uuid}` : encodeURIComponent(env.name);
  return `${base}/project/${env.projectUuid}/${where}/${kind === "compose" ? "application" : kind}/${uuid}`;
}

/** `GET /api/v1/resources` → applications, services and databases. */
export function parseCoolifyResources(json: string, base: string, envs: Map<number, CoolifyEnvironment>): Resource[] {
  const raw = JSON.parse(json || "[]");
  return (Array.isArray(raw) ? raw : []).map((r: Raw) => {
    const kind = coolifyKind(r.type);
    const env = envs.get(Number(r.environment_id));
    return {
      platform: "coolify" as const,
      kind,
      id: str(r.uuid),
      name: str(r.name) || str(r.uuid),
      description: str(r.description),
      type: kind === "database" ? str(r.type).replace(/^standalone-/, "") : str(r.service_type ?? r.build_pack ?? ""),
      status: coolifyStatus(r.status),
      urls: splitFqdn(r.fqdn),
      project: env?.projectName ?? "",
      environment: env?.name ?? "",
      ui: coolifyUi(base, env, kind, str(r.uuid)),
      repository: str(r.git_repository),
      branch: str(r.git_branch),
      buildPack: str(r.build_pack),
      updated: str(r.updated_at ?? r.last_online_at),
    };
  }).filter((r) => r.id);
}

function coolifyDeploymentStatus(s: string): Deployment["status"] {
  if (s === "finished") return "success";
  if (s === "failed") return "failed";
  if (s === "in_progress") return "running";
  if (s === "queued") return "queued";
  if (s.startsWith("cancelled")) return "cancelled";
  return "unknown";
}

/** `GET /api/v1/deployments/applications/{uuid}`: `{ count, deployments }` (older versions: a list). */
export function parseCoolifyDeployments(json: string, base: string, appUi: string): Deployment[] {
  const raw = JSON.parse(json || "[]");
  const list: Raw[] = Array.isArray(raw) ? raw : Array.isArray(raw?.deployments) ? raw.deployments : [];
  return list.map((d) => {
    const id = str(d.deployment_uuid);
    const path = str(d.deployment_url);
    return {
      id,
      status: coolifyDeploymentStatus(str(d.status).toLowerCase()),
      commit: str(d.commit).replace(/^HEAD$/, ""),
      message: str(d.commit_message).split("\n")[0],
      created: str(d.created_at),
      finished: d.status === "in_progress" || d.status === "queued" ? "" : str(d.updated_at),
      url: path ? (path.startsWith("http") ? path : `${base}${path}`) : `${appUi}/deployment/${id}`,
      trigger: d.rollback
        ? "Rollback"
        : d.is_webhook
        ? "Webhook"
        : d.is_api
        ? "API"
        : d.pull_request_id
        ? "Preview"
        : "Manual",
    };
  }).sort((a, b) => b.created.localeCompare(a.created));
}

// ---------------------------------------------------------------------------
// Dokploy

/** `GET /api/project.all` → applications and compose stacks, for both the old and the environment shapes. */
export function parseDokployProjects(json: string, base: string): Resource[] {
  const raw = JSON.parse(json || "[]");
  const resources: Resource[] = [];
  for (const p of (Array.isArray(raw) ? raw : []) as Raw[]) {
    const scopes: { env?: Raw; holder: Raw }[] = Array.isArray(p.environments)
      ? (p.environments as Raw[]).map((env) => ({ env, holder: env }))
      : [{ holder: p }];
    for (const { env, holder } of scopes) {
      const where = env?.environmentId
        ? `${base}/dashboard/project/${p.projectId}/environment/${env.environmentId}/services`
        : `${base}/dashboard/project/${p.projectId}/services`;
      for (const a of (holder.applications ?? []) as Raw[]) {
        resources.push({
          platform: "dokploy",
          kind: "application",
          id: str(a.applicationId),
          name: str(a.name) || str(a.appName),
          description: str(a.description),
          type: str(a.sourceType ?? ""),
          status: dokployStatus(a.applicationStatus),
          urls: ((a.domains ?? []) as Raw[]).map(domainUrl),
          project: str(p.name),
          environment: env ? str(env.name) : "",
          ui: `${where}/application/${a.applicationId}`,
          repository: str(a.repository ?? a.customGitUrl ?? a.dockerImage ?? ""),
          branch: str(a.branch ?? a.customGitBranch ?? ""),
          buildPack: str(a.buildType ?? ""),
          updated: str(a.createdAt ?? ""),
        });
      }
      for (const c of (holder.compose ?? []) as Raw[]) {
        resources.push({
          platform: "dokploy",
          kind: "compose",
          id: str(c.composeId),
          name: str(c.name) || str(c.appName),
          description: str(c.description),
          type: str(c.composeType ?? "docker-compose"),
          status: dokployStatus(c.composeStatus),
          urls: ((c.domains ?? []) as Raw[]).map(domainUrl),
          project: str(p.name),
          environment: env ? str(env.name) : "",
          ui: `${where}/compose/${c.composeId}`,
          repository: str(c.repository ?? c.customGitUrl ?? ""),
          branch: str(c.branch ?? c.customGitBranch ?? ""),
          buildPack: "",
          updated: str(c.createdAt ?? ""),
        });
      }
    }
  }
  return resources.filter((r) => r.id);
}

/** A Dokploy domain row → its URL. */
export function domainUrl(d: Raw): string {
  const scheme = d.https ? "https" : "http";
  const path = str(d.path) && str(d.path) !== "/" ? str(d.path) : "";
  return `${scheme}://${str(d.host)}${path}`;
}

/** `GET /api/deployment.all?applicationId=…` (or `allByCompose`). */
export function parseDokployDeployments(json: string, ui: string): Deployment[] {
  const raw = JSON.parse(json || "[]");
  const map: Record<string, Deployment["status"]> = {
    done: "success",
    error: "failed",
    running: "running",
    queued: "queued",
    cancelled: "cancelled",
  };
  return (Array.isArray(raw) ? raw : []).map((d: Raw) => ({
    id: str(d.deploymentId),
    status: map[str(d.status).toLowerCase()] ?? "unknown",
    commit: "",
    message: str(d.title) || str(d.description),
    created: str(d.createdAt),
    finished: str(d.finishedAt),
    url: `${ui}?tab=deployments`,
    trigger: str(d.description).toLowerCase().includes("webhook") ? "Webhook" : "",
  })).sort((a, b) => b.created.localeCompare(a.created));
}

// ---------------------------------------------------------------------------
// Formatting and filters

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", "2 months ago". */
export function ago(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return "yesterday";
  if (d < 60) return `${d} days ago`;
  if (d < 730) return `${Math.floor(d / 30)} months ago`;
  return `${Math.floor(d / 365)} years ago`;
}

/** "2m 05s" between two dates; empty when unfinished. */
export function took(start: string, end: string): string {
  const s = Math.round((Date.parse(end) - Date.parse(start)) / 1000);
  if (!start || !end || Number.isNaN(s) || s < 0) return "";
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

export type Chip = "all" | "running" | "stopped" | "problems";

export function matchesChip(r: Resource, chip: string | undefined): boolean {
  if (chip === "running") return r.status.state === "running" || r.status.state === "deploying";
  if (chip === "stopped") return r.status.state === "stopped";
  if (chip === "problems") return r.status.state === "degraded" || r.status.state === "error";
  return true;
}

/** Problems first, then running, deploying, stopped; by name within. */
export function sortResources(list: Resource[]): Resource[] {
  const rank: Record<State, number> = { error: 0, degraded: 1, deploying: 2, running: 3, unknown: 4, stopped: 5 };
  return [...list].sort((a, b) =>
    a.platform.localeCompare(b.platform) || a.project.localeCompare(b.project) ||
    rank[a.status.state] - rank[b.status.state] || a.name.localeCompare(b.name)
  );
}

/** "github.com/acme/web" from the many forms a repository is written in. */
export function shortRepo(repo: string): string {
  return repo.replace(/^https?:\/\//, "").replace(/^git@([^:]+):/, "$1/").replace(/\.git$/, "");
}
