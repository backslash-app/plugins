import {
  type Accessory,
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  charge,
  has,
  infoLine,
  kindName,
  levelText,
  levelTint,
  type Peripheral,
  SIDETONE_LEVELS,
  sortByCharge,
  STATE_NAMES,
} from "../lib.ts";
import { load, setInactiveTime, setLights, setSidetone } from "../system.ts";

const KIND_ICONS: Record<string, string> = {
  mouse: Icons.mouse,
  touchpad: Icons.mouse,
  keyboard: Icons.keyboard,
  headset: Icons.headphones,
  headphones: Icons.headphones,
  "other-audio": Icons.headphones,
  speakers: Icons.speaker,
  "gaming-input": Icons.gamepad,
  pen: Icons.note,
  tablet: Icons.monitor,
  monitor: Icons.monitor,
  phone: Icons.bluetooth,
  ups: Icons.plug,
  computer: Icons.cpu,
};

function headsetActions(p: Peripheral): Action[] {
  if (p.source !== "HeadsetControl") return [];
  const actions: Action[] = [];
  if (has(p, "sidetone")) {
    actions.push(submenu(
      "Set Sidetone",
      SIDETONE_LEVELS.map((l) =>
        action(`${l.title} (${l.value})`, async () => {
          await setSidetone(l.value);
          await toast(`Sidetone ${l.title.toLowerCase()}`, { style: "success" });
        }, { icon: l.value ? Icons.mic : Icons.speakerOff })
      ),
      { icon: Icons.mic, section: "Headset" },
    ));
  }
  if (has(p, "lights")) {
    actions.push(
      action("Lights On", async () => {
        await setLights(true);
        await toast("Lights on", { style: "success" });
      }, { icon: Icons.lightbulb, section: "Headset", shortcut: "<Ctrl>l" }),
      action("Lights Off", async () => {
        await setLights(false);
        await toast("Lights off", { style: "success" });
      }, { icon: Icons.lightbulb, section: "Headset", shortcut: "<Ctrl><Shift>l" }),
    );
  }
  if (has(p, "inactive time")) {
    actions.push(submenu(
      "Turn Off When Idle",
      [5, 15, 30, 60, 0].map((m) =>
        action(m ? `After ${m} minutes` : "Never", async () => {
          await setInactiveTime(m);
          await toast(m ? `Turns off after ${m} minutes idle` : "Stays on", { style: "success" });
        }, { icon: Icons.timer })
      ),
      { icon: Icons.timer, section: "Headset" },
    ));
  }
  return actions;
}

function item(p: Peripheral): Item {
  const tint = levelTint(p);
  const level = levelText(p);
  const c = charge(p);
  const accessories: Accessory[] = [];
  if (p.state === "charging") accessories.push({ tag: "Charging", color: "green" });
  else if (p.state === "full") accessories.push({ tag: "Full", color: "green" });
  else if (c !== undefined && c <= 15 && p.state !== "off") accessories.push({ tag: "Low", color: "red" });
  if (p.bluetooth) accessories.push({ icon: Icons.bluetooth, tooltip: "Bluetooth" });
  if (level) {
    accessories.push({
      text: level,
      color: tint === "gray" ? undefined : tint,
      icon: { source: p.state === "charging" ? Icons.batteryCharging : Icons.battery, tint },
    });
  }

  const metadata: Metadata[] = [
    ...(c !== undefined && p.state !== "off" ? [meta.progress("Battery", c / 100, level)] : []),
    meta.text("State", STATE_NAMES[p.state], {
      color: p.state === "charging" || p.state === "full" ? "green" : undefined,
    }),
    meta.text("Kind", kindName(p.kind), { icon: KIND_ICONS[p.kind] ?? Icons.battery }),
    ...(p.vendor ? [meta.text("Maker", p.vendor)] : []),
    ...(p.model && p.model !== p.name ? [meta.text("Model", p.model)] : []),
    ...(p.bluetooth ? [meta.text("Connection", "Bluetooth", { icon: Icons.bluetooth })] : []),
    ...(p.updated ? [meta.text("Reported", p.updated)] : []),
    ...(p.capabilities?.length ? [meta.tags("Controls", p.capabilities)] : []),
    meta.separator(),
    meta.text("From", p.source),
    ...(p.serial ? [meta.text("Serial", p.serial)] : []),
    ...(p.path ? [meta.text("Device", p.path)] : []),
  ];

  const headset = headsetActions(p);
  return {
    id: p.id,
    title: p.name,
    subtitle: kindName(p.kind),
    icon: { source: KIND_ICONS[p.kind] ?? Icons.battery, tint },
    section: p.state === "off" ? "Off or Out of Range" : c === undefined ? "No Battery Level" : "Devices",
    keywords: [kindName(p.kind), p.kind, p.vendor ?? "", p.model ?? "", "batterie", "battery"].filter(Boolean),
    accessories,
    detail: {
      stats: [
        ...(level ? [{ label: "Battery", value: level, color: tint === "gray" ? undefined : tint }] : []),
        { label: "State", value: STATE_NAMES[p.state] },
      ],
      metadata,
    },
    actions: [
      ...headset.slice(0, 1),
      copy(infoLine(p), "Copy Battery Info"),
      ...headset.slice(1),
      copy(p.name, "Copy Device Name", { section: "Copy" }),
      ...(p.serial ? [copy(p.serial, "Copy Serial Number", { section: "Copy" })] : []),
    ],
  };
}

export default list({
  placeholder: "Search mice, keyboards, headsets…",
  empty: {
    title: "No wireless device reports its battery",
    description: "Connect a Bluetooth or wireless mouse, keyboard, headset or gamepad",
    icon: Icons.battery,
  },
  status: (items) => {
    const low = items.filter((i) => i.accessories?.some((a) => a.tag === "Low")).length;
    return `${items.length} device${items.length === 1 ? "" : "s"}${low ? `, ${low} low` : ""}`;
  },
  actions: [action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async items() {
    const { devices, nothing, errors } = await load();
    if (nothing) {
      throw new Error("UPower is not installed: install the upower package (Solaar and HeadsetControl are optional)");
    }
    if (!devices.length && errors.length) throw new Error(errors[0]);
    return sortByCharge(devices).map(item);
  },
});
