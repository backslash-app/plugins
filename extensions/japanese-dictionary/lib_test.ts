import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  gradeText,
  hasJapanese,
  jishoKanjiPage,
  type JishoResponse,
  jishoUrl,
  jishoWordPage,
  kanaItem,
  kanaToRomaji,
  kanjiItem,
  kanjiOf,
  type KanjiResponse,
  kanjiUrl,
  parseJisho,
  parseQuery,
  posText,
  romajiToHiragana,
  summaryText,
  toHiragana,
  toKanji,
  toKatakana,
  wordItem,
  wordMarkdown,
} from "./lib.ts";

const fixture = async <T>(name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url))) as T;

Deno.test("romaji → hiragana", () => {
  const cases: [string, string][] = [
    ["neko", "ねこ"],
    ["taberu", "たべる"],
    ["konnichiha", "こんにちは"],
    ["konnichiwa", "こんにちわ"],
    ["onna", "おんな"],
    ["kitte", "きって"],
    ["matcha", "まっちゃ"],
    ["gakkou", "がっこう"],
    ["shinbun", "しんぶん"],
    ["kan'i", "かんい"],
    ["kani", "かに"],
    ["hon", "ほん"],
    ["honn", "ほん"],
    ["toukyou", "とうきょう"],
    ["tōkyō", "とうきょう"],
    ["ryokou", "りょこう"],
    ["sushi", "すし"],
    ["tsukue", "つくえ"],
    ["fuji", "ふじ"],
    ["chizu", "ちず"],
    ["jisho", "じしょ"],
    ["kyaku", "きゃく"],
    ["Nihon Go", "にほんご"],
    ["ko-hi-", "こーひー"],
    ["sya", "しゃ"],
    ["wo", "を"],
  ];
  for (const [romaji, kana] of cases) assertEquals(romajiToHiragana(romaji), kana, romaji);
  // Not romaji.
  for (const text of ["cat", "xyz", "hello world", "1234", "猫", "", "qu"]) {
    assertEquals(romajiToHiragana(text), undefined, text);
  }
});

Deno.test("kana conversions and romaji for display", () => {
  assertEquals(toKatakana("こーひー"), "コーヒー");
  assertEquals(toKatakana("ねこ"), "ネコ");
  assertEquals(toHiragana("ネコ"), "ねこ");
  assertEquals(toKatakana("猫ねこ"), "猫ネコ");
  const cases: [string, string][] = [
    ["ねこ", "neko"],
    ["たべる", "taberu"],
    ["がっこう", "gakkou"],
    ["まっちゃ", "matcha"],
    ["しんぶん", "shinbun"],
    ["かんい", "kan'i"],
    ["じしょ", "jisho"],
    ["ちず", "chizu"],
    ["つくえ", "tsukue"],
    ["ふじ", "fuji"],
    ["コーヒー", "koohii"],
    ["ネコ", "neko"],
    ["きゃく", "kyaku"],
    ["を", "o"],
    ["はなぢ", "hanaji"],
  ];
  for (const [kana, romaji] of cases) assertEquals(kanaToRomaji(kana), romaji, kana);
  // Round trip on readings.
  for (const word of ["ねこ", "がっこう", "しんぶん", "とうきょう", "りょこう", "じしょ"]) {
    assertEquals(romajiToHiragana(kanaToRomaji(word)), word, word);
  }
});

Deno.test("kanji detection", () => {
  assertEquals(kanjiOf("日本語を勉強する日"), ["日", "本", "語", "勉", "強"]);
  assertEquals(kanjiOf("ねこ"), []);
  assertEquals(kanjiOf("一二三四五六七八", 3), ["一", "二", "三"]);
  assert(hasJapanese("ねこ"));
  assert(hasJapanese("猫"));
  assert(!hasJapanese("cat"));
});

Deno.test("query parsing", () => {
  assertEquals(parseQuery("  neko "), { keyword: "neko", kana: "ねこ", kanji: [] });
  assertEquals(parseQuery("cat").kana, undefined);
  // English words that happen to be romaji are left alone.
  assertEquals(parseQuery("no").kana, undefined);
  assertEquals(parseQuery("日本語").kanji, ["日", "本", "語"]);
  assertEquals(parseQuery("#jlpt-n5 taberu"), { keyword: "#jlpt-n5 taberu", kana: "たべる", kanji: [] });
  assertEquals(parseQuery("#common"), { keyword: "#common", kana: undefined, kanji: [] });
});

Deno.test("urls", () => {
  assertEquals(jishoUrl("猫 #common"), "https://jisho.org/api/v1/search/words?keyword=%E7%8C%AB+%23common");
  assertEquals(jishoWordPage("猫"), "https://jisho.org/word/%E7%8C%AB");
  assertEquals(jishoKanjiPage("猫"), "https://jisho.org/search/%E7%8C%AB%20%23kanji");
  assertEquals(kanjiUrl("食"), "https://kanjiapi.dev/v1/kanji/%E9%A3%9F");
});

Deno.test("Jisho answers", async () => {
  const words = parseJisho(await fixture<JishoResponse>("neko.json"));
  assertEquals(words.length, 3);
  const [neko, nekoze] = words;
  assertEquals(neko.word, "猫");
  assertEquals(neko.reading, "ねこ");
  assertEquals(neko.romaji, "neko");
  assertEquals(neko.otherForms, [{ reading: "ネコ" }]);
  assertEquals(neko.common, true);
  assertEquals(neko.jlpt, "N5");
  assertEquals(neko.wanikani, 15);
  assertEquals(neko.kind, "word");
  assertEquals(neko.senses[0].definitions, ["cat (esp. the domestic cat, Felis catus)", "feline"]);
  // The Wikipedia sense is dropped when there are dictionary senses.
  assert(neko.senses.every((s) => !s.partsOfSpeech.includes("Wikipedia definition")));
  assert(neko.senses.some((s) => s.notes.includes("usually in kana")));
  assert(neko.senses.some((s) => s.seeAlso.includes("猫車")));
  assertEquals(nekoze.common, true);
  assertEquals(parseJisho({ data: [{ slug: "x", japanese: [{ reading: "x" }], senses: [] }] })[0].common, false);
  assertEquals(nekoze.jlpt, undefined);

  const [taberu] = parseJisho(await fixture<JishoResponse>("taberu.json"));
  assertEquals(summaryText(taberu), "食べる (たべる): to eat; to live on (e.g. a salary), to live off, to subsist on");
  const md = wordMarkdown(taberu);
  assert(md.includes("**たべる** · taberu"));
  assert(md.includes("*Ichidan verb · transitive*"));
  // The part of speech is only written when it changes.
  assertEquals(md.split("Ichidan verb").length, 2);
  assert(md.includes("1. to eat"));
  assertEquals(
    posText(["Godan verb with 'u' ending", "Intransitive verb"]),
    "Godan verb with 'u' ending · intransitive",
  );

  assertEquals(parseJisho({ meta: { status: 200 }, data: [] }), []);
  assertEquals(parseJisho({}), []);
});

Deno.test("word items", async () => {
  const [neko] = parseJisho(await fixture<JishoResponse>("neko.json"));
  const item = wordItem(neko);
  assertEquals(item.title, "猫  ねこ");
  assertEquals(item.accessories?.map((a) => a.tag), ["N5", "common"]);
  assert(item.subtitle?.startsWith("cat (esp. the domestic cat"));
  const titles = item.actions?.map((a) => a.title);
  assertEquals(titles, ["Copy 猫", "Copy Reading", "Copy with Meaning", "Copy Romaji", "Open on Jisho"]);
  const katakana = item.detail?.metadata?.find((m) => m.label === "Katakana");
  assertEquals(katakana?.value, "ネコ");

  // A kana-only word has a single title.
  const kana = wordItem({ ...neko, word: "ねこ", reading: "ねこ" });
  assertEquals(kana.title, "ねこ");
});

Deno.test("kanji details", async () => {
  const shoku = toKanji(await fixture<KanjiResponse>("kanji-shoku.json"));
  assertEquals(shoku.kanji, "食");
  assertEquals(shoku.strokes, 9);
  assertEquals(shoku.on, ["ショク", "ジキ"]);
  assert(shoku.kun.includes("た.べる"));
  assertEquals(shoku.grade, 2);
  assertEquals(shoku.jlpt, "N5");
  assertEquals(shoku.unicode, "U+98DF");
  const neko = toKanji(await fixture<KanjiResponse>("kanji-neko.json"));
  assertEquals(neko.grade, 8);
  assertEquals(gradeText(neko.grade), "Jōyō, secondary school");
  assertEquals(gradeText(2), "Jōyō, grade 2");
  assertEquals(gradeText(9), "Jinmeiyō (names)");
  assertEquals(gradeText(undefined), undefined);

  const item = kanjiItem(shoku);
  assertEquals(item.title, "食");
  assertEquals(item.accessories?.[0].text, "ショク · く.う");
  assertEquals(item.detail?.stats?.map((s) => s.label), ["Strokes", "JLPT", "Frequency rank"]);
  assert(item.detail?.markdown?.includes("| On'yomi | ショク、ジキ |"));
  // A kanji without a level or frequency.
  const rare = kanjiItem({ ...shoku, jlpt: undefined, frequency: undefined, grade: undefined });
  assertEquals(rare.detail?.stats?.map((s) => s.label), ["Strokes"]);
});

Deno.test("kana item", () => {
  const item = kanaItem("neko", "ねこ");
  assertEquals(item.title, "ねこ  ネコ");
  assertEquals(item.actions?.map((a) => a.title), ["Copy Hiragana", "Copy Katakana", "Search on Jisho"]);
});

Deno.test("manifest", async () => {
  const dir = new URL(".", import.meta.url);
  const m = parse(await Deno.readTextFile(new URL("backslash.toml", dir))) as {
    extension: { id: string };
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(m.extension.id, "japanese-dictionary");
  assertEquals(m.permissions.net, ["jisho.org", "kanjiapi.dev"]);
  for (const c of m.commands) await Deno.stat(new URL(`commands/${c.name}.ts`, dir));
});
