import { action, close, type Color, exec, type Item, list, refresh, toast } from "@backslash/api";
import { type Device, parseDevices, parseInfo } from "../lib.ts";

const btctl = (...args: string[]) => exec("bluetoothctl", args);

async function devices(): Promise<Device[]> {
  // Paired devices only: the full list is every phone around.
  const listed = parseDevices(await btctl("devices", "Paired").catch(() => btctl("devices")));
  const all = await Promise.all(listed.map(async (d) => parseInfo(d.mac, await btctl("info", d.mac).catch(() => ""))));
  return all.filter((d) => d.paired).sort((a, b) => Number(b.connected) - Number(a.connected));
}

function item(d: Device): Item {
  const battery = d.battery === undefined ? [] : [{
    text: `🔋 ${d.battery}%`,
    color: (d.battery < 20 ? "red" : undefined) as Color | undefined,
  }];
  return {
    id: d.mac,
    title: d.name,
    subtitle: d.mac,
    icon: d.icon,
    section: d.connected ? "Connected" : "Paired",
    accessories: [...battery, ...(d.connected ? [{ tag: "Connected", color: "green" as const }] : [])],
    actions: d.connected
      ? [action("Disconnect", async () => {
        await btctl("disconnect", d.mac);
        return refresh();
      }, { icon: "bluetooth-disabled" })]
      : [action("Connect", async () => {
        await toast(`Connecting to ${d.name}…`);
        const out = await btctl("--timeout", "15", "connect", d.mac);
        if (!/successful/i.test(out)) throw new Error(`Could not connect to ${d.name}`);
        return close(`${d.name} connected`);
      }, { icon: "bluetooth-active" })],
  };
}

const power = (on: boolean) =>
  action(on ? "Turn Bluetooth On" : "Turn Bluetooth Off", async () => {
    await btctl("power", on ? "on" : "off");
    return refresh();
  }, { icon: on ? "bluetooth-active" : "bluetooth-disabled", shortcut: "<Ctrl>b" });

export default async () => {
  const show = await btctl("show").catch(() => undefined);
  if (show === undefined || !show.includes("Controller")) {
    return list({ empty: { title: "No Bluetooth adapter", description: "bluetoothctl found no controller" } });
  }
  if (!/Powered: yes/.test(show)) {
    return list({
      actions: [power(true)],
      items: [{ title: "Turn Bluetooth On", icon: "bluetooth-active", actions: [power(true)] }],
    });
  }
  return list({
    placeholder: "Search devices…",
    actions: [power(false)],
    empty: { title: "No paired devices", description: "Pair a device once in your desktop's settings" },
    items: async () => (await devices()).map(item),
  });
};
