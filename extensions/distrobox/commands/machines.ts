import {
  type Action,
  action,
  close,
  copy,
  exec,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  refresh,
  toast,
} from "@backslash/api";
import {
  type Container,
  enterCommand,
  memory,
  mergeContainers,
  parseDistrobox,
  parseDomInfo,
  parseToolbox,
  parseVirshList,
  removeCommand,
  scope,
  shortStatus,
  STATE_COLORS,
  STATE_TITLES,
  stopCommand,
  virsh,
  type Vm,
  vmState,
} from "../lib.ts";
import { launch, runInTerminal, shellLine } from "../terminal.ts";

interface Prefs {
  terminal?: string;
}

const URIS = ["qemu:///session", "qemu:///system"];

/** Output of a program, or undefined when it is missing or fails. */
async function tryExec(program: string, args: string[]): Promise<string | undefined> {
  try {
    return await exec(program, args);
  } catch {
    return undefined;
  }
}

interface Found {
  containers: Container[];
  vms: Vm[];
  backends: string[];
}

async function load(): Promise<Found> {
  const [db, tb, ...virshes] = await Promise.all([
    tryExec("distrobox", ["list", "--no-color"]),
    tryExec("toolbox", ["list", "--containers"]),
    ...URIS.map((uri) => tryExec("virsh", ["-c", uri, "list", "--all"])),
  ]);
  const backends = [
    ...(db !== undefined ? ["distrobox"] : []),
    ...(tb !== undefined ? ["toolbx"] : []),
    ...(virshes.some((v) => v !== undefined) ? ["libvirt"] : []),
  ];
  return {
    containers: mergeContainers(parseDistrobox(db ?? ""), parseToolbox(tb ?? "")),
    vms: URIS.flatMap((uri, i) => parseVirshList(virshes[i] ?? "", uri)),
    backends,
  };
}

function containerItem(c: Container, prefs: Prefs): Item {
  const term = prefs.terminal || undefined;
  const name = c.kind === "distrobox" ? "Distrobox" : "Toolbx";
  const run = (argv: string[], done: string) => async () => {
    await exec(argv[0], argv.slice(1));
    await toast(done, { style: "success" });
    return refresh();
  };
  const enter = enterCommand(c);
  const actions: Action[] = [
    action("Enter in Terminal", () => {
      runInTerminal(enter, term);
      return close();
    }, { icon: Icons.terminal }),
  ];
  if (c.running) {
    actions.push(action("Stop", run(stopCommand(c), `${c.name} stopped`), {
      icon: Icons.stop,
      shortcut: "<Ctrl>s",
      section: "Container",
    }));
  }
  if (c.kind === "distrobox") {
    actions.push(action("Upgrade Packages in Terminal", () => {
      runInTerminal(["distrobox", "upgrade", c.name], term);
      return close();
    }, { icon: Icons.download, shortcut: "<Ctrl>u", section: "Container" }));
  }
  actions.push(
    copy(shellLine(enter), "Copy Enter Command", { icon: Icons.terminal, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(c.name, "Copy Name", { section: "Copy" }),
    copy(c.image, "Copy Image", { icon: Icons.package, section: "Copy" }),
    action("Remove Container", run(removeCommand(c), `${c.name} removed`), {
      icon: Icons.trash,
      destructive: true,
      confirm: `Remove ${c.name}? Files outside your home folder are lost.`,
      section: "Danger",
    }),
  );
  const status = shortStatus(c.status);
  return {
    id: `${c.kind}:${c.name}`,
    title: c.name,
    subtitle: c.image.replace(/^(docker\.io|registry\.fedoraproject\.org|quay\.io|ghcr\.io)\//, ""),
    icon: { source: Icons.box, tint: c.running ? "green" : "gray" },
    section: name,
    keywords: [c.image, c.kind, c.id],
    accessories: [{ tag: c.running ? "Running" : "Stopped", color: c.running ? "green" : "gray" }, { text: status }],
    detail: {
      markdown: `\`\`\`sh\n${shellLine(enter)}\n\`\`\``,
      metadata: [
        meta.text("Status", status, { icon: Icons.dot, color: c.running ? "green" : "gray" }),
        meta.text("Image", c.image, { icon: Icons.package }),
        meta.text("Tool", name, { icon: Icons.box }),
        ...(c.created ? [meta.text("Created", c.created, { icon: Icons.calendar })] : []),
        meta.separator(),
        meta.text("ID", c.id.slice(0, 12)),
      ],
    },
    actions,
  };
}

function vmItem(vm: Vm, prefs: Prefs, info?: Record<string, string>): Item {
  const state = vmState(vm.state);
  const color = STATE_COLORS[state];
  const on = state === "running" || state === "paused";
  const run = (verb: string, done: string) => async () => {
    await exec("virsh", virsh(vm, verb).slice(1));
    await toast(done, { style: "success" });
    return refresh();
  };
  const actions: Action[] = [];
  const openConsole = action("Open Console", () => {
    if (
      !launch("virt-manager", ["--connect", vm.uri, "--show-domain-console", vm.name]) &&
      !launch("virt-viewer", ["--connect", vm.uri, "--wait", vm.name])
    ) {
      throw new Error("Install virt-manager or virt-viewer to open the console");
    }
    return close();
  }, { icon: Icons.monitor });
  if (state === "off" || state === "crashed") {
    actions.push(action("Start", run("start", `${vm.name} started`), { icon: Icons.play }), openConsole);
  } else {
    actions.push(openConsole);
    if (state === "paused" || state === "suspended") {
      actions.push(action("Resume", run(state === "paused" ? "resume" : "dompmwakeup", `${vm.name} resumed`), {
        icon: Icons.play,
        shortcut: "<Ctrl>p",
        section: "Power",
      }));
    } else {
      actions.push(action("Pause", run("suspend", `${vm.name} paused`), {
        icon: Icons.pause,
        shortcut: "<Ctrl>p",
        section: "Power",
      }));
    }
    actions.push(
      action("Shut Down", run("shutdown", `Shutting down ${vm.name}`), {
        icon: Icons.power,
        shortcut: "<Ctrl>s",
        section: "Power",
      }),
      action("Reboot", run("reboot", `Rebooting ${vm.name}`), {
        icon: Icons.refresh,
        shortcut: "<Ctrl>r",
        section: "Power",
      }),
    );
  }
  actions.push(
    action("Open in Virtual Machine Manager", () => {
      if (!launch("virt-manager", ["--connect", vm.uri, "--show-domain-editor", vm.name])) {
        throw new Error("virt-manager is not installed");
      }
      return close();
    }, { icon: Icons.settings, section: "Open" }),
    action("Serial Console in Terminal", () => {
      runInTerminal(virsh(vm, "console"), prefs.terminal || undefined);
      return close();
    }, { icon: Icons.terminal, section: "Open" }),
    action("Open GNOME Boxes", () => {
      if (!launch("gnome-boxes")) throw new Error("GNOME Boxes is not installed");
      return close();
    }, { icon: Icons.apps, section: "Open" }),
    copy(vm.name, "Copy Name", { section: "Copy" }),
    copy(shellLine(virsh(vm, on ? "shutdown" : "start")), on ? "Copy Shutdown Command" : "Copy Start Command", {
      icon: Icons.terminal,
      section: "Copy",
    }),
  );
  if (on) {
    actions.push(action("Force Off", run("destroy", `${vm.name} powered off`), {
      icon: Icons.power,
      destructive: true,
      confirm: `Force off ${vm.name}? Like pulling the plug: unsaved work is lost.`,
      section: "Danger",
    }));
  }
  const cpus = info?.["CPU(s)"];
  const mem = memory(info?.["Max memory"]);
  const metadata: Metadata[] = [
    meta.text("State", STATE_TITLES[state], { icon: Icons.dot, color }),
    meta.text("Connection", `${scope(vm.uri)} (${vm.uri})`, { icon: Icons.plug }),
    ...(info?.["OS Type"] ? [meta.text("OS type", info["OS Type"])] : []),
    ...(info?.Autostart ? [meta.text("Autostart", info.Autostart === "enable" ? "Yes" : "No")] : []),
    ...(info?.Persistent ? [meta.text("Persistent", info.Persistent)] : []),
    meta.separator(),
    ...(vm.id ? [meta.text("ID", vm.id)] : []),
    ...(info?.UUID ? [meta.text("UUID", info.UUID)] : []),
  ];
  return {
    id: `${vm.uri}:${vm.name}`,
    title: vm.name,
    subtitle: [cpus ? `${cpus} vCPU` : "", mem ?? ""].filter(Boolean).join(" · ") || undefined,
    icon: { source: Icons.monitor, tint: color },
    section: `Virtual Machines (${scope(vm.uri)})`,
    keywords: ["vm", "libvirt", "qemu", scope(vm.uri)],
    accessories: [{ tag: STATE_TITLES[state], color }],
    detail: {
      stats: info
        ? [
          ...(cpus ? [{ label: "vCPUs", value: cpus }] : []),
          ...(mem ? [{ label: "memory", value: mem }] : []),
          ...(memory(info["Used memory"]) && on ? [{ label: "in use", value: memory(info["Used memory"])! }] : []),
        ]
        : undefined,
      metadata,
    },
    actions,
  };
}

let summary = "";

const missingItem: Item = {
  id: "missing",
  title: "No container or VM tool found",
  subtitle: "Install distrobox, toolbx or libvirt",
  icon: { source: Icons.alert, tint: "orange" },
  detail: {
    markdown: [
      "This command lists:",
      "",
      "- **distrobox** and **toolbx** containers, to enter them in a terminal",
      "- **libvirt** virtual machines (virt-manager, GNOME Boxes), to start, stop and open them",
      "",
      "```sh",
      "sudo dnf install distrobox libvirt-client virt-manager   # Fedora",
      "sudo apt install distrobox libvirt-clients virt-manager  # Debian, Ubuntu",
      "```",
    ].join("\n"),
  },
  actions: [copy("sudo apt install distrobox libvirt-clients virt-manager", "Copy apt Command")],
};

export default list({
  placeholder: "Filter containers and virtual machines…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "containers", title: "Containers" },
      { value: "vms", title: "Virtual Machines" },
    ],
    default: "all",
  },
  empty: {
    title: "Nothing here yet",
    description: "Create a container with distrobox create, or a VM with virt-manager or GNOME Boxes",
    icon: Icons.layers,
  },
  status: () => summary,
  async *items({ preferences, filter }) {
    const prefs = preferences as Prefs;
    const found = await load();
    if (!found.backends.length) {
      summary = "";
      yield [missingItem];
      return;
    }
    const containers = filter === "vms" ? [] : found.containers;
    const vms = filter === "containers" ? [] : found.vms;
    const up = (n: number, of: number, word: string) => `${of} ${word}${of === 1 ? "" : "s"} (${n} running)`;
    summary = [
      ...(filter !== "vms"
        ? [up(found.containers.filter((c) => c.running).length, found.containers.length, "container")]
        : []),
      ...(filter !== "containers"
        ? [up(found.vms.filter((v) => vmState(v.state) === "running").length, found.vms.length, "VM")]
        : []),
    ].join(" · ");
    const sorted = [...containers].sort((a, b) => Number(b.running) - Number(a.running));
    const vmOrder = [...vms].sort((a, b) =>
      Number(vmState(b.state) === "running") - Number(vmState(a.state) === "running")
    );
    yield [...sorted.map((c) => containerItem(c, prefs)), ...vmOrder.map((vm) => vmItem(vm, prefs))];
    if (!vmOrder.length) return;
    // Then CPUs and memory, one virsh call per VM.
    const infos = await Promise.all(
      vmOrder.map(async (vm) => parseDomInfo(await tryExec("virsh", virsh(vm, "dominfo").slice(1)) ?? "")),
    );
    yield [
      ...sorted.map((c) => containerItem(c, prefs)),
      ...vmOrder.map((vm, i) => vmItem(vm, prefs, infos[i])),
    ];
  },
});
