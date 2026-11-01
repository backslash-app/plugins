import { copy, Icons, type Item, list } from "@backslash/api";
import { byIcao, credentialsOf, creditsLeft, RateLimited, resolveLocation, world } from "../api.ts";
import { aircraftItem, AIRLINES, matchCallsign, measureFrom, parseQuery, parseStates, unitsOf } from "../lib.ts";

const LIMIT = 200;

const EXAMPLES = [
  { query: "AFR", title: "Every Air France flight in the air" },
  { query: "EZY", title: "Every easyJet flight" },
  { query: "BAW117", title: "One flight by its callsign" },
  { query: "3c6521", title: "An aircraft by its transponder address (ICAO 24, hex)" },
];

function examples(): Item[] {
  return EXAMPLES.map((e) => ({
    id: `example:${e.query}`,
    title: e.query,
    subtitle: e.title,
    icon: { source: Icons.lightbulb, tint: "yellow" },
    section: "Type a callsign, its first letters, or a transponder address",
    actions: [copy(e.query, "Copy Example")],
  }));
}

let shown = "";

export default list({
  placeholder: "Callsign (AFR1234, AFR…) or transponder address (3c6521)…",
  empty: {
    title: "Not in the air right now",
    description: "OpenSky only knows aircraft its receivers hear at this moment",
    icon: Icons.search,
  },
  status: () => shown,
  async search(query, ctx) {
    const q = parseQuery(query);
    if (q.kind === "empty" || q.kind === "short") {
      shown = q.kind === "short" ? "Type at least 3 characters of a callsign" : "OpenSky Network";
      return examples();
    }
    const prefs = ctx.preferences;
    const units = unitsOf(prefs.units);
    const creds = credentialsOf(prefs);
    const home = await resolveLocation(String(prefs.location ?? ""), ctx.signal).catch(() => undefined);
    try {
      const data = q.kind === "icao24" ? await byIcao(q.icao24, creds, ctx.signal) : await world(creds, ctx.signal);
      const all = parseStates(data);
      const found = q.kind === "icao24" ? all : matchCallsign(all, q.callsign).slice(0, LIMIT);
      const prefix = q.kind === "callsign" ? AIRLINES[q.callsign.slice(0, 3)] : undefined;
      const credits = creditsLeft !== undefined ? ` · ${creditsLeft.toLocaleString("en")} API credits left` : "";
      shown = `${found.length}${found.length === LIMIT ? "+" : ""} aircraft${credits}`;
      const section = q.kind === "icao24"
        ? "Transponder"
        : prefix && q.callsign.length === 3
        ? `${prefix} flights in the air`
        : "Matching callsigns";
      return measureFrom(found, home).map((a) => aircraftItem(a, { units, now: data.time, home, section }));
    } catch (e) {
      if (e instanceof RateLimited) shown = "Out of API credits";
      throw e;
    }
  },
});
