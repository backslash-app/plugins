import { type Context, list, updateCommandMetadata } from "@backslash/api";
import { account, guarded, sentry } from "../api.ts";
import { type Issue, issueItem } from "../lib.ts";

const QUERIES: Record<string, string> = {
  unresolved: "is:unresolved",
  review: "is:unresolved is:for_review",
  mine: "is:unresolved assigned:me",
};

const LIMIT = 50;

export default (ctx: Context) =>
  list({
    placeholder: "Filter issues by title, project, short ID, culprit…",
    filter: {
      options: [
        { value: "unresolved", title: "Unresolved" },
        { value: "review", title: "For review" },
        { value: "mine", title: "Assigned to me" },
      ],
    },
    empty: { title: "No issue here", description: "Nothing matches in the last 14 days.", icon: "bs-circle-check" },
    status: (items) =>
      items[0]?.id === "setup"
        ? "Not connected"
        : `${items.length === LIMIT ? `${LIMIT}+` : items.length} issue${items.length === 1 ? "" : "s"} · last 14 days`,
    items: ({ preferences, signal, filter }) =>
      guarded(async () => {
        const a = account(preferences);
        const key = filter && QUERIES[filter] ? filter : "unresolved";
        const params = new URLSearchParams({
          query: QUERIES[key],
          statsPeriod: "14d",
          sort: "date",
          limit: String(LIMIT),
          project: "-1",
        });
        const issues = await sentry<Issue[]>(a, `/organizations/${a.org}/issues/?${params}`, { signal });
        if (key === "unresolved") {
          const n = issues.length === LIMIT ? `${LIMIT}+` : String(issues.length);
          updateCommandMetadata({ subtitle: issues.length ? `${n} unresolved` : null }).catch(() => {});
        }
        // By project, the one with the most recent event first.
        const order = new Map<string, number>();
        issues.forEach((issue, i) => order.has(issue.project.slug) || order.set(issue.project.slug, i));
        return [...issues]
          .sort((x, y) => order.get(x.project.slug)! - order.get(y.project.slug)!)
          .map((issue) => issueItem(issue, ctx));
      }),
  });
