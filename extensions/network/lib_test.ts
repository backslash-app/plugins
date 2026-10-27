import { assertEquals } from "@std/assert";
import {
  nmcliFields,
  parseAudio,
  parseConnections,
  parseDevices,
  parseInfo,
  parseTailscale,
  parseWifi,
} from "./lib.ts";

Deno.test("nmcli escaping", () => {
  assertEquals(nmcliFields(String.raw`*:Café\: 2.4G:80:WPA2`), ["*", "Café: 2.4G", "80", "WPA2"]);
});

Deno.test("wifi networks", () => {
  const out = [":Home:54:WPA2", "*:Home:70:WPA2", ":Home:90:WPA2", ":FreeWifi:40:--", "::30:WPA2"].join("\n");
  assertEquals(parseWifi(out), [
    { ssid: "Home", signal: 70, security: "WPA2", active: true },
    { ssid: "FreeWifi", signal: 40, security: "", active: false },
  ]);
});

Deno.test("connections", () => {
  assertEquals(parseConnections("Home:802-11-wireless:wlan0\nWork VPN:vpn:\nwg0:wireguard:wg0"), [
    { name: "Home", type: "802-11-wireless", device: "wlan0" },
    { name: "Work VPN", type: "vpn", device: "" },
    { name: "wg0", type: "wireguard", device: "wg0" },
  ]);
});

Deno.test("bluetooth", () => {
  assertEquals(parseDevices("Device 00:1B:66:AA:BB:CC WH-1000XM4\nController 11:22:33:44:55:66 laptop"), [
    { mac: "00:1B:66:AA:BB:CC", name: "WH-1000XM4" },
  ]);
  const info = `Device 00:1B:66:AA:BB:CC (public)
\tName: WH-1000XM4
\tAlias: My headphones
\tIcon: audio-headset
\tPaired: yes
\tConnected: yes
\tBattery Percentage: 0x50 (80)`;
  assertEquals(parseInfo("00:1B:66:AA:BB:CC", info), {
    mac: "00:1B:66:AA:BB:CC",
    name: "My headphones",
    icon: "audio-headset",
    paired: true,
    connected: true,
    battery: 80,
  });
});

Deno.test("audio devices", () => {
  const sources = JSON.stringify([
    { name: "alsa_output.pci.monitor", description: "Monitor of Speakers", monitor_of_sink: "alsa_output.pci" },
    { name: "alsa_input.usb", description: "USB Microphone", mute: false },
  ]);
  assertEquals(parseAudio(sources, "input", "alsa_input.usb"), [
    { name: "alsa_input.usb", description: "USB Microphone", kind: "input", isDefault: true, muted: false },
  ]);
});

Deno.test("tailscale", () => {
  const s = parseTailscale(
    JSON.stringify({ BackendState: "Running", Self: { HostName: "laptop", TailscaleIPs: ["100.64.0.1"] } }),
  );
  assertEquals([s.running, s.host, s.ip], [true, "laptop", "100.64.0.1"]);
});
