import { action, close, type Color, exec, Icons, type Item, list, meta, refresh, toast } from "@backslash/api";
import { type Device, parseDevices, parseInfo } from "../lib.ts";

const btctl = (...args: string[]) => exec("bluetoothctl", args);

async function devices(): Promise<Device[]> {
  // Paired devices only: the full list is every phone around.
  const listed = parseDevices(await btctl("devices", "Paired").catch(() => btctl("devices")));
  const all = await Promise.all(listed.map(async (d) => parseInfo(d.mac, await btctl("info", d.mac).catch(() => ""))));
  return all.filter((d) => d.paired).sort((a, b) => Number(b.connected) - Number(a.connected));
}

/** Backslash's icon for bluetoothctl's device class. */
function deviceIcon(icon: string): string {
  if (/headset|headphone/.test(icon)) return Icons.headphones;
  if (/audio|speaker/.test(icon)) return Icons.speaker;
  if (/keyboard/.test(icon)) return Icons.keyboard;
  if (/phone/.test(icon)) return Icons.monitor;
  if (/computer/.test(icon)) return Icons.monitor;
  return Icons.bluetooth;
}

function item(d: Device): Item {
  const low = d.battery !== undefined && d.battery < 20;
  return {
    id: d.mac,
    title: d.name,
    subtitle: d.connected ? "Connected" : undefined,
    icon: { source: deviceIcon(d.icon), tint: d.connected ? "blue" : "gray" },
    section: d.connected ? "Connected" : "Paired",
    accessories: [
      ...(d.battery === undefined
        ? []
        : [{ text: `${d.battery} %`, icon: Icons.bolt, color: (low ? "red" : undefined) as Color | undefined }]),
    ],
    detail: {
      metadata: [
        meta.text("Status", d.connected ? "Connected" : "Paired, not connected", {
          icon: d.connected ? Icons.check : Icons.bluetooth,
          color: d.connected ? "green" : undefined,
        }),
        ...(d.battery === undefined ? [] : [meta.progress("Battery", d.battery / 100)]),
        meta.text("Kind", d.icon.replace(/-/g, " ")),
        meta.text("Address", d.mac),
      ],
    },
    actions: d.connected
      ? [action("Disconnect", async () => {
        await btctl("disconnect", d.mac);
        return refresh();
      }, { icon: Icons.cross })]
      : [action("Connect", async () => {
        await toast(`Connecting to ${d.name}…`);
        const out = await btctl("--timeout", "15", "connect", d.mac);
        if (!/successful/i.test(out)) throw new Error(`Could not connect to ${d.name}`);
        return close(`${d.name} connected`);
      }, { icon: Icons.bluetooth })],
  };
}

const power = (on: boolean) =>
  action(on ? "Turn Bluetooth On" : "Turn Bluetooth Off", async () => {
    await btctl("power", on ? "on" : "off");
    return refresh();
  }, { icon: Icons.bluetooth, shortcut: "<Ctrl>b" });

export default async () => {
  const show = await btctl("show").catch(() => undefined);
  if (show === undefined || !show.includes("Controller")) {
    return list({
      empty: { title: "No Bluetooth adapter", description: "bluetoothctl found no controller", icon: "bs-bluetooth" },
    });
  }
  if (!/Powered: yes/.test(show)) {
    return list({
      actions: [power(true)],
      status: "Bluetooth is off",
      items: [{ title: "Turn Bluetooth On", icon: { source: Icons.bluetooth, tint: "gray" }, actions: [power(true)] }],
    });
  }
  return list({
    placeholder: "Search devices…",
    actions: [power(false)],
    empty: {
      title: "No paired devices",
      description: "Pair a device once in your desktop's settings",
      icon: "bs-bluetooth",
    },
    status: (items) => `${items.filter((i) => i.section === "Connected").length} connected · ${items.length} paired`,
    items: async () => (await devices()).map(item),
  });
};
