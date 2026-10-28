import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  diceNotation,
  drawInRange,
  EIGHT_BALL,
  hex,
  hsl,
  language,
  looksFrench,
  parseDice,
  parseIntent,
  parseList,
  parseRange,
  randomColor,
  randomFloat,
  randomInt,
  roll,
  rollBreakdown,
  shuffle,
  type Source,
} from "./lib.ts";

/** Returns the given values in a loop. */
const seq = (...values: number[]): Source => {
  let i = 0;
  return () => values[i++ % values.length];
};

Deno.test("dice notation", () => {
  assertEquals(parseDice("2d6+3"), { count: 2, sides: 6, modifier: 3 });
  assertEquals(parseDice("d20"), { count: 1, sides: 20, modifier: 0 });
  assertEquals(parseDice("3D8 - 1"), { count: 3, sides: 8, modifier: -1 });
  assertEquals(parseDice("4d6kh3"), { count: 4, sides: 6, modifier: 0, keep: 3 });
  assertEquals(parseDice("2d20kl1+5"), { count: 2, sides: 20, modifier: 5, keep: -1 });
  assertEquals(parseDice("2de6"), { count: 2, sides: 6, modifier: 0 });
  assertEquals(parseDice("2d6k2"), { count: 2, sides: 6, modifier: 0 }, "keeping every die is no keep");
  for (const bad of ["d1", "0d6", "101d6", "2d1001", "2d6kh3", "hello", "2d", "d"]) {
    assertEquals(parseDice(bad), undefined, bad);
  }
  assertEquals(diceNotation({ count: 4, sides: 6, modifier: -2, keep: 3 }), "4d6kh3-2");
});

Deno.test("dice rolls stay within bounds and keep the right dice", () => {
  const d = parseDice("3d6+2")!;
  for (let i = 0; i < 2000; i++) {
    const r = roll(d);
    assert(r.rolls.every((v) => v >= 1 && v <= 6));
    assert(r.total >= 5 && r.total <= 20);
    assertEquals([r.min, r.max], [5, 20]);
  }
  // seq values % 6 + 1: 3 → 4, 0 → 1, 5 → 6, 2 → 3
  const r = roll(parseDice("4d6kh3")!, seq(3, 0, 5, 2));
  assertEquals(r.rolls, [4, 1, 6, 3]);
  assertEquals(r.kept, [0, 2, 3]);
  assertEquals(r.total, 13);
  assertEquals(rollBreakdown(r), "[4, (1), 6, 3]");
  const low = roll(parseDice("2d20kl1-1")!, seq(19, 4));
  assertEquals([low.rolls, low.total, rollBreakdown(low)], [[20, 5], 4, "[(20), 5] − 1"]);
});

Deno.test("ranges", () => {
  assertEquals(parseRange("1-100"), { min: 1, max: 100, decimals: 0 });
  assertEquals(parseRange("1..6"), { min: 1, max: 6, decimals: 0 });
  assertEquals(parseRange("-10 10"), { min: -10, max: 10, decimals: 0 });
  assertEquals(parseRange("-20--10"), { min: -20, max: -10, decimals: 0 });
  assertEquals(parseRange("50 to 1"), { min: 1, max: 50, decimals: 0 });
  assertEquals(parseRange("de 1 à 10"), { min: 1, max: 10, decimals: 0 });
  assertEquals(parseRange("between 5 and 8"), { min: 5, max: 8, decimals: 0 });
  assertEquals(parseRange("0.5-2.25"), { min: 0.5, max: 2.25, decimals: 2 });
  assertEquals(parseRange("0,5 - 1,5"), { min: 0.5, max: 1.5, decimals: 1 });
  assertEquals(parseRange("100"), { min: 1, max: 100, decimals: 0 });
  for (const bad of ["abc", "1-", "0", "1-2-3", "1e400-2"]) assertEquals(parseRange(bad), undefined, bad);
});

Deno.test("random integers cover the range, without bias, within bounds", () => {
  const counts = new Map<number, number>();
  const n = 60000;
  for (let i = 0; i < n; i++) {
    const v = randomInt(-2, 3);
    assert(v >= -2 && v <= 3);
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  assertEquals([...counts.keys()].sort((a, b) => a - b), [-2, -1, 0, 1, 2, 3]);
  // Each value expects 10000; 5 % is about 10 standard deviations.
  for (const c of counts.values()) assert(Math.abs(c - n / 6) < n / 6 * 0.05, `${c}`);
  assertEquals(randomInt(7, 7), 7);
  assertEquals(randomInt(10, 1, seq(0)), 1, "reversed bounds");
  // Values past the last full multiple of the span are rejected: 2^32 % 3 = 1.
  assertEquals(randomInt(0, 2, seq(2 ** 32 - 1, 4)), 1);
  const big = randomInt(0, 2 ** 40);
  assert(big >= 0 && big <= 2 ** 40 && Number.isInteger(big));
  assertThrows(() => randomInt(0, 2 ** 60));
  assertThrows(() => randomInt(0.5, 2));
  for (let i = 0; i < 1000; i++) {
    const f = randomFloat();
    assert(f >= 0 && f < 1);
  }
});

Deno.test("decimal ranges draw on the grid, both bounds reachable", () => {
  const r = parseRange("0.5-0.7")!;
  const seen = new Set<number>();
  for (let i = 0; i < 500; i++) seen.add(drawInRange(r));
  assertEquals([...seen].sort(), [0.5, 0.6, 0.7]);
  assertEquals(drawInRange({ min: 1, max: 100, decimals: 0 }, seq(41)), 42);
});

Deno.test("lists, shuffle and pick", () => {
  assertEquals(parseList("pizza, sushi ,tacos,"), ["pizza", "sushi", "tacos"]);
  assertEquals(parseList("a; b | c"), ["a", "b", "c"]);
  assertEquals(parseList("tea or coffee"), ["tea", "coffee"]);
  assertEquals(parseList("thé ou café"), ["thé", "café"]);
  assertEquals(parseList("one\ntwo"), ["one", "two"]);
  const items = ["a", "b", "c", "d", "e"];
  const firsts = new Set<string>();
  for (let i = 0; i < 500; i++) {
    const s = shuffle(items);
    assertEquals([...s].sort(), items);
    firsts.add(s[0]);
  }
  assertEquals(firsts.size, 5);
  assertEquals(items, ["a", "b", "c", "d", "e"], "the input is left alone");
});

Deno.test("intents", () => {
  assertEquals(parseIntent(""), { kind: "tools" });
  assertEquals(parseIntent("flip"), { kind: "coin", count: 1 });
  assertEquals(parseIntent("flip a coin"), { kind: "coin", count: 1 });
  assertEquals(parseIntent("flip 10"), { kind: "coin", count: 10 });
  assertEquals(parseIntent("pile ou face"), { kind: "coin", count: 1 });
  assertEquals(parseIntent("roll 2d6+3"), { kind: "dice", dice: { count: 2, sides: 6, modifier: 3 } });
  assertEquals(parseIntent("d20"), { kind: "dice", dice: { count: 1, sides: 20, modifier: 0 } });
  assertEquals(parseIntent("dice"), { kind: "dice", dice: { count: 1, sides: 6, modifier: 0 } });
  assertEquals(parseIntent("1-100"), { kind: "range", range: { min: 1, max: 100, decimals: 0 } });
  assertEquals(parseIntent("pick a, b, c"), { kind: "pick", items: ["a", "b", "c"], count: 1 });
  assertEquals(parseIntent("pick 2 from a, b, c"), { kind: "pick", items: ["a", "b", "c"], count: 2 });
  assertEquals(parseIntent("choisir parmi thé, café"), { kind: "pick", items: ["thé", "café"], count: 1 });
  assertEquals(parseIntent("pizza or sushi"), { kind: "pick", items: ["pizza", "sushi"], count: 1 });
  assertEquals(parseIntent("shuffle Alice, Bob"), { kind: "shuffle", items: ["Alice", "Bob"] });
  assertEquals(parseIntent("mélanger a; b; c"), { kind: "shuffle", items: ["a", "b", "c"] });
  assertEquals(parseIntent("color"), { kind: "color" });
  assertEquals(parseIntent("couleur"), { kind: "color" });
  assertEquals(parseIntent("yes or no"), { kind: "yesno" });
  assertEquals(parseIntent("oui ou non ?"), { kind: "yesno" });
  assertEquals(parseIntent("8ball Will it rain?"), { kind: "eightball", question: "Will it rain?" });
  assertEquals(parseIntent("Should I go?"), { kind: "eightball", question: "Should I go?" });
  assertEquals(parseIntent("boule magique"), { kind: "eightball", question: "" });
  assertEquals(parseIntent("coffee"), { kind: "unknown", text: "coffee" });
});

Deno.test("colors", () => {
  const c = randomColor(seq(0x00336699));
  assertEquals(c, { r: 0x99, g: 0x66, b: 0x33 });
  assertEquals(hex(c), "#996633");
  assertEquals(hsl({ r: 255, g: 0, b: 0 }), { h: 0, s: 100, l: 50 });
  assertEquals(hsl({ r: 0, g: 0, b: 255 }), { h: 240, s: 100, l: 50 });
  assertEquals(hsl({ r: 128, g: 128, b: 128 }), { h: 0, s: 0, l: 50 });
});

Deno.test("languages and answers", () => {
  assertEquals(language("fr", "en_US.UTF-8"), "fr");
  assertEquals(language("auto", "fr_FR.UTF-8"), "fr");
  assertEquals(language(undefined, "de_DE.UTF-8"), "en");
  assert(looksFrench("Est-ce que je vais gagner ?"));
  assert(!looksFrench("Will you win?"));
  for (const lang of ["en", "fr"] as const) {
    const answers = EIGHT_BALL[lang];
    assertEquals(answers.length, 20);
    assertEquals(answers.filter(([, m]) => m === "yes").length, 10);
    assertEquals(answers.filter(([, m]) => m === "maybe").length, 5);
  }
});
