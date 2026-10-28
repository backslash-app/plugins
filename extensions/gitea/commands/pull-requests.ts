import { list, updateCommandMetadata } from "@backslash/api";
import { api, countStatus, guardedSteps, type Server, server } from "../api.ts";

import { type CombinedStatus, groupByRepo, type Issue, issueItem, type Pull, type PullDetail } from "../lib.ts";

/** The server shown in the footer. */
let host = "";

const FILTERS: Record<string, string> = {
  review: "review_requested",
  created: "created",
  assigned: "assigned",
  mentioned: "mentioned",
};

/** Branches, diff size and CI come from one call per pull request: only the first ones. */
const ENRICH = 20;

async function enrich(t: Server, pr: Issue, signal: AbortSignal): Promise<Pull> {
  const base = `/repos/${pr.repository.full_name}`;
  const detail = await api<PullDetail>(t, `${base}/pulls/${pr.number}`, { signal }).catch(() => undefined);
  const ci = detail?.head.sha
    ? await api<CombinedStatus>(t, `${base}/commits/${detail.head.sha}/status`, { signal }).catch(() => undefined)
    : undefined;
  return { ...pr, detail, ci };
}

export default list({
  placeholder: "Filter pull requests by title, repository, author, branch…",
  filter: {
    options: [
      { value: "review", title: "Review requested" },
      { value: "created", title: "Created by me" },
      { value: "assigned", title: "Assigned" },
      { value: "mentioned", title: "Mentioning me" },
    ],
  },
  empty: { title: "Nothing here", description: "No open pull request matches.", icon: "bs-pr-open" },
  status: (items) => countStatus(items, "pull request", host),
  items: ({ preferences, signal, filter }) =>
    guardedSteps(async function* () {
      const t = server(preferences);
      host = t.host;
      const key = filter && FILTERS[filter] ? filter : "review";
      const found = await api<Issue[]>(
        t,
        `/repos/issues/search?type=pulls&state=open&${FILTERS[key]}=true&limit=50`,
        { signal },
      );
      if (key === "review") {
        updateCommandMetadata({ subtitle: found.length ? `${found.length} to review` : null }).catch(() => {});
      }
      const prs = groupByRepo(found);
      yield prs.map((pr) => issueItem(pr, pr.repository.full_name));
      const enriched = await Promise.all(
        prs.map((pr, i) => (i < ENRICH ? enrich(t, pr, signal) : Promise.resolve(pr as Pull))),
      );
      yield enriched.map((pr) => issueItem(pr, pr.repository.full_name));
    }),
});
