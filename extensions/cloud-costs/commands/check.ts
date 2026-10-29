import { run, storage, toast, updateCommandMetadata } from "@backslash/api";
import { alertKey, BUDGET_LOOK, budgetStatus, money, period, PROVIDER_NAMES, totals } from "../lib.ts";
import { enabled, loadAll, notify, type Prefs } from "../system.ts";

// Every 6 hours in the background: the month's spend under the command, and a
// desktop notification the first time this month it nears or passes the budget.
export default run(async ({ preferences, signal, launchType }) => {
  const prefs = preferences as Prefs;
  const background = launchType === "background";
  if (!enabled(prefs).length) {
    if (background) return;
    throw new Error("Turn on a provider in Settings → Extensions → Cloud Costs");
  }
  const { results, errors } = await loadAll(prefs, { signal });
  const all = results.map((r) => r.costs);
  const main = totals(all)[0];
  const budget = budgetStatus(all, Number(prefs.budget ?? 0), Number(prefs.warnPercent ?? 80));
  if (main) {
    await updateCommandMetadata({
      subtitle: `${money(main.total, main.currency)} this month${
        main.forecast !== undefined ? ` · ${money(main.forecast, main.currency)} forecast` : ""
      }`,
    });
  }
  if (budget && budget.level !== "ok") {
    const key = alertKey(period(), budget.level);
    const sent = (await storage.get<string[]>("alerts").catch(() => undefined)) ?? [];
    if (!sent.includes(key)) {
      const title = `Cloud costs: ${BUDGET_LOOK[budget.level].title.toLowerCase()}`;
      const body = `${money(budget.spent, budget.currency)} of ${money(budget.budget, budget.currency)} spent${
        budget.forecast !== undefined ? `, ${money(budget.forecast, budget.currency)} forecast for the month` : ""
      }`;
      await notify(title, body);
      await toast(title, { style: "failure", message: body });
      await storage.set("alerts", [...sent.filter((k) => k.startsWith(key.slice(0, 7))), key]);
    }
  }
  if (background) return;
  const failed = errors.length ? ` · ${errors.map((e) => PROVIDER_NAMES[e.provider]).join(", ")} failed` : "";
  if (!main) return `No cost data${failed}`;
  return `${money(main.total, main.currency)} this month${
    budget ? ` · ${BUDGET_LOOK[budget.level].title}` : ""
  }${failed}`;
});
