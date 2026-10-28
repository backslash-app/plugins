// Pure logic of the Google Cloud extension: gcloud JSON mapping, console
// URLs, command lines, error classification. No I/O here.

/** `https://…/zones/europe-west1-b` → `europe-west1-b`. */
export const lastSegment = (url: string | undefined) => (url ?? "").split("/").pop() ?? "";

// --- Configuration and projects --------------------------------------------------------

export interface GcloudConfig {
  project?: string;
  account?: string;
  region?: string;
  zone?: string;
}

export function parseConfig(json: string): GcloudConfig {
  const c = JSON.parse(json || "{}") as {
    core?: { project?: string; account?: string };
    compute?: { region?: string; zone?: string };
  };
  return {
    project: c.core?.project || undefined,
    account: c.core?.account || undefined,
    region: c.compute?.region || undefined,
    zone: c.compute?.zone || undefined,
  };
}

export interface Project {
  id: string;
  name: string;
  number: string;
  state: string;
  created?: Date;
  parent?: string;
  labels: Record<string, string>;
}

export function parseProjects(json: string): Project[] {
  const data = JSON.parse(json || "[]") as any[];
  return data.map((p) => ({
    id: p.projectId,
    name: p.name ?? p.projectId,
    number: String(p.projectNumber ?? ""),
    state: p.lifecycleState ?? p.state ?? "ACTIVE",
    created: p.createTime ? new Date(p.createTime) : undefined,
    parent: p.parent ? `${p.parent.type} ${p.parent.id}` : undefined,
    labels: p.labels ?? {},
  })).sort((a, b) => a.name.localeCompare(b.name));
}

// --- Compute Engine ------------------------------------------------------------------------

export interface Instance {
  name: string;
  id: string;
  zone: string;
  status: string;
  machineType: string;
  internalIp?: string;
  externalIp?: string;
  network?: string;
  created?: Date;
  labels: Record<string, string>;
  tags: string[];
  spot: boolean;
  os?: string;
  cpuPlatform?: string;
}

export function parseInstances(json: string): Instance[] {
  const data = JSON.parse(json || "[]") as any[];
  return data.map((i) => {
    const nic = i.networkInterfaces?.[0];
    const boot = (i.disks ?? []).find((d: any) => d.boot);
    return {
      name: i.name,
      id: String(i.id ?? ""),
      zone: lastSegment(i.zone),
      status: i.status ?? "UNKNOWN",
      machineType: lastSegment(i.machineType),
      internalIp: nic?.networkIP || undefined,
      externalIp: nic?.accessConfigs?.find((a: any) => a.natIP)?.natIP || undefined,
      network: nic?.network ? lastSegment(nic.network) : undefined,
      created: i.creationTimestamp ? new Date(i.creationTimestamp) : undefined,
      labels: i.labels ?? {},
      tags: i.tags?.items ?? [],
      spot: i.scheduling?.provisioningModel === "SPOT" || i.scheduling?.preemptible === true,
      os: boot?.licenses?.length ? lastSegment(boot.licenses[0]) : undefined,
      cpuPlatform: i.cpuPlatform || undefined,
    };
  });
}

/** `europe-west1-b` → `europe-west1`. */
export const zoneRegion = (zone: string) => zone.replace(/-[a-z]$/, "");

export type Health = "ok" | "busy" | "off" | "failed";

export function instanceHealth(status: string): Health {
  switch (status) {
    case "RUNNING":
      return "ok";
    case "PROVISIONING":
    case "STAGING":
    case "STOPPING":
    case "SUSPENDING":
    case "REPAIRING":
      return "busy";
    case "TERMINATED":
    case "STOPPED":
    case "SUSPENDED":
      return "off";
    default:
      return "failed";
  }
}

export const HEALTH_COLORS = { ok: "green", busy: "yellow", off: "gray", failed: "red" } as const;

/** `TERMINATED` → `Stopped` (what the console shows), others title-cased. */
export function statusLabel(status: string): string {
  if (status === "TERMINATED") return "Stopped";
  return status.charAt(0) + status.slice(1).toLowerCase();
}

export function sortInstances(all: Instance[]): Instance[] {
  const order: Health[] = ["failed", "busy", "ok", "off"];
  return [...all].sort((a, b) =>
    order.indexOf(instanceHealth(a.status)) - order.indexOf(instanceHealth(b.status)) || a.name.localeCompare(b.name)
  );
}

// --- Cloud Run ----------------------------------------------------------------------------

export interface Service {
  name: string;
  region: string;
  url?: string;
  ready: "True" | "False" | "Unknown";
  reason?: string;
  message?: string;
  revision?: string;
  image?: string;
  modifier?: string;
  updated?: Date;
  ingress?: string;
  traffic: { revision: string; percent: number; tag?: string; latest?: boolean }[];
}

export function parseServices(json: string): Service[] {
  const data = JSON.parse(json || "[]") as any[];
  return data.map((s) => {
    const ready = (s.status?.conditions ?? []).find((c: any) => c.type === "Ready");
    const container = s.spec?.template?.spec?.containers?.[0];
    const meta = s.metadata ?? {};
    return {
      name: meta.name,
      region: meta.labels?.["cloud.googleapis.com/location"] ?? "",
      url: s.status?.url || s.status?.address?.url || undefined,
      ready: (ready?.status ?? "Unknown") as Service["ready"],
      reason: ready?.reason || undefined,
      message: ready?.message || undefined,
      revision: s.status?.latestReadyRevisionName || s.status?.latestCreatedRevisionName || undefined,
      image: container?.image,
      modifier: meta.annotations?.["serving.knative.dev/lastModifier"] ??
        meta.annotations?.["serving.knative.dev/creator"],
      updated: ready?.lastTransitionTime
        ? new Date(ready.lastTransitionTime)
        : meta.creationTimestamp
        ? new Date(meta.creationTimestamp)
        : undefined,
      ingress: meta.annotations?.["run.googleapis.com/ingress"],
      traffic: (s.status?.traffic ?? []).map((t: any) => ({
        revision: t.revisionName ?? (t.latestRevision ? "latest" : ""),
        percent: t.percent ?? 0,
        tag: t.tag,
        latest: t.latestRevision,
      })),
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

export function serviceHealth(s: Service): Health {
  return s.ready === "True" ? "ok" : s.ready === "False" ? "failed" : "busy";
}

/** `europe-docker.pkg.dev/acme/apps/api@sha256:…` → `api@sha256:1a2b3c4`. */
export function shortImage(image: string | undefined): string {
  if (!image) return "";
  const last = image.split("/").pop()!;
  const at = last.indexOf("@sha256:");
  return at > 0 ? `${last.slice(0, at)}@${last.slice(at + 8, at + 15)}` : last;
}

// --- URLs and commands -------------------------------------------------------------------

const C = "https://console.cloud.google.com";
export const projectConsoleUrl = (p: string) => `${C}/home/dashboard?project=${encodeURIComponent(p)}`;
export const instanceConsoleUrl = (i: Instance, p: string) =>
  `${C}/compute/instancesDetail/zones/${i.zone}/instances/${encodeURIComponent(i.name)}?project=${
    encodeURIComponent(p)
  }`;
export const serviceConsoleUrl = (s: Service, p: string) =>
  `${C}/run/detail/${s.region}/${encodeURIComponent(s.name)}/metrics?project=${encodeURIComponent(p)}`;
export const serviceLogsUrl = (s: Service, p: string) =>
  `${C}/run/detail/${s.region}/${encodeURIComponent(s.name)}/logs?project=${encodeURIComponent(p)}`;

export const sshCommand = (
  i: Instance,
  p: string,
) => ["gcloud", "compute", "ssh", i.name, `--zone=${i.zone}`, `--project=${p}`];

export const serialCommand = (i: Instance, p: string) => [
  "gcloud",
  "compute",
  "instances",
  "tail-serial-port-output",
  i.name,
  `--zone=${i.zone}`,
  `--project=${p}`,
];

export const instanceLogsCommand = (i: Instance, p: string) => [
  "gcloud",
  "logging",
  "read",
  `resource.type="gce_instance" AND resource.labels.instance_id="${i.id}"`,
  "--freshness=1d",
  "--limit=200",
  "--order=asc",
  "--format=value(timestamp,severity,textPayload,jsonPayload.message)",
  `--project=${p}`,
];

export const tailServiceCommand = (s: Service, p: string) => [
  "gcloud",
  "beta",
  "run",
  "services",
  "logs",
  "tail",
  s.name,
  `--region=${s.region}`,
  `--project=${p}`,
];

export const readServiceLogsCommand = (s: Service, p: string, limit = 100) => [
  "gcloud",
  "run",
  "services",
  "logs",
  "read",
  s.name,
  `--region=${s.region}`,
  `--project=${p}`,
  `--limit=${limit}`,
];

// --- Errors ------------------------------------------------------------------------------

export type Problem = "auth" | "api" | "denied" | "project" | "network" | "other";

export function classifyError(err: unknown): { problem: Problem; title: string; message: string; api?: string } {
  const raw = (err instanceof Error ? err.message : String(err)).replace(/^gcloud exited with \d+: /, "").trim();
  const message = raw.split("\n").filter((l) => !/^\s*(- '@type'|metadata:|method:|service:|reason:)/.test(l)).join(
    "\n",
  ).trim();
  const is = (re: RegExp) => re.test(raw);
  if (
    is(
      /You do not currently have an active account|gcloud auth login|UNAUTHENTICATED|Reauthentication|refresh token|invalid_grant/i,
    )
  ) {
    return { problem: "auth", title: "Sign in to Google Cloud", message };
  }
  const api =
    /(\w+\.googleapis\.com) (?:has not been used|is not enabled)|SERVICE_DISABLED|API \[([\w.]+)\] not enabled/.exec(
      raw,
    );
  if (api) return { problem: "api", title: "API not enabled for this project", message, api: api[1] ?? api[2] };
  if (
    is(
      /required '?project'? property|project property is not set|The required property \[project\] is not currently set/i,
    )
  ) {
    return { problem: "project", title: "No project selected", message };
  }
  if (is(/PERMISSION_DENIED|does not have .* permission|Required '[\w.]+' permission|403/)) {
    return { problem: "denied", title: "Permission denied", message };
  }
  if (is(/Unable to find|Failed to connect|Connection aborted|timed out|Name or service not known|TransportError/i)) {
    return { problem: "network", title: "Cannot reach Google Cloud", message };
  }
  return { problem: "other", title: "gcloud failed", message };
}

// --- Formatting -------------------------------------------------------------------------

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

// --- Installing the CLI --------------------------------------------------------------------

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
      return "yay -S google-cloud-cli   # AUR";
    case "fedora":
      return "sudo dnf install google-cloud-cli   # after adding Google's repository";
    default:
      return "sudo snap install google-cloud-cli --classic";
  }
}
