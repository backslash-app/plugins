import {
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  submenu,
} from "@backslash/api";
import {
  areaText,
  type Country,
  densityText,
  driveText,
  flag,
  label,
  type Lang,
  mapUrl,
  nameOf,
  people,
  summary,
  wikipediaUrl,
  words,
} from "./lib.ts";
import { UPDATED } from "./data.ts";

function metadata(c: Country, all: Map<string, Country>, lang: Lang): Metadata[] {
  const t = words(lang);
  const lines: Metadata[] = [];
  const text = (k: string, v: string | undefined, icon?: string) =>
    v && lines.push(meta.text(k, v, icon ? { icon } : {}));
  text(c.capitals.length > 1 ? t.capitals : t.capital, c.capitals.map((x) => label(x, lang)).join(", "), Icons.home);
  if (c.continents.length) lines.push(meta.tags(t.continent, c.continents.map((x) => label(x, lang))));
  text(t.demonym, c.demonym?.[lang] ?? c.demonym?.en, Icons.person);
  lines.push(meta.separator());
  if (c.languages.length) lines.push(meta.tags(t.languages, c.languages.map((x) => label(x, lang))));
  if (c.currencies.length) {
    lines.push(meta.tags(t.currencies, c.currencies.map((x) => ({ text: `${x.code} · ${x.name}`, color: "green" }))));
  }
  text(t.calling, c.calling.join(", "), Icons.hash);
  text(t.tld, c.tld.join(", "), Icons.globe);
  text(t.drive, driveText(c, lang), Icons.arrowRight);
  if (c.zones.length) lines.push(meta.tags(t.zones, c.zones));
  lines.push(meta.separator());
  const neighbors = c.borders.map((b) => all.get(b)).filter((x): x is Country => !!x);
  text(t.borders, neighbors.length ? neighbors.map((n) => `${flag(n.a2)} ${nameOf(n, lang)}`).join(", ") : t.island);
  text(t.codes, [c.a2, c.a3].filter(Boolean).join(" · "), Icons.tag);
  return lines;
}

function markdown(c: Country, lang: Lang): string {
  const t = words(lang);
  const year = c.populationYear ? ` (${c.populationYear})` : "";
  return [
    `# ${flag(c.a2)} ${nameOf(c, lang)}`,
    "",
    lang === "fr" ? `*${c.name.en}*` : c.name.fr !== c.name.en ? `*${c.name.fr}*` : "",
    "",
    c.population ? `${t.population}${year}: **${people(c.population, lang)}**` : "",
    c.area ? `${t.area}: **${areaText(c.area, lang)}**` : "",
    "",
    `<small>Wikidata, ${UPDATED}</small>`,
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

function actions(c: Country, all: Map<string, Country>, lang: Lang): Action[] {
  const neighbors = c.borders.map((b) => all.get(b)).filter((x): x is Country => !!x);
  const capital = c.capitals.map((x) => label(x, lang)).join(", ");
  const map = mapUrl(c);
  return [
    copy(nameOf(c, lang), "Copy Name", { section: "Copy" }),
    ...(neighbors.length
      ? [
        submenu(
          `Neighbors (${neighbors.length})`,
          neighbors.map((n) =>
            action(`${flag(n.a2)} ${nameOf(n, lang)}`, () => countryView(n, all, lang), { icon: Icons.arrowRight })
          ),
          { icon: Icons.globe, shortcut: "<Ctrl>n", section: "Explore" },
        ),
      ]
      : []),
    open(wikipediaUrl(c, lang), "Open in Wikipedia", { icon: Icons.book, shortcut: "<Ctrl>o", section: "Explore" }),
    ...(map ? [open(map, "Open Map", { icon: Icons.pin, shortcut: "<Ctrl>m", section: "Explore" })] : []),
    copy(summary(c, all, lang), "Copy Summary", { icon: Icons.text, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(capital ? [copy(capital, "Copy Capital", { icon: Icons.home, section: "Copy" })] : []),
    ...(c.calling.length ? [copy(c.calling[0], "Copy Calling Code", { icon: Icons.hash, section: "Copy" })] : []),
    copy(flag(c.a2), "Copy Flag Emoji", { icon: Icons.flag, section: "Copy" }),
    copy(c.a2, "Copy ISO Code", { icon: Icons.tag, section: "Copy" }),
  ];
}

export function countryItem(c: Country, all: Map<string, Country>, lang: Lang, section?: string): Item {
  const capital = c.capitals.map((x) => label(x, lang)).join(", ");
  return {
    id: c.a2,
    title: nameOf(c, lang),
    subtitle: capital || undefined,
    icon: flag(c.a2),
    section,
    accessories: [
      ...(c.population ? [{ text: people(c.population, lang), icon: Icons.person }] : []),
      { tag: c.a2 },
    ],
    detail: {
      markdown: markdown(c, lang),
      stats: [
        ...(c.population ? [{ label: words(lang).population, value: people(c.population, lang) }] : []),
        ...(c.area ? [{ label: words(lang).area, value: `${Math.round(c.area).toLocaleString("en-US")} km²` }] : []),
        ...(densityText(c, lang) ? [{ label: words(lang).density, value: densityText(c, lang)! }] : []),
      ],
      metadata: metadata(c, all, lang),
    },
    actions: actions(c, all, lang),
  };
}

/** One country and its neighbors, opened from the Neighbors submenu. */
export function countryView(c: Country, all: Map<string, Country>, lang: Lang): ListSpec {
  const neighbors = c.borders.map((b) => all.get(b)).filter((x): x is Country => !!x);
  return list({
    title: nameOf(c, lang),
    placeholder: `${nameOf(c, lang)} and its neighbors`,
    items: [
      countryItem(c, all, lang, nameOf(c, lang)),
      ...neighbors.map((n) => countryItem(n, all, lang, words(lang).borders)),
    ],
  });
}
