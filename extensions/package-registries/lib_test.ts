import { assertEquals } from "@std/assert";
import {
  compact,
  escapeModule,
  looksLikeModule,
  mapCrates,
  mapGems,
  mapGo,
  mapHex,
  mapMaven,
  mapNuget,
  mapPackagist,
  mapPub,
  mapPypi,
  mavenQuery,
  normalizePython,
  packagistLatest,
  parseQuery,
  pubNames,
  pypiCandidates,
  rank,
  relativeDate,
} from "./lib.ts";

// Trimmed real responses (October 2026); Maven Central and NuGet follow their documented shapes.
const CRATES = {
  "crates": [{
    "id": "serde",
    "name": "serde",
    "updated_at": "2026-07-18T23:05:13.266456Z",
    "versions": null,
    "keywords": null,
    "categories": null,
    "badges": [],
    "created_at": "2014-12-05T20:20:39.487502Z",
    "downloads": 1602431895,
    "recent_downloads": 386912775,
    "default_version": "1.0.229",
    "num_versions": 316,
    "yanked": false,
    "max_version": "1.0.229",
    "newest_version": "1.0.229",
    "max_stable_version": "1.0.229",
    "description": "A generic serialization/deserialization framework",
    "homepage": "https://serde.rs",
    "documentation": "https://docs.rs/serde",
    "repository": "https://github.com/serde-rs/serde",
    "exact_match": true,
    "trustpub_only": false,
  }],
  "meta": { "total": 24467 },
};
const PYPI = {
  "info": {
    "name": "requests",
    "version": "2.34.2",
    "summary": "Python HTTP for Humans.",
    "license": "Apache-2.0",
    "license_expression": null,
    "home_page": null,
    "project_urls": { "Documentation": "https://requests.readthedocs.io", "Source": "https://github.com/psf/requests" },
    "requires_python": ">=3.10",
    "author": null,
    "keywords": null,
    "package_url": "https://pypi.org/project/requests/",
    "docs_url": null,
    "yanked": false,
    "yanked_reason": null,
    "classifiers": ["License :: OSI Approved :: Apache Software License"],
  },
  "urls": [{ "upload_time_iso_8601": "2026-05-14T19:25:26.443000Z" }, {
    "upload_time_iso_8601": "2026-05-14T19:25:27.735762Z",
  }],
};
const GO = {
  "Version": "v5.5.0",
  "Time": "2026-10-14T13:20:04Z",
  "Origin": {
    "VCS": "git",
    "URL": "https://github.com/go-chi/chi",
    "Hash": "3a33ba578e0dd93444e0ff386cc26e665d92e31e",
    "Ref": "refs/tags/v5.5.0",
  },
};
const GEMS = [{
  "documentation_uri": "https://api.rubyonrails.org/v8.1.4/",
  "homepage_uri": "https://rubyonrails.org",
  "funding_uri": null,
  "bug_tracker_uri": "https://github.com/rails/rails/issues",
  "project_uri": "https://rubygems.org/gems/rails",
  "version": "8.1.4",
  "platform": "ruby",
  "changelog_uri": "https://github.com/rails/rails/releases/tag/v8.1.4",
  "source_code_uri": "https://github.com/rails/rails/tree/v8.1.4",
  "licenses": ["MIT"],
  "gem_uri": "https://rubygems.org/gems/rails-8.1.4.gem",
  "downloads": 807907647,
  "mailing_list_uri": "https://discuss.rubyonrails.org/c/rubyonrails-talk",
  "name": "rails",
  "wiki_uri": null,
  "version_downloads": 3197458,
  "info":
    "Ruby on Rails is a full-stack web framework optimized for programmer happiness and sustainable productivity. It encourages beautiful code by favoring convention over configuration.",
  "authors": "David Heinemeier Hansson",
}];
const PACKAGIST = {
  "results": [{
    "name": "laravel/framework",
    "description": "The Laravel Framework.",
    "url": "https://packagist.org/packages/laravel/framework",
    "repository": "https://github.com/laravel/framework",
    "downloads": 606007207,
    "favers": 35474,
  }, {
    "name": "spatie/laravel-permission",
    "description": "Permission handling for Laravel 12 and up",
    "url": "https://packagist.org/packages/spatie/laravel-permission",
    "repository": "https://github.com/spatie/laravel-permission",
    "downloads": 128373642,
    "favers": 13145,
  }],
  "total": 99085,
  "next": "https://packagist.org/search.json?q=laravel&page=2&per_page=2",
};
const P2 = {
  "packages": {
    "laravel/framework": [{ "version": "v13.40.0-beta1" }, {
      "version": "v13.39.0",
      "license": ["MIT"],
      "time": "2026-10-27T14:04:39+00:00",
      "homepage": "https://laravel.com",
    }],
  },
};
const HEX = [{
  "meta": {
    "links": {
      "Changelog": "https://phoenix.hexdocs.pm/changelog.html",
      "GitHub": "https://github.com/phoenixframework/phoenix",
    },
    "description": "Peace of mind from prototype to production",
    "licenses": ["MIT"],
    "maintainers": [],
  },
  "name": "phoenix",
  "url": "https://hex.pm/api/packages/phoenix",
  "inserted_at": "2014-04-21T22:38:32.000000Z",
  "updated_at": "2026-10-20T10:33:08.398912Z",
  "repository": "hexpm",
  "html_url": "https://hex.pm/packages/phoenix",
  "latest_version": "1.8.16",
  "downloads": { "all": 158653497, "day": 97873, "recent": 5919337, "week": 615197 },
  "docs_html_url": "https://phoenix.hexdocs.pm/",
  "retirements": {},
  "configs": {
    "erlang.mk": "dep_phoenix = hex 1.8.16",
    "mix.exs": '{:phoenix, "~> 1.8"}',
    "rebar.config": '{phoenix, "1.8.16"}',
  },
  "latest_stable_version": "1.8.16",
}];
const PUB = {
  "name": "http",
  "latest": {
    "version": "1.6.0",
    "published": "2025-11-10T18:27:56.434747Z",
    "pubspec": {
      "name": "http",
      "description": "A composable, multi-platform, Future-based API for HTTP requests.",
      "repository": "https://github.com/dart-lang/http/tree/master/pkgs/http",
      "topics": ["http", "network", "protocols"],
    },
  },
};
const PUB_SCORE = {
  "grantedPoints": 160,
  "maxPoints": 160,
  "likeCount": 8480,
  "downloadCount30Days": 13858269,
  "tags": [
    "publisher:dart.dev",
    "has:topic",
    "sdk:dart",
    "sdk:flutter",
    "platform:android",
    "platform:ios",
    "platform:windows",
    "platform:linux",
    "platform:macos",
    "platform:web",
    "runtime:native-aot",
    "runtime:native-jit",
    "runtime:web",
    "is:null-safe",
    "is:wasm-ready",
    "is:dart3-compatible",
    "license:bsd-3-clause",
    "license:fsf-libre",
    "license:osi-approved",
    "topic:http",
    "topic:network",
    "topic:protocols",
  ],
};
const MAVEN = {
  "responseHeader": { "status": 0 },
  "response": {
    "numFound": 2,
    "start": 0,
    "docs": [{
      "id": "com.google.guava:guava",
      "g": "com.google.guava",
      "a": "guava",
      "latestVersion": "33.5.0-jre",
      "repositoryId": "central",
      "p": "bundle",
      "timestamp": 1758114632000,
      "versionCount": 122,
      "text": ["com.google.guava", "guava", "-sources.jar", ".jar", ".pom"],
      "ec": ["-sources.jar", ".jar", ".pom"],
    }, {
      "id": "com.google.guava:guava-testlib",
      "g": "com.google.guava",
      "a": "guava-testlib",
      "latestVersion": "33.5.0-jre",
      "repositoryId": "central",
      "p": "jar",
      "timestamp": 1758114631000,
      "versionCount": 98,
    }],
  },
};
const NUGET = {
  "totalHits": 2,
  "data": [{
    "@id": "https://api.nuget.org/v3/registration5-gz-semver2/newtonsoft.json/index.json",
    "@type": "Package",
    "registration": "https://api.nuget.org/v3/registration5-gz-semver2/newtonsoft.json/index.json",
    "id": "Newtonsoft.Json",
    "version": "13.0.4",
    "description": "Json.NET is a popular high-performance JSON framework for .NET\nSecond line",
    "summary": "",
    "title": "Json.NET",
    "iconUrl": "https://api.nuget.org/v3-flatcontainer/newtonsoft.json/13.0.4/icon",
    "licenseUrl": "https://www.nuget.org/packages/Newtonsoft.Json/13.0.4/license",
    "projectUrl": "https://www.newtonsoft.com/json",
    "tags": ["json"],
    "authors": ["James Newton-King"],
    "owners": ["dotnetfoundation", "jamesnk", "newtonsoft"],
    "totalDownloads": 7006651044,
    "verified": true,
    "packageTypes": [{ "name": "Dependency" }],
    "versions": [],
  }, {
    "id": "System.Text.Json",
    "version": "9.0.10",
    "description": "Provides high-performance and low-allocating types.",
    "licenseUrl": "https://licenses.nuget.org/MIT",
    "projectUrl": "https://dot.net/",
    "tags": [],
    "owners": "Microsoft",
    "totalDownloads": 4100000000,
    "verified": true,
  }],
};

Deno.test("registry prefixes", () => {
  assertEquals(parseQuery("cargo serde", "pypi"), { registry: "crates", query: "serde" });
  assertEquals(parseQuery("pip install-tools", "crates"), { registry: "pypi", query: "install-tools" });
  assertEquals(parseQuery("go github.com/go-chi/chi", "crates"), { registry: "go", query: "github.com/go-chi/chi" });
  assertEquals(parseQuery("  rails  ", "gems"), { registry: "gems", query: "rails" });
  assertEquals(parseQuery("serde json", "crates"), { registry: "crates", query: "serde json" });
  assertEquals(parseQuery("nuget", "crates"), { registry: "crates", query: "nuget" });
});

Deno.test("crates.io", () => {
  const [serde] = mapCrates(CRATES);
  assertEquals([serde.name, serde.version, serde.downloads, serde.exact], ["serde", "1.0.229", 1602431895, true]);
  assertEquals([serde.homepage, serde.repository, serde.docs], [
    "https://serde.rs",
    "https://github.com/serde-rs/serde",
    "https://docs.rs/serde",
  ]);
  assertEquals(serde.install, [["cargo add", "cargo add serde"], ["Cargo.toml", 'serde = "1.0.229"']]);
  assertEquals(serde.facts?.[0], ["Recent downloads", "387M in 90 days"]);
  assertEquals(mapCrates({}), []);
});

Deno.test("PyPI: exact lookups", () => {
  assertEquals(pypiCandidates("Requests"), ["requests", "python-requests", "requests-python", "pyrequests"]);
  assertEquals(pypiCandidates("python dateutil")[0], "python-dateutil");
  assertEquals(pypiCandidates("??"), []);
  assertEquals(normalizePython("Foo_Bar.baz"), "foo-bar-baz");
  const p = mapPypi(PYPI);
  assertEquals([p.name, p.version, p.description, p.license], [
    "requests",
    "2.34.2",
    "Python HTTP for Humans.",
    "Apache-2.0",
  ]);
  assertEquals([p.repository, p.docs, p.page], [
    "https://github.com/psf/requests",
    "https://requests.readthedocs.io",
    "https://pypi.org/project/requests/",
  ]);
  assertEquals(p.install[0], ["pip install", "pip install requests"]);
  assertEquals(p.install[3], ["requirements.txt", "requests==2.34.2"]);
  assertEquals(p.facts, [["Python", ">=3.10"]]);
  // The license falls back to the classifiers.
  const old = mapPypi({ info: { ...PYPI.info, license: null, license_expression: null }, urls: [] });
  assertEquals(old.license, "Apache Software License");
});

Deno.test("Go modules", () => {
  assertEquals(escapeModule("github.com/BurntSushi/toml"), "github.com/!burnt!sushi/toml");
  assertEquals([
    looksLikeModule("github.com/go-chi/chi/v5"),
    looksLikeModule("golang.org/x/net"),
    looksLikeModule("chi"),
  ], [
    true,
    true,
    false,
  ]);
  const m = mapGo("github.com/go-chi/chi/v5", GO);
  assertEquals([m.version, m.repository, m.page], [
    "v5.5.0",
    "https://github.com/go-chi/chi",
    "https://pkg.go.dev/github.com/go-chi/chi/v5",
  ]);
  assertEquals(m.install, [["go get", "go get github.com/go-chi/chi/v5@v5.5.0"], [
    "import",
    'import "github.com/go-chi/chi/v5"',
  ]]);
});

Deno.test("RubyGems", () => {
  const [rails] = mapGems(GEMS);
  assertEquals([rails.name, rails.version, rails.license, rails.downloads], ["rails", "8.1.4", "MIT", 807907647]);
  assertEquals(rails.install, [
    ["gem install", "gem install rails"],
    ["bundle add", "bundle add rails"],
    ["Gemfile", 'gem "rails", "~> 8.1"'],
  ]);
  assertEquals(rails.repository, "https://github.com/rails/rails/tree/v8.1.4");
});

Deno.test("Packagist with versions from the metadata files", () => {
  const latest = { "laravel/framework": packagistLatest(P2, "laravel/framework") };
  const [laravel, spatie] = mapPackagist(PACKAGIST, latest);
  assertEquals([laravel.name, laravel.version, laravel.license, laravel.downloads], [
    "laravel/framework",
    "13.39.0",
    "MIT",
    606007207,
  ]);
  assertEquals(laravel.install, [["composer require", "composer require laravel/framework"], [
    "composer.json",
    '"laravel/framework": "^13.39"',
  ]]);
  assertEquals([spatie.version, spatie.install.length], [undefined, 1]);
  assertEquals(laravel.facts, [["Stars", "35k"]]);
});

Deno.test("Maven Central", () => {
  assertEquals(mavenQuery("com.google.guava:guava"), 'g:"com.google.guava" AND a:"guava"');
  assertEquals(mavenQuery(" guava "), "guava");
  const [guava] = mapMaven(MAVEN);
  assertEquals([guava.name, guava.version, guava.page], [
    "com.google.guava:guava",
    "33.5.0-jre",
    "https://central.sonatype.com/artifact/com.google.guava/guava",
  ]);
  assertEquals(guava.install[0], ["Gradle (Kotlin)", 'implementation("com.google.guava:guava:33.5.0-jre")']);
  assertEquals(
    guava.install[2][1],
    "<dependency>\n  <groupId>com.google.guava</groupId>\n  <artifactId>guava</artifactId>\n  <version>33.5.0-jre</version>\n</dependency>",
  );
  assertEquals(guava.updated, "2025-09-17T13:10:32.000Z");
});

Deno.test("Hex", () => {
  const [phoenix] = mapHex(HEX);
  assertEquals([phoenix.version, phoenix.license, phoenix.downloads, phoenix.repository], [
    "1.8.16",
    "MIT",
    158653497,
    "https://github.com/phoenixframework/phoenix",
  ]);
  assertEquals(phoenix.install[0], ["mix.exs", '{:phoenix, "~> 1.8"}']);
});

Deno.test("pub.dev", () => {
  assertEquals(pubNames({ packages: [{ package: "http" }, { package: "dio" }] }), ["http", "dio"]);
  const http = mapPub(PUB, PUB_SCORE);
  assertEquals([http.version, http.license, http.downloadsPeriod], ["1.6.0", "BSD-3-CLAUSE", "last 30 days"]);
  assertEquals(http.install[0], ["dart pub add", "dart pub add http"]);
  assertEquals(http.install[2], ["pubspec.yaml", "http: ^1.6.0"]);
  assertEquals(http.facts?.map((f) => f[0]), ["Likes", "Pub points", "Publisher"]);
  assertEquals(mapPub(PUB).downloads, undefined);
});

Deno.test("NuGet", () => {
  const [newtonsoft, stj] = mapNuget(NUGET);
  assertEquals([newtonsoft.name, newtonsoft.description, newtonsoft.license], [
    "Newtonsoft.Json",
    "Json.NET is a popular high-performance JSON framework for .NET Second line",
    undefined,
  ]);
  assertEquals(newtonsoft.install[0], ["dotnet add package", "dotnet add package Newtonsoft.Json"]);
  assertEquals(newtonsoft.facts, [["Owners", "dotnetfoundation, jamesnk, newtonsoft"], ["Prefix", "Verified owner"]]);
  assertEquals([stj.license, stj.facts?.[0]], ["MIT", ["Owners", "Microsoft"]]);
});

Deno.test("formatting and ranking", () => {
  assertEquals([compact(950), compact(1234), compact(45_600), compact(2_300_000), compact(1_602_431_895)], [
    "950",
    "1.2k",
    "46k",
    "2.3M",
    "1.6B",
  ]);
  const now = new Date("2026-10-28T12:00:00Z");
  assertEquals(
    [
      relativeDate("2026-10-28T08:00:00Z", now),
      relativeDate("2026-10-20T08:00:00Z", now),
      relativeDate("2026-05-01T00:00:00Z", now),
      relativeDate("2023-01-01", now),
      relativeDate(undefined, now),
    ],
    ["today", "8 days ago", "6 months ago", "4 years ago", undefined],
  );
  const pkgs = mapGems([{ name: "rails-i18n" }, { name: "Rails" }]);
  assertEquals(rank(pkgs, "rails").map((p) => p.name), ["Rails", "rails-i18n"]);
});
