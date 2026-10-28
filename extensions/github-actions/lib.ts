// Workflow runs, jobs and logs: parsing and how they look. Tested in lib_test.ts.

import { type Action, type Color, Icons, type Item, meta, type Metadata, type Stat } from "@backslash/api";

// --- GitHub objects ----------------------------------------------------------------

export interface Actor {
  login: string;
  avatar_url?: string;
}

/** `GET /repos/{owner}/{repo}/actions/runs`. */
export interface Run {
  id: number;
  name?: string | null;
  display_title: string;
  run_number: number;
  run_attempt?: number;
  event: string;
  status: string | null;
  conclusion: string | null;
  workflow_id: number;
  path?: string;
  head_branch: string | null;
  head_sha: string;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  actor?: Actor | null;
  triggering_actor?: Actor | null;
  head_commit?: { id: string; message: string; author?: { name: string } } | null;
  repository: { full_name: string; html_url: string };
  pull_requests?: { number: number }[];
}

export interface Step {
  name: string;
  number: number;
  status: string;
  conclusion: string | null;
  started_at?: string | null;
  completed_at?: string | null;
}

/** `GET /repos/{owner}/{repo}/actions/runs/{id}/jobs`. */
export interface Job {
  id: number;
  run_id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  started_at?: string | null;
  completed_at?: string | null;
  runner_name?: string | null;
  labels?: string[];
  steps?: Step[];
}

export interface Repo {
  full_name: string;
  pushed_at?: string | null;
  archived?: boolean;
  disabled?: boolean;
}

// --- Preferences --------------------------------------------------------------------

/** "a/b, https://github.com/c/d.git\ne/f" → ["a/b", "c/d", "e/f"]. */
export function parseRepositories(text: unknown): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? "").split(/[\s,;]+/)) {
    const name = raw.trim()
      .replace(/^(https?:\/\/)?(www\.)?github\.com\//i, "")
      .replace(/^git@github\.com:/i, "")
      .replace(/\.git$/, "")
      .replace(/\/+$/, "")
      .split("/").slice(0, 2).join("/");
    if (/^[\w.-]+\/[\w.-]+$/.test(name) && !out.some((n) => n.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out;
}

/** Repositories pushed to in the last `days`, most recent first. */
export function recentRepos(repos: Repo[], now = new Date(), days = 30, max = 10): string[] {
  const since = now.getTime() - days * 86_400_000;
  return repos
    .filter((r) => !r.archived && !r.disabled && r.pushed_at && Date.parse(r.pushed_at) >= since)
    .sort((a, b) => Date.parse(b.pushed_at!) - Date.parse(a.pushed_at!))
    .slice(0, max)
    .map((r) => r.full_name);
}

// --- States -------------------------------------------------------------------------

export type Kind = "failure" | "running" | "queued" | "waiting" | "success" | "cancelled" | "skipped" | "neutral";

export interface State {
  kind: Kind;
  icon: string;
  tint: Color;
  text: string;
}

const FAILED = new Set(["failure", "timed_out", "startup_failure"]);

/** What a run, job or step is: the icon and words GitHub would show. */
export function stateOf(o: { status: string | null; conclusion: string | null }): State {
  switch (o.status) {
    case "in_progress":
      return { kind: "running", icon: Icons.inProgress, tint: "yellow", text: "In progress" };
    case "queued":
    case "requested":
    case "pending":
      return { kind: "queued", icon: Icons.todo, tint: "yellow", text: "Queued" };
    case "waiting":
      return { kind: "waiting", icon: Icons.hourglass, tint: "orange", text: "Waiting for approval" };
  }
  switch (o.conclusion) {
    case "success":
      return { kind: "success", icon: Icons.done, tint: "green", text: "Succeeded" };
    case "failure":
      return { kind: "failure", icon: Icons.canceled, tint: "red", text: "Failed" };
    case "timed_out":
      return { kind: "failure", icon: Icons.canceled, tint: "red", text: "Timed out" };
    case "startup_failure":
      return { kind: "failure", icon: Icons.canceled, tint: "red", text: "Startup failure" };
    case "action_required":
      return { kind: "waiting", icon: Icons.alert, tint: "orange", text: "Action required" };
    case "cancelled":
      return { kind: "cancelled", icon: Icons.stop, tint: "gray", text: "Cancelled" };
    case "skipped":
      return { kind: "skipped", icon: Icons.backlog, tint: "gray", text: "Skipped" };
    case "stale":
      return { kind: "neutral", icon: Icons.history, tint: "gray", text: "Stale" };
    default:
      return { kind: "neutral", icon: Icons.done, tint: "gray", text: "Neutral" };
  }
}

export const isActive = (r: { status: string | null }) => !!r.status && r.status !== "completed";
export const isFailed = (o: { conclusion: string | null; status: string | null }) =>
  o.status === "completed" && FAILED.has(o.conclusion ?? "");

/**
 * Runs that are failing now: the latest completed run of a workflow on a
 * branch failed. A failure fixed by a later green run is history, not failing.
 */
export function failing(runs: Run[]): Run[] {
  const latest = new Map<string, Run>();
  for (const r of runs) {
    if (r.status !== "completed" || r.conclusion === "cancelled" || r.conclusion === "skipped") continue;
    const key = `${r.repository.full_name}|${r.workflow_id}|${r.head_branch ?? ""}`;
    const seen = latest.get(key);
    if (!seen || Date.parse(r.created_at) > Date.parse(seen.created_at)) latest.set(key, r);
  }
  return [...latest.values()].filter(isFailed).sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export type Section = "Failing" | "In Progress" | "Recent";

/** The runs a filter shows, in order, with their section. */
export function arrange(runs: Run[], filter: string, max = 60): { run: Run; section: Section }[] {
  const byDate = [...runs].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const fail = failing(runs);
  const active = byDate.filter(isActive);
  if (filter === "failing") return fail.map((run) => ({ run, section: "Failing" }));
  if (filter === "running") return active.map((run) => ({ run, section: "In Progress" }));
  const shown = new Set([...fail, ...active].map((r) => r.id));
  return [
    ...fail.map((run) => ({ run, section: "Failing" as const })),
    ...active.map((run) => ({ run, section: "In Progress" as const })),
    ...byDate.filter((r) => !shown.has(r.id)).slice(0, max).map((run) => ({ run, section: "Recent" as const })),
  ];
}

/** "2 failing · 1 running", for the footer and the root search. */
export function summary(runs: Run[]): string {
  const f = failing(runs).length;
  const a = runs.filter(isActive).length;
  return [f ? `${f} failing` : "", a ? `${a} running` : ""].filter(Boolean).join(" · ");
}

// --- Formatting ---------------------------------------------------------------------

/** 45 s → "45s", 192 s → "3m 12s", 3840 s → "1h 04m". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

function span(start: string | null | undefined, end: string | null | undefined, now: Date): number | undefined {
  if (!start) return undefined;
  const s = Date.parse(start);
  const e = end ? Date.parse(end) : now.getTime();
  return Number.isFinite(s) && Number.isFinite(e) ? e - s : undefined;
}

export function runDuration(r: Run, now = new Date()): string | undefined {
  const ms = span(r.run_started_at ?? r.created_at, r.status === "completed" ? r.updated_at : undefined, now);
  return ms === undefined ? undefined : duration(ms);
}

export function jobDuration(j: Job | Step, now = new Date()): string | undefined {
  if (!j.started_at) return undefined;
  const ms = span(j.started_at, j.status === "completed" ? j.completed_at : undefined, now);
  return ms === undefined ? undefined : duration(ms);
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", "12 Oct". */
export function ago(iso: string, now = new Date()): string {
  const s = (now.getTime() - Date.parse(iso)) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  const days = Math.floor(s / 86_400);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString("en", { day: "numeric", month: "short" });
}

const EVENTS: Record<string, string> = {
  push: "Push",
  pull_request: "Pull request",
  pull_request_target: "Pull request (target)",
  schedule: "Schedule",
  workflow_dispatch: "Manual",
  workflow_run: "After another workflow",
  release: "Release",
  merge_group: "Merge queue",
  repository_dispatch: "Repository dispatch",
  dynamic: "Dynamic",
};

export const eventName = (e: string) => EVENTS[e] ?? e.replace(/_/g, " ");

export const headline = (message: string | undefined | null) => (message ?? "").split("\n")[0].trim();

const workflowName = (r: Run) => r.name || r.path?.split("/").pop() || "Workflow";

/** The workflow file on GitHub: `.github/workflows/ci.yml` at the run's commit. */
export function workflowUrl(r: Run): string | undefined {
  const file = r.path?.split("@")[0];
  return file ? `${r.repository.html_url}/actions/workflows/${file.split("/").pop()}` : undefined;
}

// --- Runs ---------------------------------------------------------------------------

export function runStats(r: Run, now = new Date()): Stat[] {
  const d = runDuration(r, now);
  return [
    ...(d ? [{ label: isActive(r) ? "running for" : "duration", value: d }] : []),
    { label: "run", value: `#${r.run_number}` },
    ...((r.run_attempt ?? 1) > 1 ? [{ label: "attempt", value: r.run_attempt!, color: "orange" as Color }] : []),
  ];
}

export function runMetadata(r: Run, now = new Date()): Metadata[] {
  const s = stateOf(r);
  const lines: Metadata[] = [
    meta.text("Status", s.text, { icon: s.icon, color: s.tint }),
    meta.text("Workflow", workflowName(r), { icon: Icons.activity }),
    meta.text("Repository", r.repository.full_name, { icon: Icons.repository }),
  ];
  if (r.head_branch) lines.push(meta.text("Branch", r.head_branch, { icon: Icons.branch }));
  lines.push(meta.text("Event", eventName(r.event), { icon: Icons.bolt }));
  if (r.pull_requests?.length) {
    lines.push(meta.tags("Pull requests", r.pull_requests.map((p) => `#${p.number}`)));
  }
  lines.push(meta.text("Commit", r.head_sha.slice(0, 7), { icon: Icons.commit }));
  lines.push(meta.separator());
  if (r.actor) lines.push(meta.person("Actor", r.actor.login, r.actor.avatar_url));
  if (r.triggering_actor && r.triggering_actor.login !== r.actor?.login) {
    lines.push(meta.person("Re-run by", r.triggering_actor.login, r.triggering_actor.avatar_url));
  }
  lines.push(meta.text("Started", ago(r.run_started_at ?? r.created_at, now), { icon: Icons.clock }));
  const d = runDuration(r, now);
  if (d) lines.push(meta.text("Duration", d, { icon: Icons.timer }));
  lines.push(meta.link("Run", `${r.repository.full_name.split("/")[1]} #${r.run_number}`, r.html_url));
  return lines;
}

export function runItem(r: Run, section: string | undefined, actions: Action[], now = new Date()): Item {
  const s = stateOf(r);
  const d = runDuration(r, now);
  const message = r.head_commit?.message?.trim();
  return {
    id: String(r.id),
    title: r.display_title || headline(message) || workflowName(r),
    subtitle: `${r.repository.full_name.split("/")[1]} · ${workflowName(r)}`,
    icon: { source: s.icon, tint: s.tint },
    section,
    keywords: [r.repository.full_name, workflowName(r), r.head_branch ?? "", r.actor?.login ?? "", r.event, s.text],
    accessories: [
      ...(r.head_branch ? [{ icon: Icons.branch, text: r.head_branch, tooltip: "Branch" }] : []),
      ...(d ? [{ icon: Icons.timer, text: d, tooltip: isActive(r) ? "Running for" : "Duration" }] : []),
      ...(r.actor ? [{ avatar: r.actor.avatar_url ?? r.actor.login, tooltip: r.actor.login }] : []),
      { text: ago(r.created_at, now), tooltip: s.text },
    ],
    detail: {
      stats: runStats(r, now),
      markdown: message ? `**${headline(message)}**${message.includes("\n") ? `\n\n${body(message)}` : ""}` : undefined,
      metadata: runMetadata(r, now),
    },
    actions,
  };
}

function body(message: string): string {
  const rest = message.split("\n").slice(1).join("\n").trim();
  return rest.length > 600 ? `${rest.slice(0, 600).trimEnd()}…` : rest;
}

// --- Jobs and steps -----------------------------------------------------------------

export function stepLines(job: Job, now = new Date()): Metadata[] {
  return (job.steps ?? []).map((step) => {
    const s = stateOf(step);
    const d = jobDuration(step, now);
    return meta.text(step.name, d ? `${s.text} · ${d}` : s.text, { icon: s.icon, color: s.tint });
  });
}

export function failedStep(job: Job): Step | undefined {
  return job.steps?.find((s) => isFailed(s));
}

export function jobItem(job: Job, actions: Action[], now = new Date()): Item {
  const s = stateOf(job);
  const d = jobDuration(job, now);
  const steps = job.steps ?? [];
  const done = steps.filter((st) => st.status === "completed").length;
  const bad = failedStep(job);
  return {
    id: String(job.id),
    title: job.name,
    subtitle: bad ? `Failed at “${bad.name}”` : undefined,
    icon: { source: s.icon, tint: s.tint },
    section: s.kind === "failure" ? "Failed" : s.kind === "running" || s.kind === "queued" ? "Running" : "Jobs",
    keywords: [s.text, ...steps.map((st) => st.name)],
    accessories: [
      ...(steps.length ? [{ text: `${done}/${steps.length} steps` }] : []),
      ...(d ? [{ icon: Icons.timer, text: d }] : []),
    ],
    detail: {
      stats: [
        { label: "status", value: s.text, color: s.tint },
        ...(d ? [{ label: "duration", value: d }] : []),
        ...(steps.length ? [{ label: "steps", value: `${done}/${steps.length}` }] : []),
      ],
      metadata: [
        ...stepLines(job, now),
        ...(job.runner_name || job.labels?.length ? [meta.separator()] : []),
        ...(job.labels?.length ? [meta.tags("Runs on", job.labels)] : []),
        ...(job.runner_name ? [meta.text("Runner", job.runner_name, { icon: Icons.server })] : []),
      ],
    },
    actions,
  };
}

// --- Logs ---------------------------------------------------------------------------

/** One readable line per log line: no timestamps, colors or workflow commands. */
export function cleanLog(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    let line = raw.replace(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z ?/, "")
      // deno-lint-ignore no-control-regex
      .replace(/\x1b\[[0-9;]*[A-Za-z]/g, "");
    if (line.startsWith("##[endgroup]")) continue;
    if (line.startsWith("##[group]")) line = `▸ ${line.slice(9)}`;
    else if (line.startsWith("##[error]")) line = `Error: ${line.slice(9)}`;
    else if (line.startsWith("##[warning]")) line = `Warning: ${line.slice(11)}`;
    else if (line.startsWith("##[notice]")) line = `Notice: ${line.slice(10)}`;
    else if (line.startsWith("##[debug]")) continue;
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out;
}

/** The end of a log, and its error lines. */
export function logTail(text: string, max = 80): { errors: string[]; tail: string[]; total: number } {
  const lines = cleanLog(text);
  // GitHub's own clean-up steps come after the failure: stop before them.
  let end = lines.length;
  const post = lines.findIndex((l) => /^▸ Post job cleanup\.|^Cleaning up orphan processes/.test(l));
  if (post > 0) end = post;
  const errors = lines.slice(0, end).filter((l) => /^Error: /.test(l)).map((l) => l.slice(7)).slice(-10);
  return { errors, tail: lines.slice(Math.max(0, end - max), end), total: lines.length };
}

export function logMarkdown(job: Job, text: string, max = 80): string {
  if (!text.trim()) return `# ${job.name}\n\n_The log is not available (expired, or the job did not start)._`;
  const { errors, tail, total } = logTail(text, max);
  const bad = failedStep(job);
  const fence = tail.some((l) => l.includes("```")) ? "~~~" : "```";
  return [
    `# ${job.name}`,
    "",
    ...(bad ? [`Failed at step **${bad.number}. ${bad.name}**`, ""] : []),
    ...(errors.length ? ["## Errors", "", ...errors.map((e) => `- ${e.replace(/([*_`[\]])/g, "\\$1")}`), ""] : []),
    `## Last ${tail.length} of ${total} lines`,
    "",
    `${fence}text`,
    ...tail,
    fence,
  ].join("\n");
}

/** The failed job a log action should show, else the first one. */
export function jobToShow(jobs: Job[]): Job | undefined {
  return jobs.find(isFailed) ?? jobs[0];
}
