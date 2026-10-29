import { copy, Icons, type Item, list, open, updateCommandMetadata } from "@backslash/api";
import { INSTALL_BOTTLES } from "../lib.ts";
import { bottles, hasWine, prefixes } from "../system.ts";
import { bottleItem, prefixItem, programItem, wineAppItem } from "../ui.ts";

function installItem(wine: boolean): Item {
  return {
    id: "install",
    title: "No bottle or Wine prefix yet",
    subtitle: "Install Bottles to run Windows programs in tidy, separate bottles",
    icon: { source: Icons.box, tint: "gray" },
    detail: {
      markdown: [
        "**Bottles** keeps each Windows program in its own bottle, with the right Wine version and settings:",
        "",
        "```",
        INSTALL_BOTTLES,
        "```",
        "",
        wine
          ? "Wine is installed: run `winecfg` once to create the default prefix in **~/.wine**."
          : "Plain Wine prefixes (**~/.wine**, winetricks' **~/.local/share/wineprefixes**) are listed here too.",
      ].join("\n"),
    },
    actions: [
      copy(INSTALL_BOTTLES, "Copy Install Command"),
      open("https://flathub.org/apps/com.usebottles.bottles", "Bottles on Flathub", { icon: Icons.globe }),
    ],
  };
}

export default list({
  placeholder: "Filter bottles, programs and Wine prefixes…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "bottles", title: "Bottles" },
      { value: "wine", title: "Wine" },
    ],
    default: "all",
  },
  empty: { title: "Nothing here", description: "Tab shows the other sources", icon: Icons.box },
  status: (items) => {
    const programs = items.filter((i) => i.section === "Programs" || i.section === "Wine Programs").length;
    return `${programs} program${programs === 1 ? "" : "s"}`;
  },
  async *items({ filter }) {
    const showBottles = filter !== "wine", showWine = filter !== "bottles";
    const [found, wine] = await Promise.all([
      showBottles ? bottles() : Promise.resolve({ bottles: [], installs: [] }),
      showWine ? prefixes() : Promise.resolve([]),
    ]);
    const items: Item[] = [
      ...found.bottles.flatMap((b) => b.programs.map((p) => programItem(b, p))),
      ...wine.flatMap((p) => p.programs.map((a) => wineAppItem(a, p))),
      ...found.bottles.map(bottleItem),
      ...wine.map(prefixItem),
    ];
    if (!items.length && filter === "all") {
      yield [installItem(await hasWine())];
      return;
    }
    if (filter === "all") {
      updateCommandMetadata({
        subtitle: found.bottles.length
          ? `${found.bottles.length} bottle${found.bottles.length === 1 ? "" : "s"}`
          : null,
      }).catch(() => {});
    }
    yield items.length ? items : [{
      id: "none",
      title: filter === "wine" ? "No Wine prefix" : "No bottle",
      subtitle: filter === "wine" ? "Run winecfg once to create ~/.wine" : "Create one in Bottles",
      icon: { source: Icons.info, tint: "gray" },
      actions: filter === "wine" ? [] : [copy(INSTALL_BOTTLES, "Copy Install Command")],
    }];
  },
});
