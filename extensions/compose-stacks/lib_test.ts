import { assert, assertEquals } from "@std/assert";
import {
  buildStacks,
  cleanError,
  composeCommand,
  dirname,
  exitCodeOf,
  forgetStack,
  healthOf,
  logsCommand,
  parseComposeLs,
  parseDockerPs,
  parseJsonRecords,
  parseLabels,
  parsePodmanPs,
  parsePortArray,
  parsePortString,
  pullScript,
  rebuildScript,
  remember,
  servicesTable,
  stackPorts,
  stackState,
  stackSummary,
  tildify,
} from "./lib.ts";

// docker compose ls --all --format json (Compose v2.2x).
const LS =
  `[{"Name":"shop","Status":"running(2), exited(1)","ConfigFiles":"/home/ada/code/shop/compose.yaml,/home/ada/code/shop/compose.override.yaml"},{"Name":"blog","Status":"exited(2)","ConfigFiles":"/home/ada/code/blog/docker-compose.yml"}]`;

// docker ps -a --filter label=com.docker.compose.project --format json: one object per line.
const DOCKER_PS = [
  {
    Command: '"docker-entrypoint.s…"',
    CreatedAt: "2026-10-30 09:12:01 +0100 CET",
    ID: "3f2a9c1b7d4e5f60718293a4b5c6d7e8",
    Image: "postgres:16",
    Labels:
      "com.docker.compose.config-hash=ab12,com.docker.compose.container-number=1,com.docker.compose.oneoff=False,com.docker.compose.project=shop,com.docker.compose.project.config_files=/home/ada/code/shop/compose.yaml,/home/ada/code/shop/compose.override.yaml,com.docker.compose.project.working_dir=/home/ada/code/shop,com.docker.compose.service=db,com.docker.compose.version=2.29.1",
    Names: "shop-db-1",
    Ports: "0.0.0.0:5432->5432/tcp, :::5432->5432/tcp",
    RunningFor: "2 hours ago",
    State: "running",
    Status: "Up 2 hours (healthy)",
  },
  {
    ID: "8e7d6c5b4a39",
    Image: "ghcr.io/ada/shop-web:latest",
    Labels:
      "com.docker.compose.project=shop,com.docker.compose.service=web,com.docker.compose.project.working_dir=/home/ada/code/shop,com.docker.compose.project.config_files=/home/ada/code/shop/compose.yaml,/home/ada/code/shop/compose.override.yaml,com.docker.compose.oneoff=False",
    Names: "shop-web-1",
    Ports: "0.0.0.0:8080->3000/tcp, [::]:8080->3000/tcp",
    State: "running",
    Status: "Up 2 hours (unhealthy)",
  },
  {
    ID: "1a2b3c4d5e6f",
    Image: "ghcr.io/ada/shop-web:latest",
    Labels:
      "com.docker.compose.project=shop,com.docker.compose.service=migrate,com.docker.compose.project.working_dir=/home/ada/code/shop,com.docker.compose.oneoff=False",
    Names: "shop-migrate-1",
    Ports: "",
    State: "exited",
    Status: "Exited (0) 2 hours ago",
  },
  {
    ID: "9f9f9f9f9f9f",
    Image: "ghcr.io/ada/shop-web:latest",
    Labels: "com.docker.compose.project=shop,com.docker.compose.service=web,com.docker.compose.oneoff=True",
    Names: "shop-web-run-5c1d",
    Ports: "",
    State: "exited",
    Status: "Exited (0) 1 hour ago",
  },
  {
    ID: "aaaabbbbcccc",
    Image: "ghost:5",
    Labels:
      "com.docker.compose.project=blog,com.docker.compose.service=ghost,com.docker.compose.project.working_dir=/home/ada/code/blog,com.docker.compose.project.config_files=/home/ada/code/blog/docker-compose.yml",
    Names: "blog-ghost-1",
    Ports: "",
    State: "exited",
    Status: "Exited (137) 3 days ago",
  },
].map((r) => JSON.stringify(r)).join("\n");

// podman ps -a --format json (Podman 5, podman-compose 1.2).
const PODMAN_PS = JSON.stringify([
  {
    AutoRemove: false,
    Command: ["redis-server"],
    CreatedAt: "3 hours ago",
    Exited: false,
    ExitCode: 0,
    Id: "c0ffee0123456789abcdef",
    Image: "docker.io/library/redis:7",
    Labels: {
      "com.docker.compose.container-number": "1",
      "com.docker.compose.project": "cache",
      "com.docker.compose.project.config_files": "compose.yml",
      "com.docker.compose.project.working_dir": "/home/ada/cache",
      "com.docker.compose.service": "redis",
      "io.podman.compose.project": "cache",
      "io.podman.compose.version": "1.2.0",
      PODMAN_SYSTEMD_UNIT: "podman-compose@cache.service",
    },
    Names: ["cache_redis_1"],
    Ports: [{ host_ip: "", container_port: 6379, host_port: 6379, range: 1, protocol: "tcp" }],
    State: "running",
    Status: "Up 3 hours",
  },
  {
    Id: "deadbeef0000",
    Image: "docker.io/library/alpine:3",
    Labels: { app: "standalone" },
    Names: ["lonely"],
    Ports: null,
    State: "running",
    Status: "Up 1 minute",
  },
]);

Deno.test("json records: arrays and one object per line", () => {
  assertEquals(parseJsonRecords(""), []);
  assertEquals(parseJsonRecords('[{"a":1}]'), [{ a: 1 }]);
  assertEquals(parseJsonRecords('{"a":1}\n{"a":2}\n'), [{ a: 1 }, { a: 2 }]);
});

Deno.test("compose ls with several config files", () => {
  assertEquals(parseComposeLs(LS), [
    {
      name: "shop",
      status: "running(2), exited(1)",
      configFiles: ["/home/ada/code/shop/compose.yaml", "/home/ada/code/shop/compose.override.yaml"],
    },
    { name: "blog", status: "exited(2)", configFiles: ["/home/ada/code/blog/docker-compose.yml"] },
  ]);
});

Deno.test("labels: commas inside a value stay in it", () => {
  const l = parseLabels(
    "com.docker.compose.project=shop,com.docker.compose.project.config_files=/a/compose.yaml,/a/override.yaml,com.docker.compose.service=db",
  );
  assertEquals(l["com.docker.compose.project.config_files"], "/a/compose.yaml,/a/override.yaml");
  assertEquals(l["com.docker.compose.service"], "db");
  assertEquals(parseLabels({ a: "1" }), { a: "1" });
  assertEquals(parseLabels(undefined), {});
});

Deno.test("health, exit codes and ports", () => {
  assertEquals(healthOf("Up 2 hours (healthy)"), "healthy");
  assertEquals(healthOf("Up 3 seconds (health: starting)"), "starting");
  assertEquals(healthOf("Up 2 hours (unhealthy)"), "unhealthy");
  assertEquals(healthOf("Up 2 hours"), undefined);
  assertEquals(exitCodeOf("Exited (137) 3 days ago"), 137);
  assertEquals(exitCodeOf("Up 1 minute"), undefined);
  assertEquals(parsePortString("0.0.0.0:8080->3000/tcp, [::]:8080->3000/tcp, 9000/tcp, 0.0.0.0:53->53/udp"), [
    { host: 8080, container: 3000, protocol: "tcp" },
    { host: 53, container: 53, protocol: "udp" },
  ]);
  assertEquals(parsePortString("127.0.0.1:9000-9001->9000-9001/tcp"), [{
    host: 9000,
    container: 9000,
    protocol: "tcp",
  }]);
  assertEquals(parsePortArray([{ host_port: 6379, container_port: 6379, protocol: "tcp" }, { host_port: 0 }]), [
    { host: 6379, container: 6379, protocol: "tcp" },
  ]);
  assertEquals(parsePortArray(null), []);
});

Deno.test("docker ps: compose containers, without one-off runs", () => {
  const s = parseDockerPs(DOCKER_PS);
  assertEquals(s.map((x) => `${x.project}/${x.service}`), ["shop/db", "shop/web", "shop/migrate", "blog/ghost"]);
  assertEquals(s[0].id, "3f2a9c1b7d4e");
  assertEquals(s[0].health, "healthy");
  assertEquals(s[0].ports, [{ host: 5432, container: 5432, protocol: "tcp" }]);
  assertEquals(s[0].configFiles, ["/home/ada/code/shop/compose.yaml", "/home/ada/code/shop/compose.override.yaml"]);
  assertEquals(s[1].health, "unhealthy");
  assertEquals(s[2].exitCode, 0);
  assertEquals(s[3].exitCode, 137);
});

Deno.test("podman ps: labels object, names array, port objects", () => {
  const s = parsePodmanPs(PODMAN_PS);
  assertEquals(s.length, 1);
  assertEquals(s[0].project, "cache");
  assertEquals(s[0].container, "cache_redis_1");
  assertEquals(s[0].ports, [{ host: 6379, container: 6379, protocol: "tcp" }]);
  assertEquals(s[0].workingDir, "/home/ada/cache");
});

Deno.test("stack states", () => {
  const [db, web, migrate, ghost] = parseDockerPs(DOCKER_PS);
  assertEquals(stackState([]), "down");
  assertEquals(stackState([db, web]), "problem");
  assertEquals(stackState([db, migrate]), "running");
  assertEquals(stackState([db, { ...ghost, exitCode: undefined, state: "created" }]), "partial");
  assertEquals(stackState([{ ...ghost, exitCode: 0 }]), "stopped");
  assertEquals(stackState([ghost]), "problem");
});

Deno.test("stacks: listed, from containers and remembered, problems first", () => {
  const stacks = buildStacks("docker", parseComposeLs(LS), parseDockerPs(DOCKER_PS), [
    { name: "old", engine: "docker", configFiles: ["/srv/old/compose.yml"] },
    { name: "shop", engine: "docker", configFiles: ["/stale.yml"] },
    { name: "pod", engine: "podman", configFiles: ["/srv/pod/compose.yml"] },
  ]);
  assertEquals(stacks.map((s) => [s.name, s.state]), [["blog", "problem"], ["shop", "problem"], ["old", "down"]]);
  const shop = stacks[1];
  assertEquals(shop.services.map((s) => s.service), ["db", "migrate", "web"]);
  assertEquals(shop.configFiles[1], "/home/ada/code/shop/compose.override.yaml");
  assertEquals(shop.workingDir, "/home/ada/code/shop");
  assertEquals(stacks[2].remembered, true);
  assertEquals(stacks[2].workingDir, "/srv/old");
  assertEquals(stackSummary(shop), "2/3 running");
  assertEquals(stackSummary(stacks[2]), "down");
  assertEquals(stackSummary(stacks[0]), "stopped");
  assertEquals(stackPorts(shop).map((p) => `${p.host}:${p.service}`), ["5432:db", "8080:web"]);
  assert(servicesTable(shop).includes("| web | unhealthy | 8080 | ghcr.io/ada/shop-web:latest |"));
  assert(servicesTable(stacks[2]).includes("down"));

  const podman = buildStacks("podman", [], parsePodmanPs(PODMAN_PS));
  assertEquals(podman.map((s) => [s.name, s.state, s.configFiles]), [["cache", "running", [
    "/home/ada/cache/compose.yml",
  ]]]);
});

Deno.test("remembering stacks across visits", () => {
  const stacks = buildStacks("docker", parseComposeLs(LS), parseDockerPs(DOCKER_PS), [
    { name: "old", engine: "docker", configFiles: ["/srv/old/compose.yml"] },
  ]);
  const kept = remember([{ name: "old", engine: "docker", configFiles: ["/srv/old/compose.yml"] }], stacks);
  assertEquals(kept.map((k) => k.name), ["blog", "shop", "old"]);
  assertEquals(kept[1].workingDir, "/home/ada/code/shop");
  assertEquals(forgetStack(kept, { name: "old", engine: "docker" }).map((k) => k.name), ["blog", "shop"]);
});

Deno.test("command lines", () => {
  const [, shop] = buildStacks("docker", parseComposeLs(LS), parseDockerPs(DOCKER_PS));
  assertEquals(composeCommand(shop, "up", "-d"), [
    "docker",
    "compose",
    "-p",
    "shop",
    "-f",
    "/home/ada/code/shop/compose.yaml",
    "-f",
    "/home/ada/code/shop/compose.override.yaml",
    "up",
    "-d",
  ]);
  assertEquals(logsCommand(shop, "web", true).slice(-4), ["--follow", "--tail", "100", "web"]);
  assertEquals(logsCommand(shop).slice(-4), ["logs", "--no-color", "--tail", "200"]);
  const pull = pullScript(shop, "web");
  assertEquals(pull.slice(0, 2), ["sh", "-c"]);
  assert(pull[2].includes("pull web && docker compose -p shop"));
  assert(pull[2].includes("read -r _"));
  assert(rebuildScript(shop)[2].includes("up -d --build\n"));
});

Deno.test("paths and errors", () => {
  assertEquals(dirname("/home/ada/shop/compose.yaml"), "/home/ada/shop");
  assertEquals(dirname("/compose.yaml"), "/");
  assertEquals(tildify("/home/ada/shop", "/home/ada"), "~/shop");
  assertEquals(tildify("/home/adam/x", "/home/ada"), "/home/adam/x");
  assertEquals(
    cleanError(new Error("docker exited with 1: no configuration file provided: not found")),
    "no configuration file provided: not found",
  );
});
