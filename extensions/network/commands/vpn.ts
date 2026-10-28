import { action, exec, Icons, type Item, list, meta, refresh, toast } from "@backslash/api";
import { parseConnections, parseTailscale } from "../lib.ts";

const nmcli = (...args: string[]) => exec("nmcli", args);

async function nmVpns(): Promise<Item[]> {
  const conns = parseConnections(await nmcli("-t", "-f", "NAME,TYPE,DEVICE", "connection", "show").catch(() => ""));
  return conns.filter((c) => c.type === "vpn" || c.type === "wireguard").map((c) => {
    const on = c.device !== "";
    return {
      id: `nm:${c.name}`,
      title: c.name,
      subtitle: c.type === "wireguard" ? "WireGuard" : "VPN",
      icon: { source: Icons.vpn, tint: on ? ("green" as const) : ("gray" as const) },
      section: on ? "Connected" : "Available",
      accessories: on ? [{ tag: "Connected", color: "green" as const }] : [],
      detail: {
        metadata: [
          meta.text("Status", on ? "Connected" : "Disconnected", { icon: Icons.vpn, color: on ? "green" : undefined }),
          meta.text("Kind", c.type === "wireguard" ? "WireGuard" : "VPN (NetworkManager)"),
          ...(on ? [meta.text("Interface", c.device)] : []),
        ],
      },
      actions: [action(on ? "Disconnect" : "Connect", async () => {
        if (!on) await toast(`Connecting to ${c.name}…`);
        await nmcli("connection", on ? "down" : "up", "id", c.name);
        return refresh();
      }, { icon: on ? Icons.cross : Icons.vpn })],
    };
  });
}

async function tailscale(): Promise<Item[]> {
  const json = await exec("tailscale", ["status", "--json"]).catch(() => undefined);
  if (!json) return [];
  const t = parseTailscale(json);
  return [{
    id: "tailscale",
    title: "Tailscale",
    subtitle: t.running ? t.tailnet : t.host,
    icon: { source: Icons.vpn, tint: t.running ? ("green" as const) : ("gray" as const) },
    section: t.running ? "Connected" : "Available",
    accessories: t.running ? [{ tag: "Connected", color: "green" as const }] : [],
    detail: {
      metadata: [
        meta.text("Status", t.running ? "Connected" : "Stopped", {
          icon: Icons.vpn,
          color: t.running ? "green" : undefined,
        }),
        ...(t.tailnet ? [meta.text("Tailnet", t.tailnet)] : []),
        meta.text("This device", t.host, { icon: Icons.monitor }),
        ...(t.ip ? [meta.text("Address", t.ip)] : []),
      ],
    },
    actions: [action(t.running ? "Disconnect" : "Connect", async () => {
      await exec("tailscale", [t.running ? "down" : "up"]);
      return refresh();
    }, { icon: Icons.vpn })],
  }];
}

export default list({
  placeholder: "Search VPNs…",
  empty: {
    title: "No VPN configured",
    description: "VPN and WireGuard connections of NetworkManager, and Tailscale, show up here",
    icon: "bs-vpn",
  },
  status: (items) => `${items.filter((i) => i.section === "Connected").length} connected`,
  items: async () => [...await tailscale(), ...await nmVpns()],
});
