import { copy, Icons, type Item, list, meta, open, paste } from "@backslash/api";
import data from "../utilities.json" with { type: "json" };
import { docUrl } from "../docs.ts";
import {
  colorHex,
  type Data,
  expand,
  groupStyle,
  index,
  type Indexed,
  POPULAR,
  px,
  resolve,
  rule,
  search,
  summary,
  telling,
  themeVars,
} from "../lib.ts";

const DATA = data as Data;
const THEME = new Map(DATA.theme);
let INDEX: Indexed[] | undefined;
const all = () => (INDEX ??= index(expand(DATA), THEME));

function classItem(u: Indexed, section?: string): Item {
  const css = rule(u);
  const resolved = resolve(css, THEME);
  const vars = themeVars(css, THEME);
  const { text, px: pixels } = summary(u, THEME);
  const style = groupStyle(u.doc?.group);
  const colorValue = u.color ? THEME.get(`--color-${u.color}`) : undefined;
  const hex = colorValue ? colorHex(colorValue) : undefined;
  const computed = telling(u.css).map(([p, v]) => {
    const r = resolve(v, THEME);
    const inPx = px(r);
    return `${p}: ${r}${inPx ? ` /* ${inPx} */` : ""};`;
  });
  return {
    id: u.cls,
    title: u.cls,
    subtitle: text,
    icon: hex ? `color:${hex}` : { source: style.icon, tint: style.tint },
    section: section ?? u.doc?.group ?? "Other",
    accessories: [
      ...(pixels ? [{ text: pixels, tooltip: "At the default 16px root font size" }] : []),
      ...(hex ? [{ text: hex }] : []),
    ],
    detail: {
      markdown: [
        "```css",
        css,
        "```",
        ...(resolved !== css ? ["", "**Computed**", "", "```css", computed.join("\n"), "```"] : []),
      ].join("\n"),
      metadata: [
        ...(u.doc ? [meta.text("Docs", u.doc.title, { icon: Icons.book })] : []),
        ...(u.doc ? [meta.text("Category", u.doc.group, { icon: style.icon, color: style.tint })] : []),
        ...(hex && colorValue
          ? [meta.text("Color", hex, { icon: `color:${hex}` }), meta.text("OKLCH", colorValue)]
          : []),
        ...(vars.length ? [meta.separator(), ...vars.slice(0, 6).map(([n, v]) => meta.text(n, v))] : []),
        meta.separator(),
        meta.text("Tailwind CSS", `v${DATA.version}`, { icon: Icons.tag }),
        ...(u.doc ? [meta.link("Page", `tailwindcss.com/docs/${u.doc.slug}`, docUrl(u.doc.slug))] : []),
      ],
    },
    actions: [
      copy(u.cls, "Copy Class"),
      paste(u.cls, "Paste Class"),
      copy(css, "Copy CSS", { icon: Icons.code, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(computed.join("\n"), "Copy Computed CSS", { icon: Icons.code, section: "Copy" }),
      copy(`@apply ${u.cls};`, "Copy as @apply", { icon: Icons.braces, section: "Copy" }),
      ...(hex ? [copy(hex, "Copy Hex", { icon: Icons.palette, section: "Copy" })] : []),
      ...(u.doc
        ? [
          open(docUrl(u.doc.slug), `Open “${u.doc.title}” Docs`, {
            icon: Icons.book,
            shortcut: "<Ctrl>o",
            section: "Docs",
          }),
        ]
        : []),
    ],
  };
}

let last = "";

export default list({
  placeholder: "Search classes, CSS properties or values (p-4, padding, 16px, red-500)…",
  empty: {
    title: "No utility found",
    description: "Try a class (rounded-lg), a property (letter-spacing) or a value (1.5rem).",
    icon: Icons.search,
  },
  status: () => last,
  search(query) {
    const utilities = all();
    if (!query.trim()) {
      last = `${utilities.length.toLocaleString("en")} utilities · Tailwind CSS v${DATA.version}`;
      const byClass = new Map(utilities.map((u) => [u.cls, u]));
      return POPULAR.flatMap((c) => byClass.has(c) ? [classItem(byClass.get(c)!, "Popular")] : []);
    }
    const found = search(utilities, query);
    last = found.length === 60 ? "Best 60 matches" : `${found.length} match${found.length === 1 ? "" : "es"}`;
    return found.map((u) => classItem(u));
  },
});
