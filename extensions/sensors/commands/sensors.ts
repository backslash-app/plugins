import { action, copy, Icons, type Item, list, meta, type Metadata, open, refresh } from "@backslash/api";
import {
  chipTitle,
  formatTemp,
  formatValue,
  type Level,
  LEVEL_COLORS,
  LEVEL_TITLES,
  levelOf,
  limits,
  type Reading,
  readingsText,
  readingSubtitle,
  readingTitle,
  sortReadings,
  summaryLine,
} from "../lib.ts";
import { read, sleep } from "../system.ts";

const INTERVAL = 2000;

/** Lowest and highest seen while the list is open. */
const seen = new Map<string, { min: number; max: number }>();
let status = "";

function remember(r: Reading) {
  const s = seen.get(r.id);
  seen.set(r.id, s ? { min: Math.min(s.min, r.value), max: Math.max(s.max, r.value) } : { min: r.value, max: r.value });
}

function readingItem(r: Reading, all: Reading[], f: boolean, override: number | undefined): Item {
  const level: Level = levelOf(r, override);
  const temp = r.unit === "°C";
  const l = temp ? limits(r, override) : undefined;
  const s = seen.get(r.id);
  const color = LEVEL_COLORS[level];
  const metadata: Metadata[] = [
    meta.text("Sensor", r.label, { icon: temp ? Icons.thermometer : Icons.wind }),
    meta.text("Chip", r.chip, { icon: Icons.cpu }),
    ...(r.adapter ? [meta.text("Adapter", r.adapter)] : []),
    ...(r.model ? [meta.text("Model", r.model, { icon: Icons.drive })] : []),
    meta.text("Kind", chipTitle(r.driver)),
    meta.separator(),
    meta.text("State", LEVEL_TITLES[level], { color, icon: level === "ok" ? Icons.check : Icons.alert }),
    ...(l
      ? [
        meta.text(l.reported && r.high !== undefined ? "High" : "High (usual)", formatTemp(l.high, f), {
          color: "orange",
        }),
        meta.text(l.reported && r.crit !== undefined ? "Critical" : "Critical (usual)", formatTemp(l.crit, f), {
          color: "red",
        }),
        meta.progress("Up to critical", r.value / l.crit, `${Math.round((r.value / l.crit) * 100)} %`),
      ]
      : []),
    ...(r.min !== undefined ? [meta.text("Minimum speed", formatValue({ unit: r.unit, value: r.min }))] : []),
    ...(r.alarm ? [meta.text("Alarm", "The chip raised its alarm", { color: "red", icon: Icons.alert })] : []),
  ];
  return {
    id: r.id,
    title: readingTitle(r),
    subtitle: readingSubtitle(r),
    icon: { source: temp ? Icons.thermometer : Icons.wind, tint: temp || level !== "ok" ? color : "blue" },
    section: r.group,
    keywords: [r.chip, r.driver, r.label, r.group, temp ? "temperature température" : "fan ventilateur"],
    accessories: [
      ...(level === "critical" ? [{ tag: "Critical", color: "red" as const }] : []),
      ...(level === "high" ? [{ tag: temp ? "Hot" : "Check", color: "orange" as const }] : []),
      ...(s && s.max - s.min >= 1 && temp
        ? [{
          text: `${formatTemp(s.min, f)}–${formatTemp(s.max, f)}`,
          color: "gray" as const,
          tooltip: "Seen since opened",
        }]
        : []),
      { text: formatValue(r, f), color: temp || level !== "ok" ? color : undefined },
    ],
    detail: {
      stats: [
        { label: "Now", value: formatValue(r, f), color },
        ...(s ? [{ label: "Highest seen", value: formatValue({ unit: r.unit, value: s.max }, f) }] : []),
        ...(l ? [{ label: "Critical at", value: formatTemp(l.crit, f), color: "red" as const }] : []),
      ],
      metadata,
    },
    actions: [
      copy(`${readingTitle(r)}: ${formatValue(r, f)}`, "Copy Reading"),
      copy(readingsText(all, f), "Copy All Readings", { shortcut: "<Ctrl><Shift>c" }),
      action("Forget Highest and Lowest", () => {
        seen.clear();
        return refresh();
      }, { icon: Icons.history, section: "View" }),
    ],
  };
}

const installItem: Item = {
  id: "install",
  title: "No sensor found",
  subtitle: "Install lm-sensors, then run sudo sensors-detect",
  icon: { source: Icons.thermometer, tint: "gray" },
  detail: {
    markdown: [
      "Neither lm-sensors nor `/sys/class/hwmon` reported a temperature.",
      "",
      "Install **lm-sensors** (`lm_sensors` on Fedora and Arch), then run `sudo sensors-detect` to load the drivers for your motherboard's chip. In a virtual machine there is usually nothing to read.",
    ].join("\n"),
  },
  actions: [
    open("https://github.com/lm-sensors/lm-sensors", "Open lm-sensors", { icon: Icons.globe }),
    action("Check Again", () => refresh(), { icon: Icons.refresh }),
  ],
};

export default list({
  placeholder: "Filter temperatures and fans…",
  empty: { title: "No sensor matches", icon: Icons.thermometer },
  status: () => status,
  async *items({ preferences, signal }) {
    const f = preferences.fahrenheit === true;
    const override = Number(preferences.threshold) > 0 ? Number(preferences.threshold) : undefined;
    const nvidia = preferences.nvidia !== false;
    while (!signal.aborted) {
      const { readings, lmSensors } = await read({ nvidia });
      if (!readings.length) {
        status = "";
        yield [installItem];
        return;
      }
      readings.forEach(remember);
      const sorted = sortReadings(readings);
      const hot = readings.filter((r) => ["high", "critical"].includes(levelOf(r, override))).length;
      const fans = readings.filter((r) => r.unit !== "°C").length;
      status = [
        summaryLine(readings, f),
        ...(fans ? [`${fans} fan${fans === 1 ? "" : "s"}`] : []),
        ...(hot ? [`${hot} hot`] : []),
        ...(lmSensors ? [] : ["from /sys (lm-sensors not installed)"]),
      ].filter(Boolean).join(" · ");
      yield sorted.map((r) => readingItem(r, readings, f, override));
      await sleep(INTERVAL, signal);
    }
  },
});
