// Syncthing REST API shapes, parsers and formatting. No I/O here.

import type { Color } from "@backslash/api";
import { Icons } from "@backslash/api";

// ---------------------------------------------------------------------------
// config.xml

export interface GuiConfig {
  apiKey?: string;
  /** `127.0.0.1:8384`, as written in `<gui><address>`. */
  address?: string;
  tls: boolean;
}

const unescapeXml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

/** The `<gui>` block of Syncthing's config.xml: API key, listen address, HTTPS. */
export function parseConfigXml(xml: string): GuiConfig {
  const gui = /<gui\b([^>]*)>([\s\S]*?)<\/gui>/.exec(xml);
  if (!gui) return { tls: false };
  const tag = (name: string) => {
    const m = new RegExp(`<${name}>([^<]*)</${name}>`).exec(gui[2]);
    return m ? unescapeXml(m[1].trim()) || undefined : undefined;
  };
  return { apiKey: tag("apikey"), address: tag("address"), tls: /\btls="true"/.test(gui[1]) };
}

/** `0.0.0.0:8384` listens everywhere but is reached on localhost. */
export function baseFromGui(gui: GuiConfig): string | undefined {
  if (!gui.address) return undefined;
  if (gui.address.startsWith("/")) return undefined; // a unix socket
  const address = gui.address.replace(/^0\.0\.0\.0(?=:)/, "127.0.0.1").replace(/^\[::\](?=:)/, "127.0.0.1");
  return `${gui.tls ? "https" : "http"}://${address}`;
}

// ---------------------------------------------------------------------------
// REST shapes

export interface FolderConfig {
  id: string;
  label: string;
  path: string;
  type: "sendreceive" | "sendonly" | "receiveonly" | "receiveencrypted";
  paused: boolean;
  devices: { deviceID: string }[];
  rescanIntervalS?: number;
  fsWatcherEnabled?: boolean;
}

export interface DeviceConfig {
  deviceID: string;
  name: string;
  paused: boolean;
  addresses?: string[];
  compression?: string;
  introducer?: boolean;
}

export interface FolderStatus {
  state: string;
  stateChanged?: string;
  globalBytes: number;
  globalFiles: number;
  globalDirectories?: number;
  localBytes: number;
  localFiles: number;
  inSyncBytes: number;
  inSyncFiles?: number;
  needBytes: number;
  needFiles: number;
  needDeletes?: number;
  errors: number;
  pullErrors: number;
  error?: string;
  receiveOnlyChangedFiles?: number;
}

export interface Connection {
  connected: boolean;
  paused: boolean;
  address?: string;
  clientVersion?: string;
  type?: string;
  isLocal?: boolean;
  inBytesTotal?: number;
  outBytesTotal?: number;
  startedAt?: string;
}

export interface Completion {
  completion: number;
  globalBytes: number;
  needBytes: number;
  needItems?: number;
  remoteState?: string;
}

export interface SystemStatus {
  myID: string;
  uptime: number;
  startTime?: string;
}

export interface FolderView {
  config: FolderConfig;
  status?: FolderStatus;
  lastScan?: string;
  lastFile?: { at: string; filename: string; deleted: boolean };
}

export interface DeviceView {
  config: DeviceConfig;
  connection?: Connection;
  lastSeen?: string;
  completion?: Completion;
}

// ---------------------------------------------------------------------------
// Formatting

export function bytes(n: number | undefined): string {
  if (!n || n < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  const v = n / 1000 ** i;
  return `${i === 0 ? v : v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Syncthing writes `1970-01-01T00:00:00Z` (or Go's zero time) for "never". */
export function isNever(iso: string | undefined): boolean {
  if (!iso) return true;
  const t = Date.parse(iso);
  return !Number.isFinite(t) || t < Date.UTC(2000, 0, 1);
}

export function ago(iso: string | undefined, now = Date.now()): string {
  if (isNever(iso)) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso!)) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86_400);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86_400), h = Math.floor(seconds % 86_400 / 3600), m = Math.floor(seconds % 3600 / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

/** "42 %", never "100 %" while something is left. */
export function percent(ratio: number): string {
  const p = Math.floor(ratio * 100);
  return `${ratio < 1 ? Math.min(p, 99) : 100} %`;
}

export const FOLDER_TYPES: Record<string, string> = {
  sendreceive: "Send & Receive",
  sendonly: "Send Only",
  receiveonly: "Receive Only",
  receiveencrypted: "Receive Encrypted",
};

// ---------------------------------------------------------------------------
// Folder and device states

export interface StateLook {
  label: string;
  icon: string;
  tint: Color;
  /** 0..1 while syncing. */
  progress?: number;
  busy: boolean;
}

/** Share of the folder that is here, by bytes (the Web UI's percentage). */
export function folderProgress(s: FolderStatus): number {
  if (!s.globalBytes) return 1;
  return Math.max(0, Math.min(1, s.inSyncBytes / s.globalBytes));
}

export function folderState(f: FolderView): StateLook {
  const s = f.status;
  if (f.config.paused) return { label: "Paused", icon: Icons.pause, tint: "gray", busy: false };
  if (!s) return { label: "Unknown", icon: Icons.question, tint: "gray", busy: false };
  if (s.state === "error" || s.error) return { label: "Error", icon: Icons.alert, tint: "red", busy: false };
  switch (s.state) {
    case "syncing":
    case "sync-preparing": {
      const progress = folderProgress(s);
      return {
        label: s.state === "syncing" ? `Syncing ${percent(progress)}` : "Preparing to sync",
        icon: Icons.refresh,
        tint: "blue",
        progress,
        busy: true,
      };
    }
    case "scanning":
      return { label: "Scanning", icon: Icons.search, tint: "blue", busy: true };
    case "scan-waiting":
      return { label: "Waiting to scan", icon: Icons.hourglass, tint: "gray", busy: true };
    case "sync-waiting":
      return { label: "Waiting to sync", icon: Icons.hourglass, tint: "gray", busy: true };
    case "cleaning":
    case "clean-waiting":
      return { label: "Cleaning versions", icon: Icons.trash, tint: "gray", busy: true };
    case "idle":
      if (s.pullErrors > 0) {
        return { label: `${plural(s.pullErrors, "failed item")}`, icon: Icons.alert, tint: "orange", busy: false };
      }
      if (s.needFiles > 0 || s.needBytes > 0) {
        return { label: "Out of sync", icon: Icons.alert, tint: "orange", busy: false };
      }
      if ((s.receiveOnlyChangedFiles ?? 0) > 0) {
        return { label: "Local additions", icon: Icons.info, tint: "orange", busy: false };
      }
      return { label: "Up to Date", icon: Icons.done, tint: "green", busy: false };
    default:
      return {
        label: s.state.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase()),
        icon: Icons.dot,
        tint: "gray",
        busy: true,
      };
  }
}

export function deviceState(d: DeviceView, now = Date.now()): StateLook & { detail: string } {
  if (d.config.paused || d.connection?.paused) {
    return { label: "Paused", icon: Icons.pause, tint: "gray", busy: false, detail: "Paused" };
  }
  if (d.connection?.connected) {
    const c = d.completion;
    if (c && c.completion < 100 && c.needBytes > 0) {
      const progress = c.completion / 100;
      return {
        label: `Syncing ${percent(progress)}`,
        icon: Icons.refresh,
        tint: "blue",
        progress,
        busy: true,
        detail: `${bytes(c.needBytes)} left`,
      };
    }
    return { label: "Up to Date", icon: Icons.wifi, tint: "green", busy: false, detail: "Connected" };
  }
  return {
    label: "Disconnected",
    icon: Icons.wifiOff,
    tint: "gray",
    busy: false,
    detail: isNever(d.lastSeen) ? "Never seen" : `Last seen ${ago(d.lastSeen, now)}`,
  };
}

/** The line under the command in the root search. */
export function summary(folders: FolderView[]): string | null {
  const active = folders.filter((f) => !f.config.paused && f.status);
  if (!folders.length) return null;
  if (!active.length) return "Paused";
  const syncing = active.filter((f) => f.status!.state === "syncing" || f.status!.state === "sync-preparing");
  if (syncing.length) {
    const global = syncing.reduce((n, f) => n + f.status!.globalBytes, 0);
    const inSync = syncing.reduce((n, f) => n + f.status!.inSyncBytes, 0);
    return `Syncing ${percent(global ? inSync / global : 0)}`;
  }
  const errors = active.filter((f) => folderState(f).tint === "red").length;
  if (errors) return `${plural(errors, "folder")} with errors`;
  if (active.some((f) => f.status!.state === "scanning")) return "Scanning";
  const out = active.filter((f) => folderState(f).tint === "orange").length;
  if (out) return `${plural(out, "folder")} out of sync`;
  return "Up to date";
}

/** Folders by label, those needing attention first. */
export function sortFolders(folders: FolderView[]): FolderView[] {
  const rank = (f: FolderView) => {
    const t = folderState(f).tint;
    return t === "red" ? 0 : t === "orange" ? 1 : t === "blue" ? 2 : f.config.paused ? 4 : 3;
  };
  return [...folders].sort((a, b) => rank(a) - rank(b) || labelOf(a.config).localeCompare(labelOf(b.config)));
}

export function sortDevices(devices: DeviceView[]): DeviceView[] {
  const rank = (d: DeviceView) => d.connection?.connected ? 0 : d.config.paused ? 2 : 1;
  return [...devices].sort((a, b) => rank(a) - rank(b) || a.config.name.localeCompare(b.config.name));
}

export const labelOf = (f: FolderConfig) => f.label || f.id;

/** The first group of a device ID, as Syncthing shows it in conflict names. */
export const shortId = (deviceID: string) => deviceID.slice(0, 7);

/** `~/Sync` → `/home/me/Sync`. */
export function expandHome(path: string, home: string | undefined): string {
  if (!home) return path;
  if (path === "~") return home;
  return path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
}

/** `/home/me/Sync/x` → `~/Sync/x`. */
export function tildify(path: string, home: string | undefined): string {
  if (!home) return path;
  return path === home ? "~" : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export const isLocalBase = (base: string) => {
  try {
    return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname);
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Conflicts

export interface Conflict {
  path: string;
  /** The file it conflicts with. */
  original: string;
  /** When the losing version was saved. */
  date?: Date;
  /** First group of the device ID that made the losing change. */
  device: string;
  size: number;
  modified: number;
}

const CONFLICT = /^(.*)\.sync-conflict-(\d{8})-(\d{6})-([A-Z0-9]{7})(\..*)?$/;

/** `report.sync-conflict-20260115-093012-ABCDEF7.odt` → original `report.odt`. */
export function parseConflictName(path: string): Pick<Conflict, "original" | "date" | "device"> | undefined {
  const slash = path.lastIndexOf("/");
  const dir = path.slice(0, slash + 1), name = path.slice(slash + 1);
  const m = CONFLICT.exec(name);
  if (!m) return undefined;
  const [, base, d, t, device, ext] = m;
  const date = new Date(
    Number(d.slice(0, 4)),
    Number(d.slice(4, 6)) - 1,
    Number(d.slice(6, 8)),
    Number(t.slice(0, 2)),
    Number(t.slice(2, 4)),
    Number(t.slice(4, 6)),
  );
  return { original: `${dir}${base}${ext ?? ""}`, date: Number.isNaN(date.getTime()) ? undefined : date, device };
}

/** Lines of `find … -printf '%T@\t%s\t%p\n'`, newest first. */
export function parseConflicts(out: string): Conflict[] {
  const found: Conflict[] = [];
  for (const line of out.split("\n")) {
    const [mtime, size, ...rest] = line.split("\t");
    const path = rest.join("\t");
    if (!path) continue;
    const parsed = parseConflictName(path);
    if (!parsed) continue;
    found.push({ path, ...parsed, size: Number(size) || 0, modified: Math.round(Number(mtime) * 1000) || 0 });
  }
  return found.sort((a, b) => b.modified - a.modified);
}

/** The arguments of `find` that list a folder's conflict copies. */
export function conflictFindArgs(root: string): string[] {
  return [
    root,
    "-path",
    "*/.stversions",
    "-prune",
    "-o",
    "-path",
    "*/.stfolder",
    "-prune",
    "-o",
    "-type",
    "f",
    "-name",
    "*.sync-conflict-*",
    "-printf",
    "%T@\\t%s\\t%p\\n",
  ];
}

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function dirname(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "/" : path.slice(0, i);
}
