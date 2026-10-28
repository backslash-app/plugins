// Where projects are (editors' recent lists, git folders) and the tasks they define.

import { DatabaseSync } from "node:sqlite";
import { exec } from "@backslash/api";
import {
  cargoTasks,
  composerScripts,
  denoTasks,
  jetbrainsProduct,
  jetbrainsRecents,
  justDump,
  justfileRecipes,
  justSummary,
  makeTargets,
  merge,
  packageScripts,
  pyprojectTasks,
  type Recent,
  type Task,
  TASK_FILES,
  taskfileTasks,
  taskList,
  vscodeRecents,
  zedPaths,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
const TMP = "/tmp/backslash-project-scripts";

const VSCODES: [string, string][] = [
  [".config/Code", "VS Code"],
  [".var/app/com.visualstudio.code/config/Code", "VS Code"],
  [".config/Code - OSS", "Code - OSS"],
  [".config/VSCodium", "VSCodium"],
  [".var/app/com.vscodium.codium/config/VSCodium", "VSCodium"],
  [".config/Cursor", "Cursor"],
  [".config/Windsurf", "Windsurf"],
];

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

const isDir = (path: string) => {
  try {
    return Deno.statSync(path).isDirectory;
  } catch {
    return false;
  }
};

function dirs(path: string): string[] {
  try {
    return [...Deno.readDirSync(path)].filter((e) => e.isDirectory && !e.name.startsWith(".")).map((e) =>
      `${path}/${e.name}`
    );
  } catch {
    return [];
  }
}

/** A readable copy of a database the editor may hold open. */
function openDb(path: string): DatabaseSync | undefined {
  try {
    Deno.statSync(path);
    Deno.mkdirSync(TMP, { recursive: true });
    const copy = `${TMP}/${path.replace(/[^a-zA-Z0-9]/g, "_").slice(-100)}`;
    Deno.copyFileSync(path, copy);
    try {
      Deno.copyFileSync(`${path}-wal`, `${copy}-wal`);
    } catch { /* no write-ahead log */ }
    return new DatabaseSync(copy);
  } catch {
    return undefined;
  }
}

function vscode(): Recent[] {
  return VSCODES.flatMap(([dir, editor]) => {
    const db = openDb(`${HOME}/${dir}/User/globalStorage/state.vscdb`);
    if (!db) return [];
    try {
      const row = db.prepare("SELECT value FROM ItemTable WHERE key = 'history.recentlyOpenedPathsList'").get() as
        | { value: string }
        | undefined;
      return row ? vscodeRecents(String(row.value), editor) : [];
    } catch {
      return [];
    } finally {
      db.close();
    }
  });
}

function jetbrains(): Recent[] {
  return dirs(`${HOME}/.config/JetBrains`).flatMap((dir) => {
    const product = jetbrainsProduct(dir.split("/").pop()!);
    if (!product) return [];
    try {
      return jetbrainsRecents(Deno.readTextFileSync(`${dir}/options/recentProjects.xml`), HOME, product);
    } catch {
      return [];
    }
  });
}

function zed(): Recent[] {
  return dirs(`${HOME}/.local/share/zed/db`).flatMap((dir) => {
    const db = openDb(`${dir}/db.sqlite`);
    if (!db) return [];
    try {
      const rows = db.prepare("SELECT * FROM workspaces").all() as Record<string, unknown>[];
      return rows.flatMap((row) => {
        const opened = Date.parse(String(row.timestamp ?? "")) || 0;
        return Object.keys(row).filter((k) => /paths/.test(k)).flatMap((k) => zedPaths(row[k])).map((path) => ({
          path,
          opened,
          editor: "Zed",
        }));
      });
    } catch {
      return [];
    } finally {
      db.close();
    }
  });
}

const hasTaskFile = (dir: string) => TASK_FILES.some((f) => exists(`${dir}/${f}`));

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}

/** Projects one or two levels below the usual folders, newest change first. */
function folders(): Recent[] {
  const found: string[] = [];
  for (const root of FOLDERS.map((f) => `${HOME}/${f}`)) {
    for (const dir of dirs(root)) {
      if (isDir(`${dir}/.git`) || hasTaskFile(dir)) found.push(dir);
      else found.push(...dirs(dir).filter((d) => isDir(`${d}/.git`) || hasTaskFile(d)));
    }
  }
  return found.map((path) => {
    let opened = 0;
    try {
      opened = Deno.statSync(path).mtime?.getTime() ?? 0;
    } catch { /* unreadable */ }
    // Behind anything an editor opened recently.
    return { path, opened: Math.min(opened, Date.now() - 30 * 86_400_000), editor: "" };
  });
}

/** Projects with task files, most recently opened first. */
export function projects(): Recent[] {
  const fromEditors = merge([...vscode(), ...jetbrains(), ...zed()]);
  const known = new Set(fromEditors.map((r) => r.path));
  return merge([...fromEditors, ...folders().filter((r) => !known.has(r.path))])
    .filter((r) => isDir(r.path) && hasTaskFile(r.path));
}

// --- Tasks ----------------------------------------------------------------------------

/** Programs the extension may run to list tasks; NotFound means "not installed". */
async function tool(program: string, args: string[]): Promise<string | undefined> {
  try {
    return await exec(program, args, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return undefined;
    throw err;
  }
}

const read = (path: string) => Deno.readTextFile(path).catch(() => undefined);

export interface Found {
  tasks: Task[];
  /** Runners whose program would describe tasks better, if installed. */
  missing: string[];
  errors: string[];
}

export async function tasksOf(dir: string): Promise<Found> {
  const files = (() => {
    try {
      return [...Deno.readDirSync(dir)].filter((e) => e.isFile).map((e) => e.name);
    } catch {
      return [];
    }
  })();
  const has = (f: string) => files.includes(f);
  const out: Task[] = [];
  const missing: string[] = [];
  const errors: string[] = [];
  const attempt = async (file: string, parse: () => Promise<Task[]> | Task[]) => {
    try {
      out.push(...await parse());
    } catch (e) {
      errors.push(`${file}: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
    }
  };

  if (has("package.json")) {
    await attempt("package.json", async () => packageScripts((await read(`${dir}/package.json`)) ?? "{}", files));
  }
  for (const f of ["deno.json", "deno.jsonc"]) {
    if (has(f)) await attempt(f, async () => denoTasks((await read(`${dir}/${f}`)) ?? "{}", f));
  }
  const justfile = ["justfile", "Justfile", ".justfile"].find(has);
  if (justfile) {
    await attempt(justfile, async () => {
      const args = ["--justfile", `${dir}/${justfile}`, "--working-directory", dir];
      const dump = await tool("just", [...args, "--dump", "--dump-format", "json"]).catch(() => undefined);
      if (dump) return justDump(dump, justfile);
      const summary = await tool("just", [...args, "--summary"]);
      if (summary !== undefined) return justSummary(summary, justfile);
      missing.push("just");
      return justfileRecipes((await read(`${dir}/${justfile}`)) ?? "", justfile);
    });
  }
  const taskfile = ["Taskfile.yml", "Taskfile.yaml", "taskfile.yml", "taskfile.yaml"].find(has);
  if (taskfile) {
    await attempt(taskfile, async () => {
      const json = await tool("task", ["--dir", dir, "--list-all", "--json"]) ??
        await tool("go-task", ["--dir", dir, "--list-all", "--json"]);
      if (json) return taskList(json, taskfile);
      missing.push("task");
      return taskfileTasks((await read(`${dir}/${taskfile}`)) ?? "", taskfile);
    });
  }
  const makefile = ["GNUmakefile", "makefile", "Makefile"].find(has);
  if (makefile) await attempt(makefile, async () => makeTargets((await read(`${dir}/${makefile}`)) ?? "", makefile));
  if (has("Cargo.toml")) {
    await attempt(
      "Cargo.toml",
      async () => cargoTasks((await read(`${dir}/Cargo.toml`)) ?? "", exists(`${dir}/src/main.rs`)),
    );
  }
  if (has("composer.json")) {
    await attempt("composer.json", async () => composerScripts((await read(`${dir}/composer.json`)) ?? "{}"));
  }
  if (has("pyproject.toml")) {
    await attempt("pyproject.toml", async () => pyprojectTasks((await read(`${dir}/pyproject.toml`)) ?? "", files));
  }
  return { tasks: out, missing, errors };
}
