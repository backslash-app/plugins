import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  ago,
  band,
  bits,
  bytes,
  duration,
  freeboxApiPath,
  freeboxClients,
  FreeboxError,
  type FreeboxHost,
  freeboxPassword,
  freeboxResult,
  freeboxRouter,
  kindFrom,
  openwrtClients,
  openwrtRouter,
  rate,
  section,
  signalBars,
  signalColor,
  speed,
  statusLine,
  type UbusLeases,
  ubusResult,
  unifiClients,
  unifiData,
  unifiRouter,
} from "./lib.ts";
import { checkBase, HOSTS, isAllowedHost, normalizePem, normalizeUrl, SetupError } from "./net.ts";

// ---------------------------------------------------------------------------
// OpenWrt

Deno.test("ubus: results, status codes and JSON-RPC errors", () => {
  assertEquals(ubusResult({ jsonrpc: "2.0", id: 1, result: [0, { ubus_rpc_session: "abc" }] }), {
    status: 0,
    data: { ubus_rpc_session: "abc" },
  });
  assertEquals(ubusResult({ jsonrpc: "2.0", id: 1, result: [6] }).status, 6);
  assertEquals(ubusResult({ jsonrpc: "2.0", id: 1, error: { code: -32002, message: "Access denied" } }), {
    status: 6,
    error: "Access denied",
  });
  assertEquals(ubusResult("<html>").status, -1);
});

const BOARD = {
  kernel: "6.6.73",
  hostname: "OpenWrt",
  system: "ARMv8 Processor rev 4",
  model: "GL.iNet GL-MT6000",
  board_name: "glinet,gl-mt6000",
  release: { distribution: "OpenWrt", version: "24.10.0", revision: "r28427", description: "OpenWrt 24.10.0 r28427" },
};
const INFO = {
  localtime: 1792483200,
  uptime: 356_400,
  load: [32768, 16384, 8192],
  memory: { total: 1_000_000_000, free: 600_000_000, shared: 0, buffered: 0, available: 750_000_000, cached: 0 },
};
const WAN = {
  up: true,
  uptime: 300_000,
  l3_device: "eth1",
  proto: "dhcp",
  device: "eth1",
  "ipv4-address": [{ address: "82.64.12.34", mask: 24 }],
  "ipv6-address": [],
};
const LEASES: UbusLeases = {
  dhcp_leases: [
    { expires: 40_000, hostname: "pixel-8", macaddr: "aa:bb:cc:00:00:01", ipaddr: "192.168.1.120" },
    { expires: 3_600, hostname: "nas", macaddr: "aa:bb:cc:00:00:02", ipaddr: "192.168.1.10" },
    { expires: false, macaddr: "aa:bb:cc:00:00:03", ipaddr: "192.168.1.50" },
  ],
  dhcp6_leases: [],
};
const HINTS = {
  "AA:BB:CC:00:00:01": { ipaddrs: ["192.168.1.120"], ip6addrs: ["fd00::120"], name: "pixel-8" },
  "AA:BB:CC:00:00:03": { ipaddrs: ["192.168.1.50"], name: "printer" },
  "AA:BB:CC:00:00:04": { ipaddrs: ["192.168.1.77"], name: "laptop" },
};
const ASSOC = [
  {
    mac: "AA:BB:CC:00:00:01",
    signal: -58,
    noise: -95,
    inactive: 120,
    connected_time: 4_000,
    rx: { rate: 864_800, mcs: 9, bytes: 52_000_000 },
    tx: { rate: 1_200_900, mcs: 11, bytes: 2_100_000_000 },
  },
  { mac: "AA:BB:CC:00:00:04", signal: -76, rx: { rate: 6_000 }, tx: { rate: 54_000 } },
];

Deno.test("openwrt: router from board, info, WAN and counters", () => {
  const r = openwrtRouter(BOARD, INFO, WAN, { down: 1_250_000, up: 125_000, totalDown: 9e9, totalUp: 1e9 });
  assertEquals(r.name, "OpenWrt");
  assertEquals(r.model, "GL.iNet GL-MT6000");
  assertEquals(r.firmware, "OpenWrt 24.10.0 r28427");
  assertEquals(r.uptime, 356_400);
  assertEquals(r.wan.online, true);
  assertEquals(r.wan.ip, "82.64.12.34");
  assertEquals(r.wan.type, "dhcp");
  assertEquals(r.cpu, 0.5);
  assertEquals(r.memory, 0.25);
  assertEquals(speed(r.wan.down), "10.0 Mb/s");
  const down = openwrtRouter(undefined, undefined, { up: false }, {});
  assertEquals(down.wan.online, false);
  assertEquals(down.firmware, undefined);
});

Deno.test("openwrt: Wi-Fi stations named from leases and hints, then wired leases", () => {
  const clients = openwrtClients(
    [{ device: "phy1-ap0", ssid: "Home", band: band(5180), list: ASSOC }],
    LEASES,
    HINTS,
  );
  assertEquals(clients.map((c) => c.name), ["laptop", "pixel-8", "nas", "printer"]);
  const [laptop, pixel, nas, printer] = clients;
  assertEquals(pixel.mac, "aa:bb:cc:00:00:01");
  assertEquals(pixel.connection, "wifi");
  assertEquals(pixel.online, true);
  assertEquals(pixel.ssid, "Home");
  assertEquals(pixel.band, "5 GHz");
  assertEquals(pixel.ip, "192.168.1.120");
  assertEquals(pixel.ip6, "fd00::120");
  assertEquals(pixel.linkDown, 1_200_900_000);
  assertEquals(pixel.totalDown, 2_100_000_000);
  assertEquals(pixel.lease, 40_000);
  assertEquals(laptop.ip, "192.168.1.77");
  assertEquals(nas.connection, "wired");
  assertEquals(nas.online, undefined);
  assertEquals(printer.lease, undefined);
  assertEquals(section(pixel), "Wi-Fi");
  assertEquals(section(nas), "Wired");
});

Deno.test("openwrt: throughput from two samples", () => {
  assertEquals(rate(1000, 3000, 2), 1000);
  assertEquals(rate(5000, 1000, 1), undefined); // counter reset
  assertEquals(rate(undefined, 1000, 1), undefined);
  assertEquals(rate(1, 2, 0), undefined);
  assertEquals(band(2437), "2.4 GHz");
  assertEquals(band(5955), "6 GHz");
  assertEquals(band(undefined), undefined);
});

// ---------------------------------------------------------------------------
// UniFi

const STA = {
  meta: { rc: "ok" },
  data: [
    {
      mac: "F0:9F:C2:11:22:33",
      hostname: "iphone",
      name: "Ada's iPhone",
      ip: "192.168.1.31",
      is_wired: false,
      essid: "Home",
      radio: "na",
      channel: 36,
      signal: -54,
      rssi: 42,
      tx_rate: 1_201_000,
      rx_rate: 866_000,
      "tx_bytes-r": 250_000,
      "rx_bytes-r": 12_000,
      tx_bytes: 9_000_000_000,
      rx_bytes: 300_000_000,
      uptime: 7_200,
      last_seen: 1_792_483_190,
      oui: "Apple",
      network: "Default",
    },
    {
      mac: "00:11:32:aa:bb:cc",
      hostname: "ds920",
      ip: "192.168.1.5",
      is_wired: true,
      "tx_bytes-r": 0,
      "rx_bytes-r": 0,
      uptime: 900_000,
      oui: "Synology",
    },
    { mac: "aa:aa:aa:aa:aa:aa", is_wired: false, rssi: 20, radio: "ng", blocked: true },
  ],
};

const HEALTH = {
  meta: { rc: "ok" },
  data: [
    { subsystem: "wlan", status: "ok", num_user: 12 },
    {
      subsystem: "wan",
      status: "ok",
      wan_ip: "81.2.3.4",
      gw_mac: "e4:38:83:00:00:01",
      gw_name: "UDM Pro",
      gw_version: "4.1.13",
      "rx_bytes-r": 2_500_000,
      "tx_bytes-r": 300_000,
      "gw_system-stats": { cpu: "12.5", mem: "61.0", uptime: "864000" },
    },
    { subsystem: "www", status: "ok", latency: 9, xput_down: 940.5, xput_up: 610.2 },
  ],
};

const DEVICES = {
  meta: { rc: "ok" },
  data: [
    { mac: "f0:9f:c2:00:00:09", type: "uap", model: "U6LR", name: "Living room AP" },
    {
      mac: "e4:38:83:00:00:01",
      type: "udm",
      model: "UDMPRO",
      name: "Dream Machine Pro",
      version: "4.1.13.11916",
      uptime: 864_000,
      "system-stats": { cpu: "12.5", mem: "61.0" },
    },
  ],
};

Deno.test("unifi: clients from stat/sta", () => {
  const clients = unifiClients(unifiData(STA));
  assertEquals(clients.map((c) => c.name), ["aa:aa:aa:aa:aa:aa", "Ada's iPhone", "ds920"]);
  const iphone = clients[1];
  assertEquals(iphone.mac, "f0:9f:c2:11:22:33");
  assertEquals(iphone.band, "5 GHz");
  assertEquals(iphone.signal, -54);
  assertEquals(iphone.down, 250_000);
  assertEquals(iphone.up, 12_000);
  assertEquals(iphone.linkDown, 1_201_000_000);
  assertEquals(iphone.lastSeen, 1_792_483_190_000);
  assertEquals(iphone.vendor, "Apple");
  assertEquals(clients[2].connection, "wired");
  // Without a signal, RSSI (above the noise floor) gives it.
  assertEquals(clients[0].signal, -76);
  assertEquals(clients[0].band, "2.4 GHz");
  assertEquals(clients[0].blocked, true);
});

Deno.test("unifi: gateway from health and devices", () => {
  const r = unifiRouter(unifiData(HEALTH), unifiData(DEVICES));
  assertEquals(r.name, "Dream Machine Pro");
  assertEquals(r.model, "UDMPRO");
  assertEquals(r.firmware, "4.1.13.11916");
  assertEquals(r.wan.online, true);
  assertEquals(r.wan.ip, "81.2.3.4");
  assertEquals(r.wan.down, 2_500_000);
  assertEquals(r.wan.up, 300_000);
  assertEquals(r.wan.maxDown, 940_500_000);
  assertEquals(r.wan.latency, 9);
  assertEquals(r.cpu, 0.125);
  assertEquals(r.memory, 0.61);
  assertEquals(r.gatewayMac, "e4:38:83:00:00:01");
  const noDevices = unifiRouter(unifiData(HEALTH), []);
  assertEquals(noDevices.name, "UDM Pro");
  assertEquals(noDevices.uptime, 864_000);
  assertEquals(noDevices.gatewayMac, "e4:38:83:00:00:01");
});

Deno.test("unifi: error envelope", () => {
  assertThrows(() => unifiData({ meta: { rc: "error", msg: "api.err.NoSiteContext" }, data: [] }), Error, "NoSite");
  assertEquals(unifiData({}), []);
});

// ---------------------------------------------------------------------------
// Freebox

const HOSTS_FBX: FreeboxHost[] = [
  {
    id: "ether-3c:22:fb:00:00:01",
    primary_name: "MacBook-Air",
    host_type: "laptop",
    active: true,
    reachable: true,
    last_activity: 1_792_483_100,
    vendor_name: "Apple, Inc.",
    l2ident: { id: "3C:22:FB:00:00:01", type: "mac_address" },
    l3connectivities: [
      { addr: "192.168.1.12", af: "ipv4", active: false, reachable: false },
      { addr: "192.168.1.22", af: "ipv4", active: true, reachable: true },
      { addr: "2a01:e0a::22", af: "ipv6", active: true, reachable: true },
    ],
    access_point: {
      connectivity_type: "wifi",
      wifi_information: { band: "5g", ssid: "Freebox-ABCDEF", signal: -63, phy_rx_rate: 866_000, phy_tx_rate: 780_000 },
      rx_rate: 125_000,
      tx_rate: 3_000,
      rx_bytes: 1_000_000,
      tx_bytes: 200_000,
    },
  },
  {
    id: "ether-00:24:d4:00:00:02",
    primary_name: "Freebox Player POP",
    host_type: "freebox_player",
    active: false,
    last_activity: 1_792_400_000,
    l2ident: { id: "00:24:D4:00:00:02", type: "mac_address" },
    l3connectivities: [{ addr: "192.168.1.30", af: "ipv4", active: false }],
    access_point: { connectivity_type: "ethernet" },
  },
  { id: "broken", primary_name: "no mac" },
];

Deno.test("freebox: hosts from lan/browser/pub", () => {
  const clients = freeboxClients(HOSTS_FBX);
  assertEquals(clients.length, 2);
  const [mac, player] = clients;
  assertEquals(mac.mac, "3c:22:fb:00:00:01");
  assertEquals(mac.ip, "192.168.1.22");
  assertEquals(mac.ip6, "2a01:e0a::22");
  assertEquals(mac.connection, "wifi");
  assertEquals(mac.band, "5 GHz");
  assertEquals(mac.ssid, "Freebox-ABCDEF");
  assertEquals(mac.signal, -63);
  assertEquals(mac.down, 125_000);
  assertEquals(mac.vendor, "Apple, Inc.");
  assertEquals(player.online, false);
  assertEquals(player.connection, "wired");
  assertEquals(section(player), "Offline");
});

Deno.test("freebox: connection and system", () => {
  const r = freeboxRouter(
    {
      state: "up",
      type: "ethernet",
      media: "ftth",
      ipv4: "88.170.1.2",
      ipv6: "2a01:e0a:1::1",
      rate_down: 5_000_000,
      rate_up: 120_000,
      bandwidth_down: 8_000_000_000,
      bandwidth_up: 8_000_000_000,
      bytes_down: 9e11,
      bytes_up: 1e11,
    },
    {
      firmware_version: "4.8.12",
      uptime_val: 1_209_600,
      board_name: "fbxgw9r",
      model_info: { pretty_name: "Freebox v9 (r1)", name: "fbxgw9-r1" },
      sensors: [{ id: "temp_cpu_cp_master", name: "Température CPU", value: 58 }],
    },
  );
  assertEquals(r.name, "Freebox v9 (r1)");
  assertEquals(r.wan.online, true);
  assertEquals(r.wan.type, "Fiber");
  assertEquals(r.wan.maxDown, 8e9);
  assertEquals(bits(r.wan.maxDown), "8.0 Gb/s");
  assertEquals(r.temperature, 58);
  assertEquals(r.uptime, 1_209_600);
  assertEquals(freeboxRouter(undefined, { temp_cpum: 61 }).temperature, 61);
});

Deno.test("freebox: API path, envelope and login password", async () => {
  assertEquals(freeboxApiPath({ api_version: "10.2", api_base_url: "/api/" }), "/api/v10");
  assertEquals(freeboxApiPath(undefined), "/api/v4");
  assertEquals(freeboxResult<{ challenge: string }>({ success: true, result: { challenge: "abc" } }).challenge, "abc");
  try {
    freeboxResult({ success: false, error_code: "auth_required", msg: "Vous devez vous connecter" });
    throw new Error("should throw");
  } catch (e) {
    assert(e instanceof FreeboxError);
    assertEquals(e.code, "auth_required");
  }
  // HMAC-SHA1("key", "The quick brown fox jumps over the lazy dog"), the RFC 2104 example.
  assertEquals(
    await freeboxPassword("key", "The quick brown fox jumps over the lazy dog"),
    "de7c9b85b8b78aa6bc8a7a36f70a90701c9db4d9",
  );
  await assertRejects(() => Promise.reject(new FreeboxError("x", "y")), FreeboxError);
});

// ---------------------------------------------------------------------------
// Shared

Deno.test("formatting", () => {
  assertEquals(speed(125_000), "1.0 Mb/s");
  assertEquals(speed(undefined), "");
  assertEquals(bits(940_500_000), "941 Mb/s");
  assertEquals(bits(800), "800 b/s");
  assertEquals(bytes(2_100_000_000), "2.0 GB");
  assertEquals(duration(356_400), "4d 3h");
  assertEquals(duration(7_260), "2h 1m");
  assertEquals(duration(59), "0m");
  assertEquals(signalColor(-54), "green");
  assertEquals(signalColor(-70), "yellow");
  assertEquals(signalColor(-80), "red");
  assertEquals(signalBars(-50), "▂▄▆█");
  assertEquals(signalBars(-80), "▂▁▁▁");
  assertEquals(ago(Date.parse("2026-10-31T09:00:00Z"), Date.parse("2026-10-31T10:00:00Z")), "1h ago");
});

Deno.test("status line", () => {
  const r = unifiRouter(unifiData(HEALTH), unifiData(DEVICES));
  const clients = unifiClients(unifiData(STA));
  assertEquals(statusLine(r, clients), "3 clients online · ↓ 20.0 Mb/s ↑ 2.4 Mb/s");
  const off = { ...r, wan: { online: false } };
  assertEquals(statusLine(off, []), "0 clients online · internet down");
});

Deno.test("router kind from the preference or the address", () => {
  assertEquals(kindFrom("OpenWrt", ""), "openwrt");
  assertEquals(kindFrom("UniFi OS", ""), "unifi");
  assertEquals(kindFrom("", "http://mafreebox.freebox.fr"), "freebox");
  assertEquals(kindFrom("", "https://unifi.lan"), "unifi");
  assertEquals(kindFrom("", "192.168.1.1"), undefined);
});

Deno.test("addresses and certificates", () => {
  assertEquals(normalizeUrl("192.168.1.1/"), "http://192.168.1.1");
  assertEquals(normalizeUrl("192.168.1.1", "https"), "https://192.168.1.1");
  assertEquals(checkBase("mafreebox.freebox.fr", "router"), "http://mafreebox.freebox.fr");
  assert(isAllowedHost("192.168.1.1"));
  assert(isAllowedHost("router.lan"));
  assert(isAllowedHost("unifi"));
  assert(!isAllowedHost("example.com"));
  assert(!isAllowedHost("8.8.8.8"));
  assertThrows(() => checkBase("https://router.example.com", "router"), SetupError, "outside");
  assertThrows(() => checkBase("", "router"), SetupError, "Add the address");
  const pem = normalizePem("-----BEGIN CERTIFICATE----- MIIB\nIjAN BgkqhkiG9w0BAQEFAAOC -----END CERTIFICATE-----");
  assertEquals(pem, "-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOC\n-----END CERTIFICATE-----\n");
  assertEquals(normalizePem("nope"), undefined);
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, HOSTS);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
