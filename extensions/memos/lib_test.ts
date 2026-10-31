import { assert, assertEquals, assertInstanceOf, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  age,
  apiError,
  decodeEntities,
  fromMemo,
  fromTrilium,
  HOSTS,
  htmlToMarkdown,
  isAllowedHost,
  isMine,
  isUserNote,
  matches,
  type Memo,
  memoUid,
  normalizeUrl,
  noteTitle,
  parentChoice,
  SetupError,
  setupItem,
  sortNotes,
  tagsIn,
  textToHtml,
  titleOf,
  triliumDate,
  type TriliumNote,
  triliumQuery,
  userName,
} from "./lib.ts";

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("memos.lan"));
  assert(isAllowedHost("localhost"));
  assert(isAllowedHost("10.1.2.3"));
  assert(isAllowedHost("nas.tail1234.ts.net"));
  assert(!isAllowedHost("memos.example.com"));
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("memos.lan:5230/explore"), "http://memos.lan:5230");
  assertEquals(normalizeUrl("http://192.168.1.20:8080/etapi"), "http://192.168.1.20:8080");
  assertEquals(normalizeUrl("https://nas.lan/memos/m/abc"), "https://nas.lan/memos");
  assertEquals(normalizeUrl("http://localhost:37840/"), "http://localhost:37840");
  assertEquals(normalizeUrl(" "), "");
});

Deno.test("tags and titles", () => {
  assertEquals(tagsIn("Call Ada #work and #home/garden. `#notatag` [x](http://a.b/#anchor) #été"), [
    "work",
    "home/garden",
    "été",
  ]);
  assertEquals(tagsIn("# Heading\n## Two"), []);
  assertEquals(titleOf("## Groceries\n- milk"), "Groceries");
  assertEquals(titleOf("- [ ] Call **Ada** about [the demo](https://x.y)"), "Call Ada about the demo");
  assertEquals(titleOf("```\ncode\n```"), "code");
  assertEquals(titleOf("\n\n"), "Untitled memo");
  assertEquals(titleOf("x".repeat(200), 10), "xxxxxxxxx…");
  assertEquals(noteTitle("Buy milk #home #errands"), "Buy milk");
  assertEquals(noteTitle("  "), "Quick note");
});

// GET /api/v1/memos (Memos 0.24)
const memo: Memo = {
  name: "memos/ZK3qLzVjY8p7Q2nW",
  uid: "ZK3qLzVjY8p7Q2nW",
  creator: "users/1",
  createTime: "2026-10-29T08:00:00Z",
  updateTime: "2026-10-30T09:30:00Z",
  displayTime: "2026-10-29T08:00:00Z",
  content: "Ideas for the talk #work\n\n- [ ] outline\n- [x] title",
  visibility: "PRIVATE",
  pinned: true,
  tags: ["work"],
  state: "NORMAL",
  property: { hasIncompleteTasks: true },
};

Deno.test("memos", () => {
  const n = fromMemo(memo, "http://memos.lan:5230");
  assertEquals(n.title, "Ideas for the talk #work");
  assertEquals(n.url, "http://memos.lan:5230/m/ZK3qLzVjY8p7Q2nW");
  assertEquals(n.tags, ["work"]);
  assertEquals(n.pinned, true);
  assertEquals(n.openTasks, true);
  // 0.22: numeric names, tags in property, rowStatus.
  const old = fromMemo({ name: "memos/42", content: "Hello #a", property: { tags: ["a"] } }, "http://m");
  assertEquals(old.url, "http://m/m/42");
  assertEquals(old.tags, ["a"]);
  assertEquals(memoUid({ name: "memos/42" }), "42");
  // No tags field at all: read them from the text.
  assertEquals(fromMemo({ name: "memos/x", content: "a #b c #d" }, "http://m").tags, ["b", "d"]);
  assert(isMine(memo, "users/1"));
  assert(!isMine(memo, "users/2"));
  assert(isMine(memo, undefined));
  assert(!isMine({ ...memo, state: "ARCHIVED" }, "users/1"));
  assert(!isMine({ ...memo, state: undefined, rowStatus: "ARCHIVED" }, "users/1"));
  assertEquals(userName({ name: "users/1", username: "steven" }), "users/1");
  assertEquals(userName({ user: { name: "users/7" }, lastAccessedAt: "…" }), "users/7");
  assertEquals(userName({ code: 16, message: "unauthenticated" }), undefined);
});

// GET /etapi/notes?search=… and /etapi/notes/{id}/content
const note: TriliumNote = {
  noteId: "Ab12Cd34Ef56",
  title: "Reading list",
  type: "text",
  mime: "text/html",
  isProtected: false,
  attributes: [
    { attributeId: "attr1", noteId: "Ab12Cd34Ef56", type: "label", name: "bookmarked", value: "" },
    { attributeId: "attr2", noteId: "Ab12Cd34Ef56", type: "label", name: "topic", value: "books" },
    { attributeId: "attr3", noteId: "Ab12Cd34Ef56", type: "label", name: "iconClass", value: "bx bx-book" },
    { attributeId: "attr4", noteId: "Ab12Cd34Ef56", type: "relation", name: "template", value: "xyz" },
  ],
  dateCreated: "2026-10-01 10:00:00.000+0200",
  dateModified: "2026-10-30 14:02:11.123+0200",
  utcDateCreated: "2026-10-01 08:00:00.000Z",
  utcDateModified: "2026-10-30 12:02:11.123Z",
};

const HTML =
  `<h2>Books &amp; papers</h2><p>Start with <strong>SICP</strong>, then <em>TAoCP</em>.<br>See <a href="https://mitpress.mit.edu/sicp">the site</a> and <a href="#root/xyz">this note</a>.</p>
<ul><li>Dune</li><li>Hyperion&nbsp;cantos</li></ul>
<ul class="todo-list"><li><label class="todo-list__label"><input type="checkbox" disabled="disabled" checked="checked"><span class="todo-list__label__description">Read</span></label></li><li><label class="todo-list__label"><input type="checkbox" disabled="disabled"><span class="todo-list__label__description">Review</span></label></li></ul>
<blockquote><p>Programs must be written for people to read.</p></blockquote>
<pre><code class="language-text-x-python">def f(x):
    return x &lt; 2</code></pre><p><img src="api/images/abc/x.png" alt="cover"></p>`;

Deno.test("Trilium HTML as Markdown", () => {
  const md = htmlToMarkdown(HTML);
  assertStringIncludes(md, "## Books & papers");
  assertStringIncludes(
    md,
    "Start with **SICP**, then _TAoCP_.\nSee [the site](https://mitpress.mit.edu/sicp) and this note.",
  );
  assertStringIncludes(md, "- Dune\n- Hyperion cantos");
  assertStringIncludes(md, "- [x] Read\n- [ ] Review");
  assertStringIncludes(md, "> Programs must be written for people to read.");
  assertStringIncludes(md, "```\ndef f(x):\n    return x < 2\n```");
  assertStringIncludes(md, "[image: cover]");
  assert(!/<\/?[a-z]+[ >]/.test(md));
  assertEquals(decodeEntities("&lt;a&gt; &#233;t&#xE9; &unknown;"), "<a> été &unknown;");
  assertEquals(textToHtml("Line <1>\nline 2\n\nPara & more"), "<p>Line &lt;1&gt;<br>line 2</p><p>Para &amp; more</p>");
});

Deno.test("Trilium notes", () => {
  const n = fromTrilium(note, "http://trilium.lan:8080", HTML);
  assertEquals(n.pinned, true);
  assertEquals(n.bookmarkAttributeId, "attr1");
  assertEquals(n.tags, ["topic=books"]);
  assertEquals(n.url, "http://trilium.lan:8080/#root/Ab12Cd34Ef56");
  assertEquals(n.updated, "2026-10-30T12:02:11.123Z");
  assertStringIncludes(n.body, "**SICP**");
  assertStringIncludes(fromTrilium({ ...note, isProtected: true }, "http://t", HTML).body, "protected");
  assertEquals(fromTrilium({ ...note, type: "code" }, "http://t", "let x = 1;").body, "```\nlet x = 1;\n```");
  assertEquals(fromTrilium({ ...note, attributes: [] }, "http://t").body, "");
  assertEquals(triliumDate("2026-10-30 14:02:11.123+0200"), "2026-10-30T12:02:11.123Z");
  assertEquals(triliumDate("2026-10-30 12:02:11.123Z"), "2026-10-30T12:02:11.123Z");
  assertEquals(triliumDate("nonsense"), undefined);
  assert(isUserNote(note));
  assert(!isUserNote({ ...note, noteId: "_hidden" }));
  assert(!isUserNote({ ...note, noteId: "root" }));
  assertEquals(triliumQuery("  sicp "), { search: "sicp", orderBy: "dateModified" });
  assertEquals(triliumQuery("").search, "note.dateModified >= MONTH-3");
});

Deno.test("where new Trilium notes go", () => {
  assertEquals(parentChoice(""), { kind: "inbox" });
  assertEquals(parentChoice("Inbox"), { kind: "inbox" });
  assertEquals(parentChoice("today"), { kind: "today" });
  assertEquals(parentChoice("Xy12Ab34"), { kind: "note", id: "Xy12Ab34" });
  assertEquals(parentChoice("http://trilium.lan/#root/abc/Xy12Ab34"), { kind: "note", id: "Xy12Ab34" });
});

Deno.test("search, order, ages", () => {
  const a = fromMemo(memo, "http://m");
  const b = fromMemo({
    ...memo,
    name: "memos/b",
    pinned: false,
    content: "Café crème #food",
    tags: ["food"],
    updateTime: "2026-10-31T00:00:00Z",
  }, "http://m");
  const c = fromTrilium({ ...note, attributes: [] }, "http://t", HTML);
  assert(matches(b, "cafe"));
  assert(matches(b, "#food creme"));
  assert(!matches(b, "tea"));
  assert(matches(c, "sicp dune"));
  assertEquals(sortNotes([c, b, a]).map((n) => n.id), ["memos/ZK3qLzVjY8p7Q2nW", "memos/b", "Ab12Cd34Ef56"]);
  const now = Date.parse("2026-10-31T12:00:00Z");
  assertEquals(age("2026-10-31T08:00:00Z", now), "today");
  assertEquals(age("2026-10-21T08:00:00Z", now), "10d");
  assertEquals(age(undefined, now), "");
});

Deno.test("errors", () => {
  assertInstanceOf(apiError("memos", 401, { code: 16, message: "unauthenticated" }), SetupError);
  assertEquals(
    apiError("trilium", 400, {
      status: 400,
      code: "SEARCH_QUERY_PARAM_MANDATORY",
      message: "Search query is mandatory",
    }).message,
    "Trilium answered 400: Search query is mandatory",
  );
  assertEquals(apiError("memos", 404, {}).message, "Not found on Memos: it may have been deleted");
  assertStringIncludes(setupItem(new SetupError("x")).detail!.markdown!, "ETAPI");
});
