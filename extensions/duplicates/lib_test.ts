import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  byWasted,
  dedupeHardLinks,
  type FileInfo,
  formatSize,
  groupMarkdown,
  makeGroup,
  parseHashOutput,
  parseSize,
  pruneCache,
  relativeTo,
  sameSize,
  skipDir,
  split,
  splitBy,
  trashPlan,
  whereSummary,
  without,
} from "./lib.ts";
import { findDuplicates, headHash, walk } from "./system.ts";

const f = (path: string, size: number, mtime: number, ino?: number): FileInfo => ({
  path,
  size,
  mtime,
  dev: ino === undefined ? undefined : 2049,
  ino,
});

Deno.test("sizes", () => {
  assertEquals(parseSize("1 MB"), 1048576);
  assertEquals(parseSize("500k"), 512000);
  assertEquals(parseSize("2,5 Go"), 2684354560);
  assertEquals(parseSize("0"), 0);
  assertEquals(parseSize(" 12 "), 12);
  assertThrows(() => parseSize("big"), Error, "not a size");
  assertThrows(() => parseSize("3 parsecs"), Error);
  assertEquals(formatSize(512), "512 B");
  assertEquals(formatSize(1536), "1.5 KB");
  assertEquals(formatSize(1048576), "1 MB");
  assertEquals(formatSize(734003200), "700 MB");
  assertEquals(formatSize(5 * 1024 ** 4), "5 TB");
});

Deno.test("sha256sum and b3sum output, escaped names", () => {
  const out = [
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08  /home/ada/Pictures/a.jpg",
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855 */home/ada/binary mode.iso",
    "\\2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824  /home/ada/odd\\nname\\\\x.txt",
    "af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262  /home/ada/b3 hash.mkv",
    "sha256sum: /home/ada/gone.txt: No such file or directory",
    "",
  ].join("\n");
  const m = parseHashOutput(out);
  assertEquals(m.size, 4);
  assertEquals(m.get("/home/ada/Pictures/a.jpg")?.slice(0, 8), "9f86d081");
  assertEquals(m.get("/home/ada/binary mode.iso")?.slice(0, 8), "e3b0c442");
  assertEquals(m.get("/home/ada/odd\nname\\x.txt")?.slice(0, 8), "2cf24dba");
  assertEquals(m.get("/home/ada/b3 hash.mkv")?.slice(0, 8), "af1349b9");
});

Deno.test("hard links count once, empty files never", () => {
  const files = [f("/a", 10, 1, 7), f("/b", 10, 2, 7), f("/c", 10, 3, 8), f("/d", 0, 1), f("/e", 0, 2)];
  assertEquals(dedupeHardLinks(files).map((x) => x.path), ["/a", "/c", "/d", "/e"]);
  assertEquals(sameSize(files).map((g) => g.map((x) => x.path)), [["/a", "/c"]]);
  assertEquals(sameSize([f("/a", 1, 1, 1), f("/b", 1, 1, 1)]), []);
});

Deno.test("grouping by hash, newest first, by space wasted", () => {
  const hashes: Record<string, string> = { "/a": "x", "/b": "x", "/c": "y", "/d": "x" };
  const groups = splitBy([f("/a", 5, 1), f("/b", 5, 3), f("/c", 5, 2), f("/d", 5, 2)], (x) => hashes[x.path]);
  assertEquals(groups.length, 1);
  const g = makeGroup("x", groups[0]);
  assertEquals(g.files.map((x) => x.path), ["/b", "/d", "/a"]);
  assertEquals(g.wasted, 10);
  const small = makeGroup("s", [f("/s1", 1, 1), f("/s2", 1, 1)]);
  const big = makeGroup("b", [f("/b1", 100, 1), f("/b2", 100, 1)]);
  assertEquals([small, big, g].sort(byWasted).map((x) => x.hash), ["b", "x", "s"]);
});

Deno.test("keeping the newest, the oldest or one copy", () => {
  const g = makeGroup("x", [f("/old", 5, 1), f("/new", 5, 9), f("/mid", 5, 5)]);
  assertEquals(split(g, "newest").keep.path, "/new");
  assertEquals(split(g, "newest").trash.map((x) => x.path), ["/mid", "/old"]);
  assertEquals(split(g, "oldest").keep.path, "/old");
  assertEquals(split(g, "/mid").trash.map((x) => x.path), ["/new", "/old"]);
  assertThrows(() => split(g, "/nope"), Error, "no longer");
  assertEquals(without(g, new Set(["/new"]))?.files.map((x) => x.path), ["/mid", "/old"]);
  assertEquals(without(g, new Set(["/new", "/old"])), undefined);
  const plan = trashPlan([g, makeGroup("y", [f("/y1", 100, 1), f("/y2", 100, 2)])], "oldest");
  assertEquals(plan.files.map((x) => x.path), ["/new", "/mid", "/y2"]);
  assertEquals(plan.bytes, 110);
});

Deno.test("folders that are skipped", () => {
  assert(skipDir(".git", true));
  assert(skipDir("node_modules", true));
  assert(skipDir(".Trash-1000", true));
  assert(skipDir(".config", false));
  assert(!skipDir(".config", true));
  assert(!skipDir("Photos", false));
});

Deno.test("paths shown from the scanned folder", () => {
  assertEquals(relativeTo("/home/ada/Pictures/", "/home/ada/Pictures/2024/a.jpg"), "2024/a.jpg");
  assertEquals(relativeTo("/home/ada/Pictures", "/home/ada/Downloads/a.jpg", "/home/ada"), "~/Downloads/a.jpg");
  const g = makeGroup("x", [f("/home/ada/Pictures/2024/a.jpg", 5, 2), f("/home/ada/Pictures/2024/a (1).jpg", 5, 1)]);
  assertEquals(whereSummary(g, "/home/ada/Pictures"), "2024");
  assertEquals(whereSummary(makeGroup("x", [f("/r/a", 1, 1), f("/r/b", 1, 1)]), "/r"), "this folder");
  assertEquals(whereSummary(makeGroup("x", [f("/r/x/a", 1, 1), f("/r/y/a", 1, 1)]), "/r"), "2 folders");
  const md = groupMarkdown(g, "/home/ada/Pictures");
  assert(md.startsWith("**2 identical copies** of 5 B"));
  assert(md.includes("`2024/a.jpg`"));
  assert(md.includes("**newest**"));
});

Deno.test("hash cache keeps the most recent entries", () => {
  const cache = { a: { at: 1 }, b: { at: 3 }, c: { at: 2 } };
  assertEquals(Object.keys(pruneCache(cache, 2)).sort(), ["b", "c"]);
  assertEquals(pruneCache(cache, 5), cache);
});

Deno.test("walking a real folder and hashing the start of files", async () => {
  const dir = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${dir}/sub`);
    await Deno.mkdir(`${dir}/.git`);
    await Deno.mkdir(`${dir}/.hidden`);
    await Deno.writeTextFile(`${dir}/a.txt`, "same content");
    await Deno.writeTextFile(`${dir}/sub/b.txt`, "same content");
    await Deno.writeTextFile(`${dir}/c.txt`, "other stuff!");
    await Deno.writeTextFile(`${dir}/tiny`, "x");
    await Deno.writeTextFile(`${dir}/.git/HEAD`, "same content");
    await Deno.writeTextFile(`${dir}/.hidden/d.txt`, "same content");
    await Deno.symlink(`${dir}/a.txt`, `${dir}/link.txt`);
    await Deno.link(`${dir}/a.txt`, `${dir}/hardlink.txt`);

    const files = await walk(dir, { minSize: 2, hidden: false });
    assertEquals(files.map((x) => x.path.slice(dir.length)).sort(), [
      "/a.txt",
      "/c.txt",
      "/hardlink.txt",
      "/sub/b.txt",
    ]);
    const withHidden = await walk(dir, { minSize: 0, hidden: true });
    assert(withHidden.some((x) => x.path.endsWith("/.hidden/d.txt")));
    assert(!withHidden.some((x) => x.path.includes("/.git/")));

    const groups = sameSize(files);
    assertEquals(groups.length, 1);
    assertEquals(groups[0].length, 3); // the hard link is the same file as a.txt
    const heads = await Promise.all(groups[0].map((x) => headHash(x.path)));
    const byHead = splitBy(groups[0], (x) => heads[groups[0].indexOf(x)]);
    assertEquals(byHead.length, 1);
    // One of a.txt and its hard link, whichever was seen first, and b.txt.
    assertEquals(byHead[0].length, 2);
    assert(byHead[0].some((x) => x.path.endsWith("/sub/b.txt")));
    assertEquals(await headHash(`${dir}/missing`), undefined);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("big files: same start, different end, compared whole with sha256sum or b3sum", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const a = new Uint8Array(200_000).fill(7);
    const b = a.slice();
    b[199_999] = 8;
    await Deno.writeFile(`${dir}/one.bin`, a);
    await Deno.writeFile(`${dir}/two copy.bin`, a);
    await Deno.writeFile(`${dir}/-dash.bin`, a);
    await Deno.writeFile(`${dir}/three.bin`, b);
    const files = await walk(dir, { minSize: 1, hidden: false });
    // No launcher here: the hash cache is skipped.
    const groups = await findDuplicates(files, {});
    assertEquals(groups.length, 1);
    assertEquals(groups[0].files.map((x) => x.path.slice(dir.length + 1)).sort(), [
      "-dash.bin",
      "one.bin",
      "two copy.bin",
    ]);
    assertEquals(groups[0].wasted, 400_000);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
