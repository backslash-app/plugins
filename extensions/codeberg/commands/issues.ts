import { list } from "@backslash/api";
import { countStatus, forgejo, guarded, token } from "../api.ts";
import { groupByRepo, type Issue, issueItem } from "../lib.ts";

const FILTERS: Record<string, string> = { assigned: "assigned", created: "created", mentioned: "mentioned" };

export default list({
  placeholder: "Filter issues by title, repository, label, author…",
  filter: {
    options: [
      { value: "assigned", title: "Assigned to me" },
      { value: "created", title: "Created by me" },
      { value: "mentioned", title: "Mentioning me" },
    ],
  },
  empty: { title: "No open issue", description: "Nothing matches this view.", icon: "bs-issue-open" },
  status: (items) => countStatus(items, "issue"),
  items: ({ preferences, signal, filter }) =>
    guarded(async () => {
      const t = token(preferences);
      const key = filter && FILTERS[filter] ? filter : "assigned";
      const issues = await forgejo<Issue[]>(
        t,
        `/repos/issues/search?type=issues&state=open&${FILTERS[key]}=true&limit=50`,
        { signal },
      );
      return groupByRepo(issues).map((i) => issueItem(i, i.repository.full_name));
    }),
});
