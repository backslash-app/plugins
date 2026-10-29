// SonarQube and SonarCloud Web API objects and how they look in lists. Tested in lib_test.ts.

import { type Action, type Color, copy, Icons, type Item, meta, type Metadata, open, type Stat } from "@backslash/api";

// --- Server -------------------------------------------------------------------------

/** `sonar.example.com/` → `https://sonar.example.com`; keeps a context path (`/sonarqube`). */
export function normalizeUrl(input: unknown): string {
  let text = String(input ?? "").trim() || "https://sonarcloud.io";
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  const url = new URL(text);
  if (url.hostname === "www.sonarcloud.io") url.hostname = "sonarcloud.io";
  const path = url.pathname.replace(/\/+$/, "").replace(/\/(projects|dashboard|account).*$/, "");
  return `${url.protocol}//${url.host}${path}`;
}

export const isCloud = (base: string) => /^https:\/\/sonarcloud\.io$/.test(base);

/** A user token goes as the Basic user name with an empty password, on every version. */
export function tokenAuth(token: string): string {
  const bytes = new TextEncoder().encode(`${token}:`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

export const dashboardUrl = (base: string, key: string) =>
  `${base}/${isCloud(base) ? "project/overview" : "dashboard"}?id=${encodeURIComponent(key)}`;

export const issuesUrl = (base: string, key: string, newCode = true) =>
  `${base}/project/issues?id=${encodeURIComponent(key)}&resolved=false${newCode ? "&inNewCodePeriod=true" : ""}`;

export const issueUrl = (base: string, project: string, issue: string) =>
  `${base}/project/issues?id=${encodeURIComponent(project)}&open=${encodeURIComponent(issue)}`;

export const hotspotsUrl = (base: string, key: string, hotspot?: string) =>
  `${base}/${isCloud(base) ? "project/" : ""}security_hotspots?id=${encodeURIComponent(key)}${
    hotspot ? `&hotspots=${encodeURIComponent(hotspot)}` : ""
  }`;

// --- Formatting ---------------------------------------------------------------------

export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  const d = new Date(t);
  if (s < 365 * 86_400) return d.toLocaleDateString("en", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

/** 1234 → "1.2k", 2_500_000 → "2.5M". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

export const percent = (v: number | undefined) => v === undefined ? "—" : `${v.toFixed(1).replace(/\.0$/, "")}%`;

/** Sonar ratings: 1.0 → A … 5.0 → E. */
export function rating(v: number | undefined): string | undefined {
  if (v === undefined || Number.isNaN(v)) return undefined;
  return "ABCDE"[Math.min(4, Math.max(0, Math.round(v) - 1))];
}

export const RATING_COLORS: Record<string, Color> = { A: "green", B: "teal", C: "yellow", D: "orange", E: "red" };

// --- Projects and measures ----------------------------------------------------------

/** `api/components/search_projects` (or `api/components/search`). */
export interface Project {
  key: string;
  name: string;
  isFavorite?: boolean;
  tags?: string[];
  visibility?: "public" | "private";
  analysisDate?: string;
}

/** `api/measures/search` and `api/measures/component`. */
export interface Measure {
  metric: string;
  value?: string;
  component?: string;
  period?: { value?: string };
  periods?: { value?: string }[];
}

export const METRICS = [
  "alert_status",
  "bugs",
  "vulnerabilities",
  "code_smells",
  "security_hotspots",
  "coverage",
  "duplicated_lines_density",
  "ncloc",
  "reliability_rating",
  "security_rating",
  "sqale_rating",
  "new_violations",
];

export type Gate = "ERROR" | "WARN" | "OK" | "NONE";

export interface Measures {
  gate: Gate;
  bugs?: number;
  vulnerabilities?: number;
  codeSmells?: number;
  hotspots?: number;
  coverage?: number;
  duplication?: number;
  lines?: number;
  reliability?: string;
  security?: string;
  maintainability?: string;
  newIssues?: number;
}

const num = (v: string | undefined) => v === undefined || v === "" ? undefined : Number(v);

/** The measures of each project, by key. */
export function parseMeasures(measures: Measure[]): Map<string, Measures> {
  const raw = new Map<string, Record<string, string | undefined>>();
  for (const m of measures) {
    const key = m.component ?? "";
    const row = raw.get(key) ?? {};
    row[m.metric] = m.value ?? m.period?.value ?? m.periods?.[0]?.value;
    raw.set(key, row);
  }
  const out = new Map<string, Measures>();
  for (const [key, r] of raw) {
    const gate = (r.alert_status ?? "NONE").toUpperCase();
    out.set(key, {
      gate: (["ERROR", "WARN", "OK"].includes(gate) ? gate : "NONE") as Gate,
      bugs: num(r.bugs),
      vulnerabilities: num(r.vulnerabilities),
      codeSmells: num(r.code_smells),
      hotspots: num(r.security_hotspots),
      coverage: num(r.coverage),
      duplication: num(r.duplicated_lines_density),
      lines: num(r.ncloc),
      reliability: rating(num(r.reliability_rating)),
      security: rating(num(r.security_rating)),
      maintainability: rating(num(r.sqale_rating)),
      newIssues: num(r.new_violations),
    });
  }
  return out;
}

export const GATES: Record<Gate, { label: string; icon: string; color: Color }> = {
  ERROR: { label: "Failed", icon: Icons.canceled, color: "red" },
  WARN: { label: "Warning", icon: Icons.alert, color: "orange" },
  OK: { label: "Passed", icon: Icons.done, color: "green" },
  NONE: { label: "Not computed", icon: Icons.backlog, color: "gray" },
};

const GATE_ORDER: Gate[] = ["ERROR", "WARN", "NONE", "OK"];

/** Failing quality gates first, then favorites, then by name. */
export function sortProjects(projects: Project[], measures: Map<string, Measures>): Project[] {
  const gate = (p: Project) => GATE_ORDER.indexOf(measures.get(p.key)?.gate ?? "NONE");
  return [...projects].sort((a, b) =>
    gate(a) - gate(b) || Number(!!b.isFavorite) - Number(!!a.isFavorite) || a.name.localeCompare(b.name)
  );
}

export function projectStats(m: Measures | undefined): Stat[] {
  if (!m) return [];
  const count = (v?: number) => v === undefined ? "—" : compact(v);
  return [
    { label: "Bugs", value: count(m.bugs), color: m.bugs ? "red" : undefined },
    { label: "Vulnerabilities", value: count(m.vulnerabilities), color: m.vulnerabilities ? "orange" : undefined },
    { label: "Code smells", value: count(m.codeSmells) },
    { label: "Coverage", value: percent(m.coverage), color: coverageColor(m.coverage) },
  ];
}

export function coverageColor(v: number | undefined): Color | undefined {
  if (v === undefined) return undefined;
  return v >= 80 ? "green" : v >= 50 ? "yellow" : "red";
}

export function projectMetadata(base: string, p: Project, m: Measures | undefined): Metadata[] {
  const g = GATES[m?.gate ?? "NONE"];
  const withRating = (label: string, r?: string, extra = "") =>
    r ? [meta.text(label, `${r}${extra}`, { icon: Icons.dot, color: RATING_COLORS[r] })] : [];
  return [
    meta.text("Quality gate", g.label, { icon: g.icon, color: g.color }),
    ...(m?.newIssues !== undefined ? [meta.text("New issues", m.newIssues, { icon: Icons.issue })] : []),
    ...withRating("Reliability", m?.reliability, m?.bugs !== undefined ? ` · ${m.bugs} bugs` : ""),
    ...withRating(
      "Security",
      m?.security,
      m?.vulnerabilities !== undefined ? ` · ${m.vulnerabilities} vulnerabilities` : "",
    ),
    ...withRating(
      "Maintainability",
      m?.maintainability,
      m?.codeSmells !== undefined ? ` · ${m.codeSmells} code smells` : "",
    ),
    ...(m?.hotspots !== undefined ? [meta.text("Security hotspots", m.hotspots, { icon: Icons.shield })] : []),
    ...(m?.coverage !== undefined ? [meta.progress("Coverage", m.coverage / 100, percent(m.coverage))] : []),
    ...(m?.duplication !== undefined
      ? [
        meta.text("Duplication", percent(m.duplication), {
          icon: Icons.copy,
          color: m.duplication > 5 ? "orange" : undefined,
        }),
      ]
      : []),
    ...(m?.lines !== undefined ? [meta.text("Lines of code", compact(m.lines), { icon: Icons.code })] : []),
    meta.separator(),
    meta.text("Key", p.key, { icon: Icons.key }),
    ...(p.visibility ? [meta.text("Visibility", p.visibility === "private" ? "Private" : "Public")] : []),
    ...(p.tags?.length ? [meta.tags("Tags", p.tags)] : []),
    ...(p.analysisDate ? [meta.text("Last analysis", ago(p.analysisDate), { icon: Icons.clock })] : []),
    meta.link("Dashboard", p.name, dashboardUrl(base, p.key)),
  ];
}

export function projectItem(base: string, p: Project, m: Measures | undefined, extra: Action[] = []): Item {
  const g = GATES[m?.gate ?? "NONE"];
  return {
    id: p.key,
    title: p.name,
    subtitle: p.key !== p.name ? p.key : undefined,
    icon: { source: g.icon, tint: g.color },
    section: m?.gate === "ERROR" || m?.gate === "WARN" ? "Failing" : p.isFavorite ? "Favorites" : "Projects",
    keywords: [p.key, ...(p.tags ?? []), g.label],
    accessories: [
      ...(m?.newIssues ? [{ icon: Icons.issue, text: compact(m.newIssues), tooltip: "New issues" }] : []),
      ...(m?.bugs
        ? [{ icon: { source: Icons.bug, tint: "red" as Color }, text: compact(m.bugs), tooltip: "Bugs" }]
        : []),
      ...(m?.vulnerabilities
        ? [{
          icon: { source: Icons.lock, tint: "orange" as Color },
          text: compact(m.vulnerabilities),
          tooltip: "Vulnerabilities",
        }]
        : []),
      ...(m?.coverage !== undefined
        ? [{ text: percent(m.coverage), color: coverageColor(m.coverage), tooltip: "Coverage" }]
        : []),
      ...(p.isFavorite ? [{ icon: { source: Icons.starFilled, tint: "yellow" as Color }, tooltip: "Favorite" }] : []),
      { tag: g.label, color: g.color },
    ],
    detail: { stats: projectStats(m), metadata: projectMetadata(base, p, m) },
    actions: [
      open(dashboardUrl(base, p.key), "Open in Browser"),
      ...extra,
      open(issuesUrl(base, p.key), "Open New Issues in Browser", { icon: Icons.issue, section: "Browser" }),
      open(hotspotsUrl(base, p.key), "Open Security Hotspots in Browser", { icon: Icons.shield, section: "Browser" }),
      copy(dashboardUrl(base, p.key), "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(p.key, "Copy Project Key", { icon: Icons.key, shortcut: "<Ctrl>period", section: "Copy" }),
    ],
  };
}

// --- Quality gate conditions --------------------------------------------------------

/** `api/qualitygates/project_status`. */
export interface GateCondition {
  status: "OK" | "WARN" | "ERROR" | "NONE";
  metricKey: string;
  comparator?: "GT" | "LT";
  errorThreshold?: string;
  actualValue?: string;
}

const METRIC_NAMES: Record<string, string> = {
  new_coverage: "Coverage on new code",
  coverage: "Coverage",
  new_duplicated_lines_density: "Duplication on new code",
  duplicated_lines_density: "Duplication",
  new_reliability_rating: "Reliability rating on new code",
  new_security_rating: "Security rating on new code",
  new_maintainability_rating: "Maintainability rating on new code",
  new_security_hotspots_reviewed: "Hotspots reviewed on new code",
  new_violations: "New issues",
  new_bugs: "New bugs",
  new_vulnerabilities: "New vulnerabilities",
  new_code_smells: "New code smells",
  reliability_rating: "Reliability rating",
  security_rating: "Security rating",
  sqale_rating: "Maintainability rating",
};

export const metricName = (key: string) =>
  METRIC_NAMES[key] ?? key.replace(/^new_/, "new ").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

/** "Coverage on new code: 62.5% (required ≥ 80%)". */
export function conditionText(c: GateCondition): string {
  const isRating = /rating$/.test(c.metricKey);
  const isPercent = /coverage|density|reviewed/.test(c.metricKey);
  const fmt = (v?: string) => {
    if (v === undefined) return "—";
    if (isRating) return rating(Number(v)) ?? v;
    return isPercent ? percent(Number(v)) : v;
  };
  const op = c.comparator === "LT" ? "≥" : "≤";
  return `${fmt(c.actualValue)}${c.errorThreshold !== undefined ? ` (required ${op} ${fmt(c.errorThreshold)})` : ""}`;
}

export function gateMarkdown(conditions: GateCondition[]): string {
  if (!conditions.length) return "_No condition on this project's quality gate._";
  const failed = conditions.filter((c) => c.status === "ERROR" || c.status === "WARN");
  const passed = conditions.filter((c) => !failed.includes(c));
  return [
    ...(failed.length
      ? [
        "### Failing conditions",
        "",
        ...failed.map((c) => `- **${metricName(c.metricKey)}**: ${conditionText(c)}`),
        "",
      ]
      : []),
    ...(passed.length
      ? ["### Passing conditions", "", ...passed.map((c) => `- ${metricName(c.metricKey)}: ${conditionText(c)}`)]
      : []),
  ].join("\n");
}

// --- Issues -------------------------------------------------------------------------

/** `api/issues/search`. */
export interface Issue {
  key: string;
  rule: string;
  severity?: "BLOCKER" | "CRITICAL" | "MAJOR" | "MINOR" | "INFO";
  component: string;
  project: string;
  line?: number;
  message: string;
  type?: "BUG" | "VULNERABILITY" | "CODE_SMELL" | "SECURITY_HOTSPOT";
  status: string;
  author?: string;
  assignee?: string;
  creationDate: string;
  effort?: string;
  tags?: string[];
  impacts?: { softwareQuality: string; severity: string }[];
}

export interface ComponentRef {
  key: string;
  path?: string;
  longName?: string;
  name?: string;
}

export const SEVERITIES: Record<string, { label: string; icon: string; color: Color; rank: number }> = {
  BLOCKER: { label: "Blocker", icon: Icons.urgent, color: "red", rank: 0 },
  HIGH: { label: "High", icon: Icons.high, color: "red", rank: 1 },
  CRITICAL: { label: "Critical", icon: Icons.high, color: "orange", rank: 1 },
  MAJOR: { label: "Major", icon: Icons.medium, color: "yellow", rank: 2 },
  MEDIUM: { label: "Medium", icon: Icons.medium, color: "yellow", rank: 2 },
  MINOR: { label: "Minor", icon: Icons.low, color: "blue", rank: 3 },
  LOW: { label: "Low", icon: Icons.low, color: "blue", rank: 3 },
  INFO: { label: "Info", icon: Icons.noPriority, color: "gray", rank: 4 },
};

export const TYPES: Record<string, { label: string; icon: string; color: Color }> = {
  BUG: { label: "Bug", icon: Icons.bug, color: "red" },
  VULNERABILITY: { label: "Vulnerability", icon: Icons.lock, color: "orange" },
  CODE_SMELL: { label: "Code smell", icon: Icons.code, color: "yellow" },
  SECURITY_HOTSPOT: { label: "Security hotspot", icon: Icons.shield, color: "orange" },
};

export const severity = (s?: string) => SEVERITIES[s ?? "INFO"] ?? SEVERITIES.INFO;

/** `acme:src/app/main.ts` → `src/app/main.ts`, from the components of the answer when given. */
export function filePath(componentKey: string, components: ComponentRef[] = []): string {
  const c = components.find((x) => x.key === componentKey);
  return c?.path ?? c?.longName ?? componentKey.replace(/^[^:]*:/, "");
}

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) =>
    severity(a.severity).rank - severity(b.severity).rank || b.creationDate.localeCompare(a.creationDate)
  );
}

export function issueItem(base: string, i: Issue, components: ComponentRef[] = []): Item {
  const s = severity(i.severity);
  const t = TYPES[i.type ?? "CODE_SMELL"] ?? TYPES.CODE_SMELL;
  const file = filePath(i.component, components);
  const where = i.line ? `${file}:${i.line}` : file;
  const url = issueUrl(base, i.project, i.key);
  return {
    id: i.key,
    title: i.message,
    subtitle: where,
    icon: { source: t.icon, tint: t.color },
    section: t.label === "Code smell" ? "Code smells" : `${t.label}s`,
    keywords: [file, i.rule, s.label, ...(i.tags ?? []), i.author ?? ""],
    accessories: [
      { icon: { source: s.icon, tint: s.color }, tooltip: `${s.label} severity` },
      ...(i.effort ? [{ icon: Icons.timer, text: i.effort, tooltip: "Effort" }] : []),
      ...(i.author ? [{ avatar: i.author.replace(/@.*$/, ""), tooltip: i.author }] : []),
      { text: ago(i.creationDate), tooltip: "Created" },
    ],
    detail: {
      markdown: `**${i.message}**\n\n\`${where}\``,
      metadata: [
        meta.text("Type", t.label, { icon: t.icon, color: t.color }),
        meta.text("Severity", s.label, { icon: s.icon, color: s.color }),
        meta.text("Status", i.status.toLowerCase().replace(/_/g, " ")),
        meta.text("Rule", i.rule, { icon: Icons.book }),
        ...(i.effort ? [meta.text("Effort", i.effort, { icon: Icons.timer })] : []),
        ...(i.author ? [meta.person("Author", i.author)] : []),
        ...(i.assignee ? [meta.person("Assignee", i.assignee)] : []),
        ...(i.tags?.length ? [meta.tags("Tags", i.tags)] : []),
        meta.separator(),
        meta.text("File", file, { icon: Icons.file }),
        ...(i.line ? [meta.text("Line", i.line)] : []),
        meta.text("Created", ago(i.creationDate), { icon: Icons.clock }),
      ],
    },
    actions: [
      open(url, "Open in Browser"),
      open(
        `${base}/coding_rules?open=${encodeURIComponent(i.rule)}&rule_key=${encodeURIComponent(i.rule)}`,
        "Open Rule",
        {
          icon: Icons.book,
        },
      ),
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(where, "Copy File and Line", { icon: Icons.file, shortcut: "<Ctrl>period", section: "Copy" }),
      copy(i.message, "Copy Message", { section: "Copy" }),
    ],
  };
}

// --- Security hotspots --------------------------------------------------------------

/** `api/hotspots/search`. */
export interface Hotspot {
  key: string;
  component: string;
  project: string;
  securityCategory: string;
  vulnerabilityProbability: "HIGH" | "MEDIUM" | "LOW";
  status: "TO_REVIEW" | "REVIEWED";
  resolution?: string;
  line?: number;
  message: string;
  author?: string;
  creationDate: string;
  ruleKey?: string;
}

const PROBABILITY: Record<Hotspot["vulnerabilityProbability"], { label: string; color: Color; rank: number }> = {
  HIGH: { label: "High", color: "red", rank: 0 },
  MEDIUM: { label: "Medium", color: "orange", rank: 1 },
  LOW: { label: "Low", color: "yellow", rank: 2 },
};

/** `sql-injection` → `SQL injection`. */
export function categoryName(c: string): string {
  const words = c.replace(/[-_]/g, " ").trim();
  return words
    .replace(/\b(sql|xss|csrf|dos|xxe|ssrf|ldap|rce)\b/gi, (w) => w.toUpperCase())
    .replace(/^./, (x) => x.toUpperCase());
}

export function sortHotspots(h: Hotspot[]): Hotspot[] {
  return [...h].sort((a, b) =>
    (PROBABILITY[a.vulnerabilityProbability]?.rank ?? 3) - (PROBABILITY[b.vulnerabilityProbability]?.rank ?? 3) ||
    b.creationDate.localeCompare(a.creationDate)
  );
}

export function hotspotItem(base: string, h: Hotspot, components: ComponentRef[] = []): Item {
  const p = PROBABILITY[h.vulnerabilityProbability] ?? PROBABILITY.LOW;
  const file = filePath(h.component, components);
  const where = h.line ? `${file}:${h.line}` : file;
  const url = hotspotsUrl(base, h.project, h.key);
  const category = categoryName(h.securityCategory);
  return {
    id: h.key,
    title: h.message,
    subtitle: where,
    icon: { source: Icons.shield, tint: p.color },
    section: `${p.label} review priority`,
    keywords: [file, category, h.ruleKey ?? "", h.author ?? ""],
    accessories: [
      { tag: category },
      ...(h.author ? [{ avatar: h.author.replace(/@.*$/, ""), tooltip: h.author }] : []),
      { text: ago(h.creationDate), tooltip: "Created" },
    ],
    detail: {
      markdown: `**${h.message}**\n\n\`${where}\``,
      metadata: [
        meta.text("Review priority", p.label, { icon: Icons.shield, color: p.color }),
        meta.text("Category", category, { icon: Icons.tag }),
        meta.text(
          "Status",
          h.status === "TO_REVIEW" ? "To review" : `Reviewed${h.resolution ? ` (${h.resolution.toLowerCase()})` : ""}`,
        ),
        ...(h.ruleKey ? [meta.text("Rule", h.ruleKey, { icon: Icons.book })] : []),
        ...(h.author ? [meta.person("Author", h.author)] : []),
        meta.separator(),
        meta.text("File", file, { icon: Icons.file }),
        meta.text("Created", ago(h.creationDate), { icon: Icons.clock }),
      ],
    },
    actions: [
      open(url, "Review in Browser"),
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(where, "Copy File and Line", { icon: Icons.file, shortcut: "<Ctrl>period", section: "Copy" }),
    ],
  };
}
