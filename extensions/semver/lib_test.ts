import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  bounds,
  boundsInWords,
  boundsShort,
  bump,
  compare,
  compareReason,
  compareSentence,
  desugared,
  type Dialect,
  difference,
  EXAMPLES,
  format,
  guessDialect,
  isVersion,
  maxSatisfying,
  parsePep440,
  parseQuery,
  parseRange,
  parseRuby,
  parseSemver,
  parts,
  satisfies,
  SCHEME,
  type Scheme,
  sortVersions,
  splitDialect,
} from "./lib.ts";

const v = parseSemver;
const ok = (range: string, version: string, dialect?: Dialect) => {
  const r = parseRange(range, dialect);
  return satisfies(
    (SCHEME[r.dialect] === "semver" ? parseSemver : SCHEME[r.dialect] === "ruby" ? parseRuby : parsePep440)(version),
    r,
  ).ok;
};
const short = (range: string, dialect?: Dialect) => {
  const r = parseRange(range, dialect);
  return r.sets.map((s) => boundsShort(bounds(s))).join(" || ");
};

Deno.test("semver: parsing", () => {
  const x = v("v1.2.3-rc.1+build.5");
  assertEquals(x.release, [1, 2, 3]);
  assertEquals(x.pre, ["rc", 1]);
  assertEquals(x.build, ["build", "5"]);
  assertEquals(format(x), "1.2.3-rc.1+build.5");
  assertEquals(format(v("=1.0.0")), "1.0.0");
  // Partial versions are completed.
  assertEquals(format(v("1.2")), "1.2.0");
  assertEquals(format(v("2")), "2.0.0");
  assertThrows(() => v("1.02.3"), Error, "leading zeros");
  assertThrows(() => v("1.2.3-01"), Error, "leading zeros");
  assertThrows(() => v("one"), Error, "not a version");
  assert(!isVersion("1.2.3.4"));
  assert(isVersion("1.2.3.4", "ruby"));
  assert(isVersion("1.0rc1", "pep440"));
});

Deno.test("semver: precedence from the spec (§11)", () => {
  const ordered = [
    "1.0.0-alpha",
    "1.0.0-alpha.1",
    "1.0.0-alpha.beta",
    "1.0.0-beta",
    "1.0.0-beta.2",
    "1.0.0-beta.11",
    "1.0.0-rc.1",
    "1.0.0",
    "1.0.1",
    "1.2.0",
    "1.10.0",
    "2.0.0",
  ];
  const shuffled = [...ordered].reverse().map(v);
  assertEquals(sortVersions(shuffled).map(format), ordered);
  assertEquals(compare(v("1.0.0+a"), v("1.0.0+b")), 0);
});

Deno.test("comparing two versions", () => {
  assertEquals(compareSentence(v("1.2.3"), v("1.10.0")), "1.2.3 < 1.10.0");
  assertEquals(compareReason(v("1.2.3"), v("1.10.0")), "minor 2 < 10");
  assertEquals(compareReason(v("2.0.0"), v("1.9.9")), "major 2 > 1");
  assertEquals(compareReason(v("1.0.0-rc.1"), v("1.0.0")), "1.0.0 is the final release, after its prereleases");
  assertEquals(compareReason(v("1.0.0-beta.2"), v("1.0.0-beta.11")), "prerelease beta.2 < beta.11");
  assertEquals(difference(v("1.0.0+a"), v("1.0.0+b")), "build");
  assertEquals(difference(v("1.2.3"), v("1.2.4")), "patch");
  assertEquals(compareReason(parsePep440("1!1.0"), parsePep440("2.0")), "epoch 1 > 0");
});

Deno.test("bumping like npm version", () => {
  const inc = (x: string, kind: Parameters<typeof bump>[1], id = "") => format(bump(v(x), kind, id));
  assertEquals(inc("1.2.3", "major"), "2.0.0");
  assertEquals(inc("1.2.3", "minor"), "1.3.0");
  assertEquals(inc("1.2.3", "patch"), "1.2.4");
  assertEquals(inc("1.2.3", "premajor"), "2.0.0-0");
  assertEquals(inc("1.2.3", "premajor", "beta"), "2.0.0-beta.0");
  assertEquals(inc("1.2.3", "preminor", "rc"), "1.3.0-rc.0");
  assertEquals(inc("1.2.3", "prepatch"), "1.2.4-0");
  assertEquals(inc("1.2.3", "prerelease"), "1.2.4-0");
  assertEquals(inc("1.2.4-0", "prerelease"), "1.2.4-1");
  assertEquals(inc("1.2.3-beta.1", "prerelease"), "1.2.3-beta.2");
  assertEquals(inc("1.2.3-beta", "prerelease"), "1.2.3-beta.0");
  assertEquals(inc("1.2.3-beta.1", "prerelease", "alpha"), "1.2.3-alpha.0");
  assertEquals(inc("1.2.3-beta.1", "prerelease", "beta"), "1.2.3-beta.2");
  // A prerelease of x.0.0 is promoted, not bumped.
  assertEquals(inc("1.0.0-rc.1", "major"), "1.0.0");
  assertEquals(inc("1.2.0-rc.1", "minor"), "1.2.0");
  assertEquals(inc("1.2.3-rc.1", "patch"), "1.2.3");
  assertEquals(inc("1.2.3-rc.1", "minor"), "1.3.0");
  assertEquals(inc("1.2.3-rc.1", "release"), "1.2.3");
  assertEquals(inc("1.2.3+build", "patch"), "1.2.4");
  assertThrows(() => bump(parsePep440("1.0"), "major"), Error, "semantic versions");
});

Deno.test("npm: caret", () => {
  assertEquals(short("^1.2.3"), ">=1.2.3 <2.0.0");
  assertEquals(short("^0.2.3"), ">=0.2.3 <0.3.0");
  assertEquals(short("^0.0.3"), ">=0.0.3 <0.0.4");
  assertEquals(short("^1.2.x"), ">=1.2.0 <2.0.0");
  assertEquals(short("^0.0.x"), ">=0.0.0 <0.1.0");
  assertEquals(short("^0.x"), ">=0.0.0 <1.0.0");
  assertEquals(short("^1"), ">=1.0.0 <2.0.0");
  assertEquals(short("^*"), "*");
  assert(ok("^1.2.3", "1.2.3"));
  assert(ok("^1.2.3", "1.9.9"));
  assert(!ok("^1.2.3", "2.0.0"));
  assert(!ok("^1.2.3", "1.2.2"));
  assert(!ok("^1.2.3", "2.0.0-rc.1"));
  assert(ok("^0.2.3", "0.2.5"));
  assert(!ok("^0.2.3", "0.3.0"));
  assert(ok("^0.0.3", "0.0.3"));
  assert(!ok("^0.0.3", "0.0.4"));
  const r = parseRange("^1.2.3");
  assertEquals(r.sets[0][0].meaning, "Compatible with 1.2.3: minor and patch updates (1.x.x)");
  assertEquals(
    parseRange("^0.2.3").sets[0][0].meaning,
    "Compatible with 0.2.3: patch updates (0.2.x) (below 1.0.0, ^ treats the first non-zero part as the major)",
  );
  assertEquals(parseRange("^0.0.3").sets[0][0].meaning.startsWith("Compatible with 0.0.3: this version only"), true);
});

Deno.test("npm: prereleases only match when the range names the same x.y.z", () => {
  assert(!ok("^1.2.3", "1.3.0-beta"));
  assert(!ok("^1.2.3", "1.2.4-beta"));
  assert(ok("^1.2.3-beta.2", "1.2.3-beta.4"));
  assert(!ok("^1.2.3-beta.2", "1.2.4-beta.2"));
  assert(ok("^1.2.3-beta.2", "1.2.3"));
  assert(ok("^1.2.3-beta.2", "1.5.0"));
  assert(!ok("*", "1.0.0-rc.1"));
  assert(ok(">=1.0.0-rc.1", "1.0.0-rc.2"));
  const why = satisfies(v("1.3.0-beta"), parseRange("^1.2.3"));
  assertEquals(why.reason, "is a prerelease: npm only matches prereleases of a version the range names");
});

Deno.test("npm: tilde, x-ranges, hyphens and partial comparators", () => {
  assertEquals(short("~1.2.3"), ">=1.2.3 <1.3.0");
  assertEquals(short("~1.2"), ">=1.2.0 <1.3.0");
  assertEquals(short("~1"), ">=1.0.0 <2.0.0");
  assertEquals(short("~0.2.3"), ">=0.2.3 <0.3.0");
  assertEquals(short("~1.2.3-beta.2"), ">=1.2.3-beta.2 <1.3.0");
  assertEquals(short("1.x"), ">=1.0.0 <2.0.0");
  assertEquals(short("1.2.*"), ">=1.2.0 <1.3.0");
  assertEquals(short("*"), "*");
  assertEquals(short(""), "*");
  assertEquals(short("1.2.3"), "=1.2.3");
  assertEquals(short("=1.2"), ">=1.2.0 <1.3.0");
  assertEquals(short("1.2.3 - 2.3.4"), ">=1.2.3 <=2.3.4");
  assertEquals(short("1.2 - 2.3.4"), ">=1.2.0 <=2.3.4");
  assertEquals(short("1.2.3 - 2.3"), ">=1.2.3 <2.4.0");
  assertEquals(short("1.2.3 - 2"), ">=1.2.3 <3.0.0");
  assertEquals(short(">1.2"), ">=1.3.0");
  assertEquals(short(">1"), ">=2.0.0");
  assertEquals(short(">=1.2"), ">=1.2.0");
  assertEquals(short("<1.2"), "<1.2.0");
  assertEquals(short("<=1.2"), "<1.3.0");
  assertEquals(short("<=1"), "<2.0.0");
  assertEquals(short(">= 1.2.3 < 2"), ">=1.2.3 <2.0.0");
  assert(ok("1.2.3 - 2.3", "2.3.9"));
  assert(!ok("1.2.3 - 2.3", "2.4.0"));
  assert(!ok("1.2.3 - 2.3", "1.2.2"));
  assert(!ok(">1.2", "1.2.9"));
  assert(ok(">1.2", "1.3.0"));
  assert(ok("<=1.2", "1.2.9"));
  assert(!ok("<=1.2", "1.3.0"));
  assert(!ok("<1.2", "1.2.0-rc.1"));
  assert(!ok(">*", "1.0.0"));
  // Two comparators that can't both hold.
  assert(bounds(parseRange(">2 <1").sets[0]).empty);
  assertEquals(boundsInWords(bounds(parseRange(">2 <1").sets[0])), "No version can match");
});

Deno.test("npm: alternatives", () => {
  const r = parseRange(">=1.0.0 <2.0.0 || ^3.1");
  assertEquals(r.sets.length, 2);
  assertEquals(desugared(r), ">=1.0.0 <2.0.0 || >=3.1.0 <4.0.0");
  assert(ok(">=1.0.0 <2.0.0 || ^3.1", "3.5.0"));
  assert(!ok(">=1.0.0 <2.0.0 || ^3.1", "2.5.0"));
  assertEquals(satisfies(v("3.5.0"), r).reason, "matches ^3.1");
  assertEquals(satisfies(v("2.5.0"), r).reason, "matches none of the alternatives");
  assertEquals(satisfies(v("0.5.0"), parseRange("^1.2")).reason, "below the minimum (>=1.2.0)");
  assertEquals(satisfies(v("2.5.0"), parseRange("^1.2")).reason, "above the maximum (<2.0.0)");
  assertEquals(
    maxSatisfying(["1.2.0", "1.9.1", "2.0.0", "1.10.3"].map(v), parseRange("^1.2"))?.raw,
    "1.10.3",
  );
  assertEquals(maxSatisfying(["3.0.0"].map(v), parseRange("^1.2")), undefined);
  assertThrows(() => parseRange("^1.2.3.4"), Error, "is not a version or range term");
});

Deno.test("Cargo: a bare version is a caret requirement", () => {
  assertEquals(short("0.4", "cargo"), ">=0.4.0 <0.5.0");
  assertEquals(short("1.2.3", "cargo"), ">=1.2.3 <2.0.0");
  assertEquals(short("=1.2", "cargo"), ">=1.2.0 <1.3.0");
  assertEquals(short(">=1.2, <1.5", "cargo"), ">=1.2.0 <1.5.0");
  assertEquals(short("~1.2", "cargo"), ">=1.2.0 <1.3.0");
  assertEquals(short("1.*", "cargo"), ">=1.0.0 <2.0.0");
  assertEquals(short("*", "cargo"), "*");
  assert(ok("0.4", "0.4.9", "cargo"));
  assert(!ok("0.4", "0.5.0", "cargo"));
  assert(ok(">=1.2, <1.5", "1.4.0"));
  assert(!ok(">=1.2, <1.5", "1.5.0"));
  assertEquals(guessDialect(">=1.2, <1.5"), "cargo");
  assertThrows(() => parseRange("1 || 2", "cargo"), Error, "npm only");
  assertEquals(desugared(parseRange("^1.2, <1.8", "cargo")), ">=1.2.0, <2.0.0, <1.8.0");
});

Deno.test("RubyGems: versions and the pessimistic operator", () => {
  const r = parseRuby("1.0.0.rc1");
  assertEquals(r.release, [1, 0, 0]);
  assertEquals(r.pre, ["rc", 1]);
  assertEquals(parseRuby("2.0.0-beta.2").pre, ["pre", "beta", 2]);
  assert(compare(parseRuby("1.0.0.rc1"), parseRuby("1.0.0")) < 0);
  assertEquals(compare(parseRuby("1.0"), parseRuby("1.0.0")), 0);
  assert(compare(parseRuby("1.0.0.4"), parseRuby("1.0.0")) > 0);
  assertEquals(short("~> 2.1"), ">=2.1 <3");
  assertEquals(short("~> 2.1.3"), ">=2.1.3 <2.2");
  assertEquals(short("~> 2"), ">=2 <3");
  assert(ok("~> 2.1", "2.9.4"));
  assert(!ok("~> 2.1", "3.0"));
  assert(!ok("~> 2.1", "2.0"));
  assert(ok("~> 2.1.3", "2.1.9"));
  assert(!ok("~> 2.1.3", "2.2.0"));
  assert(ok(">= 1.0, < 2.0", "1.5", "ruby"));
  assert(!ok("!= 1.5", "1.5", "ruby"));
  assert(ok("1.5", "1.5.0", "ruby"));
  assertEquals(parseRange("~> 2.1").sets[0][0].meaning, "Pessimistic: 2.1 or later, below 3 (minor updates)");
  assertEquals(guessDialect("~> 2.1"), "ruby");
  assertThrows(() => parseRuby("v1.0"), Error, "gem version");
});

Deno.test("PEP 440: versions and their order", () => {
  const x = parsePep440("1!2.0.1rc3.post2.dev4+ubuntu.1");
  assertEquals(x.epoch, 1);
  assertEquals(x.release, [2, 0, 1]);
  assertEquals(x.pre, ["rc", 3]);
  assertEquals(x.post, 2);
  assertEquals(x.dev, 4);
  assertEquals(x.build, ["ubuntu", "1"]);
  assertEquals(format(x), "1!2.0.1rc3.post2.dev4+ubuntu.1");
  // Normalized spellings.
  assertEquals(format(parsePep440("1.0-alpha-1")), "1.0a1");
  assertEquals(format(parsePep440("1.0.c2")), "1.0rc2");
  assertEquals(format(parsePep440("1.0-3")), "1.0.post3");
  const ordered = [
    "1.0.dev1",
    "1.0a1.dev1",
    "1.0a1",
    "1.0a2",
    "1.0b1",
    "1.0rc1",
    "1.0",
    "1.0+local",
    "1.0.post1.dev1",
    "1.0.post1",
    "1.1",
    "1!0.1",
  ];
  assertEquals(sortVersions([...ordered].reverse().map(parsePep440)).map((p) => p.raw), ordered);
  assertThrows(() => parsePep440("1.0-foo"), Error, "Python version");
});

Deno.test("PEP 440: specifiers", () => {
  assertEquals(short("~=1.4.5"), ">=1.4.5 <1.5");
  assertEquals(short("~=2.2"), ">=2.2 <3");
  assertEquals(short("==1.4.*"), ">=1.4 <1.5");
  assertEquals(short(">=2.0,!=2.1.*,<3"), ">=2.0 <3 !=2.1.*");
  assert(ok("~=1.4.5", "1.4.9"));
  assert(!ok("~=1.4.5", "1.5.0"));
  assert(!ok("~=1.4.5", "1.4.4"));
  assert(ok("~=2.2", "2.9"));
  assert(!ok("~=2.2", "3.0"));
  assert(ok("==1.4.*", "1.4.2"));
  assert(!ok("==1.4.*", "1.5"));
  assert(!ok(">=2.0,!=2.1.*,<3", "2.1.4"));
  assert(ok(">=2.0,!=2.1.*,<3", "2.2"));
  assert(ok("==1.0", "1.0.0", "python"));
  assert(ok("==1.0", "1.0+local", "python"));
  assert(!ok("==1.0+a", "1.0+b", "python"));
  assert(!ok(">=1.0", "2.0rc1", "python"));
  assert(ok(">=1.0rc1", "2.0rc1"));
  assert(!ok("<1.7", "1.7rc1", "python"));
  assert(!ok(">1.7", "1.7.post1", "python"));
  assert(ok(">1.7", "1.8", "python"));
  assert(ok("===1.0.0", "1.0.0", "python"));
  assert(!ok("===1.0.0", "1.0", "python"));
  assertEquals(
    satisfies(parsePep440("2.1.4"), parseRange(">=2.0,!=2.1.*,<3")).reason,
    "excluded by !=2.1.*",
  );
  assertEquals(
    satisfies(parsePep440("2.0rc1"), parseRange(">=1.0", "python")).reason,
    "is a prerelease: pip skips them unless the specifier names one (or --pre)",
  );
  assertThrows(() => parseRange("~=1", "python"), Error, "at least two numbers");
  assertThrows(() => parseRange("1.0", "python"), Error, "need an operator");
  assertThrows(() => parseRange(">=1.*", "python"), Error, ".* only works");
  assertEquals(parseRange("~=1.4.5").sets[0][0].meaning, "Compatible release: 1.4.5 or later, within 1.4.*");
});

Deno.test("bounds in words", () => {
  const words = (r: string, d?: Dialect) => boundsInWords(bounds(parseRange(r, d).sets[0]));
  assertEquals(words("^1.2.3"), "From 1.2.3 (included) to 2.0.0 (excluded)");
  assertEquals(words(">1.2.3"), "Later than 1.2.3");
  assertEquals(words(">=1.2.3"), "1.2.3 or later");
  assertEquals(words("<=2.0.0"), "2.0.0 or earlier");
  assertEquals(words("1.2.3"), "Exactly 1.2.3");
  assertEquals(words("*"), "Any version");
  assertEquals(words(">=2.0,!=2.1.*,<3"), "From 2.0 (included) to 3 (excluded), except 2.1.*");
  // The tighter of two lower bounds wins.
  assertEquals(words(">=1.0.0 >1.2.0 >=1.1.0"), "Later than 1.2.0");
});

Deno.test("dialect prefixes", () => {
  assertEquals(splitDialect("cargo: 1.2"), { dialect: "cargo", rest: "1.2" });
  assertEquals(splitDialect("pypi:>=1.0"), { dialect: "python", rest: ">=1.0" });
  assertEquals(splitDialect("gem: ~> 2"), { dialect: "ruby", rest: "~> 2" });
  assertEquals(splitDialect("http://x"), { rest: "http://x" });
  assertEquals(guessDialect("^1.2"), "npm");
  assertEquals(guessDialect("==1.4.*"), "python");
});

Deno.test("search bar queries", () => {
  assertEquals(parseQuery("  ").kind, "empty");

  const range = parseQuery("^1.2.3 1.4.0 2.0.0");
  assert(range.kind === "range");
  assertEquals(range.range.source, "^1.2.3");
  assertEquals(range.candidates.map(format), ["1.4.0", "2.0.0"]);

  const several = parseQuery(">=1.2.3 <2.0.0 1.5.0");
  assert(several.kind === "range");
  assertEquals(several.range.source, ">=1.2.3 <2.0.0");
  assertEquals(several.candidates.map(format), ["1.5.0"]);

  const hyphen = parseQuery("1.2.3 - 2.3 2.0.0");
  assert(hyphen.kind === "range");
  assertEquals(hyphen.range.source, "1.2.3 - 2.3");
  assertEquals(hyphen.candidates.map(format), ["2.0.0"]);

  const ruby = parseQuery("~> 2.1 2.9.4");
  assert(ruby.kind === "range");
  assertEquals(ruby.range.dialect, "ruby");
  assertEquals(ruby.range.source, "~> 2.1");
  assertEquals(ruby.candidates.map(format), ["2.9.4"]);

  const spaced = parseQuery(">= 1.0, < 2.0 1.5");
  assert(spaced.kind === "range");
  assertEquals(spaced.range.dialect, "cargo");
  assertEquals(spaced.range.source, ">= 1.0, < 2.0");
  assertEquals(spaced.candidates.map(format), ["1.5.0"]);

  const python = parseQuery(">=2.0,!=2.1.*,<3 2.1.4");
  assert(python.kind === "range");
  assertEquals(python.range.dialect, "python");
  assertEquals(python.candidates.map(format), ["2.1.4"]);

  const inForm = parseQuery("1.4.0 2.1.0 in ^1.2");
  assert(inForm.kind === "range" && inForm.explicit);
  assertEquals(inForm.candidates.map(format), ["1.4.0", "2.1.0"]);

  const cargo = parseQuery("cargo: 0.4 0.4.7");
  assert(cargo.kind === "range");
  assertEquals(cargo.range.dialect, "cargo");
  assertEquals(cargo.candidates.map(format), ["0.4.7"]);
  assert(parseQuery("cargo: 0.4").kind === "range");

  const b = parseQuery("bump 2.0.0-rc.1 rc");
  assert(b.kind === "bump");
  assertEquals(b.preid, "rc");
  assertEquals(format(b.version), "2.0.0-rc.1");
  assertEquals(parseQuery("bump 1.2.3").kind, "bump");

  const cmp = parseQuery("1.2.3 vs 1.10.0");
  assert(cmp.kind === "compare");
  assertEquals([format(cmp.a), format(cmp.b)], ["1.2.3", "1.10.0"]);
  assertEquals(parseQuery("1.2.3 1.10.0").kind, "compare");
  assertEquals(parseQuery("1.0a1 vs 1.0").kind, "compare");

  const sorted = parseQuery("sort 1.10.0 1.2.0 1.2.0-rc.1");
  assert(sorted.kind === "sort");
  assertEquals(sorted.versions.length, 3);
  assertEquals(parseQuery("1.10.0 1.2.0 1.9.0").kind, "sort");

  const single = parseQuery("v1.2.3-beta");
  assert(single.kind === "version");
  assertEquals(single.version.pre, ["beta"]);
  assertEquals(parseQuery("1.x").kind, "range");
  assertEquals(parseQuery("1.x 1.5.0").kind, "range");

  const bad = parseQuery("^1.2.3.4");
  assert(bad.kind === "error");
  const badBump = parseQuery("bump nope");
  assert(badBump.kind === "error");
});

Deno.test("parts of a version", () => {
  assertEquals(parts(v("1.2.3-rc.1+b5")), [
    ["Major", "1"],
    ["Minor", "2"],
    ["Patch", "3"],
    ["Prerelease", "rc.1"],
    ["Build", "b5"],
  ]);
  assertEquals(parts(parsePep440("1!2.0.post1+x")), [
    ["Epoch", "1"],
    ["Major", "2"],
    ["Minor", "0"],
    ["Post-release", "1"],
    ["Local", "x"],
  ]);
});

Deno.test("every example parses", () => {
  for (const e of EXAMPLES) {
    const q = parseQuery(e.query);
    assert(q.kind !== "error", `${e.query}: ${q.kind === "error" ? q.message : ""}`);
  }
});

Deno.test("manifest: no permission, command file exists", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions?: unknown;
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions, undefined);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  const schemes: Scheme[] = Object.values(SCHEME);
  assertEquals(new Set(schemes).size, 3);
});
