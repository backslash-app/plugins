// Pure logic: romaji → kana, reading Jisho and kanjiapi.dev answers, list items.

import { type Action, copy, Icons, type Item, meta, type Metadata, open } from "@backslash/api";

// ---------------------------------------------------------------------------
// Romaji → kana

const ROWS: Record<string, string> = {
  "": "あいうえお",
  k: "かきくけこ",
  g: "がぎぐげご",
  s: "さしすせそ",
  z: "ざじずぜぞ",
  t: "たちつてと",
  d: "だぢづでど",
  n: "なにぬねの",
  h: "はひふへほ",
  b: "ばびぶべぼ",
  p: "ぱぴぷぺぽ",
  m: "まみむめも",
  r: "らりるれろ",
};
const VOWELS = "aiueo";
const SMALL_Y: Record<string, string> = { a: "ゃ", u: "ゅ", o: "ょ" };

/** Every romaji syllable (Hepburn and Kunrei-shiki) with its hiragana. */
export const SYLLABLES: Record<string, string> = (() => {
  const t: Record<string, string> = {};
  for (const [c, kana] of Object.entries(ROWS)) {
    [...kana].forEach((k, i) => t[c + VOWELS[i]] = k);
    if (c) {
      const i = [...kana][1];
      for (const [v, small] of Object.entries(SMALL_Y)) t[`${c}y${v}`] = i + small;
    }
  }
  for (const v of VOWELS) t[`l${v}`] = t[`r${v}`];
  for (const v of "auo") t[`ly${v}`] = t[`ry${v}`];
  Object.assign(t, {
    ya: "や",
    yu: "ゆ",
    yo: "よ",
    ye: "いぇ",
    wa: "わ",
    wi: "うぃ",
    we: "うぇ",
    wo: "を",
    shi: "し",
    chi: "ち",
    tsu: "つ",
    fu: "ふ",
    ji: "じ",
    sha: "しゃ",
    shu: "しゅ",
    sho: "しょ",
    she: "しぇ",
    cha: "ちゃ",
    chu: "ちゅ",
    cho: "ちょ",
    che: "ちぇ",
    ja: "じゃ",
    ju: "じゅ",
    jo: "じょ",
    je: "じぇ",
    jya: "じゃ",
    jyu: "じゅ",
    jyo: "じょ",
    fa: "ふぁ",
    fi: "ふぃ",
    fe: "ふぇ",
    fo: "ふぉ",
    va: "ゔぁ",
    vi: "ゔぃ",
    vu: "ゔ",
    ve: "ゔぇ",
    vo: "ゔぉ",
    ti: "ち",
    tu: "つ",
    hu: "ふ",
    si: "し",
    zi: "じ",
    di: "ぢ",
    du: "づ",
    xtsu: "っ",
    xtu: "っ",
  });
  return t;
})();

const MACRONS: Record<string, string> = { "ā": "aa", "ī": "ii", "ū": "uu", "ē": "ee", "ō": "ou", "â": "aa", "ô": "ou" };

/**
 * Hiragana for romaji typed the way IMEs accept it ("neko" → ねこ,
 * "konnichiha" → こんにちは, "kitte" → きって, "rāmen" → らあめん);
 * undefined when it isn't romaji.
 */
export function romajiToHiragana(input: string): string | undefined {
  const s = input.trim().toLowerCase().replace(/[āīūēōâô]/g, (c) => MACRONS[c]).replace(
    /[\s']+/g,
    (m) => m.includes("'") ? "'" : "",
  );
  if (!s || !/^[a-z'-]+$/.test(s)) return undefined;
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "-") {
      out += "ー";
      i++;
      continue;
    }
    if (c === "'") {
      i++;
      continue;
    }
    // n before a consonant (but not y), an apostrophe or the end: ん.
    if (c === "n") {
      const next = s[i + 1];
      if (next === "n" && !/[aiueoy]/.test(s[i + 2] ?? "")) {
        out += "ん";
        i += 2;
        continue;
      }
      if (next === undefined || next === "'" || next === "-" || !/[aiueoy]/.test(next)) {
        out += "ん";
        i++;
        continue;
      }
    }
    // A doubled consonant: small tsu ("kitte", "matcha").
    if (/[bcdfghjkmpqrstvwxyz]/.test(c) && (s[i + 1] === c || (c === "t" && s.startsWith("ch", i + 1)))) {
      out += "っ";
      i++;
      continue;
    }
    const match = [3, 2, 1].map((n) => s.slice(i, i + n)).find((chunk) => SYLLABLES[chunk]);
    if (!match) return undefined;
    out += SYLLABLES[match];
    i += match.length;
  }
  return out;
}

/** ひらがな → カタカナ (other characters unchanged). */
export function toKatakana(text: string): string {
  return text.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

/** カタカナ → ひらがな (other characters unchanged). */
export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

export const isKanji = (ch: string) => /\p{Script=Han}/u.test(ch);
export const hasJapanese = (text: string) => /[぀-ヿ\p{Script=Han}]/u.test(text);

/** The distinct kanji of a text, in order. */
export function kanjiOf(text: string, max = 6): string[] {
  return [...new Set([...text].filter(isKanji))].slice(0, max);
}

// ---------------------------------------------------------------------------
// Jisho

export interface JishoSense {
  english_definitions: string[];
  parts_of_speech: string[];
  tags?: string[];
  info?: string[];
  see_also?: string[];
  antonyms?: string[];
  restrictions?: string[];
  links?: { text: string; url: string }[];
}

export interface JishoWord {
  slug: string;
  is_common?: boolean;
  tags?: string[];
  jlpt?: string[];
  japanese: { word?: string; reading?: string }[];
  senses: JishoSense[];
  attribution?: { jmdict?: boolean | string; jmnedict?: boolean | string; dbpedia?: boolean | string };
}

export interface JishoResponse {
  meta?: { status: number };
  data?: JishoWord[];
}

export interface Sense {
  definitions: string[];
  partsOfSpeech: string[];
  notes: string[];
  seeAlso: string[];
  antonyms: string[];
}

export interface Word {
  slug: string;
  /** The main written form: kanji when there is one, else the reading. */
  word: string;
  reading: string;
  romaji: string;
  otherForms: { word?: string; reading?: string }[];
  common: boolean;
  /** "N5" … "N1". */
  jlpt?: string;
  /** WaniKani level, when the word is on WaniKani. */
  wanikani?: number;
  senses: Sense[];
  /** A name (JMnedict) or an encyclopedia entry rather than a dictionary word. */
  kind: "word" | "name" | "wikipedia";
}

/** "Usually written using kana alone" and the like, kept short. */
const NOTE_RENAMES: Record<string, string> = {
  "Usually written using kana alone": "usually in kana",
};

export function toWord(w: JishoWord): Word {
  const [first, ...rest] = w.japanese.length ? w.japanese : [{ word: w.slug }];
  const reading = first.reading ?? first.word ?? w.slug;
  const senses = w.senses
    .filter((s) => !s.parts_of_speech.includes("Wikipedia definition") || w.senses.length === 1)
    .map((s): Sense => ({
      definitions: s.english_definitions,
      partsOfSpeech: s.parts_of_speech,
      notes: [
        ...(s.tags ?? []).map((t) => NOTE_RENAMES[t] ?? t),
        ...(s.info ?? []),
        ...(s.restrictions ?? []).map((r) => `only for ${r}`),
      ],
      seeAlso: s.see_also ?? [],
      antonyms: s.antonyms ?? [],
    }));
  const jlpt =
    (w.jlpt ?? []).map((j) => /jlpt-n(\d)/.exec(j)?.[1]).filter(Boolean).map(Number).sort((a, b) => b - a)[0];
  const wk = (w.tags ?? []).map((t) => /^wanikani(\d+)$/.exec(t)?.[1]).find(Boolean);
  const onlyWiki = w.senses.length > 0 && w.senses.every((s) => s.parts_of_speech.includes("Wikipedia definition"));
  const name = !w.attribution?.jmdict && !!w.attribution?.jmnedict;
  return {
    slug: w.slug,
    word: first.word ?? reading,
    reading,
    romaji: kanaToRomaji(reading),
    otherForms: rest,
    common: !!w.is_common,
    jlpt: jlpt ? `N${jlpt}` : undefined,
    wanikani: wk ? Number(wk) : undefined,
    senses: senses.length ? senses : w.senses.map((s) => ({
      definitions: s.english_definitions,
      partsOfSpeech: s.parts_of_speech,
      notes: [],
      seeAlso: [],
      antonyms: [],
    })),
    kind: onlyWiki ? "wikipedia" : name ? "name" : "word",
  };
}

export function parseJisho(res: JishoResponse): Word[] {
  return (res.data ?? []).map(toWord);
}

export const jishoUrl = (keyword: string) =>
  `https://jisho.org/api/v1/search/words?${new URLSearchParams({ keyword })}`;
export const jishoWordPage = (slug: string) => `https://jisho.org/word/${encodeURIComponent(slug)}`;
export const jishoSearchPage = (query: string) => `https://jisho.org/search/${encodeURIComponent(query)}`;
export const jishoKanjiPage = (kanji: string) => `https://jisho.org/search/${encodeURIComponent(`${kanji} #kanji`)}`;

// ---------------------------------------------------------------------------
// Kana → romaji (for display)

const ROMAJI: Record<string, string> = (() => {
  const t: Record<string, string> = {};
  // Preferred Hepburn spellings win over Kunrei ones.
  const preferred = ["shi", "chi", "tsu", "fu", "ji", "sha", "shu", "sho", "cha", "chu", "cho", "ja", "ju", "jo"];
  for (const [r, k] of Object.entries(SYLLABLES)) {
    if (r.startsWith("x") || r.startsWith("l") || r.startsWith("jy")) continue;
    if (!t[k] || preferred.includes(r)) t[k] = r;
  }
  t["を"] = "o";
  t["ぢ"] = "ji";
  t["づ"] = "zu";
  return t;
})();

/** Hepburn romaji for a reading ("ねこ" → "neko", "がっこう" → "gakkou"). */
export function kanaToRomaji(kana: string): string {
  const s = toHiragana(kana);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (ROMAJI[two] && two.length === 2) {
      out += ROMAJI[two];
      i++;
      continue;
    }
    const ch = s[i];
    if (ch === "っ") {
      const next = ROMAJI[s.slice(i + 1, i + 3)] ?? ROMAJI[s[i + 1]] ?? "";
      out += next.startsWith("ch") ? "t" : next[0] ?? "";
      continue;
    }
    if (ch === "ん") {
      out += /^[aiueoy]/.test(ROMAJI[s[i + 1]] ?? "") ? "n'" : "n";
      continue;
    }
    if (ch === "ー") {
      out += out.at(-1) && VOWELS.includes(out.at(-1)!) ? out.at(-1) : "-";
      continue;
    }
    out += ROMAJI[ch] ?? ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// kanjiapi.dev

export interface KanjiResponse {
  kanji: string;
  grade?: number | null;
  stroke_count: number;
  meanings: string[];
  heisig_en?: string | null;
  kun_readings: string[];
  on_readings: string[];
  name_readings?: string[];
  jlpt?: number | null;
  unicode: string;
  freq_mainichi_shinbun?: number | null;
}

export interface Kanji {
  kanji: string;
  strokes: number;
  meanings: string[];
  on: string[];
  kun: string[];
  nanori: string[];
  grade?: number;
  jlpt?: string;
  /** Rank among the 2,500 most frequent kanji in newspapers. */
  frequency?: number;
  unicode: string;
  heisig?: string;
}

export function toKanji(k: KanjiResponse): Kanji {
  return {
    kanji: k.kanji,
    strokes: k.stroke_count,
    meanings: k.meanings,
    on: k.on_readings,
    kun: k.kun_readings,
    nanori: k.name_readings ?? [],
    grade: k.grade ?? undefined,
    jlpt: k.jlpt ? `N${k.jlpt}` : undefined,
    frequency: k.freq_mainichi_shinbun ?? undefined,
    unicode: `U+${k.unicode.toUpperCase()}`,
    heisig: k.heisig_en ?? undefined,
  };
}

export const kanjiUrl = (kanji: string) => `https://kanjiapi.dev/v1/kanji/${encodeURIComponent(kanji)}`;

/** Where a kanji is taught: grade 1–6 in primary school, 8 in secondary school, 9–10 for names. */
export function gradeText(grade: number | undefined): string | undefined {
  if (grade === undefined) return undefined;
  if (grade >= 1 && grade <= 6) return `Jōyō, grade ${grade}`;
  if (grade === 8) return "Jōyō, secondary school";
  if (grade === 9 || grade === 10) return "Jinmeiyō (names)";
  return `Grade ${grade}`;
}

// ---------------------------------------------------------------------------
// Query

export interface Query {
  /** What is sent to Jisho. */
  keyword: string;
  /** The hiragana, when the query is romaji. */
  kana?: string;
  /** Kanji typed in the query, looked up on their own. */
  kanji: string[];
}

/** Words that are both English and valid romaji: don't offer a kana reading for them. */
const ENGLISH_LOOKALIKES = new Set(["a", "i", "o", "no", "to", "he", "me", "be", "so", "do", "go", "on", "in", "an"]);

export function parseQuery(text: string): Query {
  const keyword = text.trim().replace(/\s+/g, " ");
  const plain = keyword.replace(/#\S+/g, "").trim();
  const kana = plain.length >= 2 && !ENGLISH_LOOKALIKES.has(plain.toLowerCase()) ? romajiToHiragana(plain) : undefined;
  return { keyword, kana, kanji: kanjiOf(plain) };
}

// ---------------------------------------------------------------------------
// Formatting

export const JLPT_COLOR: Record<string, "green" | "teal" | "blue" | "purple" | "red"> = {
  N5: "green",
  N4: "teal",
  N3: "blue",
  N2: "purple",
  N1: "red",
};

/** "Ichidan verb, Transitive verb" → "Ichidan verb · transitive". */
export function posText(pos: string[]): string {
  return pos.map((p, i) => i === 0 ? p : p.replace(/ verb$/, "").toLowerCase()).join(" · ");
}

export function glosses(w: Word, max = 3): string {
  return w.senses.slice(0, max).map((s) => s.definitions.join(", ")).join("; ");
}

/** "猫 (ねこ): cat (esp. the domestic cat, Felis catus), feline". */
export function summaryText(w: Word): string {
  const head = w.word === w.reading ? w.word : `${w.word} (${w.reading})`;
  return `${head}: ${glosses(w, 2)}`;
}

export function wordMarkdown(w: Word): string {
  const lines = [`## ${w.word}`, ""];
  if (w.word !== w.reading) lines.push(`**${w.reading}** · ${w.romaji}`, "");
  else lines.push(w.romaji, "");
  let lastPos = "";
  w.senses.forEach((s, i) => {
    const pos = posText(s.partsOfSpeech);
    if (pos && pos !== lastPos) lines.push(`*${pos}*`, "");
    lastPos = pos || lastPos;
    const extra = [
      s.notes.length ? `(${s.notes.join("; ")})` : "",
      s.seeAlso.length ? `see also ${s.seeAlso.join(", ")}` : "",
      s.antonyms.length ? `antonym ${s.antonyms.join(", ")}` : "",
    ].filter(Boolean).join(" · ");
    lines.push(`${i + 1}. ${s.definitions.join("; ")}${extra ? ` — ${extra}` : ""}`);
  });
  if (w.otherForms.length) {
    lines.push(
      "",
      "### Other forms",
      "",
      w.otherForms.map((f) => f.word ? `${f.word}${f.reading ? ` (${f.reading})` : ""}` : f.reading).join(", "),
    );
  }
  return lines.join("\n");
}

export function wordMetadata(w: Word): Metadata[] {
  const tags = [
    ...(w.common ? [{ text: "Common", color: "green" as const }] : []),
    ...(w.jlpt ? [{ text: `JLPT ${w.jlpt}`, color: JLPT_COLOR[w.jlpt] }] : []),
    ...(w.kind === "name" ? [{ text: "Name", color: "orange" as const }] : []),
    ...(w.kind === "wikipedia" ? [{ text: "Wikipedia", color: "gray" as const }] : []),
  ];
  const kanji = kanjiOf(w.word);
  return [
    meta.text("Reading", w.reading),
    meta.text("Romaji", w.romaji),
    ...(w.reading !== toKatakana(w.reading) ? [meta.text("Katakana", toKatakana(w.reading))] : []),
    ...(tags.length ? [meta.tags("Level", tags)] : []),
    ...(w.wanikani ? [meta.text("WaniKani", `Level ${w.wanikani}`)] : []),
    ...(kanji.length ? [meta.text("Kanji", kanji.join(" "))] : []),
    meta.separator(),
    meta.link("Jisho", w.slug, jishoWordPage(w.slug)),
  ];
}

export function wordActions(w: Word): Action[] {
  return [
    copy(w.word, `Copy ${w.word}`),
    copy(w.reading, "Copy Reading", { shortcut: "<Ctrl><Shift>c" }),
    copy(summaryText(w), "Copy with Meaning", { icon: Icons.text, shortcut: "<Ctrl><Shift>m" }),
    copy(w.romaji, "Copy Romaji", { icon: Icons.text }),
    open(jishoWordPage(w.slug), "Open on Jisho", { shortcut: "<Ctrl>o" }),
  ];
}

export function wordItem(w: Word, section = "Words"): Item {
  return {
    id: `word:${w.slug}`,
    title: w.word === w.reading ? w.word : `${w.word}  ${w.reading}`,
    subtitle: glosses(w),
    icon: { source: w.kind === "word" ? Icons.book : Icons.person, tint: w.common ? "green" : "gray" },
    section,
    keywords: [w.romaji, w.reading, ...w.otherForms.flatMap((f) => [f.word ?? "", f.reading ?? ""])],
    accessories: [
      ...(w.jlpt ? [{ tag: w.jlpt, color: JLPT_COLOR[w.jlpt], tooltip: `JLPT ${w.jlpt}` }] : []),
      ...(w.common ? [{ tag: "common", color: "green" as const }] : []),
      ...(w.kind === "name" ? [{ tag: "name", color: "orange" as const }] : []),
    ],
    detail: { markdown: wordMarkdown(w), metadata: wordMetadata(w) },
    actions: wordActions(w),
  };
}

export function kanjiMarkdown(k: Kanji): string {
  const lines = [`## ${k.kanji}`, "", `**${k.meanings.join(", ") || "—"}**`, ""];
  lines.push("| | |", "|---|---|");
  lines.push(`| On'yomi | ${k.on.join("、") || "—"} |`);
  lines.push(`| Kun'yomi | ${k.kun.join("、") || "—"} |`);
  if (k.nanori.length) lines.push(`| Nanori (names) | ${k.nanori.join("、")} |`);
  lines.push("", "> In kun'yomi, the part after the dot is the okurigana written in kana: た.べる → 食べる.");
  return lines.join("\n");
}

export function kanjiItem(k: Kanji): Item {
  const grade = gradeText(k.grade);
  return {
    id: `kanji:${k.kanji}`,
    title: k.kanji,
    subtitle: k.meanings.slice(0, 4).join(", "),
    icon: { source: Icons.font, tint: "red" },
    section: "Kanji",
    keywords: [...k.on, ...k.kun, ...k.meanings],
    accessories: [
      { text: [k.on[0], k.kun[0]].filter(Boolean).join(" · ") },
      { tag: `${k.strokes} strokes`, color: "gray" },
      ...(k.jlpt ? [{ tag: k.jlpt, color: JLPT_COLOR[k.jlpt] }] : []),
    ],
    detail: {
      stats: [
        { label: "Strokes", value: k.strokes },
        ...(k.jlpt ? [{ label: "JLPT", value: k.jlpt, color: JLPT_COLOR[k.jlpt] }] : []),
        ...(k.frequency ? [{ label: "Frequency rank", value: k.frequency }] : []),
      ],
      markdown: kanjiMarkdown(k),
      metadata: [
        ...(grade ? [meta.text("Taught", grade)] : []),
        ...(k.heisig ? [meta.text("Heisig keyword", k.heisig)] : []),
        meta.text("Unicode", k.unicode),
        meta.separator(),
        meta.link("Jisho", `${k.kanji} #kanji`, jishoKanjiPage(k.kanji)),
      ],
    },
    actions: [
      copy(k.kanji, `Copy ${k.kanji}`),
      copy(`${k.kanji}: ${k.meanings.join(", ")} (${[...k.on, ...k.kun].join("、")})`, "Copy with Readings", {
        icon: Icons.text,
      }),
      open(jishoKanjiPage(k.kanji), "Open on Jisho", { shortcut: "<Ctrl>o" }),
    ],
  };
}

/** The romaji typed, as hiragana and katakana. */
export function kanaItem(romaji: string, hiragana: string): Item {
  const katakana = toKatakana(hiragana);
  return {
    id: "kana",
    title: `${hiragana}  ${katakana}`,
    subtitle: `“${romaji}” in kana`,
    icon: { source: Icons.keyboard, tint: "blue" },
    section: "Kana",
    detail: {
      markdown: [
        `## ${hiragana}`,
        "",
        `Katakana: **${katakana}**`,
        "",
        "Type `nn` or `n'` for ん before a vowel, double a consonant for っ (`kitte`), `-` for ー.",
      ].join("\n"),
    },
    actions: [
      copy(hiragana, "Copy Hiragana"),
      copy(katakana, "Copy Katakana", { shortcut: "<Ctrl><Shift>c" }),
      open(jishoSearchPage(hiragana), "Search on Jisho", { shortcut: "<Ctrl>o" }),
    ],
  };
}

export const EXAMPLES: { query: string; title: string }[] = [
  { query: "cat", title: "English: Japanese words for it" },
  { query: "taberu", title: "Romaji: read as たべる" },
  { query: "日本語", title: "Kanji: the word and each kanji" },
  { query: "#jlpt-n5 food", title: "Jisho tags: #jlpt-n5, #common, #verb…" },
  { query: "*電車", title: "Wildcards: words ending in 電車" },
];
