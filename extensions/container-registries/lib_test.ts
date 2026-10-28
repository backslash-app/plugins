import { assert, assertEquals } from "@std/assert";
import {
  compact,
  filterTags,
  firstLine,
  formatBytes,
  fullName,
  imageSize,
  isIndex,
  mapConfig,
  mapHubRepo,
  mapHubSearch,
  mapHubTags,
  mapQuayRepo,
  mapQuaySearch,
  mapQuayTags,
  nextLink,
  parseChallenge,
  parseImageRef,
  platformLabel,
  platformsOf,
  pullCommands,
  relativeDate,
  shortDigest,
  shortName,
  sortTagNames,
  trimReadme,
  webUrl,
} from "./lib.ts";

// Real responses (October 2026), trimmed: Docker Hub search, tags and repository; a GHCR index and manifest.
const read = async (name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`./testdata/${name}`, import.meta.url)));
const HUB_SEARCH = await read("hub_search.json");
const HUB_TAGS = await read("hub_tags.json");
const HUB_REPO = await read("hub_repo.json");
const GHCR_INDEX = await read("ghcr_index.json");
const GHCR_MANIFEST = await read("ghcr_manifest.json");

// quay.io is not reachable from here: these follow its API documentation.
const QUAY_SEARCH = {
  results: [
    {
      kind: "repository",
      title: "repo",
      namespace: {
        title: "org",
        kind: "org",
        avatar: {},
        name: "prometheus",
        score: 1,
        href: "/organization/prometheus",
      },
      name: "node-exporter",
      description: "# Node exporter\n\nExporter for machine metrics",
      is_public: true,
      score: 4.2,
      href: "/repository/prometheus/node-exporter",
      last_modified: 1792000000,
      stars: 38,
      popularity: 12,
    },
    { kind: "user", name: "someone", namespace: { name: "someone" } },
  ],
  has_additional: false,
  page: 1,
};
const QUAY_TAGS = {
  tags: [
    {
      name: "v1.9.1",
      reversion: false,
      start_ts: 1781006400,
      manifest_digest: "sha256:d00a542e409ee618a4edc67da14dd48c5da66726bbd5537ab2af9c1dfc442c8a",
      is_manifest_list: true,
      size: null,
      last_modified: "Tue, 09 Jun 2026 12:00:00 -0000",
    },
    {
      name: "master",
      reversion: false,
      start_ts: 1792000000,
      manifest_digest: "sha256:aa11",
      is_manifest_list: false,
      size: 11534336,
      last_modified: "Wed, 14 Oct 2026 08:26:40 -0000",
    },
  ],
  page: 1,
  has_additional: true,
};

Deno.test("parseImageRef reads references and pages", () => {
  assertEquals(parseImageRef("nginx"), undefined); // a word to search for
  assertEquals(parseImageRef("grafana/grafana"), undefined);
  assertEquals(parseImageRef("node exporter"), undefined);
  assertEquals(parseImageRef("nginx:"), { registry: "docker", repository: "library/nginx", tag: "" });
  assertEquals(parseImageRef("nginx:1.27"), { registry: "docker", repository: "library/nginx", tag: "1.27" });
  assertEquals(parseImageRef("docker.io/grafana/grafana"), { registry: "docker", repository: "grafana/grafana" });
  assertEquals(parseImageRef("docker.io/nginx"), { registry: "docker", repository: "library/nginx" });
  assertEquals(parseImageRef("ghcr.io/home-assistant/home-assistant:stable"), {
    registry: "ghcr",
    repository: "home-assistant/home-assistant",
    tag: "stable",
  });
  assertEquals(parseImageRef("GHCR.io/Owner/Image"), { registry: "ghcr", repository: "owner/image" });
  assertEquals(parseImageRef("quay.io/prometheus/node-exporter@sha256:abc"), {
    registry: "quay",
    repository: "prometheus/node-exporter",
    digest: "sha256:abc",
  });
  assertEquals(parseImageRef("ghcr.io/onlyone"), undefined);
  assertEquals(parseImageRef("registry.example.com/x/y"), undefined);
  assertEquals(parseImageRef("https://hub.docker.com/_/postgres"), {
    registry: "docker",
    repository: "library/postgres",
  });
  assertEquals(parseImageRef("https://hub.docker.com/r/grafana/loki/tags"), {
    registry: "docker",
    repository: "grafana/loki",
  });
  assertEquals(parseImageRef("https://quay.io/repository/coreos/etcd?tab=tags"), {
    registry: "quay",
    repository: "coreos/etcd",
  });
  assertEquals(parseImageRef("https://github.com/orgs/home-assistant/packages/container/package/home-assistant"), {
    registry: "ghcr",
    repository: "home-assistant/home-assistant",
  });
});

Deno.test("names, pull commands and web pages", () => {
  assertEquals(shortName("docker", "library/nginx"), "nginx");
  assertEquals(shortName("docker", "grafana/grafana"), "grafana/grafana");
  assertEquals(shortName("ghcr", "a/b"), "ghcr.io/a/b");
  assertEquals(fullName("docker", "library/nginx"), "docker.io/library/nginx");
  assertEquals(pullCommands("docker", "library/nginx", "1.27", "sha256:abc"), [
    { title: "docker pull", command: "docker pull nginx:1.27" },
    { title: "docker pull by digest", command: "docker pull nginx@sha256:abc" },
    { title: "podman pull", command: "podman pull docker.io/library/nginx:1.27" },
    { title: "podman pull by digest", command: "podman pull docker.io/library/nginx@sha256:abc" },
  ]);
  assertEquals(pullCommands("quay", "a/b", "latest").map((c) => c.command), [
    "docker pull quay.io/a/b:latest",
    "podman pull quay.io/a/b:latest",
  ]);
  assertEquals(webUrl("docker", "library/nginx"), "https://hub.docker.com/_/nginx");
  assertEquals(webUrl("docker", "grafana/grafana", "11.0"), "https://hub.docker.com/r/grafana/grafana/tags?name=11.0");
  assertEquals(webUrl("ghcr", "a/b", "x"), "https://ghcr.io/a/b");
  assertEquals(webUrl("quay", "a/b", "v1"), "https://quay.io/repository/a/b?tab=tags&tag=v1");
});

Deno.test("mapHubSearch puts official images first", () => {
  const found = mapHubSearch(HUB_SEARCH);
  assertEquals(found.length, 4);
  assertEquals(found[0], {
    registry: "docker",
    repository: "library/nginx",
    description: "Official build of Nginx.",
    official: true,
    stars: 21413,
    pulls: 13521637612,
  });
  assertEquals(found[1].repository, "nginx/nginx-ingress");
  const reordered = mapHubSearch({
    results: [{ repo_name: "mcp/grafana", is_official: false }, { repo_name: "grafana", is_official: true }],
  });
  assertEquals(reordered.map((r) => r.repository), ["library/grafana", "mcp/grafana"]);
  assertEquals(mapHubSearch({}), []);
});

Deno.test("mapQuaySearch keeps repositories", () => {
  assertEquals(mapQuaySearch(QUAY_SEARCH), [{
    registry: "quay",
    repository: "prometheus/node-exporter",
    description: "Node exporter",
    stars: 38,
    updated: "2026-10-14T17:46:40.000Z",
  }]);
});

Deno.test("mapHubTags reads platforms without attestations", () => {
  const tags = mapHubTags(HUB_TAGS);
  assertEquals(tags.length, 2);
  const t = tags[0];
  assertEquals(t.name, "trixie-perl");
  assertEquals(t.digest, "sha256:bbe0395f57ca4975ec253875174df25b342e51a2d5a64f23f8aedefad76bfe5a");
  assertEquals(t.size, 76070953);
  assertEquals(t.multiArch, true);
  assertEquals(t.pushed, "2026-10-28T07:53:12.670797Z");
  assertEquals(t.platforms.map(platformLabel), ["linux/amd64", "linux/ppc64le", "linux/386"]);
  assertEquals(t.platforms[0].size, 76070953);
});

Deno.test("mapQuayTags reads sizes and dates", () => {
  const tags = mapQuayTags(QUAY_TAGS);
  assertEquals(tags[0], {
    name: "v1.9.1",
    digest: "sha256:d00a542e409ee618a4edc67da14dd48c5da66726bbd5537ab2af9c1dfc442c8a",
    platforms: [],
    pushed: "2026-06-09T12:00:00.000Z",
    multiArch: true,
    partial: true,
  });
  assertEquals(tags[1].size, 11534336);
  assertEquals(tags[1].multiArch, false);
});

Deno.test("OCI indexes, manifests and configs", () => {
  assert(isIndex(GHCR_INDEX));
  assert(!isIndex(GHCR_MANIFEST));
  const platforms = platformsOf(GHCR_INDEX);
  assertEquals(platforms.map(platformLabel), ["linux/amd64", "linux/arm64"]);
  assertEquals(platforms[0].digest, "sha256:21935614df6d9f24f680a1ef749f0570d2d6b7936c606c0a44253ae875865c04");
  assertEquals(imageSize(GHCR_MANIFEST), 659369166);
  assertEquals(imageSize(GHCR_INDEX), undefined);
  assertEquals(
    mapConfig({
      created: "2026-10-27T18:00:00Z",
      os: "linux",
      architecture: "amd64",
      config: { Labels: { "org.opencontainers.image.source": "https://github.com/home-assistant/core" } },
    }),
    {
      created: "2026-10-27T18:00:00Z",
      labels: { "org.opencontainers.image.source": "https://github.com/home-assistant/core" },
      os: "linux",
      architecture: "amd64",
    },
  );
  assertEquals(mapConfig({}), { labels: {} });
});

Deno.test("registry auth challenges and pagination links", () => {
  assertEquals(
    parseChallenge('Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:a/b:pull"'),
    { realm: "https://ghcr.io/token", service: "ghcr.io", scope: "repository:a/b:pull" },
  );
  assertEquals(parseChallenge('Basic realm="x"'), undefined);
  assertEquals(parseChallenge(null), undefined);
  assertEquals(
    nextLink('</v2/a/b/tags/list?last=2021.5.0b0&n=3>; rel="next"', "https://ghcr.io/v2/a/b/tags/list?n=3"),
    "https://ghcr.io/v2/a/b/tags/list?last=2021.5.0b0&n=3",
  );
  assertEquals(nextLink(null, "https://ghcr.io/"), undefined);
});

Deno.test("sortTagNames shows latest and new versions first", () => {
  assertEquals(
    sortTagNames([
      "2021.5.0b0",
      "1.9",
      "1.10",
      "1.10.1",
      "v2.0",
      "latest",
      "dev",
      "1.10-alpine",
      "sha256-abc.sig",
      "2021.5.0",
      "beta",
    ]),
    [
      "latest",
      "dev",
      "2021.5.0",
      "v2.0",
      "1.10.1",
      "1.10",
      "1.9",
      "2021.5.0b0",
      "1.10-alpine",
      "beta",
      "sha256-abc.sig",
    ],
  );
  assertEquals(filterTags([{ name: "1.27" }, { name: "alpine" }, { name: "1.27-alpine" }], "alp").map((t) => t.name), [
    "alpine",
    "1.27-alpine",
  ]);
  assertEquals(filterTags([{ name: "a" }], "").length, 1);
});

Deno.test("repository details and README trimming", () => {
  const repo = mapHubRepo(HUB_REPO);
  assertEquals(repo.description, "Official build of Nginx.");
  assertEquals(repo.categories, ["Web servers"]);
  assertEquals(repo.created, "2014-06-05T19:14:45Z");
  assert(repo.readme?.startsWith("# Quick reference"));
  assertEquals(mapQuayRepo({ description: "## Etcd\n\nA store" }).description, "Etcd");
  assertEquals(
    trimReadme(
      "<!-- x -->\n[![CI](https://b/x.svg)](https://ci) ![v](https://b/v.svg)\n# Title\n\n\n\nText\n```sh\nrun\n",
      4,
    ),
    "# Title\n\nText\n```sh\n```\n\n…",
  );
  assertEquals(trimReadme("# A\n\nshort\n\n", 10), "# A\n\nshort");
  assertEquals(firstLine("\n## **Hello** `world`\nmore"), "Hello world");
});

Deno.test("formatting", () => {
  assertEquals(formatBytes(76070953), "76.1 MB");
  assertEquals(formatBytes(659369166), "659 MB");
  assertEquals(formatBytes(512), "512 B");
  assertEquals(formatBytes(undefined), "");
  assertEquals(compact(13521637612), "13.5B");
  assertEquals(compact(21413), "21.4K");
  assertEquals(compact(999), "999");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(relativeDate("2026-10-28T07:53:12Z", now), "4 h ago");
  assertEquals(relativeDate("2026-09-01T00:00:00Z", now), "1 month ago");
  assertEquals(relativeDate("2026-10-01T00:00:00Z", now), "27 days ago");
  assertEquals(relativeDate("2024-01-01T00:00:00Z", now), "2 years ago");
  assertEquals(relativeDate(undefined, now), "");
  assertEquals(shortDigest("sha256:bbe0395f57ca4975ec253875"), "bbe0395f57ca");
});
