// Running restic, borg and Déjà Dup: listings with the password in the environment,
// backups and mounts as systemd user units so they outlive the launcher.

import {
  backgroundScript,
  type Backup,
  backupArgs,
  BORG_NO_PROMPTS,
  borgError,
  type DejaDup,
  expandHome,
  hashId,
  isMounted,
  mountScript,
  parseBorgArchiveInfo,
  parseBorgInfo,
  parseBorgList,
  parseDejaDup,
  parseResticSnapshots,
  parseResticStats,
  type Repo,
  type RepoStats,
  resticError,
  splitPaths,
  terminalScript,
  unitName,
} from "./lib.ts";
import { runInTerminal } from "./terminal.ts";

export interface Prefs {
  resticRepository?: string;
  resticPassword?: string;
  resticPasswordFile?: string;
  resticRepository2?: string;
  resticPassword2?: string;
  borgRepository?: string;
  borgPassphrase?: string;
  backupPaths?: string;
  excludeFile?: string;
  maxAgeDays?: number | string;
  background?: boolean;
  terminal?: string;
}

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name) || undefined;
  } catch {
    return undefined;
  }
}

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash-backups`;

/** The repositories set in the preferences, or in the usual environment variables. */
export function repos(p: Prefs): Repo[] {
  const out: Repo[] = [];
  const add = (kind: Repo["kind"], location?: string, password?: string, passwordFile?: string) => {
    const loc = location?.trim();
    if (!loc) return;
    const full = expandHome(loc, HOME);
    if (out.some((r) => r.kind === kind && r.location === full)) return;
    out.push({
      kind,
      id: hashId(`${kind}:${full}`),
      location: full,
      password: password || undefined,
      passwordFile: passwordFile?.trim() ? expandHome(passwordFile.trim(), HOME) : undefined,
    });
  };
  add(
    "restic",
    p.resticRepository || env("RESTIC_REPOSITORY"),
    p.resticPassword || (p.resticRepository ? undefined : env("RESTIC_PASSWORD")),
    p.resticPasswordFile || (p.resticRepository ? undefined : env("RESTIC_PASSWORD_FILE")),
  );
  add("restic", p.resticRepository2, p.resticPassword2, p.resticPassword2 ? undefined : p.resticPasswordFile);
  add(
    "borg",
    p.borgRepository || env("BORG_REPO"),
    p.borgPassphrase || (p.borgRepository ? undefined : env("BORG_PASSPHRASE")),
  );
  return out;
}

export function maxAge(p: Prefs): number {
  const n = Number(p.maxAgeDays ?? 7);
  return Number.isFinite(n) && n > 0 ? n : 7;
}

function toolEnv(repo: Repo): Record<string, string> {
  if (repo.kind === "restic") {
    return {
      LC_ALL: "C",
      RESTIC_REPOSITORY: repo.location,
      ...(repo.password ? { RESTIC_PASSWORD: repo.password } : {}),
      ...(repo.passwordFile && !repo.password ? { RESTIC_PASSWORD_FILE: repo.passwordFile } : {}),
    };
  }
  return {
    LC_ALL: "C",
    BORG_REPO: repo.location,
    ...(repo.password ? { BORG_PASSPHRASE: repo.password } : {}),
    ...BORG_NO_PROMPTS,
  };
}

/** Runs restic or borg on the repository; throws a sentence the user understands. */
async function tool(repo: Repo, args: string[], signal?: AbortSignal, timeout = 120_000): Promise<string> {
  const signals = [AbortSignal.timeout(timeout), ...(signal ? [signal] : [])];
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(repo.kind, {
      args,
      env: toolEnv(repo),
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.any(signals),
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(`${repo.kind} is not installed: install it with your package manager`);
    }
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error(`${repo.kind} didn't answer within ${Math.round(timeout / 1000)} s`);
    }
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  if (out.code !== 0) {
    const stderr = text(out.stderr);
    throw new Error(repo.kind === "restic" ? resticError(out.code, stderr) : borgError(out.code, stderr));
  }
  return text(out.stdout);
}

export async function listBackups(
  repo: Repo,
  signal?: AbortSignal,
): Promise<{ backups: Backup[]; encryption?: string }> {
  if (repo.kind === "restic") {
    return { backups: parseResticSnapshots(await tool(repo, ["snapshots", "--json", "--no-lock"], signal), repo.id) };
  }
  const { archives, encryption } = parseBorgList(await tool(repo, ["list", "--json"], signal), repo.id);
  return { backups: archives, encryption };
}

export async function repoStats(repo: Repo, signal?: AbortSignal): Promise<RepoStats> {
  if (repo.kind === "restic") {
    return parseResticStats(await tool(repo, ["stats", "--json", "--no-lock", "--mode", "raw-data"], signal, 300_000));
  }
  return parseBorgInfo(await tool(repo, ["info", "--json"], signal));
}

export async function borgArchive(repo: Repo, name: string) {
  return parseBorgArchiveInfo(await tool(repo, ["info", "--json", `::${name}`]));
}

// --- Secrets for scripts ---------------------------------------------------------

/**
 * Writes the password to a file only the user can read, for a script that
 * deletes it as soon as it starts: it never shows up in a command line or a
 * unit's environment.
 */
async function secretFile(repo: Repo): Promise<string | undefined> {
  if (!repo.password) return undefined;
  await Deno.mkdir(CACHE, { recursive: true, mode: 0o700 });
  const path = `${CACHE}/.secret-${crypto.randomUUID()}`;
  await Deno.writeTextFile(path, repo.password, { mode: 0o600 });
  // Removed by the script; this is in case it never starts.
  setTimeout(() => Deno.remove(path).catch(() => {}), 120_000);
  return path;
}

async function systemdRun(unit: string, description: string, argv: string[]): Promise<void> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command("systemd-run", {
      args: ["--user", `--unit=${unit}`, "--collect", "--quiet", `--description=${description}`, "--", ...argv],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to run backups in the background");
    throw e;
  }
  if (out.code !== 0) {
    const err = new TextDecoder().decode(out.stderr).trim();
    throw new Error(/already (exists|loaded)/i.test(err) ? "It is already running" : err || "systemd-run failed");
  }
}

async function systemctl(args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const out = await new Deno.Command("systemctl", {
      args: ["--user", ...args],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
    }).output();
    return { code: out.code, stdout: new TextDecoder().decode(out.stdout) };
  } catch {
    return { code: 1, stdout: "" };
  }
}

/** Active Backslash units: `backslash-backup-restic-1a2b3c4d-1709290000000.service loaded active running …`. */
export async function runningUnits(): Promise<string[]> {
  const { stdout } = await systemctl(["list-units", "--plain", "--no-legend", "--state=active", "backslash-*"]);
  return stdout.split("\n").map((l) => l.trim().split(/\s+/)[0]).filter((u) => u?.startsWith("backslash-"));
}

export function backupPaths(p: Prefs): string[] {
  const paths = splitPaths(p.backupPaths || "~", HOME);
  return paths.length ? paths : [HOME];
}

export async function backUp(repo: Repo, p: Prefs, where: "terminal" | "background", label: string): Promise<void> {
  const excludeFile = p.excludeFile?.trim() ? expandHome(p.excludeFile.trim(), HOME) : undefined;
  const secret = await secretFile(repo);
  if (where === "terminal") {
    const argv = backupArgs(repo, { paths: backupPaths(p), excludeFile, interactive: true });
    runInTerminal(terminalScript(repo, argv, `Backing up to ${label}…`, secret), p.terminal || undefined);
    return;
  }
  const unit = unitName("backup", repo, Date.now());
  const argv = backupArgs(repo, { paths: backupPaths(p), excludeFile, interactive: false });
  await systemdRun(unit, `Backslash backup to ${label}`, backgroundScript(repo, argv, label, unit, secret));
}

export async function checkInTerminal(repo: Repo, p: Prefs, label: string, argv: string[]): Promise<void> {
  const secret = await secretFile(repo);
  runInTerminal(terminalScript(repo, argv, `Checking ${label}…`, secret), p.terminal || undefined);
}

// --- Mounts ----------------------------------------------------------------------------

export const mountpoint = (repo: Repo) => `${CACHE}/mnt/${repo.kind}-${repo.id}`;

export async function mounted(repo: Repo): Promise<boolean> {
  const mounts = await Deno.readTextFile("/proc/mounts").catch(() => "");
  return isMounted(mounts, mountpoint(repo));
}

async function waitFor(path: string, seconds: number): Promise<boolean> {
  for (let i = 0; i < seconds * 4; i++) {
    try {
      await Deno.stat(path);
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

/** Mounts the repository (once) in the background and waits until `inside` shows up. */
export async function mount(repo: Repo, inside?: string): Promise<string> {
  const dir = mountpoint(repo);
  if (!(await mounted(repo))) {
    await Deno.mkdir(dir, { recursive: true, mode: 0o700 });
    const secret = await secretFile(repo);
    await systemdRun(
      unitName("mount", repo),
      `Backslash: ${repo.kind} mount of ${repo.location}`,
      mountScript(repo, dir, secret),
    );
  }
  const target = inside ?? `${dir}/${repo.kind === "restic" ? "snapshots" : "."}`;
  if (!(await waitFor(target, 45))) {
    const { stdout } = await systemctl(["is-active", unitName("mount", repo)]);
    throw new Error(
      stdout.trim() === "active"
        ? "The repository is mounted but the folder didn't show up yet: try again in a moment"
        : `Mounting failed: see journalctl --user -u ${unitName("mount", repo)}`,
    );
  }
  return target;
}

export async function unmount(repo: Repo): Promise<void> {
  const dir = mountpoint(repo);
  let done = false;
  for (const program of ["fusermount3", "fusermount"]) {
    try {
      const out = await new Deno.Command(program, { args: ["-u", dir], stdin: "null", stdout: "null", stderr: "null" })
        .output();
      if (out.code === 0) {
        done = true;
        break;
      }
    } catch {
      // Not installed: try the next one.
    }
  }
  await systemctl(["stop", unitName("mount", repo)]);
  if (!done && await mounted(repo)) throw new Error("The repository is still in use: close the folder and try again");
}

// --- Déjà Dup ----------------------------------------------------------------------

export interface DejaDupState {
  data: DejaDup;
  flatpak: boolean;
}

async function output(program: string, args: string[]): Promise<string | undefined> {
  try {
    const out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(20_000),
    }).output();
    return out.code === 0 ? new TextDecoder().decode(out.stdout) : undefined;
  } catch {
    return undefined;
  }
}

const DEJA_DUP_APP = "org.gnome.DejaDup";

/** Déjà Dup's settings, from the system's gsettings or through its Flatpak. */
export async function dejaDup(): Promise<DejaDupState | undefined> {
  const native = await output("gsettings", ["list-recursively", "org.gnome.DejaDup"]);
  if (native) return { data: parseDejaDup(native), flatpak: false };
  if (await output("flatpak", ["info", DEJA_DUP_APP]) === undefined) return undefined;
  const text = await output("flatpak", ["run", "--command=gsettings", DEJA_DUP_APP, "list-recursively", DEJA_DUP_APP]);
  return { data: parseDejaDup(text ?? ""), flatpak: true };
}

export function launchDejaDup(flatpak: boolean, args: string[] = []) {
  const [program, argv] = flatpak ? ["flatpak", ["run", DEJA_DUP_APP, ...args]] as const : ["deja-dup", args] as const;
  try {
    new Deno.Command(program, { args: [...argv], stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("Déjà Dup is not installed");
    throw e;
  }
}
