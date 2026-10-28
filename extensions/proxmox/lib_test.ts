import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { errorText, HOSTS, isAllowedHost, SetupError, setupItems } from "./api.ts";
import {
  authHeader,
  bytes,
  consoleUrl,
  type Guest,
  guestLook,
  isCertificateError,
  isTokenId,
  matches,
  normalizePem,
  normalizeUrl,
  type Resource,
  snapshotName,
  sortResources,
  sortSnapshots,
  summary,
  tagsOf,
  uptime,
  webUrl,
} from "./lib.ts";

// Shaped like `GET /api2/json/cluster/resources`.
const RESOURCES: Resource[] = [
  { id: "storage/pve/local-lvm", type: "storage", node: "pve", storage: "local-lvm", status: "available" },
  {
    id: "lxc/200",
    type: "lxc",
    vmid: 200,
    name: "pihole",
    node: "pve",
    status: "running",
    cpu: 0.002,
    maxcpu: 1,
    mem: 125829120,
    maxmem: 536870912,
    uptime: 600000,
    tags: "dns;infra",
  },
  { id: "qemu/9000", type: "qemu", vmid: 9000, name: "debian-12-cloud", node: "pve", status: "stopped", template: 1 },
  { id: "qemu/101", type: "qemu", vmid: 101, name: "win11", node: "pve", status: "stopped", maxcpu: 8 },
  { id: "node/pve", type: "node", node: "pve", status: "online", cpu: 0.12, maxcpu: 16, mem: 25e9, maxmem: 64e9 },
  {
    id: "qemu/100",
    type: "qemu",
    vmid: 100,
    name: "home-assistant",
    node: "pve",
    status: "running",
    cpu: 0.03,
    maxcpu: 2,
  },
];

const PEM = `-----BEGIN CERTIFICATE-----
MIIBszCCAVmgAwIBAgIUQ0FfVGVzdENlcnRpZmljYXRlMDAwMDAwMDAwMDAwMDAw
MDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAw
MDAwMA==
-----END CERTIFICATE-----
`;

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("pve.local"));
  assert(isAllowedHost("pve.home"));
  assert(isAllowedHost("192.168.1.10"));
  assert(isAllowedHost("100.101.102.103"));
  assert(!isAllowedHost("pve.example.com"));
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("pve.local"), "https://pve.local:8006");
  assertEquals(normalizeUrl("https://192.168.1.10:8006/#v1:0:=qemu%2F100:4"), "https://192.168.1.10:8006");
  assertEquals(normalizeUrl("https://pve.lan:443"), "https://pve.lan");
  assertEquals(normalizeUrl(""), "");
});

Deno.test("API tokens", () => {
  assert(isTokenId("root@pam!backslash"));
  assert(isTokenId("me@pve!launcher-2"));
  assert(!isTokenId("root@pam"));
  assert(!isTokenId("backslash"));
  assertEquals(authHeader(" root@pam!bs ", "abc "), "PVEAPIToken=root@pam!bs=abc");
});

Deno.test("CA certificates, from a file or pasted on one line", () => {
  assertEquals(normalizePem(PEM), PEM);
  assertEquals(normalizePem(PEM.replace(/\n/g, " ")), PEM);
  assertEquals(normalizePem("not a certificate"), undefined);
  assert(isCertificateError("client error (Connect): invalid peer certificate: UnknownIssuer"));
  assert(!isCertificateError("Connection refused (os error 111)"));
  const err = new TypeError("fetch failed", { cause: new Error("invalid peer certificate: UnknownIssuer") });
  assert(isCertificateError(errorText(err)));
});

Deno.test("filters and order", () => {
  const ids = (f: string) => sortResources(RESOURCES.filter((r) => matches(r, f))).map((r) => r.id);
  assertEquals(ids("all"), ["node/pve", "qemu/100", "qemu/101", "lxc/200", "qemu/9000"]);
  assertEquals(ids("running"), ["node/pve", "qemu/100", "lxc/200"]);
  assertEquals(ids("stopped"), ["qemu/101"]);
  assertEquals(summary(RESOURCES), "2 of 3 running");
  assertEquals(summary([]), null);
});

Deno.test("looks and formatting", () => {
  const g = (o: Partial<Guest>) => ({ id: "qemu/1", type: "qemu", vmid: 1, node: "pve", ...o }) as Guest;
  assertEquals(guestLook(g({ status: "running" })).tint, "green");
  assertEquals(guestLook(g({ status: "stopped" })).label, "Stopped");
  assertEquals(guestLook(g({ status: "running", lock: "backup" })).label, "Locked (backup)");
  assertEquals(guestLook(g({ template: 1 })).label, "Template");
  assertEquals(tagsOf({ id: "x", type: "qemu", tags: "dns;infra" }), ["dns", "infra"]);
  assertEquals(bytes(4294967296), "4.0 GiB");
  assertEquals(bytes(125829120), "120 MiB");
  assertEquals(uptime(86400 * 3 + 7200), "3 d 2 h");
  assertEquals(uptime(0), "–");
});

Deno.test("console and web UI URLs", () => {
  const base = "https://pve.local:8006";
  assertEquals(
    consoleUrl(base, RESOURCES[5]),
    "https://pve.local:8006/?console=kvm&novnc=1&vmid=100&vmname=home-assistant&node=pve&resize=off&cmd=",
  );
  assertEquals(
    consoleUrl(base, RESOURCES[1]),
    "https://pve.local:8006/?console=lxc&xtermjs=1&vmid=200&vmname=pihole&node=pve&cmd=",
  );
  assertEquals(
    consoleUrl(base, RESOURCES[4]),
    "https://pve.local:8006/?console=shell&xtermjs=1&vmid=0&vmname=&node=pve&cmd=",
  );
  assertEquals(webUrl(base, RESOURCES[5]), "https://pve.local:8006/#v1:0:=qemu%2F100:4:::::::");
});

Deno.test("snapshots", () => {
  const sorted = sortSnapshots([
    { name: "current", description: "You are here!", parent: "b" },
    { name: "a", snaptime: 100 },
    { name: "b", snaptime: 200 },
  ]);
  assertEquals(sorted.map((s) => s.name), ["b", "a"]);
  assertEquals(snapshotName("before upgrade!"), "before_upgrade_");
  assertEquals(snapshotName("2026 release"), "release");
  assertEquals(snapshotName("", new Date(2026, 9, 28, 9, 5)), "backslash_20261028_0905");
});

Deno.test("setup rows", () => {
  const [cert] = setupItems(
    new SetupError("The server's certificate is self-signed", "cert", "https://pve.local:8006"),
  );
  assert(cert.detail?.markdown?.includes("pve-root-ca.pem"));
  const [token] = setupItems(new SetupError("Add an API token", "token", "https://pve.local:8006"));
  assertEquals(token.actions?.map((a) => a.title), ["Open Proxmox Web UI", "API Token Documentation"]);
});
