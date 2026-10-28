import { Icons, list } from "@backslash/api";
import { interfaceItems } from "../ui.ts";

export default list({
  placeholder: "Filter interfaces and addresses…",
  status: (items) => `${items.filter((i) => i.section === "Up").length} up · ${items.length} interfaces`,
  empty: { title: "No network interface", icon: Icons.plug },
  items: () => interfaceItems(),
});
