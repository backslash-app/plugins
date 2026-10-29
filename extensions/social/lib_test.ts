import { assertEquals } from "@std/assert";
import {
  age,
  asCompleted,
  blueskyLength,
  type BskyNotification,
  type BskyPostView,
  compact,
  counts,
  decodeEntities,
  expandLinks,
  findUrls,
  fromBluesky,
  fromBlueskyNotifications,
  fromMastodon,
  fromMastodonNotification,
  graphemes,
  htmlToText,
  mastodonLength,
  type MastodonStatus,
  normalizeHandle,
  normalizeInstance,
  normalizeService,
  noticeTitle,
  parseVisibility,
  pdsEndpoint,
  people,
  replyPrefix,
  richText,
  rkey,
  shortUrl,
  subjectUris,
  toFacets,
  utf8Length,
} from "./lib.ts";

/** The text a facet points at, read back from the UTF-8 bytes. */
function slice(text: string, start: number, end: number): string {
  return new TextDecoder().decode(new TextEncoder().encode(text).slice(start, end));
}

Deno.test("html to text", () => {
  assertEquals(decodeEntities("caf&eacute; &amp; &#233;t&#xE9; &lt;3"), "caf&eacute; & été <3");
  assertEquals(
    htmlToText(
      '<p>Hello <a href="https://x.org/@bob" class="u-url mention">@<span>bob</span></a>!</p><p>Line<br />two <a href="https://example.com/a/very/long"><span class="invisible">https://</span><span class="ellipsis">example.com/a/ve</span><span class="invisible">ry/long</span></a></p>',
    ),
    "Hello @bob!\n\nLine\ntwo example.com/a/ve…",
  );
});

Deno.test("graphemes and bytes", () => {
  assertEquals(graphemes("héllo"), 5);
  assertEquals(graphemes("👍🏽👨‍👩‍👧"), 2);
  assertEquals(utf8Length("é"), 2);
  assertEquals(utf8Length("👍"), 4);
});

Deno.test("urls: trailing punctuation and parentheses", () => {
  assertEquals(findUrls("see https://example.com/a. and (https://x.org/b_(c)) ok").map((u) => u.url), [
    "https://example.com/a",
    "https://x.org/b_(c)",
  ]);
  assertEquals(findUrls("https://deno.com!").map((u) => [u.url, u.index]), [["https://deno.com", 0]]);
  assertEquals(findUrls("not a link: https://"), []);
});

Deno.test("mastodon counts links as 23 and remote mentions by user name", () => {
  const url = "https://example.com/" + "a".repeat(100);
  assertEquals(mastodonLength(`Read ${url}`), 5 + 23);
  assertEquals(mastodonLength("hi @ada@mastodon.social"), "hi @ada".length);
  assertEquals(mastodonLength("hi @ada"), 7);
  assertEquals(mastodonLength("ça va 👍🏽"), 7);
});

Deno.test("bluesky shortens links the way the app does", () => {
  assertEquals(shortUrl("https://www.example.com/"), "example.com");
  assertEquals(shortUrl("https://example.com/short"), "example.com/short");
  assertEquals(shortUrl("https://example.com/some/long/path?x=1"), "example.com/some/long/pa...");
  assertEquals(blueskyLength("Read https://example.com/some/long/path?x=1"), 5 + "example.com/some/long/pa...".length);
});

Deno.test("rich text: facets with UTF-8 byte offsets", () => {
  const input = "Café ☕ with @ada.bsky.social at https://example.com/some/long/path?x=1 #DenoLand, #2024 et #été";
  const { text, segments } = richText(input);
  assertEquals(text, "Café ☕ with @ada.bsky.social at example.com/some/long/pa... #DenoLand, #2024 et #été");
  assertEquals(segments.map((s) => [s.kind, s.value]), [
    ["mention", "ada.bsky.social"],
    ["link", "https://example.com/some/long/path?x=1"],
    ["tag", "DenoLand"],
    ["tag", "été"],
  ]);
  // "Café ☕ with " is 4 + 1 (é) + 1 + 3 (☕) + 6 = 15 bytes for 12 characters.
  assertEquals(segments[0].byteStart, 15);
  for (const s of segments) {
    const shown = slice(text, s.byteStart, s.byteEnd);
    if (s.kind === "mention") assertEquals(shown, `@${s.value}`);
    if (s.kind === "tag") assertEquals(shown, `#${s.value}`);
    if (s.kind === "link") assertEquals(shown, "example.com/some/long/pa...");
  }
  const facets = toFacets(segments, new Map([["ada.bsky.social", "did:plc:ada"]]));
  assertEquals(facets[0], {
    index: { byteStart: 15, byteEnd: 31 },
    features: [{ $type: "app.bsky.richtext.facet#mention", did: "did:plc:ada" }],
  });
  assertEquals(facets[1].features, [{
    $type: "app.bsky.richtext.facet#link",
    uri: "https://example.com/some/long/path?x=1",
  }]);
  // An unresolved mention stays text.
  assertEquals(toFacets(segments).filter((f) => f.features[0].$type.endsWith("#mention")), []);
});

Deno.test("rich text: no mention without a domain, nor inside a link or an email", () => {
  const { segments } = richText(
    "mail ada@example.com, ping @bob, see https://x.org/@carol.example.com and @dan.example.org.",
  );
  assertEquals(segments.map((s) => [s.kind, s.value]), [
    ["link", "https://x.org/@carol.example.com"],
    ["mention", "dan.example.org"],
  ]);
  assertEquals(richText("#123 only digits").segments, []);
  assertEquals(
    richText("unshortened https://example.com/some/long/path", { shorten: false }).text,
    "unshortened https://example.com/some/long/path",
  );
});

Deno.test("links are expanded back from facets", () => {
  const { text, segments } = richText("é https://example.com/some/long/path?x=1 end");
  assertEquals(expandLinks(text, toFacets(segments)), "é https://example.com/some/long/path?x=1 end");
  assertEquals(expandLinks("plain"), "plain");
});

Deno.test("counts for both networks", () => {
  const long = "x".repeat(320);
  assertEquals(counts(long, ["mastodon", "bluesky"]).map((c) => [c.network, c.used, c.over]), [
    ["mastodon", 320, false],
    ["bluesky", 320, true],
  ]);
});

Deno.test("settings", () => {
  assertEquals(normalizeInstance("mastodon.social"), "https://mastodon.social");
  assertEquals(normalizeInstance("@ada@fosstodon.org"), "https://fosstodon.org");
  assertEquals(normalizeInstance("https://mastodon.social/home"), "https://mastodon.social");
  assertEquals(normalizeInstance(""), "");
  assertEquals(normalizeHandle(" @Ada.Bsky.Social "), "ada.bsky.social");
  assertEquals(normalizeHandle("did:plc:AbC"), "did:plc:AbC");
  assertEquals(normalizeService("bsky.social/"), "https://bsky.social");
  assertEquals(normalizeService(""), "https://bsky.social");
  assertEquals(parseVisibility("Followers only"), "private");
  assertEquals(parseVisibility("unlisted"), "unlisted");
  assertEquals(parseVisibility("whatever"), "public");
  assertEquals(
    pdsEndpoint({
      service: [{
        id: "#atproto_pds",
        type: "AtprotoPersonalDataServer",
        serviceEndpoint: "https://morel.us-east.host.bsky.network/",
      }],
    }),
    "https://morel.us-east.host.bsky.network",
  );
  assertEquals(pdsEndpoint(undefined), undefined);
});

const STATUS: MastodonStatus = {
  id: "111",
  created_at: "2026-10-29T10:00:00.000Z",
  content: "<p>outer</p>",
  account: { id: "1", acct: "bob", display_name: "Bob" },
  reblog: {
    id: "222",
    created_at: "2026-10-29T09:00:00.000Z",
    content: "<p>Hello &amp; welcome</p>",
    url: "https://other.example/@ada/999",
    spoiler_text: "",
    visibility: "public",
    account: {
      id: "2",
      acct: "ada@other.example",
      display_name: "",
      username: "ada",
      avatar_static: "https://cdn/a.png",
    },
    replies_count: 1,
    reblogs_count: 2,
    favourites_count: 3,
    favourited: true,
    reblogged: false,
    media_attachments: [{
      type: "image",
      url: "https://cdn/p.jpg",
      preview_url: "https://cdn/p_small.jpg",
      description: "A cat",
    }],
  },
};

Deno.test("mastodon statuses: boosts show the original", () => {
  const p = fromMastodon(STATUS, "https://mastodon.social");
  assertEquals(p.id, "222");
  assertEquals(p.url, "https://mastodon.social/@ada@other.example/222");
  assertEquals(p.originalUrl, "https://other.example/@ada/999");
  assertEquals(p.author, { name: "ada", handle: "@ada@other.example", avatar: "https://cdn/a.png" });
  assertEquals(p.text, "Hello & welcome");
  assertEquals(p.boostedBy, "Bob");
  assertEquals([p.replies, p.boosts, p.likes, p.liked, p.boosted], [1, 2, 3, true, false]);
  assertEquals(p.media[0], {
    kind: "image",
    url: "https://cdn/p.jpg",
    preview: "https://cdn/p_small.jpg",
    alt: "A cat",
  });
  assertEquals(replyPrefix(p), "@ada@other.example ");
  assertEquals(replyPrefix(p, "ada@other.example"), "");
  const n = fromMastodonNotification(
    { id: "5", type: "favourite", created_at: "2026-10-29T11:00:00Z", account: STATUS.account, status: STATUS.reblog },
    "https://mastodon.social",
  );
  assertEquals(n.kind, "like");
  assertEquals(noticeTitle(n), "Bob liked your post");
});

const BSKY_POST: BskyPostView = {
  uri: "at://did:plc:ada/app.bsky.feed.post/3kabc",
  cid: "bafy1",
  author: { did: "did:plc:ada", handle: "ada.bsky.social", displayName: "Ada" },
  record: {
    text: "Root post example.com/x",
    createdAt: "2026-10-29T08:00:00.000Z",
    facets: [{
      index: { byteStart: 10, byteEnd: 23 },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: "https://example.com/x" }],
    }],
  },
  embed: {
    $type: "app.bsky.embed.images#view",
    images: [{ thumb: "https://cdn/t.jpg", fullsize: "https://cdn/f.jpg", alt: "Sky" }],
  },
  replyCount: 4,
  repostCount: 5,
  likeCount: 6,
  viewer: { like: "at://did:plc:me/app.bsky.feed.like/3klike" },
};

Deno.test("bluesky posts", () => {
  const p = fromBluesky({
    post: BSKY_POST,
    reason: { $type: "app.bsky.feed.defs#reasonRepost", by: { did: "x", handle: "bob.test" } },
  });
  assertEquals(p.url, "https://bsky.app/profile/ada.bsky.social/post/3kabc");
  assertEquals(p.text, "Root post https://example.com/x");
  assertEquals(p.boostedBy, "bob.test");
  assertEquals(p.liked, true);
  assertEquals(p.likeUri, "at://did:plc:me/app.bsky.feed.like/3klike");
  assertEquals(p.ref, { uri: BSKY_POST.uri, cid: "bafy1" });
  // A top-level post is its own thread root; a reply keeps its root.
  assertEquals(p.root, p.ref);
  const reply = fromBluesky({
    post: {
      ...BSKY_POST,
      record: {
        ...BSKY_POST.record,
        reply: { root: { uri: "at://r", cid: "c" }, parent: { uri: "at://p", cid: "d" } },
      },
    },
  });
  assertEquals(reply.root, { uri: "at://r", cid: "c" });
  assertEquals(p.media[0].kind, "image");
  assertEquals(rkey(BSKY_POST.uri), "3kabc");
});

Deno.test("bluesky notifications: likes of the same post are grouped", () => {
  const author = (h: string) => ({ did: `did:plc:${h}`, handle: `${h}.test`, displayName: h.toUpperCase() });
  const list: BskyNotification[] = [
    {
      uri: "at://1",
      cid: "c1",
      author: author("bob"),
      reason: "like",
      reasonSubject: BSKY_POST.uri,
      isRead: false,
      indexedAt: "2026-10-29T10:00:00Z",
    },
    {
      uri: "at://2",
      cid: "c2",
      author: author("carol"),
      reason: "like",
      reasonSubject: BSKY_POST.uri,
      isRead: true,
      indexedAt: "2026-10-29T09:00:00Z",
    },
    {
      uri: "at://3",
      cid: "c3",
      author: author("dan"),
      reason: "reply",
      reasonSubject: BSKY_POST.uri,
      record: { text: "Nice!" },
      isRead: true,
      indexedAt: "2026-10-29T08:00:00Z",
    },
    {
      uri: "at://4",
      cid: "c4",
      author: author("eve"),
      reason: "follow",
      isRead: true,
      indexedAt: "2026-10-29T07:00:00Z",
    },
  ];
  assertEquals(subjectUris(list), [BSKY_POST.uri]);
  const notices = fromBlueskyNotifications(list, new Map([[BSKY_POST.uri, BSKY_POST]]));
  assertEquals(notices.length, 3);
  assertEquals(noticeTitle(notices[0]), "BOB and CAROL liked your post");
  assertEquals(notices[0].unread, true);
  assertEquals(notices[0].text, "Root post https://example.com/x");
  assertEquals(notices[1].kind, "reply");
  assertEquals(notices[1].text, "Nice!");
  assertEquals(notices[1].post?.ref, { uri: "at://3", cid: "c3" });
  assertEquals(notices[2].url, "https://bsky.app/profile/eve.test");
});

Deno.test("small formatting", () => {
  assertEquals(people([{ name: "A" }, { name: "B" }, { name: "C" }]), "A and 2 others");
  assertEquals(compact(999), "999");
  assertEquals(compact(1234), "1.2K");
  assertEquals(compact(25_000), "25K");
  assertEquals(compact(1_500_000), "1.5M");
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(age(now - 30_000, now), "now");
  assertEquals(age(now - 3 * 3600_000, now), "3h");
});

Deno.test("asCompleted yields in settling order", async () => {
  const later = new Promise<string>((r) => setTimeout(() => r("slow"), 20));
  const out: string[] = [];
  for await (const v of asCompleted([later, Promise.resolve("fast")])) out.push(v);
  assertEquals(out, ["fast", "slow"]);
});
