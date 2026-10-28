import { type Action, copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { commonModes, entries, type Entry, modeEntry, parseMode, search, SECTIONS } from "../lib.ts";

function item(e: Entry): Item {
  const section = SECTIONS[e.table];
  const actions: Action[] = e.copies.map(([title, text], i) =>
    copy(text, title, i === 1 ? { shortcut: "<Ctrl><Shift>c" } : i > 1 ? { section: "Copy" } : {})
  );
  if (e.link) actions.push(open(e.link, "Open Documentation", { shortcut: "<Ctrl>o" }));
  return {
    id: e.id,
    title: e.title,
    subtitle: e.subtitle,
    icon: { source: section.icon, tint: e.tint },
    section: section.title,
    accessories: e.accessory ? [{ text: e.accessory }] : [],
    detail: {
      markdown: e.markdown,
      metadata: [
        meta.text("Table", section.title, { icon: section.icon }),
        meta.separator(),
        ...e.facts.map(([label, value]) => meta.text(label, value)),
      ],
    },
    actions,
  };
}

export default list({
  placeholder: "Search 404, .png, 5432, SIGTERM, &nbsp;, KeyA, 137… or type 755 / rwxr-x---",
  filter: {
    options: [
      { value: "all", title: "All" },
      ...Object.entries(SECTIONS).map(([value, s]) => ({ value, title: s.title })),
    ],
  },
  empty: { title: "Nothing matches", description: "Try a code, a name or an extension.", icon: Icons.search },
  status: (items) => {
    const sections = new Set(items.map((i) => i.section)).size;
    return `${items.length} entr${items.length === 1 ? "y" : "ies"}${sections > 1 ? ` in ${sections} tables` : ""}`;
  },
  search(query, { filter }) {
    const table = filter && filter !== "all" ? filter : undefined;
    const mode = parseMode(query);
    const modes: Entry[] = [];
    if (!table || table === "chmod") {
      if (mode !== undefined) modes.push(modeEntry(mode));
      else if (table === "chmod" || !query.trim()) {
        modes.push(...(query.trim() ? search(commonModes(), query) : commonModes()));
      }
    }
    const pool = table === "chmod" ? [] : table ? entries().filter((e) => e.table === table) : entries();
    const found = search(pool, query);
    // "404" is a status code before it is a mode; "755" or "rwxr-x---" is a mode first.
    const exact = found.some((e) => e.keys.includes(query.trim().toLowerCase()));
    const modeFirst = mode !== undefined && (!/^\d+$/.test(query.trim()) || !exact);
    return (modeFirst || !query.trim() ? [...modes, ...found] : [...found, ...modes]).map(item);
  },
});
