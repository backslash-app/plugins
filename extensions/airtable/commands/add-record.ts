import { Icons, list } from "@backslash/api";
import { type Backend, backends, each, recent, tables } from "../api.ts";
import { SetupError, setupItem, tableKey } from "../lib.ts";
import { report, tableItem } from "../views.ts";

export default list({
  placeholder: "Which table? The last used come first…",
  empty: { title: "No table", description: "The token sees no table you can add to.", icon: Icons.database },
  async items({ preferences, signal }) {
    let list: Backend[];
    try {
      list = backends(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    const [r, last] = await Promise.all([each(list, (b) => tables(b, signal)), recent()]);
    const setup = await report(r);
    if (setup) return setup;
    const many = r.ok.length > 1;
    const rank = (key: string) => {
      const i = last.indexOf(key);
      return i < 0 ? Infinity : i;
    };
    return r.ok.flatMap((x) => x.value.map((t) => ({ backend: x.backend, table: t })))
      .sort((a, b) => rank(tableKey(a.table)) - rank(tableKey(b.table)))
      .map((x) => {
        const item = tableItem(x.backend, x.table, many, { formFirst: true });
        return rank(tableKey(x.table)) < Infinity ? { ...item, section: "Recent" } : item;
      });
  },
});
