import { copy, Icons, type Item, list } from "@backslash/api";
import { findPlaces, lookupCode } from "../api.ts";
import { countryName, countryOf, guessCountry, parseQuery, ZIPPOPOTAM } from "../lib.ts";
import { placeItem } from "../items.ts";

const EXAMPLES = [
  ["75011", "A code in your default country"],
  ["us 90210", "A code in another country"],
  ["SW1A 1AA", "A British code (its outward part)"],
  ["Lyon", "The codes of a place"],
  ["de Berlin", "A place in another country"],
  ["Springfield, us", "Or with the country after a comma"],
];

function examples(home: string): Item[] {
  return EXAMPLES.map(([query, what]) => ({
    id: `example:${query}`,
    title: query,
    subtitle: what,
    icon: { source: Icons.lightbulb, tint: "yellow" },
    section: `Type a code or a place · default country ${countryName(home)}`,
    detail: {
      markdown: [
        "## Postal codes",
        "",
        "- A **code** finds its places: `75011`, `us 90210`, `90210 us`, `de:10115`.",
        "- A **place** finds its codes: `Lyon`, `de Berlin`, `Springfield, us`.",
        "",
        "Codes come from Zippopotam.us, which covers about 70 countries; in Britain and Canada it",
        "knows only the first part of a code (`SW1A`, `H2X`). Places and the other countries come",
        "from Open-Meteo's geocoding.",
        "",
        `Countries with codes: ${[...ZIPPOPOTAM].join(", ")}.`,
      ].join("\n"),
    },
    actions: [copy(query, "Copy Example")],
  }));
}

export default list({
  placeholder: "75011, us 90210, SW1A 1AA, Lyon or de Berlin",
  empty: { title: "Nothing found", description: "Check the code, or add a country: us 90210", icon: Icons.mail },
  status: (items) => {
    const n = items.filter((i) => !i.id?.startsWith("example:")).length;
    return n ? `${n} ${n === 1 ? "place" : "places"}` : "";
  },
  async search(query, ctx) {
    const home = countryOf(ctx.preferences.country) ?? "FR";
    const q = parseQuery(query);
    if (q.kind === "empty") return examples(home);
    if (q.kind === "code") {
      const country = q.country ?? guessCountry(q.code, home);
      let places = await lookupCode(country, q.code, ctx.signal);
      // A bare code that isn't one in the default country: try it anywhere.
      if (!places.length && !q.country && country === home) {
        places = (await findPlaces(q.code, undefined, ctx.signal)).filter((p) =>
          p.codes.some((c) => c.startsWith(q.code))
        ).map((p) => ({ ...p, codes: [q.code] }));
      }
      return places.map((p) => placeItem(p, `${q.code} · ${countryName(p.country, p.countryName)}`, q.code));
    }
    let places = await findPlaces(q.name, q.country ?? home, ctx.signal);
    if (!places.length && !q.country) places = await findPlaces(q.name, undefined, ctx.signal);
    return places.map((p, i) => placeItem(p, i === 0 ? "Best match" : "Other places"));
  },
});
