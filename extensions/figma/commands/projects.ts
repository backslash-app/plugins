import { Icons, list } from "@backslash/api";
import { type FigmaAuth, figmaAuth, figmaIndex, indexKey, SetupError } from "../api.ts";
import { indexed, projectItem, reloadAction, setupItem } from "../views.ts";

let status = "";

export default list({
  placeholder: "Filter projects…",
  status: () => status,
  empty: { title: "No project", description: "Check the team IDs in Settings", icon: Icons.folder },
  async *items({ preferences, signal }) {
    let a: FigmaAuth;
    try {
      a = figmaAuth(preferences);
    } catch (e) {
      if (e instanceof SetupError) {
        yield [setupItem(e)];
        return;
      }
      throw e;
    }
    const auth = { tool: "figma" as const, a };
    const key = await indexKey("figma", a);
    yield* indexed(key, () => figmaIndex(a, signal), ({ projects, files }) => {
      const teams = new Set(projects.map((p) => p.teamId)).size;
      status = `${projects.length} projects in ${teams} team${teams === 1 ? "" : "s"}`;
      const sorted = [...projects].sort((x, y) =>
        x.team.localeCompare(y.team) || (y.modified ?? 0) - (x.modified ?? 0)
      );
      return Promise.resolve(sorted.map((p) => {
        const item = projectItem(auth, p, files);
        return { ...item, actions: [...(item.actions ?? []), reloadAction(key)] };
      }));
    }, signal);
  },
});
