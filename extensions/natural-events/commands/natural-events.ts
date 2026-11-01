import { action, type Context, Icons, list, refresh, updateCommandMetadata } from "@backslash/api";
import { events, resolveLocation } from "../api.ts";
import { eventItem, numberPref, parseEvents, queries, sections, status, unitsOf, viewOf, VIEWS } from "../lib.ts";

// Set by "Refresh": the next load skips the 15 minute cache.
let fresh = false;

const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

let shown = "NASA EONET";

export default list({
  placeholder: "Filter by name, country or kind…",
  filter: { options: VIEWS.map((v) => ({ value: v.value, title: v.title })), default: VIEWS[0].value },
  empty: {
    title: "Nothing reported",
    description: "EONET has no event of this kind right now: try another chip or more days in the settings",
    icon: Icons.globe,
  },
  actions: [refreshAction],
  status: () => shown,
  async items(ctx: Context) {
    const prefs = ctx.preferences;
    const units = unitsOf(prefs.units);
    const days = Math.min(365, Math.round(numberPref(prefs.days, 30)));
    const nearKm = numberPref(prefs.radius, 500);
    const view = viewOf(ctx.filter);
    // A wrong location should not hide the events: distances are then left out.
    const [answers, home] = await Promise.all([
      Promise.all(queries(view, days).map((q) => events(q, ctx.signal, fresh))),
      resolveLocation(String(prefs.location ?? ""), ctx.signal).catch(() => undefined),
    ]);
    fresh = false;
    const all = parseEvents(answers, home);
    shown = `${status(all)} · NASA EONET`;
    if (view === "active") {
      const near = home ? all.filter((e) => e.distance! <= nearKm).length : 0;
      updateCommandMetadata({
        subtitle: home ? `${near} near you · ${all.length} worldwide` : `${all.length} ongoing worldwide`,
      }).catch(() => {});
    }
    const now = Date.now();
    return sections(all, nearKm, home, units).flatMap((s) =>
      s.events.map((e) => eventItem(e, { units, now, section: s.title, extraActions: [refreshAction] }))
    );
  },
});
