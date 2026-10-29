import { Icons, list } from "@backslash/api";
import { indexKey, type PenpotAuth, penpotAuth, penpotIndex, recentFiles, SetupError } from "../api.ts";
import { sortFiles } from "../lib.ts";
import { fileItem, indexed, projectItem, reloadAction, setupItem } from "../views.ts";

let status = "";

export default list({
  placeholder: "Search Penpot files and projects…",
  filter: { options: [{ value: "files", title: "Files" }, { value: "projects", title: "Projects" }], default: "files" },
  status: () => status,
  empty: { title: "Nothing in Penpot yet", description: "Create a file in Penpot first", icon: Icons.layers },
  async *items({ preferences, filter, signal }) {
    let a: PenpotAuth;
    try {
      a = penpotAuth(preferences);
    } catch (e) {
      if (e instanceof SetupError) {
        yield [setupItem(e)];
        return;
      }
      throw e;
    }
    const auth = { tool: "penpot" as const, a };
    const key = await indexKey("penpot", a);
    yield* indexed(key, () => penpotIndex(a, signal), async ({ projects, files }) => {
      status = `${files.length} files in ${projects.length} projects · ${new URL(a.base).host}`;
      const reload = reloadAction(key);
      if (filter === "projects") {
        return projects.map((p) => {
          const item = projectItem(auth, p, files);
          return { ...item, actions: [...(item.actions ?? []), reload] };
        });
      }
      const recent = await recentFiles();
      return sortFiles(files, recent).map((f) => {
        const item = fileItem(auth, f, recent);
        return { ...item, actions: [...(item.actions ?? []), reload] };
      });
    }, signal);
  },
});
