import { assert, assertEquals } from "@std/assert";
import {
  ageSection,
  checklist,
  expandHome,
  fileNameFor,
  firstLine,
  frontmatterTags,
  inlineTags,
  matchScore,
  parseNote,
  serialize,
  sortNotes,
  splitFrontmatter,
  tildify,
  titleFromText,
  uniqueFileName,
  wordCount,
} from "./lib.ts";
import { loadNotes, noteItem, saveNote } from "./notes.ts";

Deno.test("file names from titles", () => {
  assertEquals(fileNameFor("Groceries"), "Groceries.md");
  assertEquals(fileNameFor("Groceries / week 3?"), "Groceries - week 3.md");
  assertEquals(fileNameFor("  ..hidden  "), "hidden.md");
  assertEquals(fileNameFor("a:b|c"), "a-b-c.md");
  assertEquals(fileNameFor("#tag [x]"), "tag x.md");
  assertEquals(fileNameFor(""), "Untitled.md");
  assertEquals(fileNameFor("Réunion d'équipe"), "Réunion d'équipe.md");
  assertEquals(uniqueFileName("Ideas.md", ["ideas.md", "Ideas 2.md"]), "Ideas 3.md");
  assertEquals(uniqueFileName("Ideas.md", ["Other.md"]), "Ideas.md");
  assertEquals(uniqueFileName("Ideas.md", ["Ideas.md"], "Ideas.md"), "Ideas.md"); // renaming to itself
});

Deno.test("frontmatter and tags", () => {
  const text = '---\ntitle: X\ntags: [work, "urgent"]\n---\nHello #home and #2026-plan, not `#code` nor # heading\n';
  const { frontmatter, body } = splitFrontmatter(text);
  assertEquals(frontmatter, '---\ntitle: X\ntags: [work, "urgent"]\n---\n');
  assert(body.startsWith("Hello"));
  assertEquals(frontmatterTags(frontmatter), ["work", "urgent"]);
  assertEquals(frontmatterTags("---\ntags:\n  - a\n  - '#b'\nother: 1\n---\n"), ["a", "b"]);
  assertEquals(frontmatterTags("---\ntags: a, b\n---\n"), ["a", "b"]);
  assertEquals(inlineTags(body), ["home", "2026-plan"]);
  assertEquals(inlineTags("#123 is not a tag, #été is"), ["été"]);
  const note = parseNote("Plan.md", text, 5);
  assertEquals(note.title, "Plan");
  assertEquals(note.tags, ["work", "urgent", "home", "2026-plan"]);
  assertEquals(note.created, 5);
  assertEquals(serialize(note), text);
  assertEquals(serialize({ body: "a\r\nb\n\n\n" }), "a\nb\n");
});

Deno.test("subtitles, counts and checklists", () => {
  assertEquals(firstLine("\n\n# Heading\ntext"), "Heading");
  assertEquals(firstLine("- [ ] **buy** milk"), "buy milk");
  assertEquals(firstLine(""), "");
  assertEquals(wordCount("Hello, world! C'est l'été."), 4);
  assertEquals(checklist("- [x] a\n- [ ] b\n  * [X] c\n[ ] no"), { done: 2, total: 3 });
  assertEquals(titleFromText("Call the bank"), "Call the bank");
  assertEquals(titleFromText("# Title\nbody"), "Title");
  assertEquals(titleFromText("Call the bank #todo #home"), "Call the bank");
  const long = titleFromText("This is a very long note that goes on and on about many different things", 40);
  assert(long.endsWith("…") && long.length <= 41, long);
});

Deno.test("sections, matching and order", () => {
  const now = new Date(2026, 9, 28, 15, 0);
  const at = (d: number, h = 12) => new Date(2026, 9, d, h).getTime();
  assertEquals(
    [at(28, 9), at(27), at(24), at(5), at(1) - 40 * 86_400_000].map((t) => ageSection(t, now)),
    ["Today", "Yesterday", "This Week", "This Month", "Older"],
  );
  const a = parseNote("Groceries.md", "milk, eggs #home", at(20));
  const b = parseNote("Ideas.md", "Groceries app idea", at(27));
  const c = parseNote("Work.md", "standup", at(28));
  assert(matchScore(a, "groc") > matchScore(b, "groc"));
  assert(matchScore(b, "groceries app") > 0);
  assertEquals(matchScore(c, "groceries"), 0);
  assert(matchScore(a, "#home") > 0);
  assert(matchScore(a, "Grôceries") > 0);
  assertEquals(sortNotes([a, b, c], ["Groceries.md"]).map((n) => n.file), ["Groceries.md", "Work.md", "Ideas.md"]);
});

Deno.test("paths", () => {
  assertEquals(expandHome("~/Documents/Notes", "/home/ada"), "/home/ada/Documents/Notes");
  assertEquals(expandHome("/srv/notes", "/home/ada"), "/srv/notes");
  assertEquals(tildify("/home/ada/Documents/Notes", "/home/ada"), "~/Documents/Notes");
});

Deno.test("saving, renaming and loading notes on disk", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const f1 = await saveNote(dir, { title: "Groceries", body: "- [ ] milk\n- [x] eggs" });
    assertEquals(f1, "Groceries.md");
    assertEquals(await Deno.readTextFile(`${dir}/Groceries.md`), "- [ ] milk\n- [x] eggs\n");
    const f2 = await saveNote(dir, { title: "Groceries", body: "other" });
    assertEquals(f2, "Groceries 2.md");
    // Keep the frontmatter, rename the file with the title.
    await Deno.writeTextFile(`${dir}/Plan.md`, "---\ntags: [work]\n---\nold\n");
    const plan = (await loadNotes(dir)).find((n) => n.file === "Plan.md")!;
    const f3 = await saveNote(dir, { title: "Plan 2027", body: "new" }, plan);
    assertEquals(f3, "Plan 2027.md");
    assertEquals(await Deno.readTextFile(`${dir}/Plan 2027.md`), "---\ntags: [work]\n---\nnew\n");
    const notes = await loadNotes(dir);
    assertEquals(notes.map((n) => n.file).sort(), ["Groceries 2.md", "Groceries.md", "Plan 2027.md"]);
    const item = noteItem(notes.find((n) => n.file === "Groceries.md")!, dir, true, "Pinned");
    assertEquals(item.icon, { source: "bs-pin", tint: "yellow" });
    assertEquals(item.accessories?.[0].text, "1/2");
    assertEquals(item.actions?.slice(0, 3).map((a) => a.title), ["Edit Note", "Copy Note", "Paste Note"]);
    assertEquals(await loadNotes(`${dir}/missing`), []);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
