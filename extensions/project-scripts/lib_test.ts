import { assertEquals } from "@std/assert";
import {
  cargoTasks,
  composerScripts,
  denoTasks,
  jetbrainsRecents,
  jsManager,
  justDump,
  justfileRecipes,
  justSummary,
  makeTargets,
  merge,
  packageScripts,
  parseJsonc,
  pyprojectTasks,
  shellArgv,
  taskfileTasks,
  taskList,
  terminalScript,
  tilde,
  vscodeRecents,
} from "./lib.ts";
import { shellLine, terminalArgs } from "./terminal.ts";

const brief = (tasks: { name: string; command: string; description?: string }[]) =>
  tasks.map((t) => [t.name, t.command, t.description ?? ""]);

Deno.test("recent projects", () => {
  const json = JSON.stringify({
    entries: [
      { folderUri: "file:///home/ada/code/my%20app" },
      { fileUri: "file:///home/ada/notes.md" },
      { folderUri: "vscode-remote://ssh-remote+box/srv/app" },
      { folderUri: "file:///home/ada/code/api/" },
    ],
  });
  const recents = vscodeRecents(json, "VS Code", 1_000_000_000);
  assertEquals(recents.map((r) => r.path), ["/home/ada/code/my app", "/home/ada/code/api"]);
  const xml = `<component name="RecentProjectsManager"><option name="additionalInfo"><map>
    <entry key="$USER_HOME$/code/api"><value><RecentProjectMetaInfo>
      <option name="projectOpenTimestamp" value="2000000000000" /></RecentProjectMetaInfo></value></entry>
  </map></option></component>`;
  const merged = merge([...recents, ...jetbrainsRecents(xml, "/home/ada", "GoLand")]);
  assertEquals(merged.map((r) => [r.path, r.editor]), [["/home/ada/code/api", "GoLand"], [
    "/home/ada/code/my app",
    "VS Code",
  ]]);
});

Deno.test("package.json scripts and the package manager", () => {
  const pkg = JSON.stringify({ scripts: { dev: "vite", build: "tsc && vite build", "test:unit": "vitest" } });
  assertEquals(brief(packageScripts(pkg, ["package.json", "pnpm-lock.yaml"])), [
    ["dev", "pnpm run dev", ""],
    ["build", "pnpm run build", ""],
    ["test:unit", "pnpm run test:unit", ""],
  ]);
  assertEquals(packageScripts(pkg, [])[1].script, "tsc && vite build");
  assertEquals(jsManager({}, ["yarn.lock"]), "yarn");
  assertEquals(jsManager({}, ["bun.lockb"]), "bun");
  assertEquals(jsManager({}, ["package-lock.json"]), "npm");
  assertEquals(jsManager({ packageManager: "yarn@4.5.0" }, ["package-lock.json"]), "yarn");
});

Deno.test("Makefile targets", () => {
  const make = [
    ".PHONY: all test lint docs/build",
    "VERSION := 1.2",
    "CC ?= gcc",
    "",
    "## Build everything",
    "all: build",
    "",
    "build: main.o ## Compile the binary",
    "\t$(CC) -o app main.o",
    "",
    "main.o: main.c",
    "\t$(CC) -c main.c",
    "",
    "%.o: %.c",
    "test lint:",
    "\t./run $@",
    "docs/build:",
    "\tmkdocs build",
    "install: export PREFIX=/usr",
    "clean:",
    "\trm -f *.o",
  ].join("\n");
  assertEquals(brief(makeTargets(make)), [
    ["all", "make all", "Build everything"],
    ["build", "make build", "Compile the binary"],
    ["test", "make test", ""],
    ["lint", "make lint", ""],
    ["docs/build", "make docs/build", ""],
    ["clean", "make clean", ""],
  ]);
  assertEquals(makeTargets("dev:\n\tgo run .", "GNUmakefile")[0].command, "make dev");
});

Deno.test("just recipes", () => {
  const dump = JSON.stringify({
    recipes: {
      build: { name: "build", doc: "Build the app", parameters: [], private: false, attributes: [] },
      deploy: {
        name: "deploy",
        doc: null,
        parameters: [{ name: "env", default: null, kind: "singular" }, { name: "tag", default: "latest" }],
        private: false,
        attributes: [],
      },
      _helper: { name: "_helper", doc: null, parameters: [], private: true, attributes: [] },
    },
  });
  assertEquals(brief(justDump(dump)), [["build", "just build", "Build the app"], ["deploy", "just deploy <env>", ""]]);
  assertEquals(brief(justSummary("build deploy test\n")).map((t) => t[1]), ["just build", "just deploy", "just test"]);
  const file = [
    "set dotenv-load",
    "version := `git describe`",
    "",
    "# Run the dev server",
    "dev port='8080':",
    "  deno run -A main.ts {{port}}",
    "",
    "@release tag +notes:",
    "  gh release create {{tag}}",
    "alias r := release",
    "_private:",
    "  echo",
  ].join("\n");
  assertEquals(brief(justfileRecipes(file)), [
    ["dev", "just dev", "Run the dev server"],
    ["release", "just release <tag> <notes>", ""],
  ]);
});

Deno.test("Taskfile tasks", () => {
  const json = JSON.stringify({
    tasks: [
      { name: "build", task: "build", desc: "Build the binary", summary: "", aliases: ["b"] },
      { name: "docs:serve", task: "docs:serve", desc: "", summary: "Serve the docs\nlocally" },
    ],
  });
  assertEquals(brief(taskList(json)), [["build", "task build", "Build the binary"], [
    "docs:serve",
    "task docs:serve",
    "Serve the docs",
  ]]);
  const yaml = [
    "version: '3'",
    "",
    "vars:",
    "  NAME: app",
    "",
    "tasks:",
    "  build:",
    "    desc: Build the binary",
    "    cmds:",
    "      - go build ./...",
    "  'docs:serve':",
    "    cmds: [mkdocs serve]",
    "  _internal:",
    "    cmds: [echo]",
    "",
    "includes:",
    "  other: ./other",
  ].join("\n");
  assertEquals(brief(taskfileTasks(yaml)), [["build", "task build", "Build the binary"], [
    "docs:serve",
    "task docs:serve",
    "",
  ]]);
});

Deno.test("Cargo, deno, composer", () => {
  const pkg = '[package]\nname = "app"\nversion = "0.1.0"\n';
  assertEquals(cargoTasks(pkg, true).map((t) => t.name), ["build", "run", "test", "check", "clippy", "release"]);
  assertEquals(cargoTasks('[workspace]\nmembers = ["a"]\n', false).map((t) => t.command).slice(0, 2), [
    "cargo build",
    "cargo test --workspace",
  ]);
  const deno = `{
    // Tasks
    "tasks": {
      "dev": "deno run -A --watch main.ts",
      "check": { "command": "deno check **/*.ts", "description": "Type-check, // not a comment" },
    },
  }`;
  assertEquals(parseJsonc('{"a": "http://x", /* c */ "b": [1,],}'), { a: "http://x", b: [1] });
  assertEquals(brief(denoTasks(deno, "deno.jsonc")), [
    ["dev", "deno task dev", ""],
    ["check", "deno task check", "Type-check, // not a comment"],
  ]);
  const composer = JSON.stringify({
    scripts: { test: "phpunit", lint: ["phpcs", "phpstan"], "post-install-cmd": "x", "post-autoload-dump": "y" },
    "scripts-descriptions": { test: "Run PHPUnit" },
  });
  assertEquals(brief(composerScripts(composer)), [
    ["test", "composer run-script test", "Run PHPUnit"],
    ["lint", "composer run-script lint", ""],
  ]);
  assertEquals(composerScripts(composer)[1].script, "phpcs && phpstan");
});

Deno.test("pyproject scripts and task runners", () => {
  const toml = [
    "[project]",
    'name = "app"',
    "",
    "[project.scripts]",
    'app = "app.cli:main"',
    "",
    "[tool.poe.tasks]",
    'test = "pytest -q"',
    'lint = { cmd = "ruff check .", help = "Lint the code" }',
    "",
    "[tool.poe.tasks.serve]",
    'cmd = "uvicorn app:api --reload"',
    'help = "Dev server"',
    "",
    "[tool.hatch.envs.docs.scripts]",
    'build = "mkdocs build"',
    "",
    "[tool.pdm.scripts]",
    'start = "flask run"',
    '_ = { env_file = ".env" }',
    "",
    "[tool.taskipy.tasks]",
    'fmt = "black ."',
  ].join("\n");
  assertEquals(brief(pyprojectTasks(toml, ["pyproject.toml", "uv.lock"])), [
    ["app", "uv run app", ""],
    ["start", "pdm run start", ""],
    ["test", "uv run poe test", ""],
    ["lint", "uv run poe lint", "Lint the code"],
    ["serve", "uv run poe serve", "Dev server"],
    ["docs:build", "hatch run docs:build", ""],
    ["fmt", "uv run task fmt", ""],
  ]);
  const tasks = pyprojectTasks(toml, []);
  assertEquals(tasks[0].command, "app");
  assertEquals(tasks.find((t) => t.name === "lint")?.script, "ruff check .");
  assertEquals(tasks.find((t) => t.name === "serve")?.script, "uvicorn app:api --reload");
});

Deno.test("running in a terminal", () => {
  const script = terminalScript("/home/ada/code/my app", "pnpm run dev");
  assertEquals(script.split("\n").slice(0, 3), [
    "cd '/home/ada/code/my app' || exit",
    "printf '\\033[2m$ %s\\033[0m\\n' 'pnpm run dev'",
    "pnpm run dev",
  ]);
  assertEquals(terminalScript("/p", "just deploy <env> <tag>").split("\n").slice(1, 4), [
    "printf '\\033[1m%s:\\033[0m ' env; read -r arg1",
    "printf '\\033[1m%s:\\033[0m ' tag; read -r arg2",
    "printf '\\033[2m$ %s\\033[0m\\n' 'just deploy <env> <tag>'",
  ]);
  assertEquals(terminalScript("/p", "just deploy <env> <tag>").split("\n")[4], 'just deploy "$arg1" "$arg2"');
  assertEquals(shellArgv("/usr/bin/zsh", "x"), ["/usr/bin/zsh", "-ic", "x"]);
  assertEquals(shellArgv("/usr/bin/fish", "x"), ["sh", "-c", "x"]);
  assertEquals(shellArgv(undefined, "x"), ["sh", "-c", "x"]);
  assertEquals(terminalArgs("gnome-terminal", ["sh", "-c", "x"]), ["--", "sh", "-c", "x"]);
  assertEquals(shellLine(["make", "my target"]), "make 'my target'");
  assertEquals([tilde("/home/ada/code", "/home/ada"), tilde("/home/adam", "/home/ada")], ["~/code", "/home/adam"]);
});
