import { action, type Context, Icons, list, refresh, updateCommandMetadata } from "@backslash/api";
import { nearby, resolveLocation } from "../api.ts";
import {
  formatDistance,
  numberPref,
  parseQuakes,
  periodDays,
  periodOf,
  PERIODS,
  quakeItem,
  status,
  summary,
  unitsOf,
} from "../lib.ts";

// Set by "Refresh": the next load skips the 5 minute cache.
let fresh = false;

const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

const localTime = (t: number) =>
  new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium", timeZoneName: "short" });

let shown = "";

export default list({
  placeholder: "Filter by place or magnitude class…",
  filter: { options: PERIODS.map((p) => ({ value: p.value, title: p.title })), default: PERIODS[0].value },
  empty: {
    title: "No earthquakes near you",
    description: "Nothing in this period: try 30 days, a larger radius or a lower minimum magnitude in the settings",
    icon: Icons.activity,
  },
  actions: [refreshAction],
  status: () => shown,
  async items(ctx: Context) {
    const prefs = ctx.preferences;
    const home = await resolveLocation(String(prefs.location ?? ""), ctx.signal);
    if (!home) {
      throw new Error("Set your city or coordinates in Settings → Extensions → Earthquakes to see the ones near you");
    }
    const units = unitsOf(prefs.units);
    const radiusKm = numberPref(prefs.radius, 300) || 300;
    const minMagnitude = numberPref(prefs.minMagnitude, 1.5);
    const period = periodOf(ctx.filter);
    const data = await nearby(home, { radiusKm, minMagnitude, days: periodDays(period) }, ctx.signal, fresh);
    fresh = false;
    const quakes = parseQuakes(data, home);
    shown = `${status(quakes)} within ${formatDistance(radiusKm, units)} of ${home.name} · USGS`;
    if (period === PERIODS[0].value) {
      updateCommandMetadata({ subtitle: quakes[0] ? summary(quakes[0]) : "None this week" }).catch(() => {});
    }
    const now = Date.now();
    const section = `M${minMagnitude}+ within ${formatDistance(radiusKm, units)} of ${home.name}`;
    return quakes.map((q) => quakeItem(q, { units, now, localTime, section, extraActions: [refreshAction] }));
  },
});
