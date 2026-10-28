// Running ansible's tools, finding projects, and the rows every view shares.

import { action, close, copy, Icons, type Item, open, refresh, storage } from "@backslash/api";
import {
  classifyError,
  cleanError,
  configInventory,
  findArgs,
  installCommand,
  type Inventory,
  type InventoryRef,
  parseFolders,
  parseInventory,
  type Project,
  projectsFromFind,
} from "./lib.ts";
import { holdOpen, runInTerminal, shellLine } from "./terminal.ts";

export const HOME = (() => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
})();

export interface Prefs {
  folders?: string;
  depth?: number;
  terminal?: string;
  askBecome?: boolean;
  askVault?: boolean;
}

export class Missing extends Error {}

/** No colors, no prompts, no chatter on stderr. */
const ENV = {
  ANSIBLE_NOCOLOR: "1",
  ANSIBLE_FORCE_COLOR: "0",
  ANSIBLE_DEPRECATION_WARNINGS: "False",
  ANSIBLE_LOCALHOST_WARNING: "False",
  ANSIBLE_INVENTORY_UNPARSED_WARNING: "False",
  ANSIBLE_RETRY_FILES_ENABLED: "False",
  PY_COLORS: "0",
};

/** Runs a program in `cwd`; throws its cleaned stderr on failure, unless `allowFailure`. */
export async function run(
  program: string,
  args: string[],
  o: { cwd?: string; signal?: AbortSignal; allowFailure?: boolean } = {},
): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      cwd: o.cwd,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: o.signal,
      env: ENV,
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Missing(`${program} is not installed`);
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b).trim();
  if (!out.success && !o.allowFailure) {
    throw new Error(cleanError(text(out.stderr) || text(out.stdout)) || `${program} failed`);
  }
  return text(out.stdout);
}

// ---------------------------------------------------------------------------
// Projects

const PROJECTS = "projects";

/** Scans the folders of the preferences. */
export async function scan(prefs: Prefs, signal?: AbortSignal): Promise<Project[]> {
  const roots = parseFolders(prefs.folders, HOME);
  if (!roots.length) return [];
  const out = await run("find", findArgs(roots, prefs.depth ?? 4), { signal, allowFailure: true });
  const projects = projectsFromFind(out);
  await storage.set(PROJECTS, projects as any).catch(() => {});
  return projects;
}

export const cachedProjects = async () =>
  ((await storage.get(PROJECTS).catch(() => undefined)) as Project[] | undefined) ?? [];

/** Reads a file when the extension may (the default folders); undefined otherwise. */
export async function readText(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}

/** The project's inventories: ansible.cfg's own first, then those found on disk. */
export async function inventoriesOf(project: Project): Promise<InventoryRef[]> {
  const list = [...project.inventories];
  if (project.hasConfig) {
    const cfg = await readText(`${project.path}/ansible.cfg`);
    const fromCfg = cfg ? configInventory(cfg, project.path, HOME) : undefined;
    if (fromCfg) {
      const i = list.findIndex((r) => r.path === fromCfg);
      const name = i >= 0 ? list.splice(i, 1)[0].name : fromCfg.split("/").pop() || fromCfg;
      list.unshift({ name: `${name} (ansible.cfg)`, path: fromCfg });
    } else if (!list.length) list.push({ name: "ansible.cfg", path: "" });
  }
  if (!list.length) list.push({ name: "default", path: "" });
  return list;
}

const chosenKey = (project: Project) => `inventory:${project.path}`;

/** The inventory picked for a project (remembered), else its first one. */
export async function chosenInventory(project: Project, all?: InventoryRef[]): Promise<InventoryRef> {
  const list = all ?? await inventoriesOf(project);
  const saved = await storage.get<string>(chosenKey(project)).catch(() => undefined);
  return list.find((r) => r.path === saved) ?? list[0];
}

export const chooseInventory = (project: Project, ref: InventoryRef) =>
  storage.set(chosenKey(project), ref.path).catch(() => {});

const inventoryCacheKey = (project: Project, ref: InventoryRef) => `hosts:${project.path}:${ref.path}`;

/** `ansible-inventory --list`, run in the project so its ansible.cfg applies. */
export async function loadInventory(project: Project, ref: InventoryRef, signal?: AbortSignal): Promise<Inventory> {
  const args = [...(ref.path ? ["-i", ref.path] : []), "--list"];
  const out = await run("ansible-inventory", args, { cwd: project.path, signal });
  const start = out.indexOf("{");
  const inventory = parseInventory(start >= 0 ? out.slice(start) : "{}");
  await storage.set(inventoryCacheKey(project, ref), inventory as any).catch(() => {});
  return inventory;
}

export const cachedInventory = async (project: Project, ref: InventoryRef) =>
  (await storage.get(inventoryCacheKey(project, ref)).catch(() => undefined)) as Inventory | undefined;

// ---------------------------------------------------------------------------
// Terminal

export function inTerminal(
  title: string,
  argv: string[],
  cwd: string,
  prefs: Prefs,
  o: { icon?: string; shortcut?: string; section?: string; confirm?: string; destructive?: boolean } = {},
) {
  return action(title, () => {
    const term = runInTerminal(holdOpen(argv, cwd), prefs.terminal || undefined);
    return close(`Opened in ${term}`);
  }, {
    icon: o.icon ?? Icons.terminal,
    shortcut: o.shortcut,
    section: o.section,
    confirm: o.confirm,
    destructive: o.destructive,
  });
}

export const commandLine = (argv: string[], cwd: string) => `cd ${shellLine([cwd])} && ${shellLine(argv)}`;

// ---------------------------------------------------------------------------
// Missing tools and errors

let osRelease: Promise<string> | undefined;

export async function missingItem(): Promise<Item> {
  const cmd = installCommand(await (osRelease ??= Deno.readTextFile("/etc/os-release").catch(() => "")));
  return {
    id: "missing",
    title: "Ansible is not installed",
    subtitle: cmd,
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "This extension runs **ansible-inventory** and **ansible-playbook** in your projects.",
        "",
        "```sh",
        cmd,
        "pipx install --include-deps ansible   # or the latest release, for your user",
        "```",
      ].join("\n"),
    },
    actions: [
      copy(cmd, "Copy Install Command", { icon: Icons.terminal }),
      open("https://docs.ansible.com/ansible/latest/installation_guide/intro_installation.html", "Open Install Guide"),
    ],
  };
}

export function errorItem(err: unknown, title = "ansible-inventory failed"): Item {
  const message = err instanceof Error ? err.message : String(err);
  const problem = classifyError(message);
  const titles: Record<typeof problem, string> = {
    vault: "This inventory has vault-encrypted files",
    parse: "Ansible can't parse this inventory",
    "missing-file": "A file of this inventory is missing",
    other: title,
  };
  const hint = problem === "vault"
    ? "\n\nSet `vault_password_file` in ansible.cfg (or `ANSIBLE_VAULT_PASSWORD_FILE` in your session) so ansible can read it without asking."
    : "";
  return {
    id: "error",
    title: titles[problem],
    subtitle: message.split("\n")[0],
    icon: { source: Icons.alert, tint: problem === "vault" ? "orange" : "red" },
    detail: { markdown: `\`\`\`\n${message.replace(/```/g, "ʼʼʼ")}\n\`\`\`${hint}` },
    actions: [
      action("Retry", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}
