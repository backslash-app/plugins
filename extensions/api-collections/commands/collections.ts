import { list } from "@backslash/api";
import { HOME, loadAll } from "../collections.ts";
import { parseFolders } from "../lib.ts";
import { collectionItem, deniedItem, depthOf, EMPTY, type Prefs } from "../views.ts";

// Bruno collections and request files; Enter lists their requests.
export default list({
  placeholder: "Filter collections…",
  empty: EMPTY,
  status: (items) => {
    const n = items.filter((i) => !i.id?.startsWith("denied:")).length;
    return `${n} collection${n === 1 ? "" : "s"}`;
  },
  async items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    const { collections, denied } = await loadAll(parseFolders(prefs.folders, HOME), depthOf(prefs), signal);
    return [...await Promise.all(collections.map(collectionItem)), ...denied.map(deniedItem)];
  },
});
