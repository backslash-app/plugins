import { type Context, list, updateCommandMetadata } from "@backslash/api";
import { account, countStatus, guarded, sprintField } from "../api.ts";
import { categoryName, issueItem, live, searchIssues, sortIssues } from "../lib.ts";

const JQL: Record<string, string> = {
  assigned: "assignee = currentUser() AND resolution = Unresolved",
  reported: "reporter = currentUser() AND resolution = Unresolved",
  watching: "watcher = currentUser() AND resolution = Unresolved",
};

export default (ctx: Context) =>
  list({
    placeholder: "Filter issues by summary, key, status, project, sprint, label…",
    filter: {
      options: [
        { value: "assigned", title: "Assigned to me" },
        { value: "reported", title: "Reported by me" },
        { value: "watching", title: "Watching" },
      ],
    },
    empty: { title: "No unresolved issues here", icon: "bs-circle-check" },
    status: (items) => countStatus(items, "unresolved issue"),
    // Reloads after a change made from this list or an issue page (status, assignee).
    items: ({ preferences, signal, filter }) =>
      live(() =>
        guarded(async () => {
          const a = account(preferences);
          const key = filter && JQL[filter] ? filter : "assigned";
          const sprint = await sprintField(a, signal);
          const issues = sortIssues(
            await searchIssues(a, `${JQL[key]} ORDER BY updated DESC`, { sprintField: sprint, signal }),
          );
          if (key === "assigned") {
            const started = issues.filter((i) => i.fields.status.statusCategory.key === "indeterminate").length;
            const subtitle = started ? `${started} in progress` : issues.length ? `${issues.length} to do` : null;
            updateCommandMetadata({ subtitle }).catch(() => {});
          }
          return issues.map((issue) => issueItem(issue, ctx, { section: categoryName(issue), sprintField: sprint }));
        }), signal),
  });
