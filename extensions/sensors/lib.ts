// Temperatures and fans from `sensors -j` (lm-sensors) or straight from /sys/class/hwmon, with their limits.
// Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type Group = "CPU" | "GPU" | "Storage" | "Memory" | "Motherboard" | "Network" | "Battery" | "Other";
export type Unit = "°C" | "RPM" | "%";

export interface Reading {
  /** Stable: chip and sensor. */
  id: string;
  /** `coretemp-isa-0000`, or the hwmon name in the fallback. */
  chip: string;
  /** `coretemp`, `nvme`, `amdgpu`… */
  driver: string;
  adapter?: string;
  /** What lm-sensors calls it: `Package id 0`, `Composite`, `fan2`. */
  label: string;
  unit: Unit;
  value: number;
  /** Where it gets hot (`_max`), and where the hardware protects itself (`_crit`). */
  high?: number;
  crit?: number;
  /** Fans: the minimum speed the board expects. */
  min?: number;
  /** An alarm or fault bit is set. */
  alarm?: boolean;
  group: Group;
  /** The drive's model, for NVMe drives. */
  model?: string;
}

// ---------------------------------------------------------------------------
// Grouping and names

const GROUPS: [Group, RegExp][] = [
  [
    "CPU",
    /^(coretemp|k10temp|k8temp|zenpower|cpu_thermal|cpu-thermal|x86_pkg_temp|soc_thermal|via_cputemp|fam15h_power|cpu\d*)/,
  ],
  ["GPU", /^(amdgpu|radeon|nouveau|i915|xe|nvidia|gpu|panfrost|lima|msm)/],
  ["Storage", /^(nvme|drivetemp|sata|ata|hdd|ssd)/],
  ["Memory", /^(spd5118|jc42|ee1004|dimm)/],
  ["Battery", /^(BAT\d*|battery|macsmc_battery)/i],
  ["Network", /^(iwlwifi|mt7\d|mt76|ath\d|rtw|r8169|igc|igb|e1000|bnxt|mlx|wifi|phy\d|enp|eth)/],
  [
    "Motherboard",
    /^(nct\d|it8\d|w83|f71|asus|asusec|asus_wmi|dell_smm|dell_ddv|thinkpad|hp_wmi|acpitz|pch_|gigabyte_wmi|nzxt|corsair|aquacomputer|acpi_fan|lenovo|msi|ec_|wmi|pwmfan|chipset|sch5)/,
  ],
];

export function groupOf(driver: string): Group {
  for (const [g, re] of GROUPS) if (re.test(driver)) return g;
  return "Other";
}

/** `coretemp-isa-0000` → `coretemp`. hwmon names have no dash, the bus and address follow. */
export const driverOf = (chip: string) => chip.split("-")[0];

const CHIP_TITLES: [RegExp, string][] = [
  [/^coretemp/, "Intel CPU"],
  [/^(k10temp|zenpower|k8temp)/, "AMD CPU"],
  [/^x86_pkg_temp/, "CPU package"],
  [/^(cpu_thermal|cpu-thermal|soc_thermal)/, "CPU"],
  [/^amdgpu/, "AMD GPU"],
  [/^radeon/, "AMD GPU (radeon)"],
  [/^nouveau/, "NVIDIA GPU (nouveau)"],
  [/^nvidia/, "NVIDIA GPU"],
  [/^(i915|xe)$/, "Intel GPU"],
  [/^nvme/, "NVMe drive"],
  [/^drivetemp/, "Drive"],
  [/^spd5118|^jc42/, "Memory module"],
  [/^acpitz/, "ACPI thermal zone"],
  [/^pch_/, "Chipset"],
  [/^(nct|it8|w83|f71)/, "Motherboard"],
  [/^thinkpad/, "ThinkPad"],
  [/^dell_smm/, "Dell"],
  [/^iwlwifi/, "Intel Wi-Fi"],
  [/^mt7/, "MediaTek Wi-Fi"],
  [/^ath/, "Qualcomm Wi-Fi"],
  [/^r8169/, "Realtek Ethernet"],
  [/^BAT/i, "Battery"],
];

export function chipTitle(driver: string): string {
  for (const [re, title] of CHIP_TITLES) if (re.test(driver)) return title;
  return driver;
}

const LABELS: Record<string, string> = {
  "Package id 0": "Package",
  Tctl: "Package (Tctl)",
  Tdie: "Die (Tdie)",
  edge: "Edge",
  junction: "Hotspot",
  mem: "Memory",
  Composite: "Composite",
  CPU: "CPU",
  GPU: "GPU",
};

/** A readable name: `Tccd1` → "CCD 1", `junction` → "Hotspot", `temp1` → "Temperature 1". */
export function prettyLabel(label: string): string {
  if (LABELS[label]) return LABELS[label];
  const ccd = label.match(/^Tccd(\d+)$/);
  if (ccd) return `CCD ${ccd[1]}`;
  const pkg = label.match(/^Package id (\d+)$/);
  if (pkg) return `Package ${pkg[1]}`;
  const raw = label.match(/^(temp|fan)(\d+)$/);
  if (raw) return `${raw[1] === "temp" ? "Temperature" : "Fan"} ${raw[2]}`;
  return label;
}

// ---------------------------------------------------------------------------
// Sanity

/** Unused inputs read 0, -128, 127 or absurd values; limits of -273 or 65 000 mean "not set". */
export const validTemp = (t: number | undefined): t is number =>
  t !== undefined && Number.isFinite(t) && t > 0 && t < 127;
const validLimit = (
  t: number | undefined,
) => (t !== undefined && Number.isFinite(t) && t > 20 && t < 200 ? t : undefined);

/** Fans that read 0 are usually headers with nothing plugged in; GPU fans stop on purpose. */
export const keepFan = (group: Group, rpm: number) => rpm > 0 || group === "GPU";

// ---------------------------------------------------------------------------
// sensors -j

/** `sensors -j` (lm-sensors 3.5+): chips → features → `temp1_input`, `fan1_input`… */
export function parseSensorsJson(text: string): Reading[] {
  let data: Record<string, Record<string, unknown>>;
  try {
    data = JSON.parse(text);
  } catch {
    // sensors prints a warning before the JSON when a chip fails to read.
    const start = text.indexOf("{");
    if (start < 0) return [];
    try {
      data = JSON.parse(text.slice(start));
    } catch {
      return [];
    }
  }
  const out: Reading[] = [];
  for (const [chip, features] of Object.entries(data ?? {})) {
    if (!features || typeof features !== "object") continue;
    const driver = driverOf(chip);
    const group = groupOf(driver);
    const adapter = typeof features.Adapter === "string" ? features.Adapter : undefined;
    for (const [label, sub] of Object.entries(features)) {
      if (!sub || typeof sub !== "object") continue;
      const values = sub as Record<string, number>;
      const keys = Object.keys(values);
      const temp = keys.find((k) => /^temp\d+_input$/.test(k));
      const fan = keys.find((k) => /^fan\d+_input$/.test(k));
      const alarm = keys.some((k) => /_(alarm|crit_alarm|max_alarm|fault)$/.test(k) && values[k] === 1);
      if (temp) {
        const n = temp.replace(/_input$/, "");
        const value = values[temp];
        if (!validTemp(value)) continue;
        out.push({
          id: `${chip}/${label}`,
          chip,
          driver,
          adapter,
          label,
          unit: "°C",
          value,
          high: validLimit(values[`${n}_max`]),
          crit: validLimit(values[`${n}_crit`]) ?? validLimit(values[`${n}_emergency`]),
          alarm: alarm || undefined,
          group,
        });
      } else if (fan) {
        const n = fan.replace(/_input$/, "");
        const value = values[fan];
        if (!Number.isFinite(value) || value < 0 || value > 30_000 || !keepFan(group, value)) continue;
        const min = values[`${n}_min`];
        out.push({
          id: `${chip}/${label}`,
          chip,
          driver,
          adapter,
          label,
          unit: "RPM",
          value,
          min: min > 0 ? min : undefined,
          alarm: alarm || undefined,
          group,
        });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// /sys/class/hwmon (read with grep, see system.ts)

const range = (n: number, from = 0) => [...Array(n).keys()].map((i) => i + from);

/** The files the fallback reads: sysfs folders can't be listed, so the usual names are tried. */
export function hwmonPaths(chips = 16, temps = 12, fans = 8): string[] {
  return range(chips).flatMap((i) => {
    const dir = `/sys/class/hwmon/hwmon${i}`;
    return [
      `${dir}/name`,
      `${dir}/device/model`,
      ...range(temps, 1).flatMap((t) => ["input", "label", "max", "crit"].map((f) => `${dir}/temp${t}_${f}`)),
      ...range(fans, 1).flatMap((t) => ["input", "label", "min"].map((f) => `${dir}/fan${t}_${f}`)),
    ];
  });
}

/** `grep -sHa '' files…`: `path:line` → path → content. */
export function parseGrep(text: string): Map<string, string> {
  const out = new Map<string, string[]>();
  for (const line of text.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const path = line.slice(0, i);
    out.set(path, [...(out.get(path) ?? []), line.slice(i + 1)]);
  }
  return new Map([...out].map(([p, lines]) => [p, lines.join("\n").trim()]));
}

/** Readings from hwmon files (millidegrees, RPM). */
export function parseHwmon(files: Map<string, string>, chips = 16): Reading[] {
  const out: Reading[] = [];
  for (let i = 0; i < chips; i++) {
    const dir = `/sys/class/hwmon/hwmon${i}`;
    const name = files.get(`${dir}/name`);
    if (!name) continue;
    const group = groupOf(name);
    const model = files.get(`${dir}/device/model`)?.trim() || undefined;
    const num = (p: string) => {
      const v = files.get(p);
      return v === undefined || v === "" ? undefined : Number(v);
    };
    for (let t = 1; t <= 32; t++) {
      const milli = num(`${dir}/temp${t}_input`);
      if (milli === undefined) continue;
      const value = milli / 1000;
      if (!validTemp(value)) continue;
      const label = files.get(`${dir}/temp${t}_label`) || `temp${t}`;
      const lim = (f: string) => {
        const v = num(`${dir}/temp${t}_${f}`);
        return v === undefined ? undefined : validLimit(v / 1000);
      };
      out.push({
        id: `hwmon:${name}:${i}/${label}`,
        chip: `${name} (hwmon${i})`,
        driver: name,
        label,
        unit: "°C",
        value,
        high: lim("max"),
        crit: lim("crit"),
        group,
        model,
      });
    }
    for (let f = 1; f <= 16; f++) {
      const rpm = num(`${dir}/fan${f}_input`);
      if (rpm === undefined || !Number.isFinite(rpm) || !keepFan(group, rpm)) continue;
      const label = files.get(`${dir}/fan${f}_label`) || `fan${f}`;
      const min = num(`${dir}/fan${f}_min`);
      out.push({
        id: `hwmon:${name}:${i}/${label}`,
        chip: `${name} (hwmon${i})`,
        driver: name,
        label,
        unit: "RPM",
        value: rpm,
        min: min && min > 0 ? min : undefined,
        group,
      });
    }
  }
  return out;
}

/** NVMe models from hwmon, given to the lm-sensors readings when it is unambiguous (one drive). */
export function attachModels(readings: Reading[], hwmon: Reading[]): Reading[] {
  const models = [...new Set(hwmon.filter((r) => r.driver === "nvme" && r.model).map((r) => r.model!))];
  const chips = new Set(readings.filter((r) => r.driver === "nvme").map((r) => r.chip));
  if (models.length !== 1 || chips.size !== 1) return readings;
  return readings.map((r) => (r.driver === "nvme" ? { ...r, model: models[0] } : r));
}

// ---------------------------------------------------------------------------
// nvidia-smi

/** `nvidia-smi --query-gpu=index,name,temperature.gpu,fan.speed --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(text: string): Reading[] {
  const out: Reading[] = [];
  for (const line of text.split("\n")) {
    const [index, name, temp, fan] = line.split(",").map((s) => s.trim());
    if (!name) continue;
    const chip = `nvidia-gpu-${index}`;
    const t = Number(temp);
    if (validTemp(t)) {
      out.push({
        id: `${chip}/GPU`,
        chip,
        driver: "nvidia",
        adapter: name,
        label: "GPU",
        unit: "°C",
        value: t,
        group: "GPU",
      });
    }
    const f = Number(fan);
    if (fan && Number.isFinite(f) && !/N\/A/i.test(fan)) {
      out.push({
        id: `${chip}/Fan`,
        chip,
        driver: "nvidia",
        adapter: name,
        label: "Fan",
        unit: "%",
        value: f,
        group: "GPU",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Limits and levels

/** Limits used when the sensor reports none. */
export const DEFAULT_LIMITS: Record<Group, { high: number; crit: number }> = {
  CPU: { high: 85, crit: 100 },
  GPU: { high: 85, crit: 100 },
  Storage: { high: 70, crit: 80 },
  Memory: { high: 75, crit: 85 },
  Motherboard: { high: 75, crit: 95 },
  Network: { high: 85, crit: 100 },
  Battery: { high: 45, crit: 60 },
  Other: { high: 80, crit: 100 },
};

export type Level = "ok" | "warm" | "high" | "critical";

/** The limits that apply: the sensor's own, else the group's; `override` replaces the high mark of every temperature. */
export function limits(r: Reading, override?: number): { high: number; crit: number; reported: boolean } {
  const d = DEFAULT_LIMITS[r.group];
  const crit = r.crit ?? Math.max(d.crit, (r.high ?? 0) + 10);
  let high = r.high ?? (r.crit ? r.crit - 10 : d.high);
  // Some chips report a high mark at or above their critical one: keep them in order.
  if (high >= crit) high = crit - 5;
  if (override && override > 0) high = Math.min(override, crit);
  return { high, crit, reported: r.high !== undefined || r.crit !== undefined };
}

export function levelOf(r: Reading, override?: number): Level {
  if (r.unit !== "°C") {
    if (r.alarm || (r.unit === "RPM" && r.min !== undefined && r.value < r.min)) return "high";
    return "ok";
  }
  const { high, crit } = limits(r, override);
  if (r.alarm || r.value >= crit) return "critical";
  if (r.value >= high) return "high";
  if (r.value >= high - 10) return "warm";
  return "ok";
}

export const LEVEL_COLORS: Record<Level, Color> = { ok: "green", warm: "yellow", high: "orange", critical: "red" };
export const LEVEL_TITLES: Record<Level, string> = {
  ok: "Normal",
  warm: "Warm",
  high: "Hot",
  critical: "Critical",
};

const LEVEL_RANK: Record<Level, number> = { ok: 0, warm: 1, high: 2, critical: 3 };
export const worse = (a: Level, b: Level) => LEVEL_RANK[a] - LEVEL_RANK[b];

// ---------------------------------------------------------------------------
// Formatting

export function formatValue(r: Pick<Reading, "unit" | "value">, fahrenheit = false): string {
  if (r.unit === "°C") return formatTemp(r.value, fahrenheit);
  if (r.unit === "%") return `${Math.round(r.value)} %`;
  return `${Math.round(r.value)} RPM`;
}

export const formatTemp = (c: number, fahrenheit = false) =>
  fahrenheit ? `${Math.round(c * 9 / 5 + 32)} °F` : `${Math.round(c)} °C`;

/** "Package" of an Intel CPU → "CPU Package"; "Composite" of an NVMe drive → "Samsung SSD 980 PRO"… */
export function readingTitle(r: Reading): string {
  const label = prettyLabel(r.label);
  if (r.group === "Storage" && r.model && /^(Composite|Temperature 1)$/.test(label)) return r.model;
  return label;
}

export function readingSubtitle(r: Reading): string {
  const parts = [r.model ?? (r.driver === "nvidia" ? r.adapter : chipTitle(r.driver))];
  if (r.model || r.driver === "nvidia") parts.push(chipTitle(r.driver));
  return [...new Set(parts.filter(Boolean))].join(" · ");
}

/** The most telling temperature of a group: the CPU package, the GPU edge/core, else the hottest. */
export function headline(readings: Reading[], group: Group): Reading | undefined {
  const temps = readings.filter((r) => r.group === group && r.unit === "°C");
  if (!temps.length) return undefined;
  const preferred = temps.find((r) => /^(Package id 0|Tctl|Tdie|edge|GPU|Composite|CPU)$/.test(r.label));
  return preferred ?? temps.reduce((a, b) => (b.value > a.value ? b : a));
}

const SHORT: Partial<Record<Group, string>> = { Storage: "Drive", Motherboard: "Board" };

/** "CPU 52 °C · GPU 45 °C · Drive 38 °C". */
export function summaryLine(readings: Reading[], fahrenheit = false): string {
  const parts: string[] = [];
  for (const g of ["CPU", "GPU", "Storage"] as Group[]) {
    const h = headline(readings, g);
    if (h) parts.push(`${SHORT[g] ?? g} ${formatTemp(h.value, fahrenheit)}`);
  }
  if (!parts.length) {
    const hottest = readings.filter((r) => r.unit === "°C").sort((a, b) => b.value - a.value)[0];
    if (hottest) parts.push(`${readingTitle(hottest)} ${formatTemp(hottest.value, fahrenheit)}`);
  }
  return parts.join(" · ");
}

export const GROUP_ORDER: Group[] = ["CPU", "GPU", "Storage", "Memory", "Motherboard", "Network", "Battery", "Other"];

/** Groups in a fixed order; in each, temperatures before fans, in the chip's own order. */
export function sortReadings(readings: Reading[]): Reading[] {
  return readings.map((r, i) => ({ r, i })).sort((a, b) =>
    GROUP_ORDER.indexOf(a.r.group) - GROUP_ORDER.indexOf(b.r.group) ||
    Number(a.r.unit !== "°C") - Number(b.r.unit !== "°C") || a.i - b.i
  ).map(({ r }) => r);
}

/** Plain text of every reading, to paste in a bug report or a forum. */
export function readingsText(readings: Reading[], fahrenheit = false): string {
  return sortReadings(readings).map((r) => {
    const l = r.unit === "°C" ? limits(r) : undefined;
    const extra = l?.reported
      ? ` (high ${formatTemp(l.high, fahrenheit)}, crit ${formatTemp(l.crit, fahrenheit)})`
      : "";
    return `${r.chip} · ${r.label}: ${formatValue(r, fahrenheit)}${extra}`;
  }).join("\n");
}

// ---------------------------------------------------------------------------
// Background warnings

export interface Warned {
  /** Reading id → the level it was last reported at. */
  [id: string]: Level;
}

/**
 * Which readings to warn about now: those that became hot or critical since the last check. A reading
 * is forgotten once it has cooled 5 °C under its high mark, so it can warn again later.
 */
export function newWarnings(
  readings: Reading[],
  warned: Warned,
  override?: number,
): { warn: { reading: Reading; level: Level }[]; next: Warned } {
  const next: Warned = {};
  const warn: { reading: Reading; level: Level }[] = [];
  for (const r of readings) {
    if (r.unit !== "°C") continue;
    const level = levelOf(r, override);
    const before = warned[r.id];
    if (level === "high" || level === "critical") {
      if (!before || worse(level, before) > 0) warn.push({ reading: r, level });
      next[r.id] = before && worse(before, level) > 0 ? before : level;
    } else if (before && r.value > limits(r, override).high - 5) {
      next[r.id] = before; // still close: don't warn again for small swings
    }
  }
  return { warn, next };
}
