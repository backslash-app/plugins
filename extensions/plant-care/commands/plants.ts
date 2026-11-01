import { action, Icons, type Item, list, toast } from "@backslash/api";
import { dueSummary, needsWater, sortPlants, water } from "../lib.ts";
import { live, loadPlants, plantForm, plantItem, speciesItem, syncSubtitle, today, update } from "../plants.ts";
import { SPECIES } from "../species.ts";

let footer = "";

export default list({
  placeholder: "Search your plants by name, room or species…",
  empty: { title: "No plant yet", description: "Press Ctrl+N to add one", icon: Icons.leaf },
  status: () => footer,
  actions: [
    action("New Plant", () => plantForm(), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    action("Water All That Need It", async () => {
      const day = today();
      const due = (await loadPlants()).filter((p) => needsWater(p, day));
      for (const p of due) await update(p.id, (x) => water(x, day));
      await toast(due.length ? `Watered ${due.map((p) => p.name).join(", ")}` : "Nothing needs water today", {
        style: "success",
      });
    }, { icon: Icons.droplet, shortcut: "<Ctrl><Shift>w" }),
  ],
  items: ({ signal }) =>
    live(async (): Promise<Item[]> => {
      const day = today();
      const plants = await loadPlants();
      await syncSubtitle(plants);
      if (!plants.length) {
        footer = "Pick a species below to add your first plant";
        return SPECIES.slice(0, 12).map((s) => ({ ...speciesItem(s), section: "Add a plant" }));
      }
      footer = dueSummary(plants, day);
      return sortPlants(plants, day).map((p) => plantItem(p, day));
    }, signal),
});
