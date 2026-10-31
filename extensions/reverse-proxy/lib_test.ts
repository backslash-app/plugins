import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { config, SetupError } from "./api.ts";
import {
  caddyRoutes,
  certHealth,
  expiresText,
  npmCertificates,
  npmDate,
  npmRoutes,
  parseRule,
  routeUrl,
  sortCertificates,
  sortRoutes,
  statusLine,
  type TraefikRouter,
  traefikRoutes,
  type TraefikService,
  traefikSummary,
} from "./lib.ts";
import { HOSTS, isAllowedHost } from "./net.ts";

const NOW = Date.parse("2026-10-31T10:00:00Z");
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Traefik

// Shaped like Traefik v3's /api/http/routers and /api/http/services.
const ROUTERS: TraefikRouter[] = [
  {
    entryPoints: ["websecure"],
    middlewares: ["auth@file"],
    service: "jellyfin",
    rule: "Host(`jellyfin.example.com`)",
    tls: { certResolver: "letsencrypt" },
    status: "enabled",
    using: ["websecure"],
    name: "jellyfin@docker",
    provider: "docker",
  },
  {
    entryPoints: ["websecure"],
    service: "grafana",
    rule: "Host(`grafana.example.com`) && PathPrefix(`/dash`) || Host(`metrics.example.com`)",
    tls: { certResolver: "letsencrypt", domains: [{ main: "example.com", sans: ["*.example.com"] }] },
    status: "warning",
    error: ['the service "grafana@docker" does not exist'],
    name: "grafana@docker",
    provider: "docker",
  },
  {
    entryPoints: ["web"],
    service: "nextcloud@file",
    rule: "Host(`cloud.lan`)",
    status: "enabled",
    name: "nextcloud@file",
    provider: "file",
  },
  {
    entryPoints: ["traefik"],
    service: "api@internal",
    rule: "PathPrefix(`/api`)",
    status: "enabled",
    name: "api@internal",
    provider: "internal",
  },
  {
    entryPoints: ["websecure"],
    service: "broken",
    rule: "Host(`broken.example.com`",
    status: "disabled",
    error: ["error while parsing rule Host(`broken.example.com`: 1:1: expected ')'"],
    name: "broken@docker",
    provider: "docker",
  },
];

const SERVICES: TraefikService[] = [
  {
    loadBalancer: { servers: [{ url: "http://172.18.0.5:8096" }], passHostHeader: true },
    status: "enabled",
    usedBy: ["jellyfin@docker"],
    serverStatus: { "http://172.18.0.5:8096": "UP" },
    name: "jellyfin@docker",
    provider: "docker",
    type: "loadbalancer",
  },
  {
    loadBalancer: { servers: [{ url: "http://192.168.1.20:8080" }, { url: "http://192.168.1.21:8080" }] },
    status: "enabled",
    serverStatus: { "http://192.168.1.20:8080": "DOWN", "http://192.168.1.21:8080": "DOWN" },
    name: "nextcloud@file",
    provider: "file",
  },
];

Deno.test("traefik: rules to domains and paths", () => {
  assertEquals(parseRule("Host(`a.example.com`) && PathPrefix(`/api`)"), {
    domains: ["a.example.com"],
    paths: ["/api"],
  });
  assertEquals(parseRule("Host(`a.com`, `b.com`) || Host(`c.com`)").domains, ["a.com", "b.com", "c.com"]);
  assertEquals(parseRule("HostRegexp(`{sub:[a-z]+}.example.com`)").domains, []);
  assertEquals(parseRule('Path(`/x`) && Host("d.com")'), { domains: ["d.com"], paths: ["/x"] });
  assertEquals(parseRule(""), { domains: [], paths: [] });
});

Deno.test("traefik: routers with services, health and internal ones hidden", () => {
  const routes = traefikRoutes(ROUTERS, SERVICES);
  assertEquals(routes.map((r) => r.name), ["jellyfin", "grafana", "nextcloud", "broken"]);
  const [jellyfin, grafana, nextcloud, broken] = routes;
  assertEquals(jellyfin.health, "ok");
  assertEquals(jellyfin.upstreams, ["http://172.18.0.5:8096"]);
  assertEquals(jellyfin.tls, true);
  assertEquals(jellyfin.certResolver, "letsencrypt");
  assertEquals(jellyfin.middlewares, ["auth@file"]);
  assertEquals(grafana.health, "warning");
  assertEquals(grafana.domains, ["grafana.example.com", "metrics.example.com"]);
  assertEquals(grafana.paths, ["/dash"]);
  assertEquals(grafana.upstreams, ["grafana"]);
  assertEquals(grafana.problems, ['the service "grafana@docker" does not exist']);
  assertEquals(nextcloud.health, "error");
  assertEquals(nextcloud.tls, false);
  assertEquals(nextcloud.problems, ["Every server is down"]);
  assertEquals(broken.health, "error");
  assert(broken.problems[0].includes("parsing rule"));
  assertEquals(routeUrl(jellyfin), "https://jellyfin.example.com");
  assertEquals(routeUrl(grafana), "https://grafana.example.com/dash");
  assertEquals(routeUrl(nextcloud), "http://cloud.lan");
});

Deno.test("traefik: overview", () => {
  assertEquals(
    traefikSummary({ http: { routers: { total: 12, warnings: 1, errors: 2 } }, providers: ["docker"] }),
    "12 routers, 2 errors, 1 warnings",
  );
  assertEquals(traefikSummary(undefined), undefined);
});

// ---------------------------------------------------------------------------
// Caddy

// Shaped like Caddy's /config/ for a Caddyfile adapted to JSON.
const CADDY = {
  apps: {
    http: {
      servers: {
        srv0: {
          listen: [":443"],
          routes: [
            {
              match: [{ host: ["photos.example.com"] }],
              handle: [{
                handler: "subroute",
                routes: [{ handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "localhost:2283" }] }] }],
              }],
              terminal: true,
            },
            {
              match: [{ host: ["example.com", "www.example.com"] }],
              handle: [{
                handler: "subroute",
                routes: [
                  {
                    match: [{ path: ["/api/*"] }],
                    handle: [{ handler: "reverse_proxy", upstreams: [{ dial: "10.0.0.5:3000" }] }],
                  },
                  { handle: [{ handler: "vars", root: "/srv/www" }, { handler: "file_server" }] },
                ],
              }],
              terminal: true,
            },
          ],
        },
        srv1: {
          listen: [":8080"],
          routes: [{
            handle: [{ handler: "static_response", status_code: 302, headers: { Location: ["https://example.com"] } }],
          }],
        },
      },
    },
  },
};

Deno.test("caddy: routes from the JSON config, upstream failures", () => {
  const routes = caddyRoutes(CADDY, [
    { address: "localhost:2283", num_requests: 2, fails: 0 },
    { address: "10.0.0.5:3000", num_requests: 0, fails: 3 },
  ]);
  assertEquals(routes.map((r) => r.name), ["photos.example.com", "example.com", "srv1 #1"]);
  const [photos, site, redirect] = routes;
  assertEquals(photos.upstreams, ["localhost:2283"]);
  assertEquals(photos.tls, true);
  assertEquals(photos.health, "ok");
  assertEquals(site.domains, ["example.com", "www.example.com"]);
  assertEquals(site.paths, ["/api/*"]);
  assertEquals(site.upstreams, ["10.0.0.5:3000", "files /srv/www"]);
  assertEquals(site.health, "warning");
  assertEquals(site.problems, ["10.0.0.5:3000: 3 failed requests"]);
  assertEquals(redirect.upstreams, ["redirect https://example.com"]);
  assertEquals(redirect.tls, false);
  assertEquals(routeUrl(redirect), undefined);
  assertEquals(caddyRoutes(null), []);
});

// ---------------------------------------------------------------------------
// Nginx Proxy Manager

const CERT_OK = {
  id: 3,
  provider: "letsencrypt",
  nice_name: "example.com",
  domain_names: ["example.com", "*.example.com"],
  expires_on: "2027-01-10 08:00:00",
};
const CERT_SOON = {
  id: 4,
  provider: "letsencrypt",
  nice_name: "",
  domain_names: ["vault.example.com"],
  expires_on: "2026-11-04 08:00:00",
};

const HOSTS_NPM = [
  {
    id: 1,
    domain_names: ["ha.example.com"],
    forward_scheme: "http",
    forward_host: "192.168.1.40",
    forward_port: 8123,
    certificate_id: 3,
    ssl_forced: 1,
    http2_support: 1,
    block_exploits: 1,
    enabled: 1,
    meta: { nginx_online: true, nginx_err: null },
    certificate: CERT_OK,
    locations: [],
  },
  {
    id: 2,
    domain_names: ["vault.example.com"],
    forward_scheme: "https",
    forward_host: "vault",
    forward_port: 8200,
    certificate_id: 4,
    enabled: true,
    meta: { nginx_online: true },
    certificate: CERT_SOON,
  },
  {
    id: 5,
    domain_names: ["old.example.com"],
    forward_host: "10.0.0.9",
    forward_port: 80,
    certificate_id: 0,
    enabled: 0,
    meta: {},
  },
  {
    id: 6,
    domain_names: ["bad.example.com"],
    forward_host: "10.0.0.10",
    forward_port: 80,
    enabled: 1,
    meta: { nginx_online: false, nginx_err: 'nginx: [emerg] host not found in upstream "10.0.0.10x"' },
    locations: [{ path: "/admin", forward_scheme: "http", forward_host: "10.0.0.11", forward_port: 9000 }],
  },
];

Deno.test("npm: dates are UTC", () => {
  assertEquals(npmDate("2026-11-04 08:00:00"), Date.parse("2026-11-04T08:00:00Z"));
  assertEquals(npmDate("2026-11-04T08:00:00.000Z"), Date.parse("2026-11-04T08:00:00Z"));
  assertEquals(npmDate(""), undefined);
  assertEquals(npmDate("soon"), undefined);
});

Deno.test("npm: proxy hosts with certificate, disabled and nginx errors", () => {
  const routes = npmRoutes(HOSTS_NPM, NOW);
  const [ha, vault, old, bad] = routes;
  assertEquals(ha.health, "ok");
  assertEquals(ha.upstreams, ["http://192.168.1.40:8123"]);
  assertEquals(ha.tls, true);
  assertEquals(ha.middlewares, ["Force SSL", "HTTP/2", "Block exploits"]);
  assertEquals(ha.cert?.name, "example.com");
  assertEquals(vault.health, "error");
  assertEquals(vault.problems, ["Certificate 3 d left"]);
  assertEquals(vault.cert?.name, "vault.example.com");
  assertEquals(old.health, "disabled");
  assertEquals(old.tls, false);
  assertEquals(bad.health, "error");
  assert(bad.problems[0].includes("host not found"));
  assertEquals(bad.paths, ["/admin"]);
  assertEquals(bad.upstreams, ["http://10.0.0.10:80", "http://10.0.0.11:9000"]);
  assertEquals(routeUrl(bad), "http://bad.example.com/admin");
  assertEquals(
    sortRoutes(routes).map((r) => r.name),
    ["bad.example.com", "vault.example.com", "ha.example.com", "old.example.com"],
  );
});

Deno.test("npm: certificates, soonest expiry first", () => {
  const certs = sortCertificates(npmCertificates([
    { ...CERT_OK, proxy_hosts: [{ id: 1, domain_names: ["ha.example.com"] }] },
    { ...CERT_SOON, provider: "other" },
  ]));
  assertEquals(certs.map((c) => c.name), ["vault.example.com", "example.com"]);
  assertEquals(certs[0].provider, "Custom");
  assertEquals(certs[1].provider, "Let's Encrypt");
  assertEquals(certs[1].hosts, ["ha.example.com"]);
});

Deno.test("certificate health and expiry text", () => {
  assertEquals(certHealth(NOW + 3 * DAY, NOW), "error");
  assertEquals(certHealth(NOW + 14 * DAY, NOW), "warning");
  assertEquals(certHealth(NOW + 60 * DAY, NOW), "ok");
  assertEquals(certHealth(undefined, NOW), "ok");
  assertEquals(expiresText(NOW + 10.5 * DAY, NOW), "10 d left");
  assertEquals(expiresText(NOW - 2.5 * DAY, NOW), "expired 3 d ago");
  assertEquals(expiresText(NOW + 3_600_000, NOW), "expires today");
});

Deno.test("status line", () => {
  const routes = [...traefikRoutes(ROUTERS, SERVICES), ...npmRoutes(HOSTS_NPM, NOW)];
  const certs = npmCertificates([CERT_OK, CERT_SOON]);
  assertEquals(statusLine(routes, certs, NOW), "8 routes · 4 errors · 1 warning · 1 certificate expiring");
  assertEquals(statusLine([], [], NOW), "0 routes · all healthy");
});

Deno.test("configuration", () => {
  assertThrows(() => config({}), SetupError, "Connect Traefik");
  assertThrows(() => config({ npmUrl: "http://192.168.1.5:81" }), SetupError, "email and password");
  assertThrows(() => config({ traefikUrl: "https://traefik.example.com" }), SetupError, "outside");
  const c = config({ traefikUrl: "192.168.1.5:8080/dashboard/", traefikUser: "admin", traefikPassword: "pw" });
  assertEquals(c.traefik?.base, "http://192.168.1.5:8080");
  assertEquals(c.traefik?.auth, `Basic ${btoa("admin:pw")}`);
  assertEquals(config({ caddyUrl: "localhost:2019" }).caddy?.base, "http://localhost:2019");
  assert(isAllowedHost("proxy.home.arpa"));
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, HOSTS);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
