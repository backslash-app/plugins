import { Icons, list } from "@backslash/api";
import { parseQuery } from "../lib.ts";
import { itemsFor } from "../ui.ts";

export default list({
  placeholder: "48.8584, 2.2945 · 48°51'30\"N 2°17'40\"E · 31U 448251 5411943 · 8FW4V75V+8Q · A to B",
  empty: { title: "Nothing to show", icon: Icons.pin },
  status: (items) => {
    const first = items[0];
    if (!first) return "";
    if (first.id === "error") return "Not a coordinate";
    if (first.id?.startsWith("example:")) return "Decimal · DMS · UTM · MGRS · Geohash · Plus Code";
    return [first.title, first.subtitle].filter(Boolean).join(" · ");
  },
  search: (query) => itemsFor(parseQuery(query)),
});
