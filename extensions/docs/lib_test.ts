import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  bestPlatform,
  compareVersions,
  displayCommand,
  type Doc,
  type Entry,
  manToMarkdown,
  parseApropos,
  parseTldrIndex,
  parseTldrPage,
  parseWikiSearch,
  plainCommand,
  platformOrder,
  rank,
  resolveDocs,
  safeInline,
  scopeQuery,
  score,
  sectionName,
  size,
  splitList,
  stripHtml,
  stripOverstrike,
  tldrMarkdown,
  tldrName,
  tldrUrl,
  wikitextToMarkdown,
  wikiUrl,
} from "./lib.ts";
import { terminalArgs } from "./terminal.ts";

const DOCS: Doc[] = [
  { name: "JavaScript", slug: "javascript", mtime: 1729000000, db_size: 4567890 },
  { name: "Python", slug: "python~3.9", version: "3.9", release: "3.9.18" },
  { name: "Python", slug: "python~3.13", version: "3.13", release: "3.13.1" },
  { name: "Python", slug: "python~3.12", version: "3.12", release: "3.12.7" },
  { name: "Node.js", slug: "node", version: "", release: "23.1.0" },
  { name: "Node.js", slug: "node~22_lts", version: "22 LTS", release: "22.11.0" },
  { name: "Rust", slug: "rust", release: "1.82.0" },
  { name: "TypeScript", slug: "typescript", release: "5.6.3" },
];

Deno.test("scores: exact, prefix, word start, substring, letters in order", () => {
  assertEquals(score("map", "map"), 0);
  assert(score("Array.prototype.map()", "array")! < score("TypedArray", "array")!);
  assert(score("Array.prototype.map()", "map")! < score("WeakMap", "map")!);
  assertEquals(score("WeakMap", "zzz"), undefined);
  assert(score("Array.prototype.map()", "arrmap") !== undefined);
  const entries = ["WeakMap", "Map", "Array.prototype.map()", "Map.prototype.get()", "flatMap"];
  assertEquals(rank(entries, "map", (e) => e, 3), ["Map", "Map.prototype.get()", "Array.prototype.map()"]);
});

Deno.test("DevDocs: resolving names to slugs, newest version", () => {
  assertEquals(compareVersions("3.13", "3.9") > 0, true);
  assertEquals(resolveDocs(["python", "JavaScript", "rust", "nope"], DOCS), ["python~3.13", "javascript", "rust"]);
  assertEquals(resolveDocs(["python~3.12", "node", "js", "ts"], DOCS), [
    "python~3.12",
    "node",
    "javascript",
    "typescript",
  ]);
  assertEquals(resolveDocs(["Node.js"], DOCS), ["node"]);
  assertEquals(splitList("python, rust  javascript"), ["python", "rust", "javascript"]);
  assertEquals(size(4567890), "4.6 MB");
});

Deno.test("DevDocs: a doc name before the query narrows it", () => {
  const enabled = DOCS.filter((d) => ["javascript", "python~3.13"].includes(d.slug));
  assertEquals(scopeQuery("py dict", enabled), { slug: "python~3.13", text: "dict" });
  assertEquals(scopeQuery("javascript Array.from", enabled), { slug: "javascript", text: "Array.from" });
  assertEquals(scopeQuery("rust vec", enabled), { text: "rust vec" });
  assertEquals(scopeQuery("map", enabled), { text: "map" });
  const index: Entry[] = [
    { name: "dict", path: "library/stdtypes#dict", type: "Built-in Types" },
    { name: "dict.get()", path: "library/stdtypes#dict.get", type: "Built-in Types" },
    { name: "OrderedDict", path: "library/collections#collections.OrderedDict", type: "Data Types" },
  ];
  assertEquals(rank(index, "dict", (e) => e.name).map((e) => e.name), ["dict", "dict.get()", "OrderedDict"]);
});

const TAR = `# tar

> Archiving utility.
> Often combined with a compression method, such as \`gzip\` or \`bzip2\`.
> More information: <https://www.gnu.org/software/tar/manual/tar.html>.

- [c]reate an archive and write it to a [f]ile:

\`tar cf {{path/to/target.tar}} {{path/to/file1 path/to/file2 ...}}\`

- E[x]tract a (compressed) archive [f]ile into the target directory:

\`tar xf {{path/to/source.tar.ext}} {{[-C|--directory]}} {{path/to/directory}}\`
`;

Deno.test("tldr pages", () => {
  const page = parseTldrPage(TAR);
  assertEquals(page.title, "tar");
  assertEquals(page.description, [
    "Archiving utility.",
    "Often combined with a compression method, such as `gzip` or `bzip2`.",
  ]);
  assertEquals(page.more, "https://www.gnu.org/software/tar/manual/tar.html");
  assertEquals(page.examples.map((e) => e.description), [
    "create an archive and write it to a file",
    "Extract a (compressed) archive file into the target directory",
  ]);
  assertEquals(plainCommand(page.examples[1].command), "tar xf path/to/source.tar.ext --directory path/to/directory");
  assertEquals(
    displayCommand(page.examples[0].command),
    "tar cf ‹path/to/target.tar› ‹path/to/file1 path/to/file2 ...›",
  );
  const md = tldrMarkdown(page);
  assertStringIncludes(md, "**create an archive and write it to a file**\n```sh\ntar cf ‹path/to/target.tar›");
  assertEquals(tldrName("Git  Commit"), "git-commit");
  assertEquals(tldrUrl("tar", "common"), "https://raw.githubusercontent.com/tldr-pages/tldr/main/pages/common/tar.md");
  assertEquals(
    tldrUrl("tar", "linux", "fr"),
    "https://raw.githubusercontent.com/tldr-pages/tldr/main/pages.fr/linux/tar.md",
  );
});

Deno.test("tldr index and platforms", () => {
  const index = parseTldrIndex(JSON.stringify({
    commands: [
      { name: "apt", platform: ["linux"], language: ["en", "fr"], targets: [{ os: "linux", language: "en" }] },
      { name: "tar", platform: ["common"], language: ["en"] },
      { name: "brew", platform: ["osx"], language: ["en"] },
    ],
  }));
  assertEquals(index.map((c) => c.name), ["apt", "tar", "brew"]);
  const order = platformOrder("linux");
  assertEquals(order.slice(0, 3), ["linux", "common", "osx"]);
  assertEquals(bestPlatform({ name: "x", platforms: ["osx", "common"] }, order), "common");
  assertEquals(bestPlatform(index[2], order), "osx");
  assertEquals(platformOrder("darwin")[0], "osx");
});

const SEARCH = JSON.stringify({
  batchcomplete: true,
  query: {
    searchinfo: { totalhits: 1234 },
    search: [
      {
        ns: 0,
        title: "Pacman",
        pageid: 3049,
        size: 64000,
        wordcount: 8500,
        snippet: '<span class="searchmatch">pacman</span> is the &quot;package manager&quot; &amp; more',
        timestamp: "2026-10-01T10:00:00Z",
      },
      {
        ns: 0,
        title: "Pacman/Tips and tricks",
        pageid: 7,
        size: 1,
        wordcount: 3000,
        snippet: "",
        timestamp: "2026-09-01T00:00:00Z",
      },
    ],
  },
});

Deno.test("Arch Wiki search", () => {
  const { total, hits } = parseWikiSearch(SEARCH);
  assertEquals(total, 1234);
  assertEquals(hits[0].snippet, 'pacman is the "package manager" & more');
  assertEquals(hits[0].words, 8500);
  assertEquals(wikiUrl(hits[1].title), "https://wiki.archlinux.org/title/Pacman/Tips_and_tricks");
  assertEquals(wikiUrl("C++"), "https://wiki.archlinux.org/title/C%2B%2B");
  assertEquals(stripHtml("a &lt;b&gt; &#039;c&#039; &#x41;"), "a <b> 'c' A");
});

const WIKITEXT = `{{Lowercase title}}
[[Category:Package manager]]
[[de:Pacman]]
{{Related articles start}}
{{Related|pacman/Tips and tricks}}
{{Related articles end}}
The [https://pacman.archlinux.page/ pacman] package manager is one of the '''major distinguishing features''' of ''Arch Linux''.

== Usage ==
=== Installing packages ===
To install a single package, use {{ic|pacman -S package_name}}:

 # pacman -S foo bar

{{Note|Packages often have [[Wikipedia:Optional|optional dependencies]], see [[#Querying]].}}
{{Warning|Never run {{ic|pacman -Sy}} without upgrading.}}

* First item with {{Pkg|base-devel}}
** Nested item, see {{man|8|pacman}}
# Numbered

{{bc|1=
# pacman -Syu
}}
<!-- hidden comment -->
{| class="wikitable"
! Option !! Meaning
|-
| -S || sync
|}
See [[Mirrors]] and [[System maintenance|maintenance]] for my_config details.`;

Deno.test("wikitext to markdown", () => {
  const md = wikitextToMarkdown(WIKITEXT);
  assert(!md.includes("Category:"), md);
  assert(!md.includes("[[de:"), md);
  assert(!md.includes("hidden comment"), md);
  assertStringIncludes(
    md,
    "The [pacman](https://pacman.archlinux.page/) package manager is one of the **major distinguishing features** of *Arch Linux*.",
  );
  assertStringIncludes(md, "## Usage");
  assertStringIncludes(md, "### Installing packages");
  assertStringIncludes(md, "use `pacman -S package_name`:");
  assertStringIncludes(md, "```\n# pacman -S foo bar\n```");
  assertStringIncludes(
    md,
    "> **Note:** Packages often have [optional dependencies](https://en.wikipedia.org/wiki/Optional), see Querying.",
  );
  assertStringIncludes(md, "> **Warning:** Never run `pacman -Sy` without upgrading.");
  assertStringIncludes(md, "- First item with `base-devel`");
  assertStringIncludes(md, "  - Nested item, see `pacman(8)`");
  assertStringIncludes(md, "1. Numbered");
  assertStringIncludes(md, "```\n# pacman -Syu\n```");
  assertStringIncludes(md, "- Option · Meaning");
  assertStringIncludes(md, "- -S · sync");
  // Links keep their underscores; prose words with one are shown as code (they would toggle italics).
  assertStringIncludes(md, "[maintenance](https://wiki.archlinux.org/title/System_maintenance)");
  assertStringIncludes(md, "for `my_config` details.");
});

Deno.test("safe inline markdown", () => {
  assertEquals(safeInline("set MAX_ARGS to `a_b` and **bold**"), "set `MAX_ARGS` to `a_b` and **bold**");
  assertEquals(safeInline("glob *.txt"), "glob `*.txt`");
});

const APROPOS = `tar (1)              - an archiving utility
gzip (1), gunzip (1) - compress or expand files
tar (5)              - format of tape archive files
tar (1)              - an archiving utility
`;

Deno.test("apropos", () => {
  assertEquals(parseApropos(APROPOS), [
    { name: "tar", section: "1", description: "an archiving utility" },
    { name: "gzip", section: "1", description: "compress or expand files" },
    { name: "gunzip", section: "1", description: "compress or expand files" },
    { name: "tar", section: "5", description: "format of tape archive files" },
  ]);
  assertEquals(sectionName("3p"), "Library functions");
  assertEquals(sectionName("n"), "Section n");
});

const B = (s: string) => [...s].map((c) => `${c}\b${c}`).join("");

const MAN = `TAR(1)                       GNU TAR Manual                       TAR(1)

${B("NAME")}
       tar - an archiving utility

${B("SYNOPSIS")}
   ${B("Traditional usage")}
       ${B("tar")} {${B("A")}|${B("c")}} [${B("GnoSkpPuvw")}] [${B("ARG")}...]

${B("DESCRIPTION")}
       GNU  tar  saves  many files together into a single tape or disk archive,
       and can restore individual files from the archive.

${B("OPTIONS")}
       ${B("-c")}, ${B("--create")}
              Create  a  new  archive.  Arguments supply the names of the files
              to be archived.

       ${B("-v")}, ${B("--verbose")}
              Verbosely list files processed.  Set TAR_OPTIONS to change it.

       -f, --file=ARCHIVE  Use archive file.

       -D tablespace
       --tablespace=tablespace
              Specifies the default tablespace.

GNU TAR 1.35                      July 2023                          TAR(1)
`;

Deno.test("man pages to markdown", () => {
  assertEquals(stripOverstrike(B("NAME")), "NAME");
  assertEquals(stripOverstrike("_\bu_\bn\x1b[1mx\x1b[0m"), "unx");
  const md = manToMarkdown(MAN);
  assert(!md.includes("GNU TAR Manual"), md);
  assert(!md.includes("July 2023"), md);
  assertStringIncludes(md, "## Name\n\ntar - an archiving utility");
  assertStringIncludes(md, "## Synopsis\n\n```\nTraditional usage\n    tar {A|c} [GnoSkpPuvw] [ARG...]\n```");
  assertStringIncludes(
    md,
    "## Description\n\nGNU  tar  saves  many files together into a single tape or disk archive, and can restore",
  );
  assertStringIncludes(
    md,
    "**`-c, --create`**\nCreate  a  new  archive.  Arguments supply the names of the files to be archived.",
  );
  assertStringIncludes(md, "Set `TAR_OPTIONS` to change it.");
  assertStringIncludes(md, "**`-f, --file=ARCHIVE`** Use archive file.");
  assertStringIncludes(md, "**`-D tablespace, --tablespace=tablespace`**\nSpecifies the default tablespace.");
});

Deno.test("terminal", () => {
  assertEquals(terminalArgs("xfce4-terminal", ["man", "1", "tar"]), ["-x", "man", "1", "tar"]);
});
