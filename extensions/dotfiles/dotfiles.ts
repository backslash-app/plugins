// Finding and reading the dotfile managers in use: chezmoi, yadm, a bare git repository, GNU Stow.

import {
  type Backend,
  chezmoiFiles,
  type Commit,
  type DotFile,
  expandHome,
  gitFiles,
  type GitStatus,
  joinHome,
  LOG_FORMAT,
  parseChezmoiStatus,
  parseGitStatus,
  parseLog,
  parseStowrc,
  STOW_SKIP,
  type StowOptions,
  type StowPackage,
  stowTarget,
} from "./lib.ts";

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name) || undefined;
  } catch {
    return undefined;
  }
}

export const HOME = env("HOME") ?? "";

export interface Prefs {
  stowDir?: string;
  bareRepo?: string;
  terminal?: string;
}

export class Missing extends Error {}

/** Runs a program; Missing when it is not installed, an Error with its last stderr line otherwise. */
export async function sh(
  program: string,
  args: string[],
  o: { cwd?: string; signal?: AbortSignal; timeout?: number } = {},
): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      cwd: o.cwd ?? (HOME || undefined),
      env: { LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0" },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.any([AbortSignal.timeout(o.timeout ?? 30_000), ...(o.signal ? [o.signal] : [])]),
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable) throw new Missing(program);
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Error(`${program} took too long to answer`);
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  if (out.code !== 0) {
    const err = text(out.stderr).split("\n").map((l) => l.trim()).filter(Boolean).pop();
    throw new Error(err ?? `${program} exited with ${out.code}`);
  }
  return text(out.stdout);
}

/** How to run git commands on a repository: `[program, ...args]`. */
export interface GitTool {
  program: string;
  base: string[];
  cwd?: string;
}

export const gitArgv = (g: GitTool, args: string[]) => [g.program, ...g.base, ...args];

export function git(g: GitTool, args: string[], signal?: AbortSignal): Promise<string> {
  return sh(g.program, [...g.base, ...args], { cwd: g.cwd, signal });
}

export interface Source {
  backend: Backend;
  /** Where the dotfiles are kept: chezmoi's source folder, the repository, the stow folder. */
  root: string;
  files: DotFile[];
  git?: GitTool;
  status?: GitStatus;
  log: Commit[];
  error?: string;
  stow?: { options: StowOptions; packages: StowPackage[]; installed: boolean };
}

async function exists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function gitDetails(g: GitTool, signal?: AbortSignal): Promise<{ status?: GitStatus; log: Commit[] }> {
  const [status, log] = await Promise.all([
    git(g, ["status", "--porcelain=v1", "--branch", "--untracked-files=no"], signal).then(
      parseGitStatus,
      () => undefined,
    ),
    git(g, ["log", "-n", "8", LOG_FORMAT], signal).then(parseLog, () => []),
  ]);
  return { status, log };
}

// --- chezmoi ----------------------------------------------------------------------------

async function loadChezmoi(signal?: AbortSignal): Promise<Source | undefined> {
  let root: string;
  try {
    root = (await sh("chezmoi", ["source-path"], { signal, timeout: 10_000 })).trim();
  } catch {
    return undefined; // not installed, or not initialised
  }
  if (!root || !(await exists(root))) return undefined;
  const g: GitTool = { program: "chezmoi", base: ["git", "--"] };
  try {
    const [status, managed, details] = await Promise.all([
      sh("chezmoi", ["status"], { signal, timeout: 60_000 }),
      sh("chezmoi", ["managed", "--path-style=absolute", "--include=files,symlinks"], { signal }),
      exists(`${root}/.git`).then((yes) => yes ? gitDetails(g, signal) : { status: undefined, log: [] }),
    ]);
    return {
      backend: "chezmoi",
      root,
      files: chezmoiFiles(managed, parseChezmoiStatus(status, HOME)),
      git: details.status ? g : undefined,
      status: details.status,
      log: details.log,
    };
  } catch (e) {
    return { backend: "chezmoi", root, files: [], log: [], error: (e as Error).message };
  }
}

// --- git ----------------------------------------------------------------------------------

async function loadGit(backend: "yadm" | "bare", g: GitTool, root: string, signal?: AbortSignal) {
  const [ls, details] = await Promise.all([git(g, ["ls-files"], signal), gitDetails(g, signal)]);
  const status = details.status ?? { branch: { ahead: 0, behind: 0 }, files: [] };
  return {
    backend,
    root,
    files: gitFiles(backend, HOME, ls, status),
    git: g,
    status,
    log: details.log,
  } satisfies Source;
}

async function loadYadm(signal?: AbortSignal): Promise<Source | undefined> {
  const g: GitTool = { program: "yadm", base: [], cwd: HOME };
  let repo: string;
  try {
    repo = (await sh("yadm", ["introspect", "repo"], { signal, timeout: 10_000 })).trim();
  } catch {
    return undefined;
  }
  if (!repo || !(await exists(`${repo}/HEAD`))) return undefined;
  try {
    return await loadGit("yadm", g, repo, signal);
  } catch (e) {
    return { backend: "yadm", root: repo, files: [], log: [], git: g, error: (e as Error).message };
  }
}

async function loadBare(dir: string, signal?: AbortSignal): Promise<Source | undefined> {
  if (!(await exists(`${dir}/HEAD`)) || !(await exists(`${dir}/objects`))) return undefined;
  const g: GitTool = { program: "git", base: ["--git-dir", dir, "--work-tree", HOME], cwd: HOME };
  try {
    return await loadGit("bare", g, dir, signal);
  } catch (e) {
    if (e instanceof Missing) return { backend: "bare", root: dir, files: [], log: [], error: "git is not installed" };
    return { backend: "bare", root: dir, files: [], log: [], git: g, error: (e as Error).message };
  }
}

// --- Stow ----------------------------------------------------------------------------------

const PACKAGE_IGNORE = /^(\.git|\.gitignore|\.gitmodules|\.stow-local-ignore|.*~|#.*#|\.DS_Store)$/;
const PACKAGE_ROOT_IGNORE = /^(README.*|LICENSE.*|COPYING)$/;
const MAX_FILES = 2000;

async function walk(dir: string, rel = "", out: string[] = []): Promise<string[]> {
  for await (const e of Deno.readDir(dir)) {
    if (out.length >= MAX_FILES) break;
    if (PACKAGE_IGNORE.test(e.name) || (!rel && PACKAGE_ROOT_IGNORE.test(e.name))) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory) await walk(`${dir}/${e.name}`, r, out);
    else out.push(r);
  }
  return out;
}

async function real(path: string): Promise<string | undefined> {
  try {
    return await Deno.realPath(path);
  } catch {
    return undefined;
  }
}

async function readPackage(stowDir: string, name: string, o: StowOptions): Promise<StowPackage> {
  const files = await walk(`${stowDir}/${name}`);
  const result: StowPackage["files"] = [];
  await Promise.all(files.map(async (rel) => {
    const source = `${stowDir}/${name}/${rel}`;
    const target = stowTarget(rel, o);
    let state: StowPackage["files"][number]["state"];
    if (!(await exists(target))) state = "missing";
    else {
      const [a, b] = await Promise.all([real(source), real(target)]);
      if (a && a === b) state = "linked";
      else state = (await Deno.lstat(target)).isSymlink ? "foreign" : "conflict";
    }
    result.push({ source, target, state });
  }));
  result.sort((a, b) => a.target.localeCompare(b.target));
  return { name, files: result };
}

async function loadStow(dir: string, skip: string[], signal?: AbortSignal): Promise<Source | undefined> {
  if (skip.includes(dir)) return undefined;
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(dir);
  } catch {
    return undefined;
  }
  if (!info.isDirectory) return undefined;
  const [rc, installed] = await Promise.all([
    Deno.readTextFile(`${dir}/.stowrc`).catch(() => undefined),
    sh("stow", ["--version"], { timeout: 5_000 }).then(() => true, () => false),
  ]);
  const options = parseStowrc(rc ?? "", dir, HOME);
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isDirectory && !STOW_SKIP.test(e.name)) names.push(e.name);
  }
  names.sort((a, b) => a.localeCompare(b));
  const packages = await Promise.all(names.map((n) => readPackage(dir, n, options)));
  const inUse = rc !== undefined || packages.some((p) => p.files.some((f) => f.state === "linked"));
  if (!inUse && !installed) return undefined;
  let gitPart: { git?: GitTool; status?: GitStatus; log: Commit[] } = { log: [] };
  const files: DotFile[] = [];
  if (await exists(`${dir}/.git`)) {
    const g: GitTool = { program: "git", base: ["-C", dir], cwd: dir };
    const details = await gitDetails(g, signal).catch(() => ({ status: undefined, log: [] as Commit[] }));
    gitPart = { git: details.status ? g : undefined, status: details.status, log: details.log };
    for (const f of gitFiles("stow", dir, "", details.status ?? { branch: { ahead: 0, behind: 0 }, files: [] })) {
      files.push(f);
    }
  }
  return { backend: "stow", root: dir, files, ...gitPart, stow: { options, packages, installed } };
}

/** Every manager found, in parallel. */
export async function load(p: Prefs, signal?: AbortSignal): Promise<Source[]> {
  const bare = expandHome(p.bareRepo?.trim() || "~/.dotfiles", HOME);
  const [chezmoi, yadm, bareRepo] = await Promise.all([loadChezmoi(signal), loadYadm(signal), loadBare(bare, signal)]);
  const stowDir = expandHome(p.stowDir?.trim() || "~/dotfiles", HOME).replace(/\/+$/, "");
  const taken = [chezmoi?.root, bareRepo?.root, yadm?.root].filter(Boolean) as string[];
  const stow = await loadStow(stowDir, taken, signal);
  return [chezmoi, yadm, bareRepo, stow].filter((s): s is Source => s !== undefined);
}

/** The source file chezmoi keeps for a target (`~/.bashrc` → `…/chezmoi/dot_bashrc`). */
export async function chezmoiSource(target: string): Promise<string> {
  return (await sh("chezmoi", ["source-path", target])).trim();
}

export const homePath = (rel: string) => joinHome(HOME, rel);
