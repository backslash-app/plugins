import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  appName,
  batteryColor,
  connectOutcome,
  deviceInfo,
  deviceName,
  formatSize,
  installCommand,
  installOutcome,
  isNetworkSerial,
  isPng,
  launchArgs,
  logcatScript,
  normalizeAddress,
  normalizePairingCode,
  osFamily,
  parseBattery,
  parseDevices,
  parseGetprop,
  parsePackages,
  parseWifiIp,
  scrcpyRunArgs,
  scrcpyUnit,
  screenshotName,
  stateHelp,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

const DEVICES = `* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
1A2B3C4D5E6F           device usb:1-4 product:panther model:Pixel_7 device:panther transport_id:3
192.168.1.20:5555      device product:beyond1ltexx model:SM_G973F device:beyond1 transport_id:4
adb-R58M12ABCDE-x1y2Z3._adb-tls-connect._tcp device product:a52qnsxx model:SM_A525F device:a52q transport_id:7
emulator-5554          device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emu64xa transport_id:1
0123456789ABCDEF       unauthorized usb:1-2 transport_id:5
ZY22ABCD               no permissions (missing udev rules? user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:3-1 transport_id:6
192.168.1.33:5555      offline transport_id:8

`;

Deno.test("adb devices -l: states, models, transports, daemon messages", () => {
  const d = parseDevices(DEVICES);
  assertEquals(d.map((x) => [x.serial, x.state, x.transport]), [
    ["1A2B3C4D5E6F", "device", "usb"],
    ["192.168.1.20:5555", "device", "wifi"],
    ["adb-R58M12ABCDE-x1y2Z3._adb-tls-connect._tcp", "device", "wifi"],
    ["emulator-5554", "device", "emulator"],
    ["0123456789ABCDEF", "unauthorized", "usb"],
    ["ZY22ABCD", "no permissions", "usb"],
    ["192.168.1.33:5555", "offline", "wifi"],
  ]);
  assertEquals(d[0].model, "Pixel_7");
  assertEquals(d[0].usb, "1-4");
  assertEquals(d[0].transportId, "3");
  assertEquals(d[5].problem, "missing udev rules? user is in the plugdev group");
  assertEquals(d[5].usb, "3-1");
  assertEquals(parseDevices("List of devices attached\n\n"), []);
});

Deno.test("network serials", () => {
  assert(isNetworkSerial("10.0.0.5:40123"));
  assert(isNetworkSerial("[fe80::1]:5555"));
  assert(!isNetworkSerial("R58M12ABCDE"));
});

const GETPROP = `[ro.build.display.id]: [UP1A.231005.007]
[ro.build.version.release]: [14]
[ro.build.version.release_or_codename]: [14]
[ro.build.version.sdk]: [34]
[ro.build.version.security_patch]: [2023-10-05]
[ro.product.cpu.abi]: [arm64-v8a]
[ro.product.manufacturer]: [Google]
[ro.product.model]: [Pixel 7]
[persist.sys.device_name]: [Ada's Pixel]
[empty.prop]: []
`;

Deno.test("getprop: device info", () => {
  const props = parseGetprop(GETPROP);
  assertEquals(props["empty.prop"], "");
  assertEquals(deviceInfo(props), {
    manufacturer: "Google",
    model: "Pixel 7",
    android: "14",
    sdk: 34,
    abi: "arm64-v8a",
    securityPatch: "2023-10-05",
    build: "UP1A.231005.007",
    name: "Ada's Pixel",
  });
  assertEquals(deviceInfo({ "ro.build.version.sdk": "30" }).android, "11");
});

Deno.test("device names", () => {
  const [pixel, samsung] = parseDevices(DEVICES);
  assertEquals(deviceName(pixel, deviceInfo(parseGetprop(GETPROP))), "Pixel 7");
  assertEquals(deviceName(samsung), "SM G973F");
  assertEquals(deviceName(samsung, { manufacturer: "samsung", model: "SM-G973F" }), "Samsung SM-G973F");
  assertEquals(deviceName({ serial: "X", state: "unauthorized", transport: "usb" }), "X");
});

const BATTERY = `Current Battery Service state:
  AC powered: false
  USB powered: true
  Wireless powered: false
  Max charging current: 500000
  status: 2
  health: 2
  present: true
  level: 57
  scale: 100
  voltage: 3912
  temperature: 287
  technology: Li-ion
`;

Deno.test("dumpsys battery", () => {
  const b = parseBattery(BATTERY)!;
  assertEquals(b, { level: 57, status: "charging", source: "USB", temperature: 28.7, health: "Good" });
  assertEquals(batteryColor(b), "green");
  const low = parseBattery("  status: 3\n  level: 9\n  scale: 100\n")!;
  assertEquals([low.status, low.source, batteryColor(low)], ["discharging", undefined, "red"]);
  assertEquals(parseBattery("Can't find service: battery"), undefined);
});

Deno.test("Wi-Fi address", () => {
  const out = `30: wlan0: <BROADCAST,MULTICAST,UP,LOWER_UP> mtu 1500 qdisc mq state UP group default qlen 3000
    inet 192.168.1.23/24 brd 192.168.1.255 scope global wlan0
       valid_lft forever preferred_lft forever`;
  assertEquals(parseWifiIp(out), "192.168.1.23");
  assertEquals(parseWifiIp('Device "wlan0" does not exist.'), undefined);
});

Deno.test("packages and app names", () => {
  assertEquals(parsePackages("package:org.mozilla.firefox\npackage:com.spotify.music\r\n\nWARNING: x\n"), [
    "com.spotify.music",
    "org.mozilla.firefox",
  ]);
  assertEquals(appName("com.spotify.music"), "Spotify Music");
  assertEquals(appName("org.mozilla.firefox"), "Firefox");
  assertEquals(appName("com.whatsapp"), "Whatsapp");
  assertEquals(appName("de.danoeh.antennapod"), "Danoeh Antennapod");
  assertEquals(appName("com.google.android.apps.maps"), "Maps");
  assertEquals(appName("org.telegram.messenger"), "Telegram Messenger");
});

Deno.test("command lines", () => {
  assertEquals(launchArgs("S1", "com.x"), [
    "-s",
    "S1",
    "shell",
    "monkey",
    "-p",
    "com.x",
    "-c",
    "android.intent.category.LAUNCHER",
    "1",
  ]);
  assertEquals(scrcpyUnit("192.168.1.20:5555"), "backslash-scrcpy-192-168-1-20-5555");
  assertEquals(scrcpyRunArgs("S1", "Pixel 7", ["--turn-screen-off"]), [
    "--user",
    "--quiet",
    "--collect",
    "--unit=backslash-scrcpy-s1",
    "--description=Backslash: mirroring Pixel 7",
    "scrcpy",
    "--serial=S1",
    "--window-title=Pixel 7",
    "--turn-screen-off",
  ]);
  const script = logcatScript("192.168.1.20:5555", "com.spotify.music");
  assert(script.includes("adb -s 192.168.1.20:5555 shell pidof -s com.spotify.music"));
  assert(script.includes(`exec adb -s 192.168.1.20:5555 logcat -v color --pid="$pid"`));
  assert(script.includes("monkey -p com.spotify.music"));
});

Deno.test("screenshots", () => {
  assertEquals(
    screenshotName("Pixel 7 (Ada)", new Date(2026, 9, 28, 14, 30, 5)),
    "Screenshot_Pixel-7-Ada_20261028-143005.png",
  );
  assert(isPng(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])));
  assert(!isPng(new TextEncoder().encode("error: device offline")));
});

Deno.test("addresses and pairing codes", () => {
  assertEquals(normalizeAddress(" 192.168.1.20 "), "192.168.1.20:5555");
  assertEquals(normalizeAddress("192.168.1.20:41235"), "192.168.1.20:41235");
  assertEquals(normalizeAddress("pixel.lan"), "pixel.lan:5555");
  assertThrows(() => normalizeAddress("192.168.1.20", null), Error, "Add the port");
  assertThrows(() => normalizeAddress("http://x"), Error, "not an address");
  assertThrows(() => normalizeAddress("1.2.3.4:70000"), Error, "not a port");
  assertEquals(normalizePairingCode("123 456"), "123456");
  assertThrows(() => normalizePairingCode("12345"), Error, "six digits");
});

Deno.test("adb connect, pair and install answers", () => {
  assertEquals(connectOutcome("connected to 192.168.1.20:5555").ok, true);
  assertEquals(connectOutcome("already connected to 192.168.1.20:5555").ok, true);
  assertEquals(connectOutcome("Successfully paired to 192.168.1.20:37099 [guid=adb-X]").ok, true);
  const refused = connectOutcome("failed to connect to '192.168.1.20:5555': Connection refused");
  assertEquals(refused.ok, false);
  assert(refused.message.includes("Wireless debugging"));
  assertEquals(connectOutcome("Failed: Wrong password or connection was dropped.").ok, false);
  assertEquals(installOutcome("Performing Streamed Install\nSuccess\n"), { ok: true, message: "Installed" });
  assertEquals(
    installOutcome(
      "adb: failed to install app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package x signatures do not match]",
    ),
    { ok: false, message: "An app with the same name but another signature is installed: uninstall it first" },
  );
  assertEquals(installOutcome("Failure [INSTALL_FAILED_SOMETHING_NEW]").message, "INSTALL_FAILED_SOMETHING_NEW");
});

Deno.test("help for unusable devices", () => {
  const d = parseDevices(DEVICES);
  assert(stateHelp(d[4])!.includes("Allow USB debugging"));
  assert(stateHelp(d[5])!.includes("udev"));
  assertEquals(stateHelp(d[0]), undefined);
});

Deno.test("install hints by distribution", () => {
  assertEquals(osFamily('ID=ubuntu\nID_LIKE="debian"'), "debian");
  assertEquals(osFamily("ID=fedora"), "fedora");
  assertEquals(osFamily("ID=endeavouros\nID_LIKE=arch"), "arch");
  assertEquals(installCommand("adb", "debian"), "sudo apt install adb");
  assertEquals(installCommand("adb", "arch"), "sudo pacman -S android-tools");
  assertEquals(installCommand("scrcpy", "fedora"), "sudo dnf install scrcpy");
  assertEquals(formatSize(52_428_800), "50.0 MB");
  assertEquals(formatSize(2048), "2 KB");
});

Deno.test("every program run is allowed by the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
  };
  const allowed = new Set(manifest.permissions.run);
  for (const p of ["adb", "scrcpy", "systemd-run", "systemctl", ...TERMINALS]) {
    assert(allowed.has(p), `${p} is not in run`);
  }
});
