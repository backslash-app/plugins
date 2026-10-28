import { copy, Icons, type Item, list, meta, open, submenu } from "@backslash/api";
import data from "../utilities.json" with { type: "json" };
import { docUrl } from "../docs.ts";
import { capitalize, COLOR_PREFIXES, type Data, palette, type PaletteColor, parseOklch } from "../lib.ts";

const DATA = data as Data;

const rgbOf = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${n >> 16} ${(n >> 8) & 255} ${n & 255})`;
};

function colorItem(c: PaletteColor): Item {
  const variable = `var(--color-${c.name})`;
  const o = parseOklch(c.value);
  return {
    id: c.name,
    title: c.shade ?? capitalize(c.name),
    subtitle: c.name,
    icon: `color:${c.hex}`,
    section: c.shade ? capitalize(c.family) : "Black & White",
    keywords: [c.name, c.family, c.hex, c.hex.slice(1), `bg-${c.name}`, `text-${c.name}`],
    detail: {
      metadata: [
        meta.text("Color", c.name, { icon: `color:${c.hex}` }),
        meta.text("Hex", c.hex),
        meta.text("RGB", rgbOf(c.hex)),
        meta.text(o ? "OKLCH" : "Value", c.value),
        ...(o ? [meta.progress("Lightness", o.l, `${Math.round(o.l * 1000) / 10} %`)] : []),
        meta.separator(),
        meta.text("Variable", `--color-${c.name}`, { icon: Icons.braces }),
        meta.tags("Classes", [`bg-${c.name}`, `text-${c.name}`, `border-${c.name}`]),
        meta.link("Docs", "tailwindcss.com/docs/colors", docUrl("colors")),
      ],
    },
    actions: [
      copy(c.hex, "Copy Hex"),
      copy(c.value, o ? "Copy OKLCH" : "Copy Value"),
      submenu(
        "Copy Class…",
        COLOR_PREFIXES.map((p, i) =>
          copy(`${p}-${c.name}`, `${p}-${c.name}`, { icon: Icons.code, ...(i === 0 ? { shortcut: "<Ctrl>b" } : {}) })
        ),
        { icon: Icons.code, shortcut: "<Ctrl>k" },
      ),
      copy(`bg-${c.name}`, `Copy bg-${c.name}`, { icon: Icons.code, section: "Copy", shortcut: "<Ctrl><Shift>b" }),
      copy(`text-${c.name}`, `Copy text-${c.name}`, { icon: Icons.code, section: "Copy", shortcut: "<Ctrl><Shift>t" }),
      copy(variable, "Copy CSS Variable", { icon: Icons.braces, section: "Copy" }),
      copy(`--color-${c.name}: ${c.value};`, "Copy @theme Declaration", { icon: Icons.braces, section: "Copy" }),
      copy(rgbOf(c.hex), "Copy RGB", { icon: Icons.palette, section: "Copy" }),
      open(docUrl("colors"), "Open Colors Docs", { icon: Icons.book, section: "Docs" }),
    ],
  };
}

export default list({
  layout: "grid",
  columns: 11,
  placeholder: "Filter colors by name, shade or hex…",
  status: (items) =>
    `${items.length} colors · ${DATA.colors.length} families × 11 shades · Tailwind CSS v${DATA.version}`,
  items: () => palette(DATA).map(colorItem),
});
