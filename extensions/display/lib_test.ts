import { assertEquals } from "@std/assert";
import {
  aspect,
  logicalSize,
  parseBrightnessctl,
  parseBusctl,
  parseDdcDetect,
  parseDdcVcp,
  parseGsettings,
  parseHyprctl,
  parseKscreen,
  parseMutter,
  parseSway,
  parseUdevAttrs,
  parseUdevDb,
  parseWlrRandrJson,
  parseWlrRandrText,
  parseXrandr,
  percent,
  rawFor,
  refreshText,
  scaleText,
  stepped,
  systemdRunArgs,
  warmerCandidates,
  warmerCommand,
} from "./lib.ts";

Deno.test("brightnessctl", () => {
  const out = "intel_backlight,backlight,19200,40%,48000\nacpi_video0,backlight,5,50%,10\ninput3::capslock,leds,0,0%,1";
  const list = parseBrightnessctl(out);
  assertEquals(list.map((b) => [b.id, percent(b)]), [["intel_backlight", 40], ["acpi_video0", 50]]);
  assertEquals(rawFor(list[0], 50), 24000);
  assertEquals(rawFor(list[0], 0), 1); // never fully black
  assertEquals(rawFor({ ...list[0], kind: "ddc", max: 100 }, 0), 0);
});

Deno.test("sysfs through udevadm", () => {
  const db = `P: /devices/pci0000:00/0000:00:02.0/drm/card1/card1-eDP-1/intel_backlight
M: intel_backlight
R: _backlight
U: backlight
E: DEVPATH=/devices/pci0000:00/0000:00:02.0/drm/card1/card1-eDP-1/intel_backlight
E: SUBSYSTEM=backlight

P: /devices/LNXSYSTM:00
E: SUBSYSTEM=acpi
`;
  assertEquals(parseUdevDb(db, "backlight").map((d) => d.path.split("/").pop()), ["intel_backlight"]);
  const attrs = `
Udevadm info starts with the device specified by the devpath and then
walks up the chain of parent devices.

  looking at device '/devices/pci0000:00/0000:00:02.0/drm/card1/card1-eDP-1/intel_backlight':
    KERNEL=="intel_backlight"
    SUBSYSTEM=="backlight"
    ATTR{actual_brightness}=="19200"
    ATTR{brightness}=="19200"
    ATTR{max_brightness}=="96000"
    ATTR{type}=="raw"

  looking at parent device '/devices/pci0000:00/0000:00:02.0/drm/card1/card1-eDP-1':
    ATTR{brightness}=="0"
`;
  const a = parseUdevAttrs(attrs);
  assertEquals([a.brightness, a.max_brightness, a.type], ["19200", "96000", "raw"]);
});

Deno.test("steps and presets", () => {
  assertEquals([stepped(43, 10), stepped(50, 10), stepped(95, 10), stepped(100, 10)], [50, 60, 100, 100]);
  assertEquals([stepped(43, -10), stepped(40, -10), stepped(10, -10), stepped(3, -10)], [40, 30, 1, 1]);
});

Deno.test("ddcutil", () => {
  const detect = `Display 1
   I2C bus:  /dev/i2c-6
   DRM connector:           card1-DP-1
   Monitor:                 DEL:DELL U2720Q:7XYZ123

Display 2
   I2C bus:  /dev/i2c-7
   DRM connector:           card1-HDMI-A-1
   Monitor:                 GSM:LG ULTRAGEAR:

Invalid display
   I2C bus:  /dev/i2c-4
   DRM connector:           card1-eDP-1
`;
  assertEquals(parseDdcDetect(detect), [
    { display: 1, model: "DELL U2720Q", bus: "/dev/i2c-6", connector: "DP-1" },
    { display: 2, model: "LG ULTRAGEAR", bus: "/dev/i2c-7", connector: "HDMI-A-1" },
  ]);
  assertEquals(parseDdcVcp("VCP 10 C 50 100"), { current: 50, max: 100 });
  assertEquals(parseDdcVcp("VCP 10 ERR"), undefined);
});

Deno.test("night light settings", () => {
  assertEquals(parseGsettings("true\n"), true);
  assertEquals(parseGsettings("uint32 2700"), 2700);
  assertEquals(parseGsettings("20.0"), 20);
  assertEquals(parseGsettings("'manual'"), "manual");
  assertEquals(parseBusctl("b true"), true);
  assertEquals(parseBusctl("u 4500"), 4500);
  assertEquals(parseBusctl('s "Automatic"'), "Automatic");
  assertEquals(warmerCandidates({ wayland: true, desktop: "hyprland" }), ["hyprsunset", "wlsunset", "gammastep"]);
  assertEquals(warmerCandidates({ wayland: false, desktop: "other" }), ["gammastep", "redshift"]);
  assertEquals(warmerCommand("wlsunset", 4000), ["wlsunset", "-t", "4000", "-T", "4001"]);
  assertEquals(warmerCommand("gammastep", 99999), ["gammastep", "-l", "0:0", "-t", "6500:6500", "-r"]);
  assertEquals(warmerCommand("hyprsunset", 3500), ["hyprsunset", "-t", "3500"]);
  assertEquals(systemdRunArgs("backslash-night-light", ["wlsunset"], { WAYLAND_DISPLAY: "wayland-1" }).slice(-2), [
    "--setenv=WAYLAND_DISPLAY=wayland-1",
    "wlsunset",
  ]);
});

Deno.test("hyprctl monitors", () => {
  const json = JSON.stringify([{
    id: 0,
    name: "eDP-1",
    description: "BOE 0x095F",
    make: "BOE",
    model: "0x095F",
    serial: "",
    width: 2256,
    height: 1504,
    refreshRate: 59.999,
    x: 0,
    y: 0,
    activeWorkspace: { id: 1, name: "1" },
    scale: 1.57,
    transform: 0,
    focused: true,
    dpmsStatus: true,
    vrr: false,
    disabled: false,
    availableModes: ["2256x1504@60.00Hz", "2256x1504@48.00Hz"],
  }]);
  const [m] = parseHyprctl(json);
  assertEquals([m.name, m.description, m.width, m.height, m.primary, m.builtin, m.transform], [
    "eDP-1",
    "BOE 0x095F",
    2256,
    1504,
    true,
    true,
    "normal",
  ]);
  assertEquals(m.modes, ["2256×1504 @ 60 Hz", "2256×1504 @ 48 Hz"]);
  assertEquals([refreshText(m), scaleText(m.scale), logicalSize(m)], ["60 Hz", "1.57×", "1437 × 958"]);
});

Deno.test("sway outputs", () => {
  const json = JSON.stringify([{
    name: "DP-1",
    make: "Dell Inc.",
    model: "DELL U2720Q",
    serial: "ABC123",
    active: true,
    scale: 1.5,
    transform: "normal",
    current_mode: { width: 3840, height: 2160, refresh: 59997 },
    modes: [{ width: 3840, height: 2160, refresh: 59997 }, { width: 1920, height: 1080, refresh: 60000 }],
    rect: { x: 1504, y: 0, width: 2560, height: 1440 },
    focused: false,
    adaptive_sync_status: "disabled",
  }]);
  const [m] = parseSway(json);
  assertEquals([m.description, m.refresh, m.x, m.builtin, m.vrr], [
    "Dell Inc. DELL U2720Q",
    59.997,
    1504,
    false,
    false,
  ]);
  assertEquals(m.modes, ["3840×2160 @ 60 Hz", "1920×1080 @ 60 Hz"]);
});

Deno.test("wlr-randr", () => {
  const json = JSON.stringify([{
    name: "eDP-1",
    description: "Sharp Corporation 0x14F9 (eDP-1)",
    make: "Sharp Corporation",
    model: "0x14F9",
    serial: null,
    enabled: true,
    modes: [{ width: 2256, height: 1504, refresh: 59.999001, preferred: true, current: true }],
    position: { x: 0, y: 0 },
    transform: "normal",
    scale: 1.5,
    adaptive_sync: false,
  }]);
  const [j] = parseWlrRandrJson(json);
  assertEquals([j.description, j.width, j.scale, j.serial], ["Sharp Corporation 0x14F9", 2256, 1.5, undefined]);

  const text = `eDP-1 "Sharp Corporation 0x14F9 (eDP-1)"
  Make: Sharp Corporation
  Model: 0x14F9
  Serial: (null)
  Physical size: 290x190 mm
  Enabled: yes
  Modes:
    2256x1504 px, 59.999001 Hz (preferred, current)
    1920x1200 px, 59.950001 Hz
  Position: 0,0
  Transform: normal
  Scale: 1.500000
  Adaptive Sync: disabled
HDMI-A-1 "LG Electronics LG ULTRAGEAR (HDMI-A-1)"
  Make: LG Electronics
  Model: LG ULTRAGEAR
  Serial: 0x0000BEEF
  Enabled: no
  Modes:
    2560x1440 px, 143.912003 Hz (preferred)
  Position: 2256,0
  Transform: 90
  Scale: 1.000000
`;
  const [a, b] = parseWlrRandrText(text);
  assertEquals([a.description, a.width, a.height, a.refresh, a.scale, a.serial, a.vrr], [
    "Sharp Corporation 0x14F9",
    2256,
    1504,
    59.999001,
    1.5,
    undefined,
    false,
  ]);
  assertEquals(a.modes, ["2256×1504 @ 60 Hz", "1920×1200 @ 59.95 Hz"]);
  assertEquals([b.enabled, b.x, b.transform, b.serial], [false, 2256, "90", "0x0000BEEF"]);
});

Deno.test("xrandr", () => {
  const out = `Screen 0: minimum 320 x 200, current 4480 x 1440, maximum 16384 x 16384
eDP-1 connected primary 1920x1080+0+0 (normal left inverted right x axis y axis) 344mm x 193mm
   1920x1080     60.02*+  59.97    48.00
   1680x1050     59.95
HDMI-1 connected 1440x2560+1920+0 left (normal left inverted right x axis y axis) 597mm x 336mm
   2560x1440     59.95 +  143.97*
DP-1 disconnected (normal left inverted right x axis y axis)
DP-2 connected (normal left inverted right x axis y axis)
   1920x1080     60.00 +
`;
  const list = parseXrandr(out);
  assertEquals(list.map((m) => [m.name, m.width, m.height, m.refresh, m.primary, m.enabled, m.transform]), [
    ["eDP-1", 1920, 1080, 60.02, true, true, "normal"],
    ["HDMI-1", 1440, 2560, 143.97, false, true, "left"],
    ["DP-2", 0, 0, 0, false, false, "normal"],
  ]);
  assertEquals(list[0].modes, [
    "1920×1080 @ 60.02 Hz",
    "1920×1080 @ 59.97 Hz",
    "1920×1080 @ 48 Hz",
    "1680×1050 @ 59.95 Hz",
  ]);
});

Deno.test("kscreen-doctor", () => {
  const json = JSON.stringify({
    outputs: [
      {
        connected: true,
        enabled: true,
        currentModeId: "2",
        id: 1,
        modes: [
          { id: "1", name: "2560x1440@60", refreshRate: 59.951, size: { width: 2560, height: 1440 } },
          { id: "2", name: "2560x1440@144", refreshRate: 143.912, size: { width: 2560, height: 1440 } },
        ],
        name: "DP-2",
        pos: { x: 0, y: 0 },
        priority: 1,
        rotation: 1,
        scale: 1.25,
        vrrPolicy: 2,
      },
      { connected: false, name: "HDMI-A-1", modes: [] },
    ],
  });
  const list = parseKscreen(json);
  assertEquals(list.length, 1);
  assertEquals([list[0].refresh, list[0].scale, list[0].primary, list[0].vrr], [143.912, 1.25, true, true]);
  assertEquals(refreshText(list[0]), "143.91 Hz");
});

Deno.test("GNOME Mutter state", () => {
  const out =
    `(uint32 2, [(('eDP-1', 'BOE', '0x095f', '0x00000000'), [('2256x1504@59.999', 2256, 1504, 59.999275207519531, 1.5666666030883789, [1.0, 1.25, 1.5666666030883789, 2.0], {'is-current': <true>, 'is-preferred': <true>}), ('1920x1200@59.950', 1920, 1200, 59.950172424316406, 1.25, [1.0, 1.25, 1.5], @a{sv} {})], {'is-builtin': <true>, 'display-name': <'Built-in display'>, 'is-underscanning': <false>}), (('DP-3', 'DEL', 'DELL U2720Q', 'ABCD123'), [('3840x2160@59.997', 3840, 2160, 59.996623992919922, 2.0, [1.0, 2.0], {'is-current': <true>, 'is-preferred': <true>})], {'is-builtin': <false>, 'display-name': <'Dell Inc. 27"'>})], [(0, 0, 1.5, uint32 0, true, [('eDP-1', 'BOE', '0x095f', '0x00000000')], @a{sv} {}), (1504, 0, 2.0, 1, false, [('DP-3', 'DEL', 'DELL U2720Q', 'ABCD123')], @a{sv} {})], {'layout-mode': <uint32 1>, 'supports-changing-layout-mode': <true>})`;
  const [a, b] = parseMutter(out);
  assertEquals([a.name, a.description, a.width, a.height, a.scale, a.primary, a.builtin, a.serial], [
    "eDP-1",
    "Built-in display",
    2256,
    1504,
    1.5,
    true,
    true,
    undefined,
  ]);
  assertEquals(a.modes, ["2256×1504 @ 60 Hz", "1920×1200 @ 59.95 Hz"]);
  assertEquals([b.name, b.description, b.x, b.scale, b.transform, b.serial, b.builtin], [
    "DP-3",
    'Dell Inc. 27"',
    1504,
    2,
    "90",
    "ABCD123",
    false,
  ]);
});

Deno.test("aspect ratios", () => {
  assertEquals([aspect(1920, 1080), aspect(2256, 1504), aspect(2560, 1600), aspect(3440, 1440), aspect(1080, 1920)], [
    "16:9",
    "3:2",
    "16:10",
    "21:9",
    "9:16",
  ]);
  assertEquals(aspect(0, 0), "");
});
