import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { HOSTS } from "./api.ts";
import {
  daysUntil,
  decodeXml,
  type DnsRecord,
  type Domain,
  expiryColor,
  expiryState,
  expiryText,
  filterRecords,
  fullName,
  gandiValue,
  mapLimit,
  namecheapErrors,
  namecheapHostParams,
  ovhEndpoint,
  ovhRecordBody,
  ovhSignature,
  parseGandiDomains,
  parseGandiRecords,
  parseNamecheapDomains,
  parseNamecheapHosts,
  parseOvhRecord,
  parseOvhService,
  parsePorkbunDomains,
  parsePorkbunRecords,
  porkbunRecordBody,
  recordSpec,
  relativeName,
  rrsetValues,
  sortDomains,
  sortRecords,
  splitDomain,
  ttlLabel,
  typedName,
  xmlElements,
  xmlText,
  zoneLine,
} from "./lib.ts";

const NOW = Date.parse("2026-10-29T12:00:00Z");

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(manifest.permissions.net, HOSTS);
});

Deno.test("names", () => {
  assertEquals(relativeName("www.example.com", "example.com"), "www");
  assertEquals(relativeName("example.com.", "example.com"), "");
  assertEquals(relativeName("@", "example.com"), "");
  assertEquals(fullName("", "example.com"), "example.com");
  assertEquals(fullName("@", "example.com"), "example.com");
  assertEquals(fullName("WWW", "example.com"), "www.example.com");
  assertEquals(fullName("api.example.com.", "example.com"), "api.example.com");
  assertEquals(typedName("www.example.com", "example.com"), "www");
  assertEquals(splitDomain("shop.co.uk"), { sld: "shop", tld: "co.uk" });
  assertThrows(() => splitDomain("localhost"));
});

Deno.test("expiry", () => {
  const d = (iso: string, autoRenew?: boolean): Domain => ({
    registrar: "gandi",
    name: iso,
    expires: new Date(iso),
    autoRenew,
    dns: true,
  });
  assertEquals(daysUntil(new Date("2026-11-08T12:00:00Z"), NOW), 10);
  assertEquals(expiryState(d("2026-11-08T12:00:00Z"), 30, NOW), "soon");
  assertEquals(expiryState(d("2027-11-08T12:00:00Z"), 30, NOW), "ok");
  assertEquals(expiryState(d("2026-10-01T12:00:00Z"), 30, NOW), "expired");
  assertEquals(expiryState({ registrar: "ovh", name: "x", dns: false }, 30, NOW), "unknown");
  assertEquals(expiryColor(d("2026-11-08T12:00:00Z", true), 30, NOW), "yellow");
  assertEquals(expiryColor(d("2026-11-08T12:00:00Z", false), 30, NOW), "red");
  assertEquals(expiryText(new Date("2026-11-08T12:00:00Z"), NOW), "in 10 days");
  assertEquals(expiryText(new Date("2028-12-01T12:00:00Z"), NOW), "in 2 years");
  assertEquals(expiryText(new Date("2026-10-25T11:00:00Z"), NOW), "expired 4 days ago");
  assertEquals(expiryText(undefined, NOW), "no expiry date");
  const sorted = sortDomains([
    { registrar: "ovh", name: "none.fr", dns: true },
    d("2027-01-01T00:00:00Z"),
    d("2026-11-01T00:00:00Z"),
  ]);
  assertEquals(sorted.map((x) => x.name), ["2026-11-01T00:00:00Z", "2027-01-01T00:00:00Z", "none.fr"]);
});

Deno.test("record form: validation and normalisation", () => {
  assertEquals(recordSpec({ type: "a", name: "@", content: "1.2.3.4", ttl: "" }, "example.com"), {
    name: "",
    type: "A",
    content: "1.2.3.4",
    ttl: undefined,
    prio: undefined,
  });
  assertEquals(recordSpec({ type: "MX", name: "", content: "mail.example.com", ttl: "3600" }, "example.com").prio, 10);
  assertEquals(recordSpec({ type: "TXT", name: "_dmarc.example.com", content: '"v=DMARC1; p=none"' }, "example.com"), {
    name: "_dmarc",
    type: "TXT",
    content: "v=DMARC1; p=none",
    ttl: undefined,
    prio: undefined,
  });
  assertEquals(recordSpec({ type: "A", name: "*", content: "1.2.3.4" }, "example.com").name, "*");
  assertThrows(() => recordSpec({ type: "A", content: "300.1.1.1" }, "example.com"), Error, "IPv4");
  assertThrows(() => recordSpec({ type: "AAAA", content: "1.2.3.4" }, "example.com"), Error, "IPv6");
  assertThrows(() => recordSpec({ type: "CNAME", name: "@", content: "x.net" }, "example.com"), Error, "apex");
  assertThrows(() => recordSpec({ type: "A", content: "" }, "example.com"), Error, "required");
  assertThrows(() => recordSpec({ type: "A", content: "1.1.1.1", ttl: "300" }, "example.com", 600), Error, "600");
  assertThrows(() => recordSpec({ type: "BOGUS", content: "x" }, "example.com"), Error, "Unsupported");
  assertThrows(
    () => recordSpec({ type: "A", name: "bad name", content: "1.1.1.1" }, "example.com"),
    Error,
    "valid name",
  );
});

Deno.test("Porkbun", () => {
  const domains = parsePorkbunDomains({
    status: "SUCCESS",
    domains: [{
      domain: "Example.com",
      status: "ACTIVE",
      tld: "com",
      createDate: "2018-08-20 17:52:51",
      expireDate: "2027-08-20 17:52:51",
      securityLock: "1",
      whoisPrivacy: "1",
      autoRenew: 0,
      notLocal: 0,
    }],
  });
  assertEquals(domains[0].name, "example.com");
  assertEquals(domains[0].expires?.toISOString(), "2027-08-20T17:52:51.000Z");
  assertEquals(domains[0].autoRenew, false);
  assertEquals(domains[0].locked, true);
  const records = parsePorkbunRecords({
    status: "SUCCESS",
    records: [
      { id: "106926652", name: "example.com", type: "A", content: "1.1.1.1", ttl: "600", prio: "0", notes: "" },
      { id: "106926659", name: "www.example.com", type: "MX", content: "mx.example.com", ttl: "600", prio: "10" },
    ],
  }, "example.com");
  assertEquals(records.map((r) => [r.name, r.type, r.prio, r.ttl]), [["", "A", undefined, 600], [
    "www",
    "MX",
    10,
    600,
  ]]);
  assertEquals(porkbunRecordBody({ name: "www", type: "MX", content: "mx.x", ttl: 600, prio: 5 }), {
    name: "www",
    type: "MX",
    content: "mx.x",
    ttl: "600",
    prio: "5",
  });
  assertEquals(parsePorkbunDomains({ status: "ERROR" }), []);
});

Deno.test("Gandi: domains, rrsets and their values", () => {
  const domains = parseGandiDomains([
    {
      fqdn: "example.net",
      status: ["clientTransferProhibited"],
      dates: { registry_ends_at: "2027-03-01T10:00:00Z", created_at: "2020-03-01T10:00:00Z" },
      autorenew: true,
      nameserver: { current: "livedns" },
    },
    { fqdn: "other.org", status: [], dates: {}, autorenew: { enabled: false }, nameserver: { current: "other" } },
  ]);
  assertEquals(domains.map((d) => [d.name, d.autoRenew, d.dns, d.locked]), [
    ["example.net", true, true, true],
    ["other.org", false, false, false],
  ]);
  const records = parseGandiRecords([
    { rrset_name: "@", rrset_type: "A", rrset_ttl: 10800, rrset_values: ["1.1.1.1", "2.2.2.2"] },
    { rrset_name: "@", rrset_type: "MX", rrset_ttl: 10800, rrset_values: ["10 spool.mail.gandi.net."] },
    { rrset_name: "@", rrset_type: "TXT", rrset_ttl: 300, rrset_values: ['"v=spf1 include:_mailcust.gandi.net ?all"'] },
  ], "example.net");
  assertEquals(records.length, 4);
  assertEquals(records[2].prio, 10);
  assertEquals(records[2].content, "spool.mail.gandi.net.");
  assertEquals(records[3].content, "v=spf1 include:_mailcust.gandi.net ?all");
  assertEquals(gandiValue(records[3]), '"v=spf1 include:_mailcust.gandi.net ?all"');
  assertEquals(gandiValue({ type: "TXT", content: 'say "hi"' }), '"say \\"hi\\""');
  assertEquals(gandiValue(records[2]), "10 spool.mail.gandi.net.");
  // Edit one value of the A rrset, delete the other.
  assertEquals(rrsetValues(records, records[0], { name: "", type: "A", content: "3.3.3.3" }), ["3.3.3.3", "2.2.2.2"]);
  assertEquals(rrsetValues(records, records[1]), ["1.1.1.1"]);
  assertEquals(rrsetValues(records, records[2]), []);
});

Deno.test("OVHcloud: signatures, services, records", async () => {
  // The example of OVH's own documentation, and one with a body (checked with sha1sum).
  assertEquals(
    await ovhSignature(
      "EXEgWIz07P0HYwtQDs7cNIqCiQaWSuHF",
      "MtSwSrPpTxj6t5ViDiXd4kZfZqXyabK",
      "GET",
      "https://eu.api.ovh.com/1.0/domain/zone/example.com/record?fieldType=A",
      "",
      1366560945,
    ),
    "$1$256780455cd8aaa4746a9cc4752f61e9ab3562fb",
  );
  assertEquals(
    await ovhSignature(
      "secret",
      "consumer",
      "post",
      "https://eu.api.ovh.com/1.0/domain/zone/example.com/record",
      JSON.stringify(ovhRecordBody({ name: "_acme", type: "TXT", content: '"x"', ttl: 3600 }, true)),
      1761732000,
    ),
    "$1$d998db63de0ff08dab20a0364d7ea61d9449be35",
  );
  assertEquals(ovhEndpoint(""), "https://eu.api.ovh.com/1.0");
  assertEquals(ovhEndpoint("ovh-ca"), "https://ca.api.ovh.com/1.0");
  assertEquals(ovhEndpoint("us"), "https://api.us.ovhcloud.com/1.0");
  assertThrows(() => ovhEndpoint("mars"));
  const d = parseOvhService("Example.fr", {
    expiration: "2027-02-14",
    creation: "2015-02-14",
    status: "ok",
    renew: { automatic: true, deleteAtExpiration: false, forced: false, period: 12 },
  }, new Set(["example.fr"]));
  assertEquals([d.name, d.autoRenew, d.dns, d.expires?.toISOString().slice(0, 10)], [
    "example.fr",
    true,
    true,
    "2027-02-14",
  ]);
  assertEquals(
    parseOvhService("x.fr", { renew: { automatic: true, deleteAtExpiration: true } }, new Set()).autoRenew,
    false,
  );
  const mx = parseOvhRecord(
    { id: 5, fieldType: "MX", subDomain: "", target: "1 mx1.mail.ovh.net.", ttl: 0 },
    "example.fr",
  );
  assertEquals([mx.prio, mx.content, mx.ttl], [1, "mx1.mail.ovh.net.", undefined]);
  assertEquals(
    parseOvhRecord({ id: 6, fieldType: "TXT", subDomain: "x", target: '"hello"', ttl: 60 }, "example.fr").content,
    "hello",
  );
  assertEquals(ovhRecordBody({ name: "", type: "MX", content: "mx.x.", prio: 5 }, false), {
    subDomain: "",
    target: "5 mx.x.",
    ttl: 0,
  });
});

const NC_LIST = `<?xml version="1.0" encoding="utf-8"?>
<ApiResponse Status="OK" xmlns="http://api.namecheap.com/xml.response">
  <Errors />
  <RequestedCommand>namecheap.domains.getList</RequestedCommand>
  <CommandResponse Type="namecheap.domains.getList">
    <DomainGetListResult>
      <Domain ID="127" Name="example.com" User="ada" Created="02/15/2016" Expires="02/15/2027" IsExpired="false" IsLocked="true" AutoRenew="false" WhoisGuard="ENABLED" IsPremium="false" IsOurDNS="true" />
      <Domain ID="381" Name="ada&amp;co.io" User="ada" Created="04/28/2016" Expires="04/28/2026" IsExpired="true" IsLocked="false" AutoRenew="true" WhoisGuard="NOTPRESENT" IsPremium="false" IsOurDNS="false" />
    </DomainGetListResult>
    <Paging><TotalItems>2</TotalItems><CurrentPage>1</CurrentPage><PageSize>100</PageSize></Paging>
  </CommandResponse>
</ApiResponse>`;

const NC_HOSTS = `<ApiResponse Status="OK"><CommandResponse Type="namecheap.domains.dns.getHosts">
<DomainDNSGetHostsResult Domain="example.com" IsUsingOurDNS="true">
<host HostId="12" Name="@" Type="A" Address="1.2.3.4" MXPref="10" TTL="1800" />
<host HostId="14" Name="www" Type="CNAME" Address="example.com." MXPref="10" TTL="1800" />
<host HostId="15" Name="@" Type="MX" Address="mx.example.com." MXPref="20" TTL="3600" />
<host HostId="16" Name="@" Type="TXT" Address="v=spf1 &quot;quoted&quot; ~all" MXPref="10" TTL="1800" />
</DomainDNSGetHostsResult></CommandResponse></ApiResponse>`;

Deno.test("Namecheap: XML, domains, hosts and setHosts", () => {
  assertEquals(decodeXml("a&amp;b &lt;&#x41;&#66;&gt; &bogus;"), "a&b <AB> &bogus;");
  assertEquals(xmlElements('<a x="1" y=\'2\'/><a z="3">t</a>', "a"), [{ x: "1", y: "2" }, { z: "3" }]);
  assertEquals(xmlText(NC_LIST, "TotalItems"), "2");
  const { domains, total } = parseNamecheapDomains(NC_LIST);
  assertEquals(total, 2);
  assertEquals(domains.map((d) => [d.name, d.autoRenew, d.dns, d.locked, d.status, d.privacy]), [
    ["example.com", false, true, true, "active", true],
    ["ada&co.io", true, false, false, "expired", false],
  ]);
  assertEquals(domains[0].expires?.toISOString().slice(0, 10), "2027-02-15");
  const hosts = parseNamecheapHosts(NC_HOSTS, "example.com");
  assertEquals(hosts.map((h) => [h.id, h.name, h.type, h.prio]), [
    ["12", "", "A", undefined],
    ["14", "www", "CNAME", undefined],
    ["15", "", "MX", 20],
    ["16", "", "TXT", undefined],
  ]);
  assertEquals(hosts[3].content, 'v=spf1 "quoted" ~all');
  const params = namecheapHostParams(hosts.filter((h) => h.id !== "14"));
  assertEquals(params.HostName1, "@");
  assertEquals(params.RecordType2, "MX");
  assertEquals(params.MXPref2, "20");
  assertEquals(params.TTL2, "3600");
  assertEquals(params.EmailType, "MX");
  assertEquals(params.HostName4, undefined);
  assertEquals(namecheapHostParams([{ name: "x", type: "A", content: "1.1.1.1" }]).EmailType, undefined);
  assertEquals(
    namecheapErrors(
      `<ApiResponse Status="ERROR"><Errors><Error Number="1011150">Invalid request IP: 1.2.3.4</Error></Errors></ApiResponse>`,
    ),
    [{ number: "1011150", message: "Invalid request IP: 1.2.3.4" }],
  );
  assertEquals(namecheapErrors(NC_LIST), []);
});

Deno.test("records: sort, filter, zone lines, TTLs", () => {
  const r = (name: string, type: string, content: string, domain = "example.com", prio?: number): DnsRecord => ({
    id: `${name}${type}${content}`,
    domain,
    registrar: "porkbun",
    name,
    type,
    content,
    ttl: 600,
    prio,
  });
  const all = [
    r("www", "CNAME", "example.com"),
    r("", "TXT", "hi"),
    r("", "MX", "mx.b", "example.com", 20),
    r("", "A", "1.1.1.1"),
    r("", "A", "1.1.1.1", "a.org"),
  ];
  assertEquals(sortRecords(all).map((x) => `${x.domain}/${x.name || "@"}/${x.type}`), [
    "a.org/@/A",
    "example.com/@/A",
    "example.com/@/MX",
    "example.com/@/TXT",
    "example.com/www/CNAME",
  ]);
  assertEquals(filterRecords(all, "address").length, 2);
  assertEquals(filterRecords(all, "other").length, 0);
  assertEquals(zoneLine(all[2]), "example.com.\t600\tIN\tMX\t20\tmx.b.");
  assertEquals(zoneLine(all[1]), 'example.com.\t600\tIN\tTXT\t"hi"');
  assertEquals(ttlLabel(3600), "1 h");
  assertEquals(ttlLabel(undefined), "default");
});

Deno.test("mapLimit keeps the order and the limit", async () => {
  let running = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
    peak = Math.max(peak, ++running);
    await new Promise((r) => setTimeout(r, n));
    running--;
    return n * 10;
  });
  assertEquals(out, [50, 10, 40, 20, 30]);
  assert(peak <= 2);
});
