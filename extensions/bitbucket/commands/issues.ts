import { Icons, type Item, list } from "@backslash/api";
import { all, auth, countStatus, guarded, me, recentRepos, workspaces } from "../api.ts";
import { type Issue, issueItem, q } from "../lib.ts";

const OPEN = '(state="new" OR state="open" OR state="on hold")';

let trackers = 0;

export default list({
  placeholder: "Filter issues by title, repository, kind, priority…",
  filter: {
    options: [
      { value: "assigned", title: "Assigned to me" },
      { value: "reported", title: "Reported by me" },
    ],
  },
  empty: {
    title: "No open issues",
    description: "Only repositories with Bitbucket's issue tracker turned on are searched.",
    icon: Icons.issue,
  },
  status: (items) =>
    items[0]?.id === "setup" || items[0]?.id === "no-tracker"
      ? (items[0].id === "setup" ? "Not connected" : "No issue tracker")
      : `${countStatus(items, "issue")} · ${trackers} tracker${trackers === 1 ? "" : "s"}`,
  items: ({ preferences, signal, filter }) =>
    guarded(async (): Promise<Item[]> => {
      const a = auth(preferences);
      const [user, slugs] = await Promise.all([me(a, signal), workspaces(a, preferences.workspaces, signal)]);
      const repos = (await recentRepos(a, slugs, 50, signal)).filter((r) => r.has_issues);
      trackers = repos.length;
      if (!repos.length) {
        return [{
          id: "no-tracker",
          title: "None of your recent repositories has an issue tracker",
          subtitle: "Repository settings → Issue tracker",
          icon: { source: Icons.info, tint: "blue" },
          detail: {
            markdown:
              "Bitbucket's own issue tracker is off by default; most teams use **Jira** instead.\n\nTo use it, open a repository's **Repository settings → Features → Issue tracker**.",
          },
          actions: [],
        }];
      }
      const who = filter === "reported" ? q("reporter.uuid", user.uuid) : q("assignee.uuid", user.uuid);
      const filterQ = encodeURIComponent(`${who} AND ${OPEN}`);
      const lists = await Promise.all(repos.map((r) =>
        all<Issue>(a, `/repositories/${r.full_name}/issues?q=${filterQ}&sort=-updated_on&pagelen=50`, 50, signal)
          .catch(() => [] as Issue[])
      ));
      const issues = lists.flat();
      // Repositories in order of their latest issue, issues newest first.
      const latest = new Map<string, string>();
      for (const i of issues) {
        const r = i.repository.full_name;
        if ((latest.get(r) ?? "") < i.updated_on) {
          latest.set(r, i.updated_on);
        }
      }
      return issues.sort((x, y) =>
        latest.get(y.repository.full_name)!.localeCompare(latest.get(x.repository.full_name)!) ||
        x.repository.full_name.localeCompare(y.repository.full_name) || y.updated_on.localeCompare(x.updated_on)
      ).map(issueItem);
    }),
});
