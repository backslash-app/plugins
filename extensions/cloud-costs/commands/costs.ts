import {
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  bar,
  BUDGET_LOOK,
  budgetStatus,
  classifyError,
  type Costs,
  money,
  period,
  PROVIDER_COLORS,
  PROVIDER_NAMES,
  type ProviderId,
  sparkline,
  totals,
} from "../lib.ts";
import { clearCache, loadAll, MissingCli, type Prefs } from "../system.ts";

const CONSOLES: Record<ProviderId, string> = {
  aws: "https://console.aws.amazon.com/costmanagement/home#/cost-explorer",
  gcp: "https://console.cloud.google.com/billing/reports",
  azure: "https://portal.azure.com/#view/Microsoft_Azure_CostManagement/Menu/~/costanalysis",
  hetzner: "https://console.hetzner.com/projects",
};

const INSTALL: Record<MissingCli["cli"], { command: string; url: string; then: string }> = {
  aws: {
    command:
      "curl -fsSL https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip -o aws.zip && unzip aws.zip && sudo ./aws/install",
    url: "https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html",
    then: "aws configure sso",
  },
  bq: {
    command: "curl https://sdk.cloud.google.com | bash",
    url: "https://cloud.google.com/sdk/docs/install",
    then: "gcloud auth login",
  },
  az: {
    command: "curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash",
    url: "https://learn.microsoft.com/cli/azure/install-azure-cli-linux",
    then: "az login",
  },
};

const refreshAction = action("Refresh Now", async () => {
  await clearCache();
  await toast("Asking every provider again…");
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Costs" });

const ago = (ms: number) => {
  const m = Math.round((Date.now() - ms) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

const shortDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });

function setupItem(): Item {
  return {
    id: "setup",
    title: "Connect a cloud account",
    subtitle: "Turn on AWS or Azure, or set a BigQuery table or a Hetzner token in Settings",
    icon: { source: Icons.coin, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your clouds",
        "",
        "In **Settings → Extensions → Cloud Costs → Configure**:",
        "",
        "- **AWS**: turn it on; the `aws` CLI's profile needs `ce:GetCostAndUsage` and `ce:GetCostForecast`.",
        "  Cost Explorer charges $0.01 per request, so results are kept for 6 hours.",
        "- **Google Cloud**: there is no billing API for spend: set up the",
        "  [BigQuery billing export](https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup) and give",
        "  its table (`project.dataset.gcp_billing_export_v1_…`). The `bq` command runs the query.",
        "- **Azure**: turn it on; `az login` with the Cost Management Reader role on the subscription.",
        "- **Hetzner Cloud**: a read-only project token. Hetzner has no billing API: the spend is",
        "  estimated from the list prices of the servers, volumes, load balancers and IPs.",
        "",
        "Set a **monthly budget** to be warned (in the background too) when spend nears it.",
      ].join("\n"),
    },
    actions: [
      open("https://cloud.google.com/billing/docs/how-to/export-data-bigquery-setup", "Open BigQuery Export Guide"),
    ],
  };
}

function errorItem(provider: ProviderId, e: unknown): Item {
  if (e instanceof MissingCli) {
    const i = INSTALL[e.cli];
    return {
      id: `missing:${provider}`,
      title: `${e.message}: ${PROVIDER_NAMES[provider]} needs it`,
      subtitle: i.then,
      icon: { source: Icons.alert, tint: "orange" },
      section: "Problems",
      detail: { markdown: ["```sh", i.command, i.then, "```"].join("\n") },
      actions: [copy(i.command, "Copy Install Command", { icon: Icons.terminal }), open(i.url, "Open Install Guide")],
    };
  }
  const message = e instanceof Error ? e.message : String(e);
  const c = classifyError(provider, message);
  return {
    id: `error:${provider}`,
    title: c.title,
    subtitle: c.hint ?? message,
    icon: { source: Icons.alert, tint: "red" },
    section: "Problems",
    detail: { markdown: [c.hint ? `**${c.hint}**\n` : "", "```", message.slice(0, 2000), "```"].join("\n") },
    actions: [
      refreshAction,
      ...(c.hint && /^(aws|az|gcloud) /.test(c.hint) ? [copy(c.hint, `Copy ${c.hint}`, { icon: Icons.terminal })] : []),
      open(CONSOLES[provider], `Open ${PROVIDER_NAMES[provider]} Billing`),
      copy(message, "Copy Error", { section: "Copy" }),
    ],
  };
}

function common(c: Costs): Action[] {
  return [
    open(CONSOLES[c.provider], `Open ${PROVIDER_NAMES[c.provider]} Billing`),
    copy(money(c.total, c.currency), "Copy Month to Date", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(
      ["service\tamount", ...c.byService.map((s) => `${s.name}\t${s.amount}`)].join("\n"),
      "Copy by Service (TSV)",
      { icon: Icons.text, section: "Copy" },
    ),
    copy(["day\tamount", ...c.byDay.map((d) => `${d.name}\t${d.amount}`)].join("\n"), "Copy by Day (TSV)", {
      icon: Icons.calendar,
      section: "Copy",
    }),
    refreshAction,
  ];
}

function providerItem(c: Costs, cached: boolean): Item {
  const top = c.byService.slice(0, 8);
  const yesterday = c.byDay[c.byDay.length - 2];
  return {
    id: `provider:${c.provider}`,
    title: PROVIDER_NAMES[c.provider],
    subtitle: `${money(c.total, c.currency)} so far${
      c.forecast !== undefined ? ` · ${money(c.forecast, c.currency)} forecast` : ""
    }`,
    icon: { source: Icons.cloud, tint: PROVIDER_COLORS[c.provider] },
    section: "Providers",
    keywords: c.byService.map((s) => s.name),
    accessories: [
      { text: sparkline(c.byDay.map((d) => d.amount)), tooltip: "Daily spend this month" },
      ...(c.forecastKind === "estimate" ? [{ tag: "Estimate", color: "gray" as const }] : []),
      { text: money(c.total, c.currency) },
    ],
    detail: {
      stats: [
        { label: "Month to date", value: money(c.total, c.currency) },
        ...(c.forecast !== undefined ? [{ label: "Forecast", value: money(c.forecast, c.currency) }] : []),
        ...(yesterday ? [{ label: "Yesterday", value: money(yesterday.amount, c.currency) }] : []),
      ],
      markdown: [
        top.length
          ? [
            "| Service | Amount | |",
            "|---|---:|---|",
            ...top.map((s) =>
              `| ${s.name.replace(/\|/g, "/")} | ${money(s.amount, c.currency)} | ${
                bar(c.total ? s.amount / c.total : 0)
              } |`
            ),
          ].join("\n")
          : "_Nothing spent this month yet._",
        c.note ? `\n_${c.note}_` : "",
      ].join("\n"),
      metadata: [
        meta.text(
          "Forecast",
          c.forecastKind === "provider"
            ? `By ${PROVIDER_NAMES[c.provider]}`
            : c.forecastKind === "estimate"
            ? "List prices × hours"
            : "Daily average so far",
          { icon: Icons.chartUp },
        ),
        meta.text("Services", c.byService.length),
        meta.text("Updated", `${ago(c.fetched)}${cached ? " (cached)" : ""}`, { icon: Icons.clock }),
      ],
    },
    actions: common(c),
  };
}

function serviceItems(c: Costs): Item[] {
  return c.byService.map((s) => ({
    id: `service:${c.provider}:${s.name}`,
    title: s.name,
    icon: { source: Icons.box, tint: PROVIDER_COLORS[c.provider] },
    section: `${PROVIDER_NAMES[c.provider]} · ${money(c.total, c.currency)}`,
    accessories: [
      { text: bar(c.total ? s.amount / c.total : 0), tooltip: "Share of the month" },
      { text: `${c.total ? Math.round((s.amount / c.total) * 100) : 0} %`, color: "gray" as const },
      { text: money(s.amount, c.currency) },
    ],
    detail: {
      stats: [
        { label: "Month to date", value: money(s.amount, c.currency) },
        { label: "Share", value: `${c.total ? Math.round((s.amount / c.total) * 1000) / 10 : 0} %` },
      ],
      metadata: [
        meta.text("Provider", PROVIDER_NAMES[c.provider], { icon: Icons.cloud, color: PROVIDER_COLORS[c.provider] }),
      ],
    },
    actions: [copy(`${s.name}\t${s.amount}`, "Copy Line"), ...common(c)],
  }));
}

function dayItems(c: Costs): Item[] {
  const max = Math.max(0, ...c.byDay.map((d) => d.amount));
  const today = period().today;
  return [...c.byDay].reverse().map((d) => ({
    id: `day:${c.provider}:${d.name}`,
    title: shortDay(d.name),
    subtitle: d.name === today ? "Today, so far" : undefined,
    icon: { source: Icons.calendar, tint: PROVIDER_COLORS[c.provider] },
    section: PROVIDER_NAMES[c.provider],
    keywords: [d.name],
    accessories: [{ text: bar(max ? d.amount / max : 0) }, { text: money(d.amount, c.currency) }],
    actions: [copy(`${d.name}\t${d.amount}`, "Copy Line"), ...common(c)],
  }));
}

let summary = "";

export default list({
  placeholder: "Filter providers, services, days…",
  filter: {
    options: [
      { value: "overview", title: "Overview" },
      { value: "services", title: "By Service" },
      { value: "days", title: "By Day" },
    ],
    default: "overview",
  },
  empty: { title: "Nothing to show", description: "No spend in this view yet", icon: Icons.coin },
  status: () => summary,
  actions: [refreshAction],
  async items({ preferences, filter, signal }) {
    summary = "";
    const prefs = preferences as Prefs;
    const { results, errors } = await loadAll(prefs, { signal });
    if (!results.length && !errors.length) return [setupItem()];
    const all = results.map((r) => r.costs);
    const problems = errors.map((e) => errorItem(e.provider, e.error));
    const sums = totals(all);
    const budget = budgetStatus(all, Number(prefs.budget ?? 0), Number(prefs.warnPercent ?? 80));
    summary = [
      sums.map((t) => `${money(t.total, t.currency)} so far`).join(" + "),
      sums.length === 1 && sums[0].forecast !== undefined
        ? `${money(sums[0].forecast, sums[0].currency)} forecast`
        : "",
      budget ? `${Math.round(budget.ratio * 100)} % of the budget` : "",
    ].filter(Boolean).join(" · ");
    if (sums[0]) {
      updateCommandMetadata({ subtitle: `${money(sums[0].total, sums[0].currency)} this month` }).catch(() => {});
    }

    const view = filter ?? "overview";
    if (view === "services") return [...problems, ...all.flatMap(serviceItems)];
    if (view === "days") return [...problems, ...all.flatMap(dayItems)];

    // A total line when it says more than the provider rows: several providers, or a budget.
    const header: Item[] = sums.filter((t) => t.providers.length > 1 || budget?.currency === t.currency).map((t) => {
      const b = budget && budget.currency === t.currency ? budget : undefined;
      const look = BUDGET_LOOK[b?.level ?? "none"];
      return {
        id: `total:${t.currency}`,
        title: `${money(t.total, t.currency)} this month`,
        subtitle: [
          t.forecast !== undefined ? `${money(t.forecast, t.currency)} forecast` : "",
          t.providers.map((x) => PROVIDER_NAMES[x]).join(", "),
        ].filter(Boolean).join(" · "),
        icon: { source: Icons.coin, tint: look.color },
        section: "Total",
        accessories: b ? [{ tag: look.title, color: look.color }] : [],
        detail: {
          stats: [
            { label: "Month to date", value: money(t.total, t.currency) },
            ...(t.forecast !== undefined ? [{ label: "Forecast", value: money(t.forecast, t.currency) }] : []),
            ...(b ? [{ label: "Budget", value: money(b.budget, b.currency), color: look.color }] : []),
          ],
          metadata: [
            ...(b
              ? [
                meta.progress("Budget used", b.ratio, `${Math.round(b.ratio * 100)} %`),
                ...(b.forecast !== undefined
                  ? [
                    meta.progress(
                      "Forecast vs budget",
                      b.forecast / b.budget,
                      `${Math.round((b.forecast / b.budget) * 100)} %`,
                    ),
                  ]
                  : []),
                meta.text("Status", look.title, { icon: Icons.bell, color: look.color }),
              ]
              : [meta.text("Budget", "None: set one in Settings to be warned", { icon: Icons.bell })]),
            meta.tags("Providers", t.providers.map((x) => ({ text: PROVIDER_NAMES[x], color: PROVIDER_COLORS[x] }))),
          ],
        },
        actions: [copy(money(t.total, t.currency), "Copy Total"), refreshAction],
      };
    });
    return [...header, ...problems, ...results.map((r) => providerItem(r.costs, r.cached))];
  },
});
