import { assertEquals } from "@std/assert";
import {
  age,
  classifyError,
  installCommand,
  instanceConsoleUrl,
  instanceHealth,
  instanceLogsCommand,
  lastSegment,
  osFamily,
  parseConfig,
  parseInstances,
  parseProjects,
  parseServices,
  serviceConsoleUrl,
  serviceHealth,
  shortImage,
  sortInstances,
  sshCommand,
  statusLabel,
  tailServiceCommand,
  zoneRegion,
} from "./lib.ts";
import { holdOpen, terminalArgs } from "./terminal.ts";

Deno.test("config", () => {
  assertEquals(
    parseConfig(
      JSON.stringify({ core: { project: "acme-prod", account: "a@acme.io" }, compute: { zone: "europe-west1-b" } }),
    ),
    { project: "acme-prod", account: "a@acme.io", region: undefined, zone: "europe-west1-b" },
  );
  assertEquals(parseConfig("{}").project, undefined);
});

Deno.test("projects", () => {
  const projects = parseProjects(JSON.stringify([
    { lifecycleState: "ACTIVE", name: "Zeta", projectId: "zeta-1", projectNumber: 2 },
    {
      createTime: "2023-02-01T10:00:00.000Z",
      lifecycleState: "ACTIVE",
      name: "Acme Production",
      parent: { id: "4455", type: "organization" },
      projectId: "acme-prod",
      projectNumber: "123456789012",
      labels: { env: "prod" },
    },
  ]));
  assertEquals(projects.map((p) => p.id), ["acme-prod", "zeta-1"]);
  assertEquals(projects[0].parent, "organization 4455");
  assertEquals(projects[1].number, "2");
});

const Z = "https://www.googleapis.com/compute/v1/projects/acme-prod/zones/";

Deno.test("Compute Engine instances", () => {
  const all = parseInstances(JSON.stringify([
    {
      id: "8812345678901234567",
      name: "web-1",
      zone: `${Z}europe-west1-b`,
      status: "RUNNING",
      machineType: `${Z}europe-west1-b/machineTypes/e2-medium`,
      networkInterfaces: [{
        networkIP: "10.132.0.2",
        network: "https://www.googleapis.com/compute/v1/projects/acme-prod/global/networks/default",
        accessConfigs: [{ name: "External NAT", natIP: "34.77.12.9" }],
      }],
      tags: { items: ["http-server"] },
      disks: [{ boot: true, licenses: ["https://x/licenses/debian-12-bookworm"] }],
    },
    { id: "2", name: "batch", zone: `${Z}europe-west4-a`, status: "TERMINATED", scheduling: { preemptible: true } },
    { id: "3", name: "db", zone: `${Z}us-central1-a`, status: "STAGING" },
  ]));
  assertEquals(all[0].zone, "europe-west1-b");
  assertEquals(all[0].machineType, "e2-medium");
  assertEquals(all[0].externalIp, "34.77.12.9");
  assertEquals(all[0].network, "default");
  assertEquals(all[0].os, "debian-12-bookworm");
  assertEquals(all[1].spot, true);
  assertEquals(all[1].internalIp, undefined);
  assertEquals(sortInstances(all).map((i) => i.name), ["db", "web-1", "batch"]);
  assertEquals(instanceHealth("TERMINATED"), "off");
  assertEquals(instanceHealth("REPAIRING"), "busy");
  assertEquals(statusLabel("TERMINATED"), "Stopped");
  assertEquals(statusLabel("RUNNING"), "Running");
  assertEquals(zoneRegion("europe-west1-b"), "europe-west1");
  assertEquals(lastSegment(undefined), "");
  assertEquals(sshCommand(all[0], "acme-prod"), [
    "gcloud",
    "compute",
    "ssh",
    "web-1",
    "--zone=europe-west1-b",
    "--project=acme-prod",
  ]);
  assertEquals(
    instanceConsoleUrl(all[0], "acme-prod"),
    "https://console.cloud.google.com/compute/instancesDetail/zones/europe-west1-b/instances/web-1?project=acme-prod",
  );
  assertEquals(
    instanceLogsCommand(all[0], "p")[3],
    'resource.type="gce_instance" AND resource.labels.instance_id="8812345678901234567"',
  );
});

Deno.test("Cloud Run services", () => {
  const services = parseServices(JSON.stringify([
    {
      metadata: {
        name: "worker",
        labels: { "cloud.googleapis.com/location": "europe-west1" },
        annotations: { "serving.knative.dev/lastModifier": "ci@acme.iam.gserviceaccount.com" },
      },
      spec: {
        template: { spec: { containers: [{ image: "europe-docker.pkg.dev/acme/apps/worker@sha256:1a2b3c4d5e6f" }] } },
      },
      status: {
        url: "https://worker-abc-ew.a.run.app",
        latestReadyRevisionName: "worker-00042-xiz",
        conditions: [{
          type: "Ready",
          status: "False",
          reason: "RevisionFailed",
          message: "Container failed to start",
          lastTransitionTime: "2026-10-27T15:00:00Z",
        }],
        traffic: [{ revisionName: "worker-00042-xiz", percent: 100, latestRevision: true }],
      },
    },
    { metadata: { name: "api", labels: { "cloud.googleapis.com/location": "us-central1" } }, status: {} },
  ]));
  assertEquals(services.map((s) => s.name), ["api", "worker"]);
  const w = services[1];
  assertEquals(serviceHealth(w), "failed");
  assertEquals(serviceHealth(services[0]), "busy");
  assertEquals(w.reason, "RevisionFailed");
  assertEquals(w.modifier, "ci@acme.iam.gserviceaccount.com");
  assertEquals(w.traffic, [{ revision: "worker-00042-xiz", percent: 100, tag: undefined, latest: true }]);
  assertEquals(shortImage(w.image), "worker@1a2b3c4");
  assertEquals(shortImage("gcr.io/acme/api:1.4"), "api:1.4");
  assertEquals(
    serviceConsoleUrl(w, "acme"),
    "https://console.cloud.google.com/run/detail/europe-west1/worker/metrics?project=acme",
  );
  assertEquals(tailServiceCommand(w, "acme").slice(0, 6), ["gcloud", "beta", "run", "services", "logs", "tail"]);
});

Deno.test("errors", () => {
  const c = (m: string) => classifyError(new Error(`gcloud exited with 1: ${m}`));
  assertEquals(
    c("ERROR: (gcloud.projects.list) You do not currently have an active account selected.\nPlease run:\n\n  $ gcloud auth login")
      .problem,
    "auth",
  );
  assertEquals(
    c("ERROR: (gcloud.projects.list) UNAUTHENTICATED: Request had invalid authentication credentials.\n- '@type': type.googleapis.com/google.rpc.ErrorInfo\n  reason: CREDENTIALS_MISSING")
      .message,
    "ERROR: (gcloud.projects.list) UNAUTHENTICATED: Request had invalid authentication credentials.",
  );
  const api = c(
    "ERROR: (gcloud.compute.instances.list) Compute Engine API has not been used in project 123 before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/compute.googleapis.com/overview?project=123 then retry.\n compute.googleapis.com has not been used",
  );
  assertEquals(api.problem, "api");
  assertEquals(api.api, "compute.googleapis.com");
  assertEquals(
    c("ERROR: (gcloud.run.services.list) PERMISSION_DENIED: Permission 'run.services.list' denied").problem,
    "denied",
  );
  assertEquals(c("ERROR: The required property [project] is not currently set.").problem, "project");
  assertEquals(c("boom").problem, "other");
});

Deno.test("formatting and install hints", () => {
  assertEquals(age(new Date("2026-10-27T15:00:00Z"), new Date("2026-10-28T10:00:00Z")), "19h");
  assertEquals(installCommand(osFamily("ID=arch")), "yay -S google-cloud-cli   # AUR");
  assertEquals(installCommand(osFamily("ID=ubuntu\nID_LIKE=debian")), "sudo snap install google-cloud-cli --classic");
  assertEquals(terminalArgs("foot", ["gcloud", "compute", "ssh", "x"]), ["gcloud", "compute", "ssh", "x"]);
  assertEquals(holdOpen(["gcloud", "auth", "login"])[2].startsWith("gcloud auth login;"), true);
});
