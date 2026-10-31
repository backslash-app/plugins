import { assert, assertEquals } from "@std/assert";
import {
  addRecent,
  bundlephobiaError,
  bytes,
  candidates,
  compareVersions,
  downloadTime,
  duration,
  lighter,
  NETWORKS,
  parseHistory,
  parseInstall,
  parseSearch,
  parseSimilar,
  parseSize,
  parseSpec,
  repoUrl,
  saving,
  sizeColor,
  summaryLine,
} from "./lib.ts";

// bundlephobia.com/api/size?package=react-dom@18.2.0 (abridged).
const SIZE = {
  assets: [{ gzip: 41981, name: "main", size: 130469, type: "js" }],
  dependencyCount: 3,
  dependencySizes: [
    { approximateSize: 2643, name: "loose-envify" },
    { approximateSize: 125541, name: "react-dom" },
    { approximateSize: 4710, name: "scheduler" },
    { approximateSize: 166, name: "js-tokens" },
  ],
  description: "React package for working with the DOM.",
  hasJSModule: false,
  hasJSNext: false,
  hasSideEffects: true,
  isModuleType: false,
  name: "react-dom",
  repository: "git+https://github.com/facebook/react.git",
  scoped: false,
  version: "18.2.0",
  size: 130469,
  gzip: 41981,
};

Deno.test("package specs as typed", () => {
  assertEquals(parseSpec("react"), { name: "react" });
  assertEquals(parseSpec("  React@18.2.0 "), { name: "react", version: "18.2.0" });
  assertEquals(parseSpec("@tanstack/react-query@^5"), { name: "@tanstack/react-query", version: "^5" });
  assertEquals(parseSpec("@babel/core"), { name: "@babel/core" });
  assertEquals(parseSpec("npm i -D vite"), { name: "vite" });
  assertEquals(parseSpec("pnpm add lodash@latest"), { name: "lodash", version: "latest" });
  assertEquals(parseSpec("https://bundlephobia.com/package/dayjs@1.11.10"), { name: "dayjs", version: "1.11.10" });
  assertEquals(parseSpec("https://www.npmjs.com/package/react/v/18.2.0"), { name: "react", version: "18.2.0" });
  assertEquals(parseSpec("https://www.npmjs.com/package/@scope/pkg"), { name: "@scope/pkg" });
  assertEquals(parseSpec("react@"), { name: "react" });
  assertEquals(parseSpec(""), undefined);
  assertEquals(parseSpec("not/a/package"), undefined);
  assertEquals(parseSpec("é"), undefined);
});

Deno.test("bundlephobia size", () => {
  const b = parseSize(SIZE, 1000)!;
  assertEquals(b.name, "react-dom");
  assertEquals(b.size, 130469);
  assertEquals(b.gzip, 41981);
  assertEquals(b.dependencyCount, 3);
  assertEquals(b.treeShakeable, false);
  assertEquals(b.sideEffects, true);
  assertEquals(b.repository, "https://github.com/facebook/react");
  assertEquals(b.dependencies.map((d) => d.name), ["react-dom", "scheduler", "loose-envify", "js-tokens"]);
  assertEquals(b.measuredAt, 1000);

  const esm = parseSize({ ...SIZE, hasJSModule: "dist/index.mjs", hasSideEffects: ["*.css"] })!;
  assertEquals(esm.treeShakeable, true);
  assertEquals(esm.sideEffects, ["*.css"]);
  assertEquals(parseSize({ ...SIZE, hasSideEffects: false })!.sideEffects, false);

  assertEquals(parseSize({ error: { code: "BuildError" } }), undefined);
  assertEquals(parseSize({ name: "x", version: "1.0.0" }), undefined);
  assertEquals(parseSize(null), undefined);
});

Deno.test("bundlephobia errors read like sentences", () => {
  assertEquals(
    bundlephobiaError({
      error: { code: "PackageNotFoundError", message: "The package you were looking for doesn't exist." },
    }, "reakt"),
    "No package “reakt” on npm",
  );
  assert(bundlephobiaError({ error: { code: "BlocklistedPackageError" } }, "aws-sdk").includes("blocklisted"));
  assertEquals(
    bundlephobiaError({ error: { code: "BuildError", message: "Failed to build <code>x</code>" } }, "x"),
    "Bundlephobia couldn't build x: Failed to build x",
  );
  assertEquals(bundlephobiaError({}, "x"), "Bundlephobia couldn't measure x");
});

Deno.test("repository URLs", () => {
  assertEquals(repoUrl("git+https://github.com/lodash/lodash.git"), "https://github.com/lodash/lodash");
  assertEquals(repoUrl("git@github.com:iamkun/dayjs.git"), "https://github.com/iamkun/dayjs");
  assertEquals(repoUrl({ type: "git", url: "git://github.com/a/b.git" }), "https://github.com/a/b");
  assertEquals(repoUrl("github:sindresorhus/ky"), "https://github.com/sindresorhus/ky");
  assertEquals(repoUrl("sindresorhus/ky"), "https://github.com/sindresorhus/ky");
  assertEquals(repoUrl("svn://nope"), undefined);
  assertEquals(repoUrl(undefined), undefined);
});

Deno.test("similar packages: names or objects", () => {
  const sim = parseSimilar({
    category: {
      label: "date-time",
      score: 13.5,
      similar: ["moment", { name: "dayjs", gzip: 2920, size: 7185, description: "2KB immutable date" }, "dayjs", {}],
    },
  });
  assertEquals(sim.category, "date time");
  assertEquals(sim.packages, [
    { name: "moment" },
    { name: "dayjs", gzip: 2920, size: 7185, description: "2KB immutable date" },
  ]);
  assertEquals(parseSimilar({}).packages, []);
  assertEquals(parseSimilar(null).packages, []);
});

Deno.test("alternatives: bundlephobia's first, then ours, never itself", () => {
  const c = candidates("moment", [{ name: "moment" }, { name: "luxon", gzip: 23000 }]);
  assertEquals(c.map((p) => p.name), ["luxon", "dayjs", "date-fns"]);
  assertEquals(candidates("left-pad", []), []);
  const l = lighter(72000, [
    { name: "luxon", gzip: 23000 },
    { name: "dayjs", gzip: 2900 },
    { name: "big", gzip: 90000 },
    { name: "unknown" },
  ]);
  assertEquals(l.map((p) => p.name), ["dayjs", "luxon"]);
  assertEquals(saving(72000, 2900), "-96 %");
  assertEquals(saving(1000, 1500), "+50 %");
  assertEquals(saving(1000, 1000), "same");
});

Deno.test("size history, newest first", () => {
  const h = parseHistory({
    "18.2.0": { size: 6400, gzip: 2500 },
    "18.10.0-canary": { size: 6600, gzip: 2600 },
    "17.0.2": { size: 6900, gzip: 2700 },
    "18.10.0": { size: 6500, gzip: 2550 },
    "16.0.0": {},
    "latest": { size: 1, gzip: 1 },
  });
  assertEquals(h.map((v) => v.version), ["18.10.0", "18.10.0-canary", "18.2.0", "17.0.2"]);
  assertEquals(parseHistory([]), []);
  assert(compareVersions("1.10.0", "1.9.9") > 0);
  assert(compareVersions("2.0.0-beta.10", "2.0.0-beta.9") > 0);
  assertEquals(compareVersions("v1.2.3", "1.2.3"), 0);
});

Deno.test("packagephobia install size", () => {
  const json = {
    name: "express",
    version: "4.18.2",
    publish: { bytes: 220458, files: 16, pretty: "215 kB", color: "#44cc11" },
    install: { bytes: 2273591, files: 482, pretty: "2.17 MB", color: "#dfb317" },
  };
  assertEquals(parseInstall(json), { publishBytes: 220458, installBytes: 2273591, installFiles: 482 });
  assertEquals(parseInstall({ publish: { bytes: 0 }, install: { bytes: 0 } }), undefined);
  assertEquals(parseInstall({ error: "not found" }), undefined);
});

Deno.test("npm search", () => {
  const s = parseSearch({
    objects: [
      {
        downloads: { monthly: 120000000, weekly: 30000000 },
        package: { name: "dayjs", version: "1.11.13", description: "2KB immutable date time library" },
        score: { final: 0.9 },
      },
      { package: { name: "dayjs-plugin-utc", version: "0.1.2" } },
      { package: { name: "", version: "1.0.0" } },
    ],
    total: 2,
  });
  assertEquals(s, [
    { name: "dayjs", version: "1.11.13", description: "2KB immutable date time library", downloads: 30000000 },
    { name: "dayjs-plugin-utc", version: "0.1.2", description: undefined, downloads: undefined },
  ]);
  assertEquals(parseSearch({}), []);
});

Deno.test("sizes and durations", () => {
  assertEquals(bytes(512), "512 B");
  assertEquals(bytes(2543), "2.48 kB");
  assertEquals(bytes(41981), "41 kB");
  assertEquals(bytes(130469), "127 kB");
  assertEquals(bytes(2273591), "2.17 MB");
  assertEquals(bytes(-1), "?");
  assertEquals(duration(0.2), "< 1 ms");
  assertEquals(duration(85.4), "85 ms");
  assertEquals(duration(1234), "1.23 s");
  assertEquals(duration(12_340), "12.3 s");
  assertEquals(duration(61_000), "1 min 1 s");
  assertEquals(sizeColor(2000), "green");
  assertEquals(sizeColor(20_000), "yellow");
  assertEquals(sizeColor(60_000), "orange");
  assertEquals(sizeColor(200_000), "red");
});

Deno.test("download time: a round trip plus the transfer", () => {
  const [slow3g, , fast4g] = NETWORKS;
  // 50 kB on 400 kbit/s: 1 s, plus 400 ms.
  assertEquals(downloadTime(50_000, slow3g), 1400);
  assertEquals(Math.round(downloadTime(41981, fast4g)), 122);
});

Deno.test("recent packages: one per name, newest first, capped", () => {
  const e = (name: string, at: number) => ({ name, version: "1.0.0", size: 10, gzip: 5, at });
  let r = addRecent([], e("a", 1));
  r = addRecent(r, e("b", 2));
  r = addRecent(r, { ...e("a", 3), version: "2.0.0" });
  assertEquals(r.map((x) => `${x.name}@${x.version}`), ["a@2.0.0", "b@1.0.0"]);
  assertEquals(addRecent(r, e("c", 4), 2).map((x) => x.name), ["c", "a"]);
  assertEquals(
    summaryLine({ name: "dayjs", version: "1.11.13", size: 7185, gzip: 2920 }),
    "dayjs@1.11.13: 7.02 kB minified, 2.85 kB min+gzip",
  );
});
