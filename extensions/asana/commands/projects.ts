import { type Context, Icons, list } from "@backslash/api";
import { asana, guarded, paged, PROJECT_FIELDS } from "../api.ts";
import type { Named, Project } from "../lib.ts";
import { projectItem } from "../views.ts";

let total = 0;

export default (ctx: Context) =>
  list({
    placeholder: "Filter projects by name, team, owner…",
    empty: { title: "No project", description: "Projects of your workspace show up here.", icon: Icons.project },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : `${total} project${total === 1 ? "" : "s"}`,
    items: ({ signal }) =>
      guarded(ctx.preferences, async (s) => {
        const [all, favorites] = await Promise.all([
          paged<Project>(
            s.token,
            `/projects?workspace=${s.workspace.gid}&archived=false&opt_fields=${PROJECT_FIELDS}`,
            1000,
            signal,
          ),
          asana<Named[]>(
            s.token,
            `/users/me/favorites?resource_type=project&workspace=${s.workspace.gid}&opt_fields=name`,
            { signal },
          ).catch(() => [] as Named[]),
        ]);
        total = all.length;
        const fav = new Map(favorites.map((f, i) => [f.gid, i]));
        return [...all]
          .sort((a, b) =>
            (fav.get(a.gid) ?? 1e9) - (fav.get(b.gid) ?? 1e9) ||
            (a.team?.name ?? "").localeCompare(b.team?.name ?? "") ||
            (b.modified_at ?? "").localeCompare(a.modified_at ?? "")
          )
          .map((p) => projectItem(s, p, ctx.preferences, fav.has(p.gid)));
      }, signal),
  });
