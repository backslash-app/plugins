// Parsing /proc, /sys and df output, and formatting numbers. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Files

/**
 * `grep -sHa "" <paths…>`: the content of each file, the way the extension reads /proc and /sys
 * (Deno only opens them with --allow-all). Paths given to it never contain a colon.
 */
export function parseGrep(text: string): Map<string, string> {
  const out = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const path = line.slice(0, i);
    const lines = out.get(path) ?? [];
    lines.push(line.slice(i + 1));
    out.set(path, lines);
  }
  return new Map([...out].map(([path, lines]) => [path, lines.join("\n")]));
}

// ---------------------------------------------------------------------------
// CPU

/** Jiffies of one line of /proc/stat. */
export interface CpuTimes {
  idle: number;
  total: number;
}

/** `/proc/stat`: the aggregate `cpu` line and one per core. */
export function parseCpuStat(text: string): { total: CpuTimes; cores: CpuTimes[] } {
  let total: CpuTimes = { idle: 0, total: 0 };
  const cores: CpuTimes[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^cpu(\d*)\s+(.*)$/);
    if (!m) continue;
    // user nice system idle iowait irq softirq steal guest guest_nice
    const n = m[2].trim().split(/\s+/).map(Number);
    // guest time is already counted in user and nice.
    const sum = n.slice(0, 8).reduce((a, b) => a + (b || 0), 0);
    const times = { idle: (n[3] || 0) + (n[4] || 0), total: sum };
    if (m[1] === "") total = times;
    else cores[Number(m[1])] = times;
  }
  return { total, cores: cores.filter(Boolean) };
}

/** Busy fraction between two samples, from 0 to 1. */
export function cpuUsage(prev: CpuTimes, cur: CpuTimes): number {
  const total = cur.total - prev.total;
  if (total <= 0) return 0;
  return clamp01(1 - (cur.idle - prev.idle) / total);
}

export interface CpuInfo {
  model: string;
  threads: number;
  /** Physical cores, when the kernel says. */
  cores?: number;
  /** Average current frequency in MHz, from `cpu MHz` lines. */
  mhz?: number;
}

/** `/proc/cpuinfo` on x86 and ARM. */
export function parseCpuinfo(text: string): CpuInfo {
  const blocks = text.split(/\n\s*\n/).filter((b) => b.trim());
  const field = (block: string, key: string) => block.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, "m"))?.[1]?.trim();
  const processors = blocks.filter((b) => field(b, "processor") !== undefined);
  const mhz = processors.map((b) => Number(field(b, "cpu MHz"))).filter((n) => n > 0);
  const model = processors.map((b) => field(b, "model name") ?? field(b, "Processor")).find(Boolean) ??
    blocks.map((b) => field(b, "Model") ?? field(b, "Hardware")).find(Boolean) ?? "Unknown processor";
  const physical = new Set(processors.map((b) => `${field(b, "physical id")}:${field(b, "core id")}`));
  const hasCoreIds = processors.some((b) => field(b, "core id") !== undefined);
  return {
    model: model.replace(/\s+/g, " ").replace(/\((R|TM)\)/gi, "").replace(/ CPU /, " ").trim(),
    threads: processors.length,
    cores: hasCoreIds ? physical.size : undefined,
    mhz: mhz.length ? mhz.reduce((a, b) => a + b, 0) / mhz.length : undefined,
  };
}

export interface LoadAvg {
  one: number;
  five: number;
  fifteen: number;
  running: number;
  processes: number;
}

/** `/proc/loadavg`: `0.07 0.09 0.04 1/109 3352`. */
export function parseLoadavg(text: string): LoadAvg {
  const [one, five, fifteen, tasks] = text.trim().split(/\s+/);
  const [running, processes] = (tasks ?? "0/0").split("/").map(Number);
  return { one: Number(one), five: Number(five), fifteen: Number(fifteen), running, processes };
}

export interface Sensor {
  /** hwmon `name` or thermal zone `type`. */
  chip: string;
  label?: string;
  /** °C */
  celsius: number;
}

const CPU_CHIPS = ["coretemp", "k10temp", "zenpower", "cpu_thermal", "cpu-thermal", "x86_pkg_temp", "soc_thermal"];

/** The sensor that best describes the CPU: package temperature first, else the hottest CPU sensor. */
export function cpuTemperature(sensors: Sensor[]): number | undefined {
  const cpu = sensors.filter((s) => CPU_CHIPS.includes(s.chip) && s.celsius > 0 && s.celsius < 150);
  const pkg = cpu.find((s) => /package|tctl|tdie/i.test(s.label ?? ""));
  if (pkg) return pkg.celsius;
  if (cpu.length) return Math.max(...cpu.map((s) => s.celsius));
  // Laptops without a CPU driver often expose only ACPI zones.
  const acpi = sensors.filter((s) => /acpitz|thermal_zone/.test(s.chip) && s.celsius > 0 && s.celsius < 150);
  return acpi.length ? Math.max(...acpi.map((s) => s.celsius)) : undefined;
}

// ---------------------------------------------------------------------------
// Memory

export interface Memory {
  total: number;
  used: number;
  available: number;
  cached: number;
  buffers: number;
  swapTotal: number;
  swapUsed: number;
}

/** `/proc/meminfo`, in bytes. Used = total − available, as `free` and GNOME System Monitor do. */
export function parseMeminfo(text: string): Memory {
  const kb: Record<string, number> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^([\w()]+):\s+(\d+)/);
    if (m) kb[m[1]] = Number(m[2]);
  }
  const total = (kb.MemTotal ?? 0) * 1024;
  const available = (kb.MemAvailable ?? (kb.MemFree ?? 0) + (kb.Cached ?? 0) + (kb.Buffers ?? 0)) * 1024;
  const swapTotal = (kb.SwapTotal ?? 0) * 1024;
  return {
    total,
    available,
    used: Math.max(0, total - available),
    cached: ((kb.Cached ?? 0) + (kb.SReclaimable ?? 0)) * 1024,
    buffers: (kb.Buffers ?? 0) * 1024,
    swapTotal,
    swapUsed: Math.max(0, swapTotal - (kb.SwapFree ?? 0) * 1024),
  };
}

// ---------------------------------------------------------------------------
// Disks

export interface Disk {
  device: string;
  mount: string;
  fstype: string;
  size: number;
  used: number;
  available: number;
}

/** `df -P -k`: 1024-byte blocks; the mount point may contain spaces. */
export function parseDf(text: string): Omit<Disk, "fstype">[] {
  return text.split("\n").slice(1).flatMap((line) => {
    const m = line.match(/^(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+%\s+(\/.*)$/);
    if (!m) return [];
    return [{
      device: m[1],
      size: Number(m[2]) * 1024,
      used: Number(m[3]) * 1024,
      available: Number(m[4]) * 1024,
      mount: m[5],
    }];
  });
}

/** `/proc/mounts`: mount point → filesystem type (octal escapes decoded). */
export function parseMounts(text: string): Map<string, { device: string; fstype: string }> {
  const unescape = (s: string) => s.replace(/\\([0-7]{3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  const out = new Map<string, { device: string; fstype: string }>();
  for (const line of text.split("\n")) {
    const [device, mount, fstype] = line.split(" ");
    if (device && mount && fstype) out.set(unescape(mount), { device: unescape(device), fstype });
  }
  return out;
}

const PSEUDO_FS = new Set([
  "tmpfs",
  "devtmpfs",
  "overlay",
  "squashfs",
  "proc",
  "sysfs",
  "cgroup",
  "cgroup2",
  "devpts",
  "efivarfs",
  "fuse.portal",
  "fuse.gvfsd-fuse",
  "nsfs",
  "ramfs",
  "autofs",
  "tracefs",
  "debugfs",
]);

/** Real storage only: no tmpfs, snaps, containers, /boot/efi duplicates of one device. */
export function realDisks(df: Omit<Disk, "fstype">[], mounts: Map<string, { device: string; fstype: string }>): Disk[] {
  const seen = new Set<string>();
  const disks: Disk[] = [];
  for (const d of df) {
    const fstype = mounts.get(d.mount)?.fstype ?? "";
    if (PSEUDO_FS.has(fstype) || d.size === 0) continue;
    if (/^\/(proc|sys|dev|run|snap|var\/lib\/(docker|containers|snapd))(\/|$)/.test(d.mount)) {
      // Removable drives live in /run/media; keep them.
      if (!d.mount.startsWith("/run/media/")) continue;
    }
    if (!d.device.startsWith("/") && !["zfs", "btrfs", "nfs", "nfs4", "cifs", "fuse.sshfs"].includes(fstype)) continue;
    // Btrfs subvolumes and bind mounts show the same device several times.
    const key = `${d.device}:${d.size}`;
    if (seen.has(key)) continue;
    seen.add(key);
    disks.push({ ...d, fstype });
  }
  return disks.sort((a, b) => (a.mount === "/" ? -1 : b.mount === "/" ? 1 : a.mount.localeCompare(b.mount)));
}

// ---------------------------------------------------------------------------
// Network

export interface NetCounters {
  rx: number;
  tx: number;
}

/** `/proc/net/dev`: received and sent bytes per interface. */
export function parseNetDev(text: string): Map<string, NetCounters> {
  const out = new Map<string, NetCounters>();
  for (const line of text.split("\n").slice(2)) {
    const m = line.match(/^\s*([^:]+):\s*(.*)$/);
    if (!m) continue;
    const n = m[2].trim().split(/\s+/).map(Number);
    out.set(m[1].trim(), { rx: n[0] || 0, tx: n[8] || 0 });
  }
  return out;
}

/** Interfaces worth showing: no loopback nor container plumbing. */
export const isPhysicalInterface = (name: string) => !/^(lo|ifb\d|veth|docker|br-|virbr|vnet|tap|dummy)/.test(name);

/** Friendly kind of an interface from its name. */
export function interfaceKind(name: string): "wifi" | "ethernet" | "vpn" | "mobile" | "other" {
  if (/^(wl|wlan|wifi)/.test(name)) return "wifi";
  if (/^(en|eth)/.test(name)) return "ethernet";
  if (/^(tun|wg|tailscale|ppp|proton|nordlynx)/.test(name)) return "vpn";
  if (/^(wwan|usb|rmnet)/.test(name)) return "mobile";
  return "other";
}

// ---------------------------------------------------------------------------
// GPU

export interface Gpu {
  name: string;
  /** 0 to 1 */
  usage?: number;
  memoryUsed?: number;
  memoryTotal?: number;
  celsius?: number;
}

/** `nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(text: string): Gpu[] {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const [name, util, used, total, temp] = line.split(",").map((s) => s.trim());
    const num = (s: string | undefined) => (s && /^\d+(\.\d+)?$/.test(s) ? Number(s) : undefined);
    const mib = (s: string | undefined) => (num(s) === undefined ? undefined : num(s)! * 1024 * 1024);
    return {
      name,
      usage: num(util) === undefined ? undefined : num(util)! / 100,
      memoryUsed: mib(used),
      memoryTotal: mib(total),
      celsius: num(temp),
    };
  });
}

/** PCI vendor id from `/sys/class/drm/cardN/device/vendor`. */
export const gpuVendor = (id: string) =>
  ({ "0x1002": "AMD", "0x10de": "NVIDIA", "0x8086": "Intel" } as Record<string, string>)[id.trim()] ?? "GPU";

// ---------------------------------------------------------------------------
// Processes

export interface ProcStat {
  pid: number;
  name: string;
  state: string;
  ppid: number;
  /** utime + stime, in clock ticks. */
  ticks: number;
  /** Resident pages. */
  rssPages: number;
  threads: number;
  /** Clock ticks after boot when it started. */
  startTicks: number;
}

/** `/proc/<pid>/stat`; the name is in parentheses and may contain spaces and parentheses. */
export function parseProcStat(text: string): ProcStat | undefined {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open < 0 || close < open) return undefined;
  const rest = text.slice(close + 2).trim().split(/\s+/);
  // rest[0] is field 3 (state); utime and stime are fields 14 and 15, rss is 24.
  return {
    pid: Number(text.slice(0, open).trim()),
    name: text.slice(open + 1, close),
    state: rest[0],
    ppid: Number(rest[1]),
    ticks: Number(rest[11]) + Number(rest[12]),
    threads: Number(rest[17]),
    startTicks: Number(rest[19]),
    rssPages: Number(rest[21]),
  };
}

export const PROCESS_STATES: Record<string, [string, Color]> = {
  R: ["Running", "green"],
  S: ["Sleeping", "gray"],
  D: ["Waiting for I/O", "orange"],
  Z: ["Zombie", "red"],
  T: ["Stopped", "yellow"],
  t: ["Traced", "yellow"],
  I: ["Idle", "gray"],
  X: ["Dead", "red"],
};

export interface PsRow {
  pid: number;
  uid: number;
  /** Resident memory in bytes. */
  rss: number;
  user: string;
}

/** `ps -e -o pid=,uid=,rss=,user:32=`. */
export function parsePs(text: string): PsRow[] {
  return text.split("\n").flatMap((line) => {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)$/);
    return m ? [{ pid: Number(m[1]), uid: Number(m[2]), rss: Number(m[3]) * 1024, user: m[4] }] : [];
  });
}

/** `ps -o pid=,args= -p …`: pid → command line. */
export function parsePsArgs(text: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const line of text.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(.*)$/);
    if (m) out.set(Number(m[1]), m[2]);
  }
  return out;
}

/**
 * CPU of a process between two samples, the way `top` shows it: 100 % is one
 * core. `elapsedTotal` is the delta of the aggregate `cpu` line of /proc/stat.
 */
export function processCpu(prevTicks: number, curTicks: number, elapsedTotal: number, cpus: number): number {
  if (elapsedTotal <= 0 || cpus <= 0) return 0;
  return Math.max(0, (curTicks - prevTicks) / (elapsedTotal / cpus));
}

// ---------------------------------------------------------------------------
// Formatting

export const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** 1536 → "1.5 kB", in powers of 1024 like file managers on Linux label them "kB, MB, GB". */
export function bytes(n: number, digits = 1): string {
  if (!Number.isFinite(n) || n < 0) return "–";
  const units = ["B", "kB", "MB", "GB", "TB", "PB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? Math.round(n) : n.toFixed(n >= 100 ? 0 : digits)} ${units[i]}`;
}

export const rate = (bytesPerSecond: number) => `${bytes(bytesPerSecond)}/s`;

export const percent = (ratio: number) => `${Math.round(clamp01(ratio) * 100)} %`;

/** 93784 → "1 d 2 h 3 min". */
export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} d ${h} h ${m} min`;
  if (h) return `${h} h ${m} min`;
  if (m) return `${m} min`;
  return `${Math.floor(seconds)} s`;
}

/** Green, then yellow from 60 %, orange from 75 %, red from 90 %. */
export const levelColor = (ratio: number): Color =>
  ratio >= 0.9 ? "red" : ratio >= 0.75 ? "orange" : ratio >= 0.6 ? "yellow" : "green";

export const temperatureColor = (celsius: number): Color =>
  celsius >= 90 ? "red" : celsius >= 80 ? "orange" : celsius >= 70 ? "yellow" : "green";

const BLOCKS = "▁▂▃▄▅▆▇█";

/** Values from 0 to `max` as a row of block characters. */
export function sparkline(values: number[], max = 1): string {
  if (!values.length) return "";
  const top = max > 0 ? max : Math.max(...values, 1);
  return values.map((v) => BLOCKS[Math.round(clamp01(v / top) * (BLOCKS.length - 1))]).join("");
}

/** Keeps the last `size` values. */
export function push(history: number[], value: number, size = 30): number[] {
  const next = [...history, value];
  return next.length > size ? next.slice(next.length - size) : next;
}
