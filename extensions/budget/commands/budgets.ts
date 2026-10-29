import { Icons, list } from "@backslash/api";
import { type Backend, backends, each, month, SetupError, setupItem } from "../api.ts";
import { money, monthRange, sortBudgets } from "../lib.ts";
import { budgetItem, reloadAction, report, summaryItem } from "../views.ts";

let status = "";

export default list({
  placeholder: "Filter budgets…",
  filter: { options: [{ value: "0", title: "This Month" }, { value: "-1", title: "Last Month" }], default: "0" },
  status: () => status,
  empty: {
    title: "No budget",
    description: "Create budgets in Firefly III, or budget categories in Actual",
    icon: Icons.chartDown,
  },
  async items({ preferences, filter, signal }) {
    let list: Backend[];
    try {
      list = backends(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    const offset = Number(filter ?? 0) || 0;
    const range = monthRange(new Date(), offset);
    const r = await each(list, (b) => month(b, offset, signal));
    const setup = await report(r);
    if (setup) return setup;
    const many = r.ok.length > 1;
    const lines = r.ok.flatMap((x) => x.value.lines);
    const over = lines.filter((l) => l.budgeted > 0 && l.spent > l.budgeted).length;
    const spent = r.ok.flatMap((x) => x.value.summaries).map((s) => `${money(s.spent, s.currency)} spent`);
    status = [range.title, ...spent, ...(over ? [`${over} over budget`] : [])].join(" · ");
    return r.ok.flatMap((x) => [
      ...x.value.summaries.map((s) => ({ ...summaryItem(s, range.title, many), actions: [reloadAction()] })),
      ...sortBudgets(x.value.lines).map((l) => {
        const item = budgetItem(x.backend, l, offset === 0, many);
        return { ...item, actions: [...(item.actions ?? []), reloadAction()] };
      }),
    ]);
  },
});
