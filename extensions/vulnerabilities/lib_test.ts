import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { API, findProjects, readDependencies } from "./api.ts";
import {
  affectedFor,
  affectedRanges,
  cvss2,
  cvss3,
  ecosystemFor,
  type Finding,
  fixedVersions,
  fixFor,
  headline,
  looseCompare,
  normalizeId,
  type OsvVuln,
  parseCargoLock,
  parseComposerLock,
  parseFolders,
  parseGemfileLock,
  parseGoMod,
  parseGoSum,
  parsePackageLock,
  parsePipfileLock,
  parsePnpmLock,
  parsePythonTomlLock,
  parseRequirements,
  parseSearch,
  parseYarnLock,
  pickLockfiles,
  rangeText,
  rating,
  severityCounts,
  severityOf,
  sortFindings,
  upgradeCommand,
  vulnMarkdown,
  worst,
} from "./lib.ts";

// Shaped like `GET https://api.osv.dev/v1/vulns/GHSA-35jh-r3h4-6jhm`.
const lodash: OsvVuln = {
  id: "GHSA-35jh-r3h4-6jhm",
  summary: "Command Injection in lodash",
  details: "`lodash` versions prior to 4.17.21 are vulnerable to Command Injection via the template function.",
  aliases: ["CVE-2021-23337"],
  modified: "2024-03-11T05:22:56.538Z",
  published: "2021-05-06T16:05:51Z",
  database_specific: { cwe_ids: ["CWE-77", "CWE-94"], github_reviewed: true, severity: "HIGH" },
  references: [
    { type: "WEB", url: "https://github.com/lodash/lodash/commit/3469357cff396a26c363f8c1b5a91dde28ba4b1c" },
    { type: "ADVISORY", url: "https://nvd.nist.gov/vuln/detail/CVE-2021-23337" },
    { type: "PACKAGE", url: "https://github.com/lodash/lodash" },
  ],
  affected: [
    {
      package: { name: "lodash", ecosystem: "npm", purl: "pkg:npm/lodash" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }],
    },
    {
      package: { name: "lodash-es", ecosystem: "npm", purl: "pkg:npm/lodash-es" },
      ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "4.17.21" }] }],
    },
  ],
  severity: [{ type: "CVSS_V3", score: "CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H" }],
};

// A RustSec advisory with two fixed branches and no CVSS.
const time: OsvVuln = {
  id: "RUSTSEC-2020-0071",
  summary: "Potential segfault in the time crate",
  modified: "2023-06-13T13:10:24Z",
  aliases: ["CVE-2020-26235", "GHSA-wcg3-cvx6-7396"],
  affected: [{
    package: { name: "time", ecosystem: "crates.io" },
    ranges: [{
      type: "SEMVER",
      events: [{ introduced: "0.0.0-0" }, { fixed: "0.2.23" }, { introduced: "0.3.0" }, { fixed: "0.3.4" }],
    }],
    ecosystem_specific: { affects: { functions: ["time::UtcOffset::local_offset_at"] } },
  }],
  severity: [{ type: "CVSS_V4", score: "CVSS:4.0/AV:L/AC:H/AT:N/PR:N/UI:N/VC:N/VI:N/VA:H/SC:N/SI:N/SA:N" }],
};

Deno.test("search syntax", () => {
  assertEquals(parseSearch("lodash@4.17.20"), {
    kind: "package",
    ecosystem: "npm",
    name: "lodash",
    version: "4.17.20",
  });
  assertEquals(parseSearch("@babel/traverse@7.22.0"), {
    kind: "package",
    ecosystem: "npm",
    name: "@babel/traverse",
    version: "7.22.0",
  });
  assertEquals(parseSearch("@babel/core"), {
    kind: "package",
    ecosystem: "npm",
    name: "@babel/core",
    version: undefined,
  });
  assertEquals(parseSearch("pypi:requests 2.19"), {
    kind: "package",
    ecosystem: "PyPI",
    name: "requests",
    version: "2.19",
  });
  assertEquals(parseSearch("pip:Django_Rest==3.0"), {
    kind: "package",
    ecosystem: "PyPI",
    name: "django-rest",
    version: "3.0",
  });
  assertEquals(parseSearch("crates:time"), {
    kind: "package",
    ecosystem: "crates.io",
    name: "time",
    version: undefined,
  });
  assertEquals(parseSearch("go:github.com/gin-gonic/gin@v1.6.0"), {
    kind: "package",
    ecosystem: "Go",
    name: "github.com/gin-gonic/gin",
    version: "1.6.0",
  });
  assertEquals(parseSearch("maven:org.apache.logging.log4j:log4j-core:2.14.1"), {
    kind: "package",
    ecosystem: "Maven",
    name: "org.apache.logging.log4j:log4j-core",
    version: "2.14.1",
  });
  assertEquals(parseSearch("gem:rails 6.0.3"), {
    kind: "package",
    ecosystem: "RubyGems",
    name: "rails",
    version: "6.0.3",
  });
  assertEquals(parseSearch("lodash@latest"), { kind: "package", ecosystem: "npm", name: "lodash", version: undefined });
  assertEquals(parseSearch("cve-2021-44228"), { kind: "id", id: "CVE-2021-44228" });
  assertEquals(parseSearch("ghsa-35JH-r3h4-6jhm"), { kind: "id", id: "GHSA-35jh-r3h4-6jhm" });
  assertEquals(parseSearch("rustsec-2020-0071"), { kind: "id", id: "RUSTSEC-2020-0071" });
  assertEquals(parseSearch("GO-2022-0969"), { kind: "id", id: "GO-2022-0969" });
  assertEquals(parseSearch(" "), { kind: "empty" });
  assertEquals(normalizeId("lodash"), undefined);
  assertEquals(ecosystemFor("cargo")?.id, "crates.io");
});

Deno.test("CVSS v3 base scores", () => {
  assertEquals(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H"), 9.8);
  assertEquals(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H"), 10);
  assertEquals(cvss3("CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H"), 7.2);
  assertEquals(cvss3("CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:H"), 5.9);
  assertEquals(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L"), 5.3);
  assertEquals(cvss3("CVSS:3.1/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H"), 7.8);
  assertEquals(cvss3("CVSS:3.0/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N"), 6.1);
  assertEquals(cvss3("CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N"), 0);
  assertEquals(cvss3("CVSS:3.1/AV:N/AC:L"), undefined);
});

Deno.test("CVSS v2 base scores and ratings", () => {
  assertEquals(cvss2("AV:N/AC:L/Au:N/C:P/I:P/A:P"), 7.5);
  assertEquals(cvss2("AV:N/AC:L/Au:N/C:C/I:C/A:C"), 10);
  assertEquals(cvss2("AV:N/AC:M/Au:N/C:N/I:P/A:N"), 4.3);
  assertEquals(cvss2("(AV:L/AC:L/Au:N/C:N/I:N/A:N)"), 0);
  assertEquals(rating(9.8), "Critical");
  assertEquals(rating(7.2), "High");
  assertEquals(rating(5.3), "Medium");
  assertEquals(rating(3.1), "Low");
  assertEquals(rating(0), "None");
  assertEquals(rating(10, 2), "High");
});

Deno.test("severity of an advisory", () => {
  assertEquals(severityOf(lodash), {
    severity: "High",
    score: 7.2,
    vector: "CVSS:3.1/AV:N/AC:L/PR:H/UI:N/S:U/C:H/I:H/A:H",
    source: "CVSS 3.1",
  });
  // CVSS 4.0 alone: no computed score, unknown severity.
  assertEquals(severityOf(time).severity, "Unknown");
  assertEquals(severityOf(time).source, "CVSS 4.0");
  // A database label wins over an uncomputed v4 vector.
  const labelled = { ...time, database_specific: { severity: "MODERATE" } };
  assertEquals(severityOf(labelled).severity, "Medium");
  assertEquals(severityOf({ id: "X", modified: "" }).severity, "Unknown");
  const v2 = { id: "Y", modified: "", severity: [{ type: "CVSS_V2", score: "AV:N/AC:L/Au:N/C:P/I:P/A:P" }] };
  assertEquals(severityOf(v2).score, 7.5);
  assertEquals(worst([severityOf(time), severityOf(lodash)]).severity, "High");
});

Deno.test("affected ranges and fixes", () => {
  assertEquals(rangeText(lodash.affected![0].ranges![0]), ["<4.17.21"]);
  assertEquals(rangeText(time.affected![0].ranges![0]), ["<0.2.23", ">=0.3.0 <0.3.4"]);
  assertEquals(rangeText({ type: "ECOSYSTEM", events: [{ introduced: "2.0.0" }] }), [">=2.0.0"]);
  assertEquals(rangeText({ type: "ECOSYSTEM", events: [{ introduced: "0" }] }), ["all versions"]);
  assertEquals(rangeText({ type: "ECOSYSTEM", events: [{ introduced: "1.0" }, { last_affected: "1.4" }] }), [
    ">=1.0 <=1.4",
  ]);
  assertEquals(affectedRanges([{ versions: ["1.0", "1.1"] }]), ["1.0, 1.1"]);
  assertEquals(fixedVersions(time.affected!), ["0.2.23", "0.3.4"]);
  assertEquals(fixFor(time.affected!, "0.1.45"), "0.2.23");
  assertEquals(fixFor(time.affected!, "0.3.2"), "0.3.4");
  assertEquals(fixFor(time.affected!), "0.3.4");
  assertEquals(affectedFor(lodash, "npm", "lodash-es").map((a) => a.package?.name), ["lodash-es"]);
  assertEquals(affectedFor(lodash, "npm", "other").length, 2);
  assert(looseCompare("1.10.0", "1.9.0") > 0);
  assert(looseCompare("1.0.0-rc.1", "1.0.0") < 0);
  assert(looseCompare("v2.0", "2.0") === 0);
});

Deno.test("advisory markdown", () => {
  const md = vulnMarkdown(lodash, "npm", "lodash", "4.17.20");
  assert(md.startsWith("## Command Injection in lodash"));
  assert(md.includes("**lodash 4.17.20 is affected: upgrade to 4.17.21 or later.**"));
  assert(md.includes("| npm `lodash` | `<4.17.21` | 4.17.21 |"));
  // The advisory link comes first.
  assert(md.indexOf("nvd.nist.gov") < md.indexOf("github.com/lodash/lodash/commit"));
  assertEquals(headline({ id: "X", modified: "", details: "# Title\nmore" }), "Title");
});

Deno.test("package-lock.json v3 and v1", () => {
  const v3 = JSON.stringify({
    name: "app",
    lockfileVersion: 3,
    packages: {
      "": { name: "app", version: "1.0.0" },
      "node_modules/lodash": { version: "4.17.20" },
      "node_modules/@babel/core": { version: "7.22.0", dev: true },
      "node_modules/a/node_modules/lodash": { version: "3.10.1" },
      "node_modules/local": { resolved: "../local", link: true },
      "packages/ui": { version: "0.1.0" },
    },
  });
  assertEquals(parsePackageLock(v3), [
    { ecosystem: "npm", name: "lodash", version: "4.17.20", dev: undefined },
    { ecosystem: "npm", name: "@babel/core", version: "7.22.0", dev: true },
    { ecosystem: "npm", name: "lodash", version: "3.10.1", dev: undefined },
  ]);
  const v1 = JSON.stringify({
    lockfileVersion: 1,
    dependencies: {
      express: { version: "4.17.1", dependencies: { qs: { version: "6.7.0" } } },
      mine: { version: "file:../mine" },
    },
  });
  assertEquals(parsePackageLock(v1).map((d) => `${d.name}@${d.version}`), ["express@4.17.1", "qs@6.7.0"]);
});

Deno.test("yarn.lock classic and berry", () => {
  const classic = `# THIS IS AN AUTOGENERATED FILE.
# yarn lockfile v1


"@babel/code-frame@^7.0.0", "@babel/code-frame@^7.10.4":
  version "7.12.13"
  resolved "https://registry.yarnpkg.com/@babel/code-frame/-/code-frame-7.12.13.tgz"

lodash@^4.17.15, lodash@^4.17.20:
  version "4.17.20"
`;
  assertEquals(parseYarnLock(classic).map((d) => `${d.name}@${d.version}`), [
    "@babel/code-frame@7.12.13",
    "lodash@4.17.20",
  ]);
  const berry = `__metadata:
  version: 6

"lodash@npm:^4.17.20":
  version: 4.17.21
  resolution: "lodash@npm:4.17.21"

"app@workspace:.":
  version: 0.0.0-use.local
`;
  assertEquals(parseYarnLock(berry).map((d) => `${d.name}@${d.version}`), ["lodash@4.17.21"]);
});

Deno.test("pnpm-lock.yaml v5, v6 and v9", () => {
  const v6 = `lockfileVersion: '6.0'

dependencies:
  lodash:
    specifier: ^4.17.20
    version: 4.17.20

packages:

  /@babel/core@7.22.0:
    resolution: {integrity: sha512-x}
    dev: true

  /lodash@4.17.20:
    resolution: {integrity: sha512-y}

  /react-dom@18.2.0(react@18.2.0):
    resolution: {integrity: sha512-z}
`;
  assertEquals(parsePnpmLock(v6).map((d) => `${d.name}@${d.version}`), [
    "@babel/core@7.22.0",
    "lodash@4.17.20",
    "react-dom@18.2.0",
  ]);
  const v5 =
    "lockfileVersion: 5.4\n\npackages:\n\n  /lodash/4.17.20:\n    resolution: {integrity: x}\n  /@types/node/18.0.0:\n    dev: true\n";
  assertEquals(parsePnpmLock(v5).map((d) => `${d.name}@${d.version}`), ["lodash@4.17.20", "@types/node@18.0.0"]);
  const v9 =
    "lockfileVersion: '9.0'\n\npackages:\n\n  '@babel/core@7.22.0':\n    resolution: {integrity: x}\n\n  lodash@4.17.21:\n    resolution: {integrity: y}\n\nsnapshots:\n\n  lodash@4.17.21: {}\n";
  assertEquals(parsePnpmLock(v9).map((d) => `${d.name}@${d.version}`), ["@babel/core@7.22.0", "lodash@4.17.21"]);
});

Deno.test("Cargo.lock: registry packages only", () => {
  const lock = `# This file is automatically @generated by Cargo.
version = 3

[[package]]
name = "myapp"
version = "0.1.0"
dependencies = [
 "time",
]

[[package]]
name = "time"
version = "0.1.45"
source = "registry+https://github.com/rust-lang/crates.io-index"
checksum = "1b797afad3f312d1c66a56d11d0316f916356d11bd158fbc6ca6389ff6bf805a"
dependencies = [
 "libc",
]

[[package]]
name = "libc"
version = "0.2.150"
source = "registry+https://github.com/rust-lang/crates.io-index"

[[package]]
name = "forked"
version = "1.0.0"
source = "git+https://github.com/me/forked#abc"
`;
  assertEquals(parseCargoLock(lock), [
    { ecosystem: "crates.io", name: "time", version: "0.1.45" },
    { ecosystem: "crates.io", name: "libc", version: "0.2.150" },
  ]);
});

Deno.test("poetry.lock and uv.lock", () => {
  const poetry = `[[package]]
name = "Requests"
version = "2.19.1"
description = "Python HTTP for Humans."
optional = false
python-versions = "*"

[package.dependencies]
idna = ">=2.5,<2.8"

[[package]]
name = "pytest"
version = "7.4.0"
category = "dev"

[metadata]
lock-version = "1.1"
`;
  assertEquals(parsePythonTomlLock(poetry), [
    { ecosystem: "PyPI", name: "requests", version: "2.19.1", dev: undefined },
    { ecosystem: "PyPI", name: "pytest", version: "7.4.0", dev: true },
  ]);
  const uv = `version = 1
requires-python = ">=3.12"

[[package]]
name = "myapp"
version = "0.1.0"
source = { editable = "." }

[[package]]
name = "jinja2"
version = "3.1.2"
source = { registry = "https://pypi.org/simple" }
`;
  assertEquals(parsePythonTomlLock(uv).map((d) => `${d.name}@${d.version}`), ["jinja2@3.1.2"]);
});

Deno.test("requirements.txt and Pipfile.lock", () => {
  const req = `# pinned
requests==2.19.1 \\
    --hash=sha256:63b52e3c866428a224f97cab011de738c36aec0185aa91cfacd418b5d58911d1
Django[argon2]==3.2.0 ; python_version >= "3.8"
flask>=2.0
-r other.txt
--index-url https://pypi.org/simple
numpy===1.26.0  # exact
`;
  assertEquals(parseRequirements(req).map((d) => `${d.name}@${d.version}`), [
    "requests@2.19.1",
    "django@3.2.0",
    "numpy@1.26.0",
  ]);
  const pipfile = JSON.stringify({
    _meta: { hash: { sha256: "x" } },
    default: { requests: { version: "==2.19.1", hashes: [] }, local: { path: "." } },
    develop: { pytest: { version: "==7.4.0" } },
  });
  assertEquals(parsePipfileLock(pipfile), [
    { ecosystem: "PyPI", name: "requests", version: "2.19.1", dev: undefined },
    { ecosystem: "PyPI", name: "pytest", version: "7.4.0", dev: true },
  ]);
});

Deno.test("go.mod and go.sum", () => {
  const mod = `module example.com/app

go 1.21

toolchain go1.21.5

require github.com/gin-gonic/gin v1.6.0

require (
	golang.org/x/net v0.7.0 // indirect
	github.com/google/uuid v1.3.0
)

replace example.com/old => ../old
`;
  assertEquals(parseGoMod(mod), [
    { ecosystem: "Go", name: "github.com/gin-gonic/gin", version: "1.6.0" },
    { ecosystem: "Go", name: "golang.org/x/net", version: "0.7.0" },
    { ecosystem: "Go", name: "github.com/google/uuid", version: "1.3.0" },
    { ecosystem: "Go", name: "stdlib", version: "1.21.5" },
  ]);
  const sum = `github.com/gin-gonic/gin v1.6.0 h1:abc=
github.com/gin-gonic/gin v1.6.0/go.mod h1:def=
github.com/gin-gonic/gin v1.5.0/go.mod h1:ghi=
golang.org/x/net v0.0.0-20190404232315-eb5bcb51f2a3 h1:x=
golang.org/x/net v0.7.0 h1:y=
`;
  assertEquals(parseGoSum(sum), [
    { ecosystem: "Go", name: "github.com/gin-gonic/gin", version: "1.6.0" },
    { ecosystem: "Go", name: "golang.org/x/net", version: "0.7.0" },
  ]);
});

Deno.test("Gemfile.lock and composer.lock", () => {
  const gemfile = `GIT
  remote: https://github.com/me/gem.git
  specs:
    mygem (0.1.0)

GEM
  remote: https://rubygems.org/
  specs:
    actionpack (6.0.3)
      rack (~> 2.0, >= 2.0.8)
    nokogiri (1.13.0-x86_64-linux)
      racc (~> 1.4)
    rack (2.2.3)

PLATFORMS
  x86_64-linux

DEPENDENCIES
  rails (= 6.0.3)

BUNDLED WITH
   2.4.10
`;
  assertEquals(parseGemfileLock(gemfile).map((d) => `${d.name}@${d.version}`), [
    "actionpack@6.0.3",
    "nokogiri@1.13.0",
    "rack@2.2.3",
  ]);
  const composer = JSON.stringify({
    packages: [{ name: "guzzlehttp/guzzle", version: "7.4.0" }, { name: "me/dev", version: "dev-main" }],
    "packages-dev": [{ name: "phpunit/phpunit", version: "v9.5.0" }],
  });
  assertEquals(parseComposerLock(composer), [
    { ecosystem: "Packagist", name: "guzzlehttp/guzzle", version: "7.4.0", dev: undefined },
    { ecosystem: "Packagist", name: "phpunit/phpunit", version: "9.5.0", dev: true },
  ]);
});

Deno.test("one lockfile per ecosystem", () => {
  assertEquals(
    pickLockfiles(["yarn.lock", "package-lock.json", "go.sum", "go.mod", "Cargo.lock"]).map((l) => l.file),
    ["package-lock.json", "Cargo.lock", "go.mod"],
  );
  assertEquals(pickLockfiles(["requirements.txt", "poetry.lock"]).map((l) => l.file), ["poetry.lock"]);
});

Deno.test("upgrade commands", () => {
  const d = (ecosystem: string, name: string, version = "1.0.0") => ({ ecosystem, name, version });
  assertEquals(upgradeCommand(d("npm", "lodash"), "4.17.21"), "npm install lodash@4.17.21");
  assertEquals(upgradeCommand(d("npm", "lodash"), "4.17.21", "yarn.lock"), "yarn upgrade lodash@4.17.21");
  assertEquals(
    upgradeCommand(d("crates.io", "time", "0.1.45"), "0.2.23"),
    "cargo update -p time@0.1.45 --precise 0.2.23",
  );
  assertEquals(upgradeCommand(d("PyPI", "requests"), "2.20.0", "poetry.lock"), "poetry add 'requests>=2.20.0'");
  assertEquals(upgradeCommand(d("Go", "golang.org/x/net"), "0.17.0"), "go get golang.org/x/net@v0.17.0");
  assertEquals(upgradeCommand(d("Go", "stdlib"), "1.21.6"), "go mod edit -go=1.21.6");
});

Deno.test("findings: vulnerable and worst first", () => {
  const dep = (name: string) => ({ ecosystem: "npm", name, version: "1.0.0" });
  const findings: Finding[] = [
    { dependency: dep("clean"), vulns: [] },
    { dependency: dep("low"), vulns: [time] },
    { dependency: dep("high"), vulns: [lodash] },
  ];
  assertEquals(sortFindings(findings).map((f) => f.dependency.name), ["high", "low", "clean"]);
  const counts = severityCounts([...findings, { dependency: dep("again"), vulns: [lodash] }]);
  assertEquals(counts.High, 1);
  assertEquals(counts.Unknown, 1);
});

Deno.test("folders", () => {
  assertEquals(parseFolders("~/code, /srv/apps/, ~/code", "/home/ada"), ["/home/ada/code", "/srv/apps"]);
  assertEquals(parseFolders("", "/home/ada")[0], "/home/ada/Projects");
});

Deno.test("projects with lockfiles on disk", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/web/node_modules/dep`, { recursive: true });
    await Deno.writeTextFile(
      `${root}/web/package-lock.json`,
      JSON.stringify({ lockfileVersion: 3, packages: { "node_modules/lodash": { version: "4.17.20" } } }),
    );
    await Deno.writeTextFile(`${root}/web/node_modules/dep/package-lock.json`, "{}");
    await Deno.mkdir(`${root}/group/api`, { recursive: true });
    await Deno.writeTextFile(`${root}/group/api/requirements.txt`, "requests==2.19.1\n");
    await Deno.mkdir(`${root}/notes`);
    const projects = await findProjects(root, 2);
    assertEquals(projects.map((p) => p.path.slice(root.length)).sort(), ["/group/api", "/web"]);
    const web = projects.find((p) => p.path.endsWith("/web"))!;
    const [read] = await readDependencies(web);
    assertEquals(read.deps.map((d) => `${d.name}@${d.version}`), ["lodash@4.17.20"]);
    assertEquals((await findProjects(root, 1)).map((p) => p.path.slice(root.length)), ["/web"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("manifest: the OSV host and the commands", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, [new URL(API).host]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
