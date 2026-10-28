import { assertEquals } from "@std/assert";
import {
  age,
  classifyError,
  healthOf,
  inContext,
  installCommand,
  osFamily,
  parseHelmDate,
  parseHistory,
  parseKubeconfig,
  parseReleases,
  rollbackCommand,
  rollbackTargets,
  sortReleases,
  splitChart,
  statusLabel,
  uninstallCommand,
  valuesCommand,
} from "./lib.ts";
import { holdOpen, terminalArgs } from "./terminal.ts";

const LIST = JSON.stringify([
  {
    name: "ingress-nginx",
    namespace: "ingress",
    revision: "4",
    updated: "2026-10-20 09:12:33.123456789 +0000 UTC",
    status: "deployed",
    chart: "ingress-nginx-4.11.2",
    app_version: "1.11.2",
  },
  {
    name: "api",
    namespace: "shop",
    revision: "12",
    updated: "2026-10-28 11:00:00.5 +0200 CEST",
    status: "failed",
    chart: "api-0.3.0-rc.1",
    app_version: "",
  },
  {
    name: "redis",
    namespace: "shop",
    revision: "2",
    updated: "2026-10-27 08:00:00 +0000 UTC",
    status: "pending-upgrade",
    chart: "redis-19.6.4",
    app_version: "7.2.5",
  },
  {
    name: "cert-manager",
    namespace: "cert-manager",
    revision: "1",
    updated: "2026-10-01 10:00:00 +0000 UTC",
    status: "deployed",
    chart: "cert-manager-v1.15.3",
    app_version: "v1.15.3",
  },
]);

Deno.test("charts and dates", () => {
  assertEquals(splitChart("ingress-nginx-4.11.2"), { name: "ingress-nginx", version: "4.11.2" });
  assertEquals(splitChart("api-0.3.0-rc.1"), { name: "api", version: "0.3.0-rc.1" });
  assertEquals(splitChart("cert-manager-v1.15.3"), { name: "cert-manager", version: "v1.15.3" });
  assertEquals(splitChart("weird"), { name: "weird" });
  assertEquals(parseHelmDate("2026-10-20 09:12:33.123456789 +0000 UTC")?.toISOString(), "2026-10-20T09:12:33.123Z");
  assertEquals(parseHelmDate("2026-10-28 11:00:00.5 +0200 CEST")?.toISOString(), "2026-10-28T09:00:00.500Z");
  assertEquals(parseHelmDate("2026-10-01T10:00:00.987654321Z")?.toISOString(), "2026-10-01T10:00:00.987Z");
  assertEquals(parseHelmDate("2026-10-01T12:00:00+02:00")?.toISOString(), "2026-10-01T10:00:00.000Z");
  assertEquals(parseHelmDate(""), undefined);
});

Deno.test("releases, problems first", () => {
  const releases = parseReleases(LIST);
  assertEquals(releases[0].revision, 4);
  assertEquals(releases[0].appVersion, "1.11.2");
  assertEquals(releases[1].appVersion, undefined);
  assertEquals(sortReleases(releases).map((r) => `${r.name}:${r.health}`), [
    "api:failed",
    "redis:pending",
    "ingress-nginx:ok",
    "cert-manager:ok",
  ]);
  assertEquals(healthOf("uninstalling"), "pending");
  assertEquals(healthOf("superseded"), "other");
  assertEquals(statusLabel("pending-upgrade"), "Pending upgrade");
  assertEquals(parseReleases("null"), []);
});

Deno.test("history and rollback targets", () => {
  const history = parseHistory(JSON.stringify([
    {
      revision: 1,
      updated: "2026-10-01T10:00:00Z",
      status: "superseded",
      chart: "api-0.2.0",
      app_version: "1.0",
      description: "Install complete",
    },
    {
      revision: 2,
      updated: "2026-10-10T10:00:00Z",
      status: "deployed",
      chart: "api-0.2.1",
      app_version: "1.1",
      description: "Upgrade complete",
    },
    {
      revision: 3,
      updated: "2026-10-28T09:00:00Z",
      status: "failed",
      chart: "api-0.3.0",
      app_version: "1.2",
      description: 'Upgrade "api" failed: timed out waiting for the condition',
    },
  ]));
  assertEquals(history.map((r) => r.revision), [3, 2, 1]);
  assertEquals(rollbackTargets(history, 3).map((r) => r.revision), [2, 1]);
});

Deno.test("command lines", () => {
  const r = parseReleases(LIST)[0];
  assertEquals(valuesCommand(r), ["helm", "get", "values", "ingress-nginx", "--namespace", "ingress", "-o", "yaml"]);
  assertEquals(valuesCommand(r, true).at(-1), "--all");
  assertEquals(rollbackCommand(r, 3), ["helm", "rollback", "ingress-nginx", "3", "--namespace", "ingress"]);
  assertEquals(inContext(uninstallCommand(r), "prod"), [
    "helm",
    "--kube-context",
    "prod",
    "uninstall",
    "ingress-nginx",
    "--namespace",
    "ingress",
  ]);
  assertEquals(inContext(["helm", "list"], undefined), ["helm", "list"]);
  assertEquals(terminalArgs("wezterm", ["helm", "status", "x"]), ["start", "--", "helm", "status", "x"]);
  assertEquals(holdOpen(["helm", "status", "x"])[0], "sh");
});

Deno.test("kubeconfig", () => {
  const c = parseKubeconfig(JSON.stringify({
    "current-context": "prod",
    clusters: [{ name: "prod-cluster", cluster: { server: "https://10.0.0.1:6443" } }],
    contexts: [{ name: "prod", context: { cluster: "prod-cluster", user: "admin", namespace: "shop" } }],
  }));
  assertEquals(c, {
    current: "prod",
    contexts: [{ name: "prod", cluster: "prod-cluster", namespace: "shop", server: "https://10.0.0.1:6443" }],
  });
  assertEquals(parseKubeconfig("{}"), { current: undefined, contexts: [] });
});

Deno.test("errors, age and install hints", () => {
  assertEquals(
    classifyError('helm exited with 1: Error: Kubernetes cluster unreachable: Get "https://10.0.0.1:6443/version"')
      .unreachable,
    true,
  );
  assertEquals(
    classifyError("Error: list: failed to list: secrets is forbidden").title,
    "The cluster refused the credentials",
  );
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(age(new Date("2026-10-28T11:15:00Z"), now), "45 min");
  assertEquals(age(new Date("2026-10-20T12:00:00Z"), now), "8 d");
  assertEquals(age(undefined, now), "");
  assertEquals(installCommand(osFamily("ID=arch\n")), "sudo pacman -S helm");
  assertEquals(installCommand(osFamily("ID=ubuntu\nID_LIKE=debian\n")), "sudo snap install helm --classic");
});
