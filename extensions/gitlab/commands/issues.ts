import { type Context, list, updateCommandMetadata } from "@backslash/api";
import { countStatus, guarded, needToken, rest } from "../api.ts";
import { type Issue, issueItem, issueProject } from "../lib.ts";

const SCOPES: Record<string, string> = { assigned: "assigned_to_me", created: "created_by_me" };

export default (ctx: Context) =>
  list({
    placeholder: "Filter issues by title, project, label, milestone…",
    filter: {
      options: [
        { value: "assigned", title: "Assigned to me" },
        { value: "created", title: "Created by me" },
      ],
    },
    empty: { title: "No open issues here", icon: "bs-issue-open" },
    status: (items) => countStatus(items, "open issue"),
    items: ({ preferences, signal, filter }) =>
      guarded(async () => {
        const key = filter && SCOPES[filter] ? filter : "assigned";
        const issues = await rest<Issue[]>(
          needToken(preferences),
          `/issues?scope=${SCOPES[key]}&state=opened&order_by=updated_at&per_page=60&with_labels_details=true`,
          { signal },
        );
        if (key === "assigned") {
          updateCommandMetadata({ subtitle: issues.length ? `${issues.length} assigned` : null }).catch(() => {});
        }
        const order = new Map<string, number>();
        issues.forEach((issue, i) => order.has(issueProject(issue)) || order.set(issueProject(issue), i));
        return [...issues]
          .sort((a, b) => order.get(issueProject(a))! - order.get(issueProject(b))!)
          .map((issue) => issueItem(issue, ctx));
      }),
  });
