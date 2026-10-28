import { assert, assertEquals } from "@std/assert";
import {
  appendBlock,
  backlinkCounts,
  blockUri,
  DEFAULT_CONFIG,
  formatDate,
  graphFromCacheFile,
  listProperty,
  ordinal,
  pageNameFromFile,
  pageUri,
  parseConfig,
  parseJournalFile,
  parsePage,
  plain,
  previewMarkdown,
  references,
  score,
  taskMarker,
} from "./lib.ts";
import { pickGraph } from "./graph.ts";

const PAGE = `title:: Project Alpha
tags:: [[project]], work
alias:: Alpha
status:: active

- Kickoff with [[Bob Smith]] #meeting
  id:: 6720f1b2-1c3d-4e5f-8a9b-0c1d2e3f4a5b
  collapsed:: true
	- TODO Write the brief
	  SCHEDULED: <2026-10-30 Fri>
	- DONE Book the room #[[Meeting Rooms]]
- Notes
  continued on a second line
  \`\`\`js
  - not a block:: really
  \`\`\`
-
`;

Deno.test("graphs from Logseq's cache files", () => {
  assertEquals(graphFromCacheFile("logseq_local_++home++me++Documents++notes.transit"), {
    name: "notes",
    path: "/home/me/Documents/notes",
  });
  assertEquals(graphFromCacheFile("logseq_local_C:++Users++me++notes.transit"), undefined);
  assertEquals(graphFromCacheFile("logseq_local_++home++me++notes++.transit")?.path, "/home/me/notes");
  assertEquals(graphFromCacheFile("something.json"), undefined);
});

Deno.test("config.edn keys, comments ignored", () => {
  const edn = `{:meta/version 1
 ;; :journal/page-title-format "yyyy-MM-dd"
 :journal/page-title-format "EEE, dd.MM.yyyy"
 :journal/file-name-format "yyyy-MM-dd"
 :preferred-format :markdown
 :file/name-format :triple-lowbar
 :journals-directory "daily"}`;
  assertEquals(parseConfig(edn), {
    journalTitle: "EEE, dd.MM.yyyy",
    journalFile: "yyyy-MM-dd",
    pagesDir: "pages",
    journalsDir: "daily",
    tripleLowbar: true,
    org: false,
  });
  assertEquals(parseConfig(undefined), DEFAULT_CONFIG);
  assertEquals(parseConfig(`{:preferred-format "Org"}`).org, true);
});

Deno.test("journal dates", () => {
  const d = new Date(2026, 9, 28);
  assertEquals(formatDate("MMM do, yyyy", d), "Oct 28th, 2026");
  assertEquals(formatDate("yyyy_MM_dd", d), "2026_10_28");
  assertEquals(formatDate("EEEE, MMMM d, yyyy", new Date(2026, 0, 1)), "Thursday, January 1, 2026");
  assertEquals(formatDate("EEE, dd.MM.yy", new Date(2026, 1, 3)), "Tue, 03.02.26");
  assertEquals(formatDate("do 'of' MMMM", new Date(2026, 4, 22)), "22nd of May");
  assertEquals(
    [1, 2, 3, 4, 11, 12, 13, 21, 22, 23].map(ordinal).join(" "),
    "1st 2nd 3rd 4th 11th 12th 13th 21st 22nd 23rd",
  );
  assertEquals(parseJournalFile("2026_10_28", "yyyy_MM_dd")?.getDate(), 28);
  assertEquals(parseJournalFile("2026-02-30", "yyyy-MM-dd"), undefined);
  assertEquals(parseJournalFile("notes", "yyyy_MM_dd"), undefined);
});

Deno.test("page names from files", () => {
  assertEquals(pageNameFromFile("projects___alpha", true), "projects/alpha");
  assertEquals(pageNameFromFile("projects%2Falpha", false), "projects/alpha");
  assertEquals(pageNameFromFile("What%3F", false), "What?");
  assertEquals(pageNameFromFile("100% sure", false), "100% sure");
  assertEquals(pageUri("my notes", "Oct 28th, 2026"), "logseq://graph/my%20notes?page=Oct%2028th%2C%202026");
  assertEquals(blockUri("notes", "abc"), "logseq://graph/notes?block-id=abc");
});

Deno.test("the outline: page properties, blocks, block properties, code", () => {
  const page = parsePage(PAGE);
  assertEquals(page.properties, {
    title: "Project Alpha",
    tags: "[[project]], work",
    alias: "Alpha",
    status: "active",
  });
  assertEquals(page.blocks.map((b) => [b.depth, b.content]), [
    [0, "Kickoff with [[Bob Smith]] #meeting"],
    [1, "TODO Write the brief\nSCHEDULED: <2026-10-30 Fri>"],
    [1, "DONE Book the room #[[Meeting Rooms]]"],
    [0, "Notes\ncontinued on a second line\n```js\n- not a block:: really\n```"],
  ]);
  assertEquals(page.blocks[0].id, "6720f1b2-1c3d-4e5f-8a9b-0c1d2e3f4a5b");
  assertEquals(page.blocks[0].properties.collapsed, "true");
  // Page properties in a first bullet, as Logseq writes them in some versions.
  const bulleted = parsePage("- tags:: a, b\n  type:: book\n- First block\n");
  assertEquals(bulleted.properties, { tags: "a, b", type: "book" });
  assertEquals(bulleted.blocks.map((b) => b.content), ["First block"]);
  // A file without bullets is one block.
  assertEquals(parsePage("Just text\n").blocks.map((b) => b.content), ["Just text"]);
  assertEquals(parsePage("").blocks, []);
});

Deno.test("references, list properties and backlinks", () => {
  assertEquals(references("See [[Bob Smith]] and #meeting, #[[Meeting Rooms]] `#not` [[bob smith]]"), [
    "bob smith",
    "meeting rooms",
    "meeting",
  ]);
  assertEquals(references("C# and issue#12 and https://x.org/#anchor"), []);
  assertEquals(listProperty("[[project]], work, #later"), ["project", "work", "later"]);
  const alpha = { name: "Project Alpha", page: parsePage(PAGE), aliases: ["Alpha"] };
  const journal = {
    name: "Oct 28th, 2026",
    page: parsePage("- Met [[Alpha]] team\n- [[Project Alpha]] again #meeting\n"),
  };
  const counts = backlinkCounts([alpha, journal, { name: "Project", page: parsePage("- [[project]] self ref") }]);
  assertEquals(counts.get("project alpha"), 2); // via its alias, and by name
  assertEquals(counts.get("meeting"), 2);
  assertEquals(counts.get("project"), 1); // tags:: of Project Alpha; its own self-reference doesn't count
  assertEquals(counts.get("bob smith"), 1);
});

Deno.test("readable text and previews", () => {
  assertEquals(
    plain("TODO Call [[Bob Smith]] about **the** ((6720f1b2-1c3d-4e5f-8a9b-0c1d2e3f4a5b)) {{embed [[x]]}}"),
    "Call Bob Smith about the …",
  );
  assertEquals(taskMarker("DONE x"), "DONE");
  assertEquals(taskMarker("TODOS x"), undefined);
  const md = previewMarkdown(parsePage(PAGE));
  assert(md.startsWith("- Kickoff with **Bob Smith** #meeting\n  - [ ] Write the brief\n    SCHEDULED"));
  assert(md.includes("  - [x] Book the room"));
});

Deno.test("capturing a block", () => {
  assertEquals(appendBlock("", "Call the bank"), "- Call the bank\n");
  assertEquals(appendBlock("-\n", "Call the bank"), "- Call the bank\n"); // Logseq's empty new journal
  assertEquals(appendBlock("- one", "two"), "- one\n- two\n");
  assertEquals(appendBlock("- one\n\n\n", "two\nmore", { time: "14:05" }), "- one\n- 14:05 two\n  more\n");
  assertEquals(appendBlock("* one\n", "two", { org: true }), "* one\n* two\n");
});

Deno.test("search scoring", () => {
  assertEquals(score("Project Alpha", "alp"), 3);
  assertEquals(score("Project Alpha", "pha"), 1);
  assertEquals(score("Project Alpha", "proj alp"), 6);
  assertEquals(score("Project Alpha", "beta"), 0);
  assertEquals(score("Café notes", "cafe"), 3);
});

Deno.test("the graph for journal and captures", () => {
  const graphs = [{ name: "work", path: "/h/Logseq/work", used: 2 }, { name: "notes", path: "/h/notes", used: 1 }];
  assertEquals(pickGraph(graphs, { preferences: {} })?.name, "work");
  assertEquals(pickGraph(graphs, { preferences: { graph: "Notes" } })?.name, "notes");
  assertEquals(pickGraph(graphs, { preferences: { graph: "/h/notes/" } })?.name, "notes");
  assertEquals(pickGraph(graphs, { preferences: { graph: "missing" } })?.name, "work");
  assertEquals(pickGraph([], { preferences: {} }), undefined);
});
