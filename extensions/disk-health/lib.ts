// Parsing lsblk, smartctl's JSON, btrfs and zpool output, and judging a drive's health.
// Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Drives (lsblk)

/** Columns asked of lsblk; older util-linux (< 2.33) lacks PATH and FSVER, then the short list is used. */
export const COLUMNS = "NAME,PATH,TYPE,SIZE,MODEL,VENDOR,SERIAL,REV,TRAN,ROTA,RM,FSTYPE,UUID,LABEL,MOUNTPOINT";
export const COLUMNS_SHORT = "NAME,TYPE,SIZE,MODEL,SERIAL,TRAN,ROTA,RM,FSTYPE,UUID,LABEL,MOUNTPOINT";

export interface Filesystem {
  device: string;
  fstype: string;
  uuid?: string;
  label?: string;
  mountpoint?: string;
}

export interface Disk {
  name: string;
  path: string;
  model?: string;
  vendor?: string;
  serial?: string;
  firmware?: string;
  size: number;
  transport?: string;
  rotational: boolean;
  removable: boolean;
  /** Every filesystem on the disk, partitions and LUKS/LVM contents included. */
  filesystems: Filesystem[];
}

// lsblk prints booleans and numbers as JSON values since 2.33, as strings before.
const bool = (v: unknown) => v === true || v === 1 || v === "1" || v === "true";
const num = (v: unknown) => (v === null || v === undefined || v === "" ? undefined : Number(v));
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

interface Raw {
  [key: string]: unknown;
  children?: Raw[];
}

function filesystems(r: Raw): Filesystem[] {
  const own: Filesystem[] = str(r.fstype)
    ? [{
      device: str(r.path) ?? `/dev/${r.name}`,
      fstype: String(r.fstype),
      uuid: str(r.uuid),
      label: str(r.label),
      mountpoint: str(r.mountpoint),
    }]
    : [];
  return [...own, ...(r.children ?? []).flatMap(filesystems)];
}

/** Drives SMART can talk to: no loop devices, RAM disks, optical drives, device-mapper or empty card readers. */
export function parseLsblk(json: string): Disk[] {
  const devices = (JSON.parse(json).blockdevices ?? []) as Raw[];
  return devices.flatMap((r) => {
    const name = String(r.name);
    if (String(r.type ?? "disk") !== "disk" || /^(zram|ram|loop|md|dm-|sr)/.test(name)) return [];
    const size = num(r.size) ?? 0;
    if (size === 0) return [];
    return [{
      name,
      path: str(r.path) ?? `/dev/${name}`,
      model: str(r.model)?.replace(/_/g, " "),
      // Virtual disks report a PCI id ("0x1af4") as vendor.
      vendor: str(r.vendor)?.startsWith("0x") ? undefined : str(r.vendor),
      serial: str(r.serial),
      firmware: str(r.rev),
      size,
      transport: str(r.tran),
      rotational: bool(r.rota),
      removable: bool(r.rm),
      filesystems: (r.children ?? []).flatMap(filesystems).concat(
        str(r.fstype) ? filesystems({ ...r, children: [] }) : [],
      ),
    }];
  });
}

/** One entry per Btrfs filesystem (a filesystem can span several drives), where it is mounted. */
export function btrfsFilesystems(
  disks: Disk[],
): { uuid: string; label?: string; mountpoint?: string; devices: string[] }[] {
  const byUuid = new Map<string, { uuid: string; label?: string; mountpoint?: string; devices: string[] }>();
  for (const fs of disks.flatMap((d) => d.filesystems)) {
    if (fs.fstype !== "btrfs") continue;
    const key = fs.uuid ?? fs.device;
    const entry = byUuid.get(key) ?? { uuid: key, label: fs.label, devices: [] };
    entry.devices.push(fs.device);
    // The shortest mount point is the most meaningful: "/" before "/home".
    if (fs.mountpoint && (!entry.mountpoint || fs.mountpoint.length < entry.mountpoint.length)) {
      entry.mountpoint = fs.mountpoint;
    }
    byUuid.set(key, entry);
  }
  return [...byUuid.values()];
}

const TRANSPORTS: Record<string, string> = {
  usb: "USB",
  sata: "SATA",
  ata: "ATA",
  nvme: "NVMe",
  mmc: "SD card",
  scsi: "SCSI",
  sas: "SAS",
  virtio: "Virtual",
};

/** "NVMe SSD", "SATA HDD", "USB drive". */
export function kind(d: Disk, smart?: Smart): string {
  if (d.transport === "nvme" || smart?.protocol === "NVMe") return "NVMe SSD";
  const bus = d.transport ? TRANSPORTS[d.transport] ?? d.transport.toUpperCase() : "";
  const rotation = smart?.rotationRate;
  const ssd = rotation !== undefined ? rotation === 0 : !d.rotational;
  if (d.transport === "usb" || d.transport === "mmc") return `${bus} drive`;
  return [bus, ssd ? "SSD" : "HDD"].filter(Boolean).join(" ");
}

export function diskName(d: Disk, smart?: Smart): string {
  const model = smart?.model ?? d.model ?? "";
  const vendor = d.vendor && !model.toLowerCase().startsWith(d.vendor.toLowerCase()) ? d.vendor : "";
  return [vendor, model].filter(Boolean).join(" ") || `${kind(d)} ${d.name}`;
}

// ---------------------------------------------------------------------------
// SMART (smartctl -j -a)

export interface Attribute {
  id: number;
  name: string;
  value: number;
  worst: number;
  thresh: number;
  raw: number;
  rawText: string;
  failed?: string;
}

export interface SelfTest {
  type: string;
  result: string;
  passed: boolean;
  hours?: number;
}

export interface Smart {
  device: string;
  protocol?: "ATA" | "NVMe" | "SCSI";
  model?: string;
  serial?: string;
  firmware?: string;
  capacity?: number;
  rotationRate?: number;
  /** SMART unsupported, or smartctl couldn't open the drive. */
  error?: string;
  available: boolean;
  passed?: boolean;
  temperature?: number;
  powerOnHours?: number;
  powerCycles?: number;
  reallocated?: number;
  pending?: number;
  uncorrectable?: number;
  crcErrors?: number;
  /** NVMe: percentage used of the rated endurance; SATA SSD: derived from the wear attributes. */
  lifeUsed?: number;
  availableSpare?: number;
  spareThreshold?: number;
  criticalWarning?: number;
  mediaErrors?: number;
  unsafeShutdowns?: number;
  bytesRead?: number;
  bytesWritten?: number;
  attributes: Attribute[];
  lastTest?: SelfTest;
  /** A self-test is running: the percentage left. */
  testRemaining?: number;
  /** Minutes a short self-test takes, as the drive says. */
  shortTestMinutes?: number;
}

// deno-lint-ignore no-explicit-any
type J = any;

const n = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** NVMe data units are thousands of 512-byte blocks. */
export const NVME_UNIT = 512_000;

export function parseSmart(device: string, json: string): Smart {
  let j: J;
  try {
    j = JSON.parse(json);
  } catch {
    const line = json.split("\n").map((l) => l.trim()).filter(Boolean).pop();
    return { device, available: false, error: line || "smartctl printed nothing", attributes: [] };
  }
  const protocol = j.device?.protocol as Smart["protocol"];
  const errors = ((j.smartctl?.messages ?? []) as J[]).filter((m) => m.severity === "error").map((m) => m.string);
  const attributes: Attribute[] = ((j.ata_smart_attributes?.table ?? []) as J[]).map((a) => ({
    id: a.id,
    name: String(a.name ?? `Attribute ${a.id}`).replace(/_/g, " "),
    value: a.value,
    worst: a.worst,
    thresh: a.thresh,
    raw: n(a.raw?.value) ?? 0,
    rawText: String(a.raw?.string ?? a.raw?.value ?? ""),
    failed: str(a.when_failed),
  }));
  const attr = (id: number) => attributes.find((a) => a.id === id);
  const nvme = j.nvme_smart_health_information_log;

  const smart: Smart = {
    device,
    protocol,
    model: str(j.model_name) ?? str(j.scsi_model_name),
    serial: str(j.serial_number),
    firmware: str(j.firmware_version),
    capacity: n(j.user_capacity?.bytes) ?? n(j.nvme_total_capacity),
    rotationRate: n(j.rotation_rate),
    available: j.smart_support?.available !== false && (!!j.smart_status || !!nvme || attributes.length > 0),
    passed: typeof j.smart_status?.passed === "boolean" ? j.smart_status.passed : undefined,
    temperature: n(j.temperature?.current) ?? n(nvme?.temperature),
    powerOnHours: n(j.power_on_time?.hours) ?? n(nvme?.power_on_hours),
    powerCycles: n(j.power_cycle_count) ?? n(nvme?.power_cycles),
    attributes,
  };
  if (errors.length && !smart.available) smart.error = errors.join(" · ");
  if (j.smart_support?.available === false) smart.error ??= "This drive doesn't support SMART";
  else if (j.smart_support?.enabled === false) smart.error ??= "SMART is disabled on this drive";

  if (nvme) {
    smart.lifeUsed = n(nvme.percentage_used);
    smart.availableSpare = n(nvme.available_spare);
    smart.spareThreshold = n(nvme.available_spare_threshold);
    smart.criticalWarning = n(nvme.critical_warning);
    smart.mediaErrors = n(nvme.media_errors);
    smart.unsafeShutdowns = n(nvme.unsafe_shutdowns);
    if (n(nvme.data_units_read) !== undefined) smart.bytesRead = nvme.data_units_read * NVME_UNIT;
    if (n(nvme.data_units_written) !== undefined) smart.bytesWritten = nvme.data_units_written * NVME_UNIT;
  } else {
    smart.reallocated = attr(5)?.raw;
    smart.pending = attr(197)?.raw;
    smart.uncorrectable = attr(198)?.raw;
    smart.crcErrors = attr(199)?.raw;
    smart.lifeUsed = ataLifeUsed(j, attr);
    const block = n(j.logical_block_size) ?? 512;
    const written = attr(241), read = attr(242);
    // Total_LBAs_Written: most drives count logical blocks; a few count 32 MiB units and say so in the name.
    if (written && /LBAs/i.test(written.name)) smart.bytesWritten = written.raw * block;
    if (read && /LBAs/i.test(read.name)) smart.bytesRead = read.raw * block;
    if (smart.temperature === undefined) {
      const t = attr(194) ?? attr(190);
      if (t) smart.temperature = t.raw & 0xff;
    }
    if (smart.powerOnHours === undefined && attr(9)) smart.powerOnHours = attr(9)!.raw;
  }

  // Self-tests: the latest result, and the one running.
  const ataLog = j.ata_smart_self_test_log?.standard?.table?.[0];
  const nvmeLog = j.nvme_self_test_log?.table?.[0];
  if (ataLog) {
    smart.lastTest = {
      type: String(ataLog.type?.string ?? "Self-test"),
      result: String(ataLog.status?.string ?? ""),
      passed: ataLog.status?.passed !== false,
      hours: n(ataLog.lifetime_hours),
    };
  } else if (nvmeLog) {
    const result = String(nvmeLog.self_test_result?.string ?? "");
    smart.lastTest = {
      type: String(nvmeLog.self_test_code?.string ?? "Self-test"),
      result,
      passed: (n(nvmeLog.self_test_result?.value) ?? 0) === 0 || /without error/i.test(result),
      hours: n(nvmeLog.power_on_hours),
    };
  }
  const ataRunning = j.ata_smart_data?.self_test?.status;
  if (ataRunning && ((n(ataRunning.value) ?? 0) >> 4) === 0xf) {
    smart.testRemaining = n(ataRunning.remaining_percent) ?? (ataRunning.value & 0xf) * 10;
  }
  const nvmeRunning = j.nvme_self_test_log?.current_self_test_operation;
  if (nvmeRunning && (n(nvmeRunning.value) ?? 0) !== 0) {
    smart.testRemaining = 100 - (n(j.nvme_self_test_log.current_self_test_completion_percent) ?? 0);
  }
  // NVMe short self-tests last two minutes at most (NVMe base specification).
  smart.shortTestMinutes = n(j.ata_smart_data?.self_test?.polling_minutes?.short) ??
    (protocol === "NVMe" ? 2 : undefined);
  return smart;
}

/** A SATA SSD's wear: device statistics when present, else the vendors' "life left" attributes. */
function ataLifeUsed(j: J, attr: (id: number) => Attribute | undefined): number | undefined {
  for (const page of (j.ata_device_statistics?.pages ?? []) as J[]) {
    for (const s of (page.table ?? []) as J[]) {
      if (/Percentage Used Endurance/i.test(String(s.name)) && s.flags?.valid !== false && n(s.value) !== undefined) {
        return s.value;
      }
    }
  }
  // Normalized values counting down from 100: SSD_Life_Left, Media_Wearout_Indicator, Wear_Leveling_Count,
  // Percent_Lifetime_Remain.
  for (const id of [231, 233, 177, 202]) {
    const a = attr(id);
    if (a && a.value > 0 && a.value <= 100) return 100 - a.value;
  }
  return undefined;
}

export type Level = "good" | "warning" | "failing" | "unknown";

export interface Health {
  level: Level;
  label: string;
  reasons: string[];
}

export const LEVEL_COLOR: Record<Level, Color> = { good: "green", warning: "orange", failing: "red", unknown: "gray" };

/** Above this, a drive runs hot (HDDs are rated lower than SSDs). */
export const hotAt = (s: Smart) => (s.protocol === "NVMe" ? 70 : s.rotationRate ? 55 : 65);

const plural = (count: number, word: string) => `${count.toLocaleString("en-US")} ${word}${count === 1 ? "" : "s"}`;

/** The verdict shown in the list, with what led to it. */
export function health(s?: Smart): Health {
  if (!s) return { level: "unknown", label: "Not read", reasons: [] };
  if (!s.available) return { level: "unknown", label: "No SMART", reasons: s.error ? [s.error] : [] };
  const failing: string[] = [];
  const warning: string[] = [];
  if (s.passed === false) failing.push("The drive's own assessment is FAILED: back up your data now");
  if (s.criticalWarning) failing.push(`NVMe critical warning ${criticalWarnings(s.criticalWarning).join(", ")}`);
  for (const a of s.attributes) {
    if (a.failed === "now") failing.push(`${a.name} is below its threshold`);
  }
  if (s.reallocated) warning.push(`${plural(s.reallocated, "reallocated sector")}`);
  if (s.pending) warning.push(`${plural(s.pending, "sector")} waiting to be reallocated`);
  if (s.uncorrectable) warning.push(`${plural(s.uncorrectable, "uncorrectable sector")}`);
  if (s.mediaErrors) warning.push(`${plural(s.mediaErrors, "media error")}`);
  if (s.lifeUsed !== undefined && s.lifeUsed >= 90) warning.push(`${s.lifeUsed}% of the rated endurance used`);
  if (s.availableSpare !== undefined && s.spareThreshold !== undefined && s.availableSpare <= s.spareThreshold) {
    warning.push(`Spare blocks at ${s.availableSpare}% (threshold ${s.spareThreshold}%)`);
  }
  if (s.temperature !== undefined && s.temperature >= hotAt(s)) warning.push(`Running hot: ${s.temperature} °C`);
  if (s.lastTest && !s.lastTest.passed) warning.push(`Last self-test: ${s.lastTest.result}`);
  if (failing.length) return { level: "failing", label: "Failing", reasons: [...failing, ...warning] };
  if (warning.length) return { level: "warning", label: "Warning", reasons: warning };
  if (s.passed === undefined && !s.attributes.length && s.lifeUsed === undefined) {
    return { level: "unknown", label: "Unknown", reasons: [] };
  }
  return { level: "good", label: "Healthy", reasons: [] };
}

/** The bits of an NVMe critical warning, spelled out. */
export function criticalWarnings(bits: number): string[] {
  const names = [
    "spare below threshold",
    "temperature out of range",
    "reliability degraded",
    "read-only mode",
    "volatile backup failed",
    "persistent memory read-only",
  ];
  const out = names.filter((_, i) => bits & (1 << i));
  return out.length ? out : [`0x${bits.toString(16)}`];
}

// ---------------------------------------------------------------------------
// Btrfs

export interface Scrub {
  status: "finished" | "running" | "aborted" | "interrupted" | "never" | "unknown";
  started?: string;
  duration?: string;
  total?: string;
  progress?: number;
  errors: number;
  summary?: string;
}

/** `btrfs scrub status <mount>`, the btrfs-progs 5.x+ layout and the older one-line layout. */
export function parseScrubStatus(text: string): Scrub {
  if (/no stats available/i.test(text)) return { status: "never", errors: 0 };
  const field = (name: string) => text.match(new RegExp(`^\\s*${name}:\\s*(.+)$`, "mi"))?.[1]?.trim();
  const status = field("Status")?.toLowerCase();
  if (status) {
    const summary = field("Error summary");
    const scrubbed = field("Bytes scrubbed");
    let errors = 0;
    if (summary && !/no errors/i.test(summary)) {
      for (const m of summary.matchAll(/=(\d+)/g)) errors += Number(m[1]);
      const uncorrectable = Number(field("Uncorrectable") ?? 0);
      if (!errors) errors = uncorrectable;
    }
    return {
      status: (["finished", "running", "aborted", "interrupted"].includes(status) ? status : "unknown") as Scrub[
        "status"
      ],
      started: field("Scrub started"),
      duration: field("Duration"),
      total: field("Total to scrub"),
      progress: scrubbed ? Number(scrubbed.match(/\(([\d.]+)%\)/)?.[1] ?? NaN) || undefined : undefined,
      errors,
      summary,
    };
  }
  // btrfs-progs < 5.1: "scrub started at Sun Oct 26 03:00:01 2026 and finished after 00:05:12"
  const old = text.match(/scrub started at (.+?) and (finished|was aborted|running) (?:after|for) ([\d:]+)/);
  if (old) {
    const errors = Number(text.match(/with (\d+) errors/)?.[1] ?? 0);
    return {
      status: old[2] === "finished" ? "finished" : old[2] === "running" ? "running" : "aborted",
      started: old[1],
      duration: old[3],
      total: text.match(/total bytes scrubbed: (\S+)/)?.[1],
      errors,
      summary: errors ? `${errors} errors` : "no errors found",
    };
  }
  return { status: "unknown", errors: 0 };
}

export interface DeviceStats {
  device: string;
  counters: Record<string, number>;
  total: number;
}

/** `btrfs device stats <mount>`: "[/dev/nvme0n1p2].write_io_errs    0", per device. */
export function parseDeviceStats(text: string): DeviceStats[] {
  const byDevice = new Map<string, DeviceStats>();
  for (const m of text.matchAll(/^\[(.+?)\]\.(\w+)\s+(\d+)\s*$/gm)) {
    const entry = byDevice.get(m[1]) ?? { device: m[1], counters: {}, total: 0 };
    const value = Number(m[3]);
    entry.counters[m[2]] = value;
    entry.total += value;
    byDevice.set(m[1], entry);
  }
  return [...byDevice.values()];
}

/** "write_io_errs" → "Write I/O errors". */
export function counterName(key: string): string {
  return ({
    write_io_errs: "Write I/O errors",
    read_io_errs: "Read I/O errors",
    flush_io_errs: "Flush I/O errors",
    corruption_errs: "Checksum errors",
    generation_errs: "Generation errors",
  } as Record<string, string>)[key] ?? key.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// ZFS

/** The columns asked of `zpool list -H -o`. */
export const ZPOOL_COLUMNS = "name,size,alloc,free,frag,cap,health";

export interface Pool {
  name: string;
  size: string;
  allocated: string;
  free: string;
  fragmentation: string;
  capacity: number;
  health: string;
  state?: string;
  scan?: string;
  errors?: string;
  status?: string;
  action?: string;
  devices: { name: string; state: string; errors: string }[];
}

/** `zpool list -H -o name,size,alloc,free,frag,cap,health`: tab-separated. */
export function parseZpoolList(text: string): Pool[] {
  return text.split("\n").filter((l) => l.trim()).map((line) => {
    const [name, size, allocated, free, fragmentation, cap, health] = line.split("\t");
    return {
      name,
      size,
      allocated,
      free,
      fragmentation: fragmentation ?? "-",
      capacity: Number(String(cap ?? "0").replace("%", "")) || 0,
      health: health ?? "UNKNOWN",
      devices: [],
    };
  });
}

/** `zpool status`: the state, scan and errors lines of each pool, and its devices' error counts. */
export function parseZpoolStatus(text: string): Map<string, Partial<Pool>> {
  const out = new Map<string, Partial<Pool>>();
  for (const block of text.split(/^\s*pool: /m).slice(1)) {
    const name = block.split("\n")[0].trim();
    // Continuation lines are indented with tabs or many spaces.
    const field = (key: string) => {
      const m = block.match(new RegExp(`^\\s*${key}:\\s*([\\s\\S]*?)(?=^\\s*\\w+:|^\\s*$)`, "m"));
      return m?.[1].replace(/\s+/g, " ").trim() || undefined;
    };
    const devices: Pool["devices"] = [];
    const config = block.match(/config:\s*\n([\s\S]*?)(?:\n\s*errors:|$)/)?.[1] ?? "";
    for (const line of config.split("\n")) {
      const m = line.match(
        /^\s+(\S+)\s+(ONLINE|DEGRADED|FAULTED|OFFLINE|UNAVAIL|REMOVED|AVAIL|INUSE)\s+(\d+\S*)\s+(\d+\S*)\s+(\d+\S*)/,
      );
      if (m && m[1] !== "NAME" && m[1] !== name) {
        devices.push({ name: m[1], state: m[2], errors: `${m[3]}/${m[4]}/${m[5]}` });
      }
    }
    out.set(name, {
      state: field("state"),
      scan: field("scan"),
      errors: field("errors"),
      status: field("status"),
      action: field("action"),
      devices,
    });
  }
  return out;
}

export const poolColor = (health: string): Color =>
  health === "ONLINE" ? "green" : health === "DEGRADED" ? "orange" : health === "UNKNOWN" ? "gray" : "red";

// ---------------------------------------------------------------------------
// The root script

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/**
 * One script for one password prompt: SMART of every drive, then the scrub status and error
 * counters of every mounted Btrfs filesystem. Sections start with "@@kind target".
 * USB enclosures smartctl can't identify are retried as SAT, which most of them speak.
 */
export function readScript(devices: string[], btrfsMounts: string[]): string {
  const lines = ["export LC_ALL=C"];
  if (devices.length) {
    lines.push(
      "if command -v smartctl >/dev/null 2>&1; then",
      `  for d in ${devices.map(quote).join(" ")}; do`,
      `    echo "@@smart $d"`,
      `    out=$(smartctl -j -a "$d" 2>&1)`,
      `    case "$out" in *"Unknown USB bridge"*|*"specify device type"*) out=$(smartctl -j -a -d sat "$d" 2>&1);; esac`,
      `    printf '%s\\n' "$out"`,
      "  done",
      "else",
      `  echo "@@missing smartctl"`,
      "fi",
    );
  }
  if (btrfsMounts.length) {
    lines.push(
      "if command -v btrfs >/dev/null 2>&1; then",
      `  for m in ${btrfsMounts.map(quote).join(" ")}; do`,
      `    echo "@@scrub $m"; btrfs scrub status "$m" 2>&1`,
      `    echo "@@stats $m"; btrfs device stats "$m" 2>&1`,
      "  done",
      "fi",
    );
  }
  lines.push("exit 0");
  return lines.join("\n");
}

export interface RootReport {
  smart: Record<string, Smart>;
  scrub: Record<string, Scrub>;
  stats: Record<string, DeviceStats[]>;
  missing: string[];
}

export function parseReadScript(out: string): RootReport {
  const report: RootReport = { smart: {}, scrub: {}, stats: {}, missing: [] };
  const sections = out.split(/^@@/m).slice(1);
  for (const section of sections) {
    const nl = section.indexOf("\n");
    const header = nl < 0 ? section : section.slice(0, nl);
    const body = nl < 0 ? "" : section.slice(nl + 1);
    const space = header.indexOf(" ");
    const kind = header.slice(0, space < 0 ? undefined : space);
    const target = space < 0 ? "" : header.slice(space + 1).trim();
    if (kind === "smart") report.smart[target] = parseSmart(target, body);
    else if (kind === "scrub") report.scrub[target] = parseScrubStatus(body);
    else if (kind === "stats") report.stats[target] = parseDeviceStats(body);
    else if (kind === "missing") report.missing.push(target);
  }
  return report;
}

/** pkexec's exit codes when nobody authenticated. */
export function pkexecError(code: number, stderr: string): string | undefined {
  if (code === 126) return "Authentication was cancelled";
  if (code === 127 && /not authorized|authentication/i.test(stderr)) return "Not authorized";
  if (/No authentication agent/i.test(stderr)) return "No polkit agent to ask for your password";
  return undefined;
}

/** smartctl -t short: the drive refuses when a test is already running or self-tests are unsupported. */
export function explainTestError(text: string): string {
  if (/in progress/i.test(text)) return "A self-test is already running on this drive";
  if (/not supported|unsupported|does not support/i.test(text)) return "This drive doesn't support self-tests";
  if (/Unknown USB bridge|specify device type/i.test(text)) return "smartctl can't talk to this USB enclosure";
  return text.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "The self-test didn't start";
}

// ---------------------------------------------------------------------------
// Formatting

/** 512 GB, 1.2 TB: decimal units, as printed on drives. */
export function size(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB", "PB"];
  let i = 0;
  while (bytes >= 1000 && i < units.length - 1) {
    bytes /= 1000;
    i++;
  }
  return `${bytes >= 100 || i === 0 ? Math.round(bytes) : bytes.toFixed(1).replace(/\.0$/, "")} ${units[i]}`;
}

/** 37 h, 12 days, 2.3 years: how long a drive has been powered on. */
export function hours(h: number): string {
  if (h < 48) return `${h} h`;
  const days = h / 24;
  if (days < 365) return `${Math.round(days)} days`;
  return `${(days / 365).toFixed(1).replace(/\.0$/, "")} years`;
}

/** "2 h ago", "3 days ago": when the SMART data was read. */
export function ago(at: number, now = Date.now()): string {
  const minutes = Math.floor((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const h = Math.floor(minutes / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  return `${d} day${d === 1 ? "" : "s"} ago`;
}

export const temperatureColor = (s: Smart): Color | undefined =>
  s.temperature === undefined
    ? undefined
    : s.temperature >= hotAt(s)
    ? "red"
    : s.temperature >= hotAt(s) - 10
    ? "orange"
    : undefined;

export const wearColor = (used: number): Color => used >= 90 ? "red" : used >= 70 ? "orange" : "green";

export type Family = "debian" | "fedora" | "arch" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

/** The command that installs smartmontools here. */
export function installSmartctl(family?: Family): string {
  return {
    debian: "sudo apt install smartmontools",
    fedora: "sudo dnf install smartmontools",
    arch: "sudo pacman -S smartmontools",
    suse: "sudo zypper install smartmontools",
  }[family ?? "debian"];
}
