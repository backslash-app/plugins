import { action, type Context, Icons, list, open, refresh, updateCommandMetadata } from "@backslash/api";
import { around, credentialsOf, creditsLeft, resolveLocation } from "../api.ts";
import {
  aircraftItem,
  airline,
  formatDistance,
  label,
  numberPref,
  parseStates,
  status,
  unitsOf,
  viewOf,
  VIEWS,
} from "../lib.ts";

// Set by "Refresh": the next load skips the 20 second cache.
let fresh = false;

const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

let shown = "OpenSky Network";

export default list({
  placeholder: "Filter by callsign, airline or country…",
  filter: { options: VIEWS.map((v) => ({ value: v.value, title: v.title })), default: VIEWS[0].value },
  empty: {
    title: "No aircraft around you right now",
    description: "Try a larger radius in the settings, or the All chip to include aircraft on the ground",
    icon: Icons.globe,
  },
  actions: [refreshAction, open("https://opensky-network.org/my-opensky/account", "Get an OpenSky API Client")],
  status: () => shown,
  async items(ctx: Context) {
    const prefs = ctx.preferences;
    const home = await resolveLocation(String(prefs.location ?? ""), ctx.signal);
    if (!home) {
      throw new Error(
        "Set your city or coordinates in Settings → Extensions → Flight Tracker to see the aircraft above you",
      );
    }
    const units = unitsOf(prefs.units);
    const radiusKm = Math.min(500, numberPref(prefs.radius, 50));
    const data = await around(home, radiusKm, credentialsOf(prefs), ctx.signal, fresh);
    fresh = false;
    const all = parseStates(data, home).filter((a) => a.distance! <= radiusKm);
    const view = viewOf(ctx.filter);
    const shownAircraft = view === "air" ? all.filter((a) => !a.onGround) : all;
    const credits = creditsLeft !== undefined ? ` · ${creditsLeft.toLocaleString("en")} API credits left` : "";
    shown = `${status(all)} within ${formatDistance(radiusKm, units)} of ${home.name}${credits}`;
    const nearest = all.find((a) => !a.onGround);
    if (view === "air") {
      updateCommandMetadata({
        subtitle: nearest
          ? `${label(nearest)}${airline(nearest.callsign) ? ` (${airline(nearest.callsign)})` : ""} is nearest`
          : "Nothing in the air nearby",
      }).catch(() => {});
    }
    const section = `Within ${formatDistance(radiusKm, units)} of ${home.name}, nearest first`;
    return shownAircraft.map((a) =>
      aircraftItem(a, { units, now: data.time, home, section, extraActions: [refreshAction] })
    );
  },
});
