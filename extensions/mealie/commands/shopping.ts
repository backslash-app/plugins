import { type Action, action, copy, Icons, type Item, list, open, refresh, submenu, toast } from "@backslash/api";
import {
  addShoppingItem,
  deleteShoppingItem,
  grocy,
  grocyAddMissing,
  grocyAddNote,
  grocyDeleteItem,
  grocySetDone,
  grocyShoppingList,
  hasGrocy,
  hasMealie,
  mealie,
  type Server,
  setChecked,
  SetupError,
  setupItem,
  shoppingItems,
  shoppingLists,
} from "../api.ts";
import {
  type GrocyShoppingItem,
  parseItem,
  pickList,
  plural,
  type ShoppingItem,
  type ShoppingList,
  shoppingText,
  sortShopping,
} from "../lib.ts";

interface Loaded {
  mealie?: { s: Server; lists: { list: ShoppingList; items: ShoppingItem[] }[] };
  grocy?: { s: Server; items: GrocyShoppingItem[] };
  setup: SetupError[];
  errors: string[];
}

// Loaded once, then filtered as the user types (for a minute); actions reload it.
let loading: { at: number; data: Promise<Loaded> } | undefined;
let footer = "";

async function load(prefs: Record<string, unknown>, signal: AbortSignal): Promise<Loaded> {
  const out: Loaded = { setup: [], errors: [] };
  const tasks: Promise<void>[] = [];
  const fail = (e: unknown) => {
    if (e instanceof SetupError) out.setup.push(e);
    else out.errors.push((e as Error).message);
  };
  if (hasMealie(prefs)) {
    tasks.push(
      (async () => {
        const s = mealie(prefs);
        const lists = await shoppingLists(s, signal);
        const items = await Promise.all(lists.map((l) => shoppingItems(s, l, signal)));
        out.mealie = { s, lists: lists.map((list, i) => ({ list, items: items[i] })) };
      })().catch(fail),
    );
  }
  if (hasGrocy(prefs)) {
    tasks.push(
      (async () => {
        const s = grocy(prefs);
        out.grocy = { s, items: await grocyShoppingList(s, signal) };
      })().catch(fail),
    );
  }
  await Promise.all(tasks);
  if (!hasMealie(prefs) && !hasGrocy(prefs)) out.setup.push(new SetupError("Connect Mealie or Grocy", "Mealie"));
  return out;
}

const reload = () => {
  loading = undefined;
  return refresh();
};

function mealieItem(s: Server, list: ShoppingList, item: ShoppingItem, many: boolean): Item {
  const text = shoppingText(item);
  return {
    id: `mealie:${item.id}`,
    title: text,
    subtitle: item.label?.name ?? undefined,
    icon: item.checked ? { source: Icons.squareCheck, tint: "green" } : { source: Icons.square, tint: "gray" },
    section: item.checked ? `Checked${many ? ` · ${list.name}` : ""}` : many ? list.name : "To Buy",
    accessories: many ? [{ tag: list.name, color: "orange" }] : [],
    actions: [
      action(item.checked ? "Uncheck" : "Check Off", async () => {
        await setChecked(s, item, !item.checked);
        return reload();
      }, { icon: item.checked ? Icons.square : Icons.squareCheck }),
      copy(text, "Copy Item", { shortcut: "<Ctrl><Shift>c" }),
      open(`${s.base}/shopping-lists/${list.id}`, "Open List in Mealie", { shortcut: "<Ctrl>o" }),
      action("Delete Item", async () => {
        await deleteShoppingItem(s, item);
        await toast(`${text} deleted`);
        return reload();
      }, { icon: Icons.trash, destructive: true, confirm: `Delete “${text}” from ${list.name}?`, section: "Item" }),
    ],
  };
}

function grocyItem(s: Server, item: GrocyShoppingItem): Item {
  const title = item.amount !== 1 ? `${item.amount} × ${item.text}` : item.text;
  return {
    id: `grocy:${item.id}`,
    title,
    icon: item.checked ? { source: Icons.squareCheck, tint: "green" } : { source: Icons.square, tint: "gray" },
    section: item.checked ? "Checked · Grocy" : "Grocy",
    accessories: [{ tag: "Grocy", color: "teal" }],
    actions: [
      action(item.checked ? "Uncheck" : "Check Off", async () => {
        await grocySetDone(s, item, !item.checked);
        return reload();
      }, { icon: item.checked ? Icons.square : Icons.squareCheck }),
      copy(item.text, "Copy Item", { shortcut: "<Ctrl><Shift>c" }),
      open(`${s.base}/shoppinglist`, "Open in Grocy", { shortcut: "<Ctrl>o" }),
      action("Delete Item", async () => {
        await grocyDeleteItem(s, item);
        await toast(`${item.text} deleted`);
        return reload();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete “${item.text}” from Grocy's list?`,
        section: "Item",
      }),
    ],
  };
}

function addItems(d: Loaded, text: string, preferred: unknown): Item[] {
  const { quantity, note } = parseItem(text);
  const label = quantity !== 1 ? `${quantity} × ${note}` : note;
  const targets: { title: string; run: () => Promise<void> }[] = [];
  if (d.mealie) {
    const lists = d.mealie.lists.map((l) => l.list);
    const first = pickList(lists, preferred);
    for (const l of [first, ...lists.filter((x) => x !== first)]) {
      if (l) targets.push({ title: l.name, run: () => addShoppingItem(d.mealie!.s, l, note, quantity) });
    }
  }
  if (d.grocy) targets.push({ title: "Grocy", run: () => grocyAddNote(d.grocy!.s, note, quantity) });
  const act = (t: (typeof targets)[number]): Action =>
    action(`Add to ${t.title}`, async () => {
      await t.run();
      await toast(`${label} added to ${t.title}`, { style: "success" });
      return reload();
    }, { icon: Icons.plus });
  return targets.slice(0, 1).map((t) => ({
    id: "add",
    title: `Add “${label}”`,
    subtitle: `to ${t.title}`,
    icon: { source: Icons.plus, tint: "green" },
    section: "Add",
    actions: [
      act(t),
      ...(targets.length > 1
        ? [submenu("Add to Another List", targets.slice(1).map(act), { icon: Icons.layers })]
        : []),
    ],
  }));
}

export default list({
  placeholder: "Type to filter, or to add an item (“2 lemons”)…",
  status: () => footer,
  empty: { title: "The shopping list is empty", description: "Type something to add it", icon: Icons.squareCheck },
  async search(query, { preferences, signal }) {
    if (!loading || Date.now() - loading.at > 60_000) {
      loading = {
        at: Date.now(),
        data: load(preferences, signal).catch((e) => {
          loading = undefined;
          throw e;
        }),
      };
    }
    const d = await loading.data;
    if (!d.mealie && !d.grocy) {
      if (d.setup.length) return d.setup.map(setupItem);
      throw new Error(d.errors.join(" · "));
    }
    if (d.errors.length) await toast("Some lists couldn't load", { style: "failure", message: d.errors.join(" · ") });
    const q = query.trim().toLowerCase();
    const many = (d.mealie?.lists.length ?? 0) > 1;
    const rows: Item[] = [
      ...(d.mealie?.lists ?? []).flatMap(({ list, items }) =>
        sortShopping(items).map((i) => mealieItem(d.mealie!.s, list, i, many))
      ),
      ...sortShopping(d.grocy?.items ?? []).map((i) => grocyItem(d.grocy!.s, i)),
    ];
    const toBuy = rows.filter((r) => !r.section?.startsWith("Checked")).length;
    footer = `${plural(toBuy, "item")} to buy`;
    const shown = q ? rows.filter((r) => r.title.toLowerCase().includes(q)) : rows;
    const extra: Action[] = [
      ...(d.grocy
        ? [action("Add Missing Products (Grocy)", async () => {
          await grocyAddMissing(d.grocy!.s);
          await toast("Products below their minimum stock added", { style: "success" });
          return reload();
        }, { icon: Icons.box, section: "Lists" })]
        : []),
      action("Reload", () => reload(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Lists" }),
    ];
    const exact = rows.some((r) => r.title.toLowerCase() === q);
    return [...(q && !exact ? addItems(d, query, preferences.shoppingList) : []), ...shown].map((i) => ({
      ...i,
      actions: [...(i.actions ?? []), ...extra],
    }));
  },
});
