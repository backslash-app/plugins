import { list, updateCommandMetadata } from "@backslash/api";
import { CARD_FIELDS, guarded, MEMBER_FIELDS, trello } from "../api.ts";
import { type Board, type Card, cardSection, dueOf, sortByDue } from "../lib.ts";
import { live } from "../live.ts";
import { cardItem } from "../views.ts";

let summary = "";

export default list({
  placeholder: "Filter your cards by title, label, board, list…",
  filter: {
    options: [
      { value: "all", title: "All My Cards" },
      { value: "due", title: "Due This Week" },
    ],
  },
  empty: { title: "No card here", description: "Cards you are a member of show up here.", icon: "bs-square-check" },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
  items: ({ preferences, signal, filter }) =>
    live(() =>
      guarded(preferences, async (a) => {
        const [cards, boards] = await Promise.all([
          trello<Card[]>(a, "/members/me/cards", {
            params: { filter: "visible", fields: CARD_FIELDS, members: true, member_fields: MEMBER_FIELDS },
            signal,
          }),
          trello<Board[]>(a, "/members/me/boards", {
            params: { filter: "all", fields: "name", lists: "all", list_fields: "name" },
            signal,
          }),
        ]);
        const boardName = new Map(boards.map((b) => [b.id, b.name]));
        const listName = new Map(boards.flatMap((b) => (b.lists ?? []).map((l) => [l.id, l.name] as const)));
        const now = new Date();
        const sections = new Map(cards.map((c) => [c.id, cardSection(c, now)]));
        const overdue = cards.filter((c) => sections.get(c.id) === "Overdue").length;
        const today = cards.filter((c) => sections.get(c.id) === "Today").length;
        summary = [
          `${cards.length} card${cards.length === 1 ? "" : "s"}`,
          overdue ? `${overdue} overdue` : "",
          today ? `${today} due today` : "",
        ].filter(Boolean).join(" · ");
        updateCommandMetadata({
          subtitle: [overdue ? `${overdue} overdue` : "", today ? `${today} due today` : ""].filter(Boolean)
            .join(" · ") || null,
        }).catch(() => {});
        const week = now.getTime() + 7 * 86_400_000;
        const shown = filter === "due"
          ? cards.filter((c) => !c.dueComplete && c.due && dueOf(c)!.getTime() < week)
          : cards;
        return sortByDue(shown).map((c) =>
          cardItem(a, c, {
            board: boardName.get(c.idBoard),
            list: listName.get(c.idList),
            section: sections.get(c.id),
          }, now)
        );
      }), signal),
});
