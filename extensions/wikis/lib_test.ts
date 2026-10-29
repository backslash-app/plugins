import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  age,
  basicAuth,
  bookStackContent,
  byUpdated,
  cleanOutline,
  configured,
  confluenceContent,
  confluenceCql,
  confluenceSite,
  fromBookStack,
  fromBookStackPage,
  fromConfluence,
  fromOutline,
  fromWikiJs,
  graphqlError,
  HOSTS,
  htmlToMarkdown,
  incomplete,
  interleave,
  isAllowedHost,
  normalizeUrl,
  type Page,
  snippet,
  storageToHtml,
  wikiJsContent,
} from "./lib.ts";

Deno.test("configured: any subset, complete ones only", () => {
  assertEquals(configured({}), {});
  const c = configured({
    outlineToken: " ol_api_x ",
    bookstackUrl: "wiki.lan",
    bookstackTokenId: "id",
    wikijsUrl: "http://wikijs:3000/en/home",
    wikijsToken: "jwt",
    confluenceUrl: "acme",
    confluenceEmail: "me@acme.com",
    confluenceToken: "tok",
  });
  assertEquals(c.outline, { base: "https://app.getoutline.com", token: "ol_api_x" });
  assertEquals(c.bookstack, undefined, "no secret");
  assertEquals(c.wikijs, { base: "http://wikijs:3000", token: "jwt" });
  assertEquals(c.confluence?.base, "https://acme.atlassian.net");
  assertEquals(incomplete({ bookstackUrl: "wiki.lan", wikijsToken: "x", outlineUrl: "o.lan" }), [
    "Outline needs an API key",
    "BookStack needs its address, token ID and token secret",
    "Wiki.js needs its address and an API key",
  ]);
  assertEquals(confluenceSite("https://acme.atlassian.net/wiki/spaces/ENG"), "https://acme.atlassian.net");
  assertEquals(basicAuth("me@acme.com", "tok"), `Basic ${btoa("me@acme.com:tok")}`);
  assertEquals(basicAuth("é", "x"), "Basic w6k6eA==");
});

Deno.test("snippets and merging", () => {
  assertEquals(
    snippet("Deploy with <b>Docker</b> &amp; compose_file"),
    "Deploy with **Docker** & compose\\_file",
  );
  assertEquals(snippet("The @@@hl@@@release@@@endhl@@@ process…"), "The **release** process…");
  assertEquals(snippet(""), undefined);
  const p = (wiki: Page["wiki"], id: string, updated?: string): Page => ({
    wiki,
    id,
    title: id,
    url: `https://x/${id}`,
    tags: [],
    updated,
  });
  assertEquals(
    interleave([[p("outline", "a"), p("outline", "b"), p("outline", "c")], [p("bookstack", "x")], []]).map((x) => x.id),
    ["a", "x", "b", "c"],
  );
  assertEquals(
    byUpdated([p("outline", "old", "2026-01-01"), p("outline", "none"), p("wikijs", "new", "2026-10-01")])
      .map((x) => x.id),
    ["new", "old", "none"],
  );
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(age("2026-10-29T09:00:00Z", now), "3h");
  assertEquals(age("2026-10-19T12:00:00Z", now), "10d");
  assertEquals(age(undefined, now), "");
});

Deno.test("Outline", () => {
  const page = fromOutline(
    {
      id: "d1",
      title: "Onboarding",
      url: "/doc/onboarding-abc123",
      text: "# Onboarding\n\nWelcome aboard.\n\\\nSecond line",
      updatedAt: "2026-10-20T10:00:00Z",
      updatedBy: { name: "Ada" },
      collectionId: "c1",
    },
    "https://app.getoutline.com",
    new Map([["c1", "Handbook"]]),
  );
  assertEquals(page.url, "https://app.getoutline.com/doc/onboarding-abc123");
  assertEquals(page.container, "Handbook");
  assertEquals(page.author, "Ada");
  assertEquals(page.excerpt, "Welcome aboard. Second line");
  assertEquals(cleanOutline("a\n\\\n\nb"), "a\n\nb");
  const hit = fromOutline({ id: "d2", title: "", url: "/doc/x" }, "http://o.lan", new Map(), "a <b>match</b>");
  assertEquals(hit.title, "Untitled");
  assertEquals(hit.excerpt, "a **match**");
});

Deno.test("BookStack", () => {
  const books = new Map([[3, "Servers"]]);
  const r = fromBookStack({
    id: 7,
    name: "Backups",
    type: "page",
    url: "http://wiki.lan/books/servers/page/backups",
    book_id: 3,
    preview_html: { content: "Nightly <strong>backups</strong> with restic" },
    tags: [{ name: "ops", value: "" }, { name: "env", value: "prod" }],
  }, books);
  assertEquals(r.container, "Servers");
  assertEquals(r.excerpt, "Nightly **backups** with restic");
  assertEquals(r.tags, ["ops", "env: prod"]);
  assertEquals(
    fromBookStackPage({ id: 7, name: "B", slug: "b", book_slug: "servers" }, "http://wiki.lan", books).url,
    "http://wiki.lan/books/servers/page/b",
  );
  assertEquals(fromBookStackPage({ id: 8, name: "C" }, "http://wiki.lan", books).url, "http://wiki.lan/link/8");
  assertEquals(bookStackContent({ id: 1, name: "x", markdown: " # Hi ", html: "<p>no</p>" }, "").markdown, "# Hi");
  assertEquals(
    bookStackContent(
      { id: 1, name: "x", markdown: "", html: "<h1>Hi</h1><p>there</p>", updated_by: { name: "Bo" } },
      "",
    )
      .markdown,
    "## Hi\n\nthere",
  );
});

Deno.test("Wiki.js", () => {
  const p = fromWikiJs(
    { id: "12", title: "VPN", description: "How to connect", path: "it/vpn", locale: "en" },
    "http://wikijs:3000",
  );
  assertEquals(p.id, "en/it/vpn");
  assertEquals(p.url, "http://wikijs:3000/en/it/vpn");
  assertEquals(p.container, "it");
  assertEquals(
    wikiJsContent({ editor: "markdown", content: "# VPN\n\nUse WireGuard." }, "").markdown,
    "# VPN\n\nUse WireGuard.",
  );
  assertEquals(
    wikiJsContent({ editor: "ckeditor", content: "<p>x</p>", render: "<p>Rendered</p>" }, "").markdown,
    "Rendered",
  );
  assertEquals(graphqlError([{ message: "Forbidden" }]), "Wiki.js refused the API key: does it have read access?");
  assertEquals(graphqlError(undefined), undefined);
});

Deno.test("Confluence: CQL, results and the storage format", () => {
  assertEquals(confluenceCql(' say "hi" '), 'type = page AND text ~ "say \\"hi\\""');
  assertEquals(confluenceCql(""), "type = page ORDER BY lastmodified DESC");
  const r = fromConfluence({
    content: {
      id: "123",
      type: "page",
      title: "Release @@@hl@@@process@@@endhl@@@",
      _links: { webui: "/spaces/ENG/pages/123/Release" },
    },
    excerpt: "How we @@@hl@@@ship@@@endhl@@@",
    resultGlobalContainer: { title: "Engineering" },
    lastModified: "2026-10-01T08:00:00.000Z",
  }, "https://acme.atlassian.net");
  assertEquals(r?.title, "Release process");
  assertEquals(r?.url, "https://acme.atlassian.net/wiki/spaces/ENG/pages/123/Release");
  assertEquals(r?.container, "Engineering");
  assertEquals(r?.excerpt, "How we **ship**");
  assertEquals(fromConfluence({ title: "space" }, "x"), undefined);

  const storage = [
    "<h1>Release</h1>",
    '<p>Ask <ac:link><ri:user ri:account-id="1"/></ac:link> or read <ac:link><ri:page ri:content-title="Runbook"/></ac:link>.</p>',
    '<ac:structured-macro ac:name="info" ac:schema-version="1"><ac:rich-text-body><p>Freeze on Fridays</p></ac:rich-text-body></ac:structured-macro>',
    '<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">bash</ac:parameter><ac:plain-text-body><![CDATA[make release && echo "<done>"]]></ac:plain-text-body></ac:structured-macro>',
    '<ac:structured-macro ac:name="toc"/>',
    "<ac:task-list><ac:task><ac:task-id>1</ac:task-id><ac:task-status>complete</ac:task-status><ac:task-body>Tag</ac:task-body></ac:task>",
    "<ac:task><ac:task-id>2</ac:task-id><ac:task-status>incomplete</ac:task-status><ac:task-body>Announce</ac:task-body></ac:task></ac:task-list>",
    '<ac:image><ri:attachment ri:filename="flow.png"/></ac:image>',
  ].join("");
  assert(!storageToHtml(storage).includes("ac:"));
  assertEquals(
    confluenceContent(
      {
        title: "Release",
        body: { storage: { value: storage } },
        version: { when: "2026-10-01", by: { displayName: "Ada" } },
      },
      "https://acme.atlassian.net",
    ),
    {
      markdown: [
        "## Release",
        "Ask _@someone_ or read _Runbook_.",
        "> **Info**\n>\n> Freeze on Fridays",
        '```bash\nmake release && echo "<done>"\n```',
        "- ☑ Tag\n- ☐ Announce",
        "_\\[flow.png\\]_",
      ].join("\n\n"),
      updated: "2026-10-01",
      author: "Ada",
      tags: [],
    },
  );
  assertEquals(htmlToMarkdown("<p>a &amp; b</p>"), "a & b");
});

Deno.test("hosts: the manifest's, and wiki addresses", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("acme.atlassian.net"));
  assert(isAllowedHost("acme.getoutline.com"));
  assert(isAllowedHost("wiki.home.arpa"));
  assert(isAllowedHost("bookstack"));
  assert(!isAllowedHost("wiki.example.com"));
  assertEquals(normalizeUrl("wiki.lan:6875/books/servers"), "http://wiki.lan:6875");
  assertEquals(normalizeUrl("https://docs.example.ts.net/doc/x-1"), "https://docs.example.ts.net");
  assertEquals(normalizeUrl("http://192.168.1.9/wiki/api/"), "http://192.168.1.9/wiki");
  assertEquals(normalizeUrl(""), "");
});
