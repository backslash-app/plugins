import { action, Icons, type Item, list, refresh } from "@backslash/api";
import { top } from "../api.ts";
import { type Kind, PERIODS, plays, SERVICES, services, settings } from "../lib.ts";
import { errorItem, setupItem, topItem } from "../views.ts";

let status = "";
let fresh = false;

const reload = action("Reload", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

export default list({
  placeholder: "Filter your top music…",
  status: () => status,
  filter: {
    options: [{ value: "artists", title: "Artists" }, { value: "tracks", title: "Tracks" }, {
      value: "albums",
      title: "Albums",
    }],
    default: "artists",
  },
  empty: { title: "Nothing in this period", description: "Choose a longer period in Settings", icon: Icons.music },
  async items({ preferences, filter, signal }): Promise<Item[]> {
    const force = fresh;
    fresh = false;
    const s = settings(preferences);
    const service = services(s)[0];
    if (!service) {
      status = "";
      return [setupItem()];
    }
    const kind = (filter ?? "artists") as Kind;
    try {
      const entries = await top(service, kind, s, { signal, fresh: force });
      if (!entries) {
        status = `${SERVICES[service].title} · ${PERIODS[s.period].title}`;
        return [{
          id: "pending",
          title: "ListenBrainz hasn't computed these statistics yet",
          subtitle: "They are updated once a day: come back tomorrow",
          icon: { source: Icons.hourglass, tint: "gray" },
        }];
      }
      const total = entries.reduce((n, e) => n + e.plays, 0);
      status = `${SERVICES[service].title} · ${kind} ${PERIODS[s.period].title} · ${plays(total)}`;
      const max = entries[0]?.plays ?? 0;
      return entries.map((e) => topItem(e, service, s, max, [reload]));
    } catch (e) {
      if (signal.aborted) throw e;
      status = "";
      return [errorItem(e, service)];
    }
  },
});
