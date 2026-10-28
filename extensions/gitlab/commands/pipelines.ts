import { type Context, Icons, list } from "@backslash/api";
import { guarded, needToken, rest } from "../api.ts";
import { type Project, projectItem } from "../lib.ts";

/** How many projects get their last pipeline status (one request each). */
const WITH_STATUS = 15;

export default (ctx: Context) =>
  list({
    placeholder: "Pick a project to see its pipelines…",
    empty: { title: "No project", icon: Icons.activity },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : "Enter shows the project's pipelines",
    async *items({ preferences, signal }) {
      let token: string;
      let projects: Project[] = [];
      const first = await guarded(async () => {
        token = needToken(preferences);
        projects = await rest<Project[]>(
          token,
          "/projects?membership=true&order_by=last_activity_at&per_page=40&archived=false",
          { signal },
        );
        return projects.map((p) => toItem(p));
      });
      yield first;
      if (first[0]?.id === "setup" || !projects.length) return;
      // Then the status of the last pipeline of the most active projects.
      const latest = new Map<number, string>();
      await Promise.all(
        projects.slice(0, WITH_STATUS).map(async (p) => {
          const [last] = await rest<{ status: string }[]>(token, `/projects/${p.id}/pipelines?per_page=1`, { signal })
            .catch(() => []);
          if (last) latest.set(p.id, last.status);
        }),
      );
      yield projects.map((p) => toItem(p, latest.get(p.id)));

      function toItem(p: Project, pipeline?: string) {
        const item = projectItem(p, ctx, { pipeline });
        // Enter goes to the pipelines; the other project actions stay in Ctrl+K.
        const [openAction, pipelines, ...others] = item.actions ?? [];
        return { ...item, actions: [pipelines, openAction, ...others].filter(Boolean) };
      }
    },
  });
