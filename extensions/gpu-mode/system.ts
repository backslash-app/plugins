// The system's tools: lspci, the mode switchers, nvidia-smi, fuser and systemd-run.

import { storage } from "@backslash/api";
import {
  type App,
  asleep,
  classify,
  commandLine,
  dedupeApps,
  type Gpu,
  type GpuProcess,
  launchArgs,
  mergeProcesses,
  type Mode,
  modes,
  type Needs,
  NVIDIA_QUERY,
  type NvidiaGpu,
  offloadEnv,
  parseComputeApps,
  parseDesktop,
  parseFuser,
  parseLspci,
  parseMode,
  parseNvidiaGpus,
  parsePower,
  parseRequiredAction,
  parseSupported,
  parseSwitcheroo,
  pkexecError,
  shellLine,
  slotFromDriPrime,
  slotOfDriLink,
  switchCommand,
  type SwitcherooGpu,
  type Tool,
} from "./lib.ts";

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

export class NotInstalled extends Error {}

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name) || undefined;
  } catch {
    return undefined;
  }
}

export const HOME = env("HOME") ?? "";

async function sh(program: string, args: string[], timeout = 15_000): Promise<Output> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      env: { LC_ALL: "C" },
      signal: AbortSignal.timeout(timeout),
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable) throw new NotInstalled(program);
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  return { code: out.code, stdout: text(out.stdout), stderr: text(out.stderr).trim() };
}

/** stdout when the program is installed and succeeds, else undefined. */
async function quiet(program: string, args: string[], timeout?: number): Promise<string | undefined> {
  try {
    const o = await sh(program, args, timeout);
    return o.code === 0 ? o.stdout : undefined;
  } catch {
    return undefined;
  }
}

/** Runs a script as root, after polkit asks for the password once. */
async function asRoot(script: string): Promise<string> {
  let o: Output;
  try {
    // Rebuilding the initramfs (envycontrol, prime-select) takes a while.
    o = await sh("pkexec", ["/bin/sh", "-c", script], 300_000);
  } catch (e) {
    if (e instanceof NotInstalled) throw new Error("pkexec (polkit) is needed to switch the GPU mode");
    throw e;
  }
  const denied = pkexecError(o.code, o.stderr);
  if (denied) throw new Error(denied);
  if (o.code !== 0) {
    throw new Error((o.stderr || o.stdout).split("\n").filter(Boolean).pop() || `Exited with ${o.code}`);
  }
  return o.stdout + o.stderr;
}

// ---------------------------------------------------------------------------
// GPUs

export async function switcheroo(): Promise<SwitcherooGpu[]> {
  const out = await quiet("switcherooctl", ["list"], 5000);
  return out ? parseSwitcheroo(out) : [];
}

export async function gpus(boot?: SwitcherooGpu[]): Promise<Gpu[]> {
  let o: Output;
  try {
    o = await sh("lspci", ["-vmm", "-nn", "-k", "-D"]);
  } catch (e) {
    if (e instanceof NotInstalled) throw new Error("lspci was not found: install pciutils");
    throw e;
  }
  const found = parseLspci(o.stdout);
  const bootSlot = slotFromDriPrime(boot?.find((g) => g.default)?.env.DRI_PRIME);
  return bootSlot && found.some((g) => g.slot === bootSlot) ? classify(found, bootSlot) : found;
}

// ---------------------------------------------------------------------------
// Modes

export interface ModeState {
  tool?: Tool;
  current?: string;
  modes: Mode[];
  /** supergfxctl: the discrete GPU's power state. */
  power?: string;
  error?: string;
}

async function probe(tool: Tool): Promise<ModeState | undefined> {
  switch (tool) {
    case "supergfxctl": {
      const current = await quiet("supergfxctl", ["-g"], 5000);
      if (current === undefined) return undefined;
      const [supported, power] = await Promise.all([
        quiet("supergfxctl", ["-s"], 5000),
        quiet("supergfxctl", ["-S"], 5000),
      ]);
      return {
        tool,
        current: parseMode(tool, current),
        modes: modes(tool, parseSupported(supported ?? "")),
        power: parsePower(power ?? ""),
      };
    }
    case "envycontrol": {
      const current = await quiet("envycontrol", ["--query"]);
      return current === undefined ? undefined : { tool, current: parseMode(tool, current), modes: modes(tool) };
    }
    case "prime-select": {
      const current = await quiet("prime-select", ["query"]);
      return current === undefined ? undefined : { tool, current: parseMode(tool, current), modes: modes(tool) };
    }
    case "system76-power": {
      const current = await quiet("system76-power", ["graphics"]);
      return current === undefined ? undefined : { tool, current: parseMode(tool, current), modes: modes(tool) };
    }
  }
}

/** The first switcher installed, in the order of preference. */
export async function modeState(): Promise<ModeState> {
  const tools: Tool[] = ["supergfxctl", "system76-power", "envycontrol", "prime-select"];
  const found = await Promise.all(tools.map(probe));
  return found.find((s) => s) ?? { modes: [] };
}

export interface Pending {
  tool: Tool;
  mode: string;
  needs: Needs;
  at: number;
}

const PENDING = "pending";

/** The switch waiting for a log out or restart; forgotten once the machine restarted, or after 12 hours. */
export async function pending(): Promise<Pending | undefined> {
  const p = await storage.get(PENDING).catch(() => undefined) as unknown as Pending | undefined;
  if (!p) return undefined;
  const boot = await quiet("uptime", ["-s"], 3000);
  const bootedAt = boot ? Date.parse(boot.trim().replace(" ", "T")) : NaN;
  if ((Number.isFinite(bootedAt) && bootedAt > p.at) || Date.now() - p.at > 12 * 3600_000) {
    await storage.delete(PENDING).catch(() => {});
    return undefined;
  }
  return p;
}

export async function switchMode(tool: Tool, mode: Mode): Promise<Needs> {
  const { argv, root } = switchCommand(tool, mode.id);
  let out: string;
  if (root) out = await asRoot(`${shellLine(argv)} 2>&1`);
  else {
    const o = await sh(argv[0], argv.slice(1), 120_000);
    out = `${o.stdout}\n${o.stderr}`;
    if (o.code !== 0) throw new Error(out.trim().split("\n").filter(Boolean).pop() || `${argv[0]} failed`);
  }
  const needs = parseRequiredAction(out) ?? mode.needs;
  if (needs !== "none") {
    await storage.set(PENDING, { tool, mode: mode.id, needs, at: Date.now() } as never).catch(() => {});
  }
  return needs;
}

export async function logOut(): Promise<void> {
  const session = env("XDG_SESSION_ID");
  if (!session) throw new Error("Couldn't find your session: log out from your desktop's menu");
  const o = await sh("loginctl", ["terminate-session", session]);
  if (o.code !== 0) throw new Error(o.stderr || "loginctl failed");
}

export async function reboot(): Promise<void> {
  const o = await sh("systemctl", ["reboot"]);
  if (o.code !== 0) throw new Error(o.stderr || "systemctl reboot failed");
}

// ---------------------------------------------------------------------------
// The discrete GPU at work

/** nvidia-smi's view, unless the GPU is asleep: asking would wake it up. */
export async function nvidia(power?: string): Promise<NvidiaGpu[]> {
  if (asleep(power)) return [];
  const out = await quiet("nvidia-smi", [`--query-gpu=${NVIDIA_QUERY}`, "--format=csv,noheader,nounits"], 8000);
  return out ? parseNvidiaGpus(out) : [];
}

/** The /dev/dri nodes of a PCI slot, through the by-path links. */
async function driNodes(slot: string): Promise<string[]> {
  const nodes: string[] = [];
  try {
    for await (const e of Deno.readDir("/dev/dri/by-path")) {
      if (slotOfDriLink(e.name)?.toLowerCase() !== slot.toLowerCase()) continue;
      const target = await Deno.readLink(`/dev/dri/by-path/${e.name}`).catch(() => "");
      if (target) nodes.push(`/dev/dri/${target.split("/").pop()}`);
    }
  } catch {
    // No DRM devices visible.
  }
  return nodes;
}

/** Processes holding the discrete GPU open (fuser), with CUDA apps from nvidia-smi when it is awake. */
export async function processes(dgpu: Gpu | undefined, awake: boolean): Promise<GpuProcess[]> {
  if (!dgpu) return [];
  const devices = await driNodes(dgpu.slot);
  if (dgpu.driver === "nvidia") devices.push("/dev/nvidia0");
  const [fuser, cuda] = await Promise.all([
    devices.length
      ? sh("fuser", ["-v", ...devices], 8000).then((o) => parseFuser(o.stderr), () => [])
      : Promise.resolve([]),
    awake && dgpu.vendorId === "10de"
      ? quiet(
        "nvidia-smi",
        ["--query-compute-apps=pid,process_name,used_memory", "--format=csv,noheader,nounits"],
        8000,
      )
        .then((o) => parseComputeApps(o ?? ""))
      : Promise.resolve([]),
  ]);
  return mergeProcesses(fuser, cuda);
}

export async function stopProcess(pid: number): Promise<void> {
  const o = await sh("kill", ["-TERM", String(pid)]);
  if (o.code !== 0) throw new Error(o.stderr || `Couldn't stop process ${pid}`);
}

// ---------------------------------------------------------------------------
// Launching on the discrete GPU

export const APP_DIRS = [
  `${HOME}/.local/share/applications`,
  `${HOME}/.local/share/flatpak/exports/share/applications`,
  "/var/lib/flatpak/exports/share/applications",
  "/usr/local/share/applications",
  "/usr/share/applications",
  "/var/lib/snapd/desktop/applications",
];

export async function apps(): Promise<App[]> {
  const found = await Promise.all(APP_DIRS.map(async (dir) => {
    const list: App[] = [];
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.name.endsWith(".desktop")) continue;
        const file = `${dir}/${e.name}`;
        const app = parseDesktop(file, await Deno.readTextFile(file).catch(() => ""));
        if (app) list.push(app);
      }
    } catch {
      // Folder missing.
    }
    return list;
  }));
  return dedupeApps(found.flat());
}

/** How apps reach the discrete GPU here: the environment, and who said so. */
export async function offload(): Promise<{ env: Record<string, string>; gpu?: Gpu; source: string }> {
  const boot = await switcheroo();
  const all = await gpus(boot).catch(() => [] as Gpu[]);
  const dgpu = all.find((g) => g.discrete);
  const other = boot.find((g) => !g.default);
  if (other && Object.keys(other.env).length) return { env: other.env, gpu: dgpu, source: "switcheroo-control" };
  return {
    env: offloadEnv(dgpu),
    gpu: dgpu,
    source: dgpu?.driver === "nvidia" ? "NVIDIA PRIME render offload" : "Mesa PRIME (DRI_PRIME)",
  };
}

/** Starts a command line with the offload environment, in its own systemd scope so it outlives the launcher. */
export async function launch(line: string, name: string, offloadEnvironment: Record<string, string>): Promise<void> {
  let o: Output;
  try {
    o = await sh(
      "systemd-run",
      launchArgs(commandLine(line), offloadEnvironment, name, Date.now()),
      15_000,
    );
  } catch (e) {
    if (e instanceof NotInstalled) {
      throw new Error("systemd-run is needed to start apps; run it from a terminal with the copied command instead");
    }
    throw e;
  }
  if (o.code !== 0) throw new Error(o.stderr.split("\n").pop() || "systemd-run failed");
}
