// Finding Ansible projects and reading playbooks, inventories and ansible's output. Pure, tested in lib_test.ts.

// deno-lint-ignore no-import-prefix
import { parse as parseYaml } from "jsr:@std/yaml@^1";

// ---------------------------------------------------------------------------
// Folders and the find command

export const DEFAULT_FOLDERS =
  "~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/git, ~/repos, ~/workspace, ~/infra, ~/ansible, /etc/ansible";

/** The folders preference: commas, colons or new lines; `~` expanded; duplicates dropped. */
export function parseFolders(pref: string | undefined, home: string): string[] {
  const raw = (pref?.trim() || DEFAULT_FOLDERS).split(/[,:\n]/).map((f) => f.trim()).filter(Boolean);
  const expanded = raw.map((f) => f.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "") || "/");
  return [...new Set(expanded)].filter((f) => f.startsWith("/"));
}

export const clampDepth = (depth: unknown) => Math.max(1, Math.min(8, Math.round(Number(depth) || 4)));

/** Folders never worth descending into. */
const SKIP = ["node_modules", "vendor", "target", ".venv", "venv", "__pycache__", "build", "dist", "molecule"];

/**
 * `find` arguments printing, at most `depth` folders below the roots:
 * `C <dir>` for an ansible.cfg, `R <dir>` for a roles/ folder, `G <dir>` for group_vars/ or host_vars/,
 * `D <dir> <name>` for an inventory/ or inventories/ folder, `V <dir> <file>` for an inventory-looking
 * file, and `Y <mtime> <dir> <file>` for every other YAML file.
 */
export function findArgs(roots: string[], depth: number): string[] {
  const or = (names: string[]) => names.flatMap((n, i) => [...(i ? ["-o"] : []), "-name", n]);
  return [
    ...roots,
    "-mindepth",
    "1",
    "-maxdepth",
    String(clampDepth(depth) + 1),
    "(",
    ...or([...SKIP, ".*"]),
    ")",
    "-prune",
    "-o",
    "-type",
    "d",
    "-name",
    "roles",
    "-printf",
    "R\t%h\n",
    "-prune",
    "-o",
    "-type",
    "d",
    "(",
    ...or(["group_vars", "host_vars"]),
    ")",
    "-printf",
    "G\t%h\n",
    "-prune",
    "-o",
    "-type",
    "d",
    "(",
    ...or(["inventory", "inventories"]),
    ")",
    "-printf",
    "D\t%h\t%f\n",
    "-o",
    "-type",
    "f",
    "-name",
    "ansible.cfg",
    "-printf",
    "C\t%h\n",
    "-o",
    "-type",
    "f",
    "(",
    ...or(["inventory", "inventory.*", "hosts", "hosts.ini", "hosts.yml", "hosts.yaml"]),
    ")",
    "-printf",
    "V\t%h\t%f\n",
    "-o",
    "-type",
    "f",
    "(",
    ...or(["*.yml", "*.yaml"]),
    ")",
    "-printf",
    "Y\t%T@\t%h\t%f\n",
  ];
}

export interface InventoryRef {
  /** "production", "hosts.ini", "ansible.cfg"… */
  name: string;
  /** Absolute; empty means ansible's own choice (ansible.cfg, then /etc/ansible/hosts). */
  path: string;
}

export interface Project {
  path: string;
  name: string;
  hasConfig: boolean;
  hasRoles: boolean;
  /** Absolute paths of the YAML files that may be playbooks, by name. */
  playbooks: string[];
  inventories: InventoryRef[];
  /** Latest change of a playbook, in Unix seconds. */
  modified: number;
}

/** YAML files at a project's top that are never playbooks. */
const NOT_PLAYBOOKS = new Set([
  "requirements.yml",
  "requirements.yaml",
  "galaxy.yml",
  "galaxy.yaml",
  "docker-compose.yml",
  "docker-compose.yaml",
  "compose.yml",
  "compose.yaml",
  "mkdocs.yml",
  "molecule.yml",
  "renovate.yml",
  "dependabot.yml",
  "netlify.yml",
  "codecov.yml",
  "vars.yml",
  "secrets.yml",
  "vault.yml",
  "values.yaml",
  "chart.yaml",
  "kustomization.yaml",
]);

const dirname = (p: string) => p.replace(/\/[^/]+$/, "") || "/";
const basename = (p: string) => p.split("/").pop() || p;

/** `find` output → Ansible projects, the most recently changed first. */
export function projectsFromFind(out: string): Project[] {
  const config = new Set<string>(), roles = new Set<string>(), vars = new Set<string>();
  const invDirs = new Map<string, Set<string>>();
  const invFiles: [string, string][] = [];
  const yamls: { mtime: number; dir: string; file: string }[] = [];
  for (const line of out.split("\n")) {
    const p = line.split("\t");
    if (p[0] === "C" && p[1]) config.add(p[1]);
    else if (p[0] === "R" && p[1]) roles.add(p[1]);
    else if (p[0] === "G" && p[1]) vars.add(p[1]);
    else if (p[0] === "D" && p.length >= 3) {
      if (!invDirs.has(p[1])) invDirs.set(p[1], new Set());
      invDirs.get(p[1])!.add(p[2]);
    } else if (p[0] === "V" && p.length >= 3) invFiles.push([p[1], p.slice(2).join("\t")]);
    else if (p[0] === "Y" && p.length >= 4) {
      yamls.push({ mtime: Math.floor(Number(p[1]) || 0), dir: p[2], file: p.slice(3).join("\t") });
    }
  }

  const inventories = new Map<string, InventoryRef[]>();
  const addInventory = (root: string, ref: InventoryRef) => {
    const list = inventories.get(root) ?? [];
    if (!list.some((r) => r.path === ref.path)) list.push(ref);
    inventories.set(root, list);
  };
  for (const [dir, names] of invDirs) {
    if (names.has("inventory")) addInventory(dir, { name: "inventory", path: `${dir}/inventory` });
  }
  for (const [dir, file] of invFiles) {
    const parent = basename(dir), grand = basename(dirname(dir));
    if (parent === "inventory") continue; // Part of the inventory/ folder.
    if (grand === "inventories") addInventory(dirname(dirname(dir)), { name: parent, path: dir });
    else if (parent === "inventories") {
      addInventory(dirname(dir), { name: file.replace(/\.(ini|ya?ml|json)$/, ""), path: `${dir}/${file}` });
    } else addInventory(dir, { name: file, path: `${dir}/${file}` });
  }
  // inventories/<env>/ folders holding only group_vars and a dynamic plugin config still count.
  for (const dir of vars) {
    if (basename(dirname(dir)) === "inventories") {
      addInventory(dirname(dirname(dir)), { name: basename(dir), path: dir });
    }
  }

  const playbooksOf = new Map<string, { path: string; mtime: number }[]>();
  for (const y of yamls) {
    if (NOT_PLAYBOOKS.has(y.file.toLowerCase())) continue;
    const owner = basename(y.dir) === "playbooks" ? dirname(y.dir) : y.dir;
    const list = playbooksOf.get(owner) ?? [];
    list.push({ path: `${y.dir}/${y.file}`, mtime: y.mtime });
    playbooksOf.set(owner, list);
  }

  const candidates = new Set<string>([...config, ...inventories.keys()]);
  for (const dir of roles) if (playbooksOf.has(dir)) candidates.add(dir);
  for (const y of yamls) {
    if (basename(y.dir) === "playbooks" || /^(site|playbook|main|deploy)\.ya?ml$/.test(y.file)) {
      if (basename(y.dir) === "playbooks") candidates.add(dirname(y.dir));
      else if (vars.has(y.dir) || roles.has(y.dir)) candidates.add(y.dir);
    }
  }

  const projects: Project[] = [];
  for (const dir of candidates) {
    // A folder inside another project's inventories/ or playbooks/ is not a project of its own.
    const nested = [...candidates].some((c) =>
      c !== dir && dir.startsWith(`${c}/`) &&
      /^(inventories|inventory|playbooks|group_vars|host_vars)(\/|$)/.test(dir.slice(c.length + 1))
    );
    if (nested) continue;
    const inv = inventories.get(dir) ?? [];
    const books = playbooksOf.get(dir) ?? [];
    // An inventory file alone, without ansible.cfg, roles or playbooks, is probably not Ansible's.
    if (!config.has(dir) && !roles.has(dir) && !books.length && !inv.some((i) => /^inventor/.test(basename(i.path)))) {
      continue;
    }
    if (!books.length && !inv.length && !config.has(dir)) continue;
    projects.push({
      path: dir,
      name: basename(dir),
      hasConfig: config.has(dir),
      hasRoles: roles.has(dir),
      playbooks: books.map((b) => b.path).sort((a, b) => a.localeCompare(b)),
      inventories: inv.sort((a, b) => a.name.localeCompare(b.name)),
      modified: Math.max(0, ...books.map((b) => b.mtime)),
    });
  }
  return projects.sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
}

/** The `inventory =` line of an ansible.cfg, resolved against the project; comma lists keep their first entry. */
export function configInventory(cfg: string, projectDir: string, home: string): string | undefined {
  let section = "";
  for (const raw of cfg.split("\n")) {
    const line = raw.replace(/\s[;#].*$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const s = /^\[(.+)\]$/.exec(line);
    if (s) {
      section = s[1].trim().toLowerCase();
      continue;
    }
    const kv = /^(inventory|hostfile)\s*[=:]\s*(.+)$/.exec(line);
    if (section === "defaults" && kv) {
      const first = kv[2].split(",")[0].trim();
      if (!first) return undefined;
      const expanded = first.replace(/^~(?=\/|$)/, home);
      return expanded.startsWith("/") ? expanded : `${projectDir}/${expanded.replace(/^\.\//, "")}`.replace(/\/$/, "");
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Playbooks

export interface Play {
  name: string;
  hosts: string;
  roles: string[];
  /** Tasks, pre_tasks and post_tasks, blocks counted by what they hold. */
  tasks: number;
  handlers: number;
  tags: string[];
  become: boolean;
  gatherFacts: boolean;
  serial: string;
  /** For `- import_playbook: other.yml`. */
  imports?: string;
}

const IMPORT_KEYS = ["import_playbook", "ansible.builtin.import_playbook"];

function countTasks(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  let n = 0;
  for (const t of list) {
    if (t && typeof t === "object" && "block" in t) {
      const b = t as Record<string, unknown>;
      n += countTasks(b.block) + countTasks(b.rescue) + countTasks(b.always);
    } else n++;
  }
  return n;
}

const tagList = (t: unknown): string[] =>
  Array.isArray(t) ? t.map(String) : typeof t === "string" ? t.split(",").map((s) => s.trim()).filter(Boolean) : [];

function roleName(r: unknown): string {
  if (typeof r === "string") return r;
  if (r && typeof r === "object") {
    const o = r as Record<string, unknown>;
    return String(o.role ?? o.name ?? "");
  }
  return "";
}

/**
 * The plays of a playbook, or undefined when the text is not one. Ansible's own
 * YAML tags (`!vault`, `!unsafe`) are dropped so the standard parser reads it.
 */
export function parsePlaybook(text: string): Play[] | undefined {
  let doc: unknown;
  try {
    doc = parseYaml(text.replace(/!(vault|unsafe)\b/g, ""));
  } catch {
    return undefined;
  }
  if (!Array.isArray(doc) || !doc.length) return undefined;
  const plays: Play[] = [];
  for (const entry of doc) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
    const p = entry as Record<string, unknown>;
    const imported = IMPORT_KEYS.map((k) => p[k]).find((v) => v !== undefined);
    if (imported !== undefined) {
      const target = typeof imported === "string"
        ? imported
        : String((imported as Record<string, unknown>)?.file ?? "");
      plays.push({
        name: String(p.name ?? `Import ${target}`),
        hosts: "",
        roles: [],
        tasks: 0,
        handlers: 0,
        tags: tagList(p.tags),
        become: false,
        gatherFacts: false,
        serial: "",
        imports: target,
      });
      continue;
    }
    if (!("hosts" in p)) return undefined;
    const hosts = Array.isArray(p.hosts) ? p.hosts.map(String).join(",") : String(p.hosts ?? "");
    plays.push({
      name: String(p.name ?? "").trim(),
      hosts,
      roles: Array.isArray(p.roles) ? p.roles.map(roleName).filter(Boolean) : [],
      tasks: countTasks(p.tasks) + countTasks(p.pre_tasks) + countTasks(p.post_tasks),
      handlers: countTasks(p.handlers),
      tags: tagList(p.tags),
      become: p.become === true || p.become === "yes" || p.become === "true",
      gatherFacts: !(p.gather_facts === false || p.gather_facts === "no" || p.gather_facts === "false"),
      serial: p.serial === undefined ? "" : String(p.serial),
    });
  }
  return plays;
}

/** Every tag a playbook's plays name, for "Run with Tag". */
export const playTags = (plays: Play[]) => [...new Set(plays.flatMap((p) => p.tags))].sort();

/** "webservers, dbservers" from the plays, without duplicates. */
export const playHosts = (plays: Play[]) => [...new Set(plays.map((p) => p.hosts).filter(Boolean))].join(", ");

// ---------------------------------------------------------------------------
// ansible-playbook --list-hosts --list-tasks

export interface ListedTask {
  role: string;
  name: string;
  tags: string[];
}

export interface ListedPlay {
  number: number;
  pattern: string;
  name: string;
  tags: string[];
  hosts: string[];
  tasks: ListedTask[];
}

const bracketList = (s: string) =>
  s.replace(/^\[|\]$/g, "").split(",").map((t) => t.trim().replace(/^'|'$/g, "")).filter(Boolean);

export function parseListTasks(out: string): ListedPlay[] {
  const plays: ListedPlay[] = [];
  let play: ListedPlay | undefined;
  let mode: "hosts" | "tasks" | "" = "";
  for (const raw of out.split("\n")) {
    const line = raw.trimEnd();
    const head = /^\s*play #(\d+) \((.*?)\): ?(.*?)\s*TAGS: (\[.*\])\s*$/.exec(line);
    if (head) {
      play = {
        number: Number(head[1]),
        pattern: head[2],
        name: head[3].trim(),
        tags: bracketList(head[4]),
        hosts: [],
        tasks: [],
      };
      plays.push(play);
      mode = "";
      continue;
    }
    if (!play) continue;
    if (/^\s*pattern: /.test(line)) continue;
    if (/^\s*hosts \(\d+\):\s*$/.test(line)) {
      mode = "hosts";
      continue;
    }
    if (/^\s*tasks:\s*$/.test(line)) {
      mode = "tasks";
      continue;
    }
    const text = line.trim();
    if (!text) continue;
    if (mode === "hosts") play.hosts.push(text);
    else if (mode === "tasks") {
      const t = /^(.*?)\s*TAGS: (\[.*\])$/.exec(text);
      const label = (t ? t[1] : text).trim();
      const role = /^([\w.-]+) : (.+)$/.exec(label);
      play.tasks.push({
        role: role ? role[1] : "",
        name: role ? role[2] : label,
        tags: t ? bracketList(t[2]) : [],
      });
    }
  }
  return plays;
}

// ---------------------------------------------------------------------------
// ansible-inventory --list

export interface Group {
  name: string;
  /** Hosts listed in the group itself. */
  hosts: string[];
  children: string[];
  /** Hosts of the group and of its children, recursively. */
  allHosts: string[];
}

export interface Host {
  name: string;
  /** The groups listing it directly (not all/ungrouped). */
  groups: string[];
  vars: Record<string, unknown>;
}

export interface Inventory {
  groups: Group[];
  hosts: Host[];
}

export function parseInventory(json: string): Inventory {
  const raw = JSON.parse(json || "{}") as Record<string, Record<string, unknown>>;
  const hostvars = (raw._meta?.hostvars ?? {}) as Record<string, Record<string, unknown>>;
  const direct = new Map<string, { hosts: string[]; children: string[] }>();
  for (const [name, g] of Object.entries(raw)) {
    if (name === "_meta" || !g || typeof g !== "object") continue;
    direct.set(name, {
      hosts: Array.isArray(g.hosts) ? (g.hosts as unknown[]).map(String) : [],
      children: Array.isArray(g.children) ? (g.children as unknown[]).map(String) : [],
    });
  }
  const memo = new Map<string, string[]>();
  const all = (name: string, seen = new Set<string>()): string[] => {
    if (memo.has(name)) return memo.get(name)!;
    if (seen.has(name)) return [];
    seen.add(name);
    const g = direct.get(name);
    if (!g) return [];
    const hosts = [...new Set([...g.hosts, ...g.children.flatMap((c) => all(c, seen))])].sort(naturalCompare);
    memo.set(name, hosts);
    return hosts;
  };
  const groups: Group[] = [...direct.entries()]
    .map(([name, g]) => ({ name, hosts: g.hosts, children: g.children, allHosts: all(name) }))
    .filter((g) => g.name !== "all" || g.allHosts.length)
    .sort((a, b) => (a.name === "all" ? -1 : b.name === "all" ? 1 : a.name.localeCompare(b.name)));
  const names = new Set<string>([...Object.keys(hostvars), ...groups.flatMap((g) => g.allHosts)]);
  const hosts: Host[] = [...names].sort(naturalCompare).map((name) => ({
    name,
    groups: groups.filter((g) => g.hosts.includes(name) && g.name !== "all" && g.name !== "ungrouped").map((g) =>
      g.name
    ),
    vars: hostvars[name] ?? {},
  }));
  return { groups: groups.filter((g) => g.name !== "ungrouped" || g.hosts.length), hosts };
}

/** "web2" before "web10". */
export const naturalCompare = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

const NOT_SSH = new Set([
  "local",
  "docker",
  "community.docker.docker",
  "podman",
  "containers.podman.podman",
  "winrm",
  "psrp",
  "ansible.netcommon.network_cli",
  "network_cli",
  "httpapi",
  "ansible.netcommon.httpapi",
  "netconf",
  "community.general.lxd",
  "lxd",
  "kubectl",
  "kubernetes.core.kubectl",
]);

/** Where `ssh` connects for a host, from its inventory variables; undefined for non-SSH connections. */
export function sshTarget(host: Host): { address: string; argv: string[] } | undefined {
  const v = host.vars;
  const connection = String(v.ansible_connection ?? "ssh");
  if (NOT_SSH.has(connection)) return undefined;
  const address = String(v.ansible_host ?? v.ansible_ssh_host ?? host.name);
  const user = v.ansible_user ?? v.ansible_ssh_user;
  const port = v.ansible_port ?? v.ansible_ssh_port;
  const key = v.ansible_ssh_private_key_file ?? v.ansible_private_key_file;
  const argv = ["ssh"];
  if (port !== undefined && String(port) !== "22") argv.push("-p", String(port));
  if (typeof key === "string" && key && !key.includes("{{")) argv.push("-i", key);
  if (typeof v.ansible_ssh_common_args === "string" && /ProxyJump|-J\s/.test(v.ansible_ssh_common_args)) {
    const jump = /(?:ProxyJump=|-J\s+)(\S+)/.exec(v.ansible_ssh_common_args);
    if (jump) argv.push("-J", jump[1].replace(/["']/g, ""));
  }
  argv.push(user !== undefined && String(user) ? `${user}@${address}` : address);
  return { address, argv };
}

const SENSITIVE = /pass|secret|token|private_key(?!_file)|api_?key|credential/i;

/** A variable for the detail panel: vault-encrypted and secret-looking values hidden. */
export function varText(name: string, value: unknown): string {
  if (value && typeof value === "object" && "__ansible_vault" in (value as Record<string, unknown>)) {
    return "(vault encrypted)";
  }
  if (SENSITIVE.test(name)) return "••••••••";
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Inventory variables Ansible adds itself, not worth showing. */
export const isMagicVar = (name: string) =>
  ["inventory_file", "inventory_dir", "playbook_dir", "omit"].includes(name) || name.startsWith("ansible_facts");

// ---------------------------------------------------------------------------
// Errors and formatting

export type Problem = "vault" | "parse" | "missing-file" | "other";

export function classifyError(stderr: string): Problem {
  const t = stderr.toLowerCase();
  if (/vault secrets? (were )?found|no vault secrets|decryption failed|attempting to decrypt/.test(t)) return "vault";
  if (/unable to parse|failed to parse|syntax error|yaml|could not find expected/.test(t)) return "parse";
  if (/could not find or access|does not exist|no such file/.test(t)) return "missing-file";
  return "other";
}

/** The useful lines of ansible's stderr: warnings and colors dropped. */
export function cleanError(stderr: string): string {
  return stderr
    .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "")
    .split("\n")
    .filter((l) => l.trim() && !/^\[(WARNING|DEPRECATION WARNING)\]/.test(l.trim()))
    .join("\n")
    .replace(/^ERROR!\s*/, "")
    .trim()
    .slice(0, 1500);
}

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

/** A path relative to the project, for the command lines shown and run. */
export const relativeTo = (path: string, dir: string) => path.startsWith(`${dir}/`) ? path.slice(dir.length + 1) : path;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", "2 weeks ago", "3 months ago", "2 years ago". */
export function relativeTime(unixSeconds: number, now = Date.now()): string {
  const s = Math.max(0, Math.round(now / 1000 - unixSeconds));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return "yesterday";
  if (d < 14) return `${d} days ago`;
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  if (d < 730) return `${Math.floor(d / 30)} months ago`;
  return `${Math.floor(d / 365)} years ago`;
}

/** The command line for a playbook run. */
export function playbookArgv(
  playbook: string,
  inventory: string,
  o: { check?: boolean; limit?: string; tags?: string; syntax?: boolean; askBecome?: boolean; askVault?: boolean } = {},
): string[] {
  const argv = ["ansible-playbook"];
  if (inventory) argv.push("-i", inventory);
  argv.push(playbook);
  if (o.syntax) argv.push("--syntax-check");
  if (o.check) argv.push("--check", "--diff");
  if (o.limit) argv.push("--limit", o.limit);
  if (o.tags) argv.push("--tags", o.tags);
  if (o.askBecome && !o.syntax) argv.push("--ask-become-pass");
  if (o.askVault) argv.push("--ask-vault-pass");
  return argv;
}

/** Linux distribution family from /etc/os-release, for the install hint. */
export function installCommand(osRelease: string): string {
  const id = /^(?:ID|ID_LIKE)=(.*)$/gm;
  const ids = [...osRelease.matchAll(id)].map((m) => m[1].replace(/"/g, "")).join(" ");
  if (/fedora|rhel|centos/.test(ids)) return "sudo dnf install ansible";
  if (/debian|ubuntu/.test(ids)) return "sudo apt install ansible";
  if (/arch/.test(ids)) return "sudo pacman -S ansible";
  if (/suse/.test(ids)) return "sudo zypper install ansible";
  return "pipx install --include-deps ansible";
}
