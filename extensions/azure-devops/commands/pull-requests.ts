import { type Action, action, Icons, list, refresh, submenu, toast, updateCommandMetadata } from "@backslash/api";
import { ado, type Auth, auth, countStatus, guardedSteps, me, projectPath, projects } from "../api.ts";
import { type PolicyEvaluation, prArtifactId, prItem, type Pull, type PullRequest, uniquePulls, vote } from "../lib.ts";

/** Policies take one call per pull request: only for the first ones. */
const ENRICH = 30;

async function withPolicies(a: Auth, pr: PullRequest, signal: AbortSignal): Promise<Pull> {
  const id = encodeURIComponent(prArtifactId(pr));
  const res = await ado<{ value: PolicyEvaluation[] }>(
    a,
    `/${encodeURIComponent(pr.repository.project.name)}/_apis/policy/evaluations?artifactId=${id}`,
    { signal, version: "7.1-preview.1" },
  ).catch(() => undefined);
  return { ...pr, policies: res?.value };
}

function voteActions(a: Auth, pr: PullRequest, meId: string): Action[] {
  const path = `/${encodeURIComponent(pr.repository.project.name)}/_apis/git/repositories/${pr.repository.id}` +
    `/pullrequests/${pr.pullRequestId}/reviewers/${meId}`;
  const cast = (value: number, title: string, options: { shortcut?: string; destructive?: boolean } = {}) =>
    action(title, async () => {
      await ado(a, path, { method: "PUT", body: { vote: value } });
      await toast(value === 0 ? "Vote reset" : `Voted “${vote(value).label}”`, {
        style: "success",
        message: `${pr.repository.name} !${pr.pullRequestId}`,
      });
      return refresh();
    }, { icon: vote(value).icon, ...options });
  return [
    cast(10, "Approve", { shortcut: "<Ctrl><Shift>a" }),
    submenu("Vote", [
      cast(10, "Approve"),
      cast(5, "Approve with Suggestions"),
      cast(-5, "Wait for Author"),
      cast(-10, "Reject", { destructive: true }),
      cast(0, "Reset Vote"),
    ], { icon: Icons.check, shortcut: "<Ctrl>v" }),
  ];
}

export default list({
  placeholder: "Filter pull requests by title, repository, author, branch…",
  filter: {
    options: [
      { value: "review", title: "To review" },
      { value: "mine", title: "Created by me" },
    ],
  },
  empty: { title: "No active pull request", description: "Nothing waits for you here.", icon: Icons.pullRequest },
  status: (items) => countStatus(items, "pull request"),
  items: ({ preferences, signal, filter }) =>
    guardedSteps(async function* () {
      const a = auth(preferences);
      const [user, list] = await Promise.all([me(a, signal), projects(a, signal)]);
      const who = filter === "mine" ? `searchCriteria.creatorId=${user.id}` : `searchCriteria.reviewerId=${user.id}`;
      const lists = await Promise.all(list.map((p) =>
        ado<{ value: PullRequest[] }>(
          a,
          `${projectPath(p)}/_apis/git/pullrequests?searchCriteria.status=active&${who}&$top=100`,
          { signal },
        ).then((r) => r.value).catch(() => [] as PullRequest[])
      ));
      let prs = uniquePulls(lists.flat());
      if (filter !== "mine") {
        prs = prs.filter((pr) => pr.createdBy.id !== user.id);
        updateCommandMetadata({ subtitle: prs.length ? `${prs.length} to review` : null }).catch(() => {});
      }
      const items = (all: Pull[]) =>
        all.map((pr) => prItem(a.org, pr, user.id, filter === "mine" ? [] : voteActions(a, pr, user.id)));
      yield items(prs);
      if (!prs.length) return;
      yield items(await Promise.all(prs.map((pr, i) => i < ENRICH ? withPolicies(a, pr, signal) : pr)));
    }),
});
