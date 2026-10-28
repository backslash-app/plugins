import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  broadcastOf,
  dedupeNeighbors,
  formatMac,
  isBroadcastMac,
  isIPv4,
  machineFromForm,
  magicPacket,
  normalizeMac,
  parseBroadcasts,
  parseIpNeigh,
  parseMac,
  parseProcArp,
  parseSecureOn,
  programArgs,
  PROGRAMS,
} from "./lib.ts";
import { HOSTS } from "./net.ts";

Deno.test("MAC addresses in every usual spelling", () => {
  for (const t of ["3c:7c:3f:1a:2b:4c", "3C-7C-3F-1A-2B-4C", "3c7c.3f1a.2b4c", "3C7C3F1A2B4C", " 3c:7c:3f:1a:2b:4c "]) {
    assertEquals(normalizeMac(t), "3c:7c:3f:1a:2b:4c");
  }
  assertEquals(normalizeMac("0:1b:2:3:4:5"), "00:1b:02:03:04:05");
  assertThrows(() => parseMac("3c:7c:3f:1a:2b"), Error, "not a MAC address");
  assertThrows(() => parseMac("3c:7c-3f:1a:2b:4c"));
  assertThrows(() => parseMac("zz:7c:3f:1a:2b:4c"));
  assert(isBroadcastMac(parseMac("ff:ff:ff:ff:ff:ff")));
  assert(isBroadcastMac(parseMac("01:00:5e:00:00:fb")));
  assert(!isBroadcastMac(parseMac("3c:7c:3f:1a:2b:4c")));
});

Deno.test("magic packet: 6 × FF then the MAC 16 times", () => {
  const p = magicPacket("3c:7c:3f:1a:2b:4c");
  assertEquals(p.length, 102);
  assertEquals([...p.slice(0, 6)], [255, 255, 255, 255, 255, 255]);
  for (let i = 0; i < 16; i++) assertEquals(formatMac(p.slice(6 + i * 6, 12 + i * 6)), "3c:7c:3f:1a:2b:4c");
  const withPassword = magicPacket("3c:7c:3f:1a:2b:4c", "00:11:22:33:44:55");
  assertEquals(withPassword.length, 108);
  assertEquals([...withPassword.slice(102)], [0, 0x11, 0x22, 0x33, 0x44, 0x55]);
  assertEquals([...parseSecureOn("192.168.1.2")], [192, 168, 1, 2]);
  assertThrows(() => parseSecureOn("nope"));
});

Deno.test("broadcast addresses", () => {
  assertEquals(broadcastOf("192.168.1.20", 24), "192.168.1.255");
  assertEquals(broadcastOf("10.1.2.3", 8), "10.255.255.255");
  assertEquals(broadcastOf("172.16.5.4", 20), "172.16.15.255");
  assert(isIPv4("255.255.255.255"));
  assert(!isIPv4("256.1.1.1"));
  assert(!isIPv4("nas.local"));
});

Deno.test("ip -j neigh", () => {
  const json = JSON.stringify([
    { dst: "192.168.1.1", dev: "wlp2s0", lladdr: "a0:63:91:aa:bb:cc", state: ["REACHABLE"] },
    { dst: "192.168.1.20", dev: "wlp2s0", lladdr: "3C:7C:3F:1A:2B:4C", state: ["STALE"] },
    { dst: "192.168.1.30", dev: "wlp2s0", state: ["FAILED"] },
    { dst: "192.168.1.31", dev: "wlp2s0", lladdr: "00:00:00:00:00:00", state: ["INCOMPLETE"] },
    { dst: "fe80::3e7c:3fff:fe1a:2b4c", dev: "wlp2s0", lladdr: "3c:7c:3f:1a:2b:4c", router: null, state: ["STALE"] },
    { dst: "224.0.0.251", dev: "wlp2s0", lladdr: "01:00:5e:00:00:fb", state: ["NOARP"] },
  ]);
  const table = dedupeNeighbors(parseIpNeigh(json));
  assertEquals(table.map((n) => [n.ip, n.mac, n.state]), [
    ["192.168.1.1", "a0:63:91:aa:bb:cc", "reachable"],
    ["192.168.1.20", "3c:7c:3f:1a:2b:4c", "stale"],
  ]);
});

Deno.test("/proc/net/arp", () => {
  const text = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         a0:63:91:aa:bb:cc     *        wlp2s0
192.168.1.44     0x1         0x0         00:00:00:00:00:00     *        wlp2s0
192.168.1.20     0x1         0x2         3c:7c:3f:1a:2b:4c     *        wlp2s0
`;
  assertEquals(parseProcArp(text).map((n) => n.ip), ["192.168.1.1", "192.168.1.20"]);
});

Deno.test("ip -j addr broadcasts", () => {
  const json = JSON.stringify([
    { ifname: "lo", addr_info: [{ family: "inet", local: "127.0.0.1", prefixlen: 8 }] },
    {
      ifname: "wlp2s0",
      addr_info: [{ family: "inet", local: "192.168.1.12", prefixlen: 24, broadcast: "192.168.1.255" }],
    },
    { ifname: "tailscale0", addr_info: [{ family: "inet", local: "100.101.2.3", prefixlen: 32 }] },
    { ifname: "enp3s0", addr_info: [{ family: "inet", local: "10.0.3.7", prefixlen: 16 }] },
  ]);
  assertEquals(parseBroadcasts(json), {
    wlp2s0: "192.168.1.255",
    tailscale0: "100.101.2.3",
    enp3s0: "10.0.255.255",
  });
});

Deno.test("machine form", () => {
  const m = machineFromForm({ name: " Desktop ", mac: "3C-7C-3F-1A-2B-4C", broadcast: "", port: "", host: "" }, "x");
  assertEquals(m, {
    id: "x",
    name: "Desktop",
    mac: "3c:7c:3f:1a:2b:4c",
    broadcast: "255.255.255.255",
    port: 9,
    host: undefined,
    secureOn: undefined,
    lastWoken: undefined,
  });
  assertThrows(() => machineFromForm({ name: "", mac: "3c:7c:3f:1a:2b:4c" }, "x"), Error, "name");
  assertThrows(() => machineFromForm({ name: "A", mac: "ff:ff:ff:ff:ff:ff" }, "x"), Error, "broadcast");
  assertThrows(() => machineFromForm({ name: "A", mac: "3c:7c:3f:1a:2b:4c", port: "70000" }, "x"), Error, "port");
  assertThrows(() => machineFromForm({ name: "A", mac: "3c:7c:3f:1a:2b:4c", broadcast: "lan" }, "x"));
  assertThrows(() => machineFromForm({ name: "A", mac: "3c:7c:3f:1a:2b:4c", host: "a b" }, "x"));
});

Deno.test("fallback programs", () => {
  const m = machineFromForm({ name: "NAS", mac: "3c:7c:3f:1a:2b:4c", broadcast: "192.168.1.255", port: "7" }, "x");
  assertEquals(programArgs("wakeonlan", m), ["-i", "192.168.1.255", "-p", "7", "3c:7c:3f:1a:2b:4c"]);
  assertEquals(programArgs("wol", m), ["-i", "192.168.1.255", "-p", "7", "3c:7c:3f:1a:2b:4c"]);
  assertEquals(programArgs("etherwake", m), ["-b", "3c:7c:3f:1a:2b:4c"]);
});

Deno.test("hosts and programs match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[]; run: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  for (const p of PROGRAMS) assert(manifest.permissions.run.includes(p));
});
