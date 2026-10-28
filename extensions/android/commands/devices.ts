import { type Action, action, copy, Icons, type Item, list, meta, open, refresh, toast } from "@backslash/api";
import { adb, type Details, details, devices, installHint, Missing } from "../adb.ts";
import { batteryColor, type Device, deviceName, stateHelp } from "../lib.ts";
import { connectForm, deviceActions, pairForm, type Prefs } from "../views.ts";

const TRANSPORT = { usb: "USB", wifi: "Wi-Fi", emulator: "Emulator" } as const;

function listActions(): Action[] {
  return [
    action("Connect over Wi-Fi…", () => connectForm(), { icon: Icons.wifi, shortcut: "<Ctrl>n", section: "adb" }),
    action("Pair with a Code…", () => pairForm(), { icon: Icons.key, shortcut: "<Ctrl>p", section: "adb" }),
    action("Restart adb Server", async () => {
      await adb(["kill-server"]).catch(() => {});
      await adb(["start-server"]);
      await toast("adb server restarted", { style: "success" });
      return refresh();
    }, { icon: Icons.refresh, section: "adb" }),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "adb" }),
  ];
}

function deviceItem(d: Device, prefs: Prefs, more?: Details): Item {
  const info = more?.info;
  const name = deviceName(d, info);
  const ready = d.state === "device";
  const b = more?.battery;
  const help = stateHelp(d);
  const transportIcon = d.transport === "wifi" ? Icons.wifi : d.transport === "emulator" ? Icons.monitor : Icons.plug;
  return {
    id: d.serial,
    title: name,
    subtitle: ready ? (info?.android ? `Android ${info.android}` : d.serial) : help,
    icon: { source: Icons.cpu, tint: ready ? "green" : d.state === "unauthorized" ? "orange" : "red" },
    keywords: [d.serial, d.product ?? "", d.device ?? "", info?.manufacturer ?? ""].filter(Boolean),
    accessories: [
      ...(!ready ? [{ tag: d.state, color: d.state === "unauthorized" ? "orange" as const : "red" as const }] : []),
      ...(b?.level !== undefined
        ? [{
          text: `${b.level}%`,
          icon: { source: b.status === "charging" ? Icons.batteryCharging : Icons.battery, tint: batteryColor(b) },
          tooltip: `Battery ${b.status}${b.source ? ` (${b.source})` : ""}`,
        }]
        : []),
      { icon: transportIcon, tooltip: TRANSPORT[d.transport] },
    ],
    detail: {
      stats: ready && b?.level !== undefined
        ? [
          { label: "Battery", value: `${b.level}%`, color: batteryColor(b) },
          ...(b.temperature !== undefined ? [{ label: "Temperature", value: `${b.temperature.toFixed(1)} °C` }] : []),
        ]
        : undefined,
      markdown: !ready ? `**${help ?? d.state}**${d.problem ? `\n\n\`${d.problem}\`` : ""}` : undefined,
      metadata: [
        ...(info?.android
          ? [meta.text("Android", `${info.android}${info.sdk ? ` (API ${info.sdk})` : ""}`, { icon: Icons.info })]
          : []),
        ...(info?.manufacturer ? [meta.text("Maker", info.manufacturer)] : []),
        ...(info?.model
          ? [meta.text("Model", info.model)]
          : d.model
          ? [meta.text("Model", d.model.replace(/_/g, " "))]
          : []),
        ...(b
          ? [meta.text("Battery", `${b.status}${b.source ? `, ${b.source}` : ""}${b.health ? ` · ${b.health}` : ""}`)]
          : []),
        meta.text("Connection", TRANSPORT[d.transport], { icon: transportIcon }),
        ...(more?.ip ? [meta.text("Wi-Fi address", more.ip, { icon: Icons.wifi })] : []),
        meta.text("Serial", d.serial, { icon: Icons.hash }),
        ...(info?.abi ? [meta.text("CPU", info.abi, { icon: Icons.cpu })] : []),
        ...(info?.securityPatch ? [meta.text("Security patch", info.securityPatch, { icon: Icons.shield })] : []),
        ...(info?.build ? [meta.text("Build", info.build)] : []),
      ],
    },
    actions: ready ? [...deviceActions(d, name, prefs, more?.ip), ...listActions()] : [
      ...(d.state === "no permissions"
        ? [open("https://developer.android.com/studio/run/device#setting-up", "Open USB Setup Guide")]
        : []),
      copy(d.serial, "Copy Serial"),
      ...listActions(),
    ],
  };
}

async function missingItem(): Promise<Item> {
  const cmd = await installHint("adb");
  return {
    id: "missing",
    title: "adb is not installed",
    subtitle: cmd,
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown:
        `This extension talks to your phone with **adb**, the Android Debug Bridge.\n\n\`\`\`sh\n${cmd}\n\`\`\`\n\nThen turn on **USB debugging** on the phone (Settings → About phone → tap Build number 7 times, then Developer options).`,
    },
    actions: [
      copy(cmd, "Copy Install Command", { icon: Icons.terminal }),
      open("https://developer.android.com/tools/releases/platform-tools", "Open Platform Tools Page"),
    ],
  };
}

export default list({
  placeholder: "Filter devices…",
  empty: {
    title: "No Android device",
    description: "Plug in a phone with USB debugging on, or press Ctrl+N to connect over Wi-Fi",
    icon: Icons.cpu,
  },
  actions: listActions(),
  status: (items) =>
    items[0]?.id === "missing" ? "adb missing" : `${items.length} device${items.length === 1 ? "" : "s"}`,
  async *items({ preferences, signal }) {
    const prefs = preferences as Prefs;
    let found: Device[];
    try {
      found = await devices(signal);
    } catch (e) {
      if (e instanceof Missing) {
        yield [await missingItem()];
        return;
      }
      throw e;
    }
    yield found.map((d) => deviceItem(d, prefs));
    if (!found.some((d) => d.state === "device")) return;
    const more = await Promise.all(
      found.map((d) => d.state === "device" ? details(d.serial, signal).catch(() => undefined) : undefined),
    );
    yield found.map((d, i) => deviceItem(d, prefs, more[i]));
  },
});
