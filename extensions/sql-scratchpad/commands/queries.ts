import { type Context, Icons, type Item, list } from "@backslash/api";
import { connectionsOf, loadQueries, type Prefs } from "../system.ts";
import { live, newQueryAction, openFolderAction, queryItem, setupItem } from "../views.ts";

// Saved queries grouped by connection; Enter runs one, read-only unless it changes data (then it asks).
export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  return list({
    placeholder: "Filter saved queries…",
    empty: {
      title: "No saved queries",
      description: "Press Ctrl+N to write one; they are .sql files in ~/.local/share/sql-scratchpad",
      icon: Icons.database,
    },
    status: (items) => {
      const n = items.filter((i) => i.id?.startsWith("query:")).length;
      return `${n} quer${n === 1 ? "y" : "ies"} · read-only unless confirmed`;
    },
    actions: [newQueryAction(prefs), openFolderAction()],
    // Reloads after a save, a duplicate or a deletion made from this list.
    items: ({ signal }) =>
      live(async () => {
        const { connections, errors } = connectionsOf(prefs);
        const items: Item[] = (await loadQueries()).map((q) => queryItem(q, prefs));
        if (!connections.length || errors.length) items.unshift(setupItem(errors));
        return items;
      }, signal),
  });
};
