import { type Context, list, updateCommandMetadata } from "@backslash/api";
import { countStatus, graphql, guarded, needToken } from "../api.ts";
import { type MergeRequest, MR_FIELDS, mrItem } from "../lib.ts";

/** Fields of `currentUser` for each filter. */
const CONNECTIONS: Record<string, string> = {
  review: "reviewRequestedMergeRequests",
  mine: "authoredMergeRequests",
  assigned: "assignedMergeRequests",
};

export default (ctx: Context) =>
  list({
    placeholder: "Filter merge requests by title, project, author, branch, label…",
    filter: {
      options: [
        { value: "review", title: "To review" },
        { value: "mine", title: "Mine" },
        { value: "assigned", title: "Assigned" },
      ],
    },
    empty: { title: "Nothing here", description: "No open merge request matches.", icon: "bs-pr-open" },
    status: (items) => countStatus(items, "merge request"),
    items: ({ preferences, signal, filter }) =>
      guarded(async () => {
        const key = filter && CONNECTIONS[filter] ? filter : "review";
        const data = await graphql<{ currentUser: Record<string, { nodes: MergeRequest[] }> | null }>(
          needToken(preferences),
          `query { currentUser { ${
            CONNECTIONS[key]
          }(state: opened, first: 50, sort: UPDATED_DESC) { nodes { ${MR_FIELDS} } } } }`,
          {},
          signal,
        );
        if (!data.currentUser) throw new Error("GitLab did not recognize the token's user");
        const mrs = data.currentUser[CONNECTIONS[key]].nodes;
        if (key === "review") {
          updateCommandMetadata({ subtitle: mrs.length ? `${mrs.length} to review` : null }).catch(() => {});
        }
        // Grouped by project, the most recently updated project first.
        const order = new Map<string, number>();
        mrs.forEach((mr, i) => order.has(mr.project.fullPath) || order.set(mr.project.fullPath, i));
        return [...mrs]
          .sort((a, b) => order.get(a.project.fullPath)! - order.get(b.project.fullPath)!)
          .map((mr) => mrItem(mr, ctx));
      }),
  });
