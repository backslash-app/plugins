import { assertEquals, assertInstanceOf, assertStringIncludes, assertThrows } from "@std/assert";
import {
  AuthError,
  bookmarkMarkdown,
  bookmarkMetadata,
  type Collection,
  collectionName,
  coverUrl,
  domainOf,
  filterOptions,
  folders,
  linkIn,
  parseTags,
  type Raindrop,
  raindropError,
  savedAgo,
  setupItem,
  tokenOf,
  typeOf,
} from "./lib.ts";

Deno.test("token and errors", () => {
  assertThrows(() => tokenOf({}), AuthError, "Connect");
  assertEquals(tokenOf({ token: " ae2e3f-123 " }), "ae2e3f-123");
  assertInstanceOf(raindropError(401, { result: false, errorMessage: "Unauthorized" }), AuthError);
  assertEquals(
    raindropError(400, { result: false, errorMessage: "link is required" }).message,
    "Raindrop.io answered 400: link is required",
  );
  assertStringIncludes(setupItem(new AuthError("x")).detail!.markdown!, "Create test token");
});

const roots: Collection[] = [
  { _id: 10, title: "Dev", count: 120, sort: 1, color: "#3f88ff" },
  { _id: 20, title: "Recipes", count: 40, sort: 0, color: "#e44a4a" },
  { _id: 30, title: "Travel", count: 3, sort: 2 },
];
const children: Collection[] = [
  { _id: 11, title: "Rust", count: 30, parent: { $id: 10 }, sort: 1 },
  { _id: 12, title: "TypeScript", count: 25, parent: { $id: 10 }, sort: 0 },
  { _id: 13, title: "Async", count: 4, parent: { $id: 11 } },
];

Deno.test("collections as paths, chips", () => {
  const all = folders(roots, children);
  assertEquals(all.map((f) => f.path), [
    "Recipes",
    "Dev",
    "Dev › TypeScript",
    "Dev › Rust",
    "Dev › Rust › Async",
    "Travel",
  ]);
  assertEquals(all.find((f) => f.id === 20)?.color, "red");
  assertEquals(collectionName(13, all), "Dev › Rust › Async");
  assertEquals(collectionName(-1, all), "Unsorted");
  assertEquals(collectionName(-99, all), "Trash");
  assertEquals(filterOptions(all, 2).map((o) => o.title), ["All", "Unsorted", "Dev", "Recipes"]);
  assertEquals(filterOptions(all, 2).map((o) => o.value), ["0", "-1", "10", "20"]);
});

Deno.test("covers go through Raindrop's proxy", () => {
  assertEquals(
    coverUrl("https://images.example.com/og.png?x=1", 640, 360),
    "https://rdl.ink/render/https%3A%2F%2Fimages.example.com%2Fog.png%3Fx%3D1?mode=crop&width=640&height=360&dpr=2",
  );
  assertEquals(coverUrl("https://rdl.ink/render/abc?mode=crop"), "https://rdl.ink/render/abc?mode=crop");
  assertEquals(coverUrl(""), undefined);
  assertEquals(coverUrl("data:image/png;base64,xx"), undefined);
});

Deno.test("links typed in the search field", () => {
  assertEquals(linkIn("https://deno.com/blog"), "https://deno.com/blog");
  assertEquals(linkIn("  deno.com/blog/v2  "), "https://deno.com/blog/v2");
  assertEquals(linkIn("example.org"), "https://example.org/");
  assertEquals(linkIn("rust async"), undefined);
  assertEquals(linkIn("#rust"), undefined);
  assertEquals(linkIn("type:article"), undefined);
  assertEquals(linkIn("http://localhost"), undefined);
  assertEquals(linkIn(""), undefined);
});

Deno.test("tags, dates, types, domains", () => {
  assertEquals(parseTags("reading, #rust  design,rust"), ["reading", "rust", "design"]);
  assertEquals(parseTags(""), []);
  const now = new Date(2026, 9, 27, 14);
  assertEquals(savedAgo(new Date(2026, 9, 27, 9).toISOString(), now), "today");
  assertEquals(savedAgo(new Date(2026, 9, 26, 9).toISOString(), now), "yesterday");
  assertEquals(savedAgo(new Date(2026, 9, 22).toISOString(), now), "5d");
  assertEquals(savedAgo(new Date(2026, 1, 3).toISOString(), now), "Feb 3");
  assertEquals(savedAgo(new Date(2024, 1, 3).toISOString(), now), "Feb 2024");
  assertEquals(typeOf({ _id: 1, title: "", link: "", type: "video" }).name, "Video");
  assertEquals(typeOf({ _id: 1, title: "", link: "", type: "weird" }).name, "Link");
  assertEquals(domainOf({ _id: 1, title: "", link: "https://www.example.com/a" }), "example.com");
  assertEquals(domainOf({ _id: 1, title: "", link: "x", domain: "www.deno.com" }), "deno.com");
});

Deno.test("bookmark detail", () => {
  const all = folders(roots, children);
  const r: Raindrop = {
    _id: 1,
    title: "Async Rust",
    link: "https://rust-lang.github.io/async-book/",
    domain: "rust-lang.github.io",
    excerpt: "The async book.",
    note: "Read chapter 3\nthen 4",
    tags: ["rust", "async"],
    type: "article",
    important: true,
    collection: { $id: 13 },
    created: new Date().toISOString(),
    highlights: [{ text: "Futures are lazy" }, { text: "a" }, { text: "b" }, { text: "c" }],
  };
  assertEquals(
    bookmarkMarkdown(r),
    "The async book.\n\n> Read chapter 3\n> then 4\n\n**Highlights**\n\n- “Futures are lazy”\n- “a”\n- “b”\n- …and 1 more",
  );
  const lines = bookmarkMetadata(r, all);
  const by = (label: string) => lines.find((l) => l.label === label);
  assertEquals(by("Link")?.link, r.link);
  assertEquals(by("Collection")?.value, "Dev › Rust › Async");
  assertEquals(by("Tags")?.tags?.map((t) => t.text), ["#rust", "#async"]);
  assertEquals(by("Type")?.value, "Article");
  assertEquals(by("Favorite")?.value, "Yes");
  assertEquals(by("Highlights")?.value, "4");
  assertEquals(bookmarkMarkdown({ _id: 2, title: "", link: "" }), undefined);
});
