import { assert, assertEquals } from "@std/assert";
import {
  addressScope,
  cleanHost,
  countryName,
  daysUntil,
  expandIPv6,
  formatSpeed,
  formatTtl,
  installMarkdown,
  isHostname,
  isIPv4,
  isIPv6,
  jitter,
  median,
  osFamily,
  parseDig,
  parseDoh,
  parseIntent,
  parseInterfaces,
  parseIpinfo,
  parsePing,
  parseWhois,
  percentile,
  place,
  rankInterfaces,
  reverseName,
  serverTime,
  shortDate,
  unquoteTxt,
} from "./lib.ts";

Deno.test("addresses and hosts", () => {
  assert(isIPv4("192.168.1.10") && !isIPv4("256.1.1.1") && !isIPv4("1.2.3"));
  for (const ok of ["::1", "2606:4700:4700::1111", "fe80::1ff:fe23:4567:890a", "::ffff:192.0.2.1", "1:2:3:4:5:6:7:8"]) {
    assert(isIPv6(ok), ok);
  }
  for (const bad of ["1::2::3", "12345::", "1:2:3:4:5:6:7:8:9", "example.com", ":"]) assert(!isIPv6(bad), bad);
  assert(isHostname("www.example.co.uk") && isHostname("localhost") && isHostname("_dmarc.example.com"));
  assert(!isHostname("-rf.example.com") && !isHostname("example") && !isHostname("1.2.3"));
  assertEquals(cleanHost("https://www.Example.com/path?q=1"), "www.example.com");
  assertEquals(cleanHost("example.com:8080"), "example.com");
  assertEquals(cleanHost("[2606:4700::1111]"), "2606:4700::1111");
  assertEquals(cleanHost("--help"), undefined, "never an option");
  assertEquals(cleanHost("a b"), undefined);
  assertEquals(addressScope("10.0.0.4"), "Private");
  assertEquals(addressScope("172.20.1.1"), "Private");
  assertEquals(addressScope("100.101.1.1"), "Carrier-grade NAT");
  assertEquals(addressScope("8.8.8.8"), undefined);
  assertEquals(addressScope("fe80::1"), "Link-local");
  assertEquals(expandIPv6("2001:db8::1"), "2001:0db8:0000:0000:0000:0000:0000:0001");
  assertEquals(reverseName("1.2.3.4"), "4.3.2.1.in-addr.arpa");
  assert(
    reverseName("2001:db8::1").startsWith("1.0.0.0.0.0.0.0.") &&
      reverseName("2001:db8::1").endsWith("8.b.d.0.1.0.0.2.ip6.arpa"),
  );
});

Deno.test("intents", () => {
  assertEquals(parseIntent(""), { kind: "home" });
  assertEquals(parseIntent("ip"), { kind: "ip" });
  assertEquals(parseIntent("speedtest"), { kind: "speed" });
  assertEquals(parseIntent("interfaces"), { kind: "interfaces" });
  assertEquals(parseIntent("dns example.com"), {
    kind: "dns",
    host: "example.com",
    types: ["A", "AAAA", "CNAME", "MX", "NS", "TXT"],
  });
  assertEquals(parseIntent("dig example.com mx txt"), { kind: "dns", host: "example.com", types: ["MX", "TXT"] });
  assertEquals(parseIntent("dns 1.1.1.1"), { kind: "dns", host: "1.1.1.1", types: ["PTR"] });
  assertEquals(parseIntent("ping 1.1.1.1"), { kind: "ping", host: "1.1.1.1" });
  assertEquals(parseIntent("whois https://github.com/x"), { kind: "whois", host: "github.com" });
  assertEquals(parseIntent("ping -f"), { kind: "invalid", tool: "ping", text: "-f" });
  assertEquals(parseIntent("example.org"), { kind: "host", host: "example.org" });
  assertEquals(parseIntent("hello there"), { kind: "home" });
});

Deno.test("DNS over HTTPS answers", () => {
  // cloudflare-dns.com/dns-query?name=www.github.com&type=A
  const a = parseDoh("A", {
    Status: 0,
    TC: false,
    RD: true,
    RA: true,
    AD: false,
    CD: false,
    Question: [{ name: "www.github.com", type: 1 }],
    Answer: [
      { name: "www.github.com", type: 5, TTL: 3600, data: "github.com." },
      { name: "github.com", type: 1, TTL: 60, data: "140.82.121.4" },
    ],
  });
  assertEquals(a.records, [{ name: "github.com", type: "A", ttl: 60, data: "140.82.121.4" }]);
  const mx = parseDoh("MX", {
    Status: 0,
    Answer: [
      { name: "gmail.com.", type: 15, TTL: 3600, data: "20 alt2.gmail-smtp-in.l.google.com." },
      { name: "gmail.com.", type: 15, TTL: 3600, data: "5 gmail-smtp-in.l.google.com." },
    ],
  });
  assertEquals(mx.records.map((r) => [r.priority, r.data]), [[5, "gmail-smtp-in.l.google.com"], [
    20,
    "alt2.gmail-smtp-in.l.google.com",
  ]]);
  const txt = parseDoh("TXT", {
    Status: 0,
    Answer: [{ name: "example.com", type: 16, TTL: 300, data: '"v=spf1 -all"' }],
  });
  assertEquals(txt.records[0].data, "v=spf1 -all");
  assertEquals(parseDoh("A", { Status: 3, Authority: [] }).status, "NXDOMAIN");
  assertEquals(unquoteTxt('"v=DKIM1; k=rsa; " "p=MIGf"'), "v=DKIM1; k=rsa; p=MIGf");
});

Deno.test("dig output", () => {
  const out = `;; Got answer:
;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 4242
example.com.		3600	IN	MX	10 mail.example.com.
example.com.		3600	IN	MX	0 .
`;
  const mx = parseDig("MX", out);
  assertEquals(mx.records.map((r) => [r.priority, r.data]), [[0, ""], [10, "mail.example.com"]]);
  assertEquals(parseDig("A", ";; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 1\n").status, "NXDOMAIN");
  assertEquals(formatTtl(45), "45 s");
  assertEquals(formatTtl(7200), "2 h");
});

Deno.test("ping output", () => {
  const out = `PING one.one.one.one (1.1.1.1) 56(84) bytes of data.
64 bytes from one.one.one.one (1.1.1.1): icmp_seq=1 ttl=57 time=11.9 ms
64 bytes from one.one.one.one (1.1.1.1): icmp_seq=2 ttl=57 time=12.6 ms
64 bytes from one.one.one.one (1.1.1.1): icmp_seq=4 ttl=57 time=12.1 ms

--- one.one.one.one ping statistics ---
4 packets transmitted, 3 received, 25% packet loss, time 3005ms
rtt min/avg/max/mdev = 11.912/12.204/12.611/0.298 ms
`;
  const s = parsePing("one.one.one.one", out);
  assertEquals(s.address, "1.1.1.1");
  assertEquals(s.replies.map((r) => r.seq), [1, 2, 4]);
  assertEquals([s.transmitted, s.received, s.loss], [4, 3, 25]);
  assertEquals([s.min, s.avg, s.max, s.mdev], [11.912, 12.204, 12.611, 0.298]);

  const partial = parsePing("x", out.split("\n").slice(0, 3).join("\n"));
  assertEquals([partial.transmitted, partial.min, partial.max], [undefined, 11.9, 12.6]);
  assertEquals(partial.avg, 12.25);

  const busybox = parsePing(
    "8.8.8.8",
    `PING 8.8.8.8 (8.8.8.8): 56 data bytes
64 bytes from 8.8.8.8: seq=0 ttl=117 time=9.876 ms
--- 8.8.8.8 ping statistics ---
1 packets transmitted, 1 packets received, 0% packet loss
round-trip min/avg/max = 9.876/9.876/9.876 ms`,
  );
  assertEquals([busybox.loss, busybox.avg], [0, 9.876]);

  const down = parsePing(
    "10.9.9.9",
    `PING 10.9.9.9 (10.9.9.9) 56(84) bytes of data.
From 10.0.0.1 icmp_seq=1 Destination Host Unreachable

--- 10.9.9.9 ping statistics ---
2 packets transmitted, 0 received, +1 errors, 100% packet loss, time 1001ms`,
  );
  assertEquals([down.loss, down.avg, down.errors], [100, undefined, ["Destination Host Unreachable"]]);
  const unknown = parsePing("nope.invalid", "ping: nope.invalid: Name or service not known");
  assertEquals(unknown.errors, ["Name or service not known"]);
});

Deno.test("whois output", () => {
  const com = `   Domain Name: EXAMPLE.COM
   Registry Domain ID: 2336799_DOMAIN_COM-VRSN
   Registrar WHOIS Server: whois.iana.org
   Updated Date: 2025-08-14T07:01:39Z
   Creation Date: 1995-08-14T04:00:00Z
   Registry Expiry Date: 2026-08-13T04:00:00Z
   Registrar: RESERVED-Internet Assigned Numbers Authority
   Registrar IANA ID: 376
   Domain Status: clientDeleteProhibited https://icann.org/epp#clientDeleteProhibited
   Domain Status: clientTransferProhibited https://icann.org/epp#clientTransferProhibited
   Name Server: A.IANA-SERVERS.NET
   Name Server: B.IANA-SERVERS.NET
   DNSSEC: signedDelegation
>>> Last update of whois database: 2026-10-28T09:12:08Z <<<
Registrant Organization: REDACTED FOR PRIVACY
`;
  const w = parseWhois(com);
  assertEquals(w.fields, [
    { label: "Domain", value: "EXAMPLE.COM" },
    { label: "Updated", value: "2025-08-14T07:01:39Z" },
    { label: "Created", value: "1995-08-14T04:00:00Z" },
    { label: "Expires", value: "2026-08-13T04:00:00Z" },
    { label: "Registrar", value: "RESERVED-Internet Assigned Numbers Authority" },
    { label: "DNSSEC", value: "signedDelegation" },
  ]);
  assertEquals(w.nameServers, ["a.iana-servers.net", "b.iana-servers.net"]);
  assertEquals(w.statuses, ["clientDeleteProhibited", "clientTransferProhibited"]);
  assertEquals(daysUntil("2026-11-07T00:00:00Z", Date.parse("2026-10-28T00:00:00Z")), 10);
  assertEquals(shortDate("1995-08-14T04:00:00Z"), "14 Aug 1995");

  const ripe = parseWhois(`% This is the RIPE Database query service.
inetnum:        193.0.0.0 - 193.0.7.255
netname:        RIPE-NCC
country:        NL
org:            ORG-RIEN1-RIPE
abuse-mailbox:  abuse@ripe.net
origin:         AS3333
`);
  assertEquals(ripe.fields.map((f) => f.label), ["Range", "Network", "Country", "Registrant", "Abuse", "ASN"]);
  assertEquals(parseWhois('No match for "NOPE-NOPE.COM".').fields, []);
});

Deno.test("ipinfo geolocation", () => {
  const g = parseIpinfo({
    ip: "8.8.8.8",
    hostname: "dns.google",
    city: "Mountain View",
    region: "California",
    country: "US",
    loc: "37.4056,-122.0775",
    org: "AS15169 Google LLC",
    postal: "94043",
    timezone: "America/Los_Angeles",
    anycast: true,
  });
  assertEquals(g.loc, { lat: 37.4056, lon: -122.0775 });
  assertEquals([g.org, g.asn], ["Google LLC", "AS15169"]);
  assertEquals(place(g), "Mountain View, California, US");
  assertEquals(parseIpinfo({ ip: "10.0.0.1", bogon: true }).loc, undefined);
  assertEquals(countryName("FR"), "🇫🇷 France");
});

Deno.test("interfaces from ip -j", () => {
  const addr = JSON.stringify([
    {
      ifindex: 1,
      ifname: "lo",
      flags: ["LOOPBACK", "UP", "LOWER_UP"],
      mtu: 65536,
      operstate: "UNKNOWN",
      link_type: "loopback",
      address: "00:00:00:00:00:00",
      addr_info: [{ family: "inet", local: "127.0.0.1", prefixlen: 8, scope: "host" }],
    },
    {
      ifindex: 3,
      ifname: "wlp2s0",
      flags: ["BROADCAST", "MULTICAST", "UP", "LOWER_UP"],
      mtu: 1500,
      operstate: "UP",
      link_type: "ether",
      address: "a4:c3:f0:11:22:33",
      addr_info: [
        { family: "inet", local: "192.168.1.42", prefixlen: 24, scope: "global" },
        { family: "inet6", local: "fe80::a6c3:f0ff:fe11:2233", prefixlen: 64, scope: "link" },
      ],
      stats64: { rx: { bytes: 1234567890 }, tx: { bytes: 98765432 } },
    },
    {
      ifindex: 4,
      ifname: "docker0",
      flags: ["NO-CARRIER", "BROADCAST", "MULTICAST", "UP"],
      mtu: 1500,
      operstate: "DOWN",
      link_type: "ether",
      address: "02:42:ac:11:00:01",
      addr_info: [{ family: "inet", local: "172.17.0.1", prefixlen: 16, scope: "global" }],
    },
    { ifindex: 5, ifname: "wg0", flags: ["POINTOPOINT", "NOARP", "UP", "LOWER_UP"], mtu: 1420, link_type: "none" },
  ]);
  const route = JSON.stringify([
    { dst: "default", gateway: "192.168.1.1", dev: "wlp2s0", protocol: "dhcp", metric: 600 },
    { dst: "192.168.1.0/24", dev: "wlp2s0" },
  ]);
  const list = parseInterfaces(addr, route);
  const wifi = list.find((i) => i.name === "wlp2s0")!;
  assertEquals([wifi.kind, wifi.up, wifi.gateway, wifi.isDefault, wifi.rx], [
    "wifi",
    true,
    "192.168.1.1",
    true,
    1234567890,
  ]);
  assertEquals(list.find((i) => i.name === "docker0")!.up, false);
  assertEquals(list.find((i) => i.name === "wg0")!.kind, "vpn");
  assertEquals(list.find((i) => i.name === "lo")!.mac, undefined);
  assertEquals(rankInterfaces(list).map((i) => i.name), ["wlp2s0", "wg0", "docker0", "lo"]);
});

Deno.test("speed test maths", () => {
  assertEquals(formatSpeed(94_300_000), "94.3 Mbit/s");
  assertEquals(formatSpeed(512_000_000), "512 Mbit/s");
  assertEquals(formatSpeed(1_234_000_000), "1.23 Gbit/s");
  assertEquals(median([5, 1, 3]), 3);
  assertEquals(percentile([10, 20, 30, 40, 50], 0.9), 46);
  assertEquals(jitter([10, 12, 11, 15]), (2 + 1 + 4) / 3);
  assertEquals(serverTime("cfRequestDuration;dur=12.5"), 12.5);
  assertEquals(serverTime(null), 0);
});

Deno.test("install hints", () => {
  assertEquals(osFamily("ID=ubuntu\nID_LIKE=debian\n"), "debian");
  assertEquals(osFamily('ID="fedora"\n'), "fedora");
  assert(installMarkdown("Whois", "whois", "arch").includes("sudo pacman -S whois"));
  assert(installMarkdown("Ping", "ping", "debian").includes("sudo apt install iputils-ping"));
  assert(installMarkdown("DNS", "dig", undefined).includes("sudo dnf install bind-utils"));
});
