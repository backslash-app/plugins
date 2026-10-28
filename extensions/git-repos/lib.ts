// Git output parsing, remote URLs and folder settings. Pure, tested in lib_test.ts.

export interface Status {
  /** Branch name; undefined when HEAD is detached. */
  branch?: string;
  /** Commit hash, undefined in a repository without commits. */
  oid?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  /** Files with staged changes. */
  staged: number;
  /** Tracked files changed but not staged. */
  modified: number;
  untracked: number;
  conflicts: number;
  stashes: number;
}

/** `git status --porcelain=v2 --branch --show-stash`. */
export function parseStatus(out: string): Status {
  const s: Status = { ahead: 0, behind: 0, staged: 0, modified: 0, untracked: 0, conflicts: 0, stashes: 0 };
  for (const line of out.split("\n")) {
    if (line.startsWith("# branch.oid ")) {
      const oid = line.slice(13).trim();
      s.oid = oid === "(initial)" ? undefined : oid;
    } else if (line.startsWith("# branch.head ")) {
      const head = line.slice(14).trim();
      s.branch = head === "(detached)" ? undefined : head;
    } else if (line.startsWith("# branch.upstream ")) s.upstream = line.slice(18).trim();
    else if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+) -(\d+)/);
      if (m) [s.ahead, s.behind] = [Number(m[1]), Number(m[2])];
    } else if (line.startsWith("# stash ")) s.stashes = Number(line.slice(8)) || 0;
    else if (line.startsWith("1 ") || line.startsWith("2 ")) {
      // `1 XY …`: X is the index (staged), Y the work tree.
      const [x, y] = [line[2], line[3]];
      if (x !== ".") s.staged++;
      if (y !== ".") s.modified++;
    } else if (line.startsWith("u ")) s.conflicts++;
    else if (line.startsWith("? ")) s.untracked++;
  }
  return s;
}

/** Files that differ from HEAD in any way (staged, modified, untracked or conflicting). */
export function changedFiles(out: string): number {
  return out.split("\n").filter((l) => /^[12u?] /.test(l)).length;
}

export const isDirty = (s: Status) => s.staged + s.modified + s.untracked + s.conflicts > 0;

export interface Commit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  email: string;
  /** Unix seconds. */
  time: number;
  /** `HEAD -> main, origin/main, tag: v1.0`. */
  refs: string[];
  body: string;
}

/** The `--format` that {@link parseLog} reads. */
export const LOG_FORMAT = "%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%ct%x1f%D%x1f%b%x1e";

export function parseLog(out: string): Commit[] {
  return out.split("\x1e").map((r) => r.replace(/^\n/, "")).filter((r) => r.trim()).map((record) => {
    const [hash, short, subject, author, email, time, refs, body] = record.split("\x1f");
    return {
      hash,
      short,
      subject,
      author,
      email,
      time: Number(time),
      refs: (refs ?? "").split(",").map((r) => r.trim()).filter(Boolean),
      body: (body ?? "").trim(),
    };
  });
}

/** `git config --get-regexp ^remote\..*\.url$` → the origin's URL, else the first remote's. */
export function pickRemote(out: string): { name: string; url: string } | undefined {
  const remotes = out.split("\n").map((l) => l.match(/^remote\.(.+)\.url\s+(.+)$/)).filter((m): m is RegExpMatchArray =>
    !!m
  )
    .map((m) => ({ name: m[1], url: m[2].trim() }));
  return remotes.find((r) => r.name === "origin") ?? remotes[0];
}

/** `git@github.com:me/app.git`, `ssh://git@host:2222/me/app`, `https://user@host/me/app.git` → the web page. */
export function remotePage(remote: string): string | undefined {
  const r = remote.trim();
  if (!/^[a-z+]+:\/\//i.test(r)) {
    // scp-like `user@host:path`; anything else is a local path.
    const scp = r.match(/^(?:[^@/]+@)?([^:/]+):(.+?)(?:\.git)?\/?$/);
    return scp ? `https://${scp[1]}/${scp[2].replace(/^\/+/, "")}` : undefined;
  }
  const ssh = r.match(/^(?:ssh|git\+ssh):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+?)(?:\.git)?\/?$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  const git = r.match(/^git:\/\/([^/]+)\/(.+?)(?:\.git)?\/?$/);
  if (git) return `https://${git[1]}/${git[2]}`;
  const https = r.match(/^(https?):\/\/(?:[^@/]+@)?(.+?)(?:\.git)?\/?$/);
  return https ? `${https[1]}://${https[2]}` : undefined;
}

/** A commit's page on the usual forges. */
export function commitUrl(page: string, hash: string): string {
  if (/bitbucket\.org/.test(page)) return `${page}/commits/${hash}`;
  if (/gitlab/.test(page)) return `${page}/-/commit/${hash}`;
  return `${page}/commit/${hash}`;
}

/** A branch's page on the usual forges. */
export function branchUrl(page: string, branch: string): string {
  const b = branch.split("/").map(encodeURIComponent).join("/");
  if (/bitbucket\.org/.test(page)) return `${page}/src/${b}`;
  if (/gitlab/.test(page)) return `${page}/-/tree/${b}`;
  if (/codeberg\.org|gitea|forgejo/.test(page)) return `${page}/src/branch/${b}`;
  return `${page}/tree/${b}`;
}

export const DEFAULT_FOLDERS = "~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/git, ~/repos, ~/workspace";

/** The folders preference: commas, colons or new lines; `~` expanded; duplicates dropped. */
export function parseFolders(pref: string | undefined, home: string): string[] {
  const raw = (pref?.trim() || DEFAULT_FOLDERS).split(/[,:\n]/).map((f) => f.trim()).filter(Boolean);
  const expanded = raw.map((f) => f.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "") || "/");
  return [...new Set(expanded)].filter((f) => f.startsWith("/"));
}

/** Directories never worth descending into. */
const SKIP = ["node_modules", "vendor", "target", ".venv", "venv", "__pycache__", "build", "dist", ".cache"];

/** `find` arguments listing the `.git` entries at most `depth` folders below the roots. */
export function findArgs(roots: string[], depth: number): string[] {
  const skip = SKIP.flatMap((name, i) => [...(i ? ["-o"] : []), "-name", name]);
  return [
    ...roots,
    "-mindepth",
    "1",
    "-maxdepth",
    String(Math.max(1, Math.min(8, Math.round(depth))) + 1),
    "(",
    ...skip,
    "-o",
    "(",
    "-name",
    ".*",
    "!",
    "-name",
    ".git",
    ")",
    ")",
    "-prune",
    "-o",
    "-name",
    ".git",
    "-print",
    "-prune",
  ];
}

/** `find` output → repository folders, sorted, without nested duplicates of the same path. */
export function reposFromFind(out: string): string[] {
  return [
    ...new Set(out.split("\n").map((l) => l.trim()).filter((l) => l.endsWith("/.git")).map((l) => l.slice(0, -5))),
  ]
    .sort((a, b) => a.localeCompare(b));
}

/** The configured folder a repository was found in. */
export const rootOf = (path: string, roots: string[]) =>
  roots.filter((r) => path === r || path.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0];

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

/** "2 staged, 3 modified, 1 untracked". */
export function changeSummary(s: Status): string {
  const parts = [
    s.conflicts && `${s.conflicts} conflicted`,
    s.staged && `${s.staged} staged`,
    s.modified && `${s.modified} modified`,
    s.untracked && `${s.untracked} untracked`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "Clean";
}

/** Branch names from `git branch --format=%(refname:short)`. */
export const parseBranches = (out: string) =>
  out.split("\n").map((b) => b.trim()).filter((b) => b && !b.startsWith("("));

/** `/etc/os-release` → how to install git. */
export function installCommand(osRelease: string): string {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "sudo pacman -S git";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "sudo apt install git";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "sudo dnf install git";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "sudo zypper install git";
  if (ids.includes("alpine")) return "sudo apk add git";
  if (ids.includes("void")) return "sudo xbps-install git";
  if (ids.includes("nixos")) return "nix-env -iA nixos.git";
  return "Install git with your package manager";
}
