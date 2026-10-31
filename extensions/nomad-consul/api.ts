// The Nomad and Consul HTTP APIs, on this computer, the local network or Tailscale.

import { Icons, type Item, open } from "@backslash/api";
import {
  type AllocStub,
  type Check,
  type ConsulService,
  fromCatalog,
  fromUiServices,
  type JobStub,
  type ServiceEntry,
  type UiService,
} from "./lib.ts";

/** As declared in `[permissions] net` (kept equal by a test). */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.internal",
  "*.consul",
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

/** `nomad.lan:4646/ui/jobs` → `http://nomad.lan:4646`. */
export function normalizeUrl(input: unknown, fallback = ""): string {
  let url = String(input ?? "").trim() || fallback;
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "").replace(/\/(ui|v1)(\/.*)?$/, "");
}

export class SetupError extends Error {}

export interface Service {
  name: "Nomad" | "Consul";
  url: string;
  token: string;
  /** Nomad: the namespace to list (`*` for all). Consul: the datacenter. */
  scope: string;
}

function env(name: string): string {
  try {
    return Deno.env.get(name) ?? "";
  } catch {
    return "";
  }
}

function checked(s: Service, raw: unknown): Service {
  let host: string;
  try {
    host = new URL(s.url).hostname;
  } catch {
    throw new SetupError(`“${raw}” is not an address: fix the ${s.name} address in Settings`);
  }
  if (!isAllowedHost(host)) {
    throw new SetupError(`${host} is outside the networks this extension may reach (local network, Tailscale)`);
  }
  return s;
}

/** The preferences, then NOMAD_ADDR / NOMAD_TOKEN / NOMAD_NAMESPACE, then the local agent. */
export function nomadConfig(p: Record<string, unknown>): Service {
  const raw = String(p.nomadAddress ?? "").trim() || env("NOMAD_ADDR");
  return checked({
    name: "Nomad",
    url: normalizeUrl(raw, "http://127.0.0.1:4646"),
    token: String(p.nomadToken ?? "").trim() || env("NOMAD_TOKEN"),
    scope: String(p.nomadNamespace ?? "").trim() || env("NOMAD_NAMESPACE") || "*",
  }, raw);
}

/** The preferences, then CONSUL_HTTP_ADDR / CONSUL_HTTP_TOKEN, then the local agent. */
export function consulConfig(p: Record<string, unknown>): Service {
  const raw = String(p.consulAddress ?? "").trim() || env("CONSUL_HTTP_ADDR");
  return checked({
    name: "Consul",
    url: normalizeUrl(raw, "http://127.0.0.1:8500"),
    token: String(p.consulToken ?? "").trim() || env("CONSUL_HTTP_TOKEN"),
    scope: String(p.consulDatacenter ?? "").trim(),
  }, raw);
}

/** Why a request failed, from the cause Deno attaches to "fetch failed". */
const message = (e: unknown): string => {
  const cause = (e as { cause?: unknown })?.cause;
  const text = `${e instanceof Error ? e.message : String(e)} ${cause instanceof Error ? cause.message : ""}`;
  if (/Connection refused|ECONNREFUSED/i.test(text)) return "nothing answers there";
  if (/dns error|failed to lookup|not known|ENOTFOUND/i.test(text)) return "the name doesn't resolve";
  if (/certificate|UnknownIssuer|tls handshake|ssl/i.test(text)) {
    return "its TLS certificate isn't trusted by this computer";
  }
  if (/timed out|timeout/i.test(text)) return "it doesn't answer in time";
  return text.replace(/^fetch failed\s*/, "").trim() || "unknown error";
};

export async function call<T = any>(
  s: Service,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal; text?: boolean; quiet404?: boolean } = {},
): Promise<T> {
  const url = `${s.url}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: o.method ?? "GET",
      signal: o.signal,
      headers: {
        ...(s.token ? { [s.name === "Nomad" ? "X-Nomad-Token" : "X-Consul-Token"]: s.token } : {}),
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(url).host} is outside the networks this extension may reach`);
    }
    throw new SetupError(`Can't reach ${s.name} at ${new URL(url).host}: ${message(e)}`);
  }
  const text = await res.text();
  if (res.status === 401 || res.status === 403) {
    throw new SetupError(
      s.token
        ? `${s.name} refused the token (${text.trim().slice(0, 80) || res.status}): check it in Settings`
        : `${s.name} needs an ACL token: add one in Settings`,
    );
  }
  if (!res.ok) {
    if (res.status === 404 && o.quiet404) return undefined as T;
    throw new Error(`${s.name} answered ${res.status}${text.trim() ? `: ${text.trim().slice(0, 200)}` : ""}`);
  }
  if (o.text) return text as T;
  return (text ? JSON.parse(text) : undefined) as T;
}

const q = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]);
  return p.size ? `?${p}` : "";
};

// ---------------------------------------------------------------------------
// Nomad

export const nomadJobs = (s: Service, signal?: AbortSignal) =>
  call<JobStub[]>(s, `/v1/jobs${q({ namespace: s.scope })}`, { signal });

/** Every allocation of the namespace(s), without their resources (smaller). */
export const nomadAllocations = (s: Service, signal?: AbortSignal) =>
  call<AllocStub[]>(s, `/v1/allocations${q({ namespace: s.scope, resources: "false" })}`, { signal });

export const jobAllocations = (s: Service, job: JobStub, signal?: AbortSignal) =>
  call<AllocStub[]>(
    s,
    `/v1/job/${encodeURIComponent(job.ID)}/allocations${q({ namespace: job.Namespace, all: "true" })}`,
    { signal },
  );

/** The end of a task's stdout or stderr (the last 64 KB). */
export function allocLogs(s: Service, alloc: AllocStub, task: string, type: "stdout" | "stderr") {
  return call<string>(
    s,
    `/v1/client/fs/logs/${alloc.ID}${
      q({ task, type, origin: "end", offset: "65536", plain: "true", namespace: alloc.Namespace })
    }`,
    { text: true },
  );
}

export const evaluateJob = (s: Service, job: JobStub) =>
  call(s, `/v1/job/${encodeURIComponent(job.ID)}/evaluate${q({ namespace: job.Namespace })}`, {
    method: "POST",
    body: { JobID: job.ID, EvalOptions: { ForceReschedule: true } },
  });

export const forcePeriodic = (s: Service, job: JobStub) =>
  call(s, `/v1/job/${encodeURIComponent(job.ID)}/periodic/force${q({ namespace: job.Namespace })}`, {
    method: "POST",
  });

export const stopJob = (s: Service, job: JobStub) =>
  call(s, `/v1/job/${encodeURIComponent(job.ID)}${q({ namespace: job.Namespace })}`, { method: "DELETE" });

/** Starts a stopped job again: its last version, registered with Stop unset. */
export async function startJob(s: Service, job: JobStub): Promise<void> {
  const ns = q({ namespace: job.Namespace });
  const spec = await call<Record<string, unknown>>(s, `/v1/job/${encodeURIComponent(job.ID)}${ns}`);
  await call(s, `/v1/job/${encodeURIComponent(job.ID)}${ns}`, {
    method: "POST",
    body: { Job: { ...spec, Stop: false } },
  });
}

export const restartAlloc = (s: Service, a: AllocStub) =>
  call(s, `/v1/client/allocation/${a.ID}/restart${q({ namespace: a.Namespace })}`, {
    method: "POST",
    body: { AllTasks: true },
  });

/** Stops an allocation: the scheduler places a new one. */
export const stopAlloc = (s: Service, a: AllocStub) =>
  call(s, `/v1/allocation/${a.ID}/stop${q({ namespace: a.Namespace })}`, { method: "POST" });

export function nomadJobUrl(s: Service, job: JobStub): string {
  const ns = job.Namespace ?? "default";
  return `${s.url}/ui/jobs/${encodeURIComponent(job.ID)}${ns === "default" ? "" : `@${encodeURIComponent(ns)}`}`;
}

export const nomadAllocUrl = (s: Service, a: AllocStub, task?: string) =>
  `${s.url}/ui/allocations/${a.ID}${task ? `/${encodeURIComponent(task)}/logs` : ""}`;

// ---------------------------------------------------------------------------
// Consul

/**
 * The services with their check counts. The Consul UI's endpoint has
 * everything in one call; older or locked-down agents get the catalog and
 * the checks instead.
 */
export async function consulServices(s: Service, signal?: AbortSignal): Promise<ConsulService[]> {
  const dc = q({ dc: s.scope });
  const ui = await call<UiService[] | undefined>(s, `/v1/internal/ui/services${dc}`, { signal, quiet404: true })
    .catch((e) => {
      if (e instanceof SetupError || signal?.aborted) throw e;
      return undefined;
    });
  if (Array.isArray(ui)) return fromUiServices(ui.filter((x) => x.Kind !== "connect-proxy"));
  const [catalog, checks] = await Promise.all([
    call<Record<string, string[] | null>>(s, `/v1/catalog/services${dc}`, { signal }),
    call<Check[]>(s, `/v1/health/state/any${dc}`, { signal }),
  ]);
  return fromCatalog(catalog, checks);
}

/** Checks that are not passing, node checks included. */
export const consulProblems = (s: Service, signal?: AbortSignal) =>
  call<Check[]>(s, `/v1/health/state/critical${q({ dc: s.scope })}`, { signal });

export const serviceInstances = (s: Service, name: string, signal?: AbortSignal) =>
  call<ServiceEntry[]>(s, `/v1/health/service/${encodeURIComponent(name)}${q({ dc: s.scope })}`, { signal });

/** The datacenter of the agent, for the UI's links. */
export async function datacenter(s: Service, signal?: AbortSignal): Promise<string> {
  if (s.scope) return s.scope;
  const self = await call<{ Config?: { Datacenter?: string } }>(s, "/v1/agent/self", { signal }).catch(() => undefined);
  return self?.Config?.Datacenter ?? "dc1";
}

export const consulServiceUrl = (s: Service, dc: string, name: string) =>
  `${s.url}/ui/${encodeURIComponent(dc)}/services/${encodeURIComponent(name)}/instances`;

// ---------------------------------------------------------------------------

export function setupItem(error: SetupError, which: "Nomad" | "Consul"): Item {
  const nomad = which === "Nomad";
  return {
    id: "setup",
    title: error.message,
    subtitle: "Settings → Extensions → Nomad & Consul → Configure",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        `## Connect ${which}`,
        "",
        nomad
          ? "- **Nomad address**, like `http://nomad.lan:4646` (default: `NOMAD_ADDR`, then `http://127.0.0.1:4646`);"
          : "- **Consul address**, like `http://consul.lan:8500` (default: `CONSUL_HTTP_ADDR`, then `http://127.0.0.1:8500`);",
        nomad
          ? "- a **token** when ACLs are on (`nomad acl token self` shows yours; a policy with `read-job` and `read-logs` is enough to look, `submit-job` and `alloc-lifecycle` to stop or restart);"
          : "- a **token** when ACLs are on, with `service:read` and `node:read`;",
        "",
        "Addresses on this computer, your local network or Tailscale (`*.ts.net`, `100.x`) can be reached.",
      ].join("\n"),
    },
    actions: [
      open(
        nomad
          ? "https://developer.hashicorp.com/nomad/tutorials/access-control/access-control-tokens"
          : "https://developer.hashicorp.com/consul/docs/security/acl/tokens",
        "ACL Tokens Help",
        { icon: Icons.key },
      ),
    ],
  };
}
