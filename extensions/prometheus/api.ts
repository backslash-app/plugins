// HTTP calls to Prometheus (/api/v1) and Alertmanager (/api/v2), with the
// optional basic auth or bearer token, and the rows shown when something is missing.

import { action, copy, Icons, type Item, open, refresh } from "@backslash/api";
import { authHeader, hostAllowed, hostLabel, normalizeUrl, parseUrls } from "./lib.ts";

export class SetupError extends Error {}

export interface Server {
  base: string;
  auth?: string;
  kind: "Prometheus" | "Alertmanager";
}

const authOf = (p: Record<string, unknown>) => authHeader(p.username, p.password, p.token);

function check(base: string) {
  const host = new URL(base).hostname;
  if (!hostAllowed(host)) throw new SetupError(`${host} is not a host this extension may reach`);
}

export function alertmanagers(preferences: Record<string, unknown>): Server[] {
  const urls = parseUrls(preferences.alertmanagerUrl);
  if (!urls.length) throw new SetupError("Add your Alertmanager URL");
  urls.forEach(check);
  return urls.map((base) => ({ base, auth: authOf(preferences), kind: "Alertmanager" }));
}

export function prometheus(preferences: Record<string, unknown>): Server {
  const base = normalizeUrl(preferences.prometheusUrl);
  if (!base) throw new SetupError("Add your Prometheus URL");
  check(base);
  return { base, auth: authOf(preferences), kind: "Prometheus" };
}

/** A JSON call; Prometheus' `{status: "error", error}` bodies become the error message. */
export async function call<T>(
  s: Server,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${s.base}${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: {
        Accept: "application/json",
        ...(s.auth ? { Authorization: s.auth } : {}),
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    if (options.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(s.base).hostname} is not a host this extension may reach`);
    }
    throw new Error(`Cannot reach ${s.kind} at ${hostLabel(s.base)}: ${e instanceof Error ? e.message : e}`);
  }
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (res.status === 401) {
    throw new SetupError(`${s.kind} at ${hostLabel(s.base)} asks for credentials: check the user, password or token`);
  }
  if (res.status === 403) throw new Error(`${s.kind} at ${hostLabel(s.base)} refused the credentials`);
  if (!res.ok || body?.status === "error") {
    // Prometheus: {status, errorType, error}; Alertmanager: a plain string or {message}.
    const message = body?.error ?? body?.message ?? (typeof body === "string" ? body : text.slice(0, 200));
    if (res.status === 404 && !body) {
      throw new SetupError(`${s.base} does not look like ${s.kind}: check the URL (and its sub-path)`);
    }
    throw new Error(String(message || `${s.kind} answered ${res.status}`).trim());
  }
  if (body === undefined && text && res.headers.get("content-type")?.includes("html")) {
    throw new SetupError(`${s.base} answered with a web page: is it the ${s.kind} URL, without a sign-in in front?`);
  }
  return body as T;
}

/** Prometheus wraps everything in `{status, data, warnings}`. */
export async function promData<T>(
  s: Server,
  path: string,
  signal?: AbortSignal,
): Promise<{ data: T; warnings: string[] }> {
  const body = await call<{ data: T; warnings?: string[] }>(s, path, { signal });
  return { data: body?.data, warnings: body?.warnings ?? [] };
}

/** Each Alertmanager in parallel; the ones that fail are reported, the others still shown. */
export async function fromEach<T>(
  servers: Server[],
  load: (s: Server) => Promise<T>,
): Promise<{ results: T[]; errors: { server: Server; error: unknown }[] }> {
  const settled = await Promise.allSettled(servers.map(load));
  const results: T[] = [];
  const errors: { server: Server; error: unknown }[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") results.push(r.value);
    else errors.push({ server: servers[i], error: r.reason });
  });
  if (!results.length && errors.length) throw errors[0].error;
  return { results, errors };
}

const SETUP = [
  "## Connect Prometheus and Alertmanager",
  "",
  "In **Settings → Extensions → Prometheus & Alertmanager → Configure**:",
  "",
  "- **Alertmanager URLs**: one or more, separated by commas (`http://alertmanager.local:9093`).",
  "  The members of an HA cluster can all be listed: their alerts and silences are shown once.",
  "- **Prometheus URL**: `http://prometheus.local:9090`, with its sub-path behind a proxy.",
  "- Behind basic auth, a **user name** and **password**; behind a proxy that takes tokens, a **bearer token**.",
  "",
  "Reachable hosts: this computer, the local network (`*.local`, `*.lan`, `*.home.arpa`, `*.internal`,",
  "private IP addresses, the names `prometheus` and `alertmanager`), Tailscale (`*.ts.net`) and",
  "Grafana Cloud (`*.grafana.net`).",
].join("\n");

export function setupItems(error: SetupError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Prometheus and Alertmanager URLs, and credentials if they need some",
    icon: { source: Icons.settings, tint: "orange" },
    detail: { markdown: SETUP },
    actions: [
      open("https://prometheus.io/docs/alerting/latest/alertmanager/", "Open Alertmanager Docs"),
      open("https://prometheus.io/docs/prometheus/latest/querying/api/", "Open Prometheus API Docs"),
    ],
  }];
}

export function errorItem(error: unknown, server?: Server): Item {
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: `error:${server?.base ?? ""}`,
    title: message.startsWith("Cannot reach")
      ? `${server?.kind ?? "The server"} is unreachable`
      : `${server?.kind ?? "The server"} failed`,
    subtitle: server ? `${hostLabel(server.base)} · ${message}` : message,
    icon: { source: Icons.alert, tint: "red" },
    section: server ? "Errors" : undefined,
    detail: { markdown: `\`\`\`\n${message.replace(/```/g, "ʼʼʼ")}\n\`\`\`` },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...(server ? [open(server.base, `Open ${server.kind}`)] : []),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}

/** Turns a missing preference or a failure into one helpful row. */
export async function guarded(load: () => Promise<Item[]>, signal?: AbortSignal): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e);
    if (signal?.aborted || (e instanceof DOMException && e.name === "AbortError")) throw e;
    return [errorItem(e)];
  }
}
