import { type Action, action, Icons, type Item, list, open, refresh } from "@backslash/api";
import { metars, removeAirport, saveAirport, savedAirports, tafs } from "../api.ts";
import { metarItem, periodItem, tafSection } from "../items.ts";
import {
  type Code,
  looksLikeReport,
  type MetarRecord,
  parseCodes,
  parseMetar,
  parseTaf,
  SITE,
  stationName,
} from "../lib.ts";

interface Prefs {
  airports?: string;
}

const HELP = [
  "## Type airport codes",
  "",
  "- An ICAO code: `LFPG`, `KJFK`, `EGLL`",
  "- An IATA code for large airports: `CDG`, `JFK`, `NRT` (other 3-letter codes are read as US airports)",
  "- Several at once: `LFPG LFPO LFOB`",
  "",
  "Save airports with Ctrl+S, or list them in Settings → Extensions → Aviation Weather.",
  "To decode a report you already have, use **Decode METAR or TAF**.",
].join("\n");

function hint(title: string, subtitle: string): Item {
  return {
    id: "hint",
    title,
    subtitle,
    icon: { source: Icons.info, tint: "blue" },
    detail: { markdown: HELP },
    actions: [open(SITE, "Open aviationweather.gov", { icon: Icons.globe })],
  };
}

function saveActions(icao: string, saved: boolean): Action[] {
  return [
    saved
      ? action("Remove from My Airports", async () => {
        await removeAirport(icao);
        return refresh();
      }, { icon: Icons.minus, shortcut: "<Ctrl>s", destructive: true })
      : action("Add to My Airports", async () => {
        await saveAirport(icao);
        return refresh();
      }, { icon: Icons.plus, shortcut: "<Ctrl>s" }),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
  ];
}

/** One METAR line per saved airport. */
async function myAirports(prefs: Prefs, signal: AbortSignal): Promise<Item[]> {
  const fromPrefs = parseCodes(prefs.airports ?? "").map((c) => c.icao);
  const saved = await savedAirports();
  const ids = [...new Set([...fromPrefs, ...saved])];
  if (!ids.length) return [hint("Type an airport code", "LFPG, KJFK, CDG… or several at once")];
  const records = await metars(ids, signal);
  const byId = new Map(records.map((r) => [r.icaoId, r]));
  return ids.map((id): Item => {
    const r = byId.get(id);
    if (!r) {
      return {
        id: `missing:${id}`,
        title: id,
        subtitle: "No recent METAR",
        icon: { source: Icons.wind, tint: "gray" },
        section: "My Airports",
        actions: saveActions(id, saved.includes(id)),
      };
    }
    return metarItem(parseMetar(r.rawOb, r.obsTime ? new Date(r.obsTime * 1000) : new Date()), {
      name: stationName(r.name),
      section: "My Airports",
      actions: saveActions(id, saved.includes(id)),
    });
  });
}

/** METAR and TAF periods for the typed airports. */
async function lookup(codes: Code[], signal: AbortSignal): Promise<Item[]> {
  const ids = codes.map((c) => c.icao);
  const [records, forecasts, saved] = await Promise.all([metars(ids, signal), tafs(ids, signal), savedAirports()]);
  const metarById = new Map<string, MetarRecord>(records.map((r) => [r.icaoId, r]));
  const items: Item[] = [];
  for (const code of codes) {
    const id = code.icao;
    const r = metarById.get(id);
    const t = forecasts.find((f) => f.icaoId === id);
    const name = stationName(r?.name ?? t?.name);
    const actions = saveActions(id, saved.includes(id));
    if (!r && !t) {
      items.push({
        id: `missing:${id}`,
        title: `Nothing for ${code.typed}`,
        subtitle: code.guessed
          ? `Read as the US airport ${id}: for other airports, type the 4-letter ICAO code`
          : "No recent METAR or TAF: small airfields often have neither",
        icon: { source: Icons.question, tint: "gray" },
        detail: { markdown: HELP },
      });
      continue;
    }
    const section = `${id}${name ? ` · ${name}` : ""}`;
    if (r) {
      try {
        const m = parseMetar(r.rawOb, r.obsTime ? new Date(r.obsTime * 1000) : new Date());
        items.push(metarItem(m, { name, section: `${section} · METAR`, actions }));
      } catch {
        items.push({ id: `raw:${id}`, title: r.rawOb, section, icon: Icons.wind, actions });
      }
    }
    if (t) {
      try {
        const taf = parseTaf(t.rawTAF, t.issueTime ? new Date(t.issueTime) : new Date());
        taf.periods.forEach((p, i) => items.push(periodItem(taf, p, i, { section: tafSection(taf, name), actions })));
        if (taf.cancelled) {
          items.push({ id: `taf:${id}`, title: "TAF cancelled or missing", section: tafSection(taf, name), actions });
        }
      } catch {
        items.push({ id: `rawtaf:${id}`, title: t.rawTAF, section: `TAF ${id}`, icon: Icons.calendar, actions });
      }
    }
  }
  return items;
}

export default list({
  placeholder: "Airport codes: LFPG, KJFK, CDG…",
  empty: { title: "Nothing found", description: "Type an ICAO code like LFPG", icon: Icons.wind },
  status: (items) => {
    const cats = items.flatMap((i) => i.id?.startsWith("metar:") ? i.accessories?.[0]?.tag ?? [] : []);
    if (!cats.length) return "METAR and TAF from aviationweather.gov";
    const count = (c: string) => cats.filter((x) => x === c).length;
    return ["VFR", "MVFR", "IFR", "LIFR"].filter((c) => count(c)).map((c) => `${count(c)} ${c}`).join(" · ");
  },
  async search(query, { preferences, signal }) {
    const prefs = preferences as Prefs;
    if (!query.trim()) return await myAirports(prefs, signal);
    if (looksLikeReport(query)) {
      return [hint("This looks like a report", "Use Decode METAR or TAF to read it")];
    }
    const codes = parseCodes(query);
    if (!codes.length) return [hint("Type an airport code", "4 letters like LFPG, or 3 like CDG")];
    return await lookup(codes.slice(0, 8), signal);
  },
  actions: [open(SITE, "Open aviationweather.gov", { icon: Icons.globe })],
});
