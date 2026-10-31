import { action, Icons, type Item, list, refresh, updateCommandMetadata } from "@backslash/api";
import { ecowatt, spotPrices, tempo } from "../api.ts";
import { addDays, parisDate, tempoSubtitle } from "../lib.ts";
import { ecowattItem, ecowattSetupItem, errorItem, seasonItem, spotItems, tempoItem } from "../views.ts";

// Set by "Reload": the next load skips the cache.
let fresh = false;
let status = "";

const reload = action("Reload", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

export default list({
  placeholder: "Filter…",
  status: () => status,
  empty: { title: "Nothing to show", description: "Check your connection, then reload with Ctrl+R", icon: Icons.bolt },
  async *items({ preferences, signal }) {
    const force = fresh;
    fresh = false;
    const day = parisDate();
    const extra = [reload];
    let items: Item[] = [];

    try {
      const t = await tempo({ signal, fresh: force });
      items = [
        tempoItem("Today", t.today, { expected: day, stats: t.stats, season: t.season, extra }),
        tempoItem("Tomorrow", t.tomorrow, { expected: addDays(day, 1), stats: t.stats, season: t.season, extra }),
        ...(t.stats ? [seasonItem(t.stats, t.season, extra)] : []),
      ];
      const subtitle = tempoSubtitle(t.today, t.tomorrow);
      status = subtitle ?? "";
      updateCommandMetadata({ subtitle }).catch(() => {});
    } catch (e) {
      if (signal.aborted) throw e;
      items = [errorItem("tempo:error", "EDF Tempo", "Couldn't load the Tempo colors", e)];
    }
    yield items;

    const [eco, spot] = await Promise.allSettled([
      ecowatt(preferences.ecowatt, { signal, fresh: force }),
      preferences.spot === false ? Promise.resolve(undefined) : spotPrices({ signal, fresh: force }),
    ]);
    if (signal.aborted) return;

    if (eco.status === "fulfilled") {
      items = [
        ...items,
        ...(eco.value ? eco.value.map((d) => ecowattItem(d, day, extra)) : [ecowattSetupItem()]),
      ];
    } else items = [...items, ecowattSetupItem((eco.reason as Error).message)];

    if (spot.status === "fulfilled") {
      if (spot.value) items = [...items, ...spotItems(spot.value, extra)];
    } else {
      items = [
        ...items,
        errorItem("spot:error", "Day-ahead prices (France)", "Couldn't load the spot prices", spot.reason),
      ];
    }
    yield items;
  },
});
