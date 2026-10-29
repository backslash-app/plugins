// Figma's REST API (X-Figma-Token) and Penpot's RPC API (Authorization:
// Token …), with the file index cached so the list shows at once.

import { storage } from "@backslash/api";
import {
  apiError,
  type DesignFile,
  figmaFiles,
  type FigmaProjectFiles,
  figmaProjects,
  type FigmaTeamProjects,
  isAllowedHost,
  normalizePenpot,
  parseTeams,
  penpotFiles,
  penpotProjects,
  pool,
  type Project,
  remember,
  type Tool,
} from "./lib.ts";

export class SetupError extends Error {
  constructor(message: string, readonly tool: Tool, readonly base?: string) {
    super(message);
  }
}

export interface FigmaAuth {
  token: string;
  teams: string[];
  desktop: boolean;
}

export interface PenpotAuth {
  base: string;
  token: string;
}

export function figmaAuth(prefs: Record<string, unknown>): FigmaAuth {
  const token = String(prefs.figmaToken ?? "").trim();
  if (!token) throw new SetupError("Add a Figma personal access token", "figma");
  const teams = parseTeams(prefs.figmaTeams);
  if (!teams.length) throw new SetupError("Add the IDs of your Figma teams", "figma");
  return { token, teams, desktop: /desk|app/i.test(String(prefs.openIn ?? "")) };
}

export function penpotAuth(prefs: Record<string, unknown>): PenpotAuth {
  const base = normalizePenpot(prefs.penpotUrl);
  if (!base) throw new SetupError(`“${prefs.penpotUrl}” is not an address`, "penpot");
  const host = new URL(base).hostname;
  if (!isAllowedHost(host)) {
    throw new SetupError(`${host} is outside the networks this extension may reach`, "penpot", base);
  }
  const token = String(prefs.penpotToken ?? "").trim().replace(/^Token\s+/i, "");
  if (!token) throw new SetupError("Add a Penpot access token", "penpot", base);
  return { base, token };
}

async function send<T>(
  tool: Tool,
  url: string,
  init: RequestInit & { signal?: AbortSignal },
  base?: string,
): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    const host = new URL(url).host;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${host} is outside the networks this extension may reach`, tool, base);
    }
    throw new Error(`${host} is unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    if (res.ok) {
      throw new SetupError(
        `${new URL(url).host} answers, but not as ${tool === "figma" ? "Figma" : "Penpot"}: check the address`,
        tool,
        base,
      );
    }
  }
  if (!res.ok) {
    const message = apiError(tool, res.status, json);
    if (res.status === 401 || res.status === 403) throw new SetupError(message, tool, base);
    throw new Error(message);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Figma

const figma = <T>(a: FigmaAuth, path: string, signal?: AbortSignal) =>
  send<T>("figma", `https://api.figma.com/v1${path}`, {
    headers: { "X-Figma-Token": a.token, Accept: "application/json" },
    signal,
  });

export async function figmaTeamProjects(a: FigmaAuth, signal?: AbortSignal): Promise<Project[]> {
  const lists = await Promise.all(a.teams.map(async (team) => {
    try {
      return figmaProjects(team, await figma<FigmaTeamProjects>(a, `/teams/${team}/projects`, signal));
    } catch (e) {
      if (e instanceof SetupError || signal?.aborted) throw e;
      throw new Error(`Team ${team}: ${(e as Error).message}`);
    }
  }));
  return lists.flat();
}

export async function figmaProjectFiles(a: FigmaAuth, p: Project, signal?: AbortSignal): Promise<DesignFile[]> {
  return figmaFiles(p, await figma<FigmaProjectFiles>(a, `/projects/${p.id}/files`, signal));
}

/** Every file of every project (4 requests at a time: Figma limits the rate). */
export async function figmaIndex(
  a: FigmaAuth,
  signal?: AbortSignal,
): Promise<{ projects: Project[]; files: DesignFile[] }> {
  const projects = await figmaTeamProjects(a, signal);
  const files = await pool(projects, 4, (p) => figmaProjectFiles(a, p, signal));
  projects.forEach((p, i) => {
    p.files = files[i].length;
    p.modified = Math.max(0, ...files[i].map((f) => f.modified));
  });
  return { projects, files: files.flat() };
}

// ---------------------------------------------------------------------------
// Penpot

const penpot = <T>(a: PenpotAuth, command: string, body: Record<string, unknown> = {}, signal?: AbortSignal) =>
  send<T>("penpot", `${a.base}/api/rpc/command/${command}`, {
    method: "POST",
    headers: { Authorization: `Token ${a.token}`, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  }, a.base);

export async function penpotAllProjects(a: PenpotAuth, signal?: AbortSignal): Promise<Project[]> {
  try {
    return penpotProjects(await penpot<Record<string, unknown>[]>(a, "get-all-projects", {}, signal));
  } catch (e) {
    if (e instanceof SetupError || signal?.aborted) throw e;
    // Older Penpot: the teams, then each team's projects.
    const teams = await penpot<Record<string, unknown>[]>(a, "get-teams", {}, signal);
    const lists = await Promise.all(
      teams.map((t) =>
        penpot<Record<string, unknown>[]>(a, "get-projects", { "team-id": t.id, teamId: t.id }, signal)
          .then((ps) =>
            ps.map((p) => ({
              ...p,
              "team-name": t.name,
              "team-id": t.id,
              "is-default-team": t["is-default"] ?? t.isDefault,
            }))
          )
      ),
    );
    return penpotProjects(lists.flat());
  }
}

export async function penpotProjectFiles(a: PenpotAuth, p: Project, signal?: AbortSignal): Promise<DesignFile[]> {
  // Penpot reads its parameters in kebab-case (1.x) or camelCase (2.x).
  const list = await penpot<Record<string, unknown>[]>(
    a,
    "get-project-files",
    { "project-id": p.id, projectId: p.id },
    signal,
  );
  return penpotFiles(p, list);
}

export async function penpotIndex(
  a: PenpotAuth,
  signal?: AbortSignal,
): Promise<{ projects: Project[]; files: DesignFile[] }> {
  const projects = await penpotAllProjects(a, signal);
  const files = await pool(projects, 4, (p) => penpotProjectFiles(a, p, signal));
  projects.forEach((p, i) => {
    p.files = files[i].length;
    p.modified = Math.max(p.modified ?? 0, ...files[i].map((f) => f.modified));
  });
  return { projects, files: files.flat() };
}

// ---------------------------------------------------------------------------
// Cache and recent files

type Json = Parameters<typeof storage.set>[1];

export interface Index {
  at: number;
  projects: Project[];
  files: DesignFile[];
}

async function digest(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A cache key that changes with the account, without keeping the token. */
export async function indexKey(tool: Tool, a: FigmaAuth | PenpotAuth): Promise<string> {
  const id = "teams" in a ? `${a.teams.join(",")} ${a.token}` : `${a.base} ${a.token}`;
  return `index:${tool}:${await digest(id)}`;
}

export async function cachedIndex(key: string): Promise<Index | undefined> {
  return await storage.get(key).catch(() => undefined) as Index | undefined;
}

export async function saveIndex(key: string, index: Omit<Index, "at">): Promise<void> {
  await storage.set(key, { at: Date.now(), ...index } as unknown as Json).catch(() => {});
}

export async function recentFiles(): Promise<string[]> {
  return await storage.get<string[]>("recent").catch(() => undefined) ?? [];
}

export async function markOpened(f: Pick<DesignFile, "tool" | "id">): Promise<void> {
  await storage.set("recent", remember(await recentFiles(), `${f.tool}:${f.id}`)).catch(() => {});
}
