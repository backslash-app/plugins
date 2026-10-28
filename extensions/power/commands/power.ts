import {
  action,
  type Color,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  type Battery,
  duration,
  health,
  levelColor,
  type Profile,
  profileName,
  statusLine,
  summary,
  watts,
  wh,
} from "../lib.ts";
import { power, type Profiles, profiles, setProfile } from "../system.ts";

const PROFILE_LOOK: Record<string, { icon: string; tint: Color; about: string }> = {
  "power-saver": {
    icon: Icons.leaf,
    tint: "green",
    about: "Lower performance, longer battery life, a cooler and quieter computer.",
  },
  balanced: {
    icon: Icons.activity,
    tint: "blue",
    about: "Performance when you need it, power saving the rest of the time.",
  },
  performance: {
    icon: Icons.rocket,
    tint: "orange",
    about: "Full speed, more heat and fan noise, shorter battery life.",
  },
};
const look = (id: string) =>
  PROFILE_LOOK[id] ??
    (/save|power|eco|quiet/.test(id)
      ? PROFILE_LOOK["power-saver"]
      : /perf|throughput|latency/.test(id)
      ? PROFILE_LOOK.performance
      : PROFILE_LOOK.balanced);

function profileItem(p: Profile, all: Profiles): Item {
  const l = look(p.id);
  return {
    id: `profile:${p.id}`,
    title: profileName(p.id),
    subtitle: p.active ? "Active" : p.description,
    icon: { source: p.active ? Icons.done : l.icon, tint: p.active ? l.tint : "gray" },
    section: "Power Profile",
    keywords: ["profile", "profil", "énergie", "performance", "économie", p.id],
    accessories: [
      ...(p.degraded
        ? [{ icon: { source: Icons.alert, tint: "orange" as const }, tooltip: `Limited: ${p.degraded}` }]
        : []),
      ...(p.active ? [{ tag: "Active", color: l.tint }] : []),
    ],
    detail: {
      markdown: PROFILE_LOOK[p.id]?.about ?? p.description,
      metadata: [
        meta.text("Profile", p.id, { icon: l.icon }),
        meta.text("Status", p.active ? "Active" : "Available", {
          icon: p.active ? Icons.check : Icons.dottedCircle,
          color: p.active ? "green" : undefined,
        }),
        ...(p.driver ? [meta.text("Driver", p.driver, { icon: Icons.cpu })] : []),
        ...(p.degraded
          ? [meta.text("Limited", p.degraded.replace(/-/g, " "), { icon: Icons.alert, color: "orange" })]
          : []),
        meta.text("Through", all.tool ?? "", { icon: Icons.terminal }),
      ],
    },
    actions: p.active ? [copy(p.id, "Copy Profile Name")] : [
      action(`Switch to ${profileName(p.id)}`, async () => {
        await setProfile(all.tool, p.id);
        await toast(`${profileName(p.id)} profile`, { style: "success" });
        return refresh();
      }, { icon: l.icon }),
      copy(p.id, "Copy Profile Name", { section: "Copy" }),
    ],
  };
}

const noProfiles = (error?: string): Item => ({
  id: "profiles:none",
  title: "Power profiles unavailable",
  subtitle: error ? "the daemon did not answer" : "install power-profiles-daemon",
  icon: { source: Icons.bolt, tint: "gray" },
  section: "Power Profile",
  detail: {
    markdown: [
      "Backslash switches profiles with **power-profiles-daemon** (GNOME, KDE and most desktops) or **tuned** (Fedora's tuned-ppd provides both).",
      "**Debian, Ubuntu** `sudo apt install power-profiles-daemon`",
      "**Fedora** `sudo dnf install tuned-ppd`",
      "**Arch** `sudo pacman -S power-profiles-daemon`",
      "Then enable it: `sudo systemctl enable --now power-profiles-daemon`",
      ...(error ? [`\`\`\`\n${error}\n\`\`\``] : []),
    ].join("\n\n"),
  },
  actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
});

function batteryMetadata(b: Battery, plugged?: boolean): Metadata[] {
  const h = health(b);
  return [
    ...(b.capacity !== undefined ? [meta.progress("Charge", b.capacity / 100, `${Math.round(b.capacity)} %`)] : []),
    ...(h !== undefined ? [meta.progress("Health", h, `${Math.round(h * 100)} % of design`)] : []),
    meta.text("Status", statusLine(b), {
      icon: b.status === "Charging" ? Icons.batteryCharging : Icons.battery,
      color: b.status === "Charging" ? "green" : undefined,
    }),
    ...(plugged !== undefined && !b.peripheral
      ? [meta.text("Charger", plugged ? "Plugged in" : "Unplugged", { icon: Icons.plug })]
      : []),
    ...(b.power
      ? [meta.text(b.status === "Charging" ? "Charging at" : "Power draw", watts(b.power), { icon: Icons.bolt })]
      : []),
    meta.separator(),
    ...(b.energyNow !== undefined && b.energyFull
      ? [meta.text("Energy", `${wh(b.energyNow)} of ${wh(b.energyFull)}`)]
      : []),
    ...(b.energyDesign ? [meta.text("Design capacity", wh(b.energyDesign))] : []),
    ...(b.cycles !== undefined ? [meta.text("Charge cycles", b.cycles, { icon: Icons.cycle })] : []),
    ...(b.voltage ? [meta.text("Voltage", `${b.voltage.toFixed(2)} V`)] : []),
    ...(b.technology ? [meta.text("Technology", b.technology)] : []),
    ...(b.manufacturer || b.model ? [meta.text("Model", [b.manufacturer, b.model].filter(Boolean).join(" "))] : []),
    meta.text("Device", b.id, { icon: Icons.tag }),
  ];
}

function batteryItem(b: Battery, plugged?: boolean): Item {
  const pct = b.capacity;
  const color = b.status === "Charging" || b.status === "Full" ? "green" : levelColor(pct);
  const h = health(b);
  const summaryText = [
    `${b.model ?? b.id}: ${pct !== undefined ? `${Math.round(pct)} %` : "?"}`,
    statusLine(b),
    ...(h !== undefined ? [`health ${Math.round(h * 100)} %`] : []),
    ...(b.cycles !== undefined ? [`${b.cycles} cycles`] : []),
  ].join(", ");
  return {
    id: `battery:${b.id}`,
    title: b.peripheral ? b.model ?? b.id : "Battery",
    subtitle: statusLine(b),
    icon: { source: b.status === "Charging" ? Icons.batteryCharging : Icons.battery, tint: color },
    section: b.peripheral ? "Devices" : "Battery",
    keywords: ["battery", "batterie", "charge", "autonomie", b.id, b.model ?? ""],
    accessories: [
      ...(b.power && !b.peripheral ? [{ text: watts(b.power), tooltip: "Power draw" }] : []),
      ...(pct !== undefined ? [{ tag: `${Math.round(pct)} %`, color }] : []),
    ],
    detail: {
      stats: [
        ...(pct !== undefined ? [{ label: "charge", value: `${Math.round(pct)} %`, color }] : []),
        ...(h !== undefined
          ? [{ label: "health", value: `${Math.round(h * 100)} %`, color: h < 0.7 ? "orange" as const : undefined }]
          : []),
        ...(b.timeLeft && b.timeLeft < 172800
          ? [{ label: b.status === "Charging" ? "until full" : "left", value: duration(b.timeLeft) }]
          : []),
      ],
      metadata: batteryMetadata(b, plugged),
    },
    actions: [
      action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      copy(summaryText, "Copy Battery Summary", { section: "Copy" }),
    ],
  };
}

const noBattery = (): Item => ({
  id: "battery:none",
  title: "No battery",
  subtitle: "Running on mains power",
  icon: { source: Icons.plug, tint: "gray" },
  section: "Battery",
  detail: { markdown: "This computer has no battery, or the system doesn't report one." },
  actions: [action("Refresh", () => refresh(), { icon: Icons.refresh })],
});

export default list({
  placeholder: "Power profiles and batteries…",
  empty: { title: "Nothing to show", icon: Icons.power },
  status: (items) => {
    const p = items.find((i) => i.section === "Power Profile" && i.subtitle === "Active");
    const b = items.find((i) => i.section === "Battery" && i.id !== "battery:none");
    return [p?.title, b && `${b.accessories?.at(-1)?.tag ?? ""} · ${b.subtitle}`].filter(Boolean).join(" · ") ||
      "Power";
  },
  // Refreshed every ten seconds while open: charge, draw and time left move.
  async *items({ signal }) {
    let last = "";
    let lastSubtitle: string | null | undefined;
    while (!signal.aborted) {
      const [all, state] = await Promise.all([profiles(), power()]);
      const main = state.batteries.find((b) => !b.peripheral);
      const sub = summary(all.list.find((p) => p.active), main);
      if (sub !== lastSubtitle) {
        lastSubtitle = sub;
        updateCommandMetadata({ subtitle: sub }).catch(() => {});
      }
      const own = state.batteries.filter((b) => !b.peripheral);
      const items = [
        ...(own.length ? own.map((b) => batteryItem(b, state.plugged)) : [noBattery()]),
        ...(all.list.length ? all.list.map((p) => profileItem(p, all)) : [noProfiles(all.error)]),
        ...state.batteries.filter((b) => b.peripheral).map((b) => batteryItem(b)),
      ];
      const key = JSON.stringify(items.map((i) => [i.id, i.subtitle, i.accessories, i.detail]));
      if (key !== last) {
        last = key;
        yield items;
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  },
});
