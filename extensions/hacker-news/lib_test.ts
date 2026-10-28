import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  ago,
  commentsMarkdown,
  dateSection,
  decodeEntities,
  discoverFeeds,
  domain,
  excerpt,
  feedList,
  htmlToMarkdown,
  htmlToText,
  parseDate,
  parseFeed,
  parseXml,
  topComments,
  toStory,
} from "./lib.ts";

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<!-- generator: test -->
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Ars &amp; Crafts</title>
    <link>https://example.com/</link>
    <description><![CDATA[News about <b>things</b>]]></description>
    <atom:link href="https://example.com/feed" rel="self" type="application/rss+xml" />
    <item>
      <title><![CDATA[Rust 2.0 & "friends" <released>]]></title>
      <link>https://example.com/rust-2</link>
      <guid isPermaLink="false">post-42</guid>
      <pubDate>Tue, 27 Oct 2026 14:03:00 +0100</pubDate>
      <dc:creator>Ada Lovelace</dc:creator>
      <category>Programming</category>
      <category><![CDATA[Rust]]></category>
      <description>Short &lt;i&gt;summary&lt;/i&gt; &#8230;</description>
      <content:encoded><![CDATA[<p>The <a href="https://rust-lang.org">Rust</a> team…</p><pre><code>fn main() {}</code></pre>]]></content:encoded>
      <comments>https://example.com/rust-2#comments</comments>
    </item>
    <item>
      <title>L&#8217;été est fini</title>
      <link>/relative/post</link>
      <pubDate>Mon, 26 Oct 2026 08:00:00 PDT</pubDate>
      <description>Plain text</description>
      <enclosure url="https://example.com/ep1.mp3" length="123" type="audio/mpeg"/>
    </item>
    <item>
      <description>An item without a title nor a link</description>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:base="https://blog.example.org/">
  <title type="text">Example Blog</title>
  <subtitle>Thoughts</subtitle>
  <link href="https://blog.example.org/" rel="alternate"/>
  <link href="https://blog.example.org/atom.xml" rel="self"/>
  <updated>2026-10-27T10:00:00Z</updated>
  <entry>
    <title type="html">Hello &lt;em&gt;world&lt;/em&gt;</title>
    <link rel="alternate" type="text/html" href="posts/hello"/>
    <link rel="replies" href="posts/hello#comments"/>
    <id>tag:blog.example.org,2026:hello</id>
    <published>2026-10-27T09:30:00+02:00</published>
    <updated>2026-10-27T10:00:00Z</updated>
    <author><name>Grace Hopper</name></author>
    <category term="go" label="Go"/>
    <summary type="html">&lt;p&gt;A summary&lt;/p&gt;</summary>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>Some <strong>bold</strong> text &amp; more</p></div></content>
  </entry>
  <entry>
    <title>Plain &lt;3 text</title>
    <link href="https://elsewhere.example.com/x"/>
    <id>urn:uuid:2</id>
    <updated>2026-10-20</updated>
    <content type="text">1 &lt; 2</content>
  </entry>
</feed>`;

const RDF = `<?xml version="1.0"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel rdf:about="https://slashdot.example/"><title>Slash</title><link>https://slashdot.example/</link></channel>
  <item rdf:about="https://slashdot.example/1"><title>First</title><link>https://slashdot.example/1</link><dc:date>2026-10-27T12:00:00+00:00</dc:date></item>
</rdf:RDF>`;

Deno.test("entities and HTML", () => {
  assertEquals(decodeEntities("&amp;lt; &#x27;a&#39; &hellip; &eacute; &bogus; &#0;"), "&lt; 'a' … é &bogus; &#0;");
  assertEquals(htmlToText("<p>Hello&nbsp;<b>world</b></p><p>again</p>"), "Hello world again");
  const md = htmlToMarkdown(
    'First line<p>See <a href="https:&#x2F;&#x2F;example.com&#x2F;a" rel="nofollow">https:&#x2F;&#x2F;example.com&#x2F;a</a> and <i>this</i>.<p>&gt; quoted text<p><pre><code>  let x = 1 &lt; 2;\n</code></pre>',
  );
  assertEquals(
    md,
    "First line\n\nSee [https://example.com/a](https://example.com/a) and *this*.\n\n> quoted text\n\n```\n  let x = 1 < 2;\n```",
  );
  assertEquals(htmlToMarkdown("<ul><li>One</li><li>Two</li></ul><h2>Title</h2>"), "- One\n- Two\n\n### Title");
  assertEquals(htmlToMarkdown('<a href="javascript:alert(1)">x</a>'), "x");
});

Deno.test("small helpers", () => {
  assertEquals(domain("https://www.github.com/x"), "github.com");
  assertEquals(domain("nope"), undefined);
  const now = Date.UTC(2026, 9, 28, 12);
  assertEquals([ago(now - 30_000, now), ago(now - 5 * 60_000, now), ago(now - 3 * 3600_000, now)], [
    "now",
    "5 min",
    "3 h",
  ]);
  assertEquals(ago(now - 2 * 86400_000, now), "2 d");
  assertEquals(feedList("https://a.com/feed, https://b.com/rss\nnot-a-url https://a.com/feed"), [
    "https://a.com/feed",
    "https://b.com/rss",
  ]);
  const today = new Date(2026, 9, 28, 15).getTime();
  assertEquals(dateSection(new Date(2026, 9, 28, 9).getTime(), today), "Today");
  assertEquals(dateSection(new Date(2026, 9, 27, 23).getTime(), today), "Yesterday");
  assertEquals(dateSection(new Date(2026, 9, 24).getTime(), today), "This Week");
  assertEquals(dateSection(new Date(2026, 9, 10).getTime(), today), "This Month");
  assertEquals(dateSection(new Date(2025, 0, 1).getTime(), today), "Older");
  assertEquals(dateSection(undefined, today), "Undated");
});

Deno.test("dates: RFC 822 and ISO 8601 variants", () => {
  assertEquals(parseDate("Tue, 27 Oct 2026 14:03:00 +0100"), Date.UTC(2026, 9, 27, 13, 3));
  assertEquals(parseDate("Mon, 26 Oct 2026 08:00:00 PDT"), Date.UTC(2026, 9, 26, 15, 0));
  assertEquals(parseDate("27 Oct 2026 14:03 CEST"), Date.UTC(2026, 9, 27, 12, 3));
  assertEquals(parseDate("Thurs, 1 Oct 26 10:00:00 GMT"), Date.UTC(2026, 9, 1, 10));
  assertEquals(parseDate("Sun, 4 January 2026 09:00:00 Z"), Date.UTC(2026, 0, 4, 9));
  assertEquals(parseDate("2026-10-27T09:30:00+02:00"), Date.UTC(2026, 9, 27, 7, 30));
  assertEquals(parseDate("2026-10-27T09:30:00.123Z"), Date.UTC(2026, 9, 27, 9, 30));
  assertEquals(parseDate("2026-10-27 09:30:00 +0200"), Date.UTC(2026, 9, 27, 7, 30));
  assertEquals(parseDate("2026-10-20"), Date.UTC(2026, 9, 20));
  assertEquals(parseDate("garbage"), undefined);
  assertEquals(parseDate(""), undefined);
});

Deno.test("XML parser: CDATA, comments, attributes, self-closing and broken markup", () => {
  const doc = parseXml(
    `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><a x="1 &amp; 2" y='q>r'><b/><c><![CDATA[<raw>]]> &lt;t&gt;</c><d>unclosed</a>`,
  );
  const a = doc.children[0];
  assertEquals(a.name, "a");
  assertEquals(a.attrs, { x: "1 & 2", y: "q>r" });
  assertEquals(a.children.map((c) => c.name), ["b", "c", "d"]);
  assertEquals(a.children[1].text, "<raw> <t>");
  assertEquals(a.children[2].text, "unclosed");
});

Deno.test("RSS 2.0", () => {
  const feed = parseFeed(RSS, "https://example.com/feed");
  assertEquals(feed.title, "Ars & Crafts");
  assertEquals(feed.link, "https://example.com/");
  assertEquals(feed.description, "News about things");
  assertEquals(feed.items.length, 3);
  const [first, second, third] = feed.items;
  assertEquals(first.title, 'Rust 2.0 & "friends"');
  assertEquals(first.id, "post-42");
  assertEquals(first.link, "https://example.com/rust-2");
  assertEquals(first.date, Date.UTC(2026, 9, 27, 13, 3));
  assertEquals(first.author, "Ada Lovelace");
  assertEquals(first.categories, ["Programming", "Rust"]);
  assertEquals(first.comments, "https://example.com/rust-2#comments");
  assertStringIncludes(first.html, '<a href="https://rust-lang.org">Rust</a>');
  assertEquals(excerpt(first.html), "The [Rust](https://rust-lang.org) team…\n\n```\nfn main() {}\n```");
  assertEquals(second.title, "L’été est fini");
  assertEquals(second.link, "https://example.com/relative/post");
  assertEquals(second.id, "https://example.com/relative/post");
  assertEquals(second.enclosure, { url: "https://example.com/ep1.mp3", type: "audio/mpeg" });
  assertEquals(third.title, "An item without a title nor a link");
  assertEquals(third.link, undefined);
});

Deno.test("Atom", () => {
  const feed = parseFeed(ATOM, "https://blog.example.org/atom.xml");
  assertEquals([feed.title, feed.link, feed.description], ["Example Blog", "https://blog.example.org/", "Thoughts"]);
  const [hello, plain] = feed.items;
  assertEquals(hello.title, "Hello world");
  assertEquals(hello.link, "https://blog.example.org/posts/hello");
  assertEquals(hello.id, "tag:blog.example.org,2026:hello");
  assertEquals(hello.date, Date.UTC(2026, 9, 27, 7, 30));
  assertEquals(hello.author, "Grace Hopper");
  assertEquals(hello.categories, ["Go"]);
  assertEquals(htmlToText(hello.html), "Some bold text & more");
  assertEquals(plain.title, "Plain <3 text");
  assertEquals(plain.link, "https://elsewhere.example.com/x");
  assertEquals(plain.date, Date.UTC(2026, 9, 20));
  assertEquals(htmlToText(plain.html), "1 < 2");
});

Deno.test("RSS 1.0 (RDF) and non-feeds", () => {
  const feed = parseFeed(RDF);
  assertEquals(feed.title, "Slash");
  assertEquals(feed.items.map((i) => [i.title, i.link, i.date]), [
    ["First", "https://slashdot.example/1", Date.UTC(2026, 9, 27, 12)],
  ]);
  assertThrows(() => parseFeed("<html><body>Hi</body></html>"), Error, "Not an RSS or Atom feed");
});

Deno.test("feed discovery in web pages", () => {
  const html = `<html><head>
    <link rel="stylesheet" href="/s.css">
    <link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml">
    <link type="application/atom+xml" rel="alternate" href="https://example.com/atom">
  </head></html>`;
  assertEquals(discoverFeeds(html, "https://example.com/blog/"), [
    "https://example.com/feed.xml",
    "https://example.com/atom",
  ]);
  assertEquals(discoverFeeds("<html></html>", "https://example.com"), []);
});

Deno.test("Hacker News stories and comments", () => {
  const story = toStory({
    id: 1,
    type: "story",
    by: "pg",
    time: 1_761_000_000,
    title: "Ask HN: What&#x27;s new?",
    score: 321,
    descendants: 12,
    kids: [12, 11, 13],
    text: "<p>Tell us</p>",
  }, 3)!;
  assertEquals([story.title, story.kind, story.rank, story.points, story.comments], [
    "Ask HN: What's new?",
    "ask",
    3,
    321,
    12,
  ]);
  assertEquals(story.domain, undefined);
  assertEquals(
    toStory({ id: 2, title: "Show HN: A thing", url: "https://www.thing.dev/x", type: "story" }, 1)?.kind,
    "show",
  );
  assertEquals(toStory({ id: 3, title: "Hiring", type: "job" }, 1)?.kind, "job");
  assertEquals(toStory({ id: 4, dead: true, title: "x" }, 1), undefined);
  assertEquals(toStory({ id: 5, deleted: true }, 1), undefined);

  const tree = {
    id: 1,
    children: [
      { id: 11, author: "b", text: "<p>Second</p>", created_at_i: 1_761_000_100, children: [] },
      {
        id: 12,
        author: "a",
        text: "First <i>comment</i>",
        created_at_i: 1_761_000_000,
        children: [{ id: 14, author: "c", text: "reply", children: [{ id: 15, author: "d", text: "deeper" }] }],
      },
      { id: 13, author: null, text: null },
    ],
  };
  const top = topComments(tree, story.kids);
  assertEquals(top.map((c) => [c.author, c.markdown, c.replies]), [["a", "First *comment*", 2], ["b", "Second", 0]]);
  const md = commentsMarkdown(story, top, 1_761_000_000_000 + 3600_000);
  assertStringIncludes(md, "# Ask HN: What's new?");
  assertStringIncludes(md, "**321 points** · by pg · 1 h");
  assertStringIncludes(md, "**a** · 1 h · 2 replies");
  assertStringIncludes(md, "[10 more comments on Hacker News](https://news.ycombinator.com/item?id=1)");
});
