// Traefik, Caddy and Nginx Proxy Manager answers as one list of routes and certificates. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type Source = "traefik" | "caddy" | "npm";

export const SOURCES: Record<Source, string> = { traefik: "Traefik", caddy: "Caddy", npm: "Nginx Proxy Manager" };

export type Health = "error" | "warning" | "ok" | "disabled";

export const HEALTH: Record<Health, { label: string; color: Color }> = {
  error: { label: "Error", color: "red" },
  warning: { label: "Warning", color: "orange" },
  ok: { label: "OK", color: "green" },
  disabled: { label: "Disabled", color: "gray" },
};

export interface CertInfo {
  name: string;
  /** Unix ms. */
  expires?: number;
  provider?: string;
  id?: number;
}

export interface Route {
  /** Unique across sources. */
  key: string;
  source: Source;
  name: string;
  domains: string[];
  paths: string[];
  upstreams: string[];
  health: Health;
  problems: string[];
  tls: boolean;
  entryPoints: string[];
  middlewares: string[];
  provider?: string;
  certResolver?: string;
  cert?: CertInfo;
  /** Nginx Proxy Manager's host id. */
  id?: number;
  /** Caddy: the server block it belongs to. */
  server?: string;
}

export interface Certificate {
  key: string;
  source: Source;
  id: number;
  name: string;
  domains: string[];
  expires?: number;
  provider: string;
  hosts: string[];
}

const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Traefik

export interface TraefikRouter {
  name: string;
  provider?: string;
  status?: string;
  rule?: string;
  service?: string;
  entryPoints?: string[];
  middlewares?: string[];
  priority?: number;
  tls?: { certResolver?: string; domains?: { main?: string; sans?: string[] }[]; options?: string } | null;
  error?: string[];
  using?: string[];
}

export interface TraefikService {
  name: string;
  provider?: string;
  status?: string;
  serverStatus?: Record<string, string>;
  loadBalancer?: { servers?: { url?: string; address?: string }[]; passHostHeader?: boolean };
  usedBy?: string[];
  error?: string[];
  type?: string;
}

export interface TraefikOverview {
  http?: { routers?: Counts; services?: Counts; middlewares?: Counts };
  tcp?: { routers?: Counts };
  providers?: string[];
}

interface Counts {
  total?: number;
  warnings?: number;
  errors?: number;
}

/** The hosts and paths of a Traefik rule: `Host(`a`) && PathPrefix(`/b`) || Host(`c`, `d`)`. */
export function parseRule(rule: string): { domains: string[]; paths: string[] } {
  const args = (name: string) =>
    [...rule.matchAll(new RegExp(`(?<![A-Za-z])${name}\\(([^)]*)\\)`, "g"))].flatMap((m) =>
      [...m[1].matchAll(/[`"']([^`"']+)[`"']/g)].map((a) => a[1])
    );
  return {
    domains: unique(args("Host")),
    paths: unique([...args("PathPrefix"), ...args("Path")]),
  };
}

const unique = <T>(xs: T[]) => [...new Set(xs)];

/** Router `service: "whoami"` of provider docker is the service `whoami@docker`. */
function serviceKey(r: TraefikRouter): string {
  const s = r.service ?? "";
  return s.includes("@") ? s : `${s}@${r.provider ?? ""}`;
}

export function traefikRoutes(routers: TraefikRouter[], services: TraefikService[]): Route[] {
  const byName = new Map(services.map((s) => [s.name, s]));
  return routers
    .filter((r) => r.provider !== "internal" || r.error?.length)
    .map((r): Route => {
      const { domains, paths } = parseRule(r.rule ?? "");
      const svc = byName.get(serviceKey(r));
      const servers = svc?.loadBalancer?.servers?.map((s) => s.url ?? s.address ?? "").filter(Boolean) ?? [];
      const status = Object.entries(svc?.serverStatus ?? {});
      const down = status.filter(([, v]) => v !== "UP").map(([k]) => k);
      const problems = [...(r.error ?? []), ...(svc?.error ?? [])];
      if (status.length && down.length) {
        problems.push(down.length === status.length ? "Every server is down" : `Down: ${down.join(", ")}`);
      }
      let health: Health = r.status === "disabled" ? "error" : r.status === "warning" ? "warning" : "ok";
      if (health === "ok" && status.length && down.length === status.length) health = "error";
      else if (health === "ok" && (down.length || svc?.status === "warning")) health = "warning";
      const tlsDomains = (r.tls?.domains ?? []).flatMap((d) => [d.main ?? "", ...(d.sans ?? [])]).filter(Boolean);
      return {
        key: `traefik:${r.name}`,
        source: "traefik",
        name: r.name.replace(/@[\w-]+$/, ""),
        domains: domains.length ? domains : tlsDomains,
        paths,
        upstreams: servers.length ? servers : r.service ? [r.service] : [],
        health,
        problems,
        tls: Boolean(r.tls),
        entryPoints: r.entryPoints ?? [],
        middlewares: r.middlewares ?? [],
        provider: r.provider,
        certResolver: r.tls?.certResolver,
      };
    });
}

export function traefikSummary(o: TraefikOverview | undefined): string | undefined {
  const r = o?.http?.routers;
  if (!r) return undefined;
  const parts = [`${r.total ?? 0} routers`];
  if (r.errors) parts.push(`${r.errors} errors`);
  if (r.warnings) parts.push(`${r.warnings} warnings`);
  return parts.join(", ");
}

// ---------------------------------------------------------------------------
// Caddy

interface CaddyRoute {
  group?: string;
  match?: { host?: string[]; path?: string[] }[];
  handle?: CaddyHandler[];
  terminal?: boolean;
}

interface CaddyHandler {
  handler?: string;
  routes?: CaddyRoute[];
  upstreams?: { dial?: string }[];
  root?: string;
  status_code?: number | string;
  headers?: { Location?: string[] };
}

interface CaddyServer {
  listen?: string[];
  routes?: CaddyRoute[];
  automatic_https?: { disable?: boolean; skip?: string[] };
  tls_connection_policies?: unknown[];
}

export interface CaddyConfig {
  apps?: { http?: { servers?: Record<string, CaddyServer> } };
}

export interface CaddyUpstream {
  address: string;
  num_requests?: number;
  fails?: number;
}

/** What a list of handlers does: proxied addresses, a folder served, a redirect… */
function targets(handlers: CaddyHandler[] | undefined, paths: string[]): string[] {
  const out: string[] = [];
  let root: string | undefined;
  for (const h of handlers ?? []) {
    switch (h.handler) {
      case "reverse_proxy":
        out.push(...(h.upstreams ?? []).map((u) => u.dial ?? "").filter(Boolean));
        break;
      case "subroute":
        for (const r of h.routes ?? []) {
          paths.push(...(r.match ?? []).flatMap((m) => m.path ?? []));
          out.push(...targets(r.handle, paths));
        }
        break;
      case "file_server":
        out.push(`files ${h.root ?? root ?? ""}`.trim());
        break;
      case "static_response":
        out.push(h.headers?.Location?.[0] ? `redirect ${h.headers.Location[0]}` : `static ${h.status_code ?? 200}`);
        break;
      case "vars":
        // `root` in a Caddyfile: the folder a later file_server serves.
        root = h.root ?? root;
        break;
    }
  }
  return out;
}

export function caddyRoutes(config: CaddyConfig | null | undefined, upstreams: CaddyUpstream[] = []): Route[] {
  const health = new Map(upstreams.map((u) => [u.address, u]));
  const out: Route[] = [];
  for (const [server, s] of Object.entries(config?.apps?.http?.servers ?? {})) {
    const https = !s.automatic_https?.disable && (s.listen ?? []).some((l) => /:443$/.test(l));
    (s.routes ?? []).forEach((r, i) => {
      const domains = unique((r.match ?? []).flatMap((m) => m.host ?? []));
      const paths: string[] = (r.match ?? []).flatMap((m) => m.path ?? []);
      const ups = unique(targets(r.handle, paths));
      const failing = ups.filter((u) => (health.get(u)?.fails ?? 0) > 0);
      out.push({
        key: `caddy:${server}:${i}`,
        source: "caddy",
        name: domains[0] ?? `${server} #${i + 1}`,
        domains,
        paths: unique(paths),
        upstreams: ups,
        health: failing.length && failing.length === ups.length ? "error" : failing.length ? "warning" : "ok",
        problems: failing.map((u) => `${u}: ${health.get(u)?.fails} failed requests`),
        tls: https && domains.length > 0 && !domains.every((d) => s.automatic_https?.skip?.includes(d)),
        entryPoints: s.listen ?? [],
        middlewares: [],
        server,
      });
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Nginx Proxy Manager

export interface NpmCertificate {
  id: number;
  provider?: string;
  nice_name?: string;
  domain_names?: string[];
  expires_on?: string;
  proxy_hosts?: { id: number; domain_names?: string[] }[];
}

export interface NpmProxyHost {
  id: number;
  domain_names?: string[];
  forward_scheme?: string;
  forward_host?: string;
  forward_port?: number;
  certificate_id?: number | string;
  ssl_forced?: boolean | number;
  enabled?: boolean | number;
  meta?: { nginx_online?: boolean; nginx_err?: string | null };
  certificate?: NpmCertificate | null;
  locations?: { path?: string; forward_host?: string; forward_port?: number; forward_scheme?: string }[];
  access_list_id?: number;
  block_exploits?: boolean | number;
  http2_support?: boolean | number;
}

/** NPM's `"2026-12-01 10:00:00"` is UTC; ISO dates pass through. */
export function npmDate(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(text) ? `${text.replace(" ", "T")}Z` : text;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : undefined;
}

/** Red when expired or within a week, orange within three weeks. */
export function certHealth(expires: number | undefined, now = Date.now()): Health {
  if (expires === undefined) return "ok";
  const days = (expires - now) / DAY;
  return days < 7 ? "error" : days < 21 ? "warning" : "ok";
}

export function expiresText(expires: number | undefined, now = Date.now()): string {
  if (expires === undefined) return "";
  const days = Math.floor((expires - now) / DAY);
  if (days < 0) return `expired ${-days} d ago`;
  if (days === 0) return "expires today";
  return `${days} d left`;
}

export function npmRoutes(hosts: NpmProxyHost[], now = Date.now()): Route[] {
  return hosts.map((h) => {
    const enabled = h.enabled === undefined ? true : Boolean(h.enabled);
    const cert = h.certificate && typeof h.certificate === "object"
      ? {
        name: h.certificate.nice_name || (h.certificate.domain_names ?? []).join(", "),
        expires: npmDate(h.certificate.expires_on),
        provider: h.certificate.provider,
        id: h.certificate.id,
      }
      : undefined;
    const problems: string[] = [];
    let health: Health = enabled ? "ok" : "disabled";
    if (enabled && h.meta?.nginx_online === false) {
      health = "error";
      problems.push(h.meta.nginx_err?.trim() || "nginx refused this host's configuration");
    }
    const ch = certHealth(cert?.expires, now);
    if (enabled && cert && ch !== "ok") {
      if (health === "ok" || ch === "error") health = ch;
      problems.push(`Certificate ${expiresText(cert.expires, now)}`);
    }
    const target = `${h.forward_scheme ?? "http"}://${h.forward_host ?? "?"}:${h.forward_port ?? 80}`;
    const domains = h.domain_names ?? [];
    return {
      key: `npm:${h.id}`,
      source: "npm" as const,
      name: domains[0] ?? `Proxy host ${h.id}`,
      domains,
      paths: (h.locations ?? []).map((l) => l.path ?? "").filter(Boolean),
      upstreams: [
        target,
        ...(h.locations ?? []).map((l) => `${l.forward_scheme ?? "http"}://${l.forward_host}:${l.forward_port}`),
      ],
      health,
      problems,
      tls: Boolean(cert) || Boolean(Number(h.certificate_id)),
      entryPoints: [],
      middlewares: [
        ...(h.ssl_forced ? ["Force SSL"] : []),
        ...(h.http2_support ? ["HTTP/2"] : []),
        ...(h.block_exploits ? ["Block exploits"] : []),
        ...(h.access_list_id ? ["Access list"] : []),
      ],
      cert,
      id: h.id,
    };
  });
}

export function npmCertificates(certs: NpmCertificate[]): Certificate[] {
  return certs.map((c) => ({
    key: `npm-cert:${c.id}`,
    source: "npm" as const,
    id: c.id,
    name: c.nice_name || (c.domain_names ?? []).join(", ") || `Certificate ${c.id}`,
    domains: c.domain_names ?? [],
    expires: npmDate(c.expires_on),
    provider: c.provider === "letsencrypt" ? "Let's Encrypt" : c.provider === "other" ? "Custom" : c.provider ?? "",
    hosts: (c.proxy_hosts ?? []).map((h) => h.domain_names?.[0] ?? `#${h.id}`),
  }));
}

// ---------------------------------------------------------------------------
// Shared

const RANK: Record<Health, number> = { error: 0, warning: 1, ok: 2, disabled: 3 };

/** Errors first, then warnings, then by name. */
export function sortRoutes(routes: Route[]): Route[] {
  return [...routes].sort((a, b) => RANK[a.health] - RANK[b.health] || a.name.localeCompare(b.name));
}

/** Soonest expiry first. */
export function sortCertificates(certs: Certificate[]): Certificate[] {
  return [...certs].sort((a, b) => (a.expires ?? Infinity) - (b.expires ?? Infinity) || a.name.localeCompare(b.name));
}

/** The address to open: the first concrete domain (not a wildcard or regexp), with its first path. */
export function routeUrl(r: Route): string | undefined {
  const domain = r.domains.find((d) => /^[\w.-]+$/.test(d) && d.includes("."));
  if (!domain) return undefined;
  const path = r.paths.find((p) => /^\/[\w./-]*$/.test(p)) ?? "";
  return `${r.tls ? "https" : "http"}://${domain}${path === "/" ? "" : path.replace(/\*$/, "")}`;
}

export function statusLine(routes: Route[], certs: Certificate[], now = Date.now()): string {
  const errors = routes.filter((r) => r.health === "error").length;
  const warnings = routes.filter((r) => r.health === "warning").length;
  const expiring = certs.filter((c) => certHealth(c.expires, now) !== "ok").length;
  const parts = [`${routes.length} route${routes.length === 1 ? "" : "s"}`];
  if (errors) parts.push(`${errors} error${errors === 1 ? "" : "s"}`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  if (expiring) parts.push(`${expiring} certificate${expiring === 1 ? "" : "s"} expiring`);
  if (!errors && !warnings && !expiring) parts.push("all healthy");
  return parts.join(" · ");
}
