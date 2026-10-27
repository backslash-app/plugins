import { type Context, list } from "@backslash/api";
import { type Issue, ISSUE_FIELDS, issueItem, linear, live, sortIssues } from "../lib.ts";
import { statusPicker } from "../statuses.ts";

const QUERY = `query { viewer { assignedIssues(first: 100, orderBy: updatedAt,
  filter: { state: { type: { nin: ["completed", "canceled"] } } }) { nodes { ${ISSUE_FIELDS} } } } }`;

export default (ctx: Context) =>
  list({
    placeholder: "Filter your issues…",
    empty: { title: "No open issues assigned to you", icon: "🎉" },
    // Reloads after a status change made from this list.
    items: ({ preferences, signal }) =>
      live(async () => {
        const data = await linear<{ viewer: { assignedIssues: { nodes: Issue[] } } }>(
          preferences.apiKey as string,
          QUERY,
          {},
          signal,
        );
        return sortIssues(data.viewer.assignedIssues.nodes).map((issue) =>
          issueItem(issue, { section: issue.state.name, moveTo: (i) => statusPicker(i, ctx) })
        );
      }, signal),
  });
