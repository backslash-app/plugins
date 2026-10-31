import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  ago,
  bytes,
  cleanNetworkId,
  explainZt,
  latencyColor,
  latencyMs,
  loginUrl,
  ms,
  netbirdProblem,
  parseNetbird,
  parseZtInfo,
  parseZtNetworks,
  parseZtPeers,
  summary,
  ztStatus,
} from "./lib.ts";

// Shaped like `netbird status --json` (0.30).
const NETBIRD = JSON.stringify({
  peers: {
    total: 3,
    connected: 2,
    details: [
      {
        fqdn: "nas.netbird.cloud",
        netbirdIp: "100.92.14.7",
        publicKey: "AAA=",
        status: "Connected",
        statusSince: "2026-10-30T08:00:00Z",
        connectionType: "Relayed",
        iceCandidateType: { local: "", remote: "" },
        iceCandidateEndpoint: { local: "", remote: "" },
        relayAddress: "rels://streamline-de-fra1-0.relay.netbird.io:443",
        lastWireguardHandshake: "2026-10-31T09:58:00Z",
        transferReceived: 1048576,
        transferSent: 2048,
        latency: 48_300_000,
        quantumResistance: false,
        routes: ["192.168.10.0/24"],
        networks: ["192.168.10.0/24"],
      },
      {
        fqdn: "laptop.netbird.cloud",
        netbirdIp: "100.92.3.21",
        publicKey: "BBB=",
        status: "Connected",
        statusSince: "2026-10-31T09:00:00Z",
        connectionType: "P2P",
        iceCandidateType: { local: "host", remote: "srflx" },
        iceCandidateEndpoint: { local: "192.168.1.20:51820", remote: "82.64.1.2:51820" },
        relayAddress: "",
        lastWireguardHandshake: "2026-10-31T09:59:00Z",
        transferReceived: 0,
        transferSent: 0,
        latency: 6_100_000,
        routes: null,
      },
      {
        fqdn: "phone.netbird.cloud",
        netbirdIp: "100.92.8.2",
        publicKey: "CCC=",
        status: "Idle",
        statusSince: "2026-10-30T20:00:00Z",
        connectionType: "-",
        lastWireguardHandshake: "0001-01-01T00:00:00Z",
        latency: 0,
      },
    ],
  },
  cliVersion: "0.30.2",
  daemonVersion: "0.30.2",
  management: { url: "https://api.netbird.io:443", connected: true, error: "" },
  signal: { url: "https://signal.netbird.io:443", connected: true, error: "" },
  relays: { total: 2, available: 2, details: [] },
  netbirdIp: "100.92.1.5/16",
  publicKey: "SELF=",
  usesKernelInterface: true,
  fqdn: "desktop.netbird.cloud",
  quantumResistance: false,
  networks: ["192.168.10.0/24"],
});

Deno.test("netbird: self, peers connected first by latency, relayed and P2P", () => {
  const s = parseNetbird(NETBIRD);
  assertEquals(s.connected, true);
  assertEquals(s.ip, "100.92.1.5");
  assertEquals(s.cidr, "100.92.1.5/16");
  assertEquals(s.managementUrl, "https://api.netbird.io");
  assertEquals(s.peersConnected, 2);
  assertEquals(s.peersTotal, 3);
  assertEquals(s.relays, "2/2");
  assertEquals(s.version, "0.30.2");
  assertEquals(s.peers.map((p) => p.name), ["laptop", "nas", "phone"]);
  const [laptop, nas, phone] = s.peers;
  assertEquals(laptop.latency, 6.1);
  assertEquals(laptop.connection, "P2P");
  assertEquals(laptop.endpoint, "82.64.1.2:51820");
  assertEquals(nas.connection, "Relayed");
  assertEquals(nas.endpoint, "rels://streamline-de-fra1-0.relay.netbird.io:443");
  assertEquals(nas.routes, ["192.168.10.0/24"]);
  assertEquals(nas.rx, 1048576);
  assertEquals(phone.connected, false);
  assertEquals(phone.latency, undefined);
  assertEquals(phone.handshake, undefined);
  assertEquals(phone.connection, undefined);
});

Deno.test("netbird: disconnected (no IP, management down)", () => {
  const s = parseNetbird(JSON.stringify({
    peers: { total: 0, connected: 0, details: null },
    management: { url: "https://netbird.example.com:443", connected: false, error: "context deadline exceeded" },
    signal: { connected: false },
    netbirdIp: "",
    daemonVersion: "0.29.0",
  }));
  assertEquals(s.connected, false);
  assertEquals(s.ip, undefined);
  assertEquals(s.managementError, "context deadline exceeded");
  assertEquals(s.peers, []);
});

Deno.test("netbird: latency in nanoseconds or as text", () => {
  assertEquals(latencyMs(12_000_000), 12);
  assertEquals(latencyMs("12.5ms"), 12.5);
  assertEquals(latencyMs("850µs"), 0.85);
  assertEquals(latencyMs("1.2s"), 1200);
  assertEquals(latencyMs(0), undefined);
  assertEquals(latencyMs("n/a"), undefined);
  assertEquals(latencyMs(null), undefined);
});

Deno.test("netbird: problems and sign-in link", () => {
  assertEquals(netbirdProblem("Daemon status: NeedsLogin\n\nRun UP command to log in with SSO").state, "login");
  assertEquals(
    netbirdProblem("Error: failed to connect to daemon error: context deadline exceeded").state,
    "daemon",
  );
  assertEquals(netbirdProblem("something odd\nmore").message, "something odd");
  assertEquals(
    loginUrl(
      "Please do the SSO login in your browser.\nIf your browser didn't open automatically, use this URL to log in:\n\nhttps://login.netbird.io/activate?user_code=ABCD-EFGH\n",
    ),
    "https://login.netbird.io/activate?user_code=ABCD-EFGH",
  );
  assertEquals(loginUrl("Connected"), undefined);
});

// Shaped like `zerotier-cli -j info`, `-j listnetworks` and `-j peers` (1.14).
const ZT_INFO = JSON.stringify({
  address: "a1b2c3d4e5",
  clock: 1792483200000,
  config: { settings: { allowTcpFallbackRelay: true, portMappingEnabled: true, primaryPort: 9993 } },
  online: true,
  planetWorldId: 149604618,
  publicIdentity: "a1b2c3d4e5:0:abcd",
  tcpFallbackActive: false,
  version: "1.14.2",
  versionBuild: 0,
  versionMajor: 1,
  versionMinor: 14,
  versionRev: 2,
});

const ZT_NETWORKS = JSON.stringify([
  {
    allowDNS: false,
    allowDefault: false,
    allowGlobal: false,
    allowManaged: true,
    assignedAddresses: ["10.147.17.5/24", "fd80:56c2:e21c::1/88"],
    bridge: false,
    broadcastEnabled: true,
    dns: { domain: "", servers: [] },
    id: "8056c2e21c000001",
    mac: "e6:1a:2b:3c:4d:5e",
    mtu: 2800,
    multicastSubscriptions: [],
    name: "home-lab",
    netconfRevision: 12,
    nwid: "8056c2e21c000001",
    portDeviceName: "ztabcdef12",
    portError: 0,
    routes: [{ flags: 0, metric: 0, target: "10.147.17.0/24", via: null }, {
      flags: 0,
      metric: 0,
      target: "192.168.50.0/24",
      via: "10.147.17.1",
    }],
    status: "OK",
    type: "PRIVATE",
  },
  {
    allowDefault: true,
    assignedAddresses: [],
    id: "1c33c1ced0ffee00",
    name: "",
    nwid: "1c33c1ced0ffee00",
    routes: [],
    status: "ACCESS_DENIED",
    type: "PRIVATE",
  },
]);

const ZT_PEERS = JSON.stringify([
  {
    address: "778cde7190",
    isBonded: false,
    latency: 112,
    paths: [{ active: true, address: "103.195.103.66/9993", expired: false, preferred: true }],
    role: "PLANET",
    version: "-1.-1.-1",
    versionMajor: -1,
  },
  {
    address: "0f1e2d3c4b",
    latency: 4,
    paths: [
      { active: false, address: "10.0.0.2/9993", expired: true, preferred: false },
      { active: true, address: "192.168.1.30/9993", expired: false, preferred: true },
    ],
    role: "LEAF",
    version: "1.14.2",
  },
  {
    address: "9a8b7c6d5e",
    latency: -1,
    paths: [],
    role: "LEAF",
    version: "1.12.0",
  },
  {
    address: "1122334455",
    latency: 38,
    paths: [{ active: true, address: "82.12.3.4/41234", expired: false, preferred: false }],
    role: "LEAF",
    version: "1.14.0",
  },
]);

Deno.test("zerotier: info", () => {
  assertEquals(parseZtInfo(ZT_INFO), {
    address: "a1b2c3d4e5",
    online: true,
    version: "1.14.2",
    tcpFallback: false,
    port: 9993,
  });
});

Deno.test("zerotier: networks with addresses, routes, unauthorized", () => {
  const [lab, denied] = parseZtNetworks(ZT_NETWORKS);
  assertEquals(lab.id, "8056c2e21c000001");
  assertEquals(lab.name, "home-lab");
  assertEquals(lab.addresses, ["10.147.17.5/24", "fd80:56c2:e21c::1/88"]);
  assertEquals(lab.routes, ["10.147.17.0/24", "192.168.50.0/24 via 10.147.17.1"]);
  assertEquals(lab.device, "ztabcdef12");
  assertEquals(lab.private, true);
  assertEquals(lab.dnsDomain, undefined);
  assertEquals(denied.status, "ACCESS_DENIED");
  assertEquals(denied.allowDefault, true);
  assertEquals(ztStatus(denied.status).label, "Not authorized");
  assertEquals(ztStatus("SOMETHING_NEW").label, "something new");
  assertEquals(parseZtNetworks("[]"), []);
});

Deno.test("zerotier: peers, leaves first by latency, roots last", () => {
  const peers = parseZtPeers(ZT_PEERS);
  assertEquals(peers.map((p) => p.address), ["0f1e2d3c4b", "1122334455", "9a8b7c6d5e", "778cde7190"]);
  assertEquals(peers[0].path, "192.168.1.30:9993");
  assertEquals(peers[0].direct, true);
  assertEquals(peers[1].path, "82.12.3.4:41234");
  assertEquals(peers[2].latency, undefined);
  assertEquals(peers[2].direct, false);
  assertEquals(peers[3].role, "PLANET");
  assertEquals(peers[3].version, undefined);
});

Deno.test("zerotier: network IDs and errors", () => {
  assertEquals(cleanNetworkId(" 8056C2E21C000001 "), "8056c2e21c000001");
  assertEquals(cleanNetworkId("8056c2e21c00001"), undefined);
  assertEquals(cleanNetworkId("not-an-id-at-all"), undefined);
  assert(
    explainZt("Error connecting to the ZeroTier service: authtoken.secret not found or readable").includes(
      "~/.zeroTierOneAuthToken",
    ),
  );
  assertEquals(
    explainZt("Error connecting to the ZeroTier service: connection failed"),
    "The ZeroTier service isn't running",
  );
});

Deno.test("formatting", () => {
  assertEquals(ms(0.4), "<1 ms");
  assertEquals(ms(6.1), "6.1 ms");
  assertEquals(ms(48.3), "48 ms");
  assertEquals(ms(undefined), "");
  assertEquals(latencyColor(20), "green");
  assertEquals(latencyColor(120), "yellow");
  assertEquals(latencyColor(400), "red");
  assertEquals(bytes(0), "0 B");
  assertEquals(bytes(1048576), "1.0 MB");
  assertEquals(bytes(15 * 1024 ** 3), "15 GB");
  const now = Date.parse("2026-10-31T10:00:00Z");
  assertEquals(ago("2026-10-31T09:58:00Z", now), "2m ago");
  assertEquals(ago("2026-10-29T10:00:00Z", now), "2d ago");
});

Deno.test("summary for the root search", () => {
  const nb = parseNetbird(NETBIRD);
  const nets = parseZtNetworks(ZT_NETWORKS);
  assertEquals(summary(nb, nets), "NetBird 2/3 peers · ZeroTier 1/2 networks");
  assertEquals(summary(undefined, []), "ZeroTier: no network");
  assertEquals(summary(undefined, undefined), null);
});

Deno.test("manifest runs only the two CLIs", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[]; net?: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.run, ["netbird", "zerotier-cli"]);
  assertEquals(manifest.permissions.net, undefined);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
