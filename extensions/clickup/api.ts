// Calls to the ClickUp API v2 with the user's personal token.

import type { Item } from "@backslash/api";
import {
  API,
  AuthError,
  clickupError,
  type ListRef,
  setupItem,
  type Task,
  type Team,
  tokenOf,
  type User,
} from "./lib.ts";

export async function clickup<T>(
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
        Authorization: token,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`ClickUp is unreachable: ${(e as Error).message}`);
  }
  const json = await res.json().catch(() => undefined);
  if (!res.ok) throw clickupError(res.status, json);
  return json as T;
}

export interface Session {
  token: string;
  me: User;
  teams: Team[];
}

let cached: Session | undefined;

/** Who I am and my workspaces ("teams" in the API), asked once per process. */
export async function session(prefs: Record<string, unknown>, signal?: AbortSignal): Promise<Session> {
  const token = tokenOf(prefs);
  if (cached?.token === token) return cached;
  const [{ user }, { teams }] = await Promise.all([
    clickup<{ user: User }>(token, "/user", { signal }),
    clickup<{ teams: Team[] }>(token, "/team", { signal }),
  ]);
  cached = { token, me: user, teams };
  return cached;
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

/** My tasks in one workspace, page by page (100 each), up to 500. */
export async function myTasks(s: Session, team: Team, closed: boolean, signal?: AbortSignal): Promise<Task[]> {
  const out: Task[] = [];
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({
      page: String(page),
      subtasks: "true",
      include_closed: String(closed),
      order_by: "due_date",
      reverse: "true",
    });
    params.append("assignees[]", String(s.me.id));
    const res = await clickup<{ tasks: Task[]; last_page?: boolean }>(
      s.token,
      `/team/${team.id}/task?${params}`,
      { signal },
    );
    out.push(...res.tasks.map((t) => ({ ...t, team_id: t.team_id ?? team.id })));
    if (res.last_page === true || res.tasks.length < 100) break;
  }
  return out;
}

/** Every list of every space and folder, for the new task form. */
export async function allLists(s: Session): Promise<{ value: string; title: string }[]> {
  const perTeam = await Promise.all(s.teams.map(async (team) => {
    const { spaces } = await clickup<{ spaces: { id: string; name: string }[] }>(
      s.token,
      `/team/${team.id}/space?archived=false`,
    );
    const perSpace = await Promise.all(spaces.map(async (space) => {
      const [folders, loose] = await Promise.all([
        clickup<{ folders: { id: string; name: string; hidden?: boolean; lists: ListRef[] }[] }>(
          s.token,
          `/space/${space.id}/folder?archived=false`,
        ).then((r) => r.folders).catch(() => []),
        clickup<{ lists: ListRef[] }>(s.token, `/space/${space.id}/list?archived=false`)
          .then((r) => r.lists).catch(() => []),
      ]);
      const prefix = s.teams.length > 1 ? `${team.name} › ${space.name}` : space.name;
      return [
        ...loose.map((l) => ({ value: l.id, title: `${prefix} › ${l.name}` })),
        ...folders.flatMap((f) =>
          f.lists.map((l) => ({
            value: l.id,
            title: f.hidden ? `${prefix} › ${l.name}` : `${prefix} › ${f.name} › ${l.name}`,
          }))
        ),
      ];
    }));
    return perSpace.flat();
  }));
  return perTeam.flat();
}
