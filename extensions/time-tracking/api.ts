// The four backends behind one interface: Toggl Track, Clockify, Timewarrior and Kimai.

import { exec, storage } from "@backslash/api";
import {
  type BackendId,
  BACKENDS,
  chooseBackend,
  clockifyBody,
  type ClockifyEntry,
  type ClockifyProject,
  clockifyProjects,
  type Entry,
  fromClockify,
  fromKimai,
  fromToggl,
  isAllowedHost,
  type KimaiActivity,
  kimaiBody,
  kimaiChoices,
  type KimaiProject,
  type KimaiTimesheet,
  localIso,
  normalizeUrl,
  parseTimew,
  type Project,
  type StartRequest,
  timewStartArgs,
  timewTags,
  togglBody,
  type TogglEntry,
  type TogglProject,
  togglProjects,
  utcIso,
} from "./lib.ts";

/** Something the user fixes in the preferences or by installing a tool. */
export class SetupError extends Error {}

export interface Backend {
  id: BackendId;
  name: string;
  /** Entries started since `since`, the running one included. */
  entries(since: Date, signal?: AbortSignal): Promise<Entry[]>;
  /** The running entry, if any. */
  current(signal?: AbortSignal): Promise<Entry | undefined>;
  /** What a timer can be started on (projects, Kimai activities, Timewarrior tags). */
  projects(signal?: AbortSignal): Promise<Project[]>;
  start(r: StartRequest): Promise<void>;
  stop(e: Entry): Promise<void>;
  remove(e: Entry): Promise<void>;
  /** Starts a new entry like `e`. */
  resume(e: Entry): Promise<void>;
  /** A page of the service for the entries, if it has one. */
  webUrl?: string;
}

async function call<T>(
  service: string,
  url: string,
  headers: Record<string, string>,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        ...headers,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if (e instanceof Deno.errors.NotCapable || (e as Error).name === "NotCapable") {
      throw new SetupError(`${service} is at a host this extension may not reach: ${new URL(url).host}`);
    }
    throw new Error(`${service} is unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new SetupError(`${service} refused the credentials: check them in Settings → Extensions → Time Tracking`);
  }
  if (res.status === 429) throw new Error(`${service} rate limit reached: try again in a minute`);
  if (!res.ok) {
    let message = text.slice(0, 200);
    try {
      const j = JSON.parse(text);
      message = j.message ?? j.error ?? message;
      if (typeof message !== "string") message = JSON.stringify(message);
    } catch {
      // plain text error
    }
    throw new Error(`${service} answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as T;
  }
}

/** Projects change rarely: kept a day, so the Start list shows them at once. */
async function cached(key: string, load: () => Promise<Project[]>, maxAge = 86_400_000): Promise<Project[]> {
  const saved = await storage.get<{ at: number; value: Project[] }>(key).catch(() => undefined);
  if (saved && Date.now() - saved.at < maxAge) return saved.value;
  const value = await load();
  await storage.set(key, { at: Date.now(), value }).catch(() => {});
  return value;
}

export async function cachedProjects(b: Backend): Promise<Project[] | undefined> {
  const saved = await storage.get<{ at: number; value: Project[] }>(`projects:${b.id}`).catch(() => undefined);
  return saved?.value;
}

export async function forgetProjects(b: Backend): Promise<void> {
  await storage.delete(`projects:${b.id}`).catch(() => {});
}

// ---------------------------------------------------------------------------

function toggl(token: string): Backend {
  const base = "https://api.track.toggl.com/api/v9";
  const headers = { Authorization: `Basic ${btoa(`${token}:api_token`)}` };
  const get = <T>(path: string, signal?: AbortSignal) => call<T>("Toggl Track", `${base}${path}`, headers, { signal });
  const send = (method: string, path: string, body?: unknown) =>
    call<unknown>("Toggl Track", `${base}${path}`, headers, { method, body });
  let me: Promise<{ default_workspace_id: number }> | undefined;
  const workspace = async () => (await (me ??= get<{ default_workspace_id: number }>("/me"))).default_workspace_id;
  const b: Backend = {
    id: "toggl",
    name: BACKENDS.toggl,
    webUrl: "https://track.toggl.com/timer",
    projects: (signal) =>
      cached("projects:toggl", async () => {
        const [projects, clients] = await Promise.all([
          get<TogglProject[] | null>("/me/projects", signal),
          get<{ id: number; name: string }[] | null>("/me/clients", signal).catch(() => []),
        ]);
        return togglProjects(projects ?? [], clients ?? []);
      }),
    async entries(since, signal) {
      const end = new Date(Date.now() + 86_400_000);
      const [list, projects] = await Promise.all([
        get<TogglEntry[]>(
          `/me/time_entries?meta=true&start_date=${encodeURIComponent(utcIso(since))}&end_date=${
            encodeURIComponent(utcIso(end))
          }`,
          signal,
        ),
        b.projects(signal).catch(() => []),
      ]);
      const out = (list ?? []).map((e) => fromToggl(e, projects));
      // The running entry is missing from the range on some accounts: ask for it too.
      if (!out.some((e) => !e.stop)) {
        const running = await b.current(signal);
        if (running && Date.parse(running.start) >= since.getTime()) out.push(running);
      }
      return out;
    },
    async current(signal) {
      const e = await get<TogglEntry | null>("/me/time_entries/current?meta=true", signal);
      if (!e) return undefined;
      const projects = await cachedProjects(b) ?? [];
      return fromToggl(e, projects);
    },
    async start(r) {
      const wid = await workspace();
      await send("POST", `/workspaces/${wid}/time_entries`, togglBody(r, wid));
    },
    async stop(e) {
      await send("PATCH", `/workspaces/${await workspace()}/time_entries/${e.id}/stop`);
    },
    async remove(e) {
      await send("DELETE", `/workspaces/${await workspace()}/time_entries/${e.id}`);
    },
    resume: (e) => b.start({ description: e.description, project: e.project, tags: e.tags, billable: e.billable }),
  };
  return b;
}

// ---------------------------------------------------------------------------

function clockify(key: string): Backend {
  const base = "https://api.clockify.me/api/v1";
  const headers = { "X-Api-Key": key };
  const get = <T>(path: string, signal?: AbortSignal) => call<T>("Clockify", `${base}${path}`, headers, { signal });
  const send = (method: string, path: string, body?: unknown) =>
    call<unknown>("Clockify", `${base}${path}`, headers, { method, body });
  let user: Promise<{ id: string; activeWorkspace: string; defaultWorkspace: string }> | undefined;
  const me = () => user ??= get("/user");
  const ws = async () => {
    const u = await me();
    return u.activeWorkspace || u.defaultWorkspace;
  };
  // Tag names → ids, to resume an entry with its tags.
  const tagIds = async (names: string[]) => {
    if (!names.length) return [];
    const tags = await get<{ id: string; name: string }[]>(`/workspaces/${await ws()}/tags?page-size=500`);
    return names.map((n) => tags.find((t) => t.name === n)?.id).filter((id): id is string => !!id);
  };
  const b: Backend = {
    id: "clockify",
    name: BACKENDS.clockify,
    webUrl: "https://app.clockify.me/tracker",
    projects: (signal) =>
      cached("projects:clockify", async () =>
        clockifyProjects(
          await get<ClockifyProject[]>(`/workspaces/${await ws()}/projects?archived=false&page-size=500`, signal),
        )),
    async entries(since, signal) {
      const u = await me();
      const w = u.activeWorkspace || u.defaultWorkspace;
      const end = new Date(Date.now() + 86_400_000);
      const list = await get<ClockifyEntry[]>(
        `/workspaces/${w}/user/${u.id}/time-entries?hydrated=true&page-size=500&start=${utcIso(since)}&end=${
          utcIso(end)
        }`,
        signal,
      );
      return list.map((e) => fromClockify(e));
    },
    async current(signal) {
      const u = await me();
      const w = u.activeWorkspace || u.defaultWorkspace;
      const list = await get<ClockifyEntry[]>(
        `/workspaces/${w}/user/${u.id}/time-entries?hydrated=true&in-progress=true`,
        signal,
      );
      const running = (Array.isArray(list) ? list : [list]).find((e) => e && !e.timeInterval.end);
      return running ? fromClockify(running) : undefined;
    },
    async start(r) {
      await send("POST", `/workspaces/${await ws()}/time-entries`, clockifyBody(r));
    },
    async stop() {
      const u = await me();
      await send("PATCH", `/workspaces/${u.activeWorkspace || u.defaultWorkspace}/user/${u.id}/time-entries`, {
        end: utcIso(new Date()),
      });
    },
    async remove(e) {
      await send("DELETE", `/workspaces/${await ws()}/time-entries/${e.id}`);
    },
    async resume(e) {
      await send(
        "POST",
        `/workspaces/${await ws()}/time-entries`,
        clockifyBody({ ...e, tagIds: await tagIds(e.tags) }),
      );
    },
  };
  return b;
}

// ---------------------------------------------------------------------------

async function timew(args: string[], signal?: AbortSignal): Promise<string> {
  try {
    return await exec("timew", args, { signal });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new SetupError("Timewarrior is not installed: install the timew package with your package manager");
    }
    throw e;
  }
}

export async function timewInstalled(): Promise<boolean> {
  try {
    await new Deno.Command("timew", { args: ["--version"], stdout: "null", stderr: "null" }).output();
    return true;
  } catch {
    return false;
  }
}

function timewarrior(): Backend {
  const b: Backend = {
    id: "timewarrior",
    name: BACKENDS.timewarrior,
    async entries(since, signal) {
      return parseTimew(await timew(["export", "from", localIso(since)], signal));
    },
    async current(signal) {
      const since = new Date(Date.now() - 7 * 86_400_000);
      const all = parseTimew(await timew(["export", "from", localIso(since)], signal));
      return all.find((e) => !e.stop);
    },
    projects: async (signal) => {
      const since = new Date(Date.now() - 60 * 86_400_000);
      return timewTags(parseTimew(await timew(["export", "from", localIso(since)], signal)));
    },
    async start(r) {
      await timew(timewStartArgs(r));
      // A description with several words is one tag; an annotation keeps it readable too.
      if (r.description.trim() && r.project) await timew(["annotate", "@1", r.description.trim()]).catch(() => {});
    },
    async stop() {
      await timew(["stop"]);
    },
    async remove(e) {
      await timew(["delete", e.id, ":yes"]);
    },
    async resume(e) {
      await timew(["continue", e.id]);
    },
  };
  return b;
}

// ---------------------------------------------------------------------------

function kimai(url: string, token: string): Backend {
  const base = `${url}/api`;
  const headers = { Authorization: `Bearer ${token}` };
  const get = <T>(path: string, signal?: AbortSignal) => call<T>("Kimai", `${base}${path}`, headers, { signal });
  const send = (method: string, path: string, body?: unknown) =>
    call<unknown>("Kimai", `${base}${path}`, headers, { method, body });
  const b: Backend = {
    id: "kimai",
    name: BACKENDS.kimai,
    webUrl: `${url}/en/timesheet/`,
    projects: (signal) =>
      cached("projects:kimai", async () => {
        const [projects, activities] = await Promise.all([
          get<KimaiProject[]>("/projects?visible=1", signal),
          get<KimaiActivity[]>("/activities?visible=1", signal),
        ]);
        return kimaiChoices(projects, activities);
      }),
    async entries(since, signal) {
      const [list, choices] = await Promise.all([
        get<KimaiTimesheet[]>(
          `/timesheets?full=true&size=250&order=DESC&orderBy=begin&begin=${encodeURIComponent(localIso(since))}`,
          signal,
        ),
        b.projects(signal).catch(() => []),
      ]);
      return list.map((t) => fromKimai(t, choices));
    },
    async current(signal) {
      const list = await get<KimaiTimesheet[]>("/timesheets/active", signal);
      return list[0] ? fromKimai(list[0], await cachedProjects(b) ?? []) : undefined;
    },
    async start(r) {
      await send("POST", "/timesheets", kimaiBody(r));
    },
    async stop(e) {
      await send("PATCH", `/timesheets/${e.id}/stop`);
    },
    async remove(e) {
      await send("DELETE", `/timesheets/${e.id}`);
    },
    resume: (e) => b.start({ description: e.description, project: e.project, tags: e.tags }),
  };
  return b;
}

// ---------------------------------------------------------------------------

/** The backend of the preferences, or a SetupError saying what is missing. */
export async function backendOf(prefs: Record<string, unknown>): Promise<Backend> {
  const explicit = String(prefs.backend ?? "").trim();
  const id = chooseBackend(prefs, explicit ? false : await timewInstalled());
  if (!id) {
    if (explicit && explicit.toLowerCase() !== "auto") {
      throw new SetupError(`Unknown backend “${explicit}”: use toggl, clockify, timewarrior or kimai`);
    }
    throw new SetupError("Pick a time tracker: add a Toggl or Clockify key, a Kimai server, or install Timewarrior");
  }
  switch (id) {
    case "toggl": {
      const token = String(prefs.togglToken ?? "").trim();
      if (!token) throw new SetupError("Add your Toggl Track API token");
      return toggl(token);
    }
    case "clockify": {
      const key = String(prefs.clockifyKey ?? "").trim();
      if (!key) throw new SetupError("Add your Clockify API key");
      return clockify(key);
    }
    case "timewarrior":
      return timewarrior();
    case "kimai": {
      const url = normalizeUrl(prefs.kimaiUrl);
      const token = String(prefs.kimaiToken ?? "").trim();
      if (!url || !token) throw new SetupError("Add your Kimai address and API token");
      const host = new URL(url).hostname;
      if (!isAllowedHost(host)) {
        throw new SetupError(
          `${host} is outside the hosts this extension may reach: Kimai Cloud, or a server on your local network or Tailscale`,
        );
      }
      return kimai(url, token);
    }
  }
}

/** Starts a timer, stopping the running one first (as every tracker's own timer does). */
export async function startTimer(b: Backend, r: StartRequest | Entry, resume = false): Promise<void> {
  const running = await b.current().catch(() => undefined);
  if (running && b.id !== "timewarrior") await b.stop(running);
  if (resume) await b.resume(r as Entry);
  else await b.start(r);
}
