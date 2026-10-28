import { assert, assertEquals } from "@std/assert";
import SEARCH from "./testdata/search.json" with { type: "json" };
import ANSWERS from "./testdata/answers.json" with { type: "json" };
import { codeBlocks, decodeEntities, htmlToMarkdown, htmlToText } from "./html.ts";
import {
  ago,
  apiError,
  cacheKey,
  codeTitle,
  compact,
  excerpt,
  fresh,
  mapAnswer,
  mapPage,
  mapQuestion,
  parseQuery,
  pickAnswer,
  searchParams,
  siteFor,
  SITES,
  touch,
} from "./lib.ts";

const SO = SITES[0];

// ---------------------------------------------------------------------------
// HTML → markdown

Deno.test("html: paragraphs, emphasis, inline code and links", () => {
  assertEquals(
    htmlToMarkdown(
      `<p>Use <code>git reset --soft</code>, <strong>not</strong> <em>revert</em>. See <a href="https://git-scm.com/docs" rel="nofollow">the docs</a>.</p>\n<p>Second</p>`,
    ),
    "Use `git reset --soft`, **not** *revert*. See [the docs](https://git-scm.com/docs).\n\nSecond",
  );
});

Deno.test("html: code blocks keep their text and language", () => {
  const html =
    `<pre class="lang-py s-code-block"><code class="hljs language-python"><span class="hljs-keyword">def</span> f(x):\n    <span class="hljs-keyword">return</span> x &lt; 2 &amp;&amp; y\n\n\nprint(f(1))\n</code></pre>`;
  assertEquals(htmlToMarkdown(html), "```python\ndef f(x):\n    return x < 2 && y\n\n\nprint(f(1))\n```");
  assertEquals(codeBlocks(html), [{ code: "def f(x):\n    return x < 2 && y\n\n\nprint(f(1))", language: "python" }]);
  assertEquals(codeBlocks("<pre><code>ls -la\n</code></pre><p>x</p><pre class='lang-none'><code>a</code></pre>"), [
    { code: "ls -la", language: "" },
    { code: "a", language: "" },
  ]);
});

Deno.test("html: lists, nested lists and numbering", () => {
  const md = htmlToMarkdown(
    `<ol start="3"><li>Three</li><li><p>Four</p><ul><li>nested <code>a</code></li><li>nested b</li></ul></li></ol>`,
  );
  assertEquals(md, "3. Three\n4. Four\n  - nested `a`\n  - nested b");
  assertEquals(htmlToMarkdown("<ul><li>one<li>two</ul>"), "- one\n- two");
});

Deno.test("html: blockquotes, headings, rules, breaks", () => {
  assertEquals(
    htmlToMarkdown(
      `<h1>Title</h1><blockquote><p><strong>Note:</strong> one</p><p>two</p></blockquote><hr><p>a<br>b</p>`,
    ),
    "# Title\n\n> **Note:** one\n> two\n\n---\n\na\nb",
  );
  assertEquals(htmlToMarkdown("<h5>Deep</h5>"), "### Deep");
});

Deno.test("html: entities, relative links, images", () => {
  assertEquals(
    decodeEntities("&lt;div&gt; &amp; &#39;x&#39; &#x2014; &quot;q&quot; &nbsp;&unknown;"),
    "<div> & 'x' — \"q\"  &unknown;",
  );
  assertEquals(
    htmlToMarkdown(`<p><a href="/a/1">answer</a> <img src="https://i.sstatic.net/x.png" alt="shot"></p>`, {
      base: "https://stackoverflow.com",
    }),
    "[answer](https://stackoverflow.com/a/1) [shot](https://i.sstatic.net/x.png)",
  );
  assertEquals(htmlToMarkdown(`<a href="#anchor">local</a>`), "local");
});

Deno.test("html: words the renderer would italicize become code", () => {
  assertEquals(htmlToMarkdown("<p>Set my_var or *args, then a * b.</p>"), "Set `my_var` or `*args`, then a * b.");
});

Deno.test("html: tables become lines, scripts vanish, broken html is fine", () => {
  assertEquals(
    htmlToMarkdown("<table><tr><th>Key</th><th>Value</th></tr><tr><td>a</td><td><code>1</code></td></tr></table>"),
    "- Key · Value\n- a · `1`",
  );
  assertEquals(htmlToMarkdown("<script>alert(1)</script><p>ok"), "ok");
  assertEquals(htmlToMarkdown("<p>unclosed <b>bold</p></div>"), "unclosed **bold**");
  assertEquals(htmlToText("<p>a\n  <b>b</b></p>"), "a b");
});

// ---------------------------------------------------------------------------
// API

Deno.test("maps search results", () => {
  const page = mapPage(SEARCH, mapQuestion);
  assertEquals(page.quotaRemaining, 287);
  const [q, closed] = page.items;
  assertEquals(q.title, "How do I undo the most recent local commits in Git?");
  assertEquals(q.acceptedAnswerId, 927386);
  assertEquals(q.answers, 106);
  assertEquals(q.owner, {
    name: "Hamza Yerlikaya",
    reputation: 79855,
    link: "https://stackoverflow.com/users/89904/hamza-yerlikaya",
  });
  assertEquals(closed.title, `git "undo" doesn't work`);
  assertEquals(closed.closed, "Duplicate");
  assertEquals(closed.owner?.name, "new_user&co");
  assertEquals(closed.acceptedAnswerId, undefined);
});

Deno.test("picks the accepted answer, else the best voted", () => {
  const answers = mapPage(ANSWERS, mapAnswer).items;
  assertEquals(pickAnswer(answers, 927386)?.id, 927386);
  assertEquals(pickAnswer(answers.map((a) => ({ ...a, accepted: false })))?.id, 927400);
  assertEquals(pickAnswer([]), undefined);
  const md = htmlToMarkdown(answers[1].body, { base: "https://stackoverflow.com" });
  assert(md.startsWith('# Undo a commit & redo\n\n```bash\n$ git commit -m "Something terribly misguided"'));
  assert(md.includes("1. `git reset` is the command responsible for the **undo**."));
  assert(md.includes("2. Make corrections to `working_tree` files.\n  - add with `git add`"));
  assert(md.includes("> **Note:** see [this answer](https://stackoverflow.com/a/6866485)."));
  assertEquals(codeBlocks(answers[1].body).length, 2);
});

Deno.test("query syntax", () => {
  assertEquals(parseQuery("[Rust] [tokio]  spawn blocking is:accepted"), {
    q: "spawn blocking",
    tagged: ["rust", "tokio"],
    accepted: true,
  });
  const p = searchParams("[git] undo commit", SO, "k3y")!;
  assertEquals(p.get("q"), "undo commit");
  assertEquals(p.get("tagged"), "git");
  assertEquals(p.get("filter"), "withbody");
  assertEquals(p.get("site"), "stackoverflow");
  assertEquals(p.get("key"), "k3y");
  assertEquals(searchParams("a", SO), undefined);
  assertEquals(searchParams("[bash]", SO)?.get("q"), null);
});

Deno.test("sites", () => {
  assertEquals(siteFor("unix").host, "unix.stackexchange.com");
  assertEquals(siteFor("askubuntu.com").id, "askubuntu");
  assertEquals(siteFor("Super User").id, "superuser");
  assertEquals(siteFor("https://serverfault.com/questions").id, "serverfault");
  assertEquals(siteFor("").id, "stackoverflow");
  assertEquals(siteFor("nope").id, "stackoverflow");
});

Deno.test("API errors", () => {
  assertEquals(
    apiError(400, {
      error_id: 502,
      error_name: "throttle_violation",
      error_message: "too many requests from this IP, more requests available in 3600 seconds",
    }),
    "Too many requests: too many requests from this IP, more requests available in 3600 seconds",
  );
  assertEquals(
    apiError(400, { error_id: 400, error_name: "key_invalid" }),
    "The API key is invalid: check the preference",
  );
  assertEquals(apiError(500, {}), "Stack Exchange answered 500");
});

Deno.test("formatting", () => {
  assertEquals(compact(26741), "27k");
  assertEquals(compact(1234), "1.2k");
  assertEquals(compact(14462305), "14M");
  assertEquals(compact(2500000), "2.5M");
  assertEquals(compact(-2), "-2");
  const now = Date.UTC(2026, 9, 28);
  assertEquals(ago(now / 1000 - 3 * 86400, now), "3 days ago");
  assertEquals(ago(now / 1000 - 400 * 86400, now), "1 year ago");
  assertEquals(ago(now / 1000, now), "just now");
  assertEquals(codeTitle("\n  git reset HEAD~\ngit status", 0), "1. git reset HEAD~ (3 lines)");
  assertEquals(codeTitle("x".repeat(60), 1), `2. ${"x".repeat(47)}…`);
});

Deno.test("excerpts stop at a paragraph and close code blocks", () => {
  const short = excerpt("<p>short</p>", "https://stackoverflow.com");
  assertEquals(short, "short");
  const long = excerpt(
    `<p>${"a ".repeat(200)}</p><pre><code>line1\n\nline2\n${"b".repeat(400)}</code></pre><p>end</p>`,
    "https://stackoverflow.com",
    500,
  );
  assert(long.endsWith("…"));
  assertEquals((long.match(/^```/gm) ?? []).length % 2, 0);
  assert(!long.includes("end"));
});

Deno.test("cache helpers", () => {
  assert(fresh({ at: 1000, value: 1 }, 500, 1400));
  assert(!fresh({ at: 1000, value: 1 }, 500, 1600));
  assert(!fresh(undefined, 500));
  assertEquals(touch(["a", "b", "c"], "b", 3), { keys: ["b", "a", "c"], evicted: [] });
  assertEquals(touch(["a", "b", "c"], "d", 3), { keys: ["d", "a", "b"], evicted: ["c"] });
  assertEquals(cacheKey("search", SO, "  Undo   Commit "), "search:stackoverflow:undo commit");
});
