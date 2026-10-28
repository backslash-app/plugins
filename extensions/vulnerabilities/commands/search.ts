import { copy, Icons, type Item, list, open, storage } from "@backslash/api";
import { getVuln, queryPackage } from "../api.ts";
import { ECOSYSTEMS, ecosystemTitle, parseSearch, SEVERITY_ORDER, severityCounts, severityOf } from "../lib.ts";
import { vulnItem } from "../views.ts";

const RECENT = "recentSearches";

const EXAMPLES = [
  { query: "lodash@4.17.20", title: "An npm package at a version" },
  { query: "pypi:requests 2.19", title: "A Python package" },
  { query: "crates:time 0.1.45", title: "A Rust crate" },
  { query: "go:golang.org/x/net 0.7.0", title: "A Go module" },
  { query: "gem:rails 6.0.3", title: "A Ruby gem" },
  { query: "maven:org.apache.logging.log4j:log4j-core 2.14.1", title: "A Maven artifact" },
  { query: "CVE-2021-44228", title: "An advisory by CVE, GHSA, RUSTSEC, PYSEC… id" },
];

async function recent(): Promise<string[]> {
  return ((await storage.get(RECENT).catch(() => undefined)) as string[] | undefined) ?? [];
}

async function remember(query: string) {
  const list = await recent();
  await storage.set(RECENT, [query, ...list.filter((q) => q !== query)].slice(0, 8)).catch(() => {});
}

const hint = (query: string, title: string, section: string, icon: string): Item => ({
  id: `hint:${section}:${query}`,
  title: query,
  subtitle: title,
  icon: { source: icon, tint: "gray" },
  section,
  detail: {
    markdown: [
      "## Search OSV.dev",
      "",
      "Type a package, optionally with a version, or an advisory id:",
      "",
      "- `lodash@4.17.20`, `@babel/traverse 7.22.0` (npm is the default)",
      "- `pypi:requests 2.19`, `crates:time`, `go:github.com/gin-gonic/gin 1.6.0`",
      "- `gem:`, `maven:`, `composer:`, `nuget:`, `hex:`, `pub:` for the other ecosystems",
      "- `CVE-2021-44228`, `GHSA-35jh-r3h4-6jhm`, `RUSTSEC-2020-0071`, `PYSEC-2018-28`",
      "",
      "With a version, only the advisories affecting it are listed, with the version that fixes them.",
    ].join("\n"),
  },
  actions: [copy(query, "Copy Query")],
});

export default list({
  placeholder: "lodash@4.17.20 · pypi:requests 2.19 · crates:time · CVE-2021-44228",
  empty: {
    title: "Nothing found",
    description: "Check the package name, or prefix its ecosystem: pypi:, crates:, go:, gem:, maven:",
    icon: Icons.shield,
  },
  status: (items) => {
    const vulns = items.filter((i) => !/^(hint|missing|none):/.test(i.id ?? ""));
    if (!vulns.length) return "OSV.dev · npm, PyPI, crates.io, Go, RubyGems, Maven, Packagist, NuGet…";
    return `${vulns.length} advisor${vulns.length === 1 ? "y" : "ies"} · OSV.dev`;
  },
  async search(text, { signal }) {
    const q = parseSearch(text);
    if (q.kind === "empty") {
      const past = await recent();
      return [
        ...past.map((p) => hint(p, "Recent search", "Recent", Icons.history)),
        ...EXAMPLES.map((e) => hint(e.query, e.title, "Try", Icons.search)),
      ];
    }

    if (q.kind === "id") {
      const v = await getVuln(q.id, signal);
      if (!v) {
        return [{
          id: "missing:id",
          title: `OSV.dev has no advisory ${q.id}`,
          subtitle: "Some CVEs are only known under their GHSA or ecosystem id",
          icon: { source: Icons.question, tint: "orange" },
          actions: [
            open(`https://osv.dev/list?q=${encodeURIComponent(q.id)}`, "Search OSV.dev Website"),
            open(`https://github.com/advisories?query=${encodeURIComponent(q.id)}`, "Search GitHub Advisories"),
            open(`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(q.id)}`, "Open on NVD"),
          ],
        }];
      }
      await remember(text.trim());
      // Its aliases may be separate records with more detail (a CVE and its GHSA).
      return [vulnItem(v)];
    }

    const vulns = await queryPackage(q, signal);
    const label = `${ecosystemTitle(q.ecosystem)} ${q.name}${q.version ? ` ${q.version}` : ""}`;
    if (!vulns.length) {
      const other = ECOSYSTEMS.filter((e) => e.id !== q.ecosystem).slice(0, 3).map((e) => `${e.prefixes[0]}:${q.name}`);
      return [{
        id: "none:package",
        title: q.version ? `No known vulnerability in ${label}` : `No advisory for ${label}`,
        subtitle: q.version
          ? "OSV.dev lists nothing affecting this version"
          : `Wrong ecosystem? Try ${other.join(", ")}`,
        icon: { source: q.version ? Icons.check : Icons.question, tint: q.version ? "green" : "gray" },
        actions: [
          open(
            `https://osv.dev/list?q=${encodeURIComponent(q.name)}&ecosystem=${encodeURIComponent(q.ecosystem)}`,
            "Open on OSV.dev",
          ),
          copy(text.trim(), "Copy Query"),
        ],
      }];
    }
    await remember(text.trim());
    const counts = severityCounts([{ dependency: { ...q, version: q.version ?? "" }, vulns }]);
    const summary = SEVERITY_ORDER.filter((s) => counts[s]).map((s) => `${counts[s]} ${s.toLowerCase()}`).join(", ");
    return [...vulns]
      .sort((a, b) =>
        SEVERITY_ORDER.indexOf(severityOf(a).severity) - SEVERITY_ORDER.indexOf(severityOf(b).severity) ||
        (severityOf(b).score ?? 0) - (severityOf(a).score ?? 0) ||
        (b.published ?? "").localeCompare(a.published ?? "")
      )
      .map((v) =>
        vulnItem(v, {
          ecosystem: q.ecosystem,
          name: q.name,
          version: q.version,
          section: `${label} · ${summary}`,
        })
      );
  },
});
