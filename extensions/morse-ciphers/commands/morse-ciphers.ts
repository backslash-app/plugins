import { copy, Icons, type Item, list, meta, paste } from "@backslash/api";
import {
  caesar,
  caesarGuesses,
  type Conversion,
  conversions,
  decodings,
  EXAMPLES,
  FORMAT_TITLE,
  parseQuery,
  vigenere,
} from "../lib.ts";

const SYNTAX = [
  "## What you can type",
  "",
  "- Any text: it is written in Morse, the NATO and French alphabets, ROT13, ROT47, Atbash, A1Z26, binary, hex, braille and upside down",
  "- Morse (`... --- ...`, words separated by `/`), NATO words, binary, hex, A1Z26 (`8-5-12-12-15`), braille or upside-down text: it is decoded",
  "- `caesar Wkh txlfn` tries the 25 shifts, the most likely first; `caesar 3 text` shifts by 3",
  "- `vigenere KEY text` encrypts and decrypts with a key",
  "",
  "Morse prosigns are written in angle brackets: `<SOS>`, `<AR>`, `<SK>`.",
].join("\n");

function preview(text: string): string {
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

function block(text: string): string {
  return ["```", preview(text).replace(/```/g, "``​`"), "```"].join("\n");
}

function outputItem(id: string, section: string, title: string, output: string, input: string, note?: string): Item {
  return {
    id,
    title: output.length > 120 ? `${output.slice(0, 120)}…` : output,
    subtitle: title,
    icon: { source: Icons.text, tint: "blue" },
    section,
    keywords: [title],
    accessories: note ? [{ icon: { source: Icons.alert, tint: "orange" }, tooltip: note }] : [],
    detail: {
      markdown: [`## ${title}`, "", block(output), ...(note ? ["", `> ${note}`] : [])].join("\n"),
      metadata: [
        meta.text("From", preview(input).slice(0, 80)),
        meta.text("Characters", [...output].length),
      ],
    },
    actions: [copy(output, "Copy Result"), paste(output, "Paste Result")],
  };
}

function conversionItems(text: string, section: string): Item[] {
  return conversions(text).map((c: Conversion) =>
    outputItem(`to:${section}:${c.id}`, section, c.title, c.output, text, c.note)
  );
}

function exampleItems(): Item[] {
  return EXAMPLES.map((e) => ({
    id: `example:${e.query}`,
    title: e.query,
    subtitle: e.title,
    icon: { source: Icons.lightbulb, tint: "yellow" },
    section: "Examples: type one",
    detail: { markdown: SYNTAX },
    actions: [copy(e.query, "Copy Example")],
  }));
}

function caesarItems(text: string, shift?: number): Item[] {
  if (shift !== undefined) {
    const encrypted = caesar(text, shift);
    const decrypted = caesar(text, -shift);
    return [
      outputItem("caesar:enc", `Caesar, shift ${shift}`, `Encrypted (+${shift})`, encrypted, text),
      outputItem("caesar:dec", `Caesar, shift ${shift}`, `Decrypted (−${shift})`, decrypted, text),
    ];
  }
  const guesses = caesarGuesses(text).filter((g) => g.shift !== 0);
  return guesses.map((g, i) => ({
    ...outputItem(
      `caesar:${g.shift}`,
      "Caesar: every shift, most likely first",
      `Shift ${g.shift} (ROT${g.shift})${i === 0 ? ` · best guess, reads like ${g.language}` : ""}`,
      g.text,
      text,
    ),
    accessories: i === 0
      ? [{ tag: "Best guess", color: "green" as const }, { text: `ROT${g.shift}` }]
      : [{ text: `ROT${g.shift}` }],
    icon: { source: i === 0 ? Icons.sparkle : Icons.text, tint: i === 0 ? "green" as const : "gray" as const },
  }));
}

export default list({
  placeholder: "Text, ... --- ..., Hotel Echo, caesar 3 text, vigenere KEY text",
  empty: { title: "Nothing to convert", icon: Icons.text },
  status: (items) => {
    const first = items[0];
    if (!first) return "";
    if (first.id?.startsWith("example:")) return "Morse · NATO · ROT13 · Caesar · Vigenère · braille";
    if (first.id?.startsWith("decoded:")) return `Decoded from ${first.subtitle}`;
    return first.section ?? "";
  },
  search(query) {
    const q = parseQuery(query);
    switch (q.kind) {
      case "empty":
        return exampleItems();
      case "error":
        return [{
          id: "error",
          title: q.message,
          icon: { source: Icons.alert, tint: "red" },
          detail: { markdown: SYNTAX },
        }, ...exampleItems()];
      case "caesar":
        return caesarItems(q.text, q.shift);
      case "vigenere": {
        const section = `Vigenère, key ${q.key.toUpperCase()}`;
        return [
          outputItem("vig:enc", section, "Encrypted", vigenere(q.text, q.key), q.text),
          outputItem("vig:dec", section, "Decrypted", vigenere(q.text, q.key, true), q.text),
        ];
      }
      case "auto": {
        const found = decodings(q.text);
        const items: Item[] = found.map((d) => ({
          ...outputItem(`decoded:${d.format}`, "Decoded", FORMAT_TITLE[d.format], d.text, q.text, d.note),
          icon: { source: Icons.check, tint: "green" },
        }));
        // Decoded text is then written the other ways; plain text directly.
        const plain = found[0]?.text ?? q.text;
        items.push(...conversionItems(plain, found.length ? "The decoded text as…" : "Written as…"));
        if (!found.length && /[a-z]{4}/i.test(q.text)) {
          const best = caesarGuesses(q.text)[0];
          if (best.shift !== 0) {
            items.push({
              ...outputItem(
                "caesar:guess",
                "If it's a Caesar cipher",
                `Shift ${best.shift}, reads like ${best.language} (type caesar … for all shifts)`,
                best.text,
                q.text,
              ),
              icon: { source: Icons.sparkle, tint: "purple" },
            });
          }
        }
        return items;
      }
    }
  },
});
