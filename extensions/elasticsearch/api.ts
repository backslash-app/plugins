// The Elasticsearch / OpenSearch REST API: on this computer, the local network,
// Tailscale, or the usual hosted services.

import { Icons, type Item, open } from "@backslash/api";
import {
  type CatAlias,
  type CatIndex,
  type ClusterHealth,
  errorReason,
  INDEX_COLUMNS,
  type Root,
  searchBody,
  type SearchResponse,
} from "./lib.ts";

/** As declared in `[permissions] net` (kept equal by a test). */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.internal",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
  "*.cloud.es.io",
  "*.elastic-cloud.com",
  "*.found.io",
  "*.es.amazonaws.com",
  "*.aivencloud.com",
  "*.bonsaisearch.net",
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

/** `es.lan:9200/` → `http://es.lan:9200`; a path prefix (behind a proxy) is kept. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim() || "http://localhost:9200";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, "");
}

/**
 * The Authorization header: an API key (the "encoded" value, or `id:key`),
 * else user and password. OpenSearch has no API keys.
 */
export function authHeader(p: { apiKey?: unknown; username?: unknown; password?: unknown }): string | undefined {
  const key = String(p.apiKey ?? "").trim();
  if (key) return `ApiKey ${/^[^:]+:[^:]+$/.test(key) ? btoa(key) : key}`;
  const user = String(p.username ?? "").trim();
  if (user) {
    const bytes = new TextEncoder().encode(`${user}:${String(p.password ?? "")}`);
    return `Basic ${btoa(String.fromCharCode(...bytes))}`;
  }
  return undefined;
}

export class SetupError extends Error {}

export interface Config {
  url: string;
  auth?: string;
  showSystem: boolean;
  defaultIndex: string;
}

export function config(p: Record<string, unknown>): Config {
  const url = normalizeUrl(p.address);
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new SetupError(`“${p.address}” is not an address: fix it in Settings`);
  }
  if (!isAllowedHost(host)) {
    throw new SetupError(`${host} is outside the networks this extension may reach`);
  }
  return {
    url,
    auth: authHeader(p),
    showSystem: p.showSystem === true || p.showSystem === "true",
    defaultIndex: String(p.defaultIndex ?? "").trim() || "*",
  };
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

/** Thrown for a 4xx with Elasticsearch's own reason (a bad query, a missing index). */
export class RequestError extends Error {
  constructor(public status: number, reason: string) {
    super(reason);
  }
}

export async function es<T = any>(
  c: Config,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${c.url}${path}`, {
      method: o.method ?? "GET",
      signal: o.signal,
      headers: {
        Accept: "application/json",
        ...(c.auth ? { Authorization: c.auth } : {}),
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    const host = new URL(c.url).host;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${host} is outside the networks this extension may reach`);
    }
    if (message(e).includes("certificate")) {
      throw new SetupError(
        `${host}'s certificate isn't trusted: add its CA (http_ca.crt) to the system's certificates, or use http://`,
      );
    }
    throw new SetupError(`Can't reach ${host}: ${message(e)}`);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = text;
  }
  if (res.status === 401) {
    throw new SetupError(
      c.auth
        ? "The cluster refused the credentials: check them in Settings"
        : "The cluster asks for an API key or a user: add one in Settings",
    );
  }
  if (res.status === 403) {
    throw new RequestError(403, errorReason(body) ?? "The credentials aren't allowed to do this");
  }
  if (!res.ok) {
    throw new RequestError(res.status, errorReason(body) ?? `The cluster answered ${res.status}`);
  }
  return body as T;
}

export const root = (c: Config, signal?: AbortSignal) => es<Root>(c, "/", { signal }).catch(() => undefined);

export const health = (c: Config, signal?: AbortSignal) => es<ClusterHealth>(c, "/_cluster/health", { signal });

export const indices = (c: Config, signal?: AbortSignal) =>
  es<CatIndex[]>(c, `/_cat/indices?format=json&bytes=b&expand_wildcards=all&h=${INDEX_COLUMNS}`, { signal });

export const aliases = (c: Config, signal?: AbortSignal) =>
  es<CatAlias[]>(c, "/_cat/aliases?format=json&expand_wildcards=all", { signal });

export const nodes = (c: Config) =>
  es<Record<string, string>[]>(
    c,
    "/_cat/nodes?format=json&h=name,ip,version,node.role,master,heap.percent,ram.percent,cpu,load_1m,disk.used_percent,uptime",
  );

export const allocationExplain = (c: Config) => es(c, "/_cluster/allocation/explain", { method: "POST" });

export const mapping = (c: Config, index: string) =>
  es<Record<string, unknown>>(c, `/${encodeURIComponent(index)}/_mapping`);

export const search = (c: Config, target: string, query: string, signal?: AbortSignal) =>
  es<SearchResponse>(c, `/${target.split(",").map(encodeURIComponent).join(",")}/_search`, {
    method: "POST",
    body: searchBody(query),
    signal,
  });

export const deleteIndex = (c: Config, index: string) => es(c, `/${encodeURIComponent(index)}`, { method: "DELETE" });

export const refreshIndex = (c: Config, index: string) =>
  es(c, `/${encodeURIComponent(index)}/_refresh`, { method: "POST" });

// ---------------------------------------------------------------------------

export function setupItem(error: SetupError): Item {
  return {
    id: "setup",
    title: error.message,
    subtitle: "Settings → Extensions → Elasticsearch → Configure",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your cluster",
        "",
        "- **Address**, like `http://localhost:9200`, `https://search.lan:9200` or an Elastic Cloud endpoint",
        "  (`https://….es.europe-west1.gcp.cloud.es.io`).",
        "- **API key** (Elasticsearch: Kibana → Stack Management → API keys, the *Encoded* value),",
        "- or a **user and password** (OpenSearch, or Elasticsearch's basic security).",
        "",
        "A read-only key is enough to browse: `monitor` on the cluster, `read` and `view_index_metadata` on indices.",
      ].join("\n"),
    },
    actions: [
      open(
        "https://www.elastic.co/guide/en/elasticsearch/reference/current/security-api-create-api-key.html",
        "API Keys Help",
        { icon: Icons.key },
      ),
    ],
  };
}

/** `curl` for the terminal, without credentials. */
export const curlCommand = (c: Config, path: string) =>
  `curl -s ${
    c.auth ? (c.auth.startsWith("ApiKey") ? `-H "Authorization: ApiKey $ES_API_KEY" ` : '-u "$ES_USER" ') : ""
  }"${c.url}${path}"`;
