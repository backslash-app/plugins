import {
  action,
  type Color,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  updateCommandMetadata,
} from "@backslash/api";
import {
  bytes,
  cpuTemperature,
  cpuUsage,
  type Disk,
  duration,
  type Gpu,
  interfaceKind,
  isPhysicalInterface,
  levelColor,
  type LoadAvg,
  type Memory,
  type NetCounters,
  percent,
  push,
  rate,
  sparkline,
  temperatureColor,
} from "../lib.ts";
import { processView } from "../processes.ts";
import { type Battery, disks, osName, sleep, type Snapshot, snapshot } from "../system.ts";

const INTERVAL = 2000;

const topByCpu = action("Show Top Processes by CPU", () => processView("Processes by CPU", "cpu"), {
  icon: Icons.activity,
  shortcut: "<Ctrl>p",
});
const topByMemory = action("Show Top Processes by Memory", () => processView("Processes by Memory", "memory"), {
  icon: Icons.layers,
  shortcut: "<Ctrl><Shift>p",
});

const history = (values: number[], max = 1) => values.length > 1 ? `\`${sparkline(values, max)}\`` : "";

function cpuItem(
  usage: number,
  cores: number[],
  info: Snapshot["info"],
  load: LoadAvg,
  celsius: number | undefined,
  past: number[],
): Item {
  const color = levelColor(usage);
  const threads = cores.length || info.threads;
  const ghz = info.mhz ? `${(info.mhz / 1000).toFixed(2)} GHz` : undefined;
  const summary = `CPU ${percent(usage)} · load ${load.one.toFixed(2)}${celsius ? ` · ${Math.round(celsius)} °C` : ""}`;
  return {
    id: "cpu",
    title: "CPU",
    subtitle: info.model,
    icon: { source: Icons.cpu, tint: color },
    section: "Overview",
    keywords: ["processor", "processeur", "load", "charge", "temperature", "température", info.model],
    accessories: [
      ...(celsius
        ? [{ text: `${Math.round(celsius)} °C`, icon: Icons.thermometer, color: temperatureColor(celsius) }]
        : []),
      { text: percent(usage), color, tooltip: `${threads} threads` },
    ],
    detail: {
      stats: [
        { label: "Usage", value: percent(usage), color },
        { label: "Load (1 min)", value: load.one.toFixed(2), color: load.one > threads ? "orange" : undefined },
        celsius
          ? { label: "Temperature", value: `${Math.round(celsius)} °C`, color: temperatureColor(celsius) }
          : { label: "Frequency", value: ghz ?? "–" },
      ],
      markdown: past.length > 1 ? `**Last minute** ${history(past)}` : undefined,
      metadata: [
        meta.text("Model", info.model, { icon: Icons.cpu }),
        meta.text("Cores", info.cores ? `${info.cores} cores · ${threads} threads` : `${threads} threads`),
        ...(ghz
          ? [meta.text("Frequency", info.maxMhz ? `${ghz} (max ${(info.maxMhz / 1000).toFixed(2)} GHz)` : ghz, {
            icon: Icons.bolt,
          })]
          : []),
        ...(celsius
          ? [meta.text("Temperature", `${celsius.toFixed(1)} °C`, {
            icon: Icons.thermometer,
            color: temperatureColor(celsius),
          })]
          : []),
        meta.text("Load average", `${load.one.toFixed(2)} · ${load.five.toFixed(2)} · ${load.fifteen.toFixed(2)}`, {
          icon: Icons.activity,
        }),
        meta.text("Processes", `${load.running} running of ${load.processes}`),
        meta.separator(),
        ...cores.map((c, i) => meta.progress(`Core ${i}`, c)),
      ],
    },
    actions: [topByCpu, topByMemory, copy(summary, "Copy Summary", { section: "Copy" })],
  };
}

function memoryItem(m: Memory, past: number[]): Item {
  const ratio = m.total ? m.used / m.total : 0;
  const swap = m.swapTotal ? m.swapUsed / m.swapTotal : 0;
  const color = levelColor(ratio);
  const summary = `RAM ${bytes(m.used)} of ${bytes(m.total)} (${percent(ratio)})`;
  return {
    id: "memory",
    title: "Memory",
    subtitle: `${bytes(m.used)} of ${bytes(m.total)}`,
    icon: { source: Icons.layers, tint: color },
    section: "Overview",
    keywords: ["ram", "memory", "mémoire", "swap", "mem"],
    accessories: [
      ...(m.swapTotal && m.swapUsed > 0 ? [{ text: `swap ${percent(swap)}`, color: levelColor(swap) }] : []),
      { text: percent(ratio), color },
    ],
    detail: {
      stats: [
        { label: "Used", value: bytes(m.used), color },
        { label: "Available", value: bytes(m.available) },
        { label: "Swap", value: m.swapTotal ? bytes(m.swapUsed) : "None" },
      ],
      markdown: past.length > 1 ? `**Last minute** ${history(past)}` : undefined,
      metadata: [
        meta.progress("RAM", ratio, `${bytes(m.used)} / ${bytes(m.total)} · ${percent(ratio)}`),
        ...(m.swapTotal
          ? [meta.progress("Swap", swap, `${bytes(m.swapUsed)} / ${bytes(m.swapTotal)} · ${percent(swap)}`)]
          : [meta.text("Swap", "No swap configured", { color: "gray" })]),
        meta.separator(),
        meta.text("Total", bytes(m.total), { icon: Icons.layers }),
        meta.text("Cache", bytes(m.cached), { icon: Icons.archive }),
        meta.text("Buffers", bytes(m.buffers)),
      ],
    },
    actions: [topByMemory, topByCpu, copy(summary, "Copy Summary", { section: "Copy" })],
  };
}

function gpuItem(g: Gpu, i: number): Item {
  const usage = g.usage ?? 0;
  const vram = g.memoryTotal ? (g.memoryUsed ?? 0) / g.memoryTotal : undefined;
  return {
    id: `gpu-${i}`,
    title: "GPU",
    subtitle: g.name,
    icon: { source: Icons.monitor, tint: levelColor(usage) },
    section: "Overview",
    keywords: ["gpu", "graphics", "carte graphique", "vram", g.name],
    accessories: [
      ...(g.celsius
        ? [{ text: `${Math.round(g.celsius)} °C`, icon: Icons.thermometer, color: temperatureColor(g.celsius) }]
        : []),
      { text: percent(usage), color: levelColor(usage) },
    ],
    detail: {
      stats: [
        { label: "Usage", value: percent(usage), color: levelColor(usage) },
        ...(g.memoryUsed !== undefined ? [{ label: "VRAM", value: bytes(g.memoryUsed) }] : []),
        ...(g.celsius
          ? [{ label: "Temperature", value: `${Math.round(g.celsius)} °C`, color: temperatureColor(g.celsius) }]
          : []),
      ],
      metadata: [
        meta.text("Model", g.name, { icon: Icons.monitor }),
        meta.progress("Usage", usage),
        ...(vram !== undefined
          ? [meta.progress("Video memory", vram, `${bytes(g.memoryUsed ?? 0)} / ${bytes(g.memoryTotal ?? 0)}`)]
          : []),
      ],
    },
    actions: [copy(`${g.name}: ${percent(usage)}`, "Copy Summary", { section: "Copy" })],
  };
}

function batteryItem(b: Battery): Item {
  const ratio = b.capacity / 100;
  const charging = b.status === "Charging";
  const color: Color = charging ? "green" : ratio < 0.15 ? "red" : ratio < 0.3 ? "orange" : "green";
  return {
    id: `battery-${b.name}`,
    title: "Battery",
    subtitle: b.status === "Not charging" ? "Plugged in, not charging" : b.status,
    icon: { source: charging ? Icons.batteryCharging : Icons.battery, tint: color },
    section: "Overview",
    keywords: ["battery", "batterie", "power", "charge"],
    accessories: [{ text: `${b.capacity} %`, color }],
    detail: {
      stats: [
        { label: "Charge", value: `${b.capacity} %`, color },
        { label: "Status", value: b.status },
        ...(b.power ? [{ label: charging ? "Charging at" : "Drawing", value: `${b.power.toFixed(1)} W` }] : []),
      ],
      metadata: [meta.progress("Charge", ratio), meta.text("Device", b.name, { icon: Icons.battery })],
    },
  };
}

function diskItem(d: Disk): Item {
  const ratio = d.size ? d.used / d.size : 0;
  const color = levelColor(ratio);
  const name = d.mount === "/" ? "System" : d.mount.split("/").pop() || d.mount;
  return {
    id: `disk-${d.mount}`,
    title: name,
    subtitle: `${bytes(d.available)} free of ${bytes(d.size)}`,
    icon: { source: Icons.drive, tint: color },
    section: "Disks",
    keywords: ["disk", "disque", "storage", "stockage", "space", "espace", d.mount, d.device, d.fstype],
    accessories: [{ tag: d.mount, color: "gray" }, { text: percent(ratio), color }],
    detail: {
      stats: [
        { label: "Used", value: bytes(d.used), color },
        { label: "Free", value: bytes(d.available) },
        { label: "Size", value: bytes(d.size) },
      ],
      metadata: [
        meta.progress("Usage", ratio, `${percent(ratio)} used`),
        meta.separator(),
        meta.text("Mounted on", d.mount, { icon: Icons.folder }),
        meta.text("Device", d.device, { icon: Icons.drive }),
        ...(d.fstype ? [meta.tags("File system", [d.fstype])] : []),
      ],
    },
    actions: [
      open(d.mount, "Open in File Manager", { icon: Icons.folder }),
      copy(d.mount, "Copy Mount Point", { section: "Copy" }),
      copy(d.device, "Copy Device", { section: "Copy" }),
    ],
  };
}

interface Throughput {
  name: string;
  down: number;
  up: number;
  totals: NetCounters;
  past: number[];
}

const NET_ICONS = { wifi: Icons.wifi, ethernet: Icons.plug, vpn: Icons.vpn, mobile: Icons.globe, other: Icons.globe };
const NET_KINDS = {
  wifi: "Wi-Fi",
  ethernet: "Ethernet",
  vpn: "VPN / tunnel",
  mobile: "Mobile broadband",
  other: "Network",
};

function netItem(n: Throughput): Item {
  const kind = interfaceKind(n.name);
  const busy = n.down + n.up > 64 * 1024;
  return {
    id: `net-${n.name}`,
    title: n.name,
    subtitle: `↓ ${rate(n.down)}  ↑ ${rate(n.up)}`,
    icon: { source: NET_ICONS[kind], tint: busy ? "blue" : "gray" },
    section: "Network",
    keywords: ["network", "réseau", "bandwidth", "débit", "download", "upload", NET_KINDS[kind]],
    accessories: [{ tag: NET_KINDS[kind], color: "gray" }],
    detail: {
      stats: [
        { label: "Download", value: rate(n.down), color: "blue" },
        { label: "Upload", value: rate(n.up), color: "purple" },
      ],
      markdown: n.past.length > 1 ? `**Download, last minute** ${history(n.past, 0)}` : undefined,
      metadata: [
        meta.text("Interface", n.name, { icon: NET_ICONS[kind] }),
        meta.text("Type", NET_KINDS[kind]),
        meta.separator(),
        meta.text("Received since boot", bytes(n.totals.rx), { icon: Icons.arrowDown }),
        meta.text("Sent since boot", bytes(n.totals.tx), { icon: Icons.arrowUp }),
      ],
    },
    actions: [copy(`${n.name}: ↓ ${rate(n.down)} ↑ ${rate(n.up)}`, "Copy Throughput", { section: "Copy" })],
  };
}

function uptimeItem(seconds: number, host: string, os: string, kernel: string, load: LoadAvg): Item {
  const booted = new Date(Date.now() - seconds * 1000);
  const lines: Metadata[] = [
    meta.text("Booted", booted.toLocaleString(), { icon: Icons.power }),
    ...(host ? [meta.text("Host name", host, { icon: Icons.home })] : []),
    ...(os ? [meta.text("System", os, { icon: Icons.monitor })] : []),
    ...(kernel ? [meta.text("Kernel", kernel, { icon: Icons.code })] : []),
    meta.text("Processes", load.processes),
  ];
  return {
    id: "uptime",
    title: "Uptime",
    subtitle: duration(seconds),
    icon: { source: Icons.clock, tint: "teal" },
    section: "Overview",
    keywords: ["uptime", "boot", "démarrage", "kernel", "noyau", "host"],
    accessories: [{ text: `since ${booted.toLocaleDateString([], { day: "numeric", month: "short" })}` }],
    detail: {
      stats: [{ label: "Up for", value: duration(seconds) }, { label: "Processes", value: load.processes }],
      metadata: lines,
    },
    actions: [
      copy(
        [`Up ${duration(seconds)}`, os, kernel && `Linux ${kernel}`, host].filter(Boolean).join(" · "),
        "Copy System Info",
        { section: "Copy" },
      ),
    ],
  };
}

let status = "Measuring…";

export default list({
  placeholder: "Filter CPU, memory, disks, network…",
  empty: { title: "Nothing to show", description: "/proc could not be read", icon: Icons.activity },
  actions: [topByCpu, topByMemory],
  status: () => status,
  async *items({ signal }) {
    const os = await osName();
    let prev = await snapshot();
    let prevTime = performance.now();
    let cpuPast: number[] = [];
    let memPast: number[] = [];
    const netPast = new Map<string, number[]>();
    let subtitle = "";
    // A short first sample so the numbers are real from the first frame.
    await sleep(400, signal);
    while (!signal.aborted) {
      const now = await snapshot();
      const { cpu, memory: mem, load, net } = now;
      const mounts = await disks(now.mounts);
      const prevCpu = prev.cpu;
      const prevNet = prev.net;
      const seconds = Math.max(0.001, (performance.now() - prevTime) / 1000);
      const usage = cpuUsage(prevCpu.total, cpu.total);
      const cores = cpu.cores.map((c, i) => cpuUsage(prevCpu.cores[i] ?? c, c));
      const ram = mem.total ? mem.used / mem.total : 0;
      cpuPast = push(cpuPast, usage);
      memPast = push(memPast, ram);

      const throughput: Throughput[] = [];
      for (const [name, c] of net) {
        if (!isPhysicalInterface(name) || c.rx + c.tx === 0) continue;
        const p = prevNet.get(name) ?? c;
        const down = Math.max(0, (c.rx - p.rx) / seconds);
        const past = push(netPast.get(name) ?? [], down);
        netPast.set(name, past);
        throughput.push({ name, down, up: Math.max(0, (c.tx - p.tx) / seconds), totals: c, past });
      }

      status = `CPU ${percent(usage)} · RAM ${percent(ram)} · ${bytes(mem.used)} used · updated every 2 s`;
      const next = `CPU ${percent(usage)} · RAM ${percent(ram)}`;
      if (next !== subtitle) {
        subtitle = next;
        updateCommandMetadata({ subtitle }).catch(() => {});
      }

      yield [
        cpuItem(usage, cores, now.info, load, cpuTemperature(now.sensors), cpuPast),
        memoryItem(mem, memPast),
        ...now.gpus.map(gpuItem),
        ...now.batteries.map(batteryItem),
        uptimeItem(now.uptime, now.host, os, now.kernel, load),
        ...mounts.map(diskItem),
        ...throughput.sort((a, b) => b.totals.rx - a.totals.rx).map(netItem),
      ];

      prev = now;
      prevTime = performance.now();
      await sleep(INTERVAL, signal);
    }
  },
});
