import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  compactNumber,
  decodeEntities,
  describeQuery,
  fenceLanguage,
  fileUrl,
  firstMatch,
  GREP_APP,
  grepAppParams,
  grepAppWebUrl,
  type Hit,
  languageOf,
  parseGrepApp,
  parseQuery,
  parseSnippet,
  parseSourcegraph,
  parseSse,
  rangeUrl,
  snippetMarkdown,
  snippetText,
  SOURCEGRAPH,
  sourcegraphFileUrl,
  sourcegraphQuery,
  sourcegraphStreamUrl,
  splitRepository,
  summary,
} from "./lib.ts";

// A hit of `GET https://grep.app/api/search?q=useState`.
const SNIPPET = '<table class="highlight-table"><tr data-line="10"><td><div class="lineno">10</div></td>' +
  '<td><div class="highlight"><pre><span class="k">import</span> { <mark>useState</mark> } <span class="k">from</span> <span class="s">&quot;react&quot;</span>;\n</pre></div></td></tr>' +
  '<tr data-line="11"><td><div class="lineno">11</div></td><td><div class="highlight"><pre>\n</pre></div></td></tr>' +
  '<tr data-line="42"><td><div class="lineno">42</div></td><td><div class="highlight"><pre>  <span class="k">const</span> [a, b] = <mark>useState</mark>&lt;<span class="nx">number</span>&gt;(0); <span class="c">// a &amp;&amp; b</span>\n</pre></div></td></tr></table>';

const GREP_ANSWER = {
  time: 87,
  facets: {
    count: 2,
    lang: {
      buckets: [{ val: "TypeScript", count: 6000 }, { val: "JavaScript", count: 3000 }, { val: "TSX", count: 1000 }],
    },
    repo: { buckets: [{ val: "facebook/react", count: 120 }] },
  },
  hits: {
    total: 10000,
    hits: [
      {
        repo: { raw: "facebook/react" },
        branch: { raw: "main" },
        path: { raw: "packages/react/src/ReactHooks.js" },
        total_matches: { raw: "2" },
        content: { snippet: SNIPPET },
      },
      // Newer answers use plain strings.
      {
        repo: "vercel/next.js",
        branch: "canary",
        path: "docs/hooks.md",
        content: { snippet: "<mark>useState</mark> hook" },
      },
    ],
  },
};

Deno.test("query syntax", () => {
  assertEquals(parseQuery("useState lang:ts repo:facebook/react"), {
    pattern: "useState",
    regexp: false,
    caseSensitive: false,
    words: false,
    languages: ["TypeScript"],
    repos: ["facebook/react"],
    paths: [],
  });
  const regex = parseQuery("/fn \\w+_test\\(/ lang:rust,go path:src/ case:yes");
  assertEquals(regex.pattern, "fn \\w+_test\\(");
  assert(regex.regexp);
  assert(regex.caseSensitive);
  assertEquals(regex.languages, ["Rust", "Go"]);
  assertEquals(regex.paths, ["src/"]);
  assertEquals(parseQuery('"Deno.serve(" repo:https://github.com/denoland/deno').pattern, "Deno.serve(");
  assertEquals(parseQuery('"Deno.serve(" repo:https://github.com/denoland/deno').repos, ["denoland/deno"]);
  assertEquals(parseQuery("a b c").pattern, "a b c");
  assertEquals(parseQuery("lang:c++ x").languages, ["C++"]);
  assertEquals(parseQuery("x lang:Brainfuck").languages, ["Brainfuck"]);
  assertEquals(parseQuery("std::vector").pattern, "std::vector");
  assertEquals(describeQuery(parseQuery("useState lang:ts case:yes")), "“useState” · in TypeScript · case-sensitive");
});

Deno.test("grep.app parameters and web link", () => {
  const q = parseQuery("/use\\w+/ lang:ts repo:facebook/react repo:vercel path:src case:yes");
  const p = grepAppParams(q, 2);
  assertEquals(p.get("q"), "use\\w+");
  assertEquals(p.get("page"), "2");
  assertEquals(p.get("regexp"), "true");
  assertEquals(p.get("case"), "true");
  assertEquals(p.getAll("f.lang"), ["TypeScript"]);
  assertEquals(p.getAll("f.repo"), ["facebook/react"]);
  assertEquals(p.getAll("f.repo.pattern"), ["vercel/"]);
  assertEquals(p.getAll("f.path.pattern"), ["src"]);
  assertEquals(
    grepAppWebUrl(parseQuery("useState lang:ts")),
    `${GREP_APP}/search?q=useState&filter%5Blang%5D%5B0%5D=TypeScript`,
  );
});

Deno.test("grep.app snippets become lines", () => {
  assertEquals(parseSnippet(SNIPPET), [
    { number: 10, text: 'import { useState } from "react";', match: true },
    { number: 11, text: "", match: false },
    { number: 42, text: "  const [a, b] = useState<number>(0); // a && b", match: true },
  ]);
  assertEquals(parseSnippet("<mark>x</mark> y"), [{ number: 1, text: "x y", match: true }]);
  assertEquals(decodeEntities("&lt;a&gt; &#39;b&#x27; &amp;amp; &nbsp;&unknown;"), "<a> 'b' &amp;  &unknown;");
});

Deno.test("grep.app answers", () => {
  const r = parseGrepApp(GREP_ANSWER);
  assertEquals(r.total, 10000);
  assertEquals(r.hits.length, 2);
  const [react, next] = r.hits;
  assertEquals([react.repo, react.path, react.ref, react.matches], [
    "facebook/react",
    "packages/react/src/ReactHooks.js",
    "main",
    2,
  ]);
  assertEquals([next.repo, next.ref, next.matches], ["vercel/next.js", "canary", 1]);
  assertEquals(r.languages[0], { name: "TypeScript", count: 6000 });
  assertEquals(summary(r), "10k files · TypeScript 60%, JavaScript 30%, TSX 10%");
  assertEquals(firstMatch(react), 10);
  assertEquals(fileUrl(react), "https://github.com/facebook/react/blob/main/packages/react/src/ReactHooks.js#L10");
  assertEquals(rangeUrl(react), "https://github.com/facebook/react/blob/main/packages/react/src/ReactHooks.js#L10-L42");
  assertEquals(
    snippetText(react),
    'import { useState } from "react";\n\n…\n  const [a, b] = useState<number>(0); // a && b',
  );
  assertEquals(
    snippetMarkdown(react),
    '```javascript\n10▶ import { useState } from "react";\n11\n    ⋮\n42▶   const [a, b] = useState<number>(0); // a && b\n```',
  );
  assertEquals(languageOf(react), "JavaScript");
  assertEquals(parseGrepApp({ error: "bad regex" }).notes, ["bad regex"]);
});

// `GET https://sourcegraph.com/.api/search/stream?…` (text/event-stream).
const STREAM = `event: progress
data: {"done":false,"matchCount":0,"durationMs":40,"skipped":[]}

event: matches
data: [{"type":"content","path":"cli/main.rs","repositoryID":1,"repository":"github.com/denoland/deno","repoStars":98000,"branches":[""],"commit":"0123456789abcdef0123456789abcdef01234567","language":"Rust","chunkMatches":[{"content":"fn main() {\\n  let x = deno_test(1);\\n","contentStart":{"offset":100,"line":9,"column":0},"ranges":[{"start":{"offset":120,"line":10,"column":10},"end":{"offset":129,"line":10,"column":19}}]}]}]

event: matches
data: [{"type":"content","path":"src/lib.rs","repository":"gitlab.com/acme/tool","branches":["main"],"commit":"abc","lineMatches":[{"line":"pub fn deno_test() {}","lineNumber":4,"offsetAndLengths":[[7,9]]}]},{"type":"repo","repository":"github.com/x/y"}]

event: filters
data: [{"value":"lang:rust","label":"Rust","count":30,"kind":"lang"},{"value":"repo:^github\\\\.com/denoland/deno$","label":"github.com/denoland/deno","count":12,"kind":"repo"}]

event: alert
data: {"title":"Showing only the first 40 results","description":"Use count:all for more."}

event: progress
data: {"done":true,"matchCount":31,"durationMs":300}

event: done
data: {}

`;

Deno.test("server-sent events", () => {
  const events = parseSse(": comment\nevent: a\ndata: 1\ndata: 2\n\ndata: x\r\n\r\n");
  assertEquals(events, [{ event: "a", data: "1\n2" }, { event: "message", data: "x" }]);
  assertEquals(parseSse(STREAM).map((e) => e.event), [
    "progress",
    "matches",
    "matches",
    "filters",
    "alert",
    "progress",
    "done",
  ]);
});

Deno.test("Sourcegraph results", () => {
  const r = parseSourcegraph(parseSse(STREAM));
  assertEquals(r.total, 31);
  assertEquals(r.hits.length, 2);
  const [deno, tool] = r.hits;
  assertEquals(deno.repo, "denoland/deno");
  assertEquals(deno.host, "github.com");
  assertEquals(deno.commit, "0123456789abcdef0123456789abcdef01234567");
  assertEquals(deno.lines, [
    { number: 10, text: "fn main() {", match: false },
    { number: 11, text: "  let x = deno_test(1);", match: true },
  ]);
  assertEquals(deno.matches, 1);
  assertEquals(deno.stars, 98000);
  assertEquals(deno.language, "Rust");
  // A commit hash makes a permalink.
  assertEquals(
    rangeUrl(deno),
    "https://github.com/denoland/deno/blob/0123456789abcdef0123456789abcdef01234567/cli/main.rs#L10-L11",
  );
  assertEquals(tool.host, "gitlab.com");
  assertEquals(tool.ref, "main");
  assertEquals(tool.commit, undefined);
  assertEquals(tool.lines, [{ number: 5, text: "pub fn deno_test() {}", match: true }]);
  assertEquals(fileUrl(tool), "https://gitlab.com/acme/tool/-/blob/main/src/lib.rs#L5");
  assertEquals(sourcegraphFileUrl(tool), "https://sourcegraph.com/gitlab.com/acme/tool@main/-/blob/src/lib.rs?L5");
  assertEquals(r.notes, ["Showing only the first 40 results: Use count:all for more."]);
  assertEquals(r.languages, [{ name: "Rust", count: 30 }]);
  assertEquals(parseSourcegraph(parseSse('event: error\ndata: {"message":"invalid query"}\n\n')).notes, [
    "invalid query",
  ]);
});

Deno.test("Sourcegraph queries", () => {
  assertEquals(
    sourcegraphQuery(parseQuery("deno_test lang:rust repo:denoland/deno path:cli case:yes")),
    "repo:github.com/denoland/deno lang:Rust file:cli case:yes count:40 deno_test",
  );
  assertEquals(sourcegraphQuery(parseQuery("/fn \\w+/")), "count:40 /fn \\w+/");
  assertEquals(sourcegraphQuery(parseQuery('"a b"')), 'count:40 "a b"');
  assertEquals(sourcegraphQuery(parseQuery("x repo:gitlab.com/acme/tool")), "repo:gitlab.com/acme/tool count:40 x");
  const url = new URL(sourcegraphStreamUrl(parseQuery("/x+/")));
  assertEquals(url.origin, SOURCEGRAPH);
  assertEquals(url.pathname, "/.api/search/stream");
  assertEquals(url.searchParams.get("t"), "regexp");
  assertEquals(url.searchParams.get("cm"), "t");
});

Deno.test("small helpers", () => {
  assertEquals(splitRepository("github.com/a/b"), { host: "github.com", repo: "a/b" });
  assertEquals(splitRepository("local/repo"), { host: "", repo: "local/repo" });
  assertEquals(fenceLanguage("a/Dockerfile.dev"), "dockerfile");
  assertEquals(fenceLanguage("x.tsx"), "tsx");
  assertEquals(fenceLanguage("README"), "");
  assertEquals(compactNumber(999), "999");
  assertEquals(compactNumber(1234), "1.2k");
  assertEquals(compactNumber(25_000), "25k");
  assertEquals(compactNumber(3_400_000), "3.4M");
  const h: Hit = {
    engine: "grep.app",
    repo: "a/b",
    host: "github.com",
    path: "x y/C++.cc",
    ref: "main",
    lines: [],
    matches: 0,
  };
  assertEquals(fileUrl(h), "https://github.com/a/b/blob/main/x%20y/C%2B%2B.cc");
  assertEquals(languageOf(h), "C++");
});

Deno.test("manifest hosts", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, [new URL(GREP_APP).host, new URL(SOURCEGRAPH).host]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
