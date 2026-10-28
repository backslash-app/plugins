// Finding Terraform projects and reading terraform's output. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Folders and the find command

export const DEFAULT_FOLDERS =
  "~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/git, ~/repos, ~/workspace, ~/infra, ~/terraform";

/** The folders preference: commas, colons or new lines; `~` expanded; duplicates dropped. */
export function parseFolders(pref: string | undefined, home: string): string[] {
  const raw = (pref?.trim() || DEFAULT_FOLDERS).split(/[,:\n]/).map((f) => f.trim()).filter(Boolean);
  const expanded = raw.map((f) => f.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "") || "/");
  return [...new Set(expanded)].filter((f) => f.startsWith("/"));
}

/** Directories never worth descending into. */
const SKIP = ["node_modules", "vendor", "target", ".venv", "venv", "__pycache__", "build", "dist"];

/**
 * `find` arguments printing, at most `depth` folders below the roots:
 * `F <mtime> <file> <dir>` for each *.tf / *.tofu / terraform.tfstate file and
 * `I <dir>` for each `.terraform` folder (an initialized project).
 */
export function findArgs(roots: string[], depth: number): string[] {
  const skip = SKIP.flatMap((name, i) => [...(i ? ["-o"] : []), "-name", name]);
  return [
    ...roots,
    "-mindepth",
    "1",
    "-maxdepth",
    String(Math.max(1, Math.min(8, Math.round(depth || 4))) + 1),
    "(",
    ...skip,
    ")",
    "-prune",
    "-o",
    "-name",
    ".terraform",
    "-type",
    "d",
    "-printf",
    "I\t%h\n",
    "-prune",
    "-o",
    "-name",
    ".*",
    "-prune",
    "-o",
    "-type",
    "f",
    "(",
    "-name",
    "*.tf",
    "-o",
    "-name",
    "*.tofu",
    "-o",
    "-name",
    "terraform.tfstate",
    ")",
    "-printf",
    "F\t%T@\t%f\t%h\n",
  ];
}

export interface Project {
  path: string;
  name: string;
  /** Configuration files (*.tf, *.tofu). */
  files: string[];
  /** Latest change of a configuration file, in Unix seconds. */
  modified: number;
  /** Has a `.terraform` folder: `init` ran. */
  initialized: boolean;
  /** Has a local `terraform.tfstate`. */
  localState: boolean;
  /** Looks like a reusable module (under a `modules/` folder), not a root module. */
  module: boolean;
}

/** `find` output → projects, the most recently changed first. */
export function projectsFromFind(out: string): Project[] {
  const byDir = new Map<string, Project>();
  const initialized = new Set<string>();
  const get = (dir: string) => {
    let p = byDir.get(dir);
    if (!p) {
      p = {
        path: dir,
        name: dir.split("/").pop() || dir,
        files: [],
        modified: 0,
        initialized: false,
        localState: false,
        module: /\/modules\/[^/]+$/.test(dir),
      };
      byDir.set(dir, p);
    }
    return p;
  };
  for (const line of out.split("\n")) {
    const parts = line.split("\t");
    if (parts[0] === "I" && parts[1]) initialized.add(parts[1]);
    else if (parts[0] === "F" && parts.length >= 4) {
      const dir = parts.slice(3).join("\t");
      const p = get(dir);
      if (parts[2] === "terraform.tfstate") p.localState = true;
      else {
        p.files.push(parts[2]);
        p.modified = Math.max(p.modified, Math.floor(Number(parts[1]) || 0));
      }
    }
  }
  return [...byDir.values()]
    .filter((p) => p.files.length)
    .map((p) => ({ ...p, files: p.files.sort(), initialized: initialized.has(p.path) }))
    .sort((a, b) => b.modified - a.modified || a.path.localeCompare(b.path));
}

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

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

// ---------------------------------------------------------------------------
// Workspaces

export interface Workspaces {
  current: string;
  names: string[];
}

/** `terraform workspace list`: one per line, the current one starred. */
export function parseWorkspaces(out: string): Workspaces {
  let current = "default";
  const names: string[] = [];
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("*")) {
      current = line.slice(1).trim();
      names.push(current);
    } else names.push(line);
  }
  return { current, names: names.length ? names : ["default"] };
}

// ---------------------------------------------------------------------------
// Resources

export interface Address {
  address: string;
  /** `module.vpc.module.subnets`, empty for the root module. */
  module: string;
  mode: "managed" | "data";
  type: string;
  name: string;
  /** `0` or `"a"`, as written. */
  index?: string;
}

/** `module.vpc.aws_subnet.private["a"]` → its parts. */
export function parseAddress(address: string): Address {
  let rest = address;
  const modules: string[] = [];
  for (;;) {
    const m = /^module\.([^.[]+)(\[[^\]]*\])?\./.exec(rest);
    if (!m) break;
    modules.push(`module.${m[1]}${m[2] ?? ""}`);
    rest = rest.slice(m[0].length);
  }
  let mode: "managed" | "data" = "managed";
  if (rest.startsWith("data.")) {
    mode = "data";
    rest = rest.slice(5);
  }
  const m = /^([^.]+)\.([^[]+)(?:\[(.*)\])?$/.exec(rest);
  return {
    address,
    module: modules.join("."),
    mode,
    type: m?.[1] ?? rest,
    name: m?.[2] ?? "",
    index: m?.[3],
  };
}

/** `terraform state list` → addresses. */
export const parseStateList = (out: string) =>
  out.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("Warning"));

/** `aws_instance` → `aws`; `registry.terraform.io/hashicorp/aws` → `aws`. */
export function providerOf(type: string, providerName?: string): string {
  if (providerName) return providerName.split("/").pop()!;
  return type.split("_")[0];
}

export interface StateResource {
  address: string;
  type: string;
  name: string;
  mode: "managed" | "data";
  module: string;
  index?: string | number;
  provider: string;
  values: Record<string, unknown>;
  /** Attribute names whose value is sensitive. */
  sensitive: string[];
  dependsOn: string[];
}

export interface State {
  version?: string;
  resources: StateResource[];
  outputs: Output[];
}

/** `terraform show -json`: every resource of every module, and the outputs. */
export function parseShow(json: string): State {
  const data = JSON.parse(json || "{}");
  const resources: StateResource[] = [];
  const walk = (mod: any) => {
    for (const r of mod?.resources ?? []) {
      const sens = r.sensitive_values && typeof r.sensitive_values === "object" ? r.sensitive_values : {};
      resources.push({
        address: r.address,
        type: r.type,
        name: r.name,
        mode: r.mode === "data" ? "data" : "managed",
        module: mod.address ?? "",
        index: r.index,
        provider: providerOf(r.type, r.provider_name),
        values: r.values ?? {},
        sensitive: Object.keys(sens).filter((k) => sens[k] === true),
        dependsOn: r.depends_on ?? [],
      });
    }
    for (const child of mod?.child_modules ?? []) walk(child);
  };
  walk(data.values?.root_module);
  return {
    version: data.terraform_version,
    resources,
    outputs: parseOutputs(JSON.stringify(data.values?.outputs ?? {})),
  };
}

/** Attributes worth showing first, in this order. */
const KEY_ATTRS = ["id", "arn", "name", "self_link", "url", "endpoint", "fqdn", "public_ip", "private_ip", "region"];

export interface Attribute {
  key: string;
  value: string;
  sensitive: boolean;
}

/** One line per non-empty top-level attribute; long or nested values shortened. */
export function attributes(r: StateResource, max = 80): Attribute[] {
  const rank = (k: string) => {
    const i = KEY_ATTRS.indexOf(k);
    return i === -1 ? KEY_ATTRS.length : i;
  };
  return Object.entries(r.values)
    .filter(([, v]) =>
      v !== null && v !== "" && !(Array.isArray(v) && !v.length) &&
      !(typeof v === "object" && !Array.isArray(v) && !Object.keys(v as object).length)
    )
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, v]) => {
      const sensitive = r.sensitive.includes(key);
      return { key, value: sensitive ? "(sensitive)" : shorten(display(v), max), sensitive };
    });
}

/** The resource's identifier, as most providers name it. */
export const resourceId = (r: StateResource) =>
  ["id", "arn", "self_link", "name"].map((k) => r.values[k]).find((v) => typeof v === "string" && v) as
    | string
    | undefined;

export const display = (v: unknown): string => typeof v === "string" ? v : JSON.stringify(v);

export const shorten = (s: string, max: number) => s.length > max ? `${s.slice(0, max - 1)}…` : s;

/** Resources grouped by type, types sorted, managed resources before data sources. */
export function groupByType<T extends { type: string; mode: string; address: string }>(items: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const r of items) {
    const key = r.mode === "data" ? `data.${r.type}` : r.type;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => Number(a.startsWith("data.")) - Number(b.startsWith("data.")) || a.localeCompare(b))
    .map(([k, v]) => [k, v.sort((x, y) => x.address.localeCompare(y.address, undefined, { numeric: true }))]);
}

// ---------------------------------------------------------------------------
// Outputs

export interface Output {
  name: string;
  sensitive: boolean;
  /** `string`, `number`, `list`, `map`, `object`… */
  type: string;
  value: unknown;
}

const typeName = (t: unknown): string => {
  if (typeof t === "string") return t;
  if (Array.isArray(t) && typeof t[0] === "string") return t[0];
  return "value";
};

/** `terraform output -json` → outputs sorted by name. */
export function parseOutputs(json: string): Output[] {
  const data = JSON.parse(json || "{}") ?? {};
  return Object.entries(data as Record<string, any>)
    .map(([name, o]) => ({ name, sensitive: !!o?.sensitive, type: typeName(o?.type), value: o?.value }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** What to copy: strings as they are, anything else as pretty JSON. */
export const outputText = (o: Output) => typeof o.value === "string" ? o.value : JSON.stringify(o.value, null, 2);

// ---------------------------------------------------------------------------
// Errors and installing

export type Problem = "init" | "locked" | "auth" | "other";

/** What went wrong, from terraform's stderr. */
export function classifyError(message: string): { problem: Problem; title: string } {
  if (
    /terraform init|tofu init|Backend initialization required|Required plugins are not installed|Module not installed/i
      .test(message)
  ) {
    return { problem: "init", title: "Not initialized" };
  }
  if (/state lock|Error acquiring the state lock/i.test(message)) {
    return { problem: "locked", title: "State is locked" };
  }
  if (
    /credentials|NoCredentialProviders|could not find default credentials|401|403|AccessDenied|Unauthorized/i.test(
      message,
    )
  ) {
    return { problem: "auth", title: "The backend refused the credentials" };
  }
  return { problem: "other", title: "terraform failed" };
}

/** Error text without terraform's box drawing and color codes. */
export function cleanError(message: string): string {
  return message
    // deno-lint-ignore no-control-regex
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/^(terraform|tofu) exited with \d+: /, "")
    .split("\n")
    .map((l) => l.replace(/^[│╷╵]\s?/, "").trimEnd())
    .filter((l, i, all) => l || (i > 0 && all[i - 1]))
    .join("\n")
    .trim();
}

export type Family = "debian" | "fedora" | "arch" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

/** How to install OpenTofu (in the distributions) or Terraform (HashiCorp's repository). */
export function installCommands(family: Family | undefined): { tofu: string; terraform: string } {
  switch (family) {
    case "arch":
      return { tofu: "sudo pacman -S opentofu", terraform: "sudo pacman -S terraform" };
    case "fedora":
      return {
        tofu: "sudo dnf install opentofu",
        terraform: "sudo dnf install terraform   # after adding rpm.releases.hashicorp.com",
      };
    case "suse":
      return { tofu: "sudo zypper install opentofu", terraform: "sudo zypper install terraform" };
    default:
      return {
        tofu: "sudo snap install opentofu --classic",
        terraform: "sudo snap install terraform --classic",
      };
  }
}
