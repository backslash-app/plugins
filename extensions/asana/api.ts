// Calls to the Asana REST API with the user's personal access token.

import type { Item } from "@backslash/api";
import { API, asanaError, AuthError, pickWorkspace, setupItem, tokenOf, type Workspace } from "./lib.ts";

export interface Session {
  token: string;
  workspace: Workspace;
  me: { gid: string; name: string };
}

export async function asana<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify({ data: options.body }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Asana is unreachable: ${(e as Error).message}`);
  }
  const json = await res.json().catch(() => undefined) as { data?: T } | undefined;
  if (!res.ok) throw asanaError(res.status, json);
  return json?.data as T;
}

/** Follows `next_page.offset`, up to `max` results. */
export async function paged<T>(token: string, path: string, max: number, signal?: AbortSignal): Promise<T[]> {
  const out: T[] = [];
  let offset = "";
  do {
    const sep = path.includes("?") ? "&" : "?";
    const res = await fetch(`${API}${path}${sep}limit=100${offset ? `&offset=${encodeURIComponent(offset)}` : ""}`, {
      signal,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    }).catch((e) => {
      if ((e as Error).name === "AbortError") throw e;
      throw new Error(`Asana is unreachable: ${(e as Error).message}`);
    });
    const json = await res.json().catch(() => undefined) as
      | { data?: T[]; next_page?: { offset?: string } | null }
      | undefined;
    if (!res.ok) throw asanaError(res.status, json);
    out.push(...(json?.data ?? []));
    offset = json?.next_page?.offset ?? "";
  } while (offset && out.length < max);
  return out;
}

// One process serves the views of a command: ask who I am once.
let cached: { key: string; session: Session } | undefined;

/** The token, the workspace from the preferences and who I am. */
export async function session(prefs: Record<string, unknown>, signal?: AbortSignal): Promise<Session> {
  const token = tokenOf(prefs);
  const key = `${token}\n${String(prefs.workspace ?? "")}`;
  if (cached?.key === key) return cached.session;
  const me = await asana<{ gid: string; name: string; workspaces: Workspace[] }>(
    token,
    "/users/me?opt_fields=name,workspaces.name,workspaces.is_organization",
    { signal },
  );
  const s = { token, me: { gid: me.gid, name: me.name }, workspace: pickWorkspace(me.workspaces, prefs.workspace) };
  cached = { key, session: s };
  return s;
}

export async function guarded(
  prefs: Record<string, unknown>,
  load: (s: Session) => Promise<Item[]>,
  signal?: AbortSignal,
): Promise<Item[]> {
  try {
    return await load(await session(prefs, signal));
  } catch (e) {
    if (e instanceof AuthError) return [setupItem(e)];
    throw e;
  }
}

export const TASK_FIELDS = [
  "name",
  "notes",
  "completed",
  "due_on",
  "due_at",
  "start_on",
  "permalink_url",
  "modified_at",
  "num_subtasks",
  "num_likes",
  "projects.name",
  "projects.color",
  "tags.name",
  "tags.color",
  "memberships.project.name",
  "memberships.section.name",
].join(",");

export const PROJECT_FIELDS = [
  "name",
  "color",
  "notes",
  "permalink_url",
  "due_on",
  "modified_at",
  "owner.name",
  "team.name",
  "current_status_update.status_type",
  "current_status_update.title",
].join(",");
