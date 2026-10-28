import { assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { accounts, errorMessage, HOSTS } from "./api.ts";
import {
  consoleUrl,
  formatMemory,
  formatPrice,
  fromDigitalOcean,
  fromHetzner,
  fromLinode,
  fromScaleway,
  ipv6Address,
  linodePrices,
  monthlyTotal,
  parseZones,
  powerChoices,
  powerRequest,
  sortServers,
  specs,
  sshCommand,
  statusLabel,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

const HETZNER = {
  id: 42,
  name: "web-1",
  status: "running",
  created: "2025-06-01T10:00:00+00:00",
  labels: { env: "prod", backup: "" },
  public_net: { ipv4: { ip: "116.203.10.20" }, ipv6: { ip: "2a01:4f8:c17:1234::/64" } },
  private_net: [{ ip: "10.0.0.2" }],
  server_type: {
    name: "cx22",
    cores: 2,
    memory: 4,
    disk: 40,
    prices: [
      {
        location: "fsn1",
        price_hourly: { gross: "0.0074000000000000" },
        price_monthly: { gross: "4.5900000000000000" },
      },
      {
        location: "nbg1",
        price_hourly: { gross: "0.0074000000000000" },
        price_monthly: { gross: "4.5900000000000000" },
      },
    ],
  },
  datacenter: { name: "nbg1-dc3", location: { name: "nbg1", city: "Nuremberg", country: "DE" } },
  image: { name: "ubuntu-24.04", description: "Ubuntu 24.04" },
};

const DROPLET = {
  id: 3164444,
  name: "api-droplet",
  memory: 1024,
  vcpus: 1,
  disk: 25,
  status: "off",
  created_at: "2026-01-10T08:00:00Z",
  size_slug: "s-1vcpu-1gb",
  size: { price_monthly: 6, price_hourly: 0.00893 },
  image: { distribution: "Debian", name: "12 x64" },
  networks: {
    v4: [
      { ip_address: "10.110.0.3", type: "private" },
      { ip_address: "164.90.1.2", type: "public" },
    ],
    v6: [{ ip_address: "2a03:b0c0:3:d0::1a:2001", type: "public" }],
  },
  region: { slug: "fra1", name: "Frankfurt 1" },
  tags: ["api"],
};

const LINODE = {
  id: 123,
  label: "mail",
  status: "shutting_down",
  ipv4: ["192.168.139.10", "172.105.5.6"],
  ipv6: "2600:3c01::f03c:93ff:fe24:3a2f/128",
  region: "eu-central",
  type: "g6-standard-2",
  specs: { vcpus: 2, memory: 4096, disk: 81920 },
  image: "linode/debian12",
  created: "2024-02-01T09:00:00",
  tags: [],
};

const SCALEWAY = {
  id: "7a1b2c3d-0000-4000-8000-000000000001",
  name: "scw-dev",
  state: "stopped in place",
  commercial_type: "DEV1-S",
  zone: "fr-par-1",
  project: "proj",
  creation_date: "2025-12-01T12:00:00.000000+00:00",
  tags: ["dev"],
  image: { name: "Ubuntu 22.04 Jammy Jellyfish" },
  public_ip: null,
  public_ips: [
    { address: "51.15.1.2", family: "inet" },
    { address: "2001:bc8:710:1::1", family: "inet6" },
  ],
  private_ip: null,
};

Deno.test("Hetzner: price of the server's location, IPv6 from its block, labels", () => {
  const s = fromHetzner(HETZNER);
  assertEquals(s.state, "running");
  assertEquals(s.ipv4, "116.203.10.20");
  assertEquals(s.ipv6, "2a01:4f8:c17:1234::1");
  assertEquals(s.region, "nbg1");
  assertEquals(s.regionName, "Nuremberg, DE");
  assertEquals(s.price, { monthly: 4.59, hourly: 0.0074, currency: "EUR" });
  assertEquals(s.tags, ["env=prod", "backup"]);
  assertEquals(specs(s), "2 vCPU · 4 GB · 40 GB disk");
  assertEquals(powerChoices(s), ["reboot", "shutdown", "off"]);
  assertEquals(powerRequest(s, "off"), { path: "/v1/servers/42/actions/poweroff" });
});

Deno.test("DigitalOcean: public and private networks, price, power actions", () => {
  const s = fromDigitalOcean(DROPLET);
  assertEquals(s.state, "off");
  assertEquals(s.ipv4, "164.90.1.2");
  assertEquals(s.privateIps, ["10.110.0.3"]);
  assertEquals(s.ipv6, "2a03:b0c0:3:d0::1a:2001");
  assertEquals(formatPrice(s.price), "$6/mo");
  assertEquals(formatMemory(s.memory), "1 GB");
  assertEquals(s.image, "Debian 12 x64");
  assertEquals(powerChoices(s), ["on"]);
  assertEquals(powerRequest(s, "on"), { path: "/v2/droplets/3164444/actions", body: { type: "power_on" } });
  assertEquals(consoleUrl(s), "https://cloud.digitalocean.com/droplets/3164444");
});

Deno.test("Linode: public IPv4 among private ones, plan prices, UTC dates", () => {
  const prices = linodePrices([
    { id: "g6-standard-2", label: "Linode 4GB", price: { monthly: 24, hourly: 0.036 } },
    { id: "g6-nanode-1", price: { monthly: 5, hourly: 0.0075 } },
  ]);
  const s = fromLinode(LINODE, prices);
  assertEquals(s.state, "busy");
  assertEquals(s.ipv4, "172.105.5.6");
  assertEquals(s.privateIps, ["192.168.139.10"]);
  assertEquals(s.ipv6, "2600:3c01::f03c:93ff:fe24:3a2f");
  assertEquals(s.disk, 80);
  assertEquals(s.image, "debian12");
  assertEquals(s.created?.toISOString(), "2024-02-01T09:00:00.000Z");
  assertEquals(formatPrice(s.price), "$24/mo");
  assertEquals(statusLabel(s.status), "Shutting down");
  assertEquals(powerChoices(s), []);
  assertEquals(powerRequest({ ...s, state: "running" }, "reboot"), { path: "/v4/linode/instances/123/reboot" });
});

Deno.test("Scaleway: public_ips by family, products, zone in paths", () => {
  const s = fromScaleway(SCALEWAY, "fr-par-1", {
    "DEV1-S": { monthly_price: 6.42, hourly_price: 0.0088, ncpus: 2, ram: 2147483648 },
  });
  assertEquals(s.state, "off");
  assertEquals(s.ipv4, "51.15.1.2");
  assertEquals(s.ipv6, "2001:bc8:710:1::1");
  assertEquals(formatPrice(s.price), "€6.42/mo");
  assertEquals(specs(s), "2 vCPU · 2 GB");
  assertEquals(powerRequest(s, "on"), {
    path: "/instance/v1/zones/fr-par-1/servers/7a1b2c3d-0000-4000-8000-000000000001/action",
    body: { action: "poweron" },
  });
  assertEquals(
    consoleUrl(s),
    "https://console.scaleway.com/instance/servers/fr-par-1/7a1b2c3d-0000-4000-8000-000000000001/overview",
  );
  // The deprecated single public_ip is still read.
  assertEquals(
    fromScaleway({ ...SCALEWAY, public_ips: [], public_ip: { address: "1.2.3.4" } }, "nl-ams-1").ipv4,
    "1.2.3.4",
  );
});

Deno.test("sorting, totals, SSH", () => {
  const all = [fromScaleway(SCALEWAY, "fr-par-1"), fromDigitalOcean(DROPLET), fromHetzner(HETZNER)];
  assertEquals(sortServers(all).map((s) => s.provider), ["hetzner", "digitalocean", "scaleway"]);
  assertEquals(monthlyTotal(all), "$6/mo + €4.59/mo");
  assertEquals(sshCommand(fromHetzner(HETZNER), "deploy"), ["ssh", "deploy@116.203.10.20"]);
  assertEquals(sshCommand(fromHetzner(HETZNER), ""), ["ssh", "root@116.203.10.20"]);
  assertEquals(sshCommand({ ...fromHetzner(HETZNER), ipv4: undefined, ipv6: undefined }), undefined);
});

Deno.test("zones and accounts from preferences", () => {
  assertEquals(parseZones("fr-par-1, NL-AMS-1 junk;pl-waw-2,fr-par-1"), ["fr-par-1", "nl-ams-1", "pl-waw-2"]);
  const acc = accounts({ hetznerToken: " h ", linodeToken: "", scalewaySecretKey: "s", scalewayZones: "fr-par-2" });
  assertEquals(acc.map((a) => [a.provider, a.token, a.zones]), [["hetzner", "h", []], ["scaleway", "s", ["fr-par-2"]]]);
});

Deno.test("IPv6 blocks and error bodies", () => {
  assertEquals(ipv6Address("2a01:4f8::/64"), "2a01:4f8::1");
  assertEquals(ipv6Address("2600:3c01::1/128"), "2600:3c01::1");
  assertEquals(ipv6Address(null), undefined);
  assertEquals(
    errorMessage({ error: { code: "forbidden", message: "insufficient permissions" } }),
    "insufficient permissions",
  );
  assertEquals(
    errorMessage({ id: "unauthorized", message: "Unable to authenticate you" }),
    "Unable to authenticate you",
  );
  assertEquals(errorMessage({ errors: [{ reason: "Not found" }] }), "Not found");
  assertEquals(errorMessage(undefined), "");
});

Deno.test("hosts and programs match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[]; run: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assertEquals(manifest.permissions.run, TERMINALS);
});
