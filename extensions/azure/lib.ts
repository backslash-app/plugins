// Parsing the az CLI's JSON output, sorting and formatting, error classification.

import type { Color } from "@backslash/api";

// --- Subscriptions ------------------------------------------------------------------------

export interface Subscription {
  id: string;
  name: string;
  state: string;
  isDefault: boolean;
  tenantId: string;
  tenantName?: string;
  tenantDomain?: string;
  user?: string;
  userType?: string;
  cloud: string;
}

interface RawSubscription {
  id?: string;
  name?: string;
  state?: string;
  isDefault?: boolean;
  tenantId?: string;
  homeTenantId?: string;
  tenantDisplayName?: string;
  tenantDefaultDomain?: string;
  cloudName?: string;
  user?: { name?: string; type?: string };
}

function toSubscription(r: RawSubscription): Subscription {
  return {
    id: r.id ?? "",
    name: r.name ?? r.id ?? "",
    state: r.state ?? "Enabled",
    isDefault: r.isDefault === true,
    tenantId: r.tenantId ?? r.homeTenantId ?? "",
    tenantName: r.tenantDisplayName || undefined,
    tenantDomain: r.tenantDefaultDomain || undefined,
    user: r.user?.name || undefined,
    userType: r.user?.type || undefined,
    cloud: r.cloudName ?? "AzureCloud",
  };
}

/** `az account list`: the current one first, then enabled before disabled, by name. */
export function parseSubscriptions(json: string): Subscription[] {
  const raw = JSON.parse(json || "[]") as RawSubscription[];
  const rank = (s: Subscription) => s.isDefault ? 0 : s.state === "Enabled" ? 1 : 2;
  return raw.filter((r) => r.id).map(toSubscription).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** `az account show`. */
export const parseAccount = (json: string): Subscription => toSubscription(JSON.parse(json) as RawSubscription);

export const SUBSCRIPTION_COLORS: Record<string, Color> = {
  Enabled: "green",
  Warned: "yellow",
  PastDue: "orange",
  Disabled: "gray",
  Deleted: "red",
};

// --- Virtual machines ---------------------------------------------------------------------

export type PowerState = "running" | "starting" | "stopping" | "stopped" | "deallocating" | "deallocated" | "unknown";

export interface Vm {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  power: PowerState;
  size?: string;
  os?: string;
  image?: string;
  adminUser?: string;
  computerName?: string;
  publicIps: string[];
  privateIps: string[];
  fqdns: string[];
  zones: string[];
  provisioning?: string;
  created?: Date;
  tags: Record<string, string>;
  priority?: string;
}

interface RawVm {
  id?: string;
  name?: string;
  resourceGroup?: string;
  location?: string;
  powerState?: string | null;
  publicIps?: string | null;
  privateIps?: string | null;
  fqdns?: string | null;
  provisioningState?: string;
  timeCreated?: string;
  zones?: string[] | null;
  tags?: Record<string, string> | null;
  priority?: string | null;
  hardwareProfile?: { vmSize?: string };
  osProfile?: { adminUsername?: string; computerName?: string } | null;
  storageProfile?: {
    osDisk?: { osType?: string };
    imageReference?: { publisher?: string; offer?: string; sku?: string; version?: string; id?: string } | null;
  };
}

/** "VM running" → "running"; anything unknown → "unknown". */
export function powerState(text: string | null | undefined): PowerState {
  const s = String(text ?? "").toLowerCase().replace(/^vm\s+/, "").trim();
  const known: PowerState[] = ["running", "starting", "stopping", "stopped", "deallocating", "deallocated"];
  return (known as string[]).includes(s) ? s as PowerState : "unknown";
}

/** "20.1.2.3,20.1.2.4" → ["20.1.2.3", "20.1.2.4"]. */
export const splitList = (text: string | null | undefined) =>
  String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/** The resource group from an ARM id (az sometimes upper-cases the field). */
export function resourceGroupOf(id: string): string | undefined {
  return /\/resourceGroups\/([^/]+)/i.exec(id)?.[1];
}

/** `az vm list --show-details`. */
export function parseVms(json: string): Vm[] {
  const raw = JSON.parse(json || "[]") as RawVm[];
  return raw.filter((r) => r.id && r.name).map((r) => {
    const img = r.storageProfile?.imageReference;
    const image = img?.offer
      ? [img.publisher, img.offer, img.sku].filter(Boolean).join(" · ")
      : img?.id
      ? img.id.split("/").pop()
      : undefined;
    const created = r.timeCreated ? new Date(r.timeCreated) : undefined;
    return {
      id: r.id!,
      name: r.name!,
      resourceGroup: resourceGroupOf(r.id!) ?? r.resourceGroup ?? "",
      location: r.location ?? "",
      power: powerState(r.powerState),
      size: r.hardwareProfile?.vmSize,
      os: r.storageProfile?.osDisk?.osType,
      image,
      adminUser: r.osProfile?.adminUsername || undefined,
      computerName: r.osProfile?.computerName || undefined,
      publicIps: splitList(r.publicIps),
      privateIps: splitList(r.privateIps),
      fqdns: splitList(r.fqdns),
      zones: r.zones ?? [],
      provisioning: r.provisioningState,
      created: created && !isNaN(created.getTime()) ? created : undefined,
      tags: r.tags ?? {},
      priority: r.priority && r.priority !== "Regular" ? r.priority : undefined,
    };
  });
}

export const POWER_COLORS: Record<PowerState, Color> = {
  running: "green",
  starting: "yellow",
  stopping: "yellow",
  deallocating: "yellow",
  stopped: "orange",
  deallocated: "gray",
  unknown: "gray",
};

const POWER_ORDER: PowerState[] = [
  "running",
  "starting",
  "stopping",
  "deallocating",
  "stopped",
  "deallocated",
  "unknown",
];

/** Running first, then the transitions, then stopped ones; by name. */
export function sortVms(vms: Vm[]): Vm[] {
  return [...vms].sort((a, b) =>
    POWER_ORDER.indexOf(a.power) - POWER_ORDER.indexOf(b.power) || a.name.localeCompare(b.name)
  );
}

export type VmFilter = "running" | "stopped" | "all";

export function filterVms(vms: Vm[], filter: VmFilter): Vm[] {
  if (filter === "running") return vms.filter((v) => ["running", "starting"].includes(v.power));
  if (filter === "stopped") return vms.filter((v) => !["running", "starting"].includes(v.power));
  return vms;
}

/** The address SSH should use: the DNS name, else the first public IP. */
export const sshHost = (vm: Vm) => vm.fqdns[0] ?? vm.publicIps[0];

/** `ssh user@host`, the user from the preference or the VM's admin user. */
export function sshCommand(vm: Vm, user?: string): string[] | undefined {
  const host = sshHost(vm);
  if (!host) return undefined;
  const login = user?.trim() || vm.adminUser;
  return ["ssh", login ? `${login}@${host}` : host];
}

// --- Web apps -----------------------------------------------------------------------------

export interface WebApp {
  id: string;
  name: string;
  resourceGroup: string;
  location: string;
  state: string;
  hostname?: string;
  hostnames: string[];
  scmHost?: string;
  kind: string;
  linux: boolean;
  container: boolean;
  httpsOnly: boolean;
  usage?: string;
  availability?: string;
  plan?: string;
  modified?: Date;
  outboundIps: string[];
  enabled: boolean;
}

interface RawWebApp {
  id?: string;
  name?: string;
  resourceGroup?: string;
  location?: string;
  state?: string;
  defaultHostName?: string;
  hostNames?: string[];
  enabledHostNames?: string[];
  kind?: string;
  httpsOnly?: boolean;
  usageState?: string;
  availabilityState?: string;
  serverFarmId?: string;
  appServicePlanId?: string;
  lastModifiedTimeUtc?: string;
  outboundIpAddresses?: string;
  enabled?: boolean;
}

/** `az webapp list`. */
export function parseWebApps(json: string): WebApp[] {
  const raw = JSON.parse(json || "[]") as RawWebApp[];
  return raw.filter((r) => r.id && r.name).map((r) => {
    const kind = (r.kind ?? "app").toLowerCase();
    const modified = r.lastModifiedTimeUtc
      ? new Date(/Z|[+-]\d\d:?\d\d$/.test(r.lastModifiedTimeUtc) ? r.lastModifiedTimeUtc : `${r.lastModifiedTimeUtc}Z`)
      : undefined;
    const plan = r.serverFarmId ?? r.appServicePlanId;
    return {
      id: r.id!,
      name: r.name!,
      resourceGroup: resourceGroupOf(r.id!) ?? r.resourceGroup ?? "",
      location: r.location ?? "",
      state: r.state ?? "Unknown",
      hostname: r.defaultHostName || undefined,
      hostnames: r.hostNames ?? [],
      scmHost: (r.enabledHostNames ?? []).find((h) => h.includes(".scm.")),
      kind,
      linux: kind.includes("linux"),
      container: kind.includes("container"),
      httpsOnly: r.httpsOnly === true,
      usage: r.usageState,
      availability: r.availabilityState,
      plan: plan ? plan.split("/").pop() : undefined,
      modified: modified && !isNaN(modified.getTime()) ? modified : undefined,
      outboundIps: splitList(r.outboundIpAddresses),
      enabled: r.enabled !== false,
    };
  });
}

export type AppHealth = "running" | "stopped" | "limited";

export function appHealth(a: WebApp): AppHealth {
  if (a.state.toLowerCase() !== "running" || !a.enabled) return "stopped";
  if ((a.availability && a.availability !== "Normal") || (a.usage && a.usage !== "Normal")) return "limited";
  return "running";
}

export const APP_COLORS: Record<AppHealth, Color> = { running: "green", limited: "orange", stopped: "gray" };
export const APP_LABELS: Record<AppHealth, string> = { running: "Running", limited: "Limited", stopped: "Stopped" };

/** Limited first (they need attention), then running, then stopped; by name. */
export function sortWebApps(apps: WebApp[]): WebApp[] {
  const order: AppHealth[] = ["limited", "running", "stopped"];
  return [...apps].sort((a, b) =>
    order.indexOf(appHealth(a)) - order.indexOf(appHealth(b)) || a.name.localeCompare(b.name)
  );
}

/** "app,linux,container" → "Linux container". */
export function appKind(a: WebApp): string {
  const what = a.kind.includes("functionapp") ? "Function app" : "Web app";
  return `${what} · ${a.linux ? "Linux" : "Windows"}${a.container ? " container" : ""}`;
}

/** Streams the app's log (`az webapp log tail`), in a terminal. */
export const webappTailCommand = (a: WebApp) => ["az", "webapp", "log", "tail", "--ids", a.id];

export const appUrl = (a: WebApp) => a.hostname ? `https://${a.hostname}` : undefined;

// --- Portal -------------------------------------------------------------------------------

/** A resource page of the Azure portal, in the right tenant. */
export function portalUrl(resourceId: string, tenant?: string, blade = "overview"): string {
  return `https://portal.azure.com/#@${tenant ?? ""}/resource${resourceId}/${blade}`;
}

export const subscriptionPortalUrl = (s: Subscription) =>
  portalUrl(`/subscriptions/${s.id}`, s.tenantDomain ?? s.tenantId);

// --- Errors -------------------------------------------------------------------------------

export type Problem = "login" | "subscription" | "denied" | "network" | "extension" | "other";

export interface Classified {
  problem: Problem;
  title: string;
  message: string;
}

export function classifyError(err: unknown): Classified {
  const message = (err instanceof Error ? err.message : String(err)).replace(/^az exited with \d+: /, "")
    .replace(/^ERROR: /gm, "").trim();
  const is = (re: RegExp) => re.test(message);
  if (
    is(
      /az login|AADSTS\d+|refresh token has expired|Interactive authentication is needed|re-?authenticate|No subscriptions found|User .* does not exist in MSAL token cache/i,
    )
  ) {
    return { problem: "login", title: "Sign in to Azure", message };
  }
  if (is(/subscription .* (doesn't|does not) exist|SubscriptionNotFound|InvalidSubscriptionId/i)) {
    return { problem: "subscription", title: "Subscription not found", message };
  }
  if (is(/AuthorizationFailed|does not have authorization|LinkedAuthorizationFailed|Forbidden/i)) {
    return { problem: "denied", title: "Permission denied", message };
  }
  if (is(/is not installed|extension .* not found|az extension add/i)) {
    return { problem: "extension", title: "An az extension is missing", message };
  }
  if (
    is(
      /Failed to establish a new connection|Max retries exceeded|Connection aborted|timed out|Name or service not known/i,
    )
  ) {
    return { problem: "network", title: "Cannot reach Azure", message };
  }
  return { problem: "other", title: "az failed", message: message || "az failed without a message" };
}

// --- Formatting ---------------------------------------------------------------------------

export function age(date: Date | undefined, now = new Date()): string {
  if (!date || isNaN(date.getTime())) return "";
  const s = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export const formatDate = (d?: Date) =>
  d && !isNaN(d.getTime()) ? d.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "";

export const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

// --- Installing the CLI -------------------------------------------------------------------

export type Family = "debian" | "fedora" | "arch" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

export function installCommand(family: Family | undefined): string {
  switch (family) {
    case "debian":
      return "curl -sL https://aka.ms/InstallAzureCLIDeb | sudo bash";
    case "arch":
      return "sudo pacman -S azure-cli";
    case "fedora":
      return "sudo dnf install azure-cli";
    case "suse":
      return "sudo zypper install azure-cli";
    default:
      return "pipx install azure-cli";
  }
}
