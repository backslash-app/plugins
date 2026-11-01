import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  atbash,
  caesar,
  caesarGuesses,
  conversions,
  decodings,
  EXAMPLES,
  FRENCH,
  fromA1Z26,
  fromBinary,
  fromBraille,
  fromHex,
  fromMorse,
  fromUpsideDown,
  isA1Z26,
  isBinary,
  isHex,
  isMorse,
  MORSE,
  NATO,
  parseQuery,
  rot13,
  rot47,
  spell,
  toA1Z26,
  toBinary,
  toBraille,
  toHex,
  toMorse,
  unspell,
  upsideDown,
  vigenere,
} from "./lib.ts";

Deno.test("manifest", async () => {
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(m.extension.id, "morse-ciphers");
  assertEquals(m.extension.version, "1.0.0");
  assertEquals(m.extension.categories, ["everyday"]);
  assertEquals(m.permissions, undefined);
  const keywords: string[] = m.commands[0].keywords;
  assertEquals(new Set(keywords).size, keywords.length);
});

Deno.test("morse: encode and decode", () => {
  assertEquals(toMorse("SOS").morse, "... --- ...");
  assertEquals(toMorse("Hello world").morse, ".... . .-.. .-.. --- / .-- --- .-. .-.. -..");
  assertEquals(fromMorse(".... . .-.. .-.. --- / .-- --- .-. .-.. -..").text, "HELLO WORLD");
  // Pasted look-alikes and other word separators.
  assertEquals(fromMorse("··· −−− ···").text, "SOS");
  assertEquals(fromMorse("... ---   ...").text, "SO S");
  assertEquals(fromMorse("-- --- .-. ... . | -.-. --- -.. .").text, "MORSE CODE");
  // Accents: the ones Morse has, and the others written without.
  assertEquals(toMorse("é").morse, "..-..");
  assertEquals(toMorse("Ê").morse, "..-..");
  assertEquals(toMorse("ô").morse, "---");
  assertEquals(fromMorse("..-.. -.-..").text, "ÉÇ");
  // Prosigns.
  assertEquals(toMorse("<SOS>").morse, "...---...");
  assertEquals(fromMorse("...---...").text, "<SOS>");
  assertEquals(fromMorse("...-.-").text, "<SK>");
  // A code that shares a character keeps the character.
  assertEquals(fromMorse(".-.-.").text, "+");
  const odd = toMorse("a#b");
  assertEquals(odd.morse, ".- -...");
  assertEquals(odd.skipped, ["#"]);
  assertEquals(fromMorse(".-.-.-.-.-").unknown, [".-.-.-.-.-"]);
  assert(isMorse("... --- ..."));
  assert(!isMorse("hello"));
  assert(!isMorse("   "));
  // Every code decodes to its character.
  for (const [ch, code] of Object.entries(MORSE)) assertEquals(fromMorse(code).text, ch);
  assertEquals(new Set(Object.values(MORSE)).size, Object.keys(MORSE).length);
});

Deno.test("caesar, rot13, rot47, atbash", () => {
  assertEquals(caesar("Attack at Dawn!", 3), "Dwwdfn dw Gdzq!");
  assertEquals(caesar("Dwwdfn", -3), "Attack");
  assertEquals(caesar("abc", 29), "def");
  assertEquals(caesar("abc", -1), "zab");
  assertEquals(rot13("Hello"), "Uryyb");
  assertEquals(rot13(rot13("Round trip, 123")), "Round trip, 123");
  assertEquals(rot47("Hello, World!"), "w6==@[ (@C=5P");
  assertEquals(rot47(rot47("p@ss~word{1}")), "p@ss~word{1}");
  assertEquals(atbash("Hello"), "Svool");
  assertEquals(atbash(atbash("Zebra")), "Zebra");
});

Deno.test("caesar: the best guess finds English and French", () => {
  const english = caesar("The quick brown fox jumps over the lazy dog while the band plays", 7);
  const [best] = caesarGuesses(english);
  assertEquals(best.shift, 7);
  assertEquals(best.text, "The quick brown fox jumps over the lazy dog while the band plays");
  const french = caesar("Le petit chat est dans le jardin avec sa mère et elle mange des pommes", 11);
  const [guess] = caesarGuesses(french);
  assertEquals(guess.shift, 11);
  assertEquals(guess.language, "french");
  assertEquals(caesarGuesses("abc").length, 26);
});

Deno.test("vigenère", () => {
  assertEquals(vigenere("ATTACKATDAWN", "LEMON"), "LXFOPVEFRNHR");
  assertEquals(vigenere("LXFOPVEFRNHR", "LEMON", true), "ATTACKATDAWN");
  // Spaces and punctuation don't use up the key; case is kept.
  assertEquals(vigenere("attack at dawn!", "lemon"), "lxfopv ef rnhr!");
  assertEquals(vigenere("Clé", "é"), "Gpé");
  assertThrows(() => vigenere("x", "123"), Error, "letter");
});

Deno.test("spelling alphabets", () => {
  assertEquals(spell("Hi 2", NATO), "Hotel India / Two");
  assertEquals(unspell("Hotel India / Two", NATO), "HI 2");
  assertEquals(unspell("hotel echo lima lima oscar", NATO), "HELLO");
  assertEquals(unspell("Alpha Juliet Xray Niner", NATO), "AJX9");
  assertEquals(unspell("Hotel Banana", NATO), undefined);
  assertEquals(spell("Zoé", FRENCH), "Zoé Oscar Eugène");
  assertEquals(unspell("Anatole Berthe Célestin", FRENCH), "ABC");
  assertEquals(unspell("anatole berthe celestin", FRENCH), "ABC");
  for (const alphabet of [NATO, FRENCH]) {
    const words = Object.values(alphabet.words).map((w) => w.toLowerCase());
    assertEquals(new Set(words).size, words.length, alphabet.id);
  }
});

Deno.test("a1z26, binary, hex", () => {
  assertEquals(toA1Z26("Hi there"), "8-9 20-8-5-18-5");
  assertEquals(fromA1Z26("8-9 20-8-5-18-5"), "HI THERE");
  assertEquals(fromA1Z26("8 5 12 12 15"), "HELLO");
  assert(isA1Z26("8-5-12-12-15"));
  assert(!isA1Z26("8-5-30"));
  assert(!isA1Z26("12"));
  assertEquals(toBinary("Hi"), "01001000 01101001");
  assertEquals(fromBinary("01001000 01101001"), "Hi");
  assertEquals(fromBinary("0100100001101001"), "Hi");
  assertEquals(toBinary("é"), "11000011 10101001");
  assertEquals(fromBinary("11000011 10101001"), "é");
  assertEquals(fromBinary("00000001"), undefined);
  assert(isBinary("01001000 01101001"));
  assert(!isBinary("0101"));
  assertEquals(toHex("Hi!"), "48 69 21");
  assertEquals(fromHex("48 69 21"), "Hi!");
  assertEquals(fromHex("0x486921"), "Hi!");
  assertEquals(fromHex("48:69"), "Hi");
  assert(isHex("48 65 6c 6c 6f"));
  assert(!isHex("cafe"));
  assert(!isHex("deadbeef"));
  assert(!isHex("hello"));
  assertEquals(fromHex("ff fe"), undefined);
});

Deno.test("braille", () => {
  assertEquals(toBraille("hello").braille, "⠓⠑⠇⠇⠕");
  assertEquals(toBraille("Hi").braille, "⠠⠓⠊");
  assertEquals(toBraille("2026").braille, "⠼⠃⠚⠃⠋");
  assertEquals(toBraille("3a").braille, "⠼⠉⠰⠁");
  assertEquals(toBraille("Yes, no!").braille, "⠠⠽⠑⠎⠂ ⠝⠕⠖");
  assertEquals(toBraille("a#").skipped, ["#"]);
  for (const text of ["Hello world", "Room 101, floor 3a", "Yes? No! (maybe)", "Élève"]) {
    assertEquals(fromBraille(toBraille(text).braille), text.normalize("NFD").replace(/\p{M}/gu, ""));
  }
});

Deno.test("upside down", () => {
  assertEquals(upsideDown("hello"), "ollǝɥ");
  assertEquals(upsideDown("Why?"), "¿ʎɥM");
  for (const text of ["Hello World", "Upside down 2026!", "pdqb nu 69"]) {
    assertEquals(fromUpsideDown(upsideDown(text)), text);
  }
});

Deno.test("decoding what was typed", () => {
  const formats = (s: string) => decodings(s).map((d) => `${d.format}:${d.text}`);
  assertEquals(formats("... --- ..."), ["morse:SOS"]);
  assertEquals(formats("01001000 01101001"), ["binary:Hi"]);
  assertEquals(formats("48 69 21"), ["hex:Hi!"]);
  assertEquals(formats("8-5-12-12-15"), ["a1z26:HELLO"]);
  assertEquals(formats("⠓⠑⠇⠇⠕"), ["braille:hello"]);
  assertEquals(formats("ollǝɥ"), ["upside-down:hello"]);
  assertEquals(formats("Hotel Echo Lima Lima Oscar"), ["nato:HELLO"]);
  assertEquals(formats("Anatole Berthe"), ["french:AB"]);
  // Oscar and Victor are in both alphabets: one answer, from NATO.
  assertEquals(formats("Oscar Victor"), ["nato:OV"]);
  assertEquals(formats("Hello world"), []);
  assertEquals(formats("cafe"), []);
  assertEquals(formats(""), []);
});

Deno.test("conversions write the text every way, and read back", () => {
  const all = conversions("Hello 42");
  assertEquals(all.map((c) => c.id), [
    "morse",
    "nato",
    "french",
    "rot13",
    "rot47",
    "atbash",
    "a1z26",
    "binary",
    "hex",
    "braille",
    "upside-down",
  ]);
  const byId = Object.fromEntries(all.map((c) => [c.id, c.output]));
  assertEquals(fromMorse(byId.morse).text, "HELLO 42");
  assertEquals(unspell(byId.nato, NATO), "HELLO 42");
  assertEquals(unspell(byId.french, FRENCH), "HELLO 42");
  assertEquals(fromBinary(byId.binary), "Hello 42");
  assertEquals(fromHex(byId.hex), "Hello 42");
  assertEquals(fromBraille(byId.braille), "Hello 42");
  assertEquals(fromUpsideDown(byId["upside-down"]), "Hello 42");
  // Nothing to write is left out (A1Z26 of digits is empty).
  assertEquals(conversions("42").some((c) => c.id === "a1z26"), false);
});

Deno.test("queries", () => {
  assertEquals(parseQuery("  "), { kind: "empty" });
  assertEquals(parseQuery("hello"), { kind: "auto", text: "hello" });
  assertEquals(parseQuery("caesar 3 attack"), { kind: "caesar", text: "attack", shift: 3 });
  assertEquals(parseQuery("César -1 abc"), { kind: "caesar", text: "abc", shift: 25 });
  assertEquals(parseQuery("rot 5 abc"), { kind: "caesar", text: "abc", shift: 5 });
  assertEquals(parseQuery("caesar Wkh txlfn"), { kind: "caesar", text: "Wkh txlfn", shift: undefined });
  assertEquals(parseQuery("Vigenère LEMON attack at dawn"), { kind: "vigenere", key: "LEMON", text: "attack at dawn" });
  assertEquals(parseQuery("vigenere LEMON").kind, "error");
  assertEquals(parseQuery("vigenere 123 abc").kind, "error");
  // Every example reads as something.
  for (const e of EXAMPLES) assert(parseQuery(e.query).kind !== "error", e.query);
});
