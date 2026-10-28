import { assertEquals, assertInstanceOf, assertMatch, assertThrows } from "@std/assert";
import {
  applyAll,
  applyFix,
  checkBody,
  deeplError,
  deeplHost,
  deeplKey,
  fixTitle,
  highlight,
  highlightAll,
  KeyError,
  languageName,
  languagePrefs,
  ltError,
  type LtResponse,
  ltSettings,
  normalizeSource,
  normalizeTarget,
  parseCheck,
  parseQuery,
  parseTranslation,
  preview,
  supportsFormality,
  translateBody,
  words,
} from "./lib.ts";

Deno.test("languages: codes typed by people become DeepL codes", () => {
  assertEquals(normalizeTarget("en"), "EN-US");
  assertEquals(normalizeTarget("en", "EN-GB"), "EN-GB");
  assertEquals(normalizeTarget("pt"), "PT-BR");
  assertEquals(normalizeTarget("zh"), "ZH-HANS");
  assertEquals(normalizeTarget("de"), "DE");
  assertEquals(normalizeTarget("pt-pt"), "PT-PT");
  assertEquals(normalizeTarget("ok"), undefined);
  assertEquals(normalizeSource("en-gb"), "EN");
  assertEquals(normalizeSource("xx"), undefined);
  assertEquals(languageName("FR"), "French");
  assertEquals(languageName("EN"), "English");
  assertEquals(languageName("EN-GB"), "English (UK)");
  assertEquals(supportsFormality("de"), true);
  assertEquals(supportsFormality("EN-US"), false);
});

Deno.test("parseQuery: per-query languages, else the text as typed", () => {
  assertEquals(parseQuery("en: bonjour tout le monde"), { text: "bonjour tout le monde", target: "EN-US" });
  assertEquals(parseQuery(">de Good morning"), { text: "Good morning", target: "DE" });
  assertEquals(parseQuery("Good morning >ja"), { text: "Good morning", target: "JA" });
  assertEquals(parseQuery("fr>en Bonjour"), { text: "Bonjour", source: "FR", target: "EN-US" });
  assertEquals(parseQuery("fr > es: Bonjour"), { text: "Bonjour", source: "FR", target: "ES" });
  assertEquals(parseQuery("en: hello", "EN-GB").target, "EN-GB");
  // Not languages: kept whole.
  assertEquals(parseQuery("Note: buy milk"), { text: "Note: buy milk" });
  assertEquals(parseQuery("ok: fine"), { text: "ok: fine" });
  assertEquals(parseQuery("  Hallo Welt  "), { text: "Hallo Welt" });
  assertEquals(parseQuery("de:"), { text: "de:" });
});

Deno.test("languagePrefs: target, second language, formality", () => {
  assertEquals(languagePrefs({}), { target: "EN-US", second: undefined, formality: "default" });
  assertEquals(languagePrefs({ targetLang: "fr", secondLang: "en", formality: "LESS" }), {
    target: "FR",
    second: "EN-US",
    formality: "less",
  });
  // A second language that is the same language is no second language.
  assertEquals(languagePrefs({ targetLang: "EN-GB", secondLang: "EN-US" }).second, undefined);
  assertThrows(() => languagePrefs({ targetLang: "klingon" }), Error, "not a DeepL language");
});

Deno.test("deepl: host by key, body, response, errors", () => {
  assertThrows(() => deeplKey({}), KeyError);
  assertEquals(deeplHost("abc-123:fx"), "https://api-free.deepl.com");
  assertEquals(deeplHost("abc-123"), "https://api.deepl.com");
  assertEquals(translateBody("Hi", "DE", { formality: "more" }), {
    text: ["Hi"],
    target_lang: "DE",
    formality: "prefer_more",
  });
  assertEquals(translateBody("Hi", "EN-US", { formality: "more", source: "FR" }), {
    text: ["Hi"],
    target_lang: "EN-US",
    source_lang: "FR",
  });
  const t = parseTranslation(
    { translations: [{ detected_source_language: "FR", text: "Hello everyone" }] },
    { original: "Bonjour à tous", target: "EN-US", formality: "default" },
  );
  assertEquals(t, {
    text: "Hello everyone",
    source: "FR",
    target: "EN-US",
    original: "Bonjour à tous",
    formality: "default",
  });
  assertThrows(
    () => parseTranslation({}, { original: "", target: "DE", formality: "default" }),
    Error,
    "no translation",
  );
  assertInstanceOf(deeplError(403, '{"message":"Wrong endpoint"}'), KeyError);
  assertMatch(deeplError(456, "").message, /quota/);
  assertEquals(
    deeplError(400, '{"message":"Value for \'target_lang\' not supported."}').message,
    "DeepL answered 400: Value for 'target_lang' not supported.",
  );
});

Deno.test("languagetool: servers inside the permissions only", () => {
  const free = ltSettings({});
  assertEquals([free.url, free.language, free.maxBytes, free.premium], [
    "https://api.languagetool.org",
    "auto",
    20_000,
    undefined,
  ]);
  assertEquals(ltSettings({ ltServer: "http://localhost:8081/v2/check/" }).url, "http://localhost:8081");
  assertEquals(ltSettings({ ltServer: "http://127.0.0.1:8010" }).maxBytes, undefined);
  const premium = ltSettings({ ltServer: "https://api.languagetoolplus.com", ltUser: "me@example.com", ltKey: "k" });
  assertEquals(premium.premium, { username: "me@example.com", apiKey: "k" });
  assertThrows(() => ltSettings({ ltServer: "https://lt.example.com" }), Error, "localhost");
  assertThrows(() => ltSettings({ ltServer: "http://api.languagetool.org" }), Error);
  assertThrows(() => ltSettings({ ltServer: "not a url" }), Error, "not a LanguageTool");
});

Deno.test("languagetool: request body", () => {
  const body = checkBody("Hello", { ...ltSettings({ ltVariants: "en-GB, de-CH", ltPicky: true }) });
  assertEquals(Object.fromEntries(body), {
    text: "Hello",
    language: "auto",
    preferredVariants: "en-GB,de-CH",
    level: "picky",
  });
  const fixed = checkBody(
    "Hallo",
    ltSettings({
      ltLanguage: "de-DE",
      ltVariants: "en-GB",
      ltUser: "u",
      ltKey: "k",
      ltServer: "https://api.languagetoolplus.com",
    }),
  );
  assertEquals(Object.fromEntries(fixed), { text: "Hallo", language: "de-DE", username: "u", apiKey: "k" });
  assertMatch(ltError(429, "", { url: "https://api.languagetool.org" }).message, /20 checks a minute/);
});

// A real answer from api.languagetool.org/v2/check, trimmed.
const TEXT = "This are a exemple with teh error.";
const RESPONSE: LtResponse = {
  language: {
    name: "English (US)",
    code: "en-US",
    detectedLanguage: { name: "English (US)", code: "en-US", confidence: 0.99 },
  },
  matches: [
    {
      message: "Did you mean “is”?",
      shortMessage: "Grammatical problem",
      replacements: [{ value: "is" }],
      offset: 5,
      length: 3,
      context: { text: TEXT, offset: 5, length: 3 },
      rule: {
        id: "THIS_NNS_VB",
        description: "this/these + verb agreement",
        issueType: "grammar",
        category: { id: "GRAMMAR", name: "Grammar" },
      },
    },
    {
      message: "Use “an” instead of “a” if the following word starts with a vowel sound.",
      replacements: [{ value: "an" }],
      offset: 9,
      length: 1,
      context: { text: TEXT, offset: 9, length: 1 },
      rule: {
        id: "EN_A_VS_AN",
        description: "a vs an",
        issueType: "misspelling",
        category: { id: "MISC", name: "Miscellaneous" },
      },
    },
    {
      message: "Possible spelling mistake found.",
      shortMessage: "Spelling mistake",
      replacements: [{ value: "example" }, { value: "exempla" }, { value: "example" }],
      offset: 11,
      length: 7,
      context: { text: TEXT, offset: 11, length: 7 },
      rule: {
        id: "MORFOLOGIK_RULE_EN_US",
        description: "Possible spelling mistake",
        issueType: "misspelling",
        category: { id: "TYPOS", name: "Possible Typo" },
        urls: [{ value: "https://languagetool.org/insights/post/spelling/" }],
      },
    },
    {
      message: "Possible spelling mistake found.",
      replacements: [{ value: "the" }, { value: "tea" }],
      offset: 24,
      length: 3,
      context: { text: TEXT, offset: 24, length: 3 },
      rule: { id: "MORFOLOGIK_RULE_EN_US", issueType: "misspelling", category: { id: "TYPOS", name: "Possible Typo" } },
    },
  ],
};

Deno.test("languagetool: matches become issues", () => {
  const r = parseCheck(TEXT, RESPONSE);
  assertEquals([r.language, r.languageCode], ["English (US)", "en-US"]);
  assertEquals(r.issues.map((i) => i.error), ["are", "a", "exemple", "teh"]);
  assertEquals(r.issues[2].replacements, ["example", "exempla"]); // duplicates dropped
  assertEquals(r.issues[2].category, "Possible Typo");
  assertEquals(r.issues[2].url, "https://languagetool.org/insights/post/spelling/");
  assertEquals(fixTitle(r.issues[3]), "teh → the");
  assertEquals(parseCheck("ok", {}).issues, []);
});

Deno.test("languagetool: context in bold, the whole text highlighted", () => {
  const [, , exemple] = parseCheck(TEXT, RESPONSE).issues;
  assertEquals(highlight(exemple), "This are a **exemple** with teh error.");
  assertEquals(highlight({ context: { text: "a * b c", offset: 2, length: 1 } }), "a **\\*** b c");
  const all = highlightAll(TEXT, parseCheck(TEXT, RESPONSE).issues);
  assertEquals(all, "This **are** **a** **exemple** with **teh** error.");
});

Deno.test("languagetool: one fix, then all of them from the end", () => {
  const issues = parseCheck(TEXT, RESPONSE).issues;
  assertEquals(applyFix(TEXT, issues[3], "the"), "This are a exemple with the error.");
  assertEquals(applyAll(TEXT, issues), { text: "This is an example with the error.", applied: 4 });
  // Overlaps keep the first; issues without a suggestion are skipped.
  const overlapping = [
    { ...issues[2], replacements: ["sample"] },
    { ...issues[2], offset: 12, length: 3, replacements: ["x"] },
    { ...issues[0], replacements: [] },
  ];
  assertEquals(applyAll(TEXT, overlapping), { text: "This are a sample with teh error.", applied: 1 });
});

Deno.test("text helpers", () => {
  assertEquals(words("L'été est là, c’est-à-dire 2026."), 5);
  assertEquals(preview("one\n two   three", 9), "one two…");
  assertEquals(preview("short"), "short");
});
