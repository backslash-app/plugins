// OSV.dev advisories: what to query, severities from CVSS vectors, affected ranges, and lockfile parsing.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// OSV schema (https://ossf.github.io/osv-schema/), the parts we read

export interface OsvEvent {
  introduced?: string;
  fixed?: string;
  last_affected?: string;
  limit?: string;
}

export interface OsvRange {
  type: "SEMVER" | "ECOSYSTEM" | "GIT" | string;
  repo?: string;
  events: OsvEvent[];
}

export interface OsvSeverity {
  type: "CVSS_V2" | "CVSS_V3" | "CVSS_V4" | "Ubuntu" | string;
  score: string;
}

export interface OsvAffected {
  package?: { ecosystem: string; name: string; purl?: string };
  ranges?: OsvRange[];
  versions?: string[];
  severity?: OsvSeverity[];
  database_specific?: Record<string, unknown>;
  ecosystem_specific?: Record<string, unknown>;
}

export interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  related?: string[];
  modified: string;
  published?: string;
  withdrawn?: string;
  severity?: OsvSeverity[];
  affected?: OsvAffected[];
  references?: { type: string; url: string }[];
  database_specific?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Ecosystems

export interface Ecosystem {
  /** OSV's name. */
  id: string;
  title: string;
  /** What users type before the colon. */
  prefixes: string[];
}

export const ECOSYSTEMS: Ecosystem[] = [
  { id: "npm", title: "npm", prefixes: ["npm", "node", "js", "yarn", "pnpm"] },
  { id: "PyPI", title: "PyPI", prefixes: ["pypi", "pip", "python", "py", "poetry", "uv"] },
  { id: "crates.io", title: "crates.io", prefixes: ["crates", "crate", "cargo", "rust", "crates.io"] },
  { id: "Go", title: "Go", prefixes: ["go", "golang"] },
  { id: "RubyGems", title: "RubyGems", prefixes: ["gem", "gems", "rubygems", "ruby", "bundler"] },
  { id: "Maven", title: "Maven", prefixes: ["maven", "mvn", "java", "gradle"] },
  { id: "Packagist", title: "Packagist", prefixes: ["packagist", "composer", "php"] },
  { id: "NuGet", title: "NuGet", prefixes: ["nuget", "dotnet", ".net"] },
  { id: "Hex", title: "Hex", prefixes: ["hex", "elixir", "erlang", "mix"] },
  { id: "Pub", title: "Pub", prefixes: ["pub", "dart", "flutter"] },
];

export function ecosystemFor(prefix: string): Ecosystem | undefined {
  const p = prefix.toLowerCase();
  return ECOSYSTEMS.find((e) => e.prefixes.includes(p) || e.id.toLowerCase() === p);
}

export const ecosystemTitle = (id: string) => ECOSYSTEMS.find((e) => e.id === id)?.title ?? id;

/** PyPI names are case and punctuation insensitive (PEP 503). */
export function normalizeName(ecosystem: string, name: string): string {
  if (ecosystem === "PyPI") return name.toLowerCase().replace(/[-_.]+/g, "-");
  return name;
}

// ---------------------------------------------------------------------------
// The search bar

export type Search =
  | { kind: "empty" }
  | { kind: "id"; id: string }
  | { kind: "package"; ecosystem: string; name: string; version?: string };

const ID =
  /^(CVE-\d{4}-\d{4,}|GHSA(?:-[0-9a-z]{4}){3}|(?:PYSEC|RUSTSEC|GO|OSV|GSD|MAL|DLA|DSA|USN|ALSA|RLSA|RHSA|BIT|CGA|UVI|LBSEC|PSF|HSEC|JLSEC|ESB|SUSE-SU|openSUSE-SU)-[0-9A-Za-z:._-]+)$/i;

/** `CVE-2021-44228`, `ghsa-35jh-r3h4-6jhm` → the id OSV knows. */
export function normalizeId(text: string): string | undefined {
  const t = text.trim();
  if (!ID.test(t)) return undefined;
  const [prefix, ...rest] = t.split("-");
  const upper = prefix.toUpperCase();
  if (upper === "GHSA") return `GHSA-${rest.join("-").toLowerCase()}`;
  if (upper === "CVE") return t.toUpperCase();
  if (/^(open)?suse$/i.test(prefix)) return t;
  return `${upper}-${rest.join("-")}`;
}

/**
 * `lodash@4.17.20`, `@babel/core@7.0.0`, `pypi:requests 2.19`, `pip:requests==2.19.0`, `crates:time`,
 * `go:github.com/gin-gonic/gin@v1.6.0`, `maven:org.apache.logging.log4j:log4j-core 2.14.1`, an advisory id.
 */
export function parseSearch(text: string): Search {
  const t = text.trim();
  if (!t) return { kind: "empty" };
  const id = normalizeId(t);
  if (id) return { kind: "id", id };
  let ecosystem = "npm";
  let rest = t;
  const prefixed = /^([a-z.]+):(?!\/\/)(.+)$/i.exec(t);
  if (prefixed) {
    const eco = ecosystemFor(prefixed[1]);
    if (eco) {
      ecosystem = eco.id;
      rest = prefixed[2].trim();
    }
  }
  let name = rest;
  let version: string | undefined;
  const spaced = /^(\S+)\s+(\S+)$/.exec(rest);
  const pinned = /^(.+?)\s*(?:===?|@)\s*([^@=\s]+)$/.exec(rest);
  if (spaced) [, name, version] = spaced;
  else if (pinned && !(ecosystem === "npm" && rest.startsWith("@") && !rest.slice(1).includes("@"))) {
    [, name, version] = pinned;
  }
  if (ecosystem === "Maven" && !version) {
    // group:artifact:version
    const parts = name.split(":");
    if (parts.length === 3) [name, version] = [`${parts[0]}:${parts[1]}`, parts[2]];
  }
  if (version && ecosystem === "Go") version = version.replace(/^v/, "");
  if (version === "latest" || version === "*") version = undefined;
  return { kind: "package", ecosystem, name: normalizeName(ecosystem, name), version };
}

// ---------------------------------------------------------------------------
// CVSS

export type Severity = "Critical" | "High" | "Medium" | "Low" | "None" | "Unknown";

export const SEVERITY_ORDER: Severity[] = ["Critical", "High", "Medium", "Low", "None", "Unknown"];

export const SEVERITY_COLOR: Record<Severity, Color> = {
  Critical: "red",
  High: "orange",
  Medium: "yellow",
  Low: "blue",
  None: "gray",
  Unknown: "gray",
};

const roundUp = (x: number) => {
  const i = Math.round(x * 100000);
  return i % 10000 === 0 ? i / 100000 : (Math.floor(i / 10000) + 1) / 10;
};

function metrics(vector: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of vector.split("/")) {
    const [k, v] = part.split(":");
    if (k && v) out[k] = v;
  }
  return out;
}

/** CVSS v3.0/v3.1 base score from its vector. */
export function cvss3(vector: string): number | undefined {
  const m = metrics(vector);
  const AV = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 }[m.AV];
  const AC = { L: 0.77, H: 0.44 }[m.AC];
  const UI = { N: 0.85, R: 0.62 }[m.UI];
  const changed = m.S === "C";
  const PR = { N: 0.85, L: changed ? 0.68 : 0.62, H: changed ? 0.5 : 0.27 }[m.PR];
  const cia = (x: string) => ({ H: 0.56, L: 0.22, N: 0 } as Record<string, number>)[x];
  const C = cia(m.C), I = cia(m.I), A = cia(m.A);
  if ([AV, AC, UI, PR, C, I, A].some((x) => x === undefined) || !["U", "C"].includes(m.S)) return undefined;
  const iss = 1 - (1 - C) * (1 - I) * (1 - A);
  const impact = changed ? 7.52 * (iss - 0.029) - 3.25 * Math.pow(iss - 0.02, 15) : 6.42 * iss;
  const exploitability = 8.22 * AV! * AC! * PR! * UI!;
  if (impact <= 0) return 0;
  return changed
    ? roundUp(Math.min(1.08 * (impact + exploitability), 10))
    : roundUp(Math.min(impact + exploitability, 10));
}

/** CVSS v2 base score from its vector. */
export function cvss2(vector: string): number | undefined {
  const m = metrics(vector.replace(/^\(|\)$/g, ""));
  const AV = { L: 0.395, A: 0.646, N: 1 }[m.AV];
  const AC = { H: 0.35, M: 0.61, L: 0.71 }[m.AC];
  const Au = { M: 0.45, S: 0.56, N: 0.704 }[m.Au];
  const cia = (x: string) => ({ N: 0, P: 0.275, C: 0.66 } as Record<string, number>)[x];
  const C = cia(m.C), I = cia(m.I), A = cia(m.A);
  if ([AV, AC, Au, C, I, A].some((x) => x === undefined)) return undefined;
  const impact = 10.41 * (1 - (1 - C) * (1 - I) * (1 - A));
  const exploitability = 20 * AV! * AC! * Au!;
  const f = impact === 0 ? 0 : 1.176;
  return Math.round(((0.6 * impact) + (0.4 * exploitability) - 1.5) * f * 10) / 10;
}

/** The qualitative rating of a score (v3 and v4 bands; v2 has no Critical). */
export function rating(score: number, version: 2 | 3 | 4 = 3): Severity {
  if (score === 0) return "None";
  if (score >= 9 && version !== 2) return "Critical";
  if (score >= 7) return "High";
  if (score >= 4) return "Medium";
  return "Low";
}

const LABELS: Record<string, Severity> = {
  CRITICAL: "Critical",
  HIGH: "High",
  IMPORTANT: "High",
  MODERATE: "Medium",
  MEDIUM: "Medium",
  LOW: "Low",
  NEGLIGIBLE: "Low",
};

export interface Score {
  severity: Severity;
  /** 0–10 when a CVSS v2/v3 vector gives one. */
  score?: number;
  /** `CVSS:3.1/AV:N/…` */
  vector?: string;
  /** "CVSS 3.1", "CVSS 4.0", "GitHub", … */
  source?: string;
}

/** The most useful severity of an advisory: a computed CVSS v3 score, else v2, else the database's label. */
export function severityOf(v: OsvVuln): Score {
  const all = [...(v.severity ?? []), ...(v.affected ?? []).flatMap((a) => a.severity ?? [])];
  const v3 = all.find((s) => s.type === "CVSS_V3" || /^CVSS:3/.test(s.score));
  if (v3) {
    const score = cvss3(v3.score);
    if (score !== undefined) {
      return {
        severity: rating(score),
        score,
        vector: v3.score,
        source: `CVSS ${/^CVSS:(3\.\d)/.exec(v3.score)?.[1] ?? "3"}`,
      };
    }
  }
  const label = [
    v.database_specific?.severity,
    ...(v.affected ?? []).map((a) => a.ecosystem_specific?.severity ?? a.database_specific?.severity),
  ].find((s) => typeof s === "string" && LABELS[s.toUpperCase()]) as string | undefined;
  const v4 = all.find((s) => s.type === "CVSS_V4" || /^CVSS:4/.test(s.score));
  if (label) {
    return {
      severity: LABELS[label.toUpperCase()],
      vector: v4?.score,
      source: v4 ? "CVSS 4.0 (rated by the database)" : "Database",
    };
  }
  const v2 = all.find((s) => s.type === "CVSS_V2");
  if (v2) {
    const score = cvss2(v2.score);
    if (score !== undefined) return { severity: rating(score, 2), score, vector: v2.score, source: "CVSS 2.0" };
  }
  const ubuntu = all.find((s) => s.type === "Ubuntu" && LABELS[s.score.toUpperCase()]);
  if (ubuntu) return { severity: LABELS[ubuntu.score.toUpperCase()], source: "Ubuntu" };
  if (v4) return { severity: "Unknown", vector: v4.score, source: "CVSS 4.0" };
  return { severity: "Unknown" };
}

export const worst = (scores: Score[]): Score =>
  scores.reduce<Score>(
    (a, b) =>
      SEVERITY_ORDER.indexOf(b.severity) < SEVERITY_ORDER.indexOf(a.severity) ||
        (b.severity === a.severity && (b.score ?? 0) > (a.score ?? 0))
        ? b
        : a,
    { severity: "Unknown" },
  );

// ---------------------------------------------------------------------------
// Affected versions

/** Loose version order across ecosystems: numbers compare as numbers, a prerelease sorts first. */
export function looseCompare(a: string, b: string): number {
  const split = (s: string) => s.replace(/^v/, "").split(/[.+-]/);
  const pa = split(a), pb = split(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i], y = pb[i];
    if (x === undefined) return y !== undefined && /^\d+$/.test(y) ? -1 : 1;
    if (y === undefined) return /^\d+$/.test(x) ? 1 : -1;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) {
      const d = Number(x) - Number(y);
      if (d) return Math.sign(d);
    } else if (nx !== ny) return nx ? 1 : -1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

const matches = (a: OsvAffected, ecosystem: string, name: string) =>
  !a.package ||
  (a.package.ecosystem.split(":")[0] === ecosystem &&
    normalizeName(ecosystem, a.package.name) === normalizeName(ecosystem, name));

/** The affected entries for one package (all of them when no package is given). */
export function affectedFor(v: OsvVuln, ecosystem?: string, name?: string): OsvAffected[] {
  const all = v.affected ?? [];
  if (!ecosystem || !name) return all;
  const mine = all.filter((a) => matches(a, ecosystem, name));
  return mine.length ? mine : all;
}

/** `0`, `0.0.0` and `0.0.0-0` all mean "from the first version". */
const isZero = (v: string) => /^0(?:\.0)*(?:-0)?$/.test(v);

/** `>=1.0.0 <1.2.5`, `<4.17.21`, `>=2.0.0` (no fix), from a range's events. */
export function rangeText(range: OsvRange): string[] {
  const out: string[] = [];
  let start: string | undefined;
  for (const e of range.events) {
    if (e.introduced !== undefined) start = e.introduced;
    else if (e.fixed !== undefined || e.last_affected !== undefined) {
      const end = e.fixed !== undefined ? `<${e.fixed}` : `<=${e.last_affected}`;
      out.push(start && !isZero(start) ? `>=${start} ${end}` : end);
      start = undefined;
    } else if (e.limit !== undefined) {
      out.push(start && !isZero(start) ? `>=${start} <${e.limit}` : `<${e.limit}`);
      start = undefined;
    }
  }
  if (start !== undefined) out.push(isZero(start) ? "all versions" : `>=${start}`);
  return out;
}

/** Ranges of the affected entries, in words, skipping git commit ranges. */
export function affectedRanges(affected: OsvAffected[]): string[] {
  const out = affected.flatMap((a) => (a.ranges ?? []).filter((r) => r.type !== "GIT").flatMap(rangeText));
  if (!out.length) {
    const versions = affected.flatMap((a) => a.versions ?? []);
    if (versions.length) {
      return [
        versions.length > 6
          ? `${versions.slice(0, 5).join(", ")} and ${versions.length - 5} more`
          : versions.join(", "),
      ];
    }
  }
  return [...new Set(out)];
}

/** Every version that fixes it, lowest first. */
export function fixedVersions(affected: OsvAffected[]): string[] {
  const fixed = affected.flatMap((a) =>
    (a.ranges ?? []).filter((r) => r.type !== "GIT").flatMap((r) => r.events.map((e) => e.fixed))
  ).filter((f): f is string => !!f);
  return [...new Set(fixed)].sort(looseCompare);
}

/**
 * The version to upgrade to from `version`: the first fix after the start of the range it is in,
 * else the lowest fix above it.
 */
export function fixFor(affected: OsvAffected[], version?: string): string | undefined {
  const all = fixedVersions(affected);
  if (!version) return all[all.length - 1];
  for (const a of affected) {
    for (const r of a.ranges ?? []) {
      if (r.type === "GIT") continue;
      let start: string | undefined;
      for (const e of r.events) {
        if (e.introduced !== undefined) start = e.introduced;
        else if (e.fixed !== undefined) {
          const inside = (start === undefined || isZero(start) || looseCompare(version, start) >= 0) &&
            looseCompare(version, e.fixed) < 0;
          if (inside) return e.fixed;
          start = undefined;
        }
      }
    }
  }
  return all.find((f) => looseCompare(f, version) > 0);
}

/** The advisory pages worth opening first. */
export function advisoryUrl(v: OsvVuln): string {
  return `https://osv.dev/vulnerability/${encodeURIComponent(v.id)}`;
}

const REF_ORDER = ["ADVISORY", "FIX", "REPORT", "ARTICLE", "PACKAGE", "WEB", "EVIDENCE", "INTRODUCED", "GIT"];

export function sortedReferences(v: OsvVuln): { type: string; url: string }[] {
  return [...(v.references ?? [])].sort((a, b) =>
    (REF_ORDER.indexOf(a.type) + 100) % 100 - (REF_ORDER.indexOf(b.type) + 100) % 100
  );
}

export const cves = (v: OsvVuln) => [v.id, ...(v.aliases ?? [])].filter((a) => /^CVE-/.test(a));

/** A one-line title: the summary, or the start of the details. */
export function headline(v: OsvVuln): string {
  const s = v.summary?.trim() || v.details?.trim().split(/\n/)[0]?.replace(/[#*`]/g, "").trim() || v.id;
  return s.length > 140 ? `${s.slice(0, 137)}…` : s;
}

/** "3d", "5mo", "2y". */
export function age(date: string | undefined, now = Date.now()): string {
  if (!date) return "";
  const days = Math.floor((now - Date.parse(date)) / 86_400_000);
  if (Number.isNaN(days)) return "";
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

const fence = (s: string) => s.replace(/\r\n/g, "\n");

/** The detail panel's markdown for an advisory. */
export function vulnMarkdown(v: OsvVuln, ecosystem?: string, name?: string, version?: string): string {
  const affected = affectedFor(v, ecosystem, name);
  const lines = [`## ${headline(v)}`, ""];
  if (v.withdrawn) lines.push(`> **Withdrawn** on ${v.withdrawn.slice(0, 10)}.`, "");
  const fix = fixFor(affected, version);
  if (version) {
    lines.push(
      fix
        ? `**${name} ${version} is affected: upgrade to ${fix} or later.**`
        : `**${name} ${version} is affected, and no fixed version is known.**`,
      "",
    );
  }
  if (v.details?.trim() && v.details.trim() !== v.summary?.trim()) lines.push(fence(v.details.trim()), "");
  const packages = affected.filter((a) => a.package);
  if (packages.length) {
    lines.push("### Affected", "", "| Package | Versions | Fixed in |", "|---|---|---|");
    for (const a of packages) {
      const ranges = affectedRanges([a]);
      const fixed = fixedVersions([a]);
      lines.push(
        `| ${ecosystemTitle(a.package!.ecosystem)} \`${a.package!.name}\` | ${
          ranges.map((r) => `\`${r}\``).join(", ") || "—"
        } | ${fixed.join(", ") || "not fixed"} |`,
      );
    }
    lines.push("");
  }
  const refs = sortedReferences(v);
  if (refs.length) {
    lines.push("### References", "");
    for (const r of refs.slice(0, 12)) lines.push(`- ${r.type.toLowerCase()}: [${shortUrl(r.url)}](${r.url})`);
    if (refs.length > 12) lines.push(`- …and ${refs.length - 12} more`);
  }
  return lines.join("\n").trim();
}

export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/$/, "");
    const text = `${u.host.replace(/^www\./, "")}${path}`;
    return text.length > 70 ? `${text.slice(0, 67)}…` : text;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Lockfiles

export interface Dependency {
  ecosystem: string;
  name: string;
  version: string;
  /** Development only (devDependencies, dev group). */
  dev?: boolean;
}

export interface Lockfile {
  file: string;
  ecosystem: string;
  parse: (text: string) => Dependency[];
}

const dedupe = (deps: Dependency[]): Dependency[] => {
  const seen = new Map<string, Dependency>();
  for (const d of deps) {
    const key = `${d.ecosystem}\0${normalizeName(d.ecosystem, d.name)}\0${d.version}`;
    const prev = seen.get(key);
    if (!prev) seen.set(key, d);
    else if (prev.dev && !d.dev) prev.dev = false;
  }
  return [...seen.values()];
};

/** package-lock.json / npm-shrinkwrap.json, lockfileVersion 1, 2 and 3. */
export function parsePackageLock(text: string): Dependency[] {
  const json = JSON.parse(text) as {
    packages?: Record<string, { version?: string; name?: string; dev?: boolean; link?: boolean }>;
    dependencies?: Record<string, LockV1>;
  };
  const deps: Dependency[] = [];
  if (json.packages) {
    for (const [path, p] of Object.entries(json.packages)) {
      if (!path || p.link || !p.version) continue;
      const i = path.lastIndexOf("node_modules/");
      if (i < 0) continue;
      const name = p.name ?? path.slice(i + "node_modules/".length);
      if (/^(file|link|git|http)/.test(p.version)) continue;
      deps.push({ ecosystem: "npm", name, version: p.version, dev: p.dev });
    }
  } else if (json.dependencies) {
    const walk = (tree: Record<string, LockV1>) => {
      for (const [name, d] of Object.entries(tree)) {
        if (d.version && !/^(file|link|git|http)/.test(d.version)) {
          deps.push({ ecosystem: "npm", name, version: d.version, dev: d.dev });
        }
        if (d.dependencies) walk(d.dependencies);
      }
    };
    walk(json.dependencies);
  }
  return dedupe(deps);
}

interface LockV1 {
  version?: string;
  dev?: boolean;
  dependencies?: Record<string, LockV1>;
}

/** yarn.lock, classic (v1) and Berry. */
export function parseYarnLock(text: string): Dependency[] {
  const deps: Dependency[] = [];
  let names: string[] = [];
  for (const line of text.split("\n")) {
    if (/^\S.*:\s*$/.test(line) && !line.startsWith("#") && !line.startsWith("__metadata")) {
      names = line.replace(/:\s*$/, "").split(/,\s*/).map((spec) => {
        const s = spec.replace(/^"|"$/g, "").trim();
        const at = s.indexOf("@", 1);
        return at > 0 ? s.slice(0, at) : s;
      });
      continue;
    }
    const v = /^\s+version:?\s+"?([^"\s]+)"?\s*$/.exec(line);
    if (v && names.length) {
      if (!/^0\.0\.0-use\.local$/.test(v[1])) deps.push({ ecosystem: "npm", name: names[0], version: v[1] });
      names = [];
    }
  }
  return dedupe(deps);
}

/** pnpm-lock.yaml v5 (`/name/1.0.0:`), v6 (`/name@1.0.0:`) and v9 (`name@1.0.0:`). */
export function parsePnpmLock(text: string): Dependency[] {
  const deps: Dependency[] = [];
  let section = "";
  for (const line of text.split("\n")) {
    const top = /^(\w[\w-]*):/.exec(line);
    if (top) {
      section = top[1];
      continue;
    }
    if (section !== "packages") continue;
    const m = /^ {2}['"]?\/?(@?[^\s'"():]+?)['"]?:\s*$/.exec(line.replace(/\(.*\)/, ""));
    if (!m) continue;
    const key = m[1].replace(/_.*$/, "");
    let name: string, version: string;
    const at = key.lastIndexOf("@");
    if (at > 0) [name, version] = [key.slice(0, at), key.slice(at + 1)];
    else {
      const slash = key.lastIndexOf("/");
      if (slash <= 0) continue;
      [name, version] = [key.slice(0, slash), key.slice(slash + 1)];
    }
    if (/^\d/.test(version)) deps.push({ ecosystem: "npm", name, version });
  }
  return dedupe(deps);
}

/** The `[[package]]` tables of a TOML lockfile (Cargo.lock, poetry.lock, uv.lock), line by line. */
function tomlPackages(text: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let current: Record<string, string> | undefined;
  for (const line of text.split("\n")) {
    if (/^\[\[package\]\]\s*$/.test(line)) {
      current = {};
      out.push(current);
    } else if (/^\[/.test(line)) current = undefined;
    else if (current) {
      const m = /^([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|(\{.*\}|true|false|[\d.]+))\s*$/.exec(line);
      if (m) current[m[1]] = m[2] ?? m[3];
    }
  }
  return out;
}

/** Cargo.lock: registry packages only (workspace members have no `source`). */
export function parseCargoLock(text: string): Dependency[] {
  return dedupe(
    tomlPackages(text).filter((p) => p.name && p.version && p.source?.startsWith("registry+")).map((p) => ({
      ecosystem: "crates.io",
      name: p.name,
      version: p.version,
    })),
  );
}

/** poetry.lock and uv.lock. */
export function parsePythonTomlLock(text: string): Dependency[] {
  return dedupe(
    tomlPackages(text)
      .filter((p) => p.name && p.version && !/editable|virtual|directory/.test(p.source ?? ""))
      .map((p) => ({
        ecosystem: "PyPI",
        name: normalizeName("PyPI", p.name),
        version: p.version,
        dev: p.category === "dev" ? true : undefined,
      })),
  );
}

/** requirements.txt: only `name==version` pins can be checked. */
export function parseRequirements(text: string): Dependency[] {
  const deps: Dependency[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").replace(/\\$/, "").trim();
    if (!line || line.startsWith("#") || line.startsWith("-")) continue;
    const m = /^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[[^\]]*\])?\s*===?\s*([^\s;,]+)/.exec(line);
    if (m && !m[2].includes("*")) deps.push({ ecosystem: "PyPI", name: normalizeName("PyPI", m[1]), version: m[2] });
  }
  return dedupe(deps);
}

/** Pipfile.lock: `default` and `develop` with `==` pins. */
export function parsePipfileLock(text: string): Dependency[] {
  const json = JSON.parse(text) as Record<string, Record<string, { version?: string }>>;
  const deps: Dependency[] = [];
  for (const [group, dev] of [["default", false], ["develop", true]] as const) {
    for (const [name, p] of Object.entries(json[group] ?? {})) {
      const v = /^==(.+)$/.exec(p.version ?? "");
      if (v) deps.push({ ecosystem: "PyPI", name: normalizeName("PyPI", name), version: v[1], dev: dev || undefined });
    }
  }
  return dedupe(deps);
}

/** go.mod `require` lines (and the Go version, checked as `stdlib`). Versions without their `v`. */
export function parseGoMod(text: string): Dependency[] {
  const deps: Dependency[] = [];
  let inRequire = false;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(line)) {
      inRequire = true;
      continue;
    }
    if (inRequire && line === ")") {
      inRequire = false;
      continue;
    }
    const go = /^(?:go|toolchain)\s+(?:go)?(\d+\.\d+(?:\.\d+)?)$/.exec(line);
    if (go) {
      deps.push({ ecosystem: "Go", name: "stdlib", version: go[1] });
      continue;
    }
    const m = inRequire ? /^(\S+)\s+(v\S+)$/.exec(line) : /^require\s+(\S+)\s+(v\S+)$/.exec(line);
    if (m) deps.push({ ecosystem: "Go", name: m[1], version: m[2].replace(/^v/, "") });
  }
  // The toolchain line wins over the go line for the standard library.
  const std = deps.filter((d) => d.name === "stdlib").sort((a, b) => looseCompare(a.version, b.version)).pop();
  return dedupe([...deps.filter((d) => d.name !== "stdlib"), ...(std ? [std] : [])]);
}

/** go.sum: the highest version of each module (go.mod is better: Go picks exactly those). */
export function parseGoSum(text: string): Dependency[] {
  const best = new Map<string, string>();
  for (const line of text.split("\n")) {
    const m = /^(\S+)\s+v([^\s/]+)\s+h1:/.exec(line.trim());
    if (!m) continue;
    const prev = best.get(m[1]);
    if (!prev || looseCompare(m[2], prev) > 0) best.set(m[1], m[2]);
  }
  return [...best].map(([name, version]) => ({ ecosystem: "Go", name, version }));
}

const PLATFORM = /-(x86_64|x86|aarch64|arm64|arm|universal|java|x64|mingw|mswin|darwin|linux)[\w-]*$/;

/** Gemfile.lock: the `specs:` of the GEM section. */
export function parseGemfileLock(text: string): Dependency[] {
  const deps: Dependency[] = [];
  let inGem = false, inSpecs = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) {
      inGem = line.trim() === "GEM";
      inSpecs = false;
      continue;
    }
    if (inGem && /^ {2}specs:\s*$/.test(line)) {
      inSpecs = true;
      continue;
    }
    if (inGem && /^ {2}\S/.test(line)) inSpecs = false;
    const m = inSpecs ? /^ {4}([^\s(]+) \(([^)]+)\)\s*$/.exec(line) : null;
    if (m) deps.push({ ecosystem: "RubyGems", name: m[1], version: m[2].replace(PLATFORM, "") });
  }
  return dedupe(deps);
}

/** composer.lock: `packages` and `packages-dev`. */
export function parseComposerLock(text: string): Dependency[] {
  const json = JSON.parse(text) as Record<string, { name: string; version: string }[] | undefined>;
  const deps: Dependency[] = [];
  for (const [key, dev] of [["packages", false], ["packages-dev", true]] as const) {
    for (const p of json[key] ?? []) {
      if (p.name && p.version && !p.version.startsWith("dev-")) {
        deps.push({
          ecosystem: "Packagist",
          name: p.name,
          version: p.version.replace(/^v/, ""),
          dev: dev || undefined,
        });
      }
    }
  }
  return dedupe(deps);
}

/** What the scan reads, in order of preference within an ecosystem. */
export const LOCKFILES: Lockfile[] = [
  { file: "package-lock.json", ecosystem: "npm", parse: parsePackageLock },
  { file: "npm-shrinkwrap.json", ecosystem: "npm", parse: parsePackageLock },
  { file: "pnpm-lock.yaml", ecosystem: "npm", parse: parsePnpmLock },
  { file: "yarn.lock", ecosystem: "npm", parse: parseYarnLock },
  { file: "Cargo.lock", ecosystem: "crates.io", parse: parseCargoLock },
  { file: "poetry.lock", ecosystem: "PyPI", parse: parsePythonTomlLock },
  { file: "uv.lock", ecosystem: "PyPI", parse: parsePythonTomlLock },
  { file: "Pipfile.lock", ecosystem: "PyPI", parse: parsePipfileLock },
  { file: "requirements.txt", ecosystem: "PyPI", parse: parseRequirements },
  { file: "go.mod", ecosystem: "Go", parse: parseGoMod },
  { file: "go.sum", ecosystem: "Go", parse: parseGoSum },
  { file: "Gemfile.lock", ecosystem: "RubyGems", parse: parseGemfileLock },
  { file: "composer.lock", ecosystem: "Packagist", parse: parseComposerLock },
];

export const LOCKFILE_NAMES = new Set(LOCKFILES.map((l) => l.file));

/** One lockfile per ecosystem: package-lock.json over yarn.lock, go.mod over go.sum… */
export function pickLockfiles(files: string[]): Lockfile[] {
  const have = new Set(files);
  const chosen = new Map<string, Lockfile>();
  for (const l of LOCKFILES) if (have.has(l.file) && !chosen.has(l.ecosystem)) chosen.set(l.ecosystem, l);
  return [...chosen.values()];
}

/** A command that upgrades the package to `fixed`. */
export function upgradeCommand(d: Dependency, fixed: string, lockfile?: string): string {
  switch (d.ecosystem) {
    case "npm":
      return lockfile === "yarn.lock"
        ? `yarn upgrade ${d.name}@${fixed}`
        : lockfile === "pnpm-lock.yaml"
        ? `pnpm update ${d.name}@${fixed}`
        : `npm install ${d.name}@${fixed}`;
    case "crates.io":
      return `cargo update -p ${d.name}@${d.version} --precise ${fixed}`;
    case "PyPI":
      return lockfile === "poetry.lock"
        ? `poetry add '${d.name}>=${fixed}'`
        : lockfile === "uv.lock"
        ? `uv add '${d.name}>=${fixed}'`
        : `pip install '${d.name}>=${fixed}'`;
    case "Go":
      return d.name === "stdlib" ? `go mod edit -go=${fixed}` : `go get ${d.name}@v${fixed}`;
    case "RubyGems":
      return `bundle update ${d.name} --conservative`;
    case "Packagist":
      return `composer require '${d.name}:^${fixed}'`;
    default:
      return `${d.name}@${fixed}`;
  }
}

// ---------------------------------------------------------------------------
// Projects

export const DEFAULT_FOLDERS = "~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/git, ~/repos, ~/workspace";

export function parseFolders(pref: string | undefined, home: string): string[] {
  const raw = (pref?.trim() || DEFAULT_FOLDERS).split(/[,:\n]/).map((f) => f.trim()).filter(Boolean);
  const expanded = raw.map((f) => f.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "") || "/");
  return [...new Set(expanded)].filter((f) => f.startsWith("/"));
}

export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

/** Folders never worth descending into. */
export const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  "build",
  "dist",
  ".git",
  ".cache",
  ".next",
  ".tox",
]);

export interface Finding {
  dependency: Dependency;
  vulns: OsvVuln[];
}

/** Vulnerable packages first, the worst first; then the clean ones by name. */
export function sortFindings(findings: Finding[]): Finding[] {
  const rank = (f: Finding) => f.vulns.length ? SEVERITY_ORDER.indexOf(worst(f.vulns.map(severityOf)).severity) : 99;
  return [...findings].sort((a, b) =>
    rank(a) - rank(b) || b.vulns.length - a.vulns.length || a.dependency.name.localeCompare(b.dependency.name)
  );
}

/** Counts by severity, for the summary. */
export function severityCounts(findings: Finding[]): Record<Severity, number> {
  const counts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<Severity, number>;
  const seen = new Set<string>();
  for (const f of findings) {
    for (const v of f.vulns) {
      if (seen.has(v.id)) continue;
      seen.add(v.id);
      counts[severityOf(v).severity]++;
    }
  }
  return counts;
}
