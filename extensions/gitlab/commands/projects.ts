import { type Context, list } from "@backslash/api";
import { countStatus, guarded, needToken, rest } from "../api.ts";
import { type Project, projectItem } from "../lib.ts";

export default (ctx: Context) =>
  list({
    placeholder: "Search GitLab projects…",
    empty: { title: "No project found", icon: "bs-repo" },
    status: (items) => countStatus(items, "project"),
    search: (query, { preferences, signal }) =>
      guarded(async () => {
        const token = needToken(preferences);
        const q = query.trim();
        const search = q ? `&search=${encodeURIComponent(q)}` : "";
        const mine = rest<Project[]>(
          token,
          `/projects?membership=true&order_by=last_activity_at&per_page=30${search}`,
          { signal },
        );
        // Typing also searches every public project, below yours.
        const others = q.length >= 2
          ? rest<Project[]>(
            token,
            `/projects?search=${encodeURIComponent(q)}&search_namespaces=true&order_by=last_activity_at&per_page=20`,
            { signal },
          )
          : Promise.resolve([]);
        const [own, all] = await Promise.all([mine, others]);
        const seen = new Set(own.map((p) => p.id));
        return [
          ...own.map((p) => projectItem(p, ctx, { section: q ? "Your projects" : "Recently active" })),
          ...all.filter((p) => !seen.has(p.id)).map((p) => projectItem(p, ctx, { section: "All projects" })),
        ];
      }),
  });
