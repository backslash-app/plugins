// Nomad and Consul logic: the shapes of their HTTP APIs, the health of a job
// from its allocations, sorting and formatting. Pure, tested in lib_test.ts.

export type Tint = "red" | "orange" | "yellow" | "green" | "gray" | "blue" | "purple";

// ---------------------------------------------------------------------------
// Nomad

export interface TaskGroupSummary {
  Queued?: number;
  Complete?: number;
  Failed?: number;
  Running?: number;
  Starting?: number;
  Lost?: number;
  Unknown?: number;
}

/** GET /v1/jobs */
export interface JobStub {
  ID: string;
  ParentID?: string;
  Name: string;
  Namespace?: string;
  Type: "service" | "batch" | "system" | "sysbatch" | string;
  Priority?: number;
  Periodic?: boolean;
  ParameterizedJob?: boolean;
  Stop?: boolean;
  Status: "pending" | "running" | "dead" | string;
  StatusDescription?: string;
  Datacenters?: string[];
  JobSummary?: {
    Summary?: Record<string, TaskGroupSummary>;
    Children?: { Pending?: number; Running?: number; Dead?: number };
  };
  SubmitTime?: number;
  Version?: number;
}

export interface TaskEvent {
  Type: string;
  /** Unix nanoseconds. */
  Time: number;
  DisplayMessage?: string;
  Message?: string;
  ExitCode?: number;
}

export interface TaskState {
  State: "pending" | "running" | "dead" | string;
  Failed?: boolean;
  Restarts?: number;
  StartedAt?: string | null;
  FinishedAt?: string | null;
  Events?: TaskEvent[] | null;
}

/** GET /v1/allocations, /v1/job/:id/allocations */
export interface AllocStub {
  ID: string;
  Name: string;
  Namespace?: string;
  JobID: string;
  JobVersion?: number;
  TaskGroup: string;
  NodeID?: string;
  NodeName?: string;
  DesiredStatus: "run" | "stop" | "evict" | string;
  DesiredDescription?: string;
  ClientStatus: "pending" | "running" | "complete" | "failed" | "lost" | "unknown" | string;
  ClientDescription?: string;
  TaskStates?: Record<string, TaskState> | null;
  DeploymentStatus?: { Healthy?: boolean | null; Canary?: boolean } | null;
  /** Unix nanoseconds. */
  CreateTime?: number;
  ModifyTime?: number;
}

export type JobHealth = "failing" | "degraded" | "pending" | "running" | "complete" | "idle" | "stopped" | "dead";

export const JOB_HEALTH: Record<JobHealth, { title: string; color: Tint; section: string; order: number }> = {
  failing: { title: "failing", color: "red", section: "Failing", order: 0 },
  degraded: { title: "degraded", color: "orange", section: "Failing", order: 1 },
  pending: { title: "pending", color: "yellow", section: "Starting", order: 2 },
  running: { title: "running", color: "green", section: "Running", order: 3 },
  idle: { title: "scheduled", color: "blue", section: "Periodic & Parameterized", order: 4 },
  complete: { title: "complete", color: "gray", section: "Completed", order: 5 },
  dead: { title: "dead", color: "gray", section: "Stopped", order: 6 },
  stopped: { title: "stopped", color: "gray", section: "Stopped", order: 7 },
};

export interface JobView {
  job: JobStub;
  health: JobHealth;
  running: number;
  /** Allocations the job wants running right now. */
  wanted: number;
  failed: number;
  queued: number;
  restarts: number;
  allocs: AllocStub[];
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export const isFailedAlloc = (a: AllocStub) =>
  a.ClientStatus === "failed" || a.ClientStatus === "lost" || a.DeploymentStatus?.Healthy === false;

export const restartsOf = (a: AllocStub) => sum(Object.values(a.TaskStates ?? {}).map((t) => t.Restarts ?? 0));

/** The job's allocations, its periodic or dispatched children's included. */
export function allocsOf(job: JobStub, allocs: AllocStub[]): AllocStub[] {
  const ns = job.Namespace ?? "default";
  return allocs.filter((a) =>
    (a.Namespace ?? "default") === ns && (a.JobID === job.ID || a.JobID.startsWith(`${job.ID}/`))
  );
}

/**
 * How a job is doing, from what it asks for and what its allocations do:
 * failed or lost allocations it still wants, unhealthy deployments, a dead
 * service, or the latest run of a periodic job that failed.
 */
export function jobView(job: JobStub, all: AllocStub[]): JobView {
  const allocs = allocsOf(job, all).sort((a, b) => (b.CreateTime ?? 0) - (a.CreateTime ?? 0));
  const groups = Object.values(job.JobSummary?.Summary ?? {});
  const queued = sum(groups.map((g) => g.Queued ?? 0));
  const current = allocs.filter((a) => a.DesiredStatus === "run");
  const running = current.filter((a) => a.ClientStatus === "running").length;
  const pending = current.filter((a) => a.ClientStatus === "pending").length;
  let failed = current.filter(isFailedAlloc).length;
  const restarts = sum(current.map(restartsOf));
  const base = { job, running, wanted: current.length, queued, restarts, allocs };

  if (job.Stop) return { ...base, failed, health: "stopped" };
  if (job.Periodic || job.ParameterizedJob) {
    // The newest allocation of each task group tells how the last run went.
    const latest = new Map<string, AllocStub>();
    for (const a of allocs.filter((x) => x.JobID !== job.ID)) {
      if (!latest.has(a.TaskGroup)) latest.set(a.TaskGroup, a);
    }
    failed = [...latest.values()].filter((a) => a.ClientStatus === "failed" || a.ClientStatus === "lost").length;
    const children = job.JobSummary?.Children ?? {};
    const health: JobHealth = failed ? "failing" : (children.Running ?? 0) > 0 ? "running" : "idle";
    return { ...base, running: children.Running ?? running, failed, health };
  }
  if (failed) return { ...base, failed, health: running ? "degraded" : "failing" };
  if (job.Status === "dead") {
    const complete = sum(groups.map((g) => g.Complete ?? 0));
    const lost = sum(groups.map((g) => (g.Failed ?? 0) + (g.Lost ?? 0)));
    if ((job.Type === "batch" || job.Type === "sysbatch") && complete > 0 && !lost) {
      return { ...base, failed, health: "complete" };
    }
    // A service that died on its own, or a batch whose allocations failed.
    return { ...base, failed: Math.max(failed, lost), health: job.Type === "service" || lost ? "failing" : "dead" };
  }
  if (queued || pending) return { ...base, failed, health: running ? "degraded" : "pending" };
  if (running) return { ...base, failed, health: "running" };
  if (job.Type === "batch" || job.Type === "sysbatch") return { ...base, failed, health: "complete" };
  return { ...base, failed, health: job.Status === "pending" ? "pending" : "running" };
}

/** Top-level jobs (not the children of periodic or parameterized jobs), failing first. */
export function jobViews(jobs: JobStub[], allocs: AllocStub[]): JobView[] {
  return jobs.filter((j) => !j.ParentID).map((j) => jobView(j, allocs)).sort((a, b) =>
    JOB_HEALTH[a.health].order - JOB_HEALTH[b.health].order || a.job.Name.localeCompare(b.job.Name)
  );
}

/** `web.api[2]` → `api[2]`. */
export function allocShortName(a: Pick<AllocStub, "Name" | "JobID">): string {
  const name = a.Name.startsWith(`${a.JobID}.`) ? a.Name.slice(a.JobID.length + 1) : a.Name;
  return name.replace(/^.*?\.(?=[^.]+\[\d+\]$)/, "");
}

export const ALLOC_COLORS: Record<string, Tint> = {
  running: "green",
  pending: "yellow",
  complete: "gray",
  failed: "red",
  lost: "red",
  unknown: "orange",
};

export function allocColor(a: AllocStub): Tint {
  if (a.DeploymentStatus?.Healthy === false) return "red";
  return ALLOC_COLORS[a.ClientStatus] ?? "gray";
}

/** Current allocations first (failing, then running), older ones after, newest first. */
export function sortAllocs(allocs: AllocStub[]): AllocStub[] {
  const rank = (a: AllocStub) =>
    a.DesiredStatus !== "run" ? 3 : isFailedAlloc(a) ? 0 : a.ClientStatus === "running" ? 1 : 2;
  return [...allocs].sort((a, b) => rank(a) - rank(b) || (b.CreateTime ?? 0) - (a.CreateTime ?? 0));
}

/** A task's latest events, newest first. */
export function taskEvents(t: TaskState, n = 5): TaskEvent[] {
  return [...(t.Events ?? [])].sort((a, b) => b.Time - a.Time).slice(0, n);
}

/** The task whose logs to show first: a failed one, else one that restarted, else the first. */
export function mainTask(a: AllocStub): string | undefined {
  const tasks = Object.entries(a.TaskStates ?? {});
  return (tasks.find(([, t]) => t.Failed) ?? tasks.find(([, t]) => (t.Restarts ?? 0) > 0) ?? tasks[0])?.[0];
}

/** Markdown of an allocation's tasks and their latest events. */
export function allocMarkdown(a: AllocStub, now = Date.now()): string {
  const tasks = Object.entries(a.TaskStates ?? {});
  const lines = [
    `## ${allocShortName(a)}`,
    "",
    a.ClientDescription ? `_${a.ClientDescription}_` : "",
  ];
  if (!tasks.length) lines.push("", "_No task has started yet._");
  for (const [name, t] of tasks) {
    lines.push(
      "",
      `### ${name} · ${t.Failed ? "failed" : t.State}${
        t.Restarts ? ` · ${t.Restarts} restart${t.Restarts === 1 ? "" : "s"}` : ""
      }`,
      "",
    );
    const events = taskEvents(t);
    if (!events.length) lines.push("_No events._");
    for (const e of events) {
      const msg = (e.DisplayMessage || e.Message || "").replace(/\s+/g, " ").trim();
      lines.push(`- **${e.Type}** ${age(e.Time / 1e6, now)} ago${msg ? ` · ${msg}` : ""}`);
    }
  }
  return lines.join("\n");
}

/** `3/3`, `1/3`, `2 runs` (periodic). */
export function jobCount(v: JobView): string | undefined {
  if (v.job.Periodic || v.job.ParameterizedJob) {
    const c = v.job.JobSummary?.Children;
    const total = (c?.Running ?? 0) + (c?.Pending ?? 0) + (c?.Dead ?? 0);
    return total ? `${total} run${total === 1 ? "" : "s"}` : undefined;
  }
  if (v.health === "stopped" || v.health === "complete") return undefined;
  const wanted = Math.max(v.wanted, v.running + v.queued);
  return wanted ? `${v.running}/${wanted}` : undefined;
}

export function jobKind(job: JobStub): string {
  if (job.Periodic) return `${job.Type} · periodic`;
  if (job.ParameterizedJob) return `${job.Type} · parameterized`;
  return job.Type;
}

// ---------------------------------------------------------------------------
// Consul

export type CheckStatus = "passing" | "warning" | "critical" | "maintenance";

/** GET /v1/internal/ui/services (what the Consul UI lists). */
export interface UiService {
  Name: string;
  Datacenter?: string;
  Kind?: string;
  Tags?: string[] | null;
  Nodes?: string[] | null;
  InstanceCount?: number;
  ChecksPassing?: number;
  ChecksWarning?: number;
  ChecksCritical?: number;
  ExternalSources?: string[] | null;
  Namespace?: string;
}

/** GET /v1/health/state/:state */
export interface Check {
  Node: string;
  CheckID: string;
  Name: string;
  Status: CheckStatus | string;
  Notes?: string;
  Output?: string;
  ServiceID?: string;
  ServiceName?: string;
  ServiceTags?: string[] | null;
  Type?: string;
}

/** GET /v1/health/service/:name */
export interface ServiceEntry {
  Node: { Node: string; Address: string; Datacenter?: string };
  Service: {
    ID: string;
    Service: string;
    Tags?: string[] | null;
    Address?: string;
    Port?: number;
    Meta?: Record<string, string> | null;
    Kind?: string;
  };
  Checks: Check[];
}

export interface ConsulService {
  name: string;
  kind?: string;
  tags: string[];
  instances?: number;
  nodes: string[];
  passing: number;
  warning: number;
  critical: number;
  sources: string[];
}

export function fromUiServices(list: UiService[]): ConsulService[] {
  return list.map((s) => ({
    name: s.Name,
    kind: s.Kind || undefined,
    tags: s.Tags ?? [],
    instances: s.InstanceCount,
    nodes: [...new Set(s.Nodes ?? [])],
    passing: s.ChecksPassing ?? 0,
    warning: s.ChecksWarning ?? 0,
    critical: s.ChecksCritical ?? 0,
    sources: s.ExternalSources ?? [],
  }));
}

/** From the public endpoints: /v1/catalog/services and /v1/health/state/any. */
export function fromCatalog(catalog: Record<string, string[] | null>, checks: Check[]): ConsulService[] {
  return Object.entries(catalog).map(([name, tags]) => {
    const mine = checks.filter((c) => c.ServiceName === name);
    const ids = new Set(mine.map((c) => `${c.Node}/${c.ServiceID}`));
    return {
      name,
      tags: tags ?? [],
      instances: ids.size || undefined,
      nodes: [...new Set(mine.map((c) => c.Node))],
      passing: mine.filter((c) => c.Status === "passing").length,
      warning: mine.filter((c) => c.Status === "warning").length,
      critical: mine.filter((c) => c.Status === "critical").length,
      sources: [],
    };
  });
}

export type ServiceHealth = "critical" | "warning" | "passing" | "none";

export function serviceHealth(s: Pick<ConsulService, "passing" | "warning" | "critical">): ServiceHealth {
  if (s.critical) return "critical";
  if (s.warning) return "warning";
  return s.passing ? "passing" : "none";
}

export const SERVICE_HEALTH: Record<ServiceHealth, { title: string; color: Tint; section: string; order: number }> = {
  critical: { title: "critical", color: "red", section: "Critical", order: 0 },
  warning: { title: "warning", color: "orange", section: "Warning", order: 1 },
  passing: { title: "passing", color: "green", section: "Passing", order: 2 },
  none: { title: "no checks", color: "gray", section: "No Checks", order: 3 },
};

export function sortServices(list: ConsulService[]): ConsulService[] {
  return [...list].sort((a, b) =>
    SERVICE_HEALTH[serviceHealth(a)].order - SERVICE_HEALTH[serviceHealth(b)].order || a.name.localeCompare(b.name)
  );
}

/** Node checks that fail (serfHealth and the like): a node down hides behind its services. */
export const nodeProblems = (checks: Check[]) =>
  checks.filter((c) => !c.ServiceID && (c.Status === "critical" || c.Status === "warning"));

export const CHECK_COLORS: Record<string, Tint> = {
  passing: "green",
  warning: "orange",
  critical: "red",
  maintenance: "blue",
};

/** The worst status of an instance's checks. */
export function instanceHealth(e: ServiceEntry): ServiceHealth {
  return serviceHealth({
    passing: e.Checks.filter((c) => c.Status === "passing").length,
    warning: e.Checks.filter((c) => c.Status === "warning").length,
    critical: e.Checks.filter((c) => c.Status === "critical" || c.Status === "maintenance").length,
  });
}

/** An instance's address: its own, or its node's. */
export function instanceAddress(e: ServiceEntry): string {
  const host = e.Service.Address || e.Node.Address;
  const h = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return e.Service.Port ? `${h}:${e.Service.Port}` : h;
}

/** Markdown of an instance's checks with their output. */
export function checksMarkdown(e: ServiceEntry): string {
  if (!e.Checks.length) return "_No health checks._";
  const order = { critical: 0, warning: 1, maintenance: 2, passing: 3 } as Record<string, number>;
  return [...e.Checks].sort((a, b) => (order[a.Status] ?? 4) - (order[b.Status] ?? 4)).map((c) => {
    const out = (c.Output ?? "").trim().slice(0, 1500).replace(/```/g, "ʼʼʼ");
    return [`### ${c.Name} · ${c.Status}`, c.Notes ? `_${c.Notes}_` : "", out ? `\`\`\`\n${out}\n\`\`\`` : ""]
      .filter(Boolean).join("\n\n");
  }).join("\n\n");
}

// ---------------------------------------------------------------------------
// Shared

/** "now", "45 s", "12 min", "3 h", "5 d", from Unix milliseconds. */
export function age(ms: number | undefined, now = Date.now()): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 5) return "now";
  if (s < 60) return `${Math.floor(s)} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

/** The last `n` lines of a log. */
export function tail(text: string, n = 200): string {
  const lines = text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");
  return lines.slice(-n).join("\n");
}
