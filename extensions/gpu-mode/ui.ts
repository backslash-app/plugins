// Rows of the GPU Mode list: the modes, the GPUs and what runs on the discrete one.

import { type Action, action, copy, Icons, type Item, meta, type Metadata, open, toast } from "@backslash/api";
import {
  envPrefix,
  type Gpu,
  type GpuProcess,
  INSTALL_HINTS,
  type Mode,
  needsText,
  type NvidiaGpu,
  shellLine,
  switchCommand,
  TOOL_NAMES,
  VENDOR_COLOR,
} from "./lib.ts";
import { logOut, type ModeState, type Pending, reboot, stopProcess, switchMode } from "./system.ts";

export const changes = new EventTarget();
export const changed = () => changes.dispatchEvent(new Event("change"));

function finishActions(p: Pending): Action[] {
  return p.needs === "reboot"
    ? [action("Restart Now", reboot, {
      icon: Icons.power,
      destructive: true,
      confirm: "Restart the computer now? Unsaved work in open apps is lost",
    })]
    : [action("Log Out Now", logOut, {
      icon: Icons.power,
      destructive: true,
      confirm: "Log out now? Unsaved work in open apps is lost",
    })];
}

export function pendingItem(p: Pending, state: ModeState): Item {
  const mode = state.modes.find((m) => m.id === p.mode);
  return {
    id: "pending",
    title: `${needsText(p.needs)} to ${mode?.title ?? p.mode}`,
    subtitle: p.needs === "reboot" ? "The new mode is used after a restart" : "The new mode is used at the next login",
    icon: { source: Icons.alert, tint: "orange" },
    section: "Mode",
    accessories: [{ tag: p.needs === "reboot" ? "Restart" : "Log out", color: "orange" }],
    detail: {
      markdown: `The graphics mode was switched to **${mode?.title ?? p.mode}** with ${
        TOOL_NAMES[p.tool]
      }. Save your work, then ${p.needs === "reboot" ? "restart" : "log out and back in"}.`,
    },
    actions: finishActions(p),
  };
}

export function modeItem(m: Mode, state: ModeState, pending?: Pending): Item {
  const tool = state.tool!;
  const active = state.current?.toLowerCase() === m.id.toLowerCase();
  const target = pending?.mode === m.id;
  const { argv, root } = switchCommand(tool, m.id);
  const command = root ? `sudo ${shellLine(argv)}` : shellLine(argv);
  const tint = active ? "green" : target ? "orange" : "gray";
  const after = m.needs === "reboot" ? "You'll need to restart" : m.needs === "logout" ? "You'll need to log out" : "";
  return {
    id: `mode:${m.id}`,
    title: m.title,
    subtitle: m.description,
    icon: { source: active ? Icons.done : target ? Icons.inProgress : Icons.todo, tint },
    section: "Mode",
    keywords: ["mode", m.id, tool],
    accessories: [
      ...(m.needs !== "none" && !active
        ? [{ text: m.needs === "reboot" ? "Restart" : "Log out", icon: Icons.power }]
        : []),
      ...(active
        ? [{ tag: "Current", color: "green" as const }]
        : target
        ? [{ tag: "Pending", color: "orange" as const }]
        : []),
    ],
    detail: {
      metadata: [
        meta.text("Mode", m.title, { icon: Icons.cpu }),
        meta.text("State", active ? "Current" : target ? "Waiting for a restart or log out" : "Available", {
          color: tint === "gray" ? undefined : tint,
        }),
        meta.text(
          "Takes effect",
          m.needs === "reboot" ? "After a restart" : m.needs === "logout" ? "After logging out" : "Right away",
          {
            icon: Icons.power,
          },
        ),
        meta.text("Switched by", TOOL_NAMES[tool], { icon: Icons.settings }),
        meta.text("Command", command, { icon: Icons.terminal }),
      ],
      markdown: root ? "Switching asks for your password." : undefined,
    },
    actions: active ? [copy(command, "Copy Command", { section: "Copy" })] : [
      action(`Switch to ${m.title}`, async () => {
        await toast(`Switching to ${m.title}…`);
        const needs = await switchMode(tool, m);
        await toast(`Switched to ${m.title}`, {
          style: "success",
          message: needs === "none" ? undefined : `${needsText(needs)}`,
        });
        changed();
      }, {
        icon: Icons.cycle,
        confirm: `Switch to ${m.title}?${after ? ` ${after} before it is used` : ""}`,
      }),
      copy(command, "Copy Command", { section: "Copy" }),
    ],
  };
}

export function noToolItem(gpus: Gpu[]): Item {
  const hybrid = gpus.length > 1;
  return {
    id: "no-tool",
    title: hybrid ? "No GPU switcher installed" : "One GPU: nothing to switch",
    subtitle: hybrid ? "Install supergfxctl, EnvyControl, nvidia-prime or system76-power" : gpus[0]?.name ?? "",
    icon: { source: Icons.info, tint: hybrid ? "orange" : "gray" },
    section: "Mode",
    detail: {
      markdown: hybrid
        ? [
          "This computer has two GPUs, but no tool to switch between them was found. Pick the one for your laptop:",
          "",
          ...INSTALL_HINTS.map((h) => `- **${h.title}**: ${h.text}`),
          "",
          "Apps can still run on the discrete GPU without switching: use **Run on Discrete GPU**.",
        ].join("\n")
        : "Hybrid graphics modes are for laptops with an integrated and a discrete GPU.",
    },
    actions: hybrid ? INSTALL_HINTS.map((h) => open(h.url, `${h.title} Website`, { icon: Icons.globe })) : [],
  };
}

export function gpuItem(g: Gpu, offload: Record<string, string>, power?: string, smi?: NvidiaGpu): Item {
  const role = g.discrete === undefined ? "GPU" : g.discrete ? "Discrete" : "Integrated";
  const tint = VENDOR_COLOR[g.vendor] ?? "gray";
  const metadata: Metadata[] = [
    meta.text("Vendor", g.vendor, { icon: Icons.cpu }),
    meta.text("Role", role, { icon: Icons.layers }),
    meta.text("Driver", g.driver ?? "None loaded", { icon: Icons.package, color: g.driver ? undefined : "orange" }),
    meta.text("PCI address", g.slot, { icon: Icons.hash }),
    meta.text("PCI id", `${g.vendorId}:${g.deviceId}`, { icon: Icons.tag }),
  ];
  if (g.subsystem) metadata.push(meta.text("Made for", g.subsystem, { icon: Icons.box }));
  if (g.discrete && power) metadata.push(meta.text("Power", power, { icon: Icons.power }));
  if (smi) {
    metadata.push(meta.separator(), meta.text("Driver version", smi.driver, { icon: Icons.package }));
    if (smi.memoryUsed !== undefined && smi.memoryTotal) {
      metadata.push(
        meta.progress("Video memory", smi.memoryUsed / smi.memoryTotal, `${smi.memoryUsed} / ${smi.memoryTotal} MiB`),
      );
    }
    if (smi.pstate) metadata.push(meta.text("Performance state", smi.pstate, { icon: Icons.activity }));
  }
  const accessories = [];
  if (smi?.utilization !== undefined) accessories.push({ text: `${smi.utilization}%`, icon: Icons.activity });
  if (smi?.temperature !== undefined) accessories.push({ text: `${smi.temperature} °C`, icon: Icons.thermometer });
  if (g.discrete && power) accessories.push({ text: power, icon: Icons.power });
  accessories.push({ tag: role, color: g.discrete ? "purple" as const : "blue" as const });
  return {
    id: `gpu:${g.slot}`,
    title: `${g.vendor} ${g.name}`,
    subtitle: g.driver ? `Driver ${g.driver}` : "No driver loaded",
    icon: { source: Icons.monitor, tint },
    section: "GPUs",
    keywords: [g.vendor, g.driver ?? "", role, g.slot],
    accessories,
    detail: {
      stats: smi
        ? [
          ...(smi.utilization !== undefined ? [{ label: "Load", value: `${smi.utilization}%` }] : []),
          ...(smi.temperature !== undefined ? [{ label: "Temperature", value: `${smi.temperature} °C` }] : []),
          ...(smi.power !== undefined ? [{ label: "Power", value: `${smi.power.toFixed(1)} W` }] : []),
        ]
        : undefined,
      metadata,
    },
    actions: [
      copy(g.name, "Copy Name"),
      ...(g.discrete
        ? [copy(envPrefix(offload), "Copy Offload Variables", { section: "Copy", icon: Icons.terminal })]
        : []),
      copy(g.slot, "Copy PCI Address", { section: "Copy" }),
    ],
  };
}

export function processItem(p: GpuProcess): Item {
  return {
    id: `proc:${p.pid}`,
    title: p.command,
    subtitle: `PID ${p.pid}${p.user ? ` · ${p.user}` : ""}`,
    icon: { source: Icons.apps, tint: "purple" },
    section: "Using the Discrete GPU",
    keywords: [String(p.pid), p.user ?? "", "process"],
    accessories: [...(p.memory !== undefined ? [{ text: `${p.memory} MiB` }] : []), {
      text: p.devices.map((d) => d.split("/").pop()).join(", "),
    }],
    detail: {
      metadata: [
        meta.text("Process", p.command, { icon: Icons.apps }),
        meta.text("PID", p.pid, { icon: Icons.hash }),
        ...(p.user ? [meta.text("User", p.user, { icon: Icons.person })] : []),
        ...(p.memory !== undefined ? [meta.text("Video memory", `${p.memory} MiB`, { icon: Icons.database })] : []),
        meta.tags("Holds", p.devices),
      ],
      markdown:
        "Switching to **Integrated** needs these processes closed: the discrete GPU can't be turned off while " +
        "they use it.",
    },
    actions: [
      action("Stop Process", async () => {
        await stopProcess(p.pid);
        await toast(`${p.command} stopped`, { style: "success" });
        changed();
      }, {
        icon: Icons.stop,
        destructive: true,
        confirm: `Stop ${p.command} (${p.pid})? Unsaved work in it is lost`,
        shortcut: "<Ctrl>Delete",
      }),
      copy(String(p.pid), "Copy PID", { section: "Copy" }),
    ],
  };
}
