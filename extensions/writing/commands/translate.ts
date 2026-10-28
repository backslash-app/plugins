import { action, type Context, copy, Icons, type Item, list, paste } from "@backslash/api";
import { deeplKey, KeyError, languageName, languagePrefs, parseQuery, preview } from "../lib.ts";
import { clipboardText, selection, translateSmart, usage } from "../services.ts";
import { direction, keyItem, recents, type Setup, translationDetail, translationItem } from "../translate.ts";

let status = "";

/** "Translate Selection" / "Translate Clipboard" rows, shown before anything is typed. */
function sourceItem(
  setup: Setup,
  langs: ReturnType<typeof languagePrefs>,
  text: string,
  from: "Selection" | "Clipboard",
): Item {
  return {
    id: from,
    title: preview(text, 100),
    subtitle: `Translate ${from.toLowerCase()} into ${languageName(langs.target)}`,
    icon: { source: from === "Selection" ? Icons.text : Icons.paste, tint: "blue" },
    section: from === "Selection" ? "Selected Text" : "Clipboard",
    detail: { markdown: text.trim().slice(0, 4000) },
    actions: [
      action("Translate", async () => {
        const t = await translateSmart(setup.key, text, { ...langs });
        return translationDetail(setup, t, await usage(setup.key));
      }, { icon: Icons.globe }),
    ],
  };
}

export default (ctx: Context) =>
  list({
    placeholder: "Text to translate… (de: text, >ja text, fr>en text)",
    empty: {
      title: "Type to translate",
      description: "“de: Good morning” picks German for this one.",
      icon: Icons.globe,
    },
    status: () => status,
    async search(query, { signal }) {
      let key: string;
      try {
        key = deeplKey(ctx.preferences);
      } catch (e) {
        if (e instanceof KeyError) return [keyItem(e.message)];
        throw e;
      }
      const langs = languagePrefs(ctx.preferences);
      const setup: Setup = { key, target: langs.target };
      const req = parseQuery(query, langs.target);
      status = `To ${languageName(req.target ?? langs.target)}${
        langs.second && !req.target ? `, or ${languageName(langs.second)}` : ""
      } · DeepL`;

      if (!req.text) {
        const [sel, clip, recent] = await Promise.all([selection(), clipboardText(), recents()]);
        const items: Item[] = [];
        if (sel.trim()) items.push(sourceItem(setup, langs, sel, "Selection"));
        if (clip.trim() && clip.trim() !== sel.trim()) items.push(sourceItem(setup, langs, clip, "Clipboard"));
        for (const r of recent) {
          items.push({
            id: `recent:${r.at}`,
            title: preview(r.text, 100),
            subtitle: preview(r.original, 60),
            icon: { source: Icons.history, tint: "gray" },
            section: "Recent",
            accessories: [{ tag: `${r.source || "?"} → ${r.target}` }],
            detail: { markdown: `${r.text}\n\n---\n\n> ${r.original.replace(/\n/g, "\n> ")}` },
            actions: [
              copy(r.text, "Copy Translation"),
              paste(r.text, "Paste Translation"),
              copy(r.original, "Copy Original", { section: "Copy" }),
            ],
          });
        }
        return items;
      }

      try {
        const t = await translateSmart(key, req.text, {
          target: req.target ?? langs.target,
          second: langs.second,
          source: req.source,
          explicit: !!req.target,
          formality: langs.formality,
        }, signal);
        status = `${direction(t)} · DeepL`;
        return [translationItem(setup, t, await usage(key, signal))];
      } catch (e) {
        if (e instanceof KeyError) return [keyItem(e.message)];
        throw e;
      }
    },
  });
