// Reads /proc and /sys. Deno refuses to open them without --allow-all, so they are read in one batch
// by `grep -sH`, which prefixes each line with its file. Missing files are simply absent: every reader
// returns what it could and never throws.

import {
  type CpuInfo,
  type CpuTimes,
  type Disk,
  type Gpu,
  gpuVendor,
  type LoadAvg,
  type Memory,
  type NetCounters,
  parseCpuinfo,
  parseCpuStat,
  parseDf,
  parseGrep,
  parseLoadavg,
  parseMeminfo,
  parseMounts,
  parseNetDev,
  parseNvidiaSmi,
  realDisks,
  type Sensor,
} from "./lib.ts";

/** Runs a program and returns its stdout whatever the exit code; "" when it is missing. */
export async function capture(program: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await new Deno.Command(program, { args, stdin: "null", stdout: "piped", stderr: "null" })
      .output();
    return new TextDecoder().decode(stdout);
  } catch {
    return "";
  }
}

/** Reads many small text files in one spawn. */
export async function readFiles(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map();
  return parseGrep(await capture("grep", ["-sHa", "", "--", ...paths]));
}

/** Sleeps, waking up early when the view goes away. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

const range = (n: number) => [...Array(n).keys()];

// Candidate paths: sysfs directories can't be listed, so the usual names are tried.
const HWMON = range(16).flatMap((i) => [
  `/sys/class/hwmon/hwmon${i}/name`,
  ...range(10).flatMap((
    t,
  ) => [`/sys/class/hwmon/hwmon${i}/temp${t}_input`, `/sys/class/hwmon/hwmon${i}/temp${t}_label`]),
]);
const THERMAL = range(16).flatMap((i) => [
  `/sys/class/thermal/thermal_zone${i}/type`,
  `/sys/class/thermal/thermal_zone${i}/temp`,
]);
const BATTERIES = ["BAT0", "BAT1", "BAT2", "BAT", "CMB0", "CMB1", "battery", "macsmc-battery"];
const POWER = BATTERIES.flatMap((b) =>
  ["type", "capacity", "status", "power_now"].map((f) => `/sys/class/power_supply/${b}/${f}`)
);
const DRM = range(4).flatMap((i) =>
  ["gpu_busy_percent", "mem_info_vram_used", "mem_info_vram_total", "vendor"].map((f) =>
    `/sys/class/drm/card${i}/device/${f}`
  )
);

export interface Battery {
  name: string;
  capacity: number;
  status: string;
  /** Watts, when reported. */
  power?: number;
}

export interface Snapshot {
  cpu: { total: CpuTimes; cores: CpuTimes[] };
  memory: Memory;
  load: LoadAvg;
  net: Map<string, NetCounters>;
  uptime: number;
  info: CpuInfo & { maxMhz?: number };
  sensors: Sensor[];
  batteries: Battery[];
  gpus: Gpu[];
  mounts: string;
  host: string;
  kernel: string;
}

let threads = 0;

/** Everything the monitor shows, from one grep. */
export async function snapshot(): Promise<Snapshot> {
  const freq = range(threads).map((i) => `/sys/devices/system/cpu/cpu${i}/cpufreq/scaling_cur_freq`);
  const files = await readFiles([
    "/proc/stat",
    "/proc/meminfo",
    "/proc/loadavg",
    "/proc/net/dev",
    "/proc/uptime",
    "/proc/cpuinfo",
    "/proc/mounts",
    "/proc/sys/kernel/hostname",
    "/proc/sys/kernel/osrelease",
    "/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq",
    ...freq,
    ...HWMON,
    ...THERMAL,
    ...POWER,
    ...DRM,
  ]);
  const get = (path: string) => files.get(path) ?? "";
  const cpu = parseCpuStat(get("/proc/stat"));
  threads = cpu.cores.length;

  const info = parseCpuinfo(get("/proc/cpuinfo"));
  const khz = freq.map((p) => Number(get(p))).filter((f) => f > 0);
  const max = Number(get("/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq"));

  const sensors: Sensor[] = [];
  for (let i = 0; i < 16; i++) {
    const dir = `/sys/class/hwmon/hwmon${i}`;
    const chip = get(`${dir}/name`).trim();
    if (!chip) continue;
    for (let t = 0; t < 10; t++) {
      const milli = Number(get(`${dir}/temp${t}_input`));
      if (milli) sensors.push({ chip, label: get(`${dir}/temp${t}_label`).trim() || undefined, celsius: milli / 1000 });
    }
  }
  for (let i = 0; i < 16; i++) {
    const milli = Number(get(`/sys/class/thermal/thermal_zone${i}/temp`));
    if (milli) sensors.push({ chip: get(`/sys/class/thermal/thermal_zone${i}/type`).trim(), celsius: milli / 1000 });
  }

  const batteries: Battery[] = BATTERIES.flatMap((name) => {
    const dir = `/sys/class/power_supply/${name}`;
    const capacity = get(`${dir}/capacity`).trim();
    if (get(`${dir}/type`).trim() !== "Battery" || !capacity) return [];
    const microwatts = Number(get(`${dir}/power_now`));
    return [{
      name,
      capacity: Number(capacity),
      status: get(`${dir}/status`).trim() || "Unknown",
      power: microwatts > 0 ? microwatts / 1e6 : undefined,
    }];
  });

  // AMD cards report their load in sysfs; their temperature is the amdgpu hwmon sensor.
  const amdTemp = sensors.find((s) => s.chip === "amdgpu")?.celsius;
  const gpus: Gpu[] = range(4).flatMap((i) => {
    const dev = `/sys/class/drm/card${i}/device`;
    const busy = get(`${dev}/gpu_busy_percent`).trim();
    if (!busy) return [];
    return [{
      name: `${gpuVendor(get(`${dev}/vendor`))} graphics (card${i})`,
      usage: Number(busy) / 100,
      memoryUsed: Number(get(`${dev}/mem_info_vram_used`)) || undefined,
      memoryTotal: Number(get(`${dev}/mem_info_vram_total`)) || undefined,
      celsius: amdTemp,
    }];
  });

  return {
    cpu,
    memory: parseMeminfo(get("/proc/meminfo")),
    load: parseLoadavg(get("/proc/loadavg")),
    net: parseNetDev(get("/proc/net/dev")),
    uptime: Number(get("/proc/uptime").split(" ")[0]) || 0,
    info: {
      ...info,
      threads: info.threads || cpu.cores.length,
      mhz: khz.length ? khz.reduce((a, b) => a + b, 0) / khz.length / 1000 : info.mhz,
      maxMhz: max > 0 ? max / 1000 : undefined,
    },
    sensors,
    batteries,
    gpus: [...gpus, ...await nvidia()],
    mounts: get("/proc/mounts"),
    host: get("/proc/sys/kernel/hostname").trim(),
    kernel: get("/proc/sys/kernel/osrelease").trim(),
  };
}

/** CPU times alone, for the processes view. */
export async function cpuTimes() {
  return parseCpuStat((await readFiles(["/proc/stat"])).get("/proc/stat") ?? "");
}

/** Mounted filesystems with their usage. */
export async function disks(mounts: string): Promise<Disk[]> {
  return realDisks(parseDf(await capture("df", ["-P", "-k"])), parseMounts(mounts));
}

let nvidiaMissing = false;

async function nvidia(): Promise<Gpu[]> {
  if (nvidiaMissing) return [];
  const out = await capture("nvidia-smi", [
    "--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu",
    "--format=csv,noheader,nounits",
  ]);
  const gpus = parseNvidiaSmi(out).filter((g) => g.usage !== undefined);
  // Not installed, or no NVIDIA card: don't try again every 2 s.
  if (!gpus.length) nvidiaMissing = true;
  return gpus;
}

export async function osName(): Promise<string> {
  const text = await Deno.readTextFile("/etc/os-release").catch(() => "");
  return text.match(/^PRETTY_NAME="?([^"\n]*)"?/m)?.[1] ?? "";
}
