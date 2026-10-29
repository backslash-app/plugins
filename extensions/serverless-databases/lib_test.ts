import { assertEquals, assertRejects } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { call, HOSTS, neonProjects, psDatabases, TokenError } from "./api.ts";
import {
  age,
  computeSize,
  configured,
  credentials,
  deployState,
  endpointState,
  errorMessage,
  formatBytes,
  locationName,
  maskUri,
  type NeonBranch,
  neonConsoleUrl,
  neonRegion,
  newBranchName,
  plural,
  type PsDeployRequest,
  psState,
  sortBranches,
  sortDeployRequests,
  sortPsBranches,
  tursoEnv,
  tursoState,
  tursoTokenPath,
  validateBranchName,
} from "./lib.ts";

Deno.test("credentials: any subset, PlanetScale as id + token or id:token", () => {
  assertEquals(configured(credentials({})), []);
  assertEquals(credentials({ neonApiKey: " k ", tursoToken: "" }), { neon: "k" });
  assertEquals(
    credentials({ planetscaleTokenId: "abc", planetscaleToken: "pscale_tkn_x", planetscaleOrg: "acme" }).planetscale,
    {
      id: "abc",
      token: "pscale_tkn_x",
      org: "acme",
    },
  );
  assertEquals(credentials({ planetscaleToken: "abc:pscale_tkn_x" }).planetscale, {
    id: "abc",
    token: "pscale_tkn_x",
    org: undefined,
  });
  // A token without its ID can't be used.
  assertEquals(credentials({ planetscaleToken: "pscale_tkn_x" }).planetscale, undefined);
  assertEquals(configured(credentials({ tursoToken: "t", neonApiKey: "n" })), ["neon", "turso"]);
});

Deno.test("error bodies", () => {
  assertEquals(errorMessage({ message: "branch not found", code: "" }), "branch not found");
  assertEquals(errorMessage({ error: "database not found" }), "database not found");
  assertEquals(errorMessage({ error: { message: "nope" } }), "nope");
  assertEquals(errorMessage("plain"), "plain");
  assertEquals(errorMessage(undefined), "");
});

const branch = (o: Partial<NeonBranch>): NeonBranch => ({
  id: "br-x",
  project_id: "p",
  name: "x",
  current_state: "ready",
  created_at: "2026-10-01T00:00:00Z",
  ...o,
});

Deno.test("neon: regions, branches, computes", () => {
  assertEquals(neonRegion("aws-eu-central-1"), "Europe (Frankfurt)");
  assertEquals(neonRegion("aws-me-central-1"), "me-central-1");
  assertEquals(neonConsoleUrl("p-1", "br-2"), "https://console.neon.tech/app/projects/p-1/branches/br-2");
  const sorted = sortBranches([
    branch({ id: "old", created_at: "2026-01-01T00:00:00Z" }),
    branch({ id: "new", created_at: "2026-10-01T00:00:00Z" }),
    branch({ id: "main", primary: true, created_at: "2025-01-01T00:00:00Z" }),
  ]);
  assertEquals(sorted.map((b) => b.id), ["main", "new", "old"]);
  assertEquals(endpointState(undefined), { label: "No compute", color: "gray" });
  const ep = { id: "ep", host: "h", branch_id: "b", type: "read_write" as const, current_state: "idle" };
  assertEquals(endpointState(ep).label, "Idle");
  assertEquals(endpointState({ ...ep, current_state: "active" }).color, "green");
  assertEquals(computeSize({ ...ep, autoscaling_limit_min_cu: 0.25, autoscaling_limit_max_cu: 2 }), "0.25–2 CU");
  assertEquals(computeSize({ ...ep, autoscaling_limit_min_cu: 1, autoscaling_limit_max_cu: 1 }), "1 CU");
  const now = new Date("2026-10-29T10:00:00Z");
  assertEquals(newBranchName(["main"], now), "dev/2026-10-29");
  assertEquals(newBranchName(["dev/2026-10-29", "dev/2026-10-29-2"], now), "dev/2026-10-29-3");
  assertEquals(validateBranchName("  feature  "), "feature");
});

Deno.test("turso: state, locations, tokens", () => {
  const d = { Name: "app", DbId: "1", Hostname: "app-acme.turso.io" };
  assertEquals(tursoState(d).label, "Ready");
  assertEquals(tursoState({ ...d, sleeping: true }).label, "Sleeping");
  assertEquals(tursoState({ ...d, block_writes: true }).color, "orange");
  assertEquals(locationName("lhr", { lhr: "London, UK" }), "London, UK (lhr)");
  assertEquals(locationName("xyz", {}), "xyz");
  assertEquals(
    tursoTokenPath("acme", "app db", "7d", true),
    "/v1/organizations/acme/databases/app%20db/auth/tokens?expiration=7d&authorization=read-only",
  );
  assertEquals(tursoEnv(d, "jwt"), "TURSO_DATABASE_URL=libsql://app-acme.turso.io\nTURSO_AUTH_TOKEN=jwt\n");
});

const dr = (o: Partial<PsDeployRequest>): PsDeployRequest => ({
  id: "x",
  number: 1,
  branch: "dev",
  into_branch: "main",
  state: "open",
  deployment_state: "ready",
  html_url: "https://app.planetscale.com/acme/db/deploy-requests/1",
  created_at: "2026-10-01T00:00:00Z",
  ...o,
});

Deno.test("planetscale: states, deploy requests and branches", () => {
  assertEquals(psState("ready").color, "green");
  assertEquals(psState("sleep_in_progress").label, "Going to sleep");
  assertEquals(deployState(dr({})), { label: "Ready to deploy", color: "green", deployable: true });
  assertEquals(deployState(dr({ approved: false })).label, "Ready (needs approval)");
  assertEquals(deployState(dr({ deployment_state: "no_changes" })).deployable, false);
  assertEquals(deployState(dr({ deployment_state: "in_progress_cutover" })).label, "Deploying");
  assertEquals(deployState(dr({ state: "closed", deployment_state: "complete" })).label, "Deployed");
  assertEquals(deployState(dr({ state: "closed", deployment_state: "ready" })).label, "Closed");
  assertEquals(
    sortDeployRequests([dr({ number: 1, state: "closed" }), dr({ number: 2 }), dr({ number: 3 })]).map((d) => d.number),
    [3, 2, 1],
  );
  const b = (name: string, production: boolean) => ({ id: name, name, production, ready: true, created_at: "" });
  assertEquals(sortPsBranches([b("z", false), b("main", true), b("a", false)]).map((x) => x.name), ["main", "a", "z"]);
});

Deno.test("formatting", () => {
  assertEquals(formatBytes(undefined), undefined);
  assertEquals(formatBytes(512), "512 B");
  assertEquals(formatBytes(31_457_280), "30 MB");
  assertEquals(formatBytes(1.5 * 1024 ** 3), "1.5 GB");
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(age("2026-10-29T11:30:00Z", now), "30m");
  assertEquals(age("2026-10-26T12:00:00Z", now), "3d");
  assertEquals(age("2024-10-01T12:00:00Z", now), "2y");
  assertEquals(age(undefined, now), "");
  assertEquals(
    maskUri("postgresql://neondb_owner:npg_abc@ep-x.neon.tech/neondb?sslmode=require"),
    "postgresql://neondb_owner:****@ep-x.neon.tech/neondb?sslmode=require",
  );
  assertEquals(plural(1, "branch", "branches"), "1 branch");
  assertEquals(plural(2, "branch", "branches"), "2 branches");
});

Deno.test("permissions list the API hosts", async () => {
  const manifest = parseToml(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
});

/** Replaces fetch for the duration of `fn`, recording the requests. */
async function withFetch(
  answer: (url: string, init: RequestInit) => Response,
  fn: (calls: { url: string; init: RequestInit }[]) => Promise<void>,
) {
  const original = globalThis.fetch;
  const calls: { url: string; init: RequestInit }[] = [];
  globalThis.fetch = ((url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(answer(String(url), init));
  }) as typeof fetch;
  try {
    await fn(calls);
  } finally {
    globalThis.fetch = original;
  }
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

Deno.test("api: authentication headers and errors", async () => {
  const c = credentials({ neonApiKey: "nk", planetscaleTokenId: "id", planetscaleToken: "tok" });
  await withFetch(() => json({ ok: true }), async (calls) => {
    await call("neon", c, "/projects");
    await call("planetscale", c, "/organizations");
    assertEquals(calls[0].url, "https://console.neon.tech/api/v2/projects");
    assertEquals((calls[0].init.headers as Record<string, string>).Authorization, "Bearer nk");
    assertEquals((calls[1].init.headers as Record<string, string>).Authorization, "id:tok");
  });
  await withFetch(() => json({ message: "bad" }, 401), async () => {
    await assertRejects(() => call("neon", c, "/projects"), TokenError);
  });
  await withFetch(() => json({ message: "branch is protected" }, 422), async () => {
    await assertRejects(() => call("neon", c, "/x"), Error, "Neon answered 422: branch is protected");
  });
});

Deno.test("api: Neon projects of the account and its organizations, PlanetScale pages", async () => {
  const c = credentials({ neonApiKey: "nk", planetscaleTokenId: "id", planetscaleToken: "tok" });
  const signal = new AbortController().signal;
  const project = (id: string, updated: string) => ({
    id,
    name: id,
    region_id: "aws-us-east-2",
    pg_version: 17,
    created_at: "",
    updated_at: updated,
  });
  await withFetch((url) => {
    if (url.endsWith("/users/me/organizations")) return json({ organizations: [{ id: "org-1", name: "Acme" }] });
    if (url.includes("org_id=org-1")) {
      return json({ projects: [project("p2", "2026-10-02"), project("p3", "2026-10-03")] });
    }
    return json({ projects: [project("p1", "2026-10-01"), project("p2", "2026-10-02")] });
  }, async () => {
    const all = await neonProjects(c, signal);
    assertEquals(all.map((e) => [e.project.id, e.org]), [["p3", "Acme"], ["p2", "Acme"], ["p1", undefined]]);
  });
  await withFetch((url) => {
    const page = Number(new URL(url).searchParams.get("page"));
    return json({
      data: [{ id: `d${page}`, name: `db${page}`, state: "ready", created_at: "" }],
      next_page: page < 2 ? page + 1 : null,
    });
  }, async (calls) => {
    const dbs = await psDatabases(c, "acme", signal);
    assertEquals(dbs.map((d) => d.name), ["db1", "db2"]);
    assertEquals(calls[0].url, "https://api.planetscale.com/v1/organizations/acme/databases?page=1&per_page=100");
  });
});
