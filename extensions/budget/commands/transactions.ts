import { Icons, list } from "@backslash/api";
import { type Backend, backends, each, SetupError, setupItem, transactions } from "../api.ts";
import { money } from "../lib.ts";
import { reloadAction, report, sortTransactions, transactionItem } from "../views.ts";

let status = "";

const FILTERS = [
  { value: "all", title: "All" },
  { value: "withdrawal", title: "Expenses" },
  { value: "deposit", title: "Income" },
  { value: "transfer", title: "Transfers" },
];

export default list({
  placeholder: "Filter by description, category, account…",
  filter: { options: FILTERS, default: "all" },
  status: () => status,
  empty: { title: "No transaction", description: "Nothing in the last 30 days", icon: Icons.history },
  async items({ preferences, filter, signal }) {
    let list: Backend[];
    try {
      list = backends(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    const r = await each(list, (b) => transactions(b, { days: 30, signal }));
    const setup = await report(r);
    if (setup) return setup;
    const many = r.ok.length > 1;
    const f = filter ?? "all";
    const rows = r.ok.flatMap((x) =>
      x.value.filter((t) => f === "all" || t.kind === f).map((t) => ({ backend: x.backend, t }))
    );
    const out = new Map<string, number>();
    for (const { t } of rows) if (t.kind === "withdrawal") out.set(t.currency, (out.get(t.currency) ?? 0) - t.amount);
    status = [
      `${rows.length} transaction${rows.length === 1 ? "" : "s"} in 30 days`,
      ...[...out].map(([c, v]) => `${money(v, c)} spent`),
    ].join(" · ");
    const order = new Map(sortTransactions(rows.map((x) => x.t)).map((t, i) => [t, i]));
    return rows.sort((a, b) => order.get(a.t)! - order.get(b.t)!).map(({ backend, t }) => {
      const item = transactionItem(backend, t, many);
      return { ...item, actions: [...(item.actions ?? []), reloadAction()] };
    });
  },
});
