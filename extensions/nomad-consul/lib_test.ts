import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { consulConfig, HOSTS, isAllowedHost, nomadConfig, nomadJobUrl, normalizeUrl, SetupError } from "./api.ts";
import {
  age,
  allocMarkdown,
  allocShortName,
  type AllocStub,
  checksMarkdown,
  fromCatalog,
  fromUiServices,
  instanceAddress,
  instanceHealth,
  jobCount,
  type JobStub,
  jobView,
  jobViews,
  mainTask,
  nodeProblems,
  type ServiceEntry,
  serviceHealth,
  sortAllocs,
  sortServices,
  tail,
} from "./lib.ts";

const NS = 1_000_000;
const NOW = Date.parse("2026-10-31T12:00:00Z");
const t = (minutesAgo: number) => (NOW - minutesAgo * 60_000) * NS;

// GET /v1/jobs?namespace=* (Nomad 1.8, abridged).
const JOBS: JobStub[] = JSON.parse(JSON.stringify([
  {
    ID: "api",
    Name: "api",
    Namespace: "default",
    Type: "service",
    Priority: 50,
    Status: "running",
    Stop: false,
    Datacenters: ["dc1"],
    JobSummary: { Summary: { web: { Queued: 0, Complete: 3, Failed: 7, Running: 2, Starting: 0, Lost: 0 } } },
    SubmitTime: t(60 * 24 * 3),
    Version: 12,
  },
  {
    ID: "worker",
    Name: "worker",
    Namespace: "prod",
    Type: "service",
    Status: "running",
    JobSummary: { Summary: { work: { Queued: 0, Failed: 1, Running: 3 } } },
  },
  {
    ID: "cleanup",
    Name: "cleanup",
    Namespace: "default",
    Type: "batch",
    Periodic: true,
    Status: "running",
    JobSummary: { Summary: {}, Children: { Pending: 0, Running: 0, Dead: 14 } },
  },
  {
    ID: "cleanup/periodic-1761900000",
    ParentID: "cleanup",
    Name: "cleanup/periodic-1761900000",
    Namespace: "default",
    Type: "batch",
    Status: "dead",
  },
  {
    ID: "migrate",
    Name: "migrate",
    Namespace: "default",
    Type: "batch",
    Status: "dead",
    JobSummary: { Summary: { run: { Complete: 1 } } },
  },
  { ID: "old", Name: "old", Namespace: "default", Type: "service", Status: "dead", Stop: true },
  {
    ID: "gpu",
    Name: "gpu",
    Namespace: "default",
    Type: "service",
    Status: "pending",
    JobSummary: { Summary: { train: { Queued: 1 } } },
  },
]));

const alloc = (o: Partial<AllocStub>): AllocStub => ({
  ID: "00000000-0000-0000-0000-000000000000",
  Name: "api.web[0]",
  Namespace: "default",
  JobID: "api",
  TaskGroup: "web",
  DesiredStatus: "run",
  ClientStatus: "running",
  NodeName: "node-1",
  CreateTime: t(30),
  ...o,
});

// GET /v1/allocations?namespace=*&resources=false
const ALLOCS: AllocStub[] = [
  alloc({
    ID: "a1b2c3d4-0000-4000-8000-000000000001",
    TaskStates: { server: { State: "running", Restarts: 2, Failed: false } },
  }),
  alloc({
    ID: "a1b2c3d4-0000-4000-8000-000000000002",
    Name: "api.web[1]",
    ClientStatus: "failed",
    ClientDescription: "Failed tasks",
    CreateTime: t(10),
    TaskStates: {
      server: {
        State: "dead",
        Failed: true,
        Restarts: 3,
        Events: [
          { Type: "Received", Time: t(10), DisplayMessage: "Task received by client" },
          { Type: "Terminated", Time: t(4), DisplayMessage: 'Exit Code: 1, Exit Message: "oom killed"' },
          { Type: "Not Restarting", Time: t(3), DisplayMessage: "Exceeded allowed attempts 2 in interval 30m0s" },
        ],
      },
      logshipper: { State: "dead", Failed: false },
    },
  }),
  alloc({ ID: "old-alloc", Name: "api.web[0]", DesiredStatus: "stop", ClientStatus: "complete", CreateTime: t(600) }),
  ...[1, 2, 3].map((i) =>
    alloc({ ID: `w${i}`, Name: `worker.work[${i}]`, JobID: "worker", Namespace: "prod", TaskGroup: "work" })
  ),
  // Same job name in another namespace: not the default one's.
  alloc({ ID: "x", JobID: "api", Namespace: "staging", ClientStatus: "failed" }),
  alloc({
    ID: "c1",
    Name: "cleanup/periodic-1761900000.run[0]",
    JobID: "cleanup/periodic-1761900000",
    TaskGroup: "run",
    ClientStatus: "failed",
    CreateTime: t(5),
  }),
  alloc({
    ID: "c0",
    Name: "cleanup/periodic-1761800000.run[0]",
    JobID: "cleanup/periodic-1761800000",
    TaskGroup: "run",
    ClientStatus: "complete",
    CreateTime: t(65),
  }),
];

Deno.test("job health from allocations", () => {
  const byId = Object.fromEntries(JOBS.map((j) => [j.ID, jobView(j, ALLOCS)]));
  assertEquals(byId.api.health, "degraded");
  assertEquals([byId.api.running, byId.api.wanted, byId.api.failed, byId.api.restarts], [1, 2, 1, 5]);
  // Failed: 1 in the summary is history: the allocations are fine now.
  assertEquals(byId.worker.health, "running");
  assertEquals(jobCount(byId.worker), "3/3");
  assertEquals(byId.cleanup.health, "failing");
  assertEquals(jobCount(byId.cleanup), "14 runs");
  assertEquals(byId.migrate.health, "complete");
  assertEquals(byId.old.health, "stopped");
  assertEquals(byId.gpu.health, "pending");
  assertEquals(jobCount(byId.gpu), "0/1");
  assertEquals(jobView({ ...JOBS[0], Status: "dead" }, []).health, "failing");
});

Deno.test("jobs: children hidden, failing first", () => {
  assertEquals(jobViews(JOBS, ALLOCS).map((v) => `${v.job.ID}:${v.health}`), [
    "cleanup:failing",
    "api:degraded",
    "gpu:pending",
    "worker:running",
    "migrate:complete",
    "old:stopped",
  ]);
});

Deno.test("allocations: names, order, main task, events", () => {
  assertEquals(allocShortName(ALLOCS[0]), "web[0]");
  assertEquals(allocShortName(ALLOCS[7]), "run[0]");
  assertEquals(sortAllocs(ALLOCS.slice(0, 3)).map((a) => a.ID.slice(-1)), ["2", "1", "c"]);
  assertEquals(mainTask(ALLOCS[1]), "server");
  assertEquals(mainTask(ALLOCS[0]), "server");
  assertEquals(mainTask(alloc({ TaskStates: null })), undefined);
  const md = allocMarkdown(ALLOCS[1], NOW);
  assert(md.includes("### server · failed · 3 restarts"));
  assert(md.indexOf("Not Restarting") < md.indexOf("Terminated"));
  assert(md.includes("**Terminated** 4 min ago · Exit Code: 1"));
  assert(md.includes("### logshipper · dead"));
});

Deno.test("consul services from the UI endpoint and from the catalog", () => {
  const ui = fromUiServices([
    {
      Name: "web",
      Datacenter: "dc1",
      Tags: ["v2", "http"],
      Nodes: ["n1", "n2", "n1"],
      InstanceCount: 3,
      ChecksPassing: 5,
      ChecksWarning: 0,
      ChecksCritical: 1,
      ExternalSources: ["nomad"],
    },
    { Name: "consul", Nodes: ["n1"], InstanceCount: 1, ChecksPassing: 1, Tags: null },
    { Name: "legacy", InstanceCount: 1 },
  ]);
  assertEquals(ui[0].nodes, ["n1", "n2"]);
  assertEquals(sortServices(ui).map((s) => `${s.name}:${serviceHealth(s)}`), [
    "web:critical",
    "consul:passing",
    "legacy:none",
  ]);

  const checks = [
    {
      Node: "n1",
      CheckID: "serfHealth",
      Name: "Serf Health Status",
      Status: "passing",
      ServiceID: "",
      ServiceName: "",
    },
    { Node: "n2", CheckID: "serfHealth", Name: "Serf Health Status", Status: "critical", ServiceID: "" },
    { Node: "n1", CheckID: "service:web-1", Name: "http", Status: "passing", ServiceID: "web-1", ServiceName: "web" },
    { Node: "n2", CheckID: "service:web-2", Name: "http", Status: "warning", ServiceID: "web-2", ServiceName: "web" },
  ];
  const cat = fromCatalog({ web: ["http"], db: null }, checks);
  assertEquals(cat[0], {
    name: "web",
    tags: ["http"],
    instances: 2,
    nodes: ["n1", "n2"],
    passing: 1,
    warning: 1,
    critical: 0,
    sources: [],
  });
  assertEquals(cat[1].instances, undefined);
  assertEquals(nodeProblems(checks).map((c) => c.Node), ["n2"]);
});

Deno.test("consul instances", () => {
  const e: ServiceEntry = {
    Node: { Node: "n1", Address: "10.0.0.5" },
    Service: { ID: "web-1", Service: "web", Address: "", Port: 8080, Tags: ["v2"] },
    Checks: [
      { Node: "n1", CheckID: "serfHealth", Name: "Serf Health Status", Status: "passing", Output: "Agent alive" },
      {
        Node: "n1",
        CheckID: "service:web-1",
        Name: "HTTP /health",
        Status: "critical",
        Output: "HTTP GET http://10.0.0.5:8080/health: 503 Service Unavailable",
      },
    ],
  };
  assertEquals(instanceAddress(e), "10.0.0.5:8080");
  assertEquals(instanceAddress({ ...e, Service: { ...e.Service, Address: "fd00::1", Port: 80 } }), "[fd00::1]:80");
  assertEquals(instanceHealth(e), "critical");
  const md = checksMarkdown(e);
  assert(md.indexOf("HTTP /health · critical") < md.indexOf("Serf Health Status"));
  assert(md.includes("503 Service Unavailable"));
  assertEquals(checksMarkdown({ ...e, Checks: [] }), "_No health checks._");
});

Deno.test("addresses and configuration", () => {
  assertEquals(normalizeUrl("nomad.lan:4646/ui/jobs"), "http://nomad.lan:4646");
  assertEquals(normalizeUrl("https://consul.ts.net/v1/"), "https://consul.ts.net");
  assertEquals(normalizeUrl("", "http://127.0.0.1:4646"), "http://127.0.0.1:4646");
  const n = nomadConfig({ nomadAddress: "192.168.1.20:4646", nomadToken: " secret " });
  assertEquals([n.url, n.token], ["http://192.168.1.20:4646", "secret"]);
  assertEquals(nomadConfig({ nomadAddress: "nomad.lan", nomadNamespace: "prod" }).scope, "prod");
  assertEquals(consulConfig({ consulAddress: "consul.service.consul:8500" }).url, "http://consul.service.consul:8500");
  assertThrows(() => nomadConfig({ nomadAddress: "nomad.example.com" }), SetupError, "outside the networks");
  assertEquals(
    nomadJobUrl(n, { ...JOBS[1] }),
    "http://192.168.1.20:4646/ui/jobs/worker@prod",
  );
  assertEquals(nomadJobUrl(n, JOBS[0]), "http://192.168.1.20:4646/ui/jobs/api");
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("nomad.home.arpa"));
  assert(isAllowedHost("100.101.102.103"));
  assert(isAllowedHost("172.20.0.4"));
  assert(!isAllowedHost("172.32.0.4"));
  assert(!isAllowedHost("nomad.example.com"));
});

Deno.test("formatting", () => {
  assertEquals(age(NOW - 90_000, NOW), "1 min");
  assertEquals(age(NOW - 3 * 86_400_000, NOW), "3 d");
  assertEquals(age(0, NOW), "");
  assertEquals(tail("a\nb\nc\n", 2), "b\nc");
});
