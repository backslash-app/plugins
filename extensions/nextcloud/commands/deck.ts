import {
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { json, type Server, server, SetupError, setupItem, userId } from "../api.ts";
import {
  type CardView,
  type DeckBoard,
  deckCards,
  type DeckStack,
  deckWebUrl,
  dueBucket,
  dueText,
  nearestColor,
  plural,
  sortCards,
} from "../lib.ts";

const API = "/index.php/apps/deck/api/v1.0";
const MISSING = "The Deck app isn't installed on this Nextcloud";

async function moveCard(s: Server, c: CardView, to: DeckStack) {
  await json(s, `${API}/boards/${c.board.id}/stacks/${c.stack.id}/cards/${c.card.id}/reorder`, {
    method: "PUT",
    body: { order: 0, stackId: to.id },
    missing: MISSING,
  });
  await toast(`Moved to ${to.title}`, { style: "success" });
  return refresh();
}

function cardItem(s: Server, c: CardView, now: number): Item {
  const bucket = dueBucket(c, now);
  const overdue = bucket === "Overdue";
  const metadata: Metadata[] = [
    meta.text("Board", c.board.title, { icon: Icons.kanban }),
    meta.text("List", c.stack.title, { icon: Icons.layers }),
  ];
  if (c.due !== undefined) {
    metadata.push(meta.text(
      "Due",
      `${
        new Date(c.due).toLocaleString("en-GB", {
          weekday: "short",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })
      } (${dueText(c.due, now)})`,
      { icon: Icons.calendar, color: overdue ? "red" : undefined },
    ));
  }
  if (c.card.done) {
    metadata.push(meta.text("Done", new Date(c.card.done).toLocaleDateString("en-GB"), { icon: Icons.done }));
  }
  if (c.card.labels?.length) {
    metadata.push(meta.tags("Labels", c.card.labels.map((l) => ({ text: l.title, color: nearestColor(l.color) }))));
  }
  if (c.assignees.length) metadata.push(meta.tags("Assigned", c.assignees));
  if (c.card.commentsCount) metadata.push(meta.text("Comments", c.card.commentsCount, { icon: Icons.comment }));
  if (c.card.attachmentCount) metadata.push(meta.text("Attachments", c.card.attachmentCount, { icon: Icons.file }));

  const others = c.stacks.filter((st) => st.id !== c.stack.id);
  const actions: Action[] = [
    open(deckWebUrl(s.base, c.board.id, c.card.id), "Open in Deck", { icon: Icons.external }),
    submenu(
      "Move to List",
      others.map((st) => action(st.title, () => moveCard(s, c, st), { icon: Icons.arrowRight })),
      { icon: Icons.arrowRight, shortcut: "<Ctrl>m" },
    ),
  ];
  // The list to its right on the board: "To do" → "Doing" → "Done".
  const next = c.stacks[c.stacks.findIndex((st) => st.id === c.stack.id) + 1];
  if (next) {
    actions.push(action(`Move to ${next.title}`, () => moveCard(s, c, next), {
      icon: Icons.chevronRight,
      shortcut: "<Ctrl>Right",
    }));
  }
  actions.push(
    open(deckWebUrl(s.base, c.board.id), "Open Board", { icon: Icons.kanban, section: "Board" }),
    copy(deckWebUrl(s.base, c.board.id, c.card.id), "Copy Card Link", { section: "Copy" }),
    copy(c.card.title, "Copy Title", { section: "Copy" }),
  );

  const accessories: Item["accessories"] = [];
  for (const l of (c.card.labels ?? []).slice(0, 2)) accessories.push({ tag: l.title, color: nearestColor(l.color) });
  if (c.card.commentsCount) accessories.push({ text: String(c.card.commentsCount), icon: Icons.comment });
  if (c.due !== undefined && !c.card.done) {
    accessories.push({
      text: dueText(c.due, now),
      icon: Icons.clock,
      color: overdue ? "red" : bucket === "Today" ? "orange" : undefined,
    });
  }
  for (const a of c.assignees.slice(0, 2)) accessories.push({ avatar: a, tooltip: a });

  return {
    id: `${c.board.id}:${c.card.id}`,
    title: c.card.title,
    subtitle: `${c.board.title} › ${c.stack.title}`,
    icon: {
      source: c.card.done ? Icons.done : overdue ? Icons.alert : Icons.todo,
      tint: c.card.done ? "green" : overdue ? "red" : nearestColor(c.board.color),
    },
    section: bucket,
    keywords: [c.board.title, c.stack.title, ...(c.card.labels ?? []).map((l) => l.title), ...c.assignees],
    accessories,
    detail: { markdown: c.card.description?.trim() || undefined, metadata },
    actions,
  };
}

let footer = "";

export default list({
  placeholder: "Filter cards by title, board, list, label…",
  filter: {
    options: [
      { value: "mine", title: "Assigned to Me" },
      { value: "due", title: "With Due Date" },
      { value: "all", title: "All Cards" },
    ],
    default: "mine",
  },
  empty: {
    title: "No cards here",
    description: "Cards assigned to you, or with a due date, show here; Tab shows the others",
    icon: Icons.kanban,
  },
  status: () => footer,
  async *items({ preferences, signal, filter }) {
    let s: Server;
    let me: string;
    let boards: DeckBoard[];
    try {
      s = server(preferences);
      [me, boards] = await Promise.all([
        userId(s, signal),
        json<DeckBoard[]>(s, `${API}/boards`, { signal, missing: MISSING }),
      ]);
    } catch (e) {
      if (e instanceof SetupError) {
        yield [setupItem(e)];
        return;
      }
      throw e;
    }
    const live = boards.filter((b) => !b.archived && !b.deletedAt);
    const perBoard = await Promise.all(live.map(async (b) => {
      try {
        return deckCards(b, await json<DeckStack[]>(s, `${API}/boards/${b.id}/stacks`, { signal }), me);
      } catch {
        return [];
      }
    }));
    if (signal.aborted) return;
    const now = Date.now();
    const cards = perBoard.flat();
    const shown = cards.filter((c) =>
      filter === "all" ? true : filter === "due" ? c.due !== undefined && !c.card.done : c.mine && !c.card.done
    );
    const mine = cards.filter((c) => c.mine && !c.card.done);
    const overdue = mine.filter((c) => dueBucket(c, now) === "Overdue").length;
    updateCommandMetadata({
      subtitle: mine.length
        ? [plural(mine.length, "card"), overdue ? `${overdue} overdue` : ""].filter(Boolean).join(" · ")
        : null,
    }).catch(() => {});
    footer = `${plural(shown.length, "card")} · ${plural(live.length, "board")}`;
    yield sortCards(shown, now).map((c) => cardItem(s, c, now));
  },
});
