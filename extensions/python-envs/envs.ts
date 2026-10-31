// Finding environments on disk and asking conda; sizes with du.

import {
  basename,
  condaName,
  condaPackages,
  condaPython,
  dedupe,
  distInfo,
  type Env,
  isPoetryProject,
  type Package,
  parseCondaList,
  parseDu,
  parseEnvironmentsTxt,
  parsePoetryDir,
  pipenvProject,
  poetryEnvPrefix,
  pyprojectName,
  venvFromCfg,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

/** Same folders as `[permissions] read`. */
export const FOLDERS = [
  "Projects",
  "projects",
  "Code",
  "code",
  "dev",
  "Developer",
  "src",
  "git",
  "repos",
  "workspace",
  "work",
  "Work",
];

export const POETRY = `${HOME}/.cache/pypoetry/virtualenvs`;
export const PIPENV = `${HOME}/.local/share/virtualenvs`;
const DIRS = { poetry: POETRY, pipenv: PIPENV };

/** Conda installs read for environments.txt' siblings when conda isn't on the PATH. */
const CONDA_ROOTS = ["miniconda3", "anaconda3", "miniforge3", "mambaforge", "micromamba", ".local/share/mamba"].map((
  d,
) => `${HOME}/${d}`).concat("/opt/conda");

/** A folder name that may hold a project's virtualenv: .venv, venv, env, .venv-3.12… */
const VENV_NAME = /^\.?(venv|env|virtualenv|python-venv)([-_.][\w.-]+)?$/;

const read = (path: string) => Deno.readTextFile(path).catch(() => undefined);

async function subdirs(path: string): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(path)) if (e.isDirectory) out.push(e.name);
  } catch { /* missing or unreadable */ }
  return out;
}

async function exists(path: string): Promise<boolean | undefined> {
  try {
    await Deno.stat(path);
    return true;
  } catch (e) {
    return e instanceof Deno.errors.NotFound ? false : undefined;
  }
}

async function created(path: string): Promise<number | undefined> {
  try {
    const s = await Deno.stat(path);
    return (s.birthtime ?? s.mtime)?.getTime();
  } catch {
    return undefined;
  }
}

async function sitePackages(env: string): Promise<Package[]> {
  const out: Package[] = [];
  for (const lib of ["lib", "lib64"]) {
    for (const py of (await subdirs(`${env}/${lib}`)).filter((d) => /^(python|pypy)\d/.test(d))) {
      for (const d of await subdirs(`${env}/${lib}/${py}/site-packages`)) {
        const p = distInfo(d);
        if (p) out.push(p);
      }
    }
    if (out.length) break;
  }
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(p.name.toLowerCase()) && seen.add(p.name.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function venv(path: string, project?: string): Promise<Env | undefined> {
  const cfg = await read(`${path}/pyvenv.cfg`);
  if (cfg === undefined) return undefined;
  const env = venvFromCfg(path, cfg, DIRS);
  const python = await exists(`${path}/bin/python`);
  const [packages, when] = await Promise.all([sitePackages(path), created(`${path}/pyvenv.cfg`)]);
  return { ...env, project, broken: python === false, packages, created: when };
}

interface Project {
  path: string;
  pyproject?: string;
}

/** Projects one or two levels below the usual folders, and the virtualenvs inside them. */
async function scanProjects(): Promise<{ envs: Env[]; projects: Project[] }> {
  const envs: Env[] = [];
  const projects: Project[] = [];
  const visit = async (dir: string, depth: number) => {
    const names = await subdirs(dir);
    const own = await venv(dir);
    if (own) return void envs.push(own);
    const pyproject = await read(`${dir}/pyproject.toml`);
    const candidates = names.filter((n) => VENV_NAME.test(n));
    const found = (await Promise.all(candidates.map((n) => venv(`${dir}/${n}`, dir)))).filter((e): e is Env => !!e);
    envs.push(...found);
    if (pyproject !== undefined || found.length) projects.push({ path: dir, pyproject });
    const isProject = found.length || pyproject !== undefined || names.includes(".git");
    if (!isProject && depth < 2) {
      await Promise.all(names.filter((n) => !n.startsWith(".")).map((n) => visit(`${dir}/${n}`, depth + 1)));
    }
  };
  await Promise.all(FOLDERS.map(async (f) => {
    const root = `${HOME}/${f}`;
    await Promise.all((await subdirs(root)).filter((n) => !n.startsWith(".")).map((n) => visit(`${root}/${n}`, 1)));
  }));
  return { envs, projects };
}

async function poetry(projects: Project[]): Promise<Env[]> {
  const owners = new Map<string, string>();
  await Promise.all(projects.map(async (p) => {
    if (!p.pyproject || !isPoetryProject(p.pyproject)) return;
    const name = pyprojectName(p.pyproject);
    if (name) owners.set(await poetryEnvPrefix(name, p.path), p.path);
  }));
  const envs = await Promise.all((await subdirs(POETRY)).map(async (dir): Promise<Env | undefined> => {
    const parsed = parsePoetryDir(dir);
    const project = parsed ? owners.get(parsed.prefix) : undefined;
    const env = await venv(`${POETRY}/${dir}`, project);
    // Not matched to a project we can see: orphaned only if Poetry could never find it again.
    return env && { ...env, orphan: false };
  }));
  return envs.filter((e): e is Env => !!e);
}

async function pipenv(): Promise<Env[]> {
  const envs = await Promise.all((await subdirs(PIPENV)).map(async (dir): Promise<Env | undefined> => {
    const path = `${PIPENV}/${dir}`;
    const project = pipenvProject((await read(`${path}/.project`)) ?? "");
    const env = await venv(path, project);
    if (!env) return undefined;
    return { ...env, orphan: project ? (await exists(project)) === false : false };
  }));
  return envs.filter((e): e is Env => !!e);
}

/** `conda env list --json` from the first of conda, mamba, micromamba that answers. */
async function condaList(): Promise<string[]> {
  for (const program of ["conda", "mamba", "micromamba"]) {
    try {
      const { code, stdout } = await new Deno.Command(program, {
        args: ["env", "list", "--json"],
        stdin: "null",
        stdout: "piped",
        stderr: "null",
        signal: AbortSignal.timeout(10_000),
      }).output();
      if (code === 0) return parseCondaList(new TextDecoder().decode(stdout));
    } catch { /* not installed */ }
  }
  return [];
}

async function condaEnv(path: string): Promise<Env | undefined> {
  let files: string[];
  try {
    files = [];
    for await (const e of Deno.readDir(`${path}/conda-meta`)) {
      if (e.isFile && e.name.endsWith(".json")) files.push(e.name);
    }
  } catch {
    return undefined;
  }
  const { name, root } = condaName(path);
  return {
    path,
    kind: "conda",
    python: condaPython(files),
    name: root ? "base" : name,
    root,
    packages: condaPackages(files),
    created: await created(`${path}/conda-meta/history`),
  };
}

async function conda(): Promise<Env[]> {
  const txt = parseEnvironmentsTxt((await read(`${HOME}/.conda/environments.txt`)) ?? "");
  const fromRoots = (await Promise.all(CONDA_ROOTS.map(async (root) => [
    ...((await exists(`${root}/conda-meta`)) ? [root] : []),
    ...(await subdirs(`${root}/envs`)).map((d) => `${root}/envs/${d}`),
  ]))).flat();
  const paths = [...new Set([...(await condaList()), ...txt, ...fromRoots].map((p) => p.replace(/\/+$/, "")))];
  return (await Promise.all(paths.map(condaEnv))).filter((e): e is Env => !!e);
}

export async function findEnvs(): Promise<Env[]> {
  const scanned = await scanProjects();
  const [p, pe, c] = await Promise.all([poetry(scanned.projects), pipenv(), conda()]);
  return dedupe([...scanned.envs, ...p, ...pe, ...c]);
}

/** Sizes of many folders with one `du -sb`; what du could measure even if it hit errors. */
export async function sizes(paths: string[]): Promise<Map<string, number>> {
  if (!paths.length) return new Map();
  try {
    const { stdout } = await new Deno.Command("du", {
      args: ["-sb", "--", ...paths],
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(60_000),
    }).output();
    return parseDu(new TextDecoder().decode(stdout));
  } catch {
    return new Map();
  }
}

/** Removes a virtualenv's folder, or asks conda to remove an environment. */
export async function remove(e: Env): Promise<void> {
  if (e.kind === "conda") {
    for (const program of ["conda", "mamba", "micromamba"]) {
      try {
        const { code, stderr } = await new Deno.Command(program, {
          args: ["env", "remove", "--prefix", e.path, "--yes"],
          stdin: "null",
          stdout: "null",
          stderr: "piped",
        }).output();
        if (code === 0) return;
        throw new Error(`${program} couldn't remove ${basename(e.path)}: ${new TextDecoder().decode(stderr).trim()}`);
      } catch (err) {
        if (!(err instanceof Deno.errors.NotFound)) throw err;
      }
    }
    throw new Error("conda isn't installed: remove the environment's folder by hand");
  }
  if ((await exists(`${e.path}/pyvenv.cfg`)) !== true) {
    throw new Error(`${e.path} has no pyvenv.cfg: not removing it`);
  }
  try {
    await Deno.remove(e.path, { recursive: true });
  } catch (err) {
    if (err instanceof Deno.errors.NotCapable || err instanceof Deno.errors.PermissionDenied) {
      throw new Error(`Not allowed to delete ${e.path}: it is outside the folders this extension may change`);
    }
    throw err;
  }
}
