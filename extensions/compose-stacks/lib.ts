// Compose Stacks logic: reading `docker compose ls`, `docker ps` and `podman ps`
// output, grouping containers into projects, and building compose command lines.
// Pure, tested in lib_test.ts.

import { shellLine } from "./terminal.ts";

export type Engine = "docker" | "podman";

export interface Port {
  host: number;
  container: number;
  protocol: string;
}

/** A container of a Compose project. */
export interface Service {
  project: string;
  service: string;
  container: string;
  id: string;
  image: string;
  /** running, exited, created, paused, restarting, dead, removing. */
  state: string;
  /** "Up 2 hours (healthy)", "Exited (1) 3 minutes ago". */
  status: string;
  health?: "healthy" | "unhealthy" | "starting";
  exitCode?: number;
  ports: Port[];
  workingDir?: string;
  configFiles: string[];
}

export type StackState = "problem" | "running" | "partial" | "stopped" | "down";

export interface Stack {
  name: string;
  engine: Engine;
  configFiles: string[];
  workingDir?: string;
  services: Service[];
  state: StackState;
  /** Not seen right now: remembered from an earlier visit (brought down since). */
  remembered?: boolean;
}

/** What is kept in storage to list a stack after `down`. */
export interface Remembered {
  name: string;
  engine: Engine;
  configFiles: string[];
  workingDir?: string;
}

// ---------------------------------------------------------------------------
// Parsing

/** A JSON array, or one JSON object per line (`--format json` changed between Compose versions). */
export function parseJsonRecords(text: string): Record<string, unknown>[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[")) {
    const arr = JSON.parse(t);
    return Array.isArray(arr) ? arr : [];
  }
  return t.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
}

/** `docker compose ls --all --format json`. */
export function parseComposeLs(text: string): { name: string; status: string; configFiles: string[] }[] {
  return parseJsonRecords(text).map((r) => ({
    name: String(r.Name ?? r.name ?? ""),
    status: String(r.Status ?? r.status ?? ""),
    configFiles: splitFiles(String(r.ConfigFiles ?? r.configFiles ?? "")),
  })).filter((s) => s.name);
}

/** `a.yml,b.yml` → paths; Compose joins several -f files with commas. */
export function splitFiles(text: string): string[] {
  return text.split(",").map((f) => f.trim()).filter(Boolean);
}

/**
 * `docker ps --format json` prints labels as `k=v,k=v`, and a value can hold
 * commas itself (several config files): a piece without `=` belongs to the
 * value before it.
 */
export function parseLabels(labels: unknown): Record<string, string> {
  if (labels && typeof labels === "object") {
    return Object.fromEntries(Object.entries(labels as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }
  const out: Record<string, string> = {};
  let last: string | undefined;
  for (const piece of String(labels ?? "").split(",")) {
    const eq = piece.indexOf("=");
    if (eq > 0 && /^[\w.\-/]+$/.test(piece.slice(0, eq))) {
      last = piece.slice(0, eq);
      out[last] = piece.slice(eq + 1);
    } else if (last) {
      out[last] += `,${piece}`;
    }
  }
  return out;
}

/** `Up 2 hours (healthy)` → healthy; `(health: starting)` → starting. */
export function healthOf(status: string): Service["health"] {
  if (/\(unhealthy\)/i.test(status)) return "unhealthy";
  if (/\(health: starting\)|\(starting\)/i.test(status)) return "starting";
  if (/\(healthy\)/i.test(status)) return "healthy";
  return undefined;
}

/** `Exited (137) 2 hours ago` → 137. */
export function exitCodeOf(status: string): number | undefined {
  const m = /^Exited \((-?\d+)\)/i.exec(status.trim());
  return m ? Number(m[1]) : undefined;
}

/** `0.0.0.0:8080->80/tcp, :::8080->80/tcp, 9000/tcp` → published ports, once each. */
export function parsePortString(ports: string | undefined): Port[] {
  const out: Port[] = [];
  for (const m of (ports ?? "").matchAll(/:(\d+)(?:-(\d+))?->(\d+)(?:-\d+)?\/(\w+)/g)) {
    const host = Number(m[1]), container = Number(m[3]), protocol = m[4];
    if (!out.some((p) => p.host === host && p.protocol === protocol)) out.push({ host, container, protocol });
  }
  return out;
}

/** Podman's `Ports`: `[{ host_port, container_port, protocol, range }]`. */
export function parsePortArray(ports: unknown): Port[] {
  if (!Array.isArray(ports)) return [];
  const out: Port[] = [];
  for (const p of ports as Record<string, unknown>[]) {
    const host = Number(p.host_port ?? p.hostPort), container = Number(p.container_port ?? p.containerPort);
    const protocol = String(p.protocol ?? "tcp");
    if (host > 0 && !out.some((x) => x.host === host && x.protocol === protocol)) {
      out.push({ host, container, protocol });
    }
  }
  return out;
}

const COMPOSE = "com.docker.compose";

function serviceFrom(r: Record<string, unknown>, labels: Record<string, string>, ports: Port[]): Service | undefined {
  const project = labels[`${COMPOSE}.project`] ?? labels["io.podman.compose.project"];
  if (!project || /^true$/i.test(labels[`${COMPOSE}.oneoff`] ?? "")) return undefined;
  const names = Array.isArray(r.Names) ? (r.Names as string[]).join(", ") : String(r.Names ?? r.Name ?? "");
  const status = String(r.Status ?? "");
  const state = String(r.State ?? "").toLowerCase() || (/^up/i.test(status) ? "running" : "exited");
  const workingDir = labels[`${COMPOSE}.project.working_dir`] || undefined;
  const code = typeof r.ExitCode === "number" && state === "exited" ? r.ExitCode : exitCodeOf(status);
  return {
    project,
    service: labels[`${COMPOSE}.service`] ?? names,
    container: names.replace(/^\//, ""),
    id: String(r.ID ?? r.Id ?? "").slice(0, 12),
    image: String(r.Image ?? ""),
    state,
    status,
    health: ["healthy", "unhealthy", "starting"].includes(String(r.HealthStatus))
      ? r.HealthStatus as Service["health"]
      : healthOf(status),
    exitCode: code,
    ports,
    workingDir,
    // podman-compose writes the files relative to the project folder.
    configFiles: splitFiles(labels[`${COMPOSE}.project.config_files`] ?? "").map((f) =>
      f.startsWith("/") || !workingDir ? f : `${workingDir.replace(/\/+$/, "")}/${f.replace(/^\.\//, "")}`
    ),
  };
}

/** `docker ps -a --format json` (one object per line), Compose containers only. */
export function parseDockerPs(text: string): Service[] {
  return parseJsonRecords(text)
    .map((r) => serviceFrom(r, parseLabels(r.Labels), parsePortString(String(r.Ports ?? ""))))
    .filter((s): s is Service => !!s);
}

/** `podman ps -a --format json` (an array), Compose containers only. */
export function parsePodmanPs(text: string): Service[] {
  return parseJsonRecords(text)
    .map((r) => serviceFrom(r, parseLabels(r.Labels), parsePortArray(r.Ports)))
    .filter((s): s is Service => !!s);
}

// ---------------------------------------------------------------------------
// Stacks

/** A service that needs a look: crashed, unhealthy, restarting in a loop or dead. */
export function isProblem(s: Service): boolean {
  return s.health === "unhealthy" || s.state === "restarting" || s.state === "dead" ||
    (s.state === "exited" && s.exitCode !== undefined && s.exitCode !== 0);
}

export function stackState(services: Service[]): StackState {
  if (!services.length) return "down";
  if (services.some(isProblem)) return "problem";
  const running = services.filter((s) => s.state === "running").length;
  if (running === services.length) return "running";
  // One-shot services (migrations, init) that exited 0 don't make a stack partial.
  const finished = services.filter((s) => s.state === "exited" && s.exitCode === 0).length;
  if (running && running + finished === services.length) return "running";
  return running ? "partial" : "stopped";
}

const STATE_ORDER: Record<StackState, number> = { problem: 0, partial: 1, running: 2, stopped: 3, down: 4 };

/**
 * The stacks: projects listed by `compose ls`, those found only on
 * containers, and remembered ones that are down now. Problems first.
 */
export function buildStacks(
  engine: Engine,
  listed: { name: string; configFiles: string[] }[],
  services: Service[],
  remembered: Remembered[] = [],
): Stack[] {
  const byName = new Map<string, Stack>();
  const add = (name: string, configFiles: string[], workingDir?: string) => {
    const s = byName.get(name);
    if (s) {
      if (!s.configFiles.length) s.configFiles = configFiles;
      s.workingDir ??= workingDir;
      return s;
    }
    const stack: Stack = { name, engine, configFiles, workingDir, services: [], state: "down" };
    byName.set(name, stack);
    return stack;
  };
  for (const l of listed) add(l.name, l.configFiles);
  for (const svc of services) add(svc.project, svc.configFiles, svc.workingDir).services.push(svc);
  for (const r of remembered) {
    if (r.engine === engine && !byName.has(r.name)) {
      add(r.name, r.configFiles, r.workingDir).remembered = true;
    }
  }
  const stacks = [...byName.values()];
  for (const s of stacks) {
    s.workingDir ??= s.configFiles[0] ? dirname(s.configFiles[0]) : undefined;
    s.services.sort((a, b) => a.service.localeCompare(b.service) || a.container.localeCompare(b.container));
    s.state = stackState(s.services);
  }
  return stacks.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name));
}

/** Remembered stacks after a visit: the ones seen now replace their old entry, newest first, at most 50. */
export function remember(old: Remembered[], stacks: Stack[]): Remembered[] {
  const seen = stacks.filter((s) => !s.remembered && s.configFiles.length).map((s) => ({
    name: s.name,
    engine: s.engine,
    configFiles: s.configFiles,
    ...(s.workingDir ? { workingDir: s.workingDir } : {}),
  }));
  const keys = new Set(seen.map((s) => `${s.engine}/${s.name}`));
  return [...seen, ...old.filter((o) => !keys.has(`${o.engine}/${o.name}`))].slice(0, 50);
}

export function forgetStack(old: Remembered[], stack: Pick<Stack, "name" | "engine">): Remembered[] {
  return old.filter((o) => !(o.name === stack.name && o.engine === stack.engine));
}

export function dirname(path: string): string {
  const i = path.replace(/\/+$/, "").lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}

/** `~/code/shop/compose.yaml` for the home folder. */
export function tildify(path: string, home = ""): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** "3/4 running", "stopped", "down". */
export function stackSummary(s: Stack): string {
  if (!s.services.length) return s.remembered ? "down" : "no containers";
  const running = s.services.filter((x) => x.state === "running").length;
  if (!running) return "stopped";
  return `${running}/${s.services.length} running`;
}

/** Published ports of a stack, once each, in service order. */
export function stackPorts(s: Stack): (Port & { service: string })[] {
  const out: (Port & { service: string })[] = [];
  for (const svc of s.services) {
    for (const p of svc.ports) {
      if (!out.some((o) => o.host === p.host && o.protocol === p.protocol)) out.push({ ...p, service: svc.service });
    }
  }
  return out;
}

/** "running", "healthy", "exited 1", "unhealthy". */
export function serviceLabel(s: Service): string {
  if (s.state === "running") return s.health && s.health !== "healthy" ? s.health : s.health ?? "running";
  if (s.state === "exited") return s.exitCode !== undefined ? `exited ${s.exitCode}` : "exited";
  return s.state;
}

export type Tint = "red" | "orange" | "yellow" | "green" | "gray" | "blue";

export function serviceColor(s: Service): Tint {
  if (isProblem(s)) return "red";
  if (s.state === "running") return s.health === "starting" ? "yellow" : "green";
  if (s.state === "paused" || s.state === "created") return "orange";
  return "gray";
}

export const STACK_COLORS: Record<StackState, Tint> = {
  problem: "red",
  partial: "orange",
  running: "green",
  stopped: "gray",
  down: "gray",
};

/** A Markdown table of the services, for the preview panel. */
export function servicesTable(s: Stack): string {
  if (!s.services.length) {
    return s.remembered
      ? "_The stack is down: no containers. **Up** creates them again from the Compose file._"
      : "_No containers._";
  }
  const esc = (t: string) => t.replace(/\|/g, "\\|");
  return [
    "| Service | State | Ports | Image |",
    "| --- | --- | --- | --- |",
    ...s.services.map((x) =>
      `| ${esc(x.service)} | ${esc(serviceLabel(x))} | ${x.ports.map((p) => p.host).join(", ") || "–"} | ${
        esc(x.image.replace(/^(docker\.io|registry-1\.docker\.io)\/(library\/)?/, ""))
      } |`
    ),
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Command lines

/** `docker compose -p shop -f /…/compose.yaml`: works from anywhere, and after `down`. */
export function composeBase(s: Pick<Stack, "engine" | "name" | "configFiles">): string[] {
  return [s.engine, "compose", "-p", s.name, ...s.configFiles.flatMap((f) => ["-f", f])];
}

export const composeCommand = (s: Pick<Stack, "engine" | "name" | "configFiles">, ...args: string[]) => [
  ...composeBase(s),
  ...args,
];

/** `logs` arguments: the last 200 lines, or following from the last 100. */
export const logsArgs = (service?: string, follow = false) => [
  "logs",
  ...(follow ? ["--follow", "--tail", "100"] : ["--no-color", "--tail", "200"]),
  ...(service ? [service] : []),
];

export const logsCommand = (s: Stack, service?: string, follow = false) =>
  composeCommand(s, ...logsArgs(service, follow));

/** A shell in a running service: bash when the image has it, sh otherwise. */
export const shellCommand = (s: Stack, service: string) =>
  composeCommand(s, "exec", service, "sh", "-c", "command -v bash >/dev/null && exec bash || exec sh");

/** A script for the terminal that waits for Enter before the window closes. */
export function holdOpen(lines: string[]): string[] {
  return [
    "sh",
    "-c",
    `${
      lines.join("\n")
    }\nstatus=$?\necho\nprintf 'Done (exit %s). Press Enter to close this window.' "$status"\nread -r _`,
  ];
}

/** Pull the images, then recreate what changed. */
export const pullScript = (s: Stack, service?: string) =>
  holdOpen([
    `${shellLine(composeCommand(s, "pull", ...(service ? [service] : [])))} && ${
      shellLine(composeCommand(s, "up", "-d", ...(service ? [service] : [])))
    }`,
  ]);

/** Build the images again and recreate the containers. */
export const rebuildScript = (s: Stack, service?: string) =>
  holdOpen([shellLine(composeCommand(s, "up", "-d", "--build", ...(service ? [service] : [])))]);

/** The error of a failed compose call, without "docker exited with 1:". */
export function cleanError(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/^\w+ exited with \d+: /, "").split("\n").filter((l) => l.trim()).slice(-3).join("\n");
}
