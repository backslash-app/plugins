import { assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  age,
  chooseBackend,
  decodeEntities,
  domainOf,
  excerpt,
  formatReadingTime,
  fromReadeck,
  fromWallabag,
  HOSTS,
  htmlToMarkdown,
  htmlToText,
  isAllowedHost,
  isoDate,
  linkIn,
  normalizeUrl,
  readeckQuery,
  sortArticles,
  wallabagQuery,
  wallabagTokenBody,
} from "./lib.ts";

const ARTICLE = `<!DOCTYPE html><html><head><title>x</title><style>p{color:red}</style></head><body>
<h1>Why <em>plain text</em> wins</h1>
<p>Plain text is <strong>durable</strong>, portable &amp; easy to <a href="/diff">diff</a>.<br>Really.</p>
<script>alert("no")</script>
<p>Second paragraph with <code>grep -r</code> and an image <img src="https://cdn.example.com/a.png" alt="A chart"></p>
<ul><li>One</li><li>Two<ul><li>Two point one</li></ul></li><li>Three</ul>
<ol start="3"><li>Third</li><li>Fourth</li></ol>
<blockquote><p>Simple things should be simple.</p><p>— Alan Kay</p></blockquote>
<pre><code class="language-sh">echo "hi"
ls -la</code></pre>
<table><tr><th>Tool</th><th>Format</th></tr><tr><td>Markdown</td><td>text</td></tr></table>
<figure><img src="b.jpg"><figcaption>A <b>caption</b></figcaption></figure>
<hr><p>L&#39;été &eacute;tait chaud&nbsp;&hellip;<p>Unclosed paragraph
</body></html>`;

Deno.test("HTML to Markdown", () => {
  const md = htmlToMarkdown(ARTICLE, "https://blog.example.com/posts/plain-text");
  assertEquals(
    md,
    [
      "## Why _plain text_ wins",
      "Plain text is **durable**, portable & easy to [diff](https://blog.example.com/diff).  \nReally.",
      "Second paragraph with `grep -r` and an image [🖼 A chart](https://cdn.example.com/a.png)",
      "- One\n- Two\n  - Two point one\n- Three",
      "3. Third\n4. Fourth",
      "> Simple things should be simple.\n>\n> — Alan Kay",
      '```sh\necho "hi"\nls -la\n```',
      "| Tool | Format |\n|---|---|\n| Markdown | text |",
      "[🖼 Image](https://blog.example.com/posts/b.jpg)\n\n_A **caption**_",
      "---",
      "L'été était chaud …",
      "Unclosed paragraph",
    ].join("\n\n"),
  );
  assertEquals(htmlToMarkdown("<div>a <span>b</span></div><div>c_d</div>"), "a b\n\nc\\_d");
  assertEquals(htmlToText("<p>Hello <b>world</b></p><p>again</p>"), "Hello worldagain");
  assertEquals(decodeEntities("&lt;a&gt; &#x41;&#66; &unknown;"), "<a> AB &unknown;");
});

Deno.test("Wallabag entries", () => {
  const a = fromWallabag({
    id: 1234,
    url: "https://www.example.com/post",
    title: "  A post  ",
    domain_name: "www.example.com",
    reading_time: 7,
    tags: [{ label: "dev" }, { label: "linux" }],
    is_archived: 0,
    is_starred: 1,
    created_at: "2026-10-28T09:15:00+0100",
    preview_picture: null,
    published_by: ["Ada"],
    content: "<p>Intro text of the article.</p>",
  });
  assertEquals(a.id, "1234");
  assertEquals(a.title, "A post");
  assertEquals(a.domain, "example.com");
  assertEquals([a.archived, a.starred], [false, true]);
  assertEquals(a.created, "2026-10-28T08:15:00.000Z");
  assertEquals(a.excerpt, "Intro text of the article.");
  assertEquals(a.tags, ["dev", "linux"]);
  assertEquals(isoDate("garbage"), "garbage");
  assertEquals(wallabagQuery("unread"), "sort=created&order=desc&perPage=100&detail=metadata&archive=0");
  assertEquals(wallabagQuery("starred").endsWith("starred=1"), true);
  assertEquals(
    wallabagTokenBody({ clientId: "1_abc", clientSecret: "s", username: "ada", password: "p w" }).toString(),
    "grant_type=password&client_id=1_abc&client_secret=s&username=ada&password=p+w",
  );
});

Deno.test("Readeck bookmarks", () => {
  const a = fromReadeck({
    id: "Xyz12",
    url: "https://lwn.net/Articles/1/",
    href: "https://read.home.lan/api/bookmarks/Xyz12",
    title: "Kernel news",
    site_name: "LWN.net",
    site: "lwn.net",
    created: "2026-10-27T10:00:00Z",
    authors: ["Jonathan Corbet"],
    description: "What happened in the kernel.",
    is_marked: false,
    is_archived: true,
    labels: ["kernel"],
    reading_time: 12,
    word_count: 2800,
    read_progress: 40,
    resources: { thumbnail: { src: "https://read.home.lan/bm/Xy/thumb.jpg" } },
  });
  assertEquals([a.domain, a.archived, a.starred, a.progress, a.words], ["lwn.net", true, false, 40, 2800]);
  assertEquals(a.image, "https://read.home.lan/bm/Xy/thumb.jpg");
  assertEquals(readeckQuery("unread"), "limit=100&sort=-created&is_archived=false");
  assertEquals(readeckQuery("starred"), "limit=100&sort=-created&is_marked=true");
  const sorted = sortArticles([a, { ...a, id: "b", archived: false, created: "2026-10-01T00:00:00Z" }]);
  assertEquals(sorted.map((x) => x.id), ["b", "Xyz12"]);
});

Deno.test("links, times and backends", () => {
  assertEquals(linkIn("look at https://example.com/a?b=1)."), "https://example.com/a?b=1");
  assertEquals(linkIn("example.com/post"), "https://example.com/post");
  assertEquals(linkIn("not a link"), undefined);
  assertEquals(domainOf("https://www.lemonde.fr/x"), "lemonde.fr");
  assertEquals(formatReadingTime(0), "< 1 min");
  assertEquals(formatReadingTime(7), "7 min");
  assertEquals(formatReadingTime(75), "1 h 15");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(age("2026-10-25T12:00:00Z", now), "3d");
  assertEquals(age("2026-10-28T11:00:00Z", now), "today");
  assertEquals(excerpt("word ".repeat(100), 20), "word word word word…");
  assertEquals(chooseBackend({ backend: "Readeck" }), "readeck");
  assertEquals(chooseBackend({ backend: "pocket" }), undefined);
  assertEquals(chooseBackend({ clientId: "1_x" }), "wallabag");
  assertEquals(chooseBackend({ token: "t", url: "https://read.lan" }), "readeck");
  assertEquals(chooseBackend({ username: "ada@example.com" }), "instapaper");
  assertEquals(chooseBackend({}), undefined);
});

Deno.test("servers and hosts match the manifest", async () => {
  assertEquals(normalizeUrl("wallabag.home.lan/api/"), "https://wallabag.home.lan");
  assertEquals(isAllowedHost("app.wallabag.it"), true);
  assertEquals(isAllowedHost("read.home.lan"), true);
  assertEquals(isAllowedHost("10.1.2.3"), true);
  assertEquals(isAllowedHost("wallabag.example.com"), false);
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
});
