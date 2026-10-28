import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  charge,
  has,
  infoLine,
  kindName,
  levelText,
  levelTint,
  lowestSummary,
  merge,
  parseHeadsetJson,
  parseHeadsetText,
  parseSolaar,
  parseUpowerDump,
  type Peripheral,
  sameDevice,
  sortByCharge,
} from "./lib.ts";

const fixture = (name: string) => Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url));

Deno.test("upower --dump: peripherals only", async () => {
  const list = parseUpowerDump(await fixture("upower-dump.txt"));
  // No AC adapter, laptop battery or summary.
  assertEquals(list.map((d) => d.kind), ["mouse", "keyboard", "headset", "gaming-input"]);
  const [mouse, keyboard, headset, pad] = list;
  assertEquals(mouse.name, "MX Master 3");
  assertEquals(mouse.percentage, 12);
  assertEquals(mouse.state, "discharging");
  assertEquals(mouse.serial, "4082-ab-cd-ef");
  assertEquals(mouse.updated, "30 seconds ago");
  assertEquals(mouse.bluetooth, false);
  assertEquals(mouse.rechargeable, true);
  // A coarse level: the percentage "should be ignored".
  assertEquals(keyboard.percentage, undefined);
  assertEquals(keyboard.level, "normal");
  assertEquals(charge(keyboard), 55);
  assertEquals(levelText(keyboard), "Normal");
  assertEquals(headset.percentage, 70);
  assertEquals(headset.bluetooth, true);
  assertEquals(headset.state, "unknown");
  assertEquals(pad.state, "charging");
  assertEquals(kindName(pad.kind), "Gamepad");
  assertEquals(parseUpowerDump(""), []);
});

Deno.test("solaar show", async () => {
  const list = parseSolaar(await fixture("solaar-show.txt"));
  assertEquals(list.map((d) => d.name), [
    "MX Master 3 Wireless Mouse",
    "Wireless Keyboard K270",
    "MX Anywhere 3",
    "G915 TKL",
  ]);
  const [master, k270, anywhere, g915] = list;
  assertEquals([master.kind, master.percentage, master.state], ["mouse", 15, "discharging"]);
  assertEquals(master.serial, "8A1B2C3D");
  assertEquals(master.path, "/dev/hidraw2");
  assertEquals(master.model, "MX Master 3");
  assertEquals([k270.percentage, k270.level, k270.path], [undefined, "good", undefined]);
  assertEquals([anywhere.percentage, anywhere.state, anywhere.bluetooth], [90, "charging", true]);
  assertEquals([g915.percentage, g915.state], [undefined, "unknown"]);
});

Deno.test("headsetcontrol -o json", async () => {
  const [nova, g533] = parseHeadsetJson(await fixture("headsetcontrol.json"));
  assertEquals(nova.name, "SteelSeries Arctis Nova 7");
  assertEquals(nova.percentage, 64);
  assertEquals(nova.state, "discharging");
  assertEquals(nova.path, "1038:2202");
  assert(has(nova, "sidetone"));
  assert(!has(nova, "lights"));
  assertEquals(g533.percentage, undefined);
  assertEquals(g533.state, "off");
  assertEquals(levelText(g533), "Off");
  assert(has(g533, "lights"));
  assertEquals(parseHeadsetJson('{"device_count": 0, "devices": []}'), []);
});

Deno.test("headsetcontrol 2.x text", () => {
  const [g] = parseHeadsetText("Found Logitech G533!\nBattery: 64%\nSuccess!");
  assertEquals([g.name, g.percentage, g.state], ["Logitech G533", 64, "discharging"]);
  // Capabilities unknown: every control is offered.
  assert(has(g, "lights"));
  assertEquals(parseHeadsetText("Found Corsair Void!\nBattery: Charging\n")[0].state, "charging");
  assertEquals(parseHeadsetText("No supported headset found"), []);
});

Deno.test("merging the sources", async () => {
  const upower = parseUpowerDump(await fixture("upower-dump.txt"));
  const solaar = parseSolaar(await fixture("solaar-show.txt"));
  const headsets = parseHeadsetJson(await fixture("headsetcontrol.json"));
  assert(sameDevice(upower[0], solaar[0]));
  assert(!sameDevice(upower[0], solaar[2]));
  const named = (name: string): Peripheral => ({ id: name, name, kind: "mouse", state: "unknown", source: "Solaar" });
  assert(!sameDevice(named("MX Master 3"), named("MX Master 2S")));
  assert(sameDevice(named("Arctis Nova 7"), named("SteelSeries Arctis Nova 7")));
  const all = merge(upower, solaar, headsets);
  // The MX Master 3 once, from UPower; the K270, MX Anywhere 3 and G915 from Solaar; both headsets.
  assertEquals(all.filter((d) => /MX Master/.test(d.name)).length, 1);
  assertEquals(all.length, 4 + 3 + 2);
  const sorted = sortByCharge(all);
  assertEquals(sorted[0].name, "MX Master 3");
  // Off and unknown levels last.
  assertEquals(sorted.at(-1)?.name, "Logitech G533");
  assertEquals(lowestSummary(all), "Mouse 12 %");
  // A charging device isn't "lowest".
  assertEquals(lowestSummary([{ ...upower[0], state: "charging" }]), undefined);
  assertEquals(lowestSummary([]), undefined);
});

Deno.test("HeadsetControl replaces UPower's twin, keeping its controls", () => {
  const up: Peripheral = {
    id: "u",
    name: "Arctis Nova 7",
    kind: "headset",
    percentage: 60,
    state: "discharging",
    source: "UPower",
  };
  const hc: Peripheral = {
    id: "h",
    name: "SteelSeries Arctis Nova 7",
    kind: "headset",
    percentage: 64,
    state: "discharging",
    source: "HeadsetControl",
    capabilities: ["sidetone"],
  };
  const [one, ...rest] = merge([up], [], [hc]);
  assertEquals(rest, []);
  assertEquals([one.source, one.percentage, one.capabilities], ["HeadsetControl", 64, ["sidetone"]]);
});

Deno.test("tints and lines", () => {
  const p = (percentage: number): Peripheral => ({
    id: "x",
    name: "MX",
    kind: "mouse",
    percentage,
    state: "discharging",
    source: "UPower",
  });
  assertEquals([5, 20, 45, 90].map((n) => levelTint(p(n))), ["red", "orange", "yellow", "green"]);
  assertEquals(levelTint({ state: "unknown" }), "gray");
  assertEquals(infoLine(p(55)), "MX (Mouse): 55 %, on battery");
  assertEquals(kindName("bluetooth-generic"), "Bluetooth Device");
  assertEquals(kindName("some-thing"), "Some Thing");
});

Deno.test("the manifest allows what the code runs", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
    commands: { name: string; mode?: string; interval?: string }[];
  };
  const code = await Deno.readTextFile(new URL("./system.ts", import.meta.url));
  const used = new Set([...code.matchAll(/sh\("([\w-]+)"/g)].map((m) => m[1]));
  assertEquals([...used].sort(), [...manifest.permissions.run].sort());
  const check = manifest.commands.find((c) => c.name === "battery-check")!;
  assertEquals([check.mode, check.interval], ["no-view", "30m"]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
