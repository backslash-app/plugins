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
  refresh,
  storage,
  toast,
} from "@backslash/api";
import {
  charOf,
  className,
  codePoint,
  countBySet,
  cssContent,
  type Glyph,
  htmlEntity,
  jsEscape,
  prefixOf,
  remember,
  searchGlyphs,
  SET_NAMES,
  SETS,
  shortTitle,
} from "../lib.ts";
import { download, glyphs, POPULAR, recent, reset } from "../glyphs.ts";

const CHEAT_SHEET = "https://www.nerdfonts.com/cheat-sheet";
const DOWNLOADS = "https://www.nerdfonts.com/font-downloads";

async function used(name: string) {
  await storage.set("recent", remember(await recent(), name)).catch(() => {});
}

function glyphItem([name, code]: Glyph, section: string): Item {
  const char = charOf(code);
  const cls = className(name);
  const actions: Action[] = [
    action("Copy Glyph", async () => {
      await used(name);
      await clipboard.write(char);
      return close(`Copied ${cls}`);
    }, { icon: Icons.copy }),
    action("Paste Glyph", async () => {
      await used(name);
      await clipboard.paste(char);
    }, { icon: Icons.paste }),
    copy(cls, `Copy Class (${cls})`, { icon: Icons.code, shortcut: "<Ctrl>period", section: "Copy" }),
    copy(codePoint(code), `Copy Code Point (${codePoint(code)})`, {
      icon: Icons.hash,
      shortcut: "<Ctrl><Shift>c",
      section: "Copy",
    }),
    copy(jsEscape(code), `Copy Escape (${jsEscape(code)})`, { icon: Icons.braces, section: "Copy" }),
    copy(htmlEntity(code), `Copy HTML Entity (${htmlEntity(code)})`, { icon: Icons.globe, section: "Copy" }),
    copy(cssContent(code), `Copy CSS Content (${cssContent(code)})`, { icon: Icons.palette, section: "Copy" }),
    copy(`<i class="nf ${cls}"></i>`, "Copy HTML Tag", { icon: Icons.code, section: "Copy" }),
  ];
  return {
    id: `${section}:${name}`,
    title: shortTitle(name),
    subtitle: cls,
    icon: char,
    section,
    keywords: [cls, code],
    detail: {
      markdown: `# ${char}`,
      metadata: [
        meta.text("Class", cls, { icon: Icons.code }),
        meta.text("Code point", codePoint(code), { icon: Icons.hash }),
        meta.text("HTML", htmlEntity(code)),
        meta.tags("Set", [SET_NAMES[prefixOf(name)] ?? prefixOf(name)]),
      ],
    },
    actions,
  };
}

const updateAction = action("Update Glyph List", async () => {
  await toast("Downloading glyphnames.json…");
  const data = await download();
  reset();
  await toast(`${data.glyphs.length.toLocaleString("en-US")} glyphs`, {
    style: "success",
    message: data.version ? `Nerd Fonts ${data.version}` : undefined,
  });
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Glyphs" });

const globalActions: Action[] = [
  updateAction,
  open(CHEAT_SHEET, "Open Nerd Fonts Cheat Sheet", { icon: Icons.globe, section: "Glyphs" }),
  open(DOWNLOADS, "Download a Nerd Font", { icon: Icons.download, section: "Glyphs" }),
];

let summary = "";

export default list({
  layout: "grid",
  columns: 8,
  placeholder: "Search Nerd Font icons: folder, git branch, nf-md-…, f07c",
  filter: { options: SETS.map(({ value, title }) => ({ value, title })), default: "all" },
  empty: {
    title: "No glyph found",
    description:
      "Try another word or set. Glyphs show only if your font has them: install a Nerd Font (Ctrl+K → Download a Nerd Font).",
    icon: Icons.font,
  },
  status: () => summary,
  actions: globalActions,
  async search(query, { filter }) {
    const data = await glyphs();
    const set = filter ?? "all";
    const counts = countBySet(data.glyphs);
    const setTitle = SETS.find((s) => s.value === set)?.title ?? "All";
    const about = data.source === "fallback"
      ? `Offline: ${data.glyphs.length} popular glyphs`
      : `${counts[set].toLocaleString("en-US")} glyphs${set === "all" ? "" : ` in ${setTitle}`}${
        data.version ? ` · Nerd Fonts ${data.version}` : ""
      }`;
    const items: Item[] = [];
    if (data.source === "fallback") {
      items.push({
        id: "offline",
        title: "Offline",
        subtitle: `Could not download the glyph list: ${data.error}`,
        icon: { source: Icons.wifiOff, tint: "orange" },
        section: "Glyph list",
        detail: { markdown: `Showing ${data.glyphs.length} popular glyphs. ${data.error ?? ""}` },
        actions: [updateAction],
      });
    }
    if (!query.trim()) {
      const names = new Map(data.glyphs.map((g) => [g[0], g]));
      const mine = (await recent()).map((n) => names.get(n)).filter((g): g is Glyph => !!g)
        .filter((g) => searchGlyphs([g], "", set).length);
      items.push(...mine.map((g) => glyphItem(g, "Recently Copied")));
      const browse = set === "all" ? POPULAR.filter((g) => names.has(g[0])) : searchGlyphs(data.glyphs, "", set, 240);
      items.push(...browse.map((g) => glyphItem(g, set === "all" ? "Popular" : setTitle)));
      summary = about;
      return items;
    }
    const found = searchGlyphs(data.glyphs, query, set);
    summary = `${found.length === 240 ? "240+" : found.length} match${found.length === 1 ? "" : "es"} · ${about}`;
    items.push(...found.map((g) => glyphItem(g, "Results")));
    return items;
  },
});
