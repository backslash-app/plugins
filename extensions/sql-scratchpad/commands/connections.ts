import { Icons, list } from "@backslash/api";
import { connectionFor, connectionsOf, type Prefs } from "../system.ts";
import { connectionItem, setupItem } from "../views.ts";

// The connections of the preferences: browse their tables, start a query, copy the URL.
export default list({
  placeholder: "Filter connections…",
  empty: {
    title: "No connections",
    description: "Add them in Settings → Extensions → SQL Scratchpad",
    icon: Icons.database,
  },
  status: (items) => `${items.filter((i) => i.id?.startsWith("connection:")).length} connections`,
  items({ preferences }) {
    const prefs = preferences as Prefs;
    const { connections, errors } = connectionsOf(prefs);
    const fallback = connectionFor(undefined, prefs);
    const items = connections.map((c) => connectionItem(c, prefs, c === fallback || c.name === fallback?.name));
    return !connections.length || errors.length ? [setupItem(errors), ...items] : items;
  },
});
