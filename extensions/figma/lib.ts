// Figma teams, projects and files, and Penpot projects and files, as one kind
// of design file; links, dates and the preferences.

/** The hosts of `[permissions] net` (kept equal by a test). */
export const HOSTS = [
  "api.figma.com",
  "s3-alpha.figma.com",
  "s3-alpha-sig.figma.com",
  "design.penpot.app",
  "localhost",
  "127.0.0.1",
  "penpot",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.duckdns.org",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/**
 * "123, 456", "https://www.figma.com/files/team/123/Design" or the newer
 * "https://www.figma.com/files/9876/team/123/…" → ["123", "456"].
 */
export function parseTeams(input: unknown): string[] {
  const out: string[] = [];
  for (const part of String(input ?? "").split(/[\s,;]+/)) {
    const fromUrl = /\/team\/(\d+)/.exec(part);
    const id = fromUrl?.[1] ?? (/^\d+$/.test(part) ? part : undefined);
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

/** `design.penpot.app/#/dashboard` → `https://design.penpot.app`; http for local names. */
export function normalizePenpot(input: unknown): string {
  let url = String(input ?? "").trim() || "https://design.penpot.app";
  if (!/^https?:\/\//i.test(url)) {
    const host = url.split(/[/:#]/)[0];
    url = `${isLocal(host) ? "http" : "https"}://${url}`;
  }
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/(api.*|dashboard.*|workspace.*)$/i, "").replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return "";
  }
}

const isLocal = (host: string) =>
  host === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(host) || !host.includes(".") ||
  /\.(local|lan|home|home\.arpa|internal)$/.test(host);

// ---------------------------------------------------------------------------
// Model

export type Tool = "figma" | "penpot";

export interface DesignFile {
  tool: Tool;
  id: string;
  name: string;
  /** ms since epoch. */
  modified: number;
  project: string;
  projectId: string;
  team: string;
  teamId: string;
  thumbnail?: string;
  shared?: boolean;
}

export interface Project {
  tool: Tool;
  id: string;
  name: string;
  team: string;
  teamId: string;
  files?: number;
  modified?: number;
}

// ---------------------------------------------------------------------------
// Figma

export interface FigmaTeamProjects {
  name?: string;
  projects?: { id: string | number; name: string }[];
}

export interface FigmaProjectFiles {
  name?: string;
  files?: { key: string; name: string; thumbnail_url?: string | null; last_modified?: string }[];
}

export function figmaProjects(teamId: string, r: FigmaTeamProjects): Project[] {
  return (r.projects ?? []).map((p) => ({
    tool: "figma",
    id: String(p.id),
    name: p.name,
    team: r.name ?? `Team ${teamId}`,
    teamId,
  }));
}

export function figmaFiles(project: Project, r: FigmaProjectFiles): DesignFile[] {
  return (r.files ?? []).map((f) => ({
    tool: "figma",
    id: f.key,
    name: f.name,
    modified: Date.parse(f.last_modified ?? "") || 0,
    project: project.name,
    projectId: project.id,
    team: project.team,
    teamId: project.teamId,
    thumbnail: f.thumbnail_url && /^https:\/\//.test(f.thumbnail_url) ? f.thumbnail_url : undefined,
  }));
}

/** "Design System v2 (WIP)" → "Design-System-v2-WIP", as Figma writes it in links. */
export function slug(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") ||
    "Untitled";
}

/** `/file/` links open designs, FigJam boards and slides alike (Figma redirects). */
export const figmaUrl = (f: Pick<DesignFile, "id" | "name">) => `https://www.figma.com/file/${f.id}/${slug(f.name)}`;
export const figmaDesktopUrl = (f: Pick<DesignFile, "id" | "name">) => `figma://file/${f.id}/${slug(f.name)}`;
export const figmaProjectUrl = (p: Pick<Project, "id">) => `https://www.figma.com/files/project/${p.id}`;
export const figmaTeamUrl = (teamId: string) => `https://www.figma.com/files/team/${teamId}`;

// ---------------------------------------------------------------------------
// Penpot

/** Penpot answers JSON in kebab-case (1.x) or camelCase (2.x): read either. */
export function pick<T = unknown>(o: Record<string, unknown> | undefined, key: string): T | undefined {
  if (!o) return undefined;
  if (key in o) return o[key] as T;
  const camel = key.replace(/-(\w)/g, (_, c: string) => c.toUpperCase());
  return o[camel] as T | undefined;
}

const date = (v: unknown) => typeof v === "string" ? Date.parse(v) || 0 : typeof v === "number" ? v : 0;

export function penpotProjects(list: Record<string, unknown>[]): Project[] {
  return list.map((p) => {
    const isDefault = !!pick(p, "is-default");
    return {
      tool: "penpot" as const,
      id: String(pick(p, "id")),
      name: isDefault ? "Drafts" : String(pick(p, "name") ?? "Untitled"),
      team: pick<boolean>(p, "is-default-team") ? "Your Penpot" : String(pick(p, "team-name") ?? "Team"),
      teamId: String(pick(p, "team-id") ?? ""),
      files: typeof pick(p, "count") === "number" ? pick<number>(p, "count") : undefined,
      modified: date(pick(p, "modified-at")) || undefined,
    };
  });
}

export function penpotFiles(project: Project, list: Record<string, unknown>[]): DesignFile[] {
  return list.filter((f) => !pick(f, "deleted-at")).map((f) => ({
    tool: "penpot" as const,
    id: String(pick(f, "id")),
    name: String(pick(f, "name") ?? "Untitled"),
    modified: date(pick(f, "modified-at")) || date(pick(f, "created-at")),
    project: project.name,
    projectId: project.id,
    team: project.team,
    teamId: project.teamId,
    shared: !!pick(f, "is-shared"),
  }));
}

/** The workspace of a file in Penpot 2 (query parameters); 1.x redirects from the dashboard. */
export function penpotUrl(base: string, f: Pick<DesignFile, "id" | "teamId" | "projectId">): string {
  return `${base}/#/workspace?team-id=${f.teamId}&file-id=${f.id}`;
}

export function penpotProjectUrl(base: string, p: Pick<Project, "id" | "teamId">): string {
  return `${base}/#/dashboard/recent?team-id=${p.teamId}&project-id=${p.id}`;
}

// ---------------------------------------------------------------------------

/** Newest first; opened recently through Backslash comes first of all. */
export function sortFiles(files: DesignFile[], recent: string[] = []): DesignFile[] {
  const rank = (f: DesignFile) => {
    const i = recent.indexOf(`${f.tool}:${f.id}`);
    return i < 0 ? Infinity : i;
  };
  return [...files].sort((a, b) => rank(a) - rank(b) || b.modified - a.modified || a.name.localeCompare(b.name));
}

/** Remember a file as just opened; keeps the 8 latest. */
export function remember(recent: string[], key: string, max = 8): string[] {
  return [key, ...recent.filter((k) => k !== key)].slice(0, max);
}

/** "just now", "5 minutes ago", "yesterday", "3 days ago", "12 Mar 2025". */
export function ago(ts: number, now = Date.now()): string {
  if (!ts) return "unknown";
  const m = Math.floor((now - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  return new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** Short age for a row: "5m", "3h", "2d", "Mar 2025". */
export function shortAge(ts: number, now = Date.now()): string {
  if (!ts) return "";
  const m = Math.floor((now - ts) / 60_000);
  if (m < 60) return `${Math.max(1, m)}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  if (m < 30 * 1440) return `${Math.floor(m / 1440)}d`;
  return new Date(ts).toLocaleDateString("en-GB", { month: "short", year: "numeric" });
}

/** A Figma or Penpot error as a sentence. */
export function apiError(tool: Tool, status: number, body: unknown): string {
  const b = body as { err?: string; message?: string; type?: string; code?: string; hint?: string } | undefined;
  if (tool === "figma") {
    if (status === 403 || status === 401) {
      return /scope/i.test(b?.err ?? "")
        ? `Figma: the token lacks a scope (${b!.err})`
        : "Figma refused the token: generate a new one in Settings → Security";
    }
    if (status === 404) return "Figma doesn't know this team: check the team IDs in Settings";
    if (status === 429) return "Figma is rate limiting: try again in a minute";
    return `Figma answered ${status}${b?.err ? `: ${b.err}` : ""}`;
  }
  if (status === 401 || status === 403 || b?.code === "authentication-required") {
    return "Penpot refused the access token: generate a new one in Your account → Access tokens";
  }
  return `Penpot answered ${status}${b?.hint ?? b?.message ?? b?.code ? `: ${b?.hint ?? b?.message ?? b?.code}` : ""}`;
}

/** Runs `fn` over `items` with at most `n` at a time. */
export async function pool<T, R>(items: T[], n: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
