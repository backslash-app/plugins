// Conventional Commits to a Markdown changelog, the next semantic version, CHANGELOG.md insertion,
// remotes and the repository scan rules. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// git log

/** `git log` fields separated by US (0x1f), commits by RS (0x1e). */
export const LOG_FORMAT = "%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1f%b%x1e";

export interface Commit {
  hash: string;
  short: string;
  author: string;
  date: string;
  subject: string;
  body: string;
}

export function parseLog(out: string): Commit[] {
  return out.split("\x1e").map((r) => r.replace(/^\n+/, "")).filter((r) => r.trim()).map((r) => {
    const [hash, short, author, date, subject, body] = r.split("\x1f");
    return { hash, short, author, date, subject: subject ?? "", body: (body ?? "").trim() };
  }).filter((c) => /^[0-9a-f]{7,64}$/.test(c.hash));
}

// ---------------------------------------------------------------------------
// Conventional Commits

export interface Change {
  commit: Commit;
  /** `feat`, `fix`… or `other` for a subject that isn't a Conventional Commit. */
  type: string;
  scope?: string;
  description: string;
  breaking: boolean;
  /** What `BREAKING CHANGE:` says, or the description for `feat!:`. */
  breakingNote?: string;
  /** `#123` and `!45` mentioned in the subject. */
  refs: string[];
}

/** A leading gitmoji, as an emoji or a `:code:`, is not part of the type. */
const GITMOJI = /^(?::[a-z0-9_+-]+:|\p{Extended_Pictographic}️?)\s*/u;
const HEADER = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?:\s+(.+)$/;
const BREAKING_FOOTER = /^BREAKING[ -]CHANGES?:\s*([\s\S]+?)(?:\n\n|\n[A-Za-z-]+(?:: | #)|$)/m;

export function parseChange(c: Commit): Change {
  const subject = c.subject.replace(GITMOJI, "").trim();
  const m = HEADER.exec(subject);
  const footer = BREAKING_FOOTER.exec(c.body);
  const refs = [...subject.matchAll(/(?:^|[\s(])([#!]\d+)\b/g)].map((x) => x[1]);
  if (!m) {
    return {
      commit: c,
      type: "other",
      description: subject,
      breaking: Boolean(footer),
      breakingNote: footer?.[1].trim(),
      refs,
    };
  }
  const breaking = Boolean(m[3] || footer);
  return {
    commit: c,
    type: m[1].toLowerCase(),
    scope: m[2]?.trim() || undefined,
    description: m[4].trim(),
    breaking,
    breakingNote: breaking ? (footer?.[1].trim().replace(/\s*\n\s*/g, " ") ?? m[4].trim()) : undefined,
    refs,
  };
}

export const SECTIONS: { title: string; types: string[] }[] = [
  { title: "Features", types: ["feat", "feature"] },
  { title: "Bug Fixes", types: ["fix", "bugfix", "hotfix"] },
  { title: "Performance", types: ["perf"] },
  { title: "Reverts", types: ["revert"] },
  { title: "Refactoring", types: ["refactor"] },
  { title: "Documentation", types: ["docs", "doc"] },
  { title: "Tests", types: ["test", "tests"] },
  { title: "Build and CI", types: ["build", "ci"] },
  { title: "Style", types: ["style"] },
  { title: "Chores", types: ["chore"] },
  { title: "Other Changes", types: ["other"] },
];

export const sectionOf = (type: string) => SECTIONS.find((s) => s.types.includes(type))?.title ?? "Other Changes";

/** Subjects that never belong in release notes: merges, release bumps, fixups. */
export function isNoise(c: Commit): boolean {
  const s = c.subject;
  return /^Merge (branch|pull request|remote-tracking branch|tag) /.test(s) ||
    /^(fixup|squash|amend)! /.test(s) ||
    /^chore\(release\):|^chore: (release|bump version)/i.test(s) ||
    /^(v?\d+\.\d+\.\d+(-[\w.]+)?|Release v?\d+\.\d+\.\d+.*|Bump version.*)$/i.test(s);
}

export interface Notes {
  changes: Change[];
  /** Section title → changes, in the order of `SECTIONS`. */
  groups: [string, Change[]][];
  breaking: Change[];
  skipped: number;
}

export interface GroupOptions {
  /** Leave chores, style, tests, build and CI out. */
  hideMinor?: boolean;
}

const MINOR_SECTIONS = new Set(["Chores", "Style", "Tests", "Build and CI"]);

export function groupCommits(commits: Commit[], o: GroupOptions = {}): Notes {
  const changes = commits.filter((c) => !isNoise(c)).map(parseChange);
  const groups: [string, Change[]][] = [];
  for (const s of SECTIONS) {
    if (o.hideMinor && MINOR_SECTIONS.has(s.title)) continue;
    const list = changes.filter((c) => sectionOf(c.type) === s.title);
    if (list.length) groups.push([s.title, list]);
  }
  return {
    changes,
    groups,
    breaking: changes.filter((c) => c.breaking),
    skipped: commits.length - changes.length,
  };
}

// ---------------------------------------------------------------------------
// Versions

export interface Version {
  /** What comes before the numbers: `v`, `release-`, `my-lib@`. */
  prefix: string;
  major: number;
  minor: number;
  patch: number;
  pre?: string;
}

export function parseVersion(tag: string): Version | undefined {
  const m = /^(.*?)(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag.trim());
  if (!m || /\d$/.test(m[1])) return undefined;
  return { prefix: m[1], major: +m[2], minor: +m[3], patch: +(m[4] ?? 0), pre: m[5] };
}

export const formatVersion = (v: Version, withPrefix = true) =>
  `${withPrefix ? v.prefix : ""}${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ""}`;

export type Bump = "major" | "minor" | "patch";

export function bump(v: Version, kind: Bump): Version {
  // A prerelease of x.y.z is released as x.y.z when the bump doesn't go further.
  if (v.pre) {
    const released = { ...v, pre: undefined };
    if (kind === "patch") return released;
    if (kind === "minor" && v.patch === 0) return released;
    if (kind === "major" && v.patch === 0 && v.minor === 0) return released;
  }
  if (kind === "major") return { prefix: v.prefix, major: v.major + 1, minor: 0, patch: 0 };
  if (kind === "minor") return { prefix: v.prefix, major: v.major, minor: v.minor + 1, patch: 0 };
  return { prefix: v.prefix, major: v.major, minor: v.minor, patch: v.patch + 1 };
}

export interface Suggestion {
  kind: Bump;
  reason: string;
  next: Version;
}

/**
 * The next version as Conventional Commits mean it: a breaking change is a
 * major (a minor before 1.0.0), a feature a minor, anything else a patch.
 */
export function suggest(current: Version | undefined, notes: Notes): Suggestion {
  const base = current ?? { prefix: "v", major: 0, minor: 0, patch: 0 };
  const feats = notes.changes.filter((c) => sectionOf(c.type) === "Features").length;
  let kind: Bump, reason: string;
  if (notes.breaking.length) {
    kind = base.major === 0 ? "minor" : "major";
    reason = `${plural(notes.breaking.length, "breaking change")}${base.major === 0 ? " (before 1.0.0: a minor)" : ""}`;
  } else if (feats) {
    kind = "minor";
    reason = plural(feats, "new feature");
  } else {
    kind = "patch";
    reason = notes.changes.length ? "Fixes and other changes only" : "No change";
  }
  if (!current) {
    return { kind: "minor", reason: "First release", next: { prefix: "v", major: 0, minor: 1, patch: 0 } };
  }
  return { kind, reason, next: bump(current, kind) };
}

/** The newest version-looking tags first (`git tag --sort=-v:refname` gives them that way already). */
export const versionTags = (tags: string[]) => tags.filter((t) => parseVersion(t) !== undefined);

// ---------------------------------------------------------------------------
// Remotes

export interface Remote {
  kind: "github" | "gitlab" | "other";
  host: string;
  /** `owner/name`, `group/subgroup/name` on GitLab. */
  path: string;
  web: string;
}

/** `git@github.com:o/r.git`, `https://gitlab.com/g/s/r`, `ssh://git@host:22/o/r.git`. */
export function parseRemote(url: string): Remote | undefined {
  const u = url.trim();
  const m = /^(?:[\w+]+:\/\/)?(?:[^@/]+@)?([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/.exec(u);
  if (!m || !m[2].includes("/")) return undefined;
  const host = m[1].toLowerCase();
  const path = m[2].replace(/^\/+/, "");
  const kind = host === "github.com"
    ? "github"
    : /(^|\.)gitlab\./.test(host) || host === "gitlab.com"
    ? "gitlab"
    : "other";
  return { kind, host, path, web: `https://${host}/${path}` };
}

export function compareUrl(r: Remote, from: string | undefined, to: string): string | undefined {
  if (r.kind === "github") return from ? `${r.web}/compare/${from}...${to}` : `${r.web}/commits/${to}`;
  if (r.kind === "gitlab") return from ? `${r.web}/-/compare/${from}...${to}` : `${r.web}/-/commits/${to}`;
  return undefined;
}

const commitUrl = (r: Remote, hash: string) =>
  r.kind === "gitlab" ? `${r.web}/-/commit/${hash}` : `${r.web}/commit/${hash}`;

function refUrl(r: Remote, ref: string): string | undefined {
  const n = ref.slice(1);
  if (r.kind === "github") return `${r.web}/${ref[0] === "#" ? "issues" : "pull"}/${n}`;
  if (r.kind === "gitlab") return `${r.web}/-/${ref[0] === "#" ? "issues" : "merge_requests"}/${n}`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Markdown

export interface RenderOptions {
  version: string;
  /** `YYYY-MM-DD`. */
  date: string;
  remote?: Remote;
  from?: string;
  to: string;
  /** Links to commits, pull requests and the comparison. */
  links?: boolean;
  /** `##` (the default, for CHANGELOG.md) or `#`. */
  level?: number;
  /** Leave out the version heading (a GitHub release has its own title). */
  heading?: boolean;
}

function line(c: Change, o: RenderOptions, text = c.description): string {
  const r = o.links ? o.remote : undefined;
  let desc = text;
  if (r) {
    for (const ref of c.refs) {
      const url = refUrl(r, ref);
      if (url) desc = desc.replace(new RegExp(`(^|[\\s(])${ref.replace(/[#!]/, "\\$&")}\\b`), `$1[${ref}](${url})`);
    }
  }
  const scope = c.scope ? `**${c.scope}:** ` : "";
  const hash = r && r.kind !== "other" ? `[${c.commit.short}](${commitUrl(r, c.commit.hash)})` : c.commit.short;
  return `- ${scope}${desc} (${hash})`;
}

export function renderMarkdown(notes: Notes, o: RenderOptions): string {
  const h = "#".repeat(o.level ?? 2);
  const out: string[] = [];
  if (o.heading !== false) {
    const url = o.links && o.remote ? compareUrl(o.remote, o.from, o.version) : undefined;
    out.push(`${h} ${url ? `[${o.version}](${url})` : o.version} (${o.date})`, "");
  }
  if (!notes.changes.length) {
    out.push("_No changes._");
    return out.join("\n");
  }
  if (notes.breaking.length) {
    out.push(`${h}# Breaking Changes`, "");
    for (const c of notes.breaking) out.push(line(c, o, c.breakingNote ?? c.description));
    out.push("");
  }
  for (const [title, list] of notes.groups) {
    out.push(`${h}# ${title}`, "");
    // Scoped entries grouped together, then the rest, oldest first as they happened.
    const sorted = [...list].reverse().sort((a, b) => (a.scope ?? "~").localeCompare(b.scope ?? "~"));
    for (const c of sorted) out.push(line(c, o));
    out.push("");
  }
  return out.join("\n").trimEnd();
}

/** Plain text for an annotated tag message: no links, no Markdown headings. */
export function renderPlain(notes: Notes, version: string): string {
  const out = [version, ""];
  if (notes.breaking.length) {
    out.push("Breaking changes:");
    for (const c of notes.breaking) out.push(`- ${c.scope ? `${c.scope}: ` : ""}${c.breakingNote ?? c.description}`);
    out.push("");
  }
  for (const [title, list] of notes.groups) {
    out.push(`${title}:`);
    for (const c of [...list].reverse()) out.push(`- ${c.scope ? `${c.scope}: ` : ""}${c.description}`);
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}

// ---------------------------------------------------------------------------
// CHANGELOG.md

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whether the changelog already has a section for this version (with or without its prefix). */
export function hasVersion(changelog: string, version: string): boolean {
  const bare = version.replace(/^[^\d]*/, "");
  return new RegExp(`^#{1,3} \\[?v?${escapeRe(bare)}\\]?(?:[\\s(]|$)`, "m").test(changelog);
}

/**
 * The changelog with `section` added on top of the releases: after the title
 * and introduction, and after an `## [Unreleased]` section, if any.
 */
export function prependChangelog(existing: string | undefined, section: string): string {
  const body = section.trim() + "\n";
  if (!existing?.trim()) return `# Changelog\n\n${body}`;
  const lines = existing.replace(/\r\n/g, "\n").split("\n");
  // The first release heading: `## ` that isn't "Unreleased".
  let at = lines.findIndex((l) => /^##\s/.test(l) && !/^##\s+\[?unreleased\]?/i.test(l));
  if (at === -1) {
    const text = existing.replace(/\s*$/, "");
    return /^# /.test(text) ? `${text}\n\n${body}` : `# Changelog\n\n${body}\n${text}\n`;
  }
  while (at > 0 && lines[at - 1].trim() === "") at--;
  const before = lines.slice(0, at).join("\n").replace(/\s*$/, "");
  const after = lines.slice(at).join("\n").replace(/^\s*/, "");
  return `${before ? `${before}\n\n` : ""}${body}\n${after.replace(/\s*$/, "")}\n`;
}

// ---------------------------------------------------------------------------
// Folders and helpers

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

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

/** A short age: "today", "3d", "2mo", "1y". */
export function age(seconds: number, now = Date.now()): string {
  const days = Math.floor((now / 1000 - seconds) / 86_400);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function installCommand(osRelease: string, pkg: string): string {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  const names: Record<string, Record<string, string>> = {
    git: { pacman: "git", apt: "git", dnf: "git", zypper: "git", apk: "git" },
    gh: { pacman: "github-cli", apt: "gh", dnf: "gh", zypper: "gh", apk: "github-cli" },
    glab: { pacman: "glab", apt: "glab", dnf: "glab", zypper: "glab", apk: "glab" },
  };
  const n = names[pkg] ?? { pacman: pkg, apt: pkg, dnf: pkg, zypper: pkg, apk: pkg };
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return `sudo pacman -S ${n.pacman}`;
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return `sudo apt install ${n.apt}`;
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return `sudo dnf install ${n.dnf}`;
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return `sudo zypper install ${n.zypper}`;
  if (ids.includes("alpine")) return `sudo apk add ${n.apk}`;
  return `Install ${pkg} with your package manager`;
}
