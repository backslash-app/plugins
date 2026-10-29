// What the list and the tray menu share: setup rows, the budget line and the notification.

import { exec, Icons, type Item, open } from "@backslash/api";
import { type Snapshot } from "./api.ts";
import { type Budget, level, money, percent, type ProviderId, PROVIDERS } from "./lib.ts";

export const SETUP: Record<ProviderId, string[]> = {
  anthropic: [
    "## Connect Anthropic",
    "",
    "1. In the Claude Console, **Settings → Admin keys → Create admin key** (Enter opens it).",
    "   Only organization admins can create one; regular API keys can't read usage.",
    "2. Paste it (`sk-ant-admin…`) in **Settings → Extensions → AI Usage → Anthropic Admin key**.",
    "",
    "The usage and cost reports cover the whole organization, every workspace.",
  ],
  openai: [
    "## Connect OpenAI",
    "",
    "1. In the OpenAI platform, **Organization settings → Admin keys → Create new admin key** (Enter opens it).",
    "   Read-only access to **Usage** is enough.",
    "2. Paste it (`sk-admin-…`) in **Settings → Extensions → AI Usage → OpenAI Admin key**.",
  ],
  openrouter: [
    "## Connect OpenRouter",
    "",
    "1. In OpenRouter, **Settings → API Keys** (Enter opens it): any key shows its spend today and this month.",
    "   A **provisioning key** also gives the spend per model and per day.",
    "2. Paste it in **Settings → Extensions → AI Usage → OpenRouter key**.",
  ],
};

export function setupItem(provider: ProviderId, problem?: string): Item {
  const p = PROVIDERS[provider];
  return {
    id: `setup:${provider}`,
    title: problem ?? `Connect ${p.title}`,
    subtitle: problem ? "Check the key in the extension's preferences" : "Add a key in the extension's preferences",
    section: problem ? "Problems" : "Add a Provider",
    icon: { source: problem ? Icons.alert : Icons.key, tint: problem ? "orange" : "gray" },
    detail: { markdown: [...(problem ? [`**${problem}.**`, ""] : []), ...SETUP[provider]].join("\n") },
    actions: [open(p.keys, `Open ${p.title} Keys`, { icon: Icons.key })],
  };
}

export const total = (s: Snapshot) => s.reports.reduce((sum, r) => sum + r.month, 0);
export const totalToday = (s: Snapshot) => s.reports.reduce((sum, r) => sum + r.today, 0);

export function budgetLine(spent: number, b: Budget): string | undefined {
  if (!b.amount) return undefined;
  const lv = level(spent, b);
  const pct = percent(spent, b.amount);
  if (lv === "over") return `Over budget: ${money(spent)} of ${money(b.amount)} (${pct} %)`;
  return `${pct} % of the ${money(b.amount)} budget`;
}

/** A desktop notification, when notify-send is there (toasts only show while the launcher is open). */
export async function notify(title: string, body: string, urgent: boolean): Promise<void> {
  await exec("notify-send", [
    "-a",
    "Backslash",
    "-u",
    urgent ? "critical" : "normal",
    "-i",
    "dialog-warning",
    title,
    body,
  ])
    .catch(() => {});
}
