import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { clipUrl, eventUrl, liveUrl, server, SetupError } from "./api.ts";
import {
  ago,
  cameraLook,
  duration,
  eventTitle,
  fps,
  inGroup,
  labelColor,
  latestByCamera,
  parseCameras,
  parseEvents,
  parseSnapshotName,
  percent,
  prettyName,
  type RawEvent,
  safeId,
  snapshotName,
  version,
} from "./lib.ts";
import { HOSTS, isAllowedHost } from "./net.ts";

// Shaped like Frigate 0.14's /api/config and /api/stats.
const CONFIG = {
  cameras: {
    front_door: {
      enabled: true,
      detect: { enabled: true, width: 1280, height: 720, fps: 5 },
      record: { enabled: true },
      snapshots: { enabled: true },
      objects: { track: ["person", "car", "package"] },
      zones: { porch: {}, driveway: {} },
      ui: { order: 1 },
    },
    garden: {
      enabled: true,
      friendly_name: "Back Garden",
      detect: { enabled: true, width: 640, height: 360 },
      record: { enabled: false },
      snapshots: { enabled: true },
      ui: { order: 0 },
    },
    garage: { enabled: false, detect: { enabled: false } },
  },
};

const STATS = {
  cameras: {
    front_door: {
      camera_fps: 5.1,
      process_fps: 5.1,
      skipped_fps: 0,
      detection_fps: 1.2,
      detection_enabled: 1,
      pid: 300,
    },
    garden: { camera_fps: 0, process_fps: 0, skipped_fps: 0, detection_fps: 0, detection_enabled: false, pid: 301 },
  },
  detectors: { coral: { inference_speed: 8.4 } },
  service: { version: "0.14.1-f4f3cfa", uptime: 86400, latest_version: "0.14.1" },
};

const EVENTS: RawEvent[] = [
  {
    id: "1792483100.123456-abc123",
    camera: "front_door",
    label: "person",
    sub_label: ["Ada", 0.92],
    top_score: 0.84,
    start_time: 1792483100.12,
    end_time: 1792483145.9,
    has_clip: true,
    has_snapshot: true,
    retain_indefinitely: false,
    zones: ["porch"],
    data: { top_score: 0.87, score: 0.8, type: "object" },
  },
  {
    id: "1792483190.5-def456",
    camera: "front_door",
    label: "car",
    sub_label: null,
    top_score: 0.71,
    start_time: 1792483190.5,
    end_time: null,
    has_clip: true,
    has_snapshot: false,
    zones: [],
  },
  {
    id: "1792400000.0-cat",
    camera: "garden",
    label: "cat",
    sub_label: "Felix",
    start_time: 1792400000,
    end_time: 1792400012,
    has_clip: false,
    has_snapshot: true,
    retain_indefinitely: true,
    zones: [],
    data: { top_score: 0.66, description: "An orange cat crosses the lawn." },
  },
];

Deno.test("cameras: config and stats, ordered as in Frigate's UI", () => {
  const cams = parseCameras(CONFIG, STATS);
  assertEquals(cams.map((c) => c.name), ["garden", "front_door", "garage"]);
  const [garden, front, garage] = cams;
  assertEquals(front.title, "Front Door");
  assertEquals(front.detecting, true);
  assertEquals(front.recording, true);
  assertEquals(front.fps, 5.1);
  assertEquals(front.objects, ["person", "car", "package"]);
  assertEquals(front.zones, ["porch", "driveway"]);
  assertEquals(front.resolution, "1280×720");
  assertEquals(garden.title, "Back Garden");
  // Detection turned off at runtime: the stats say so, the config doesn't.
  assertEquals(garden.detecting, false);
  assertEquals(garden.objects, ["person"]);
  assertEquals(garage.enabled, false);
  assertEquals(cameraLook(front), { label: "Detecting", color: "green" });
  assertEquals(cameraLook(garden), { label: "No signal", color: "red" });
  assertEquals(cameraLook(garage).label, "Disabled");
  assertEquals(cameraLook({ ...garden, fps: 4 }).label, "Detection off");
  assertEquals(parseCameras(undefined, undefined), []);
});

Deno.test("events: newest first, sub labels, scores, in progress", () => {
  const events = parseEvents(EVENTS);
  assertEquals(events.map((e) => e.label), ["car", "person", "cat"]);
  const [car, person, cat] = events;
  assertEquals(car.end, undefined);
  assertEquals(car.score, 0.71);
  assertEquals(person.subLabel, "Ada");
  assertEquals(person.score, 0.87);
  assertEquals(person.start, 1792483100120);
  assertEquals(person.zones, ["porch"]);
  assertEquals(eventTitle(person), "Person (Ada)");
  assertEquals(eventTitle(car), "Car");
  assertEquals(cat.subLabel, "Felix");
  assertEquals(cat.retained, true);
  assertEquals(cat.description, "An orange cat crosses the lawn.");
  assertEquals(latestByCamera(events).get("front_door")?.label, "car");
  assertEquals(latestByCamera(events).get("garden")?.label, "cat");
  assertEquals(parseEvents([{ id: "", camera: "x", label: "y", start_time: 1 }]), []);
});

Deno.test("label groups, icons and colors", () => {
  assert(inGroup("person", "people"));
  assert(inGroup("car", "vehicles"));
  assert(inGroup("dog", "animals"));
  assert(!inGroup("dog", "people"));
  assert(inGroup("package", "all"));
  assert(inGroup("package", undefined));
  assertEquals(labelColor("person"), "blue");
  assertEquals(labelColor("package"), "orange");
});

Deno.test("snapshot file names and ids", () => {
  const at = Date.parse("2026-10-31T10:00:00Z");
  assertEquals(snapshotName("front_door", at), "front_door-1793440800.jpg");
  assertEquals(parseSnapshotName("front_door-1793440800.jpg"), { camera: "front_door", at });
  assertEquals(parseSnapshotName("cam-2-1793440800.jpg")?.camera, "cam-2");
  assertEquals(parseSnapshotName("notes.txt"), undefined);
  assert(safeId("1792483100.123456-abc123"));
  assert(!safeId("../etc/passwd"));
});

Deno.test("formatting", () => {
  const now = Date.parse("2026-10-31T10:00:00Z");
  assertEquals(ago(now - 90_000, now), "1m ago");
  assertEquals(duration(45_780), "46s");
  assertEquals(duration(125_000), "2m 5s");
  assertEquals(duration(3_900_000), "1h 5m");
  assertEquals(percent(0.871), "87 %");
  assertEquals(fps(5.06), "5.1 fps");
  assertEquals(fps(15), "15 fps");
  assertEquals(version("0.14.1-f4f3cfa"), "0.14.1");
  assertEquals(prettyName("back-yard_cam"), "Back Yard Cam");
});

Deno.test("server and links", () => {
  const s = server({ url: "frigate.lan:5000/" });
  assertEquals(s.base, "http://frigate.lan:5000");
  assertEquals(s.user, undefined);
  assertEquals(liveUrl(s, "front_door"), "http://frigate.lan:5000/#front_door");
  assertEquals(eventUrl(s, "1.2-ab"), "http://frigate.lan:5000/explore?event_id=1.2-ab");
  assertEquals(clipUrl(s, "1.2-ab"), "http://frigate.lan:5000/api/events/1.2-ab/clip.mp4");
  assertEquals(server({ url: "https://frigate:8971", username: "admin", password: "x" }).user, "admin");
  assertThrows(() => server({ url: "" }), SetupError, "Add the address");
  assertThrows(() => server({ url: "https://nvr.example.com" }), SetupError, "outside");
  assert(isAllowedHost("frigate"));
});

Deno.test("hosts and cache folder match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[]; read: string[]; write: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assertEquals(manifest.permissions.read, ["~/.cache/backslash/cameras"]);
  assertEquals(manifest.permissions.write, ["~/.cache/backslash/cameras"]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
