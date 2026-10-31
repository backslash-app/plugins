import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  compareIp,
  displayName,
  hostsOf,
  inSubnet,
  isRandomMac,
  kindOf,
  mergeDevices,
  modelOf,
  normalizeMac,
  parseAddrs,
  parseAvahi,
  parseGateways,
  parseGetent,
  parseIpNeigh,
  parseNmap,
  parseOuiDb,
  parsePing,
  parseProcArp,
  parseTxt,
  serviceTags,
  shortVendor,
  sweepTarget,
  unescapeAvahi,
  vendorOf,
  webUrl,
} from "./lib.ts";
import { OUI } from "./oui.ts";
import { OUI_FILES } from "./system.ts";
import { TERMINALS } from "./terminal.ts";

// ip -j neigh (iproute2 6.x)
const NEIGH = JSON.stringify([
  { dst: "192.168.1.1", dev: "wlp2s0", lladdr: "3c:a6:2f:11:22:33", state: ["REACHABLE"] },
  { dst: "192.168.1.20", dev: "wlp2s0", lladdr: "b8:27:eb:aa:bb:cc", state: ["STALE"] },
  { dst: "192.168.1.30", dev: "wlp2s0", lladdr: "f4:f5:d8:01:02:03", state: ["DELAY"] },
  { dst: "192.168.1.42", dev: "wlp2s0", lladdr: "a6:12:34:56:78:9a", state: ["REACHABLE"] },
  { dst: "192.168.1.99", dev: "wlp2s0", state: ["FAILED"] },
  { dst: "192.168.1.77", dev: "wlp2s0", lladdr: "00:11:32:de:ad:00", state: ["INCOMPLETE"] },
  { dst: "fe80::3ea6:2fff:fe11:2233", dev: "wlp2s0", lladdr: "3c:a6:2f:11:22:33", router: null, state: ["STALE"] },
  { dst: "2a01:e0a:1:2::20", dev: "wlp2s0", lladdr: "b8:27:eb:aa:bb:cc", state: ["STALE"] },
  { dst: "224.0.0.251", dev: "wlp2s0", lladdr: "01:00:5e:00:00:fb", state: ["NOARP"] },
]);

// avahi-browse -aprt (resolved lines, and the + / - ones it also prints)
const AVAHI = String.raw`+;wlp2s0;IPv4;Living\032Room;_googlecast._tcp;local
=;wlp2s0;IPv4;Living\032Room;_googlecast._tcp;local;Chromecast-a1b2.local;192.168.1.30;8009;"rs=" "nf=1" "fn=Living Room" "md=Chromecast Ultra" "id=a1b2"
=;wlp2s0;IPv4;raspberrypi\032\091b8\05827\058eb\058aa\058bb\058cc\093;_workstation._tcp;local;raspberrypi.local;192.168.1.20;9;
=;wlp2s0;IPv4;raspberrypi;_ssh._tcp;local;raspberrypi.local;192.168.1.20;22;
=;wlp2s0;IPv6;raspberrypi;_ssh._tcp;local;raspberrypi.local;2a01:e0a:1:2::20;22;
=;wlp2s0;IPv4;Pi-hole\032admin;_http._tcp;local;raspberrypi.local;192.168.1.20;8080;"path=/admin"
=;wlp2s0;IPv4;Brother\032HL-L2350DW;_ipp._tcp;local;BRW1234.local;192.168.1.50;631;"txtvers=1" "ty=Brother HL-L2350DW series" "rp=ipp/print" "note=Office; 2nd floor"
=;docker0;IPv4;container;_http._tcp;local;abc.local;172.17.0.2;80;
=;wlp2s0;IPv4;Living\032Room;_googlecast._tcp;local;Chromecast-a1b2.local;192.168.1.30;8009;"fn=Living Room"
`;

const ADDRS = JSON.stringify([
  {
    ifindex: 1,
    ifname: "lo",
    flags: ["LOOPBACK", "UP"],
    addr_info: [{ family: "inet", local: "127.0.0.1", prefixlen: 8 }],
  },
  {
    ifindex: 3,
    ifname: "wlp2s0",
    flags: ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"],
    addr_info: [{ family: "inet", local: "192.168.1.10", prefixlen: 24 }],
  },
  { ifindex: 4, ifname: "docker0", flags: ["UP"], addr_info: [{ family: "inet", local: "172.17.0.1", prefixlen: 16 }] },
  {
    ifindex: 5,
    ifname: "enp0s31f6",
    flags: ["NO-CARRIER", "BROADCAST"],
    addr_info: [{ family: "inet", local: "10.0.0.5", prefixlen: 8 }],
  },
]);

Deno.test("MAC addresses", () => {
  assertEquals(normalizeMac("3C-A6-2F-11-22-33"), "3c:a6:2f:11:22:33");
  assertEquals(normalizeMac("3ca6.2f11.2233"), "3c:a6:2f:11:22:33");
  assertEquals(normalizeMac("nope"), undefined);
  assert(isRandomMac("a6:12:34:56:78:9a"));
  assert(!isRandomMac("b8:27:eb:aa:bb:cc"));
});

Deno.test("the neighbor table", () => {
  const n = parseIpNeigh(NEIGH);
  assertEquals(n.map((x) => x.ip), [
    "192.168.1.1",
    "192.168.1.20",
    "192.168.1.30",
    "192.168.1.42",
    "fe80::3ea6:2fff:fe11:2233",
    "2a01:e0a:1:2::20",
  ]);
  assertEquals(n[0], { ip: "192.168.1.1", mac: "3c:a6:2f:11:22:33", dev: "wlp2s0", state: "reachable", router: false });
  assertEquals(n[4].router, true);
  assertEquals(parseIpNeigh("not json"), []);
  const arp = parseProcArp(`IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         3c:a6:2f:11:22:33     *        wlp2s0
192.168.1.99     0x1         0x0         00:00:00:00:00:00     *        wlp2s0
`);
  assertEquals(arp.map((x) => x.ip), ["192.168.1.1"]);
});

Deno.test("Avahi services: escapes, TXT records, duplicates", () => {
  const s = parseAvahi(AVAHI);
  assertEquals(s.length, 7);
  assertEquals(s[0].name, "Living Room");
  assertEquals(s[0].txt.md, "Chromecast Ultra");
  assertEquals(s[1].name, "raspberrypi [b8:27:eb:aa:bb:cc]");
  assertEquals(s[4].txt.path, "/admin");
  assertEquals(s[5].txt.note, "Office; 2nd floor");
  assertEquals(s[5].port, 631);
  assertEquals(unescapeAvahi(String.raw`My\032NAS\.local`), "My NAS.local");
  assertEquals(parseTxt(String.raw`"a=1" "flag" "quote=say \"hi\""`), { a: "1", flag: "", quote: 'say "hi"' });
  assertEquals(modelOf(s.filter((x) => x.type === "_ipp._tcp")), "Brother HL-L2350DW series");
  assertEquals(parseAvahi("Failed to create client object: Daemon not running"), []);
});

Deno.test("our networks, the router, sweeps", () => {
  const subs = parseAddrs(ADDRS);
  assertEquals(subs, [{ dev: "wlp2s0", ip: "192.168.1.10", prefix: 24 }]);
  assertEquals(
    parseGateways(JSON.stringify([{ dst: "default", gateway: "192.168.1.1", dev: "wlp2s0", protocol: "dhcp" }])),
    ["192.168.1.1"],
  );
  assertEquals(sweepTarget({ dev: "x", ip: "10.20.30.40", prefix: 8 }), "10.20.30.0/24");
  assertEquals(sweepTarget({ dev: "x", ip: "192.168.1.130", prefix: 25 }), "192.168.1.128/25");
  assertEquals(hostsOf("192.168.1.0/24").length, 254);
  assertEquals(hostsOf("192.168.1.0/24")[0], "192.168.1.1");
  assertEquals(hostsOf("192.168.1.128/30"), ["192.168.1.129", "192.168.1.130"]);
  assertEquals(hostsOf("10.0.0.0/8"), []);
  assert(inSubnet("192.168.1.200", "192.168.1.10", 24));
  assert(!inSubnet("192.168.2.1", "192.168.1.10", 24));
  assertEquals(["192.168.1.10", "192.168.1.9", "fe80::1", "10.0.0.1"].sort(compareIp), [
    "10.0.0.1",
    "192.168.1.9",
    "192.168.1.10",
    "fe80::1",
  ]);
});

Deno.test("nmap, getent and ping output", () => {
  assertEquals(
    parseNmap(`# Nmap 7.94 scan initiated Sat Oct 31 12:00:00 2026 as: nmap -sn -n -oG - 192.168.1.0/24
Host: 192.168.1.1 ()	Status: Up
Host: 192.168.1.20 (raspberrypi.lan)	Status: Up
Host: 192.168.1.30 ()	Status: Down
# Nmap done at Sat Oct 31 12:00:03 2026 -- 256 IP addresses (2 hosts up) scanned in 2.95 seconds`),
    [{ ip: "192.168.1.1", host: undefined }, { ip: "192.168.1.20", host: "raspberrypi.lan" }],
  );
  assertEquals(
    parseGetent("192.168.1.20    raspberrypi.local\n192.168.1.1     fritz.box router\n").get("192.168.1.1"),
    "fritz.box",
  );
  assertEquals(
    parsePing(`PING 192.168.1.1 (192.168.1.1) 56(84) bytes of data.
64 bytes from 192.168.1.1: icmp_seq=1 ttl=64 time=2.31 ms

--- 192.168.1.1 ping statistics ---
4 packets transmitted, 4 received, 0% packet loss, time 3004ms
rtt min/avg/max/mdev = 1.912/2.403/3.101/0.441 ms`),
    { sent: 4, received: 4, loss: 0, min: 1.912, avg: 2.403, max: 3.101 },
  );
  assertEquals(
    parsePing("4 packets transmitted, 0 received, +4 errors, 100% packet loss, time 3060ms"),
    { sent: 4, received: 0, loss: 100 },
  );
  assertEquals(
    parsePing("4 packets transmitted, 4 packets received, 0% packet loss\nround-trip min/avg/max = 0.5/0.7/1.0 ms"),
    { sent: 4, received: 4, loss: 0, min: 0.5, avg: 0.7, max: 1 },
  );
  assertEquals(parsePing("garbage"), undefined);
});

Deno.test("vendors: bundled table, system IEEE lists, private addresses", () => {
  assertEquals(vendorOf("b8:27:eb:aa:bb:cc"), "Raspberry Pi");
  assertEquals(vendorOf("a6:12:34:56:78:9a"), undefined);
  const wanted = new Set(["001A2B", "B827EB", "ABCDEF"]);
  const hwdata = parseOuiDb(
    `OUI/MA-L                                                    Organization
00-1A-2B   (hex)		Ayecom Technology Co., Ltd.
001A2B     (base 16)		Ayecom Technology Co., Ltd.
				Taipei  TW
B8-27-EB   (hex)		Raspberry Pi Foundation
`,
    wanted,
  );
  assertEquals(hwdata, new Map([["001A2B", "Ayecom Technology Co., Ltd."], ["B827EB", "Raspberry Pi Foundation"]]));
  assertEquals(
    parseOuiDb("001A2B Ayecom Technology\nB827EB Raspberry Pi Foundation\n", wanted).get("001A2B"),
    "Ayecom Technology",
  );
  assertEquals(
    parseOuiDb("00:1A:2B\tAyecom\tAyecom Technology Co., Ltd.\nAB:CD:EF\tShortOnly\n", wanted).get("ABCDEF"),
    "ShortOnly",
  );
  assertEquals(vendorOf("00:1a:2b:00:00:01", hwdata), "Ayecom Technology");
  assertEquals(shortVendor("TP-LINK TECHNOLOGIES CO.,LTD."), "TP-Link Technologies");
  assertEquals(shortVendor("Raspberry Pi Trading Ltd"), "Raspberry Pi Trading");
  assertEquals(shortVendor("Cisco Systems, Inc"), "Cisco Systems");
  assertEquals(shortVendor("Siemens AG"), "Siemens");
  // Every bundled prefix is six hex digits.
  for (const p of OUI.keys()) assert(/^[0-9A-F]{6}$/.test(p), p);
  assert(OUI.size > 300);
});

Deno.test("merging every source into devices", () => {
  const devices = mergeDevices({
    neighbors: parseIpNeigh(NEIGH),
    services: parseAvahi(AVAHI),
    names: new Map([["192.168.1.1", "fritz.box"], ["192.168.1.20", "ignored.lan"]]),
    swept: [{ ip: "192.168.1.10" }, { ip: "192.168.1.60", host: "tv.lan" }],
    gateways: ["192.168.1.1"],
    own: parseAddrs(ADDRS),
  });
  assertEquals(devices.map((d) => d.ip), [
    "192.168.1.1",
    "192.168.1.10",
    "192.168.1.20",
    "192.168.1.30",
    "192.168.1.42",
    "192.168.1.50",
    "192.168.1.60",
  ]);
  const [router, self, pi, cast, phone, printer, tv] = devices;
  assert(router.gateway);
  assertEquals(router.vendor, "AVM (FRITZ!Box)");
  assertEquals(router.ipv6, []); // link-local only
  assertEquals(displayName(router), "fritz.box");
  assertEquals(kindOf(router), "router");
  assert(self.self);
  assertEquals(kindOf(self), "this");
  assertEquals(pi.hostname, "raspberrypi.local");
  assertEquals(pi.ipv6, ["2a01:e0a:1:2::20"]);
  assertEquals(pi.vendor, "Raspberry Pi");
  assertEquals(serviceTags(pi), ["SSH", "Web"]);
  assertEquals(displayName(pi), "raspberrypi");
  assertEquals(webUrl(pi), "http://192.168.1.20:8080/admin");
  assertEquals(kindOf(pi), "computer");
  assertEquals(cast.model, "Chromecast Ultra");
  assertEquals(displayName(cast), "Living Room");
  assertEquals(kindOf(cast), "tv");
  assertEquals(cast.vendor, "Google");
  assert(phone.randomMac);
  assertEquals(phone.vendor, undefined);
  assertEquals(displayName(phone), "192.168.1.42");
  assertEquals(kindOf(printer), "printer");
  assertEquals(webUrl(printer), "http://192.168.1.50/");
  assert(tv.swept);
  assertEquals(tv.hostname, "tv.lan");
  assertEquals(displayName(tv), "tv");
});

Deno.test("manifest: OUI files and terminals", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[]; read: string[] };
  };
  for (const f of OUI_FILES) assert(manifest.permissions.read.includes(f), f);
  for (const t of TERMINALS) assert(manifest.permissions.run.includes(t), t);
});
