import { action, Icons, type Item, list, refresh, updateCommandMetadata } from "@backslash/api";
import { favorites, HostError, liveStatus, network } from "../api.ts";
import { matches, type Need, parseCoordinates, resolveSystem, rows, summary } from "../lib.ts";
import { messageItem, stationItem } from "../views.ts";

const NEEDS = [
  { value: "all", title: "All" },
  { value: "bikes", title: "Bikes" },
  { value: "ebikes", title: "E-bikes" },
  { value: "docks", title: "Free Docks" },
];

/** Stations close to home this far are "Nearby". */
const NEARBY_METERS = 1500;
const NEARBY_MAX = 12;

let status = "";
let fresh = false;

const reload = action("Reload", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Stations" });

export default list({
  placeholder: "Filter stations by name, address or code…",
  filter: { options: NEEDS, default: "all" },
  status: () => status,
  empty: { title: "No station matches", description: "Try another chip with Tab", icon: Icons.pin },
  async items({ preferences, filter, signal }): Promise<Item[]> {
    const force = fresh;
    fresh = false;
    const system = resolveSystem(preferences.system);
    if (!system) {
      status = "";
      return [messageItem(`Unknown system “${preferences.system}”`, "Use a name from the list or a gbfs.json URL")];
    }
    const homeText = String(preferences.home ?? "").trim();
    const home = parseCoordinates(homeText);
    let net, live;
    try {
      net = await network(system, { signal, fresh: force });
      live = await liveStatus(net, signal);
    } catch (e) {
      if (signal.aborted) throw e;
      status = system.name;
      return [
        messageItem(
          e instanceof HostError ? "This feed's host isn't allowed" : `Couldn't load ${system.name}`,
          (e as Error).message,
        ),
      ];
    }
    const need = (filter ?? "all") as Need;
    const fav = await favorites(system);
    const all = rows(net.stations, live, home);
    const shown = all.filter((r) => matches(r, need));
    const sys = { ...system, name: net.name };
    const item = (section: string, favorite: boolean) => (r: (typeof all)[number]) =>
      stationItem(r, { system: sys, home, favorite, section, extra: [reload] });

    const favRows = all.filter((r) => fav.includes(r.station.id));
    const first = favRows[0];
    updateCommandMetadata({ subtitle: first ? `${first.station.name}: ${summary(first.status)}` : null }).catch(
      () => {},
    );

    const favItems = favRows.filter((r) => matches(r, need)).map(item("Favorites", true));
    const rest = shown.filter((r) => !fav.includes(r.station.id));
    const nearby = home ? rest.filter((r) => (r.distance ?? Infinity) <= NEARBY_METERS).slice(0, NEARBY_MAX) : [];
    const others = rest.filter((r) => !nearby.includes(r));

    const bikes = shown.reduce((n, r) => n + (r.status?.bikes ?? 0), 0);
    status = `${net.name} · ${shown.length} stations · ${bikes} bikes${home ? "" : " · set Home to sort by distance"}`;

    const setup: Item[] = homeText && !home
      ? [messageItem("Home isn't “latitude, longitude”", `“${homeText}”: e.g. 48.8566, 2.3522`)]
      : [];
    return [
      ...setup,
      ...favItems,
      ...nearby.map(item("Nearby", false)),
      ...others.map(item(home ? "Farther" : "All stations", false)),
    ];
  },
});
