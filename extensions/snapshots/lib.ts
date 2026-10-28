// Parsing and formatting for Timeshift, Snapper and plain Btrfs snapshots.

export type Tool = "timeshift" | "snapper" | "btrfs";

/** One snapshot, whichever tool made it. */
export interface Snapshot {
  tool: Tool;
  /** Timeshift: the snapshot name; Snapper: its number; Btrfs: the subvolume ID. */
  id: string;
  /** Snapper config (`root`, `home`…). */
  config?: string;
  /** Milliseconds since the epoch, when known. */
  date?: number;
  /** Snapper: `single`, `pre` or `post`. */
  kind?: "single" | "pre" | "post";
  /** Timeshift tags, spelled out: `ondemand`, `boot`, `hourly`… */
  tags: string[];
  description: string;
  /** Snapper cleanup algorithm: `number`, `timeline`, `empty-pre-post` or empty. */
  cleanup?: string;
  /** Exclusive size in bytes (Snapper with quotas). */
  size?: number;
  user?: string;
  /** A post snapshot's pre snapshot. */
  preNumber?: number;
  /** The snapshot booted by default (Snapper). */
  isDefault?: boolean;
  /** The snapshot currently mounted (Snapper). */
  active?: boolean;
  userdata?: Record<string, string>;
  /** Btrfs: the subvolume path relative to the top level. */
  path?: string;
}

// --- Dates -----------------------------------------------------------------------

/** `2024-03-01 09:41:06` or `2024-03-01_09-41-06`, in local time. */
export function parseLocalDate(text: string): number | undefined {
  const m = text.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ _T](\d{2})[:-](\d{2})[:-](\d{2})/);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const date = new Date(y, mo - 1, d, h, mi, s);
  return isNaN(date.getTime()) ? undefined : date.getTime();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `2024-03-01 09:41`. */
export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `just now`, `12 min ago`, `3 h ago`, `5 days ago`, `2 months ago`. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const min = Math.floor(s / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.floor(h / 24);
  if (d < 31) return d === 1 ? "yesterday" : `${d} days ago`;
  const mo = Math.floor(d / 30.44);
  if (mo < 12) return mo === 1 ? "a month ago" : `${mo} months ago`;
  const y = Math.floor(d / 365.25);
  return y === 1 ? "a year ago" : `${y} years ago`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

// --- Timeshift ---------------------------------------------------------------------

export const TIMESHIFT_TAGS: Record<string, string> = {
  O: "ondemand",
  B: "boot",
  H: "hourly",
  D: "daily",
  W: "weekly",
  M: "monthly",
};

export const TAG_LABELS: Record<string, string> = {
  ondemand: "On demand",
  boot: "Boot",
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

export interface TimeshiftDevice {
  device?: string;
  uuid?: string;
  path?: string;
  mode?: "RSYNC" | "BTRFS";
  status?: string;
  /** `3 snapshots, 101.5 GB free`. */
  details?: string;
  free?: string;
}

/** What `timeshift --list` prints: the backup device, then a table of snapshots. */
export function parseTimeshiftList(text: string): { device: TimeshiftDevice; snapshots: Snapshot[] } {
  const device: TimeshiftDevice = {};
  const snapshots: Snapshot[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const field = line.match(/^(Device|UUID|Path|Mode|Status)\s*:\s*(.*)$/);
    if (field) {
      const [, key, value] = field;
      if (key === "Device") device.device = value;
      else if (key === "UUID") device.uuid = value;
      else if (key === "Path") device.path = value;
      else if (key === "Mode") device.mode = value === "BTRFS" ? "BTRFS" : "RSYNC";
      else device.status = value;
      continue;
    }
    const summary = line.match(/^\d+ snapshots?, (.+) free$/);
    if (summary) {
      device.details = line;
      device.free = summary[1];
      continue;
    }
    // "0    >  2024-03-01_09-00-01  O D  before the upgrade"; every column is padded with 2 spaces.
    const row = line.match(/^\s*(\d+)\s+>\s+(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(.*)$/);
    if (!row) continue;
    const rest = row[3].replace(/^ {2}/, "");
    const cols = rest.match(/^((?:[OBHDWM](?: [OBHDWM])*)?)(?: {2,}|\s*$)(.*)$/);
    const letters = cols ? cols[1] : "";
    const description = (cols ? cols[2] : rest).trim();
    snapshots.push({
      tool: "timeshift",
      id: row[2],
      date: parseLocalDate(row[2]),
      tags: letters.split(" ").filter(Boolean).map((l) => TIMESHIFT_TAGS[l] ?? l),
      description,
    });
  }
  return { device, snapshots };
}

export interface TimeshiftConfig {
  btrfs: boolean;
  deviceUuid?: string;
  schedule: string[];
  counts: Record<string, number>;
  includeHome: boolean;
}

/** `/etc/timeshift/timeshift.json`: every value is a string ("true", "5"). */
export function parseTimeshiftConfig(json: string): TimeshiftConfig {
  const c = JSON.parse(json) as Record<string, unknown>;
  const yes = (k: string) => String(c[k] ?? "") === "true";
  const schedule = ["boot", "hourly", "daily", "weekly", "monthly"].filter((p) => yes(`schedule_${p}`));
  const counts: Record<string, number> = {};
  for (const p of ["boot", "hourly", "daily", "weekly", "monthly"]) {
    const n = Number(c[`count_${p}`]);
    if (Number.isFinite(n)) counts[p] = n;
  }
  return {
    btrfs: yes("btrfs_mode"),
    deviceUuid: typeof c.backup_device_uuid === "string" && c.backup_device_uuid ? c.backup_device_uuid : undefined,
    schedule,
    counts,
    includeHome: yes("include_btrfs_home_for_backup") || yes("include_btrfs_home_for_restore"),
  };
}

// --- Snapper -----------------------------------------------------------------------

export interface SnapperConfig {
  name: string;
  subvolume: string;
}

/** `snapper --jsonout list-configs`. */
export function parseSnapperConfigs(json: string): SnapperConfig[] {
  const data = JSON.parse(json) as { configs?: { config: string; subvolume: string }[] };
  return (data.configs ?? []).map((c) => ({ name: c.config, subvolume: c.subvolume }));
}

interface SnapperJson {
  number: number;
  default?: boolean;
  active?: boolean;
  type: string;
  "pre-number"?: number | null;
  date?: string;
  user?: string;
  "used-space"?: number | null;
  cleanup?: string;
  description?: string;
  userdata?: Record<string, string> | null;
}

/** `snapper --jsonout list` (one config) or `list --all-configs`: `{ "root": [...], "home": [...] }`. */
export function parseSnapperList(json: string): Snapshot[] {
  const data = JSON.parse(json) as Record<string, SnapperJson[]>;
  const out: Snapshot[] = [];
  for (const [config, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    for (const r of rows) {
      if (r.number === 0) continue; // "current": the live filesystem
      const kind = r.type === "pre" || r.type === "post" ? r.type : "single";
      out.push({
        tool: "snapper",
        id: String(r.number),
        config,
        date: r.date ? parseLocalDate(r.date) : undefined,
        kind,
        tags: [],
        description: r.description ?? "",
        cleanup: r.cleanup || undefined,
        size: typeof r["used-space"] === "number" ? r["used-space"] : undefined,
        user: r.user,
        preNumber: typeof r["pre-number"] === "number" ? r["pre-number"] : undefined,
        isDefault: r.default ?? false,
        active: r.active ?? false,
        userdata: r.userdata && Object.keys(r.userdata).length ? r.userdata : undefined,
      });
    }
  }
  return out;
}

/** Newest first, then by config. */
export function sortSnapshots(list: Snapshot[]): Snapshot[] {
  return [...list].sort((a, b) => (b.date ?? 0) - (a.date ?? 0) || Number(b.id) - Number(a.id));
}

/** The range whose changes a snapshot stands for: pre..post, or the snapshot against now (0). */
export function changeRange(s: Snapshot, all: Snapshot[]): { from: string; to: string; label: string } {
  if (s.kind === "post" && s.preNumber !== undefined) {
    return { from: String(s.preNumber), to: s.id, label: `#${s.preNumber} → #${s.id}` };
  }
  if (s.kind === "pre") {
    const post = all.find((o) => o.config === s.config && o.kind === "post" && o.preNumber === Number(s.id));
    if (post) return { from: s.id, to: post.id, label: `#${s.id} → #${post.id}` };
  }
  return { from: s.id, to: "0", label: `#${s.id} → now` };
}

/** A post snapshot shows its pre snapshot's description when it has none (zypper, dnf). */
export function snapperTitle(s: Snapshot, all: Snapshot[]): string {
  if (s.description) return s.description;
  if (s.kind === "post" && s.preNumber !== undefined) {
    const pre = all.find((o) => o.config === s.config && o.id === String(s.preNumber));
    if (pre?.description) return pre.description;
  }
  return `Snapshot #${s.id}`;
}

export type ChangeKind = "created" | "deleted" | "modified" | "type";

export interface FileChange {
  path: string;
  kind: ChangeKind;
  /** Which metadata changed: permissions, owner, group, xattrs, ACLs. */
  meta: string[];
}

/** `snapper status 3..4`: `+..... /etc/new`, `c.ug.. /etc/changed`, `-..... /etc/gone`. */
export function parseSnapperStatus(text: string): FileChange[] {
  const out: FileChange[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^([+\-ct.])([p.])([u.])([g.])([x.])([a.])\s+(\/.*)$/);
    if (!m) continue;
    const kind: ChangeKind = m[1] === "+" ? "created" : m[1] === "-" ? "deleted" : m[1] === "t" ? "type" : "modified";
    const meta = [
      m[2] === "p" ? "permissions" : "",
      m[3] === "u" ? "owner" : "",
      m[4] === "g" ? "group" : "",
      m[5] === "x" ? "xattrs" : "",
      m[6] === "a" ? "ACLs" : "",
    ].filter(Boolean);
    out.push({ path: m[7], kind, meta });
  }
  return out;
}

export function countChanges(changes: FileChange[]): Record<ChangeKind, number> {
  const c: Record<ChangeKind, number> = { created: 0, deleted: 0, modified: 0, type: 0 };
  for (const ch of changes) c[ch.kind]++;
  return c;
}

const SIGN: Record<ChangeKind, string> = { created: "+", deleted: "−", modified: "~", type: "≠" };

/** The changed files as markdown, the most interesting first, capped. */
export function changesMarkdown(changes: FileChange[], limit = 400): string {
  if (!changes.length) return "No file changed.";
  const order: ChangeKind[] = ["modified", "created", "deleted", "type"];
  const sorted = [...changes].sort((a, b) =>
    order.indexOf(a.kind) - order.indexOf(b.kind) || (a.path < b.path ? -1 : 1)
  );
  const lines = sorted.slice(0, limit).map((c) =>
    `${SIGN[c.kind]} ${c.path}${c.meta.length && c.kind === "modified" ? `  (${c.meta.join(", ")})` : ""}`
  );
  const more = changes.length > limit ? `\n\n…and ${changes.length - limit} more` : "";
  return "```\n" + lines.join("\n") + "\n```" + more;
}

/** A diff as a fenced block, cut at `max` characters. */
export function diffMarkdown(diff: string, max = 60_000): string {
  if (!diff.trim()) return "No difference in file contents.";
  const cut = diff.length > max ? diff.slice(0, diff.lastIndexOf("\n", max)) : diff;
  return "```diff\n" + cut.replaceAll("```", "``​`") + "\n```" +
    (cut.length < diff.length ? "\n\n*Cut: open it in a terminal for the rest.*" : "");
}

export const CLEANUP_LABELS: Record<string, string> = {
  number: "Number",
  timeline: "Timeline",
  "empty-pre-post": "Empty pre/post",
};

export function snapperCreateArgs(
  config: string,
  o: { description: string; cleanup: string; important: boolean },
): string[] {
  const args = ["-c", config, "create", "--print-number", "--description", o.description || "Backslash"];
  if (o.cleanup && o.cleanup !== "none") args.push("--cleanup-algorithm", o.cleanup);
  if (o.important) args.push("--userdata", "important=yes");
  return args;
}

/** What a failed snapper call means, in words. */
export function snapperError(stderr: string): string {
  if (/No permissions/i.test(stderr)) return "Snapper needs your password for this config";
  if (/Unknown (global )?option.*jsonout/i.test(stderr) || /--jsonout/.test(stderr)) {
    return "This Snapper is too old for JSON output: update it (0.8.10 or later)";
  }
  if (/Unknown config/i.test(stderr)) return "Snapper doesn't know this config";
  if (/Failure \(error\.service_unknown\)|org\.opensuse\.Snapper/i.test(stderr)) {
    return "The Snapper service (snapperd) is not available";
  }
  const last = stderr.split("\n").map((l) => l.trim()).filter(Boolean).pop();
  return last ?? "Snapper failed";
}

export const needsRoot = (stderr: string) => /No permissions|Permission denied|not permitted/i.test(stderr);

// --- Btrfs -------------------------------------------------------------------------

/** `btrfs subvolume list -s /`: `ID 260 gen 52 cgen 51 top level 5 otime 2024-03-01 09:00:00 path @snapshots/1`. */
export function parseBtrfsList(text: string): Snapshot[] {
  const out: Snapshot[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^ID (\d+) gen (\d+)(?: cgen \d+)? top level (\d+)(?: otime (\S+ \S+))? path (.+)$/);
    if (!m) continue;
    const path = m[5].replace(/^<FS_TREE>\//, "");
    const name = path.split("/").pop() ?? path;
    out.push({
      tool: "btrfs",
      id: m[1],
      date: m[4] && m[4] !== "-" ? parseLocalDate(m[4]) : undefined,
      tags: [],
      description: name,
      path,
    });
  }
  return out;
}

/** Whether `/proc/mounts` says `/` is on Btrfs. */
export function rootIsBtrfs(mounts: string): boolean {
  return mounts.split("\n").some((l) => {
    const [, mountpoint, type] = l.split(/\s+/);
    return mountpoint === "/" && type === "btrfs";
  });
}

// --- Root and terminal ---------------------------------------------------------

/** pkexec's exit codes and messages, in words; undefined when it ran the program. */
export function pkexecError(code: number, stderr: string): string | undefined {
  if (code === 126) return "Authentication was cancelled";
  if (code === 127 && /not authorized|authentication/i.test(stderr)) return "Not authorized";
  if (/No authentication agent/i.test(stderr)) return "No polkit agent to ask for your password";
  return undefined;
}

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/** A command line as a shell would read it back. */
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/** Separates the outputs of several commands run in one root script. */
export const MARK = "@@BACKSLASH-SNAPSHOTS@@";

/** Splits a root script's output at {@link MARK}. */
export function splitMarked(text: string): string[] {
  const parts = `\n${text}`.split(`\n${MARK}\n`);
  parts[0] = parts[0].slice(1);
  return parts;
}

/** A shell script that runs `argv` in a terminal and waits for Enter before the window closes. */
export function holdOpen(lines: string[]): string[] {
  return [
    "sh",
    "-c",
    `${
      lines.join("\n")
    }\nstatus=$?\necho\nprintf 'Done (exit %s). Press Enter to close this window.' "$status"\nread -r _`,
  ];
}

export function timeshiftRestoreScript(name: string): string[] {
  return holdOpen([
    "echo 'Restoring a Timeshift snapshot: answer the questions below, or press Ctrl+C to cancel.'",
    shellLine(["sudo", "timeshift", "--restore", "--snapshot", name]),
  ]);
}

export function snapperUndoScript(config: string, from: string, to: string): string[] {
  return holdOpen([
    `echo ${quote(`Files changed between snapshots ${from} and ${to} (${config}):`)}`,
    shellLine(["sudo", "snapper", "-c", config, "status", `${from}..${to}`]),
    "echo",
    "printf 'Undo these changes? [y/N] '",
    "read -r answer",
    `case "$answer" in [yY]*) ${
      shellLine(["sudo", "snapper", "-c", config, "undochange", `${from}..${to}`])
    };; *) echo Cancelled;; esac`,
  ]);
}

export function snapperRollbackScript(config: string, number: string): string[] {
  return holdOpen([
    `echo ${quote(`Rolling ${config} back to snapshot ${number}: the system boots into it next time.`)}`,
    "printf 'Continue? [y/N] '",
    "read -r answer",
    `case "$answer" in [yY]*) ${
      shellLine(["sudo", "snapper", "-c", config, "rollback", number])
    } && echo 'Reboot to use the restored system.';; *) echo Cancelled;; esac`,
  ]);
}

export function snapperDiffScript(config: string, from: string, to: string): string[] {
  return [
    "sh",
    "-c",
    `${shellLine(["sudo", "snapper", "-c", config, "diff", `${from}..${to}`])} | less -R`,
  ];
}
