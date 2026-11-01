// Morse code, spelling alphabets and classic ciphers, both ways. Pure functions, no network.

// ---------------------------------------------------------------------------
// Text helpers

/** Removes accents: "Élève" → "Eleve". */
export function stripAccents(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").normalize("NFC");
}

const A = "A".charCodeAt(0);
const a = "a".charCodeAt(0);

/** Shifts the Latin letters of `text` by `shift` places, keeping case; everything else stays. */
export function caesar(text: string, shift: number): string {
  const s = ((shift % 26) + 26) % 26;
  return text.replace(/[A-Za-z]/g, (ch) => {
    const base = ch <= "Z" ? A : a;
    return String.fromCharCode(base + (ch.charCodeAt(0) - base + s) % 26);
  });
}

export const rot13 = (text: string): string => caesar(text, 13);

/** ROT47: rotates every printable ASCII character from `!` to `~`; its own inverse. */
export function rot47(text: string): string {
  return text.replace(/[!-~]/g, (ch) => String.fromCharCode(33 + (ch.charCodeAt(0) - 33 + 47) % 94));
}

/** Atbash: A↔Z, B↔Y…; its own inverse. */
export function atbash(text: string): string {
  return text.replace(/[A-Za-z]/g, (ch) => {
    const base = ch <= "Z" ? A : a;
    return String.fromCharCode(base + 25 - (ch.charCodeAt(0) - base));
  });
}

/** Vigenère with a letter key; non-letters are copied and don't use up the key. */
export function vigenere(text: string, key: string, decrypt = false): string {
  const shifts = stripAccents(key).toUpperCase().replace(/[^A-Z]/g, "").split("").map((c) => c.charCodeAt(0) - A);
  if (!shifts.length) throw new Error("The key needs at least one letter");
  let i = 0;
  return text.replace(/[A-Za-z]/g, (ch) => {
    const s = shifts[i++ % shifts.length];
    return caesar(ch, decrypt ? -s : s);
  });
}

// ---------------------------------------------------------------------------
// Caesar: guess the shift from letter frequencies

/** Letter frequencies in percent, A to Z. */
export const FREQUENCIES = {
  english: [
    8.167,
    1.492,
    2.782,
    4.253,
    12.702,
    2.228,
    2.015,
    6.094,
    6.966,
    0.153,
    0.772,
    4.025,
    2.406,
    6.749,
    7.507,
    1.929,
    0.095,
    5.987,
    6.327,
    9.056,
    2.758,
    0.978,
    2.360,
    0.150,
    1.974,
    0.074,
  ],
  french: [
    7.636,
    0.901,
    3.260,
    3.669,
    14.715,
    1.066,
    0.866,
    0.737,
    7.529,
    0.613,
    0.074,
    5.456,
    2.968,
    7.095,
    5.796,
    2.521,
    1.362,
    6.693,
    7.948,
    7.244,
    6.311,
    1.838,
    0.049,
    0.427,
    0.128,
    0.326,
  ],
} as const;

export type Language = keyof typeof FREQUENCIES;

/** Chi-squared distance between the letters of `text` and a language; lower is closer. */
export function chiSquared(text: string, language: Language): number {
  const counts = new Array(26).fill(0);
  let total = 0;
  for (const ch of stripAccents(text).toUpperCase()) {
    const i = ch.charCodeAt(0) - A;
    if (i >= 0 && i < 26) {
      counts[i]++;
      total++;
    }
  }
  if (!total) return Infinity;
  return counts.reduce((sum, n, i) => {
    const expected = FREQUENCIES[language][i] / 100 * total;
    return sum + (n - expected) ** 2 / expected;
  }, 0);
}

export interface CaesarGuess {
  /** The shift that was applied to encrypt; decrypting shifts back by it. */
  shift: number;
  text: string;
  language: Language;
  score: number;
}

/** Every shift (1 to 25) of a Caesar-encrypted text, the most likely plaintext first. */
export function caesarGuesses(text: string): CaesarGuess[] {
  const guesses: CaesarGuess[] = [];
  for (let shift = 0; shift < 26; shift++) {
    const plain = caesar(text, -shift);
    const [language, score] = (Object.keys(FREQUENCIES) as Language[])
      .map((l) => [l, chiSquared(plain, l)] as const)
      .sort((x, y) => x[1] - y[1])[0];
    guesses.push({ shift, text: plain, language, score });
  }
  return guesses.sort((x, y) => x.score - y.score || x.shift - y.shift);
}

// ---------------------------------------------------------------------------
// Morse

/** International Morse (ITU-R M.1677) plus the usual accented letters. */
export const MORSE: Record<string, string> = {
  A: ".-",
  B: "-...",
  C: "-.-.",
  D: "-..",
  E: ".",
  F: "..-.",
  G: "--.",
  H: "....",
  I: "..",
  J: ".---",
  K: "-.-",
  L: ".-..",
  M: "--",
  N: "-.",
  O: "---",
  P: ".--.",
  Q: "--.-",
  R: ".-.",
  S: "...",
  T: "-",
  U: "..-",
  V: "...-",
  W: ".--",
  X: "-..-",
  Y: "-.--",
  Z: "--..",
  "0": "-----",
  "1": ".----",
  "2": "..---",
  "3": "...--",
  "4": "....-",
  "5": ".....",
  "6": "-....",
  "7": "--...",
  "8": "---..",
  "9": "----.",
  ".": ".-.-.-",
  ",": "--..--",
  "?": "..--..",
  "'": ".----.",
  "!": "-.-.--",
  "/": "-..-.",
  "(": "-.--.",
  ")": "-.--.-",
  "&": ".-...",
  ":": "---...",
  ";": "-.-.-.",
  "=": "-...-",
  "+": ".-.-.",
  "-": "-....-",
  _: "..--.-",
  '"': ".-..-.",
  $: "...-..-",
  "@": ".--.-.",
  À: ".--.-",
  Ä: ".-.-",
  Ç: "-.-..",
  É: "..-..",
  È: ".-..-",
  Ñ: "--.--",
  Ö: "---.",
  Ü: "..--",
};

/** Procedural signals, written `<SOS>` and sent without gaps between letters. */
export const PROSIGNS: Record<string, string> = {
  SOS: "...---...",
  AR: ".-.-.",
  SK: "...-.-",
  BT: "-...-",
  KN: "-.--.",
  AS: ".-...",
  CT: "-.-.-",
  HH: "........",
};

/** Letters that share a code with one in {@link MORSE}: decoded as the first. */
const MORSE_ALIASES: Record<string, string> = { Å: "À", Æ: "Ä", Ø: "Ö", Ê: "É" };

const FROM_MORSE: Record<string, string> = {};
for (const [ch, code] of Object.entries(MORSE)) FROM_MORSE[code] ??= ch;
for (const [name, code] of Object.entries(PROSIGNS)) FROM_MORSE[code] ??= `<${name}>`;

/** Characters that can't be sent in Morse are dropped and listed. */
export function toMorse(text: string): { morse: string; skipped: string[] } {
  const skipped = new Set<string>();
  const words = text.trim().split(/\s+/).filter(Boolean).map((word) => {
    const codes: string[] = [];
    for (const m of word.toUpperCase().matchAll(/<([A-Z]+)>|./gsu)) {
      if (m[1] && PROSIGNS[m[1]]) {
        codes.push(PROSIGNS[m[1]]);
        continue;
      }
      let ch = m[0];
      ch = MORSE_ALIASES[ch] ?? ch;
      const code = MORSE[ch] ?? MORSE[stripAccents(ch)];
      if (code) codes.push(code);
      else skipped.add(m[0]);
    }
    return codes.join(" ");
  }).filter(Boolean);
  return { morse: words.join(" / "), skipped: [...skipped] };
}

/** Accepts `.` `-`, and the look-alikes people paste: `·` `•` `_` `−` `–` `—`. */
export function normalizeMorse(text: string): string {
  return text.replace(/[·•∙⋅]/g, ".").replace(/[_−–—‒]/g, "-");
}

export function isMorse(text: string): boolean {
  const t = normalizeMorse(text).trim();
  return /^[.\-\s/|]+$/.test(t) && /[.-]/.test(t);
}

/** Words are separated by `/`, `|` or three spaces or more; letters by a space. */
export function fromMorse(text: string): { text: string; unknown: string[] } {
  const unknown = new Set<string>();
  const words = normalizeMorse(text).trim().split(/\s*[/|]\s*|\s{3,}/).map((word) =>
    word.trim().split(/\s+/).filter(Boolean).map((code) => {
      const ch = FROM_MORSE[code];
      if (!ch) unknown.add(code);
      return ch ?? "�";
    }).join("")
  ).filter(Boolean);
  return { text: words.join(" "), unknown: [...unknown] };
}

// ---------------------------------------------------------------------------
// Spelling alphabets

export interface SpellingAlphabet {
  id: "nato" | "french";
  title: string;
  words: Record<string, string>;
  /** Other spellings accepted when reading. */
  variants: Record<string, string>;
}

export const NATO: SpellingAlphabet = {
  id: "nato",
  title: "NATO phonetic alphabet",
  words: {
    A: "Alfa",
    B: "Bravo",
    C: "Charlie",
    D: "Delta",
    E: "Echo",
    F: "Foxtrot",
    G: "Golf",
    H: "Hotel",
    I: "India",
    J: "Juliett",
    K: "Kilo",
    L: "Lima",
    M: "Mike",
    N: "November",
    O: "Oscar",
    P: "Papa",
    Q: "Quebec",
    R: "Romeo",
    S: "Sierra",
    T: "Tango",
    U: "Uniform",
    V: "Victor",
    W: "Whiskey",
    X: "X-ray",
    Y: "Yankee",
    Z: "Zulu",
    "0": "Zero",
    "1": "One",
    "2": "Two",
    "3": "Three",
    "4": "Four",
    "5": "Five",
    "6": "Six",
    "7": "Seven",
    "8": "Eight",
    "9": "Nine",
    "-": "Dash",
    ".": "Stop",
  },
  variants: {
    ALPHA: "A",
    JULIET: "J",
    XRAY: "X",
    WHISKY: "W",
    NINER: "9",
    TREE: "3",
    FIFE: "5",
    FOWER: "4",
    DECIMAL: ".",
    POINT: ".",
    HYPHEN: "-",
  },
};

/** The traditional French spelling alphabet (alphabet radio français). */
export const FRENCH: SpellingAlphabet = {
  id: "french",
  title: "French spelling alphabet",
  words: {
    A: "Anatole",
    B: "Berthe",
    C: "Célestin",
    D: "Désiré",
    E: "Eugène",
    F: "François",
    G: "Gaston",
    H: "Henri",
    I: "Irma",
    J: "Joseph",
    K: "Kléber",
    L: "Louis",
    M: "Marcel",
    N: "Nicolas",
    O: "Oscar",
    P: "Pierre",
    Q: "Quintal",
    R: "Raoul",
    S: "Suzanne",
    T: "Thérèse",
    U: "Ursule",
    V: "Victor",
    W: "William",
    X: "Xavier",
    Y: "Yvonne",
    Z: "Zoé",
    "0": "Zéro",
    "1": "Un",
    "2": "Deux",
    "3": "Trois",
    "4": "Quatre",
    "5": "Cinq",
    "6": "Six",
    "7": "Sept",
    "8": "Huit",
    "9": "Neuf",
    "-": "Tiret",
    ".": "Point",
  },
  variants: { HENRY: "H", THERESE: "T", ZOE: "Z" },
};

const wordKey = (w: string) => stripAccents(w).toUpperCase().replace(/[^A-Z]/g, "");

/** "Hi 2" → "Hotel India / Two"; characters without a word are kept as they are. */
export function spell(text: string, alphabet: SpellingAlphabet): string {
  return text.trim().split(/\s+/).filter(Boolean).map((word) =>
    [...stripAccents(word).toUpperCase()].map((ch) => alphabet.words[ch] ?? ch).join(" ")
  ).join(" / ");
}

function readingTable(alphabet: SpellingAlphabet): Map<string, string> {
  const table = new Map<string, string>();
  for (const [ch, word] of Object.entries(alphabet.words)) table.set(wordKey(word), ch);
  for (const [word, ch] of Object.entries(alphabet.variants)) table.set(word, ch);
  return table;
}

/** "Hotel India / Two" → "HI 2", or undefined when a word isn't in the alphabet. */
export function unspell(text: string, alphabet: SpellingAlphabet): string | undefined {
  const table = readingTable(alphabet);
  const words = text.trim().split(/\s*[/|]\s*|\s{2,}/).filter(Boolean);
  const out: string[] = [];
  for (const word of words) {
    let letters = "";
    for (const token of word.split(/[\s,]+/).filter(Boolean)) {
      const ch = table.get(wordKey(token));
      if (ch === undefined) return undefined;
      letters += ch;
    }
    out.push(letters);
  }
  return out.length ? out.join(" ") : undefined;
}

// ---------------------------------------------------------------------------
// A1Z26, binary, hex

/** "Hi there" → "8-9 20-8-5-18-5"; other characters are dropped. */
export function toA1Z26(text: string): string {
  return stripAccents(text).toUpperCase().split(/\s+/).map((word) =>
    [...word].filter((c) => c >= "A" && c <= "Z").map((c) => c.charCodeAt(0) - A + 1).join("-")
  ).filter(Boolean).join(" ");
}

export function isA1Z26(text: string): boolean {
  const t = text.trim();
  return /^\d{1,2}([-.,\s]+\d{1,2})*$/.test(t) && t.split(/[^\d]+/).every((n) => +n >= 1 && +n <= 26) &&
    /[-.,\s]/.test(t);
}

/** Numbers joined by `-` (or `.`/`,`) form a word; spaces separate words. */
export function fromA1Z26(text: string): string {
  const t = text.trim();
  const hasJoiners = /\d[-.,]\d/.test(t);
  const words = hasJoiners ? t.split(/\s+/) : [t];
  return words.map((w) =>
    w.split(/[-.,\s]+/).filter(Boolean).map((n) => String.fromCharCode(A + Number(n) - 1)).join("")
  ).join(" ");
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function toBinary(text: string): string {
  return [...encoder.encode(text)].map((b) => b.toString(2).padStart(8, "0")).join(" ");
}

export function toHex(text: string): string {
  return [...encoder.encode(text)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

export function isBinary(text: string): boolean {
  const bits = text.replace(/\s+/g, "");
  return /^[01\s]+$/.test(text.trim()) && bits.length >= 8 && bits.length % 8 === 0;
}

export function isHex(text: string): boolean {
  const t = text.trim().replace(/^0x/i, "");
  if (!/^[0-9a-f\s:]+$/i.test(t)) return false;
  const digits = t.replace(/[\s:]/g, "");
  if (digits.length < 4 || digits.length % 2) return false;
  // Groups, when there are any, must be bytes; "deadbeef" alone could be a word, so it needs a digit.
  const groups = t.split(/[\s:]+/).filter(Boolean);
  if (groups.length > 1) return groups.every((g) => g.length === 2);
  return /\d/.test(digits);
}

/** Decodes UTF-8 bytes; undefined when they aren't valid text. */
function bytesToText(bytes: number[]): string | undefined {
  try {
    const text = decoder.decode(new Uint8Array(bytes));
    // Control characters other than whitespace mean it wasn't text.
    return [...text].some((ch) => {
        const c = ch.charCodeAt(0);
        return c < 9 || (c > 13 && c < 32) || c === 127;
      })
      ? undefined
      : text;
  } catch {
    return undefined;
  }
}

export function fromBinary(text: string): string | undefined {
  const bits = text.replace(/\s+/g, "");
  const bytes = bits.match(/.{8}/g)?.map((b) => parseInt(b, 2)) ?? [];
  return bytesToText(bytes);
}

export function fromHex(text: string): string | undefined {
  const digits = text.trim().replace(/^0x/i, "").replace(/[\s:]/g, "");
  const bytes = digits.match(/.{2}/g)?.map((h) => parseInt(h, 16)) ?? [];
  return bytesToText(bytes);
}

// ---------------------------------------------------------------------------
// Braille (Grade 1, Unicode)

const BRAILLE_LETTERS = "⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠅⠇⠍⠝⠕⠏⠟⠗⠎⠞⠥⠧⠺⠭⠽⠵";
const BRAILLE_PUNCTUATION: Record<string, string> = {
  ",": "⠂",
  ";": "⠆",
  ":": "⠒",
  ".": "⠲",
  "!": "⠖",
  "?": "⠦",
  "'": "⠄",
  "-": "⠤",
  "(": "⠐⠣",
  ")": "⠐⠜",
  '"': "⠘⠦",
};
export const BRAILLE_CAPITAL = "⠠";
export const BRAILLE_NUMBER = "⠼";

/** Uncontracted (Grade 1) English braille: letters, digits with the number sign, capitals, common punctuation. */
export function toBraille(text: string): { braille: string; skipped: string[] } {
  const skipped = new Set<string>();
  let out = "";
  let inNumber = false;
  for (const ch of stripAccents(text)) {
    if (/\d/.test(ch)) {
      if (!inNumber) out += BRAILLE_NUMBER;
      inNumber = true;
      out += BRAILLE_LETTERS[(Number(ch) + 9) % 10];
      continue;
    }
    if (ch === "." && inNumber) {
      out += "⠲";
      continue;
    }
    const lower = ch.toLowerCase();
    if (lower >= "a" && lower <= "z") {
      // A letter a–j right after digits would read as a digit: the letter sign ends the number.
      if (inNumber && lower <= "j") out += "⠰";
      inNumber = false;
      if (ch !== lower) out += BRAILLE_CAPITAL;
      out += BRAILLE_LETTERS[lower.charCodeAt(0) - a];
      continue;
    }
    inNumber = false;
    if (/\s/.test(ch)) out += ch === "\n" ? "\n" : " ";
    else if (BRAILLE_PUNCTUATION[ch]) out += BRAILLE_PUNCTUATION[ch];
    else skipped.add(ch);
  }
  return { braille: out, skipped: [...skipped] };
}

export function isBraille(text: string): boolean {
  const t = text.trim();
  return /^[⠀-⣿\s]+$/.test(t) && /[⠁-⣿]/.test(t);
}

export function fromBraille(text: string): string {
  const punctuation = new Map(Object.entries(BRAILLE_PUNCTUATION).map(([k, v]) => [v, k]));
  let out = "";
  let capital = false;
  let number = false;
  const chars = [...text];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const pair = ch + (chars[i + 1] ?? "");
    if (punctuation.has(pair) && pair.length === 2) {
      out += punctuation.get(pair);
      i++;
      continue;
    }
    if (ch === BRAILLE_CAPITAL) {
      capital = true;
      continue;
    }
    if (ch === BRAILLE_NUMBER) {
      number = true;
      continue;
    }
    if (ch === "⠰") {
      number = false;
      continue;
    }
    if (/\s/.test(ch) || ch === "⠀") {
      number = false;
      out += ch === "\n" ? "\n" : " ";
      continue;
    }
    const letter = BRAILLE_LETTERS.indexOf(ch);
    if (number && letter >= 0 && letter < 10) {
      out += String((letter + 1) % 10);
      continue;
    }
    if (number && ch === "⠲") {
      out += ".";
      continue;
    }
    number = false;
    if (letter >= 0) {
      const l = String.fromCharCode(a + letter);
      out += capital ? l.toUpperCase() : l;
      capital = false;
      continue;
    }
    out += punctuation.get(ch) ?? "�";
  }
  return out;
}

// ---------------------------------------------------------------------------
// Upside-down text

const FLIP: Record<string, string> = {
  a: "ɐ",
  b: "q",
  c: "ɔ",
  d: "p",
  e: "ǝ",
  f: "ɟ",
  g: "ƃ",
  h: "ɥ",
  i: "ᴉ",
  j: "ɾ",
  k: "ʞ",
  l: "l",
  m: "ɯ",
  n: "u",
  o: "o",
  p: "d",
  q: "b",
  r: "ɹ",
  s: "s",
  t: "ʇ",
  u: "n",
  v: "ʌ",
  w: "ʍ",
  x: "x",
  y: "ʎ",
  z: "z",
  A: "∀",
  B: "ꓭ",
  C: "Ɔ",
  D: "ꓷ",
  E: "Ǝ",
  F: "Ⅎ",
  G: "⅁",
  H: "H",
  I: "I",
  J: "ꓩ",
  K: "ꓘ",
  L: "ꓶ",
  M: "W",
  N: "N",
  O: "O",
  P: "Ԁ",
  Q: "Ὁ",
  R: "ꓤ",
  S: "S",
  T: "ꓕ",
  U: "∩",
  V: "Λ",
  W: "M",
  X: "X",
  Y: "⅄",
  Z: "Z",
  "0": "0",
  "1": "Ɩ",
  "2": "ᄅ",
  "3": "Ɛ",
  "4": "ㄣ",
  "5": "ϛ",
  "6": "9",
  "7": "ㄥ",
  "8": "8",
  "9": "6",
  ".": "˙",
  ",": "'",
  "'": ",",
  '"': "„",
  "?": "¿",
  "!": "¡",
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
  "&": "⅋",
  _: "‾",
  ";": "؛",
};

const UNFLIP: Record<string, string> = {};
for (const [k, v] of Object.entries(FLIP)) UNFLIP[v] = k;
/** Characters that only appear in flipped text. */
const FLIPPED_ONLY = Object.values(FLIP).filter((v) => !(v in FLIP));

export function upsideDown(text: string): string {
  return [...stripAccents(text)].reverse().map((ch) => FLIP[ch] ?? ch).join("");
}

export function isUpsideDown(text: string): boolean {
  return [...text].some((ch) => FLIPPED_ONLY.includes(ch));
}

export function fromUpsideDown(text: string): string {
  return [...text].reverse().map((ch) => UNFLIP[ch] ?? ch).join("");
}

// ---------------------------------------------------------------------------
// What the user typed

export type Format = "morse" | "nato" | "french" | "binary" | "hex" | "a1z26" | "braille" | "upside-down";

export const FORMAT_TITLE: Record<Format, string> = {
  morse: "Morse code",
  nato: "NATO alphabet",
  french: "French spelling alphabet",
  binary: "Binary",
  hex: "Hexadecimal",
  a1z26: "A1Z26",
  braille: "Braille",
  "upside-down": "Upside-down text",
};

export interface Decoding {
  format: Format;
  text: string;
  note?: string;
}

/** Every format the input reads as, most specific first. */
export function decodings(input: string): Decoding[] {
  const t = input.trim();
  if (!t) return [];
  const found: Decoding[] = [];
  if (isMorse(t)) {
    const m = fromMorse(t);
    found.push({
      format: "morse",
      text: m.text,
      note: m.unknown.length ? `Unknown codes: ${m.unknown.join(" ")}` : undefined,
    });
  }
  if (isBinary(t)) {
    const text = fromBinary(t);
    if (text !== undefined) found.push({ format: "binary", text });
  }
  if (!isBinary(t) && isHex(t)) {
    const text = fromHex(t);
    if (text !== undefined) found.push({ format: "hex", text });
  }
  if (isA1Z26(t)) found.push({ format: "a1z26", text: fromA1Z26(t) });
  if (isBraille(t)) found.push({ format: "braille", text: fromBraille(t) });
  if (isUpsideDown(t)) found.push({ format: "upside-down", text: fromUpsideDown(t) });
  if (/[a-z]{3}/i.test(t)) {
    const nato = unspell(t, NATO);
    if (nato) found.push({ format: "nato", text: nato });
    const french = unspell(t, FRENCH);
    if (french && french !== nato) found.push({ format: "french", text: french });
  }
  return found;
}

export interface Conversion {
  id: string;
  title: string;
  output: string;
  /** Converting the output back gives the input again with this. */
  reversible: boolean;
  note?: string;
}

/** The input written every other way. */
export function conversions(text: string): Conversion[] {
  const morse = toMorse(text);
  const braille = toBraille(text);
  const list: Conversion[] = [
    {
      id: "morse",
      title: "Morse code",
      output: morse.morse,
      reversible: true,
      note: morse.skipped.length ? `No Morse for ${morse.skipped.join(" ")}` : undefined,
    },
    { id: "nato", title: "NATO alphabet", output: spell(text, NATO), reversible: true },
    { id: "french", title: "French spelling alphabet", output: spell(text, FRENCH), reversible: true },
    { id: "rot13", title: "ROT13", output: rot13(text), reversible: true },
    { id: "rot47", title: "ROT47", output: rot47(text), reversible: true },
    { id: "atbash", title: "Atbash", output: atbash(text), reversible: true },
    { id: "a1z26", title: "A1Z26", output: toA1Z26(text), reversible: false },
    { id: "binary", title: "Binary (UTF-8)", output: toBinary(text), reversible: true },
    { id: "hex", title: "Hexadecimal (UTF-8)", output: toHex(text), reversible: true },
    {
      id: "braille",
      title: "Braille (Grade 1)",
      output: braille.braille,
      reversible: true,
      note: braille.skipped.length ? `No braille for ${braille.skipped.join(" ")}` : undefined,
    },
    { id: "upside-down", title: "Upside down", output: upsideDown(text), reversible: true },
  ];
  return list.filter((c) => c.output.trim() !== "");
}

export type Query =
  | { kind: "empty" }
  | { kind: "auto"; text: string }
  | { kind: "caesar"; text: string; shift?: number }
  | { kind: "vigenere"; key: string; text: string }
  | { kind: "error"; message: string };

/** `caesar 3 text`, `caesar text`, `rot 5 text`, `vigenere KEY text`, or any text. */
export function parseQuery(query: string): Query {
  const q = query.trim();
  if (!q) return { kind: "empty" };
  const vig = /^vig[eéè]n[eéè]re\s+(\S+)(?:\s+([\s\S]*))?$/i.exec(q);
  if (vig) {
    if (!/[a-z]/i.test(stripAccents(vig[1]))) return { kind: "error", message: "The key needs at least one letter" };
    if (!vig[2]?.trim()) return { kind: "error", message: `Type the text after the key: vigenere ${vig[1]} …` };
    return { kind: "vigenere", key: vig[1], text: vig[2].trim() };
  }
  const cae = /^(?:c[ae]e?sar|c[ée]sar|rot)\s+(?:([+-]?\d{1,3})\s+)?([\s\S]+)$/i.exec(q);
  if (cae) {
    const shift = cae[1] === undefined ? undefined : ((Number(cae[1]) % 26) + 26) % 26;
    return { kind: "caesar", text: cae[2].trim(), shift };
  }
  return { kind: "auto", text: q };
}

export const EXAMPLES: { query: string; title: string }[] = [
  { query: "... --- ...", title: "Morse to text" },
  { query: "Hello world", title: "Text to Morse, NATO, ROT13, binary, braille…" },
  { query: "Hotel Echo Lima Lima Oscar", title: "NATO alphabet to text" },
  { query: "caesar Wkh txlfn eurzq ira", title: "Crack a Caesar cipher" },
  { query: "caesar 3 attack at dawn", title: "Shift by 3" },
  { query: "vigenere LEMON attack at dawn", title: "Vigenère with a key" },
  { query: "01001000 01101001", title: "Binary to text" },
  { query: "8-5-12-12-15", title: "A1Z26 to text" },
  { query: "⠓⠑⠇⠇⠕", title: "Braille to text" },
];
