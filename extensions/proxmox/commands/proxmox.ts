import {
  type Action,
  action,
  type Context,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  pop,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { guarded, pve, type Server, server, SetupError } from "../api.ts";
import {
  bytes,
  consoleUrl,
  type Guest,
  guestLook,
  guestName,
  isGuest,
  kindTitle,
  matches,
  nodeLook,
  type NodeStatus,
  pct,
  plural,
  ratio,
  type Resource,
  sectionOf,
  type Snapshot,
  snapshotName,
  snapshotTime,
  sortResources,
  sortSnapshots,
  summary,
  tagsOf,
  uptime,
  webUrl,
} from "../lib.ts";

const POLL_MS = 5_000;
/** Right after a start or stop, to follow the task. */
const FAST_POLL_MS = 1_500;

// --- Live reload ---------------------------------------------------------------

const changes = new EventTarget();
let fastUntil = 0;
function changed() {
  fastUntil = Date.now() + 20_000;
  changes.dispatchEvent(new Event("change"));
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      changes.removeEventListener("change", done);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    changes.addEventListener("change", done);
    signal.addEventListener("abort", done);
  });
}

// --- Actions -------------------------------------------------------------------

const guestPath = (g: Guest) => `/nodes/${encodeURIComponent(g.node)}/${g.type}/${g.vmid}`;

const VERBS: Record<string, [string, string]> = {
  start: ["Starting", "started"],
  shutdown: ["Shutting down", "shut down"],
  stop: ["Stopping", "stopped"],
  reboot: ["Rebooting", "rebooted"],
  suspend: ["Pausing", "paused"],
  resume: ["Resuming", "resumed"],
};

function power(s: Server, g: Guest, verb: keyof typeof VERBS, title: string, options: Parameters<typeof action>[2]) {
  return action(title, async () => {
    await pve<string>(s, `${guestPath(g)}/status/${verb}`, { method: "POST", body: {} });
    await toast(`${VERBS[verb][0]} ${guestName(g)}…`, { style: "success" });
    changed();
  }, options);
}

function snapshotForm(s: Server, g: Guest) {
  return form({
    title: `Snapshot ${guestName(g)}`,
    submitTitle: "Take Snapshot",
    fields: [
      field.text("name", "Name", { placeholder: snapshotName(""), required: false }),
      field.textArea("description", "Description", { placeholder: "Before upgrading to …" }),
      ...(g.type === "qemu" && g.status === "running" ? [field.checkbox("vmstate", "Include RAM")] : []),
    ],
    async submit(values) {
      const name = snapshotName(String(values.name ?? ""));
      await pve<string>(s, `${guestPath(g)}/snapshot`, {
        method: "POST",
        body: {
          snapname: name,
          ...(values.description ? { description: String(values.description) } : {}),
          ...(values.vmstate ? { vmstate: 1 } : {}),
        },
      });
      await toast(`Taking snapshot ${name}…`, { style: "success" });
      changed();
      return pop();
    },
  });
}

function snapshotItem(s: Server, g: Guest, snap: Snapshot): Item {
  return {
    id: snap.name,
    title: snap.name,
    subtitle: snap.description?.split("\n")[0],
    icon: { source: Icons.history, tint: "blue" },
    keywords: [snap.description ?? ""],
    accessories: [
      ...(snap.vmstate ? [{ tag: "RAM", color: "purple" as const }] : []),
      ...(snap.snaptime ? [{ text: snapshotTime(snap) }] : []),
    ],
    detail: {
      markdown: snap.description || undefined,
      metadata: [
        meta.text("Name", snap.name, { icon: Icons.tag }),
        ...(snap.snaptime ? [meta.text("Taken", snapshotTime(snap), { icon: Icons.clock })] : []),
        ...(snap.parent ? [meta.text("Parent", snap.parent, { icon: Icons.branch })] : []),
        meta.text("RAM included", snap.vmstate ? "Yes" : "No", { icon: Icons.cpu }),
        meta.text("Guest", `${guestName(g)} (${g.vmid})`, { icon: g.type === "lxc" ? Icons.box : Icons.monitor }),
      ],
    },
    actions: [
      action("Take Snapshot", () => snapshotForm(s, g), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      open(webUrl(s.base, g), "Open in Web UI", { icon: Icons.globe }),
      copy(snap.name, "Copy Snapshot Name", { section: "Copy" }),
    ],
  };
}

function snapshotList(s: Server, g: Guest) {
  let count = 0;
  return list({
    title: `Snapshots of ${guestName(g)}`,
    placeholder: "Filter snapshots…",
    empty: {
      title: "No snapshot",
      description: "Take one before an upgrade: Ctrl+N",
      icon: Icons.history,
    },
    status: () => plural(count, "snapshot"),
    actions: [
      action("Take Snapshot", () => snapshotForm(s, g), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      open(webUrl(s.base, g), "Open in Web UI", { icon: Icons.globe }),
    ],
    // Reloads after a snapshot is taken from here (Proxmox needs a moment to list it).
    async *items({ signal }) {
      while (!signal.aborted) {
        const snaps = sortSnapshots(await pve<Snapshot[]>(s, `${guestPath(g)}/snapshot`, { signal }));
        count = snaps.length;
        yield snaps.map((snap) => snapshotItem(s, g, snap));
        await wait(Date.now() < fastUntil ? FAST_POLL_MS * 2 : 60_000, signal);
      }
    },
  });
}

// --- Items -------------------------------------------------------------------

function guestItem(g: Guest, s: Server, nodes: number): Item {
  const look = guestLook(g);
  const running = g.status === "running";
  const cpu = g.cpu ?? 0, mem = ratio(g.mem, g.maxmem);
  const tags = tagsOf(g);
  const metadata: Metadata[] = [
    meta.text("Status", look.label, { icon: { source: look.icon, tint: look.tint }, color: look.tint }),
  ];
  if (running) {
    metadata.push(
      meta.progress("CPU", cpu, `${pct(cpu)} of ${plural(g.maxcpu ?? 1, "core")}`),
      meta.progress("Memory", mem, `${bytes(g.mem)} of ${bytes(g.maxmem)}`),
    );
    if (g.maxdisk && g.disk) {
      metadata.push(meta.progress("Disk", ratio(g.disk, g.maxdisk), `${bytes(g.disk)} of ${bytes(g.maxdisk)}`));
    }
    metadata.push(meta.text("Uptime", uptime(g.uptime), { icon: Icons.clock }));
  } else {
    metadata.push(
      meta.text("Cores", String(g.maxcpu ?? "–"), { icon: Icons.cpu }),
      meta.text("Memory", bytes(g.maxmem), { icon: Icons.layers }),
      meta.text("Disk", bytes(g.maxdisk), { icon: Icons.drive }),
    );
  }
  metadata.push(
    meta.separator(),
    meta.text("Type", kindTitle(g), { icon: g.type === "lxc" ? Icons.box : Icons.monitor }),
    meta.text("ID", String(g.vmid), { icon: Icons.hash }),
    meta.text("Node", g.node, { icon: Icons.server }),
  );
  if (tags.length) metadata.push(meta.tags("Tags", tags.map((t) => ({ text: t, color: "blue" as const }))));
  if (g.pool) metadata.push(meta.text("Pool", g.pool, { icon: Icons.folder }));
  if (g.hastate) metadata.push(meta.text("HA", g.hastate, { icon: Icons.shield }));
  if (running && (g.netin || g.netout)) {
    metadata.push(meta.text("Network", `↓ ${bytes(g.netin)} · ↑ ${bytes(g.netout)}`, { icon: Icons.activity }));
  }
  metadata.push(meta.link("Web UI", `${new URL(s.base).host}`, webUrl(s.base, g)));

  const name = guestName(g);
  const consoleAction = open(consoleUrl(s.base, g), "Open Console", { icon: Icons.terminal, shortcut: "<Ctrl>o" });
  const actions: Action[] = [];
  if (g.template) {
    actions.push(open(webUrl(s.base, g), "Open in Web UI", { icon: Icons.globe }));
  } else if (running) {
    actions.push(
      consoleAction,
      power(s, g, "shutdown", "Shut Down", {
        icon: Icons.power,
        shortcut: "<Ctrl><Shift>s",
        confirm: `Shut down ${name}?`,
        section: "Power",
      }),
      power(s, g, "reboot", "Reboot", {
        icon: Icons.refresh,
        shortcut: "<Ctrl><Shift>r",
        confirm: `Reboot ${name}?`,
        section: "Power",
      }),
      ...(g.type === "qemu" ? [power(s, g, "suspend", "Pause", { icon: Icons.pause, section: "Power" })] : []),
      power(s, g, "stop", "Stop (Pull the Plug)", {
        icon: Icons.stop,
        destructive: true,
        confirm: `Stop ${name} now? Unsaved data in the guest is lost`,
        section: "Power",
      }),
    );
  } else if (g.status === "paused" || g.status === "suspended") {
    actions.push(power(s, g, "resume", "Resume", { icon: Icons.play }), consoleAction);
  } else {
    actions.push(power(s, g, "start", "Start", { icon: Icons.play }), consoleAction);
  }
  if (!g.template) {
    actions.push(
      action("Snapshots", () => snapshotList(s, g), { icon: Icons.history, shortcut: "<Ctrl>s", section: "Snapshots" }),
      action("Take Snapshot", () => snapshotForm(s, g), {
        icon: Icons.plus,
        shortcut: "<Ctrl>n",
        section: "Snapshots",
      }),
    );
  }
  if (!g.template) actions.push(open(webUrl(s.base, g), "Open in Web UI", { icon: Icons.globe, section: "Proxmox" }));
  actions.push(
    copy(String(g.vmid), "Copy ID", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(name, "Copy Name", { section: "Copy" }),
  );

  return {
    id: g.id,
    title: name,
    subtitle: nodes > 1 ? `${g.vmid} · ${g.node}` : String(g.vmid),
    icon: { source: look.icon, tint: look.tint },
    section: sectionOf(g),
    keywords: [String(g.vmid), g.node, look.label, kindTitle(g), ...tags],
    accessories: running
      ? [
        { text: pct(cpu), icon: Icons.cpu, tooltip: "CPU", color: cpu > 0.9 ? "red" : undefined },
        {
          text: bytes(g.mem),
          icon: Icons.layers,
          tooltip: `Memory, of ${bytes(g.maxmem)}`,
          color: mem > 0.9 ? "red" : undefined,
        },
        { text: uptime(g.uptime), icon: Icons.clock, tooltip: "Uptime" },
      ]
      : [{ tag: look.label, color: look.tint }],
    detail: {
      stats: running
        ? [
          { label: "CPU", value: pct(cpu), color: cpu > 0.9 ? "red" : undefined },
          { label: "Memory", value: pct(mem), color: mem > 0.9 ? "red" : undefined },
          { label: "Uptime", value: uptime(g.uptime) },
        ]
        : undefined,
      metadata,
    },
    actions,
  };
}

function nodeItem(n: Resource, status: NodeStatus | undefined, s: Server, guests: Guest[]): Item {
  const look = nodeLook(n);
  const name = n.node ?? n.name ?? n.id;
  const online = n.status === "online";
  const cpu = n.cpu ?? 0, mem = ratio(n.mem, n.maxmem), disk = ratio(n.disk, n.maxdisk);
  const mine = guests.filter((g) => g.node === name && !g.template);
  const up = mine.filter((g) => g.status === "running").length;
  const metadata: Metadata[] = [
    meta.text("Status", look.label, { icon: { source: Icons.server, tint: look.tint }, color: look.tint }),
  ];
  if (online) {
    metadata.push(
      meta.progress("CPU", cpu, `${pct(cpu)} of ${plural(n.maxcpu ?? 1, "CPU")}`),
      meta.progress("Memory", mem, `${bytes(n.mem)} of ${bytes(n.maxmem)}`),
      meta.progress("Root disk", disk, `${bytes(n.disk)} of ${bytes(n.maxdisk)}`),
    );
    if (status?.swap?.total) {
      metadata.push(
        meta.progress(
          "Swap",
          ratio(status.swap.used, status.swap.total),
          `${bytes(status.swap.used)} of ${bytes(status.swap.total)}`,
        ),
      );
    }
    if (status?.loadavg) metadata.push(meta.text("Load", status.loadavg.join(" · "), { icon: Icons.activity }));
    metadata.push(meta.text("Uptime", uptime(n.uptime), { icon: Icons.clock }));
  }
  metadata.push(meta.separator(), meta.text("Guests", `${up} of ${mine.length} running`, { icon: Icons.monitor }));
  if (status?.cpuinfo?.model) {
    metadata.push(meta.text("CPU model", status.cpuinfo.model.replace(/\s+/g, " "), { icon: Icons.cpu }));
  }
  if (status?.pveversion) {
    metadata.push(meta.text("Version", status.pveversion.replace(/^pve-manager\//, ""), { icon: Icons.tag }));
  }
  if (status?.kversion) {
    metadata.push(meta.text("Kernel", status.kversion.split(" ").slice(0, 2).join(" "), { icon: Icons.code }));
  }

  return {
    id: n.id,
    title: name,
    subtitle: online ? `${up} of ${plural(mine.length, "guest")} running` : look.label,
    icon: { source: Icons.server, tint: look.tint },
    section: "Nodes",
    keywords: ["node", look.label],
    accessories: online
      ? [
        { text: pct(cpu), icon: Icons.cpu, tooltip: "CPU", color: cpu > 0.9 ? "red" : undefined },
        {
          text: pct(mem),
          icon: Icons.layers,
          tooltip: `Memory: ${bytes(n.mem)} of ${bytes(n.maxmem)}`,
          color: mem > 0.9 ? "red" : undefined,
        },
        { text: uptime(n.uptime), icon: Icons.clock, tooltip: "Uptime" },
      ]
      : [{ tag: look.label, color: look.tint }],
    detail: {
      stats: online
        ? [
          { label: "CPU", value: pct(cpu), color: cpu > 0.9 ? "red" : undefined },
          { label: "Memory", value: pct(mem), color: mem > 0.9 ? "red" : undefined },
          { label: "Guests", value: `${up}/${mine.length}` },
        ]
        : undefined,
      metadata,
    },
    actions: [
      open(consoleUrl(s.base, n), "Open Shell", { icon: Icons.terminal }),
      open(webUrl(s.base, n), "Open in Web UI", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
      copy(name, "Copy Node Name", { section: "Copy" }),
    ],
  };
}

// --- Command -------------------------------------------------------------------

export default (_ctx: Context) => {
  let shown = "";
  return list({
    placeholder: "Filter VMs, containers and nodes by name, ID, tag…",
    filter: {
      options: [
        { value: "running", title: "Running" },
        { value: "stopped", title: "Stopped" },
        { value: "all", title: "All" },
      ],
      default: "all",
    },
    empty: { title: "Nothing here", description: "No guest matches this view", icon: Icons.server },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : shown,
    async *items({ preferences, signal, filter }) {
      let s: Server;
      try {
        s = await server(preferences);
      } catch (e) {
        if (!(e instanceof SetupError)) throw e;
        yield await guarded(() => Promise.reject(e));
        return;
      }
      const statuses = new Map<string, NodeStatus>();
      while (!signal.aborted) {
        const items = await guarded(async () => {
          const all = await pve<Resource[]>(s, "/cluster/resources", { signal });
          const nodes = all.filter((r) => r.type === "node");
          // Node details (load, versions) once; the resources call has the live numbers.
          await Promise.all(
            nodes.filter((n) => n.status === "online" && !statuses.has(n.node!)).map(async (n) => {
              const st = await pve<NodeStatus>(s, `/nodes/${encodeURIComponent(n.node!)}/status`, { signal })
                .catch(() => undefined);
              if (st) statuses.set(n.node!, st);
            }),
          );
          const guests = all.filter(isGuest);
          const line = summary(all);
          updateCommandMetadata({ subtitle: line }).catch(() => {});
          const real = guests.filter((g) => !g.template);
          shown = [
            plural(nodes.length, "node"),
            line ?? "No guest",
            real.filter((g) => g.status !== "running").length
              ? `${real.filter((g) => g.status !== "running").length} stopped`
              : "",
          ].filter(Boolean).join(" · ");
          return sortResources(all.filter((r) => matches(r, filter))).map((r) =>
            r.type === "node" ? nodeItem(r, statuses.get(r.node!), s, guests) : guestItem(r as Guest, s, nodes.length)
          );
        });
        yield items;
        if (items[0]?.id === "setup") return;
        await wait(Date.now() < fastUntil ? FAST_POLL_MS : POLL_MS, signal);
      }
    },
  });
};
