// Rows, previews and actions shared by the two commands.

import {
  type Accessory,
  type Action,
  action,
  close,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  type ItemDetail,
  meta,
  type Metadata,
  open,
  refresh,
  type Stat,
  toast,
} from "@backslash/api";
import { loadSites, type Options, saveSites, testSite } from "./api.ts";
import {
  ago,
  CATEGORIES,
  delta,
  type Field,
  latest,
  metric,
  rate,
  RATING_COLOR,
  RATING_TITLE,
  removeSite,
  reportUrl,
  type Run,
  scoreColor,
  scoreLine,
  shortUrl,
  type Site,
  sparkline,
  type Strategy,
} from "./lib.ts";

const TITLE: Record<Strategy, string> = { mobile: "Mobile", desktop: "Desktop" };

function stats(run: Run | undefined): Stat[] {
  if (!run) return [];
  return CATEGORIES.filter((c) => run.scores[c.key] !== undefined).map((c) => ({
    label: c.title.toLowerCase(),
    value: run.scores[c.key]!,
    color: scoreColor(run.scores[c.key]),
  }));
}

const dot = (rating?: "good" | "average" | "poor") => rating === "good" ? "🟢" : rating === "average" ? "🟠" : "🔴";

function fieldTable(f: Field | undefined): string {
  if (!f) {
    return "### Core Web Vitals\n\n_No field data: Chrome has too few visits to this page and site to report them._";
  }
  const rows = (
    [
      ["Largest Contentful Paint", "lcp"],
      ["Interaction to Next Paint", "inp"],
      ["Cumulative Layout Shift", "cls"],
      ["First Contentful Paint", "fcp"],
      ["Time to First Byte", "ttfb"],
    ] as const
  ).filter(([, k]) => f[k]).map(([title, k]) =>
    `| ${title} | ${metric(k, f[k]!.p75)} | ${dot(f[k]!.rating)} ${RATING_TITLE[f[k]!.rating]} |`
  );
  return [
    `### Core Web Vitals${f.overall ? `: ${f.overall === "good" ? "passed" : "failed"}` : ""}`,
    "",
    `Real Chrome users over the last 28 days, 75th percentile${
      f.scope === "origin" ? ", **for the whole site** (this page has too few visits)" : ""
    }.`,
    "",
    "| Metric | p75 | |",
    "| --- | ---: | --- |",
    ...rows,
  ].join("\n");
}

function labTable(run: Run): string {
  const rows = (
    [
      ["First Contentful Paint", "fcp"],
      ["Largest Contentful Paint", "lcp"],
      ["Total Blocking Time", "tbt"],
      ["Cumulative Layout Shift", "cls"],
      ["Speed Index", "si"],
    ] as const
  ).filter(([, k]) => run.lab[k] !== undefined).map(([title, k]) =>
    `| ${title} | ${metric(k, run.lab[k])} | ${dot(rate(k, run.lab[k]!))} |`
  );
  if (!rows.length) return "";
  return ["### Lab metrics", "", "| Metric | Value | |", "| --- | ---: | --- |", ...rows].join("\n");
}

function opportunitiesList(run: Run): string {
  if (!run.opportunities.length) return "";
  return [
    "### Opportunities",
    "",
    ...run.opportunities.map((o) => `- **${o.title}**: saves about ${metric("ms", o.savingsMs)}`),
  ].join("\n");
}

function historyTable(runs: Run[]): string {
  if (runs.length < 2) return "";
  const perf = runs.map((r) => r.scores.performance).filter((v): v is number => v !== undefined).reverse();
  return [
    `### History ${perf.length > 1 ? `\`${sparkline(perf)}\`` : ""}`,
    "",
    "| Tested | Perf | A11y | BP | SEO | LCP |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
    ...runs.slice(0, 10).map((r) =>
      `| ${new Date(r.at).toLocaleDateString("en", { dateStyle: "medium" })} | ${r.scores.performance ?? "–"} | ${
        r.scores.accessibility ?? "–"
      } | ${r.scores.bestPractices ?? "–"} | ${r.scores.seo ?? "–"} | ${
        metric("lcp", r.field?.lcp?.p75 ?? r.lab.lcp)
      } |`
    ),
  ].join("\n");
}

export function runMarkdown(site: Site, strategy: Strategy): string {
  const run = latest(site, strategy);
  if (!run) return `_Not tested on ${strategy} yet._`;
  return [
    fieldTable(run.field),
    labTable(run),
    opportunitiesList(run),
    historyTable(site.runs[strategy]),
    ...run.warnings.map((w) => `> ${w}`),
  ].filter(Boolean).join("\n\n");
}

function runMetadata(site: Site, strategy: Strategy): Metadata[] {
  const run = latest(site, strategy);
  const before = site.runs[strategy]?.[1];
  return [
    ...(run
      ? CATEGORIES.filter((c) => run.scores[c.key] !== undefined).map((c) => {
        const d = delta(run.scores[c.key], before?.scores[c.key]);
        return meta.text(c.title, `${run.scores[c.key]}${d ? ` (${d})` : ""}`, {
          icon: Icons.dot,
          color: scoreColor(run.scores[c.key]),
        });
      })
      : []),
    meta.separator(),
    meta.text("Strategy", TITLE[strategy], { icon: strategy === "mobile" ? Icons.mouse : Icons.monitor }),
    ...(run ? [meta.text("Tested", ago(run.at), { icon: Icons.clock })] : []),
    ...(run?.field
      ? [meta.text(
        "Field data",
        run.field.scope === "origin" ? "Whole site" : "This page",
        { icon: Icons.person, color: run.field.overall ? RATING_COLOR[run.field.overall] : undefined },
      )]
      : []),
    ...(run && run.finalUrl && run.finalUrl !== site.url ? [meta.text("Final URL", shortUrl(run.finalUrl))] : []),
    ...(run?.lighthouse ? [meta.text("Lighthouse", run.lighthouse)] : []),
    meta.text("Runs saved", String(site.runs[strategy]?.length ?? 0), { icon: Icons.history }),
    meta.link("Page", shortUrl(site.url), site.url),
  ];
}

export function siteDetail(site: Site, strategy: Strategy): ItemDetail {
  return {
    stats: stats(latest(site, strategy)),
    markdown: runMarkdown(site, strategy),
    metadata: runMetadata(site, strategy),
  };
}

/** Runs the test from an action: toasts what failed, or the new performance score. */
async function retest(site: Site, o: Options): Promise<void> {
  const { site: updated, errors } = await testSite(site.url, o);
  if (errors.length) await toast(errors[0], { style: "failure" });
  else {
    const m = latest(updated, "mobile")?.scores.performance, d = latest(updated, "desktop")?.scores.performance;
    await toast(`${shortUrl(site.url)}: ${m ?? "–"} mobile, ${d ?? "–"} desktop`, { style: "success" });
  }
}

export function siteActions(site: Site, strategy: Strategy, o: Options, inList: boolean): Action[] {
  const run = latest(site, strategy);
  const other: Strategy = strategy === "mobile" ? "desktop" : "mobile";
  return [
    action("Test Again", async () => {
      await retest(site, o);
      return inList ? refresh() : resultView((await loadSites()).find((s) => s.url === site.url) ?? site, strategy, o);
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    open(reportUrl(site.url, strategy), `Open ${TITLE[strategy]} Report`, { shortcut: "<Ctrl>o" }),
    ...(inList ? [] : [action(`Show ${TITLE[other]}`, () => resultView(site, other, o), { icon: Icons.monitor })]),
    open(site.url, "Open Page", { icon: Icons.globe, shortcut: "<Ctrl><Shift>o" }),
    ...(run ? [copy(scoreLine(run), "Copy Scores", { section: "Copy", shortcut: "<Ctrl><Shift>c" })] : []),
    copy(site.url, "Copy URL", { section: "Copy" }),
    action("Remove Site", async () => {
      await saveSites(removeSite(await loadSites(), site.url));
      if (!inList) return close(`Removed ${shortUrl(site.url)}`);
      await toast(`Removed ${shortUrl(site.url)}`);
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Remove ${shortUrl(site.url)} and its history?`,
      section: "Site",
      shortcut: "<Ctrl>x",
    }),
  ];
}

export function siteItem(site: Site, strategy: Strategy, o: Options): Item {
  const run = latest(site, strategy);
  const perf = run?.scores.performance;
  const accessories: Accessory[] = run
    ? [
      ...(run.field?.overall
        ? [{
          icon: { source: Icons.person, tint: RATING_COLOR[run.field.overall] },
          tooltip: `Core Web Vitals: ${run.field.overall === "good" ? "passed" : "failed"}`,
        }]
        : []),
      ...CATEGORIES.filter((c) => run.scores[c.key] !== undefined).map((c) => ({
        tag: String(run.scores[c.key]),
        color: scoreColor(run.scores[c.key]),
        tooltip: c.title,
      })),
    ]
    : [{ text: `not tested on ${strategy}` }];
  return {
    id: site.url,
    title: shortUrl(site.url),
    subtitle: run ? ago(run.at) : undefined,
    icon: { source: Icons.chartUp, tint: scoreColor(perf) },
    keywords: [site.url],
    accessories,
    detail: siteDetail(site, strategy),
    actions: siteActions(site, strategy, o, true),
  };
}

/** The full result of a site, as a page (the Test Page Speed command, "Analyze" in the list). */
export function resultView(site: Site, strategy: Strategy, o: Options, errors: string[] = []): DetailSpec {
  const run = latest(site, strategy);
  return detail({
    title: `${shortUrl(site.url)} · ${TITLE[strategy]}`,
    markdown: [
      `## ${shortUrl(site.url)} · ${TITLE[strategy]}`,
      ...errors.map((e) => `> ${e}`),
      runMarkdown(site, strategy),
    ].join("\n\n"),
    stats: stats(run),
    metadata: runMetadata(site, strategy),
    status: run ? scoreLine(run) : undefined,
    actions: siteActions(site, strategy, o, false),
  });
}
