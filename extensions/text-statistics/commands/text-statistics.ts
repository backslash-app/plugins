import { action, clipboard, copy, field, form, Icons, type Item, list, replace } from "@backslash/api";
import { analyze, type Language, plural } from "../lib.ts";
import { type Source, statItems } from "../ui.ts";

// Clipboards can hold a whole book: past this, only the start is analyzed.
const MAX = 1_000_000;

function languageOf(value: unknown): Language | undefined {
  return value === "en" || value === "fr" ? value : undefined;
}

const pasteForm = (lang: Language | undefined) =>
  form({
    title: "Analyze Text",
    submitTitle: "Analyze",
    fields: [field.textArea("text", "Text", { placeholder: "Paste or type a long text", required: true })],
    submit: (values) => {
      const text = String(values.text ?? "");
      return replace(list({
        title: "Text Statistics",
        status: (items) => String(items[0]?.title ?? ""),
        items: statItems(analyze(text.slice(0, MAX), lang), text, "form"),
      }));
    },
  });

function hint(lang: Language | undefined, reason: string): Item[] {
  return [{
    id: "hint",
    title: reason,
    subtitle: "Type or paste text in the search bar, or copy some text first",
    icon: { source: Icons.info, tint: "blue" },
    actions: [action("Analyze Long Text…", () => pasteForm(lang), { icon: Icons.text })],
  }];
}

export default list({
  placeholder: "Type or paste text, or leave empty for the clipboard",
  empty: { title: "No text", icon: Icons.text },
  status: (items) => items[0]?.id === "overview" ? String(items[0].subtitle ?? "") : "",
  async search(query, ctx) {
    const lang = languageOf(ctx.preferences.language);
    const more = [action("Analyze Long Text…", () => pasteForm(lang), { icon: Icons.text, shortcut: "<Ctrl>t" })];
    if (query.trim()) {
      return statItems(analyze(query, lang), query, "typed" satisfies Source, more);
    }
    const text = (await clipboard.read().catch(() => "")).slice(0, MAX);
    if (!text.trim()) return hint(lang, "The clipboard has no text");
    // A copied file in a file manager is a path list, not prose.
    if (/^(file:\/\/\S+\s*)+$/.test(text.trim())) return hint(lang, "The clipboard holds files, not text");
    const stats = analyze(text, lang);
    return statItems(stats, text, "clipboard", [
      ...more,
      copy(String(stats.words), `Copy “${plural(stats.words, "word")}”`, { icon: Icons.hash }),
    ]);
  },
});
