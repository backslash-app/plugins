import { assertEquals } from "@std/assert";
import {
  ago,
  cliToken,
  flyHealth,
  flyInstallCommand,
  flyUrl,
  formatLogs,
  isFlySignedOut,
  osFamily,
  parseDeployments,
  parseFlyApps,
  parseFlyStatus,
  parseRailwayProjects,
  parseReleases,
  railwayDashboard,
  railwayHealth,
  statusLabel,
  summarizeMachines,
} from "./lib.ts";
import { holdOpen, terminalArgs } from "./terminal.ts";

const APPS = JSON.stringify([
  {
    ID: "shop-api",
    Name: "shop-api",
    Status: "deployed",
    Deployed: true,
    Hostname: "shop-api.fly.dev",
    AppURL: "",
    Version: 0,
    Release: null,
    Organization: { ID: "o1", Name: "Acme", Slug: "acme" },
    PlatformVersion: "machines",
  },
  {
    ID: "old-worker",
    Name: "old-worker",
    Status: "suspended",
    Deployed: true,
    Hostname: "old-worker.fly.dev",
    Organization: { Slug: "personal", Name: "Ada Lovelace" },
  },
  { name: "fresh", status: "pending", deployed: false, organization: { slug: "acme" } },
]);

const STATUS = JSON.stringify({
  ID: "shop-api",
  Name: "shop-api",
  Status: "deployed",
  Version: 42,
  Machines: [
    {
      id: "148ed193b21e89",
      name: "red-sun-1234",
      state: "started",
      region: "cdg",
      image_ref: { registry: "registry.fly.io", repository: "shop-api", tag: "deployment-01JB" },
      config: { metadata: { fly_process_group: "app" } },
      checks: [{ name: "servicecheck-00-http-8080", status: "passing" }],
      updated_at: "2026-10-28T10:00:00Z",
    },
    {
      id: "3d8d9e1fe63918",
      name: "blue-moon-5678",
      state: "started",
      region: "ams",
      config: { metadata: { fly_process_group: "app" } },
      checks: [{ name: "servicecheck-00-http-8080", status: "critical" }],
    },
    { id: "e784e90ea54d68", name: "worker", state: "stopped", region: "cdg", config: {} },
  ],
});

Deno.test("fly apps and machines", () => {
  const apps = parseFlyApps(APPS);
  assertEquals(apps.map((a) => [a.name, a.status, a.org]), [
    ["shop-api", "deployed", "Acme"],
    ["old-worker", "suspended", "Ada Lovelace"],
    ["fresh", "pending", "acme"],
  ]);
  assertEquals(flyUrl(apps[0]), "https://shop-api.fly.dev");
  assertEquals(flyUrl(apps[2]), "https://fresh.fly.dev");
  const status = parseFlyStatus(STATUS);
  assertEquals(status.version, 42);
  assertEquals(status.machines[0].image, "shop-api:deployment-01JB");
  assertEquals(status.machines[0].processGroup, "app");
  const s = summarizeMachines(status.machines);
  assertEquals(s, { total: 3, started: 2, stopped: 1, failing: 1, regions: ["ams", "cdg"] });
  assertEquals(flyHealth(apps[0], s), "failed");
  assertEquals(flyHealth(apps[0], summarizeMachines(status.machines.slice(0, 1))), "ok");
  assertEquals(flyHealth(apps[0]), "ok");
  assertEquals(flyHealth(apps[1]), "idle");
  assertEquals(flyHealth(apps[2]), "busy");
  assertEquals(parseFlyStatus("[]").machines, []);
});

Deno.test("fly releases and sign-in errors", () => {
  const releases = parseReleases(JSON.stringify([
    {
      ID: "r1",
      Version: 41,
      Stable: true,
      InProgress: false,
      Description: "Deploy image",
      Status: "complete",
      DeploymentStrategy: "rolling",
      User: { Email: "ada@acme.dev" },
      CreatedAt: "2026-10-27T10:00:00Z",
      ImageRef: "registry.fly.io/shop-api:deployment-01JA",
    },
    { ID: "r2", Version: 42, Status: "failed", Description: "Deploy image", CreatedAt: "2026-10-28T10:00:00Z" },
  ]));
  assertEquals(releases.map((r) => [r.version, r.status, r.user]), [[42, "failed", undefined], [
    41,
    "complete",
    "ada@acme.dev",
  ]]);
  assertEquals(isFlySignedOut("Error: no access token available. Please login with 'flyctl auth login'"), true);
  assertEquals(isFlySignedOut("Error: app not found"), false);
});

const RAILWAY = {
  projects: {
    edges: [{
      node: {
        id: "p1",
        name: "Shop",
        updatedAt: "2026-10-28T09:00:00Z",
        environments: { edges: [{ node: { id: "e1", name: "production" } }, { node: { id: "e2", name: "staging" } }] },
        services: {
          edges: [{
            node: {
              id: "s1",
              name: "api",
              icon: null,
              serviceInstances: {
                edges: [
                  {
                    node: {
                      environmentId: "e2",
                      domains: { serviceDomains: [{ domain: "api-staging.up.railway.app" }], customDomains: [] },
                      latestDeployment: {
                        id: "d2",
                        status: "CRASHED",
                        createdAt: "2026-10-28T08:00:00Z",
                        staticUrl: "api-staging.up.railway.app",
                        meta: {
                          commitMessage: "Try the new cache\n\nlong body",
                          branch: "cache",
                          commitHash: "abc1234def",
                        },
                      },
                    },
                  },
                  {
                    node: {
                      environmentId: "e1",
                      domains: {
                        serviceDomains: [{ domain: "api.up.railway.app" }],
                        customDomains: [{ domain: "api.acme.dev" }],
                      },
                      latestDeployment: { id: "d1", status: "SUCCESS", createdAt: "2026-10-27T08:00:00Z", meta: {} },
                    },
                  },
                ],
              },
            },
          }, {
            node: {
              id: "s2",
              name: "postgres",
              serviceInstances: { edges: [{ node: { environmentId: "e1", latestDeployment: null } }] },
            },
          }],
        },
      },
    }],
  },
};

Deno.test("railway services", () => {
  const services = parseRailwayProjects(RAILWAY);
  assertEquals(services.map((s) => `${s.serviceName}@${s.environmentName}`), [
    "api@production",
    "api@staging",
    "postgres@production",
  ]);
  assertEquals(services[0].domains, ["api.acme.dev", "api.up.railway.app"]);
  assertEquals(services[1].deployment?.commitMessage, "Try the new cache");
  assertEquals(services[1].deployment?.url, "https://api-staging.up.railway.app");
  assertEquals(services[2].deployment, undefined);
  assertEquals(railwayHealth("CRASHED"), "failed");
  assertEquals(railwayHealth("BUILDING"), "busy");
  assertEquals(railwayHealth("SLEEPING"), "idle");
  assertEquals(railwayHealth(undefined), "other");
  assertEquals(statusLabel("CRASHED"), "Crashed");
  assertEquals(
    railwayDashboard(services[0]),
    "https://railway.com/project/p1/service/s1?environmentId=e1",
  );
  assertEquals(parseRailwayProjects({}), []);
  assertEquals(
    parseDeployments({
      deployments: { edges: [{ node: { id: "d9", status: "FAILED", createdAt: "2026-10-01T00:00:00Z" } }] },
    })
      .map((d) => d.status),
    ["FAILED"],
  );
});

Deno.test("railway CLI token and logs", () => {
  assertEquals(cliToken('{"projects":{},"user":{"token":"rw_abc"}}'), "rw_abc");
  assertEquals(cliToken('{"user":{}}'), undefined);
  assertEquals(cliToken("not json"), undefined);
  assertEquals(
    formatLogs([
      { timestamp: "2026-10-28T08:00:01.123Z", message: "Listening on :8080", severity: "info" },
      { timestamp: "2026-10-28T08:00:02.000Z", message: "panic: nil map", severity: "error" },
    ]),
    "08:00:01      Listening on :8080\n08:00:02  ERR panic: nil map",
  );
});

Deno.test("install hints, time and terminal", () => {
  assertEquals(flyInstallCommand(osFamily("ID=arch\n")), "yay -S flyctl-bin   # AUR");
  assertEquals(flyInstallCommand(osFamily("ID=fedora\n")), "curl -L https://fly.io/install.sh | sh");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(ago(new Date("2026-10-28T09:00:00Z"), now), "3 h ago");
  assertEquals(ago(new Date("invalid"), now), "");
  assertEquals(terminalArgs("konsole", ["flyctl", "logs", "-a", "shop-api"]), [
    "-e",
    "flyctl",
    "logs",
    "-a",
    "shop-api",
  ]);
  assertEquals(holdOpen(["flyctl", "auth", "login"])[2].startsWith("flyctl auth login;"), true);
});
