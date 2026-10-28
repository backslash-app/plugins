import {
  action,
  Icons,
  type Item,
  list,
  type ListSpec,
  refresh,
  replace,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  addFavourite,
  type Board,
  departures,
  favourites,
  moveFavourite,
  removeFavourite,
  SetupError,
  token,
} from "../api.ts";
import { clock, type Place, shortStop } from "../lib.ts";
import { boardItems, boardView, guarded, placeSearch } from "../ui.ts";

const addStop = action(
  "Add a Stop…",
  () =>
    placeSearch("Add a Stop", async (p) => {
      await addFavourite(p);
      await toast(`${shortStop(p.name)} added to your stops`, { style: "success" });
      return replace(view);
    }, { stopsOnly: true, pickTitle: "Add to Favourites" }),
  { icon: Icons.plus, shortcut: "<Ctrl>n", section: "Stops" },
);

function stopActions(stop: Place) {
  return [
    action("All Departures", () => boardView(stop), { icon: Icons.clock, shortcut: "<Ctrl>d", section: "Stops" }),
    addStop,
    action("Move Stop Up", async () => {
      await moveFavourite(stop, -1);
      return refresh();
    }, { icon: Icons.arrowUp, shortcut: "<Ctrl><Shift>Up", section: "Stops" }),
    action("Move Stop Down", async () => {
      await moveFavourite(stop, 1);
      return refresh();
    }, { icon: Icons.arrowDown, shortcut: "<Ctrl><Shift>Down", section: "Stops" }),
    action("Remove Stop", async () => {
      await removeFavourite(stop);
      await toast(`${shortStop(stop.name)} removed`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Remove ${shortStop(stop.name)} from your stops?`,
      shortcut: "<Ctrl>x",
      section: "Stops",
    }),
  ];
}

const view: ListSpec = list({
  placeholder: "Filter departures by line, direction or stop…",
  empty: {
    title: "No favourite stop yet",
    description: "Ctrl+N finds a station or stop and adds it here",
    icon: Icons.pin,
  },
  actions: [addStop],
  status: (
    items,
  ) => (items[0]?.id === "setup" ? "Not connected" : `${items.length} departures · real time when available`),
  async *items({ preferences, signal }) {
    const stops = await favourites();
    if (!stops.length) {
      yield await guarded(() => {
        token(preferences);
        return Promise.resolve([]);
      });
      return;
    }
    const shown = new Map<string, Item[]>();
    const boards = new Map<string, Board>();
    const all = await guarded(async () => {
      const tok = token(preferences);
      await Promise.all(stops.map(async (stop) => {
        try {
          const board = await departures(tok, stop, signal, 8);
          boards.set(stop.id, board);
          shown.set(stop.id, boardItems(board, stop, stopActions(stop)));
        } catch (e) {
          if (e instanceof SetupError || (e instanceof DOMException && e.name === "AbortError")) throw e;
          shown.set(stop.id, [{
            id: `error|${stop.id}`,
            title: (e as Error).message,
            subtitle: shortStop(stop.name),
            icon: { source: Icons.alert, tint: "orange" },
            section: shortStop(stop.name),
            actions: [action("Retry", () => refresh(), { icon: Icons.refresh }), ...stopActions(stop)],
          }]);
        }
      }));
      return stops.flatMap((s) => shown.get(s.id) ?? []);
    });
    const next = boards.get(stops[0].id)?.departures[0];
    updateCommandMetadata({
      subtitle: next ? `${next.line} → ${next.direction} at ${clock(next.time)}` : null,
    }).catch(() => {});
    yield all;
  },
});

export default view;
