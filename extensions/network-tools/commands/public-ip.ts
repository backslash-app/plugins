import { type Context, Icons, list } from "@backslash/api";
import { publicIpItems } from "../ui.ts";

export default (ctx: Context) =>
  list({
    placeholder: "Public IP addresses…",
    status: (items) =>
      items.length ? `${items.filter((i) => i.id?.startsWith("ip:")).length} public addresses · ipinfo.io` : "",
    empty: { title: "No public IP", description: "Are you offline?", icon: Icons.wifiOff },
    items: () => publicIpItems(ctx, "Public IP"),
  });
