import { list, updateCommandMetadata } from "@backslash/api";
import { all, auth, bitbucket, countStatus, guardedSteps, me, recentRepos, workspaces } from "../api.ts";
import { type BuildStatus, prItem, type Pull, type PullRequest, q, uniquePulls } from "../lib.ts";

/** Reviewers, approvals and builds take two calls per pull request: only the first ones. */
const ENRICH = 25;
/** Pull requests to review are looked up in the most recently updated repositories. */
const REPOS = 25;

async function enrich(a: ReturnType<typeof auth>, pr: PullRequest, signal: AbortSignal): Promise<Pull> {
  const base = `/repositories/${pr.destination.repository.full_name}/pullrequests/${pr.id}`;
  const [full, statuses] = await Promise.all([
    bitbucket<PullRequest>(a, base, signal).catch(() => pr),
    all<BuildStatus>(a, `${base}/statuses?pagelen=25`, 25, signal).catch(() => undefined),
  ]);
  return { ...pr, ...full, statuses };
}

export default list({
  placeholder: "Filter pull requests by title, repository, author, branch…",
  filter: {
    options: [
      { value: "review", title: "To review" },
      { value: "mine", title: "Opened by me" },
    ],
  },
  empty: { title: "Nothing here", description: "No open pull request matches.", icon: "bs-pr-open" },
  status: (items) => countStatus(items, "pull request"),
  items: ({ preferences, signal, filter }) =>
    guardedSteps(async function* () {
      const a = auth(preferences);
      const [user, slugs] = await Promise.all([me(a, signal), workspaces(a, preferences.workspaces, signal)]);
      const key = filter === "mine" ? "mine" : "review";
      let found: PullRequest[];
      if (key === "mine") {
        const lists = await Promise.all(slugs.map((ws) =>
          all<PullRequest>(
            a,
            `/workspaces/${encodeURIComponent(ws)}/pullrequests/${encodeURIComponent(user.uuid)}?state=OPEN&pagelen=50`,
            100,
            signal,
          ).catch(() => [] as PullRequest[])
        ));
        found = lists.flat();
      } else {
        const repos = await recentRepos(a, slugs, REPOS, signal);
        const filter = encodeURIComponent(`${q("reviewers.uuid", user.uuid)} AND state="OPEN"`);
        const lists = await Promise.all(repos.map((r) =>
          all<PullRequest>(a, `/repositories/${r.full_name}/pullrequests?q=${filter}&pagelen=50`, 50, signal)
            .catch(() => [] as PullRequest[])
        ));
        found = lists.flat();
        updateCommandMetadata({ subtitle: found.length ? `${found.length} to review` : null }).catch(() => {});
      }
      const prs = uniquePulls(found);
      const items = (list: Pull[]) =>
        list.map((pr) => prItem(pr, pr.destination.repository.full_name));
      yield items(prs);
      const enriched = await Promise.all(prs.map((pr, i) => (i < ENRICH ? enrich(a, pr, signal) : pr)));
      yield items(enriched);
    }),
});
