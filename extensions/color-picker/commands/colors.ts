import { action, Icons, type Item, list, meta, refresh } from "@backslash/api";
import {
  describeName,
  type Family,
  FAMILY_NAMES,
  parseColor,
  type Picked,
  PICKER_NAMES,
  pickerInstall,
  toHex,
} from "../lib.ts";
import { family, history, picker, saveHistory } from "../system.ts";
import { colorActions, colorMetadata, pickAction, swatch } from "../ui.ts";

const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

function colorItem(p: Picked, upper: boolean): Item | undefined {
  const c = parseColor(p.hex);
  if (!c) return undefined;
  const hex = toHex(c, { upper });
  return {
    id: p.hex,
    title: hex,
    subtitle: describeName(c),
    icon: swatch(c),
    section: "History",
    keywords: [describeName(c).replace("≈ ", ""), p.hex.slice(1)],
    accessories: [{
      text: new Date(p.at).toLocaleDateString([], { month: "short", day: "numeric" }),
      tooltip: when(p.at),
    }],
    detail: { metadata: colorMetadata(c, upper, [meta.text("Picked", when(p.at), { icon: Icons.clock })]) },
    actions: [
      ...colorActions(c, upper),
      pickAction(upper),
      action("Remove from History", async () => {
        await saveHistory((await history()).filter((h) => h.hex !== p.hex));
        return refresh();
      }, { icon: Icons.trash, destructive: true, shortcut: "<Ctrl>Delete", section: "Danger" }),
      action("Clear History", async () => {
        await saveHistory([]);
        return refresh();
      }, { icon: Icons.trash, destructive: true, confirm: "Forget every picked color?", section: "Danger" }),
    ],
  };
}

function pickItem(tool: string | undefined, install: string, fam: Family | undefined, upper: boolean): Item {
  if (!tool) {
    return {
      id: "missing",
      title: "No color picker found",
      subtitle: "install one to pick from the screen",
      icon: { source: Icons.alert, tint: "orange" },
      section: "Pick",
      detail: {
        markdown: [
          "Backslash picks colors with **hyprpicker** or **grim + slurp** (Hyprland, Sway, wlroots), the **desktop portal** (GNOME, KDE), or **xcolor** / **Gpick** (X11).",
          `**${FAMILY_NAMES[fam ?? "debian"]}**\n\n\`${install}\``,
          "You can still convert colors with **Convert Color**.",
        ].join("\n\n"),
      },
      actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
    };
  }
  return {
    id: "pick",
    title: "Pick Color from Screen",
    subtitle: "copied and kept here",
    icon: { source: Icons.pipette, tint: "pink" },
    section: "Pick",
    keywords: ["pipette", "eyedropper", "pipette", "couleur"],
    detail: {
      markdown: "Click anywhere on the screen: the color is copied as hex and added to this history.",
      metadata: [meta.text("Picker", tool, { icon: Icons.pipette })],
    },
    actions: [pickAction(upper)],
  };
}

export default list({
  placeholder: "Search picked colors…",
  empty: { title: "No colors yet", description: "Pick a color from the screen", icon: Icons.palette },
  status: (items) => {
    const n = items.filter((i) => i.section === "History").length;
    return n ? `${n} color${n > 1 ? "s" : ""}` : "Pick a color to start your history";
  },
  items: async ({ preferences }) => {
    const upper = !!preferences.uppercase;
    const [p, fam, colors] = await Promise.all([picker(), family(), history()]);
    return [
      pickItem(p.tool && PICKER_NAMES[p.tool], pickerInstall(p.session, fam ?? "debian"), fam, upper),
      ...colors.map((c) => colorItem(c, upper)).filter((i): i is Item => !!i),
    ];
  },
});
