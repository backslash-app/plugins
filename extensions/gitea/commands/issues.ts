import { list } from "@backslash/api";
import { api, countStatus, guarded, server } from "../api.ts";

import { groupByRepo, type Issue, issueItem } from "../lib.ts";

/** The server shown in the footer. */
let host = "";

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
  status: (items) => countStatus(items, "issue", host),
  items: ({ preferences, signal, filter }) =>
    guarded(async () => {
      const t = server(preferences);
      host = t.host;
      const key = filter && FILTERS[filter] ? filter : "assigned";
      const issues = await api<Issue[]>(
        t,
        `/repos/issues/search?type=issues&state=open&${FILTERS[key]}=true&limit=50`,
        { signal },
      );
      return groupByRepo(issues).map((i) => issueItem(i, i.repository.full_name));
    }),
});
