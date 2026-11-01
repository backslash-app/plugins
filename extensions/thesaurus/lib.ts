// Pure logic: reading what you type, building Datamuse requests, reading its answers, list items.

import { type Action, copy, Icons, type Item, meta, open, paste } from "@backslash/api";

// ---------------------------------------------------------------------------
// Relations

export type Relation = "syn" | "ant" | "rhy" | "nry" | "sl" | "ml" | "jjb" | "jja" | "trg" | "sp";

export interface RelationInfo {
  title: string;
  /** Section header; `%s` is the word. */
  section: string;
  /** Datamuse parameter. */
  param: string;
  /** Words typed before the query to pick this relation. */
  prefixes: string[];
  /** Ask for definitions (heavier answers). */
  defs: boolean;
}

export const RELATIONS: Record<Relation, RelationInfo> = {
  syn: {
    title: "Synonyms",
    section: "Synonyms of “%s”",
    param: "rel_syn",
    prefixes: ["syn", "synonym", "synonyms", "synonyme", "synonymes"],
    defs: true,
  },
  ml: {
    title: "Similar Meaning",
    section: "Means like “%s”",
    param: "ml",
    prefixes: ["like", "ml", "means", "meaning"],
    defs: true,
  },
  ant: {
    title: "Antonyms",
    section: "Antonyms of “%s”",
    param: "rel_ant",
    prefixes: ["ant", "antonym", "antonyms", "opposite", "antonyme", "contraire"],
    defs: true,
  },
  rhy: {
    title: "Rhymes",
    section: "Rhymes with “%s”",
    param: "rel_rhy",
    prefixes: ["rhyme", "rhymes", "rhy", "rime", "rimes"],
    defs: false,
  },
  nry: {
    title: "Near Rhymes",
    section: "Near rhymes for “%s”",
    param: "rel_nry",
    prefixes: ["near", "nry", "slant"],
    defs: false,
  },
  sl: {
    title: "Sounds Like",
    section: "Sounds like “%s”",
    param: "sl",
    prefixes: ["sounds", "sl", "homophone", "homophones"],
    defs: false,
  },
  jjb: {
    title: "Adjectives",
    section: "Adjectives for “%s”",
    param: "rel_jjb",
    prefixes: ["adj", "adjective", "adjectives", "describe"],
    defs: false,
  },
  jja: {
    title: "Nouns",
    section: "Nouns described as “%s”",
    param: "rel_jja",
    prefixes: ["noun", "nouns", "described"],
    defs: false,
  },
  trg: {
    title: "Associated",
    section: "Associated with “%s”",
    param: "rel_trg",
    prefixes: ["assoc", "associated", "trg", "related"],
    defs: false,
  },
  sp: {
    title: "Spelled Like",
    section: "Spelled like “%s”",
    param: "sp",
    prefixes: ["spell", "sp", "pattern"],
    defs: false,
  },
};

/** The filter chips: "all" shows the word, synonyms, antonyms and rhymes together. */
export const FILTERS: { value: string; title: string }[] = [
  { value: "all", title: "All" },
  ...(["syn", "ant", "rhy", "nry", "sl", "jjb", "jja", "trg"] as Relation[]).map((r) => ({
    value: r,
    title: RELATIONS[r].title,
  })),
];

export function relationOf(value: unknown): Relation | "all" {
  return typeof value === "string" && value in RELATIONS ? value as Relation : "all";
}

// ---------------------------------------------------------------------------
// Query

export interface Query {
  /** The word or phrase, without the prefix and quotes. */
  text: string;
  /** Picked by a prefix (`rhyme orange`), a wildcard or a phrase; else the filter decides. */
  relation?: Relation;
}

export function parseQuery(input: string): Query {
  const trimmed = input.trim().replace(/\s+/g, " ");
  const m = /^([a-zé]+):?\s+(.+)$/i.exec(trimmed);
  if (m) {
    const prefix = m[1].toLowerCase();
    const relation = (Object.keys(RELATIONS) as Relation[]).find((r) => RELATIONS[r].prefixes.includes(prefix));
    if (relation) return { text: unquote(m[2]), relation };
  }
  const text = unquote(trimmed);
  if (/[*?]/.test(text)) return { text, relation: "sp" };
  return { text };
}

function unquote(s: string): string {
  return s.trim().replace(/^["“'](.*)["”']$/, "$1").trim();
}

/** A phrase has no single-word synonyms: "fast car" is looked up by meaning. */
export const isPhrase = (text: string) => /\s/.test(text.trim());

// ---------------------------------------------------------------------------
// Datamuse

export const API = "https://api.datamuse.com/words";

export function relationUrl(relation: Relation, text: string, max = 40): string {
  const info = RELATIONS[relation];
  const q = new URLSearchParams({ [info.param]: text, md: info.defs ? "dpsf" : "psf", max: String(max) });
  return `${API}?${q}`;
}

/** The word itself, with its definitions and frequency. */
export function wordUrl(word: string): string {
  return `${API}?${new URLSearchParams({ sp: word, qe: "sp", md: "dpsf", max: "1" })}`;
}

export interface DatamuseWord {
  word: string;
  score?: number;
  numSyllables?: number;
  tags?: string[];
  defs?: string[];
}

export type PartOfSpeech = "noun" | "verb" | "adjective" | "adverb";

export interface Definition {
  pos?: PartOfSpeech;
  text: string;
}

export interface Entry {
  word: string;
  score: number;
  syllables?: number;
  pos: PartOfSpeech[];
  proper: boolean;
  /** Occurrences per million words of English text. */
  frequency?: number;
  definitions: Definition[];
}

const POS: Record<string, PartOfSpeech> = { n: "noun", v: "verb", adj: "adjective", adv: "adverb" };
const POS_SHORT: Record<PartOfSpeech, string> = { noun: "n.", verb: "v.", adjective: "adj.", adverb: "adv." };

export function toEntry(w: DatamuseWord): Entry {
  const tags = w.tags ?? [];
  const f = tags.find((t) => t.startsWith("f:"));
  return {
    word: w.word,
    score: w.score ?? 0,
    syllables: w.numSyllables,
    pos: [...new Set(tags.map((t) => POS[t]).filter(Boolean))],
    proper: tags.includes("prop"),
    frequency: f ? Number(f.slice(2)) : undefined,
    definitions: (w.defs ?? []).map((d) => {
      const [p, ...rest] = d.split("\t");
      const text = rest.join("\t").trim();
      return text ? { pos: POS[p], text } : { text: p.trim() };
    }).filter((d) => d.text),
  };
}

/** Datamuse answers, minus the query word itself and duplicates. */
export function parseWords(words: DatamuseWord[], query = ""): Entry[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  return words.map(toEntry).filter((e) => {
    const key = e.word.toLowerCase();
    if (key === q || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Synonyms, topped up with words of similar meaning when there are few. */
export function mergeSynonyms(synonyms: Entry[], similar: Entry[], min = 12): Entry[] {
  if (synonyms.length >= min) return synonyms;
  const have = new Set(synonyms.map((e) => e.word.toLowerCase()));
  return [...synonyms, ...similar.filter((e) => !have.has(e.word.toLowerCase())).slice(0, min * 2 - synonyms.length)];
}

// ---------------------------------------------------------------------------
// Formatting

export function frequencyLabel(
  f: number | undefined,
): { text: string; color: "green" | "teal" | "orange" | "gray" } | undefined {
  if (f === undefined) return undefined;
  if (f >= 100) return { text: "very common", color: "green" };
  if (f >= 10) return { text: "common", color: "teal" };
  if (f >= 1) return { text: "uncommon", color: "orange" };
  return { text: "rare", color: "gray" };
}

/** "49 per million words", "0.3 per million words". */
export function frequencyText(f: number): string {
  const n = f >= 10 ? Math.round(f).toLocaleString("en-US") : f >= 0.1 ? f.toFixed(1) : f.toFixed(3);
  return `${n} per million words`;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "(figurative) Calm, undisturbed." stays readable in one line. */
export function shortDefinition(e: Entry): string | undefined {
  const d = e.definitions[0];
  if (!d) return undefined;
  return d.text.length > 90 ? `${d.text.slice(0, 89).trimEnd()}…` : d.text;
}

export function entryMarkdown(e: Entry, max = 8): string {
  const lines = [`## ${e.word}`, ""];
  const parts = [
    e.pos.join(", "),
    e.syllables ? plural(e.syllables, "syllable") : "",
  ].filter(Boolean);
  if (parts.length) lines.push(`*${parts.join(" · ")}*`, "");
  if (!e.definitions.length) lines.push("No definition from Datamuse.");
  let last: PartOfSpeech | undefined | null = null;
  e.definitions.slice(0, max).forEach((d, i) => {
    if (d.pos !== last && d.pos) lines.push(`**${d.pos}**`, "");
    last = d.pos;
    lines.push(`${i + 1}. ${d.text}`);
  });
  if (e.definitions.length > max) lines.push("", `…and ${e.definitions.length - max} more on Wiktionary.`);
  return lines.join("\n");
}

export const wiktionaryUrl = (word: string) =>
  `https://en.wiktionary.org/wiki/${encodeURIComponent(word.replaceAll(" ", "_"))}`;

export function entryAccessories(e: Entry, withFrequency = true) {
  const f = withFrequency ? frequencyLabel(e.frequency) : undefined;
  return [
    ...(e.pos.length ? [{ text: e.pos.map((p) => POS_SHORT[p]).join(" ") }] : []),
    ...(e.syllables ? [{ text: `${e.syllables} syl.`, tooltip: plural(e.syllables, "syllable") }] : []),
    ...(f ? [{ tag: f.text, color: f.color }] : []),
  ];
}

/** `more(word, relation)` opens the list for another word: synonyms of a synonym. */
export type More = (word: string, relation: Relation | "all") => Action[];

export function entryItem(e: Entry, section: string, relation: Relation, more: More = () => []): Item {
  const f = frequencyLabel(e.frequency);
  return {
    id: `${relation}:${e.word}`,
    title: e.word,
    subtitle: shortDefinition(e),
    icon: { source: ICON[relation], tint: TINT[relation] },
    section,
    accessories: entryAccessories(e),
    detail: {
      markdown: entryMarkdown(e),
      metadata: [
        ...(e.syllables ? [meta.text("Syllables", e.syllables)] : []),
        ...(e.pos.length ? [meta.tags("Part of speech", e.pos)] : []),
        ...(e.frequency !== undefined && f
          ? [meta.text("Frequency", `${f.text}: ${frequencyText(e.frequency)}`, { color: f.color })]
          : []),
        ...(e.proper ? [meta.tags("Also", [{ text: "proper noun", color: "purple" }])] : []),
        meta.separator(),
        meta.link("Wiktionary", e.word, wiktionaryUrl(e.word)),
      ],
    },
    actions: [
      copy(e.word, "Copy Word"),
      paste(e.word, "Paste Word"),
      ...more(e.word, relation === "rhy" || relation === "nry" ? "rhy" : "all"),
      open(wiktionaryUrl(e.word), "Open in Wiktionary", { shortcut: "<Ctrl>o" }),
    ],
  };
}

const ICON: Record<Relation, string> = {
  syn: Icons.book,
  ml: Icons.book,
  ant: Icons.arrowRight,
  rhy: Icons.music,
  nry: Icons.music,
  sl: Icons.speaker,
  jjb: Icons.sparkle,
  jja: Icons.box,
  trg: Icons.link,
  sp: Icons.font,
};
const TINT: Record<Relation, "blue" | "teal" | "red" | "purple" | "pink" | "orange" | "yellow" | "green" | "gray"> = {
  syn: "blue",
  ml: "teal",
  ant: "red",
  rhy: "purple",
  nry: "pink",
  sl: "orange",
  jjb: "yellow",
  jja: "green",
  trg: "gray",
  sp: "gray",
};

/** The word looked up, at the top of "All". */
export function headwordItem(e: Entry, more: More = () => []): Item {
  return {
    id: `word:${e.word}`,
    title: e.word,
    subtitle: shortDefinition(e) ?? "No definition",
    icon: { source: Icons.book, tint: "green" },
    section: "Word",
    accessories: entryAccessories(e),
    detail: {
      markdown: entryMarkdown(e, 12),
      metadata: [
        ...(e.syllables ? [meta.text("Syllables", e.syllables)] : []),
        ...(e.frequency !== undefined ? [meta.text("Frequency", frequencyText(e.frequency))] : []),
        meta.separator(),
        meta.link("Wiktionary", e.word, wiktionaryUrl(e.word)),
      ],
    },
    actions: [
      copy(e.word, "Copy Word"),
      ...more(e.word, "rhy"),
      open(wiktionaryUrl(e.word), "Open in Wiktionary", { shortcut: "<Ctrl>o" }),
    ],
  };
}

/** Rhymes grouped by syllable count, best first in each group. */
export function rhymeItems(entries: Entry[], word: string, relation: "rhy" | "nry", more: More = () => []): Item[] {
  const groups = new Map<number, Entry[]>();
  for (const e of entries) {
    const n = e.syllables ?? 0;
    groups.set(n, [...groups.get(n) ?? [], e]);
  }
  const title = relation === "rhy" ? "Rhymes" : "Near rhymes";
  return [...groups.keys()].sort((a, b) => (a || 99) - (b || 99)).flatMap((n) =>
    groups.get(n)!.map((e) =>
      entryItem(e, n ? `${title} · ${plural(n, "syllable")}` : `${title} for “${word}”`, relation, more)
    )
  );
}

export function sectionTitle(relation: Relation, text: string): string {
  return RELATIONS[relation].section.replace("%s", text);
}

export const EXAMPLES: { query: string; title: string }[] = [
  { query: "happy", title: "A word: its meaning, synonyms, antonyms and rhymes" },
  { query: "rhyme orange", title: "Rhymes, by syllable count" },
  { query: 'like "very tired"', title: "Words for a phrase" },
  { query: "adj ocean", title: "Adjectives used for a noun" },
  { query: "noun yellow", title: "Nouns described by an adjective" },
  { query: "sounds jirraf", title: "Words that sound like what you type" },
  { query: "h*py", title: "Wildcards: * for letters, ? for one" },
];
