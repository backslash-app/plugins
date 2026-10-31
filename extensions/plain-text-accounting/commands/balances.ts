import { action, type Context, copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { balances, commodityFor, guarded, type Journal, journal, transactions } from "../engine.ts";
import {
  type Balance,
  formatAmounts,
  isoDay,
  KIND_TITLES,
  kindOf,
  sortBalances,
  type Styles,
  sumAmounts,
  totalsByKind,
  type Txn,
} from "../lib.ts";
import { addForm, engineLine, txnItem } from "../views.ts";

let footer = "";

interface View {
  j: Journal;
  styles: Styles;
  accounts: string[];
  commodity: string;
}

/** The account's transactions of the last 90 days, newest first. */
function registerView(account: string, txns: Txn[], ctx: View) {
  const now = new Date();
  const mine = txns.filter((t) => t.postings.some((p) => p.account === account || p.account.startsWith(`${account}:`)))
    .reverse();
  return list({
    title: account,
    placeholder: `Transactions of ${account} in the last 90 days…`,
    empty: { title: "No transaction in the last 90 days", icon: Icons.history },
    items: mine.map((t) => txnItem(t, ctx.j, ctx.styles, { now, accounts: ctx.accounts, commodity: ctx.commodity })),
  });
}

export default (ctx: Context) =>
  list({
    placeholder: "Filter accounts…",
    filter: {
      options: [
        { value: "sheet", title: "Assets & Liabilities" },
        { value: "all", title: "All Accounts" },
        { value: "pnl", title: "Income & Expenses" },
      ],
    },
    empty: { title: "No account with a balance", description: "Add a transaction with Ctrl+N", icon: Icons.coin },
    status: () => footer,
    items: ({ filter, signal }) =>
      guarded(async (): Promise<Item[]> => {
        const j = await journal(ctx);
        const styles: Styles = new Map();
        const since = new Date();
        since.setDate(since.getDate() - 90);
        const [{ rows, tops }, recent] = await Promise.all([
          balances(j, styles, signal),
          transactions(j, styles, isoDay(since), signal),
        ]);
        const totals = (tops ?? []).length
          ? (tops as Balance[]).map((b) => ({ kind: kindOf(b.account), top: b.account, amounts: b.amounts }))
          : totalsByKind(rows);
        const accounts = rows.map((r) => r.account);
        const commodity = commodityFor(j, recent);
        const shown = sortBalances(rows).filter((b) => {
          const k = kindOf(b.account);
          if (filter === "pnl") return k === "income" || k === "expenses";
          if (filter === "all") return true;
          return k === "assets" || k === "liabilities" || k === "other";
        });
        const net = totals.filter((t) => t.kind === "assets" || t.kind === "liabilities");
        footer = [
          net.length ? `Net worth ${formatAmounts(sumAmounts(...net.map((t) => t.amounts)), styles)}` : "",
          engineLine(j),
        ].filter(Boolean).join(" · ");
        const view = { j, styles, accounts, commodity };
        return shown.map((b): Item => {
          const k = kindOf(b.account);
          const top = b.account.split(":")[0];
          const total = totals.find((t) => t.top === top);
          const negative = b.amounts.some((a) => a.quantity < 0);
          const text = formatAmounts(b.amounts, styles);
          return {
            id: b.account,
            title: b.account,
            icon: {
              source: k === "assets"
                ? Icons.coin
                : k === "liabilities"
                ? Icons.ticket
                : k === "income"
                ? Icons.chartUp
                : k === "expenses"
                ? Icons.chartDown
                : Icons.layers,
              tint: k === "assets"
                ? "green"
                : k === "liabilities"
                ? "orange"
                : k === "income"
                ? "teal"
                : k === "expenses"
                ? "red"
                : "gray",
            },
            section: `${KIND_TITLES[k] === "Other" ? top : KIND_TITLES[k]}${
              total ? ` · ${formatAmounts(total.amounts, styles)}` : ""
            }`,
            keywords: b.account.split(":"),
            accessories: [{ text, color: k === "assets" && negative ? "red" : undefined }],
            detail: {
              stats: b.amounts.slice(0, 3).map((a) => ({
                label: a.commodity || "balance",
                value: formatAmounts([a], styles),
                color: k === "assets" && a.quantity < 0 ? "red" as const : undefined,
              })),
              metadata: [
                meta.text("Account", b.account, { icon: Icons.layers }),
                meta.tags("Type", [KIND_TITLES[k]]),
                ...(total ? [meta.text(`${top} total`, formatAmounts(total.amounts, styles))] : []),
                meta.separator(),
                meta.text("Journal", engineLine(j), { icon: Icons.file }),
              ],
            },
            actions: [
              action("Show Transactions", () => registerView(b.account, recent, view), { icon: Icons.history }),
              copy(text, "Copy Balance", { shortcut: "<Ctrl><Shift>c" }),
              copy(b.account, "Copy Account Name", { section: "Copy" }),
              action("New Transaction", () =>
                addForm(j, styles, {
                  accounts,
                  commodity,
                  from: k === "assets" || k === "liabilities" ? b.account : undefined,
                  to: k === "expenses" || k === "income" ? b.account : undefined,
                }), {
                icon: Icons.plus,
                shortcut: "<Ctrl>n",
              }),
              open(j.file, "Open Journal", { icon: Icons.file, shortcut: "<Ctrl>o", section: "Journal" }),
            ],
          };
        });
      }),
  });
