import { copy, Icons, type Item, list, meta } from "@backslash/api";
import { ELEMENTS } from "../elements.ts";
import {
  category,
  EXAMPLES,
  formatGrams,
  formatMass,
  FormulaError,
  type MolarMass,
  molarMass,
  subscript,
} from "../lib.ts";

const SYNTAX = [
  "## What you can type",
  "",
  "- A formula with the usual capitals: `H2SO4`, `NaCl`, `C6H12O6` (`CO` is carbon monoxide, `Co` cobalt)",
  "- Parentheses and brackets: `Ca(OH)2`, `K4[Fe(CN)6]`",
  "- Hydrates with `·`, `.` or `*`: `CuSO4·5H2O`, `CuSO4.5H2O`",
  "- Subscripts work too: `H₂O`",
].join("\n");

function exampleItems(): Item[] {
  return EXAMPLES.map((x) => {
    const m = molarMass(x.formula, ELEMENTS);
    return {
      id: `example:${x.formula}`,
      title: subscript(x.formula),
      subtitle: x.title,
      icon: { source: Icons.lightbulb, tint: "yellow" },
      section: "Examples: type a formula",
      accessories: [{ text: `${formatGrams(m.total)} g/mol` }],
      detail: { markdown: SYNTAX },
      actions: [copy(x.formula, "Copy Formula")],
    };
  });
}

function resultItems(m: MolarMass): Item[] {
  const total = `${formatGrams(m.total)} g/mol`;
  const pretty = subscript(m.formula);
  const table = [
    "| Element | Atoms | Atomic mass | Mass | Share |",
    "|---|---:|---:|---:|---:|",
    ...m.shares.map((s) =>
      `| ${s.element.name} (${s.element.symbol}) | ${s.count} | ${formatMass(s.element)} | ${formatGrams(s.mass)} | ${
        (s.fraction * 100).toFixed(2)
      } % |`
    ),
  ].join("\n");
  const breakdown = m.shares.map((s) => `${s.element.symbol}: ${(s.fraction * 100).toFixed(2)} %`).join("\n");
  const markdown = [
    `## ${pretty} = ${total}`,
    "",
    table,
    "",
    m.approximate ? "> Some elements have no standard atomic weight: their mass number is used." : "",
  ].join("\n");
  return [
    {
      id: "total",
      title: total,
      subtitle: `Molar mass of ${pretty}`,
      icon: { source: Icons.calculator, tint: "blue" },
      section: "Molar Mass",
      accessories: [{ text: `${m.atoms} atoms` }],
      detail: {
        stats: [
          { label: "g/mol", value: formatGrams(m.total), color: "blue" },
          { label: "Atoms", value: m.atoms },
          { label: "Elements", value: m.shares.length },
        ],
        markdown,
        metadata: [meta.text("Formula", pretty), meta.text("Hill formula", subscript(m.hill))],
      },
      actions: [
        copy(formatGrams(m.total), "Copy Molar Mass"),
        copy(`${pretty}: ${total}`, "Copy with Formula", { icon: Icons.text }),
        copy(breakdown, "Copy Mass Percentages", { icon: Icons.chartUp, shortcut: "<Ctrl><Shift>p" }),
        copy(m.hill, "Copy Hill Formula", { icon: Icons.code, section: "Copy" }),
      ],
    },
    ...m.shares.map((s): Item => {
      const c = category(s.element.category);
      const percent = `${(s.fraction * 100).toFixed(2)} %`;
      return {
        id: `share:${s.element.symbol}`,
        title: `${s.element.name} (${s.element.symbol})`,
        subtitle: `${s.count} × ${formatMass(s.element)} = ${formatGrams(s.mass)} g/mol`,
        icon: `color:${c.hex}`,
        section: "Composition by Mass",
        accessories: [{ tag: percent, color: c.color }],
        detail: {
          markdown,
          metadata: [
            meta.progress("Share of the mass", s.fraction, percent),
            meta.text("Atoms", s.count),
            meta.text("Atomic mass", formatMass(s.element)),
            meta.text("Mass", `${formatGrams(s.mass)} g/mol`),
          ],
        },
        actions: [
          copy(percent, "Copy Percentage"),
          copy(formatGrams(s.mass), "Copy Mass"),
          copy(breakdown, "Copy All Percentages", { icon: Icons.chartUp, shortcut: "<Ctrl><Shift>p" }),
        ],
      };
    }),
  ];
}

export default list({
  placeholder: "H2SO4 · Ca(OH)2 · CuSO4·5H2O · C6H12O6",
  empty: { title: "Nothing to show", icon: Icons.calculator },
  status: (items) => {
    const first = items[0];
    if (!first) return "";
    if (first.id === "error") return "Not a formula";
    if (first.id?.startsWith("example:")) return "Molar mass and mass percent of each element";
    return String(first.subtitle ?? "");
  },
  search(query) {
    if (!query.trim()) return exampleItems();
    try {
      return resultItems(molarMass(query, ELEMENTS));
    } catch (e) {
      if (!(e instanceof FormulaError)) throw e;
      return [{
        id: "error",
        title: e.message,
        subtitle: "Not a formula",
        icon: { source: Icons.alert, tint: "red" },
        detail: { markdown: SYNTAX },
        actions: [copy(query, "Copy Input")],
      }, ...exampleItems()];
    }
  },
});
