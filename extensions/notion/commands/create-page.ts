import { type Context, list, storage } from "@backslash/api";
import { EMPTY, guarded, needToken } from "../api.ts";
import { type Database, resultItem, search, titlesOf } from "../lib.ts";

export default (ctx: Context) =>
  list({
    placeholder: "Pick a database for the new page…",
    empty: { ...EMPTY, title: "No database shared with the integration" },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : "Enter opens the form",
    items: ({ preferences, signal }) =>
      guarded(async () => {
        const [databases, last] = await Promise.all([
          search(needToken(preferences), "", "database", signal, 50) as Promise<Database[]>,
          storage.get<string>("lastDatabase").catch(() => undefined),
        ]);
        const titles = titlesOf(databases);
        // The last database used first.
        const sorted = [...databases].sort((a, b) => Number(b.id === last) - Number(a.id === last));
        return sorted.map((db) => {
          const item = resultItem(db, ctx, titles);
          const create = item.actions!.find((a) => a.title === "Create Page in Database")!;
          return {
            ...item,
            section: db.id === last ? "Last used" : "Databases",
            actions: [create, ...item.actions!.filter((a) => a !== create)],
          };
        });
      }),
  });
