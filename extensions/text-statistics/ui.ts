// List items for an analysis.

import { type Action, type Color, copy, Icons, type Item, meta } from "@backslash/api";
import {
  bytes,
  duration,
  easeColor,
  ellipsis,
  LANGUAGE_TITLE,
  number,
  plural,
  READING_WPM,
  SPEAKING_WPM,
  type Stats,
  summary,
} from "./lib.ts";

export type Source = "typed" | "clipboard" | "form";

const SOURCE_TITLE: Record<Source, string> = {
  typed: "Typed text",
  clipboard: "Clipboard",
  form: "Pasted text",
};

function overviewMarkdown(s: Stats, text: string): string {
  const out = [
    `## ${plural(s.words, "word")}`,
    "",
    `${plural(s.characters, "character")}, ${plural(s.sentences, "sentence")}, ${
      plural(s.paragraphs, "paragraph")
    }. About **${duration(s.readingTime)}** to read and **${duration(s.speakingTime)}** to say out loud.`,
  ];
  if (s.readability) {
    out.push(
      "",
      `Readability: **${s.readability.label.toLowerCase()}** (${s.readability.formula} ${s.readability.ease}), ` +
        `for ${s.readability.audience}.`,
    );
  }
  if (s.topWords.length) {
    out.push("", "### Frequent words", "", s.topWords.slice(0, 5).map((w) => `${w.word} (${w.count})`).join(", "));
  }
  out.push("", "### Text", "", "> " + ellipsis(text, 400).replace(/\n/g, " "));
  return out.join("\n");
}

function metadata(s: Stats, source: Source) {
  return [
    meta.tags("Language", [{ text: LANGUAGE_TITLE[s.language], color: "blue" }]),
    meta.text("Source", SOURCE_TITLE[source]),
    meta.separator(),
    meta.text("Words", number(s.words)),
    meta.text("Unique words", number(s.uniqueWords)),
    meta.text("Characters", number(s.characters)),
    meta.text("Without spaces", number(s.charactersNoSpaces)),
    meta.text("Sentences", number(s.sentences)),
    meta.text("Paragraphs", number(s.paragraphs)),
    meta.text("Lines", number(s.lines)),
    meta.text("Syllables", number(s.syllables)),
    meta.text("Size", bytes(s.bytes)),
  ];
}

/** Every row of the analysis of `text`. */
export function statItems(s: Stats, text: string, source: Source, extra: Action[] = []): Item[] {
  const sum = summary(s);
  const shared: Action[] = [copy(sum, "Copy Summary", { icon: Icons.text, shortcut: "<Ctrl><Shift>c" }), ...extra];
  const panel = { markdown: overviewMarkdown(s, text), metadata: metadata(s, source) };
  const row = (
    id: string,
    title: string,
    value: string,
    icon: string,
    o: { subtitle?: string; tint?: Color; keywords?: string[] } = {},
  ): Item => ({
    id,
    title,
    subtitle: o.subtitle,
    icon: { source: icon, tint: o.tint ?? "blue" },
    section: "Counts",
    keywords: o.keywords,
    accessories: [{ text: value }],
    detail: panel,
    actions: [copy(value.replace(/,/g, ""), `Copy ${title}`), ...shared],
  });

  const items: Item[] = [{
    id: "overview",
    title: `${plural(s.words, "word")} · ${plural(s.characters, "character")}`,
    subtitle: `${duration(s.readingTime)} to read · ${LANGUAGE_TITLE[s.language]}`,
    icon: { source: Icons.text, tint: "blue" },
    section: SOURCE_TITLE[source],
    detail: {
      stats: [
        { label: "Words", value: number(s.words) },
        { label: "Characters", value: number(s.characters) },
        { label: "Sentences", value: number(s.sentences) },
        { label: "Reading", value: duration(s.readingTime) },
      ],
      ...panel,
    },
    actions: [...shared.slice(0, 1), copy(String(s.words), "Copy Word Count"), ...shared.slice(1)],
  }];

  items.push(
    row("words", "Words", number(s.words), Icons.text, {
      subtitle: `${number(s.uniqueWords)} unique`,
      keywords: ["mots", "word count"],
    }),
    row("characters", "Characters", number(s.characters), Icons.font, { keywords: ["caractères", "letters"] }),
    row("characters-no-spaces", "Characters without Spaces", number(s.charactersNoSpaces), Icons.font, {
      keywords: ["caractères sans espaces"],
    }),
    row("sentences", "Sentences", number(s.sentences), Icons.text, { keywords: ["phrases"] }),
    row("paragraphs", "Paragraphs", number(s.paragraphs), Icons.layers, { keywords: ["paragraphes"] }),
    row("lines", "Lines", number(s.lines), Icons.hash, { keywords: ["lignes"] }),
    row("unique", "Unique Words", number(s.uniqueWords), Icons.star, {
      subtitle: s.words ? `${Math.round(s.uniqueWords / s.words * 100)} % of the words` : undefined,
      keywords: ["vocabulary", "vocabulaire", "mots uniques"],
    }),
    row("average-word", "Average Word Length", `${s.averageWordLength} letters`, Icons.minus, {
      keywords: ["longueur moyenne des mots"],
    }),
    row("average-sentence", "Average Sentence Length", `${s.averageSentenceLength} words`, Icons.minus, {
      keywords: ["longueur moyenne des phrases"],
    }),
    row("reading", "Reading Time", duration(s.readingTime), Icons.book, {
      subtitle: `At ${READING_WPM[s.language]} words a minute`,
      tint: "teal",
      keywords: ["temps de lecture"],
    }),
    row("speaking", "Speaking Time", duration(s.speakingTime), Icons.mic, {
      subtitle: `At ${SPEAKING_WPM} words a minute`,
      tint: "teal",
      keywords: ["temps de parole", "speech", "discours"],
    }),
    row("size", "Size", bytes(s.bytes), Icons.file, { subtitle: "UTF-8", tint: "gray", keywords: ["bytes", "octets"] }),
  );

  if (s.readability) {
    const r = s.readability;
    items.push({
      id: "readability",
      title: r.label,
      subtitle: `${r.formula}${r.grade !== undefined ? ` · grade ${r.grade}` : ""} · for ${r.audience}`,
      icon: { source: Icons.activity, tint: easeColor(r.ease) },
      section: "Readability",
      keywords: ["readability", "lisibilité", "flesch", "kincaid", "kandel", "moles"],
      accessories: [{ tag: String(r.ease), color: easeColor(r.ease) }],
      detail: {
        markdown: [
          `## ${r.label}`,
          "",
          `${r.formula}: **${r.ease}**, readable by ${r.audience}.`,
          "",
          "| Score | Means |",
          "|---|---|",
          "| 90–100 | Very easy |",
          "| 70–90 | Easy to fairly easy |",
          "| 60–70 | Plain |",
          "| 50–60 | Fairly difficult |",
          "| 30–50 | Difficult |",
          "| 0–30 | Very difficult |",
          "",
          s.language === "fr"
            ? "Kandel and Moles adapted Flesch's formula to French: 207 − 1.015 × words per sentence − 73.6 × syllables per word."
            : "206.835 − 1.015 × words per sentence − 84.6 × syllables per word. The grade is the Flesch–Kincaid US school grade.",
          "",
          "Shorter sentences and shorter words make a text easier.",
        ].join("\n"),
        metadata: [
          meta.text("Score", String(r.ease), { color: easeColor(r.ease) }),
          ...(r.grade !== undefined ? [meta.text("Grade level", String(r.grade))] : []),
          meta.text("Words per sentence", String(s.averageSentenceLength)),
          meta.text("Syllables per word", s.words ? (s.syllables / s.words).toFixed(2) : "0"),
        ],
      },
      actions: [copy(String(r.ease), "Copy Score"), ...shared],
    });
  }

  if (s.longestSentence && s.sentences > 1) {
    items.push({
      id: "longest-sentence",
      title: ellipsis(s.longestSentence.text, 90),
      subtitle: "Longest sentence",
      icon: { source: Icons.arrowRight, tint: s.longestSentence.words > 35 ? "orange" : "gray" },
      section: "Longest",
      accessories: [{ text: plural(s.longestSentence.words, "word") }],
      detail: {
        markdown: [
          `## Longest sentence: ${plural(s.longestSentence.words, "word")}`,
          "",
          `> ${s.longestSentence.text}`,
          s.longestSentence.words > 35 ? "\nOver 35 words: consider splitting it." : "",
        ].join("\n"),
      },
      actions: [copy(s.longestSentence.text, "Copy Sentence"), ...shared],
    });
  }
  if (s.longestWord) {
    items.push({
      id: "longest-word",
      title: s.longestWord,
      subtitle: "Longest word",
      icon: { source: Icons.arrowRight, tint: "gray" },
      section: "Longest",
      accessories: [{ text: plural([...s.longestWord].length, "letter") }],
      detail: panel,
      actions: [copy(s.longestWord, "Copy Word"), ...shared],
    });
  }

  const max = s.topWords[0]?.count ?? 0;
  for (const [i, w] of s.topWords.entries()) {
    items.push({
      id: `top:${w.word}`,
      title: w.word,
      subtitle: `${Math.round(w.count / Math.max(1, s.words) * 1000) / 10} % of the words`,
      icon: { source: Icons.hash, tint: i < 3 ? "purple" : "gray" },
      section: "Frequent Words",
      accessories: [{ text: `× ${w.count}` }],
      detail: {
        markdown: [
          "## Frequent words",
          "",
          "Without common words like “the” or “le”.",
          "",
          "| Word | Times |",
          "|---|---|",
          ...s.topWords.map((t) => `| ${t.word} | ${t.count} |`),
        ].join("\n"),
        metadata: [meta.progress(w.word, max ? w.count / max : 0, `× ${w.count}`)],
      },
      actions: [copy(w.word, "Copy Word"), ...shared],
    });
  }
  return items;
}
