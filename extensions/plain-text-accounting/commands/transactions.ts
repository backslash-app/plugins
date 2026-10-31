import { action, type Context, Icons, type Item, list } from "@backslash/api";
import { commodityFor, guarded, journal, transactions } from "../engine.ts";
import { isoDay, type Styles } from "../lib.ts";
import { addForm, engineLine, txnItem } from "../views.ts";

let footer = "";

export default (ctx: Context) =>
  list({
    placeholder: "Filter by payee, note or account…",
    filter: {
      options: [{ value: "30", title: "Last 30 Days" }, { value: "90", title: "Last 90 Days" }, {
        value: "365",
        title: "This Year",
      }],
    },
    empty: { title: "No transaction in this period", description: "Add one with Ctrl+N", icon: Icons.history },
    status: () => footer,
    items: ({ filter, signal }) =>
      guarded(async (): Promise<Item[]> => {
        const now = new Date();
        const j = await journal(ctx);
        const styles: Styles = new Map();
        const from = filter === "365"
          ? `${now.getFullYear()}-01-01`
          : isoDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - Number(filter === "90" ? 90 : 30)));
        const txns = await transactions(j, styles, from, signal);
        const commodity = commodityFor(j, txns);
        const accounts = [...new Set(txns.flatMap((t) => t.postings.map((p) => p.account)))];
        const shown = txns.slice(-500).reverse(); // newest first
        footer = `${txns.length} transaction${txns.length === 1 ? "" : "s"} · ${engineLine(j)}`;
        const add = action("New Transaction", () => addForm(j, styles, { accounts, commodity }), {
          icon: Icons.plus,
          shortcut: "<Ctrl>n",
        });
        return shown.map((t) => {
          const item = txnItem(t, j, styles, { now, accounts, commodity });
          return { ...item, actions: [...(item.actions ?? []), add] };
        });
      }),
  });
