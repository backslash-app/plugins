// Items, actions and forms shared by the commands.

import {
  type Action,
  action,
  copy,
  detail,
  field,
  form,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  pop,
  storage,
  submenu,
  toast,
} from "@backslash/api";
import { CARD_FIELDS, guarded, MEMBER_FIELDS, trello } from "./api.ts";
import {
  type Account,
  avatarOf,
  type Board,
  boardColor,
  boardImage,
  type Card,
  cardIcon,
  cardMetadata,
  checklist,
  dueColor,
  dueOf,
  excerpt,
  labelColor,
  labelText,
  type List,
  type Member,
  parseWhen,
  shortDue,
  sortByList,
} from "./lib.ts";
import { live, notifyChanged } from "./live.ts";

async function updateCard(a: Account, card: Card, params: Record<string, string | boolean>, message: string) {
  await trello(a, `/cards/${card.id}`, { method: "PUT", params });
  notifyChanged();
  await toast(message, { style: "success" });
}

export function cardActions(a: Account, card: Card, where: { list?: string }): Action[] {
  const moveTo = submenu("Move to List", async () => {
    const lists = await trello<List[]>(a, `/boards/${card.idBoard}/lists`, {
      params: { filter: "open", fields: "name,pos" },
    });
    return lists.filter((l) => l.id !== card.idList).map((l) =>
      action(l.name, () => updateCard(a, card, { idList: l.id, pos: "top" }, `Moved to ${l.name}`), {
        icon: Icons.arrowRight,
      })
    );
  }, { icon: Icons.layers, shortcut: "<Ctrl>m", section: "Card" });
  const due = dueOf(card);
  return [
    open(card.url, "Open in Trello"),
    moveTo,
    ...(due
      ? [action(
        card.dueComplete ? "Mark Due Incomplete" : "Mark Due Complete",
        () =>
          updateCard(
            a,
            card,
            { dueComplete: !card.dueComplete },
            card.dueComplete ? "Due marked incomplete" : "Due complete",
          ),
        { icon: card.dueComplete ? Icons.square : Icons.squareCheck, shortcut: "<Ctrl>d", section: "Card" },
      )]
      : []),
    action("New Card in This List…", () => cardForm(a, { idList: card.idList, listName: where.list }), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Card",
    }),
    copy(card.shortUrl ?? card.url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`[${card.name}](${card.shortUrl ?? card.url})`, "Copy as Markdown Link", { section: "Copy" }),
    copy(card.name, "Copy Title", { shortcut: "<Ctrl>period", section: "Copy" }),
    action("Archive Card", () => updateCard(a, card, { closed: true }, "Card archived"), {
      icon: Icons.archive,
      destructive: true,
      confirm: `Archive “${card.name}”?`,
      shortcut: "<Ctrl><Shift>Delete",
      section: "Danger",
    }),
  ];
}

export function cardItem(
  a: Account,
  card: Card,
  where: { board?: string; list?: string; section?: string },
  now = new Date(),
  options: { avatars?: boolean } = {},
): Item {
  const due = dueOf(card);
  const list = checklist(card);
  const members = card.members ?? [];
  return {
    id: card.id,
    title: card.name,
    // In a board, sections are its lists; elsewhere, where the card is.
    subtitle: where.section === where.list ? undefined : [where.board, where.list].filter(Boolean).join(" › "),
    icon: cardIcon(card),
    section: where.section,
    keywords: [
      ...card.labels.map(labelText),
      ...members.map((m) => m.fullName),
      where.board ?? "",
      where.list ?? "",
    ].filter(Boolean),
    accessories: [
      ...card.labels.slice(0, 2).map((l) => ({ tag: labelText(l), color: labelColor(l.color) })),
      ...(list.total
        ? [{
          icon: Icons.squareCheck,
          text: `${list.done}/${list.total}`,
          color: list.done === list.total ? "green" as const : undefined,
          tooltip: "Checklist",
        }]
        : []),
      ...(card.badges?.comments
        ? [{ icon: Icons.comment, text: String(card.badges.comments), tooltip: "Comments" }]
        : []),
      ...(due ? [{ icon: Icons.clock, text: shortDue(due, now), color: dueColor(card, now), tooltip: "Due" }] : []),
      ...(options.avatars === false ? [] : members).slice(0, 2).map((m: Member) => ({
        avatar: avatarOf(m),
        tooltip: m.fullName,
      })),
    ],
    detail: {
      markdown: excerpt(card.desc),
      metadata: cardMetadata(card, where, now),
    },
    actions: cardActions(a, card, where),
  };
}

/** The cards of a board, by list, live after a move or an archive. */
export function boardCards(a: Account, board: Board, prefs: Record<string, unknown>): ListSpec {
  let me = "";
  let total = 0;
  return list({
    title: board.name,
    placeholder: `Filter cards of ${board.name}…`,
    filter: { options: [{ value: "all", title: "All Cards" }, { value: "mine", title: "My Cards" }] },
    empty: { title: "No card here", icon: Icons.kanban },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : `${items.length} of ${total} cards`,
    actions: [
      action("New Card…", () => cardForm(a, { idBoard: board.id }), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      open(board.url, "Open Board in Trello"),
    ],
    items: ({ signal, filter }) =>
      live(() =>
        guarded(prefs, async () => {
          const [lists, cards, self] = await Promise.all([
            trello<List[]>(a, `/boards/${board.id}/lists`, { params: { filter: "open", fields: "name,pos" }, signal }),
            trello<Card[]>(a, `/boards/${board.id}/cards/open`, {
              params: { fields: CARD_FIELDS, members: true, member_fields: MEMBER_FIELDS },
              signal,
            }),
            me
              ? Promise.resolve({ id: me })
              : trello<{ id: string }>(a, "/members/me", { params: { fields: "id" }, signal }),
          ]);
          me = self.id;
          total = cards.length;
          const names = new Map(lists.map((l) => [l.id, l.name]));
          const shown = filter === "mine" ? cards.filter((c) => c.idMembers.includes(me)) : cards;
          return sortByList(shown, lists).map((c) => {
            const name = names.get(c.idList) ?? "Other";
            return cardItem(a, c, { board: board.name, list: name, section: name });
          });
        }), signal),
  });
}

export function boardItem(a: Account, board: Board, prefs: Record<string, unknown>, workspace?: string): Item {
  const image = boardImage(board);
  return {
    id: board.id,
    title: board.name,
    subtitle: board.starred ? workspace : board.desc?.split("\n")[0] || undefined,
    icon: { source: Icons.kanban, tint: boardColor(board) },
    section: board.starred ? "Starred" : workspace ?? "Boards",
    keywords: [workspace ?? ""].filter(Boolean),
    accessories: [
      ...(board.starred ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Starred" }] : []),
      ...(board.dateLastActivity
        ? [{ text: shortDue(new Date(board.dateLastActivity), new Date(), false), tooltip: "Last activity" }]
        : []),
    ],
    detail: {
      image,
      markdown: excerpt(board.desc),
      metadata: [
        ...(workspace ? [meta.text("Workspace", workspace, { icon: Icons.home })] : []),
        ...(board.lists ? [meta.text("Lists", board.lists.length, { icon: Icons.layers })] : []),
        ...(board.dateLastActivity
          ? [meta.text("Last activity", shortDue(new Date(board.dateLastActivity), new Date(), false))]
          : []),
        meta.separator(),
        meta.link("Link", (board.shortUrl ?? board.url).replace(/^https:\/\//, ""), board.url),
      ],
    },
    actions: [
      action("Show Cards", () => boardCards(a, board, prefs), { icon: Icons.layers }),
      open(board.url, "Open in Trello"),
      action("New Card…", () => cardForm(a, { idBoard: board.id }), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      copy(board.shortUrl ?? board.url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ],
  };
}

/** Every open list of every open board, as "Board › List". */
export async function allLists(a: Account): Promise<{ value: string; title: string; board: string }[]> {
  const boards = await trello<Board[]>(a, "/members/me/boards", {
    params: { filter: "open", fields: "name,starred", lists: "open", list_fields: "name,pos" },
  });
  const sorted = [...boards].sort((x, y) => Number(!!y.starred) - Number(!!x.starred) || x.name.localeCompare(y.name));
  return sorted.flatMap((b) =>
    [...(b.lists ?? [])].sort((x, y) => x.pos - y.pos).map((l) => ({
      value: l.id,
      title: `${b.name} › ${l.name}`,
      board: b.id,
    }))
  );
}

/** A new card; `standalone` when the form is the command itself (no list to go back to). */
export async function cardForm(
  a: Account,
  where: { idList?: string; idBoard?: string; listName?: string } = {},
  options: { standalone?: boolean; title?: string } = {},
) {
  const lists = await allLists(a);
  if (!lists.length) throw new Error("No open Trello board with a list: create one in Trello first");
  const last = await storage.get<string>("lastList").catch(() => undefined);
  const initial = lists.find((l) => l.value === where.idList) ?? lists.find((l) => l.board === where.idBoard) ??
    lists.find((l) => l.value === last) ?? lists[0];
  return form({
    title: "New Trello card",
    submitTitle: "Create Card",
    fields: [
      field.dropdown("list", "List", lists.map(({ value, title }) => ({ value, title })), { value: initial.value }),
      field.text("name", "Title", { required: true, placeholder: "What needs doing?", value: options.title ?? "" }),
      field.textArea("desc", "Description", { placeholder: "Markdown" }),
      field.text("due", "Due", { placeholder: "tomorrow 5pm, friday, +3d, 2026-11-03…" }),
      field.checkbox("top", "Put it at the top of the list", { value: true }),
      field.checkbox("me", "Add me to the card", { value: true }),
    ],
    async submit(values) {
      const when = parseWhen(String(values.due ?? ""));
      const due = when ? (when.time ? when.date : new Date(when.date.setHours(12, 0, 0, 0))) : undefined;
      const me = values.me ? (await trello<{ id: string }>(a, "/members/me", { params: { fields: "id" } })).id : "";
      const card = await trello<Card>(a, "/cards", {
        method: "POST",
        params: {
          idList: String(values.list),
          name: String(values.name).trim(),
          desc: String(values.desc ?? "").trim() || undefined,
          due: due?.toISOString(),
          pos: values.top ? "top" : "bottom",
          idMembers: me || undefined,
        },
      });
      await storage.set("lastList", String(values.list)).catch(() => {});
      notifyChanged();
      const where = lists.find((l) => l.value === values.list)?.title ?? "";
      await toast(`Card created in ${where}`, { style: "success" });
      if (!options.standalone) return pop();
      return detail({
        title: card.name,
        markdown: `# ${card.name}\n\nCreated in **${where}**.`,
        metadata: [
          meta.text("List", where, { icon: Icons.layers }),
          ...(due ? [meta.text("Due", shortDue(due), { icon: Icons.calendar })] : []),
          meta.link("Link", card.shortUrl ?? card.url, card.shortUrl ?? card.url),
        ],
        status: "Card created",
        actions: [
          open(card.url, "Open in Trello"),
          copy(card.shortUrl ?? card.url, "Copy Link", { shortcut: "<Ctrl><Shift>c" }),
        ],
      });
    },
  });
}
