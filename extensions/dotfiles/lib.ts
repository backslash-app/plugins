// Parsing for chezmoi, yadm, bare git repositories and GNU Stow, and the commands they take.

export type Backend = "chezmoi" | "yadm" | "bare" | "stow";

export const BACKEND_TITLES: Record<Backend, string> = {
  chezmoi: "chezmoi",
  yadm: "yadm",
  bare: "Bare Git Repository",
  stow: "GNU Stow",
};

export type FileState =
  | "modified"
  | "added"
  | "deleted"
  | "renamed"
  | "untracked"
  | "conflict"
  | "typechange"
  // chezmoi: what `chezmoi apply` would do, and scripts that would run.
  | "apply-add"
  | "apply-delete"
  | "apply-modify"
  | "script"
  | "clean";

export interface DotFile {
  backend: Backend;
  /** Absolute path in the home folder. */
  path: string;
  state: FileState;
  /** git: the change is staged. */
  staged?: boolean;
  /** chezmoi: the file was changed by hand since chezmoi last wrote it. */
  localEdit?: boolean;
  /** git renames: the old path. */
  from?: string;
}

export const STATE_LABELS: Record<FileState, string> = {
  modified: "Modified",
  added: "Added",
  deleted: "Deleted",
  renamed: "Renamed",
  untracked: "Untracked",
  conflict: "Conflict",
  typechange: "Type changed",
  "apply-add": "Not applied",
  "apply-delete": "To delete",
  "apply-modify": "Out of date",
  script: "Script pending",
  clean: "Up to date",
};

/** Order of the rows: what needs attention first. */
const RANK: Record<FileState, number> = {
  conflict: 0,
  modified: 1,
  added: 2,
  deleted: 3,
  renamed: 4,
  typechange: 5,
  "apply-modify": 6,
  "apply-add": 7,
  "apply-delete": 8,
  script: 9,
  untracked: 10,
  clean: 11,
};

export function sortFiles(files: DotFile[]): DotFile[] {
  return [...files].sort((a, b) =>
    RANK[a.state] - RANK[b.state] || (a.localEdit === b.localEdit ? 0 : a.localEdit ? -1 : 1) ||
    a.path.localeCompare(b.path)
  );
}

export const changed = (f: DotFile) => f.state !== "clean";

export function joinHome(home: string, rel: string): string {
  return rel.startsWith("/") ? rel : `${home}/${rel.replace(/^\.\//, "")}`;
}

export function tildify(path: string, home: string): string {
  return home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;
}

export function expandHome(path: string, home: string): string {
  return path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
}

// --- git -------------------------------------------------------------------------------

export interface GitBranch {
  branch?: string;
  upstream?: string;
  ahead: number;
  behind: number;
  /** No commit yet. */
  empty?: boolean;
  detached?: boolean;
}

export interface GitStatus {
  branch: GitBranch;
  files: { x: string; y: string; path: string; from?: string }[];
}

/** git's quoted paths: `"caf\303\251.txt"` → `café.txt`. */
export function unquoteGitPath(p: string): string {
  if (!p.startsWith('"') || !p.endsWith('"')) return p;
  const inner = p.slice(1, -1);
  const bytes: number[] = [];
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c !== "\\") {
      bytes.push(...new TextEncoder().encode(c));
      continue;
    }
    const n = inner[++i];
    if (/[0-7]/.test(n)) {
      bytes.push(parseInt(inner.slice(i, i + 3), 8));
      i += 2;
    } else bytes.push(({ n: 10, t: 9, r: 13, '"': 34, "\\": 92 } as Record<string, number>)[n] ?? n.charCodeAt(0));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** `git status --porcelain=v1 --branch`. */
export function parseGitStatus(text: string): GitStatus {
  const branch: GitBranch = { ahead: 0, behind: 0 };
  const files: GitStatus["files"] = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("## ")) {
      const head = line.slice(3);
      const noCommits = head.match(/^No commits yet on (.+)$/) ?? head.match(/^Initial commit on (.+)$/);
      if (noCommits) {
        branch.branch = noCommits[1];
        branch.empty = true;
        continue;
      }
      if (head.startsWith("HEAD (no branch)")) {
        branch.detached = true;
        continue;
      }
      const m = head.match(/^(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/);
      if (m) {
        branch.branch = m[1];
        branch.upstream = m[2];
        for (const part of (m[3] ?? "").split(", ")) {
          const n = part.match(/^(ahead|behind) (\d+)$/);
          if (n) branch[n[1] as "ahead" | "behind"] = Number(n[2]);
        }
      }
      continue;
    }
    if (line.length < 4) continue;
    const x = line[0], y = line[1];
    const rest = line.slice(3);
    const arrow = rest.match(/^(".*?(?<!\\)"|.+?) -> (.+)$/);
    if (arrow && (x === "R" || x === "C")) {
      files.push({ x, y, from: unquoteGitPath(arrow[1]), path: unquoteGitPath(arrow[2]) });
    } else files.push({ x, y, path: unquoteGitPath(rest) });
  }
  return { branch, files };
}

/** One file's state from its two status letters. */
export function gitState(x: string, y: string): { state: FileState; staged: boolean } {
  if (x === "?" && y === "?") return { state: "untracked", staged: false };
  if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
    return { state: "conflict", staged: false };
  }
  const letter = y !== " " ? y : x;
  const staged = y === " " && x !== " ";
  const state: FileState = letter === "M"
    ? "modified"
    : letter === "A"
    ? "added"
    : letter === "D"
    ? "deleted"
    : letter === "R" || letter === "C"
    ? "renamed"
    : letter === "T"
    ? "typechange"
    : "modified";
  return { state, staged };
}

/** Tracked files (from `ls-files`) merged with their status; paths are relative to `root`. */
export function gitFiles(backend: Backend, root: string, lsFiles: string, status: GitStatus): DotFile[] {
  const byPath = new Map<string, DotFile>();
  for (const rel of lsFiles.split("\n").map((l) => unquoteGitPath(l.trim())).filter(Boolean)) {
    byPath.set(rel, { backend, path: joinHome(root, rel), state: "clean" });
  }
  for (const f of status.files) {
    const { state, staged } = gitState(f.x, f.y);
    byPath.set(f.path, {
      backend,
      path: joinHome(root, f.path),
      state,
      staged,
      ...(f.from ? { from: joinHome(root, f.from) } : {}),
    });
  }
  return [...byPath.values()];
}

export interface Commit {
  hash: string;
  when: string;
  subject: string;
}

export const LOG_FORMAT = "--format=%h%x09%cr%x09%s";

/** `git log --format=%h%x09%cr%x09%s`. */
export function parseLog(text: string): Commit[] {
  return text.split("\n").filter(Boolean).map((l) => {
    const [hash, when, ...subject] = l.split("\t");
    return { hash, when, subject: subject.join("\t") };
  });
}

/** `## main...origin/main [ahead 1]` in words. */
export function branchSummary(b: GitBranch): string {
  if (b.empty) return `${b.branch ?? "?"} · no commit yet`;
  if (b.detached) return "Detached HEAD";
  const parts = [b.branch ?? "?"];
  if (!b.upstream) parts.push("not pushed anywhere");
  if (b.ahead) parts.push(`${b.ahead} to push`);
  if (b.behind) parts.push(`${b.behind} to pull`);
  if (b.upstream && !b.ahead && !b.behind) parts.push("in sync");
  return parts.join(" · ");
}

// --- chezmoi -----------------------------------------------------------------------------

/**
 * `chezmoi status`: two columns then the path relative to the home folder.
 * The first column is what changed since chezmoi last wrote the file (an edit
 * by hand), the second what `chezmoi apply` would do.
 */
export function parseChezmoiStatus(text: string, home: string): DotFile[] {
  const out: DotFile[] = [];
  for (const line of text.split("\n")) {
    if (line.length < 4) continue;
    const a = line[0], b = line[1];
    const rel = line.slice(3);
    const localEdit = a !== " ";
    let state: FileState;
    if (b === "R" || a === "R") state = "script";
    else if (localEdit) state = a === "D" ? "deleted" : a === "A" ? "added" : "modified";
    else if (b === "A") state = "apply-add";
    else if (b === "D") state = "apply-delete";
    else if (b === "M") state = "apply-modify";
    else continue;
    out.push({ backend: "chezmoi", path: joinHome(home, rel), state, localEdit });
  }
  return out;
}

/** `chezmoi managed --path-style=absolute` merged with `chezmoi status`. */
export function chezmoiFiles(managed: string, status: DotFile[]): DotFile[] {
  const byPath = new Map<string, DotFile>();
  for (const p of managed.split("\n").map((l) => l.trim()).filter(Boolean)) {
    byPath.set(p, { backend: "chezmoi", path: p, state: "clean" });
  }
  for (const f of status) byPath.set(f.path, f);
  return [...byPath.values()];
}

// --- Stow ---------------------------------------------------------------------------------

export interface StowOptions {
  /** Where packages link to: `--target`, by default the stow folder's parent. */
  target: string;
  /** `--dotfiles`: `dot-bashrc` in a package is `.bashrc` in the target. */
  dotfiles: boolean;
  ignore: string[];
}

/** `.stowrc`: one option per line or several on a line, `~` and `$HOME` expanded. */
export function parseStowrc(text: string, stowDir: string, home: string): StowOptions {
  const o: StowOptions = { target: parentDir(stowDir), dotfiles: false, ignore: [] };
  const words = text.split("\n").map((l) => l.replace(/#.*$/, "").trim()).filter(Boolean).flatMap((l) =>
    l.split(/\s+/)
  );
  const expand = (v: string) => expandHome(v.replace(/^\$HOME/, home).replace(/^"(.*)"$/, "$1"), home);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const value = (name: string, short: string) => {
      if (w.startsWith(`--${name}=`)) return w.slice(name.length + 3);
      if (w === `--${name}` || w === `-${short}`) return words[++i];
      if (short && w.startsWith(`-${short}`) && w.length > 2) return w.slice(2);
      return undefined;
    };
    const target = value("target", "t");
    if (target !== undefined) {
      o.target = expand(target);
      continue;
    }
    const ignore = value("ignore", "");
    if (ignore !== undefined) {
      o.ignore.push(ignore);
      continue;
    }
    if (w === "--dotfiles") o.dotfiles = true;
  }
  return o;
}

export function parentDir(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i <= 0 ? "/" : trimmed.slice(0, i);
}

/** Where a package file lands: `vim/dot-vimrc` → `~/.vimrc` with `--dotfiles`. */
export function stowTarget(relInPackage: string, o: StowOptions): string {
  const parts = relInPackage.split("/").map((p) => o.dotfiles && p.startsWith("dot-") ? `.${p.slice(4)}` : p);
  return `${o.target}/${parts.join("/")}`;
}

/** Folders of the stow directory that are not packages. */
export const STOW_SKIP = /^(\..*|README.*|LICENSE.*|Makefile|install(\.sh)?|bootstrap(\.sh)?|scripts?)$/i;

export type LinkState = "linked" | "missing" | "conflict" | "foreign";

export interface StowPackage {
  name: string;
  files: { source: string; target: string; state: LinkState }[];
}

export function packageState(p: StowPackage): "linked" | "partial" | "unlinked" | "conflict" {
  const linked = p.files.filter((f) => f.state === "linked").length;
  if (p.files.some((f) => f.state === "conflict")) return "conflict";
  if (linked === p.files.length && linked > 0) return "linked";
  return linked ? "partial" : "unlinked";
}

export function stowArgs(stowDir: string, o: StowOptions, op: "stow" | "restow" | "delete", pkg: string): string[] {
  return [
    "--dir",
    stowDir,
    "--target",
    o.target,
    ...(o.dotfiles ? ["--dotfiles"] : []),
    ...(op === "restow" ? ["--restow"] : op === "delete" ? ["--delete"] : ["--stow"]),
    "--verbose=1",
    pkg,
  ];
}

/** Stow's refusal in words: `* existing target is neither a link nor a directory: .bashrc`. */
export function stowError(stderr: string): string {
  const conflicts = [
    ...stderr.matchAll(/existing target is (?:neither a link nor a directory|not owned by stow): (.+)/g),
  ]
    .map((m) => m[1].trim());
  if (conflicts.length) {
    return `Files already exist: ${conflicts.slice(0, 3).join(", ")}${
      conflicts.length > 3 ? ` and ${conflicts.length - 3} more` : ""
    }. Move them away or adopt them (stow --adopt)`;
  }
  return stderr.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "stow failed";
}

// --- Diffs and scripts ------------------------------------------------------------------

export function diffMarkdown(diff: string, max = 60_000): string {
  if (!diff.trim()) return "No difference.";
  const cut = diff.length > max ? diff.slice(0, diff.lastIndexOf("\n", max)) : diff;
  return "```diff\n" + cut.replaceAll("```", "``​`") + "\n```" +
    (cut.length < diff.length ? "\n\n*Cut: open the diff in a terminal for the rest.*" : "");
}

/** `+12 −3` for a diff. */
export function diffStat(diff: string): { added: number; removed: number } {
  let added = 0, removed = 0;
  for (const l of diff.split("\n")) {
    if (l.startsWith("+") && !l.startsWith("+++")) added++;
    else if (l.startsWith("-") && !l.startsWith("---")) removed++;
  }
  return { added, removed };
}

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/** Runs commands one after the other in a terminal, stopping at the first failure, then waits for Enter. */
export function terminalScript(title: string, commands: string[][]): string[] {
  return [
    "sh",
    "-c",
    [
      `echo ${quote(title)}`,
      "echo",
      commands.map(shellLine).join(" && "),
      "status=$?",
      "echo",
      `if [ "$status" -eq 0 ]; then echo 'Done.'; else echo "Stopped (exit $status)."; fi`,
      "printf 'Press Enter to close this window.'",
      "read -r _",
    ].join("\n"),
  ];
}

/** Opens a file in the user's editor, in a terminal. */
export function editorScript(path: string): string[] {
  return ["sh", "-c", 'exec "${VISUAL:-${EDITOR:-nano}}" "$1"', "sh", path];
}
