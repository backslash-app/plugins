import { type Context, list, updateCommandMetadata } from "@backslash/api";
import { type Issue, ISSUE_FIELDS, issueItem, linear, live, sortIssues } from "../lib.ts";

const FILTERS = {
  assigned: "{ assignee: { isMe: { eq: true } } }",
  created: "{ creator: { isMe: { eq: true } } }",
  subscribed: "{ subscribers: { isMe: { eq: true } } }",
};

const open = `state: { type: { nin: ["completed", "canceled"] } }`;

export default (ctx: Context) =>
  list({
    placeholder: "Filter issues by title, identifier, label, project…",
    filter: {
      options: [
        { value: "assigned", title: "Assigned to me" },
        { value: "created", title: "Created by me" },
        { value: "subscribed", title: "Subscribed" },
      ],
    },
    empty: { title: "No open issues here", icon: "bs-circle-check" },
    status: (items) => `${items.length} open issue${items.length === 1 ? "" : "s"}`,
    // Reloads after a change made from this list (status, priority…).
    items: ({ preferences, signal, filter }) =>
      live(async () => {
        const who = FILTERS[(filter ?? "assigned") as keyof typeof FILTERS] ?? FILTERS.assigned;
        const where = who.replace(/\}$/, `, ${open} }`);
        const data = await linear<{ issues: { nodes: Issue[] } }>(
          preferences.apiKey as string,
          `query { issues(first: 100, orderBy: updatedAt, filter: ${where}) { nodes { ${ISSUE_FIELDS} } } }`,
          {},
          signal,
        );
        const issues = sortIssues(data.issues.nodes);
        if ((filter ?? "assigned") === "assigned") {
          const started = issues.filter((i) => i.state.type === "started").length;
          updateCommandMetadata({ subtitle: started ? `${started} in progress` : null }).catch(() => {});
        }
        return issues.map((issue) => issueItem(issue, ctx, { section: issue.state.name }));
      }, signal),
  });
