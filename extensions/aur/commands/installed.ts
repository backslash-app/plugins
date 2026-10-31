import { action, close, Icons, type Item, list, meta, open, refresh, updateCommandMetadata } from "@backslash/api";
import { info } from "../api.ts";
import { type AurPackage, type Installed, isVcs, packageUrl, type State, stateOf, updateAllCommand } from "../lib.ts";
import { foreign, helper, inTerminal } from "../system.ts";
import { packageItem, removeAction, type Setup, STATE_LOOK } from "../ui.ts";

const SECTIONS: Record<State, string> = {
  update: "Updates",
  current: "Installed",
  newer: "Installed",
  missing: "Not in the AUR",
};
const ORDER: State[] = ["update", "current", "newer", "missing"];

let status = "";

function missingItem(p: Installed, setup: Setup): Item {
  return {
    id: p.name,
    title: p.name,
    subtitle: p.version,
    icon: { source: Icons.package, tint: "gray" },
    section: SECTIONS.missing,
    accessories: [{ tag: "Not in the AUR", color: "gray" }],
    detail: {
      markdown:
        "This package came from no repository, and the AUR has no package by this name: you built it yourself, or it was removed or renamed in the AUR. It gets no updates.",
      metadata: [meta.text("Installed", p.version, { icon: Icons.tag }), meta.text("State", STATE_LOOK.missing.text)],
    },
    actions: [
      open(packageUrl(p.name), "Look for It in the AUR", { icon: Icons.globe }),
      removeAction(p.name, setup),
    ],
  };
}

export default list({
  placeholder: "Filter AUR packages…",
  empty: {
    title: "No AUR package installed",
    description: "Packages you build from the AUR show up here",
    icon: Icons.package,
  },
  status: () => status,
  async items({ preferences, signal }) {
    const local = await foreign(signal);
    const setup: Setup = { helper: await helper(preferences.helper), terminal: preferences.terminal };
    const aur: Map<string, AurPackage> = local.length ? await info(local.map((p) => p.name), signal) : new Map();
    const rows = local.map((p) => ({ p, a: aur.get(p.name), state: stateOf(p, aur.get(p.name)) }))
      .sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state) || x.p.name.localeCompare(y.p.name));
    const updates = rows.filter((r) => r.state === "update");
    const vcs = rows.filter((r) => r.a && isVcs(r.p.name)).length;
    status = [
      `${local.length} AUR package${local.length === 1 ? "" : "s"}`,
      ...(updates.length ? [`${updates.length} update${updates.length === 1 ? "" : "s"}`] : []),
      ...(vcs ? [`${vcs} built from git (checked by ${setup.helper ?? "your helper"} --devel)`] : []),
    ].join(" · ");
    updateCommandMetadata({
      subtitle: updates.length ? `${updates.length} update${updates.length === 1 ? "" : "s"}` : null,
    }).catch(() => {});

    const updateAll = setup.helper
      ? action(`Update All AUR Packages with ${setup.helper}`, () => {
        const term = inTerminal(updateAllCommand(setup.helper!), setup.terminal);
        return close(`Running in ${term}…`);
      }, { icon: Icons.download, section: "All Packages", shortcut: "<Ctrl>u" })
      : undefined;
    const now = Date.now();
    return rows.map(({ p, a, state }) => {
      if (!a) return missingItem(p, setup);
      const item = packageItem(a, setup, { installed: p, state, section: SECTIONS[state], now });
      return {
        ...item,
        subtitle: state === "update" ? `${p.version} → ${a.Version}` : item.subtitle,
        actions: [
          ...(item.actions ?? []),
          ...(updateAll ? [updateAll] : []),
          action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" }),
        ],
      };
    });
  },
});
