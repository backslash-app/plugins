// Argo CD applications: parsing, status order, summaries and URLs.

import type { Color } from "@backslash/api";

export type SyncStatus = "Synced" | "OutOfSync" | "Unknown";
export type HealthStatus = "Healthy" | "Progressing" | "Degraded" | "Suspended" | "Missing" | "Unknown";

export interface Source {
  repoURL?: string;
  path?: string;
  chart?: string;
  targetRevision?: string;
  ref?: string;
}

export interface Resource {
  group?: string;
  kind: string;
  name: string;
  namespace?: string;
  status?: string;
  health?: { status?: string; message?: string };
  requiresPruning?: boolean;
}

export interface HistoryEntry {
  id: number;
  revision?: string;
  revisions?: string[];
  deployedAt?: string;
  deployStartedAt?: string;
  source?: Source;
  sources?: Source[];
  initiatedBy?: { username?: string; automated?: boolean };
}

export interface Application {
  metadata: { name: string; namespace?: string; creationTimestamp?: string; labels?: Record<string, string> };
  spec: {
    project?: string;
    source?: Source;
    sources?: Source[];
    destination?: { server?: string; name?: string; namespace?: string };
    syncPolicy?: { automated?: { prune?: boolean; selfHeal?: boolean } | null } | null;
  };
  status?: {
    sync?: { status?: string; revision?: string; revisions?: string[] };
    health?: { status?: string; message?: string };
    resources?: Resource[];
    conditions?: { type: string; message?: string; lastTransitionTime?: string }[];
    history?: HistoryEntry[];
    operationState?: {
      phase?: string;
      message?: string;
      startedAt?: string;
      finishedAt?: string;
      operation?: { initiatedBy?: { username?: string; automated?: boolean } };
    };
    reconciledAt?: string;
    sourceType?: string;
    summary?: { images?: string[]; externalURLs?: string[] };
  };
}

export interface App {
  name: string;
  namespace: string;
  project: string;
  sync: SyncStatus;
  health: HealthStatus;
  healthMessage?: string;
  sources: Source[];
  revision?: string;
  destination: string;
  destinationNamespace?: string;
  automated: boolean;
  selfHeal: boolean;
  autoPrune: boolean;
  resources: Resource[];
  conditions: { type: string; message?: string }[];
  history: HistoryEntry[];
  operation?: { phase: string; message?: string; startedAt?: string; finishedAt?: string; by?: string };
  reconciledAt?: string;
  sourceType?: string;
  images: string[];
  urls: string[];
}

const SYNC: SyncStatus[] = ["Synced", "OutOfSync", "Unknown"];
const HEALTH: HealthStatus[] = ["Healthy", "Progressing", "Degraded", "Suspended", "Missing", "Unknown"];

export function toApp(a: Application): App {
  const st = a.status ?? {};
  const sync = SYNC.find((s) => s === st.sync?.status) ?? "Unknown";
  const health = HEALTH.find((h) => h === st.health?.status) ?? "Unknown";
  const dest = a.spec.destination ?? {};
  const op = st.operationState;
  const by = op?.operation?.initiatedBy;
  return {
    name: a.metadata.name,
    namespace: a.metadata.namespace ?? "argocd",
    project: a.spec.project ?? "default",
    sync,
    health,
    healthMessage: st.health?.message || undefined,
    sources: a.spec.sources?.length ? a.spec.sources : a.spec.source ? [a.spec.source] : [],
    revision: st.sync?.revision ?? st.sync?.revisions?.[0],
    destination: dest.name || dest.server || "",
    destinationNamespace: dest.namespace || undefined,
    automated: !!a.spec.syncPolicy?.automated,
    selfHeal: a.spec.syncPolicy?.automated?.selfHeal === true,
    autoPrune: a.spec.syncPolicy?.automated?.prune === true,
    resources: st.resources ?? [],
    conditions: (st.conditions ?? []).map((c) => ({ type: c.type, message: c.message })),
    history: st.history ?? [],
    operation: op?.phase
      ? {
        phase: op.phase,
        message: op.message || undefined,
        startedAt: op.startedAt,
        finishedAt: op.finishedAt,
        by: by?.automated ? "automated" : by?.username,
      }
      : undefined,
    reconciledAt: st.reconciledAt,
    sourceType: st.sourceType,
    images: st.summary?.images ?? [],
    urls: st.summary?.externalURLs ?? [],
  };
}

export const parseApplications = (body: { items?: Application[] | null }): App[] => (body.items ?? []).map(toApp);

// --- Status -------------------------------------------------------------------------------

export const SYNC_COLORS: Record<SyncStatus, Color> = { Synced: "green", OutOfSync: "orange", Unknown: "gray" };
export const HEALTH_COLORS: Record<HealthStatus, Color> = {
  Healthy: "green",
  Progressing: "blue",
  Degraded: "red",
  Suspended: "purple",
  Missing: "yellow",
  Unknown: "gray",
};

export const SYNC_LABELS: Record<SyncStatus, string> = {
  Synced: "Synced",
  OutOfSync: "Out of sync",
  Unknown: "Unknown",
};

/** The group an application lands in, most urgent first. */
export type Attention = "failed" | "degraded" | "outOfSync" | "progressing" | "ok";

export const ATTENTION_ORDER: Attention[] = ["failed", "degraded", "outOfSync", "progressing", "ok"];
export const ATTENTION_TITLES: Record<Attention, string> = {
  failed: "Sync failed",
  degraded: "Degraded",
  outOfSync: "Out of sync",
  progressing: "Progressing",
  ok: "Synced and healthy",
};

export const isSyncing = (a: App) => a.operation?.phase === "Running" || a.operation?.phase === "Terminating";

export function attention(a: App): Attention {
  if (a.operation && ["Failed", "Error"].includes(a.operation.phase)) return "failed";
  if (a.health === "Degraded" || a.health === "Missing") return "degraded";
  if (a.sync !== "Synced") return "outOfSync";
  if (a.health === "Progressing" || isSyncing(a)) return "progressing";
  return "ok";
}

export function sortApps(apps: App[]): App[] {
  return [...apps].sort((x, y) =>
    ATTENTION_ORDER.indexOf(attention(x)) - ATTENTION_ORDER.indexOf(attention(y)) || x.name.localeCompare(y.name)
  );
}

export type AppFilter = "all" | "attention" | "outOfSync" | "unhealthy";

export function filterApps(apps: App[], filter: AppFilter): App[] {
  switch (filter) {
    case "attention":
      return apps.filter((a) => attention(a) !== "ok");
    case "outOfSync":
      return apps.filter((a) => a.sync !== "Synced");
    case "unhealthy":
      return apps.filter((a) => a.health !== "Healthy");
    default:
      return apps;
  }
}

export interface ResourceCounts {
  total: number;
  outOfSync: number;
  unhealthy: number;
  prune: number;
  byKind: [string, number][];
}

export function resourceCounts(resources: Resource[]): ResourceCounts {
  const kinds = new Map<string, number>();
  for (const r of resources) kinds.set(r.kind, (kinds.get(r.kind) ?? 0) + 1);
  return {
    total: resources.length,
    outOfSync: resources.filter((r) => r.status && r.status !== "Synced").length,
    unhealthy: resources.filter((r) => r.health?.status && !["Healthy", "Suspended"].includes(r.health.status)).length,
    prune: resources.filter((r) => r.requiresPruning).length,
    byKind: [...kinds].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };
}

/** The resources that explain the state: out of sync or not healthy. */
export function problemResources(resources: Resource[]): Resource[] {
  return resources.filter((r) =>
    (r.status && r.status !== "Synced") ||
    (r.health?.status && !["Healthy", "Suspended"].includes(r.health.status))
  );
}

// --- Formatting ---------------------------------------------------------------------------

/** A git SHA shortened, a chart version or tag kept. */
export const shortRevision = (rev?: string) => !rev ? "" : /^[0-9a-f]{40}$/i.test(rev) ? rev.slice(0, 7) : rev;

/** "https://github.com/acme/deploy.git" → "acme/deploy". */
export function repoName(url?: string): string {
  if (!url) return "";
  const m = /^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?[^/:]+[:/](.+?)(?:\.git)?\/?$/i.exec(url.trim());
  return m ? m[1] : url;
}

/** A link to a revision on GitHub, GitLab, Bitbucket or Gitea-like forges, when the repo is a web one. */
export function revisionUrl(repoURL?: string, revision?: string): string | undefined {
  if (!repoURL || !revision || !/^[0-9a-f]{40}$/i.test(revision)) return undefined;
  let web = repoURL.trim().replace(/\.git$/, "").replace(/\/$/, "");
  const ssh = /^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/.exec(web);
  if (ssh) web = `https://${ssh[1]}/${ssh[2]}`;
  if (!/^https?:\/\//.test(web)) return undefined;
  if (web.includes("bitbucket.org")) return `${web}/commits/${revision}`;
  if (web.includes("gitlab")) return `${web}/-/commit/${revision}`;
  return `${web}/commit/${revision}`;
}

export function describeSource(s: Source): string {
  const where = s.chart ? `chart ${s.chart}` : s.path ? s.path : s.ref ? `ref ${s.ref}` : "";
  return [repoName(s.repoURL), where, s.targetRevision ? `@ ${s.targetRevision}` : ""].filter(Boolean).join(" ");
}

/** "https://kubernetes.default.svc" → "in-cluster". */
export function destinationName(a: App): string {
  const d = a.destination === "https://kubernetes.default.svc"
    ? "in-cluster"
    : a.destination.replace(/^https:\/\//, "");
  return a.destinationNamespace ? `${d} / ${a.destinationNamespace}` : d;
}

/** The deployments one can roll back to: newest first, without the one running now. */
export function rollbackTargets(a: App): HistoryEntry[] {
  const sorted = [...a.history].sort((x, y) => y.id - x.id);
  return sorted.slice(1);
}

export function age(date: string | undefined, now = Date.now()): string {
  const t = date ? Date.parse(date) : NaN;
  if (isNaN(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export const formatDate = (date?: string) => {
  const t = date ? Date.parse(date) : NaN;
  return isNaN(t) ? "" : new Date(t).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
};

/** Markdown-safe text in a table cell or inline. */
export const md = (s: string) => s.replace(/([\\`*_[\]|<>])/g, "\\$1").replace(/\n+/g, " ");

// --- Server -------------------------------------------------------------------------------

/** "argocd.example.com/" → "https://argocd.example.com"; keeps a path prefix (`/argocd`). */
export function normalizeUrl(input: unknown): string {
  let text = String(input ?? "").trim();
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  const url = new URL(text);
  const path = url.pathname.replace(/\/(applications|settings|login)(\/.*)?$/, "").replace(/\/+$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

export const appUrl = (base: string, a: App) =>
  `${base}/applications/${encodeURIComponent(a.namespace)}/${encodeURIComponent(a.name)}`;

/** The API path of an application, with the namespace it lives in (apps in any namespace). */
export const appPath = (a: App, suffix = "", query: Record<string, string> = {}) =>
  `/api/v1/applications/${encodeURIComponent(a.name)}${suffix}?${new URLSearchParams({
    ...query,
    appNamespace: a.namespace,
  })}`;

/** Only the PEM blocks of a pasted certificate. */
export function normalizePem(text: string): string | undefined {
  const blocks = text.replace(/\r/g, "").match(/-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g);
  return blocks?.join("\n");
}

export const isCertificateError = (message: string) =>
  /certificate|UnknownIssuer|self[- ]signed|NotValidForName|invalid peer|tls handshake/i.test(message);
