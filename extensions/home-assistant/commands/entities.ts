import { type Context, list, updateCommandMetadata } from "@backslash/api";
import { guarded, ha, server } from "../api.ts";
import { type Entity, entityItem, lightsOn, matchesFilter, sortEntities } from "../lib.ts";

/** The list follows the house while it is open. */
const POLL_MS = 10_000;

export default (ctx: Context) =>
  list({
    placeholder: "Filter entities by name, room, entity id, state…",
    filter: {
      options: [
        { value: "controls", title: "Controls" },
        { value: "sensors", title: "Sensors" },
        { value: "all", title: "All" },
      ],
    },
    empty: { title: "No entity here", icon: "bs-home" },
    status: (items) =>
      items[0]?.id === "setup" ? "Not connected" : `${items.length} entit${items.length === 1 ? "y" : "ies"}`,
    async *items({ preferences, signal, filter }) {
      while (!signal.aborted) {
        const items = await guarded(async () => {
          const s = server(preferences);
          const all = await ha<Entity[]>(s, "/states", { signal });
          updateCommandMetadata({ subtitle: lightsOn(all) }).catch(() => {});
          return sortEntities(all.filter((e) => matchesFilter(e, filter))).map((e) => entityItem(e, ctx, s));
        });
        yield items;
        if (items[0]?.id === "setup") return;
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, POLL_MS);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
            resolve(undefined);
          }, { once: true });
        });
      }
    },
  });
