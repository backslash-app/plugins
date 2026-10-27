import { type Context, list } from "@backslash/api";
import { type Issue, ISSUE_FIELDS, issueItem, linear } from "../lib.ts";
import { statusPicker } from "../statuses.ts";

export default (ctx: Context) =>
  list({
    placeholder: "Search issues by title, identifier or text…",
    empty: { title: "Type to search Linear" },
    async search(query, { preferences, signal }) {
      if (query.trim().length < 2) return [];
      const data = await linear<{ searchIssues: { nodes: Issue[] } }>(
        preferences.apiKey as string,
        `query($term: String!) { searchIssues(term: $term, first: 30) { nodes { ${ISSUE_FIELDS} } } }`,
        { term: query.trim() },
        signal,
      );
      return data.searchIssues.nodes.map((issue) => issueItem(issue, { moveTo: (i) => statusPicker(i, ctx) }));
    },
  });
