// Calls to Vikunja's API (v1) with an API token.

import {
  apiDate,
  findLabel,
  findProject,
  isAllowedHost,
  type Label,
  normalizeUrl,
  parseQuickAdd,
  type Project,
  SetupError,
  type Task,
  tasksQuery,
  updated,
  usableProjects,
  vikunjaError,
} from "./lib.ts";

export { SetupError };

export interface Client {
  base: string;
  call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T>;
  /** Every page of a list (Vikunja pages by 50 by default). */
  all<T>(path: string, signal?: AbortSignal): Promise<T[]>;
}

export function client(prefs: Record<string, unknown>): Client {
  const base = normalizeUrl(prefs.url);
  if (!base) throw new SetupError("Add the address of your Vikunja");
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${prefs.url}” is not an address`);
  }
  if (!isAllowedHost(host)) {
    throw new SetupError(
      `${host} is outside the hosts this extension may reach: app.vikunja.cloud, or a server on your network or Tailscale`,
    );
  }
  const token = String(prefs.token ?? "").trim();
  if (!token) throw new SetupError("Add a Vikunja API token");
  const request = async (method: string, path: string, body?: unknown, signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(20_000);
    let res: Response;
    try {
      res = await fetch(`${base}/api/v1${path}`, {
        method,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
        throw new SetupError(`${host} is outside the hosts this extension may reach`);
      }
      throw new Error(`Vikunja is unreachable at ${new URL(base).host}: ${(e as Error).message}`);
    }
    if (!res.ok) throw vikunjaError(res.status, await res.text().catch(() => ""));
    return res;
  };
  return {
    base,
    async call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
      const text = await (await request(method, path, body, signal)).text();
      return (text ? JSON.parse(text) : undefined) as T;
    },
    async all<T>(path: string, signal?: AbortSignal): Promise<T[]> {
      const out: T[] = [];
      const sep = path.includes("?") ? "&" : "?";
      for (let page = 1; page <= 20; page++) {
        const url = /[?&]page=/.test(path) ? path.replace(/([?&]page=)\d+/, `$1${page}`) : `${path}${sep}page=${page}`;
        const res = await request("GET", url, undefined, signal);
        const items = (await res.json() ?? []) as T[];
        out.push(...items);
        const pages = Number(res.headers.get("x-pagination-total-pages") ?? 1);
        if (page >= pages || !items.length) break;
      }
      return out;
    },
  };
}

export const taskUrl = (api: Client, task: Pick<Task, "id">) => `${api.base}/tasks/${task.id}`;

export function projects(api: Client, signal?: AbortSignal): Promise<Project[]> {
  return api.all<Project>("/projects?per_page=50", signal);
}

/** Open tasks across all projects. */
export async function openTasks(api: Client, signal?: AbortSignal): Promise<Task[]> {
  const tasks = await api.all<Task>(`/tasks/all?${tasksQuery(1)}`, signal);
  return tasks.filter((t) => !t.done);
}

export async function everything(api: Client, signal?: AbortSignal) {
  const [all, tasks] = await Promise.all([projects(api, signal), openTasks(api, signal)]);
  return { projects: all, tasks };
}

export async function update(api: Client, task: Task, changes: Partial<Task>): Promise<Task> {
  return await api.call<Task>("POST", `/tasks/${task.id}`, updated(task, changes));
}

/** The project new tasks go to: the preference, the user's default, else the first one. */
export async function defaultProject(api: Client, all: Project[], prefs: Record<string, unknown>): Promise<Project> {
  const usable = usableProjects(all);
  const asked = String(prefs.project ?? "").trim();
  if (asked) {
    const p = findProject(usable, asked);
    if (!p) throw new Error(`No Vikunja project “${asked}”: check Default project in Settings`);
    return p;
  }
  const user = await api.call<{ settings?: { default_project_id?: number } }>("GET", "/user").catch(() => undefined);
  const id = user?.settings?.default_project_id;
  const p = usable.find((x) => x.id === id) ?? usable[0];
  if (!p) throw new Error("You have no Vikunja project to add tasks to: create one first");
  return p;
}

/** Creates a task from quick add magic: labels are created when missing. */
export async function quickAdd(
  api: Client,
  text: string,
  prefs: Record<string, unknown>,
  options: { projects?: Project[]; projectId?: number } = {},
): Promise<{ task: Task; project: Project; summary: string }> {
  const q = parseQuickAdd(text);
  if (!q.title) throw new Error("Type what the task is, not only its date or labels");
  const all = options.projects ?? await projects(api);
  const usable = usableProjects(all);
  let project: Project | undefined;
  if (q.project) {
    project = findProject(usable, q.project);
    if (!project) throw new Error(`No Vikunja project “${q.project}”`);
  } else if (options.projectId) {
    project = usable.find((p) => p.id === options.projectId);
  }
  project ??= await defaultProject(api, all, prefs);
  const task = await api.call<Task>("PUT", `/projects/${project.id}/tasks`, {
    title: q.title,
    ...(q.priority ? { priority: q.priority } : {}),
    ...(q.due ? { due_date: apiDate(q.due) } : {}),
  });
  if (q.labels.length) {
    const known = await api.all<Label>("/labels?per_page=50").catch(() => [] as Label[]);
    for (const name of q.labels) {
      const label = findLabel(known, name) ?? await api.call<Label>("PUT", "/labels", { title: name });
      await api.call("PUT", `/tasks/${task.id}/labels`, { label_id: label.id });
    }
  }
  const when = q.due
    ? ` · due ${q.due.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" })}`
    : "";
  return { task, project, summary: `Added “${q.title}” to ${project.title}${when}` };
}
