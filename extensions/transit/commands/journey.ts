import { type Context, list } from "@backslash/api";
import { searchPlaces, SetupError, setupItem, token } from "../api.ts";
import { coverages, type Place, shortStop } from "../lib.ts";
import { journeysView, placeSearch, suggestions } from "../ui.ts";

const pickDestination = (from: Place) =>
  placeSearch(`From ${shortStop(from.name)} to…`, (to) => journeysView(from, to), {
    pickTitle: "Plan Journey",
    suggestions: async () => (await suggestions()).filter((p) => p.id !== from.id),
  });

const pickOrigin = () =>
  placeSearch("Plan a Journey: from…", (from) => pickDestination(from), {
    pickTitle: "Choose as Start",
    suggestions,
  });

export default async (ctx: Context<{ from?: string; to?: string }>) => {
  const from = String(ctx.args?.from ?? "").trim();
  const to = String(ctx.args?.to ?? "").trim();
  if (!from) return pickOrigin();
  // "Plan a Journey Gare de Lyon, Châtelet": take the best match of each.
  let tok: string;
  try {
    tok = token(ctx.preferences);
  } catch (e) {
    if (e instanceof SetupError) return list({ items: [setupItem(e)] });
    throw e;
  }
  const regions = coverages(ctx.preferences.coverage);
  const [a, b] = await Promise.all([
    searchPlaces(tok, from, regions, { signal: ctx.signal }),
    to ? searchPlaces(tok, to, regions, { signal: ctx.signal }) : Promise.resolve([] as Place[]),
  ]);
  if (!a[0]) throw new Error(`No place called “${from}”`);
  if (!to) return pickDestination(a[0]);
  if (!b[0]) throw new Error(`No place called “${to}”`);
  return journeysView(a[0], b[0]);
};
