import { action, type Context, Icons, type Item, list, refresh } from "@backslash/api";
import { forget, lookup, recents, remember } from "../api.ts";
import { langOf, LANGS, parseQuery } from "../lib.ts";
import { entryItems, notFound, status, wordView } from "../views.ts";

let lastStatus = "";

/** Recent lookups, when nothing is typed. */
async function recentItems(): Promise<Item[]> {
  return (await recents()).map((r) => ({
    id: `recent:${r.lang}:${r.word}`,
    title: r.word,
    icon: { source: Icons.history, tint: "gray" as const },
    section: "Recent",
    accessories: [{ tag: r.lang.toUpperCase() }],
    actions: [
      action("Look Up", () => wordView(r.word, r.lang), { icon: Icons.book }),
      action("Remove from Recent", async () => {
        await forget(r.word, r.lang);
        return refresh();
      }, { icon: Icons.trash, destructive: true, shortcut: "<Ctrl>x", section: "Recent" }),
      action("Clear Recent", async () => {
        await forget();
        return refresh();
      }, { icon: Icons.trash, destructive: true, confirm: "Clear all recent lookups?", section: "Recent" }),
    ],
  }));
}

async function search(query: string, ctx: Context): Promise<Item[]> {
  const { lang, word } = parseQuery(query, langOf(ctx.preferences.language));
  if (!word) {
    lastStatus = "";
    return recentItems();
  }
  const entry = await lookup(word, lang, ctx.signal);
  if (!entry) {
    lastStatus = `${LANGS[lang]} · nothing found`;
    return [notFound(word, lang)];
  }
  lastStatus = status(entry);
  // Remembered once the user stops typing on it.
  setTimeout(() => {
    if (!ctx.signal.aborted) remember(entry.word, lang).catch(() => {});
  }, 1500);
  return entryItems(entry);
}

export default list({
  placeholder: "Look up a word… (fr:maison, en:house)",
  empty: {
    title: "Type a word to look up",
    description: "Prefix it with fr: or en: to switch language; the default is set in the extension settings",
    icon: Icons.book,
  },
  status: (items) => items.some((i) => i.section === "Recent") ? `${items.length} recent lookups` : lastStatus,
  search,
});
