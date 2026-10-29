import { type Context, Icons, menuBar, type MenuBarItem, open, storage, updateCommandMetadata } from "@backslash/api";
import { keysOf, load } from "../api.ts";
import {
  budgetOf,
  dayOf,
  forecast,
  type Level,
  level,
  money,
  percent,
  PROVIDERS,
  shortMoney,
  shouldNotify,
} from "../lib.ts";
import { budgetLine, notify, total, totalToday } from "../ui.ts";

const WARNED = "warned";

export default async ({ preferences, signal }: Context) => {
  const keys = keysOf(preferences);
  const items: MenuBarItem[] = [];
  if (!keys.anthropic && !keys.openai && !keys.openrouter) {
    return menuBar({
      title: "",
      tooltip: "AI Usage: add a key in the preferences",
      items: [{ title: "Add an admin key in Settings → Extensions → AI Usage", icon: Icons.key, enabled: false }],
    });
  }
  const snap = await load(keys, { signal });
  const now = Date.now();
  const spent = total(snap);
  const b = budgetOf(preferences);
  const lv: Level = level(spent, b);
  const line = budgetLine(spent, b);

  // Warn once per month at the warning threshold, and once when over.
  const month = dayOf(now).slice(0, 7);
  const previous = await storage.get<{ month: string; level: Level }>(WARNED).catch(() => undefined);
  if (snap.reports.length && shouldNotify(previous, month, lv)) {
    await notify(
      lv === "over" ? "AI budget exceeded" : `AI spend at ${percent(spent, b.amount)} % of budget`,
      `${money(spent)} of ${money(b.amount)} this month · forecast ${money(forecast(spent, now))}`,
      lv === "over",
    );
  }
  if (snap.reports.length) await storage.set(WARNED, { month, level: lv }).catch(() => {});
  updateCommandMetadata({ subtitle: `${shortMoney(spent)} this month${lv === "over" ? " · over budget" : ""}` })
    .catch(() => {});

  items.push(
    { title: `${money(spent)} this month`, icon: Icons.coin, section: "Month to Date", enabled: false },
    {
      title: `${money(totalToday(snap))} today · ${money(forecast(spent, now))} forecast`,
      enabled: false,
      section: "Month to Date",
    },
  );
  if (line) {
    items.push({
      title: line,
      icon: lv === "ok" ? Icons.check : Icons.alert,
      section: "Month to Date",
      enabled: false,
    });
  }
  for (const r of snap.reports) {
    const p = PROVIDERS[r.provider];
    items.push({
      id: r.provider,
      title: `${p.title}: ${money(r.month)}`,
      subtitle: `${money(r.today)} today`,
      section: "Providers",
      action: open(p.console, `Open ${p.title} Usage`),
    });
  }
  for (const p of snap.problems) {
    items.push({
      title: `${PROVIDERS[p.provider].title}: ${p.message}`,
      icon: Icons.alert,
      section: "Problems",
      enabled: false,
    });
  }
  return menuBar({
    title: shortMoney(spent),
    icon: lv === "ok" ? Icons.coin : Icons.alert,
    tooltip: `AI spend this month: ${money(spent)}${line ? ` (${line})` : ""}`,
    items,
  });
};
