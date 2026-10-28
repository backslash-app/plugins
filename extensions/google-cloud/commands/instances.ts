import { type Action, action, copy, exec, Icons, type Item, list, meta, open, refresh, toast } from "@backslash/api";
import {
  age,
  formatDate,
  HEALTH_COLORS,
  type Instance,
  instanceConsoleUrl,
  instanceHealth,
  instanceLogsCommand,
  parseInstances,
  serialCommand,
  sortInstances,
  sshCommand,
  statusLabel,
  zoneRegion,
} from "../lib.ts";
import { gcloud, guarded, inTerminal, type Prefs, projectActions, showProject } from "../gcp.ts";
import { shellLine } from "../terminal.ts";

const SECTIONS = { ok: "Running", busy: "Changing", off: "Stopped", failed: "Problems" };

function power(i: Instance, project: string, verb: "start" | "stop"): Action {
  return action(verb === "start" ? "Start Instance" : "Stop Instance", async () => {
    await toast(`${verb === "start" ? "Starting" : "Stopping"} ${i.name}…`);
    await exec("gcloud", ["compute", "instances", verb, i.name, `--zone=${i.zone}`, `--project=${project}`, "--async"]);
    await toast(`${verb === "start" ? "Starting" : "Stopping"} ${i.name}`, { style: "success" });
    return refresh();
  }, {
    icon: verb === "start" ? Icons.play : Icons.stop,
    destructive: verb === "stop",
    confirm: verb === "stop" ? `Stop ${i.name} in ${i.zone}?` : undefined,
    shortcut: verb === "start" ? "<Ctrl><Shift>s" : "<Ctrl><Shift>x",
    section: "Instance",
  });
}

function item(i: Instance, project: string, prefs: Prefs): Item {
  const health = instanceHealth(i.status);
  const color = HEALTH_COLORS[health];
  const running = i.status === "RUNNING";
  const labels = Object.entries(i.labels).map(([k, v]) => `${k}=${v}`);
  const actions: Action[] = [];
  if (running) actions.push(inTerminal("SSH in Terminal", sshCommand(i, project), prefs, { section: "Terminal" }));
  actions.push(
    open(instanceConsoleUrl(i, project), "Open in Console", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
    inTerminal("Logs in Terminal", instanceLogsCommand(i, project), prefs, {
      icon: Icons.text,
      shortcut: "<Ctrl>l",
      hold: true,
    }),
    ...(running
      ? [inTerminal("Follow Serial Console", serialCommand(i, project), prefs, { icon: Icons.monitor })]
      : []),
    copy(i.name, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }),
    ...(i.externalIp ? [copy(i.externalIp, "Copy External IP", { icon: Icons.globe, section: "Copy" })] : []),
    ...(i.internalIp ? [copy(i.internalIp, "Copy Internal IP", { icon: Icons.server, section: "Copy" })] : []),
    copy(shellLine(sshCommand(i, project)), "Copy SSH Command", { icon: Icons.terminal, section: "Copy" }),
    copy(instanceConsoleUrl(i, project), "Copy Console URL", { icon: Icons.link, section: "Copy" }),
  );
  if (i.status === "TERMINATED" || i.status === "STOPPED") actions.push(power(i, project, "start"));
  if (running) actions.push(power(i, project, "stop"));
  actions.push(action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }), ...projectActions());

  return {
    id: `${i.zone}/${i.name}`,
    title: i.name,
    subtitle: i.zone,
    icon: { source: Icons.server, tint: color },
    section: SECTIONS[health],
    keywords: [
      i.status,
      i.machineType,
      i.internalIp ?? "",
      i.externalIp ?? "",
      zoneRegion(i.zone),
      ...labels,
      ...i.tags,
    ],
    accessories: [
      ...(i.spot ? [{ tag: "Spot", color: "purple" as const }] : []),
      ...(i.externalIp ? [{ icon: Icons.globe, text: i.externalIp, tooltip: "External IP" }] : []),
      { text: i.machineType, tooltip: "Machine type" },
      { tag: statusLabel(i.status), color },
    ],
    detail: {
      stats: [
        { label: "status", value: statusLabel(i.status), color },
        { label: "type", value: i.machineType },
        { label: "age", value: age(i.created) || "—" },
      ],
      metadata: [
        meta.text("Zone", i.zone, { icon: Icons.pin }),
        ...(i.externalIp ? [meta.text("External IP", i.externalIp, { icon: Icons.globe })] : []),
        ...(i.internalIp ? [meta.text("Internal IP", i.internalIp, { icon: Icons.server })] : []),
        ...(i.network ? [meta.text("Network", i.network, { icon: Icons.layers })] : []),
        ...(i.os ? [meta.text("Image", i.os, { icon: Icons.box })] : []),
        ...(i.cpuPlatform ? [meta.text("CPU", i.cpuPlatform, { icon: Icons.cpu })] : []),
        ...(i.spot ? [meta.text("Provisioning", "Spot", { icon: Icons.bolt, color: "purple" })] : []),
        ...(labels.length ? [meta.tags("Labels", labels)] : []),
        ...(i.tags.length ? [meta.tags("Network tags", i.tags)] : []),
        meta.separator(),
        ...(i.created ? [meta.text("Created", formatDate(i.created), { icon: Icons.calendar })] : []),
        meta.text("Project", project, { icon: Icons.project }),
      ],
    },
    actions,
  };
}

let summary = "";

export default list({
  placeholder: "Filter instances by name, zone, IP, label…",
  filter: {
    options: [
      { value: "running", title: "Running" },
      { value: "stopped", title: "Stopped" },
      { value: "all", title: "All" },
    ],
    default: "all",
  },
  empty: { title: "No instances", description: "No Compute Engine VM matches in this project", icon: Icons.server },
  status: () => summary,
  actions: projectActions(),
  items: ({ preferences, signal, filter }) => {
    const prefs = preferences as Prefs;
    summary = "";
    return guarded(prefs, signal, async (c) => {
      const all = parseInstances(await gcloud(["compute", "instances", "list", `--project=${c.project}`], signal));
      const running = all.filter((i) => i.status === "RUNNING").length;
      summary = `${c.project} · ${all.length} instance${all.length === 1 ? "" : "s"} · ${running} running`;
      await showProject(c, `${running} running`);
      const shown = all.filter((i) =>
        filter === "running" ? i.status === "RUNNING" : filter === "stopped" ? instanceHealth(i.status) === "off" : true
      );
      return sortInstances(shown).map((i) => item(i, c.project, prefs));
    });
  },
});
