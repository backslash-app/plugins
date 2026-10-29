import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  age,
  chooseBackend,
  editTagBody,
  type Entry,
  formatReadingTime,
  fromGReader,
  fromGReaderSubscription,
  fromMiniflux,
  fromMinifluxFeed,
  groupEntries,
  HOSTS,
  htmlToMarkdown,
  htmlToText,
  isAllowedHost,
  isoDate,
  labelOf,
  minifluxQuery,
  normalizeUrl,
  parseClientLogin,
  readingMinutes,
  sortFeeds,
  streamPath,
  summary,
} from "./lib.ts";

const words = (n: number) => `<p>${Array(n).fill("word").join(" ")}</p>`;

Deno.test("chooseBackend: asked, or the one with credentials", () => {
  assertEquals(chooseBackend({ backend: "FreshRSS" }), "freshrss");
  assertEquals(chooseBackend({ token: "abc" }), "miniflux");
  assertEquals(chooseBackend({ username: "me", url: "rss.lan" }), "freshrss");
  assertEquals(chooseBackend({}), undefined);
  assertEquals(chooseBackend({ backend: "feedly" }), undefined);
});

Deno.test("Miniflux entries and feeds", () => {
  const e = fromMiniflux({
    id: 42,
    feed_id: 7,
    status: "unread",
    title: "  Rust 2026  ",
    url: "https://blog.rust-lang.org/2026",
    comments_url: "",
    published_at: "2026-10-28T09:15:00+01:00",
    content: words(460),
    author: "",
    starred: true,
    reading_time: 0,
    feed: { id: 7, title: "Rust Blog", site_url: "https://blog.rust-lang.org", category: { id: 1, title: "Dev" } },
  });
  assertEquals(e.id, "42");
  assertEquals(e.feedId, "7");
  assertEquals(e.title, "Rust 2026");
  assertEquals(e.category, "Dev");
  assertEquals(e.published, "2026-10-28T08:15:00.000Z");
  assertEquals(e.readingTime, 2, "computed when the server says 0");
  assertEquals(e.unread, true);
  assertEquals(e.starred, true);
  assertEquals(e.author, undefined);
  assertEquals(e.commentsUrl, undefined);
  assertEquals(fromMiniflux({ ...rawEntry(), reading_time: 7 }).readingTime, 7);

  const f = fromMinifluxFeed(
    { id: 7, title: "", site_url: "https://www.example.com", parsing_error_count: 3, parsing_error_message: "" },
    { "7": 12 },
  );
  assertEquals(f.title, "example.com");
  assertEquals(f.unread, 12);
  assertEquals(f.error, "3 failed fetches");
  assertEquals(minifluxQuery("unread"), "order=published_at&direction=desc&limit=150&status=unread");
  assertEquals(minifluxQuery("starred", 10), "order=published_at&direction=desc&limit=10&starred=true");
});

function rawEntry() {
  return {
    id: 1,
    feed_id: 1,
    status: "read" as const,
    title: "t",
    url: "https://a.example/x",
    published_at: "2026-10-01T00:00:00Z",
    starred: false,
  };
}

Deno.test("FreshRSS items, subscriptions and requests", () => {
  const feeds = new Map([[
    "feed/3",
    fromGReaderSubscription({
      id: "feed/3",
      title: "LWN",
      categories: [{ id: "user/-/label/Linux", label: "Linux" }],
      url: "https://lwn.net/headlines/rss",
      htmlUrl: "https://lwn.net",
    }, { "feed/3": 4 }),
  ]]);
  assertEquals(feeds.get("feed/3")?.unread, 4);
  assertEquals(feeds.get("feed/3")?.category, "Linux");
  const e = fromGReader({
    id: "tag:google.com,2005:reader/item/0005f0a1b2c3d4e5",
    title: "Kernel &amp; you",
    published: 1761638100,
    canonical: [{ href: "https://lwn.net/Articles/1/" }],
    categories: ["user/-/state/com.google/reading-list", "user/1/state/com.google/starred"],
    origin: { streamId: "feed/3", title: "", htmlUrl: "https://lwn.net" },
    summary: { content: words(800) },
  }, feeds);
  assertEquals(e.title, "Kernel & you");
  assertEquals(e.feedTitle, "LWN");
  assertEquals(e.category, "Linux", "from the subscription when the item has no label");
  assertEquals(e.unread, true);
  assertEquals(e.starred, true);
  assertEquals(e.readingTime, 3);
  assertEquals(e.published, "2025-10-28T07:55:00.000Z");
  assertEquals(e.url, "https://lwn.net/Articles/1/");
  const read = fromGReader({ id: "x", categories: ["user/-/state/com.google/read", "user/-/label/News"] });
  assertEquals(read.unread, false);
  assertEquals(read.category, "News");
  assertEquals(labelOf(["user/-/state/com.google/reading-list"]), undefined);

  assertEquals(parseClientLogin("SID=me/abc\nLSID=null\nAuth=me/0123abcd\n"), "me/0123abcd");
  assertEquals(parseClientLogin("Error=BadAuthentication"), undefined);
  assertEquals(
    streamPath("unread"),
    "/reader/api/0/stream/contents/user/-/state/com.google/reading-list?output=json&n=150&r=n&xt=user%2F-%2Fstate%2Fcom.google%2Fread",
  );
  assertEquals(streamPath("unread", "feed/3", 20).split("?")[0], "/reader/api/0/stream/contents/feed/3");
  assertEquals(streamPath("starred").includes("xt="), false);
  assertEquals(
    editTagBody(["a", "b"], "user/-/state/com.google/read", true, "TOK").toString(),
    "i=a&i=b&a=user%2F-%2Fstate%2Fcom.google%2Fread&T=TOK",
  );
  assertEquals(editTagBody(["a"], "s", false, "T").get("r"), "s");
});

Deno.test("reading time, age, summary", () => {
  assertEquals(readingMinutes(""), 1);
  assertEquals(readingMinutes(words(2300)), 10);
  assertEquals(formatReadingTime(0), "< 1 min");
  assertEquals(formatReadingTime(5), "5 min");
  assertEquals(formatReadingTime(65), "1 h 05");
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(age("2026-10-29T11:59:30Z", now), "now");
  assertEquals(age("2026-10-29T11:00:00Z", now), "1h");
  assertEquals(age("2026-10-26T12:00:00Z", now), "3d");
  assertEquals(age("2026-09-01T12:00:00Z", now), "8w");
  assertEquals(age("2026-08-01T12:00:00Z", now), "2mo");
  assertEquals(isoDate("2026-10-28T09:15:00+0100"), "2026-10-28T08:15:00.000Z");
  const entry = (id: string, feedTitle: string, published: string, readingTime = 4): Entry => ({
    id,
    feedId: feedTitle,
    feedTitle,
    title: id,
    url: "",
    published,
    readingTime,
    unread: true,
    starred: false,
    content: "",
  });
  const list = [
    entry("a", "LWN", "2026-10-01T00:00:00Z"),
    entry("b", "Rust", "2026-10-03T00:00:00Z"),
    entry("c", "LWN", "2026-10-02T00:00:00Z"),
  ];
  assertEquals(summary(list, "unread"), "3 unread · 12 min of reading");
  assertEquals(summary([], "starred"), "0 starred");
  const groups = groupEntries(list, (e) => e.feedTitle);
  assertEquals(groups.map(([k, es]) => [k, es.map((e) => e.id)]), [["LWN", ["c", "a"]], ["Rust", ["b"]]]);
  assertEquals(
    sortFeeds([
      { id: "1", title: "b", unread: 0 },
      { id: "2", title: "a", unread: 0 },
      { id: "3", title: "z", unread: 9 },
    ]).map((f) => f.id),
    ["3", "2", "1"],
  );
});

Deno.test("HTML to Markdown and text", () => {
  assertEquals(
    htmlToMarkdown(
      '<h2>Title</h2><p>Some <b>bold</b> &amp; <a href="/x">link</a>.</p><script>x()</script><ul><li>a<li>b</ul>',
      "https://site.example/post/1",
    ),
    "### Title\n\nSome **bold** & [link](https://site.example/x).\n\n- a\n- b",
  );
  assertEquals(htmlToText("<p>Hello <i>you</i></p>"), "Hello you");
});

Deno.test("hosts: the manifest's, and server addresses", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("reader.miniflux.app"));
  assert(isAllowedHost("rss.home.lan"));
  assert(isAllowedHost("192.168.1.20"));
  assert(isAllowedHost("freshrss"));
  assert(!isAllowedHost("rss.example.com"));
  assertEquals(normalizeUrl("rss.home.lan/i/"), "http://rss.home.lan");
  assertEquals(normalizeUrl("https://rss.example.ts.net/api/greader.php"), "https://rss.example.ts.net");
  assertEquals(normalizeUrl("reader.miniflux.app/unread"), "https://reader.miniflux.app");
  assertEquals(normalizeUrl("192.168.1.20:8080/v1/"), "http://192.168.1.20:8080");
  assertEquals(normalizeUrl(""), "");
});
