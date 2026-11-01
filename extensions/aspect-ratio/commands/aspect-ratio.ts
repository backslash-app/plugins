import { Icons, list } from "@backslash/api";
import { parseQuery } from "../lib.ts";
import { itemsFor } from "../ui.ts";

export default list({
  placeholder: '1920x1080 · 16:9 h720 · 1920x1080 to 4:3 · fit 4000x3000 in 1920x1080 · 27" 2560x1440',
  empty: { title: "Nothing to show", icon: Icons.monitor },
  status: (items) => {
    const first = items[0];
    if (!first) return "";
    if (first.id === "error") return "Not a size or a ratio";
    if (first.id?.startsWith("example:")) return "Ratios, resolutions, crops and screens";
    return [first.title, first.subtitle].filter(Boolean).join(" · ");
  },
  search: (query, ctx) => itemsFor(parseQuery(query), ctx.preferences.even === true),
});
