// Dictionary sources and their mapping to one model. Pure, tested in lib_test.ts.
//
// - English: the Wiktionary REST definition endpoint (en.wiktionary.org only;
//   other Wiktionaries don't have it), with pronunciation and synonyms from
//   dictionaryapi.dev, which also serves as a fallback.
// - French: fr.wiktionary.org's wikitext (MediaWiki parse API), parsed here:
//   French definitions, examples, gender, IPA and synonyms.

import { type Color, Icons } from "@backslash/api";

export type Lang = "en" | "fr";

export const LANGS: Record<Lang, string> = { en: "English", fr: "Français" };

export function langOf(pref: unknown): Lang {
  return String(pref ?? "").trim().toLowerCase().startsWith("fr") ? "fr" : "en";
}

/** "fr:maison" → French "maison"; "house" → the default language. */
export function parseQuery(query: string, fallback: Lang): { lang: Lang; word: string } {
  const m = /^\s*(en|fr)\s*:\s*(.*)$/i.exec(query);
  if (m) return { lang: m[1].toLowerCase() as Lang, word: m[2].trim() };
  return { lang: fallback, word: query.trim() };
}

export interface Sense {
  definition: string;
  examples: string[];
}

export interface Group {
  /** Part of speech as the source names it: "Noun", "Nom commun". */
  pos: string;
  gender?: string;
  senses: Sense[];
  synonyms: string[];
  antonyms: string[];
}

export interface Entry {
  word: string;
  lang: Lang;
  ipa: string[];
  groups: Group[];
  etymology?: string;
  /** The page on Wiktionary. */
  url: string;
  source: string;
}

export function wiktionaryUrl(word: string, lang: Lang): string {
  const title = encodeURIComponent(word.replaceAll(" ", "_"));
  return lang === "fr"
    ? `https://fr.wiktionary.org/wiki/${title}#fr`
    : `https://en.wiktionary.org/wiki/${title}#English`;
}

// ---------------------------------------------------------------------------
// Text

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  middot: "·",
  thinsp: " ",
  "#039": "'",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** HTML fragment → one line of text. */
export function htmlToText(html: string): string {
  return tidy(decodeEntities(html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "")));
}

function tidy(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\s+([,.;:!?)])/g, "$1").replace(/\(\s+/g, "(").replace(/\(\)/g, "").trim();
}

const unique = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

// ---------------------------------------------------------------------------
// English: Wiktionary REST API

interface RestDefinition {
  definition?: string;
  examples?: string[];
  parsedExamples?: { example: string }[];
}
export type RestResponse = Record<string, { partOfSpeech: string; language: string; definitions: RestDefinition[] }[]>;

/** Merges the groups of a part of speech (several etymologies make several). */
function mergeGroups(groups: Group[]): Group[] {
  const out: Group[] = [];
  for (const g of groups) {
    const same = out.find((o) => o.pos === g.pos && o.gender === g.gender);
    if (same) {
      same.senses.push(...g.senses);
      same.synonyms = unique([...same.synonyms, ...g.synonyms]);
      same.antonyms = unique([...same.antonyms, ...g.antonyms]);
    } else out.push({ ...g, senses: [...g.senses] });
  }
  return out.filter((g) => g.senses.length);
}

export function fromRest(word: string, res: RestResponse, lang: Lang = "en"): Entry | undefined {
  const groups = (res[lang] ?? []).map((g): Group => ({
    pos: g.partOfSpeech,
    senses: (g.definitions ?? []).map((d) => ({
      definition: htmlToText(d.definition ?? ""),
      examples: unique(
        (d.parsedExamples?.length ? d.parsedExamples.map((e) => e.example) : d.examples ?? []).map(htmlToText),
      ).slice(0, 3),
    })).filter((s) => s.definition),
    synonyms: [],
    antonyms: [],
  }));
  const merged = mergeGroups(groups);
  if (!merged.length) return undefined;
  return { word, lang, ipa: [], groups: merged, url: wiktionaryUrl(word, lang), source: "Wiktionary" };
}

// ---------------------------------------------------------------------------
// English: dictionaryapi.dev (IPA, synonyms; definitions as a fallback)

export interface FreeDictEntry {
  word: string;
  phonetic?: string;
  phonetics?: { text?: string; audio?: string }[];
  meanings?: {
    partOfSpeech: string;
    definitions: { definition: string; example?: string; synonyms?: string[]; antonyms?: string[] }[];
    synonyms?: string[];
    antonyms?: string[];
  }[];
}

const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

export function fromFreeDictionary(word: string, res: FreeDictEntry[]): Entry | undefined {
  if (!Array.isArray(res) || !res.length) return undefined;
  const ipa = unique(res.flatMap((e) => [e.phonetic ?? "", ...(e.phonetics ?? []).map((p) => p.text ?? "")]));
  const groups = mergeGroups(res.flatMap((e) =>
    (e.meanings ?? []).map((m): Group => ({
      pos: capitalize(m.partOfSpeech),
      senses: m.definitions.map((d) => ({ definition: d.definition.trim(), examples: d.example ? [d.example] : [] })),
      synonyms: unique([...(m.synonyms ?? []), ...m.definitions.flatMap((d) => d.synonyms ?? [])]),
      antonyms: unique([...(m.antonyms ?? []), ...m.definitions.flatMap((d) => d.antonyms ?? [])]),
    }))
  ));
  if (!groups.length) return undefined;
  return {
    word: res[0].word || word,
    lang: "en",
    ipa,
    groups,
    url: wiktionaryUrl(word, "en"),
    source: "Free Dictionary",
  };
}

/** Wiktionary's definitions with dictionaryapi.dev's pronunciation and synonyms. */
export function enrich(entry: Entry, extra: Entry | undefined): Entry {
  if (!extra) return entry;
  return {
    ...entry,
    ipa: unique([...entry.ipa, ...extra.ipa]),
    groups: entry.groups.map((g) => {
      const match = extra.groups.find((x) => x.pos.toLowerCase() === g.pos.toLowerCase());
      return match
        ? {
          ...g,
          synonyms: unique([...g.synonyms, ...match.synonyms]),
          antonyms: unique([...g.antonyms, ...match.antonyms]),
        }
        : g;
    }),
  };
}

// ---------------------------------------------------------------------------
// French: fr.wiktionary.org wikitext

/** `[[cible|texte]]` → texte, `[[mot]]` → mot; files and categories removed. */
export function stripLinks(s: string): string {
  return s
    .replace(/\[\[(?:Fichier|File|Image|Catégorie|Category):[^\]]*\]\]/gi, "")
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")
    .replace(/\[\[([^\]]*)\]\]/g, (_, t: string) => t.replace(/#.*$/, ""))
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, "$1")
    .replace(/\[https?:\/\/[^\]]+\]/g, "");
}

const DROP = new Set([
  "réf",
  "ref",
  "réf ?",
  "source",
  "siècle",
  "siècle2",
  "date",
  "ancre",
  "?",
  "m",
  "f",
  "mf",
  "n",
  "c",
  "msing",
  "fsing",
  "mplur",
  "fplur",
  "invar",
  "sp",
  "p",
  "s",
  "réf-souhaitée",
  "rare-réf",
  "lien-ancre-étym",
]);
const FIRST = new Set([
  "lien",
  "l",
  "w",
  "smcp",
  "petites capitales",
  "pc",
  "nobr",
  "exemple",
  "formatnum",
  "lien-ancre",
]);
const SUPERSCRIPT = new Set(["e", "er", "re", "ère", "es", "ers", "res", "ème", "nd", "nde"]);
const LABELS = new Set(["term", "info lex", "lexique", "contexte", "région", "registre", "sens"]);
const ETYMOLOGY_LANGS: Record<string, string> = {
  la: "latin",
  grc: "grec ancien",
  fro: "ancien français",
  frm: "moyen français",
  frk: "francique",
  en: "anglais",
  de: "allemand",
  it: "italien",
  es: "espagnol",
  pt: "portugais",
  nl: "néerlandais",
  ar: "arabe",
  ja: "japonais",
  gaul: "gaulois",
};
const isLangCode = (s: string) => /^[a-z]{2,3}(-[a-z]+)?$/.test(s.trim());

function renderTemplate(body: string): string {
  const parts = body.split("|");
  const name = parts[0].trim().toLowerCase();
  const positional = parts.slice(1).filter((p) => !/^\s*[\w-]+\s*=/.test(p)).map((p) => p.trim());
  const named = Object.fromEntries(
    parts.slice(1).map((p) => /^\s*([\w-]+)\s*=(.*)$/s.exec(p)).filter((m) => m).map((m) => [m![1], m![2].trim()]),
  );
  if (DROP.has(name) || name.startsWith("ébauche")) return "";
  if (SUPERSCRIPT.has(name)) return name;
  if (FIRST.has(name)) return positional[0] ?? "";
  if (name === "lang") return positional[1] ?? positional[0] ?? "";
  if (name === "étyl" || name === "étylp") {
    const from = ETYMOLOGY_LANGS[positional[0]] ?? positional[0] ?? "";
    const word = named.mot ?? positional[2] ?? "";
    return [from, word ? `${word}` : ""].filter(Boolean).join(" ");
  }
  if (name === "lien web") return named.titre ?? "";
  if (name === "pron" || name === "phon") return positional[0] ? `\\${positional[0]}\\` : "";
  if (name === "variante de" || name === "variante ortho de") return `Variante de ${positional[0] ?? ""}`;
  if (LABELS.has(name)) {
    const labels = positional.filter((p) => p && !isLangCode(p));
    return labels.length ? `(${labels.join(", ")})` : "";
  }
  // Domain and register labels: {{familier|fr}}, {{figuré|fr}}, {{par extension}}.
  if (/^[\p{L}][\p{L} '-]+$/u.test(name) && positional.every(isLangCode) && name.length >= 4) {
    return `(${capitalize(name)})`;
  }
  return "";
}

/** Expands templates from the innermost out. */
export function expandTemplates(s: string): string {
  let out = s;
  for (let i = 0; i < 20 && out.includes("{{"); i++) {
    const next = out.replace(/\{\{([^{}]*)\}\}/g, (_, body: string) => renderTemplate(body));
    if (next === out) break;
    out = next;
  }
  return out.replace(/\{\{|\}\}/g, "");
}

/** One line of wikitext → plain text. */
export function cleanWikitext(s: string): string {
  const noRefs = s
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<ref[^>]*\/>/gi, "")
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, "");
  const text = expandTemplates(stripLinks(noRefs))
    .replace(/'''?/g, "")
    .replace(/<[^>]+>/g, "");
  return tidy(decodeEntities(text)).replace(/^[,;:.\s]+/, "").replace(/\(\s*\)/g, "").trim();
}

const POS: Record<string, string> = {
  nom: "Nom commun",
  "nom commun": "Nom commun",
  "nom propre": "Nom propre",
  "nom-pr": "Nom propre",
  prénom: "Prénom",
  verbe: "Verbe",
  adjectif: "Adjectif",
  adj: "Adjectif",
  adverbe: "Adverbe",
  adv: "Adverbe",
  pronom: "Pronom",
  préposition: "Préposition",
  prép: "Préposition",
  conjonction: "Conjonction",
  conj: "Conjonction",
  interjection: "Interjection",
  interj: "Interjection",
  article: "Article",
  "article défini": "Article défini",
  "article indéfini": "Article indéfini",
  "adjectif possessif": "Adjectif possessif",
  "adjectif démonstratif": "Adjectif démonstratif",
  "pronom personnel": "Pronom personnel",
  "pronom relatif": "Pronom relatif",
  "locution-phrase": "Locution-phrase",
  "locution nominale": "Locution nominale",
  onomatopée: "Onomatopée",
  préfixe: "Préfixe",
  suffixe: "Suffixe",
  symbole: "Symbole",
  "nom scientifique": "Nom scientifique",
  numéral: "Adjectif numéral",
};

const GENDERS: Record<string, string> = {
  m: "masculin",
  f: "féminin",
  mf: "masculin et féminin",
  "mf ?": "masculin ou féminin",
  n: "neutre",
};

const SECTION = /^(={2,6})\s*\{\{\s*S\s*\|([^}]*)\}\}\s*\1\s*$/;
const LANGUAGE = /^==\s*\{\{\s*langue\s*\|\s*([^}|]+?)\s*\}\}\s*==\s*$/;

/** Words of a list line: `* [[demeure]], [[logis]]` → demeure, logis. */
function listWords(line: string): string[] {
  const links = [...line.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]|\{\{\s*lien\s*\|([^|}]+)/g)]
    .map((m) => (m[1] ?? m[2]).trim())
    .filter((w) => !/^(Fichier|File|Catégorie|Category|Annexe|Thésaurus|Wiktionnaire|w):/i.test(w));
  if (links.length) return links;
  const text = cleanWikitext(line.replace(/^\*+:?\s*/, ""));
  return text ? [text] : [];
}

export function fromFrWikitext(title: string, wikitext: string, lang = "fr"): Entry | undefined {
  const lines = wikitext.split("\n");
  // The lines of the language section.
  let inLang = false;
  const body: string[] = [];
  for (const line of lines) {
    const l = LANGUAGE.exec(line.trim());
    if (l) {
      inLang = l[1] === lang;
      continue;
    }
    if (inLang) body.push(line);
  }
  if (!body.length) return undefined;

  const groups: Group[] = [];
  const ipa: string[] = [];
  let etymology: string | undefined;
  let current: Group | undefined;
  /** What the lines under the last heading are: a part of speech, a list of words, or something else. */
  let mode: "pos" | "synonyms" | "antonyms" | "etymology" | "other" = "other";
  let headwordSeen = false;

  for (const raw of body) {
    const line = raw.trimEnd();
    for (const m of line.matchAll(/\{\{\s*pron\s*\|([^|}]+)\|\s*(?:lang=)?fr\s*\}\}/g)) {
      if (m[1].trim()) ipa.push(m[1].trim());
    }
    const s = SECTION.exec(line.trim());
    if (s) {
      const params = s[2].split("|").map((p) => p.trim());
      const name = params[0].toLowerCase();
      const positional = params.slice(1).filter((p) => !p.includes("="));
      const flags = params.slice(1).filter((p) => p.includes("="));
      if (positional[0] === lang) {
        const base = POS[name] ?? capitalize(name);
        const locution = flags.some((f) => /^locution\s*=\s*oui/.test(f));
        const flexion = params.slice(1).some((f) => /^flexion\b/.test(f));
        const pos = flexion ? `Forme de ${base.toLowerCase()}` : locution ? `Locution (${base.toLowerCase()})` : base;
        current = { pos, senses: [], synonyms: [], antonyms: [] };
        groups.push(current);
        mode = "pos";
        headwordSeen = false;
      } else if (name === "synonymes" || name === "quasi-synonymes") mode = current ? "synonyms" : "other";
      else if (name === "antonymes") mode = current ? "antonyms" : "other";
      else if (name === "étymologie") mode = "etymology";
      else {
        mode = "other";
        // A new level-3 section ends the part of speech.
        if (s[1].length <= 3) current = undefined;
      }
      continue;
    }
    if (mode === "etymology" && !etymology && /^:/.test(line)) {
      etymology = cleanWikitext(line.replace(/^:+\s*/, "")) || undefined;
      continue;
    }
    if (!current) continue;
    if (mode === "pos") {
      if (!headwordSeen && /^'''/.test(line)) {
        headwordSeen = true;
        const g = [...line.matchAll(/\{\{\s*(mf \?|mf|m|f|n)\s*(?:\|[^}]*)?\}\}/g)].map((m) => GENDERS[m[1]]);
        if (g.length) current.gender = g[0];
        continue;
      }
      const def = /^#+(?![*:])\s*(.*)$/.exec(line);
      if (def) {
        const text = cleanWikitext(def[1]);
        if (text) current.senses.push({ definition: text, examples: [] });
        continue;
      }
      const ex = /^#+\*(?!:)\s*(.*)$/.exec(line);
      if (ex && current.senses.length) {
        const exemple = /\{\{\s*exemple\s*\|/.test(ex[1]);
        const text = cleanWikitext(exemple ? ex[1] : ex[1].replace(/\{\{\s*source\s*\|[\s\S]*\}\}\s*$/, ""));
        const sense = current.senses[current.senses.length - 1];
        if (text && sense.examples.length < 3) sense.examples.push(text);
      }
      continue;
    }
    if ((mode === "synonyms" || mode === "antonyms") && /^\*/.test(line)) {
      const words = listWords(line);
      if (mode === "synonyms") current.synonyms = unique([...current.synonyms, ...words]);
      else current.antonyms = unique([...current.antonyms, ...words]);
    }
  }
  const kept = groups.filter((g) => g.senses.length);
  if (!kept.length) return undefined;
  return {
    word: title,
    lang: "fr",
    ipa: unique(ipa),
    groups: kept,
    etymology,
    url: wiktionaryUrl(title, "fr"),
    source: "Wiktionnaire",
  };
}

// ---------------------------------------------------------------------------
// Presentation

/** A color per part of speech, the same in both languages. */
export function posColor(pos: string): Color {
  const p = pos.toLowerCase();
  if (/^(forme|locution)/.test(p)) return "gray";
  if (/noun|nom|prénom/.test(p)) return "blue";
  if (/verb/.test(p)) return "green";
  if (/adj/.test(p)) return "purple";
  if (/adv/.test(p)) return "orange";
  if (/pronoun|pronom/.test(p)) return "teal";
  if (/interj|onomat/.test(p)) return "pink";
  return "gray";
}

export function posIcon(pos: string): { source: string; tint: Color } {
  return { source: Icons.book, tint: posColor(pos) };
}

/** "/haʊs/" or "\mɛ.zɔ̃\" as the source writes it. */
export function ipaLine(entry: Entry): string | undefined {
  if (!entry.ipa.length) return undefined;
  return entry.ipa.slice(0, 2).map((p) => entry.lang === "fr" && !/^[\\/[]/.test(p) ? `\\${p}\\` : p).join(" · ");
}

/** Text to copy for one sense. */
export function senseText(entry: Entry, group: Group, sense: Sense): string {
  return `${entry.word} (${group.pos.toLowerCase()}): ${sense.definition}`;
}

/** The whole entry as markdown, for "Show Full Entry". */
export function entryMarkdown(entry: Entry): string {
  const ipa = ipaLine(entry);
  const out = [`# ${entry.word}`, ""];
  if (ipa) out.push(`*${ipa}*`, "");
  for (const g of entry.groups) {
    out.push(`## ${g.pos}${g.gender ? ` · ${g.gender}` : ""}`, "");
    g.senses.forEach((s, i) => {
      out.push(`${i + 1}. ${s.definition}`);
      for (const e of s.examples) out.push(`> ${e}`);
    });
    out.push("");
    if (g.synonyms.length) {
      out.push(`**${entry.lang === "fr" ? "Synonymes" : "Synonyms"}:** ${g.synonyms.join(", ")}`, "");
    }
    if (g.antonyms.length) {
      out.push(`**${entry.lang === "fr" ? "Antonymes" : "Antonyms"}:** ${g.antonyms.join(", ")}`, "");
    }
  }
  if (entry.etymology) out.push(`## ${entry.lang === "fr" ? "Étymologie" : "Etymology"}`, "", entry.etymology, "");
  out.push("---", `Source: [${entry.source}](${entry.url})`);
  return out.join("\n");
}

/** The whole entry as plain text, to copy. */
export function entryText(entry: Entry): string {
  const lines = [entry.word + (entry.ipa[0] ? ` ${ipaLine(entry)}` : "")];
  for (const g of entry.groups) {
    lines.push("", g.pos + (g.gender ? ` (${g.gender})` : ""));
    g.senses.forEach((s, i) => lines.push(`${i + 1}. ${s.definition}`));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Translation: MyMemory

export interface Translation {
  text: string;
  match: number;
  alternatives: { text: string; quality: number; source: string }[];
}

export interface MyMemoryResponse {
  responseData?: { translatedText?: string; match?: number };
  responseStatus?: number | string;
  responseDetails?: string;
  quotaFinished?: boolean;
  matches?: {
    translation: string;
    quality?: number | string;
    match?: number;
    "created-by"?: string;
    reference?: string;
  }[];
}

export function parseTranslation(res: MyMemoryResponse): Translation {
  const text = decodeEntities(res.responseData?.translatedText ?? "").trim();
  if (Number(res.responseStatus) !== 200 || /^MYMEMORY WARNING/i.test(text) || res.quotaFinished) {
    throw new Error(`MyMemory: ${res.responseDetails || text || "translation failed"}`);
  }
  const seen = new Set([text.toLowerCase()]);
  const alternatives = (res.matches ?? [])
    .map((m) => ({
      text: decodeEntities(m.translation ?? "").trim(),
      quality: Number(m.quality ?? 0),
      source: m["created-by"] ?? "",
    }))
    .filter((m) => m.text && !seen.has(m.text.toLowerCase()) && seen.add(m.text.toLowerCase()));
  return { text, match: Number(res.responseData?.match ?? 0), alternatives: alternatives.slice(0, 6) };
}

/**
 * "en>fr hello", ">de hello", "hello" (default direction). Two-letter codes,
 * any language MyMemory knows.
 */
export function parseTranslateQuery(
  query: string,
  from: string,
  to: string,
): { from: string; to: string; text: string } {
  const m = /^\s*([a-z]{2})?\s*>\s*([a-z]{2})\s+(.*)$/is.exec(query);
  if (m) {
    const target = m[2].toLowerCase();
    const source = m[1]?.toLowerCase() ?? (target === from ? to : from);
    return { from: source, to: target, text: m[3].trim() };
  }
  return { from, to, text: query.trim() };
}

export function myMemoryUrl(text: string, from: string, to: string): string {
  return `https://api.mymemory.translated.net/get?${new URLSearchParams({ q: text, langpair: `${from}|${to}` })}`;
}
