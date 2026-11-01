import { action, type Context, copy, Icons, type Item, list, open, refresh } from "@backslash/api";
import { forget, kanjiList, recents, remember, searchWords } from "../api.ts";
import { EXAMPLES, glosses, jishoSearchPage, kanaItem, kanjiItem, kanjiOf, parseQuery, wordItem } from "../lib.ts";

let lastStatus = "";

async function startItems(): Promise<Item[]> {
  const recent = (await recents()).map((r): Item => ({
    id: `recent:${r.query}`,
    title: r.word === r.reading ? r.word : `${r.word}  ${r.reading}`,
    subtitle: r.gloss,
    icon: { source: Icons.history, tint: "gray" },
    section: "Recent",
    accessories: [{ text: r.query }],
    actions: [
      action("Look Up", () => wordsView(r.query), { icon: Icons.search }),
      copy(r.word, `Copy ${r.word}`),
      action("Remove from Recent", async () => {
        await forget(r.query);
        return refresh();
      }, { icon: Icons.trash, destructive: true, shortcut: "<Ctrl>x", section: "Recent" }),
      action("Clear Recent", async () => {
        await forget();
        return refresh();
      }, { icon: Icons.trash, destructive: true, confirm: "Clear all recent lookups?", section: "Recent" }),
    ],
  }));
  const examples = EXAMPLES.map((e): Item => ({
    id: `example:${e.query}`,
    title: e.query,
    subtitle: e.title,
    icon: { source: Icons.lightbulb, tint: "yellow" },
    section: "Try",
    actions: [action("Look Up", () => wordsView(e.query), { icon: Icons.search })],
  }));
  return [...recent, ...examples];
}

async function search(query: string, ctx: Context): Promise<Item[]> {
  const q = parseQuery(query);
  if (!q.keyword) {
    lastStatus = "English, romaji, kana or kanji";
    return startItems();
  }
  const [words, typedKanji] = await Promise.all([
    searchWords(q.keyword, ctx.signal),
    kanjiList(q.kanji, ctx.signal),
  ]);
  // Typed in English or romaji: also explain the kanji of the best match.
  const kanji = typedKanji.length || !words[0] ? typedKanji : await kanjiList(kanjiOf(words[0].word, 4), ctx.signal);

  const items: Item[] = [];
  if (q.kana) items.push(kanaItem(q.keyword, q.kana));
  items.push(...words.map((w) => wordItem(w)));
  items.push(...kanji.map(kanjiItem));
  if (!words.length && !kanji.length) {
    items.push({
      id: "none",
      title: `Nothing found for “${q.keyword}”`,
      subtitle: "Try another spelling, English, or kana",
      icon: { source: Icons.search, tint: "gray" },
      actions: [open(jishoSearchPage(q.keyword), "Search on Jisho")],
    });
  }
  lastStatus = `${words.length === 20 ? "20+" : words.length} words${kanji.length ? ` · ${kanji.length} kanji` : ""}`;

  const top = words[0];
  if (top) {
    setTimeout(() => {
      if (!ctx.signal.aborted) {
        remember({ query: q.keyword, word: top.word, reading: top.reading, gloss: glosses(top, 2) }).catch(() => {});
      }
    }, 1500);
  }
  return items;
}

/** The results for one query, opened from Recent or an example. */
function wordsView(query: string) {
  return list({
    title: query,
    placeholder: "Filter results…",
    items: (ctx) => search(query, ctx),
    status: () => lastStatus,
  });
}

export default list({
  placeholder: "Search in English, romaji, kana or kanji… (cat, neko, ねこ, 猫)",
  empty: { title: "Type a word", description: "English, romaji, kana or kanji", icon: Icons.book },
  status: () => lastStatus,
  search,
});
