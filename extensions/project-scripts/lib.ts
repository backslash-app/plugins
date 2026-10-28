// Finding runnable tasks in a project: parsers for each task runner's file. Pure, tested in lib_test.ts.

// --- Recent projects (same parsing as the Code Projects extension) -------------------

export interface Recent {
  path: string;
  /** Unix ms, 0 when unknown. */
  opened: number;
  editor: string;
}

/** `file:///home/me/my%20app` → `/home/me/my app`; other schemes (remote) are skipped. */
export function fileUri(uri: string): string | undefined {
  if (!uri.startsWith("file://")) return undefined;
  return decodeURIComponent(uri.slice(7)).replace(/\/$/, "");
}

/** VS Code's `history.recentlyOpenedPathsList` value. Newest first. */
export function vscodeRecents(json: string, editor: string, now = Date.now()): Recent[] {
  const entries = (JSON.parse(json)?.entries ?? []) as { folderUri?: string }[];
  return entries.flatMap((e, i) => {
    const path = fileUri(e.folderUri ?? "");
    // No timestamps: keep VS Code's order, just after "now".
    return path ? [{ path, opened: now - i * 60_000, editor }] : [];
  });
}

const JETBRAINS: [RegExp, string][] = [
  [/^IntelliJIdea|^IdeaIC/, "IntelliJ IDEA"],
  [/^PyCharm/, "PyCharm"],
  [/^WebStorm/, "WebStorm"],
  [/^GoLand/, "GoLand"],
  [/^CLion/, "CLion"],
  [/^RustRover/, "RustRover"],
  [/^PhpStorm/, "PhpStorm"],
  [/^Rider/, "Rider"],
  [/^RubyMine/, "RubyMine"],
];

/** `PyCharm2025.2` → `PyCharm`. */
export const jetbrainsProduct = (dir: string) => JETBRAINS.find(([re]) => re.test(dir))?.[1];

/** `options/recentProjects.xml` of a JetBrains IDE. */
export function jetbrainsRecents(xml: string, home: string, editor: string): Recent[] {
  const out: Recent[] = [];
  for (const m of xml.matchAll(/<entry key="([^"]+)">([\s\S]*?)<\/entry>/g)) {
    const ts = m[2].match(/name="projectOpenTimestamp" value="(\d+)"/);
    out.push({ path: m[1].replace("$USER_HOME$", home), opened: ts ? Number(ts[1]) : 0, editor });
  }
  return out;
}

/** Absolute paths stored by Zed (text or binary columns, depending on its version). */
export function zedPaths(value: unknown): string[] {
  const text = value instanceof Uint8Array ? new TextDecoder().decode(value) : String(value ?? "");
  return [...text.matchAll(/\/[^\p{Cc}"[\]]+/gu)].map((m) => m[0].replace(/\/$/, ""));
}

/** The newest entry per path, newest first. */
export function merge(recents: Recent[]): Recent[] {
  const byPath = new Map<string, Recent>();
  for (const r of recents) {
    const seen = byPath.get(r.path);
    if (!seen || r.opened > seen.opened) byPath.set(r.path, r);
  }
  return [...byPath.values()].sort((a, b) => b.opened - a.opened);
}

// --- Tasks ----------------------------------------------------------------------------

export type Runner =
  | "npm"
  | "pnpm"
  | "yarn"
  | "bun"
  | "make"
  | "just"
  | "task"
  | "cargo"
  | "deno"
  | "composer"
  | "python";

export interface Task {
  runner: Runner;
  name: string;
  /** The command line to type in the project folder. */
  command: string;
  /** What the task runs, when the file says it (a package.json script's text). */
  script?: string;
  description?: string;
  /** The file defining it, relative to the project. */
  file: string;
  /** For Python: the tool behind it (uv, poetry, poe…). */
  tool?: string;
}

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

// --- package.json ---------------------------------------------------------------------

export type JsManager = "npm" | "pnpm" | "yarn" | "bun";

/** From `packageManager` ("pnpm@9.1.0"), else the lock file present. */
export function jsManager(pkg: { packageManager?: string }, files: string[]): JsManager {
  const declared = /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager ?? "")?.[1] as JsManager | undefined;
  if (declared) return declared;
  if (files.includes("pnpm-lock.yaml")) return "pnpm";
  if (files.includes("bun.lock") || files.includes("bun.lockb")) return "bun";
  if (files.includes("yarn.lock")) return "yarn";
  return "npm";
}

export function packageScripts(text: string, files: string[]): Task[] {
  const pkg = JSON.parse(text) as { scripts?: Record<string, string>; packageManager?: string };
  const pm = jsManager(pkg, files);
  return Object.entries(pkg.scripts ?? {})
    .filter(([, script]) => typeof script === "string")
    .map(([name, script]) => ({
      runner: pm,
      name,
      command: `${pm} run ${quote(name)}`,
      script,
      file: "package.json",
    }));
}

// --- Makefile -------------------------------------------------------------------------

/** Targets of a Makefile, with `## help` comments (same line or the line above). */
export function makeTargets(text: string, file = "Makefile"): Task[] {
  const lines = text.replace(/\\\n/g, " ").split("\n");
  const phony = new Set(
    lines.filter((l) => /^\.PHONY\s*:/.test(l)).flatMap((l) => l.replace(/^\.PHONY\s*:/, "").trim().split(/\s+/)),
  );
  const out: Task[] = [];
  const seen = new Set<string>();
  lines.forEach((line, i) => {
    const m = /^([A-Za-z0-9_][A-Za-z0-9_./ -]*?)\s*:(?![=:])([^=]*?)(?:##\s*(.*))?$/.exec(line);
    if (!m || /^\s/.test(line)) return;
    const above = /^##?\s*(.+)$/.exec(lines[i - 1] ?? "")?.[1];
    for (const name of m[1].trim().split(/\s+/)) {
      if (seen.has(name) || name.includes("%") || name.includes("$")) continue;
      // Files the Makefile builds (main.o, build/app) aren't tasks, unless declared phony.
      if (!phony.has(name) && /[/.]/.test(name)) continue;
      seen.add(name);
      out.push({
        runner: "make",
        name,
        command: file === "Makefile" || file === "makefile" || file === "GNUmakefile"
          ? `make ${name}`
          : `make -f ${quote(file)} ${name}`,
        description: (m[3] ?? above)?.trim() || undefined,
        file,
      });
    }
  });
  return out;
}

// --- justfile -------------------------------------------------------------------------

interface JustRecipe {
  name: string;
  doc?: string | null;
  private?: boolean;
  parameters?: { name: string; default?: unknown; kind?: string }[];
  attributes?: unknown[];
}

const justCommand = (name: string, params: string[]) =>
  `just ${name}${params.length ? ` ${params.map((p) => `<${p}>`).join(" ")}` : ""}`;

/** `just --dump --dump-format json`. */
export function justDump(json: string, file = "justfile"): Task[] {
  const dump = JSON.parse(json) as { recipes?: Record<string, JustRecipe> };
  return Object.values(dump.recipes ?? {})
    .filter((r) => !r.private && !r.name.startsWith("_") && !(r.attributes ?? []).includes("private"))
    .map((r) => {
      // Required parameters must be typed: shown as <name> to fill in.
      const required = (r.parameters ?? []).filter((p) => p.default === null || p.default === undefined)
        .map((p) => p.name);
      return {
        runner: "just" as const,
        name: r.name,
        command: justCommand(r.name, required),
        description: r.doc || undefined,
        file,
      };
    });
}

/** `just --summary`: names separated by spaces. */
export function justSummary(out: string, file = "justfile"): Task[] {
  return out.split(/\s+/).filter(Boolean).map((name) => ({
    runner: "just" as const,
    name,
    command: `just ${name}`,
    file,
  }));
}

/** Without `just` installed: recipes read from the file (`# doc` above them). */
export function justfileRecipes(text: string, file = "justfile"): Task[] {
  const lines = text.split("\n");
  const out: Task[] = [];
  lines.forEach((line, i) => {
    if (/^\s|^#|^(set|alias|export|import|mod)\b|:=/.test(line)) return;
    const m = /^@?([A-Za-z][\w-]*)((?:\s+[+*$]?[\w-]+(?:=(?:'[^']*'|"[^"]*"|\S+))?)*)\s*:(?!=)/.exec(line);
    if (!m) return;
    const params = m[2].trim().split(/\s+/).filter(Boolean).filter((p) => !p.includes("=")).map((p) =>
      p.replace(/^[+*$]/, "")
    );
    const doc = /^#\s*(.+)$/.exec(lines[i - 1] ?? "")?.[1];
    out.push({ runner: "just", name: m[1], command: justCommand(m[1], params), description: doc, file });
  });
  return out;
}

// --- Taskfile -------------------------------------------------------------------------

/** `task --list-all --json`. */
export function taskList(json: string, file = "Taskfile.yml"): Task[] {
  const data = JSON.parse(json) as { tasks?: { name: string; desc?: string; summary?: string; aliases?: string[] }[] };
  return (data.tasks ?? []).map((t) => ({
    runner: "task" as const,
    name: t.name,
    command: `task ${t.name}`,
    description: t.desc || t.summary?.split("\n")[0] || undefined,
    file,
  }));
}

/** Without `task` installed: the keys under `tasks:`, with their `desc:`. */
export function taskfileTasks(text: string, file = "Taskfile.yml"): Task[] {
  const out: Task[] = [];
  let inTasks = false;
  let indent = -1;
  let current: Task | undefined;
  for (const line of text.split("\n")) {
    if (/^tasks:\s*$/.test(line)) {
      inTasks = true;
      continue;
    }
    if (!inTasks || !line.trim() || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) break;
    const lead = line.length - line.trimStart().length;
    const key = /^\s*(['"]?)([\w:.-]+)\1:\s*(.*)$/.exec(line);
    if (indent < 0 && key) indent = lead;
    if (key && lead === indent) {
      current = { runner: "task", name: key[2], command: `task ${key[2]}`, file };
      out.push(current);
    } else if (key && current && key[2] === "desc" && lead > indent) {
      current.description = key[3].replace(/^['"]|['"]$/g, "") || undefined;
    }
  }
  return out.filter((t) => !t.name.startsWith("_"));
}

// --- Cargo ----------------------------------------------------------------------------

/** The usual cargo commands; `run` only for a package with a binary. */
export function cargoTasks(toml: string, hasMain: boolean): Task[] {
  const isPackage = /^\[package\]/m.test(toml);
  const bins = /^\[\[bin\]\]/m.test(toml);
  const workspace = /^\[workspace\]/m.test(toml);
  const base: [string, string, string][] = [
    ["build", "cargo build", "Compile the package"],
    ...(isPackage && (hasMain || bins)
      ? [["run", "cargo run", "Build and run the binary"] as [string, string, string]]
      : []),
    ["test", workspace ? "cargo test --workspace" : "cargo test", "Run the tests"],
    ["check", "cargo check", "Check for errors without building"],
    ["clippy", "cargo clippy", "Lint with Clippy"],
    ["release", "cargo build --release", "Optimized build"],
  ];
  return base.map(([name, command, description]) => ({
    runner: "cargo",
    name,
    command,
    description,
    file: "Cargo.toml",
  }));
}

// --- deno.json ------------------------------------------------------------------------

/** JSON with comments and trailing commas (deno.jsonc, VS Code style). */
export function parseJsonc(text: string): unknown {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      out += text.slice(start, i + 1);
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2);
      if (i < 0) break;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

export function denoTasks(text: string, file = "deno.json"): Task[] {
  const json = parseJsonc(text) as { tasks?: Record<string, string | { command?: string; description?: string }> };
  return Object.entries(json.tasks ?? {}).map(([name, t]) => ({
    runner: "deno" as const,
    name,
    command: `deno task ${quote(name)}`,
    script: typeof t === "string" ? t : t.command,
    description: typeof t === "string" ? undefined : t.description,
    file,
  }));
}

// --- composer.json --------------------------------------------------------------------

export function composerScripts(text: string): Task[] {
  const json = JSON.parse(text) as {
    scripts?: Record<string, string | string[]>;
    "scripts-descriptions"?: Record<string, string>;
  };
  return Object.entries(json.scripts ?? {})
    // pre-install-cmd, post-autoload-dump…: Composer runs those itself.
    .filter(([name]) => !/^(pre|post)-[a-z-]+(-cmd|-dump)?$/.test(name))
    .map(([name, script]) => ({
      runner: "composer" as const,
      name,
      command: `composer run-script ${quote(name)}`,
      script: Array.isArray(script) ? script.join(" && ") : script,
      description: json["scripts-descriptions"]?.[name],
      file: "composer.json",
    }));
}

// --- pyproject.toml -------------------------------------------------------------------

/** Just enough TOML: `[table]` → `key = value` with values as raw text. */
export function tomlTables(text: string): Map<string, [string, string][]> {
  const tables = new Map<string, [string, string][]>();
  let current = "";
  tables.set(current, []);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;
    const header = /^\[\s*([^\][]+?)\s*\]$/.exec(line);
    if (header) {
      current = header[1].replace(/["']/g, "");
      if (!tables.has(current)) tables.set(current, []);
      continue;
    }
    const kv = /^("[^"]+"|'[^']+'|[\w.-]+)\s*=\s*(.*)$/.exec(line);
    if (!kv) continue;
    let value = kv[2];
    // Multi-line strings and arrays: read until they close.
    const open = (v: string) =>
      (v.startsWith('"""') && (v.match(/"""/g) ?? []).length < 2) ||
      (v.startsWith("'''") && (v.match(/'''/g) ?? []).length < 2) ||
      (v.startsWith("[") && depth(v) > 0);
    while (open(value) && i + 1 < lines.length) value += `\n${lines[++i]}`;
    tables.get(current)!.push([kv[1].replace(/^["']|["']$/g, ""), value.trim()]);
  }
  return tables;
}

function depth(v: string): number {
  let d = 0;
  for (const c of v.replace(/"[^"]*"|'[^']*'/g, "")) d += c === "[" ? 1 : c === "]" ? -1 : 0;
  return d;
}

/** A TOML string, or the `cmd`/`shell`/`help` of an inline table. */
function tomlValue(raw: string): { text?: string; help?: string } {
  const str = /^"((?:[^"\\]|\\.)*)"|^'([^']*)'/.exec(raw);
  if (str) return { text: str[1]?.replace(/\\"/g, '"') ?? str[2] };
  if (raw.startsWith("{")) {
    const field = (k: string) => new RegExp(`\\b${k}\\s*=\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|'([^']*)')`).exec(raw);
    const cmd = field("cmd") ?? field("shell") ?? field("script") ?? field("call") ?? field("ref");
    const help = field("help");
    return { text: cmd ? cmd[1] ?? cmd[2] : undefined, help: help ? help[1] ?? help[2] : undefined };
  }
  if (raw.startsWith("[")) {
    const items = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'/g)].map((m) => m[1] ?? m[2]);
    return { text: items.join(" && ") };
  }
  return {};
}

/** Script entry points and task runners of a Python project. */
export function pyprojectTasks(text: string, files: string[]): Task[] {
  const tables = tomlTables(text);
  const env = files.includes("uv.lock")
    ? "uv run "
    : files.includes("poetry.lock")
    ? "poetry run "
    : files.includes("pdm.lock")
    ? "pdm run "
    : "";
  const tool = env.split(" ")[0] || undefined;
  const out: Task[] = [];
  const add = (name: string, command: string, raw: string, t: string | undefined, help?: string) => {
    if (out.some((o) => o.name === name)) return;
    const v = tomlValue(raw);
    out.push({
      runner: "python",
      name,
      command,
      script: v.text,
      description: help ?? v.help,
      file: "pyproject.toml",
      tool: t,
    });
  };
  for (const [name, raw] of tables.get("project.scripts") ?? []) add(name, `${env}${name}`, raw, tool);
  for (const [name, raw] of tables.get("tool.poetry.scripts") ?? []) add(name, `poetry run ${name}`, raw, "poetry");
  for (const [name, raw] of tables.get("tool.pdm.scripts") ?? []) {
    if (name !== "_") add(name, `pdm run ${name}`, raw, "pdm");
  }
  for (const [name, raw] of tables.get("tool.rye.scripts") ?? []) add(name, `rye run ${name}`, raw, "rye");
  for (const [name, raw] of tables.get("tool.poe.tasks") ?? []) add(name, `${env}poe ${name}`, raw, "poe");
  for (const [table, rows] of tables) {
    const poe = /^tool\.poe\.tasks\.([\w-]+)$/.exec(table);
    if (poe) {
      const row = (k: string) => rows.find(([key]) => key === k)?.[1];
      const cmd = row("cmd") ?? row("shell") ?? row("script") ?? row("sequence") ?? "";
      const help = row("help");
      add(poe[1], `${env}poe ${poe[1]}`, cmd, "poe", help ? tomlValue(help).text : undefined);
    }
    const hatch = /^tool\.hatch\.envs\.([\w-]+)\.scripts$/.exec(table);
    if (hatch) {
      for (const [name, raw] of rows) {
        add(
          hatch[1] === "default" ? name : `${hatch[1]}:${name}`,
          `hatch run ${hatch[1] === "default" ? name : `${hatch[1]}:${name}`}`,
          raw,
          "hatch",
        );
      }
    }
  }
  for (const [name, raw] of tables.get("tool.taskipy.tasks") ?? []) {
    add(name, `${env}task ${name}`, raw, "taskipy");
  }
  return out;
}

// --- Running --------------------------------------------------------------------------

/**
 * A shell script for the terminal: run in the project, then say how it went and
 * wait, so the window doesn't vanish with the output.
 */
export function terminalScript(dir: string, command: string): string {
  // `just deploy <env>`: ask for each argument first.
  const asks: string[] = [];
  let n = 0;
  const line = command.replace(/<([\w-]+)>/g, (_, name: string) => {
    n++;
    asks.push(`printf '\\033[1m%s:\\033[0m ' ${quote(name)}; read -r arg${n}`);
    return `"$arg${n}"`;
  });
  return [
    `cd ${quote(dir)} || exit`,
    ...asks,
    `printf '\\033[2m$ %s\\033[0m\\n' ${quote(command)}`,
    line,
    "code=$?",
    `if [ "$code" = 0 ]; then printf '\\n\\033[32mDone.\\033[0m '; else printf '\\n\\033[31mExited with %s.\\033[0m ' "$code"; fi`,
    "printf 'Press Enter to close…'; read -r _",
  ].join("\n");
}

/** The shell running the script: the user's bash or zsh (their PATH, nvm…), else sh. */
export function shellArgv(shell: string | undefined, script: string): string[] {
  const name = (shell ?? "").split("/").pop() ?? "";
  return ["bash", "zsh"].includes(name) ? [shell!, "-ic", script] : ["sh", "-c", script];
}

/** `/home/me/code/app` → `~/code/app`. */
export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

/** Files that make a folder a project with tasks. */
export const TASK_FILES = [
  "package.json",
  "Makefile",
  "makefile",
  "GNUmakefile",
  "justfile",
  "Justfile",
  ".justfile",
  "Taskfile.yml",
  "Taskfile.yaml",
  "taskfile.yml",
  "taskfile.yaml",
  "Cargo.toml",
  "deno.json",
  "deno.jsonc",
  "composer.json",
  "pyproject.toml",
];
