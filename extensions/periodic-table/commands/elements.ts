import { copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { ELEMENTS } from "../elements.ts";
import {
  block,
  CATEGORIES,
  type Category,
  category,
  categoryName,
  countByCategory,
  type Element,
  formatDensity,
  formatDiscovered,
  formatMass,
  formatTemperature,
  group,
  period,
  prettyConfiguration,
  searchElements,
  shells,
  state,
  wikipedia,
} from "../lib.ts";

const COUNTS = countByCategory(ELEMENTS);
const STATE_TITLE = { solid: "Solid", liquid: "Liquid", gas: "Gas", unknown: "Unknown" } as const;

function summary(e: Element): string {
  const g = group(e.number);
  const where = g === null
    ? `period ${period(e.number)}, in the f-block below the table`
    : `period ${period(e.number)}, group ${g}, ${block(e.number)}-block`;
  const s = state(e);
  return `${categoryName(e.category)} in ${where}. ${
    s === "unknown" ? "Too short-lived to know its state." : `${STATE_TITLE[s]} at room temperature.`
  }`;
}

function elementItem(e: Element, section: string): Item {
  const c = category(e.category);
  const mass = formatMass(e);
  const config = prettyConfiguration(e.configuration);
  const notes = [
    e.massIsMassNumber ? `No stable isotope: ${mass} is the mass number of its longest-lived isotope.` : "",
    e.number >= 104 ? "Its electron configuration is a prediction." : "",
    e.symbol === "As" ? "Under normal pressure arsenic sublimes at 887 K; it only melts under pressure." : "",
  ].filter(Boolean);
  return {
    id: e.symbol,
    title: `${e.number} ${e.symbol}`,
    subtitle: e.name,
    icon: `color:${c.hex}`,
    section,
    keywords: [e.name, e.nameFr, e.symbol, String(e.number)],
    detail: {
      stats: [
        { label: "Atomic number", value: e.number },
        { label: "Symbol", value: e.symbol, color: c.color },
        { label: "Atomic mass", value: mass },
      ],
      markdown: [`## ${e.name}${e.nameFr !== e.name ? ` · ${e.nameFr}` : ""}`, "", summary(e), "", ...notes]
        .join("\n"),
      metadata: [
        meta.tags("Category", [{ text: categoryName(e.category), color: c.color }]),
        meta.text("Period", period(e.number)),
        meta.text("Group", group(e.number) ?? "None (f-block)"),
        meta.text("Block", block(e.number)),
        meta.separator(),
        meta.text("Electron configuration", config, { icon: Icons.layers }),
        meta.text("Electrons per shell", shells(e, ELEMENTS).join(", ")),
        meta.text("Electronegativity", e.electronegativity ?? "Unknown"),
        meta.separator(),
        meta.text("State at 25 °C", STATE_TITLE[state(e)]),
        meta.text("Melting point", formatTemperature(e.melting), { icon: Icons.thermometer }),
        meta.text("Boiling point", formatTemperature(e.boiling), { icon: Icons.thermometer }),
        meta.text("Density", formatDensity(e.density)),
        meta.text("Discovered", formatDiscovered(e.discovered), { icon: Icons.calendar }),
      ],
    },
    actions: [
      copy(e.symbol, "Copy Symbol"),
      copy(e.name, "Copy Name", { icon: Icons.text }),
      copy(mass, "Copy Atomic Mass", { icon: Icons.hash, shortcut: "<Ctrl><Shift>m" }),
      copy(config, "Copy Electron Configuration", { icon: Icons.layers, section: "Copy" }),
      copy(e.configuration, "Copy Configuration as Plain Text", { icon: Icons.layers, section: "Copy" }),
      copy(e.nameFr, "Copy French Name", { icon: Icons.text, section: "Copy" }),
      copy(String(e.number), "Copy Atomic Number", { icon: Icons.hash, section: "Copy" }),
      open(wikipedia(e), "Open in Wikipedia", { icon: Icons.book, section: "More", shortcut: "<Ctrl>o" }),
      open(wikipedia(e, "fr"), "Open in French Wikipedia", { icon: Icons.book, section: "More" }),
    ],
  };
}

let status = "";

export default list({
  layout: "grid",
  columns: 9,
  placeholder: "Search elements: Fe, 26, iron, fer, halogen…",
  filter: {
    options: [{ value: "all", title: "All" }, ...CATEGORIES.map(({ value, title }) => ({ value, title }))],
    default: "all",
  },
  empty: {
    title: "No element found",
    description: "Try a symbol (Na), a number (11) or a name in English or French (sodium)",
    icon: Icons.search,
  },
  status: () => status,
  search(query, { filter }) {
    const only = (filter ?? "all") as Category | "all";
    const found = searchElements(ELEMENTS, query, only);
    const where = only === "all" ? "" : ` · ${category(only).title}`;
    if (!query.trim()) {
      status = `${COUNTS[only]} elements${where}`;
      return found.map((e) => elementItem(e, only === "all" ? `Period ${period(e.number)}` : category(only).title));
    }
    status = `${found.length} match${found.length === 1 ? "" : "es"}${where}`;
    return found.map((e) => elementItem(e, "Results"));
  },
});
