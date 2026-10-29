import { Icons, list } from "@backslash/api";
import { countStatus, guarded, paged, token } from "../api.ts";
import { type Page, type Repo, repoItem, REPOS_QUERY } from "../lib.ts";

export default list({
  placeholder: "Filter repositories by name or description…",
  empty: {
    title: "No repositories",
    description: "Create one on git.sr.ht, or push to git@git.sr.ht:~you/name.",
    icon: Icons.repository,
  },
  status: (items) => countStatus(items, "repository", "repositories"),
  items: ({ preferences, signal }) =>
    guarded(async () => {
      const t = token(preferences);
      const repos = await paged<Repo, { me: { repositories: Page<Repo> } }>(
        t,
        "git",
        REPOS_QUERY,
        (d) => d.me.repositories,
        5,
        {},
        signal,
      );
      return repos.sort((a, b) => b.updated.localeCompare(a.updated)).map(repoItem);
    }),
});
