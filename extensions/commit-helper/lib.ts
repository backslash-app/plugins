// Commit Helper: Conventional Commits types, messages, scopes learned from history, and the gitmoji table.
// Pure, tested in lib_test.ts.

export type Tint = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

export interface CommitType {
  type: string;
  title: string;
  description: string;
  /** Its usual gitmoji (code without colons). */
  gitmoji: string;
  /** More gitmojis that fit, best first. */
  alsoGitmojis: string[];
  tint: Tint;
  icon: string;
  placeholder: string;
}

export const TYPES: CommitType[] = [
  {
    type: "feat",
    title: "Feature",
    description: "A new feature",
    gitmoji: "sparkles",
    alsoGitmojis: ["tada", "lipstick", "chart_with_upwards_trend", "globe_with_meridians", "iphone", "dizzy"],
    tint: "green",
    icon: "bs-sparkle",
    placeholder: "add dark mode to the settings page",
  },
  {
    type: "fix",
    title: "Bug Fix",
    description: "A bug fix",
    gitmoji: "bug",
    alsoGitmojis: ["ambulance", "adhesive_bandage", "lock", "pencil2", "goal_net", "green_heart", "alien"],
    tint: "red",
    icon: "bs-bug",
    placeholder: "handle empty responses from the API",
  },
  {
    type: "docs",
    title: "Documentation",
    description: "Documentation only",
    gitmoji: "memo",
    alsoGitmojis: ["bulb", "page_facing_up", "pencil2", "busts_in_silhouette"],
    tint: "blue",
    icon: "bs-book",
    placeholder: "explain the configuration options",
  },
  {
    type: "refactor",
    title: "Refactor",
    description: "A change that neither fixes a bug nor adds a feature",
    gitmoji: "recycle",
    alsoGitmojis: ["art", "truck", "fire", "coffin", "building_construction", "label"],
    tint: "purple",
    icon: "bs-cycle",
    placeholder: "split the parser into smaller functions",
  },
  {
    type: "perf",
    title: "Performance",
    description: "A change that improves performance",
    gitmoji: "zap",
    alsoGitmojis: ["thread"],
    tint: "orange",
    icon: "bs-bolt",
    placeholder: "cache the parsed configuration",
  },
  {
    type: "test",
    title: "Tests",
    description: "Adding missing tests or correcting existing ones",
    gitmoji: "white_check_mark",
    alsoGitmojis: ["test_tube", "camera_flash", "clown_face"],
    tint: "teal",
    icon: "bs-square-check",
    placeholder: "cover the date parser edge cases",
  },
  {
    type: "build",
    title: "Build",
    description: "The build system or external dependencies",
    gitmoji: "package",
    alsoGitmojis: ["arrow_up", "arrow_down", "heavy_plus_sign", "heavy_minus_sign", "pushpin", "wrench", "bricks"],
    tint: "yellow",
    icon: "bs-package",
    placeholder: "upgrade to TypeScript 6",
  },
  {
    type: "ci",
    title: "Continuous Integration",
    description: "CI configuration files and scripts",
    gitmoji: "construction_worker",
    alsoGitmojis: ["green_heart", "rocket", "wrench"],
    tint: "blue",
    icon: "bs-rocket",
    placeholder: "run the tests on pull requests",
  },
  {
    type: "chore",
    title: "Chore",
    description: "Other changes that don't modify source or test files",
    gitmoji: "wrench",
    alsoGitmojis: ["hammer", "see_no_evil", "bookmark", "rotating_light", "busts_in_silhouette", "page_facing_up"],
    tint: "gray",
    icon: "bs-settings",
    placeholder: "update the editor settings",
  },
  {
    type: "revert",
    title: "Revert",
    description: "Reverts a previous commit",
    gitmoji: "rewind",
    alsoGitmojis: [],
    tint: "pink",
    icon: "bs-history",
    placeholder: '"feat: add dark mode"',
  },
];

export const commitType = (type: string) => TYPES.find((t) => t.type === type);

// ---------------------------------------------------------------------------
// Gitmoji (gitmoji.dev, MIT)

export interface Gitmoji {
  emoji: string;
  code: string;
  description: string;
  /** The version bump it implies, when gitmoji says so. */
  semver?: "major" | "minor" | "patch";
}

const G = (emoji: string, code: string, description: string, semver?: Gitmoji["semver"]): Gitmoji => ({
  emoji,
  code,
  description,
  ...(semver ? { semver } : {}),
});

export const GITMOJIS: Gitmoji[] = [
  G("🎨", "art", "Improve structure / format of the code"),
  G("⚡️", "zap", "Improve performance", "patch"),
  G("🔥", "fire", "Remove code or files"),
  G("🐛", "bug", "Fix a bug", "patch"),
  G("🚑️", "ambulance", "Critical hotfix", "patch"),
  G("✨", "sparkles", "Introduce new features", "minor"),
  G("📝", "memo", "Add or update documentation"),
  G("🚀", "rocket", "Deploy stuff"),
  G("💄", "lipstick", "Add or update the UI and style files", "patch"),
  G("🎉", "tada", "Begin a project"),
  G("✅", "white_check_mark", "Add, update, or pass tests"),
  G("🔒️", "lock", "Fix security or privacy issues", "patch"),
  G("🔐", "closed_lock_with_key", "Add or update secrets"),
  G("🔖", "bookmark", "Release / Version tags"),
  G("🚨", "rotating_light", "Fix compiler / linter warnings"),
  G("🚧", "construction", "Work in progress"),
  G("💚", "green_heart", "Fix CI Build"),
  G("⬇️", "arrow_down", "Downgrade dependencies", "patch"),
  G("⬆️", "arrow_up", "Upgrade dependencies", "patch"),
  G("📌", "pushpin", "Pin dependencies to specific versions", "patch"),
  G("👷", "construction_worker", "Add or update CI build system"),
  G("📈", "chart_with_upwards_trend", "Add or update analytics or track code", "patch"),
  G("♻️", "recycle", "Refactor code"),
  G("➕", "heavy_plus_sign", "Add a dependency", "patch"),
  G("➖", "heavy_minus_sign", "Remove a dependency", "patch"),
  G("🔧", "wrench", "Add or update configuration files", "patch"),
  G("🔨", "hammer", "Add or update development scripts"),
  G("🌐", "globe_with_meridians", "Internationalization and localization", "patch"),
  G("✏️", "pencil2", "Fix typos", "patch"),
  G("💩", "poop", "Write bad code that needs to be improved"),
  G("⏪️", "rewind", "Revert changes", "patch"),
  G("🔀", "twisted_rightwards_arrows", "Merge branches"),
  G("📦️", "package", "Add or update compiled files or packages", "patch"),
  G("👽️", "alien", "Update code due to external API changes", "patch"),
  G("🚚", "truck", "Move or rename resources (e.g.: files, paths, routes)"),
  G("📄", "page_facing_up", "Add or update license"),
  G("💥", "boom", "Introduce breaking changes", "major"),
  G("🍱", "bento", "Add or update assets", "patch"),
  G("♿️", "wheelchair", "Improve accessibility", "patch"),
  G("💡", "bulb", "Add or update comments in source code"),
  G("🍻", "beers", "Write code drunkenly"),
  G("💬", "speech_balloon", "Add or update text and literals", "patch"),
  G("🗃️", "card_file_box", "Perform database related changes", "patch"),
  G("🔊", "loud_sound", "Add or update logs"),
  G("🔇", "mute", "Remove logs"),
  G("👥", "busts_in_silhouette", "Add or update contributor(s)"),
  G("🚸", "children_crossing", "Improve user experience / usability", "patch"),
  G("🏗️", "building_construction", "Make architectural changes"),
  G("📱", "iphone", "Work on responsive design", "patch"),
  G("🤡", "clown_face", "Mock things"),
  G("🥚", "egg", "Add or update an easter egg", "patch"),
  G("🙈", "see_no_evil", "Add or update a .gitignore file"),
  G("📸", "camera_flash", "Add or update snapshots"),
  G("⚗️", "alembic", "Perform experiments", "patch"),
  G("🔍️", "mag", "Improve SEO", "patch"),
  G("🏷️", "label", "Add or update types", "patch"),
  G("🌱", "seedling", "Add or update seed files"),
  G("🚩", "triangular_flag_on_post", "Add, update, or remove feature flags", "patch"),
  G("🥅", "goal_net", "Catch errors", "patch"),
  G("💫", "dizzy", "Add or update animations and transitions", "patch"),
  G("🗑️", "wastebasket", "Deprecate code that needs to be cleaned up", "patch"),
  G("🛂", "passport_control", "Work on code related to authorization, roles and permissions", "patch"),
  G("🩹", "adhesive_bandage", "Simple fix for a non-critical issue", "patch"),
  G("🧐", "monocle_face", "Data exploration/inspection"),
  G("⚰️", "coffin", "Remove dead code"),
  G("🧪", "test_tube", "Add a failing test"),
  G("👔", "necktie", "Add or update business logic", "patch"),
  G("🩺", "stethoscope", "Add or update healthcheck"),
  G("🧱", "bricks", "Infrastructure related changes"),
  G("🧑‍💻", "technologist", "Improve developer experience"),
  G("💸", "money_with_wings", "Add sponsorships or money related infrastructure"),
  G("🧵", "thread", "Add or update code related to multithreading or concurrency"),
  G("🦺", "safety_vest", "Add or update code related to validation"),
  G("✈️", "airplane", "Improve offline support"),
  G("🦖", "t-rex", "Code that adds backwards compatibility"),
];

export const gitmoji = (code: string) => GITMOJIS.find((g) => g.code === code);

/** The type's gitmojis first, then the rest. */
export function gitmojisFor(type: string): Gitmoji[] {
  const t = commitType(type);
  const first = t ? [t.gitmoji, ...t.alsoGitmojis] : [];
  const picked = first.map(gitmoji).filter((g): g is Gitmoji => !!g);
  return [...picked, ...GITMOJIS.filter((g) => !first.includes(g.code))];
}

/** Extra search words for a gitmoji: its code split, and the commit types it fits. */
export function gitmojiKeywords(g: Gitmoji): string[] {
  const types = TYPES.filter((t) => t.gitmoji === g.code || t.alsoGitmojis.includes(g.code)).map((t) => t.type);
  return [...g.code.split(/[_-]/), g.code, ...types, ...(g.semver ? [g.semver] : [])];
}

// ---------------------------------------------------------------------------
// Parsing subjects

export interface Subject {
  type: string;
  scope?: string;
  breaking: boolean;
  description: string;
  /** A leading gitmoji, as an emoji or a :code:. */
  gitmoji?: string;
}

const EMOJI = /^(\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*|:[a-z0-9_+-]+:)\s*/u;

/** `✨ feat(api)!: add x` → its parts; undefined when it isn't a conventional commit. */
export function parseSubject(subject: string): Subject | undefined {
  let s = subject.trim();
  let mark: string | undefined;
  const lead = s.match(EMOJI);
  if (lead) {
    mark = lead[1];
    s = s.slice(lead[0].length);
  }
  const m = s.match(/^([a-zA-Z]+)(?:\(([^()]*)\))?(!)?: +(\S.*)$/);
  if (!m) return undefined;
  return {
    type: m[1].toLowerCase(),
    ...(m[2]?.trim() ? { scope: m[2].trim() } : {}),
    breaking: !!m[3],
    description: m[4].trim(),
    ...(mark ? { gitmoji: mark } : {}),
  };
}

export interface History {
  total: number;
  conventional: number;
  /** How many subjects start with a gitmoji. */
  withGitmoji: number;
  /** Gitmojis written as `:code:` rather than emoji. */
  gitmojiAsCode: number;
  /** Descriptions starting with a lowercase letter, among conventional ones. */
  lowercase: number;
  types: Record<string, number>;
  /** Scopes, most used first. */
  scopes: { scope: string; count: number; types: string[] }[];
}

/** What `git log --format=%s` says about the repository's habits. */
export function learnHistory(subjects: string[]): History {
  const h: History = {
    total: 0,
    conventional: 0,
    withGitmoji: 0,
    gitmojiAsCode: 0,
    lowercase: 0,
    types: {},
    scopes: [],
  };
  const scopes = new Map<string, { count: number; types: Set<string> }>();
  for (const line of subjects) {
    const s = line.trim();
    if (!s) continue;
    h.total++;
    const lead = s.match(EMOJI);
    if (lead) {
      h.withGitmoji++;
      if (lead[1].startsWith(":")) h.gitmojiAsCode++;
    }
    const p = parseSubject(s);
    if (!p || !TYPES.some((t) => t.type === p.type) && !["style", "wip", "release"].includes(p.type)) continue;
    h.conventional++;
    h.types[p.type] = (h.types[p.type] ?? 0) + 1;
    if (/^[a-z]/.test(p.description)) h.lowercase++;
    if (p.scope) {
      for (const scope of p.scope.split(/\s*,\s*/).filter(Boolean)) {
        const e = scopes.get(scope) ?? { count: 0, types: new Set() };
        e.count++;
        e.types.add(p.type);
        scopes.set(scope, e);
      }
    }
  }
  h.scopes = [...scopes.entries()]
    .map(([scope, e]) => ({ scope, count: e.count, types: [...e.types] }))
    .sort((a, b) => b.count - a.count || a.scope.localeCompare(b.scope));
  return h;
}

/** Whether the repository mostly writes gitmojis (to preselect one). */
export const usesGitmoji = (h: History) => h.total >= 5 && h.withGitmoji / h.total >= 0.3;

/** Folders whose children are the natural scopes: `extensions/git-repos/…` → `git-repos`. */
const CONTAINERS = new Set([
  "extensions",
  "packages",
  "apps",
  "crates",
  "libs",
  "lib",
  "modules",
  "services",
  "plugins",
  "components",
  "cmd",
  "internal",
  "pkg",
]);

/** Scope candidates from the staged paths, most touched first. */
export function scopesFromPaths(paths: string[]): { scope: string; files: number }[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    const parts = path.split("/").filter(Boolean);
    if (parts.length < 2) continue;
    let i = parts[0] === "src" && parts.length > 2 ? 1 : 0;
    if (CONTAINERS.has(parts[i]) && parts.length > i + 2) i++;
    const scope = parts[i].replace(/^\./, "");
    if (!scope) continue;
    counts.set(scope, (counts.get(scope) ?? 0) + 1);
  }
  return [...counts.entries()].map(([scope, files]) => ({ scope, files }))
    .sort((a, b) => b.files - a.files || a.scope.localeCompare(b.scope));
}

export interface ScopeSuggestion {
  scope: string;
  /** Why it's suggested: "3 staged files", "used 12 times". */
  reason: string;
  staged: boolean;
}

/** Staged folders first (the likely scope), then the history's scopes. */
export function suggestScopes(staged: string[], history: History, type?: string, max = 25): ScopeSuggestion[] {
  const out: ScopeSuggestion[] = [];
  const seen = new Set<string>();
  const known = new Map(history.scopes.map((s) => [s.scope, s]));
  // Most touched first; on a tie, the one the history knows.
  const fromPaths = scopesFromPaths(staged).sort((a, b) =>
    b.files - a.files || (known.get(b.scope)?.count ?? 0) - (known.get(a.scope)?.count ?? 0)
  );
  for (const { scope, files } of fromPaths) {
    seen.add(scope);
    const used = known.get(scope)?.count;
    out.push({
      scope,
      reason: `${files} staged file${files === 1 ? "" : "s"}${
        used ? `, used ${used} time${used === 1 ? "" : "s"}` : ""
      }`,
      staged: true,
    });
  }
  // Scopes used with this type come first among the rest.
  const rest = [...history.scopes].sort((a, b) =>
    Number(!!type && b.types.includes(type)) - Number(!!type && a.types.includes(type)) || b.count - a.count
  );
  for (const s of rest) {
    if (seen.has(s.scope)) continue;
    seen.add(s.scope);
    out.push({ scope: s.scope, reason: `used ${s.count} time${s.count === 1 ? "" : "s"}`, staged: false });
  }
  return out.slice(0, max);
}

// ---------------------------------------------------------------------------
// Building messages

export interface Draft {
  type: string;
  scope?: string;
  description: string;
  body?: string;
  breaking?: boolean;
  /** What breaks: becomes the `BREAKING CHANGE:` footer. */
  breakingNote?: string;
  /** One per line: `Closes #12`, `Co-authored-by: …`. */
  footers?: string;
  /** Gitmoji code (without colons). */
  gitmoji?: string;
  gitmojiStyle?: "emoji" | "code";
}

/** Wraps prose paragraphs at `width`; lists, quotes, indented and long-word lines are kept. */
export function wrap(text: string, width = 72): string {
  return text.replace(/\r\n?/g, "\n").split("\n").map((line) => {
    if (line.length <= width || /^\s*([-*+>]|\d+[.)])\s|^\s{2,}|^```/.test(line)) return line;
    const out: string[] = [];
    let cur = "";
    for (const word of line.split(/ +/)) {
      if (cur && cur.length + 1 + word.length > width) {
        out.push(cur);
        cur = word;
      } else cur = cur ? `${cur} ${word}` : word;
    }
    if (cur) out.push(cur);
    return out.join("\n");
  }).join("\n");
}

export function header(d: Draft): string {
  const g = d.gitmoji ? gitmoji(d.gitmoji) : undefined;
  const mark = g ? `${d.gitmojiStyle === "code" ? `:${g.code}:` : g.emoji} ` : "";
  const scope = d.scope?.trim() ? `(${d.scope.trim()})` : "";
  return `${mark}${d.type}${scope}${d.breaking ? "!" : ""}: ${d.description.trim()}`;
}

/** Normalizes footers to `Token: value` / `Token #value` lines. */
export function footerLines(text: string | undefined): string[] {
  return (text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    // "closes #12" → "Closes #12"
    const ref = l.match(/^(close[sd]?|fix(e[sd])?|resolve[sd]?|refs?|see)\s*:?\s*(#\d+.*)$/i);
    if (ref) return `${ref[1][0].toUpperCase()}${ref[1].slice(1).toLowerCase()} ${ref[3]}`;
    return l;
  });
}

export function buildMessage(d: Draft): string {
  const parts = [header(d)];
  const body = d.body?.trim();
  if (body) parts.push(wrap(body));
  const footers = footerLines(d.footers);
  if (d.breaking && d.breakingNote?.trim()) footers.unshift(`BREAKING CHANGE: ${d.breakingNote.trim()}`);
  if (footers.length) parts.push(footers.join("\n"));
  return parts.join("\n\n") + "\n";
}

export interface Warning {
  text: string;
  level: "error" | "warning";
}

export function lint(d: Draft, history?: History): Warning[] {
  const w: Warning[] = [];
  const desc = d.description.trim();
  if (!desc) w.push({ text: "The description is empty", level: "error" });
  const h = header(d);
  if ([...h].length > 72) {
    w.push({ text: `The subject is ${[...h].length} characters: 72 at most reads best`, level: "warning" });
  } else if ([...h].length > 50) {
    w.push({ text: `The subject is ${[...h].length} characters: 50 or fewer is ideal`, level: "warning" });
  }
  if (/[.。]$/.test(desc)) w.push({ text: "The description shouldn't end with a period", level: "warning" });
  if (d.scope && /\s/.test(d.scope.trim())) w.push({ text: "Scopes usually have no spaces", level: "warning" });
  const mostlyLower = !history || history.conventional < 5 || history.lowercase / history.conventional >= 0.6;
  if (/^[A-Z][a-z]/.test(desc) && mostlyLower) {
    w.push({ text: "Descriptions usually start with a lowercase letter", level: "warning" });
  }
  if (/^(added|adds|fixed|fixes|updated|updates|removed|removes)\b/i.test(desc)) {
    w.push({ text: "Use the imperative mood: “add”, not “added” or “adds”", level: "warning" });
  }
  if (d.breaking && !d.breakingNote?.trim()) {
    w.push({ text: "Say what breaks in “What breaks” (the BREAKING CHANGE footer)", level: "warning" });
  }
  if (d.type === "revert" && !/\b[0-9a-f]{7,40}\b/.test(`${d.body ?? ""} ${d.footers ?? ""}`)) {
    w.push({ text: "Mention the reverted commit: “This reverts commit <hash>.”", level: "warning" });
  }
  return w;
}

// ---------------------------------------------------------------------------
// git output

export interface Shortstat {
  files: number;
  insertions: number;
  deletions: number;
}

/** ` 3 files changed, 10 insertions(+), 2 deletions(-)` */
export function parseShortstat(out: string): Shortstat {
  const n = (re: RegExp) => Number(out.match(re)?.[1] ?? 0);
  return {
    files: n(/(\d+) files? changed/),
    insertions: n(/(\d+) insertions?\(\+\)/),
    deletions: n(/(\d+) deletions?\(-\)/),
  };
}

/** NUL-separated `git diff --cached --name-only -z`. */
export const parseNames = (out: string) => out.split("\0").map((s) => s.trim()).filter(Boolean);

/** A POSIX shell word. */
export const shellQuote = (s: string) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;

/** `git commit -m 'subject' -m 'body'…`, one -m per paragraph. */
export function commitCommand(message: string): string {
  const paragraphs = message.trim().split(/\n{2,}/);
  return ["git commit", ...paragraphs.map((p) => `-m ${shellQuote(p)}`)].join(" ");
}

// ---------------------------------------------------------------------------
// Finding repositories (the same scan as the Git Repos extension)

export const DEFAULT_FOLDERS = "~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/git, ~/repos, ~/workspace";

export function parseFolders(pref: string | undefined, home: string): string[] {
  const raw = (pref?.trim() || DEFAULT_FOLDERS).split(/[,:\n]/).map((f) => f.trim()).filter(Boolean);
  const expanded = raw.map((f) => f.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "") || "/");
  return [...new Set(expanded)].filter((f) => f.startsWith("/"));
}

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

export function reposFromFind(out: string): string[] {
  return [
    ...new Set(out.split("\n").map((l) => l.trim()).filter((l) => l.endsWith("/.git")).map((l) => l.slice(0, -5))),
  ].sort((a, b) => a.localeCompare(b));
}

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

export interface RepoState {
  path: string;
  staged: number;
  /** Unix seconds of the last commit (0 for none). */
  lastCommit: number;
}

/** The repository to start with: the last one used if it has staged changes, else the most recent with some. */
export function pickRepo(repos: RepoState[], lastUsed?: string): RepoState | undefined {
  const last = repos.find((r) => r.path === lastUsed);
  if (last && last.staged) return last;
  const staged = repos.filter((r) => r.staged).sort((a, b) => b.lastCommit - a.lastCommit);
  return staged[0] ?? last ?? [...repos].sort((a, b) => b.lastCommit - a.lastCommit)[0];
}

export function installCommand(osRelease: string): string {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "sudo pacman -S git";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "sudo apt install git";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "sudo dnf install git";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "sudo zypper install git";
  if (ids.includes("alpine")) return "sudo apk add git";
  if (ids.includes("nixos")) return "nix-env -iA nixos.git";
  return "Install git with your package manager";
}
