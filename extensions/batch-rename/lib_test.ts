import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  changeCase,
  checkRules,
  DEFAULT_RULES,
  describeRules,
  exifDate,
  type FileInfo,
  followRenames,
  formatDate,
  invalidName,
  newName,
  ordered,
  parseExifDates,
  parseFileList,
  planRenames,
  planRows,
  readRules,
  renameSteps,
  replaceText,
  type Rules,
  slugify,
  splitName,
  undoPlan,
} from "./lib.ts";
import { applyRows } from "./system.ts";

const rules = (r: Partial<Rules>): Rules => ({ ...DEFAULT_RULES, ...r });
const file = (path: string, more: Partial<FileInfo> = {}): FileInfo => ({ path, dir: false, ...more });
const name = (path: string, r: Partial<Rules>, n = 0, more: Partial<FileInfo> = {}) =>
  newName(file(path, more), n, rules(r)).name;

Deno.test("copied files", () => {
  assertEquals(parseFileList("copy\nfile:///home/ada/Photos/IMG%201.JPG\nfile:///home/ada/Photos/\n"), [
    "/home/ada/Photos/IMG 1.JPG",
    "/home/ada/Photos",
  ]);
});

Deno.test("names and extensions", () => {
  assertEquals(splitName("photo.jpg"), { stem: "photo", ext: "jpg" });
  assertEquals(splitName("backup.tar.gz"), { stem: "backup", ext: "tar.gz" });
  assertEquals(splitName(".bashrc"), { stem: ".bashrc", ext: "" });
  assertEquals(splitName("README"), { stem: "README", ext: "" });
  assertEquals(splitName("v1.2 notes.txt"), { stem: "v1.2 notes", ext: "txt" });
  assertEquals(splitName("my.folder", true), { stem: "my.folder", ext: "" });
});

Deno.test("find and replace", () => {
  assertEquals(
    replaceText("IMG_1234 IMG", { find: "IMG", replace: "Photo", regex: false, ignoreCase: false }),
    "Photo_1234 Photo",
  );
  assertEquals(replaceText("img_1", { find: "IMG", replace: "x", regex: false, ignoreCase: true }), "x_1");
  assertEquals(replaceText("a.b", { find: ".", replace: "$", regex: false, ignoreCase: false }), "a$b");
  assertEquals(
    replaceText("IMG_20260714_183205", {
      find: "IMG_(\\d{4})(\\d\\d)(\\d\\d)_.*",
      replace: "$1-$2-$3",
      regex: true,
      ignoreCase: false,
    }),
    "2026-07-14",
  );
  assertThrows(() => checkRules(rules({ find: "(", regex: true })), Error, "valid regular expression");
  assertThrows(() => checkRules(rules({ prefix: "a/b" })), Error, "slash");
  checkRules(rules({ find: "(", regex: false }));
});

Deno.test("case and slugs", () => {
  assertEquals(changeCase("hello WORLD-foo_bar", "title"), "Hello World-Foo_Bar");
  assertEquals(changeCase("HELLO world", "sentence"), "Hello world");
  assertEquals(changeCase("Été", "upper"), "ÉTÉ");
  assertEquals(slugify("Été 2026 — Côte d'Azur!"), "ete-2026-cote-d-azur");
  assertEquals(slugify("Straße & Æble"), "strasse-aeble");
  assertEquals(slugify("***"), "");
});

Deno.test("dates", () => {
  const d = new Date(2026, 6, 14, 18, 32, 5);
  assertEquals(formatDate(d, "YYYY-MM-DD_HH-mm-ss"), "2026-07-14_18-32-05");
  assertEquals(formatDate(d, "YYYYMMDD"), "20260714");
  assertEquals(exifDate("2026:07:14 18:32:05+02:00")?.getTime(), d.getTime());
  assertEquals(exifDate("0000:00:00 00:00:00"), undefined);
  const dates = parseExifDates(JSON.stringify([
    { SourceFile: "/p/a.jpg", DateTimeOriginal: "2026:07:14 18:32:05" },
    { SourceFile: "/p/b.mp4", CreateDate: "0000:00:00 00:00:00", MediaCreateDate: "2025:01:02 03:04:05" },
    { SourceFile: "/p/c.txt" },
  ]));
  assertEquals(dates.size, 2);
  assertEquals(dates.get("/p/b.mp4")?.getFullYear(), 2025);
  assertEquals(parseExifDates("garbage").size, 0);
});

Deno.test("the new name of a file", () => {
  assertEquals(name("/p/IMG_1234.JPG", { lowerExtension: true, case: "lower" }), "img_1234.jpg");
  assertEquals(name("/p/IMG_1234.JPG", { numbering: "prefix", start: 1, padding: 3 }, 4), "005_IMG_1234.JPG");
  assertEquals(name("/p/IMG_1234.JPG", { numbering: "replace", padding: 2, separator: "-" }, 0), "01.JPG");
  assertEquals(name("/p/a b.txt", { numbering: "suffix", separator: " " }, 9), "a b 010.txt");
  assertEquals(name("/p/a.txt", { prefix: "x-", suffix: "-y", extension: "md" }), "x-a-y.md");
  assertEquals(name("/p/Été 2026.PNG", { slugify: true, lowerExtension: true }), "ete-2026.png");
  const taken = new Date(2026, 6, 14, 18, 32, 5);
  assertEquals(name("/p/IMG.jpg", { date: "prefix" }, 0, { taken }), "2026-07-14_IMG.jpg");
  // No date taken: the date modified, flagged.
  const mtime = new Date(2025, 0, 2).getTime();
  const r = newName(file("/p/IMG.jpg", { mtime }), 0, rules({ date: "suffix", dateFormat: "YYYYMMDD" }));
  assertEquals(r, { name: "IMG_20250102.jpg", dateFromMtime: true });
  // Folders keep their dots.
  assertEquals(newName({ path: "/p/v1.2", dir: true }, 0, rules({ suffix: "-old" })).name, "v1.2-old");
});

Deno.test("numbering order", () => {
  const files = [file("/p/b10.jpg", { mtime: 3 }), file("/p/b2.jpg", { mtime: 1 }), file("/p/a.jpg", { mtime: 2 })];
  assertEquals(ordered(files, rules({ order: "name" })).map((f) => f.path), ["/p/a.jpg", "/p/b2.jpg", "/p/b10.jpg"]);
  assertEquals(ordered(files, rules({ order: "date", dateSource: "mtime" })).map((f) => f.path), [
    "/p/b2.jpg",
    "/p/a.jpg",
    "/p/b10.jpg",
  ]);
  assertEquals(ordered(files, rules({})).map((f) => f.path), files.map((f) => f.path));
});

Deno.test("conflicts", () => {
  const disk = new Set(["/p/a.txt", "/p/b.txt", "/p/taken.txt"]);
  const exists = (p: string) => disk.has(p);
  // Two files get the same name.
  const same = planRenames(
    [file("/p/a.txt"), file("/p/b.txt")],
    rules({ find: "a|b", regex: true, replace: "x" }),
    exists,
  );
  assertEquals(same.rows.map((r) => r.status), ["conflict", "conflict"]);
  assertEquals(same.conflicts, 2);
  // A file that stays keeps its name.
  const kept = planRows([{ from: "/p/a.txt", to: "/p/taken.txt" }], exists);
  assertEquals(kept.rows[0].reason, "A file with this name is already there");
  // A swap is fine: each name is freed by the other rename.
  const swap = planRows([{ from: "/p/a.txt", to: "/p/b.txt" }, { from: "/p/b.txt", to: "/p/a.txt" }], exists);
  assertEquals(swap.renames, 2);
  // A chain stops when its end is stuck.
  const chain = planRows([
    { from: "/p/a.txt", to: "/p/b.txt" },
    { from: "/p/b.txt", to: "/p/taken.txt" },
  ], exists);
  assertEquals(chain.rows.map((r) => r.status), ["conflict", "conflict"]);
  assertEquals(chain.rows[0].reason, "b.txt isn't renamed");
  // Case-only renames aren't conflicts, even where the disk ignores case.
  const caseOnly = planRows([{ from: "/p/a.txt", to: "/p/A.txt" }], (p) => p.toLowerCase() === "/p/a.txt");
  assertEquals(caseOnly.renames, 1);
  // Unchanged and invalid names.
  const odd = planRows(
    [{ from: "/p/a.txt", to: "/p/a.txt" }, { from: "/p/b.txt", to: "/p/" + "x".repeat(300) }],
    exists,
  );
  assertEquals(odd.rows.map((r) => r.status), ["same", "invalid"]);
  assertEquals(invalidName(""), "The new name is empty");
  assertEquals(invalidName(".."), "Not a usable name");
});

Deno.test("rename order: straight, or through temporary names", () => {
  const temp = (from: string, n: number) => `${from}.tmp${n}`;
  const straight = planRows([{ from: "/p/a", to: "/p/x" }, { from: "/p/b", to: "/p/y" }], () => false);
  assertEquals(renameSteps(straight.rows, temp), [["/p/a", "/p/x"], ["/p/b", "/p/y"]]);
  const swap = planRows(
    [{ from: "/p/a", to: "/p/b" }, { from: "/p/b", to: "/p/a" }],
    (p) => ["/p/a", "/p/b"].includes(p),
  );
  assertEquals(renameSteps(swap.rows, temp), [
    ["/p/a", "/p/a.tmp0"],
    ["/p/b", "/p/b.tmp1"],
    ["/p/a.tmp0", "/p/b"],
    ["/p/b.tmp1", "/p/a"],
  ]);
});

Deno.test("undo", () => {
  const renames = [{ from: "/p/IMG_1.JPG", to: "/p/001.jpg" }, { from: "/p/IMG_2.JPG", to: "/p/002.jpg" }];
  const disk = new Set(["/p/001.jpg"]);
  const plan = undoPlan(renames, (p) => disk.has(p));
  assertEquals(plan.rows.map((r) => [r.from, r.to, r.status]), [
    ["/p/001.jpg", "/p/IMG_1.JPG", "rename"],
    ["/p/002.jpg", "/p/IMG_2.JPG", "conflict"],
  ]);
  assertEquals(plan.rows[1].reason, "002.jpg isn't there anymore");
  assertEquals(followRenames(["/p/IMG_1.JPG", "/p/other.txt"], renames), ["/p/001.jpg", "/p/other.txt"]);
});

Deno.test("rules from the form and from storage", () => {
  const r = readRules({ case: "lower", start: "10", padding: "2", numbering: "suffix", extension: ".JPG", bogus: 1 });
  assertEquals([r.case, r.start, r.padding, r.numbering, r.extension], ["lower", 10, 2, "suffix", "JPG"]);
  assertEquals(readRules({ case: "shout", padding: "99", start: "-1" }).case, "keep");
  assertEquals(readRules({ padding: "99" }).padding, 3);
  assertEquals(readRules(undefined), DEFAULT_RULES);
  assertEquals(
    describeRules(rules({ find: "IMG", replace: "Photo", case: "lower", numbering: "prefix" })),
    "“IMG” → “Photo” · lowercase · number as prefix from 001",
  );
  assertEquals(describeRules(DEFAULT_RULES), "No change");
});

Deno.test("renaming on disk: a swap, and a rollback", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/a.txt`, "A");
    await Deno.writeTextFile(`${dir}/b.txt`, "B");
    const exists = (p: string) => {
      try {
        Deno.lstatSync(p);
        return true;
      } catch {
        return false;
      }
    };
    const swap = planRows(
      [{ from: `${dir}/a.txt`, to: `${dir}/b.txt` }, { from: `${dir}/b.txt`, to: `${dir}/a.txt` }],
      exists,
    );
    assertEquals((await applyRows(swap.rows)).length, 2);
    assertEquals(await Deno.readTextFile(`${dir}/a.txt`), "B");
    assertEquals(await Deno.readTextFile(`${dir}/b.txt`), "A");
    // The second target appears after the plan was made: nothing is overwritten, the first rename is undone.
    const plan = planRows(
      [{ from: `${dir}/a.txt`, to: `${dir}/c.txt` }, { from: `${dir}/b.txt`, to: `${dir}/d.txt` }],
      exists,
    );
    await Deno.writeTextFile(`${dir}/d.txt`, "D");
    let failed = false;
    await applyRows(plan.rows).catch(() => (failed = true));
    assert(failed);
    assertEquals(await Deno.readTextFile(`${dir}/a.txt`), "B");
    assertEquals(await Deno.readTextFile(`${dir}/d.txt`), "D");
    assert(!exists(`${dir}/c.txt`));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
