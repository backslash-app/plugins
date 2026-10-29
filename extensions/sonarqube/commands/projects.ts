import { action, copy, detail, Icons, list, open, refresh, updateCommandMetadata } from "@backslash/api";
import {
  type Account,
  account,
  gateConditions,
  guarded,
  guardedSteps,
  hotspots,
  measures,
  newIssues,
  projects,
} from "../api.ts";
import {
  dashboardUrl,
  gateMarkdown,
  GATES,
  hotspotItem,
  hotspotsUrl,
  issueItem,
  issuesUrl,
  type Measures,
  parseMeasures,
  type Project,
  projectItem,
  projectMetadata,
  projectStats,
  sortHotspots,
  sortIssues,
  sortProjects,
} from "../lib.ts";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function issuesView(a: Account, p: Project) {
  let total = 0;
  return list({
    title: `${p.name}: new issues`,
    placeholder: "Filter new issues by message, file, rule…",
    empty: { title: "No new issue", description: "The new code of this project is clean.", icon: Icons.check },
    status: (items) =>
      items[0]?.id === "setup"
        ? "Not connected"
        : total > items.length
        ? `${items.length} of ${total} new issues`
        : plural(items.length, "new issue"),
    actions: [open(issuesUrl(a.base, p.key), "Open in Browser")],
    items: ({ signal }) =>
      guarded(async () => {
        const r = await newIssues(a, p.key, signal);
        total = r.total;
        return sortIssues(r.issues).map((i) => issueItem(a.base, i, r.components));
      }),
  });
}

function hotspotsView(a: Account, p: Project) {
  let total = 0;
  return list({
    title: `${p.name}: security hotspots`,
    placeholder: "Filter hotspots by message, file, category…",
    empty: {
      title: "No hotspot to review",
      description: "Every security hotspot has been reviewed.",
      icon: Icons.shield,
    },
    status: (items) =>
      items[0]?.id === "setup"
        ? "Not connected"
        : total > items.length
        ? `${items.length} of ${total} to review`
        : `${items.length} to review`,
    actions: [open(hotspotsUrl(a.base, p.key), "Open in Browser")],
    items: ({ signal }) =>
      guarded(async () => {
        const r = await hotspots(a, p.key, signal);
        total = r.total;
        return sortHotspots(r.hotspots).map((h) => hotspotItem(a.base, h, r.components));
      }),
  });
}

function gateView(a: Account, p: Project, m: Measures | undefined) {
  const g = GATES[m?.gate ?? "NONE"];
  return detail({
    title: p.name,
    stats: projectStats(m),
    async markdown({ signal }) {
      const conditions = await gateConditions(a, p.key, signal);
      return `# ${p.name}\n\nQuality gate: **${g.label}**\n\n${gateMarkdown(conditions)}`;
    },
    metadata: projectMetadata(a.base, p, m),
    status: `Quality gate ${g.label.toLowerCase()}`,
    actions: [
      open(dashboardUrl(a.base, p.key), "Open in Browser"),
      action("Show New Issues", () => issuesView(a, p), { icon: Icons.issue, shortcut: "<Ctrl>i" }),
      action("Show Security Hotspots", () => hotspotsView(a, p), { icon: Icons.shield, shortcut: "<Ctrl>h" }),
      copy(p.key, "Copy Project Key", { icon: Icons.key }),
    ],
  });
}

let summary = "";

export default list({
  placeholder: "Filter projects by name, key, tag…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "failing", title: "Failing" },
      { value: "favorites", title: "Favorites" },
    ],
    default: "all",
  },
  empty: { title: "No projects", description: "Nothing matches this filter.", icon: Icons.shield },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
  items: ({ preferences, signal, filter }) =>
    guardedSteps(async function* () {
      const a = account(preferences);
      summary = "";
      let list = await projects(a, signal);
      if (filter === "favorites") list = list.filter((p) => p.isFavorite);
      const extra = (p: Project, m?: Measures) => [
        action("Show New Issues", () => issuesView(a, p), { icon: Icons.issue, shortcut: "<Ctrl>i" }),
        action("Show Security Hotspots", () => hotspotsView(a, p), { icon: Icons.shield, shortcut: "<Ctrl>h" }),
        action("Show Quality Gate", () => gateView(a, p, m), { icon: Icons.check, shortcut: "<Ctrl>g" }),
        action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ];
      if (filter !== "failing") yield list.map((p) => projectItem(a.base, p, undefined, extra(p)));
      const byKey = parseMeasures(await measures(a, list.map((p) => p.key), signal));
      const failing = list.filter((p) => byKey.get(p.key)?.gate === "ERROR" || byKey.get(p.key)?.gate === "WARN");
      summary = [plural(list.length, "project"), failing.length ? `${failing.length} failing` : ""].filter(Boolean)
        .join(" · ");
      if (filter === "all" || !filter) {
        updateCommandMetadata({ subtitle: failing.length ? `${failing.length} failing` : null }).catch(() => {});
      }
      const shown = filter === "failing" ? failing : list;
      yield sortProjects(shown, byKey).map((p) => projectItem(a.base, p, byKey.get(p.key), extra(p, byKey.get(p.key))));
    }),
});
