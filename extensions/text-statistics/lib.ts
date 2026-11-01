// Counts, reading time, readability and frequent words of a text, computed locally.

export type Language = "en" | "fr";

export const LANGUAGE_TITLE: Record<Language, string> = { en: "English", fr: "French" };

/** Average silent reading and speaking speeds, in words per minute. */
export const READING_WPM: Record<Language, number> = { en: 238, fr: 214 };
export const SPEAKING_WPM = 150;

// ---------------------------------------------------------------------------
// Stop words: left out of the frequent words.

export const STOP_WORDS: Record<Language, Set<string>> = {
  en: new Set(
    ("a about above after again against all also am an and any are aren't as at be because been before being below " +
      "between both but by can can't cannot could couldn't did didn't do does doesn't doing don't down during each " +
      "even ever every few for from further get got had hadn't has hasn't have haven't having he he'd he'll he's her " +
      "here here's hers herself him himself his how how's however i i'd i'll i'm i've if in into is isn't it it's its " +
      "itself just let's like may me might more most much must mustn't my myself no nor not now of off often on once " +
      "one only or other ought our ours ourselves out over own really same shall shan't she she'd she'll she's should " +
      "shouldn't so some such than that that's the their theirs them themselves then there there's these they they'd " +
      "they'll they're they've this those though through to too under until up upon us very was wasn't we we'd we'll " +
      "we're we've were weren't what what's when when's where where's whether which while who who's whom whose why " +
      "why's will with within without won't would wouldn't yes yet you you'd you'll you're you've your yours yourself " +
      "yourselves")
      .split(" "),
  ),
  fr: new Set(
    ("à afin ai aie aient aies ait alors as au aucun aucune audit aujourd aujourd'hui auquel aura aurai auraient " +
      "aurais aurait auras aurez auriez aurions aurons auront aussi autre autres aux auxquelles auxquels avaient avais " +
      "avait avant avec avez aviez avions avoir avons ayant ayez ayons c ça car ce ceci cela celle celles celui cependant " +
      "certain certaine certaines certains ces cet cette ceux chaque chez ci comme comment d dans de des desquelles " +
      "desquels dès donc dont du duquel elle elles en encore entre es est et étaient étais était étant été êtes étiez " +
      "étions être eu eue eues eûmes eurent eus eut eux fait fois font furent fus fut ici il ils j je jusqu jusque l la " +
      "laquelle le lequel les lesquelles lesquels leur leurs lors lorsque lui m ma mais me même mêmes mes moi mon n ne " +
      "ni non nos notre nous on ont ou où par parce pas peu peut plus pour pourquoi qu quand que quel quelle quelles " +
      "quels qui quoi s sa sans se sera serai seraient serais serait seras serez seriez serions serons seront ses si " +
      "sien sienne soi soient sois soit sommes son sont sous suis sur t ta te tes toi ton tous tout toute toutes très " +
      "tu un une unes uns vers voici voilà vos votre vous y")
      .split(" "),
  ),
};

// ---------------------------------------------------------------------------
// Splitting

const wordSegmenter = (lang: Language) => new Intl.Segmenter(lang, { granularity: "word" });
const sentenceSegmenter = (lang: Language) => new Intl.Segmenter(lang, { granularity: "sentence" });
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/** Words as the reader sees them: `l'école`, `e-mail` and `2026` are one word each, punctuation is none. */
export function words(text: string, lang: Language = "en"): string[] {
  const out: string[] = [];
  let pending = "";
  // The segmenter splits "aujourd'hui" or "e-mail" in some engines: join over an apostrophe or hyphen between letters.
  const segments = [...wordSegmenter(lang).segment(text)];
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (s.isWordLike) {
      pending += s.segment;
      const next = segments[i + 1];
      const after = segments[i + 2];
      if (next && /^['’-]$/.test(next.segment) && after?.isWordLike) {
        pending += next.segment === "-" ? "-" : "'";
        i++;
        continue;
      }
      out.push(pending);
      pending = "";
    }
  }
  if (pending) out.push(pending);
  return out;
}

/** Abbreviations that end with a period without ending the sentence. */
const ABBREVIATION =
  /(?:^|\s)(?:mr|mrs|ms|dr|prof|sr|jr|st|vs|etc|e\.g|i\.e|no|fig|approx|m|mme|mlle|mm|me|cf|p|pp|vol|ch|art|env|ex)\.$/i;

/** Sentences, trimmed, without the empty ones; "Mr. Smith" stays in one. */
export function sentences(text: string, lang: Language = "en"): string[] {
  const out: string[] = [];
  for (const s of sentenceSegmenter(lang).segment(text)) {
    const sentence = s.segment.replace(/\s+/g, " ").trim();
    if (!sentence) continue;
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += ` ${sentence}`;
    else out.push(sentence);
  }
  return out.filter((s) => words(s, lang).length > 0);
}

/** Characters as the reader counts them: an emoji with its skin tone is one. */
export function graphemes(text: string): number {
  let n = 0;
  for (const _ of graphemeSegmenter.segment(text)) n++;
  return n;
}

export function paragraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}

export function lines(text: string): number {
  if (!text) return 0;
  return text.replace(/\n$/, "").split(/\r?\n/).length;
}

// ---------------------------------------------------------------------------
// Language

/** English or French, from the share of each language's common words and French accents. */
export function detectLanguage(text: string): Language {
  const ws = words(text.slice(0, 20_000)).map((w) => w.toLowerCase().replace(/’/g, "'"));
  let en = 0, fr = 0;
  for (const w of ws) {
    if (STOP_WORDS.en.has(w)) en++;
    if (STOP_WORDS.fr.has(w)) fr++;
    if (/^(l|d|qu|n|s|j|c|m|t)'/.test(w)) fr++;
  }
  fr += (text.match(/[éèêàùçœâîôû]/gi) ?? []).length / 4;
  return fr > en ? "fr" : "en";
}

// ---------------------------------------------------------------------------
// Syllables

/** English syllables, by vowel groups with the usual silent-e corrections. */
export function syllablesEn(word: string): number {
  let w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  w = w.replace(/(?:[^laeiouy]es|[^laeiouytd]ed|[^laeiouy]e)$/, "").replace(/^y/, "");
  const groups = w.match(/[aeiouy]{1,2}/g)?.length ?? 0;
  return Math.max(1, groups);
}

/** French syllables (written), by vowel groups, a final mute e not counted. */
export function syllablesFr(word: string): number {
  let w = word.toLowerCase().normalize("NFC").replace(/[^a-zàâäéèêëîïôöùûüÿœæ]/g, "");
  if (!w) return 0;
  // Mute endings: "-es", "-ent" of verbs, final "-e" after a consonant.
  w = w.replace(/([^aeiouyàâäéèêëîïôöùûüÿœæ])(e|es|ent)$/, "$1");
  const groups = w.match(/[aeiouyàâäéèêëîïôöùûüÿœæ]+/g)?.length ?? 0;
  return Math.max(1, groups);
}

export const syllables = (word: string, lang: Language) => lang === "fr" ? syllablesFr(word) : syllablesEn(word);

// ---------------------------------------------------------------------------
// Readability

export interface Readability {
  /** Flesch reading ease (English) or Kandel–Moles (French): higher is easier, about 0 to 100. */
  ease: number;
  formula: string;
  /** Flesch–Kincaid grade level, for English. */
  grade?: number;
  label: string;
  audience: string;
}

/** What a reading-ease score means, from Flesch's table. */
export function easeLabel(score: number): { label: string; audience: string } {
  if (score >= 90) return { label: "Very easy", audience: "11-year-olds" };
  if (score >= 80) return { label: "Easy", audience: "12-year-olds" };
  if (score >= 70) return { label: "Fairly easy", audience: "13-year-olds" };
  if (score >= 60) return { label: "Plain", audience: "13- to 15-year-olds" };
  if (score >= 50) return { label: "Fairly difficult", audience: "high school students" };
  if (score >= 30) return { label: "Difficult", audience: "college students" };
  return { label: "Very difficult", audience: "university graduates" };
}

export function readability(wordCount: number, sentenceCount: number, syllableCount: number, lang: Language) {
  if (!wordCount || !sentenceCount) return undefined;
  const wps = wordCount / sentenceCount;
  const spw = syllableCount / wordCount;
  const ease = lang === "fr" ? 207 - 1.015 * wps - 73.6 * spw : 206.835 - 1.015 * wps - 84.6 * spw;
  const r: Readability = {
    ease: Math.round(ease * 10) / 10,
    formula: lang === "fr" ? "Kandel–Moles" : "Flesch reading ease",
    ...easeLabel(ease),
  };
  if (lang === "en") r.grade = Math.round((0.39 * wps + 11.8 * spw - 15.59) * 10) / 10;
  return r;
}

// ---------------------------------------------------------------------------
// The whole analysis

export interface WordCount {
  word: string;
  count: number;
}

export interface Stats {
  language: Language;
  /** Characters as graphemes. */
  characters: number;
  charactersNoSpaces: number;
  /** UTF-8 size. */
  bytes: number;
  words: number;
  uniqueWords: number;
  sentences: number;
  paragraphs: number;
  lines: number;
  syllables: number;
  /** Letters per word. */
  averageWordLength: number;
  /** Words per sentence. */
  averageSentenceLength: number;
  /** Seconds. */
  readingTime: number;
  speakingTime: number;
  readability?: Readability;
  topWords: WordCount[];
  longestSentence?: { text: string; words: number };
  longestWord?: string;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function analyze(text: string, lang?: Language, top = 10): Stats {
  const language = lang ?? detectLanguage(text);
  const ws = words(text, language);
  const ss = sentences(text, language);
  const lower = ws.map((w) => w.toLocaleLowerCase(language).replace(/’/g, "'"));
  const counts = new Map<string, number>();
  for (const w of lower) {
    // Numbers and one-letter words say little about what the text is about.
    if (w.length < 2 || /^\d+([.,]\d+)?$/.test(w) || STOP_WORDS[language].has(w)) continue;
    const bare = w.replace(/^(l|d|qu|n|s|j|c|m|t)'/, "");
    if (bare.length < 2 || STOP_WORDS[language].has(bare)) continue;
    counts.set(bare, (counts.get(bare) ?? 0) + 1);
  }
  const topWords = [...counts].map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word, language))
    .slice(0, top);
  const syl = ws.reduce((n, w) => n + syllables(w, language), 0);
  const letters = ws.reduce((n, w) => n + graphemes(w.replace(/['’-]/g, "")), 0);
  let longestSentence: Stats["longestSentence"];
  for (const s of ss) {
    const n = words(s, language).length;
    if (!longestSentence || n > longestSentence.words) longestSentence = { text: s, words: n };
  }
  const longestWord = ws.reduce<string | undefined>((a, w) => !a || graphemes(w) > graphemes(a) ? w : a, undefined);
  const sentenceCount = ss.length || (ws.length ? 1 : 0);
  return {
    language,
    characters: graphemes(text),
    charactersNoSpaces: graphemes(text.replace(/\s+/g, "")),
    bytes: new TextEncoder().encode(text).length,
    words: ws.length,
    uniqueWords: new Set(lower).size,
    sentences: sentenceCount,
    paragraphs: paragraphs(text).length,
    lines: lines(text),
    syllables: syl,
    averageWordLength: ws.length ? round1(letters / ws.length) : 0,
    averageSentenceLength: sentenceCount ? round1(ws.length / sentenceCount) : 0,
    readingTime: Math.round(ws.length / READING_WPM[language] * 60),
    speakingTime: Math.round(ws.length / SPEAKING_WPM * 60),
    readability: readability(ws.length, sentenceCount, syl, language),
    topWords,
    longestSentence,
    longestWord,
  };
}

// ---------------------------------------------------------------------------
// Formatting

export const number = (n: number) => new Intl.NumberFormat("en-US").format(n);

export const plural = (n: number, word: string, many = `${word}s`) => `${number(n)} ${n === 1 ? word : many}`;

/** 42 → "42 s", 95 → "1 min 35 s", 1250 → "21 min", 3720 → "1 h 2 min". Seconds only under 10 minutes. */
export function duration(seconds: number): string {
  const s = Math.round(seconds);
  if (s < 60) return `${s} s`;
  if (s < 600) return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
  const minutes = Math.round(s / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  return minutes % 60 ? `${h} h ${minutes % 60} min` : `${h} h`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${round1(n / 1024)} KB`;
  return `${round1(n / 1024 / 1024)} MB`;
}

/** Shortens long text for a title, on a word boundary. */
export function ellipsis(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${space > max / 2 ? cut.slice(0, space) : cut}…`;
}

/** The plain-text summary copied by "Copy Summary". */
export function summary(s: Stats): string {
  const lines = [
    `Words: ${number(s.words)} (${number(s.uniqueWords)} unique)`,
    `Characters: ${number(s.characters)} (${number(s.charactersNoSpaces)} without spaces)`,
    `Sentences: ${number(s.sentences)}`,
    `Paragraphs: ${number(s.paragraphs)}`,
    `Lines: ${number(s.lines)}`,
    `Reading time: ${duration(s.readingTime)}`,
    `Speaking time: ${duration(s.speakingTime)}`,
  ];
  if (s.readability) {
    lines.push(
      `Readability: ${s.readability.ease} (${s.readability.formula}, ${s.readability.label.toLowerCase()})` +
        (s.readability.grade !== undefined ? `, grade ${s.readability.grade}` : ""),
    );
  }
  if (s.topWords.length) lines.push(`Frequent words: ${s.topWords.slice(0, 5).map((w) => w.word).join(", ")}`);
  return lines.join("\n");
}

export function easeColor(score: number): "green" | "yellow" | "orange" | "red" {
  return score >= 60 ? "green" : score >= 50 ? "yellow" : score >= 30 ? "orange" : "red";
}
