import { Icons, type Item, list } from "@backslash/api";
import { HOME, loadAll, variables } from "../collections.ts";
import { parseFolders } from "../lib.ts";
import { deniedItem, depthOf, EMPTY, type Prefs, requestItem, where } from "../views.ts";

// Every request of every collection, grouped by collection; Enter sends it.
export default list({
  placeholder: "Filter requests by name, method, URL or collection…",
  empty: EMPTY,
  status: (items) => {
    const n = items.filter((i) => !i.id?.startsWith("denied:")).length;
    return `${n} request${n === 1 ? "" : "s"}`;
  },
  async items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const { collections, denied } = await loadAll(parseFolders(prefs.folders, HOME), depthOf(prefs), signal);
    const items: Item[] = [];
    for (const c of collections) {
      const { env, vars } = await variables(c);
      const section = `${c.name}${env ? ` · ${env}` : ""} — ${where(c)}`;
      if (c.error) {
        items.push({
          id: `error:${c.path}`,
          title: `${c.name} can't be read`,
          subtitle: c.error,
          section,
          icon: { source: Icons.alert, tint: "red" },
        });
      }
      items.push(...c.requests.map((e) => requestItem(c, e, vars, env, section)));
    }
    return [...items, ...denied.map(deniedItem)];
  },
});
