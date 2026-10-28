import { assert, assertEquals } from "@std/assert";
import {
  busValue,
  deviceUses,
  mergeUses,
  parseFuser,
  parseGeoclueClients,
  parsePs,
  parsePwDump,
  parseSourceOutputs,
  prettyApp,
  since,
  subtitle,
  type Use,
} from "./lib.ts";

// pw-dump of PipeWire 1.0, trimmed: Firefox uses the camera and the microphone, cava reads the
// speakers' monitor (not the mic), OBS records a screencast from xdg-desktop-portal-wlr.
const PW = JSON.stringify([
  { id: 0, type: "PipeWire:Interface:Core", info: { name: "pipewire-0" } },
  {
    id: 33,
    type: "PipeWire:Interface:Client",
    info: { props: { "application.name": "WirePlumber", "application.process.binary": "wireplumber" } },
  },
  {
    id: 75,
    type: "PipeWire:Interface:Client",
    info: {
      props: {
        "application.name": "Firefox",
        "application.process.binary": "firefox",
        "application.process.id": 4242,
        "pipewire.access.portal.app_id": "org.mozilla.firefox",
      },
    },
  },
  {
    id: 90,
    type: "PipeWire:Interface:Client",
    info: { props: { "application.name": "xdg-desktop-portal-wlr", "application.process.id": 1500 } },
  },
  {
    id: 91,
    type: "PipeWire:Interface:Client",
    info: {
      props: { "application.name": "OBS Studio", "application.process.binary": "obs", "application.process.id": 5100 },
    },
  },
  {
    id: 45,
    type: "PipeWire:Interface:Node",
    info: {
      state: "running",
      props: {
        "media.class": "Video/Source",
        "node.name": "v4l2_input.pci-0000_00_14.0-usb-0_6_1.0",
        "node.description": "Integrated Camera (V4L2)",
        "device.api": "v4l2",
        "client.id": 33,
      },
    },
  },
  {
    id: 56,
    type: "PipeWire:Interface:Node",
    info: { props: { "media.class": "Audio/Source", "node.description": "Built-in Audio Analog Stereo" } },
  },
  {
    id: 57,
    type: "PipeWire:Interface:Node",
    info: { props: { "media.class": "Audio/Sink", "node.description": "Speakers" } },
  },
  {
    id: 79,
    type: "PipeWire:Interface:Node",
    info: { state: "running", props: { "media.class": "Stream/Input/Video", "client.id": 75 } },
  },
  {
    id: 82,
    type: "PipeWire:Interface:Node",
    info: { state: "running", props: { "media.class": "Stream/Input/Audio", "client.id": 75 } },
  },
  {
    id: 83,
    type: "PipeWire:Interface:Node",
    info: { state: "running", props: { "media.class": "Stream/Input/Audio", "application.name": "cava" } },
  },
  {
    id: 95,
    type: "PipeWire:Interface:Node",
    info: { state: "running", props: { "media.class": "Video/Source", "node.name": "xdpw_stream", "client.id": 90 } },
  },
  {
    id: 96,
    type: "PipeWire:Interface:Node",
    info: { state: "running", props: { "media.class": "Stream/Input/Video", "node.name": "OBS", "client.id": 91 } },
  },
  { id: 100, type: "PipeWire:Interface:Link", info: { "output-node-id": 45, "input-node-id": 79, state: "active" } },
  { id: 101, type: "PipeWire:Interface:Link", info: { "output-node-id": 56, "input-node-id": 82, state: "active" } },
  { id: 102, type: "PipeWire:Interface:Link", info: { "output-node-id": 57, "input-node-id": 83, state: "active" } },
  { id: 103, type: "PipeWire:Interface:Link", info: { "output-node-id": 95, "input-node-id": 96, state: "active" } },
]);

Deno.test("parsePwDump finds camera, microphone and screen users", () => {
  const uses = parsePwDump(PW);
  assertEquals(uses.map((u) => [u.kind, u.app, u.pid, u.device]), [
    ["camera", "Firefox", 4242, "Integrated Camera (V4L2)"],
    ["screen", "OBS Studio", 5100, "xdpw_stream"],
    ["microphone", "Firefox", 4242, "Built-in Audio Analog Stereo"],
  ]);
  assertEquals(uses[0].appId, "org.mozilla.firefox");
  assertEquals(parsePwDump("not json"), []);
});

Deno.test("parsePwDump shows a running screencast even without a viewer", () => {
  const dump = JSON.parse(PW).filter((o: { id: number }) => o.id !== 103);
  const uses = parsePwDump(JSON.stringify(dump));
  const screen = uses.find((u) => u.kind === "screen")!;
  assertEquals([screen.app, screen.pid], ["xdg-desktop-portal-wlr", 1500]);
});

Deno.test("parseSourceOutputs keeps mic recordings, drops monitors and level meters", () => {
  const outputs = JSON.stringify([
    {
      index: 42,
      source: 56,
      corked: false,
      mute: false,
      properties: {
        "application.name": "Firefox",
        "application.process.id": "4242",
        "application.process.binary": "firefox",
      },
    },
    { index: 43, source: 57, properties: { "application.name": "cava" } },
    { index: 44, source: 56, properties: { "media.name": "Peak detect", "application.process.binary": "pavucontrol" } },
    {
      index: 45,
      source: 56,
      corked: true,
      properties: { "application.name": "Discord", "application.process.id": "777" },
    },
  ]);
  const sources = JSON.stringify([
    { index: 56, name: "alsa_input.pci-0000_00_1f.3.analog-stereo", description: "Built-in Audio", mute: true },
    { index: 57, name: "alsa_output.pci-0000_00_1f.3.analog-stereo.monitor", description: "Monitor of Speakers" },
  ]);
  const uses = parseSourceOutputs(outputs, sources);
  assertEquals(uses.map((u) => [u.app, u.pid, u.streamIndex, u.paused]), [["Firefox", 4242, 42, false], [
    "Discord",
    777,
    45,
    true,
  ]]);
  assertEquals(uses[0].sourceName, "alsa_input.pci-0000_00_1f.3.analog-stereo");
  assertEquals(uses[0].sourceMuted, true);
  assertEquals(parseSourceOutputs("[]", ""), []);
});

Deno.test("fuser, ps and device holders", () => {
  assertEquals(parseFuser(" 1180m 7777"), [1180, 7777]);
  assertEquals(parseFuser(""), []);
  const procs = parsePs(
    " 1180   9000 ada      pipewire        /usr/bin/pipewire\n 7777     65 ada      zoom            /opt/zoom/zoom --x\n",
  );
  assertEquals(procs.get(7777), { pid: 7777, elapsed: 65, user: "ada", comm: "zoom", args: "/opt/zoom/zoom --x" });
  const uses = deviceUses([{ device: "/dev/video0", pids: [1180, 7777] }], procs);
  assertEquals(uses.map((u) => [u.app, u.pid, u.device]), [["Zoom", 7777, "/dev/video0"]]);
});

Deno.test("mergeUses keeps one row per app, filling blanks", () => {
  const a: Use = { kind: "microphone", key: "m1", app: "Firefox", pid: 4242, via: "pulse", streamIndex: 42 };
  const b: Use = {
    kind: "microphone",
    key: "m2",
    app: "Firefox",
    pid: 4242,
    via: "pipewire",
    appId: "org.mozilla.firefox",
  };
  const c: Use = { kind: "camera", key: "c", app: "Firefox", pid: 4242, via: "pipewire" };
  const merged = mergeUses([a], [b, c]);
  assertEquals(merged.length, 2);
  assertEquals([merged[0].via, merged[0].streamIndex, merged[0].appId, merged[0].key], [
    "pulse",
    42,
    "org.mozilla.firefox",
    "microphone:4242",
  ]);
});

Deno.test("GeoClue client listing", () => {
  assertEquals(
    parseGeoclueClients(
      "/org/freedesktop/GeoClue2\n/org/freedesktop/GeoClue2/Client\n/org/freedesktop/GeoClue2/Client/3\n",
    ),
    ["/org/freedesktop/GeoClue2/Client/3"],
  );
  assertEquals(parseGeoclueClients("└─ /org/freedesktop/GeoClue2/Client/1"), ["/org/freedesktop/GeoClue2/Client/1"]);
  assertEquals(busValue('{"type":"b","data":true}'), true);
  assertEquals(busValue("nope"), undefined);
});

Deno.test("words", () => {
  const u = (kind: Use["kind"], paused = false): Use => ({ kind, key: kind, app: "x", via: "pipewire", paused });
  assertEquals(subtitle([]), null);
  assertEquals(subtitle([u("camera")]), "Camera in use");
  assertEquals(subtitle([u("camera"), u("microphone")]), "Camera and microphone in use");
  assertEquals(subtitle([u("screen")]), "Screen shared");
  assertEquals(subtitle([u("microphone"), u("screen")]), "Microphone in use, screen shared");
  assertEquals(subtitle([u("microphone", true)]), null);
  assertEquals(since(42), "42 s");
  assertEquals(since(3900), "1 h 05 min");
  assertEquals(prettyApp("google-chrome"), "Google Chrome");
  assertEquals(prettyApp("OBS"), "OBS");
  assert(since(90000).startsWith("1 d"));
});
