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
import { type Device, deviceKind, short, stepVolume, type Stream, volumeBar, volumeColor } from "../lib.ts";
import { setDefaultSource, setSourceMute, setSourcePort, setSourceVolume, snapshot } from "../system.ts";

const LEVELS = [25, 50, 75, 100, 125, 150];

function volumeActions(d: Device): Action[] {
  return [
    action("Volume Up", async () => {
      await setSourceVolume(d, stepVolume(d.volume, 5));
      return refresh();
    }, { icon: Icons.arrowUp, shortcut: "<Alt>Up", section: "Volume" }),
    action("Volume Down", async () => {
      await setSourceVolume(d, stepVolume(d.volume, -5));
      return refresh();
    }, { icon: Icons.arrowDown, shortcut: "<Alt>Down", section: "Volume" }),
    submenu(
      "Set Volume",
      LEVELS.map((v) =>
        action(`${v} %${v > 100 ? " (amplified)" : ""}`, async () => {
          await setSourceVolume(d, v);
          return refresh();
        }, { icon: v === d.volume ? Icons.check : Icons.mic })
      ),
      { icon: Icons.mic, section: "Volume", shortcut: "<Ctrl>l" },
    ),
  ];
}

function item(d: Device, recording: Stream[]): Item {
  const kind = deviceKind(d);
  const port = d.ports.find((p) => p.name === d.activePort);
  const accessories: Accessory[] = [];
  if (recording.length) accessories.push({ tag: `${recording.length} recording`, color: "red" });
  if (d.muted) accessories.push({ tag: "Muted", color: "orange" });
  accessories.push({ text: `${d.volume} %`, color: volumeColor(d.volume, d.muted), tooltip: volumeBar(d.volume) });
  if (d.isDefault) accessories.push({ icon: { source: Icons.check, tint: "green" }, tooltip: "Default microphone" });

  const metadata: Metadata[] = [
    meta.progress("Volume", d.volume / 100, `${d.volume} %${d.muted ? " (muted)" : ""}`),
    meta.text("Default", d.isDefault ? "Yes" : "No", { color: d.isDefault ? "green" : undefined }),
    meta.text("Connection", kind),
    ...(port ? [meta.text("Port", port.description)] : []),
    ...(d.state ? [meta.text("State", d.state.toLowerCase())] : []),
    ...(d.sampleSpec ? [meta.text("Format", d.sampleSpec)] : []),
    ...(recording.length
      ? [meta.tags("Recording", recording.map((s) => ({ text: s.app, color: "red" as const })))]
      : []),
    meta.separator(),
    meta.text("Device", d.name),
  ];

  const ports = d.ports.filter((p) => p.available && p.name !== d.activePort);
  return {
    id: d.name,
    title: d.description,
    subtitle: d.isDefault ? "Default microphone" : kind,
    icon: { source: Icons.mic, tint: d.muted ? "orange" : d.isDefault ? "green" : "gray" },
    section: "Microphones",
    keywords: [d.name, kind, "micro", "input"],
    accessories,
    detail: { metadata },
    actions: [
      ...(d.isDefault ? [] : [action("Use as Microphone", async () => {
        await setDefaultSource(d);
        await toast(`Recording from ${short(d.description)}`, { style: "success" });
        return refresh();
      }, { icon: Icons.check })]),
      action(d.muted ? "Unmute" : "Mute", async () => {
        await setSourceMute(d, !d.muted);
        return refresh();
      }, { icon: d.muted ? Icons.mic : Icons.speakerOff, shortcut: "<Ctrl>m" }),
      ...volumeActions(d),
      ...(ports.length
        ? [submenu(
          "Switch Port",
          ports.map((p) =>
            action(p.description, async () => {
              await setSourcePort(d, p.name);
              return refresh();
            })
          ),
          { icon: Icons.plug, section: "Device" },
        )]
        : []),
      copy(d.name, "Copy Device Name", { section: "Device", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

export default list({
  placeholder: "Search microphones…",
  empty: {
    title: "No microphone found",
    description: "Plug one in, or check that PipeWire or PulseAudio is running",
    icon: Icons.mic,
  },
  status: (items) => {
    const def = items.find((i) => i.subtitle === "Default microphone");
    return def ? `Recording from ${def.title}` : `${items.length} microphones`;
  },
  async items() {
    const snap = await snapshot(true);
    const mics = snap.sources.filter((d) => !d.monitorOf);
    return mics
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.description.localeCompare(b.description))
      .map((d) =>
        item(
          d,
          snap.streams.filter((s) =>
            s.kind === "recording" && (s.device === d.index || s.deviceName === d.description)
          ),
        )
      );
  },
});
