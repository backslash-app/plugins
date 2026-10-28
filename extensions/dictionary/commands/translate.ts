import { action, type Context, copy, Icons, type Item, list, meta, paste } from "@backslash/api";
import { translate } from "../api.ts";
import { type Lang, langOf, LANGS, parseTranslateQuery } from "../lib.ts";
import { translationView, wordView } from "../views.ts";

const name = (code: string) => LANGS[code as Lang] ?? code.toUpperCase();

async function search(query: string, ctx: Context): Promise<Item[]> {
  const base = langOf(ctx.preferences.language);
  const { from, to, text } = parseTranslateQuery(query, base, base === "fr" ? "en" : "fr");
  if (!text) return [];
  const t = await translate(text, from, to, ctx.signal);
  const direction = `${name(from)} → ${name(to)}`;
  const single = !/\s/.test(t.text) && (to === "en" || to === "fr");
  const common = (result: string) => [
    copy(result, "Copy Translation"),
    paste(result, "Paste Translation"),
    action("Translate Back", () => translationView(result, to, from), { icon: Icons.refresh, shortcut: "<Ctrl>b" }),
    ...(single
      ? [action("Look Up in Dictionary", () => wordView(result, to as Lang), { icon: Icons.book, shortcut: "<Ctrl>d" })]
      : []),
    copy(text, "Copy Original", { section: "Copy" }),
  ];
  return [
    {
      id: "main",
      title: t.text,
      subtitle: text,
      icon: { source: Icons.globe, tint: "blue" },
      section: direction,
      accessories: [{ tag: `${from.toUpperCase()} → ${to.toUpperCase()}` }],
      detail: {
        markdown: `# ${t.text}\n\n> ${text}`,
        metadata: [
          meta.text("From", name(from), { icon: Icons.globe }),
          meta.text("To", name(to), { icon: Icons.globe }),
          ...(t.match ? [meta.progress("Match", t.match)] : []),
          meta.text("Source", "MyMemory"),
        ],
      },
      actions: common(t.text),
    },
    ...t.alternatives.map((a, i) => ({
      id: `alt:${i}`,
      title: a.text,
      subtitle: a.source || undefined,
      icon: { source: Icons.globe, tint: "gray" as const },
      section: "Other Translations",
      accessories: a.quality ? [{ text: `${a.quality} %`, tooltip: "Quality" }] : [],
      actions: common(a.text),
    })),
  ];
}

export default list({
  placeholder: "Translate… (en>fr hello, >de bonjour)",
  empty: {
    title: "Type something to translate",
    description: "English ↔ French by default; prefix with en>fr, fr>en or >de to pick languages",
    icon: Icons.globe,
  },
  status: "MyMemory · free, no account",
  search,
});
