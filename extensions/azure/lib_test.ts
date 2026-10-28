import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  age,
  appHealth,
  appKind,
  classifyError,
  filterVms,
  installCommand,
  osFamily,
  parseAccount,
  parseSubscriptions,
  parseVms,
  parseWebApps,
  portalUrl,
  powerState,
  resourceGroupOf,
  sortVms,
  sortWebApps,
  sshCommand,
  subscriptionPortalUrl,
  webappTailCommand,
} from "./lib.ts";
import { holdOpen, terminalArgs, TERMINALS } from "./terminal.ts";

const SUBSCRIPTIONS = JSON.stringify([
  {
    cloudName: "AzureCloud",
    homeTenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47",
    id: "0b1f6471-1bf0-4dda-aec3-111122223333",
    isDefault: false,
    managedByTenants: [],
    name: "Visual Studio Enterprise",
    state: "Enabled",
    tenantDefaultDomain: "contoso.onmicrosoft.com",
    tenantDisplayName: "Contoso",
    tenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47",
    user: { name: "alice@contoso.com", type: "user" },
  },
  {
    cloudName: "AzureCloud",
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    isDefault: false,
    name: "Old Sandbox",
    state: "Disabled",
    tenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47",
    user: { name: "alice@contoso.com", type: "user" },
  },
  {
    cloudName: "AzureCloud",
    id: "c2a7e2d8-5555-4444-8888-999900001111",
    isDefault: true,
    name: "Production",
    state: "Enabled",
    tenantId: "72f988bf-86f1-41af-91ab-2d7cd011db47",
    user: { name: "alice@contoso.com", type: "user" },
  },
]);

Deno.test("subscriptions: current first, disabled last", () => {
  const subs = parseSubscriptions(SUBSCRIPTIONS);
  assertEquals(subs.map((s) => s.name), ["Production", "Visual Studio Enterprise", "Old Sandbox"]);
  assertEquals(subs[1].tenantName, "Contoso");
  assertEquals(subs[1].tenantDomain, "contoso.onmicrosoft.com");
  assertEquals(subs[0].user, "alice@contoso.com");
  assertEquals(
    subscriptionPortalUrl(subs[1]),
    "https://portal.azure.com/#@contoso.onmicrosoft.com/resource/subscriptions/0b1f6471-1bf0-4dda-aec3-111122223333/overview",
  );
  assertEquals(parseAccount(JSON.stringify(JSON.parse(SUBSCRIPTIONS)[2])).name, "Production");
  assertEquals(parseSubscriptions(""), []);
});

const VM_ID =
  "/subscriptions/c2a7e2d8-5555-4444-8888-999900001111/resourceGroups/web-rg/providers/Microsoft.Compute/virtualMachines/web-01";

const VMS = JSON.stringify([
  {
    fqdns: "",
    hardwareProfile: { vmSize: "Standard_B2s" },
    id:
      "/subscriptions/c2a7e2d8-5555-4444-8888-999900001111/resourceGroups/BATCH-RG/providers/Microsoft.Compute/virtualMachines/batch-01",
    location: "francecentral",
    name: "batch-01",
    osProfile: { adminUsername: "azureuser", computerName: "batch-01" },
    powerState: "VM deallocated",
    privateIps: "10.1.0.5",
    provisioningState: "Succeeded",
    publicIps: "",
    resourceGroup: "BATCH-RG",
    storageProfile: {
      imageReference: { offer: "0001-com-ubuntu-server-jammy", publisher: "Canonical", sku: "22_04-lts-gen2" },
      osDisk: { osType: "Linux" },
    },
    tags: null,
    timeCreated: "2025-03-02T09:10:11.1234567+00:00",
    zones: null,
  },
  {
    fqdns: "web-01.westeurope.cloudapp.azure.com",
    hardwareProfile: { vmSize: "Standard_D4s_v5" },
    id: VM_ID,
    location: "westeurope",
    name: "web-01",
    osProfile: { adminUsername: "ops", computerName: "web-01" },
    powerState: "VM running",
    priority: "Spot",
    privateIps: "10.0.0.4,10.0.1.4",
    provisioningState: "Succeeded",
    publicIps: "20.71.12.34",
    resourceGroup: "WEB-RG",
    storageProfile: {
      imageReference: { id: "/subscriptions/x/resourceGroups/img/providers/Microsoft.Compute/galleries/g/images/web" },
      osDisk: { osType: "Linux" },
    },
    tags: { env: "prod", team: "" },
    zones: ["2"],
  },
  { id: "/x", name: "odd", powerState: null },
]);

Deno.test("VMs: power state, IPs, image, resource group from the id", () => {
  const vms = parseVms(VMS);
  const [batch, web, odd] = vms;
  assertEquals(batch.power, "deallocated");
  assertEquals(batch.publicIps, []);
  assertEquals(batch.resourceGroup, "BATCH-RG");
  assertEquals(batch.image, "Canonical · 0001-com-ubuntu-server-jammy · 22_04-lts-gen2");
  assertEquals(batch.created?.toISOString(), "2025-03-02T09:10:11.123Z");
  assertEquals(web.power, "running");
  assertEquals(web.resourceGroup, "web-rg");
  assertEquals(web.privateIps, ["10.0.0.4", "10.0.1.4"]);
  assertEquals(web.image, "web");
  assertEquals(web.priority, "Spot");
  assertEquals(odd.power, "unknown");
  assertEquals(sortVms(vms).map((v) => v.name), ["web-01", "batch-01", "odd"]);
  assertEquals(filterVms(vms, "running").map((v) => v.name), ["web-01"]);
  assertEquals(filterVms(vms, "stopped").length, 2);
});

Deno.test("power states", () => {
  assertEquals(powerState("VM stopped"), "stopped");
  assertEquals(powerState("VM deallocating"), "deallocating");
  assertEquals(powerState("Provisioning"), "unknown");
});

Deno.test("SSH command: DNS name, preference user, nothing without public address", () => {
  const [batch, web] = parseVms(VMS);
  assertEquals(sshCommand(web), ["ssh", "ops@web-01.westeurope.cloudapp.azure.com"]);
  assertEquals(sshCommand(web, " root "), ["ssh", "root@web-01.westeurope.cloudapp.azure.com"]);
  assertEquals(sshCommand(batch), undefined);
});

Deno.test("portal URLs", () => {
  assertEquals(
    portalUrl(VM_ID, "contoso.onmicrosoft.com", "serialConsole"),
    `https://portal.azure.com/#@contoso.onmicrosoft.com/resource${VM_ID}/serialConsole`,
  );
  assertEquals(resourceGroupOf(VM_ID), "web-rg");
});

const WEBAPPS = JSON.stringify([
  {
    availabilityState: "Normal",
    defaultHostName: "shop-api.azurewebsites.net",
    enabled: true,
    enabledHostNames: ["shop-api.azurewebsites.net", "shop-api.scm.azurewebsites.net"],
    hostNames: ["shop-api.azurewebsites.net", "api.shop.example"],
    httpsOnly: true,
    id: "/subscriptions/s/resourceGroups/shop-rg/providers/Microsoft.Web/sites/shop-api",
    kind: "app,linux,container",
    lastModifiedTimeUtc: "2026-10-27T08:00:00.000000",
    location: "West Europe",
    name: "shop-api",
    outboundIpAddresses: "20.1.1.1,20.1.1.2",
    resourceGroup: "shop-rg",
    serverFarmId: "/subscriptions/s/resourceGroups/shop-rg/providers/Microsoft.Web/serverfarms/shop-plan",
    state: "Running",
    usageState: "Normal",
  },
  {
    availabilityState: "Normal",
    defaultHostName: "legacy.azurewebsites.net",
    enabled: true,
    hostNames: ["legacy.azurewebsites.net"],
    httpsOnly: false,
    id: "/subscriptions/s/resourceGroups/old/providers/Microsoft.Web/sites/legacy",
    kind: "app",
    location: "North Europe",
    name: "legacy",
    state: "Stopped",
    usageState: "Normal",
  },
  {
    availabilityState: "Limited",
    defaultHostName: "free-tier.azurewebsites.net",
    enabled: true,
    id: "/subscriptions/s/resourceGroups/old/providers/Microsoft.Web/sites/free-tier",
    kind: "app",
    location: "North Europe",
    name: "free-tier",
    state: "Running",
    usageState: "Exceeded",
  },
]);

Deno.test("web apps: health, kind, plan, Kudu host, order", () => {
  const apps = parseWebApps(WEBAPPS);
  const [shop, legacy, free] = apps;
  assertEquals(appHealth(shop), "running");
  assertEquals(appHealth(legacy), "stopped");
  assertEquals(appHealth(free), "limited");
  assertEquals(appKind(shop), "Web app · Linux container");
  assertEquals(appKind(legacy), "Web app · Windows");
  assertEquals(shop.plan, "shop-plan");
  assertEquals(shop.scmHost, "shop-api.scm.azurewebsites.net");
  assertEquals(shop.outboundIps, ["20.1.1.1", "20.1.1.2"]);
  // az prints the UTC time without a zone.
  assertEquals(shop.modified?.toISOString(), "2026-10-27T08:00:00.000Z");
  assertEquals(sortWebApps(apps).map((a) => a.name), ["free-tier", "shop-api", "legacy"]);
  assertEquals(webappTailCommand(shop), ["az", "webapp", "log", "tail", "--ids", shop.id]);
});

Deno.test("errors: sign-in, permissions, subscription", () => {
  const login = classifyError(new Error("az exited with 1: ERROR: Please run 'az login' to setup account."));
  assertEquals(login.problem, "login");
  assertEquals(login.message, "Please run 'az login' to setup account.");
  assertEquals(
    classifyError(new Error("AADSTS700082: The refresh token has expired due to inactivity.")).problem,
    "login",
  );
  assertEquals(
    classifyError(
      new Error(
        "(AuthorizationFailed) The client 'alice@contoso.com' with object id '1' does not have authorization to perform action 'Microsoft.Compute/virtualMachines/read'",
      ),
    ).problem,
    "denied",
  );
  assertEquals(
    classifyError(new Error("The subscription of 'abc' doesn't exist in cloud 'AzureCloud'.")).problem,
    "subscription",
  );
  assertEquals(classifyError(new Error("az exited with 2: ")).problem, "other");
});

Deno.test("install hint per distribution", () => {
  assertEquals(
    installCommand(osFamily('ID=ubuntu\nID_LIKE="debian"\n')),
    "curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash",
  );
  assertEquals(installCommand(osFamily("ID=fedora\n")), "sudo dnf install azure-cli");
  assertEquals(installCommand(osFamily("ID=arch\n")), "sudo pacman -S azure-cli");
  assertEquals(installCommand(undefined), "pipx install azure-cli");
});

Deno.test("age", () => {
  const now = new Date("2026-10-28T12:00:00Z");
  assertEquals(age(new Date("2026-10-28T11:00:00Z"), now), "1h");
  assertEquals(age(new Date("2026-10-20T12:00:00Z"), now), "8d");
  assertEquals(age(undefined, now), "");
});

Deno.test("terminals match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
  };
  assertEquals(manifest.permissions.run, ["az", ...TERMINALS]);
  assertEquals(terminalArgs("gnome-terminal", ["ssh", "ops@host"]), ["--", "ssh", "ops@host"]);
  assert(holdOpen(["az", "login"])[2].startsWith("az login;"));
});
