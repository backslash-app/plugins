import { type Context, list, type ListSpec } from "@backslash/api";
import { config, SetupError, setupItem } from "../api.ts";
import { searchView } from "../views.ts";

// Search an index, alias or pattern straight from the root search: "Search Elasticsearch logs-*".
export default ({ preferences, args }: Context): ListSpec => {
  try {
    const c = config(preferences);
    return searchView(c, String(args.index ?? "").trim() || c.defaultIndex);
  } catch (e) {
    if (e instanceof SetupError) return list({ items: [setupItem(e)] });
    throw e;
  }
};
