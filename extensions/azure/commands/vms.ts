import { type Action, action, copy, Icons, type Item, list, meta, open, refresh } from "@backslash/api";
import { az, guarded, inTerminal, type Prefs, runOperation, showSubscription, subscriptionActions } from "../az.ts";
import {
  age,
  capitalize,
  filterVms,
  formatDate,
  parseVms,
  portalUrl,
  POWER_COLORS,
  sortVms,
  sshCommand,
  type Subscription,
  type Vm,
  type VmFilter,
} from "../lib.ts";
import { shellLine } from "../terminal.ts";

function powerActions(vm: Vm): Action[] {
  const ids = ["--ids", vm.id, "--no-wait"];
  const actions: Action[] = [];
  if (["stopped", "deallocated"].includes(vm.power)) {
    actions.push(action("Start VM", () => runOperation(["vm", "start", ...ids], `Starting ${vm.name}`), {
      icon: Icons.play,
      shortcut: "<Ctrl><Shift>s",
      section: "Power",
    }));
  }
  if (vm.power === "running") {
    actions.push(
      action("Restart VM", () => runOperation(["vm", "restart", ...ids], `Restarting ${vm.name}`), {
        icon: Icons.refresh,
        destructive: true,
        confirm: `Restart ${vm.name}? Its sessions are cut.`,
        section: "Power",
      }),
    );
  }
  if (vm.power === "running" || vm.power === "stopped") {
    actions.push(
      action("Stop and Deallocate VM", () => runOperation(["vm", "deallocate", ...ids], `Deallocating ${vm.name}`), {
        icon: Icons.stop,
        destructive: true,
        confirm:
          `Deallocate ${vm.name}? It stops and its compute is no longer billed; a dynamic public IP is released.`,
        shortcut: "<Ctrl><Shift>x",
        section: "Power",
      }),
    );
  }
  if (vm.power === "running") {
    actions.push(
      action("Power Off VM (Still Billed)", () => runOperation(["vm", "stop", ...ids], `Powering off ${vm.name}`), {
        icon: Icons.power,
        destructive: true,
        confirm: `Power off ${vm.name}? It keeps its resources and its compute stays billed.`,
        section: "Power",
      }),
    );
  }
  return actions;
}

function item(vm: Vm, sub: Subscription, prefs: Prefs): Item {
  const color = POWER_COLORS[vm.power];
  const ssh = sshCommand(vm, prefs.sshUser);
  const tenant = sub.tenantDomain ?? sub.tenantId;
  const actions: Action[] = [];
  if (ssh && vm.power === "running") actions.push(inTerminal("SSH in Terminal", ssh, prefs));
  actions.push(open(portalUrl(vm.id, tenant), "Open in Azure Portal", { icon: Icons.globe, shortcut: "<Ctrl>o" }));
  actions.push(
    ...(vm.publicIps[0]
      ? [copy(vm.publicIps[0], "Copy Public IP", { icon: Icons.globe, shortcut: "<Ctrl>period", section: "Copy" })]
      : []),
    ...(vm.privateIps[0] ? [copy(vm.privateIps[0], "Copy Private IP", { icon: Icons.server, section: "Copy" })] : []),
    ...(vm.fqdns[0] ? [copy(vm.fqdns[0], "Copy DNS Name", { icon: Icons.link, section: "Copy" })] : []),
    ...(ssh ? [copy(shellLine(ssh), "Copy SSH Command", { icon: Icons.terminal, section: "Copy" })] : []),
    copy(vm.id, "Copy Resource ID", { icon: Icons.hash, section: "Copy" }),
    ...powerActions(vm),
    open(portalUrl(vm.id, tenant, "serialConsole"), "Open Serial Console", { icon: Icons.terminal, section: "Portal" }),
    open(portalUrl(vm.id, tenant, "metrics"), "Open Metrics", { icon: Icons.activity, section: "Portal" }),
    action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ...subscriptionActions(),
  );

  const tags = Object.entries(vm.tags).slice(0, 8);
  return {
    id: vm.id,
    title: vm.name,
    subtitle: vm.resourceGroup,
    icon: { source: Icons.server, tint: color },
    section: capitalize(vm.power === "unknown" ? "Other" : vm.power),
    keywords: [
      vm.location,
      vm.size ?? "",
      vm.os ?? "",
      ...vm.publicIps,
      ...vm.privateIps,
      ...vm.fqdns,
      ...Object.values(vm.tags),
    ],
    accessories: [
      ...(vm.publicIps[0] ? [{ icon: Icons.globe, text: vm.publicIps[0], tooltip: "Public IP" }] : []),
      ...(vm.size ? [{ text: vm.size.replace(/^Standard_/, ""), tooltip: vm.size }] : []),
      { text: vm.location, tooltip: "Region" },
      { tag: capitalize(vm.power), color },
    ],
    detail: {
      stats: [
        { label: "power", value: capitalize(vm.power), color },
        { label: "size", value: vm.size?.replace(/^Standard_/, "") ?? "—" },
        { label: "os", value: vm.os ?? "—" },
      ],
      metadata: [
        ...(vm.publicIps.length ? [meta.tags("Public IP", vm.publicIps)] : []),
        ...(vm.privateIps.length ? [meta.tags("Private IP", vm.privateIps)] : []),
        ...(vm.fqdns.length ? [meta.text("DNS name", vm.fqdns.join(", "), { icon: Icons.link })] : []),
        ...(vm.adminUser ? [meta.text("Admin user", vm.adminUser, { icon: Icons.person })] : []),
        ...(vm.computerName && vm.computerName !== vm.name ? [meta.text("Computer name", vm.computerName)] : []),
        ...(vm.image ? [meta.text("Image", vm.image, { icon: Icons.layers })] : []),
        ...(vm.priority ? [meta.text("Priority", vm.priority, { icon: Icons.coin })] : []),
        meta.separator(),
        meta.text("Resource group", vm.resourceGroup, { icon: Icons.folder }),
        meta.text("Region", vm.zones.length ? `${vm.location} · zone ${vm.zones.join(", ")}` : vm.location, {
          icon: Icons.pin,
        }),
        ...(vm.provisioning && vm.provisioning !== "Succeeded"
          ? [meta.text("Provisioning", vm.provisioning, { icon: Icons.info, color: "orange" })]
          : []),
        ...(vm.created
          ? [meta.text("Created", `${formatDate(vm.created)} (${age(vm.created)})`, { icon: Icons.calendar })]
          : []),
        ...(tags.length ? [meta.tags("Tags", tags.map(([k, v]) => v ? `${k}=${v}` : k))] : []),
        meta.text("Subscription", sub.name, { icon: Icons.key }),
      ],
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter VMs by name, resource group, IP, size, tag…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "running", title: "Running" },
      { value: "stopped", title: "Stopped" },
    ],
    default: "all",
  },
  empty: {
    title: "No virtual machines",
    description: "None here: switch subscription with Ctrl+Shift+P",
    icon: Icons.server,
  },
  status: () => summary,
  actions: subscriptionActions(),
  items: ({ preferences, filter, signal }) => {
    const prefs = preferences as Prefs;
    summary = "";
    return guarded(prefs, signal, async (sub) => {
      const vms = parseVms(await az(["vm", "list", "--show-details"], signal));
      const running = vms.filter((v) => v.power === "running").length;
      summary = `${sub.name} · ${vms.length} VM${vms.length === 1 ? "" : "s"} · ${running} running`;
      await showSubscription(sub, `${running} running`);
      return sortVms(filterVms(vms, (filter ?? "all") as VmFilter)).map((vm) => item(vm, sub, prefs));
    });
  },
});
