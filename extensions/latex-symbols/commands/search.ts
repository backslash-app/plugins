import {
  type Action,
  action,
  clipboard,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  storage,
} from "@backslash/api";
import {
  CATEGORIES,
  type Category,
  categoryTitle,
  codePoint,
  countByCategory,
  display,
  htmlEntity,
  jsEscape,
  type LatexSymbol,
  remember,
  searchSymbols,
  template,
  usePackage,
} from "../lib.ts";
import { SYMBOLS } from "../symbols.ts";

const COUNTS = countByCategory(SYMBOLS);
const BY_COMMAND = new Map(SYMBOLS.map((s) => [s.command, s]));

async function recent(): Promise<string[]> {
  const r = await storage.get<string[]>("recent").catch(() => undefined);
  return Array.isArray(r) ? r : [];
}

async function used(s: LatexSymbol) {
  await storage.set("recent", remember(await recent(), s.command)).catch(() => {});
}

/** Copies (or pastes) and remembers the symbol for the "Recently Copied" row. */
const copying = (
  s: LatexSymbol,
  title: string,
  text: string,
  o: { paste?: boolean; icon?: string; shortcut?: string; section?: string } = {},
) =>
  action(title, async () => {
    await used(s);
    if (o.paste) {
      await clipboard.paste(text);
      return;
    }
    await clipboard.write(text);
    return close(`Copied ${text}`);
  }, { icon: o.icon ?? (o.paste ? Icons.paste : Icons.copy), shortcut: o.shortcut, section: o.section });

function symbolItem(s: LatexSymbol, section: string): Item {
  const char = display(s);
  const cp = codePoint(s.char);
  const pkg = usePackage(s);
  const actions: Action[] = [
    copying(s, `Copy ${s.command}`, s.command),
    copying(s, `Copy ${char}`, char, { icon: Icons.text }),
    copying(s, "Paste Command", s.command, { paste: true, shortcut: "<Ctrl>p" }),
    copying(s, "Paste Character", char, { paste: true, shortcut: "<Ctrl><Shift>p" }),
    copy(cp, `Copy Code Point (${cp})`, { icon: Icons.hash, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(s.category === "accents"
      ? [copy(template(s), `Copy ${template(s)}`, { icon: Icons.braces, section: "Copy" })]
      : []),
    copy(`$${s.category === "accents" ? `${s.command}{a}` : s.command}$`, "Copy as Inline Math", {
      icon: Icons.code,
      section: "Copy",
    }),
    copy(jsEscape(s.char), `Copy Escape (${jsEscape(s.char)})`, { icon: Icons.braces, section: "Copy" }),
    copy(htmlEntity(s.char), `Copy HTML Entity (${htmlEntity(s.char)})`, { icon: Icons.globe, section: "Copy" }),
    ...(pkg ? [copy(pkg, `Copy ${pkg}`, { icon: Icons.package, shortcut: "<Ctrl>u", section: "Copy" })] : []),
    open(
      `https://www.compart.com/en/unicode/${cp.split(" ").pop()}`,
      "Open in Unicode Table",
      { icon: Icons.external, section: "More" },
    ),
  ];
  return {
    id: `${section}:${s.command}`,
    title: s.command,
    subtitle: s.names.slice(1).join(", ") || undefined,
    icon: char,
    section,
    keywords: [s.char, ...s.names, cp, s.package].filter(Boolean),
    detail: {
      markdown: `# ${char}\n\n\`${s.command}\``,
      metadata: [
        meta.text("Command", s.command, { icon: Icons.code }),
        meta.text("Character", char),
        meta.text("Code point", cp, { icon: Icons.hash }),
        meta.text("Package", pkg ?? "None (LaTeX)", { icon: Icons.package, color: pkg ? "blue" : "gray" }),
        meta.tags("Category", [categoryTitle(s.category)]),
        ...(s.names.length > 1 ? [meta.text("Also known as", s.names.slice(1).join(", "))] : []),
      ],
    },
    actions,
  };
}

let summary = "";

export default list({
  layout: "grid",
  columns: 8,
  placeholder: "Search LaTeX symbols: alpha, \\leq, arrow, reals, ∀, U+2200…",
  filter: { options: CATEGORIES.map(({ value, title }) => ({ value, title })), default: "all" },
  empty: {
    title: "No symbol found",
    description: "Try a name (integral), a command (\\int), the character (∫) or a code point (U+222B)",
    icon: Icons.search,
  },
  status: () => summary,
  actions: [
    open("https://detexify.kirelabs.org/classify.html", "Draw a Symbol in Detexify", {
      icon: Icons.external,
      section: "More",
    }),
    open("https://ctan.org/pkg/comprehensive", "Open the Comprehensive LaTeX Symbol List", {
      icon: Icons.book,
      section: "More",
    }),
  ],
  async search(query, { filter }) {
    const category = (filter ?? "all") as Category | "all";
    const name = category === "all" ? "" : ` ${categoryTitle(category).toLowerCase()}`;
    if (!query.trim()) {
      const mine = (await recent()).map((c) => BY_COMMAND.get(c)).filter((s): s is LatexSymbol => !!s)
        .filter((s) => category === "all" || s.category === category);
      summary = `${COUNTS[category]}${name} symbols`;
      return [
        ...mine.map((s) => symbolItem(s, "Recently Copied")),
        ...searchSymbols(SYMBOLS, "", category, 1000).map((s) => symbolItem(s, categoryTitle(s.category))),
      ];
    }
    const found = searchSymbols(SYMBOLS, query, category);
    summary = `${found.length} match${found.length === 1 ? "" : "es"}${name ? ` in${name}` : ""}`;
    return found.map((s) => symbolItem(s, "Results"));
  },
});
