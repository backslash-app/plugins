import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  base,
  binary,
  cidr,
  contains,
  EXAMPLES,
  expandIPv6,
  formatCount,
  formatIPv6,
  hostRange,
  ipv4Class,
  isAddress,
  last,
  maskLike,
  merge,
  neighbor,
  parseIPv4,
  parseIPv6,
  parseNetwork,
  parseQuery,
  parseSpan,
  plural,
  prefixForCount,
  prefixForHosts,
  ptrName,
  reverseZones,
  scopeOf,
  split,
  summarize,
  supernet,
  usableHosts,
} from "./lib.ts";

const net = parseNetwork;
const blocks = (...inputs: string[]) => summarize(inputs.map(parseSpan)).map(cidr);

Deno.test("IPv4 parsing is strict", () => {
  assertEquals(parseIPv4("192.168.1.10"), 0xc0a8010an);
  assertEquals(parseIPv4("0.0.0.0"), 0n);
  assertEquals(parseIPv4("255.255.255.255"), 0xffffffffn);
  assertThrows(() => parseIPv4("256.0.0.1"), Error, "more than 255");
  assertThrows(() => parseIPv4("10.0.0"), Error, "Not an IPv4");
  assertThrows(() => parseIPv4("010.0.0.1"), Error, "Leading zeros");
  assertThrows(() => parseIPv4("1.2.3.x"), Error, "Not an IPv4");
});

Deno.test("IPv6 parsing and RFC 5952 formatting", () => {
  assertEquals(parseIPv6("::"), 0n);
  assertEquals(parseIPv6("::1"), 1n);
  assertEquals(formatIPv6(parseIPv6("2001:0DB8:0000:0000:0000:0000:0000:0001")), "2001:db8::1");
  // The longest run of zeros is compressed; on a tie, the first one.
  assertEquals(formatIPv6(parseIPv6("2001:db8:0:0:1:0:0:1")), "2001:db8::1:0:0:1");
  assertEquals(formatIPv6(parseIPv6("2001:0:0:1:0:0:0:1")), "2001:0:0:1::1");
  // A single zero group is never compressed.
  assertEquals(formatIPv6(parseIPv6("2001:db8:0:1:1:1:1:1")), "2001:db8:0:1:1:1:1:1");
  assertEquals(formatIPv6(parseIPv6("::ffff:192.0.2.1")), "::ffff:192.0.2.1");
  assertEquals(formatIPv6(parseIPv6("64:ff9b::192.0.2.33")), "64:ff9b::c000:221");
  assertEquals(formatIPv6(parseIPv6("[fe80::1%eth0]")), "fe80::1");
  assertEquals(expandIPv6(parseIPv6("2001:db8::1")), "2001:0db8:0000:0000:0000:0000:0000:0001");
  assertThrows(() => parseIPv6("1::2::3"), Error, "only once");
  assertThrows(() => parseIPv6("1:2:3:4:5:6:7"), Error, "8 groups");
  assertThrows(() => parseIPv6("1:2:3:4:5:6:7:8:9"), Error, "8 groups");
  assertThrows(() => parseIPv6("1:2:3:4::5:6:7:8"), Error, "8 groups");
  assertThrows(() => parseIPv6("2001:db8::g"), Error, "Not an IPv6");
  assert(isAddress("fe80::1") && isAddress("8.8.8.8") && !isAddress("example.com"));
});

Deno.test("networks from CIDR, netmask and wildcard", () => {
  assertEquals(net("10.0.0.5/22").prefix, 22);
  assertEquals(net("10.0.0.5 255.255.252.0").prefix, 22);
  assertEquals(net("10.0.0.5/255.255.252.0").prefix, 22);
  assertEquals(net("10.0.0.5 0.0.3.255").prefix, 22);
  assertEquals(net("10.0.0.5 / 22").prefix, 22);
  assertEquals(net("0.0.0.0/0").prefix, 0);
  assertEquals(net("8.8.8.8"), { family: 4, address: 0x08080808n, prefix: 32, bare: true });
  assertEquals(net("2001:db8::/48").prefix, 48);
  assertThrows(() => net("10.0.0.0/33"), Error, "0 to 32");
  assertThrows(() => net("::/129"), Error, "0 to 128");
  assertThrows(() => net("10.0.0.0/255.0.255.0"), Error, "contiguous");
  assert(maskLike("255.255.255.0") && maskLike("0.0.0.255"));
  assert(!maskLike("10.0.0.1") && !maskLike("0.0.0.0"));
});

Deno.test("IPv4 network values", () => {
  const n = net("192.168.1.77/24");
  assertEquals(cidr(n), "192.168.1.0/24");
  assertEquals(last(n), parseIPv4("192.168.1.255"));
  const h = hostRange(n);
  assertEquals([h.first, h.last, h.count], [parseIPv4("192.168.1.1"), parseIPv4("192.168.1.254"), 254n]);
  // /31 has two usable hosts (RFC 3021), /32 one.
  assertEquals(hostRange(net("10.0.0.0/31")).count, 2n);
  assertEquals(hostRange(net("10.0.0.0/31")).first, parseIPv4("10.0.0.0"));
  assertEquals(hostRange(net("10.0.0.9/32")).count, 1n);
  assertEquals(usableHosts(0, 4), 4294967294n);
  assertEquals(binary(parseIPv4("192.168.1.0"), 4), "11000000.10101000.00000001.00000000");
});

Deno.test("IPv6 network values", () => {
  const n = net("2001:db8:abcd:12::1/64");
  assertEquals(cidr(n), "2001:db8:abcd:12::/64");
  assertEquals(formatIPv6(last(n)), "2001:db8:abcd:12:ffff:ffff:ffff:ffff");
  assertEquals(hostRange(n).count, 1n << 64n);
  assertEquals(cidr(net("::1/128")), "::1/128");
  assertEquals(cidr(net("fe80::1234/10")), "fe80::/10");
  assertEquals(formatIPv6(base(n)), "2001:db8:abcd:12::");
});

Deno.test("scopes", () => {
  const scope = (s: string) => scopeOf(net(s)).label;
  assertEquals(scope("192.168.1.0/24"), "Private");
  assertEquals(scope("172.20.0.1"), "Private");
  assertEquals(scope("172.32.0.1"), "Public");
  assertEquals(scope("8.8.8.8"), "Public");
  assertEquals(scope("100.100.1.1"), "CGNAT");
  assertEquals(scope("127.0.0.1"), "Loopback");
  assertEquals(scope("169.254.10.1"), "Link-local");
  assertEquals(scope("203.0.113.9"), "Documentation");
  assertEquals(scope("239.255.255.250"), "Multicast");
  assertEquals(scope("255.255.255.255"), "Broadcast");
  assertEquals(scope("0.0.0.0/0"), "Mixed");
  assertEquals(scope("172.0.0.0/8"), "Mixed");
  assertEquals(scope("::1"), "Loopback");
  assertEquals(scope("::"), "Unspecified");
  assertEquals(scope("fd12:3456::1"), "Private");
  assertEquals(scope("fe80::1"), "Link-local");
  assertEquals(scope("2001:db8::/48"), "Documentation");
  assertEquals(scope("2a00:1450::1"), "Public");
  assertEquals(scope("::ffff:10.0.0.1"), "IPv4-mapped");
  assertEquals(scope("4000::1"), "Reserved");
  assertEquals(ipv4Class(parseIPv4("10.1.1.1")).name, "A");
  assertEquals(ipv4Class(parseIPv4("172.16.0.1")).name, "B");
  assertEquals(ipv4Class(parseIPv4("192.168.0.1")).defaultPrefix, 24);
  assertEquals(ipv4Class(parseIPv4("224.0.0.1")).name, "D (multicast)");
});

Deno.test("reverse DNS", () => {
  assertEquals(ptrName(parseIPv4("192.0.2.5"), 4), "5.2.0.192.in-addr.arpa");
  assertEquals(ptrName(parseIPv6("2001:db8::1"), 6).slice(0, 8), "1.0.0.0.");
  assert(ptrName(parseIPv6("2001:db8::1"), 6).endsWith(".8.b.d.0.1.0.0.2.ip6.arpa"));
  assertEquals(reverseZones(net("192.168.1.0/24")), { zones: ["1.168.192.in-addr.arpa"], total: 1 });
  assertEquals(reverseZones(net("10.0.0.0/8")), { zones: ["10.in-addr.arpa"], total: 1 });
  // A /22 covers four /24 zones; a /26 lives inside one.
  assertEquals(reverseZones(net("10.0.4.0/22")).zones, [
    "4.0.10.in-addr.arpa",
    "5.0.10.in-addr.arpa",
    "6.0.10.in-addr.arpa",
    "7.0.10.in-addr.arpa",
  ]);
  assertEquals(reverseZones(net("10.0.0.64/26")).zones, ["0.0.10.in-addr.arpa"]);
  assertEquals(reverseZones(net("2001:db8::/32")).zones, ["8.b.d.0.1.0.0.2.ip6.arpa"]);
  assertEquals(reverseZones(net("2001:db8::/31")).total, 2);
  assertEquals(reverseZones(net("172.16.0.0/12"), 4), {
    zones: ["16.172.in-addr.arpa", "17.172.in-addr.arpa", "18.172.in-addr.arpa", "19.172.in-addr.arpa"],
    total: 16,
  });
});

Deno.test("splitting", () => {
  const s = split(net("10.0.0.0/16"), 24);
  assertEquals(s.total, 256n);
  assertEquals(s.subnets.length, 256);
  assertEquals(cidr(s.subnets[0]), "10.0.0.0/24");
  assertEquals(cidr(s.subnets[255]), "10.0.255.0/24");
  const big = split(net("10.0.0.0/8"), 30);
  assertEquals(big.total, 4194304n);
  assertEquals(big.subnets.length, 256);
  assertEquals(split(net("2001:db8::/48"), 64).total, 65536n);
  assertEquals(cidr(split(net("2001:db8::/48"), 64).subnets[1]), "2001:db8:0:1::/64");
  assertThrows(() => split(net("10.0.0.0/24"), 24), Error, "longer");
  assertThrows(() => split(net("10.0.0.0/24"), 33), Error, "at most");
  assertEquals(prefixForCount(net("172.16.0.0/12"), 6), 15);
  assertEquals(prefixForCount(net("10.0.0.0/16"), 4), 18);
  assertEquals(prefixForCount(net("10.0.0.0/16"), 5), 19);
});

Deno.test("membership, supernets and neighbors", () => {
  assert(contains(net("10.0.0.0/8"), net("10.200.3.4")));
  assert(contains(net("10.0.0.0/8"), net("10.1.0.0/16")));
  assert(!contains(net("10.1.0.0/16"), net("10.0.0.0/8")));
  assert(!contains(net("10.0.0.0/8"), net("11.0.0.1")));
  assert(!contains(net("::/0"), net("10.0.0.1")));
  assert(contains(net("2001:db8::/32"), net("2001:db8:1::5")));
  assertEquals(cidr(supernet(net("10.0.1.0/24"), net("10.0.2.0/24"))), "10.0.0.0/22");
  assertEquals(cidr(supernet(net("192.168.1.5"), net("192.168.1.0/24"))), "192.168.1.0/24");
  assertEquals(cidr(neighbor(net("10.0.1.0/24"), 1)!), "10.0.2.0/24");
  assertEquals(cidr(neighbor(net("10.0.1.0/24"), -1)!), "10.0.0.0/24");
  assertEquals(neighbor(net("0.0.0.0/24"), -1), undefined);
  assertEquals(neighbor(net("255.255.255.0/24"), 1), undefined);
});

Deno.test("summarizing into the fewest CIDRs", () => {
  assertEquals(blocks("10.0.0.0/24", "10.0.1.0/24"), ["10.0.0.0/23"]);
  assertEquals(blocks("10.0.0.0/24", "10.0.1.0/24", "10.0.2.0-10.0.3.255"), ["10.0.0.0/22"]);
  assertEquals(blocks("10.0.0.1-10.0.0.20"), [
    "10.0.0.1/32",
    "10.0.0.2/31",
    "10.0.0.4/30",
    "10.0.0.8/29",
    "10.0.0.16/30",
    "10.0.0.20/32",
  ]);
  assertEquals(blocks("10.0.0.1-20"), blocks("10.0.0.1-10.0.0.20"));
  assertEquals(blocks("10.0.0.0/8", "10.5.0.0/16"), ["10.0.0.0/8"]);
  assertEquals(blocks("0.0.0.0-255.255.255.255"), ["0.0.0.0/0"]);
  assertEquals(blocks("192.168.0.5", "192.168.0.4"), ["192.168.0.4/31"]);
  assertEquals(blocks("2001:db8::/64", "2001:db8:0:1::/64", "10.0.0.1"), ["10.0.0.1/32", "2001:db8::/63"]);
  assertEquals(merge([parseSpan("10.0.0.0/24"), parseSpan("10.0.2.0/24")]).length, 2);
  assertThrows(() => parseSpan("10.0.0.9-10.0.0.1"), Error, "ends before");
  assertThrows(() => parseSpan("10.0.0.1-::1"), Error, "Mixed");
});

Deno.test("sizing for hosts", () => {
  assertEquals(prefixForHosts(500n), 23);
  assertEquals(prefixForHosts(510n), 23);
  assertEquals(prefixForHosts(511n), 22);
  assertEquals(prefixForHosts(254n), 24);
  assertEquals(prefixForHosts(2n), 30);
  assertEquals(prefixForHosts(1n), 32);
  assertThrows(() => prefixForHosts(0n), Error, "1 host");
  assertThrows(() => prefixForHosts(1n << 33n), Error, "No IPv4");
});

Deno.test("counts stay readable", () => {
  assertEquals(formatCount(254n), "254");
  assertEquals(formatCount(4294967296n), "4,294,967,296");
  assertEquals(formatCount(1n << 64n), "2⁶⁴ (≈ 1.84 × 10¹⁹)");
  assertEquals(formatCount(1n << 128n), "2¹²⁸ (≈ 3.40 × 10³⁸)");
  assertEquals(plural(1n, "address"), "1 address");
  assertEquals(plural(1024n, "address"), "1,024 addresses");
  assertEquals(plural(2, "host"), "2 hosts");
});

Deno.test("queries", () => {
  assertEquals(parseQuery("").kind, "empty");
  const kind = (q: string) => parseQuery(q).kind;
  assertEquals(kind("192.168.1.0/24"), "network");
  assertEquals(kind("10.0.0.5 255.255.252.0"), "network");
  assertEquals(kind("2001:db8::/48"), "network");
  assertEquals(kind("8.8.8.8"), "network");
  assertEquals(parseQuery("10.0.0.0/16 split 24"), {
    kind: "split",
    network: net("10.0.0.0/16"),
    prefix: 24,
  });
  assertEquals(parseQuery("10.0.0.0/16 split /24").kind, "split");
  const into = parseQuery("10.0.0.0/16 into 4 subnets");
  assertEquals(into.kind === "split" && into.prefix, 18);
  const inside = parseQuery("is 10.0.0.5 in 10.0.0.0/8?");
  assertEquals(inside.kind === "contains" && cidr(inside.haystack), "10.0.0.0/8");
  assertEquals(parseQuery("10.0.0.1 in ::/0"), { kind: "error", message: "IPv4 and IPv6 never share a network" });
  assertEquals(parseQuery("500 hosts"), { kind: "hosts", hosts: 500n });
  assertEquals(parseQuery("1,000 hosts"), { kind: "hosts", hosts: 1000n });
  assertEquals(parseQuery("hosts 60"), { kind: "hosts", hosts: 60n });
  assertEquals(parseQuery("/27"), { kind: "prefix", prefix: 27 });
  assertEquals(parseQuery("255.255.255.224"), { kind: "prefix", prefix: 27, family: 4 });
  assertEquals(parseQuery("255.255.255.255").kind, "network");
  const sum = parseQuery("10.0.0.0/24, 10.0.1.0/24 10.0.0.1 - 10.0.0.9");
  assertEquals(sum.kind === "summarize" && sum.inputs, ["10.0.0.0/24", "10.0.1.0/24", "10.0.0.1-10.0.0.9"]);
  assertEquals(parseQuery("10.0.0.1 10.0.0.2").kind, "summarize");
  assertEquals(parseQuery("/200").kind, "error");
  assertEquals(parseQuery("hello").kind, "error");
  assertEquals(parseQuery("10.0.0.0/24 split 20").kind, "split"); // the error comes when splitting
  for (const e of EXAMPLES) assert(parseQuery(e.query).kind !== "error", e.query);
});

Deno.test("manifest: no permission, command file exists", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions?: unknown;
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions, undefined);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
