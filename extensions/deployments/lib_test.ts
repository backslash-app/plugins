import { assertEquals } from "@std/assert";
import type { Context } from "@backslash/api";
import { AuthError, configured, guarded, setupAll, vercelScope } from "./api.ts";
import {
  daySection,
  deploymentItem,
  duration,
  fromNetlify,
  fromVercel,
  logLines,
  type NetlifyDeploy,
  netlifyItem,
  type NetlifySite,
  netlifyState,
  since,
  sortDeployments,
  stateLook,
  type VercelDeployment,
  vercelItem,
  vercelState,
} from "./lib.ts";

const ctx: Context = {
  args: {},
  preferences: { vercelToken: "v", netlifyToken: "n" },
  query: "",
  signal: new AbortController().signal,
};

const T = Date.parse("2026-10-27T10:00:00Z");

// Shaped like `GET https://api.vercel.com/v6/deployments`.
const vercelDeployment: VercelDeployment = {
  uid: "dpl_89qyp1cskzkLrVicDaZoDbjyHuDJ",
  name: "storefront",
  url: "storefront-k3f9a1-acme.vercel.app",
  created: T,
  createdAt: T,
  buildingAt: T + 4_000,
  ready: T + 79_000,
  state: "READY",
  target: "production",
  source: "git",
  projectId: "prj_12HKQaOmR5t5Uy6vdcQsNIiZgHGB",
  inspectorUrl: "https://vercel.com/acme/storefront/89qyp1cskzkLrVicDaZoDbjyHuDJ",
  creator: { uid: "96SnxkFiMyVKsK3pnoHfx3Hz", username: "ada" },
  meta: {
    githubCommitMessage: "Fix the cart total\n\nCloses #12",
    githubCommitRef: "main",
    githubCommitSha: "dc36199b2234c6586ebe05ec94078a895c707e29",
    githubCommitAuthorName: "Ada Lovelace",
    githubOrg: "acme",
    githubRepo: "storefront",
  },
};

// Shaped like `GET https://api.netlify.com/api/v1/sites/{site_id}/deploys`.
const netlifyDeploy: NetlifyDeploy = {
  id: "6532f1c2a1b2c3d4e5f6a7b8",
  site_id: "3970e0fe-8564-4903-9a55-c5f8de49fb8b",
  name: "acme-docs",
  state: "error",
  error_message: "Build script returned non-zero exit code: 2",
  created_at: "2026-10-26T18:00:00.000Z",
  deploy_time: 41,
  branch: "main",
  commit_ref: "a1b2c3d4e5f6",
  commit_url: "https://github.com/acme/docs/commit/a1b2c3d4e5f6",
  title: "Update the install guide",
  committer: "grace",
  context: "production",
  deploy_ssl_url: "https://6532f1c2a1b2c3d4e5f6a7b8--acme-docs.netlify.app",
  ssl_url: "https://docs.acme.dev",
  admin_url: "https://app.netlify.com/sites/acme-docs",
};

Deno.test("states of both providers", () => {
  assertEquals(["READY", "BUILDING", "INITIALIZING", "QUEUED", "ERROR", "CANCELED"].map(vercelState), [
    "ready",
    "building",
    "queued",
    "queued",
    "error",
    "canceled",
  ]);
  assertEquals(
    ["ready", "building", "processing", "enqueued", "uploading"].map((state) => netlifyState({ state })),
    ["ready", "building", "building", "queued", "building"],
  );
  assertEquals(netlifyState({ state: "error", error_message: "Canceled build" }), "canceled");
  assertEquals(stateLook("ready"), { icon: "bs-circle-check", tint: "green", text: "Ready" });
  assertEquals(stateLook("building").tint, "orange");
  assertEquals(stateLook("error").tint, "red");
});

Deno.test("Vercel deployment mapping", () => {
  const d = fromVercel(vercelDeployment);
  assertEquals(d.url, "https://storefront-k3f9a1-acme.vercel.app");
  assertEquals([d.state, d.production, d.environment, d.duration], ["ready", true, "Production", 75]);
  assertEquals([d.branch, d.commitSha?.slice(0, 7), d.author], ["main", "dc36199", "Ada Lovelace"]);
  assertEquals(d.commitUrl, "https://github.com/acme/storefront/commit/dc36199b2234c6586ebe05ec94078a895c707e29");
  assertEquals(d.authorAvatar, "https://vercel.com/api/www/avatar/96SnxkFiMyVKsK3pnoHfx3Hz?s=64");
  const preview = fromVercel({ ...vercelDeployment, target: null, meta: {}, state: "BUILDING", ready: undefined });
  assertEquals([preview.environment, preview.duration, preview.commitMessage], ["Preview", undefined, undefined]);
});

Deno.test("Netlify deploy mapping", () => {
  const d = fromNetlify(netlifyDeploy);
  assertEquals([d.state, d.environment, d.duration, d.author], ["error", "Production", 41, "grace"]);
  assertEquals(d.url, "https://6532f1c2a1b2c3d4e5f6a7b8--acme-docs.netlify.app");
  assertEquals(d.dashboardUrl, "https://app.netlify.com/sites/acme-docs/deploys/6532f1c2a1b2c3d4e5f6a7b8");
  assertEquals(d.error, "Build script returned non-zero exit code: 2");
  assertEquals(fromNetlify({ ...netlifyDeploy, state: "ready" }).url, "https://docs.acme.dev");
});

Deno.test("formatting and order", () => {
  assertEquals([duration(41), duration(75), duration(3720)], ["41s", "1m 15s", "1h 2m"]);
  assertEquals([since(T, T + 30_000), since(T, T + 600_000), since(T, T + 7_200_000)], ["just now", "10m", "2h"]);
  const now = new Date(2026, 9, 27, 18, 0);
  const at = (h: number, day = 27) => ({
    ...fromVercel(vercelDeployment),
    createdAt: new Date(2026, 9, day, h).getTime(),
  });
  assertEquals(daySection(at(9), now), "Today");
  assertEquals(daySection(at(23, 26), now), "Yesterday");
  assertEquals(daySection({ ...at(9), state: "building" }, now), "In progress");
  const sorted = sortDeployments([at(9), { ...at(8), state: "building" }, at(12)]);
  assertEquals(sorted.map((d) => [d.state, new Date(d.createdAt).getHours()]), [["building", 8], ["ready", 12], [
    "ready",
    9,
  ]]);
});

Deno.test("deployment items and actions", () => {
  const v = deploymentItem(fromVercel(vercelDeployment), ctx, { section: "Today" });
  assertEquals(v.title, "storefront");
  assertEquals(v.subtitle, "Fix the cart total");
  assertEquals(v.icon, { source: "bs-circle-check", tint: "green" });
  assertEquals(v.accessories?.slice(0, 3), [
    { tag: "Production", color: "blue" },
    { icon: "bs-branch", text: "main", tooltip: "Branch" },
    { icon: "bs-timer", text: "1m 15s", tooltip: "Build time" },
  ]);
  assertEquals(v.actions?.map((a) => a.title).slice(0, 5), [
    "Open Deployment",
    "Open in Vercel",
    "Show Build Logs",
    "Open Commit",
    "Redeploy",
  ]);
  assertEquals(v.actions?.find((a) => a.title === "Redeploy")?.confirm, "Redeploy storefront to production?");

  const n = deploymentItem(fromNetlify(netlifyDeploy), ctx);
  assertEquals(n.icon, { source: "bs-circle-x", tint: "red" });
  const titles = n.actions?.map((a) => a.title) ?? [];
  assertEquals(titles.slice(0, 2), ["Open in Netlify", "Open Deployment URL"]);
  assertEquals(titles.includes("Retry Deploy"), true);
  assertEquals(titles.includes("Show Build Logs"), false);

  const building = deploymentItem({ ...fromNetlify(netlifyDeploy), state: "building" }, ctx);
  const cancel = building.actions?.find((a) => a.title === "Cancel Deployment");
  assertEquals([cancel?.destructive, building.actions?.some((a) => a.title === "Retry Deploy")], [true, false]);
});

Deno.test("projects and sites", () => {
  const v = vercelItem({
    id: "prj_1",
    name: "storefront",
    framework: "nextjs",
    updatedAt: T,
    link: { type: "github", org: "acme", repo: "storefront", productionBranch: "main" },
    targets: {
      production: { id: "dpl_1", alias: ["shop.acme.dev", "storefront.vercel.app"], readyState: "ERROR", createdAt: T },
    },
  }, ctx);
  assertEquals([v.subtitle, v.icon], ["shop.acme.dev", { source: "bs-circle-x", tint: "red" }]);
  assertEquals(v.actions?.[0].title, "Show Deployments");
  const site: NetlifySite = {
    id: "3970e0fe",
    name: "acme-docs",
    ssl_url: "https://docs.acme.dev",
    admin_url: "https://app.netlify.com/sites/acme-docs",
    updated_at: "2026-10-26T18:00:00.000Z",
    build_settings: { repo_url: "https://github.com/acme/docs", repo_branch: "main" },
    published_deploy: { ...netlifyDeploy, state: "ready", published_at: "2026-10-26T18:01:00.000Z" },
  };
  const n = netlifyItem(site, ctx);
  assertEquals([n.subtitle, n.section, n.actions?.[0].title], ["docs.acme.dev", "Netlify", "Show Deploys"]);
  assertEquals(n.detail?.metadata?.map((m) => m.label).slice(0, 5), [
    "Published",
    "URL",
    "Repository",
    "Production branch",
    "Last commit",
  ]);
});

Deno.test("Vercel build logs", () => {
  assertEquals(
    logLines([
      { type: "command", created: 1, payload: { text: "npm run build" } },
      { type: "stdout", created: 2, payload: { text: "\u001b[32m✓\u001b[39m Compiled  " } },
      { type: "delimiter", created: 3, payload: { text: "Build" } },
      { type: "stderr", created: 4, text: "warn: old" },
    ]),
    ["$ npm run build", "✓ Compiled", "warn: old"],
  );
});

Deno.test("tokens: optional, per provider", async () => {
  assertEquals(configured({ vercelToken: " v " }), ["vercel"]);
  assertEquals(configured({}), []);
  assertEquals(setupAll().map((i) => i.actions?.[0].title), ["Create Vercel Token", "Create Netlify Token"]);
  assertEquals([vercelScope("team_abc"), vercelScope("acme"), vercelScope("")], ["teamId=team_abc", "slug=acme", ""]);
  const rejected = await guarded(
    "netlify",
    () => Promise.reject(new AuthError("netlify", "Netlify rejected the access token")),
  );
  assertEquals([rejected[0].id, rejected[0].title], ["setup-netlify", "Netlify rejected the access token"]);
  const failed = await guarded("vercel", () => Promise.reject(new Error("Vercel answered 500")));
  assertEquals(failed[0].id, "error-vercel");
});
