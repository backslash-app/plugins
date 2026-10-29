import { Icons, list } from "@backslash/api";
import { type FigmaAuth, figmaAuth, figmaIndex, indexKey, recentFiles, SetupError } from "../api.ts";
import { sortFiles } from "../lib.ts";
import { fileItem, indexed, reloadAction, setupItem } from "../views.ts";

let status = "";

export default list({
  placeholder: "Search Figma files by name, project or team…",
  status: () => status,
  empty: {
    title: "No Figma file",
    description: "Check the team IDs in Settings, or create a file in Figma",
    icon: Icons.palette,
  },
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
    yield* indexed(key, () => figmaIndex(a, signal), async ({ files, projects }) => {
      const recent = await recentFiles();
      status = `${files.length} files in ${projects.length} projects`;
      return sortFiles(files, recent).map((f) => {
        const item = fileItem(auth, f, recent);
        return { ...item, actions: [...(item.actions ?? []), reloadAction(key)] };
      });
    }, signal);
  },
});
