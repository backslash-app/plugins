import { action, type Context, copy, Icons, type Item, list, meta, open, updateCommandMetadata } from "@backslash/api";
import { commodityFor, guarded, journal, transactions } from "../engine.ts";
import { expensesByCategory, formatAmount, formatAmounts, isoDay, monthStart, type Styles } from "../lib.ts";
import { addForm, engineLine, txnItem } from "../views.ts";

let footer = "";

const monthName = (iso: string) =>
  new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });

export default (ctx: Context) =>
  list({
    placeholder: "Filter categories…",
    filter: {
      options: [{ value: "this", title: "This Month" }, { value: "last", title: "Last Month" }],
    },
    empty: { title: "No expense this month yet", description: "Add one with Ctrl+N", icon: Icons.chartDown },
    status: () => footer,
    items: ({ filter, signal }) =>
      guarded(async (): Promise<Item[]> => {
        const now = new Date();
        const j = await journal(ctx);
        const styles: Styles = new Map();
        const offset = filter === "last" ? -1 : 0;
        const from = monthStart(now, offset), to = monthStart(now, offset + 1), before = monthStart(now, offset - 1);
        const txns = await transactions(j, styles, before, signal);
        const commodity = commodityFor(j, txns);
        const cats = expensesByCategory(txns, from, to, commodity, j.depth);
        // The previous month up to the same day, to compare like with like.
        const sameDay = isoDay(new Date(now.getFullYear(), now.getMonth() - 1, now.getDate() + 1));
        const prevEnd = offset === 0 && sameDay < from ? sameDay : from;
        const prev = expensesByCategory(txns, before, prevEnd, commodity, j.depth);
        const total = cats.reduce((s, c) => s + c.total, 0);
        const prevTotal = prev.reduce((s, c) => s + c.total, 0);
        const money = (q: number) => formatAmount({ commodity, quantity: q }, styles);
        const label = monthName(from);
        footer = `${label}: ${money(total)}${
          prevTotal ? ` · ${offset === 0 ? "same days last month" : "month before"} ${money(prevTotal)}` : ""
        } · ${engineLine(j)}`;
        if (offset === 0) updateCommandMetadata({ subtitle: `${money(total)} this month` }).catch(() => {});
        const accounts = [...new Set(txns.flatMap((t) => t.postings.map((p) => p.account)))];
        return cats.map((c): Item => {
          const before = prev.find((p) => p.account === c.account)?.total ?? 0;
          const change = before ? Math.round(((c.total - before) / Math.abs(before)) * 100) : undefined;
          const name = c.account.split(":").slice(1).join(":") || c.account;
          const share = total ? c.total / total : 0;
          const rows = c.txns.slice().reverse();
          return {
            id: c.account,
            title: name,
            subtitle: `${Math.round(share * 100)} %`,
            icon: { source: Icons.chartDown, tint: share > 0.25 ? "red" : share > 0.1 ? "orange" : "blue" },
            keywords: [c.account, ...c.children.map((x) => x.account)],
            accessories: [
              ...(change !== undefined && Math.abs(change) >= 5
                ? [{
                  tag: `${change > 0 ? "+" : ""}${change} %`,
                  color: change > 0 ? "red" as const : "green" as const,
                  tooltip: "Compared with the same days of the month before",
                }]
                : []),
              { text: money(c.total) },
            ],
            detail: {
              stats: [
                { label: label, value: money(c.total) },
                { label: offset === 0 ? "same days last month" : "month before", value: money(before) },
                { label: "transactions", value: c.txns.length },
              ],
              markdown: [
                ...(c.children.length > 1
                  ? ["**Breakdown**", ...c.children.map((x) => `- ${x.account}: ${money(x.total)}`), ""]
                  : []),
                "**Transactions**",
                ...rows.slice(0, 25).map((t) => {
                  const amount = t.postings.filter((p) =>
                    p.account === c.account || p.account.startsWith(`${c.account}:`)
                  )
                    .flatMap((p) => p.amounts);
                  return `- ${t.date.slice(5)} ${t.payee.replace(/[*_`[\]]/g, "\\$&")}: ${
                    formatAmounts(amount, styles)
                  }`;
                }),
                ...(rows.length > 25 ? [`- … ${rows.length - 25} more`] : []),
              ].join("\n"),
              metadata: [
                meta.progress("Share of spending", share),
                meta.text("Account", c.account, { icon: Icons.layers }),
                ...(c.amounts.filter((a) => a.commodity !== commodity).length
                  ? [
                    meta.text(
                      "Other commodities",
                      formatAmounts(c.amounts.filter((a) => a.commodity !== commodity), styles),
                    ),
                  ]
                  : []),
              ],
            },
            actions: [
              action("Show Transactions", () =>
                list({
                  title: `${name} · ${label}`,
                  items: rows.map((t) => txnItem(t, j, styles, { now, accounts, commodity })),
                }), { icon: Icons.history }),
              copy(`${name}: ${money(c.total)}`, "Copy Total", { shortcut: "<Ctrl><Shift>c" }),
              copy(
                cats.map((x) => `${x.account.split(":").slice(1).join(":") || x.account}: ${money(x.total)}`).join(
                  "\n",
                ) + `\nTotal: ${money(total)}`,
                "Copy Summary",
                { section: "Copy" },
              ),
              action("New Transaction", () => addForm(j, styles, { accounts, commodity, to: c.children[0]?.account }), {
                icon: Icons.plus,
                shortcut: "<Ctrl>n",
              }),
              open(j.file, "Open Journal", { icon: Icons.file, shortcut: "<Ctrl>o", section: "Journal" }),
            ],
          };
        });
      }),
  });
