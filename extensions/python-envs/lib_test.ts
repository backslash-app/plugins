import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  activateLine,
  checkDeletable,
  cleanVersion,
  condaName,
  condaPackages,
  condaPython,
  dedupe,
  distInfo,
  type Env,
  envTitle,
  formatSize,
  isPoetryProject,
  parseCfg,
  parseCondaList,
  parseDu,
  parseEnvironmentsTxt,
  parsePoetryDir,
  poetryEnvPrefix,
  pyprojectName,
  sortEnvs,
  terminalScript,
  venvFromCfg,
} from "./lib.ts";

const HOME = "/home/ada";
const DIRS = { poetry: `${HOME}/.cache/pypoetry/virtualenvs`, pipenv: `${HOME}/.local/share/virtualenvs` };

// python3.12 -m venv .venv
const VENV_CFG = `home = /usr/bin
include-system-site-packages = false
version = 3.12.3
executable = /usr/bin/python3.12
command = /usr/bin/python3 -m venv /home/ada/Projects/api/.venv
`;

// uv venv (0.4)
const UV_CFG = `home = /home/ada/.local/share/uv/python/cpython-3.12.4-linux-x86_64-gnu/bin
implementation = CPython
uv = 0.4.18
version_info = 3.12.4
include-system-site-packages = false
prompt = shop
`;

// virtualenv 20.26, as Poetry makes them
const VIRTUALENV_CFG = `home = /home/ada/.pyenv/versions/3.11.9/bin
implementation = CPython
version_info = 3.11.9.final.0
virtualenv = 20.26.3
include-system-site-packages = false
base-prefix = /home/ada/.pyenv/versions/3.11.9
base-exec-prefix = /home/ada/.pyenv/versions/3.11.9
base-executable = /home/ada/.pyenv/versions/3.11.9/bin/python3.11
prompt = my-app-py3.11
`;

Deno.test("parseCfg reads key = value lines", () => {
  const cfg = parseCfg(VIRTUALENV_CFG);
  assertEquals(cfg.version_info, "3.11.9.final.0");
  assertEquals(cfg["include-system-site-packages"], "false");
  assertEquals(cfg.prompt, "my-app-py3.11");
});

Deno.test("cleanVersion", () => {
  assertEquals(cleanVersion("3.11.9.final.0"), "3.11.9");
  assertEquals(cleanVersion("3.13.0rc2"), "3.13.0rc2");
  assertEquals(cleanVersion("3.12"), "3.12");
  assertEquals(cleanVersion(undefined), "");
});

Deno.test("venvFromCfg tells venv, uv, virtualenv and Poetry apart", () => {
  const v = venvFromCfg(`${HOME}/Projects/api/.venv`, VENV_CFG, DIRS);
  assertEquals([v.kind, v.python, v.base, v.creator], ["venv", "3.12.3", "/usr/bin", undefined]);
  const u = venvFromCfg(`${HOME}/Projects/shop/.venv`, UV_CFG, DIRS);
  assertEquals([u.kind, u.python, u.creator, u.name], ["uv", "3.12.4", "uv 0.4.18", "shop"]);
  const p = venvFromCfg(`${DIRS.poetry}/my-app-kp9cFgg1-py3.11`, VIRTUALENV_CFG, DIRS);
  assertEquals([p.kind, p.python, p.creator], ["poetry", "3.11.9", "virtualenv 20.26.3"]);
  assertEquals(venvFromCfg(`${HOME}/x/env`, VIRTUALENV_CFG, DIRS).kind, "virtualenv");
  assertEquals(venvFromCfg(`${DIRS.pipenv}/web-AbCd1234`, VIRTUALENV_CFG, DIRS).kind, "pipenv");
});

const PYPROJECT_POETRY = `[tool.poetry]
name = "My App"  # display name
version = "0.1.0"

[tool.poetry.dependencies]
python = "^3.11"
name = "not this"
`;

const PYPROJECT_PEP621 = `[build-system]
requires = ["hatchling"]

[project]
name = "shop"
version = "1.0"
`;

Deno.test("pyprojectName and isPoetryProject", () => {
  assertEquals(pyprojectName(PYPROJECT_POETRY), "My App");
  assertEquals(pyprojectName(PYPROJECT_PEP621), "shop");
  assertEquals(pyprojectName("[tool.ruff]\nline-length = 100"), undefined);
  assert(isPoetryProject(PYPROJECT_POETRY));
  assert(!isPoetryProject(PYPROJECT_PEP621));
});

Deno.test("poetryEnvPrefix matches Poetry's generate_env_name", async () => {
  // Python: base64.urlsafe_b64encode(sha256(b"/home/ada/Projects/my-app")).decode()[:8]
  assertEquals(await poetryEnvPrefix("My App", "/home/ada/Projects/my-app"), "my_app-kp9cFgg1");
  assertEquals(parsePoetryDir("my_app-kp9cFgg1-py3.11"), { prefix: "my_app-kp9cFgg1", python: "3.11" });
  assertEquals(parsePoetryDir("random"), undefined);
});

Deno.test("conda: env list, environments.txt, versions and packages", () => {
  const out = JSON.stringify({ envs: ["/home/ada/miniconda3", "/home/ada/miniconda3/envs/ds", 3] });
  assertEquals(parseCondaList(out), ["/home/ada/miniconda3", "/home/ada/miniconda3/envs/ds"]);
  assertEquals(parseCondaList("conda: command not found"), []);
  assertEquals(parseEnvironmentsTxt("/home/ada/miniconda3\n/home/ada/miniconda3/envs/ds\n\n"), [
    "/home/ada/miniconda3",
    "/home/ada/miniconda3/envs/ds",
  ]);
  const meta = [
    "history",
    "numpy-1.26.4-py311h64a7726_0.json",
    "python-3.11.9-hb806964_0_cpython.json",
    "python_abi-3.11-4_cp311.json",
    "ca-certificates-2024.7.4-hbcca054_0.json",
  ];
  assertEquals(condaPython(meta.filter((f) => f.endsWith(".json"))), "3.11.9");
  assertEquals(condaPackages(meta).map((p) => `${p.name}=${p.version}`), [
    "ca-certificates=2024.7.4",
    "numpy=1.26.4",
    "python=3.11.9",
    "python_abi=3.11",
  ]);
  assertEquals(condaName("/home/ada/miniconda3/envs/ds"), { name: "ds", root: false });
  assertEquals(condaName("/home/ada/miniconda3"), { name: "base", root: true });
});

Deno.test("distInfo reads package folders", () => {
  assertEquals(distInfo("requests-2.32.3.dist-info"), { name: "requests", version: "2.32.3" });
  assertEquals(distInfo("typing_extensions-4.12.2.dist-info"), { name: "typing-extensions", version: "4.12.2" });
  assertEquals(distInfo("six-1.16.0-py3.11.egg-info"), { name: "six", version: "1.16.0" });
  assertEquals(distInfo("requests"), undefined);
  assertEquals(distInfo("__pycache__"), undefined);
});

Deno.test("parseDu and formatSize", () => {
  const sizes = parseDu("214958080\t/home/ada/Projects/api/.venv\n1048576\t/home/ada/my env\n");
  assertEquals(sizes.get("/home/ada/Projects/api/.venv"), 214958080);
  assertEquals(sizes.get("/home/ada/my env"), 1048576);
  assertEquals(formatSize(214958080), "205 MB");
  assertEquals(formatSize(1536), "1.5 KB");
  assertEquals(formatSize(3 * 1024 ** 3), "3.0 GB");
  assertEquals(formatSize(undefined), "");
});

const api: Env = {
  path: `${HOME}/Projects/api/.venv`,
  kind: "venv",
  python: "3.12.3",
  project: `${HOME}/Projects/api`,
};
const ds: Env = { path: `${HOME}/miniconda3/envs/ds`, kind: "conda", python: "3.11.9", name: "ds" };
const base: Env = { path: `${HOME}/miniconda3`, kind: "conda", python: "3.12.1", name: "base", root: true };

Deno.test("envTitle and sortEnvs", () => {
  assertEquals(envTitle(api), "api");
  assertEquals(envTitle(ds), "ds");
  assertEquals(envTitle({ path: `${DIRS.poetry}/my_app-kp9cFgg1-py3.11`, kind: "poetry", python: "" }), "my_app");
  assertEquals(envTitle({ path: `${DIRS.pipenv}/web-AbCd1234`, kind: "pipenv", python: "" }), "web");
  const broken = { ...api, path: `${HOME}/Projects/zed/.venv`, project: `${HOME}/Projects/zed`, broken: true };
  assertEquals(sortEnvs([ds, api, broken]).map(envTitle), ["zed", "api", "ds"]);
});

Deno.test("dedupe keeps the first description of a folder", () => {
  assertEquals(dedupe([api, { ...api, path: `${api.path}/`, kind: "uv" }, ds]).map((e) => e.kind), ["venv", "conda"]);
});

Deno.test("activateLine and terminalScript", () => {
  assertEquals(activateLine(api), "source /home/ada/Projects/api/.venv/bin/activate");
  assertEquals(activateLine(ds), "conda activate ds");
  assertEquals(activateLine(base), "conda activate base");
  assertEquals(
    activateLine({ ...api, path: "/home/ada/my env/.venv" }),
    "source '/home/ada/my env/.venv/bin/activate'",
  );
  const script = terminalScript(api);
  assert(script.startsWith("cd /home/ada/Projects/api"));
  assert(script.includes(". /home/ada/Projects/api/.venv/bin/activate"));
  assert(script.endsWith('exec "${SHELL:-bash}"'));
  assert(terminalScript(ds).includes("conda activate /home/ada/miniconda3/envs/ds"));
  assert(terminalScript(api, "exec python").endsWith("exec python"));
});

Deno.test("checkDeletable refuses the base env, the home and projects", () => {
  checkDeletable(api, HOME);
  checkDeletable(ds, HOME);
  assertThrows(() => checkDeletable(base, HOME));
  assertThrows(() => checkDeletable({ ...api, path: HOME }, HOME));
  assertThrows(() => checkDeletable({ ...api, path: "/home/ada/Projects" }, HOME));
  assertThrows(() => checkDeletable({ ...api, path: `${HOME}/Projects/api` }, HOME));
});

Deno.test("the manifest reads and writes the folders the code uses", async () => {
  const { FOLDERS, POETRY, PIPENV } = await import("./envs.ts");
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { read: string[]; write: string[] };
  };
  const home = Deno.env.get("HOME") ?? "";
  const folders = [...FOLDERS.map((f) => `~/${f}`), POETRY, PIPENV].map((p) => p.replace(home, "~"));
  assertEquals(manifest.permissions.write, folders);
  for (const f of folders) assert(manifest.permissions.read.includes(f), f);
});
