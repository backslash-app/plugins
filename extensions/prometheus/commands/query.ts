import { type Action, action, copy, Icons, type Item, list, type ListSpec, meta, open, storage } from "@backslash/api";
import { guarded, promData, prometheus, type Server } from "../api.ts";
import {
  formatMetric,
  formatValue,
  graphUrl,
  parseQueryResult,
  type QueryResult,
  remember,
  type Series,
  sortSeries,
  sparkline,
} from "../lib.ts";

const EXAMPLES: [string, string][] = [
  ["up == 0", "Targets that are down"],
  ["sum by (job) (up)", "Healthy targets per job"],
  ['100 * (1 - avg by (instance) (rate(node_cpu_seconds_total{mode="idle"}[5m])))', "CPU usage per instance (%)"],
  ["100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)", "Memory usage (%)"],
  [
    '100 * (1 - node_filesystem_avail_bytes{fstype!~"tmpfs|overlay"} / node_filesystem_size_bytes)',
    "Disk usage per filesystem (%)",
  ],
  ['sum by (job) (rate(http_requests_total{code=~"5.."}[5m]))', "5xx rate per job"],
  ["ALERTS", "Alerts Prometheus evaluates now"],
  ['topk(10, count by (__name__) ({__name__=~".+"}))', "Metrics with the most series"],
];

async function history(): Promise<string[]> {
  const h = await storage.get<string[]>("history").catch(() => undefined);
  return Array.isArray(h) ? h : [];
}

const save = async (expr: string) => await storage.set("history", remember(await history(), expr)).catch(() => {});

/** A past or example expression: copy it into the search field, or open it in Prometheus. */
function exprItem(s: Server, expr: string, subtitle: string, section: string): Item {
  return {
    id: `${section}:${expr}`,
    title: expr,
    subtitle,
    icon: { source: section === "History" ? Icons.history : Icons.code, tint: "orange" },
    section,
    detail: { markdown: `\`\`\`promql\n${expr}\n\`\`\`` },
    actions: [
      action("Run Query", () => runView(s, expr), { icon: Icons.play }),
      copy(expr, "Copy Expression"),
      open(graphUrl(s.base, expr), "Open in Prometheus", { shortcut: "<Ctrl>o" }),
    ],
  };
}

function seriesItem(s: Server, expr: string, series: Series, matrix: boolean, i: number): Item {
  const metric = formatMetric(series.metric);
  const last = series.values[series.values.length - 1];
  const value = last ? formatValue(last[1]) : "";
  const labels = Object.entries(series.metric).filter(([k]) => k !== "__name__");
  const at = last ? new Date(last[0] * 1000) : undefined;
  const actions: Action[] = [
    copy(last?.[1] ?? "", `Copy Value (${value})`),
    copy(metric, "Copy Series", { icon: Icons.code, shortcut: "<Ctrl>period" }),
    open(graphUrl(s.base, expr), "Open in Prometheus", { shortcut: "<Ctrl>o" }),
    copy(expr, "Copy Expression", { section: "Copy" }),
    ...(matrix
      ? [copy(series.values.map(([t, v]) => `${new Date(t * 1000).toISOString()}\t${v}`).join("\n"), "Copy Samples", {
        icon: Icons.text,
        section: "Copy",
      })]
      : []),
    copy(JSON.stringify(series.metric, null, 2), "Copy Labels as JSON", { icon: Icons.braces, section: "Copy" }),
  ];
  return {
    id: `series:${i}:${metric}`,
    title: series.metric.__name__ ?? (labels.length ? labels.map(([k, v]) => `${k}=${v}`).slice(0, 2).join(" ") : expr),
    subtitle: series.metric.__name__ ? labels.map(([k, v]) => `${k}=${v}`).join(" ") : undefined,
    icon: { source: Icons.activity, tint: "orange" },
    section: "Result",
    keywords: labels.flatMap(([k, v]) => [k, v]),
    accessories: [
      ...(matrix ? [{ text: sparkline(series.values), tooltip: `${series.values.length} samples` }] : []),
      { tag: value, color: "orange" as const },
    ],
    detail: {
      markdown: `\`\`\`\n${metric}\n\`\`\``,
      stats: [{ label: matrix ? "Last value" : "Value", value }],
      metadata: [
        ...labels.map(([k, v]) => meta.text(k, v, { icon: Icons.tag })),
        meta.separator(),
        ...(at ? [meta.text("At", at.toLocaleString("en-GB"), { icon: Icons.clock })] : []),
        ...(matrix ? [meta.text("Samples", series.values.length)] : []),
      ],
    },
    actions,
  };
}

function resultItems(s: Server, expr: string, r: QueryResult): Item[] {
  const warnings: Item[] = r.warnings.map((w, i) => ({
    id: `warning:${i}`,
    title: w,
    icon: { source: Icons.info, tint: "yellow" },
    section: "Warnings",
    actions: [copy(w, "Copy Warning")],
  }));
  if (r.type === "scalar" || r.type === "string") {
    const value = r.type === "scalar" ? formatValue(r.value[1]) : r.value[1];
    return [...warnings, {
      id: "scalar",
      title: value,
      subtitle: r.type === "scalar" ? "Scalar" : "String",
      icon: { source: Icons.hash, tint: "orange" },
      section: "Result",
      detail: {
        stats: [{ label: r.type === "scalar" ? "Scalar" : "String", value }],
        markdown: `\`\`\`promql\n${expr}\n\`\`\``,
      },
      actions: [
        copy(r.value[1], "Copy Value"),
        open(graphUrl(s.base, expr), "Open in Prometheus", { shortcut: "<Ctrl>o" }),
      ],
    }];
  }
  if (!("series" in r)) return warnings;
  const sorted = sortSeries(r.series).slice(0, 500);
  return [...warnings, ...sorted.map((x, i) => seriesItem(s, expr, x, r.type === "matrix", i))];
}

/** The result of one expression, in its own view. */
function runView(s: Server, expr: string): ListSpec {
  let status = "";
  return list({
    title: expr,
    placeholder: "Filter series by label…",
    empty: { title: "Empty result", description: "No series match this expression right now", icon: Icons.activity },
    status: () => status,
    items: ({ signal }) =>
      guarded(async () => {
        const body = await promData(s, `/api/v1/query?query=${encodeURIComponent(expr)}`, signal);
        const result = parseQueryResult(body.data, body.warnings);
        save(expr);
        status = describe(result);
        return resultItems(s, expr, result);
      }, signal),
  });
}

const describe = (r: QueryResult) =>
  r.type === "vector" || r.type === "matrix"
    ? `${r.series.length} series · ${r.type}${r.series.length > 500 ? " · first 500 shown" : ""}`
    : r.type;

let summary = "";

export default list({
  placeholder: "PromQL: up == 0, rate(http_requests_total[5m])…",
  empty: {
    title: "Empty result",
    description: "The expression is valid but no series match it right now",
    icon: Icons.activity,
  },
  status: () => summary,
  async search(query, { preferences, signal }) {
    const expr = query.trim();
    return await guarded(async () => {
      const s = prometheus(preferences);
      if (!expr) {
        const past = await history();
        summary = `Prometheus at ${s.base.replace(/^https?:\/\//, "")}`;
        return [
          ...past.map((e) => exprItem(s, e, "", "History")),
          ...EXAMPLES.filter(([e]) => !past.includes(e)).map(([e, d]) => exprItem(s, e, d, "Examples")),
        ];
      }
      let body: { data: unknown; warnings: string[] };
      try {
        body = await promData(s, `/api/v1/query?query=${encodeURIComponent(expr)}`, signal);
      } catch (e) {
        if (signal.aborted) throw e;
        const message = e instanceof Error ? e.message : String(e);
        // A half-typed expression: say why, quietly.
        if (/parse error|unexpected|bad_data|invalid/i.test(message)) {
          summary = "Invalid expression";
          return [{
            id: "invalid",
            title: message.replace(/^.*?parse error:\s*/i, ""),
            subtitle: "Not a valid PromQL expression (yet)",
            icon: { source: Icons.info, tint: "gray" },
            detail: { markdown: `\`\`\`\n${message}\n\`\`\`` },
            actions: [copy(message, "Copy Error")],
          }];
        }
        throw e;
      }
      const result = parseQueryResult(body.data, body.warnings);
      if (result.type !== "vector" && result.type !== "matrix" || result.series.length) save(expr);
      summary = describe(result);
      return resultItems(s, expr, result);
    }, signal);
  },
});
