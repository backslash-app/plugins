import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  analyze,
  bytes,
  detectLanguage,
  duration,
  easeLabel,
  ellipsis,
  graphemes,
  lines,
  paragraphs,
  readability,
  sentences,
  summary,
  syllablesEn,
  syllablesFr,
  words,
} from "./lib.ts";
import { statItems } from "./ui.ts";

Deno.test("words: apostrophes, hyphens, numbers, no punctuation", () => {
  assertEquals(words("Aujourd'hui, l’école don't 3.5 e-mail café !"), [
    "Aujourd'hui",
    "l’école",
    "don't",
    "3.5",
    "e-mail",
    "café",
  ]);
  assertEquals(words("  — ... !!"), []);
  assertEquals(words("well-known state-of-the-art"), ["well-known", "state-of-the-art"]);
});

Deno.test("sentences: abbreviations don't end a sentence", () => {
  assertEquals(sentences("Hello world. Mr. Smith went to Washington! Did he? Yes."), [
    "Hello world.",
    "Mr. Smith went to Washington!",
    "Did he?",
    "Yes.",
  ]);
  assertEquals(sentences("M. Dupont est là. Il attend."), ["M. Dupont est là.", "Il attend."]);
  assertEquals(sentences("No final period"), ["No final period"]);
  assertEquals(sentences("..."), []);
});

Deno.test("graphemes, paragraphs and lines", () => {
  assertEquals(graphemes("👋🏽é"), 2);
  assertEquals(graphemes("é"), 1);
  assertEquals(paragraphs("One.\n\nTwo.\n  \nThree."), ["One.", "Two.", "Three."]);
  assertEquals(paragraphs("\n\n"), []);
  assertEquals(lines(""), 0);
  assertEquals(lines("a\nb\n"), 2);
  assertEquals(lines("a\r\nb\nc"), 3);
});

Deno.test("syllables: English", () => {
  const cases: [string, number][] = [
    ["the", 1],
    ["cat", 1],
    ["table", 2],
    ["beautiful", 4],
    ["readability", 5],
    ["created", 2],
    ["jumped", 1],
    ["make", 1],
    ["area", 2],
    ["computer", 3],
  ];
  for (const [w, n] of cases) assertEquals(syllablesEn(w), n, w);
  assertEquals(syllablesEn("42"), 0);
});

Deno.test("syllables: French, mute endings not counted", () => {
  const cases: [string, number][] = [
    ["maison", 2],
    ["chanteront", 3],
    ["oiseau", 2],
    ["aimé", 2],
    ["école", 2],
    ["chantent", 1],
    ["ordinateur", 4],
  ];
  for (const [w, n] of cases) assertEquals(syllablesFr(w), n, w);
});

Deno.test("language detection", () => {
  assertEquals(detectLanguage("The cat is on the table and it is sleeping."), "en");
  assertEquals(detectLanguage("Le chat est sur la table et il dort depuis ce matin."), "fr");
  assertEquals(detectLanguage("L'été arrive, qu'il fasse beau !"), "fr");
  assertEquals(detectLanguage(""), "en");
});

Deno.test("readability: Flesch, Flesch–Kincaid and Kandel–Moles", () => {
  // 100 words, 5 sentences, 150 syllables.
  const en = readability(100, 5, 150, "en")!;
  assertAlmostEquals(en.ease, 206.835 - 1.015 * 20 - 84.6 * 1.5, 0.1);
  assertAlmostEquals(en.grade!, 0.39 * 20 + 11.8 * 1.5 - 15.59, 0.1);
  assertEquals(en.formula, "Flesch reading ease");
  const fr = readability(100, 5, 150, "fr")!;
  assertAlmostEquals(fr.ease, 207 - 1.015 * 20 - 73.6 * 1.5, 0.1);
  assertEquals(fr.grade, undefined);
  assertEquals(readability(0, 0, 0, "en"), undefined);
  assertEquals(easeLabel(95).label, "Very easy");
  assertEquals(easeLabel(65).label, "Plain");
  assertEquals(easeLabel(10).label, "Very difficult");
});

Deno.test("analyze: an English text", () => {
  const text =
    "The quick brown fox jumps over the lazy dog. The dog sleeps.\n\nThe fox runs away, and the fox is happy.";
  const s = analyze(text);
  assertEquals(s.language, "en");
  assertEquals(s.words, 21);
  assertEquals(s.sentences, 3);
  assertEquals(s.paragraphs, 2);
  assertEquals(s.lines, 3);
  assertEquals(s.characters, text.length);
  assertEquals(s.charactersNoSpaces, text.replace(/\s/g, "").length);
  assertEquals(s.topWords[0], { word: "fox", count: 3 });
  assertEquals(s.topWords[1], { word: "dog", count: 2 });
  assert(!s.topWords.some((w) => w.word === "the"));
  assertEquals(s.longestSentence?.words, 9);
  assertEquals(s.averageSentenceLength, 7);
  assert(s.readability && s.readability.ease > 80);
  assertEquals(s.readingTime, Math.round(21 / 238 * 60));
});

Deno.test("analyze: French elisions count as the word", () => {
  const s = analyze("L'école est fermée. L'école rouvre lundi, et l’école sera neuve.");
  assertEquals(s.language, "fr");
  assertEquals(s.topWords[0], { word: "école", count: 3 });
  assertEquals(s.readability?.formula, "Kandel–Moles");
});

Deno.test("analyze: forced language and empty text", () => {
  assertEquals(analyze("Le chat dort.", "en").language, "en");
  const empty = analyze("");
  assertEquals(empty.words, 0);
  assertEquals(empty.sentences, 0);
  assertEquals(empty.readability, undefined);
  assertEquals(empty.averageWordLength, 0);
  assertEquals(empty.longestWord, undefined);
});

Deno.test("formatting", () => {
  assertEquals(duration(0), "0 s");
  assertEquals(duration(42), "42 s");
  assertEquals(duration(95), "1 min 35 s");
  assertEquals(duration(120), "2 min");
  assertEquals(duration(1250), "21 min");
  assertEquals(duration(3720), "1 h 2 min");
  assertEquals(duration(7200), "2 h");
  assertEquals(bytes(512), "512 B");
  assertEquals(bytes(2048), "2 KB");
  assertEquals(bytes(3 * 1024 * 1024), "3 MB");
  assertEquals(ellipsis("short"), "short");
  assertEquals(ellipsis("one two three four five", 12), "one two…");
});

Deno.test("summary and items", () => {
  const text = "One sentence here. Another one there, a bit longer than the first.";
  const s = analyze(text);
  const sum = summary(s);
  assert(sum.startsWith("Words: 12 (11 unique)"));
  assert(sum.includes("Readability:"));
  const items = statItems(s, text, "clipboard");
  assertEquals(items[0].id, "overview");
  assertEquals(items[0].title, "12 words · 66 characters");
  for (const id of ["words", "characters", "sentences", "reading", "readability", "longest-sentence"]) {
    assert(items.some((i) => i.id === id), id);
  }
  assert(items.every((i) => (i.actions?.length ?? 0) > 0));
  // The Copy action of a count copies the bare number.
  const words = items.find((i) => i.id === "words")!;
  assertEquals((words.actions![0] as { text: string }).text, "12");
});

Deno.test("manifest: clipboard only, command file exists", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: Record<string, unknown>;
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions, { "clipboard-read": true });
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
