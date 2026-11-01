import { copy, Icons, type Item, list } from "@backslash/api";
import { metarItem, periodItem, tafSection } from "../items.ts";
import { isTaf, metarInWords, parseMetar, parseTaf } from "../lib.ts";

const EXAMPLES = [
  "METAR LFPG 011700Z 03006KT 360V120 CAVOK 10/05 Q1030 NOSIG",
  "KORD 011651Z 27015G28KT 1 1/2SM +TSRA BR SCT008 BKN015CB 22/20 A2992 RMK AO2",
  "TAF LFPG 011700Z 0118/0224 05008KT CAVOK TEMPO 0123/0204 4000 BR PROB30 TEMPO 0205/0208 0800 FG VV///",
];

function examples(): Item[] {
  return EXAMPLES.map((e, i) => ({
    id: `example:${i}`,
    title: e,
    subtitle: e.startsWith("TAF") ? "A TAF" : "A METAR",
    icon: { source: Icons.lightbulb, tint: "yellow" },
    section: "Paste a METAR or TAF, or try one",
    actions: [copy(e, "Copy Example")],
  }));
}

export default list({
  placeholder: "Paste a METAR or TAF…",
  empty: { title: "Nothing to decode", icon: Icons.wind },
  status: (items) => items[0]?.id?.startsWith("example:") ? "Decoded on your computer, no network" : "",
  search(query) {
    const text = query.trim();
    if (!text) return examples();
    try {
      if (isTaf(text)) {
        const taf = parseTaf(text);
        if (taf.cancelled) {
          return [{ id: "cancelled", title: `TAF ${taf.station}: cancelled or missing`, icon: Icons.calendar }];
        }
        return taf.periods.map((p, i) => periodItem(taf, p, i, { section: tafSection(taf) }));
      }
      const m = parseMetar(text);
      return [metarItem(m, { section: m.type, actions: [copy(metarInWords(m), "Copy Decoded METAR")] })];
    } catch (e) {
      return [{
        id: "error",
        title: (e as Error).message,
        subtitle: "Paste a whole report, starting with METAR, SPECI, TAF or the station code",
        icon: { source: Icons.alert, tint: "red" },
      }, ...examples()];
    }
  },
});
