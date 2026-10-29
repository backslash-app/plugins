import { copy, Icons, type Item, list, meta, open, updateCommandMetadata } from "@backslash/api";
import { guarded, promData, prometheus, type Server } from "../api.ts";
import { graphUrl, parseTargets, seconds, since, sortTargets, type Target, targetCounts } from "../lib.ts";

const HEALTH = {
  up: { color: "green" as const, icon: Icons.done, title: "Up" },
  down: { color: "red" as const, icon: Icons.canceled, title: "Down" },
  unknown: { color: "gray" as const, icon: Icons.backlog, title: "Unknown" },
};

function targetItem(s: Server, t: Target): Item {
  const h = HEALTH[t.health as keyof typeof HEALTH] ?? HEALTH.unknown;
  const extra = Object.entries(t.labels).filter(([k]) => k !== "job" && k !== "instance");
  const upExpr = `up{job=${JSON.stringify(t.job)},instance=${JSON.stringify(t.instance)}}`;
  return {
    id: `${t.pool}|${t.url}`,
    title: t.instance || t.url,
    subtitle: t.health === "down" ? t.lastError : t.url,
    icon: { source: h.icon, tint: h.color },
    section: t.health === "down" ? "Down" : t.job,
    keywords: [t.job, t.pool, t.url, t.health, ...extra.map(([, v]) => v)],
    accessories: [
      ...(t.health === "down" ? [{ tag: t.job }] : []),
      ...(t.lastScrapeDuration !== undefined && t.health === "up"
        ? [{ text: seconds(t.lastScrapeDuration), tooltip: "Last scrape duration" }]
        : []),
      { text: t.lastScrape ? `${since(t.lastScrape)} ago` : "never", tooltip: "Last scrape" },
    ],
    detail: {
      markdown: t.lastError ? `**Last error**\n\n\`\`\`\n${t.lastError}\n\`\`\`` : undefined,
      metadata: [
        meta.text("Health", h.title, { icon: h.icon, color: h.color }),
        meta.text("Job", t.job, { icon: Icons.layers }),
        ...(t.pool !== t.job ? [meta.text("Scrape pool", t.pool)] : []),
        meta.link("Endpoint", t.url, t.url),
        ...(t.lastScrape
          ? [meta.text("Last scrape", t.lastScrape.toLocaleString("en-GB"), { icon: Icons.clock })]
          : []),
        ...(t.lastScrapeDuration !== undefined ? [meta.text("Duration", seconds(t.lastScrapeDuration))] : []),
        ...(t.interval ? [meta.text("Interval", t.interval, { icon: Icons.timer })] : []),
        ...(extra.length ? [meta.separator(), ...extra.map(([k, v]) => meta.text(k, v, { icon: Icons.tag }))] : []),
      ],
    },
    actions: [
      open(t.url, "Open Metrics Endpoint"),
      open(`${s.base}/targets?search=${encodeURIComponent(t.instance)}`, "Open in Prometheus", { shortcut: "<Ctrl>o" }),
      open(graphUrl(s.base, upExpr), "Graph up for This Target", { icon: Icons.chartUp, section: "Prometheus" }),
      copy(t.url, "Copy Endpoint", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(t.instance, "Copy Instance", { section: "Copy" }),
      ...(t.lastError ? [copy(t.lastError, "Copy Error", { section: "Copy" })] : []),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter targets by job, instance, label…",
  filter: {
    options: [{ value: "down", title: "Down" }, { value: "all", title: "All" }],
    default: "down",
  },
  empty: { title: "Every target is up", description: "Tab shows all of them", icon: Icons.check },
  status: () => summary,
  items: ({ preferences, filter, signal }) =>
    guarded(async () => {
      const s = prometheus(preferences);
      const { data } = await promData(s, "/api/v1/targets?state=active", signal);
      const targets = sortTargets(parseTargets(data));
      const c = targetCounts(targets);
      summary = `${c.down} down · ${c.up} up${c.unknown ? ` · ${c.unknown} unknown` : ""} · ${c.total} targets`;
      updateCommandMetadata({ subtitle: c.down ? `${c.down} down` : null }).catch(() => {});
      const shown = (filter ?? "down") === "down" ? targets.filter((t) => t.health !== "up") : targets;
      return shown.map((t) => targetItem(s, t));
    }, signal),
});
