// GPUs from lspci, hybrid graphics modes of supergfxctl, envycontrol, prime-select and
// system76-power, what runs on the discrete GPU, and launching apps on it.
// Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// GPUs (lspci -vmm -nn -k -D)

export interface Gpu {
  /** PCI address with its domain: 0000:01:00.0. */
  slot: string;
  kind: string;
  vendor: string;
  vendorId: string;
  /** "GeForce RTX 3050 Mobile", "Iris Xe Graphics". */
  name: string;
  deviceId: string;
  driver?: string;
  subsystem?: string;
  /** Integrated in the CPU, or a discrete card; undefined when it is the only GPU. */
  discrete?: boolean;
}

const VENDORS: Record<string, string> = { "10de": "NVIDIA", "8086": "Intel", "1002": "AMD", "1af4": "Virtio" };

/** "Intel Corporation [8086]" → ["Intel Corporation", "8086"]. */
function splitId(value: string): [string, string] {
  const m = value.match(/^(.*?)\s*\[([0-9a-f]{4})\]$/i);
  return m ? [m[1], m[2].toLowerCase()] : [value, ""];
}

/** "TigerLake-LP GT2 [Iris Xe Graphics]" → "Iris Xe Graphics"; "GA107M [GeForce RTX 3050 Mobile]" → its marketing name. */
export function marketingName(device: string): string {
  const inner = device.match(/\[([^\]]+)\]\s*$/)?.[1];
  return inner && !/^[0-9a-f]{4}$/i.test(inner) ? inner : device;
}

/** Display controllers only: VGA (0300), 3D (0302) and other display (0380) classes. */
export function parseLspci(text: string): Gpu[] {
  const gpus: Gpu[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const field = (k: string) => block.match(new RegExp(`^${k}:\\s*(.+)$`, "m"))?.[1]?.trim();
    const cls = field("Class");
    if (!cls || !/\[03(00|02|80)\]$/.test(cls)) continue;
    const [vendor, vendorId] = splitId(field("Vendor") ?? "");
    const [device, deviceId] = splitId(field("Device") ?? "");
    const slot = field("Slot") ?? "";
    gpus.push({
      slot: slot.includes(":") && slot.split(":").length === 2 ? `0000:${slot}` : slot,
      kind: splitId(cls)[0],
      vendor: VENDORS[vendorId] ?? vendor.replace(/ (Corporation|Corp\.|Inc\.|\[AMD\/ATI\])/g, "").trim(),
      vendorId,
      name: marketingName(device),
      deviceId,
      driver: field("Driver"),
      subsystem: field("SVendor") ? splitId(field("SVendor")!)[0] : undefined,
    });
  }
  return classify(gpus);
}

/**
 * Which GPU is the discrete one. With switcheroo-control, the boot GPU is the integrated one;
 * otherwise an Intel or AMD GPU on bus 00 (or AMD next to NVIDIA) is integrated.
 */
export function classify(gpus: Gpu[], bootSlot?: string): Gpu[] {
  if (gpus.length < 2) return gpus.map((g) => ({ ...g, discrete: undefined }));
  const hasNvidia = gpus.some((g) => g.vendorId === "10de");
  return gpus.map((g) => {
    let discrete: boolean;
    if (bootSlot) discrete = g.slot !== bootSlot;
    else if (g.vendorId === "10de") discrete = true;
    else if (/^[0-9a-f]{4}:00:/.test(g.slot)) discrete = false;
    else if (g.vendorId === "1002") discrete = !hasNvidia;
    else discrete = !/Iris|UHD|HD Graphics/i.test(g.name);
    return { ...g, discrete };
  });
}

export const VENDOR_COLOR: Record<string, Color> = { NVIDIA: "green", AMD: "red", Intel: "blue" };

// ---------------------------------------------------------------------------
// Hybrid graphics modes

export type Tool = "supergfxctl" | "envycontrol" | "prime-select" | "system76-power";

/** What must happen before a new mode is used. */
export type Needs = "none" | "logout" | "reboot";

export interface Mode {
  id: string;
  title: string;
  description: string;
  needs: Needs;
}

export const TOOL_NAMES: Record<Tool, string> = {
  supergfxctl: "supergfxctl (ASUS and other laptops)",
  envycontrol: "EnvyControl",
  "prime-select": "NVIDIA PRIME (prime-select)",
  "system76-power": "System76 Power",
};

const SUPERGFX: Record<string, Omit<Mode, "id">> = {
  Integrated: {
    title: "Integrated",
    description: "The discrete GPU is powered off: longest battery life",
    needs: "logout",
  },
  Hybrid: {
    title: "Hybrid",
    description: "The integrated GPU drives the screen; apps can use the discrete one",
    needs: "logout",
  },
  AsusMuxDgpu: {
    title: "Discrete (MUX)",
    description: "The discrete GPU drives the screen directly: best performance",
    needs: "reboot",
  },
  Vfio: { title: "VFIO", description: "The discrete GPU is handed to virtual machines", needs: "none" },
  AsusEgpu: { title: "External GPU", description: "An ASUS XG Mobile external GPU", needs: "logout" },
  NvidiaNoModeset: {
    title: "NVIDIA without modeset",
    description: "Hybrid, for setups that need nvidia-drm.modeset=0",
    needs: "logout",
  },
};

const ENVY: Mode[] = [
  {
    id: "integrated",
    title: "Integrated",
    description: "The discrete GPU is turned off: longest battery life",
    needs: "reboot",
  },
  {
    id: "hybrid",
    title: "Hybrid",
    description: "The integrated GPU drives the screen; apps can use the discrete one",
    needs: "reboot",
  },
  {
    id: "nvidia",
    title: "NVIDIA",
    description: "The NVIDIA GPU renders everything: best performance",
    needs: "reboot",
  },
];

const PRIME: Mode[] = [
  {
    id: "intel",
    title: "Integrated (Intel)",
    description: "The NVIDIA GPU is turned off: longest battery life",
    needs: "reboot",
  },
  {
    id: "on-demand",
    title: "On-Demand",
    description: "The integrated GPU drives the screen; apps can use NVIDIA",
    needs: "reboot",
  },
  {
    id: "nvidia",
    title: "NVIDIA",
    description: "The NVIDIA GPU renders everything: best performance",
    needs: "reboot",
  },
];

const SYSTEM76: Mode[] = [
  {
    id: "integrated",
    title: "Integrated",
    description: "The discrete GPU is turned off: longest battery life",
    needs: "reboot",
  },
  {
    id: "hybrid",
    title: "Hybrid",
    description: "The integrated GPU drives the screen; apps can use the discrete one",
    needs: "reboot",
  },
  {
    id: "nvidia",
    title: "NVIDIA",
    description: "The NVIDIA GPU renders everything: best performance",
    needs: "reboot",
  },
  {
    id: "compute",
    title: "Compute",
    description: "NVIDIA for CUDA only; the screen stays on the integrated GPU",
    needs: "reboot",
  },
];

/** The modes a tool offers; supergfxctl says which ones this laptop supports. */
export function modes(tool: Tool, supported: string[] = []): Mode[] {
  switch (tool) {
    case "supergfxctl": {
      const ids = supported.length ? supported : ["Integrated", "Hybrid"];
      return ids.map((id) => ({ id, ...(SUPERGFX[id] ?? { title: id, description: "", needs: "logout" as Needs }) }));
    }
    case "envycontrol":
      return ENVY;
    case "prime-select":
      return PRIME;
    case "system76-power":
      return SYSTEM76;
  }
}

/** The mode as printed: "Hybrid", "integrated", "Current graphics mode is: hybrid", "on-demand". */
export function parseMode(tool: Tool, out: string): string | undefined {
  const text = out.trim();
  if (!text) return undefined;
  const last = text.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
  const word = last.match(/(?:is|mode)[:\s]+(\S+)\s*$/i)?.[1] ?? last;
  const value = word.replace(/[.'"]/g, "");
  if (tool === "supergfxctl") {
    return Object.keys(SUPERGFX).find((k) => k.toLowerCase() === value.toLowerCase()) ?? value;
  }
  return value.toLowerCase();
}

/** `supergfxctl -s`: "[Integrated, Hybrid, AsusMuxDgpu]". */
export function parseSupported(out: string): string[] {
  return out.replace(/[[\]"]/g, "").split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
}

/** `supergfxctl -m`: "Graphics mode changed to Integrated. Required user action is: Logout". */
export function parseRequiredAction(out: string): Needs | undefined {
  const action = out.match(/user action (?:is|required)[:\s]*(\w+)/i)?.[1]?.toLowerCase() ??
    out.match(/^\s*(logout|reboot|none|nothing)\s*$/im)?.[1]?.toLowerCase();
  if (!action) return undefined;
  if (action.startsWith("logout")) return "logout";
  if (action.startsWith("reboot")) return "reboot";
  return "none";
}

/** `supergfxctl -S`: the discrete GPU's power: active, suspended, off, dgpu_disabled… */
export function parsePower(out: string): string | undefined {
  const v = out.trim().toLowerCase();
  return v ? v.replace(/_/g, " ") : undefined;
}

/** A sleeping discrete GPU is woken by nvidia-smi: leave it alone. */
export const asleep = (power?: string) => !!power && /suspend|off|disabled/.test(power);

/** The command that switches mode; true when it must run as root. */
export function switchCommand(tool: Tool, mode: string): { argv: string[]; root: boolean } {
  switch (tool) {
    case "supergfxctl":
      return { argv: ["supergfxctl", "-m", mode], root: false };
    case "envycontrol":
      return { argv: ["envycontrol", "-s", mode], root: true };
    case "prime-select":
      return { argv: ["prime-select", mode], root: true };
    case "system76-power":
      return { argv: ["system76-power", "graphics", mode], root: true };
  }
}

export const needsText = (n: Needs) =>
  n === "reboot" ? "Restart to finish switching" : n === "logout" ? "Log out to finish switching" : "Ready";

// ---------------------------------------------------------------------------
// switcheroo-control

export interface SwitcherooGpu {
  index: number;
  name: string;
  default: boolean;
  env: Record<string, string>;
}

/** `switcherooctl list`: "Device: 1", "Name: …", "Default: no", "Environment: K=V K=V". */
export function parseSwitcheroo(out: string): SwitcherooGpu[] {
  const gpus: SwitcherooGpu[] = [];
  for (const block of out.split(/^Device:/m).slice(1)) {
    const field = (k: string) => block.match(new RegExp(`^\\s*${k}:\\s*(.*)$`, "m"))?.[1]?.trim() ?? "";
    const env: Record<string, string> = {};
    for (const pair of field("Environment").split(/\s+/)) {
      const eq = pair.indexOf("=");
      if (eq > 0) env[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    gpus.push({
      index: Number(block.trim().split(/\s/)[0]),
      name: field("Name"),
      default: field("Default") === "yes",
      env,
    });
  }
  return gpus;
}

/** "DRI_PRIME=pci-0000_01_00_0" → "0000:01:00.0". */
export function slotFromDriPrime(value?: string): string | undefined {
  const m = value?.match(/pci-([0-9a-f]{4})_([0-9a-f]{2})_([0-9a-f]{2})_([0-9a-f])/i);
  return m ? `${m[1]}:${m[2]}:${m[3]}.${m[4]}` : undefined;
}

/** The environment that sends an app to the discrete GPU (what prime-run and switcherooctl set). */
export function offloadEnv(gpu: Gpu | undefined, switcheroo?: SwitcherooGpu): Record<string, string> {
  if (switcheroo && Object.keys(switcheroo.env).length) return switcheroo.env;
  if (gpu?.vendorId === "10de" && gpu.driver === "nvidia") {
    return {
      __NV_PRIME_RENDER_OFFLOAD: "1",
      __GLX_VENDOR_LIBRARY_NAME: "nvidia",
      __VK_LAYER_NV_optimus: "NVIDIA_only",
    };
  }
  if (gpu) return { DRI_PRIME: `pci-${gpu.slot.replace(/[:.]/g, "_")}` };
  return { DRI_PRIME: "1" };
}

// ---------------------------------------------------------------------------
// What uses the discrete GPU

export interface NvidiaGpu {
  index: number;
  name: string;
  busId: string;
  driver: string;
  temperature?: number;
  utilization?: number;
  memoryUsed?: number;
  memoryTotal?: number;
  power?: number;
  pstate?: string;
}

export const NVIDIA_QUERY = "index,name,pci.bus_id,driver_version,temperature.gpu,utilization.gpu,memory.used," +
  "memory.total,power.draw,pstate";

const value = (v?: string) => {
  const t = v?.trim() ?? "";
  if (!t || /^\[?(N\/A|Not Supported|Unknown Error)\]?$/i.test(t)) return undefined;
  const x = Number(t);
  return Number.isFinite(x) ? x : undefined;
};

/** `nvidia-smi --query-gpu=… --format=csv,noheader,nounits`. */
export function parseNvidiaGpus(csv: string): NvidiaGpu[] {
  return csv.split("\n").filter((l) => l.trim()).map((line) => {
    const c = line.split(",").map((s) => s.trim());
    return {
      index: Number(c[0]),
      name: c[1],
      busId: c[2],
      driver: c[3],
      temperature: value(c[4]),
      utilization: value(c[5]),
      memoryUsed: value(c[6]),
      memoryTotal: value(c[7]),
      power: value(c[8]),
      pstate: c[9] && !c[9].includes("N/A") ? c[9] : undefined,
    };
  });
}

export interface GpuProcess {
  pid: number;
  command: string;
  user?: string;
  /** MiB of video memory, from nvidia-smi. */
  memory?: number;
  devices: string[];
}

/** `nvidia-smi --query-compute-apps=pid,process_name,used_memory --format=csv,noheader,nounits`. */
export function parseComputeApps(csv: string): GpuProcess[] {
  return csv.split("\n").filter((l) => l.trim() && !/No running/i.test(l)).flatMap((line) => {
    const c = line.split(",").map((s) => s.trim());
    const pid = Number(c[0]);
    if (!Number.isInteger(pid) || pid <= 0) return [];
    return [{ pid, command: c[1].split("/").pop() || c[1], memory: value(c[2]), devices: ["CUDA"] }];
  });
}

/** `fuser -v <devices>` (its table goes to stderr): one entry per process, with the devices it holds. */
export function parseFuser(text: string): GpuProcess[] {
  const byPid = new Map<number, GpuProcess>();
  let device = "";
  for (const raw of text.split("\n")) {
    if (!raw.trim() || /^\s+USER\s+PID/.test(raw)) continue;
    let line = raw;
    const dev = raw.match(/^(\/\S+?):\s*/);
    if (dev) {
      device = dev[1];
      line = raw.slice(dev[0].length);
    }
    const m = line.match(/^\s*(\S+)\s+(\d+|kernel)\s+(\S+)\s+(.+?)\s*$/);
    if (!m || m[2] === "kernel") continue;
    const pid = Number(m[2]);
    const entry = byPid.get(pid) ?? { pid, user: m[1], command: m[4], devices: [] };
    if (device && !entry.devices.includes(device)) entry.devices.push(device);
    byPid.set(pid, entry);
  }
  return [...byPid.values()];
}

/** Both sources together, by process. */
export function mergeProcesses(a: GpuProcess[], b: GpuProcess[]): GpuProcess[] {
  const byPid = new Map<number, GpuProcess>();
  for (const p of [...a, ...b]) {
    const known = byPid.get(p.pid);
    if (!known) byPid.set(p.pid, { ...p, devices: [...p.devices] });
    else {
      known.memory ??= p.memory;
      known.user ??= p.user;
      for (const d of p.devices) if (!known.devices.includes(d)) known.devices.push(d);
    }
  }
  return [...byPid.values()].sort((x, y) => (y.memory ?? 0) - (x.memory ?? 0) || x.command.localeCompare(y.command));
}

/** /dev/dri/by-path names: "pci-0000:01:00.0-render" → its PCI slot. */
export function slotOfDriLink(name: string): string | undefined {
  return name.match(/^pci-([0-9a-f]{4}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f])-(card|render)$/i)?.[1];
}

// ---------------------------------------------------------------------------
// Applications (.desktop files)

export interface App {
  id: string;
  file: string;
  name: string;
  comment?: string;
  exec: string;
  icon?: string;
  terminal: boolean;
  /** The app asks for the discrete GPU itself (PrefersNonDefaultGPU=true). */
  prefersDgpu: boolean;
  keywords: string[];
}

/** The [Desktop Entry] group of a .desktop file; hidden entries and those without Exec are dropped. */
export function parseDesktop(file: string, text: string): App | undefined {
  const start = text.search(/^\[Desktop Entry\]\s*$/m);
  if (start < 0) return undefined;
  const group = text.slice(start).split(/^\[(?!Desktop Entry\])[^\]]+\]\s*$/m)[0];
  const field = (k: string) => group.match(new RegExp(`^${k}\\s*=\\s*(.*)$`, "m"))?.[1]?.trim();
  if (field("Type") && field("Type") !== "Application") return undefined;
  if (field("NoDisplay") === "true" || field("Hidden") === "true") return undefined;
  const exec = field("Exec");
  const name = field("Name");
  if (!exec || !name) return undefined;
  return {
    id: file.split("/").pop()!.replace(/\.desktop$/, ""),
    file,
    name,
    comment: field("Comment") || field("GenericName"),
    exec,
    icon: field("Icon"),
    terminal: field("Terminal") === "true",
    prefersDgpu: field("PrefersNonDefaultGPU") === "true",
    keywords: (field("Keywords") ?? "").split(";").filter(Boolean),
  };
}

/** The Exec line ready for a shell: field codes (%U, %f…) removed, %% kept as %. */
export function commandLine(exec: string): string {
  return exec.replace(/%[fFuUdDnNickvm]/g, "").replace(/%%/g, "%").replace(/\s+/g, " ").trim();
}

/** Earlier folders win: the user's own entries hide the system's. */
export function dedupeApps(apps: App[]): App[] {
  const seen = new Set<string>();
  return apps.filter((a) => !seen.has(a.id) && seen.add(a.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/** systemd-run arguments that start a command line on the discrete GPU, outliving the launcher. */
export function launchArgs(line: string, env: Record<string, string>, name: string, stamp: number): string[] {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "app";
  return [
    "--user",
    "--collect",
    "--quiet",
    `--unit=app-backslash-dgpu-${slug}-${stamp}`,
    `--description=${name} (discrete GPU)`,
    ...Object.entries(env).map(([k, v]) => `--setenv=${k}=${v}`),
    "--",
    "/bin/sh",
    "-c",
    `exec ${line}`,
  ];
}

/** The same, to copy into a terminal or a game's launch options. */
export function envPrefix(env: Record<string, string>): string {
  return Object.entries(env).map(([k, v]) => `${k}=${quote(v)}`).join(" ");
}

/** pkexec's exit codes when nobody authenticated. */
export function pkexecError(code: number, stderr: string): string | undefined {
  if (code === 126) return "Authentication was cancelled";
  if (code === 127 && /not authorized|authentication/i.test(stderr)) return "Not authorized";
  if (/No authentication agent/i.test(stderr)) return "No polkit agent to ask for your password";
  return undefined;
}

/** What to install for hybrid graphics switching. */
export const INSTALL_HINTS: { title: string; text: string; url: string }[] = [
  {
    title: "supergfxctl",
    text: "ASUS laptops and most other hybrid laptops (asus-linux.org)",
    url: "https://gitlab.com/asus-linux/supergfxctl",
  },
  {
    title: "EnvyControl",
    text: "NVIDIA Optimus laptops on any distribution",
    url: "https://github.com/bayasdev/envycontrol",
  },
  {
    title: "nvidia-prime",
    text: "Ubuntu and its derivatives: sudo apt install nvidia-prime",
    url: "https://wiki.ubuntu.com/X/Config/HybridGraphics",
  },
  { title: "system76-power", text: "Pop!_OS and System76 laptops", url: "https://github.com/pop-os/system76-power" },
];
