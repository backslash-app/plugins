import {
  action,
  type Color,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  updateCommandMetadata,
} from "@backslash/api";
import { keysOf, load, type Snapshot } from "../api.ts";
import {
  budgetOf,
  dailyChart,
  forecast,
  level,
  money,
  percent,
  PROVIDERS,
  type Report,
  shortModel,
  shortMoney,
  sumDaily,
  tokens,
} from "../lib.ts";
import { budgetLine, setupItem, total, totalToday } from "../ui.ts";

const TINT: Record<string, Color> = { anthropic: "orange", openai: "green", openrouter: "purple" };
let footer = "";
/** The next load skips the cache (after Ctrl+R). */
let force = false;

const reload = () =>
  action("Refresh Now", () => {
    force = true;
    return refresh();
  }, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

function providerItem(r: Report, now: number): Item {
  const p = PROVIDERS[r.provider];
  const pace = forecast(r.month, now);
  const top = r.models.slice(0, 8);
  return {
    id: `provider:${r.provider}`,
    title: p.title,
    subtitle: `${money(r.today)} today`,
    section: "This Month",
    icon: { source: Icons.coin, tint: TINT[r.provider] },
    accessories: [
      ...(r.balance !== undefined ? [{ text: `${money(r.balance)} left`, tooltip: "Credits remaining" }] : []),
      { tag: money(r.month) },
    ],
    detail: {
      stats: [
        { label: "Month to date", value: money(r.month) },
        { label: "Today", value: money(r.today) },
        { label: "Forecast", value: money(pace) },
      ],
      markdown: [
        dailyChart(r.daily, now),
        ...(r.note ? ["", `_${r.note}._`] : []),
      ].join("\n"),
      metadata: [
        ...top.map((m) => meta.text(shortModel(m.model), money(m.cost))),
        ...(r.models.length > top.length ? [meta.text("Other models", String(r.models.length - top.length))] : []),
        ...(r.balance !== undefined ? [meta.separator(), meta.text("Credits left", money(r.balance))] : []),
      ],
    },
    actions: [
      open(p.console, `Open ${p.title} Usage`),
      copy(money(r.month), "Copy Month to Date"),
      reload(),
    ],
  };
}

function modelItems(r: Report): Item[] {
  const p = PROVIDERS[r.provider];
  return r.models.map((m) => {
    const cached = m.inputTokens ? percent(m.cachedTokens, m.inputTokens) : 0;
    return {
      id: `model:${r.provider}:${m.model}`,
      title: shortModel(m.model),
      subtitle: m.inputTokens || m.outputTokens
        ? `${tokens(m.inputTokens)} in · ${tokens(m.outputTokens)} out${cached ? ` · ${cached} % cached` : ""}`
        : undefined,
      section: `${p.title} by Model`,
      icon: { source: Icons.sparkle, tint: TINT[r.provider] },
      keywords: [p.title, m.model],
      accessories: [
        ...(m.requests ? [{ text: `${m.requests.toLocaleString("en")} req` }] : []),
        { tag: money(m.cost) },
        { text: `${percent(m.cost, r.month)} %`, tooltip: `Share of ${p.title}'s month` },
      ],
      detail: {
        stats: [
          { label: "Cost", value: money(m.cost) },
          { label: "Input", value: tokens(m.inputTokens) },
          { label: "Output", value: tokens(m.outputTokens) },
        ],
        metadata: [
          meta.text("Provider", p.title),
          meta.text("Model", m.model, { icon: Icons.sparkle }),
          meta.text("Cached input", `${tokens(m.cachedTokens)} (${cached} %)`),
          ...(m.requests ? [meta.text("Requests", m.requests.toLocaleString("en"))] : []),
          ...(m.inputTokens + m.outputTokens && m.cost
            ? [meta.text("Per million tokens", money(m.cost / (m.inputTokens + m.outputTokens) * 1e6))]
            : []),
        ],
      },
      actions: [
        copy(money(m.cost), "Copy Cost"),
        copy(m.model, "Copy Model Name"),
        open(p.console, "Open Usage"),
        reload(),
      ],
    };
  });
}

function totalItem(s: Snapshot, prefs: Record<string, unknown>, now: number): Item {
  const spent = total(s);
  const b = budgetOf(prefs);
  const lv = level(spent, b);
  const pace = forecast(spent, now);
  const line = budgetLine(spent, b);
  return {
    id: "total",
    title: `${money(spent)} this month`,
    subtitle: line ?? `${money(totalToday(s))} today · ${money(pace)} forecast`,
    section: "This Month",
    icon: {
      source: lv === "ok" ? Icons.chartUp : Icons.alert,
      tint: lv === "over" ? "red" : lv === "warn" ? "orange" : "blue",
    },
    accessories: [{ text: `${money(totalToday(s))} today` }],
    detail: {
      stats: [
        { label: "Month to date", value: money(spent), color: lv === "over" ? "red" : undefined },
        { label: "Today", value: money(totalToday(s)) },
        { label: "Forecast", value: money(pace), color: b.amount && pace > b.amount ? "orange" : undefined },
      ],
      markdown: dailyChart(sumDaily(s.reports), now),
      metadata: [
        ...s.reports.map((r) => meta.text(PROVIDERS[r.provider].title, money(r.month), { icon: Icons.coin })),
        ...(b.amount
          ? [
            meta.separator(),
            meta.progress("Budget", spent / b.amount, `${percent(spent, b.amount)} % of ${money(b.amount)}`),
            meta.text("Left this month", money(Math.max(0, b.amount - spent))),
          ]
          : [meta.text("Budget", "None: set one in the preferences")]),
        meta.text("Updated", new Date(s.at).toLocaleTimeString("en", { timeStyle: "short" }), { icon: Icons.clock }),
      ],
    },
    actions: [
      copy(money(spent), "Copy Month to Date"),
      copy(
        [
          `AI spend, month to date: ${money(spent)}`,
          ...s.reports.map((r) => `- ${PROVIDERS[r.provider].title}: ${money(r.month)}`),
        ]
          .join("\n"),
        "Copy Summary",
        { icon: Icons.text },
      ),
      reload(),
    ],
  };
}

export default list({
  placeholder: "Filter providers and models…",
  empty: { title: "No usage yet", description: "Nothing was spent this month", icon: Icons.coin },
  status: () => footer,
  async items({ preferences, signal }) {
    const now = Date.now();
    const snap = await load(keysOf(preferences), { signal, force });
    force = false;
    const items: Item[] = [];
    if (snap.reports.length) {
      const spent = total(snap);
      updateCommandMetadata({ subtitle: `${shortMoney(spent)} this month` }).catch(() => {});
      items.push(totalItem(snap, preferences, now), ...snap.reports.map((r) => providerItem(r, now)));
      for (const r of snap.reports) items.push(...modelItems(r));
      footer = `Month to date (UTC) · updated ${new Date(snap.at).toLocaleTimeString("en", { timeStyle: "short" })}`;
    } else footer = "";
    for (const p of snap.problems) {
      items.push(
        p.setup ? setupItem(p.provider, p.message) : {
          id: `error:${p.provider}`,
          title: `${PROVIDERS[p.provider].title}: ${p.message}`,
          subtitle: "The other providers are shown anyway",
          section: "Problems",
          icon: { source: Icons.alert, tint: "red" },
          actions: [reload(), open(PROVIDERS[p.provider].console, "Open Usage Page")],
        },
      );
    }
    for (const id of snap.missing) items.push(setupItem(id));
    return items;
  },
});
