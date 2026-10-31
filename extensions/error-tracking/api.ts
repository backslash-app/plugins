// The four services' web APIs: listing unresolved errors, resolving and ignoring them.

import {
  type BugsnagProject,
  fromBugsnag,
  fromGlitchtip,
  fromHoneybadger,
  fromRollbar,
  type HoneybadgerProject,
  type Issue,
  type Service,
  SERVICES,
} from "./lib.ts";

/**
 * As declared in `[permissions] net` (kept equal by a test): the hosted services,
 * and a GlitchTip on this computer, the local network or Tailscale.
 */
export const HOSTS = [
  "app.glitchtip.com",
  "api.rollbar.com",
  "app.honeybadger.io",
  "eu-app.honeybadger.io",
  "api.bugsnag.com",
  "localhost",
  "127.0.0.1",
  "*.local",
  "*.lan",
  "*.home.arpa",
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

/** `glitchtip.lan:8000/acme/issues` → `http://glitchtip.lan:8000`; empty → the hosted app. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "https://app.glitchtip.com";
  if (!/^https?:\/\//i.test(url)) {
    url = `${
      /^(localhost|\d+\.\d+\.\d+\.\d+|[^/:]+\.(lan|local|home\.arpa))([:/]|$)/.test(url) ? "http" : "https"
    }://${url}`;
  }
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/** `https://app.glitchtip.com/acme/issues` or `acme` → `acme`. */
export function normalizeOrg(input: unknown): string {
  const text = String(input ?? "").trim();
  const path = /^https?:\/\/[^/]+\/([^/?#]+)/.exec(text);
  return (path ? path[1] : text).replace(/^\/+|\/+$/g, "");
}

export class SetupError extends Error {}

export interface Config {
  glitchtip?: { base: string; org: string; token: string };
  rollbar?: { token: string; project?: string };
  honeybadger?: { host: string; token: string };
  bugsnag?: { token: string };
}

const text = (v: unknown) => String(v ?? "").trim();

export function config(p: Record<string, unknown>): Config {
  const c: Config = {};
  if (text(p.glitchtipToken)) {
    const base = normalizeUrl(p.glitchtipUrl);
    const org = normalizeOrg(p.glitchtipOrg);
    if (!org) throw new SetupError("Add your GlitchTip organization slug");
    const host = new URL(base).hostname;
    if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`);
    c.glitchtip = { base, org, token: text(p.glitchtipToken) };
  }
  if (text(p.rollbarToken)) c.rollbar = { token: text(p.rollbarToken), project: text(p.rollbarProject) || undefined };
  if (text(p.honeybadgerToken)) {
    const eu = /^eu/i.test(text(p.honeybadgerRegion));
    c.honeybadger = { host: eu ? "eu-app.honeybadger.io" : "app.honeybadger.io", token: text(p.honeybadgerToken) };
  }
  if (text(p.bugsnagToken)) c.bugsnag = { token: text(p.bugsnagToken) };
  if (!Object.keys(c).length) throw new SetupError("Connect GlitchTip, Rollbar, Honeybadger or Bugsnag");
  return c;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function call<T>(
  service: Service,
  url: string,
  init: { method?: string; headers: Record<string, string>; body?: unknown; signal?: AbortSignal },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: init.method ?? "GET",
      signal: init.signal,
      headers: {
        Accept: "application/json",
        ...init.headers,
        ...(init.body ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(url).host} is outside the networks this extension may reach`);
    }
    throw new Error(`Can't reach ${SERVICES[service].title} at ${new URL(url).host}: ${message(e)}`);
  }
  const name = SERVICES[service].title;
  if (res.status === 401) {
    await res.body?.cancel();
    throw new SetupError(`${name} refused the token: check it in the extension's preferences`);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => undefined) as Record<string, unknown> | undefined;
  if (!res.ok) {
    const detail = [body?.detail, body?.message, body?.errors].find((d) => typeof d === "string") as string | undefined;
    if (res.status === 403) {
      throw new Error(`${name} refused it${detail ? `: ${detail}` : ""} (check the token's scopes)`);
    }
    throw new Error(`${name} answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return body as T;
}

// ---------------------------------------------------------------------------
// GlitchTip

const glitchtipHeaders = (c: NonNullable<Config["glitchtip"]>) => ({ Authorization: `Bearer ${c.token}` });

async function glitchtip(c: NonNullable<Config["glitchtip"]>, signal?: AbortSignal): Promise<Issue[]> {
  const params = new URLSearchParams({ query: "is:unresolved", limit: "50" });
  const body = await call<unknown>("glitchtip", `${c.base}/api/0/organizations/${c.org}/issues/?${params}`, {
    headers: glitchtipHeaders(c),
    signal,
  });
  return fromGlitchtip(body, c.base, c.org);
}

// ---------------------------------------------------------------------------
// Rollbar

async function rollbar(c: NonNullable<Config["rollbar"]>, signal?: AbortSignal): Promise<Issue[]> {
  const body = await call<{ err?: number; message?: string }>(
    "rollbar",
    "https://api.rollbar.com/api/1/items?status=active",
    {
      headers: { "X-Rollbar-Access-Token": c.token },
      signal,
    },
  );
  if (body?.err) throw new Error(`Rollbar: ${body.message ?? "error"}`);
  return fromRollbar(body, c.project);
}

// ---------------------------------------------------------------------------
// Honeybadger

const honeybadgerHeaders = (c: NonNullable<Config["honeybadger"]>) => ({
  Authorization: `Basic ${btoa(`${c.token}:`)}`,
});

async function honeybadger(c: NonNullable<Config["honeybadger"]>, signal?: AbortSignal): Promise<Issue[]> {
  const base = `https://${c.host}/v2`;
  const projects = (await call<{ results?: HoneybadgerProject[] }>("honeybadger", `${base}/projects`, {
    headers: honeybadgerHeaders(c),
    signal,
  }))?.results ?? [];
  const open = projects.filter((p) => p.unresolved_fault_count === undefined || p.unresolved_fault_count > 0)
    .slice(0, 20);
  const lists = await Promise.all(open.map(async (p) => {
    const params = new URLSearchParams({ q: "-is:resolved -is:ignored", order: "recent", limit: "25" });
    const body = await call<unknown>("honeybadger", `${base}/projects/${p.id}/faults?${params}`, {
      headers: honeybadgerHeaders(c),
      signal,
    });
    return fromHoneybadger(body, p);
  }));
  return lists.flat();
}

// ---------------------------------------------------------------------------
// Bugsnag

const bugsnagHeaders = (c: NonNullable<Config["bugsnag"]>) => ({ Authorization: `token ${c.token}`, "X-Version": "2" });

async function bugsnag(c: NonNullable<Config["bugsnag"]>, signal?: AbortSignal): Promise<Issue[]> {
  const base = "https://api.bugsnag.com";
  const orgs = (await call<{ id: string }[]>("bugsnag", `${base}/user/organizations`, {
    headers: bugsnagHeaders(c),
    signal,
  })) ?? [];
  const projects = (await Promise.all(
    orgs.map((o) =>
      call<BugsnagProject[]>("bugsnag", `${base}/organizations/${o.id}/projects?per_page=100`, {
        headers: bugsnagHeaders(c),
        signal,
      })
    ),
  )).flat().filter((p) => p && (p.open_error_count === undefined || p.open_error_count > 0)).slice(0, 20);
  const lists = await Promise.all(projects.map(async (p) => {
    const params = new URLSearchParams([
      ["filters[error.status][][type]", "eq"],
      ["filters[error.status][][value]", "open"],
      ["sort", "last_seen"],
      ["direction", "desc"],
      ["per_page", "25"],
    ]);
    const body = await call<unknown>("bugsnag", `${base}/projects/${p.id}/errors?${params}`, {
      headers: bugsnagHeaders(c),
      signal,
    });
    return fromBugsnag(body, p);
  }));
  return lists.flat();
}

// ---------------------------------------------------------------------------

export interface Loaded {
  service: Service;
  issues: Issue[];
  error?: string;
}

/** Each configured service, as it answers. */
export async function* load(c: Config, signal?: AbortSignal): AsyncGenerator<Loaded[]> {
  const jobs: [Service, () => Promise<Issue[]>][] = [];
  if (c.glitchtip) jobs.push(["glitchtip", () => glitchtip(c.glitchtip!, signal)]);
  if (c.rollbar) jobs.push(["rollbar", () => rollbar(c.rollbar!, signal)]);
  if (c.honeybadger) jobs.push(["honeybadger", () => honeybadger(c.honeybadger!, signal)]);
  if (c.bugsnag) jobs.push(["bugsnag", () => bugsnag(c.bugsnag!, signal)]);
  const pending = new Map(jobs.map(([service, run]) => [
    service,
    run().then(
      (issues): Loaded => ({ service, issues }),
      (e): Loaded => {
        if (signal?.aborted) throw e;
        return { service, issues: [], error: message(e) };
      },
    ),
  ]));
  const done: Loaded[] = [];
  while (pending.size) {
    const loaded = await Promise.race(pending.values());
    pending.delete(loaded.service);
    done.push(loaded);
    yield [...done];
  }
}

export type Triage = "resolve" | "ignore";

export async function triage(c: Config, i: Issue, what: Triage): Promise<void> {
  switch (i.service) {
    case "glitchtip": {
      const g = c.glitchtip!;
      const status = what === "resolve" ? "resolved" : "ignored";
      try {
        await call("glitchtip", `${g.base}/api/0/organizations/${g.org}/issues/?id=${encodeURIComponent(i.id)}`, {
          method: "PUT",
          headers: glitchtipHeaders(g),
          body: { status },
        });
      } catch (e) {
        if (!/answered (404|405)/.test(message(e))) throw e;
        await call("glitchtip", `${g.base}/api/0/issues/${encodeURIComponent(i.id)}/`, {
          method: "PUT",
          headers: glitchtipHeaders(g),
          body: { status },
        });
      }
      return;
    }
    case "rollbar":
      await call("rollbar", `https://api.rollbar.com/api/1/item/${i.id}`, {
        method: "PATCH",
        headers: { "X-Rollbar-Access-Token": c.rollbar!.token },
        body: { status: what === "resolve" ? "resolved" : "muted" },
      });
      return;
    case "honeybadger":
      await call("honeybadger", `https://${c.honeybadger!.host}/v2/projects/${i.projectId}/faults/${i.id}`, {
        method: "PUT",
        headers: honeybadgerHeaders(c.honeybadger!),
        body: { fault: what === "resolve" ? { resolved: true } : { ignored: true } },
      });
      return;
    case "bugsnag":
      await call("bugsnag", `https://api.bugsnag.com/projects/${i.projectId}/errors/${i.id}`, {
        method: "PATCH",
        headers: bugsnagHeaders(c.bugsnag!),
        body: { operation: what === "resolve" ? "fix" : "ignore" },
      });
      return;
  }
}
