import { Icons, type Item, list, meta } from "@backslash/api";
import { accounts, type Backend, backends, each, SetupError, setupItem } from "../api.ts";
import { money, PROVIDER_NAMES, totals } from "../lib.ts";
import { accountItem, reloadAction, report } from "../views.ts";

let status = "";

export default list({
  placeholder: "Filter accounts…",
  status: () => status,
  empty: {
    title: "No account",
    description: "Create an asset account in Firefly III or Actual first",
    icon: Icons.coin,
  },
  async items({ preferences, signal }) {
    let list: Backend[];
    try {
      list = backends(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    const r = await each(list, (b) => accounts(b, signal));
    const setup = await report(r);
    if (setup) return setup;
    const many = r.ok.length > 1;
    const all = r.ok.flatMap((x) => x.value);
    const worth = totals(all);
    status = [
      `${all.length} account${all.length === 1 ? "" : "s"}`,
      ...worth.map((w) => `net worth ${money(w.total, w.currency)}`),
    ].join(" · ");
    const net: Item[] = worth.length
      ? [{
        id: "net-worth",
        title: "Net worth",
        subtitle: r.ok.map((x) => PROVIDER_NAMES[x.backend.provider]).join(" + "),
        icon: { source: Icons.chartUp, tint: worth.every((w) => w.total >= 0) ? "green" : "red" },
        section: "Total",
        accessories: worth.map((w) => ({
          tag: money(w.total, w.currency),
          color: w.total >= 0 ? "green" as const : "red" as const,
        })),
        detail: {
          stats: worth.map((w) => ({ label: w.currency, value: money(w.total, w.currency) })),
          metadata: r.ok.flatMap((x) =>
            totals(x.value).map((w) => meta.text(PROVIDER_NAMES[x.backend.provider], money(w.total, w.currency)))
          ),
        },
        actions: [reloadAction()],
      }]
      : [];
    return [
      ...net,
      ...r.ok.flatMap((x) =>
        x.value.sort((a, b) => a.group.localeCompare(b.group) || b.balance - a.balance).map((a) => {
          const item = accountItem(x.backend, a, many);
          return { ...item, actions: [...(item.actions ?? []), reloadAction()] };
        })
      ),
    ];
  },
});
