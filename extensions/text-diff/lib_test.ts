import { assert, assertEquals } from "@std/assert";
import {
  changedPairs,
  comparable,
  diff,
  diffBlock,
  diffLines,
  firstLine,
  hunks,
  type Op,
  parseHistory,
  pickPair,
  relativeTime,
  singleLineChange,
  splitLines,
  stats,
  tokenize,
  unifiedPatch,
  wordDiff,
} from "./lib.ts";

const signs = (ops: Op[]) => ops.map((o) => (o.type === "equal" ? " " : o.type === "delete" ? "-" : "+") + o.value);

/** Rebuilds both sides from the ops: every diff must do that. */
function check<T>(a: T[], b: T[]) {
  const ops = diff(a, b);
  assertEquals(ops.filter((o) => o.type !== "insert").map((o) => o.value), a);
  assertEquals(ops.filter((o) => o.type !== "delete").map((o) => o.value), b);
  return ops;
}

Deno.test("diff finds a shortest edit script", () => {
  const ops = check("ABCABBA".split(""), "CBABAC".split(""));
  // Myers' paper: D = 5.
  assertEquals(ops.filter((o) => o.type !== "equal").length, 5);
  assertEquals(check([], ["a"]).map((o) => o.type), ["insert"]);
  assertEquals(check(["a"], []).map((o) => o.type), ["delete"]);
  assertEquals(check([], []), []);
  assertEquals(check(["a", "b"], ["a", "b"]).map((o) => o.type), ["equal", "equal"]);
  // Indexes point into both sides.
  assertEquals(diff(["x", "a"], ["a", "y"]), [
    { type: "delete", value: "x", ai: 0 },
    { type: "equal", value: "a", ai: 1, bi: 0 },
    { type: "insert", value: "y", bi: 1 },
  ]);
});

Deno.test("diff round-trips random sequences", () => {
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let t = 0; t < 200; t++) {
    const a = Array.from({ length: Math.floor(rand() * 30) }, () => "abcd"[Math.floor(rand() * 4)]);
    const b = Array.from({ length: Math.floor(rand() * 30) }, () => "abcd"[Math.floor(rand() * 4)]);
    const ops = check(a, b);
    // Deletions come before insertions within a change.
    for (let i = 1; i < ops.length; i++) assert(!(ops[i - 1].type === "insert" && ops[i].type === "delete"));
  }
});

Deno.test("diff stays fast on big inputs", () => {
  const a = Array.from({ length: 20000 }, (_, i) => `line ${i}`);
  const b = [...a];
  b[100] = "changed";
  b.splice(15000, 0, "inserted");
  const started = performance.now();
  const ops = check(a, b);
  assert(performance.now() - started < 1000);
  assertEquals(stats(ops), { added: 1, removed: 0, changed: 1, unchanged: 19999, similarity: 39998 / 40001 });
});

Deno.test("splitLines handles line endings", () => {
  assertEquals(splitLines("a\nb\n"), { lines: ["a", "b"], finalNewline: true });
  assertEquals(splitLines("a\r\nb"), { lines: ["a", "b"], finalNewline: false });
  assertEquals(splitLines(""), { lines: [], finalNewline: false });
  assertEquals(splitLines("\n"), { lines: [""], finalNewline: true });
});

Deno.test("diffLines can ignore whitespace and case", () => {
  assertEquals(comparable("  a   b\t", { ignoreWhitespace: true }), "a b");
  assertEquals(comparable("ABC", { ignoreCase: true }), "abc");
  const a = "if (x) {\n  return 1;\n}";
  const b = "if (x) {\n    return  1;\n}";
  assertEquals(diffLines(a, b).filter((o) => o.type !== "equal").length, 2);
  const ws = diffLines(a, b, { ignoreWhitespace: true });
  assertEquals(ws.map((o) => o.type), ["equal", "equal", "equal"]);
  // The original text of the first side is kept.
  assertEquals(ws[1].value, "  return 1;");
});

Deno.test("stats pair changed lines", () => {
  const ops = diffLines("a\nb\nc\nd", "a\nB\nc\nd\ne\nf");
  assertEquals(stats(ops), { added: 2, removed: 0, changed: 1, unchanged: 3, similarity: 6 / 10 });
  assertEquals(stats(diffLines("x\ny", "")), { added: 0, removed: 2, changed: 0, unchanged: 0, similarity: 0 });
  assertEquals(stats([]).similarity, 1);
});

Deno.test("hunks group changes with their context", () => {
  const a = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join("\n");
  const b = a.replace("l2\n", "L2\n").replace("l18", "L18");
  const hs = hunks(diffLines(a, b));
  assertEquals(hs.map((h) => [h.aStart, h.aLines, h.bStart, h.bLines]), [[1, 5, 1, 5], [15, 6, 15, 6]]);
  // Close changes share one hunk.
  const close = a.replace("l2\n", "L2\n").replace("l8\n", "L8\n");
  assertEquals(hunks(diffLines(a, close)).length, 1);
  assertEquals(hunks(diffLines(a, a)), []);
});

Deno.test("unifiedPatch matches diff -u", () => {
  const a = "one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\n";
  const b = "one\nTWO\nthree\nfour\nfive\nsix\nseven\neight\nnine\nten\neleven";
  assertEquals(
    unifiedPatch(a, b),
    [
      "--- a",
      "+++ b",
      "@@ -1,5 +1,5 @@",
      " one",
      "-two",
      "+TWO",
      " three",
      " four",
      " five",
      "@@ -8,3 +8,4 @@",
      " eight",
      " nine",
      " ten",
      "+eleven",
      "\\ No newline at end of file",
      "",
    ].join("\n"),
  );
  // Only the final line break differs.
  assertEquals(
    unifiedPatch("x\n", "x"),
    "--- a\n+++ b\n@@ -1 +1 @@\n-x\n+x\n\\ No newline at end of file\n",
  );
  // From nothing.
  assertEquals(unifiedPatch("", "x\n", ["old", "new"]), "--- old\n+++ new\n@@ -0,0 +1 @@\n+x\n");
  assertEquals(unifiedPatch("a\n", "a\n"), "");
  assertEquals(unifiedPatch("a  b\n", "a b", ["a", "b"], { ignoreWhitespace: true }), "");
  // A final line break lost far from the other change.
  const far = unifiedPatch("1\n2\n3\n4\n5\n6\n7\n8\n9\n", "0\n2\n3\n4\n5\n6\n7\n8\n9");
  assert(far.includes("@@ -1,4 +1,4 @@\n-1\n+0\n"));
  assert(far.endsWith("@@ -6,4 +6,4 @@\n 6\n 7\n 8\n-9\n+9\n\\ No newline at end of file\n"));
});

Deno.test("diffBlock shows hunks and cuts long ones", () => {
  const { text, truncated } = diffBlock(diffLines("a\nb\nc", "a\nB\nc"));
  assertEquals(text, "@@ -1,3 +1,3 @@\n a\n-b\n+B\n c");
  assertEquals(truncated, 0);
  const big = diffBlock(diffLines("", Array.from({ length: 50 }, (_, i) => `${i}`).join("\n")), 3, 10);
  assertEquals(big.text.split("\n").length, 10);
  assertEquals(big.truncated, 41);
});

Deno.test("tokenize and wordDiff", () => {
  assertEquals(tokenize("Hello, wörld 42!"), ["Hello", ",", " ", "wörld", " ", "42", "!"]);
  assertEquals(wordDiff("the quick brown fox", "the slow brown fox"), "the [-quick-]{+slow+} brown fox");
  assertEquals(wordDiff("a b c", "a c"), "a [-b -]c");
  assertEquals(wordDiff("price: 10 EUR", "price: 12 USD"), "price: [-10 EUR-]{+12 USD+}");
  assertEquals(wordDiff("same", "same"), "same");
  assertEquals(wordDiff("", "new"), "{+new+}");
});

Deno.test("singleLineChange and changedPairs", () => {
  assertEquals(singleLineChange(diffLines("a\nb\nc", "a\nB\nc")), ["b", "B"]);
  assertEquals(singleLineChange(diffLines("a\nb", "a\nb\nc")), undefined);
  assertEquals(singleLineChange(diffLines("x", "y")), ["x", "y"]);
  assertEquals(changedPairs(diffLines("a\nb\nc\nd", "A\nb\nC\nD")), [["a", "A"], ["c", "C"], ["d", "D"]]);
  // 1 line replaced by 2: no pairs.
  assertEquals(changedPairs(diffLines("a", "b\nc")), []);
});

Deno.test("parseHistory reads Backslash's clipboard history", () => {
  const json = JSON.stringify([
    { id: 1, text: "old", time: 100, pinned: true },
    { id: 3, text: "newest", time: 300 },
    { id: 2, text: "middle", time: 200 },
    { id: 4, time: 400 },
  ]);
  assertEquals(parseHistory(json).map((e) => e.text), ["newest", "middle", "old"]);
  assertEquals(parseHistory("not json"), []);
  assertEquals(parseHistory("{}"), []);
});

Deno.test("pickPair prefers the selection, then the last two copies", () => {
  const history = [
    { id: 3, text: "latest", time: 300 },
    { id: 2, text: "previous", time: 200 },
    { id: 1, text: "older", time: 100 },
  ];
  assertEquals(pickPair("clip", "sel", history), { left: "clip", right: "sel", labels: ["clipboard", "selection"] });
  assertEquals(pickPair("latest", "latest", history), {
    left: "previous",
    right: "latest",
    labels: ["previous copy", "latest copy"],
  });
  // The clipboard is newer than the history.
  assertEquals(pickPair("fresh", "", history)?.left, "latest");
  assertEquals(pickPair("", "", history)?.right, "latest");
  assertEquals(pickPair("x", "", []), undefined);
  assertEquals(pickPair("x", "x", [{ id: 1, text: "x", time: 1 }]), undefined);
});

Deno.test("small helpers", () => {
  assertEquals(relativeTime(1000, 1000 * 1000 + 30_000), "just now");
  assertEquals(relativeTime(1000, (1000 + 7200) * 1000), "2 h ago");
  assertEquals(firstLine("\n\n  hello world  \nmore"), "hello world");
  assertEquals(firstLine("x".repeat(100), 10), "xxxxxxxxx…");
});

Deno.test("signs helper sanity", () => {
  assertEquals(signs(diffLines("a\nb", "a\nc")), [" a", "-b", "+c"]);
});
