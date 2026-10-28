import { assertEquals, assertThrows } from "@std/assert";
import type { Context } from "@backslash/api";
import { AuthError, guarded } from "./api.ts";
import {
  appUrl,
  type Block,
  blocksToMarkdown,
  type Database,
  databaseFields,
  iconOf,
  type Page,
  parentName,
  parseDate,
  propertiesFrom,
  propertyText,
  resultItem,
  richToMarkdown,
  textToBlocks,
  titleOf,
  titlesOf,
} from "./lib.ts";

const ctx: Context = { args: {}, preferences: { token: "ntn_x" }, query: "", signal: new AbortController().signal };

const text = (s: string, extra = {}) => ({ type: "text", plain_text: s, href: null, ...extra });

// Shaped like `POST /v1/search` results (Notion-Version 2022-06-28).
const db: Database = {
  object: "database",
  id: "668d797c-76fa-4934-9b05-ad288df2d136",
  url: "https://www.notion.so/668d797c76fa49349b05ad288df2d136",
  created_time: "2026-09-01T10:00:00.000Z",
  last_edited_time: "2026-10-27T09:00:00.000Z",
  icon: { type: "external", external: { url: "https://www.notion.so/icons/clipping_gray.svg" } },
  parent: { type: "workspace", workspace: true },
  title: [text("Reading List")],
  is_inline: false,
  properties: {
    Status: { id: "a", name: "Status", type: "status", status: { options: [{ name: "To read" }, { name: "Done" }] } },
    Name: { id: "title", name: "Name", type: "title" },
    Tags: {
      id: "b",
      name: "Tags",
      type: "multi_select",
      multi_select: { options: [{ name: "Rust" }, { name: "Design" }] },
    },
    Pages: { id: "c", name: "Pages", type: "number" },
    Read: { id: "d", name: "Read", type: "checkbox" },
    Due: { id: "e", name: "Due", type: "date" },
    Author: { id: "f", name: "Author", type: "people" },
  },
};

const page: Page = {
  object: "page",
  id: "59833787-2cf9-4fdf-8782-e53db20768a5",
  url: "https://www.notion.so/Designing-Data-Intensive-Applications-598337872cf94fdf8782e53db20768a5",
  created_time: "2026-10-01T10:00:00.000Z",
  last_edited_time: "2026-10-27T08:00:00.000Z",
  icon: { type: "emoji", emoji: "📘" },
  parent: { type: "database_id", database_id: db.id },
  properties: {
    Name: { id: "title", type: "title", title: [text("Designing Data-Intensive Applications")] },
    Status: { id: "a", type: "status", status: { name: "To read", color: "blue" } },
    Tags: { id: "b", type: "multi_select", multi_select: [{ name: "Databases" }, { name: "Systems" }] },
    Pages: { id: "c", type: "number", number: 616 },
    Due: { id: "e", type: "date", date: { start: "2026-11-15", end: null } },
    Author: { id: "f", type: "people", people: [{ object: "user", id: "u", name: "Ada" }] },
  },
};

Deno.test("titles, icons, parents and links", () => {
  assertEquals([titleOf(page), titleOf(db)], ["Designing Data-Intensive Applications", "Reading List"]);
  assertEquals(iconOf(page), "📘");
  assertEquals(iconOf(db), { source: "bs-layers", tint: "blue" });
  assertEquals(iconOf({ ...page, icon: null }), { source: "bs-file", tint: "gray" });
  const titles = titlesOf([page, db]);
  assertEquals([parentName(page, titles), parentName(db, titles), parentName(page, new Map())], [
    "Reading List",
    "Workspace",
    "Database",
  ]);
  assertEquals(appUrl(page.url).startsWith("notion://www.notion.so/Designing"), true);
});

Deno.test("property values as text", () => {
  const p = page.properties;
  assertEquals([
    propertyText(p.Status),
    propertyText(p.Tags),
    propertyText(p.Pages),
    propertyText(p.Due),
    propertyText(p.Author),
  ], [
    "To read",
    "Databases, Systems",
    "616",
    "2026-11-15",
    "Ada",
  ]);
  assertEquals(propertyText({ id: "x", type: "rich_text", rich_text: [] }), undefined);
});

Deno.test("rich text and blocks to Markdown", () => {
  assertEquals(
    richToMarkdown([
      text("Read "),
      text("chapter 5", { annotations: { bold: true } }),
      text(" on "),
      text("replication", { href: "https://example.com", annotations: { italic: true } }),
    ]),
    "Read **chapter 5** on [_replication_](https://example.com)",
  );
  const blocks: Block[] = [
    { id: "1", type: "heading_2", heading_2: { rich_text: [text("Notes")] } },
    { id: "2", type: "paragraph", paragraph: { rich_text: [text("Leaders and followers.")] } },
    { id: "3", type: "bulleted_list_item", bulleted_list_item: { rich_text: [text("Sync")] } },
    { id: "4", type: "bulleted_list_item", bulleted_list_item: { rich_text: [text("Async")] } },
    { id: "5", type: "to_do", to_do: { rich_text: [text("Summarize")], checked: true } },
    { id: "6", type: "numbered_list_item", numbered_list_item: { rich_text: [text("One")] } },
    { id: "7", type: "numbered_list_item", numbered_list_item: { rich_text: [text("Two")] } },
    { id: "8", type: "code", code: { rich_text: [text("SELECT 1;")], language: "sql" } },
    { id: "9", type: "divider", divider: {} },
    { id: "10", type: "child_page", child_page: { title: "Chapter 6" } },
  ];
  assertEquals(
    blocksToMarkdown(blocks),
    "## Notes\n\nLeaders and followers.\n\n- Sync\n- Async\n- [x] Summarize\n1. One\n2. Two\n\n```sql\nSELECT 1;\n```\n\n---\n\n📄 **Chapter 6**",
  );
});

Deno.test("text to blocks", () => {
  assertEquals(textToBlocks("Hello\n\nWorld").map((b) => b.paragraph.rich_text[0].text.content), ["Hello", "World"]);
  const todos = textToBlocks("Buy milk\n\nCall Bob\n", "to_do");
  assertEquals(todos.map((b) => [b.type, b.to_do.rich_text[0].text.content, b.to_do.checked]), [
    ["to_do", "Buy milk", false],
    ["to_do", "Call Bob", false],
  ]);
  assertEquals(textToBlocks("x".repeat(4500))[0].paragraph.rich_text.length, 3);
  assertEquals(textToBlocks("   "), []);
});

Deno.test("dates", () => {
  const now = new Date(2026, 9, 27, 10, 0);
  assertEquals(
    [parseDate("today", now), parseDate("Tomorrow", now), parseDate("2026-12-01", now), parseDate("", now)],
    [
      { start: "2026-10-27" },
      { start: "2026-10-28" },
      { start: "2026-12-01" },
      undefined,
    ],
  );
  assertThrows(() => parseDate("next week", now));
});

Deno.test("database form: fields and properties", () => {
  const fields = databaseFields(db);
  assertEquals(fields.map((f) => [f.title, f.kind]), [
    ["Name", "text"],
    ["Status", "dropdown"],
    ["Tags", "text"],
    ["Pages", "text"],
    ["Read", "checkbox"],
    ["Due", "text"],
  ]);
  assertEquals(fields[0].required, true);
  const props = propertiesFrom(db, { p0: "SICP", p1: "Done", p2: "Lisp, Classics", p3: "657", p4: true, p5: "" });
  assertEquals(props, {
    Name: { title: [{ type: "text", text: { content: "SICP" } }] },
    Status: { status: { name: "Done" } },
    Tags: { multi_select: [{ name: "Lisp" }, { name: "Classics" }] },
    Pages: { number: 657 },
    Read: { checkbox: true },
  });
  assertThrows(() => propertiesFrom(db, { p0: "x", p3: "many" }));
});

Deno.test("result items", () => {
  const titles = titlesOf([page, db]);
  const p = resultItem(page, ctx, titles);
  assertEquals([p.title, p.subtitle, p.icon], ["Designing Data-Intensive Applications", "Reading List", "📘"]);
  assertEquals(p.actions?.map((a) => a.title).slice(0, 4), [
    "Open in Browser",
    "Open in Notion App",
    "Show Content",
    "Add to Page",
  ]);
  assertEquals(p.detail?.metadata?.slice(3, 7).map((m) => [m.label, m.value]), [
    ["Status", "To read"],
    ["Tags", "Databases, Systems"],
    ["Pages", "616"],
    ["Due", "2026-11-15"],
  ]);
  const d = resultItem(db, ctx, titles);
  assertEquals(d.accessories?.[0], { tag: "Database", color: "blue" });
  assertEquals(d.actions?.[2].title, "Create Page in Database");
});

Deno.test("a rejected secret becomes a setup row", async () => {
  const items = await guarded(() => Promise.reject(new AuthError("Notion rejected the integration secret")));
  assertEquals([items[0].id, items[0].actions?.[0].title], ["setup", "Create Integration"]);
});
