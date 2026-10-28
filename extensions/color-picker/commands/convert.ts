import { action, copy, Icons, type Item, list, meta, paste, toast } from "@backslash/api";
import { describeName, formats, parseColor, type RGB, toHex } from "../lib.ts";
import { history, remember } from "../system.ts";
import { colorActions, colorMetadata, swatch } from "../ui.ts";

const save = (c: RGB) =>
  action("Save to History", async () => {
    await remember(toHex({ ...c, a: 1 }));
    await toast("Saved to Color History", { style: "success" });
  }, { icon: Icons.history, shortcut: "<Ctrl>s", section: "History" });

function formatItems(c: RGB, upper: boolean): Item[] {
  const hex = toHex(c, { upper });
  return formats(c, { upper }).map((f) => ({
    id: f.id,
    title: f.value,
    subtitle: f.title,
    icon: swatch(c),
    section: describeName(c),
    detail: { metadata: colorMetadata(c, upper) },
    actions: [
      copy(f.value, `Copy ${f.title}`),
      paste(f.value, `Paste ${f.title}`),
      ...colorActions(c, upper).slice(2),
      save(c),
    ],
    keywords: [hex],
  }));
}

export default list({
  placeholder: "Type a color: #ff6347, rgb(255 99 71), hsl(9 100% 64%), oklch(70% 0.2 32), tomato…",
  empty: {
    title: "Not a color I can read",
    description:
      "Try #ff6347, rgb(255, 99, 71), hsl(9, 100%, 64%), hwb(9 28% 0%), oklch(69.6% 0.196 32.3) or a CSS name",
    icon: Icons.palette,
  },
  status: "HEX · RGB · HSL · OKLCH · HSV · HWB · CSS names",
  async search(query, { preferences }) {
    const upper = !!preferences.uppercase;
    const c = parseColor(query);
    if (c) return formatItems(c, upper);
    if (query.trim()) return [];
    // Nothing typed yet: the recent picks, to convert in one keystroke.
    return (await history()).slice(0, 8).flatMap((p) => {
      const rc = parseColor(p.hex);
      return rc
        ? [{
          id: p.hex,
          title: toHex(rc, { upper }),
          subtitle: describeName(rc),
          icon: swatch(rc),
          section: "Recent Colors",
          detail: { metadata: colorMetadata(rc, upper, [meta.text("Tip", "Type any color to convert it")]) },
          actions: colorActions(rc, upper),
        }]
        : [];
    });
  },
});
