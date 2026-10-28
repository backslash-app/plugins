// Entries and translations as launcher items, shared by both commands.

import {
  type Action,
  action,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  paste,
} from "@backslash/api";
import { lookup, translate } from "./api.ts";
import {
  type Entry,
  entryMarkdown,
  entryText,
  type Group,
  ipaLine,
  type Lang,
  LANGS,
  posColor,
  posIcon,
  type Sense,
  senseText,
  wiktionaryUrl,
} from "./lib.ts";

const other = (lang: Lang): Lang => lang === "fr" ? "en" : "fr";

/** Looks a word up and shows its entry, or says there is none. */
export async function wordView(word: string, lang: Lang, signal?: AbortSignal): Promise<ListSpec> {
  const entry = await lookup(word, lang, signal);
  return list({
    title: word,
    placeholder: `Filter the definitions of “${word}”…`,
    status: entry ? status(entry) : undefined,
    items: entry ? entryItems(entry) : [notFound(word, lang)],
  });
}

export function status(entry: Entry): string {
  const n = entry.groups.reduce((sum, g) => sum + g.senses.length, 0);
  return [entry.word, ipaLine(entry), `${n} definition${n === 1 ? "" : "s"}`, entry.source].filter(Boolean).join(" · ");
}

/** A detail page with the translation of `text`. */
export async function translationView(text: string, from: string, to: string): Promise<DetailSpec> {
  const t = await translate(text, from, to);
  return detail({
    title: `${from.toUpperCase()} → ${to.toUpperCase()}`,
    markdown: [
      `# ${t.text}`,
      "",
      `> ${text}`,
      "",
      ...(t.alternatives.length ? ["**Other translations**", "", ...t.alternatives.map((a) => `- ${a.text}`)] : []),
    ].join("\n"),
    metadata: [
      meta.text("From", LANGS[from as Lang] ?? from.toUpperCase(), { icon: Icons.globe }),
      meta.text("To", LANGS[to as Lang] ?? to.toUpperCase(), { icon: Icons.globe }),
      ...(t.match ? [meta.progress("Match", t.match)] : []),
      meta.text("Source", "MyMemory"),
    ],
    actions: [
      copy(t.text, "Copy Translation"),
      paste(t.text, "Paste Translation"),
      ...t.alternatives.slice(0, 4).map((a) => copy(a.text, `Copy “${a.text}”`, { section: "Other Translations" })),
    ],
  });
}

function translateAction(word: string, lang: Lang): Action {
  const to = other(lang);
  return action(`Translate to ${LANGS[to]}`, () => translationView(word, lang, to), {
    icon: Icons.globe,
    shortcut: "<Ctrl>t",
    section: "Word",
  });
}

export function notFound(word: string, lang: Lang): Item {
  const search = lang === "fr"
    ? `https://fr.wiktionary.org/w/index.php?search=${encodeURIComponent(word)}`
    : `https://en.wiktionary.org/w/index.php?search=${encodeURIComponent(word)}`;
  return {
    id: `missing:${lang}:${word}`,
    title: `No definition for “${word}”`,
    subtitle: lang === "fr" ? "Wiktionnaire" : "Wiktionary",
    icon: { source: Icons.question, tint: "gray" },
    accessories: [{ tag: lang.toUpperCase() }],
    detail: {
      markdown: `Nothing found for **${word}** in ${LANGS[lang]}.\n\n` +
        `Check the spelling, or switch language with a prefix: \`${other(lang)}:${word}\`.`,
    },
    actions: [
      open(search, "Search on Wiktionary", { icon: Icons.search }),
      translateAction(word, lang),
    ],
  };
}

function senseMetadata(entry: Entry, group: Group): Metadata[] {
  const fr = entry.lang === "fr";
  const ipa = ipaLine(entry);
  return [
    meta.text(fr ? "Mot" : "Word", entry.word, { icon: Icons.book }),
    ...(ipa ? [meta.text(fr ? "Prononciation" : "Pronunciation", ipa, { icon: Icons.speaker })] : []),
    meta.tags(fr ? "Nature" : "Part of speech", [{ text: group.pos, color: posColor(group.pos) }]),
    ...(group.gender ? [meta.text("Genre", group.gender)] : []),
    ...(group.synonyms.length ? [meta.tags(fr ? "Synonymes" : "Synonyms", group.synonyms.slice(0, 8))] : []),
    ...(group.antonyms.length ? [meta.tags(fr ? "Antonymes" : "Antonyms", group.antonyms.slice(0, 6))] : []),
    meta.separator(),
    meta.text(fr ? "Langue" : "Language", LANGS[entry.lang], { icon: Icons.globe }),
    meta.link("Source", entry.source, entry.url),
  ];
}

function senseMarkdown(entry: Entry, group: Group, sense: Sense, n: number): string {
  const ipa = ipaLine(entry);
  return [
    `## ${entry.word}`,
    `*${[group.pos.toLowerCase(), group.gender, ipa].filter(Boolean).join(" · ")}*`,
    "",
    `**${n}.** ${sense.definition}`,
    "",
    ...sense.examples.map((e) => `> ${e}`),
  ].join("\n");
}

function entryActions(entry: Entry, extra: { definition?: string; copyTitle?: string } = {}): Action[] {
  return [
    ...(extra.definition ? [copy(extra.definition, extra.copyTitle ?? "Copy Definition")] : []),
    open(entry.url, entry.lang === "fr" ? "Open on Wiktionnaire" : "Open on Wiktionary", { shortcut: "<Ctrl>o" }),
    action("Show Full Entry", () =>
      detail({
        title: entry.word,
        markdown: entryMarkdown(entry),
        status: status(entry),
        actions: [
          copy(entryText(entry), "Copy Entry"),
          open(entry.url, entry.lang === "fr" ? "Open on Wiktionnaire" : "Open on Wiktionary"),
        ],
      }), { icon: Icons.text, shortcut: "<Ctrl>Return", section: "Word" }),
    translateAction(entry.word, entry.lang),
    copy(entry.word, "Copy Word", { shortcut: "<Ctrl>period", section: "Copy" }),
    ...(entry.ipa[0] ? [copy(ipaLine(entry)!, "Copy Pronunciation", { section: "Copy" })] : []),
    copy(entryText(entry), "Copy Full Entry", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
  ];
}

/** One item per definition, grouped by part of speech, then the synonyms. */
export function entryItems(entry: Entry): Item[] {
  const items: Item[] = [];
  for (const group of entry.groups) {
    const section = group.gender ? `${group.pos} · ${group.gender}` : group.pos;
    group.senses.forEach((sense, i) => {
      items.push({
        id: `${entry.lang}:${entry.word}:${group.pos}:${i}`,
        title: sense.definition,
        icon: posIcon(group.pos),
        section,
        keywords: [entry.word, group.pos, ...sense.examples],
        accessories: sense.examples.length
          ? [{ icon: Icons.comment, text: String(sense.examples.length), tooltip: "Examples" }]
          : [],
        detail: { markdown: senseMarkdown(entry, group, sense, i + 1), metadata: senseMetadata(entry, group) },
        actions: entryActions(entry, { definition: senseText(entry, group, sense) }),
      });
    });
  }
  const synonyms = [...new Set(entry.groups.flatMap((g) => g.synonyms))].slice(0, 12);
  for (const word of synonyms) {
    items.push({
      id: `syn:${entry.lang}:${word}`,
      title: word,
      subtitle: entry.lang === "fr" ? `synonyme de ${entry.word}` : `synonym of ${entry.word}`,
      icon: { source: Icons.link, tint: "teal" },
      section: entry.lang === "fr" ? "Synonymes" : "Synonyms",
      actions: [
        action("Look Up", () => wordView(word, entry.lang), { icon: Icons.book }),
        copy(word, "Copy Word"),
        open(wiktionaryUrl(word, entry.lang), entry.lang === "fr" ? "Open on Wiktionnaire" : "Open on Wiktionary"),
      ],
    });
  }
  return items;
}
