import { Icons, type Item, list, open } from "@backslash/api";
import { info, search } from "../api.ts";
import { AUR, type Installed, stateOf } from "../lib.ts";
import { foreign, helper } from "../system.ts";
import { helperName, packageItem, type Setup } from "../ui.ts";

let status = "";
let installed: Map<string, Installed> | undefined;

export default list({
  placeholder: "Search the AUR…",
  empty: { title: "No package found", description: "Try another word, or part of the name", icon: Icons.package },
  status: () => status,
  async search(query, { preferences, signal }) {
    const setup: Setup = { helper: await helper(preferences.helper), terminal: preferences.terminal };
    installed ??= new Map((await foreign().catch(() => [])).map((p) => [p.name, p]));
    if (query.trim().length < 2) {
      status = `Installs with ${helperName(setup)}`;
      return [{
        id: "hint",
        title: "Search the Arch User Repository",
        subtitle: "By name or description; the most popular first",
        icon: { source: Icons.search, tint: "blue" },
        actions: [open(`${AUR}/packages`, "Open the AUR", { icon: Icons.globe })],
      }];
    }
    const found = await search(query, signal);
    status = `${found.length} package${found.length === 1 ? "" : "s"} · installs with ${helperName(setup)}`;
    // Dependencies and licenses come with `info`: ask for the ones shown first.
    const top = found.slice(0, 60);
    const details = await info(top.map((p) => p.Name), signal).catch(() => new Map());
    const now = Date.now();
    return found.slice(0, 200).map((p): Item => {
      const full = details.get(p.Name) ?? p;
      const local = installed!.get(p.Name);
      return packageItem(full, setup, {
        installed: local,
        state: local ? stateOf(local, p) : undefined,
        now,
      });
    });
  },
});
