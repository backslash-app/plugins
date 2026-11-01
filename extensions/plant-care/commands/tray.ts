import { action, close, Icons, menuBar, type MenuBarItem } from "@backslash/api";
import { dueSummary, needsWater, sortPlants, water, waterDue } from "../lib.ts";
import { loadPlants, syncSubtitle, today, update } from "../plants.ts";

export default menuBar({
  icon: Icons.leaf,
  items: async (): Promise<MenuBarItem[]> => {
    const day = today();
    const plants = sortPlants(await loadPlants(), day);
    await syncSubtitle(plants);
    const due = plants.filter((p) => needsWater(p, day));
    if (!plants.length) return [{ title: "No plant yet: open Plant Care to add one", enabled: false }];
    return [
      { title: dueSummary(plants, day), enabled: false },
      ...due.map((p): MenuBarItem => ({
        id: `water:${p.id}`,
        title: `Water ${p.name}`,
        subtitle: waterDue(p, day).label,
        icon: Icons.droplet,
        section: "Needs Water",
        action: action(`Water ${p.name}`, async () => {
          await update(p.id, (x) => water(x, today()));
          return close(`${p.name} watered`);
        }),
      })),
      ...(due.length > 1
        ? [{
          id: "water-all",
          title: "Water All",
          icon: Icons.droplet,
          action: action("Water All", async () => {
            for (const p of due) await update(p.id, (x) => water(x, today()));
            return close(`Watered ${due.length} plants`);
          }),
        }]
        : []),
      ...plants.filter((p) => !needsWater(p, day)).slice(0, 8).map((p): MenuBarItem => ({
        id: `next:${p.id}`,
        title: p.name,
        subtitle: waterDue(p, day).label,
        section: "Coming Up",
        enabled: false,
      })),
    ];
  },
});
