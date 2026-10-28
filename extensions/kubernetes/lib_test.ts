import { assertEquals } from "@std/assert";
import {
  age,
  deleteCommand,
  filterPods,
  healthOf,
  localPort,
  logsCommand,
  parseKubeconfig,
  parseNamespaces,
  parsePods,
  podStatus,
  portForwardCommand,
  shellCommand,
  shortServer,
  sortPods,
} from "./lib.ts";

const CONFIG = JSON.stringify({
  apiVersion: "v1",
  kind: "Config",
  "current-context": "prod",
  clusters: [
    {
      name: "prod-cluster",
      cluster: { server: "https://10.0.0.1:6443", "certificate-authority-data": "DATA+OMITTED" },
    },
    { name: "kind-dev", cluster: { server: "https://127.0.0.1:41235" } },
  ],
  contexts: [
    { name: "prod", context: { cluster: "prod-cluster", user: "admin", namespace: "shop" } },
    { name: "kind-dev", context: { cluster: "kind-dev", user: "kind-dev" } },
  ],
  users: [{ name: "admin", user: { token: "REDACTED" } }],
});

const NOW = new Date("2026-10-28T12:00:00Z");

const pod = (name: string, extra: Record<string, unknown>) => ({
  metadata: {
    name,
    namespace: "shop",
    creationTimestamp: "2026-10-25T08:00:00Z",
    labels: { app: "api", "pod-template-hash": "7d9f8c6b5" },
    ownerReferences: [{ kind: "ReplicaSet", name: "api-7d9f8c6b5", controller: true }],
  },
  spec: {
    nodeName: "node-1",
    containers: [
      { name: "api", image: "ghcr.io/acme/api:1.4.2", ports: [{ containerPort: 8080, name: "http", protocol: "TCP" }] },
      { name: "proxy", image: "envoyproxy/envoy:v1.31", ports: [{ containerPort: 443 }] },
    ],
  },
  ...extra,
});

const running = pod("api-7d9f8c6b5-x2x4z", {
  status: {
    phase: "Running",
    podIP: "10.244.1.17",
    qosClass: "Burstable",
    containerStatuses: [
      {
        name: "api",
        ready: true,
        restartCount: 2,
        state: { running: { startedAt: "2026-10-27T10:00:00Z" } },
        lastState: { terminated: { reason: "OOMKilled", exitCode: 137 } },
      },
      { name: "proxy", ready: true, restartCount: 0, state: { running: {} } },
    ],
  },
});

const crashing = pod("api-7d9f8c6b5-k8s9q", {
  status: {
    phase: "Running",
    containerStatuses: [
      { name: "api", ready: false, restartCount: 14, state: { waiting: { reason: "CrashLoopBackOff" } } },
      { name: "proxy", ready: true, restartCount: 0, state: { running: {} } },
    ],
  },
});

const job = {
  metadata: {
    name: "backup-29350000-abcde",
    namespace: "shop",
    creationTimestamp: "2026-10-28T11:50:00Z",
    ownerReferences: [{ kind: "Job", name: "backup-29350000", controller: true }],
  },
  spec: { containers: [{ name: "backup", image: "alpine:3" }] },
  status: {
    phase: "Succeeded",
    containerStatuses: [{
      name: "backup",
      ready: false,
      restartCount: 0,
      state: { terminated: { reason: "Completed", exitCode: 0 } },
    }],
  },
};

const initializing = {
  metadata: {
    name: "db-0",
    namespace: "shop",
    ownerReferences: [{ kind: "StatefulSet", name: "db", controller: true }],
  },
  spec: {
    initContainers: [{ name: "migrate" }, { name: "seed" }],
    containers: [{ name: "postgres", image: "postgres:17" }],
  },
  status: {
    phase: "Pending",
    initContainerStatuses: [
      { name: "migrate", state: { terminated: { exitCode: 0, reason: "Completed" } } },
      { name: "seed", state: { running: {} } },
    ],
    containerStatuses: [{
      name: "postgres",
      ready: false,
      restartCount: 0,
      state: { waiting: { reason: "PodInitializing" } },
    }],
  },
};

const pulling = {
  metadata: { name: "web", namespace: "shop", deletionTimestamp: undefined },
  spec: { containers: [{ name: "web", image: "nginx:doesnotexist" }] },
  status: {
    phase: "Pending",
    containerStatuses: [{
      name: "web",
      ready: false,
      restartCount: 0,
      state: { waiting: { reason: "ImagePullBackOff" } },
    }],
  },
};

const terminating = {
  metadata: { name: "old", namespace: "shop", deletionTimestamp: "2026-10-28T11:59:00Z" },
  spec: { containers: [{ name: "old", image: "busybox" }] },
  status: {
    phase: "Running",
    containerStatuses: [{ name: "old", ready: true, restartCount: 0, state: { running: {} } }],
  },
};

const PODS = JSON.stringify({ items: [running, crashing, job, initializing, pulling, terminating] });

Deno.test("kubeconfig", () => {
  const c = parseKubeconfig(CONFIG);
  assertEquals(c.current, "prod");
  assertEquals(c.contexts, [
    { name: "prod", cluster: "prod-cluster", user: "admin", namespace: "shop", server: "https://10.0.0.1:6443" },
    {
      name: "kind-dev",
      cluster: "kind-dev",
      user: "kind-dev",
      namespace: undefined,
      server: "https://127.0.0.1:41235",
    },
  ]);
  assertEquals(parseKubeconfig("{}"), { current: undefined, contexts: [] });
  assertEquals(shortServer("https://10.0.0.1:6443"), "10.0.0.1:6443");
});

Deno.test("namespaces", () => {
  const ns = parseNamespaces(JSON.stringify({
    items: [
      { metadata: { name: "default", creationTimestamp: "2026-01-01T00:00:00Z" }, status: { phase: "Active" } },
      { metadata: { name: "old" }, status: { phase: "Terminating" } },
    ],
  }));
  assertEquals(ns.map((n) => [n.name, n.phase]), [["default", "Active"], ["old", "Terminating"]]);
});

Deno.test("pod statuses as kubectl prints them", () => {
  assertEquals(podStatus(running), "Running");
  assertEquals(podStatus(crashing), "CrashLoopBackOff");
  assertEquals(podStatus(job), "Completed");
  assertEquals(podStatus(initializing), "Init:1/2");
  assertEquals(podStatus(pulling), "ImagePullBackOff");
  assertEquals(podStatus(terminating), "Terminating");
  assertEquals(
    podStatus({
      status: {
        phase: "Pending",
        initContainerStatuses: [{ state: { terminated: { exitCode: 1, reason: "Error" } } }],
      },
    }),
    "Init:Error",
  );
  assertEquals(podStatus({ status: { phase: "Failed", reason: "Evicted" } }), "Evicted");
});

Deno.test("pods", () => {
  const [api, crash, backup, db, web, old] = parsePods(PODS);
  assertEquals([api.ready, api.total, api.restarts, api.health], [2, 2, 2, "ok"]);
  assertEquals(api.workload, { kind: "Deployment", name: "api" });
  assertEquals(api.node, "node-1");
  assertEquals(api.ip, "10.244.1.17");
  assertEquals(api.containers[0].ports, [{ port: 8080, name: "http", protocol: "TCP" }]);
  assertEquals(api.containers[0].lastTermination, { reason: "OOMKilled", exitCode: 137, finishedAt: undefined });
  assertEquals([crash.status, crash.health, crash.restarts, crash.ready], ["CrashLoopBackOff", "failed", 14, 1]);
  assertEquals([backup.health, backup.workload], ["done", { kind: "CronJob", name: "backup" }]);
  assertEquals([db.status, db.health, db.workload], ["Init:1/2", "pending", { kind: "StatefulSet", name: "db" }]);
  assertEquals(web.health, "failed");
  assertEquals([old.health, old.deleting], ["pending", true]);
  assertEquals(healthOf("Running", 1, 2), "pending");
});

Deno.test("filters and order", () => {
  const pods = parsePods(PODS);
  assertEquals(filterPods(pods, "running").map((p) => p.name), ["api-7d9f8c6b5-x2x4z"]);
  assertEquals(filterPods(pods, "problem").map((p) => p.name), ["api-7d9f8c6b5-k8s9q", "db-0", "web", "old"]);
  assertEquals(filterPods(pods, "all").length, 6);
  assertEquals(sortPods(pods).map((p) => p.name), [
    "api-7d9f8c6b5-k8s9q",
    "web",
    "db-0",
    "old",
    "api-7d9f8c6b5-x2x4z",
    "backup-29350000-abcde",
  ]);
});

Deno.test("ages like kubectl", () => {
  const ago = (s: number) => age(new Date(NOW.getTime() - s * 1000), NOW);
  assertEquals(ago(45), "45s");
  assertEquals(ago(7 * 60 + 30), "7m30s");
  assertEquals(ago(2 * 3600 + 15 * 60), "135m");
  assertEquals(ago(5 * 3600 + 20 * 60), "5h20m");
  assertEquals(ago(30 * 3600), "30h");
  assertEquals(ago(3 * 86400 + 4 * 3600), "3d4h");
  assertEquals(ago(40 * 86400), "40d");
  assertEquals(ago(800 * 86400), "2y");
  assertEquals(age(undefined), "");
});

Deno.test("commands", () => {
  const t = { context: "prod", namespace: "shop" };
  assertEquals(logsCommand(t, "api"), [
    "kubectl",
    "--context",
    "prod",
    "-n",
    "shop",
    "logs",
    "api",
    "--all-containers",
    "--prefix",
    "--tail=200",
  ]);
  assertEquals(logsCommand(t, "api", { container: "proxy", previous: true, follow: true, tail: 50 }), [
    "kubectl",
    "--context",
    "prod",
    "-n",
    "shop",
    "logs",
    "api",
    "-c",
    "proxy",
    "--previous",
    "-f",
    "--tail=50",
  ]);
  assertEquals(deleteCommand(t, "api"), [
    "kubectl",
    "--context",
    "prod",
    "-n",
    "shop",
    "delete",
    "pod",
    "api",
    "--wait=false",
  ]);
  assertEquals(portForwardCommand(t, "api", 443, localPort(443)).slice(-2), ["pod/api", "8443:443"]);
  assertEquals(localPort(8080), 8080);
  assertEquals(shellCommand(t, "api", "proxy").slice(5, 11), ["exec", "-it", "api", "-c", "proxy", "--"]);
});
