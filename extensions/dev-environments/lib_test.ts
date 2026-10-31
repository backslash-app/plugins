import { assert, assertEquals } from "@std/assert";
import {
  ago,
  coderState,
  coderUrl,
  coderWebUrl,
  codespaceState,
  codespaceVscodeUrl,
  devpodState,
  gitSummary,
  isTransitional,
  parseCoder,
  parseCodespaces,
  parseDevpod,
  parseDevpodStatus,
  shellLine,
  sortWorkspaces,
  stateLook,
  terminalScript,
  until,
} from "./lib.ts";

// GET https://api.github.com/user/codespaces (abridged)
const CODESPACES = {
  total_count: 2,
  codespaces: [
    {
      id: 12345678,
      name: "ada-shop-r4q9w7xj2f6g",
      display_name: "special space",
      environment_id: "26a7c758-7299-4a73-b978-5a92a7ae98a0",
      owner: { login: "ada" },
      repository: { id: 1, full_name: "acme/shop", html_url: "https://github.com/acme/shop" },
      machine: {
        name: "standardLinux32gb",
        display_name: "4 cores, 16 GB RAM, 32 GB storage",
        cpus: 4,
        memory_in_bytes: 17179869184,
      },
      prebuild: false,
      devcontainer_path: ".devcontainer/devcontainer.json",
      created_at: "2024-10-01T10:00:00Z",
      updated_at: "2024-10-29T17:00:00Z",
      last_used_at: "2024-10-29T17:00:00Z",
      state: "Available",
      url: "https://api.github.com/user/codespaces/ada-shop-r4q9w7xj2f6g",
      git_status: {
        ahead: 2,
        behind: 0,
        has_unpushed_changes: true,
        has_uncommitted_changes: true,
        ref: "feature/cart",
      },
      location: "WestEurope",
      idle_timeout_minutes: 30,
      web_url: "https://ada-shop-r4q9w7xj2f6g.github.dev",
      start_url: "https://api.github.com/user/codespaces/ada-shop-r4q9w7xj2f6g/start",
      stop_url: "https://api.github.com/user/codespaces/ada-shop-r4q9w7xj2f6g/stop",
    },
    {
      id: 2,
      name: "ada-docs-xyz",
      display_name: null,
      owner: { login: "ada" },
      repository: { full_name: "acme/docs", html_url: "https://github.com/acme/docs" },
      machine: null,
      state: "Shutdown",
      git_status: { ahead: 0, behind: 3, has_unpushed_changes: false, has_uncommitted_changes: false, ref: "main" },
      last_used_at: "2024-10-20T09:00:00Z",
    },
    { id: 3 },
  ],
};

Deno.test("parseCodespaces", () => {
  const [shop, docs] = parseCodespaces(CODESPACES);
  assertEquals(parseCodespaces(CODESPACES).length, 2);
  assertEquals(shop.id, "ada-shop-r4q9w7xj2f6g");
  assertEquals(shop.title, "special space");
  assertEquals(shop.state, "running");
  assertEquals(shop.repo, "acme/shop");
  assertEquals(shop.branch, "feature/cart");
  assertEquals(shop.machine, "4 cores, 16 GB RAM, 32 GB storage");
  assertEquals(shop.idleTimeoutMinutes, 30);
  assertEquals([shop.ahead, shop.uncommitted, shop.unpushed], [2, true, true]);
  assertEquals(docs.title, "ada-docs-xyz");
  assertEquals(docs.state, "stopped");
  assertEquals(docs.machine, undefined);
  assertEquals(parseCodespaces({ message: "Bad credentials" }), []);
});

Deno.test("codespaceState maps GitHub's states", () => {
  assertEquals(codespaceState("Available"), "running");
  assertEquals(codespaceState("Shutdown"), "stopped");
  assertEquals(codespaceState("Provisioning"), "starting");
  assertEquals(codespaceState("ShuttingDown"), "stopping");
  assertEquals(codespaceState("Failed"), "failed");
  assertEquals(codespaceState("Whatever"), "unknown");
});

Deno.test("codespaceVscodeUrl", () => {
  assertEquals(codespaceVscodeUrl("ada-shop-1"), "vscode://github.codespaces/connect?name=ada-shop-1&windowId=_blank");
});

// coder list -o json (Coder v2.15, abridged)
const CODER = JSON.stringify([
  {
    id: "1e3b",
    created_at: "2024-09-01T08:00:00Z",
    updated_at: "2024-10-30T08:00:00Z",
    owner_id: "u1",
    owner_name: "ada",
    organization_name: "coder",
    template_id: "t1",
    template_name: "docker",
    template_display_name: "Docker Containers",
    template_icon: "/icon/docker.png",
    latest_build: {
      id: "b1",
      transition: "start",
      status: "running",
      deadline: "2024-10-30T18:00:00Z",
      resources: [{ agents: [{ name: "main", status: "connected", lifecycle_state: "ready" }] }],
    },
    outdated: true,
    name: "backend",
    ttl_ms: 28800000,
    last_used_at: "2024-10-30T09:30:00Z",
    health: { healthy: true, failing_agents: [] },
  },
  {
    id: "2f4c",
    owner_name: "ada",
    template_name: "kubernetes",
    template_display_name: "",
    latest_build: { transition: "stop", status: "stopped", resources: [] },
    outdated: false,
    name: "ml",
    last_used_at: "2024-10-12T09:30:00Z",
  },
]);

Deno.test("parseCoder", () => {
  const [backend, ml] = parseCoder(CODER);
  assertEquals(backend.id, "ada/backend");
  assertEquals(backend.title, "backend");
  assertEquals(backend.state, "running");
  assertEquals(backend.template, "Docker Containers");
  assertEquals(backend.outdated, true);
  assertEquals(backend.healthy, true);
  assertEquals(backend.deadline, "2024-10-30T18:00:00Z");
  assertEquals(ml.state, "stopped");
  assertEquals(ml.template, "kubernetes");
  assertEquals(ml.healthy, undefined);
  assertEquals(parseCoder("error: You are not logged in"), []);
  assertEquals(parseCoder("null"), []);
});

Deno.test("coderState", () => {
  assertEquals(coderState("pending"), "starting");
  assertEquals(coderState("canceling"), "stopping");
  assertEquals(coderState("canceled"), "stopped");
  assertEquals(coderState("deleting"), "deleting");
  assertEquals(coderState("failed"), "failed");
});

Deno.test("coderUrl and coderWebUrl", () => {
  assertEquals(coderUrl("https://coder.acme.dev/\n"), "https://coder.acme.dev");
  assertEquals(coderUrl(""), undefined);
  assertEquals(coderUrl("garbage"), undefined);
  const [backend] = parseCoder(CODER);
  assertEquals(coderWebUrl("https://coder.acme.dev", backend), "https://coder.acme.dev/@ada/backend");
});

// devpod list --output json (DevPod 0.5)
const DEVPOD = JSON.stringify([
  {
    id: "vscode-remote-try-node",
    uid: "default-vs-1c2a3",
    folder: "/home/ada/.devpod/contexts/default/workspaces/vscode-remote-try-node",
    picture: "https://avatars.githubusercontent.com/u/6154722?v=4",
    provider: { name: "docker" },
    machine: {},
    ide: { name: "vscode" },
    source: { gitRepository: "https://github.com/microsoft/vscode-remote-try-node.git", gitBranch: "main" },
    creationTimestamp: "2024-10-02T10:00:00Z",
    lastUsed: "2024-10-28T10:00:00Z",
    context: "default",
  },
  {
    id: "notes",
    provider: { name: "kubernetes" },
    ide: { name: "none" },
    source: { localFolder: "/home/ada/notes" },
    lastUsed: "2024-10-30T08:00:00Z",
  },
]);

Deno.test("parseDevpod and its status", () => {
  const [node, notes] = parseDevpod(DEVPOD);
  assertEquals(node.repo, "github.com/microsoft/vscode-remote-try-node");
  assertEquals(node.repoUrl, "https://github.com/microsoft/vscode-remote-try-node");
  assertEquals(node.branch, "main");
  assertEquals(node.backend, "docker");
  assertEquals(node.state, "unknown");
  assertEquals(notes.repo, "/home/ada/notes");
  assertEquals(notes.repoUrl, undefined);
  assertEquals(parseDevpod("[]"), []);
  assertEquals(parseDevpod("not json"), []);
  assertEquals(
    parseDevpodStatus('{"id":"notes","context":"default","provider":"docker","state":"Running"}'),
    "Running",
  );
  assertEquals(parseDevpodStatus("info Workspace 'notes' is 'Stopped'"), "Stopped");
  assertEquals(parseDevpodStatus(""), "Unknown");
  assertEquals(devpodState("Busy"), "starting");
  assertEquals(devpodState("NotFound"), "failed");
});

Deno.test("sortWorkspaces: running, then changing, then recently used", () => {
  const list = [...parseCodespaces(CODESPACES), ...parseCoder(CODER), ...parseDevpod(DEVPOD)];
  list[4] = { ...list[4], state: "starting" };
  assertEquals(sortWorkspaces(list).map((w) => w.title), [
    "backend",
    "special space",
    "vscode-remote-try-node",
    "notes",
    "ada-docs-xyz",
    "ml",
  ]);
});

Deno.test("stateLook and isTransitional", () => {
  assertEquals(stateLook("running").tint, "green");
  assertEquals(stateLook("stopped").text, "Stopped");
  assertEquals(stateLook("unknown").text, "Unknown");
  assert(isTransitional("starting"));
  assert(!isTransitional("running"));
});

Deno.test("ago, until and gitSummary", () => {
  const now = new Date("2024-10-30T10:00:00Z");
  assertEquals(ago("2024-10-30T09:30:00Z", now), "30m ago");
  assertEquals(ago("2024-10-28T10:00:00Z", now), "2d ago");
  assertEquals(ago(undefined, now), "");
  assertEquals(until("2024-10-30T18:00:00Z", now), "in 8h");
  assertEquals(until("2024-10-30T10:45:00Z", now), "in 45m");
  assertEquals(until("2024-10-30T09:00:00Z", now), "");
  const [shop, docs] = parseCodespaces(CODESPACES);
  assertEquals(gitSummary(shop), "↑2, uncommitted changes");
  assertEquals(gitSummary(docs), "↓3");
});

Deno.test("shellLine and terminalScript", () => {
  assertEquals(shellLine(["coder", "ssh", "ada/backend"]), "coder ssh ada/backend");
  assertEquals(shellLine(["echo", "it's"]), `echo 'it'\\''s'`);
  const script = terminalScript(["devpod", "up", "notes"], true);
  assert(script.includes("\ndevpod up notes\n"));
  assert(script.includes("Done."));
  assert(!terminalScript(["coder", "ssh", "x"]).includes("Done."));
});
