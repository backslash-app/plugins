import { assertEquals } from "@std/assert";
import {
  ago,
  apiUrl,
  byUpdated,
  descendants,
  type Folder,
  folderPaths,
  markdownLink,
  openNoteUrl,
  parseTags,
  previewBody,
  searchQuery,
  snippet,
  todoState,
  wordCount,
} from "./lib.ts";
import { noteItem } from "./joplin.ts";

const FOLDERS: Folder[] = [
  { id: "w", title: "Work", parent_id: "" },
  { id: "p", title: "Projects", parent_id: "w" },
  { id: "a", title: "Alpha", parent_id: "p" },
  { id: "h", title: "home", parent_id: "" },
  { id: "o", title: "Orphan", parent_id: "deleted-parent" },
];

Deno.test("API URLs carry the token and skip empty params", () => {
  assertEquals(
    apiUrl("/search", { query: "a b*", type: "note", page: undefined, limit: 10 }, "tok"),
    "http://127.0.0.1:41184/search?query=a+b*&type=note&limit=10&token=tok",
  );
});

Deno.test("search as you type", () => {
  assertEquals(searchQuery("  meeting   proj "), "meeting proj*");
  assertEquals(searchQuery("tag:work"), "tag:work");
  assertEquals(searchQuery('"exact phrase"'), '"exact phrase"');
  assertEquals(searchQuery("ide*"), "ide*");
  assertEquals(searchQuery("recipe -cake"), "recipe -cake");
  assertEquals(searchQuery(""), "");
});

Deno.test("notebook paths in tree order, and what is inside one", () => {
  assertEquals(folderPaths(FOLDERS), [
    { id: "h", path: "home", depth: 0 },
    { id: "o", path: "Orphan", depth: 0 },
    { id: "w", path: "Work", depth: 0 },
    { id: "p", path: "Work / Projects", depth: 1 },
    { id: "a", path: "Work / Projects / Alpha", depth: 2 },
  ]);
  assertEquals([...descendants(FOLDERS, "w")].sort(), ["a", "p", "w"]);
  assertEquals([...descendants(FOLDERS, "h")], ["h"]);
  // A cycle (corrupted sync) doesn't hang.
  folderPaths([{ id: "x", title: "X", parent_id: "y" }, { id: "y", title: "Y", parent_id: "x" }]);
});

Deno.test("links", () => {
  assertEquals(markdownLink({ id: "0123abcd", title: "Plan [v2]" }), "[Plan \\[v2\\]](:/0123abcd)");
  assertEquals(markdownLink({ id: "1", title: "" }), "[Untitled](:/1)");
  assertEquals(openNoteUrl("abc"), "joplin://x-callback-url/openNote?id=abc");
});

Deno.test("preview: resources become captions, internal links their text", () => {
  const id = "0123456789abcdef0123456789abcdef";
  const body =
    `# Trip\n\n![map](:/${id})\n<img src=":/${id}" width="200"/>\nSee [packing list](:/${id}#top) and [site](https://x.org).`;
  assertEquals(
    previewBody(body),
    "# Trip\n\n*[image: map]*\n*[image]*\nSee **packing list** and [site](https://x.org).",
  );
  assertEquals(previewBody("word ".repeat(50), 22), "word word word word\n\n…");
});

Deno.test("snippet, words, tags", () => {
  assertEquals(snippet("\n\n# Heading\nbody"), "Heading");
  assertEquals(snippet("- [ ] **Buy** [milk](https://shop) ![x](:/1)"), "Buy milk");
  assertEquals(snippet(undefined), "");
  assertEquals(snippet("a".repeat(100), 10), "aaaaaaaaa…");
  assertEquals(wordCount("Hello, world — 42 !"), 3);
  assertEquals(parseTags("Work, ideas #Later,, work"), ["work", "ideas", "later"]);
});

Deno.test("to-do states and times", () => {
  const now = 1_800_000_000_000;
  assertEquals(todoState({ id: "1", parent_id: "", title: "", is_todo: 0 }, now), "note");
  assertEquals(todoState({ id: "1", parent_id: "", title: "", is_todo: 1 }, now), "open");
  assertEquals(todoState({ id: "1", parent_id: "", title: "", is_todo: 1, todo_due: now - 1 }, now), "overdue");
  assertEquals(todoState({ id: "1", parent_id: "", title: "", is_todo: 1, todo_completed: now }, now), "done");
  assertEquals(ago(now - 30_000, now), "just now");
  assertEquals(ago(now - 5 * 3_600_000, now), "5h ago");
  assertEquals(ago(now - 3 * 86_400_000, now), "3d ago");
  assertEquals(ago(undefined, now), "");
  assertEquals(
    byUpdated([{ id: "a", parent_id: "", title: "", updated_time: 1 }, {
      id: "b",
      parent_id: "",
      title: "",
      updated_time: 2,
    }])
      .map((n) => n.id),
    ["b", "a"],
  );
});

Deno.test("note item", () => {
  const client = { token: "t", get: () => Promise.reject(), send: () => Promise.reject() };
  const item = noteItem(client, {
    note: {
      id: "n1",
      parent_id: "a",
      title: "Kickoff",
      body: "## Agenda\n- scope",
      updated_time: Date.now(),
      is_todo: 1,
    },
    notebook: "Work / Projects / Alpha",
    tags: ["meeting"],
  });
  assertEquals(item.subtitle, "Agenda");
  assertEquals(item.icon, { source: "bs-square", tint: "orange" });
  assertEquals(item.accessories?.map((a) => a.text ?? a.tag), ["meeting", "Alpha", "just now"]);
  assertEquals(item.actions?.map((a) => a.title).slice(0, 4), [
    "Open in Joplin",
    "View Note",
    "Mark as Done",
    "Copy Markdown Link",
  ]);
});
