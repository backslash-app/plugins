import { action, type Context, Icons, type Item, list, refresh } from "@backslash/api";
import { favourites, findPlaces, homePlace, stationsById } from "../api.ts";
import { fuelOf, parseFuel, rows, summarize } from "../lib.ts";
import { emptyFor, FUEL_FILTER, nearbyItems, placeView, settings, setupItem, stationItem } from "../views.ts";

let status = "";

export default (ctx: Context) =>
  list({
    placeholder: "Town, postcode or address in France…",
    filter: { options: FUEL_FILTER, default: parseFuel(ctx.preferences.fuel) },
    status: () => status,
    empty: emptyFor(settings(ctx.preferences, parseFuel(ctx.preferences.fuel))),
    async search(query, { preferences, filter, signal }) {
      const s = settings(preferences, parseFuel(filter ?? preferences.fuel));
      const q = query.trim();
      const reload = action("Reload Prices", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });
      const fav = await favourites();

      if (!q) {
        const home = await homePlace(preferences.location, signal);
        // Favourites first, wherever they are, priced for the chosen fuel.
        const favRows = home && fav.length
          ? rows(await stationsById(fav, signal).catch(() => []), home, s.fuel, { sort: s.sort })
          : [];
        const favItems = favRows.map((r) =>
          stationItem(r, s, { cheapest: summarize(favRows).min, favourite: true, section: "Favourites" })
        );
        if (!home) {
          status = "";
          const message = String(preferences.location ?? "").trim()
            ? `No place found for “${preferences.location}”`
            : "Type a town or postcode, or set your home location";
          return [setupItem(message)];
        }
        const near = await nearbyItems(home, s, fav, {
          signal,
          section: favItems.length ? `Around ${home.label}` : undefined,
        });
        status = near.status;
        return [...favItems, ...near.items].map((i) => ({ ...i, actions: [...(i.actions ?? []), reload] }));
      }

      const places = await findPlaces(q, signal);
      if (!places.length) {
        status = "";
        return [{
          id: "none",
          title: `No place in France matches “${q}”`,
          subtitle: "A town, a postcode (69003), an address, or latitude, longitude",
          icon: { source: Icons.search, tint: "gray" },
        }];
      }
      const [place, ...others] = places;
      const near = await nearbyItems(place, s, fav, { signal, section: others.length ? place.label : undefined });
      status = near.status;
      const elsewhere: Item[] = others.slice(0, 4).map((p) => ({
        id: `place:${p.label}`,
        title: p.label,
        subtitle: `Stations around this place instead`,
        icon: { source: Icons.pin, tint: "gray" },
        section: "Other places",
        actions: [action(`Show ${fuelOf(s.fuel).title} Around`, () => placeView(p, s, fav), { icon: Icons.droplet })],
      }));
      return [...near.items, ...elsewhere];
    },
  });
