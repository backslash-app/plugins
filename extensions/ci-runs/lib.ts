// One shape for the runs of four CI systems: parsing their API answers,
// statuses, ordering, durations and web URLs.

import type { Color } from "@backslash/api";

export type Provider = "circleci" | "buildkite" | "woodpecker" | "jenkins";

export const PROVIDERS: Provider[] = ["circleci", "buildkite", "woodpecker", "jenkins"];

export const PROVIDER_NAMES: Record<Provider, string> = {
  circleci: "CircleCI",
  buildkite: "Buildkite",
  woodpecker: "Woodpecker",
  jenkins: "Jenkins",
};

export type Status = "failed" | "running" | "queued" | "blocked" | "success" | "canceled" | "skipped";

export interface Run {
  provider: Provider;
  /** Unique within the provider. */
  id: string;
  /** Repository, pipeline or job. */
  project: string;
  number?: number;
  status: Status;
  /** The provider's own word ("failing", "UNSTABLE"…). */
  rawStatus: string;
  branch?: string;
  tag?: string;
  commit?: string;
  message?: string;
  author?: string;
  avatar?: string;
  event?: string;
  created?: number;
  started?: number;
  finished?: number;
  url: string;
  /** Sub-runs worth listing in the detail (CircleCI workflows). */
  parts: { name: string; status: Status; rawStatus: string }[];
  canRerun: boolean;
  canCancel: boolean;
  /** What the provider needs to act on it. */
  ref: Record<string, string>;
}

const time = (s?: string | null) => {
  const t = s ? Date.parse(s) : NaN;
  return isNaN(t) ? undefined : t;
};

const ACTIVE: Status[] = ["running", "queued"];

// --- CircleCI -----------------------------------------------------------------------------

export interface CirclePipeline {
  id: string;
  number: number;
  project_slug: string;
  state: string;
  created_at: string;
  updated_at?: string;
  errors?: { type: string; message: string }[];
  trigger?: { type?: string; actor?: { login?: string; avatar_url?: string | null } };
  vcs?: {
    branch?: string;
    tag?: string;
    revision?: string;
    commit?: { subject?: string; body?: string };
  };
}

export interface CircleWorkflow {
  id: string;
  name: string;
  status: string;
  created_at?: string;
  stopped_at?: string | null;
}

const CIRCLE_STATUS: Record<string, Status> = {
  success: "success",
  running: "running",
  failing: "failed",
  failed: "failed",
  error: "failed",
  on_hold: "blocked",
  canceled: "canceled",
  not_run: "skipped",
  unauthorized: "failed",
};

/** "gh/acme/api" → "https://app.circleci.com/pipelines/github/acme/api/12". */
export function circleUrl(slug: string, number: number, workflow?: string): string {
  const [vcs, ...rest] = slug.split("/");
  const host = vcs === "gh" ? "github" : vcs === "bb" ? "bitbucket" : vcs;
  return `https://app.circleci.com/pipelines/${[host, ...rest].join("/")}/${number}${
    workflow ? `/workflows/${workflow}` : ""
  }`;
}

/** The worst workflow wins: failed, then running, on hold, canceled, success. */
export function circleStatus(p: CirclePipeline, workflows: CircleWorkflow[]): { status: Status; raw: string } {
  if (p.state === "errored") return { status: "failed", raw: "errored" };
  if (!workflows.length) return { status: "queued", raw: p.state };
  const statuses = workflows.map((w) => CIRCLE_STATUS[w.status] ?? "queued");
  for (const s of ["failed", "running", "queued", "blocked", "canceled", "success", "skipped"] as Status[]) {
    const i = statuses.indexOf(s);
    if (i >= 0) return { status: s, raw: workflows[i].status };
  }
  return { status: "queued", raw: p.state };
}

export function fromCircle(p: CirclePipeline, workflows: CircleWorkflow[]): Run {
  const { status, raw } = circleStatus(p, workflows);
  const created = workflows.map((w) => time(w.created_at)).filter((t) => t !== undefined) as number[];
  const stopped = workflows.map((w) => time(w.stopped_at)).filter((t) => t !== undefined) as number[];
  const done = workflows.length > 0 && stopped.length === workflows.length;
  const repo = p.project_slug.split("/").slice(1).join("/");
  return {
    provider: "circleci",
    id: p.id,
    project: repo || p.project_slug,
    number: p.number,
    status,
    rawStatus: raw,
    branch: p.vcs?.branch,
    tag: p.vcs?.tag,
    commit: p.vcs?.revision,
    message: p.vcs?.commit?.subject ?? p.errors?.[0]?.message,
    author: p.trigger?.actor?.login,
    avatar: p.trigger?.actor?.avatar_url ?? undefined,
    event: p.trigger?.type,
    created: time(p.created_at),
    started: created.length ? Math.min(...created) : undefined,
    finished: done ? Math.max(...stopped) : undefined,
    url: circleUrl(p.project_slug, p.number, workflows.length === 1 ? workflows[0].id : undefined),
    parts: workflows.map((w) => ({ name: w.name, status: CIRCLE_STATUS[w.status] ?? "queued", rawStatus: w.status })),
    canRerun: workflows.some((w) => !["running", "on_hold"].includes(w.status)),
    canCancel: workflows.some((w) => ["running", "on_hold", "failing"].includes(w.status)),
    ref: {
      rerun: workflows.filter((w) => !["running", "on_hold"].includes(w.status)).map((w) => w.id).join(","),
      failed: workflows.filter((w) => ["failed", "error", "failing"].includes(w.status)).map((w) => w.id).join(","),
      cancel: workflows.filter((w) => ["running", "on_hold", "failing"].includes(w.status)).map((w) => w.id).join(","),
    },
  };
}

/** "gh/acme, bb/x junk" → ["gh/acme", "bb/x"]. */
export function parseOrgs(text: unknown): string[] {
  const orgs = String(text ?? "").split(/[\s,;]+/).filter((o) => /^[\w-]+\/[\w.-]+$/.test(o));
  return [...new Set(orgs)];
}

// --- Buildkite ----------------------------------------------------------------------------

export interface BuildkiteBuild {
  id: string;
  url: string;
  web_url: string;
  number: number;
  state: string;
  blocked?: boolean;
  message?: string | null;
  commit?: string;
  branch?: string;
  source?: string;
  created_at?: string | null;
  scheduled_at?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  creator?: { name?: string; avatar_url?: string } | null;
  author?: { name?: string; username?: string } | null;
  pipeline?: { slug?: string; name?: string };
}

const BUILDKITE_STATUS: Record<string, Status> = {
  running: "running",
  scheduled: "queued",
  creating: "queued",
  passed: "success",
  failing: "failed",
  failed: "failed",
  blocked: "blocked",
  canceled: "canceled",
  canceling: "running",
  skipped: "skipped",
  not_run: "skipped",
};

/** "https://api.buildkite.com/v2/organizations/acme/pipelines/web/builds/12" → { org, pipeline }. */
export function buildkiteSlugs(apiUrl: string): { org: string; pipeline: string } | undefined {
  const m = /\/organizations\/([^/]+)\/pipelines\/([^/]+)\/builds\//.exec(apiUrl);
  return m ? { org: m[1], pipeline: m[2] } : undefined;
}

export function fromBuildkite(b: BuildkiteBuild): Run {
  const status = BUILDKITE_STATUS[b.state] ?? "queued";
  const slugs = buildkiteSlugs(b.url);
  return {
    provider: "buildkite",
    id: b.id,
    project: b.pipeline?.name ?? slugs?.pipeline ?? "",
    number: b.number,
    status,
    rawStatus: b.state,
    branch: b.branch,
    commit: b.commit && b.commit !== "HEAD" ? b.commit : undefined,
    message: b.message?.split("\n")[0] || undefined,
    author: b.author?.name ?? b.creator?.name,
    avatar: b.creator?.avatar_url,
    event: b.source,
    created: time(b.created_at),
    started: time(b.started_at),
    finished: time(b.finished_at),
    url: b.web_url,
    parts: [],
    canRerun: !ACTIVE.includes(status) && b.state !== "canceling" && !!slugs,
    canCancel: ["running", "scheduled", "blocked", "failing", "creating"].includes(b.state) && !!slugs,
    ref: slugs ? { org: slugs.org, pipeline: slugs.pipeline, number: String(b.number) } : {},
  };
}

// --- Woodpecker ---------------------------------------------------------------------------

export interface WoodpeckerFeed {
  repo_id?: number;
  id?: number;
  number: number;
  event?: string;
  status: string;
  created?: number;
  started?: number;
  finished?: number;
  commit?: string;
  branch?: string;
  ref?: string;
  title?: string;
  message?: string;
  author?: string;
  author_avatar?: string;
  full_name?: string;
  owner?: string;
  name?: string;
}

export interface WoodpeckerRepo {
  id: number;
  full_name: string;
}

const WOODPECKER_STATUS: Record<string, Status> = {
  success: "success",
  failure: "failed",
  error: "failed",
  killed: "canceled",
  running: "running",
  pending: "queued",
  created: "queued",
  blocked: "blocked",
  declined: "canceled",
  skipped: "skipped",
};

const unix = (s?: number) => s && s > 0 ? s * 1000 : undefined;

export function fromWoodpecker(f: WoodpeckerFeed, base: string, repos: Map<number, string>): Run | undefined {
  if (f.repo_id === undefined) return undefined;
  const status = WOODPECKER_STATUS[f.status] ?? "queued";
  const project = f.full_name || (f.owner && f.name ? `${f.owner}/${f.name}` : repos.get(f.repo_id) ?? `#${f.repo_id}`);
  const tag = f.event === "tag" ? f.ref?.replace(/^refs\/tags\//, "") : undefined;
  return {
    provider: "woodpecker",
    id: `${f.repo_id}/${f.number}`,
    project,
    number: f.number,
    status,
    rawStatus: f.status,
    branch: tag ? undefined : f.branch,
    tag,
    commit: f.commit,
    message: (f.message ?? f.title)?.split("\n")[0] || undefined,
    author: f.author,
    avatar: f.author_avatar,
    event: f.event,
    created: unix(f.created),
    started: unix(f.started),
    finished: unix(f.finished),
    url: `${base}/repos/${f.repo_id}/pipeline/${f.number}`,
    parts: [],
    canRerun: !ACTIVE.includes(status) && status !== "blocked",
    canCancel: ACTIVE.includes(status) || status === "blocked",
    ref: { repo: String(f.repo_id), number: String(f.number) },
  };
}

// --- Jenkins ------------------------------------------------------------------------------

export interface JenkinsBuild {
  number: number;
  url: string;
  result: string | null;
  building: boolean;
  timestamp: number;
  duration: number;
  estimatedDuration?: number;
  displayName?: string;
  changeSets?: { items?: { commitId?: string; msg?: string; author?: { fullName?: string } }[] }[];
  actions?: ({
    _class?: string;
    causes?: { shortDescription?: string; userName?: string }[];
    lastBuiltRevision?: { SHA1?: string; branch?: { name?: string }[] };
  } | null)[];
}

export interface JenkinsJob {
  _class?: string;
  name: string;
  fullName?: string;
  url: string;
  color?: string;
  buildable?: boolean;
  lastBuild?: JenkinsBuild | null;
  jobs?: JenkinsJob[];
}

/** The tree query for jobs three folders deep with their last build. */
export function jenkinsTree(): string {
  const build =
    "lastBuild[number,url,result,building,timestamp,duration,estimatedDuration,displayName,changeSets[items[commitId,msg,author[fullName]]],actions[causes[shortDescription,userName],lastBuiltRevision[SHA1,branch[name]]]]";
  const job = (inner: string) => `name,fullName,url,color,buildable,${build}${inner ? `,jobs[${inner}]` : ""}`;
  return `jobs[${job(job(job("")))}]`;
}

/** Every job with a build, folders and multibranch projects flattened. */
export function flattenJobs(jobs: JenkinsJob[]): JenkinsJob[] {
  return jobs.flatMap((j) => [...(j.lastBuild ? [j] : []), ...flattenJobs(j.jobs ?? [])]);
}

const JENKINS_STATUS: Record<string, Status> = {
  SUCCESS: "success",
  FAILURE: "failed",
  UNSTABLE: "failed",
  ABORTED: "canceled",
  NOT_BUILT: "skipped",
};

export function fromJenkins(j: JenkinsJob): Run | undefined {
  const b = j.lastBuild;
  if (!b) return undefined;
  const status: Status = b.building ? "running" : JENKINS_STATUS[b.result ?? ""] ?? "queued";
  const change = b.changeSets?.flatMap((c) => c.items ?? []).at(-1);
  const rev = b.actions?.find((a) => a?.lastBuiltRevision)?.lastBuiltRevision;
  const cause = b.actions?.flatMap((a) => a?.causes ?? [])[0];
  const fullName = j.fullName ?? j.name;
  // A multibranch job is named after its branch: "api/main".
  const parts = fullName.split("/");
  const branch = rev?.branch?.[0]?.name?.replace(/^(refs\/remotes\/)?origin\//, "") ??
    (parts.length > 1 ? decodeURIComponent(parts.at(-1)!) : undefined);
  return {
    provider: "jenkins",
    id: b.url,
    project: fullName,
    number: b.number,
    status,
    rawStatus: b.building ? "BUILDING" : b.result ?? "PENDING",
    branch,
    commit: change?.commitId ?? rev?.SHA1,
    message: change?.msg ?? cause?.shortDescription,
    author: change?.author?.fullName ?? cause?.userName,
    created: b.timestamp || undefined,
    started: b.timestamp || undefined,
    finished: !b.building && b.timestamp ? b.timestamp + b.duration : undefined,
    url: b.url,
    parts: [],
    canRerun: !b.building && j.buildable !== false,
    canCancel: b.building,
    ref: { job: j.url, build: b.url, estimate: String(b.estimatedDuration ?? "") },
  };
}

// --- Sorting and formatting ---------------------------------------------------------------

export type Group = "Failing" | "Running" | "Waiting" | "Recent";
const GROUPS: Group[] = ["Failing", "Running", "Waiting", "Recent"];

const branchKey = (r: Run) => `${r.provider}\n${r.project}\n${r.branch ?? r.tag ?? ""}`;

/**
 * The failed runs that are still the latest of their project and branch: an older
 * failure fixed by a newer run is just history.
 */
export function currentFailures(runs: Run[]): Set<Run> {
  const latest = new Map<string, number>();
  for (const r of runs) latest.set(branchKey(r), Math.max(latest.get(branchKey(r)) ?? 0, r.created ?? 0));
  return new Set(runs.filter((r) => r.status === "failed" && (r.created ?? 0) >= (latest.get(branchKey(r)) ?? 0)));
}

export function group(r: Run, failing: Set<Run>): Group {
  if (r.status === "failed") return failing.has(r) ? "Failing" : "Recent";
  if (ACTIVE.includes(r.status)) return "Running";
  if (r.status === "blocked") return "Waiting";
  return "Recent";
}

/** Failing first, then running, waiting, the rest; newest first in each group. */
export function sortRuns(runs: Run[]): Run[] {
  const failing = currentFailures(runs);
  const rank = (r: Run) => GROUPS.indexOf(group(r, failing));
  return [...runs].sort((a, b) => rank(a) - rank(b) || (b.created ?? 0) - (a.created ?? 0));
}

export type RunFilter = "all" | "failed" | "running" | Provider;

export function filterRuns(runs: Run[], filter: RunFilter): Run[] {
  if (filter === "failed") return runs.filter((r) => r.status === "failed");
  if (filter === "running") return runs.filter((r) => ACTIVE.includes(r.status) || r.status === "blocked");
  if ((PROVIDERS as string[]).includes(filter)) return runs.filter((r) => r.provider === filter);
  return runs;
}

export const STATUS_COLORS: Record<Status, Color> = {
  failed: "red",
  running: "yellow",
  queued: "blue",
  blocked: "purple",
  success: "green",
  canceled: "gray",
  skipped: "gray",
};

export const STATUS_LABELS: Record<Status, string> = {
  failed: "Failed",
  running: "Running",
  queued: "Queued",
  blocked: "Waiting",
  success: "Passed",
  canceled: "Canceled",
  skipped: "Skipped",
};

/** How long it ran, or has been running. */
export function duration(r: Run, now = Date.now()): number | undefined {
  if (!r.started) return undefined;
  const end = r.finished ?? (ACTIVE.includes(r.status) ? now : undefined);
  return end === undefined ? undefined : Math.max(0, end - r.started);
}

/** 75_000 → "1m 15s", 3_725_000 → "1h 2m". */
export function formatDuration(ms?: number): string {
  if (ms === undefined) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function age(t: number | undefined, now = Date.now()): string {
  if (!t) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export const formatDate = (t?: number) =>
  t ? new Date(t).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";

export const shortSha = (sha?: string) => sha && /^[0-9a-f]{12,}$/i.test(sha) ? sha.slice(0, 7) : sha ?? "";

/** "ci.example.com/" → "https://ci.example.com"; keeps a path prefix (`/jenkins`). */
export function normalizeUrl(input: unknown): string {
  let text = String(input ?? "").trim();
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  const url = new URL(text);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}
