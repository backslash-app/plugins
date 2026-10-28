// Parsing kubectl JSON. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Kubeconfig

export interface KubeContext {
  name: string;
  cluster: string;
  user: string;
  namespace?: string;
  server?: string;
}

export interface Kubeconfig {
  current?: string;
  contexts: KubeContext[];
}

/** `kubectl config view -o json` (with or without `--minify`). */
export function parseKubeconfig(json: string): Kubeconfig {
  const c = JSON.parse(json || "{}");
  const servers = new Map<string, string>(
    (c.clusters ?? []).map((cl: any) => [cl.name, cl.cluster?.server]),
  );
  return {
    current: c["current-context"] || undefined,
    contexts: (c.contexts ?? []).map((ctx: any) => ({
      name: ctx.name,
      cluster: ctx.context?.cluster ?? "",
      user: ctx.context?.user ?? "",
      namespace: ctx.context?.namespace || undefined,
      server: servers.get(ctx.context?.cluster),
    })),
  };
}

/** `https://1.2.3.4:6443` → `1.2.3.4:6443`. */
export const shortServer = (server?: string) => server?.replace(/^https?:\/\//, "").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Namespaces

export interface Namespace {
  name: string;
  phase: string;
  created?: Date;
}

export function parseNamespaces(json: string): Namespace[] {
  return (JSON.parse(json).items ?? []).map((n: any) => ({
    name: n.metadata.name,
    phase: n.status?.phase ?? "Active",
    created: n.metadata.creationTimestamp ? new Date(n.metadata.creationTimestamp) : undefined,
  }));
}

// ---------------------------------------------------------------------------
// Pods

export interface ContainerPort {
  port: number;
  name?: string;
  protocol: string;
}

export interface PodContainer {
  name: string;
  image: string;
  ready: boolean;
  restarts: number;
  /** running, waiting, terminated */
  state: string;
  reason?: string;
  ports: ContainerPort[];
  lastTermination?: { reason?: string; exitCode?: number; finishedAt?: string };
}

export type Health = "ok" | "pending" | "failed" | "done";

export interface Pod {
  name: string;
  namespace: string;
  phase: string;
  /** What `kubectl get pods` shows in STATUS: Running, CrashLoopBackOff, Init:0/1, Terminating… */
  status: string;
  health: Health;
  ready: number;
  total: number;
  restarts: number;
  created?: Date;
  node?: string;
  ip?: string;
  qos?: string;
  owner?: { kind: string; name: string };
  /** The Deployment of a ReplicaSet's pods, by the naming convention. */
  workload?: { kind: string; name: string };
  labels: Record<string, string>;
  containers: PodContainer[];
  deleting: boolean;
}

function containerReason(s: any): string | undefined {
  if (s?.state?.waiting) return s.state.waiting.reason;
  const t = s?.state?.terminated;
  if (t) return t.reason ?? (t.signal ? `Signal:${t.signal}` : `ExitCode:${t.exitCode}`);
  return undefined;
}

/** STATUS as kubectl prints it (simplified from its printer). */
export function podStatus(pod: any): string {
  let reason: string = pod.status?.reason || pod.status?.phase || "Unknown";
  const inits: any[] = pod.status?.initContainerStatuses ?? [];
  const initTotal = (pod.spec?.initContainers ?? []).length;
  let initializing = false;
  for (const [i, s] of inits.entries()) {
    const t = s.state?.terminated;
    if (t && t.exitCode === 0) continue;
    initializing = true;
    if (t) reason = `Init:${t.reason || (t.signal ? `Signal:${t.signal}` : `ExitCode:${t.exitCode}`)}`;
    else if (s.state?.waiting?.reason && s.state.waiting.reason !== "PodInitializing") {
      reason = `Init:${s.state.waiting.reason}`;
    } else reason = `Init:${i}/${initTotal || inits.length}`;
    break;
  }
  if (!initializing) {
    let hasRunning = false;
    const statuses: any[] = [...(pod.status?.containerStatuses ?? [])].reverse();
    for (const s of statuses) {
      const r = containerReason(s);
      if (r) reason = r;
      else if (s.state?.running && s.ready) hasRunning = true;
    }
    if (reason === "Completed" && hasRunning) reason = "Running";
  }
  if (pod.metadata?.deletionTimestamp) reason = pod.status?.reason === "NodeLost" ? "Unknown" : "Terminating";
  return reason;
}

export function healthOf(status: string, ready: number, total: number): Health {
  if (status === "Completed" || status === "Succeeded") return "done";
  if (status === "Running") return ready === total ? "ok" : "pending";
  if (/^(Pending|ContainerCreating|PodInitializing|Terminating)$/.test(status) || /^Init:\d+\/\d+$/.test(status)) {
    return "pending";
  }
  return "failed";
}

export const HEALTH_COLORS: Record<Health, Color> = { ok: "green", pending: "yellow", failed: "red", done: "gray" };

/** `api-7d9f8c6b5` (a ReplicaSet) → the Deployment `api`. */
function workloadOf(owner?: { kind: string; name: string }): { kind: string; name: string } | undefined {
  if (!owner) return undefined;
  if (owner.kind === "ReplicaSet") {
    const m = owner.name.match(/^(.+)-[a-z0-9]{5,10}$/);
    if (m) return { kind: "Deployment", name: m[1] };
  }
  if (owner.kind === "Job") {
    const m = owner.name.match(/^(.+)-\d{8,}$/);
    if (m) return { kind: "CronJob", name: m[1] };
  }
  return owner;
}

export function parsePods(json: string): Pod[] {
  return (JSON.parse(json).items ?? []).map((p: any): Pod => {
    const statuses: any[] = p.status?.containerStatuses ?? [];
    const containers: PodContainer[] = (p.spec?.containers ?? []).map((c: any) => {
      const s = statuses.find((x) => x.name === c.name);
      const last = s?.lastState?.terminated;
      return {
        name: c.name,
        image: c.image,
        ready: !!s?.ready,
        restarts: s?.restartCount ?? 0,
        state: s?.state ? Object.keys(s.state)[0] : "waiting",
        reason: containerReason(s),
        ports: (c.ports ?? []).map((port: any) => ({
          port: port.containerPort,
          name: port.name,
          protocol: port.protocol ?? "TCP",
        })),
        lastTermination: last
          ? { reason: last.reason, exitCode: last.exitCode, finishedAt: last.finishedAt }
          : undefined,
      };
    });
    const ready = containers.filter((c) => c.ready).length;
    const status = podStatus(p);
    const ref = (p.metadata?.ownerReferences ?? []).find((o: any) => o.controller) ?? p.metadata?.ownerReferences?.[0];
    const owner = ref ? { kind: ref.kind, name: ref.name } : undefined;
    return {
      name: p.metadata.name,
      namespace: p.metadata.namespace,
      phase: p.status?.phase ?? "Unknown",
      status,
      health: healthOf(status, ready, containers.length),
      ready,
      total: containers.length,
      restarts: containers.reduce((n, c) => n + c.restarts, 0),
      created: p.metadata.creationTimestamp ? new Date(p.metadata.creationTimestamp) : undefined,
      node: p.spec?.nodeName,
      ip: p.status?.podIP,
      qos: p.status?.qosClass,
      owner,
      workload: workloadOf(owner),
      labels: p.metadata.labels ?? {},
      containers,
      deleting: !!p.metadata.deletionTimestamp,
    };
  });
}

export type PodFilter = "running" | "problem" | "all";

export function filterPods(pods: Pod[], filter: PodFilter): Pod[] {
  if (filter === "running") return pods.filter((p) => p.health === "ok");
  if (filter === "problem") return pods.filter((p) => p.health === "failed" || p.health === "pending");
  return pods;
}

/** Problems first, then pending, healthy and completed; by name within each. */
export function sortPods(pods: Pod[]): Pod[] {
  const rank: Record<Health, number> = { failed: 0, pending: 1, ok: 2, done: 3 };
  return [...pods].sort((a, b) => rank[a.health] - rank[b.health] || a.name.localeCompare(b.name));
}

/** kubectl's ages: 45s, 7m30s, 2h15m, 5h, 3d4h, 12d, 2y. */
export function age(from: Date | undefined, now = new Date()): string {
  if (!from) return "";
  const s = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 1000));
  const m = Math.floor(s / 60), h = Math.floor(s / 3600), d = Math.floor(s / 86400);
  if (s < 120) return `${s}s`;
  if (m < 10) return `${m}m${s % 60 ? `${s % 60}s` : ""}`;
  if (h < 3) return `${m}m`;
  if (h < 8) return `${h}h${m % 60 ? `${m % 60}m` : ""}`;
  if (h < 48) return `${h}h`;
  if (d < 8) return `${d}d${h % 24 ? `${h % 24}h` : ""}`;
  if (d < 365 * 2) return `${d}d`;
  return `${Math.floor(d / 365)}y`;
}

// ---------------------------------------------------------------------------
// Commands

export interface Target {
  context: string;
  namespace: string;
}

const scope = (t: Target) => ["--context", t.context, "-n", t.namespace];

export function logsCommand(
  t: Target,
  pod: string,
  o: { container?: string; previous?: boolean; follow?: boolean; tail?: number } = {},
) {
  return [
    "kubectl",
    ...scope(t),
    "logs",
    pod,
    ...(o.container ? ["-c", o.container] : ["--all-containers", "--prefix"]),
    ...(o.previous ? ["--previous"] : []),
    ...(o.follow ? ["-f"] : []),
    `--tail=${o.tail ?? 200}`,
  ];
}

export const describeCommand = (t: Target, pod: string) => ["kubectl", ...scope(t), "describe", "pod", pod];
export const deleteCommand = (t: Target, pod: string) => ["kubectl", ...scope(t), "delete", "pod", pod, "--wait=false"];

export const portForwardCommand = (t: Target, pod: string, port: number, local = port) => [
  "kubectl",
  ...scope(t),
  "port-forward",
  `pod/${pod}`,
  `${local}:${port}`,
];

/** Bash when the image has it, sh otherwise. */
export const shellCommand = (t: Target, pod: string, container?: string) => [
  "kubectl",
  ...scope(t),
  "exec",
  "-it",
  pod,
  ...(container ? ["-c", container] : []),
  "--",
  "sh",
  "-c",
  "command -v bash >/dev/null && exec bash || exec sh",
];

/** Ports below 1024 need root on the local side: forward them from 8000 + port instead. */
export const localPort = (port: number) => (port < 1024 ? 8000 + port : port);
