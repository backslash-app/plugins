import { action, exec, Icons, type Item, list, meta, refresh } from "@backslash/api";
import { type AudioDevice, parseAudio } from "../lib.ts";

const pactl = (...args: string[]) => exec("pactl", args);

async function devices(): Promise<AudioDevice[]> {
  const [sinks, sources, sink, source] = await Promise.all([
    pactl("-f", "json", "list", "sinks"),
    pactl("-f", "json", "list", "sources"),
    pactl("get-default-sink"),
    pactl("get-default-source"),
  ]);
  return [...parseAudio(sinks, "output", sink.trim()), ...parseAudio(sources, "input", source.trim())];
}

function item(d: AudioDevice): Item {
  const output = d.kind === "output";
  const icon = output
    ? (/headphone|headset|casque/i.test(d.description) ? Icons.headphones : Icons.speaker)
    : Icons.mic;
  return {
    id: d.name,
    title: d.description,
    subtitle: d.isDefault ? (output ? "Playing sound" : "Recording") : undefined,
    icon: { source: d.muted ? (output ? Icons.speakerOff : Icons.mic) : icon, tint: d.isDefault ? "green" : "gray" },
    section: output ? "Outputs" : "Inputs",
    accessories: [
      ...(d.muted ? [{ tag: "Muted", color: "orange" as const }] : []),
      ...(d.isDefault ? [{ icon: { source: Icons.check, tint: "green" as const }, tooltip: "In use" }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Kind", output ? "Output (speakers, headphones)" : "Input (microphone)", { icon }),
        meta.text("In use", d.isDefault ? "Yes" : "No", { color: d.isDefault ? "green" : undefined }),
        meta.text("Muted", d.muted ? "Yes" : "No", { color: d.muted ? "orange" : undefined }),
        meta.text("Device", d.name),
      ],
    },
    actions: [
      ...(d.isDefault ? [] : [action(output ? "Use for Sound" : "Use as Microphone", async () => {
        await pactl(output ? "set-default-sink" : "set-default-source", d.name);
        return refresh();
      }, { icon: Icons.check })]),
      action(d.muted ? "Unmute" : "Mute", async () => {
        await pactl(output ? "set-sink-mute" : "set-source-mute", d.name, "toggle");
        return refresh();
      }, { icon: d.muted ? Icons.speaker : Icons.speakerOff, shortcut: "<Ctrl>m" }),
    ],
  };
}

export default list({
  placeholder: "Search outputs and microphones…",
  empty: { title: "No audio devices", description: "pactl (PipeWire or PulseAudio) is needed", icon: "bs-speaker" },
  status: (items) => {
    const out = items.find((i) => i.section === "Outputs" && i.subtitle);
    return out ? `Sound on ${out.title}` : "Audio";
  },
  items: async () => (await devices()).map(item),
});
