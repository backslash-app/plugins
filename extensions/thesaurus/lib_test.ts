import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { lookup, related } from "./api.ts";
import {
  type DatamuseWord,
  entryItem,
  entryMarkdown,
  FILTERS,
  frequencyLabel,
  frequencyText,
  headwordItem,
  isPhrase,
  mergeSynonyms,
  parseQuery,
  parseWords,
  relationOf,
  relationUrl,
  rhymeItems,
  sectionTitle,
  shortDefinition,
  toEntry,
  wordUrl,
} from "./lib.ts";

const fixture = async (name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url))) as DatamuseWord[];

Deno.test("query parsing", () => {
  assertEquals(parseQuery("happy"), { text: "happy" });
  assertEquals(parseQuery("  syn   happy "), { text: "happy", relation: "syn" });
  assertEquals(parseQuery("rhyme orange"), { text: "orange", relation: "rhy" });
  assertEquals(parseQuery("Rhymes: time"), { text: "time", relation: "rhy" });
  assertEquals(parseQuery('like "fast car"'), { text: "fast car", relation: "ml" });
  assertEquals(parseQuery("adj ocean"), { text: "ocean", relation: "jjb" });
  assertEquals(parseQuery("noun yellow"), { text: "yellow", relation: "jja" });
  assertEquals(parseQuery("sounds jirraf"), { text: "jirraf", relation: "sl" });
  assertEquals(parseQuery("opposite hot"), { text: "hot", relation: "ant" });
  assertEquals(parseQuery("contraire chaud"), { text: "chaud", relation: "ant" });
  assertEquals(parseQuery("h*py"), { text: "h*py", relation: "sp" });
  assertEquals(parseQuery("spell ??ppy"), { text: "??ppy", relation: "sp" });
  // An unknown first word is part of the phrase.
  assertEquals(parseQuery("ice cream"), { text: "ice cream" });
  assertEquals(parseQuery("“big dog”"), { text: "big dog" });
  assertEquals(parseQuery(""), { text: "" });
  assert(isPhrase("ice cream"));
  assert(!isPhrase("happy"));
  assertEquals(relationOf("rhy"), "rhy");
  assertEquals(relationOf("nope"), "all");
  assertEquals(relationOf(undefined), "all");
  assertEquals(FILTERS[0].value, "all");
});

Deno.test("urls", () => {
  assertEquals(relationUrl("syn", "happy"), "https://api.datamuse.com/words?rel_syn=happy&md=dpsf&max=40");
  assertEquals(relationUrl("rhy", "orange", 10), "https://api.datamuse.com/words?rel_rhy=orange&md=psf&max=10");
  assertEquals(relationUrl("ml", "fast car"), "https://api.datamuse.com/words?ml=fast+car&md=dpsf&max=40");
  assertEquals(relationUrl("sp", "h*py"), "https://api.datamuse.com/words?sp=h*py&md=psf&max=40");
  assertEquals(wordUrl("happy"), "https://api.datamuse.com/words?sp=happy&qe=sp&md=dpsf&max=1");
  assertEquals(sectionTitle("syn", "happy"), "Synonyms of “happy”");
});

Deno.test("reading Datamuse answers", async () => {
  const syn = parseWords(await fixture("syn-happy.json"), "happy");
  assertEquals(syn[0].word, "halcyon");
  assertEquals(syn[0].syllables, 3);
  assertEquals(syn[0].pos, ["adjective", "noun"]);
  assertEquals(syn[0].frequency, 0.295747);
  assertEquals(syn[0].definitions[0], { pos: "adjective", text: "(figurative) Calm, undisturbed, peaceful, serene." });

  const [word] = await fixture("word-happy.json");
  const happy = toEntry(word);
  assertEquals(happy.pos, ["adjective", "verb", "noun"]);
  assert(happy.definitions.length > 10);
  // The query word and duplicates are dropped.
  assertEquals(parseWords([word, word, { word: "glad" }, { word: "Glad" }], "Happy").map((e) => e.word), ["glad"]);
  // A word with nothing but its spelling.
  assertEquals(toEntry({ word: "zzz" }), {
    word: "zzz",
    score: 0,
    syllables: undefined,
    pos: [],
    proper: false,
    frequency: undefined,
    definitions: [],
  });
  // "prop" marks proper nouns; a definition without a tab is kept as text.
  const prop = toEntry({ word: "Paris", tags: ["n", "prop"], defs: ["The capital of France."] });
  assert(prop.proper);
  assertEquals(prop.definitions, [{ text: "The capital of France." }]);
});

Deno.test("synonyms are topped up with similar words", () => {
  const e = (word: string) => toEntry({ word });
  const merged = mergeSynonyms([e("glad"), e("content")], [e("Glad"), e("joyful"), e("cheerful")], 3);
  assertEquals(merged.map((x) => x.word), ["glad", "content", "joyful", "cheerful"]);
  const enough = [e("a"), e("b"), e("c")];
  assertEquals(mergeSynonyms(enough, [e("d")], 3), enough);
});

Deno.test("frequency", () => {
  assertEquals(frequencyLabel(undefined), undefined);
  assertEquals(frequencyLabel(150)?.text, "very common");
  assertEquals(frequencyLabel(49)?.text, "common");
  assertEquals(frequencyLabel(3.9)?.text, "uncommon");
  assertEquals(frequencyLabel(0.03)?.text, "rare");
  assertEquals(frequencyText(1234.5), "1,235 per million words");
  assertEquals(frequencyText(3.92), "3.9 per million words");
  assertEquals(frequencyText(0.0086), "0.009 per million words");
});

Deno.test("items", async () => {
  const [halcyon] = parseWords(await fixture("syn-happy.json"), "happy");
  const item = entryItem(halcyon, sectionTitle("syn", "happy"), "syn");
  assertEquals(item.title, "halcyon");
  assertEquals(item.subtitle, "(figurative) Calm, undisturbed, peaceful, serene.");
  assertEquals(item.accessories?.map((a) => a.text ?? a.tag), ["adj. n.", "3 syl.", "rare"]);
  assertEquals(item.actions?.map((a) => a.title), ["Copy Word", "Paste Word", "Open in Wiktionary"]);
  const md = entryMarkdown(halcyon);
  assert(md.startsWith("## halcyon\n\n*adjective, noun · 3 syllables*"));
  assert(md.includes("**adjective**\n\n1. (figurative) Calm"));

  // Long definitions are cut in the subtitle.
  const long = toEntry({ word: "x", defs: [`n\t${"word ".repeat(40)}`] });
  assert(shortDefinition(long)!.endsWith("…"));
  assert(shortDefinition(long)!.length <= 90);
  assertEquals(shortDefinition(toEntry({ word: "y" })), undefined);
  assert(entryMarkdown(toEntry({ word: "y" })).includes("No definition"));

  const [word] = await fixture("word-happy.json");
  const head = headwordItem(toEntry(word));
  assertEquals(head.section, "Word");
  assert(head.detail?.markdown?.includes("more on Wiktionary"));

  // "more" adds actions to browse from a word.
  const more = (w: string) => [{ title: `Look Up ${w}` } as never];
  assertEquals(entryItem(halcyon, "s", "syn", more).actions?.[2].title, "Look Up halcyon");
});

Deno.test("rhymes are grouped by syllables", async () => {
  const rhymes = parseWords(await fixture("rhy-time.json"), "time");
  const items = rhymeItems(rhymes, "time", "rhy");
  assertEquals(items.length, rhymes.length);
  const sections = [...new Set(items.map((i) => i.section))];
  assertEquals(sections, ["Rhymes · 1 syllable", "Rhymes · 2 syllables", "Rhymes · 3 syllables"]);
  // Best score first within a group.
  assertEquals(items.filter((i) => i.section === "Rhymes · 1 syllable")[0].title, "prime");
  const orange = rhymeItems(parseWords(await fixture("rhy-orange.json"), "orange"), "orange", "nry");
  assertEquals(orange.map((i) => [i.title, i.section]), [["door hinge", "Near rhymes · 2 syllables"]]);
  assertEquals(rhymeItems([toEntry({ word: "x" })], "y", "rhy")[0].section, "Rhymes for “y”");
});

Deno.test("api: requests and merging, with a fake Datamuse", async () => {
  const realFetch = globalThis.fetch;
  const asked: string[] = [];
  const answers: Record<string, DatamuseWord[]> = {
    rel_syn: [{ word: "glad" }],
    ml: [{ word: "glad" }, { word: "joyful" }],
    rel_rhy: [{ word: "snappy", numSyllables: 2 }],
    sp: [{ word: "happy", tags: ["query", "adj", "f:49"] }],
  };
  globalThis.fetch = ((input: string | URL) => {
    const url = new URL(String(input));
    asked.push(url.search);
    const param = [...url.searchParams.keys()][0];
    return Promise.resolve(new Response(JSON.stringify(answers[param] ?? [])));
  }) as typeof fetch;
  try {
    assertEquals((await related("syn", "happy")).map((e) => e.word), ["glad", "joyful"]);
    assertEquals((await related("rhy", "happy")).map((e) => e.word), ["snappy"]);
    assertEquals((await lookup("happy"))?.frequency, 49);
    assertEquals(await lookup("happi"), undefined);
    // Answers are remembered: asking again sends nothing.
    const before = asked.length;
    await related("rhy", "happy");
    assertEquals(asked.length, before);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("manifest", async () => {
  const dir = new URL(".", import.meta.url);
  const m = parse(await Deno.readTextFile(new URL("backslash.toml", dir))) as {
    extension: { id: string };
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(m.extension.id, "thesaurus");
  assertEquals(m.permissions.net, ["api.datamuse.com"]);
  for (const c of m.commands) await Deno.stat(new URL(`commands/${c.name}.ts`, dir));
});
