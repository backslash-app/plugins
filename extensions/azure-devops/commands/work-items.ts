import { action, Icons, list, refresh, submenu, toast, updateCommandMetadata } from "@backslash/api";
import { ado, type Auth, auth, countStatus, guarded, stateCategories, typeStates } from "../api.ts";
import {
  guessCategory,
  myWorkItemsQuery,
  sortWorkItems,
  type StateCategory,
  statePatch,
  WORK_ITEM_FIELDS,
  type WorkItem,
  workItemItem,
} from "../lib.ts";

/** workitemsbatch takes at most 200 ids. */
const MAX = 200;

function stateMenu(a: Auth, w: WorkItem) {
  const project = w.fields["System.TeamProject"], type = w.fields["System.WorkItemType"];
  return submenu("Change State", async (ctx) => {
    const states = await typeStates(a, project, type, ctx.signal);
    return states.filter((s) => s.name !== w.fields["System.State"]).map((s) =>
      action(s.name, async () => {
        await ado(a, `/_apis/wit/workitems/${w.id}`, {
          method: "PATCH",
          body: statePatch(s.name),
          contentType: "application/json-patch+json",
        });
        await toast(`${type} ${w.id} → ${s.name}`, { style: "success" });
        return refresh();
      }, { icon: Icons.arrowRight, destructive: s.category === "Removed" })
    );
  }, { icon: Icons.inProgress, shortcut: "<Ctrl>s" });
}

export default list({
  placeholder: "Filter work items by title, ID, type, state, tag…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "progress", title: "In progress" },
      { value: "todo", title: "To do" },
      { value: "bugs", title: "Bugs" },
    ],
    default: "all",
  },
  empty: {
    title: "No open work item assigned to you",
    description: "Closed, Done and Removed items are left out.",
    icon: Icons.kanban,
  },
  status: (items) => countStatus(items, "work item"),
  items: ({ preferences, signal, filter }) =>
    guarded(async () => {
      const a = auth(preferences);
      const found = await ado<{ workItems: { id: number }[] }>(a, `/_apis/wit/wiql?$top=${MAX}`, {
        method: "POST",
        body: { query: myWorkItemsQuery(a.projects) },
        signal,
      });
      const ids = found.workItems.map((w) => w.id).slice(0, MAX);
      if (!ids.length) {
        updateCommandMetadata({ subtitle: null }).catch(() => {});
        return [];
      }
      const batch = await ado<{ value: WorkItem[] }>(a, "/_apis/wit/workitemsbatch", {
        method: "POST",
        body: { ids, fields: WORK_ITEM_FIELDS, errorPolicy: "omit" },
        signal,
      });
      const items = batch.value.filter(Boolean);
      const known = await stateCategories(
        a,
        items.map((w) => ({ project: w.fields["System.TeamProject"], type: w.fields["System.WorkItemType"] })),
        signal,
      );
      const category = (w: WorkItem): StateCategory =>
        known.get(`${w.fields["System.TeamProject"]}/${w.fields["System.WorkItemType"]}/${w.fields["System.State"]}`) ??
          guessCategory(w.fields["System.State"]);
      const active = items.filter((w) => category(w) === "InProgress").length;
      updateCommandMetadata({ subtitle: active ? `${active} in progress` : `${items.length} open` }).catch(() => {});
      const shown = items.filter((w) => {
        if (filter === "progress") return category(w) === "InProgress" || category(w) === "Resolved";
        if (filter === "todo") return category(w) === "Proposed";
        if (filter === "bugs") return w.fields["System.WorkItemType"].toLowerCase() === "bug";
        return true;
      });
      return sortWorkItems(shown, category).map((w) => workItemItem(a.org, w, category(w), [stateMenu(a, w)]));
    }),
});
