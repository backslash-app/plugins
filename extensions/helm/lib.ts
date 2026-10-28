// Parsing helm and kubectl JSON. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Releases

export type Health = "failed" | "pending" | "ok" | "other";

export interface Release {
  name: string;
  namespace: string;
  revision: number;
  updated?: Date;
  status: string;
  health: Health;
  /** `ingress-nginx-4.11.2` as helm prints it. */
  chart: string;
  chartName: string;
  chartVersion?: string;
  appVersion?: string;
}

/** `ingress-nginx-4.11.2` → name and version; `my-chart-1.0.0-rc.1` too. */
export function splitChart(chart: string): { name: string; version?: string } {
  const m = /^(.+)-(v?\d+\.\d+\.\d+[\w.+-]*)$/.exec(chart);
  return m ? { name: m[1], version: m[2] } : { name: chart };
}

/** helm's `2026-10-20 09:12:33.123456789 +0000 UTC` (list) or RFC 3339 (history). */
export function parseHelmDate(text: unknown): Date | undefined {
  if (typeof text !== "string" || !text) return undefined;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d+))?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(text);
  if (!m) return undefined;
  const ms = (m[3] ?? "0").padEnd(3, "0").slice(0, 3);
  let zone = m[4] ?? "Z";
  if (/^[+-]\d{4}$/.test(zone)) zone = `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const d = new Date(`${m[1]}T${m[2]}.${ms}${zone}`);
  return isNaN(d.getTime()) ? undefined : d;
}

export function healthOf(status: string): Health {
  if (status === "failed") return "failed";
  if (status.startsWith("pending") || status === "uninstalling") return "pending";
  if (status === "deployed") return "ok";
  return "other";
}

export const HEALTH_COLORS: Record<Health, Color> = { failed: "red", pending: "yellow", ok: "green", other: "gray" };

/** `helm list -A -a -o json`. */
export function parseReleases(json: string): Release[] {
  const data = JSON.parse(json || "[]") ?? [];
  return (data as any[]).map((r) => {
    const chart = String(r.chart ?? "");
    const { name, version } = splitChart(chart);
    const status = String(r.status ?? "unknown");
    return {
      name: String(r.name),
      namespace: String(r.namespace ?? "default"),
      revision: Number(r.revision) || 0,
      updated: parseHelmDate(r.updated),
      status,
      health: healthOf(status),
      chart,
      chartName: name,
      chartVersion: version,
      appVersion: r.app_version || undefined,
    };
  });
}

const RANK: Record<Health, number> = { failed: 0, pending: 1, ok: 2, other: 3 };

/** Failed, then pending, then the rest; newest change first within each. */
export function sortReleases(releases: Release[]): Release[] {
  return [...releases].sort((a, b) =>
    RANK[a.health] - RANK[b.health] || (b.updated?.getTime() ?? 0) - (a.updated?.getTime() ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

/** `failed` → `Failed`, `pending-upgrade` → `Pending upgrade`. */
export const statusLabel = (status: string) => {
  const s = status.replace(/-/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};

// ---------------------------------------------------------------------------
// History

export interface Revision {
  revision: number;
  updated?: Date;
  status: string;
  chart: string;
  appVersion?: string;
  description: string;
}

/** `helm history <release> -o json`, newest first. */
export function parseHistory(json: string): Revision[] {
  const data = JSON.parse(json || "[]") ?? [];
  return (data as any[])
    .map((r) => ({
      revision: Number(r.revision) || 0,
      updated: parseHelmDate(r.updated),
      status: String(r.status ?? "unknown"),
      chart: String(r.chart ?? ""),
      appVersion: r.app_version || undefined,
      description: String(r.description ?? ""),
    }))
    .sort((a, b) => b.revision - a.revision);
}

/** The revisions one can roll back to: every one but the current. */
export const rollbackTargets = (history: Revision[], current: number) =>
  history.filter((r) => r.revision !== current && r.status !== "pending-install");

// ---------------------------------------------------------------------------
// Command lines

const ns = (r: { namespace: string }) => ["--namespace", r.namespace];

export const valuesCommand = (r: Release, all = false) => [
  "helm",
  "get",
  "values",
  r.name,
  ...ns(r),
  "-o",
  "yaml",
  ...(all ? ["--all"] : []),
];
export const manifestCommand = (r: Release) => ["helm", "get", "manifest", r.name, ...ns(r)];
export const historyCommand = (r: Release) => ["helm", "history", r.name, ...ns(r), "-o", "json", "--max", "30"];
export const statusCommand = (r: Release) => ["helm", "status", r.name, ...ns(r)];
export const rollbackCommand = (r: Release, revision: number) => [
  "helm",
  "rollback",
  r.name,
  String(revision),
  ...ns(r),
];
export const uninstallCommand = (r: Release) => ["helm", "uninstall", r.name, ...ns(r)];

/** Adds `--kube-context` so a command acts on the context the list was loaded from. */
export const inContext = (argv: string[], context?: string) =>
  context ? [argv[0], "--kube-context", context, ...argv.slice(1)] : argv;

// ---------------------------------------------------------------------------
// Kubeconfig

export interface KubeContext {
  name: string;
  cluster: string;
  namespace?: string;
  server?: string;
}

export interface Kubeconfig {
  current?: string;
  contexts: KubeContext[];
}

/** `kubectl config view -o json`. */
export function parseKubeconfig(json: string): Kubeconfig {
  const c = JSON.parse(json || "{}") ?? {};
  const servers = new Map<string, string>((c.clusters ?? []).map((cl: any) => [cl.name, cl.cluster?.server]));
  return {
    current: c["current-context"] || undefined,
    contexts: (c.contexts ?? []).map((ctx: any) => ({
      name: ctx.name,
      cluster: ctx.context?.cluster ?? "",
      namespace: ctx.context?.namespace || undefined,
      server: servers.get(ctx.context?.cluster),
    })),
  };
}

// ---------------------------------------------------------------------------
// Formatting and errors

/** "45 s", "12 min", "3 h", "4 d", "5 mo", "2 y". */
export function age(date: Date | undefined, now = Date.now()): string {
  if (!date) return "";
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  if (d < 60) return `${d} d`;
  if (d < 730) return `${Math.floor(d / 30)} mo`;
  return `${Math.floor(d / 365)} y`;
}

export const formatDate = (d?: Date) =>
  d
    ? d.toLocaleString("en-GB", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : "";

export function classifyError(message: string): { title: string; unreachable: boolean } {
  const clean = message.replace(/^(helm|kubectl) exited with \d+: /, "");
  if (
    /cluster unreachable|Unable to connect|connection refused|no such host|i\/o timeout|context deadline/i.test(clean)
  ) {
    return { title: "Cannot reach the cluster", unreachable: true };
  }
  if (/forbidden|Unauthorized|You must be logged in/i.test(clean)) {
    return { title: "The cluster refused the credentials", unreachable: false };
  }
  return { title: "helm failed", unreachable: false };
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

export function installCommand(family: Family | undefined): string {
  switch (family) {
    case "arch":
      return "sudo pacman -S helm";
    case "fedora":
      return "sudo dnf install helm";
    case "suse":
      return "sudo zypper install helm";
    default:
      return "sudo snap install helm --classic";
  }
}
