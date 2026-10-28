import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  appPath,
  appUrl,
  attention,
  describeSource,
  destinationName,
  filterApps,
  isCertificateError,
  normalizePem,
  normalizeUrl,
  parseApplications,
  problemResources,
  repoName,
  resourceCounts,
  revisionUrl,
  rollbackTargets,
  shortRevision,
  sortApps,
} from "./lib.ts";

const SHA = "9f3c2b1a0d4e5f60718293a4b5c6d7e8f9012345";

const LIST = {
  metadata: { resourceVersion: "123" },
  items: [
    {
      metadata: { name: "guestbook", namespace: "argocd", creationTimestamp: "2025-01-01T00:00:00Z" },
      spec: {
        project: "default",
        source: {
          repoURL: "https://github.com/argoproj/argocd-example-apps.git",
          path: "guestbook",
          targetRevision: "HEAD",
        },
        destination: { server: "https://kubernetes.default.svc", namespace: "guestbook" },
        syncPolicy: { automated: { prune: true, selfHeal: true } },
      },
      status: {
        sync: { status: "Synced", revision: SHA },
        health: { status: "Healthy" },
        resources: [
          {
            kind: "Service",
            name: "guestbook-ui",
            namespace: "guestbook",
            status: "Synced",
            health: { status: "Healthy" },
          },
          { group: "apps", kind: "Deployment", name: "guestbook-ui", status: "Synced", health: { status: "Healthy" } },
        ],
        history: [
          { id: 3, revision: "1111111111111111111111111111111111111111", deployedAt: "2026-10-20T10:00:00Z" },
          { id: 5, revision: SHA, deployedAt: "2026-10-27T10:00:00Z", initiatedBy: { automated: true } },
          { id: 4, revision: "2222222222222222222222222222222222222222", deployedAt: "2026-10-25T10:00:00Z" },
        ],
        operationState: {
          phase: "Succeeded",
          message: "successfully synced (all tasks run)",
          finishedAt: "2026-10-27T10:00:05Z",
          operation: { initiatedBy: { automated: true } },
        },
        reconciledAt: "2026-10-28T11:59:00Z",
        summary: {
          images: ["gcr.io/heptio-images/ks-guestbook-demo:0.2"],
          externalURLs: ["https://guestbook.example.com"],
        },
      },
    },
    {
      metadata: { name: "payments", namespace: "team-a" },
      spec: {
        project: "payments",
        sources: [
          { repoURL: "https://charts.bitnami.com/bitnami", chart: "redis", targetRevision: "18.1.0" },
          { repoURL: "git@gitlab.com:acme/values.git", ref: "values", targetRevision: "main" },
        ],
        destination: { name: "prod-eu", namespace: "payments" },
      },
      status: {
        sync: { status: "OutOfSync", revisions: ["18.1.0", SHA] },
        health: { status: "Degraded", message: "Deployment payments-api exceeded its progress deadline" },
        resources: [
          {
            group: "apps",
            kind: "Deployment",
            name: "payments-api",
            status: "OutOfSync",
            health: { status: "Degraded", message: "exceeded progress deadline" },
          },
          { kind: "ConfigMap", name: "old-config", status: "OutOfSync", requiresPruning: true },
          { kind: "Service", name: "payments-api", status: "Synced", health: { status: "Healthy" } },
        ],
        conditions: [{ type: "SyncError", message: "Failed sync attempt: one or more objects failed to apply" }],
        operationState: { phase: "Failed", message: "one or more objects failed to apply" },
      },
    },
    {
      metadata: { name: "docs", namespace: "argocd" },
      spec: {
        project: "default",
        source: { repoURL: "https://github.com/acme/docs", path: "deploy", targetRevision: "main" },
        destination: { server: "https://10.0.0.1:6443", namespace: "docs" },
      },
      status: { sync: { status: "OutOfSync", revision: SHA }, health: { status: "Healthy" } },
    },
    {
      metadata: { name: "new-app" },
      spec: { destination: {} },
    },
  ],
};

Deno.test("applications: sources, sync policy, operation, defaults", () => {
  const [guestbook, payments, docs, fresh] = parseApplications(LIST);
  assertEquals(guestbook.sync, "Synced");
  assertEquals(guestbook.automated && guestbook.selfHeal && guestbook.autoPrune, true);
  assertEquals(guestbook.operation?.by, "automated");
  assertEquals(guestbook.urls, ["https://guestbook.example.com"]);
  assertEquals(payments.sources.length, 2);
  assertEquals(payments.revision, "18.1.0");
  assertEquals(payments.namespace, "team-a");
  assertEquals(docs.automated, false);
  assertEquals(fresh.sync, "Unknown");
  assertEquals(fresh.health, "Unknown");
  assertEquals(fresh.namespace, "argocd");
  assertEquals(fresh.project, "default");
  assertEquals(parseApplications({ items: null }), []);
});

Deno.test("attention order: failed and degraded, then out of sync, then the rest", () => {
  const apps = parseApplications(LIST);
  assertEquals(apps.map(attention), ["ok", "failed", "outOfSync", "outOfSync"]);
  assertEquals(sortApps(apps).map((a) => a.name), ["payments", "docs", "new-app", "guestbook"]);
  assertEquals(filterApps(apps, "unhealthy").map((a) => a.name), ["payments", "new-app"]);
  assertEquals(filterApps(apps, "outOfSync").length, 3);
  assertEquals(filterApps(apps, "attention").length, 3);
});

Deno.test("resource counts and problems", () => {
  const payments = parseApplications(LIST)[1];
  const c = resourceCounts(payments.resources);
  assertEquals([c.total, c.outOfSync, c.unhealthy, c.prune], [3, 2, 1, 1]);
  assertEquals(c.byKind, [["ConfigMap", 1], ["Deployment", 1], ["Service", 1]]);
  assertEquals(problemResources(payments.resources).map((r) => r.name), ["payments-api", "old-config"]);
});

Deno.test("rollback targets: newest first, without the current deployment", () => {
  const guestbook = parseApplications(LIST)[0];
  assertEquals(rollbackTargets(guestbook).map((h) => h.id), [4, 3]);
  assertEquals(rollbackTargets(parseApplications(LIST)[2]), []);
});

Deno.test("names, revisions and links", () => {
  const [guestbook, payments, docs] = parseApplications(LIST);
  assertEquals(destinationName(guestbook), "in-cluster / guestbook");
  assertEquals(destinationName(payments), "prod-eu / payments");
  assertEquals(destinationName(docs), "10.0.0.1:6443 / docs");
  assertEquals(describeSource(guestbook.sources[0]), "argoproj/argocd-example-apps guestbook @ HEAD");
  assertEquals(describeSource(payments.sources[0]), "bitnami chart redis @ 18.1.0");
  assertEquals(repoName("git@gitlab.com:acme/values.git"), "acme/values");
  assertEquals(shortRevision(SHA), "9f3c2b1");
  assertEquals(shortRevision("18.1.0"), "18.1.0");
  assertEquals(
    revisionUrl("https://github.com/argoproj/argocd-example-apps.git", SHA),
    `https://github.com/argoproj/argocd-example-apps/commit/${SHA}`,
  );
  assertEquals(revisionUrl("git@gitlab.com:acme/values.git", SHA), `https://gitlab.com/acme/values/-/commit/${SHA}`);
  assertEquals(revisionUrl("https://charts.bitnami.com/bitnami", "18.1.0"), undefined);
});

Deno.test("server address and API paths", () => {
  assertEquals(normalizeUrl("argocd.example.com/"), "https://argocd.example.com");
  assertEquals(normalizeUrl("https://ops.example.com/argocd/applications/argocd/x"), "https://ops.example.com/argocd");
  assertEquals(normalizeUrl("http://localhost:8080"), "http://localhost:8080");
  assertEquals(normalizeUrl(""), "");
  const payments = parseApplications(LIST)[1];
  assertEquals(
    appUrl("https://argocd.example.com", payments),
    "https://argocd.example.com/applications/team-a/payments",
  );
  assertEquals(appPath(payments, "/sync"), "/api/v1/applications/payments/sync?appNamespace=team-a");
  assertEquals(
    appPath(payments, "", { refresh: "hard" }),
    "/api/v1/applications/payments?refresh=hard&appNamespace=team-a",
  );
});

Deno.test("certificates", () => {
  const pem = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----";
  assertEquals(normalizePem(`junk\r\n${pem}\r\n`), pem);
  assertEquals(normalizePem("not a cert"), undefined);
  assert(isCertificateError("invalid peer certificate: UnknownIssuer"));
  assert(!isCertificateError("connection refused"));
});

Deno.test("the manifest lets the extension reach the server you set", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, ["*"]);
});
