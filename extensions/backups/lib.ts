// Parsing and formatting for restic, BorgBackup and Déjà Dup, and the scripts that run them.

export type Kind = "restic" | "borg";

/** A repository from the preferences (or the environment). */
export interface Repo {
  kind: Kind;
  /** Stable, short: names the mount folder and the systemd units. */
  id: string;
  /** Path or URL: `/mnt/backup/restic`, `sftp:nas:/srv/restic`, `ssh://u@host/./repo`… */
  location: string;
  password?: string;
  passwordFile?: string;
}

/** A restic snapshot or a borg archive. */
export interface Backup {
  repo: string;
  /** Full id (restic) or archive name (borg). */
  id: string;
  /** What the user recognises: restic's short id, borg's archive name. */
  shortId: string;
  /** Milliseconds since the epoch. */
  time: number;
  /** End of the backup, when known. */
  end?: number;
  hostname?: string;
  username?: string;
  paths: string[];
  tags: string[];
  excludes?: string[];
  program?: string;
  parent?: string;
  summary?: {
    filesNew: number;
    filesChanged: number;
    filesUnmodified: number;
    dataAdded: number;
    totalFiles: number;
    totalBytes: number;
  };
}

export interface RepoStats {
  /** Bytes on disk (restic raw data, borg deduplicated and compressed). */
  size?: number;
  /** Bytes before compression and deduplication. */
  originalSize?: number;
  compressionRatio?: number;
  count?: number;
  encryption?: string;
}

// --- Generic -------------------------------------------------------------------

/** FNV-1a, as 8 hex characters: a stable id for a repository location. */
export function hashId(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "?";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let v = bytes, i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

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

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export type Freshness = "fresh" | "stale" | "never";

/** Whether the last backup is older than `maxDays`. */
export function freshness(last: number | undefined, maxDays: number, now = Date.now()): Freshness {
  if (last === undefined) return "never";
  return now - last > maxDays * 86400_000 ? "stale" : "fresh";
}

/** `~/Documents, /etc` → absolute paths. */
export function splitPaths(text: string, home: string): string[] {
  return text.split(/[,\n]/).map((p) => p.trim()).filter(Boolean).map((p) => expandHome(p, home));
}

export function expandHome(path: string, home: string): string {
  return path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
}

/** `/home/me/Documents` → `~/Documents`. */
export function tildify(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

/** A short name for a repository: the last part of its path or URL. */
export function repoLabel(location: string): string {
  const trimmed = location.replace(/\/+$/, "");
  const scheme = trimmed.match(/^(sftp|rest|s3|b2|azure|gs|swift|rclone|ssh):/)?.[1];
  const tail = trimmed.split(/[/:]/).filter(Boolean).pop() ?? trimmed;
  return scheme && scheme !== "ssh" ? `${tail} (${scheme})` : tail;
}

// --- restic ------------------------------------------------------------------------

interface ResticJson {
  time: string;
  parent?: string;
  tree?: string;
  paths?: string[];
  hostname?: string;
  username?: string;
  tags?: string[] | null;
  excludes?: string[] | null;
  program_version?: string;
  id: string;
  short_id?: string;
  summary?: {
    backup_start?: string;
    backup_end?: string;
    files_new?: number;
    files_changed?: number;
    files_unmodified?: number;
    data_added?: number;
    total_files_processed?: number;
    total_bytes_processed?: number;
  };
}

/** `restic snapshots --json`: newest first. */
export function parseResticSnapshots(json: string, repo: string): Backup[] {
  const data = JSON.parse(json || "[]") as ResticJson[] | null;
  return (data ?? []).map((s) => {
    const sum = s.summary;
    return {
      repo,
      id: s.id,
      shortId: s.short_id ?? s.id.slice(0, 8),
      time: Date.parse(s.time),
      end: sum?.backup_end ? Date.parse(sum.backup_end) : undefined,
      hostname: s.hostname,
      username: s.username,
      paths: s.paths ?? [],
      tags: s.tags ?? [],
      excludes: s.excludes ?? undefined,
      program: s.program_version,
      parent: s.parent,
      summary: sum
        ? {
          filesNew: sum.files_new ?? 0,
          filesChanged: sum.files_changed ?? 0,
          filesUnmodified: sum.files_unmodified ?? 0,
          dataAdded: sum.data_added ?? 0,
          totalFiles: sum.total_files_processed ?? 0,
          totalBytes: sum.total_bytes_processed ?? 0,
        }
        : undefined,
    };
  }).sort((a, b) => b.time - a.time);
}

/** `restic stats --json --mode raw-data`. */
export function parseResticStats(json: string): RepoStats {
  const s = JSON.parse(json) as {
    total_size?: number;
    total_uncompressed_size?: number;
    compression_ratio?: number;
    snapshots_count?: number;
  };
  return {
    size: s.total_size,
    originalSize: s.total_uncompressed_size,
    compressionRatio: s.compression_ratio,
    count: s.snapshots_count,
  };
}

/** What a failed restic call means, in words. */
export function resticError(code: number, stderr: string): string {
  if (code === 12 || /wrong password or no key found/i.test(stderr)) {
    return "restic refused the password: check it in Settings";
  }
  if (code === 10 || /Is there a repository at the following location|repository does not exist/i.test(stderr)) {
    return "No restic repository at this location: check the path in Settings, or create one with restic init";
  }
  if (code === 11 || /unable to create lock|repository is already locked/i.test(stderr)) {
    return "The repository is locked by another restic: wait for it, or run restic unlock";
  }
  if (/empty password|reading repository password|Please specify repository location/i.test(stderr)) {
    return "restic needs a repository and a password: set them in Settings";
  }
  if (/Host key verification failed|Permission denied \(publickey/i.test(stderr)) {
    return "SSH couldn't connect without asking: add the host to known_hosts and use a key";
  }
  return lastLine(stderr) ?? `restic exited with ${code}`;
}

// --- Borg ------------------------------------------------------------------------

interface BorgArchiveJson {
  archive?: string;
  name: string;
  id: string;
  start: string;
  time?: string;
  end?: string;
  hostname?: string;
  username?: string;
  comment?: string;
}

/** Borg's timestamps are local time without offset (1.x) or with one (1.4+). */
export function parseBorgTime(text: string): number {
  return Date.parse(text.replace(/(\.\d{3})\d+/, "$1"));
}

/** `borg list --json`. */
export function parseBorgList(json: string, repo: string): { archives: Backup[]; encryption?: string } {
  const data = JSON.parse(json) as { archives?: BorgArchiveJson[]; encryption?: { mode?: string } };
  const archives = (data.archives ?? []).map((a) => ({
    repo,
    id: a.name ?? a.archive,
    shortId: a.name ?? a.archive ?? a.id.slice(0, 8),
    time: parseBorgTime(a.start ?? a.time),
    end: a.end ? parseBorgTime(a.end) : undefined,
    hostname: a.hostname,
    username: a.username,
    paths: [],
    tags: a.comment ? [a.comment] : [],
  })).sort((a, b) => b.time - a.time);
  return { archives, encryption: data.encryption?.mode };
}

/** `borg info --json` of the repository. */
export function parseBorgInfo(json: string): RepoStats {
  const data = JSON.parse(json) as {
    cache?: { stats?: { unique_csize?: number; total_size?: number; unique_size?: number } };
    encryption?: { mode?: string };
  };
  const st = data.cache?.stats;
  return {
    size: st?.unique_csize,
    originalSize: st?.total_size,
    compressionRatio: st?.unique_csize && st.unique_size ? st.unique_size / st.unique_csize : undefined,
    encryption: data.encryption?.mode,
  };
}

export interface BorgArchiveInfo {
  hostname?: string;
  username?: string;
  commandLine?: string[];
  comment?: string;
  duration?: number;
  start?: number;
  end?: number;
  files?: number;
  originalSize?: number;
  compressedSize?: number;
  deduplicatedSize?: number;
}

/** `borg info --json REPO::ARCHIVE`. */
export function parseBorgArchiveInfo(json: string): BorgArchiveInfo {
  const data = JSON.parse(json) as {
    archives?: {
      hostname?: string;
      username?: string;
      command_line?: string[];
      comment?: string;
      duration?: number;
      start?: string;
      end?: string;
      stats?: { nfiles?: number; original_size?: number; compressed_size?: number; deduplicated_size?: number };
    }[];
  };
  const a = data.archives?.[0];
  if (!a) return {};
  return {
    hostname: a.hostname,
    username: a.username,
    commandLine: a.command_line,
    comment: a.comment || undefined,
    duration: a.duration,
    start: a.start ? parseBorgTime(a.start) : undefined,
    end: a.end ? parseBorgTime(a.end) : undefined,
    files: a.stats?.nfiles,
    originalSize: a.stats?.original_size,
    compressedSize: a.stats?.compressed_size,
    deduplicatedSize: a.stats?.deduplicated_size,
  };
}

export function borgError(code: number, stderr: string): string {
  if (/passphrase .*incorrect|passphrase supplied .* is incorrect/i.test(stderr)) {
    return "Borg refused the passphrase: check it in Settings";
  }
  if (/Enter passphrase|passphrase prompt|BORG_PASSPHRASE/i.test(stderr)) {
    return "This Borg repository is encrypted: set its passphrase in Settings";
  }
  if (/does not exist|is not a valid repository/i.test(stderr)) {
    return "No Borg repository at this location: check it in Settings, or create one with borg init";
  }
  if (/Failed to create\/acquire the lock|lock\.exclusive/i.test(stderr)) {
    return "The repository is locked by another borg: wait for it, or run borg break-lock";
  }
  if (/Host key verification failed|Permission denied \(publickey/i.test(stderr)) {
    return "SSH couldn't connect without asking: add the host to known_hosts and use a key";
  }
  if (/relocated|previously located/i.test(stderr)) {
    return "The repository moved since borg last saw it: run borg list once in a terminal to accept it";
  }
  return lastLine(stderr) ?? `borg exited with ${code}`;
}

function lastLine(text: string): string | undefined {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).pop();
}

/** Borg variables that make it fail instead of waiting for an answer nobody can type. */
export const BORG_NO_PROMPTS: Record<string, string> = {
  BORG_RELOCATED_REPO_ACCESS_IS_OK: "no",
  BORG_UNKNOWN_UNENCRYPTED_REPO_ACCESS_IS_OK: "no",
  BORG_RSH: "ssh -o BatchMode=yes",
};

// --- Déjà Dup ------------------------------------------------------------------------

export interface DejaDup {
  lastBackup?: number;
  lastRun?: number;
  periodic?: boolean;
  periodDays?: number;
  backend?: string;
  include: string[];
  exclude: string[];
  /** Where the backups go, when the backend says. */
  destination?: string;
}

function gvariantValue(text: string): string | number | boolean | string[] {
  const t = text.trim().replace(/^(?:u?int\d+|@as|@s)\s+/, "");
  if (t === "true" || t === "false") return t === "true";
  if (/^-?\d+$/.test(t)) return Number(t);
  if (t.startsWith("[")) return [...t.matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1].replace(/\\(.)/g, "$1"));
  const m = t.match(/^'((?:[^'\\]|\\.)*)'$/);
  return m ? m[1].replace(/\\(.)/g, "$1") : t;
}

/** `gsettings list-recursively org.gnome.DejaDup`: `org.gnome.DejaDup last-backup '2024-03-01T10:00:00.12Z'`. */
export function parseDejaDup(text: string): DejaDup {
  const values: Record<string, ReturnType<typeof gvariantValue>> = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^(org\.gnome\.DejaDup(?:\.[\w-]+)?)\s+([\w-]+)\s+(.*)$/);
    if (m) values[`${m[1]} ${m[2]}`] = gvariantValue(m[3]);
  }
  const get = (key: string, schema = "org.gnome.DejaDup") => values[`${schema} ${key}`];
  const date = (v: unknown) => typeof v === "string" && v ? Date.parse(v) || undefined : undefined;
  const backend = typeof get("backend") === "string" ? String(get("backend")) : undefined;
  let destination: string | undefined;
  if (backend === "local") {
    destination = String(get("folder", "org.gnome.DejaDup.Local") ?? "") || undefined;
  } else if (backend === "remote") {
    const uri = String(get("uri", "org.gnome.DejaDup.Remote") ?? "");
    const folder = String(get("folder", "org.gnome.DejaDup.Remote") ?? "");
    destination = uri ? `${uri.replace(/\/$/, "")}/${folder}`.replace(/\/$/, "") : undefined;
  } else if (backend === "drive") {
    const name = String(get("name", "org.gnome.DejaDup.Drive") ?? "");
    const folder = String(get("folder", "org.gnome.DejaDup.Drive") ?? "");
    destination = name ? `${name}${folder ? `: ${folder}` : ""}` : undefined;
  } else if (backend === "google") destination = "Google Drive";
  else if (backend === "microsoft") destination = "Microsoft OneDrive";
  const list = (v: unknown) => Array.isArray(v) ? v.map(String) : [];
  return {
    lastBackup: date(get("last-backup")),
    lastRun: date(get("last-run")),
    periodic: typeof get("periodic") === "boolean" ? Boolean(get("periodic")) : undefined,
    periodDays: typeof get("periodic-period") === "number" ? Number(get("periodic-period")) : undefined,
    backend,
    include: list(get("include-list")),
    exclude: list(get("exclude-list")),
    destination,
  };
}

const XDG_DIRS: Record<string, string> = {
  DESKTOP: "Desktop",
  DOCUMENTS: "Documents",
  DOWNLOAD: "Downloads",
  MUSIC: "Music",
  PICTURES: "Pictures",
  PUBLIC_SHARE: "Public",
  TEMPLATES: "Templates",
  VIDEOS: "Videos",
};

/** Déjà Dup writes `$HOME`, `$TRASH`, `$DOWNLOAD`… in its lists. */
export function dejaDupPath(p: string): string {
  if (p === "$TRASH") return "Trash";
  return p.replace(/^\$HOME/, "~").replace(/^\$([A-Z_]+)/, (all, d: string) => XDG_DIRS[d] ? `~/${XDG_DIRS[d]}` : all);
}

export const BACKEND_LABELS: Record<string, string> = {
  auto: "Automatic",
  local: "Local folder",
  drive: "External drive",
  remote: "Network server",
  google: "Google Drive",
  microsoft: "Microsoft OneDrive",
  rclone: "Rclone",
};

// --- Scripts ---------------------------------------------------------------------

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/**
 * Shell lines that read the password file Backslash wrote, delete it at once,
 * and export it the way the tool reads it.
 */
export function secretPrelude(repo: Repo, tempFile?: string): string[] {
  const lines: string[] = [];
  if (repo.kind === "restic") {
    if (tempFile) {
      lines.push(`RESTIC_PASSWORD="$(cat ${quote(tempFile)})"; export RESTIC_PASSWORD; rm -f ${quote(tempFile)}`);
    } else if (repo.passwordFile) lines.push(`export RESTIC_PASSWORD_FILE=${quote(repo.passwordFile)}`);
    lines.push(`export RESTIC_REPOSITORY=${quote(repo.location)}`);
  } else {
    if (tempFile) {
      lines.push(`BORG_PASSPHRASE="$(cat ${quote(tempFile)})"; export BORG_PASSPHRASE; rm -f ${quote(tempFile)}`);
    }
    lines.push(`export BORG_REPO=${quote(repo.location)}`);
  }
  return lines;
}

export interface BackupOptions {
  paths: string[];
  excludeFile?: string;
  hostname?: string;
  /** Show progress (terminal) or keep the log short (background). */
  interactive: boolean;
}

/** The backup itself, once the repository and password are exported. */
export function backupArgs(repo: Repo, o: BackupOptions): string[] {
  if (repo.kind === "restic") {
    return [
      "restic",
      "backup",
      ...(o.interactive ? ["--verbose"] : []),
      "--exclude-caches",
      ...(o.excludeFile ? ["--exclude-file", o.excludeFile] : []),
      "--tag",
      "backslash",
      ...o.paths,
    ];
  }
  return [
    "borg",
    "create",
    "--stats",
    ...(o.interactive ? ["--progress", "--list", "--filter=AME"] : []),
    "--exclude-caches",
    ...(o.excludeFile ? ["--exclude-from", o.excludeFile] : []),
    "::{hostname}-{now:%Y-%m-%dT%H:%M:%S}",
    ...o.paths,
  ];
}

export function checkArgs(repo: Repo): string[] {
  return repo.kind === "restic" ? ["restic", "check"] : ["borg", "check", "--verbose", "--repository-only"];
}

/** A script for a terminal: runs, then waits for Enter so the user can read the result. */
export function terminalScript(repo: Repo, argv: string[], title: string, tempFile?: string): string[] {
  return [
    "sh",
    "-c",
    [
      ...secretPrelude(repo, tempFile),
      ...(repo.kind === "borg" ? Object.entries(BORG_NO_PROMPTS).slice(0, 2).map(([k, v]) => `export ${k}=${v}`) : []),
      `echo ${quote(title)}`,
      "echo",
      shellLine(argv),
      "status=$?",
      "echo",
      `if [ "$status" -eq 0 ]; then echo 'Finished.'; else echo "Failed (exit $status)."; fi`,
      "printf 'Press Enter to close this window.'",
      "read -r _",
    ].join("\n"),
  ];
}

/** A systemd unit's command: runs in the background and tells how it went with a notification. */
export function backgroundScript(repo: Repo, argv: string[], label: string, unit: string, tempFile?: string): string[] {
  const notify = (title: string, body: string, critical: boolean) =>
    shellLine([
      "notify-send",
      "-a",
      "Backslash",
      ...(critical ? ["-u", "critical", "-i", "dialog-error"] : ["-i", "drive-harddisk"]),
      title,
      body,
    ]);
  return [
    "sh",
    "-c",
    [
      ...secretPrelude(repo, tempFile),
      ...(repo.kind === "borg" ? Object.entries(BORG_NO_PROMPTS).map(([k, v]) => `export ${k}=${quote(v)}`) : []),
      `if ${shellLine(argv)}; then ${notify("Backup finished", label, false)}; else status=$?; ${
        notify("Backup failed", `${label}: see journalctl --user -u ${unit}`, true)
      }; exit $status; fi`,
    ].join("\n"),
  ];
}

/** A FUSE mount that stays in the foreground, so stopping its unit unmounts it. */
export function mountScript(repo: Repo, mountpoint: string, tempFile?: string): string[] {
  const argv = repo.kind === "restic"
    ? ["restic", "mount", "--no-lock", mountpoint]
    : ["borg", "mount", "--foreground", "::", mountpoint];
  return [
    "sh",
    "-c",
    [
      ...secretPrelude(repo, tempFile),
      ...(repo.kind === "borg" ? Object.entries(BORG_NO_PROMPTS).map(([k, v]) => `export ${k}=${quote(v)}`) : []),
      `mkdir -p ${quote(mountpoint)}`,
      `exec ${shellLine(argv)}`,
    ].join("\n"),
  ];
}

/** systemd unit names: letters, digits and `-` only. */
export function unitName(purpose: "backup" | "mount", repo: Repo, stamp?: number): string {
  return `backslash-${purpose}-${repo.kind}-${repo.id}${stamp ? `-${stamp}` : ""}`;
}

/** The folder of one backup inside a mounted repository. */
export function backupFolder(mountpoint: string, b: Backup, kind: Kind): string {
  return kind === "restic" ? `${mountpoint}/ids/${b.shortId}` : `${mountpoint}/${b.id}`;
}

/** Whether `/proc/mounts` lists `mountpoint` (paths there escape spaces as `\040`). */
export function isMounted(mounts: string, mountpoint: string): boolean {
  return mounts.split("\n").some((l) => l.split(" ")[1]?.replace(/\\040/g, " ") === mountpoint);
}

export function restoreCommand(repo: Repo, b: Backup, target: string): string {
  return repo.kind === "restic"
    ? shellLine(["restic", "-r", repo.location, "restore", b.shortId, "--target", target])
    : `cd ${quote(target)} && ${shellLine(["borg", "extract", "--progress", `${repo.location}::${b.id}`])}`;
}
