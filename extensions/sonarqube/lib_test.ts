import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  categoryName,
  compact,
  conditionText,
  dashboardUrl,
  filePath,
  gateMarkdown,
  type Hotspot,
  hotspotItem,
  hotspotsUrl,
  isCloud,
  type Issue,
  issueItem,
  issuesUrl,
  metricName,
  normalizeUrl,
  parseMeasures,
  percent,
  projectItem,
  rating,
  sortHotspots,
  sortIssues,
  sortProjects,
  tokenAuth,
} from "./lib.ts";

const CLOUD = "https://sonarcloud.io";
const SELF = "https://sonar.example.com/sonarqube";

Deno.test("server addresses and URLs", () => {
  assertEquals(normalizeUrl(""), CLOUD);
  assertEquals(normalizeUrl("https://www.sonarcloud.io/projects"), CLOUD);
  assertEquals(normalizeUrl("sonar.example.com/sonarqube/"), SELF);
  assertEquals(normalizeUrl("http://localhost:9000/dashboard?id=x"), "http://localhost:9000");
  assertThrows(() => normalizeUrl("https://"));
  assertEquals([isCloud(CLOUD), isCloud(SELF)], [true, false]);
  assertEquals(tokenAuth("squ_abc"), `Basic ${btoa("squ_abc:")}`);
  assertEquals(dashboardUrl(CLOUD, "acme_web"), "https://sonarcloud.io/project/overview?id=acme_web");
  assertEquals(dashboardUrl(SELF, "a:b"), `${SELF}/dashboard?id=a%3Ab`);
  assertEquals(issuesUrl(SELF, "web"), `${SELF}/project/issues?id=web&resolved=false&inNewCodePeriod=true`);
  assertEquals(hotspotsUrl(CLOUD, "web", "AX1"), "https://sonarcloud.io/project/security_hotspots?id=web&hotspots=AX1");
  assertEquals(hotspotsUrl(SELF, "web"), `${SELF}/security_hotspots?id=web`);
});

Deno.test("formatting", () => {
  assertEquals([compact(999), compact(1234), compact(25_000), compact(2_500_000)], ["999", "1.2k", "25k", "2.5M"]);
  assertEquals([percent(80), percent(62.54), percent(undefined)], ["80%", "62.5%", "—"]);
  assertEquals([rating(1), rating(2.0), rating(5), rating(undefined)], ["A", "B", "E", undefined]);
  assertEquals(categoryName("sql-injection"), "SQL injection");
  assertEquals(categoryName("weak-cryptography"), "Weak cryptography");
  assertEquals(metricName("new_coverage"), "Coverage on new code");
  assertEquals(metricName("new_blocker_violations"), "New blocker violations");
  assertEquals(filePath("acme:src/main.ts"), "src/main.ts");
  assertEquals(filePath("k", [{ key: "k", path: "lib/x.go" }]), "lib/x.go");
});

// Shaped like api/measures/search.
const MEASURES = [
  { metric: "alert_status", value: "ERROR", component: "web" },
  { metric: "bugs", value: "3", component: "web" },
  { metric: "vulnerabilities", value: "0", component: "web" },
  { metric: "code_smells", value: "120", component: "web" },
  { metric: "coverage", value: "62.5", component: "web" },
  { metric: "duplicated_lines_density", value: "7.1", component: "web" },
  { metric: "reliability_rating", value: "3.0", component: "web" },
  { metric: "new_violations", component: "web", period: { value: "4" } },
  { metric: "alert_status", value: "OK", component: "api" },
  { metric: "coverage", value: "91.0", component: "api" },
];

Deno.test("measures and projects", () => {
  const m = parseMeasures(MEASURES);
  const web = m.get("web")!;
  assertEquals([web.gate, web.bugs, web.vulnerabilities, web.coverage, web.reliability, web.newIssues], [
    "ERROR",
    3,
    0,
    62.5,
    "C",
    4,
  ]);
  assertEquals(m.get("api")?.gate, "OK");
  const projects = [
    { key: "api", name: "API" },
    { key: "docs", name: "Docs", isFavorite: true },
    { key: "web", name: "Web" },
    { key: "zeta", name: "Zeta", isFavorite: true },
  ];
  assertEquals(sortProjects(projects, m).map((p) => p.key), ["web", "docs", "zeta", "api"]);
  const item = projectItem(CLOUD, projects[2], web);
  assertEquals([item.section, item.accessories?.at(-1)?.tag], ["Failing", "Failed"]);
  assertEquals(item.accessories?.map((a) => a.tooltip), ["New issues", "Bugs", "Coverage", undefined]);
  assertEquals(item.detail?.stats?.map((s) => s.value), ["3", "0", "120", "62.5%"]);
  assertEquals(projectItem(CLOUD, projects[1], undefined).accessories?.at(-1)?.tag, "Not computed");
});

Deno.test("quality gate conditions", () => {
  const coverage = {
    status: "ERROR" as const,
    metricKey: "new_coverage",
    comparator: "LT" as const,
    errorThreshold: "80",
    actualValue: "62.5",
  };
  const rel = {
    status: "OK" as const,
    metricKey: "new_reliability_rating",
    comparator: "GT" as const,
    errorThreshold: "1",
    actualValue: "1",
  };
  assertEquals(conditionText(coverage), "62.5% (required ≥ 80%)");
  assertEquals(conditionText(rel), "A (required ≤ A)");
  const md = gateMarkdown([coverage, rel]);
  assertStringIncludes(md, "### Failing conditions\n\n- **Coverage on new code**: 62.5% (required ≥ 80%)");
  assertStringIncludes(md, "- Reliability rating on new code: A");
  assertEquals(gateMarkdown([]), "_No condition on this project's quality gate._");
});

const issue = (key: string, severity: Issue["severity"], o: Partial<Issue> = {}): Issue => ({
  key,
  rule: "typescript:S1854",
  severity,
  component: "web:src/app.ts",
  project: "web",
  line: 42,
  message: "Remove this useless assignment",
  type: "CODE_SMELL",
  status: "OPEN",
  author: "ada@example.com",
  creationDate: "2026-10-28T10:00:00+0000",
  effort: "5min",
  ...o,
});

Deno.test("issues", () => {
  assertEquals(sortIssues([issue("a", "MINOR"), issue("b", "BLOCKER"), issue("c", "MAJOR")]).map((i) => i.key), [
    "b",
    "c",
    "a",
  ]);
  const item = issueItem(SELF, issue("AX1", "CRITICAL", { type: "BUG" }), [{
    key: "web:src/app.ts",
    path: "src/app.ts",
  }]);
  assertEquals([item.subtitle, item.section], ["src/app.ts:42", "Bugs"]);
  assertEquals(item.accessories?.map((a) => a.tooltip), ["Critical severity", "Effort", "ada@example.com", "Created"]);
  assertEquals((item.actions?.[0] as { target: string }).target, `${SELF}/project/issues?id=web&open=AX1`);
  assertEquals(issueItem(SELF, issue("x", "INFO")).section, "Code smells");
});

Deno.test("security hotspots", () => {
  const h = (key: string, p: Hotspot["vulnerabilityProbability"]): Hotspot => ({
    key,
    component: "web:src/db.ts",
    project: "web",
    securityCategory: "sql-injection",
    vulnerabilityProbability: p,
    status: "TO_REVIEW",
    line: 7,
    message: "Make sure using a dynamically formatted SQL query is safe here",
    creationDate: "2026-10-01T00:00:00+0000",
  });
  assertEquals(sortHotspots([h("l", "LOW"), h("h", "HIGH"), h("m", "MEDIUM")]).map((x) => x.key), ["h", "m", "l"]);
  const item = hotspotItem(CLOUD, h("h", "HIGH"));
  assertEquals([item.section, item.subtitle, item.accessories?.[0].tag], [
    "High review priority",
    "src/db.ts:7",
    "SQL injection",
  ]);
});
