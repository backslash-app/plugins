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
import { type Device, short, stepVolume, type Stream, volumeBar, volumeColor } from "../lib.ts";
import { moveStream, setStreamMute, setStreamVolume, type Snapshot, snapshot } from "../system.ts";

const LEVELS = [10, 25, 50, 75, 100, 125, 150];

function deviceOf(s: Stream, snap: Snapshot): Device | undefined {
  const list = s.kind === "playback" ? snap.sinks : snap.sources;
  return list.find((d) => d.index === s.device) ?? list.find((d) => d.description === s.deviceName);
}

function moveAction(s: Stream, snap: Snapshot, current?: Device): Action[] {
  if (snap.backend.kind !== "pactl") return [];
  const targets = (s.kind === "playback" ? snap.sinks : snap.sources).filter((d) => d.index !== current?.index);
  if (!targets.length) return [];
  return [submenu(
    s.kind === "playback" ? "Move to Output" : "Record From",
    targets.map((d) =>
      action(d.monitorOf ? `${d.description} (what an output plays)` : d.description, async () => {
        await moveStream(s, d);
        await toast(`${s.app} → ${short(d.description)}`, { style: "success" });
        return refresh();
      }, { icon: s.kind === "playback" ? Icons.speaker : Icons.mic })
    ),
    { icon: Icons.arrowRight, shortcut: "<Ctrl>o" },
  )];
}

function item(s: Stream, snap: Snapshot): Item {
  const device = deviceOf(s, snap);
  const playback = s.kind === "playback";
  const accessories: Accessory[] = [];
  if (s.corked) accessories.push({ tag: "Paused", color: "gray" });
  if (s.muted) accessories.push({ tag: "Muted", color: "orange" });
  if (device && (playback ? snap.sinks : snap.sources).length > 1) {
    accessories.push({ text: short(device.description, 24), icon: playback ? Icons.speaker : Icons.mic });
  }
  accessories.push({ text: `${s.volume} %`, color: volumeColor(s.volume, s.muted), tooltip: volumeBar(s.volume) });

  const metadata: Metadata[] = [
    meta.progress("Volume", s.volume / 100, `${s.volume} %${s.muted ? " (muted)" : ""}`),
    ...(s.media ? [meta.text(playback ? "Playing" : "Recording", s.media)] : []),
    ...(device
      ? [meta.text(playback ? "Output" : "Input", device.description, { icon: playback ? Icons.speaker : Icons.mic })]
      : []),
    meta.text("State", s.corked ? "Paused" : playback ? "Playing" : "Recording"),
    meta.separator(),
    ...(s.binary ? [meta.text("Program", s.binary)] : []),
    ...(s.pid ? [meta.text("Process", s.pid)] : []),
    meta.text("Stream", `#${s.index}`),
  ];

  return {
    id: `${s.kind}:${s.index}`,
    title: s.app,
    subtitle: s.media,
    icon: s.iconName ??
      {
        source: playback ? (s.muted ? Icons.speakerOff : Icons.music) : Icons.mic,
        tint: s.muted ? "orange" : playback ? "blue" : "red",
      },
    section: playback ? "Playing" : "Recording",
    keywords: [s.binary ?? "", s.media ?? "", device?.description ?? ""].filter(Boolean),
    accessories,
    detail: { metadata },
    actions: [
      action(s.muted ? "Unmute" : "Mute", async () => {
        await setStreamMute(s, !s.muted);
        return refresh();
      }, { icon: s.muted ? Icons.speaker : Icons.speakerOff, shortcut: "<Ctrl>m" }),
      submenu(
        "Set Volume",
        LEVELS.map((v) =>
          action(`${v} %${v > 100 ? " (amplified)" : ""}`, async () => {
            await setStreamVolume(s, v);
            return refresh();
          }, { icon: v === s.volume ? Icons.check : Icons.speaker })
        ),
        { icon: Icons.speaker, shortcut: "<Ctrl>l" },
      ),
      ...moveAction(s, snap, device),
      action("Volume Up", async () => {
        await setStreamVolume(s, stepVolume(s.volume, 5));
        return refresh();
      }, { icon: Icons.arrowUp, shortcut: "<Alt>Up", section: "Volume" }),
      action("Volume Down", async () => {
        await setStreamVolume(s, stepVolume(s.volume, -5));
        return refresh();
      }, { icon: Icons.arrowDown, shortcut: "<Alt>Down", section: "Volume" }),
      copy(s.app, "Copy Application Name", { section: "Copy" }),
    ],
  };
}

export default list({
  placeholder: "Search applications playing or recording…",
  empty: {
    title: "No application is playing or recording",
    description: "Start some music or a call, then open this again",
    icon: Icons.music,
  },
  status: (items) => {
    const playing = items.filter((i) => i.section === "Playing").length;
    const recording = items.length - playing;
    return `${playing} playing${recording ? `, ${recording} recording` : ""}`;
  },
  async items() {
    const snap = await snapshot(true);
    return snap.streams
      .sort((a, b) =>
        Number(a.kind === "recording") - Number(b.kind === "recording") || Number(a.corked) - Number(b.corked) ||
        a.app.localeCompare(b.app)
      )
      .map((s) => item(s, snap));
  },
});
