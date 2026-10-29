import { openExternal, run } from "@backslash/api";
import { home, optionsOf, savedPlaces, search } from "../api.ts";
import { directionsUrl, modeOf } from "../lib.ts";

export default run<{ to: string }>(async (ctx) => {
  const to = String(ctx.args.to ?? "").trim();
  const o = optionsOf(ctx.preferences);
  const from = await home(String(ctx.preferences.home ?? ""), o);
  if (!from) throw new Error("Set your home address in Settings → Extensions → Maps first");
  // A saved place by name first: no request needed.
  const saved = (await savedPlaces()).find((p) => p.name.toLowerCase() === to.toLowerCase());
  const place = saved ?? (await search(to, { ...o, limit: 1 }))[0];
  if (!place) throw new Error(`OpenStreetMap found nothing for “${to}”`);
  await openExternal(directionsUrl(from, place, modeOf(ctx.preferences.mode)));
  return `Directions to ${place.name}`;
});
