// Errors from four services as one shape, and how they look.

import { type Color, Icons } from "@backslash/api";

export type Service = "glitchtip" | "rollbar" | "honeybadger" | "bugsnag";

export const SERVICES: Record<Service, { title: string; color: Color }> = {
  glitchtip: { title: "GlitchTip", color: "purple" },
  rollbar: { title: "Rollbar", color: "blue" },
  honeybadger: { title: "Honeybadger", color: "orange" },
  bugsnag: { title: "Bugsnag", color: "teal" },
};

export type Level = "fatal" | "error" | "warning" | "info" | "debug";

export interface Issue {
  service: Service;
  /** The service's id, used to resolve it. */
  id: string;
  /** The project's id where the service's API needs it. */
  projectId?: string;
  project: string;
  title: string;
  /** Where it happened: culprit, component#action, context. */
  culprit?: string;
  message?: string;
  level: Level;
  events?: number;
  users?: number;
  environment?: string;
  firstSeen?: string;
  lastSeen?: string;
  url?: string;
  /** GlitchTip's PROJECT-12, Rollbar's #counter. */
  shortId?: string;
  assignee?: string;
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
};

export function normalizeLevel(level: unknown): Level {
  if (typeof level === "number") {
    // Rollbar: 10 debug, 20 info, 30 warning, 40 error, 50 critical.
    return level >= 50 ? "fatal" : level >= 40 ? "error" : level >= 30 ? "warning" : level >= 20 ? "info" : "debug";
  }
  switch (String(level ?? "").toLowerCase()) {
    case "fatal":
    case "critical":
      return "fatal";
    case "warning":
    case "warn":
      return "warning";
    case "info":
      return "info";
    case "debug":
      return "debug";
    default:
      return "error";
  }
}

// ---------------------------------------------------------------------------
// GlitchTip (Sentry-compatible /api/0/organizations/{org}/issues/)

export function fromGlitchtip(body: unknown, base: string, org: string): Issue[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw) => {
    const i = raw as Record<string, any>;
    const id = str(i.id);
    if (!id) return [];
    const meta = i.metadata ?? {};
    return [{
      service: "glitchtip" as const,
      id,
      projectId: str(i.project?.id) || undefined,
      project: str(i.project?.name) || str(i.project?.slug) || "GlitchTip",
      title: str(i.title) || str(meta.type) || "Error",
      culprit: str(i.culprit) || undefined,
      message: str(meta.value) || undefined,
      level: normalizeLevel(i.level),
      events: num(i.count),
      users: num(i.userCount),
      firstSeen: str(i.firstSeen) || undefined,
      lastSeen: str(i.lastSeen) || undefined,
      url: str(i.permalink) || `${base}/${org}/issues/${id}`,
      shortId: str(i.shortId) || undefined,
    }];
  });
}

// ---------------------------------------------------------------------------
// Rollbar (GET /api/1/items?status=active)

const fromUnix = (s: unknown) => {
  const n = num(s);
  return n ? new Date(n * 1000).toISOString() : undefined;
};

/** `acme/website` → the item's page; undefined without it. */
export function rollbarUrl(project: string | undefined, counter: unknown): string | undefined {
  const m = /^\s*([\w.-]+)\/([\w.-]+)\s*$/.exec(project ?? "");
  const c = num(counter);
  return m && c ? `https://app.rollbar.com/a/${m[1]}/fix/item/${m[2]}/${c}` : undefined;
}

export function fromRollbar(body: unknown, project?: string): Issue[] {
  const items = (body as { result?: { items?: unknown[] } } | undefined)?.result?.items;
  if (!Array.isArray(items)) return [];
  const name = /\/([\w.-]+)\s*$/.exec(project ?? "")?.[1] ?? "Rollbar";
  return items.flatMap((raw) => {
    const i = raw as Record<string, any>;
    const id = str(i.id);
    if (!id) return [];
    return [{
      service: "rollbar" as const,
      id,
      projectId: str(i.project_id) || undefined,
      project: name,
      title: str(i.title) || "Error",
      culprit: str(i.framework) || undefined,
      level: normalizeLevel(i.level),
      events: num(i.total_occurrences),
      users: num(i.unique_occurrences),
      environment: str(i.environment) || undefined,
      firstSeen: fromUnix(i.first_occurrence_timestamp),
      lastSeen: fromUnix(i.last_occurrence_timestamp),
      url: rollbarUrl(project, i.counter),
      shortId: i.counter ? `#${i.counter}` : undefined,
    }];
  });
}

// ---------------------------------------------------------------------------
// Honeybadger (GET /v2/projects/{id}/faults)

export interface HoneybadgerProject {
  id: number | string;
  name: string;
  unresolved_fault_count?: number;
}

export function fromHoneybadger(body: unknown, project: HoneybadgerProject): Issue[] {
  const results = (body as { results?: unknown[] } | undefined)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw) => {
    const f = raw as Record<string, any>;
    const id = str(f.id);
    if (!id || f.resolved === true || f.ignored === true) return [];
    const where = [str(f.component), str(f.action)].filter(Boolean).join("#");
    return [{
      service: "honeybadger" as const,
      id,
      projectId: str(f.project_id) || str(project.id),
      project: project.name,
      title: str(f.klass) || "Error",
      culprit: where || undefined,
      message: str(f.message) || undefined,
      level: "error" as const,
      events: num(f.notices_count),
      environment: str(f.environment) || undefined,
      firstSeen: str(f.created_at) || undefined,
      lastSeen: str(f.last_notice_at) || undefined,
      url: str(f.url) || undefined,
      assignee: str(f.assignee?.name) || str(f.assignee?.email) || undefined,
    }];
  });
}

// ---------------------------------------------------------------------------
// Bugsnag (GET /projects/{id}/errors)

export interface BugsnagProject {
  id: string;
  name: string;
  html_url?: string;
  open_error_count?: number;
}

export function fromBugsnag(body: unknown, project: BugsnagProject): Issue[] {
  if (!Array.isArray(body)) return [];
  return body.flatMap((raw) => {
    const e = raw as Record<string, any>;
    const id = str(e.id);
    if (!id || (e.status && e.status !== "open")) return [];
    const stages = Array.isArray(e.release_stages) ? e.release_stages.map(String) : [];
    return [{
      service: "bugsnag" as const,
      id,
      projectId: project.id,
      project: project.name,
      title: str(e.error_class) || "Error",
      culprit: str(e.context) || undefined,
      message: str(e.message) || undefined,
      level: normalizeLevel(e.severity),
      events: num(e.events),
      users: num(e.users),
      environment: stages.join(", ") || undefined,
      firstSeen: str(e.first_seen) || undefined,
      lastSeen: str(e.last_seen) || undefined,
      url: project.html_url ? `${project.html_url.replace(/\/+$/, "")}/errors/${id}` : undefined,
    }];
  });
}

// ---------------------------------------------------------------------------
// Display

export function levelLook(level: Level): { icon: string; tint: Color; text: string } {
  switch (level) {
    case "fatal":
      return { icon: Icons.alert, tint: "red", text: "Fatal" };
    case "warning":
      return { icon: Icons.alert, tint: "orange", text: "Warning" };
    case "info":
      return { icon: Icons.info, tint: "blue", text: "Info" };
    case "debug":
      return { icon: Icons.code, tint: "gray", text: "Debug" };
    default:
      return { icon: Icons.bug, tint: "red", text: "Error" };
  }
}

/** Newest first; ties by events. */
export function sortIssues(issues: Issue[]): Issue[] {
  const t = (i: Issue) => Date.parse(i.lastSeen ?? "") || 0;
  return [...issues].sort((a, b) => t(b) - t(a) || (b.events ?? 0) - (a.events ?? 0));
}

/** "just now", "5m", "3h", "2d", "25 Oct". */
export function since(iso: string | undefined, now = new Date()): string {
  const t = Date.parse(iso ?? "");
  if (!t) return "";
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(t).toLocaleDateString("en", { day: "numeric", month: "short" });
}

/** 1234 → "1.2k". */
export function compact(n: number | undefined): string {
  if (n === undefined) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

export const isRecent = (i: Issue, hours = 24, now = Date.now()) =>
  (Date.parse(i.lastSeen ?? "") || 0) > now - hours * 3_600_000;

export function issueMarkdown(i: Issue): string {
  return [
    `### ${i.title}`,
    i.message ? `\`\`\`text\n${i.message.length > 1200 ? `${i.message.slice(0, 1200)}…` : i.message}\n\`\`\`` : "",
    i.culprit ? `in \`${i.culprit}\`` : "",
  ].filter(Boolean).join("\n\n");
}
