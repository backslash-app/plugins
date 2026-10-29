import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  allowedImage,
  bookmarkMarkdown,
  chooseBackend,
  collectionPaths,
  fromLinkding,
  fromLinkwarden,
  HOSTS,
  isAllowedHost,
  linkdingBody,
  linkdingSearch,
  linkIn,
  linkwardenBody,
  linkwardenSearch,
  normalizeUrl,
  parseTags,
  sameUrl,
  savedAgo,
} from "./lib.ts";

Deno.test("chooseBackend", () => {
  assertEquals(chooseBackend({ backend: "Linkwarden" }), "linkwarden");
  assertEquals(chooseBackend({ url: "https://linkwarden.home.lan" }), "linkwarden");
  assertEquals(chooseBackend({ url: "links.lan" }), "linkding");
  assertEquals(chooseBackend({}), undefined);
  assertEquals(chooseBackend({ backend: "shaarli" }), undefined);
});

Deno.test("links and tags typed by the user", () => {
  assertEquals(linkIn("https://deno.com/blog)."), "https://deno.com/blog");
  assertEquals(linkIn("Read this: https://a.example/x?y=1 now"), "https://a.example/x?y=1");
  assertEquals(linkIn("example.com/page"), "https://example.com/page");
  assertEquals(linkIn("rust async"), undefined);
  assertEquals(linkIn("#rust"), undefined);
  assertEquals(parseTags("rust, web dev, #cli, rust"), ["rust", "web dev", "cli"]);
  assertEquals(parseTags("#rust #cli"), ["rust", "cli"]);
  assertEquals(parseTags("web dev, ops", false), ["web-dev", "ops"]);
  assertEquals(parseTags(""), []);
  assert(sameUrl("https://www.example.com/a/", "http://example.com/a"));
  assert(!sameUrl("https://example.com/a", "https://example.com/b"));
});

Deno.test("Linkding bookmarks and requests", () => {
  const b = fromLinkding({
    id: 12,
    url: "https://docs.deno.com/runtime/",
    title: "",
    description: "",
    website_title: "Deno Runtime",
    website_description: "Docs",
    notes: "  ",
    favicon_url: "http://links.lan/static/favicon.png",
    preview_image_url: null,
    is_archived: false,
    unread: true,
    tag_names: ["deno", "docs"],
    date_added: "2026-10-01T10:00:00Z",
  });
  assertEquals(b.id, "12");
  assertEquals(b.title, "Deno Runtime");
  assertEquals(b.description, "Docs");
  assertEquals(b.notes, undefined);
  assertEquals(b.unread, true);
  assertEquals(b.preview, undefined);
  assertEquals(linkdingSearch("", "all"), "/api/bookmarks/?limit=100");
  assertEquals(linkdingSearch("#rust async", "unread"), "/api/bookmarks/?limit=100&q=%23rust+async+%21unread");
  assertEquals(linkdingSearch("x", "archived", 5), "/api/bookmarks/archived/?limit=5&q=x");
  assertEquals(linkdingBody({ url: "https://a.example", tags: ["web dev"] }), {
    url: "https://a.example",
    tag_names: ["web-dev"],
  });
  assertEquals(linkdingBody({ url: "u", title: "T", unread: true }), {
    url: "u",
    title: "T",
    tag_names: [],
    unread: true,
  });
  assertEquals(bookmarkMarkdown(b), "### Deno Runtime\n\nDocs");
});

Deno.test("Linkwarden links, collections and requests", () => {
  const l = fromLinkwarden({
    id: 5,
    name: "",
    url: "https://www.rust-lang.org/learn",
    description: "Learn Rust",
    collectionId: 2,
    tags: [{ id: 1, name: "rust" }],
    pinnedBy: [{ id: 1 }],
    createdAt: "2026-10-20T08:00:00.000Z",
    readable: "archives/2/5_readability.json",
  });
  assertEquals(l.title, "rust-lang.org");
  assertEquals(l.tags, ["rust"]);
  assertEquals(l.pinned, true);
  assertEquals(l.readable, true);
  assertEquals(l.collection, { id: "2", name: "" });
  assertEquals(fromLinkwarden({ id: 1, url: "u", createdAt: "", readable: "unavailable" }).readable, false);
  assertEquals(linkwardenSearch("", "all"), "sort=0");
  assertEquals(
    linkwardenSearch("#rust book", "pinned"),
    "sort=0&searchQueryString=rust+book&searchByName=true&searchByUrl=true&searchByDescription=true&searchByTags=true&pinnedOnly=true",
  );
  assertEquals(linkwardenBody({ url: "u", tags: ["a b"], collectionId: "3" }), {
    url: "u",
    tags: [{ name: "a b" }],
    collection: { id: 3 },
  });
  assertEquals(
    collectionPaths([
      { id: 1, name: "Dev", parentId: null, _count: { links: 4 } },
      { id: 2, name: "Rust", parentId: 1 },
      { id: 3, name: "articles" },
    ]),
    [
      { id: "3", name: "articles", count: 0 },
      { id: "1", name: "Dev", count: 4 },
      { id: "2", name: "Dev › Rust", count: 0 },
    ],
  );
});

Deno.test("savedAgo", () => {
  const now = new Date(2026, 9, 29, 12);
  assertEquals(savedAgo(new Date(2026, 9, 29, 8).toISOString(), now), "today");
  assertEquals(savedAgo(new Date(2026, 9, 28, 23).toISOString(), now), "yesterday");
  assertEquals(savedAgo(new Date(2026, 9, 25).toISOString(), now), "4d");
  assertEquals(savedAgo(new Date(2026, 2, 3).toISOString(), now), "Mar 3");
  assertEquals(savedAgo(new Date(2024, 2, 3).toISOString(), now), "Mar 2024");
  assertEquals(savedAgo(undefined, now), "");
});

Deno.test("hosts: the manifest's, server addresses and pictures", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("cloud.linkwarden.app"));
  assert(isAllowedHost("links.home.arpa"));
  assert(isAllowedHost("172.20.0.4"));
  assert(!isAllowedHost("links.example.com"));
  assertEquals(normalizeUrl("links.lan:9090/bookmarks"), "http://links.lan:9090");
  assertEquals(normalizeUrl("cloud.linkwarden.app/dashboard"), "https://cloud.linkwarden.app");
  assertEquals(normalizeUrl("http://192.168.1.4/api/"), "http://192.168.1.4");
  assertEquals(allowedImage("/static/x.png", "http://links.lan"), "http://links.lan/static/x.png");
  assertEquals(allowedImage("https://icons.example.com/x.png", "http://links.lan"), undefined);
});
