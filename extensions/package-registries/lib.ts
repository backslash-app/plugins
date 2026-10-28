// Package registries: query parsing and mapping each API's JSON to one shape. Pure, tested in lib_test.ts.

export type RegistryId = "crates" | "pypi" | "go" | "gems" | "packagist" | "maven" | "hex" | "pub" | "nuget";

export type Tint = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

export interface Registry {
  id: RegistryId;
  title: string;
  ecosystem: string;
  tint: Tint;
  /** Words that pick this registry when typed first: `cargo serde`. */
  aliases: string[];
  example: string;
  /** The registry's own web search, for what its API can't do. */
  webSearch: (q: string) => string;
  /** Explains a limitation of the API, shown with the results. */
  note?: string;
}

export const REGISTRIES: Registry[] = [
  {
    id: "crates",
    title: "crates.io",
    ecosystem: "Rust",
    tint: "orange",
    aliases: ["cargo", "crates", "crate", "rust"],
    example: "serde",
    webSearch: (q) => `https://crates.io/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "pypi",
    title: "PyPI",
    ecosystem: "Python",
    tint: "blue",
    aliases: ["pip", "pypi", "python", "py", "uv"],
    example: "requests",
    webSearch: (q) => `https://pypi.org/search/?q=${encodeURIComponent(q)}`,
    note:
      "PyPI has no search API: names are looked up exactly (with python- and py prefixes). Search the site for more.",
  },
  {
    id: "go",
    title: "Go modules",
    ecosystem: "Go",
    tint: "teal",
    aliases: ["go", "golang"],
    example: "github.com/go-chi/chi/v5",
    webSearch: (q) => `https://pkg.go.dev/search?q=${encodeURIComponent(q)}`,
    note: "pkg.go.dev has no search API: type a module path (github.com/…) to look it up on the Go module proxy.",
  },
  {
    id: "gems",
    title: "RubyGems",
    ecosystem: "Ruby",
    tint: "red",
    aliases: ["gem", "gems", "ruby", "rubygems", "bundle"],
    example: "rails",
    webSearch: (q) => `https://rubygems.org/search?query=${encodeURIComponent(q)}`,
  },
  {
    id: "packagist",
    title: "Packagist",
    ecosystem: "PHP",
    tint: "purple",
    aliases: ["composer", "packagist", "php"],
    example: "laravel",
    webSearch: (q) => `https://packagist.org/?query=${encodeURIComponent(q)}`,
  },
  {
    id: "maven",
    title: "Maven Central",
    ecosystem: "Java, Kotlin",
    tint: "pink",
    aliases: ["maven", "mvn", "java", "kotlin", "gradle"],
    example: "guava",
    webSearch: (q) => `https://central.sonatype.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: "hex",
    title: "Hex",
    ecosystem: "Elixir, Erlang",
    tint: "purple",
    aliases: ["hex", "elixir", "erlang", "mix"],
    example: "phoenix",
    webSearch: (q) => `https://hex.pm/packages?search=${encodeURIComponent(q)}`,
  },
  {
    id: "pub",
    title: "pub.dev",
    ecosystem: "Dart, Flutter",
    tint: "teal",
    aliases: ["pub", "dart", "flutter"],
    example: "http",
    webSearch: (q) => `https://pub.dev/packages?q=${encodeURIComponent(q)}`,
  },
  {
    id: "nuget",
    title: "NuGet",
    ecosystem: ".NET",
    tint: "blue",
    aliases: ["nuget", "dotnet", "csharp", "c#"],
    example: "Newtonsoft.Json",
    webSearch: (q) => `https://www.nuget.org/packages?q=${encodeURIComponent(q)}`,
  },
];

export const registry = (id: string): Registry | undefined => REGISTRIES.find((r) => r.id === id);

/** `cargo serde` → crates.io and "serde"; anything else uses `fallback`. */
export function parseQuery(input: string, fallback: RegistryId): { registry: RegistryId; query: string } {
  const m = input.trim().match(/^(\S+)\s+([\s\S]+)$/);
  if (m) {
    const hit = REGISTRIES.find((r) => r.aliases.includes(m[1].toLowerCase()));
    if (hit) return { registry: hit.id, query: m[2].trim() };
  }
  return { registry: fallback, query: input.trim() };
}

export interface Package {
  registry: RegistryId;
  name: string;
  version?: string;
  description?: string;
  license?: string;
  downloads?: number;
  /** "all time", "last 90 days"… */
  downloadsPeriod?: string;
  /** ISO date of the latest release or update. */
  updated?: string;
  page: string;
  homepage?: string;
  repository?: string;
  docs?: string;
  keywords?: string[];
  /** [title, text]: the first is the main install command. */
  install: [string, string][];
  /** More [label, value] lines for the side panel. */
  facts?: [string, string][];
  /** The registry says it's the exact name typed. */
  exact?: boolean;
  deprecated?: string;
}

const clean = (s: unknown): string | undefined => {
  const t = typeof s === "string" ? s.replace(/\s+/g, " ").trim() : "";
  return t || undefined;
};

const url = (s: unknown): string | undefined => {
  const t = clean(s);
  return t && /^https?:\/\//.test(t) ? t.replace(/\.git$/, "").replace(/^git\+/, "") : undefined;
};

// --- crates.io -----------------------------------------------------------------

export function mapCrates(json: any): Package[] {
  return (json?.crates ?? []).map((c: any): Package => {
    const version = c.max_stable_version ?? c.default_version ?? c.max_version;
    return {
      registry: "crates",
      name: c.name,
      version,
      description: clean(c.description),
      downloads: c.downloads,
      downloadsPeriod: "all time",
      updated: c.updated_at,
      page: `https://crates.io/crates/${c.name}`,
      homepage: url(c.homepage),
      repository: url(c.repository),
      docs: url(c.documentation) ?? `https://docs.rs/${c.name}`,
      install: [
        ["cargo add", `cargo add ${c.name}`],
        ["Cargo.toml", `${c.name} = "${version}"`],
      ],
      facts: [
        ...(c.recent_downloads
          ? [["Recent downloads", `${compact(c.recent_downloads)} in 90 days`] as [string, string]]
          : []),
        ...(c.num_versions ? [["Versions", String(c.num_versions)] as [string, string]] : []),
      ],
      exact: c.exact_match === true,
      deprecated: c.yanked ? "Yanked" : undefined,
    };
  });
}

// --- PyPI ------------------------------------------------------------------------

/** PEP 503 normalization: `Foo_Bar.baz` → `foo-bar-baz`. */
export const normalizePython = (name: string) => name.trim().toLowerCase().replace(/[-_.]+/g, "-");

/** Names worth an exact lookup for what the user typed. */
export function pypiCandidates(query: string): string[] {
  const base = normalizePython(query.replace(/\s+/g, "-"));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(base)) return [];
  const names = [base, `python-${base}`, `${base}-python`, `py${base}`];
  return [...new Set(names.filter((n) => n !== "py" && !/^python-python/.test(n)))];
}

export function mapPypi(json: any): Package {
  const i = json.info;
  const urls: Record<string, string> = i.project_urls ?? {};
  const find = (re: RegExp) => Object.entries(urls).find(([k]) => re.test(k))?.[1];
  const uploaded = (json.urls ?? []).map((u: any) => u.upload_time_iso_8601).filter(Boolean).sort().pop();
  const license = clean(i.license_expression) ??
    (clean(i.license) && i.license.length < 40 ? clean(i.license) : undefined) ??
    (i.classifiers ?? []).find((c: string) => c.startsWith("License :: OSI Approved :: "))?.replace(
      "License :: OSI Approved :: ",
      "",
    );
  const python = clean(i.requires_python);
  return {
    registry: "pypi",
    name: i.name,
    version: i.version,
    description: clean(i.summary),
    license,
    updated: uploaded,
    page: i.package_url ?? `https://pypi.org/project/${i.name}/`,
    homepage: url(i.home_page) ?? url(find(/^home/i)),
    repository: url(find(/source|repo|github|code/i)),
    docs: url(i.docs_url) ?? url(find(/doc/i)),
    keywords: clean(i.keywords)?.split(/[,\s]+/).filter(Boolean).slice(0, 8),
    install: [
      ["pip install", `pip install ${i.name}`],
      ["uv add", `uv add ${i.name}`],
      ["poetry add", `poetry add ${i.name}`],
      ["requirements.txt", `${i.name}==${i.version}`],
    ],
    facts: [
      ...(python ? [["Python", python] as [string, string]] : []),
      ...(clean(i.author) ? [["Author", clean(i.author)!] as [string, string]] : []),
    ],
    exact: true,
    deprecated: i.yanked ? `Yanked${i.yanked_reason ? `: ${i.yanked_reason}` : ""}` : undefined,
  };
}

// --- Go --------------------------------------------------------------------------

/** The module proxy's case encoding: `github.com/BurntSushi/toml` → `github.com/!burnt!sushi/toml`. */
export const escapeModule = (path: string) => path.replace(/[A-Z]/g, (c) => `!${c.toLowerCase()}`);

export const looksLikeModule = (q: string) => /^[a-z0-9.-]+\.[a-z]{2,}(\/[\w.~-]+)*$/i.test(q.trim());

export function mapGo(module: string, latest: any): Package {
  const repo = url(latest?.Origin?.URL);
  return {
    registry: "go",
    name: module,
    version: latest?.Version,
    updated: latest?.Time,
    page: `https://pkg.go.dev/${module}`,
    repository: repo,
    docs: `https://pkg.go.dev/${module}`,
    install: [
      ["go get", `go get ${module}@${latest?.Version ?? "latest"}`],
      ["import", `import "${module}"`],
    ],
    facts: latest?.Origin?.Hash ? [["Commit", String(latest.Origin.Hash).slice(0, 12)]] : [],
    exact: true,
  };
}

// --- RubyGems --------------------------------------------------------------------

export function mapGems(json: any): Package[] {
  return (Array.isArray(json) ? json : []).map((g: any): Package => ({
    registry: "gems",
    name: g.name,
    version: g.version,
    description: clean(g.info),
    license: (g.licenses ?? []).join(", ") || undefined,
    downloads: g.downloads,
    downloadsPeriod: "all time",
    page: g.project_uri ?? `https://rubygems.org/gems/${g.name}`,
    homepage: url(g.homepage_uri),
    repository: url(g.source_code_uri),
    docs: url(g.documentation_uri),
    install: [
      ["gem install", `gem install ${g.name}`],
      ["bundle add", `bundle add ${g.name}`],
      ["Gemfile", `gem "${g.name}", "~> ${String(g.version ?? "").split(".").slice(0, 2).join(".")}"`],
    ],
    facts: [
      ...(clean(g.authors) ? [["Authors", clean(g.authors)!] as [string, string]] : []),
      ...(g.version_downloads
        ? [["This version", `${compact(g.version_downloads)} downloads`] as [string, string]]
        : []),
    ],
  }));
}

// --- Packagist -------------------------------------------------------------------

/** The newest stable version of a `repo.packagist.org/p2/<name>.json` file. */
export function packagistLatest(p2: any, name: string): any | undefined {
  const versions: any[] = p2?.packages?.[name] ?? [];
  return versions.find((v) => !/dev|alpha|beta|rc/i.test(v.version)) ?? versions[0];
}

export function mapPackagist(json: any, latest: Record<string, any> = {}): Package[] {
  return (json?.results ?? []).filter((r: any) => !r.virtual).map((r: any): Package => {
    const v = latest[r.name];
    const version = v?.version?.replace(/^v/, "");
    return {
      registry: "packagist",
      name: r.name,
      version,
      description: clean(r.description),
      license: v?.license?.join(", ") || undefined,
      downloads: r.downloads,
      downloadsPeriod: "all time",
      updated: v?.time,
      page: r.url ?? `https://packagist.org/packages/${r.name}`,
      homepage: url(v?.homepage),
      repository: url(r.repository),
      install: [
        ["composer require", `composer require ${r.name}`],
        ...(version
          ? [["composer.json", `"${r.name}": "^${version.split(".").slice(0, 2).join(".")}"`] as [string, string]]
          : []),
      ],
      facts: r.favers ? [["Stars", compact(r.favers)]] : [],
      deprecated: r.abandoned ? `Abandoned${typeof r.abandoned === "string" ? `: use ${r.abandoned}` : ""}` : undefined,
    };
  });
}

// --- Maven Central ---------------------------------------------------------------

/** `com.google.guava:guava` searches that exact artifact; words search everything. */
export function mavenQuery(q: string): string {
  const m = q.trim().match(/^([\w.-]+):([\w.-]+)$/);
  return m ? `g:"${m[1]}" AND a:"${m[2]}"` : q.trim();
}

export function mapMaven(json: any): Package[] {
  return (json?.response?.docs ?? []).map((d: any): Package => {
    const version = d.latestVersion ?? d.v;
    const coords = `${d.g}:${d.a}`;
    return {
      registry: "maven",
      name: coords,
      version,
      updated: d.timestamp ? new Date(d.timestamp).toISOString() : undefined,
      page: `https://central.sonatype.com/artifact/${d.g}/${d.a}`,
      install: [
        ["Gradle (Kotlin)", `implementation("${coords}:${version}")`],
        ["Gradle (Groovy)", `implementation '${coords}:${version}'`],
        [
          "Maven",
          `<dependency>\n  <groupId>${d.g}</groupId>\n  <artifactId>${d.a}</artifactId>\n  <version>${version}</version>\n</dependency>`,
        ],
      ],
      facts: [
        ["Group", d.g],
        ["Artifact", d.a],
        ...(d.p ? [["Packaging", d.p] as [string, string]] : []),
        ...(d.versionCount ? [["Versions", String(d.versionCount)] as [string, string]] : []),
      ],
    };
  });
}

// --- Hex -------------------------------------------------------------------------

export function mapHex(json: any): Package[] {
  return (Array.isArray(json) ? json : []).map((p: any): Package => {
    const version = p.latest_stable_version ?? p.latest_version;
    const links: Record<string, string> = p.meta?.links ?? {};
    const repo = Object.entries(links).find(([k]) => /github|gitlab|source|codeberg/i.test(k))?.[1];
    return {
      registry: "hex",
      name: p.name,
      version,
      description: clean(p.meta?.description),
      license: (p.meta?.licenses ?? []).join(", ") || undefined,
      downloads: p.downloads?.all,
      downloadsPeriod: "all time",
      updated: p.updated_at,
      page: p.html_url ?? `https://hex.pm/packages/${p.name}`,
      repository: url(repo),
      docs: url(p.docs_html_url),
      install: [
        ["mix.exs", p.configs?.["mix.exs"] ?? `{:${p.name}, "~> ${version}"}`],
        ...(p.configs?.["rebar.config"] ? [["rebar.config", p.configs["rebar.config"]] as [string, string]] : []),
      ],
      facts: p.downloads?.recent ? [["Recent downloads", `${compact(p.downloads.recent)} in 90 days`]] : [],
      deprecated: p.retirements && Object.keys(p.retirements).includes(version) ? "This version is retired" : undefined,
    };
  });
}

// --- pub.dev ---------------------------------------------------------------------

export const pubNames = (json: any): string[] => (json?.packages ?? []).map((p: any) => p.package);

export function mapPub(pkg: any, score?: any): Package {
  const spec = pkg.latest?.pubspec ?? {};
  const license = (score?.tags ?? []).find((t: string) => t.startsWith("license:") && !/fsf|osi/.test(t))
    ?.slice(8).toUpperCase();
  const flutter = (score?.tags ?? []).includes("sdk:flutter") && !(score?.tags ?? []).includes("sdk:dart");
  return {
    registry: "pub",
    name: pkg.name,
    version: pkg.latest?.version,
    description: clean(spec.description),
    license,
    downloads: score?.downloadCount30Days,
    downloadsPeriod: "last 30 days",
    updated: pkg.latest?.published,
    page: `https://pub.dev/packages/${pkg.name}`,
    homepage: url(spec.homepage),
    repository: url(spec.repository),
    docs: `https://pub.dev/documentation/${pkg.name}/latest/`,
    keywords: spec.topics,
    install: [
      [flutter ? "flutter pub add" : "dart pub add", `${flutter ? "flutter" : "dart"} pub add ${pkg.name}`],
      ...(flutter ? [] : [["flutter pub add", `flutter pub add ${pkg.name}`] as [string, string]]),
      ["pubspec.yaml", `${pkg.name}: ^${pkg.latest?.version}`],
    ],
    facts: [
      ...(score?.likeCount !== undefined ? [["Likes", compact(score.likeCount)] as [string, string]] : []),
      ...(score?.grantedPoints !== undefined
        ? [["Pub points", `${score.grantedPoints} / ${score.maxPoints}`] as [string, string]]
        : []),
      ...((score?.tags ?? []).find((t: string) => t.startsWith("publisher:"))
        ? [["Publisher", score.tags.find((t: string) => t.startsWith("publisher:")).slice(10)] as [string, string]]
        : []),
    ],
    deprecated: pkg.isDiscontinued ? `Discontinued${pkg.replacedBy ? `: use ${pkg.replacedBy}` : ""}` : undefined,
  };
}

// --- NuGet -----------------------------------------------------------------------

export function mapNuget(json: any): Package[] {
  return (json?.data ?? []).map((p: any): Package => ({
    registry: "nuget",
    name: p.id,
    version: p.version,
    description: clean(p.description)?.split("\n")[0],
    license: /licenses\.nuget\.org\/(.+)$/.exec(p.licenseUrl ?? "")?.[1],
    downloads: p.totalDownloads,
    downloadsPeriod: "all time",
    page: `https://www.nuget.org/packages/${p.id}`,
    homepage: url(p.projectUrl),
    keywords: (p.tags ?? []).slice(0, 8),
    install: [
      ["dotnet add package", `dotnet add package ${p.id}`],
      ["PackageReference", `<PackageReference Include="${p.id}" Version="${p.version}" />`],
      ["Package Manager", `Install-Package ${p.id}`],
    ],
    facts: [
      ...((p.owners ?? []).length ? [["Owners", [].concat(p.owners).join(", ")] as [string, string]] : []),
      ...(p.verified ? [["Prefix", "Verified owner"] as [string, string]] : []),
    ],
    deprecated: p.deprecation ? `Deprecated${p.deprecation.message ? `: ${p.deprecation.message}` : ""}` : undefined,
  }));
}

// --- Formatting ------------------------------------------------------------------

/** 1234 → "1.2k", 1_602_431_895 → "1.6B". */
export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(n >= 1e7 ? 0 : 1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e4 ? 0 : 1)}k`;
  return String(n);
}

export function relativeDate(iso: string | undefined, now = new Date()): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return undefined;
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} month${Math.round(days / 30) > 1 ? "s" : ""} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years > 1 ? "s" : ""} ago`;
}

/** Exact names first, then the registry's own order. */
export function rank(packages: Package[], query: string): Package[] {
  const q = query.trim().toLowerCase();
  return packages.map((p, i) => ({ p, i, exact: p.exact || p.name.toLowerCase() === q }))
    .sort((a, b) => Number(b.exact) - Number(a.exact) || a.i - b.i).map((x) => x.p);
}
