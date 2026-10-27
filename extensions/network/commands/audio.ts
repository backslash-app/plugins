import { action, exec, type Item, list, refresh } from "@backslash/api";
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
  return {
    id: d.name,
    title: d.description,
    subtitle: output ? "Output" : "Input",
    icon: output
      ? (/headphone|headset|casque/i.test(d.description) ? "audio-headphones" : "audio-speakers")
      : "audio-input-microphone",
    section: output ? "Outputs" : "Inputs",
    accessories: [
      ...(d.muted ? [{ tag: "Muted", color: "orange" as const }] : []),
      ...(d.isDefault ? [{ tag: "Active", color: "green" as const }] : []),
    ],
    actions: [
      ...(d.isDefault ? [] : [action(output ? "Use for Sound" : "Use as Microphone", async () => {
        await pactl(output ? "set-default-sink" : "set-default-source", d.name);
        return refresh();
      }, { icon: "object-select" })]),
      action(d.muted ? "Unmute" : "Mute", async () => {
        await pactl(output ? "set-sink-mute" : "set-source-mute", d.name, "toggle");
        return refresh();
      }, { icon: d.muted ? "audio-volume-high" : "audio-volume-muted", shortcut: "<Ctrl>m" }),
    ],
  };
}

export default list({
  placeholder: "Search outputs and microphones…",
  empty: { title: "No audio devices", description: "pactl (PipeWire or PulseAudio) is needed" },
  items: async () => (await devices()).map(item),
});
