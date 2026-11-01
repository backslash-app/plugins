import { action, type Context, Icons, type Item, list, refresh } from "@backslash/api";
import { issElements, resolvePlace } from "../api.ts";
import { passes } from "../geo.ts";
import { nowItems, settingsFor, zoneFor } from "../lib.ts";
import { clockOf, localZone, type Place } from "../places.ts";
import { satrec } from "../sgp4.ts";

/** How often the position moves on screen: the station covers 23 km a second. */
const TICK = 3000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const id = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(id);
      resolve();
    }, { once: true });
  });
}

async function* live(ctx: Context): AsyncGenerator<Item[]> {
  const elements = await issElements(ctx.signal);
  const sat = satrec(elements.tle);
  const pref = String(ctx.preferences.location ?? "").trim();
  const place: Place | undefined = pref ? await resolvePlace(pref, ctx.signal).catch(() => undefined) : undefined;
  const clock = clockOf(ctx.preferences.hour12);
  const zone = zoneFor(place, localZone());
  const start = Date.now();
  // Passes are computed once; only the position moves.
  const upcoming = place ? passes(sat, place.latitude, place.longitude, start, start + 10 * 86_400_000) : undefined;
  const actions = [
    action("Update the Orbit", async (c) => {
      await issElements(c.signal, true);
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ];
  while (!ctx.signal.aborted) {
    const now = Date.now();
    yield nowItems({
      sat,
      now,
      settings: settingsFor(zone, clock, now),
      place,
      passes: upcoming,
      stale: elements.stale,
    }, actions);
    await sleep(TICK, ctx.signal);
  }
}

export default list({
  placeholder: "Filter…",
  empty: { title: "Can't place the ISS", icon: Icons.rocket },
  status: (items) => String(items.find((i) => i.id === "position")?.subtitle ?? "Computed from CelesTrak's orbit"),
  items: live,
});
