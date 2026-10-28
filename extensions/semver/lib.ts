// Versions and ranges of npm, Cargo, RubyGems and Python (PEP 440), computed locally.

// ---------------------------------------------------------------------------
// Versions

/** How versions are written and ordered. */
export type Scheme = "semver" | "ruby" | "pep440";
/** Whose range syntax a range is written in. */
export type Dialect = "npm" | "cargo" | "ruby" | "python";

export const DIALECT_TITLE: Record<Dialect, string> = {
  npm: "npm",
  cargo: "Cargo",
  ruby: "RubyGems / Bundler",
  python: "Python (PEP 440)",
};

export const SCHEME: Record<Dialect, Scheme> = { npm: "semver", cargo: "semver", ruby: "ruby", python: "pep440" };

export type Identifier = string | number;

export interface Version {
  scheme: Scheme;
  /** As typed. */
  raw: string;
  /** PEP 440 `1!2.0`; 0 elsewhere. */
  epoch: number;
  /** `1.2.3` → [1, 2, 3]. */
  release: number[];
  /** semver `-rc.1` → ["rc", 1]; PEP 440 `a1` → ["a", 1]; Ruby `.pre.2` → ["pre", 2]. */
  pre: Identifier[];
  /** PEP 440 `.post1`. */
  post?: number;
  /** PEP 440 `.dev3`. */
  dev?: number;
  /** semver `+build.5`, PEP 440 local `+ubuntu.1`. */
  build: string[];
}

export class SyntaxError extends Error {}

const ident = (s: string): Identifier => /^\d+$/.test(s) ? Number(s) : s;

const SEMVER =
  /^[v=]?\s*(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** A full semantic version, `v1.2.3-rc.1+build`. Partial ones (`1.2`) are completed with zeros. */
export function parseSemver(text: string): Version {
  const raw = text.trim();
  let m = SEMVER.exec(raw);
  if (!m) {
    // 1 or 1.2: read as 1.0.0 / 1.2.0.
    const partial = /^[v=]?(0|[1-9]\d*)(?:\.(0|[1-9]\d*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/.exec(raw);
    if (partial) m = SEMVER.exec(`${partial[1]}.${partial[2] ?? 0}.0${partial[3] ? `-${partial[3]}` : ""}`);
  }
  if (!m) {
    if (/^[v=]?\d+\.\d+\.\d+/.test(raw) && /(^|\.)0\d/.test(raw)) {
      throw new SyntaxError(`${raw} is not a valid version: numbers can't have leading zeros`);
    }
    throw new SyntaxError(`${raw || "(empty)"} is not a version like 1.2.3 or 1.2.3-rc.1`);
  }
  const pre = m[4] ? m[4].split(".") : [];
  if (pre.some((p) => /^0\d+$/.test(p))) {
    throw new SyntaxError(`${raw} is not a valid version: numeric prerelease parts can't have leading zeros`);
  }
  return {
    scheme: "semver",
    raw,
    epoch: 0,
    release: [Number(m[1]), Number(m[2]), Number(m[3])],
    pre: pre.map(ident),
    build: m[5] ? m[5].split(".") : [],
  };
}

/** A RubyGems version: `1.2`, `3.0.0.rc1`, `2.0.0-beta.2` (a hyphen means `.pre.`). */
export function parseRuby(text: string): Version {
  const raw = text.trim();
  if (!/^[0-9]+(?:[.-]?[0-9a-zA-Z]+)*$/.test(raw)) {
    throw new SyntaxError(`${raw || "(empty)"} is not a gem version like 1.2.3 or 2.0.0.rc1`);
  }
  // Gem::Version splits "rc1" into "rc", 1 and turns "-" into ".pre.".
  const segments = raw.replace(/-/g, ".pre.").match(/[0-9]+|[a-z]+/gi)!.map(ident);
  const firstText = segments.findIndex((s) => typeof s === "string");
  const release = (firstText < 0 ? segments : segments.slice(0, firstText)) as number[];
  return {
    scheme: "ruby",
    raw,
    epoch: 0,
    release,
    pre: firstText < 0 ? [] : segments.slice(firstText).map((s) => typeof s === "string" ? s.toLowerCase() : s),
    build: [],
  };
}

const PEP440 =
  /^v?(?:(\d+)!)?(\d+(?:\.\d+)*)(?:[-_.]?(a|b|c|rc|alpha|beta|pre|preview)[-_.]?(\d+)?)?(?:-(\d+)|[-_.]?(post|rev|r)[-_.]?(\d+)?)?(?:[-_.]?(dev)[-_.]?(\d+)?)?(?:\+([a-z0-9]+(?:[-_.][a-z0-9]+)*))?$/i;

const PRE_LETTER: Record<string, string> = {
  a: "a",
  alpha: "a",
  b: "b",
  beta: "b",
  c: "rc",
  rc: "rc",
  pre: "rc",
  preview: "rc",
};

/** A PEP 440 version: `1.0`, `2!1.0`, `1.0a1`, `1.0.post2`, `1.0.dev3`, `1.0+local`. */
export function parsePep440(text: string): Version {
  const raw = text.trim();
  const m = PEP440.exec(raw);
  if (!m) throw new SyntaxError(`${raw || "(empty)"} is not a Python version like 1.4, 2.0.1 or 3.0rc1`);
  return {
    scheme: "pep440",
    raw,
    epoch: m[1] ? Number(m[1]) : 0,
    release: m[2].split(".").map(Number),
    pre: m[3] ? [PRE_LETTER[m[3].toLowerCase()], Number(m[4] ?? 0)] : [],
    post: m[5] !== undefined ? Number(m[5]) : m[6] ? Number(m[7] ?? 0) : undefined,
    dev: m[8] ? Number(m[9] ?? 0) : undefined,
    build: m[10] ? m[10].toLowerCase().split(/[-_.]/) : [],
  };
}

export function parseVersion(text: string, scheme: Scheme = "semver"): Version {
  return scheme === "semver" ? parseSemver(text) : scheme === "ruby" ? parseRuby(text) : parsePep440(text);
}

/** Whether `text` reads as a version in that scheme. */
export function isVersion(text: string, scheme: Scheme = "semver"): boolean {
  try {
    parseVersion(text, scheme);
    return true;
  } catch {
    return false;
  }
}

export function isPrerelease(v: Version): boolean {
  return v.pre.length > 0 || v.dev !== undefined;
}

/** The canonical way to write it. */
export function format(v: Version): string {
  if (v.scheme === "semver") {
    return `${v.release.join(".")}${v.pre.length ? `-${v.pre.join(".")}` : ""}${
      v.build.length ? `+${v.build.join(".")}` : ""
    }`;
  }
  if (v.scheme === "ruby") return [...v.release, ...v.pre].join(".");
  return `${v.epoch ? `${v.epoch}!` : ""}${v.release.join(".")}${v.pre.length ? `${v.pre[0]}${v.pre[1]}` : ""}${
    v.post !== undefined ? `.post${v.post}` : ""
  }${v.dev !== undefined ? `.dev${v.dev}` : ""}${v.build.length ? `+${v.build.join(".")}` : ""}`;
}

const sign = (n: number) => n < 0 ? -1 : n > 0 ? 1 : 0;

function compareRelease(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return sign(d);
  }
  return 0;
}

/** semver §11: numbers below words, numbers numerically, a shorter list first when it's a prefix. */
function compareIdentifiers(a: Identifier[], b: Identifier[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;
    if (b[i] === undefined) return 1;
    const x = a[i], y = b[i];
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return sign(x - y);
    if (typeof x === "number") return -1;
    if (typeof y === "number") return 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

const PRE_ORDER: Record<string, number> = { a: 0, b: 1, rc: 2 };

/** PEP 440 ordering: dev < a < b < rc < final < post; `1.0.dev1` sorts before `1.0a1`. */
function pep440Key(v: Version): number[] {
  const pre = v.pre.length
    ? [PRE_ORDER[String(v.pre[0])], Number(v.pre[1])]
    : v.post === undefined && v.dev !== undefined
    ? [-1, 0]
    : [3, 0];
  return [...pre, v.post === undefined ? -1 : v.post, v.dev === undefined ? Infinity : v.dev];
}

/** -1, 0 or 1. Build metadata doesn't count (semver), a local label sorts after (PEP 440). */
export function compare(a: Version, b: Version): number {
  if (a.scheme === "pep440" && b.scheme === "pep440") {
    if (a.epoch !== b.epoch) return sign(a.epoch - b.epoch);
    const r = compareRelease(a.release, b.release);
    if (r) return r;
    const ka = pep440Key(a), kb = pep440Key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
    // A local label sorts after the same public version.
    if (!a.build.length || !b.build.length) return a.build.length === b.build.length ? 0 : a.build.length ? 1 : -1;
    return compareIdentifiers(a.build.map(ident), b.build.map(ident));
  }
  const r = compareRelease(a.release, b.release);
  if (r) return r;
  if (!a.pre.length || !b.pre.length) return a.pre.length === b.pre.length ? 0 : a.pre.length ? -1 : 1;
  return compareIdentifiers(a.pre, b.pre);
}

export const sortVersions = (vs: Version[]) => [...vs].sort(compare);

export type Difference = "major" | "minor" | "patch" | "prerelease" | "build" | "epoch" | "post" | "dev" | "none";

/** Which part differs first, like npm's `semver.diff`. */
export function difference(a: Version, b: Version): Difference {
  if (a.epoch !== b.epoch) return "epoch";
  const names: Difference[] = ["major", "minor", "patch"];
  for (let i = 0; i < Math.max(a.release.length, b.release.length, 3); i++) {
    if ((a.release[i] ?? 0) !== (b.release[i] ?? 0)) return names[Math.min(i, 2)];
  }
  if (compareIdentifiers(a.pre, b.pre) !== 0 || a.pre.length !== b.pre.length) return "prerelease";
  if (a.post !== b.post) return "post";
  if (a.dev !== b.dev) return "dev";
  if (a.build.join(".") !== b.build.join(".")) return "build";
  return "none";
}

// ---------------------------------------------------------------------------
// Bumping (npm's `semver.inc`)

export type Bump = "major" | "minor" | "patch" | "premajor" | "preminor" | "prepatch" | "prerelease" | "release";

export const BUMPS: { kind: Bump; title: string; description: string }[] = [
  { kind: "patch", title: "Patch", description: "Backwards compatible bug fixes" },
  { kind: "minor", title: "Minor", description: "New backwards compatible features" },
  { kind: "major", title: "Major", description: "Breaking changes" },
  { kind: "prerelease", title: "Prerelease", description: "The next prerelease of this version" },
  { kind: "prepatch", title: "Prepatch", description: "A prerelease of the next patch" },
  { kind: "preminor", title: "Preminor", description: "A prerelease of the next minor" },
  { kind: "premajor", title: "Premajor", description: "A prerelease of the next major" },
  { kind: "release", title: "Release", description: "The final version, without the prerelease" },
];

/** The bumped version, the way `npm version <kind> --preid <id>` does it. */
export function bump(v: Version, kind: Bump, preid = ""): Version {
  if (v.scheme !== "semver") throw new SyntaxError("Bumping works with semantic versions (1.2.3)");
  const [major, minor, patch] = v.release;
  const firstPre = (): Identifier[] => preid ? [preid, 0] : [0];
  const out = (release: number[], pre: Identifier[] = []): Version => ({
    scheme: "semver",
    raw: "",
    epoch: 0,
    release,
    pre,
    build: [],
  });
  const done = (x: Version) => ({ ...x, raw: format(x) });
  switch (kind) {
    case "major":
      return done(v.pre.length && minor === 0 && patch === 0 ? out([major, 0, 0]) : out([major + 1, 0, 0]));
    case "minor":
      return done(v.pre.length && patch === 0 ? out([major, minor, 0]) : out([major, minor + 1, 0]));
    case "patch":
      return done(v.pre.length ? out([major, minor, patch]) : out([major, minor, patch + 1]));
    case "premajor":
      return done(out([major + 1, 0, 0], firstPre()));
    case "preminor":
      return done(out([major, minor + 1, 0], firstPre()));
    case "prepatch":
      return done(out([major, minor, patch + 1], firstPre()));
    case "release":
      return done(out([major, minor, patch]));
    case "prerelease": {
      if (!v.pre.length) return done(out([major, minor, patch + 1], firstPre()));
      if (preid && v.pre[0] !== preid) return done(out([major, minor, patch], [preid, 0]));
      const pre = [...v.pre];
      let i = pre.length - 1;
      while (i >= 0 && typeof pre[i] !== "number") i--;
      if (i < 0) pre.push(0);
      else pre[i] = (pre[i] as number) + 1;
      return done(out([major, minor, patch], pre));
    }
  }
}

// ---------------------------------------------------------------------------
// Ranges

export type Op = ">" | ">=" | "<" | "<=" | "=" | "!=" | "==*" | "!=*" | "===";

export interface Comparator {
  op: Op;
  version: Version;
  /** How it is shown: `<2.0.0` for npm's internal `<2.0.0-0`. */
  text: string;
}

/** One term as typed (`^1.2.3`) and what it stands for. */
export interface Term {
  source: string;
  comparators: Comparator[];
  /** In words: "Compatible with 1.2.3: minor and patch updates". */
  meaning: string;
}

export interface Range {
  dialect: Dialect;
  source: string;
  /** Alternatives (`||`); a version must match every term of one of them. */
  sets: Term[][];
}

interface Partial {
  major?: number;
  minor?: number;
  patch?: number;
  pre: Identifier[];
  build: string[];
}

const semverOf = (release: number[], pre: Identifier[] = []): Version => {
  const v: Version = { scheme: "semver", raw: "", epoch: 0, release, pre, build: [] };
  return { ...v, raw: format(v) };
};

/** `<2.0.0-0` excludes 2.0.0's prereleases; we write it `<2.0.0`. */
const ZERO: Identifier[] = [0];

function cmp(op: Op, version: Version, hideZero = false): Comparator {
  const shown = hideZero && version.pre.length === 1 && version.pre[0] === 0
    ? format({ ...version, pre: [] })
    : format(version);
  return {
    op,
    version,
    text: `${op === "==*" ? "==" : op === "!=*" ? "!=" : op}${shown}${op.endsWith("*") ? ".*" : ""}`,
  };
}

function parsePartial(text: string, source: string): Partial {
  if (text === "" || text === "*" || /^[xX]$/.test(text)) return { pre: [], build: [] };
  const m =
    /^v?(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*]))?(?:\.(0|[1-9]\d*|[xX*]))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-.]+))?$/
      .exec(text);
  if (!m) throw new SyntaxError(`“${source}” is not a version or range term`);
  const num = (s?: string) => s === undefined || /^[xX*]$/.test(s) ? undefined : Number(s);
  const major = num(m[1]);
  const minor = major === undefined ? undefined : num(m[2]);
  const patch = minor === undefined ? undefined : num(m[3]);
  return {
    major,
    minor,
    patch,
    pre: patch !== undefined && m[4] ? m[4].split(".").map(ident) : [],
    build: m[5] ? m[5].split(".") : [],
  };
}

const releaseOf = (p: Partial) => [p.major ?? 0, p.minor ?? 0, p.patch ?? 0];
const full = (p: Partial) => p.patch !== undefined;

/** What a set of updates is called, from the bounds of a term. */
function allowance(lower: number[], upper: number[]): string {
  const [M, m, p] = lower;
  if (upper[0] === M + 1 && upper[1] === 0 && upper[2] === 0) return `minor and patch updates (${M}.x.x)`;
  if (upper[0] === M && upper[1] === m + 1 && upper[2] === 0) return `patch updates (${M}.${m}.x)`;
  if (upper[0] === M && upper[1] === m && upper[2] === p + 1) return "this version only";
  return `up to ${upper.join(".")}`;
}

const anyTerm = (source: string): Term => ({ source, comparators: [], meaning: "Any version" });
const noneTerm = (source: string): Term => ({
  source,
  comparators: [cmp("<", semverOf([0, 0, 0], ZERO), true)],
  meaning: "No version",
});

/** One npm or Cargo term: `^1.2`, `~1.2.3`, `>=1.0`, `1.x`, `*`, `1.2.3`. */
function semverTerm(token: string, dialect: "npm" | "cargo"): Term {
  const m = /^(<=|>=|<|>|=|\^|~>|~)?\s*(.*)$/.exec(token)!;
  let op = m[1] ?? "";
  const p = parsePartial(m[2], token);
  if (op === "~>") op = "~";
  if (op === "" && dialect === "cargo") op = "^";
  const lowerV = semverOf(releaseOf(p), p.pre);
  const range = (upper: number[], meaning: string): Term => ({
    source: token,
    comparators: [cmp(">=", lowerV), cmp("<", semverOf(upper, ZERO), true)],
    meaning,
  });

  if (op === "^") {
    if (p.major === undefined) return anyTerm(token);
    const lower = releaseOf(p);
    const upper = p.major > 0 || p.minor === undefined
      ? [p.major + 1, 0, 0]
      : p.minor > 0 || p.patch === undefined
      ? [0, p.minor + 1, 0]
      : [0, 0, p.patch + 1];
    const why = p.major === 0 && p.minor !== undefined
      ? " (below 1.0.0, ^ treats the first non-zero part as the major)"
      : "";
    return range(upper, `Compatible with ${format(lowerV)}: ${allowance(lower, upper)}${why}`);
  }
  if (op === "~") {
    if (p.major === undefined) return anyTerm(token);
    const upper = p.minor === undefined ? [p.major + 1, 0, 0] : [p.major, p.minor + 1, 0];
    return range(upper, `Approximately ${format(lowerV)}: ${allowance(releaseOf(p), upper)}`);
  }
  if (op === "" || op === "=") {
    if (p.major === undefined) return anyTerm(token);
    if (p.minor === undefined) return range([p.major + 1, 0, 0], `Any ${p.major}.x.x version`);
    if (p.patch === undefined) return range([p.major, p.minor + 1, 0], `Any ${p.major}.${p.minor}.x version`);
    return { source: token, comparators: [cmp("=", lowerV)], meaning: `Exactly ${format(lowerV)}` };
  }
  if (op === ">") {
    if (p.major === undefined) return noneTerm(token);
    if (p.minor === undefined) {
      const v = semverOf([p.major + 1, 0, 0]);
      return { source: token, comparators: [cmp(">=", v)], meaning: `${format(v)} or later` };
    }
    if (p.patch === undefined) {
      const v = semverOf([p.major, p.minor + 1, 0]);
      return { source: token, comparators: [cmp(">=", v)], meaning: `${format(v)} or later` };
    }
    return { source: token, comparators: [cmp(">", lowerV)], meaning: `Later than ${format(lowerV)}` };
  }
  if (op === ">=") {
    if (p.major === undefined) return anyTerm(token);
    return { source: token, comparators: [cmp(">=", lowerV)], meaning: `${format(lowerV)} or later` };
  }
  if (op === "<") {
    if (p.major === undefined) return noneTerm(token);
    const v = full(p) ? lowerV : semverOf(releaseOf(p), ZERO);
    return {
      source: token,
      comparators: [cmp("<", v, true)],
      meaning: `Below ${format({ ...v, pre: full(p) ? v.pre : [] })}`,
    };
  }
  // <=
  if (p.major === undefined) return anyTerm(token);
  if (full(p)) return { source: token, comparators: [cmp("<=", lowerV)], meaning: `${format(lowerV)} or earlier` };
  const upper = p.minor === undefined ? [p.major + 1, 0, 0] : [p.major, p.minor + 1, 0];
  return {
    source: token,
    comparators: [cmp("<", semverOf(upper, ZERO), true)],
    meaning: `Up to any ${p.major}${p.minor === undefined ? "" : `.${p.minor}`}.x version`,
  };
}

/** `1.2.3 - 2.3` (npm): both ends included, a partial upper end covers its whole range. */
function hyphenTerm(from: string, to: string): Term {
  const a = parsePartial(from, from);
  const b = parsePartial(to, to);
  const comparators: Comparator[] = [];
  if (a.major !== undefined) comparators.push(cmp(">=", semverOf(releaseOf(a), a.pre)));
  if (b.major !== undefined) {
    if (full(b)) comparators.push(cmp("<=", semverOf(releaseOf(b), b.pre)));
    else {
      const upper = b.minor === undefined ? [b.major + 1, 0, 0] : [b.major, b.minor + 1, 0];
      comparators.push(cmp("<", semverOf(upper, ZERO), true));
    }
  }
  return {
    source: `${from} - ${to}`,
    comparators,
    meaning: `From ${format(semverOf(releaseOf(a), a.pre))} to ${
      full(b) ? format(semverOf(releaseOf(b), b.pre)) : `any ${to}`
    }, both included`,
  };
}

/** `~> 2.2` (pessimistic): at least 2.2, below 3.0. */
function rubyTerm(token: string): Term {
  const m = /^(~>|>=|<=|!=|=|>|<)?\s*(.+)$/.exec(token.trim());
  if (!m) throw new SyntaxError(`“${token}” is not a gem requirement like ~> 2.1 or >= 1.0`);
  const op = m[1] ?? "=";
  const v = parseRuby(m[2]);
  if (op === "~>") {
    const segs = [...v.release];
    const upper = segs.length > 1 ? [...segs.slice(0, -2), segs[segs.length - 2] + 1] : [segs[0] + 1];
    const u = parseRuby(upper.join("."));
    const what = segs.length > 2 ? "patch-level updates" : segs.length === 2 ? "minor updates" : "any update";
    return {
      source: token,
      comparators: [cmp(">=", v), cmp("<", u)],
      meaning: `Pessimistic: ${format(v)} or later, below ${format(u)} (${what})`,
    };
  }
  const meaning: Record<string, string> = {
    "=": `Exactly ${format(v)}`,
    "!=": `Anything but ${format(v)}`,
    ">": `Later than ${format(v)}`,
    ">=": `${format(v)} or later`,
    "<": `Below ${format(v)}`,
    "<=": `${format(v)} or earlier`,
  };
  return { source: token, comparators: [cmp(op as Op, v)], meaning: meaning[op] };
}

/** `~=1.4.5`, `==1.4.*`, `!=1.5`, `>=2.0`, `===1.0`. */
function pythonTerm(token: string): Term {
  const m = /^(~=|===|==|!=|<=|>=|<|>)\s*(.+)$/.exec(token.trim());
  if (!m) {
    if (isVersion(token, "pep440")) {
      throw new SyntaxError(`Python specifiers need an operator: ==${token.trim()} or ~=${token.trim()}`);
    }
    throw new SyntaxError(`“${token}” is not a Python specifier like >=1.4, ~=2.2 or ==1.4.*`);
  }
  const [, op, text] = m;
  if (op === "===") {
    const v: Version = { scheme: "pep440", raw: text, epoch: 0, release: [], pre: [], build: [] };
    return {
      source: token,
      comparators: [{ op: "===", version: v, text: `===${text}` }],
      meaning: `Exactly the string ${text}`,
    };
  }
  if (text.endsWith(".*")) {
    if (op !== "==" && op !== "!=") throw new SyntaxError(`.* only works with == and != (${token})`);
    const v = parsePep440(text.slice(0, -2));
    return {
      source: token,
      comparators: [cmp(op === "==" ? "==*" : "!=*", v)],
      meaning: `${op === "==" ? "Any" : "Anything but"} ${format(v)}.* version`,
    };
  }
  const v = parsePep440(text);
  if (op === "~=") {
    if (v.release.length < 2) throw new SyntaxError(`~= needs at least two numbers: ~=${v.release[0]}.0`);
    const prefix = parsePep440(v.release.slice(0, -1).join("."));
    prefix.epoch = v.epoch;
    return {
      source: token,
      comparators: [cmp(">=", v), cmp("==*", prefix)],
      meaning: `Compatible release: ${format(v)} or later, within ${format(prefix)}.*`,
    };
  }
  const meaning: Record<string, string> = {
    "==": `Exactly ${format(v)}`,
    "!=": `Anything but ${format(v)}`,
    ">": `Later than ${format(v)}`,
    ">=": `${format(v)} or later`,
    "<": `Below ${format(v)}`,
    "<=": `${format(v)} or earlier`,
  };
  return { source: token, comparators: [cmp(op === "==" ? "=" : op as Op, v)], meaning: meaning[op] };
}

/** Guesses whose syntax a range is in. A bare `1.2.3` is npm's (exact). */
export function guessDialect(text: string): Dialect {
  if (/~>/.test(text)) return "ruby";
  if (/~=|==|!=/.test(text) || /\d(?:a|b|rc|\.post|\.dev)\d*\b/.test(text)) return "python";
  if (/,/.test(text) && !/\|\|/.test(text)) return "cargo";
  return "npm";
}

const PREFIXES: Record<string, Dialect> = {
  npm: "npm",
  node: "npm",
  cargo: "cargo",
  rust: "cargo",
  crates: "cargo",
  gem: "ruby",
  ruby: "ruby",
  bundler: "ruby",
  pip: "python",
  pypi: "python",
  python: "python",
  py: "python",
};

/** `cargo: 1.2` → ["cargo", "1.2"]. */
export function splitDialect(text: string): { dialect?: Dialect; rest: string } {
  const m = /^\s*([a-z]+):\s*(.*)$/is.exec(text);
  if (m && PREFIXES[m[1].toLowerCase()]) return { dialect: PREFIXES[m[1].toLowerCase()], rest: m[2] };
  return { rest: text };
}

export function parseRange(text: string, dialect: Dialect = guessDialect(text)): Range {
  const source = text.trim();
  if (dialect === "npm") {
    const sets = source.split("||").map((alt) => {
      const part = alt.trim();
      const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(part);
      if (hyphen) return [hyphenTerm(hyphen[1], hyphen[2])];
      const tokens = part.replace(/(<=|>=|<|>|=|\^|~>|~)\s+/g, "$1").split(/\s+/).filter(Boolean);
      return tokens.length ? tokens.map((t) => semverTerm(t, "npm")) : [anyTerm("*")];
    });
    return { dialect, source, sets };
  }
  if (/\|\|/.test(source)) throw new SyntaxError(`${DIALECT_TITLE[dialect]} has no || (alternatives are npm only)`);
  const tokens = source.split(",").map((t) => t.trim()).filter(Boolean);
  if (!tokens.length) throw new SyntaxError("Type a range, e.g. ^1.2.3, ~> 2.1 or >=1.4,<2");
  const make = dialect === "cargo"
    ? (t: string) => semverTerm(t.replace(/\s+/g, ""), "cargo")
    : dialect === "ruby"
    ? rubyTerm
    : pythonTerm;
  return { dialect, source, sets: [tokens.map(make)] };
}

// ---------------------------------------------------------------------------
// Matching

function prefixMatch(v: Version, prefix: Version): boolean {
  if (v.epoch !== prefix.epoch) return false;
  return prefix.release.every((n, i) => (v.release[i] ?? 0) === n);
}

function test(c: Comparator, v: Version): boolean {
  if (c.op === "===") return v.raw === c.version.raw;
  if (c.op === "==*") return prefixMatch(v, c.version);
  if (c.op === "!=*") return !prefixMatch(v, c.version);
  const d = compare(v, c.version);
  switch (c.op) {
    case "=":
      // PEP 440: 1.0 matches 1.0+local unless the specifier has a local label.
      if (v.scheme === "pep440" && !c.version.build.length) return compare({ ...v, build: [] }, c.version) === 0;
      return d === 0;
    case "!=":
      return d !== 0;
    case ">":
      // PEP 440: >1.7 doesn't match 1.7.post1.
      if (v.scheme === "pep440" && c.version.post === undefined && v.post !== undefined) {
        if (compare({ ...v, post: undefined, build: [] }, c.version) === 0) return false;
      }
      return d > 0;
    case ">=":
      return d >= 0;
    case "<":
      // PEP 440: <1.7 doesn't match 1.7rc1.
      if (v.scheme === "pep440" && !isPrerelease(c.version) && isPrerelease(v)) {
        if (compareRelease(v.release, c.version.release) === 0 && v.epoch === c.version.epoch) return false;
      }
      return d < 0;
    case "<=":
      return d <= 0;
  }
  return false;
}

export interface Verdict {
  ok: boolean;
  /** Why not, or which alternative matched. */
  reason: string;
}

const describeFailure = (c: Comparator): string => {
  switch (c.op) {
    case ">=":
    case ">":
      return `below the minimum (${c.text})`;
    case "<":
    case "<=":
      return `above the maximum (${c.text})`;
    case "!=":
    case "!=*":
      return `excluded by ${c.text}`;
    default:
      return `doesn't match ${c.text}`;
  }
};

/** Whether `v` is in the range, and why not. */
export function satisfies(v: Version, range: Range): Verdict {
  const reasons: string[] = [];
  for (const set of range.sets) {
    const comparators = set.flatMap((t) => t.comparators);
    const failed = comparators.find((c) => !test(c, v));
    if (failed) {
      reasons.push(describeFailure(failed));
      continue;
    }
    if (isPrerelease(v) && range.dialect !== "ruby") {
      // npm and Cargo match a prerelease only when a comparator names a prerelease of the same x.y.z;
      // pip only when the specifiers mention a prerelease.
      const allowed = range.dialect === "python"
        ? comparators.some((c) => isPrerelease(c.version))
        : comparators.some((c) => c.version.pre.length > 0 && compareRelease(c.version.release, v.release) === 0);
      if (!allowed) {
        reasons.push(
          range.dialect === "python"
            ? "is a prerelease: pip skips them unless the specifier names one (or --pre)"
            : `is a prerelease: ${DIALECT_TITLE[range.dialect]} only matches prereleases of a version the range names`,
        );
        continue;
      }
    }
    return { ok: true, reason: range.sets.length > 1 ? `matches ${set.map((t) => t.source).join(" ")}` : "matches" };
  }
  return { ok: false, reason: reasons.length === 1 ? reasons[0] : `matches none of the alternatives` };
}

/** The highest of `versions` the range accepts. */
export function maxSatisfying(versions: Version[], range: Range): Version | undefined {
  return sortVersions(versions.filter((v) => satisfies(v, range).ok)).pop();
}

// ---------------------------------------------------------------------------
// Bounds and words

export interface Bound {
  version: Version;
  inclusive: boolean;
  text: string;
}

export interface Bounds {
  lower?: Bound;
  upper?: Bound;
  exact?: Version;
  excluded: string[];
  empty: boolean;
}

function prefixUpper(prefix: Version): Version {
  const release = [...prefix.release];
  release[release.length - 1]++;
  const v: Version = { scheme: "pep440", raw: "", epoch: prefix.epoch, release, pre: [], dev: 0, build: [] };
  return { ...v, raw: format(v) };
}

const shown = (v: Version) =>
  v.scheme === "semver" && v.pre.length === 1 && v.pre[0] === 0
    ? format({ ...v, pre: [] })
    : v.scheme === "pep440" && v.dev === 0 && !v.pre.length && v.post === undefined
    ? format({ ...v, dev: undefined })
    : format(v);

/** The lowest and highest versions one alternative allows. */
export function bounds(set: Term[]): Bounds {
  let lower: Bound | undefined;
  let upper: Bound | undefined;
  let exact: Version | undefined;
  const excluded: string[] = [];
  const raiseLower = (version: Version, inclusive: boolean) => {
    const d = lower ? compare(version, lower.version) : 1;
    if (d > 0 || (d === 0 && !inclusive)) lower = { version, inclusive, text: shown(version) };
  };
  const lowerUpper = (version: Version, inclusive: boolean) => {
    const d = upper ? compare(version, upper.version) : -1;
    if (d < 0 || (d === 0 && !inclusive)) upper = { version, inclusive, text: shown(version) };
  };
  for (const c of set.flatMap((t) => t.comparators)) {
    if (c.op === ">=") raiseLower(c.version, true);
    else if (c.op === ">") raiseLower(c.version, false);
    else if (c.op === "<") lowerUpper(c.version, false);
    else if (c.op === "<=") lowerUpper(c.version, true);
    else if (c.op === "=" || c.op === "===") {
      exact = c.version;
      raiseLower(c.version, true);
      lowerUpper(c.version, true);
    } else if (c.op === "==*") {
      const start: Version = { ...c.version, dev: 0, raw: "" };
      raiseLower({ ...start, raw: format(start) }, true);
      lowerUpper(prefixUpper(c.version), false);
    } else excluded.push(c.text.replace(/^!=/, ""));
  }
  let empty = false;
  if (lower && upper) {
    const d = compare(lower.version, upper.version);
    empty = d > 0 || (d === 0 && !(lower.inclusive && upper.inclusive));
  }
  if (exact && lower && upper && compare(lower.version, upper.version) !== 0) exact = undefined;
  if (exact && (!lower || !upper)) exact = undefined;
  return { lower, upper, exact, excluded, empty };
}

/** "From 1.2.3 (included) to 2.0.0 (excluded)". */
export function boundsInWords(b: Bounds): string {
  let text: string;
  if (b.empty) return "No version can match";
  if (b.exact) text = `Exactly ${format(b.exact)}`;
  else if (b.lower && b.upper) {
    text = `From ${b.lower.text} (${b.lower.inclusive ? "included" : "excluded"}) to ${b.upper.text} (${
      b.upper.inclusive ? "included" : "excluded"
    })`;
  } else if (b.lower) text = b.lower.inclusive ? `${b.lower.text} or later` : `Later than ${b.lower.text}`;
  else if (b.upper) text = b.upper.inclusive ? `${b.upper.text} or earlier` : `Below ${b.upper.text}`;
  else text = "Any version";
  if (b.excluded.length) text += `, except ${b.excluded.join(", ")}`;
  return text;
}

/** `>=1.2.3 <2.0.0` */
export function boundsShort(b: Bounds): string {
  if (b.empty) return "∅";
  if (b.exact) return `=${format(b.exact)}`;
  const parts = [
    ...(b.lower ? [`${b.lower.inclusive ? ">=" : ">"}${b.lower.text}`] : []),
    ...(b.upper ? [`${b.upper.inclusive ? "<=" : "<"}${b.upper.text}`] : []),
    ...b.excluded.map((e) => `!=${e}`),
  ];
  return parts.length ? parts.join(" ") : "*";
}

/** The range rewritten with plain comparators, `>=1.2.3 <2.0.0 || >=3.0.0`. */
export function desugared(range: Range): string {
  const join = range.dialect === "npm" ? " " : ", ";
  return range.sets.map((set) => {
    const cs = set.flatMap((t) => t.comparators);
    return cs.length ? cs.map((c) => c.text).join(join) : "*";
  }).join(" || ");
}

// ---------------------------------------------------------------------------
// The search bar

export type Query =
  | { kind: "empty" }
  | { kind: "version"; version: Version; dialect?: Dialect }
  | { kind: "bump"; version: Version; preid: string }
  | { kind: "compare"; a: Version; b: Version }
  | { kind: "sort"; versions: Version[] }
  | { kind: "range"; range: Range; candidates: Version[]; explicit: boolean }
  | { kind: "error"; message: string };

const errorOf = (e: unknown): Query => ({ kind: "error", message: e instanceof Error ? e.message : String(e) });

/**
 * What was typed:
 * `^1.2.3 1.4.0` (range, then versions to check), `1.4.0 in ^1.2`, `bump 1.2.3 [beta]`,
 * `1.2.3 vs 1.10.0`, `sort 1.10.0 1.2.0 1.9.0`, `cargo: 1.2`, or just a version or a range.
 */
export function parseQuery(text: string): Query {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "empty" };
  const { dialect: forced, rest } = splitDialect(trimmed);
  const input = rest.trim();
  try {
    const bumpMatch = /^(?:bump|inc|increment|next)\s+(\S+)(?:\s+(?:--preid[= ])?([0-9A-Za-z-]+))?$/i.exec(input);
    if (bumpMatch) return { kind: "bump", version: parseSemver(bumpMatch[1]), preid: bumpMatch[2] ?? "" };

    const scheme = forced ? SCHEME[forced] : guessScheme(input);
    const vs = /^(\S+)\s+(?:vs\.?|versus|<=>|<|>|=|==|compare|cmp)\s+(\S+)$/i.exec(input);
    if (vs && isVersion(vs[1], scheme) && isVersion(vs[2], scheme)) {
      return { kind: "compare", a: parseVersion(vs[1], scheme), b: parseVersion(vs[2], scheme) };
    }
    const sort = /^sort\s+(.+)$/i.exec(input);
    if (sort) {
      return { kind: "sort", versions: sort[1].split(/[\s,]+/).filter(Boolean).map((t) => parseVersion(t, scheme)) };
    }
    const inMatch = /^(\S+(?:[\s,]+\S+)*?)\s+(?:in|satisfies|matches)\s+(.+)$/i.exec(input);
    if (inMatch && inMatch[1].split(/[\s,]+/).every((t) => isVersion(t, scheme))) {
      const range = parseRange(inMatch[2], forced ?? guessDialect(inMatch[2]));
      const vscheme = SCHEME[range.dialect];
      return {
        kind: "range",
        range,
        candidates: inMatch[1].split(/[\s,]+/).map((t) => parseVersion(t, vscheme)),
        explicit: true,
      };
    }

    const tokens = input.split(/\s+/);
    if (!forced && tokens.length >= 2 && tokens.every((t) => isPlain(t))) {
      if (tokens.length === 2) {
        return { kind: "compare", a: parseVersion(tokens[0], scheme), b: parseVersion(tokens[1], scheme) };
      }
      return { kind: "sort", versions: tokens.map((t) => parseVersion(t, scheme)) };
    }
    if (tokens.length === 1 && isPlain(tokens[0]) && isVersion(tokens[0], scheme) && forced !== "cargo") {
      return { kind: "version", version: parseVersion(tokens[0], forced ? SCHEME[forced] : scheme), dialect: forced };
    }

    // Trailing plain versions are the ones to check, unless they end a hyphen range or follow a comma.
    let split = tokens.length;
    while (split > 1 && isPlain(tokens[split - 1]) && !/,$/.test(tokens[split - 2])) {
      if (tokens[split - 2] === "-") break;
      split--;
    }
    let rangeText = tokens.slice(0, split).join(" ");
    let candidates = tokens.slice(split);
    // Operators followed by a space (`>= 1.2 1.5`): the first "candidate" belongs to the operator.
    if (/(<=|>=|<|>|=|\^|~>|~|~=|==|!=)$/.test(rangeText) && candidates.length) {
      rangeText = `${rangeText} ${candidates[0]}`;
      candidates = candidates.slice(1);
    }
    const range = parseRange(rangeText, forced ?? guessDialect(rangeText));
    return {
      kind: "range",
      range,
      candidates: candidates.map((t) => parseVersion(t, SCHEME[range.dialect])),
      explicit: false,
    };
  } catch (e) {
    return errorOf(e);
  }
}

/** A token that is only a version: no operator, no wildcard. */
const isPlain = (t: string) =>
  /^v?\d+(?:[.\-+_!][0-9A-Za-z.\-+_]*)?$/.test(t) && !/(^|\.)[xX*](?=\.|$)/.test(t.replace(/[-+].*$/, ""));

function guessScheme(text: string): Scheme {
  if (/\d(?:a|b|rc|c)\d+\b|\.post\d|\.dev\d|\d!\d/.test(text)) return "pep440";
  if (/\d\.\d+\.\d+\.\d|\d\.[a-z]+\d*$|\.(pre|rc|beta|alpha)\d*(\s|$)/i.test(text)) return "ruby";
  return "semver";
}

/** "1.2.3 < 1.10.0" */
export function compareSentence(a: Version, b: Version): string {
  const d = compare(a, b);
  return `${format(a)} ${d < 0 ? "<" : d > 0 ? ">" : "="} ${format(b)}`;
}

/** Why one is newer: "minor 2 < 10". */
export function compareReason(a: Version, b: Version): string {
  const diff = difference(a, b);
  const d = compare(a, b);
  const sym = d < 0 ? "<" : d > 0 ? ">" : "=";
  const index = { major: 0, minor: 1, patch: 2 } as Record<string, number>;
  if (diff in index) {
    let i = index[diff];
    while (i < 8 && (a.release[i] ?? 0) === (b.release[i] ?? 0)) i++;
    const name = i === 0 ? "major" : i === 1 ? "minor" : i === 2 ? "patch" : `part ${i + 1}`;
    return `${name} ${a.release[i] ?? 0} ${sym} ${b.release[i] ?? 0}`;
  }
  if (diff === "prerelease") {
    if (!a.pre.length || !b.pre.length) {
      return `${!a.pre.length ? format(a) : format(b)} is the final release, after its prereleases`;
    }
    return `prerelease ${a.pre.join(".")} ${sym} ${b.pre.join(".")}`;
  }
  if (diff === "build") return "build metadata doesn't count in the order";
  if (diff === "epoch") return `epoch ${a.epoch} ${sym} ${b.epoch}`;
  if (diff === "post") return `post-release ${a.post ?? "none"} ${sym} ${b.post ?? "none"}`;
  if (diff === "dev") return `dev release ${a.dev ?? "none"} ${sym} ${b.dev ?? "none"}`;
  return "the same version";
}

/** The parts of a version, for the detail panel. */
export function parts(v: Version): [string, string][] {
  const rows: [string, string][] = [];
  if (v.epoch) rows.push(["Epoch", String(v.epoch)]);
  const names = ["Major", "Minor", "Patch"];
  v.release.forEach((n, i) => rows.push([names[i] ?? `Part ${i + 1}`, String(n)]));
  if (v.pre.length) rows.push(["Prerelease", v.scheme === "pep440" ? `${v.pre[0]}${v.pre[1]}` : v.pre.join(".")]);
  if (v.post !== undefined) rows.push(["Post-release", String(v.post)]);
  if (v.dev !== undefined) rows.push(["Dev release", String(v.dev)]);
  if (v.build.length) rows.push([v.scheme === "pep440" ? "Local" : "Build", v.build.join(".")]);
  return rows;
}

export const EXAMPLES: { query: string; title: string }[] = [
  { query: "^1.2.3 1.4.0 2.0.0", title: "Does a version match an npm range?" },
  { query: "~1.2", title: "Explain a range in words" },
  { query: ">=1.0.0 <2.0.0 || ^3.1", title: "Alternatives with ||" },
  { query: "1.2.3 - 2.3", title: "Hyphen range" },
  { query: "cargo: 0.4", title: "Cargo: a bare version means ^" },
  { query: "~> 2.1 2.9.4", title: "RubyGems pessimistic operator" },
  { query: "~=1.4.5 1.4.9", title: "Python compatible release" },
  { query: ">=2.0,!=2.1.*,<3 2.1.4", title: "Python exclusions" },
  { query: "bump 1.2.3", title: "Next major, minor, patch, prerelease" },
  { query: "bump 2.0.0-rc.1 rc", title: "Next prerelease" },
  { query: "1.2.3 vs 1.10.0", title: "Compare two versions" },
  { query: "sort 1.10.0 1.2.0 1.2.0-rc.1 1.9.0", title: "Sort versions" },
];
