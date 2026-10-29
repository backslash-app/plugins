import { copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { guarded, promData, prometheus, type Server } from "../api.ts";
import { duration, graphUrl, parseRules, type Rule, RULE_STATES, seconds, since, sortRules } from "../lib.ts";

function ruleItem(s: Server, r: Rule): Item {
  const look = RULE_STATES[r.state] ?? RULE_STATES.inactive;
  const broken = r.health === "err";
  const labels = Object.entries(r.labels);
  const annotations = Object.entries(r.annotations);
  return {
    id: `${r.file}|${r.group}|${r.name}|${r.query}`,
    title: r.name,
    subtitle: r.annotations.summary ?? r.query,
    icon: {
      source: broken
        ? Icons.alert
        : r.type === "recording"
        ? Icons.database
        : r.state === "inactive"
        ? Icons.done
        : Icons.bell,
      tint: broken ? "red" : look.color,
    },
    section: broken && r.state === "inactive" ? "Broken" : r.type === "recording" ? "Recording" : look.title,
    keywords: [r.group, r.file, r.query, r.state, ...labels.flatMap(([k, v]) => [k, v])],
    accessories: [
      ...(broken ? [{ tag: "Error", color: "red" as const, tooltip: r.lastError }] : []),
      ...(r.active ? [{ text: `${r.active}`, icon: Icons.bell, tooltip: "Active alerts" }] : []),
      ...(r.labels.severity ? [{ tag: r.labels.severity }] : []),
      { text: r.group, tooltip: "Group" },
    ],
    detail: {
      markdown: [
        `\`\`\`promql\n${r.query}\n\`\`\``,
        r.lastError ? `**Last error**\n\n\`\`\`\n${r.lastError}\n\`\`\`` : "",
        ...annotations.map(([k, v]) => `**${k}**: ${v}`),
      ].filter(Boolean).join("\n\n"),
      metadata: [
        meta.text("State", look.title, { icon: Icons.dot, color: look.color }),
        meta.text("Health", r.health === "ok" ? "OK" : r.health, { color: broken ? "red" : "green" }),
        meta.text("Group", r.group, { icon: Icons.layers }),
        ...(r.file ? [meta.text("File", r.file, { icon: Icons.file })] : []),
        ...(r.type === "alerting" && r.duration
          ? [meta.text("For", duration(r.duration * 1000), { icon: Icons.timer })]
          : []),
        ...(r.lastEvaluation ? [meta.text("Evaluated", `${since(r.lastEvaluation)} ago`, { icon: Icons.clock })] : []),
        ...(r.evaluationTime !== undefined ? [meta.text("Evaluation time", seconds(r.evaluationTime))] : []),
        ...(labels.length ? [meta.separator(), ...labels.map(([k, v]) => meta.text(k, v, { icon: Icons.tag }))] : []),
      ],
    },
    actions: [
      open(graphUrl(s.base, r.query), "Run Query in Prometheus"),
      open(
        `${s.base}/${r.type === "alerting" ? "alerts" : "rules"}?search=${encodeURIComponent(r.name)}`,
        "Open Rule in Prometheus",
        {
          shortcut: "<Ctrl>o",
        },
      ),
      copy(r.query, "Copy Query", { shortcut: "<Ctrl>period", section: "Copy" }),
      copy(r.name, "Copy Name", { section: "Copy" }),
      ...(r.lastError ? [copy(r.lastError, "Copy Error", { section: "Copy" })] : []),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter rules by name, group, query, label…",
  filter: {
    options: [
      { value: "alerting", title: "Alerting" },
      { value: "active", title: "Firing & Pending" },
      { value: "recording", title: "Recording" },
      { value: "all", title: "All" },
    ],
    default: "alerting",
  },
  empty: {
    title: "No rule here",
    description: "Nothing in this view of the rules Prometheus evaluates",
    icon: Icons.check,
  },
  status: () => summary,
  items: ({ preferences, filter, signal }) =>
    guarded(async () => {
      const s = prometheus(preferences);
      const { data } = await promData(s, "/api/v1/rules", signal);
      const rules = sortRules(parseRules(data));
      const count = (state: string) => rules.filter((r) => r.state === state).length;
      const broken = rules.filter((r) => r.health === "err").length;
      summary = [
        `${count("firing")} firing`,
        `${count("pending")} pending`,
        broken ? `${broken} broken` : "",
        `${rules.length} rules`,
      ].filter(Boolean).join(" · ");
      const view = filter ?? "alerting";
      const shown = rules.filter((r) =>
        view === "all" ||
        (view === "alerting" && r.type === "alerting") ||
        (view === "recording" && r.type === "recording") ||
        (view === "active" && (r.state === "firing" || r.state === "pending"))
      );
      return shown.map((r) => ruleItem(s, r));
    }, signal),
});
