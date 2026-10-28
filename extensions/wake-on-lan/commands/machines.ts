import {
  action,
  type Color,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { ago, DEFAULT_BROADCAST, type Machine, machineFromForm, type Neighbor, newId } from "../lib.ts";
import {
  broadcasts,
  machines,
  neighbors,
  probeTarget,
  type Reachability,
  reachable,
  saveMachines,
  upsert,
  wake,
} from "../net.ts";

const STATUS: Record<Reachability | "waking", { text: string; color: Color }> = {
  online: { text: "online", color: "green" },
  offline: { text: "offline", color: "gray" },
  unknown: { text: "no host to check", color: "gray" },
  outside: { text: "host not allowed", color: "orange" },
  waking: { text: "waking…", color: "yellow" },
};

/** Machines being woken, watched until they answer. */
const waking = new Map<string, number>();

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    }, { once: true });
  });

/** Polls until the machine answers (toast) or three minutes pass. */
async function watch(m: Machine, table: Neighbor[]) {
  const target = probeTarget(m, table);
  const started = Date.now();
  if (!target) {
    waking.delete(m.id);
    return;
  }
  while (Date.now() - started < 180_000 && waking.has(m.id)) {
    await sleep(4000);
    if ((await reachable(target)) === "online") {
      waking.delete(m.id);
      await toast(`${m.name} is up`, {
        style: "success",
        message: `Answered ${Math.round((Date.now() - started) / 1000)} s after the magic packet`,
      }).catch(() => {});
      return;
    }
  }
  if (waking.delete(m.id)) {
    await toast(`${m.name} didn't answer within 3 minutes`, {
      style: "failure",
      message: "Check that Wake-on-LAN is enabled in its BIOS and network driver",
    }).catch(() => {});
  }
}

function wakeAction(m: Machine, table: Neighbor[]) {
  return action("Wake", async () => {
    const how = await wake(m);
    await upsert({ ...m, lastWoken: Date.now() });
    waking.set(m.id, Date.now());
    watch(m, table);
    await toast(`Magic packet sent to ${m.name}`, {
      style: "success",
      message: `${m.mac} via ${m.broadcast}:${m.port}${how === "Deno" ? "" : ` (${how})`}`,
    });
    return refresh();
  }, { icon: Icons.power });
}

function machineForm(title: string, initial: Partial<Machine>, existing?: Machine): FormSpec {
  return form({
    title,
    submitTitle: existing ? "Save" : "Add Machine",
    fields: [
      field.text("name", "Name", { value: initial.name ?? "", required: true, placeholder: "Desktop, NAS…" }),
      field.text("mac", "MAC address", { value: initial.mac ?? "", required: true, placeholder: "3c:7c:3f:1a:2b:4c" }),
      field.text("broadcast", "Broadcast address", {
        value: initial.broadcast ?? DEFAULT_BROADCAST,
        placeholder: "255.255.255.255, or your network's, like 192.168.1.255",
      }),
      field.text("port", "Port", { value: String(initial.port ?? 9), placeholder: "9 (or 7)" }),
      field.text("host", "Host to check", {
        value: initial.host ?? "",
        placeholder: "Optional: desktop.local or 192.168.1.20, to see when it is up",
      }),
      field.password("secureOn", "SecureOn password", { value: initial.secureOn ?? "", placeholder: "Rarely used" }),
    ],
    async submit(values) {
      const m = machineFromForm(values, existing?.id ?? newId(String(values.mac ?? "")), existing);
      const others = (await machines()).filter((x) => x.id !== m.id);
      if (others.some((x) => x.mac === m.mac)) throw new Error(`${m.mac} is already saved`);
      await upsert(m);
      await toast(existing ? `${m.name} saved` : `${m.name} added`, { style: "success" });
      return pop();
    },
  });
}

async function networkView(): Promise<ListSpec> {
  const [table, bcast, saved] = await Promise.all([neighbors(), broadcasts(), machines()]);
  const known = new Set(saved.map((m) => m.mac));
  return list({
    title: "Devices on the Network",
    placeholder: "Filter by address, MAC or interface…",
    empty: {
      title: "No device in the neighbor table",
      description: "Only devices this computer talked to recently are listed: ping the one you want first",
      icon: Icons.wifi,
    },
    items: table.map((n) => ({
      id: n.mac,
      title: n.ip,
      subtitle: n.mac,
      icon: { source: Icons.monitor, tint: known.has(n.mac) ? "gray" : "blue" },
      keywords: [n.dev, n.state],
      accessories: [
        ...(known.has(n.mac) ? [{ tag: "saved", color: "green" as Color }] : []),
        { text: n.dev },
        { tag: n.state || "seen", color: n.state.includes("reachable") ? "green" as Color : "gray" as Color },
      ],
      actions: [
        action("Add This Machine", () =>
          machineForm("Add Machine", {
            name: "",
            mac: n.mac,
            host: n.ip,
            broadcast: bcast[n.dev] ?? DEFAULT_BROADCAST,
          }), { icon: Icons.plus }),
        copy(n.mac, "Copy MAC Address"),
        copy(n.ip, "Copy IP Address"),
      ],
    })),
  });
}

function item(m: Machine, status: Reachability | undefined, table: Neighbor[]): Item {
  const target = probeTarget(m, table);
  const state = waking.has(m.id) && status !== "online" ? STATUS.waking : status ? STATUS[status] : undefined;
  const dot: Color = state?.color ?? "gray";
  return {
    id: m.id,
    title: m.name,
    subtitle: m.host ?? target ?? m.mac,
    icon: { source: Icons.monitor, tint: status === "online" ? "green" : waking.has(m.id) ? "yellow" : "blue" },
    keywords: [m.mac, m.host ?? "", target ?? "", m.broadcast],
    accessories: [
      ...(m.lastWoken ? [{ text: ago(m.lastWoken), icon: Icons.power, tooltip: "Last woken" }] : []),
      state
        ? {
          icon: { source: Icons.dot, tint: dot },
          text: state.text,
          tooltip: target ? `Checked ${target}` : undefined,
        }
        : { text: "checking…", color: "gray" as Color },
    ],
    detail: {
      metadata: [
        meta.text("Status", state?.text ?? "checking…", { icon: Icons.dot, color: dot }),
        meta.text("MAC address", m.mac, { icon: Icons.hash }),
        meta.text("Sent to", `${m.broadcast}, UDP port ${m.port}`, { icon: Icons.wifi }),
        meta.text(
          "Checked at",
          m.host ? m.host : target ? `${target} (from the neighbor table)` : "Add a host to see when it is up",
          { icon: Icons.globe },
        ),
        ...(m.secureOn ? [meta.text("SecureOn", "set", { icon: Icons.lock })] : []),
        ...(m.lastWoken ? [meta.text("Last woken", new Date(m.lastWoken).toLocaleString("en-GB"))] : []),
      ],
    },
    actions: [
      wakeAction(m, table),
      action("Edit", () => machineForm(`Edit ${m.name}`, m, m), { icon: Icons.settings, shortcut: "<Ctrl>e" }),
      copy(m.mac, "Copy MAC Address", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(target ? [copy(target, "Copy Address", { section: "Copy" })] : []),
      action("Add Machine", () => machineForm("Add Machine", {}), {
        icon: Icons.plus,
        shortcut: "<Ctrl>n",
        section: "Machines",
      }),
      action("Add from Network", networkView, { icon: Icons.wifi, shortcut: "<Ctrl>f", section: "Machines" }),
      action("Remove", async () => {
        await saveMachines((await machines()).filter((x) => x.id !== m.id));
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Remove ${m.name}?`,
        shortcut: "<Ctrl>Delete",
        section: "Machines",
      }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Filter machines…",
  empty: {
    title: "No machine yet",
    description: "Add one with Ctrl+N, or pick it among the devices on your network with Ctrl+F",
    icon: Icons.power,
  },
  status: () => summary,
  actions: [
    action("Add Machine", () => machineForm("Add Machine", {}), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    action("Add from Network", networkView, { icon: Icons.wifi, shortcut: "<Ctrl>f" }),
  ],
  async *items({ signal }) {
    const list = (await machines()).sort((a, b) => a.name.localeCompare(b.name));
    const table = await neighbors(signal);
    const status = new Map<string, Reachability>();
    summary = `${list.length} machine${list.length === 1 ? "" : "s"}`;
    yield list.map((m) => item(m, undefined, table));
    // Live: check every machine again every 10 seconds while the list is open.
    while (!signal.aborted && list.length) {
      await Promise.all(list.map(async (m) => status.set(m.id, await reachable(probeTarget(m, table)))));
      if (signal.aborted) return;
      const up = [...status.values()].filter((s) => s === "online").length;
      summary = `${list.length} machine${list.length === 1 ? "" : "s"} · ${up} online`;
      yield list.map((m) => item(m, status.get(m.id), table));
      await sleep(waking.size ? 3000 : 10_000, signal);
    }
  },
});
