import { type Action, action, copy, Icons, type Item, list, meta, open, refresh, toast } from "@backslash/api";
import { plural } from "../lib.ts";
import { bypass, detect, lastLoaded, load, type Preset, presets } from "../easyeffects.ts";

const bypassActions: Action[] = [
  action("Bypass All Effects", async () => {
    await bypass(true);
    await toast("Effects bypassed", { style: "success" });
  }, { icon: Icons.speakerOff, shortcut: "<Ctrl>b", section: "EasyEffects" }),
  action("Resume Effects", async () => {
    await bypass(false);
    await toast("Effects on", { style: "success" });
  }, { icon: Icons.sparkle, shortcut: "<Ctrl><Shift>b", section: "EasyEffects" }),
];

function item(p: Preset, current: boolean): Item {
  const output = p.kind === "output";
  return {
    id: `${p.kind}:${p.name}`,
    title: p.name,
    subtitle: p.effects.length ? p.effects.slice(0, 4).join(", ") + (p.effects.length > 4 ? "…" : "") : undefined,
    icon: { source: output ? Icons.headphones : Icons.mic, tint: current ? "green" : output ? "blue" : "purple" },
    section: output ? "Output Presets" : "Input Presets",
    keywords: [...p.effects, output ? "speakers" : "microphone"],
    accessories: [
      ...(p.effects.length ? [{ text: plural(p.effects.length, "effect") }] : []),
      ...(current ? [{ tag: "Last loaded", color: "green" as const }] : []),
    ],
    detail: {
      markdown: p.effects.length
        ? p.effects.map((e, i) => `${i + 1}. ${e}`).join("\n")
        : "_No effect, or the preset file couldn't be read._",
      metadata: [
        meta.text("Applies to", output ? "What you hear (output)" : "Your microphone (input)", {
          icon: output ? Icons.headphones : Icons.mic,
        }),
        meta.text("Effects", p.effects.length),
        ...(p.flatpak ? [meta.text("Installed", "Flatpak")] : []),
        ...(p.path ? [meta.text("File", p.path, { icon: Icons.file })] : []),
      ],
    },
    actions: [
      action("Load Preset", async () => {
        await load(p);
        await toast(`${p.name} loaded`, { style: "success" });
        return refresh();
      }, { icon: Icons.play }),
      ...(p.path ? [open(p.path, "Open Preset File", { icon: Icons.file, shortcut: "<Ctrl>o" })] : []),
      copy(p.name, "Copy Preset Name", { section: "Copy" }),
      ...bypassActions,
    ],
  };
}

export default list({
  placeholder: "Search EasyEffects presets…",
  empty: {
    title: "No EasyEffects preset",
    description:
      "Save a preset in EasyEffects (Presets → Save), or install EasyEffects from your package manager or Flathub",
    icon: Icons.sparkle,
  },
  actions: bypassActions,
  status: (items) => plural(items.length, "preset"),
  async items() {
    const [found, install, output, input] = await Promise.all([
      presets(),
      detect(),
      lastLoaded("output"),
      lastLoaded("input"),
    ]);
    if (install.kind === "missing" && !found.length) {
      throw new Error("EasyEffects is not installed: install it from your package manager or Flathub");
    }
    return found
      .sort((a, b) => a.kind.localeCompare(b.kind) * -1 || a.name.localeCompare(b.name))
      .map((p) => item(p, p.name === (p.kind === "output" ? output : input)));
  },
});
