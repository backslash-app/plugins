// Parsing distrobox, toolbx and virsh output. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type Kind = "distrobox" | "toolbox";

export interface Container {
  kind: Kind;
  id: string;
  name: string;
  /** As printed: "Up 2 hours", "Exited (0) 3 days ago", "running"… */
  status: string;
  running: boolean;
  image: string;
  created?: string;
}

export interface Vm {
  /** `qemu:///session` or `qemu:///system`. */
  uri: string;
  id?: string;
  name: string;
  state: string;
}

const running = (status: string) => /^(up|running)\b/i.test(status.trim());

/** `distrobox list --no-color`: a table with `|` between columns. */
export function parseDistrobox(out: string): Container[] {
  return out.split("\n").flatMap((line) => {
    const cols = line.split("|").map((c) => c.trim());
    if (cols.length < 4 || cols[0] === "ID" || !cols[1]) return [];
    return [{
      kind: "distrobox" as const,
      id: cols[0],
      name: cols[1],
      status: cols[2],
      running: running(cols[2]),
      image: cols[3],
    }];
  });
}

/** `toolbox list --containers`: columns separated by two spaces or more. */
export function parseToolbox(out: string): Container[] {
  const lines = out.split("\n").filter((l) => l.trim());
  const header = lines.findIndex((l) => /^CONTAINER ID\s/.test(l));
  if (header < 0) return [];
  return lines.slice(header + 1).flatMap((line) => {
    if (/^IMAGE ID\s/.test(line)) return [];
    const [id, name, created, status, image] = line.trim().split(/\s{2,}/);
    if (!id || !name || !status) return [];
    return [{ kind: "toolbox" as const, id, name, created, status, running: running(status), image: image ?? "" }];
  });
}

/** Same name in both lists (distrobox also lists toolbx containers): keep the distrobox one. */
export function mergeContainers(distrobox: Container[], toolbox: Container[]): Container[] {
  const names = new Set(distrobox.map((c) => c.name));
  return [...distrobox, ...toolbox.filter((c) => !names.has(c.name))];
}

/** `virsh list --all`. */
export function parseVirshList(out: string, uri: string): Vm[] {
  return out.split("\n").flatMap((line) => {
    const t = line.trim();
    if (!t || /^-+$/.test(t) || /^Id\s+Name\s+State/.test(t)) return [];
    const cols = t.split(/\s{2,}/);
    if (cols.length < 3) return [];
    const [id, name, ...state] = cols;
    return [{ uri, id: id === "-" ? undefined : id, name, state: state.join(" ") }];
  });
}

/** `virsh dominfo`: `Key:   value` lines. */
export function parseDomInfo(out: string): Record<string, string> {
  const info: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) info[m[1].trim()] = m[2].trim();
  }
  return info;
}

/** "4194304 KiB" → "4 GiB". */
export function memory(text: string | undefined): string | undefined {
  const m = text?.match(/^(\d+)\s*KiB$/);
  if (!m) return text || undefined;
  const kib = Number(m[1]);
  if (kib >= 1048576) return `${+(kib / 1048576).toFixed(1)} GiB`;
  if (kib >= 1024) return `${Math.round(kib / 1024)} MiB`;
  return `${kib} KiB`;
}

export type VmState = "running" | "paused" | "off" | "crashed" | "suspended" | "transition";

export function vmState(state: string): VmState {
  const s = state.toLowerCase();
  if (s === "running" || s === "idle" || s === "blocked") return "running";
  if (s === "paused") return "paused";
  if (s === "crashed") return "crashed";
  if (s === "pmsuspended") return "suspended";
  if (s === "in shutdown") return "transition";
  return "off";
}

export const STATE_COLORS: Record<VmState, Color> = {
  running: "green",
  paused: "yellow",
  off: "gray",
  crashed: "red",
  suspended: "blue",
  transition: "orange",
};

export const STATE_TITLES: Record<VmState, string> = {
  running: "Running",
  paused: "Paused",
  off: "Shut off",
  crashed: "Crashed",
  suspended: "Suspended",
  transition: "Shutting down",
};

/** `Exited (0) 3 days ago` → "Exited 3 days ago"; `Up 2 hours` → "Up 2 hours". */
export const shortStatus = (status: string) => status.replace(/\s*\(\d+\)/, "").trim();

export function enterCommand(c: Container): string[] {
  return c.kind === "distrobox" ? ["distrobox", "enter", c.name] : ["toolbox", "enter", c.name];
}

export function stopCommand(c: Container): string[] {
  // toolbx has no stop command: its containers are plain Podman ones.
  return c.kind === "distrobox" ? ["distrobox", "stop", "--yes", c.name] : ["podman", "stop", c.name];
}

export function removeCommand(c: Container): string[] {
  return c.kind === "distrobox" ? ["distrobox", "rm", "--force", c.name] : ["toolbox", "rm", "--force", c.name];
}

export const virsh = (vm: Vm, verb: string) => ["virsh", "-c", vm.uri, verb, vm.name];

export const scope = (uri: string) => (uri.endsWith("/system") ? "System" : "Session");
