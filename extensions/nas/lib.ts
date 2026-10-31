// TrueNAS, Synology DSM and Unraid answers as one model of a NAS. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type Kind = "truenas" | "synology" | "unraid";

export const TITLES: Record<Kind, string> = { truenas: "TrueNAS", synology: "Synology", unraid: "Unraid" };

export type Health = "ok" | "warning" | "error" | "offline";

export const HEALTH: Record<Health, { label: string; color: Color }> = {
  ok: { label: "Healthy", color: "green" },
  warning: { label: "Warning", color: "orange" },
  error: { label: "Failing", color: "red" },
  offline: { label: "Offline", color: "gray" },
};

export interface System {
  name: string;
  model?: string;
  version?: string;
  /** Seconds. */
  uptime?: number;
  /** 0 to 1. */
  cpu?: number;
  memory?: number;
  /** Bytes. */
  ram?: number;
  temperature?: number;
}

export interface Volume {
  key: string;
  name: string;
  /** "Pool", "Volume", "Array", "Cache". */
  type: string;
  health: Health;
  status: string;
  used?: number;
  total?: number;
  details: [string, string][];
}

export interface Disk {
  key: string;
  name: string;
  model?: string;
  role?: string;
  health: Health;
  status: string;
  temperature?: number;
  size?: number;
  used?: number;
  total?: number;
  errors?: number;
}

export interface Dataset {
  key: string;
  name: string;
  used: number;
  available?: number;
  mountpoint?: string;
  encrypted?: boolean;
  locked?: boolean;
}

export interface Share {
  key: string;
  name: string;
  path: string;
  protocol: "SMB" | "NFS";
  enabled: boolean;
  comment?: string;
}

export interface Alert {
  key: string;
  level: "critical" | "warning" | "info";
  title: string;
  message?: string;
  /** Unix ms. */
  time?: number;
  /** TrueNAS alert uuid, Unraid notification id: to dismiss it. */
  id?: string;
}

export interface Container {
  id: string;
  name: string;
  image: string;
  running: boolean;
  state: string;
  status?: string;
  autoStart?: boolean;
}

export interface Nas {
  kind: Kind;
  system: System;
  volumes: Volume[];
  disks: Disk[];
  datasets: Dataset[];
  shares: Share[];
  alerts: Alert[];
  containers: Container[];
}

const num = (v: unknown): number | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

// ---------------------------------------------------------------------------
// TrueNAS (REST v2.0)

export interface TnSystemInfo {
  version?: string;
  hostname?: string;
  physmem?: number;
  model?: string;
  system_product?: string;
  uptime_seconds?: number;
  loadavg?: number[];
  cores?: number;
}

interface TnVdev {
  type?: string;
  name?: string;
  disk?: string | null;
  status?: string;
  stats?: { read_errors?: number; write_errors?: number; checksum_errors?: number };
  children?: TnVdev[];
}

export interface TnPool {
  id: number;
  name: string;
  status?: string;
  healthy?: boolean;
  warning?: boolean;
  status_detail?: string | null;
  size?: number;
  allocated?: number;
  free?: number;
  scan?: { function?: string; state?: string; end_time?: { $date: number } | null; errors?: number } | null;
  topology?: Record<string, TnVdev[] | undefined>;
}

interface TnProp {
  parsed?: number | string | boolean | null;
  rawvalue?: string;
  value?: string;
}

export interface TnDataset {
  id: string;
  name?: string;
  pool?: string;
  type?: string;
  used?: TnProp;
  available?: TnProp;
  mountpoint?: string | null;
  encrypted?: boolean;
  locked?: boolean;
}

export interface TnAlert {
  uuid: string;
  level?: string;
  formatted?: string | null;
  text?: string;
  klass?: string;
  dismissed?: boolean;
  datetime?: { $date: number };
}

const zfsHealth = (status: string | undefined, healthy?: boolean): Health => {
  const s = (status ?? "").toUpperCase();
  if (s === "ONLINE") return healthy === false ? "warning" : "ok";
  if (s === "DEGRADED") return "warning";
  if (s === "OFFLINE" || s === "REMOVED") return "offline";
  return s ? "error" : "warning";
};

function leaves(vdevs: TnVdev[] | undefined, role: string): { v: TnVdev; role: string }[] {
  return (vdevs ?? []).flatMap((v) => v.children?.length ? leaves(v.children, role) : [{ v, role }]);
}

export function truenasPools(pools: TnPool[]): { volumes: Volume[]; disks: Disk[] } {
  const volumes = pools.map((p): Volume => {
    const vdevs = p.topology?.data ?? [];
    const scan = p.scan;
    const details: [string, string][] = [
      ...(vdevs.length ? [["Layout", vdevs.map((v) => v.type).join(" + ")] as [string, string]] : []),
      ...(scan?.function
        ? [[
          scan.function === "SCRUB" ? "Last scrub" : "Last resilver",
          [scan.state?.toLowerCase(), scan.end_time ? new Date(scan.end_time.$date).toLocaleDateString("en-GB") : ""]
            .filter(Boolean).join(", ") + (scan.errors ? `, ${scan.errors} errors` : ""),
        ] as [string, string]]
        : []),
      ...(p.status_detail ? [["Detail", p.status_detail] as [string, string]] : []),
    ];
    const used = p.allocated ?? (p.size !== undefined && p.free !== undefined ? p.size - p.free : undefined);
    return {
      key: `pool:${p.id}`,
      name: p.name,
      type: "Pool",
      health: zfsHealth(p.status, p.healthy),
      status: p.status ?? "UNKNOWN",
      used,
      total: p.size,
      details,
    };
  });
  const disks = pools.flatMap((p) =>
    Object.entries(p.topology ?? {}).flatMap(([group, vdevs]) =>
      leaves(vdevs, group).map(({ v, role }): Disk => {
        const errors = (v.stats?.read_errors ?? 0) + (v.stats?.write_errors ?? 0) + (v.stats?.checksum_errors ?? 0);
        const health = zfsHealth(v.status);
        return {
          key: `disk:${p.name}:${v.disk ?? v.name}`,
          name: v.disk ?? v.name ?? "disk",
          role: `${p.name} ${role === "data" ? "data" : role}`,
          health: health === "ok" && errors ? "warning" : health,
          status: v.status ?? "UNKNOWN",
          errors,
        };
      })
    )
  );
  return { volumes, disks };
}

const propNumber = (p: TnProp | undefined) => num(p?.parsed) ?? num(p?.rawvalue);

/** Pools' root datasets and their direct children: the ones people think of. */
export function truenasDatasets(list: TnDataset[]): Dataset[] {
  return list
    .filter((d) => d.id.split("/").length <= 2 && !/^(boot-pool|freenas-boot)/.test(d.id) && !d.id.includes("/ix-"))
    .map((d) => ({
      key: `ds:${d.id}`,
      name: d.id,
      used: propNumber(d.used) ?? 0,
      available: propNumber(d.available),
      mountpoint: d.mountpoint ?? undefined,
      encrypted: d.encrypted,
      locked: d.locked,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const LEVELS: Record<string, Alert["level"]> = {
  EMERGENCY: "critical",
  ALERT: "critical",
  CRITICAL: "critical",
  ERROR: "critical",
  WARNING: "warning",
  NOTICE: "info",
  INFO: "info",
};

export function truenasAlerts(list: TnAlert[]): Alert[] {
  return list.filter((a) => !a.dismissed).map((a) => {
    const text = (a.formatted ?? a.text ?? a.klass ?? "Alert").replace(/<[^>]+>/g, "").trim();
    const [title, ...rest] = text.split(/(?<=\.)\s+|\n/);
    return {
      key: `alert:${a.uuid}`,
      level: LEVELS[(a.level ?? "").toUpperCase()] ?? "info",
      title,
      message: rest.join(" ").trim() || undefined,
      time: a.datetime?.$date,
      id: a.uuid,
    };
  });
}

export function truenasShares(
  smb: { id: number; name?: string; path?: string; enabled?: boolean; comment?: string }[],
  nfs: { id: number; path?: string; paths?: string[]; enabled?: boolean; comment?: string }[],
): Share[] {
  return [
    ...smb.map((s) => ({
      key: `smb:${s.id}`,
      name: s.name ?? s.path ?? `share ${s.id}`,
      path: s.path ?? "",
      protocol: "SMB" as const,
      enabled: s.enabled !== false,
      comment: s.comment || undefined,
    })),
    ...nfs.map((s) => {
      const path = s.path ?? s.paths?.[0] ?? "";
      return {
        key: `nfs:${s.id}`,
        name: path.split("/").pop() || path,
        path,
        protocol: "NFS" as const,
        enabled: s.enabled !== false,
        comment: s.comment || undefined,
      };
    }),
  ];
}

export function truenasSystem(info: TnSystemInfo | undefined): System {
  const load = info?.loadavg?.[0];
  return {
    name: info?.hostname ?? "TrueNAS",
    model: info?.system_product || info?.model,
    version: info?.version?.replace(/^TrueNAS-(SCALE-)?/, ""),
    uptime: info?.uptime_seconds,
    cpu: load !== undefined && info?.cores ? Math.min(1, load / info.cores) : undefined,
    ram: info?.physmem,
  };
}

// ---------------------------------------------------------------------------
// Synology DSM

export interface SynoStorage {
  volumes?: {
    id: string;
    vol_path?: string;
    display_name?: string;
    status?: string;
    fs_type?: string;
    size?: { total?: string | number; used?: string | number };
    pool_path?: string;
    desc?: string;
  }[];
  storagePools?: {
    id: string;
    status?: string;
    raidType?: string;
    device_type?: string;
    disks?: string[];
  }[];
  disks?: {
    id: string;
    name?: string;
    longName?: string;
    model?: string;
    vendor?: string;
    status?: string;
    overview_status?: string;
    smart_status?: string;
    temp?: number;
    size_total?: string | number;
    used_by?: string;
  }[];
}

export interface SynoSystem {
  model?: string;
  firmware_ver?: string;
  up_time?: string;
  sys_temp?: number;
  ram_size?: number;
}

export interface SynoUtilization {
  cpu?: { user_load?: number; system_load?: number; other_load?: number };
  memory?: { real_usage?: number };
}

const synoHealth = (status: string | undefined): Health => {
  const s = (status ?? "").toLowerCase();
  if (s === "normal" || s === "background_scrubbing" || s === "") return "ok";
  if (/not_initialized|unknown|offline|deactivated|sleep/.test(s)) return "offline";
  if (/degrade|warning|attention|repair|expand|resync|initializ|abnormal/.test(s)) return "warning";
  return "error";
};

const pretty = (s: string | undefined) => (s ?? "").replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** "shr_with_1_disk_protect" → "SHR (1-disk protection)". */
export function raidName(type: string | undefined): string | undefined {
  if (!type) return undefined;
  const shr = /^shr(?:_with_(\d)_disk_protect)?$/.exec(type);
  if (shr) return shr[1] ? `SHR (${shr[1]}-disk protection)` : "SHR";
  const raid = /^raid_?(\d+)$/.exec(type);
  if (raid) return `RAID ${raid[1]}`;
  return pretty(type);
}

export function synologyStorage(s: SynoStorage): { volumes: Volume[]; disks: Disk[] } {
  const pools = new Map((s.storagePools ?? []).map((p) => [p.id, p]));
  const volumes = (s.volumes ?? []).map((v): Volume => {
    const pool = v.pool_path ? pools.get(v.pool_path) : undefined;
    const name = v.display_name || (v.vol_path ?? v.id).replace(/^\/volume(\d+)$/, "Volume $1");
    return {
      key: `vol:${v.id}`,
      name,
      type: "Volume",
      health: synoHealth(v.status),
      status: pretty(v.status) || "Normal",
      used: num(v.size?.used),
      total: num(v.size?.total),
      details: [
        ...(v.vol_path ? [["Path", v.vol_path] as [string, string]] : []),
        ...(v.fs_type ? [["File system", v.fs_type] as [string, string]] : []),
        ...(pool ? [["RAID", raidName(pool.device_type ?? pool.raidType) ?? "?"] as [string, string]] : []),
        ...(pool?.disks?.length ? [["Drives", String(pool.disks.length)] as [string, string]] : []),
        ...(pool && synoHealth(pool.status) !== "ok"
          ? [["Storage pool", pretty(pool.status)] as [string, string]]
          : []),
        ...(v.desc ? [["Description", v.desc] as [string, string]] : []),
      ],
    };
  });
  const disks = (s.disks ?? []).map((d): Disk => {
    const status = d.overview_status ?? d.status;
    const smart = synoHealth(d.smart_status);
    let health = synoHealth(status);
    if (health === "ok" && smart !== "ok") health = smart === "offline" ? "ok" : smart;
    return {
      key: `disk:${d.id}`,
      name: d.longName || d.name || d.id,
      model: [d.vendor?.trim(), d.model?.trim()].filter(Boolean).join(" ") || undefined,
      role: d.used_by ? pools.has(d.used_by) ? "In a storage pool" : d.used_by : "Not in use",
      health,
      status: pretty(status) || "Normal",
      temperature: d.temp && d.temp > 0 ? d.temp : undefined,
      size: num(d.size_total),
    };
  });
  return { volumes, disks };
}

/** DSM's `up_time`: "137:42:5" (hours:minutes:seconds), sometimes with days ("5 days, 3:02:01"). */
export function synoUptime(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const days = Number(/(\d+)\s*day/.exec(text)?.[1] ?? 0);
  const hms = /(\d+):(\d+):(\d+)\s*$/.exec(text);
  if (!hms && !days) return undefined;
  return days * 86400 + (hms ? Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]) : 0);
}

export function synologySystem(
  info: SynoSystem | undefined,
  usage: SynoUtilization | undefined,
  hostname?: string,
): System {
  const cpu = usage?.cpu
    ? ((usage.cpu.user_load ?? 0) + (usage.cpu.system_load ?? 0) + (usage.cpu.other_load ?? 0)) / 100
    : undefined;
  return {
    name: hostname || info?.model || "Synology",
    model: info?.model,
    version: info?.firmware_ver?.replace(/^DSM\s*/, "DSM "),
    uptime: synoUptime(info?.up_time),
    cpu,
    memory: usage?.memory?.real_usage !== undefined ? usage.memory.real_usage / 100 : undefined,
    ram: info?.ram_size ? info.ram_size * 1024 * 1024 : undefined,
    temperature: info?.sys_temp,
  };
}

export function synologyShares(list: { name: string; vol_path?: string; desc?: string }[]): Share[] {
  return list.map((s) => ({
    key: `share:${s.name}`,
    name: s.name,
    path: `${s.vol_path ?? ""}/${s.name}`,
    protocol: "SMB" as const,
    enabled: true,
    comment: s.desc || undefined,
  }));
}

/** DSM's error codes, as a sentence. */
export function synologyError(code: number | undefined, login = false): string {
  const auth: Record<number, string> = {
    400: "Synology rejected the account or password",
    401: "This Synology account is disabled",
    402: "This Synology account may not sign in here",
    403: "This account uses 2-step verification: use an account without it",
    404: "2-step verification failed",
    406: "Synology requires 2-step verification for this account: use another account",
    407: "Synology blocked this computer's IP after failed sign-ins",
    408: "The Synology password expired: change it in DSM",
    409: "The Synology password expired: change it in DSM",
    410: "The Synology password must be changed in DSM",
  };
  const common: Record<number, string> = {
    102: "This DSM doesn't have that API",
    103: "This DSM doesn't have that method",
    104: "This DSM doesn't support that version",
    105: "This Synology account isn't an administrator",
    106: "The Synology session timed out",
    107: "The Synology session was closed by another sign-in",
    119: "The Synology session expired",
  };
  if (code === undefined) return "Synology error";
  return (login ? auth[code] : undefined) ?? common[code] ?? auth[code] ?? `Synology error ${code}`;
}

// ---------------------------------------------------------------------------
// Unraid (GraphQL)

export interface UnDisk {
  id?: string;
  name?: string;
  device?: string;
  size?: number;
  status?: string;
  temp?: number | null;
  numErrors?: number;
  fsSize?: number | null;
  fsFree?: number | null;
  fsUsed?: number | null;
  fsType?: string | null;
  type?: string;
}

export interface UnArray {
  state?: string;
  capacity?: { kilobytes?: { free?: string | number; used?: string | number; total?: string | number } };
  parities?: UnDisk[];
  disks?: UnDisk[];
  caches?: UnDisk[];
}

export interface UnContainer {
  id: string;
  names?: string[];
  image?: string;
  state?: string;
  status?: string;
  autoStart?: boolean;
}

export interface UnNotification {
  id: string;
  title?: string;
  subject?: string;
  description?: string;
  importance?: string;
  timestamp?: string | null;
}

const KB = 1024;

const unraidDiskHealth = (status: string | undefined, errors = 0): Health => {
  const s = (status ?? "").toUpperCase();
  if (s === "DISK_OK") return errors ? "warning" : "ok";
  if (s === "DISK_NP" || s === "DISK_NP_MISSING") return "offline";
  if (s === "DISK_NEW") return "warning";
  return s ? "error" : "warning";
};

const UN_STATUS: Record<string, string> = {
  DISK_OK: "Normal",
  DISK_NP: "Not present",
  DISK_NP_MISSING: "Missing",
  DISK_INVALID: "Invalid",
  DISK_WRONG: "Wrong disk",
  DISK_DSBL: "Disabled",
  DISK_NP_DSBL: "Disabled, not present",
  DISK_DSBL_NEW: "Disabled, new",
  DISK_NEW: "New",
};

export function unraidArray(a: UnArray | undefined): { volumes: Volume[]; disks: Disk[] } {
  if (!a) return { volumes: [], disks: [] };
  const kb = a.capacity?.kilobytes;
  const state = (a.state ?? "UNKNOWN").toUpperCase();
  const all = [
    ...(a.parities ?? []).map((d) => ({ d, role: "Parity" })),
    ...(a.disks ?? []).map((d) => ({ d, role: "Array" })),
    ...(a.caches ?? []).map((d) => ({ d, role: "Cache" })),
  ].filter(({ d }) => d.status !== "DISK_NP" || d.device);
  const disks = all.map(({ d, role }): Disk => ({
    key: `disk:${d.id ?? d.name}`,
    name: d.name ?? d.device ?? "disk",
    model: d.device ?? undefined,
    role,
    health: unraidDiskHealth(d.status, d.numErrors),
    status: UN_STATUS[d.status ?? ""] ?? pretty(d.status?.replace(/^DISK_/, "").toLowerCase()),
    temperature: d.temp ?? undefined,
    size: d.size ? d.size * KB : undefined,
    used: d.fsUsed != null ? d.fsUsed * KB : undefined,
    total: d.fsSize != null ? d.fsSize * KB : undefined,
    errors: d.numErrors,
  }));
  const failing = disks.filter((d) => d.role !== "Cache" && d.health === "error").length;
  const arrayHealth: Health = state !== "STARTED"
    ? "offline"
    : failing
    ? (failing > (a.parities?.length ?? 0) ? "error" : "warning")
    : disks.some((d) => d.role !== "Cache" && d.health === "warning")
    ? "warning"
    : "ok";
  const volumes: Volume[] = [{
    key: "array",
    name: "Array",
    type: "Array",
    health: arrayHealth,
    status: pretty(state.toLowerCase()),
    used: num(kb?.used) !== undefined ? num(kb?.used)! * KB : undefined,
    total: num(kb?.total) !== undefined ? num(kb?.total)! * KB : undefined,
    details: [
      ["Data disks", String((a.disks ?? []).filter((d) => d.status !== "DISK_NP").length)],
      ["Parity", String((a.parities ?? []).filter((d) => d.status !== "DISK_NP").length)],
      ...(failing ? [["Failing disks", String(failing)] as [string, string]] : []),
    ],
  }];
  // Each cache pool is its own volume.
  for (const c of a.caches ?? []) {
    if (c.fsSize == null) continue;
    volumes.push({
      key: `cache:${c.id ?? c.name}`,
      name: c.name ?? "cache",
      type: "Cache",
      health: unraidDiskHealth(c.status, c.numErrors),
      status: UN_STATUS[c.status ?? ""] ?? "Unknown",
      used: (c.fsUsed ?? 0) * KB,
      total: c.fsSize * KB,
      details: c.fsType ? [["File system", c.fsType]] : [],
    });
  }
  return { volumes, disks };
}

export function unraidContainers(list: UnContainer[]): Container[] {
  return list.map((c) => {
    const state = (c.state ?? "").toUpperCase();
    return {
      id: c.id,
      name: (c.names?.[0] ?? c.id).replace(/^\//, ""),
      image: c.image ?? "",
      running: state === "RUNNING",
      state: pretty(state.toLowerCase()) || "Unknown",
      status: c.status,
      autoStart: c.autoStart,
    };
  }).sort((a, b) => Number(b.running) - Number(a.running) || a.name.localeCompare(b.name));
}

export function unraidAlerts(list: UnNotification[]): Alert[] {
  return list.map((n) => {
    const imp = (n.importance ?? "").toUpperCase();
    return {
      key: `notif:${n.id}`,
      level: imp === "ALERT" ? "critical" : imp === "WARNING" ? "warning" : "info",
      title: n.subject || n.title || "Notification",
      message: n.description || undefined,
      time: n.timestamp ? Date.parse(n.timestamp) || undefined : undefined,
      id: n.id,
    };
  });
}

/** Unraid's `os.uptime` is the boot time (ISO), older builds give seconds. */
export function unraidUptime(value: unknown, now = Date.now()): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || !value) return undefined;
  if (/^\d+$/.test(value)) return Number(value);
  const t = Date.parse(value);
  return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : undefined;
}

// ---------------------------------------------------------------------------
// Problems: alerts derived from health, for the NASes that don't keep a list

export function healthAlerts(volumes: Volume[], disks: Disk[]): Alert[] {
  const out: Alert[] = [];
  for (const v of volumes) {
    if (v.health === "warning" || v.health === "error") {
      out.push({
        key: `health:${v.key}`,
        level: v.health === "error" ? "critical" : "warning",
        title: `${v.type} ${v.name} is ${v.status.toLowerCase()}`,
      });
    }
    const ratio = usage(v);
    if (ratio !== undefined && ratio >= 0.9) {
      out.push({
        key: `full:${v.key}`,
        level: ratio >= 0.95 ? "critical" : "warning",
        title: `${v.name} is ${Math.round(ratio * 100)} % full`,
      });
    }
  }
  for (const d of disks) {
    if (d.health === "warning" || d.health === "error") {
      out.push({
        key: `health:${d.key}`,
        level: d.health === "error" ? "critical" : "warning",
        title: `${d.name}: ${d.status.toLowerCase()}${d.errors ? `, ${d.errors} errors` : ""}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting

export function usage(v: { used?: number; total?: number }): number | undefined {
  if (v.used === undefined || !v.total) return undefined;
  return Math.max(0, Math.min(1, v.used / v.total));
}

/** Green below 80 %, orange below 90 %, red above. */
export function usageColor(ratio: number | undefined): Color | undefined {
  if (ratio === undefined) return undefined;
  return ratio < 0.8 ? "green" : ratio < 0.9 ? "orange" : "red";
}

/** Bytes, in powers of 1024 with the units NAS interfaces show: "3.6 TiB". */
export function bytes(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function duration(seconds: number | undefined): string {
  if (seconds === undefined) return "";
  const d = Math.floor(seconds / 86400), h = Math.floor(seconds % 86400 / 3600), m = Math.floor(seconds % 3600 / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function ago(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const ALERT_LOOK: Record<Alert["level"], { label: string; color: Color }> = {
  critical: { label: "Critical", color: "red" },
  warning: { label: "Warning", color: "orange" },
  info: { label: "Info", color: "blue" },
};

/** The command's subtitle: the worst news first. */
export function summary(nas: Nas): string {
  const critical = nas.alerts.filter((a) => a.level === "critical").length;
  const warnings = nas.alerts.filter((a) => a.level === "warning").length;
  const used = nas.volumes.reduce((n, v) => n + (v.used ?? 0), 0);
  const total = nas.volumes.reduce((n, v) => n + (v.total ?? 0), 0);
  const parts: string[] = [];
  if (critical) parts.push(`${critical} critical`);
  if (warnings) parts.push(`${warnings} warning${warnings === 1 ? "" : "s"}`);
  if (!critical && !warnings) parts.push("healthy");
  if (total) parts.push(`${Math.round(used / total * 100)} % used`);
  return parts.join(" · ");
}

/** The kind preference, or a guess from what is set. */
export function kindFrom(pref: unknown, hasAccount: boolean): Kind | undefined {
  const k = String(pref ?? "").trim().toLowerCase().replace(/[\s-]/g, "");
  if (k === "truenas" || k === "truenasscale" || k === "truenascore" || k === "freenas") return "truenas";
  if (k === "synology" || k === "dsm" || k === "syno") return "synology";
  if (k === "unraid") return "unraid";
  return hasAccount ? "synology" : undefined;
}
