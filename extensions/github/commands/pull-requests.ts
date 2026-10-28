import { type Context, list, updateCommandMetadata } from "@backslash/api";
import { graphql, needToken } from "../api.ts";
import { PR_FIELDS, prItem, type PullRequest } from "../prs.ts";

const QUERIES: Record<string, string> = {
  review: "is:pr is:open archived:false review-requested:@me",
  mine: "is:pr is:open archived:false author:@me",
  assigned: "is:pr is:open archived:false assignee:@me",
  merged: "is:pr is:merged author:@me",
};

export default (ctx: Context) =>
  list({
    placeholder: "Filter pull requests by title, repository, author, branch…",
    filter: {
      options: [
        { value: "review", title: "To review" },
        { value: "mine", title: "Opened by me" },
        { value: "assigned", title: "Assigned" },
        { value: "merged", title: "Recently merged" },
      ],
    },
    empty: { title: "Nothing here", description: "No pull request matches.", icon: "bs-pr-open" },
    status: (items) => `${items.length} pull request${items.length === 1 ? "" : "s"}`,
    async items({ preferences, signal, filter }) {
      const key = filter ?? "review";
      const t = await needToken(preferences);
      const data = await graphql<{ search: { nodes: PullRequest[] } }>(
        t,
        `query($q: String!) { search(query: $q, type: ISSUE, first: 40) { nodes { ${PR_FIELDS} } } }`,
        { q: `${QUERIES[key] ?? QUERIES.review} sort:updated-desc` },
        signal,
      );
      const prs = data.search.nodes.filter((n) => n && n.number);
      if (key === "review") {
        updateCommandMetadata({ subtitle: prs.length ? `${prs.length} to review` : null }).catch(() => {});
      }
      return prs.map((pr) => prItem(pr, ctx, pr.repository.nameWithOwner));
    },
  });
