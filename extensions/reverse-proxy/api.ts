// Traefik's API (/api, optional basic auth), Caddy's admin API (:2019) and Nginx Proxy Manager (token from email and password).

import { storage } from "@backslash/api";
import {
  type CaddyConfig,
  caddyRoutes,
  type CaddyUpstream,
  type Certificate,
  type NpmCertificate,
  npmCertificates,
  type NpmProxyHost,
  npmRoutes,
  type Route,
  type Source,
  SOURCES,
  type TraefikOverview,
  type TraefikRouter,
  traefikRoutes,
  type TraefikService,
  traefikSummary,
} from "./lib.ts";
import { checkBase, failureDetail, httpClient, request, SetupError } from "./net.ts";

interface Prefs {
  traefikUrl?: string;
  traefikUser?: string;
  traefikPassword?: string;
  caddyUrl?: string;
  npmUrl?: string;
  npmEmail?: string;
  npmPassword?: string;
  certificate?: string;
}

export interface Config {
  traefik?: { base: string; auth?: string };
  caddy?: { base: string };
  npm?: { base: string; email: string; password: string };
  client?: Deno.HttpClient;
}

const basic = (user: string, password: string) =>
  `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(`${user}:${password}`)))}`;

export function config(preferences: Record<string, unknown>): Config {
  const p = preferences as Prefs;
  const c: Config = { client: httpClient(p.certificate) };
  if (String(p.traefikUrl ?? "").trim()) {
    const base = checkBase(p.traefikUrl, "Traefik").replace(/\/(dashboard|api)\/?.*$/, "");
    const user = String(p.traefikUser ?? "").trim();
    c.traefik = { base, auth: user ? basic(user, String(p.traefikPassword ?? "")) : undefined };
  }
  if (String(p.caddyUrl ?? "").trim()) c.caddy = { base: checkBase(p.caddyUrl, "Caddy admin API") };
  if (String(p.npmUrl ?? "").trim()) {
    const email = String(p.npmEmail ?? "").trim(), password = String(p.npmPassword ?? "");
    const base = checkBase(p.npmUrl, "Nginx Proxy Manager");
    if (!email || !password) throw new SetupError("Add your Nginx Proxy Manager email and password", "auth", base);
    c.npm = { base, email, password };
  }
  if (!c.traefik && !c.caddy && !c.npm) throw new SetupError("Connect Traefik, Caddy or Nginx Proxy Manager", "url");
  return c;
}

async function json<T>(res: Response, service: string): Promise<T> {
  if (!res.ok) {
    throw new Error(`${service} answered ${res.status}${(await failureDetail(res)).replace(/^(.)/, ": $1")}`);
  }
  return await res.json() as T;
}

// ---------------------------------------------------------------------------
// Traefik

async function traefikGet<T>(c: Config, path: string, signal?: AbortSignal): Promise<T> {
  const t = c.traefik!;
  const res = await request(`${t.base}/api${path}`, {
    signal,
    client: c.client,
    headers: t.auth ? { Authorization: t.auth } : {},
  }, "Traefik");
  if (res.status === 401 || res.status === 403) {
    throw new SetupError("Traefik refused the user name or password", "auth", t.base);
  }
  if (res.status === 404) {
    throw new SetupError(
      "Traefik's API isn't enabled: set api.insecure=true or route /api to api@internal",
      "unknown",
      t.base,
    );
  }
  return await json<T>(res, "Traefik");
}

/** Traefik pages its lists (100 by default): `?per_page=` takes more. */
async function traefik(c: Config, signal?: AbortSignal): Promise<{ routes: Route[]; summary?: string }> {
  const [routers, services, overview] = await Promise.all([
    traefikGet<TraefikRouter[]>(c, "/http/routers?per_page=1000", signal),
    traefikGet<TraefikService[]>(c, "/http/services?per_page=1000", signal).catch(() => []),
    traefikGet<TraefikOverview>(c, "/overview", signal).catch(() => undefined),
  ]);
  return { routes: traefikRoutes(routers ?? [], services ?? []), summary: traefikSummary(overview) };
}

// ---------------------------------------------------------------------------
// Caddy

async function caddy(c: Config, signal?: AbortSignal): Promise<Route[]> {
  const base = c.caddy!.base;
  const res = await request(`${base}/config/`, { signal, client: c.client }, "Caddy");
  if (res.status === 403) {
    throw new SetupError("Caddy's admin API refused the request: its origin checks only allow localhost", "auth", base);
  }
  const cfg = await json<CaddyConfig | null>(res, "Caddy");
  const ups = await request(`${base}/reverse_proxy/upstreams`, { signal, client: c.client }, "Caddy")
    .then((r) => r.ok ? r.json() as Promise<CaddyUpstream[]> : [])
    .catch(() => []);
  return caddyRoutes(cfg, ups ?? []);
}

// ---------------------------------------------------------------------------
// Nginx Proxy Manager

const NPM_KEY = "npm-token";

async function npmToken(c: Config, fresh = false): Promise<string> {
  const n = c.npm!;
  if (!fresh) {
    const saved = await storage.get<{ base: string; email: string; token: string; expires: number }>(NPM_KEY)
      .catch(() => undefined);
    if (saved && saved.base === n.base && saved.email === n.email && saved.expires > Date.now() + 60_000) {
      return saved.token;
    }
  }
  const res = await request(`${n.base}/api/tokens`, {
    method: "POST",
    client: c.client,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identity: n.email, secret: n.password }),
  }, "Nginx Proxy Manager");
  if (res.status === 400 || res.status === 401 || res.status === 403) {
    throw new SetupError("Nginx Proxy Manager rejected the email or password", "auth", n.base);
  }
  const body = await json<{ token?: string; expires?: string; requires_2fa?: boolean }>(res, "Nginx Proxy Manager");
  if (!body.token) {
    throw new SetupError(
      body.requires_2fa
        ? "This account uses two-factor sign-in: use a user without it"
        : "No token from Nginx Proxy Manager",
      "auth",
      n.base,
    );
  }
  const expires = Date.parse(body.expires ?? "") || Date.now() + 86_400_000;
  await storage.set(NPM_KEY, { base: n.base, email: n.email, token: body.token, expires }).catch(() => {});
  return body.token;
}

export async function npm<T>(
  c: Config,
  path: string,
  init: { method?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const n = c.npm!;
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await npmToken(c, attempt > 0);
    const res = await request(`${n.base}/api${path}`, {
      method: init.method ?? "GET",
      signal: init.signal,
      client: c.client,
      headers: { Authorization: `Bearer ${token}` },
    }, "Nginx Proxy Manager");
    if (res.status === 401 && attempt === 0) {
      await res.body?.cancel();
      continue;
    }
    if (res.status === 403) {
      throw new SetupError("This Nginx Proxy Manager user may not see proxy hosts", "permission", n.base);
    }
    return await json<T>(res, "Nginx Proxy Manager");
  }
  throw new SetupError("Nginx Proxy Manager rejected the session", "auth", n.base);
}

async function npmAll(c: Config, signal?: AbortSignal): Promise<{ routes: Route[]; certificates: Certificate[] }> {
  const [hosts, certs] = await Promise.all([
    npm<NpmProxyHost[]>(c, "/nginx/proxy-hosts?expand=certificate", { signal }),
    npm<NpmCertificate[]>(c, "/nginx/certificates?expand=proxy_hosts", { signal }).catch(() => []),
  ]);
  return { routes: npmRoutes(hosts ?? []), certificates: npmCertificates(certs ?? []) };
}

export const npmAction = (c: Config, path: string) => npm(c, path, { method: "POST" });

// ---------------------------------------------------------------------------

export interface Everything {
  routes: Route[];
  certificates: Certificate[];
  /** Per source, a problem reaching it (others still show). */
  errors: { source: Source; error: Error }[];
  summaries: string[];
}

export async function everything(c: Config, signal?: AbortSignal): Promise<Everything> {
  const out: Everything = { routes: [], certificates: [], errors: [], summaries: [] };
  const fail = (source: Source) => (e: unknown) => {
    if (signal?.aborted) throw e;
    out.errors.push({ source, error: e instanceof Error ? e : new Error(String(e)) });
  };
  await Promise.all([
    c.traefik && traefik(c, signal).then((t) => {
      out.routes.push(...t.routes);
      if (t.summary) out.summaries.push(`Traefik: ${t.summary}`);
    }, fail("traefik")),
    c.caddy && caddy(c, signal).then((r) => void out.routes.push(...r), fail("caddy")),
    c.npm && npmAll(c, signal).then((n) => {
      out.routes.push(...n.routes);
      out.certificates.push(...n.certificates);
    }, fail("npm")),
  ]);
  return out;
}

/** Where to see a route in its own interface. */
export function dashboardUrl(c: Config, r: Route): string | undefined {
  if (r.source === "traefik" && c.traefik) {
    return `${c.traefik.base}/dashboard/#/http/routers/${encodeURIComponent(r.key.slice("traefik:".length))}`;
  }
  if (r.source === "npm" && c.npm) return `${c.npm.base}/nginx/proxy`;
  return undefined;
}

export { SetupError, SOURCES };
