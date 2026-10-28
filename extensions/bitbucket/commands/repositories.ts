import { type Item, list } from "@backslash/api";
import { all, auth, guarded, recentRepos, workspaces } from "../api.ts";
import { q, type Repo, repoItem } from "../lib.ts";

export default list({
  placeholder: "Search repositories of your workspaces…",
  empty: { title: "No repository found", icon: "bs-repo" },
  status: (items: Item[]) =>
    items[0]?.id === "setup" ? "Not connected" : `${items.length} repositor${items.length === 1 ? "y" : "ies"}`,
  search: (query, { preferences, signal }) =>
    guarded(async () => {
      const a = auth(preferences);
      const slugs = await workspaces(a, preferences.workspaces, signal);
      const text = query.trim();
      let repos: Repo[];
      if (!text) {
        repos = await recentRepos(a, slugs, 30, signal);
      } else {
        const filter = encodeURIComponent(
          `${q("name", text).replace("=", "~")} OR ${q("description", text).replace("=", "~")}`,
        );
        const lists = await Promise.all(slugs.map((ws) =>
          all<Repo>(a, `/repositories/${encodeURIComponent(ws)}?q=${filter}&sort=-updated_on&pagelen=30`, 30, signal)
            .catch(() => [] as Repo[])
        ));
        repos = lists.flat();
      }
      const multi = slugs.length > 1;
      return repos.sort((x, y) =>
        y.updated_on.localeCompare(x.updated_on)
      )
        .map((r) => repoItem(r, multi ? (r.workspace?.name ?? r.full_name.split("/")[0]) : undefined));
    }),
});
