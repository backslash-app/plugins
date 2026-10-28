import { type Context, Icons, type Item, list } from "@backslash/api";
import { account, countStatus, guarded, jira, JiraError, sprintField } from "../api.ts";
import { asKey, FIELDS, type Issue, issueItem, jqlFor, searchIssues } from "../lib.ts";

export default (ctx: Context) =>
  list({
    placeholder: "Search issues by text, key (ENG-12) or JQL (project = ENG AND status = Done)…",
    empty: { title: "No issue found", icon: "bs-search" },
    status: (items) => countStatus(items, "issue"),
    search: (query, { preferences, signal }) =>
      guarded(async () => {
        const a = account(preferences);
        const sprint = await sprintField(a, signal);
        const key = asKey(query);
        const fields = sprint ? [...FIELDS, sprint] : FIELDS;
        try {
          // "ENG-12": that issue (in text search, "-" would mean NOT).
          const exact = key
            ? await jira<Issue>(a, `/rest/api/3/issue/${key}?fields=${fields.join(",")}`, { signal }).catch(() =>
              undefined
            )
            : undefined;
          const issues = exact
            ? [exact]
            : await searchIssues(a, jqlFor(query), { sprintField: sprint, max: 40, signal });
          const section = query.trim() ? undefined : "Recently viewed";
          return issues.map((issue) => issueItem(issue, ctx, { section, sprintField: sprint }));
        } catch (e) {
          // A JQL mistake is shown in the list, so the user can fix it while typing.
          if (e instanceof JiraError && e.status === 400) return [invalidJql(e.message, query)];
          throw e;
        }
      }),
  });

function invalidJql(message: string, query: string): Item {
  return {
    id: "error",
    title: "Jira could not run this query",
    subtitle: message,
    icon: { source: Icons.alert, tint: "orange" },
    detail: { markdown: `## Invalid JQL\n\n\`\`\`\n${query}\n\`\`\`\n\n${message}` },
  };
}
