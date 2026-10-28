import { assert, assertEquals } from "@std/assert";
import {
  appendUri,
  backlinkCounts,
  captureLine,
  dailyNotePath,
  firstLine,
  formatMoment,
  inlineTags,
  isoWeek,
  linkTargets,
  mergeVaults,
  noteAliases,
  noteTags,
  obsidianUri,
  openUri,
  parseDailyConfig,
  parseVaults,
  parseYamlish,
  pickVault,
  previewMarkdown,
  score,
  skipDir,
  snippet,
  splitFrontmatter,
} from "./lib.ts";
import { indexVault, noteItem } from "./vault.ts";

const CONFIG = JSON.stringify({
  vaults: {
    a1: { path: "/home/ada/Notes/Work", ts: 100 },
    b2: { path: "/home/ada/Sync/Personal/", ts: 300, open: true },
    c3: { path: "/home/ada/Old", ts: 200 },
    d4: { ts: 5 },
  },
});

Deno.test("vaults from obsidian.json", () => {
  const vaults = parseVaults(CONFIG);
  assertEquals(vaults.map((v) => v.name), ["Personal", "Old", "Work"]);
  assertEquals(vaults[0].path, "/home/ada/Sync/Personal");
  assertEquals(parseVaults("not json"), []);
  assertEquals(pickVault(vaults, "work")?.name, "Work");
  assertEquals(pickVault(vaults, "")?.name, "Personal");
  assertEquals(pickVault(vaults, "nope")?.name, "Personal");
  const flatpak = parseVaults(JSON.stringify({ vaults: { x: { path: "/home/ada/Notes/Work", ts: 999 } } }));
  assertEquals(mergeVaults([vaults, flatpak]).map((v) => v.name), ["Personal", "Work", "Old"]);
});

Deno.test("frontmatter, tags and aliases", () => {
  const text = [
    "---",
    "title: Design review",
    "tags: [project, 'meeting']",
    "aliases:",
    "  - DR",
    "  - Review",
    "status: draft",
    "nested:",
    "  key: value",
    "---",
    "Notes for #team/design and #2026 not #42, `#code` too.",
    "```",
    "#not-a-tag",
    "```",
  ].join("\n");
  const { frontmatter, body } = splitFrontmatter(text);
  assertEquals(frontmatter.fields.title, "Design review");
  assertEquals(frontmatter.fields.status, "draft");
  assertEquals(noteAliases(frontmatter), ["DR", "Review"]);
  assertEquals(noteTags(frontmatter, body), ["project", "meeting", "team/design"]);
  assertEquals(parseYamlish("tags: a, b\n# comment\nempty:\n"), { tags: "a, b", empty: [] });
  assertEquals(noteTags(splitFrontmatter("---\ntags: a b\n---\n").frontmatter, ""), ["a", "b"]);
  assertEquals(splitFrontmatter("no frontmatter").body, "no frontmatter");
  assertEquals(inlineTags("(#inline) and#not"), ["inline"]);
});

Deno.test("links and backlinks", () => {
  const body = "See [[Project X]], [[folder/Meeting|the meeting]], [[Note#Heading]], ![[diagram.png]] " +
    "and [md](Other%20Note.md) but not [web](https://x.com/a.md)";
  assertEquals(linkTargets(body), ["project x", "folder/meeting", "note", "diagram.png", "other note"]);
  const counts = backlinkCounts([
    { path: "Project X.md", links: ["meeting"] },
    { path: "folder/Meeting.md", links: ["project x"] },
    { path: "Daily/2026-10-28.md", links: ["project x", "project x", "folder/meeting"] },
    { path: "Other/Meeting.md", links: [] },
  ]);
  assertEquals(counts.get("Project X.md"), 2); // counted once per linking note
  assertEquals(counts.get("folder/Meeting.md"), 2); // by name from Project X, by path from the daily note
  assertEquals(counts.get("Other/Meeting.md"), 1); // [[Meeting]] matches every note named so
});

Deno.test("preview and first line", () => {
  assertEquals(
    previewMarkdown("Go to [[Page|this page]] and [[Other#Part]] ==now== %%hidden%%"),
    "Go to **this page** and **Other › Part** **now**",
  );
  assertEquals(previewMarkdown("> [!warning] Careful"), "> **Warning:** Careful");
  assertEquals(previewMarkdown("![[img.png]]"), "_(embedded: img.png)_");
  assertEquals(previewMarkdown(""), "_Empty note._");
  assertEquals(firstLine("\n## Plan\n"), "Plan");
  assertEquals(firstLine("- [ ] call [[Bob|Robert]]"), "call Robert");
});

Deno.test("search scoring and snippets", () => {
  const note = (title: string, content = "", tags: string[] = [], aliases: string[] = []) => ({
    title,
    path: `x/${title}.md`,
    tags,
    aliases,
    content,
  });
  const exact = score(note("Design review"), "design review");
  const prefix = score(note("Design system"), "design");
  const alias = score(note("DR-2", "", [], ["Design meeting"]), "design");
  const text = score(note("Weekly", "we talked about design"), "design");
  assert(exact > prefix && prefix > alias && alias > text && text > 0);
  assert(score(note("Weekly", "", ["design"]), "#design") > 0);
  assertEquals(score(note("Weekly", "nothing"), "design"), 0);
  assert(score(note("Réunion"), "reunion") > 0);
  assertEquals(
    snippet("A long text where the important word appears once.", "important"),
    "A long text where the important word appears once.",
  );
  assertEquals(snippet("# Launch\nPlan with [[Ideas|ideas]] ==soon==", "plan"), "Launch Plan with ideas soon");
  assert(snippet("x ".repeat(50) + "needle " + "y ".repeat(50), "needle")!.startsWith("…"));
});

Deno.test("daily notes in moment.js format", () => {
  const d = new Date(2026, 9, 28, 14, 5); // Wednesday 28 October 2026
  assertEquals(formatMoment(d, "YYYY-MM-DD"), "2026-10-28");
  assertEquals(formatMoment(d, "dddd, MMMM Do YYYY"), "Wednesday, October 28th YYYY".replace("YYYY", "2026"));
  assertEquals(formatMoment(d, "DD.MM.YY ddd"), "28.10.26 Wed");
  assertEquals(formatMoment(d, "[Week] W [of] GGGG"), "Week 44 of 2026");
  assertEquals(formatMoment(new Date(2026, 0, 1), "D/M Do"), "1/1 1st");
  assertEquals(formatMoment(new Date(2026, 0, 12), "Do"), "12th");
  assertEquals(formatMoment(new Date(2026, 0, 22), "Do"), "22nd");
  assertEquals(isoWeek(new Date(2027, 0, 1)), { week: 53, year: 2026 });
  assertEquals(parseDailyConfig(undefined), { folder: "", format: "YYYY-MM-DD" });
  const cfg = parseDailyConfig('{"folder":"/Journal/Daily/","format":"YYYY/MM/YYYY-MM-DD","template":"T"}');
  assertEquals(dailyNotePath(cfg, d), "Journal/Daily/2026/10/2026-10-28.md");
  assertEquals(dailyNotePath(parseDailyConfig('{"format":""}'), d), "2026-10-28.md");
});

Deno.test("obsidian:// URIs", () => {
  assertEquals(openUri("My Vault", "Folder/Note é.md"), "obsidian://open?vault=My%20Vault&file=Folder%2FNote%20%C3%A9");
  assertEquals(
    appendUri("V", "Inbox", "- 14:05 buy milk & eggs"),
    "obsidian://new?vault=V&file=Inbox&content=-%2014%3A05%20buy%20milk%20%26%20eggs&append=true&silent=true",
  );
  assertEquals(obsidianUri("daily", { vault: "V", x: undefined, y: false }), "obsidian://daily?vault=V");
  assertEquals(captureLine(" buy\nmilk ", new Date(2026, 9, 28, 9, 7), true), "- 09:07 buy milk");
  assertEquals(captureLine("idea", new Date(), false), "- idea");
  assert(skipDir(".obsidian") && skipDir(".trash") && skipDir("node_modules") && !skipDir("Projects"));
});

Deno.test("indexing a vault on disk", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/.obsidian`);
    await Deno.mkdir(`${root}/.trash`);
    await Deno.mkdir(`${root}/Projects`);
    await Deno.writeTextFile(`${root}/.obsidian/x.md`, "skip");
    await Deno.writeTextFile(`${root}/.trash/Deleted.md`, "skip");
    await Deno.writeTextFile(`${root}/Projects/Launch.md`, "---\ntags: [work]\n---\n# Launch\nPlan with [[Ideas]]");
    await Deno.writeTextFile(`${root}/Ideas.md`, "Some #idea for [[Launch]] and [[Launch|again]]");
    await Deno.writeTextFile(`${root}/image.png`, "");
    const vault = { id: "v", name: "Test", path: root, ts: 0, open: true };
    const notes = await indexVault(vault, 0);
    assertEquals(notes.map((n) => n.path).sort(), ["Ideas.md", "Projects/Launch.md"]);
    const launch = notes.find((n) => n.title === "Launch")!;
    assertEquals([launch.tags, launch.backlinks, launch.links], [["work"], 1, ["ideas"]]);
    const item = noteItem(launch, { several: false, section: "Notes" });
    assertEquals(item.subtitle, "Launch");
    assertEquals(item.actions?.[0].title, "Open in Obsidian");
    assertEquals((item.actions?.[0] as { target: string }).target, "obsidian://open?vault=Test&file=Projects%2FLaunch");
    assertEquals(item.detail?.metadata?.map((m) => m.label).slice(0, 2), ["Folder", "Tags"]);
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
