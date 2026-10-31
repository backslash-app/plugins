// The MongoDB Atlas Admin API (v2): HTTP digest with an API key pair, or a
// service account's client credentials.

import { Icons, type Item, open } from "@backslash/api";
import {
  type AtlasCluster,
  type AtlasClusterRaw,
  type AtlasProject,
  digestHeader,
  parseChallenge,
  parseCluster,
} from "./lib.ts";

export const ATLAS = "https://cloud.mongodb.com";

export class SetupError extends Error {}

export interface Credentials {
  publicKey: string;
  privateKey: string;
  clientId: string;
  clientSecret: string;
}

export function credentials(p: Record<string, unknown>): Credentials | undefined {
  const c = {
    publicKey: String(p.atlasPublicKey ?? "").trim(),
    privateKey: String(p.atlasPrivateKey ?? "").trim(),
    clientId: String(p.atlasClientId ?? "").trim(),
    clientSecret: String(p.atlasClientSecret ?? "").trim(),
  };
  if (c.clientId && c.clientSecret) return c;
  if (c.publicKey && c.privateKey) return c;
  if (c.clientId || c.publicKey) {
    throw new SetupError(c.clientId ? "Add the service account's client secret" : "Add the API key's private key");
  }
  return undefined;
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

// Service account tokens last an hour; kept in memory only.
let bearer: { id: string; token: string; expires: number } | undefined;

async function serviceToken(c: Credentials, signal?: AbortSignal): Promise<string> {
  if (bearer && bearer.id === c.clientId && bearer.expires > Date.now() + 60_000) return bearer.token;
  const res = await fetch(`${ATLAS}/api/oauth/token`, {
    method: "POST",
    signal,
    headers: {
      Authorization: `Basic ${btoa(`${c.clientId}:${c.clientSecret}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (res.status === 400 || res.status === 401) {
    throw new SetupError("Atlas refused the service account: check its client ID and secret in Settings");
  }
  if (!res.ok) throw new Error(`Atlas answered ${res.status} when signing in`);
  const body = await res.json();
  bearer = { id: c.clientId, token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 };
  return bearer.token;
}

function cnonce(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function atlas<T = any>(
  c: Credentials,
  path: string,
  o: { method?: string; body?: unknown; version?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const url = `${ATLAS}/api/atlas/v2${path}`;
  const method = o.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: `application/vnd.atlas.${o.version ?? "2023-02-01"}+json`,
    ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
  };
  const send = (auth?: string) =>
    fetch(url, {
      method,
      signal: o.signal,
      headers: auth ? { ...headers, Authorization: auth } : headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  let res: Response;
  try {
    if (c.clientId) {
      res = await send(`Bearer ${await serviceToken(c, o.signal)}`);
    } else {
      // Digest: the first answer is the challenge.
      res = await send();
      const challenge = parseChallenge(res.headers.get("WWW-Authenticate"));
      if (res.status === 401 && challenge) {
        await res.body?.cancel();
        const u = new URL(url);
        res = await send(digestHeader(challenge, {
          username: c.publicKey,
          password: c.privateKey,
          method,
          uri: `${u.pathname}${u.search}`,
          cnonce: cnonce(),
        }));
      }
    }
  } catch (e) {
    if (o.signal?.aborted || e instanceof SetupError) throw e;
    throw new Error(`Can't reach MongoDB Atlas: ${message(e)}`);
  }
  const text = await res.text();
  let body: any;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (res.status === 401) {
    throw new SetupError("Atlas refused the API key: check the public and private keys in Settings");
  }
  if (res.status === 403) {
    const detail = body?.detail ?? "";
    throw new SetupError(
      /IP address|access list/i.test(detail)
        ? "Atlas refuses this IP address: add it to the API key's access list"
        : `Atlas: ${detail || "the key isn't allowed to do this"}`,
    );
  }
  if (!res.ok) throw new Error(`Atlas answered ${res.status}${body?.detail ? `: ${body.detail}` : ""}`);
  return body as T;
}

/** Every project the key can see, and their clusters (flex ones included). */
export async function clusters(
  c: Credentials,
  signal?: AbortSignal,
): Promise<{ list: AtlasCluster[]; errors: string[] }> {
  const projects = await atlas<{ results: AtlasProject[] }>(c, "/groups?itemsPerPage=500", {
    version: "2023-01-01",
    signal,
  });
  const errors: string[] = [];
  const all = await Promise.all(projects.results.map(async (p) => {
    const [dedicated, flex] = await Promise.all([
      atlas<{ results: AtlasClusterRaw[] }>(c, `/groups/${p.id}/clusters?itemsPerPage=500`, { signal })
        .catch((e) => {
          if (signal?.aborted) throw e;
          errors.push(`${p.name}: ${message(e)}`);
          return { results: [] };
        }),
      // Older keys or regions may not know flex clusters yet.
      atlas<{ results: AtlasClusterRaw[] }>(c, `/groups/${p.id}/flexClusters?itemsPerPage=500`, {
        version: "2024-11-13",
        signal,
      }).catch(() => ({ results: [] })),
    ]);
    const names = new Set(dedicated.results.map((r) => r.name));
    return [
      ...dedicated.results.map((r) => parseCluster(p, r)),
      ...flex.results.filter((r) => !names.has(r.name)).map((r) => parseCluster(p, r, true)),
    ];
  }));
  return { list: all.flat(), errors };
}

export const setPaused = (c: Credentials, cluster: AtlasCluster, paused: boolean) =>
  atlas(c, `/groups/${cluster.project.id}/clusters/${encodeURIComponent(cluster.name)}`, {
    method: "PATCH",
    body: { paused },
  });

export function setupItem(error?: SetupError): Item {
  return {
    id: "setup",
    title: error?.message ?? "Connect MongoDB Atlas",
    subtitle: "Settings → Extensions → MongoDB → Configure",
    icon: { source: error ? Icons.alert : Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect MongoDB Atlas",
        "",
        "Either:",
        "",
        "- a **service account** (Organization → Access Manager → Service Accounts): its client ID and secret;",
        "- or an **API key** (Access Manager → API Keys): its public and private keys.",
        "",
        "**Project Read Only** lists the clusters; **Project Cluster Manager** also pauses and resumes them.",
        "Atlas only accepts the key from the IP addresses on its access list.",
      ].join("\n"),
    },
    actions: [
      open("https://www.mongodb.com/docs/atlas/configure-api-access/", "Atlas API Access Help", { icon: Icons.key }),
      open(`${ATLAS}/v2#/org`, "Open Atlas"),
    ],
  };
}
