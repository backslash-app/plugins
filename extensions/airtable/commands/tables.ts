import { Icons, list } from "@backslash/api";
import { type Backend, backends, each, tables } from "../api.ts";
import { SetupError, setupItem } from "../lib.ts";
import { report, tableItem } from "../views.ts";

let status = "";

export default list({
  placeholder: "Filter tables and bases…",
  status: () => status,
  empty: {
    title: "No table",
    description: "The token sees no base: give it access to some (Airtable) or check its permissions.",
    icon: Icons.database,
  },
  async items({ preferences, signal }) {
    let list: Backend[];
    try {
      list = backends(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    const r = await each(list, (b) => tables(b, signal));
    const setup = await report(r);
    if (setup) return setup;
    const many = r.ok.length > 1;
    const all = r.ok.flatMap((x) => x.value.map((t) => ({ backend: x.backend, table: t })));
    status = `${all.length} table${all.length === 1 ? "" : "s"} · Enter searches, Ctrl+N adds a record`;
    return all
      .sort((a, b) => a.table.kind.localeCompare(b.table.kind) || a.table.baseName.localeCompare(b.table.baseName))
      .map((x) => tableItem(x.backend, x.table, many));
  },
});
