// Renovate and Dependabot pull requests: titles and bodies parsed into packages and versions, semver jumps,
// checks, and the GitHub search queries that find them. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Versions

export type Jump = "major" | "minor" | "patch" | "digest";

export const JUMP_COLORS: Record<Jump, Color> = { major: "red", minor: "yellow", patch: "green", digest: "gray" };

/** `v1.2.3`, `^1.2`, `~5.4.0`, `<2.32`, `1.0.0-rc.1` → [1, 2, 3]; undefined when there is no number. */
export function versionParts(version: string | undefined): number[] | undefined {
  const m = /(\d+(?:\.\d+)*)/.exec(String(version ?? "").replace(/^[^\d]*/, ""));
  return m ? m[1].split(".").map(Number) : undefined;
}

const isDigest = (v: string | undefined) => !!v && /^[0-9a-f]{7,64}$/i.test(v) && /[a-f]/i.test(v);

/**
 * How big an update is. Without the old version, a target with only a major
 * number (`v4`) is a major update: Renovate writes `to v4` only for those.
 */
export function semverJump(from: string | undefined, to: string | undefined): Jump | undefined {
  if (isDigest(to) && (!from || isDigest(from))) return "digest";
  const b = versionParts(to);
  if (!b) return undefined;
  const a = versionParts(from);
  if (!a) {
    return b.length === 1 && /^v?\d+$/.test(String(to).trim()) ? "major" : undefined;
  }
  if ((b[0] ?? 0) !== (a[0] ?? 0)) return "major";
  if ((b[1] ?? 0) !== (a[1] ?? 0)) return "minor";
  if ((b[2] ?? 0) !== (a[2] ?? 0) || b.slice(3).join(".") !== a.slice(3).join(".")) return "patch";
  // Same numbers, another pre-release or build: 1.0.0-rc.1 → 1.0.0-rc.2.
  const bare = (v: string | undefined) => String(v ?? "").replace(/^[^\d]*/, "");
  return bare(from) !== bare(to) ? "patch" : undefined;
}

const RANK: Record<Jump, number> = { major: 3, minor: 2, patch: 1, digest: 0 };

export const biggest = (jumps: (Jump | undefined)[]): Jump | undefined =>
  jumps.filter((j): j is Jump => !!j).sort((a, b) => RANK[b] - RANK[a])[0];

// ---------------------------------------------------------------------------
// Titles and bodies

export interface Change {
  name: string;
  from?: string;
  to?: string;
  jump?: Jump;
}

export type UpdateKind = "single" | "group" | "pin" | "lockfile" | "digest" | "replacement" | "other";

export interface Update {
  kind: UpdateKind;
  /** The package, or the group's name. */
  label: string;
  changes: Change[];
  /** Dependabot's `in /web`, or the group's directory. */
  directory?: string;
  security: boolean;
  /** The biggest jump of the changes. */
  jump?: Jump;
}

/** `chore(deps): `, `build(deps-dev)!: `, `fix: `, gitmoji and the like. */
const PREFIX = /^(?:[^\p{L}\p{N}[(]+\s*)?(?:[\w-]+(?:\([^)]*\))?!?:\s+)?/u;

/** Renovate's dependency types around the package name. */
const LEADING_TYPE =
  /^(?:dependency|dependencies|module|rust crate|helm release|terraform|docker image|image|gem|package|npm package|plugin|github action|orb)\s+/i;
const TRAILING_TYPE =
  /\s+(?:action|actions|docker tag|docker image|digest|monorepo|orb|image|chart|packages|group|plugin)$/i;

function clean(title: string) {
  return title.trim().replace(PREFIX, "").replace(/\s+\((?:major|minor|patch)\)\s*$/i, "").trim();
}

function change(name: string, from?: string, to?: string): Change {
  const f = from?.replace(/[.,;]$/, ""), t = to?.replace(/[.,;]$/, "");
  return { name, from: f, to: t, jump: semverJump(f, t) };
}

/** Changes listed in a PR body: Renovate's table, or Dependabot's "Updates `x` from 1 to 2" lines. */
export function bodyChanges(body: string | undefined): Change[] {
  const text = String(body ?? "");
  const out: Change[] = [];
  const seen = new Set<string>();
  const push = (c: Change) => {
    const key = `${c.name}\u0000${c.to}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(c);
    }
  };
  // Renovate: | [react](https://…) ([source](…)) | [`18.2.0` -> `18.3.1`](https://renovatebot.com/diffs/…) |
  const row = /^\|\s*(?:\[([^\]\n]+)\][^|\n]*|([^|\n]+))\|[^\n]*?`([^`\n]+)`\s*(?:->|→)\s*`([^`\n]+)`/gm;
  for (const m of text.matchAll(row)) {
    const name = (m[1] ?? m[2] ?? "").trim();
    if (!name || /^package$/i.test(name)) continue;
    push(change(name, m[3].trim(), m[4].trim()));
  }
  // Dependabot groups: "Updates `lodash` from 4.17.20 to 4.17.21"
  for (const m of text.matchAll(/Updates `([^`]+)` from (\S+) to (\S+)/g)) push(change(m[1], m[2], m[3]));
  return out;
}

/** Reads what a dependency PR updates from its title, completed by its body. */
export function parseUpdate(title: string, body?: string): Update {
  const t = clean(title);
  const security = /\[security\]/i.test(t) || /security update|vulnerabilit/i.test(String(body ?? "").slice(0, 2000));
  const plain = t.replace(/\s*\[security\]\s*/gi, " ").trim();
  const fromBody = bodyChanges(body);
  const done = (u: Omit<Update, "jump" | "security">): Update => ({
    ...u,
    security,
    jump: biggest(u.changes.map((c) => c.jump)),
  });
  let m: RegExpExecArray | null;

  // Dependabot: "Bump lodash from 4.17.20 to 4.17.21 in /web", "… in the npm group"
  if ((m = /^bump (\S+) from (\S+) to (\S+?)(?: in the (\S+) group)?(?: in (\S+))?$/i.exec(plain))) {
    return done({ kind: "single", label: m[1], changes: [change(m[1], m[2], m[3])], directory: m[5] });
  }
  // Dependabot: "Update requests requirement from <2.28 to <2.32 in /api"
  if ((m = /^update (\S+) requirement from (.+?) to (.+?)(?: in (\/\S*))?$/i.exec(plain))) {
    return done({ kind: "single", label: m[1], changes: [change(m[1], m[2], m[3])], directory: m[4] });
  }
  // Dependabot groups: "Bump the npm_and_yarn group across 2 directories with 3 updates"
  if ((m = /^bump the (\S+) group(?: across \d+ director(?:y|ies))?(?: in (\S+))? with \d+ updates?$/i.exec(plain))) {
    return done({ kind: "group", label: m[1], changes: fromBody, directory: m[2] });
  }
  // Dependabot, several without a group: "Bump express and body-parser in /api"
  if ((m = /^bump ([^ ]+(?:, [^ ]+)*(?:,? and [^ ]+)?)(?: in (\S+))?$/i.exec(plain)) && / and /.test(m[1])) {
    const names = m[1].split(/,\s*|\s+and\s+/).filter(Boolean);
    const changes = names.map((n) => fromBody.find((c) => c.name === n) ?? change(n));
    return done({ kind: "group", label: names.join(", "), changes, directory: m[2] });
  }
  if (/^lock file maintenance/i.test(plain)) {
    return done({ kind: "lockfile", label: "Lock file maintenance", changes: [] });
  }
  if ((m = /^pin (?:dependency )?(\S+) to (\S+)$/i.exec(plain))) {
    return done({ kind: "pin", label: m[1], changes: [{ name: m[1], to: m[2] }] });
  }
  if (/^pin dependencies$/i.test(plain)) return done({ kind: "pin", label: "Pin dependencies", changes: fromBody });
  if ((m = /^replace (?:dependency )?(\S+) with (\S+?)(?: (\S+))?$/i.exec(plain))) {
    return done({ kind: "replacement", label: `${m[1]} → ${m[2]}`, changes: [{ name: m[2], to: m[3] }] });
  }
  // Renovate: "Update dependency react to v18.3.1", "Update actions/checkout action to v4",
  // "Update postgres Docker tag to v16.2", "Update rust crate serde to 1.0.200", "Update react monorepo to v18.3.0"
  if ((m = /^update (.+?) to (\S+)$/i.exec(plain))) {
    const what = m[1].trim(), to = m[2];
    const digest = /\sdigest$/i.test(what) || isDigest(to);
    const name = what.replace(LEADING_TYPE, "").replace(TRAILING_TYPE, "").trim();
    const grouped = /\s(monorepo|packages|group)$/i.test(what) || /^(all|non-major)\b/i.test(name);
    const bodyMatch = fromBody.find((c) => c.name === name) ?? (fromBody.length === 1 ? fromBody[0] : undefined);
    const single = change(name, bodyMatch?.from, to);
    if (digest) return done({ kind: "digest", label: name, changes: [{ ...single, jump: "digest" }] });
    if (grouped && fromBody.length > 1) {
      return done({ kind: "group", label: name, changes: fromBody });
    }
    // Without the old version, the body's jump for this package (or the title's "to v4") decides.
    return done({
      kind: "single",
      label: name,
      changes: [single.jump ? single : { ...single, jump: bodyMatch?.jump }],
    });
  }
  // Renovate groups: "Update all non-major dependencies", "Update dependencies", "Update eslint packages"
  if ((m = /^update (.+)$/i.exec(plain))) {
    return done({ kind: "group", label: m[1].replace(LEADING_TYPE, ""), changes: fromBody });
  }
  return done({ kind: fromBody.length > 1 ? "group" : "other", label: plain, changes: fromBody });
}

/** "4.17.20 → 4.17.21", "→ v4", "3 packages". */
export function versionText(u: Update): string {
  if (u.kind === "lockfile") return "lock file";
  if (u.changes.length > 1) return `${u.changes.length} packages`;
  const c = u.changes[0];
  if (!c) return u.kind === "group" ? "group" : "";
  const short = (v?: string) => (v && isDigest(v) ? v.slice(0, 7) : v);
  // Renovate's "to v18.3.1" next to the body's "18.2.0": the same spelling on both sides.
  const to = c.from && !/^v/.test(c.from) ? c.to?.replace(/^v(?=\d)/, "") : c.to;
  if (c.from && to) return `${short(c.from)} → ${short(to)}`;
  return c.to ? `→ ${short(c.to)}` : "";
}

// ---------------------------------------------------------------------------
// Pull requests (GraphQL search results)

export type Checks = "passing" | "failing" | "pending" | "none";

export const CHECK_LOOK: Record<Checks, { label: string; color: Color }> = {
  passing: { label: "Passing", color: "green" },
  failing: { label: "Failing", color: "red" },
  pending: { label: "Running", color: "yellow" },
  none: { label: "No checks", color: "gray" },
};

export interface Check {
  name: string;
  state: "success" | "failure" | "pending" | "neutral" | "skipped";
  url: string;
}

export interface Pull {
  id: string;
  repo: string;
  number: number;
  title: string;
  url: string;
  bot: "renovate" | "dependabot" | "other";
  author: string;
  created: string;
  updated: string;
  draft: boolean;
  mergeable: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  review: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | "";
  autoMerge: boolean;
  base: string;
  head: string;
  labels: string[];
  checks: Checks;
  checkRuns: Check[];
  /** Renovate's "rebase/retry" checkbox is in the body. */
  renovateRebase: boolean;
  body: string;
  update: Update;
}

type Raw = Record<string, any>;

/** The rollup's state → our four. */
export function checksState(rollup: unknown): Checks {
  const s = String((rollup as Raw | null)?.state ?? "");
  if (s === "SUCCESS") return "passing";
  if (s === "FAILURE" || s === "ERROR") return "failing";
  if (s === "PENDING" || s === "EXPECTED") return "pending";
  return "none";
}

function checkRun(n: Raw): Check | undefined {
  if (n.__typename === "CheckRun" || "conclusion" in n) {
    const c = String(n.conclusion ?? "").toUpperCase();
    const state = n.status !== "COMPLETED" && !c
      ? "pending"
      : c === "SUCCESS"
      ? "success"
      : c === "NEUTRAL"
      ? "neutral"
      : c === "SKIPPED"
      ? "skipped"
      : "failure";
    return { name: String(n.name ?? ""), state, url: String(n.detailsUrl ?? "") };
  }
  if (n.__typename === "StatusContext" || "context" in n) {
    const s = String(n.state ?? "").toUpperCase();
    return {
      name: String(n.context ?? ""),
      state: s === "SUCCESS" ? "success" : s === "PENDING" || s === "EXPECTED" ? "pending" : "failure",
      url: String(n.targetUrl ?? ""),
    };
  }
  return undefined;
}

export function botOf(login: string): Pull["bot"] {
  const l = login.toLowerCase();
  if (l.includes("renovate")) return "renovate";
  if (l.includes("dependabot")) return "dependabot";
  return "other";
}

/** A `search(type: ISSUE)` node → a pull request; undefined for issues or archived repositories. */
export function parsePull(n: Raw): Pull | undefined {
  if (!n?.number || !n.repository || n.repository.isArchived) return undefined;
  const commit = n.commits?.nodes?.[0]?.commit ?? {};
  const rollup = commit.statusCheckRollup ?? null;
  const runs = ((rollup?.contexts?.nodes ?? []) as Raw[]).map(checkRun).filter((c): c is Check => !!c);
  const login = String(n.author?.login ?? "");
  const body = String(n.body ?? "");
  return {
    id: String(n.id ?? `${n.repository.nameWithOwner}#${n.number}`),
    repo: String(n.repository.nameWithOwner),
    number: Number(n.number),
    title: String(n.title ?? ""),
    url: String(n.url ?? ""),
    bot: botOf(login),
    author: login,
    created: String(n.createdAt ?? ""),
    updated: String(n.updatedAt ?? ""),
    draft: n.isDraft === true,
    mergeable: (["MERGEABLE", "CONFLICTING"].includes(n.mergeable) ? n.mergeable : "UNKNOWN") as Pull["mergeable"],
    review:
      (["APPROVED", "CHANGES_REQUESTED", "REVIEW_REQUIRED"].includes(n.reviewDecision) ? n.reviewDecision : "") as Pull[
        "review"
      ],
    autoMerge: !!n.autoMergeRequest,
    base: String(n.baseRefName ?? ""),
    head: String(n.headRefName ?? ""),
    labels: ((n.labels?.nodes ?? []) as Raw[]).map((l) => String(l.name)),
    checks: checksState(rollup),
    checkRuns: runs,
    renovateRebase: /- \[ \] <!-- rebase-check -->/.test(body),
    body,
    update: parseUpdate(String(n.title ?? ""), body),
  };
}

/** By repository, then the failing and the biggest updates first. */
export function sortPulls(pulls: Pull[]): Pull[] {
  const checkRank: Record<Checks, number> = { failing: 0, pending: 1, none: 2, passing: 3 };
  return [...pulls].sort((a, b) =>
    a.repo.localeCompare(b.repo) ||
    checkRank[a.checks] - checkRank[b.checks] ||
    (RANK[b.update.jump ?? "digest"] - RANK[a.update.jump ?? "digest"]) ||
    a.update.label.localeCompare(b.update.label)
  );
}

export function matchesChip(p: Pull, chip: string | undefined): boolean {
  if (chip === "passing") return p.checks === "passing";
  if (chip === "failing") return p.checks === "failing";
  if (chip === "major") return p.update.jump === "major";
  return true;
}

/** The Dependabot rebase comment, or Renovate's checkbox ticked in the body. */
export const tickRebase = (body: string) => body.replace("- [ ] <!-- rebase-check -->", "- [x] <!-- rebase-check -->");

// ---------------------------------------------------------------------------
// Search queries

export const DEFAULT_AUTHORS = "app/renovate, app/dependabot";

/** `app/renovate, dependabot[bot], renovate-bot` → search qualifiers, deduplicated. */
export function parseAuthors(pref: string | undefined): string[] {
  const raw = (pref?.trim() || DEFAULT_AUTHORS).split(/[\s,]+/).map((a) => a.trim()).filter(Boolean);
  const normalized = raw.map((a) => {
    const bot = /^(.+)\[bot\]$/.exec(a);
    return bot ? `app/${bot[1]}` : a.replace(/^@/, "");
  });
  return [...new Set(normalized)];
}

/** `acme, ada/dotfiles https://github.com/x/y` → `user:acme`, `repo:ada/dotfiles`, `repo:x/y`. */
export function parseScope(pref: string | undefined): string[] {
  const terms = String(pref ?? "").split(/[\s,]+/).map((t) =>
    t.trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/+$/, "")
  ).filter(Boolean);
  const out = terms.map((t) => {
    if (/^[\w.-]+\/[\w.-]+$/.test(t)) return `repo:${t}`;
    if (/^[\w-]+$/.test(t)) return `user:${t}`;
    return "";
  }).filter(Boolean);
  return [...new Set(out)];
}

/** GitHub rejects queries over 256 characters: scopes are split over several queries. */
export function buildQueries(authors: string[], scope: string[], max = 256): string[] {
  const queries: string[] = [];
  for (const author of authors) {
    const base = `is:pr is:open archived:false author:${author}`;
    let current: string[] = [];
    for (const s of scope) {
      if ([base, ...current, s].join(" ").length > max && current.length) {
        queries.push([base, ...current].join(" "));
        current = [];
      }
      current.push(s);
    }
    queries.push([base, ...current].join(" "));
  }
  return queries;
}

/** "today", "yesterday", "3d", "2w", "4mo". */
export function age(iso: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(iso)) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 730) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
