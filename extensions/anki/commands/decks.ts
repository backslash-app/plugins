import {
  action,
  close,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  meta,
  refresh,
  updateCommandMetadata,
} from "@backslash/api";
import { type Deck, dueSubtitle, dueToday, plural } from "../lib.ts";
import { addCardForm, anki, ankiActions, loadDecks, OfflineError, offlineItems } from "../anki.ts";

let footer = "";

function deckItem(ctx: Context, d: Deck): Item {
  const due = d.reviewCount + d.learnCount;
  const todo = due + d.newCount;
  return {
    id: String(d.id),
    title: d.leaf,
    subtitle: d.parent || undefined,
    icon: { source: d.depth ? Icons.layers : Icons.book, tint: todo ? "blue" : "gray" },
    keywords: d.name.split("::"),
    accessories: [
      { text: String(d.newCount), color: d.newCount ? "blue" : "gray", tooltip: "New" },
      { text: String(d.learnCount), color: d.learnCount ? "red" : "gray", tooltip: "Learning" },
      { text: String(d.reviewCount), color: d.reviewCount ? "green" : "gray", tooltip: "To review" },
    ],
    detail: {
      stats: [
        { label: "New", value: d.newCount, color: "blue" },
        { label: "Learning", value: d.learnCount, color: "red" },
        { label: "To Review", value: d.reviewCount, color: "green" },
      ],
      metadata: [
        meta.text("Deck", d.name.replace(/::/g, " › "), { icon: Icons.book }),
        meta.text("Cards", d.total.toLocaleString("en"), { icon: Icons.layers }),
        meta.text("Today", todo ? `${plural(todo, "card")} to study` : "Nothing left: well done", {
          icon: todo ? Icons.clock : Icons.done,
          color: todo ? undefined : "green",
        }),
        meta.separator(),
        meta.text("Note", "Counts follow the deck's daily limits and include its subdecks"),
      ],
    },
    actions: [
      action("Study Now", async () => {
        await anki(ctx, "guiDeckReview", { name: d.name });
        return close(`Studying ${d.leaf}`);
      }, { icon: Icons.play }),
      action("Add Card to Deck", () => addCardForm(ctx, { deck: d.name }), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      action("Open Deck Overview", async () => {
        await anki(ctx, "guiDeckOverview", { name: d.name });
        return close();
      }, { icon: Icons.eye, shortcut: "<Ctrl>o" }),
      action("Browse Cards", async () => {
        await anki(ctx, "guiBrowse", { query: `"deck:${d.name.replace(/"/g, '\\"')}"` });
        return close();
      }, { icon: Icons.search, shortcut: "<Ctrl>b" }),
      copy(d.name, "Copy Deck Name", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Anki" }),
      ...ankiActions(ctx),
    ],
  };
}

export default list({
  placeholder: "Search decks…",
  empty: { title: "No deck", icon: Icons.book },
  status: () => footer,
  async items(ctx) {
    try {
      const decks = await loadDecks(ctx, ctx.signal);
      const subtitle = dueSubtitle(decks);
      updateCommandMetadata({ subtitle: subtitle ?? "Nothing due today" }).catch(() => {});
      const t = dueToday(decks);
      footer = `${plural(t.review + t.learn, "card")} due today · ${plural(t.new, "new card")} · ${
        plural(decks.length, "deck")
      }`;
      return decks.map((d) => deckItem(ctx, d));
    } catch (e) {
      if (!(e instanceof OfflineError)) throw e;
      footer = "AnkiConnect: 127.0.0.1:8765";
      updateCommandMetadata({ subtitle: null }).catch(() => {});
      return offlineItems(ctx);
    }
  },
});
