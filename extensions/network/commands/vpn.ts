import { action, exec, type Item, list, refresh, toast } from "@backslash/api";
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
      icon: on ? "network-vpn" : "network-vpn-disconnected",
      accessories: on ? [{ tag: "Connected", color: "green" as const }] : [],
      actions: [action(on ? "Disconnect" : "Connect", async () => {
        if (!on) await toast(`Connecting to ${c.name}…`);
        await nmcli("connection", on ? "down" : "up", "id", c.name);
        return refresh();
      }, { icon: on ? "network-offline" : "network-vpn" })],
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
    subtitle: t.running ? [t.tailnet, t.ip].filter(Boolean).join(" · ") : t.host,
    icon: "network-vpn",
    accessories: t.running ? [{ tag: "Connected", color: "green" as const }] : [],
    actions: [action(t.running ? "Disconnect" : "Connect", async () => {
      await exec("tailscale", [t.running ? "down" : "up"]);
      return refresh();
    }, { icon: "network-vpn" })],
  }];
}

export default list({
  placeholder: "Search VPNs…",
  empty: {
    title: "No VPN configured",
    description: "VPN and WireGuard connections of NetworkManager, and Tailscale, show up here",
  },
  items: async () => [...await tailscale(), ...await nmVpns()],
});
