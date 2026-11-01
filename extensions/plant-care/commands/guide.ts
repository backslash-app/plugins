import { Icons, list } from "@backslash/api";
import { speciesItem } from "../plants.ts";
import { SPECIES } from "../species.ts";

export default list({
  placeholder: "Search a plant: monstera, basilic, pet safe, toxic…",
  empty: { title: "Not in the guide", icon: Icons.leaf },
  status: `${SPECIES.length} plants · general care for a pot indoors`,
  filter: { options: ["All", "Pet Safe", "Low Light", "Succulents & Sun"], default: "All" },
  items: ({ filter }) => {
    const sorted = [...SPECIES].sort((x, y) => x.name.localeCompare(y.name));
    const kept = filter === "Pet Safe"
      ? sorted.filter((s) => !s.toxic)
      : filter === "Low Light"
      ? sorted.filter((s) => s.light === "low" || s.light === "medium")
      : filter === "Succulents & Sun"
      ? sorted.filter((s) => s.light === "sun")
      : sorted;
    return kept.map(speciesItem);
  },
});
