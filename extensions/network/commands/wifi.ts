import {
  action,
  close,
  type Color,
  exec,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  refresh,
  toast,
} from "@backslash/api";
import { parseConnections, parseWifi, type Wifi } from "../lib.ts";

const nmcli = (...args: string[]) => exec("nmcli", args);

async function connect(w: Wifi, saved: boolean, password?: string) {
  await toast(`Connecting to ${w.ssid}…`);
  if (saved && !password) await nmcli("connection", "up", "id", w.ssid);
  else await nmcli("device", "wifi", "connect", w.ssid, ...(password ? ["password", password] : []));
  return close(`Connected to ${w.ssid}`);
}

const passwordForm = (w: Wifi) =>
  form({
    title: w.ssid,
    submitTitle: "Join",
    fields: [field.password("password", `Password for ${w.ssid}`, { required: true })],
    submit: (values) => connect(w, false, String(values.password)),
  });

const strength = (signal: number): [string, Color] =>
  signal >= 70
    ? ["Excellent", "green"]
    : signal >= 50
    ? ["Good", "green"]
    : signal >= 30
    ? ["Fair", "yellow"]
    : ["Weak", "orange"];

function item(w: Wifi, saved: boolean): Item {
  const open = w.security === "";
  const [quality, color] = strength(w.signal);
  return {
    id: w.ssid,
    title: w.ssid,
    subtitle: w.active ? "Connected" : saved ? "Saved" : undefined,
    icon: { source: Icons.wifi, tint: w.active ? "accent" as Color : color },
    section: w.active ? "Connected" : saved ? "Saved networks" : "Other networks",
    accessories: [
      ...(open ? [{ tag: "Open", color: "orange" as const }] : [{ icon: Icons.lock, tooltip: w.security }]),
      { text: `${w.signal} %`, tooltip: quality },
    ],
    detail: {
      metadata: [
        meta.progress("Signal", w.signal / 100, `${w.signal} % · ${quality}`),
        meta.text("Security", open ? "None (open network)" : w.security, {
          icon: open ? Icons.alert : Icons.lock,
          color: open ? "orange" : undefined,
        }),
        meta.text("Status", w.active ? "Connected" : saved ? "Saved: joins without a password" : "Not joined yet", {
          icon: w.active ? Icons.check : Icons.wifi,
          color: w.active ? "green" : undefined,
        }),
      ],
    },
    actions: w.active
      ? [
        action("Disconnect", async () => {
          await nmcli("connection", "down", "id", w.ssid);
          return refresh();
        }, { icon: Icons.wifiOff, destructive: true }),
      ]
      : [
        action("Connect", () => (open || saved ? connect(w, saved) : passwordForm(w)), { icon: Icons.wifi }),
        ...(saved
          ? [action("Forget Network", async () => {
            await nmcli("connection", "delete", "id", w.ssid);
            return refresh();
          }, { icon: Icons.trash, destructive: true, confirm: `Forget ${w.ssid} and its password?` })]
          : []),
      ],
  };
}

const toggle = (on: boolean) =>
  action(on ? "Turn Wi-Fi On" : "Turn Wi-Fi Off", async () => {
    await nmcli("radio", "wifi", on ? "on" : "off");
    if (on) await new Promise((r) => setTimeout(r, 2500)); // let it scan
    return refresh();
  }, { icon: on ? Icons.wifi : Icons.wifiOff, shortcut: "<Ctrl>w" });

export default async () => {
  const enabled = (await nmcli("radio", "wifi").catch(() => "missing")).trim();
  if (enabled === "missing") {
    return list({
      empty: { title: "NetworkManager is not available", description: "nmcli was not found", icon: "bs-wifi-off" },
    });
  }
  if (enabled !== "enabled") {
    return list({
      empty: { title: "Wi-Fi is off", icon: "bs-wifi-off" },
      actions: [toggle(true)],
      status: "Wi-Fi is off",
      items: [{ title: "Turn Wi-Fi On", icon: { source: Icons.wifi, tint: "gray" }, actions: [toggle(true)] }],
    });
  }
  return list({
    placeholder: "Search networks…",
    actions: [toggle(false)],
    empty: { title: "No networks found", icon: "bs-wifi" },
    status: (items) => {
      const on = items.find((i) => i.section === "Connected");
      return on ? `Connected to ${on.title} · ${items.length} networks` : `${items.length} networks`;
    },
    items: async () => {
      const [scan, conns] = await Promise.all([
        nmcli("-t", "-f", "IN-USE,SSID,SIGNAL,SECURITY", "device", "wifi", "list", "--rescan", "auto"),
        nmcli("-t", "-f", "NAME,TYPE,DEVICE", "connection", "show"),
      ]);
      const saved = new Set(parseConnections(conns).filter((c) => c.type === "802-11-wireless").map((c) => c.name));
      return parseWifi(scan).map((w) => item(w, saved.has(w.ssid)));
    },
  });
};
