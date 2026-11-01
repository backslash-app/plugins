import { Icons, list } from "@backslash/api";
import { COUNTRIES } from "../data.ts";
import { countryItem } from "../items.ts";
import { byCode, CONTINENTS, continentValues, langOf, search } from "../lib.ts";

const ALL = byCode(COUNTRIES);

export default list({
  placeholder: "Country, capital, code (FR, FRA), +33, .fr or currency",
  filter: {
    options: [{ value: "all", title: "All" }, ...CONTINENTS.map((c) => ({ value: c.value, title: c.en }))],
    default: "all",
  },
  empty: { title: "No country matches", description: "Try a name in English or French, or a code", icon: Icons.globe },
  status: (items) => `${items.length} ${items.length === 1 ? "country" : "countries"}`,
  search(query, ctx) {
    const lang = langOf(ctx.preferences.language);
    const continent = ctx.filter && ctx.filter !== "all" ? ctx.filter : undefined;
    const found = search(COUNTRIES, query).filter((c) => !continent || continentValues(c).includes(continent));
    const sorted = query.trim()
      ? found
      : [...found].sort((a, b) =>
        (lang === "fr" ? a.name.fr : a.name.en).localeCompare(lang === "fr" ? b.name.fr : b.name.en, lang)
      );
    return sorted.map((c) => countryItem(c, ALL, lang));
  },
});
