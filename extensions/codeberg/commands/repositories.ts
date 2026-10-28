import { type Item, list, storage } from "@backslash/api";
import { forgejo, guarded, token } from "../api.ts";
import { type Repo, repoItem } from "../lib.ts";

let mine = 0;

export default list({
  placeholder: "Search Codeberg repositories, or browse yours…",
  empty: { title: "No repository found", icon: "bs-repo" },
  status: (items: Item[]) =>
    items[0]?.id === "setup"
      ? "Not connected"
      : items.every((i) => i.section === "Your Repositories")
      ? `${mine} of your repositories`
      : `${items.length} repositories`,
  search: (query, { preferences, signal }) =>
    guarded(async () => {
      const t = token(preferences);
      const q = query.trim();
      if (!q) {
        const repos = await forgejo<Repo[]>(t, "/user/repos?limit=50", { signal });
        mine = repos.length;
        await storage.set("mine", repos.map((r) => r.id)).catch(() => {});
        return [...repos].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
          .map((r) => repoItem(r, "Your Repositories"));
      }
      const [found, ids] = await Promise.all([
        forgejo<{ ok: boolean; data: Repo[] }>(
          t,
          `/repos/search?q=${encodeURIComponent(q)}&limit=30&sort=updated&order=desc`,
          {
            signal,
          },
        ),
        storage.get<number[]>("mine").catch(() => undefined),
      ]);
      const own = new Set(ids ?? []);
      // Yours first, then everyone's.
      return [...found.data].sort((a, b) => Number(own.has(b.id)) - Number(own.has(a.id)))
        .map((r) => repoItem(r, own.has(r.id) ? "Your Repositories" : "Codeberg"));
    }),
});
