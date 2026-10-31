// Python environments: what pyvenv.cfg, conda and Poetry say, sizes, and the shell lines to use them.

import type { Color } from "@backslash/api";

export type Kind = "venv" | "uv" | "virtualenv" | "poetry" | "pipenv" | "conda";

export const KINDS: Record<Kind, { title: string; color: Color; site: string }> = {
  venv: { title: "venv", color: "blue", site: "https://docs.python.org/3/library/venv.html" },
  uv: { title: "uv", color: "purple", site: "https://docs.astral.sh/uv/" },
  virtualenv: { title: "virtualenv", color: "teal", site: "https://virtualenv.pypa.io" },
  poetry: { title: "Poetry", color: "blue", site: "https://python-poetry.org/docs/managing-environments/" },
  pipenv: { title: "Pipenv", color: "orange", site: "https://pipenv.pypa.io" },
  conda: { title: "conda", color: "green", site: "https://docs.conda.io/projects/conda/en/latest/user-guide/" },
};

export interface Env {
  /** The environment's folder. */
  path: string;
  kind: Kind;
  /** `3.12.4`, or empty when unknown. */
  python: string;
  /** The project it belongs to, when known. */
  project?: string;
  /** conda's environment name, or the prompt of a virtualenv. */
  name?: string;
  /** The Python it was made from (pyvenv.cfg `home`). */
  base?: string;
  /** The tool's own version (uv 0.4.18, virtualenv 20.26.3). */
  creator?: string;
  systemSitePackages?: boolean;
  /** The base Python is gone: the environment can't run. */
  broken?: boolean;
  /** A Poetry or Pipenv environment whose project no longer exists. */
  orphan?: boolean;
  /** The base conda install, which can't be removed. */
  root?: boolean;
  packages?: Package[];
  size?: number;
  created?: number;
}

export interface Package {
  name: string;
  version: string;
}

// ---------------------------------------------------------------------------
// pyvenv.cfg

/** `key = value` lines of pyvenv.cfg, keys lowercased. */
export function parseCfg(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const m = /^\s*([^=#]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1].toLowerCase()] = m[2];
  }
  return out;
}

/** `3.11.9.final.0` → `3.11.9`; `3.13.0rc2` stays. */
export function cleanVersion(v: string | undefined): string {
  const m = /^(\d+\.\d+(?:\.\d+)?(?:(?:a|b|rc)\d+)?)/.exec((v ?? "").trim());
  return m ? m[1] : "";
}

/** Who made a virtualenv, from its pyvenv.cfg and where it lives. */
export function kindOf(cfg: Record<string, string>, path: string, dirs: { poetry: string; pipenv: string }): Kind {
  if (dirs.poetry && path.startsWith(`${dirs.poetry}/`)) return "poetry";
  if (dirs.pipenv && path.startsWith(`${dirs.pipenv}/`)) return "pipenv";
  if (cfg.uv) return "uv";
  if (cfg.virtualenv) return "virtualenv";
  return "venv";
}

/** An environment described by its pyvenv.cfg. */
export function venvFromCfg(
  path: string,
  text: string,
  dirs: { poetry: string; pipenv: string },
): Env {
  const cfg = parseCfg(text);
  const kind = kindOf(cfg, path, dirs);
  const creator = cfg.uv ? `uv ${cfg.uv}` : cfg.virtualenv ? `virtualenv ${cfg.virtualenv}` : undefined;
  return {
    path,
    kind,
    python: cleanVersion(cfg.version_info ?? cfg.version),
    name: cfg.prompt?.replace(/^\(|\)\s*$/g, "") || undefined,
    base: cfg.home || undefined,
    creator,
    systemSitePackages: cfg["include-system-site-packages"]?.toLowerCase() === "true",
  };
}

/** Folder names, inside a project, that hold its virtualenv. */
export const VENV_DIRS = [".venv", "venv", ".env", "env", ".virtualenv", "virtualenv", ".python-venv"];

// ---------------------------------------------------------------------------
// Poetry and Pipenv

/** The project name in a pyproject.toml: `[tool.poetry] name`, else `[project] name`. */
export function pyprojectName(text: string): string | undefined {
  let section = "";
  const names: Record<string, string> = {};
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").trim();
    const header = /^\[([^\]]+)\]$/.exec(line);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const m = /^name\s*=\s*["']([^"']+)["']/.exec(line);
    if (m && (section === "tool.poetry" || section === "project") && !names[section]) names[section] = m[1];
  }
  return names["tool.poetry"] ?? names["project"];
}

/** Whether a pyproject.toml is managed by Poetry. */
export const isPoetryProject = (text: string) => /^\[tool\.poetry(\.[\w.-]+)?\]/m.test(text);

/**
 * Poetry's virtualenv folder prefix for a project, as `EnvManager.generate_env_name`
 * computes it: the sanitized name and 8 characters of the URL-safe base64 SHA-256
 * of the project's path. The folder is `<prefix>-py3.12`.
 */
export async function poetryEnvPrefix(name: string, projectPath: string): Promise<string> {
  const sanitized = name.toLowerCase().replace(/[ $`!*@"\\\r\n\t]/g, "_").slice(0, 42);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(projectPath)));
  const b64 = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_");
  return `${sanitized}-${b64.slice(0, 8)}`;
}

/** `myapp-Ab3dE_9z-py3.12` → `{ prefix: "myapp-Ab3dE_9z", python: "3.12" }`. */
export function parsePoetryDir(name: string): { prefix: string; python: string } | undefined {
  const m = /^(.+-[A-Za-z0-9_-]{8})-py(\d+\.\d+)$/.exec(name);
  return m ? { prefix: m[1], python: m[2] } : undefined;
}

/** Pipenv's `<name>-<hash>` folders keep the project's path in `.project`. */
export const pipenvProject = (text: string) => text.trim() || undefined;

// ---------------------------------------------------------------------------
// conda

/** `conda env list --json`: `{ "envs": [...] }`, newer versions also `envs_details`. */
export function parseCondaList(out: string): string[] {
  try {
    const data = JSON.parse(out) as { envs?: unknown };
    return Array.isArray(data.envs) ? data.envs.filter((e): e is string => typeof e === "string") : [];
  } catch {
    return [];
  }
}

/** `~/.conda/environments.txt`: one prefix per line. */
export function parseEnvironmentsTxt(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/"));
}

/** The Python version from `conda-meta/` file names (`python-3.11.9-h955ad1f_0.json`). */
export function condaPython(files: string[]): string {
  for (const f of files) {
    const m = /^python-(\d+\.\d+\.\d+[^-]*)-[^-]+\.json$/.exec(f);
    if (m) return cleanVersion(m[1]);
  }
  return "";
}

/** Packages from `conda-meta/` file names: `numpy-1.26.4-py311h…_0.json`. */
export function condaPackages(files: string[]): Package[] {
  return files.flatMap((f) => {
    const m = /^(.+)-([^-]+)-([^-]+)\.json$/.exec(f);
    return m ? [{ name: m[1], version: m[2] }] : [];
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** `/home/ada/miniconda3/envs/ds` → `ds`; a root install has no `/envs/`. */
export function condaName(path: string): { name: string; root: boolean } {
  const m = /\/envs\/([^/]+)\/?$/.exec(path);
  return m ? { name: m[1], root: false } : { name: "base", root: true };
}

// ---------------------------------------------------------------------------
// Packages and sizes

/** `requests-2.32.3.dist-info` → requests 2.32.3; egg-info too. */
export function distInfo(dir: string): Package | undefined {
  const m = /^(.+?)-(\d[^-]*?)(?:-py\d[^-]*)?\.(?:dist|egg)-info$/.exec(dir);
  return m ? { name: m[1].replace(/_/g, "-"), version: m[2] } : undefined;
}

/** `du -sb` output (`<bytes>\t<path>` lines) by path. */
export function parseDu(out: string): Map<string, number> {
  const sizes = new Map<string, number>();
  for (const line of out.split("\n")) {
    const m = /^(\d+)\s+(.+)$/.exec(line.trim());
    if (m) sizes.set(m[2], Number(m[1]));
  }
  return sizes;
}

export function formatSize(bytes: number | undefined): string {
  if (bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let n = bytes / 1024, i = 0;
  while (n >= 1024 && i < units.length - 1) n /= 1024, i++;
  return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** `/home/ada/Projects/api` → `~/Projects/api`. */
export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

export const basename = (path: string) => path.replace(/\/+$/, "").split("/").pop() ?? path;

/** How the row names an environment: its project, else its own name. */
export function envTitle(e: Env): string {
  if (e.kind === "conda") return e.name ?? basename(e.path);
  if (e.project) return basename(e.project);
  if (e.kind === "poetry") {
    return parsePoetryDir(basename(e.path))?.prefix.replace(/-[A-Za-z0-9_-]{8}$/, "") ?? basename(e.path);
  }
  if (e.kind === "pipenv") return basename(e.path).replace(/-[A-Za-z0-9_]{8}$/, "");
  return e.name ?? basename(e.path);
}

/** Problems first (broken, orphaned), then by project or name. */
export function sortEnvs(envs: Env[]): Env[] {
  const rank = (e: Env) => (e.broken || e.orphan ? 0 : 1);
  return [...envs].sort((a, b) =>
    rank(a) - rank(b) || envTitle(a).localeCompare(envTitle(b)) || a.path.localeCompare(b.path)
  );
}

/** One per folder; the first description of it wins. */
export function dedupe(envs: Env[]): Env[] {
  const seen = new Set<string>();
  return envs.filter((e) => {
    const key = e.path.replace(/\/+$/, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Shell lines

const q = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/** The line that activates the environment in a POSIX shell. */
export function activateLine(e: Env): string {
  if (e.kind === "conda") {
    return `conda activate ${q(e.root ? "base" : e.name && !e.path.includes(" ") ? e.name : e.path)}`;
  }
  return `source ${q(`${e.path}/bin/activate`)}`;
}

/**
 * A bash script that activates the environment, then hands over to the user's
 * shell, which inherits PATH and VIRTUAL_ENV (or CONDA_PREFIX).
 */
export function terminalScript(e: Env, then = 'exec "${SHELL:-bash}"'): string {
  const lines: string[] = [];
  if (e.project) lines.push(`cd ${q(e.project)} 2>/dev/null || true`);
  if (e.kind === "conda") {
    lines.push(
      `if command -v conda >/dev/null 2>&1; then eval "$(conda shell.bash hook)" && conda activate ${q(e.path)};`,
      `elif command -v micromamba >/dev/null 2>&1; then eval "$(micromamba shell hook -s bash)" && micromamba activate ${
        q(e.path)
      };`,
      `else export PATH=${q(`${e.path}/bin`)}:"$PATH" CONDA_PREFIX=${q(e.path)}; fi`,
    );
  } else {
    lines.push(`. ${q(`${e.path}/bin/activate`)}`);
  }
  lines.push(`printf '\\033[1m%s\\033[0m activated: %s\\n' ${q(envTitle(e))} "$(python --version 2>&1)"`);
  lines.push(then);
  return lines.join("\n");
}

/** Refuses to delete anything that isn't plainly an environment folder. */
export function checkDeletable(e: Env, home: string): void {
  const path = e.path.replace(/\/+$/, "");
  if (!path.startsWith("/") || path === home || path.split("/").length < 5) {
    throw new Error(`${path} doesn't look like an environment folder`);
  }
  if (e.root) throw new Error("The base conda environment can't be removed");
  if (e.project && path === e.project.replace(/\/+$/, "")) throw new Error("That is the project itself");
}
