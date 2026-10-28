import { assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { incomplete, instances } from "./api.ts";
import {
  ago,
  coolifyEnvironments,
  coolifyKind,
  coolifyStatus,
  coolifyUi,
  dokployStatus,
  domainUrl,
  matchesChip,
  normalizeUrl,
  parseCoolifyDeployments,
  parseCoolifyResources,
  parseDokployDeployments,
  parseDokployProjects,
  shortRepo,
  sortResources,
  splitFqdn,
  took,
} from "./lib.ts";

const BASE = "https://coolify.example.com";

// GET /api/v1/projects/{uuid} for each project.
const PROJECTS = [
  {
    id: 1,
    uuid: "pq0k8sw",
    name: "Website",
    description: null,
    environments: [
      { id: 1, name: "production", uuid: "e1a2b3c", project_id: 1 },
      { id: 2, name: "staging", project_id: 1 },
    ],
  },
];

// GET /api/v1/resources, trimmed.
const RESOURCES = JSON.stringify([
  {
    id: 3,
    uuid: "vgsco4o",
    name: "web",
    description: "Marketing site",
    fqdn: "https://example.com,https://www.example.com",
    git_repository: "acme/web",
    git_branch: "main",
    build_pack: "nixpacks",
    environment_id: 1,
    status: "running:healthy",
    type: "application",
    updated_at: "2026-10-27T10:00:00.000000Z",
  },
  {
    uuid: "s0ckw8k",
    name: "plausible",
    service_type: "plausible",
    environment_id: 2,
    status: "exited:unhealthy",
    type: "service",
  },
  { uuid: "d8wkg0w", name: "postgres", environment_id: 1, status: "running:unknown", type: "standalone-postgresql" },
  { uuid: "", name: "broken" },
]);

// GET /api/v1/deployments/applications/vgsco4o?take=10
const DEPLOYMENTS = JSON.stringify({
  count: 2,
  deployments: [
    {
      id: 41,
      application_id: "3",
      deployment_uuid: "kg8s0cw",
      status: "failed",
      commit: "HEAD",
      is_webhook: false,
      created_at: "2026-10-26T09:00:00.000000Z",
      updated_at: "2026-10-26T09:02:10.000000Z",
    },
    {
      id: 42,
      application_id: "3",
      deployment_uuid: "w4c8o0k",
      status: "finished",
      commit: "4f2a9c1e7b",
      commit_message: "Fix footer links\n\nAnd more",
      is_webhook: true,
      deployment_url: "/project/pq0k8sw/environment/e1a2b3c/application/vgsco4o/deployment/w4c8o0k",
      created_at: "2026-10-27T10:00:00.000000Z",
      updated_at: "2026-10-27T10:01:05.000000Z",
    },
  ],
});

// GET /api/project.all (Dokploy 0.25, with environments).
const DOKPLOY = JSON.stringify([{
  projectId: "p_8Hk2",
  name: "Shop",
  environments: [{
    environmentId: "env_Q1",
    name: "production",
    isDefault: true,
    applications: [{ applicationId: "app_Z9", name: "storefront", applicationStatus: "done" }],
    compose: [{ composeId: "cmp_A1", name: "n8n", composeStatus: "error" }],
    postgres: [{ postgresId: "pg_1" }],
  }],
}]);

// The same, as Dokploy before environments (0.2x).
const DOKPLOY_OLD = JSON.stringify([{
  projectId: "p_old",
  name: "Legacy",
  applications: [{
    applicationId: "app_old",
    name: "api",
    appName: "api-3f8a1c",
    applicationStatus: "running",
    repository: "acme/api",
    branch: "main",
    buildType: "nixpacks",
    domains: [{ host: "api.example.com", https: true, path: "/" }, { host: "10.0.0.2", https: false, path: "/v2" }],
  }],
  compose: [],
}]);

Deno.test("manifest: every command has its file", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    commands: { name: string }[];
    preferences: { name: string; type?: string }[];
  };
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  assertEquals(
    manifest.preferences.filter((p) => p.type === "secret").map((p) => p.name),
    ["coolifyToken", "dokployKey"],
  );
});

Deno.test("addresses and instances", () => {
  assertEquals(normalizeUrl("coolify.example.com/"), "https://coolify.example.com");
  assertEquals(normalizeUrl("https://coolify.example.com/api/v1"), "https://coolify.example.com");
  assertEquals(normalizeUrl("http://10.0.0.5:8000/dashboard/projects"), "http://10.0.0.5:8000");
  assertEquals(normalizeUrl(""), "");
  assertEquals(instances({}), []);
  assertEquals(instances({ coolifyUrl: "app.coolify.io", coolifyToken: "1|abc" }), [
    { platform: "coolify", base: "https://app.coolify.io", secret: "1|abc" },
  ]);
  assertEquals(incomplete({ dokployUrl: "dokploy.lan" }), ["Dokploy"]);
  assertEquals(incomplete({ coolifyToken: "x" }), ["Coolify"]);
});

Deno.test("statuses", () => {
  assertEquals(coolifyStatus("running:healthy").state, "running");
  assertEquals(coolifyStatus("running:unhealthy").state, "degraded");
  assertEquals(coolifyStatus("running:unknown"), { state: "running", health: "unknown", raw: "running:unknown" });
  assertEquals(coolifyStatus("degraded:unhealthy").state, "degraded");
  assertEquals(coolifyStatus("exited:unhealthy").state, "stopped");
  assertEquals(coolifyStatus("restarting").state, "deploying");
  assertEquals(coolifyStatus(null).state, "unknown");
  assertEquals(dokployStatus("done").state, "running");
  assertEquals(dokployStatus("running").state, "deploying");
  assertEquals(dokployStatus("idle").state, "stopped");
  assertEquals(dokployStatus("error").state, "error");
});

Deno.test("Coolify resources and links", () => {
  const envs = coolifyEnvironments(PROJECTS);
  const list = parseCoolifyResources(RESOURCES, BASE, envs);
  assertEquals(list.map((r) => [r.name, r.kind, r.status.state]), [
    ["web", "application", "running"],
    ["plausible", "service", "stopped"],
    ["postgres", "database", "running"],
  ]);
  const web = list[0];
  assertEquals(web.urls, ["https://example.com", "https://www.example.com"]);
  assertEquals([web.project, web.environment], ["Website", "production"]);
  assertEquals(web.ui, `${BASE}/project/pq0k8sw/environment/e1a2b3c/application/vgsco4o`);
  // An environment without uuid: an older Coolify, routed by name.
  assertEquals(list[1].ui, `${BASE}/project/pq0k8sw/staging/service/s0ckw8k`);
  assertEquals(list[2].type, "postgresql");
  assertEquals(list[2].ui, `${BASE}/project/pq0k8sw/environment/e1a2b3c/database/d8wkg0w`);
  assertEquals(coolifyUi(BASE, undefined, "application", "x"), `${BASE}/projects`);
  assertEquals(coolifyKind("standalone-redis"), "database");
  assertEquals(splitFqdn("a.example.com, http://b.example.com:8080"), [
    "https://a.example.com",
    "http://b.example.com:8080",
  ]);
  assertEquals(splitFqdn(null), []);
});

Deno.test("Coolify deployments", () => {
  const ui = `${BASE}/project/pq0k8sw/environment/e1a2b3c/application/vgsco4o`;
  const list = parseCoolifyDeployments(DEPLOYMENTS, BASE, ui);
  assertEquals(list.map((d) => [d.id, d.status, d.trigger]), [["w4c8o0k", "success", "Webhook"], [
    "kg8s0cw",
    "failed",
    "Manual",
  ]]);
  assertEquals(list[0].message, "Fix footer links");
  assertEquals(list[0].url, `${ui}/deployment/w4c8o0k`);
  assertEquals(list[1].commit, "");
  assertEquals(list[1].url, `${ui}/deployment/kg8s0cw`);
  assertEquals(took(list[0].created, list[0].finished), "1m 05s");
  // Older Coolify returned the list itself.
  assertEquals(
    parseCoolifyDeployments('[{"deployment_uuid":"a","status":"in_progress"}]', BASE, ui)[0].status,
    "running",
  );
});

Deno.test("Dokploy projects, both shapes", () => {
  const base = "https://dokploy.example.com";
  const list = parseDokployProjects(DOKPLOY, base);
  assertEquals(list.map((r) => [r.name, r.kind, r.status.state, r.environment]), [
    ["storefront", "application", "running", "production"],
    ["n8n", "compose", "error", "production"],
  ]);
  assertEquals(list[0].ui, `${base}/dashboard/project/p_8Hk2/environment/env_Q1/services/application/app_Z9`);
  assertEquals(list[1].ui, `${base}/dashboard/project/p_8Hk2/environment/env_Q1/services/compose/cmp_A1`);
  const old = parseDokployProjects(DOKPLOY_OLD, base);
  assertEquals(old[0].ui, `${base}/dashboard/project/p_old/services/application/app_old`);
  assertEquals(old[0].urls, ["https://api.example.com", "http://10.0.0.2/v2"]);
  assertEquals(old[0].status.state, "deploying");
  assertEquals(domainUrl({ host: "x.dev", https: true, path: "/" }), "https://x.dev");
});

Deno.test("Dokploy deployments", () => {
  const list = parseDokployDeployments(
    JSON.stringify([
      { deploymentId: "d1", title: "Manual deployment", status: "done", createdAt: "2026-10-27T10:00:00.000Z" },
      {
        deploymentId: "d2",
        title: "Rebuild",
        description: "Webhook from GitHub",
        status: "error",
        createdAt: "2026-10-28T10:00:00.000Z",
        finishedAt: "2026-10-28T10:00:42.000Z",
      },
    ]),
    "https://d.example.com/dashboard/project/p/services/application/a",
  );
  assertEquals(list.map((d) => [d.id, d.status, d.trigger]), [["d2", "failed", "Webhook"], ["d1", "success", ""]]);
  assertEquals(took(list[0].created, list[0].finished), "42s");
  assertEquals(list[0].url.endsWith("?tab=deployments"), true);
});

Deno.test("filters, order and formatting", () => {
  const list = parseCoolifyResources(RESOURCES, BASE, coolifyEnvironments(PROJECTS));
  assertEquals(list.filter((r) => matchesChip(r, "running")).map((r) => r.name), ["web", "postgres"]);
  assertEquals(list.filter((r) => matchesChip(r, "stopped")).map((r) => r.name), ["plausible"]);
  assertEquals(list.filter((r) => matchesChip(r, "problems")), []);
  assertEquals(sortResources(list).map((r) => r.name), ["postgres", "web", "plausible"]);
  assertEquals(shortRepo("git@github.com:acme/web.git"), "github.com/acme/web");
  assertEquals(shortRepo("https://gitlab.com/acme/api"), "gitlab.com/acme/api");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(ago("2026-10-28T11:55:00Z", now), "5 min ago");
  assertEquals(ago("2026-10-27T10:00:00Z", now), "yesterday");
  assertEquals(took("2026-10-28T11:55:00Z", ""), "");
});
