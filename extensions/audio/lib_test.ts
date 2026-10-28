import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  clampVolume,
  deviceKind,
  pactlVersion,
  parseDevices,
  parseInfoDefault,
  parseMute,
  parsePresetList,
  parseStreams,
  parseWpctlStatus,
  parseWpctlVolume,
  presetDirs,
  presetEffects,
  stepVolume,
  supportsJson,
  volumeBar,
  volumeColor,
  volumeFromText,
  wpDevice,
} from "./lib.ts";

const fixture = (name: string) => Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url));

Deno.test("pactl version and JSON support", () => {
  assertEquals(pactlVersion("pactl 16.1\nCompiled with libpulse 16.1.0\nLinked with libpulse 16.1.0"), 16.1);
  assertEquals(pactlVersion("pactl 15.0\nCompiled with libpulse 15.0.0"), 15);
  assert(supportsJson(17));
  assert(!supportsJson(15));
  assert(!supportsJson(undefined));
});

Deno.test("sources from pactl -f json", async () => {
  const all = parseDevices(await fixture("sources.json"), true, "alsa_input.pci-0000_00_1f.3.analog-stereo");
  assertEquals(all.length, 3);
  const [monitor, builtin, webcam] = all;
  assert(monitor.monitorOf);
  assertEquals(builtin.monitorOf, undefined);
  assertEquals(builtin.description, "Built-in Audio Analog Stereo");
  assertEquals(builtin.volume, 70);
  assert(builtin.isDefault);
  assert(!builtin.muted);
  assertEquals(builtin.activePort, "analog-input-internal-mic");
  assertEquals(builtin.ports.map((p) => [p.description, p.available]), [["Internal Microphone", true], [
    "Microphone",
    false,
  ]]);
  assertEquals(builtin.channels, 2);
  assertEquals(builtin.state, "RUNNING");
  assert(webcam.muted);
  assert(!webcam.isDefault);
  assertEquals(webcam.volume, 95);
  assertEquals(deviceKind(webcam), "Webcam");
  assertEquals(deviceKind(builtin), "Built-in");
});

Deno.test("sources from pactl's text output", async () => {
  const all = parseDevices(await fixture("sources.txt"), false, "bluez_input.AA:BB:CC:DD:EE:FF");
  assertEquals(all.map((d) => d.index), [47, 50, 55]);
  const [builtin, monitor, headset] = all;
  assertEquals(builtin.name, "alsa_input.pci-0000_00_1f.3.analog-stereo");
  assertEquals(builtin.volume, 70);
  assertEquals(builtin.monitorOf, undefined);
  assertEquals(builtin.bus, "pci");
  assertEquals(builtin.ports.map((p) => [p.name, p.description, p.available]), [
    ["analog-input-internal-mic", "Internal Microphone", true],
    ["analog-input-mic", "Microphone", false],
  ]);
  assertEquals(builtin.activePort, "analog-input-internal-mic");
  assertEquals(monitor.monitorOf, "bluez_output.AA_BB_CC_DD_EE_FF.1");
  assert(headset.isDefault);
  assert(headset.muted);
  assertEquals(headset.volume, 60);
  assertEquals(headset.channels, 1);
  assertEquals(deviceKind(headset), "Bluetooth");
});

Deno.test("streams of applications", async () => {
  const playing = parseStreams(await fixture("sink-inputs.json"), true, "playback");
  // pavucontrol's level meter is left out.
  assertEquals(playing.map((s) => s.app), ["Firefox", "Spotify"]);
  const [firefox, spotify] = playing;
  assertEquals(firefox.volume, 80);
  assertEquals(firefox.device, 52);
  assertEquals(firefox.media, undefined); // "AudioStream" says nothing
  assertEquals(firefox.iconName, "firefox");
  assertEquals(firefox.pid, "4242");
  assertEquals(spotify.media, "Daft Punk - Veridis Quo");
  assert(spotify.corked);
  assert(spotify.muted);
  const recording = parseStreams(await fixture("source-outputs.txt"), false, "recording");
  assertEquals(recording.length, 1);
  assertEquals(recording[0].app, "Zoom");
  assertEquals(recording[0].kind, "recording");
  assertEquals(recording[0].device, 47);
  assertEquals(recording[0].media, 'Zoom "meeting" capture');
  assertEquals(recording[0].volume, 100);
  assertEquals(parseStreams("[]", true, "playback"), []);
  assertEquals(parseStreams("", false, "playback"), []);
});

Deno.test("pactl info and mute", () => {
  const info =
    "Server String: /run/user/1000/pulse/native\nDefault Sink: alsa_output.pci.analog-stereo\nDefault Source: alsa_input.pci.analog-stereo\n";
  assertEquals(parseInfoDefault(info, "Source"), "alsa_input.pci.analog-stereo");
  assertEquals(parseInfoDefault(info, "Sink"), "alsa_output.pci.analog-stereo");
  assert(parseMute("Mute: yes"));
  assert(!parseMute("Mute: no"));
  assertEquals(volumeFromText("mono: 39322 /  60% / -13.31 dB"), 60);
});

Deno.test("wpctl status", async () => {
  const status = parseWpctlStatus(await fixture("wpctl-status.txt"));
  assertEquals(status.sinks, [{
    id: 46,
    name: "Built-in Audio Analog Stereo",
    isDefault: true,
    volume: 40,
    muted: false,
  }]);
  assertEquals(status.sources, [
    { id: 47, name: "Built-in Audio Analog Stereo", isDefault: true, volume: 100, muted: false },
    { id: 61, name: "HD Pro Webcam C920 Analog Stereo", isDefault: false, volume: 75, muted: true },
  ]);
  // Video sources are not audio.
  assert(!status.sources.some((s) => s.id === 62));
  assertEquals(status.streams, [
    { id: 64, app: "Firefox", kind: "playback", target: "Built-in Audio" },
    { id: 70, app: "Zoom", kind: "recording", target: "HD Pro Webcam C920" },
  ]);
  assertEquals(parseWpctlVolume("Volume: 0.60 [MUTED]"), { volume: 60, muted: true });
  assertEquals(parseWpctlVolume("Volume: 1.00"), { volume: 100, muted: false });
  assertEquals(wpDevice(status.sources[1]).name, "61");
});

Deno.test("volumes", () => {
  assertEquals(stepVolume(47, 5), 50);
  assertEquals(stepVolume(50, 5), 55);
  assertEquals(stepVolume(52, -5), 50);
  assertEquals(stepVolume(50, -5), 45);
  assertEquals(stepVolume(2, -5), 0);
  assertEquals(stepVolume(149, 5), 150);
  assertEquals(clampVolume(170), 150);
  assertEquals(volumeColor(50, true), "gray");
  assertEquals(volumeColor(120, false), "red");
  assertEquals(volumeColor(10, false), "orange");
  assertEquals(volumeBar(40), "▮▮▮▮▯▯▯▯▯▯");
  assertEquals(volumeBar(130, 4), "▮▮▮▮");
});

Deno.test("EasyEffects presets", async () => {
  assertEquals(presetEffects(await fixture("preset.json")), ["Equalizer", "Bass Enhancer", "Limiter"]);
  assertEquals(presetEffects(JSON.stringify({ input: { plugins_order: ["rnnoise#0", "gate#1"] } })), [
    "Noise Reduction",
    "Gate",
  ]);
  assertEquals(presetEffects("not json"), []);
  assertEquals(parsePresetList("Output Presets: Bass Boost,Loudness+Autogain,\nInput Presets: Noise Reduction,\n"), {
    output: ["Bass Boost", "Loudness+Autogain"],
    input: ["Noise Reduction"],
  });
  assertEquals(parsePresetList(""), { output: [], input: [] });
  const dirs = presetDirs("/home/ada");
  assertEquals(dirs[0], { dir: "/home/ada/.local/share/easyeffects/output", kind: "output", flatpak: false });
  assert(dirs.some((d) => d.dir === "/home/ada/.config/easyeffects/input"));
  assert(dirs.some((d) => d.flatpak && d.dir.includes(".var/app/com.github.wwmm.easyeffects")));
});

Deno.test("the manifest allows what the code runs and reads", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[]; read: string[] };
    commands: { name: string; title: string }[];
  };
  const code = (await Promise.all(
    ["system.ts", "easyeffects.ts"].map((f) => Deno.readTextFile(new URL(`./${f}`, import.meta.url))),
  ))
    .join("\n");
  const used = new Set([...code.matchAll(/sh\("([\w-]+)"/g)].map((m) => m[1]));
  for (const m of code.matchAll(/\["(easyeffects|flatpak)", /g)) used.add(m[1]);
  for (const p of used) assert(manifest.permissions.run.includes(p), `${p} is not in run`);
  assert(used.has("pactl") && used.has("wpctl") && used.has("gsettings"));
  for (const d of presetDirs("~")) {
    assert(manifest.permissions.read.some((r) => d.dir.startsWith(r)), `${d.dir} is not readable`);
  }
  // Not the network extension's "Audio Output".
  assert(!manifest.commands.some((c) => c.title === "Audio Output"));
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
