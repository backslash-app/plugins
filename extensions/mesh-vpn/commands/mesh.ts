import {
  action,
  close,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  openExternal,
  pop,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { cli, netbirdUp, NotInstalled } from "../cli.ts";
import {
  ago,
  bytes,
  cleanNetworkId,
  explainZt,
  latencyColor,
  ms,
  type NetbirdPeer,
  netbirdProblem,
  type NetbirdStatus,
  parseNetbird,
  parseZtInfo,
  parseZtNetworks,
  parseZtPeers,
  summary,
  ZT_TOKEN_FIX,
  type ZtNetwork,
  type ZtNode,
  type ZtPeer,
  ztStatus,
} from "../lib.ts";

const ZT_CENTRAL = "https://my.zerotier.com";

// ---------------------------------------------------------------------------
// NetBird

type NetbirdState =
  | { kind: "ok"; status: NetbirdStatus }
  | { kind: "missing" }
  | { kind: "problem"; state: "login" | "daemon" | "other"; message: string };

async function netbirdState(signal?: AbortSignal): Promise<NetbirdState> {
  try {
    const r = await cli("netbird", ["status", "--json"], signal);
    if (r.out.startsWith("{")) return { kind: "ok", status: parseNetbird(r.out) };
    return { kind: "problem", ...netbirdProblem(`${r.err}\n${r.out}`) };
  } catch (e) {
    if (e instanceof NotInstalled) return { kind: "missing" };
    throw e;
  }
}

async function connectNetbird() {
  await toast("Connecting NetBird…");
  const r = await netbirdUp();
  if (r.url) {
    await openExternal(r.url);
    return close("Finish signing in to NetBird in your browser");
  }
  if (!r.ok) throw new Error(`NetBird didn't connect: ${netbirdProblem(r.output).message}`);
  await toast("NetBird connected", { style: "success" });
  return refresh();
}

const disconnectNetbird = action("Disconnect NetBird", async () => {
  const r = await cli("netbird", ["down"]);
  if (!r.ok) throw new Error(`NetBird didn't disconnect: ${netbirdProblem(r.err || r.out).message}`);
  await toast("NetBird disconnected");
  return refresh();
}, {
  icon: Icons.power,
  shortcut: "<Ctrl><Shift>d",
  destructive: true,
  confirm: "Disconnect from NetBird? Peers can't reach this computer until you connect again",
  section: "NetBird",
});

function netbirdSelf(state: NetbirdState): Item | undefined {
  if (state.kind === "missing") return undefined;
  if (state.kind === "problem") {
    const fix = state.state === "daemon" ? "sudo netbird service install && sudo netbird service start" : undefined;
    return {
      id: "netbird-self",
      title: "NetBird",
      subtitle: state.message,
      icon: { source: Icons.vpn, tint: state.state === "login" ? "orange" : "red" },
      section: "NetBird",
      accessories: [{ tag: state.state === "login" ? "signed out" : "not running", color: "orange" }],
      detail: {
        markdown: [
          `## ${state.message}`,
          "",
          state.state === "login"
            ? "**Connect** runs `netbird up` and opens the sign-in page in your browser."
            : state.state === "daemon"
            ? ["Start the NetBird service:", "", "```", fix, "```"].join("\n")
            : `\`netbird status\` said: ${state.message}`,
        ].join("\n"),
      },
      actions: [
        ...(state.state === "daemon" && fix ? [copy(fix, "Copy Command")] : []),
        action(state.state === "login" ? "Sign In and Connect" : "Connect", connectNetbird, {
          icon: Icons.power,
          shortcut: "<Ctrl><Shift>d",
        }),
        action("Try Again", () => refresh(), { icon: Icons.refresh }),
      ],
    };
  }
  const s = state.status;
  const lines: Metadata[] = [
    meta.text("Status", s.connected ? "Connected" : "Disconnected", {
      icon: { source: Icons.dot, tint: s.connected ? "green" : "gray" },
      color: s.connected ? "green" : undefined,
    }),
    ...(s.cidr ? [meta.text("NetBird IP", s.cidr, { icon: Icons.hash })] : []),
    ...(s.fqdn ? [meta.text("Name", s.fqdn, { icon: Icons.globe })] : []),
    meta.text("Peers", `${s.peersConnected} of ${s.peersTotal} connected`, { icon: Icons.link }),
    meta.separator(),
    ...(s.managementUrl
      ? [
        meta.text("Management", s.managementUrl, {
          icon: { source: Icons.server, tint: s.connected ? "green" : "red" },
        }),
      ]
      : []),
    ...(s.managementError ? [meta.text("Error", s.managementError, { icon: Icons.alert, color: "red" })] : []),
    meta.text("Signal", s.signalConnected ? "Connected" : "Disconnected", {
      icon: { source: Icons.bolt, tint: s.signalConnected ? "green" : "gray" },
    }),
    ...(s.relays ? [meta.text("Relays", `${s.relays} available`)] : []),
    meta.text("WireGuard", s.kernel ? "Kernel" : "Userspace"),
    ...(s.networks.length ? [meta.tags("Networks", s.networks)] : []),
    ...(s.version ? [meta.text("Version", s.version, { icon: Icons.tag })] : []),
  ];
  return {
    id: "netbird-self",
    title: "NetBird",
    subtitle: s.connected ? (s.fqdn ?? "Connected") : "Disconnected",
    icon: { source: Icons.vpn, tint: s.connected ? "green" : "gray" },
    section: "NetBird",
    keywords: ["netbird", "this device", s.fqdn ?? ""],
    accessories: [
      ...(s.connected ? [{ text: `${s.peersConnected}/${s.peersTotal} peers`, icon: Icons.link }] : []),
      ...(s.ip ? [{ text: s.ip }] : []),
      { tag: s.connected ? "connected" : "disconnected", color: s.connected ? "green" as const : "gray" as const },
    ],
    detail: {
      stats: [
        { label: "status", value: s.connected ? "Connected" : "Off", color: s.connected ? "green" : "gray" },
        { label: "peers", value: `${s.peersConnected}/${s.peersTotal}` },
      ],
      metadata: lines,
    },
    actions: [
      ...(s.connected
        ? [
          ...(s.ip ? [copy(s.ip, "Copy NetBird IP")] : []),
          disconnectNetbird,
          ...(s.fqdn ? [copy(s.fqdn, "Copy Name", { section: "Copy" })] : []),
        ]
        : [action("Connect NetBird", connectNetbird, { icon: Icons.power, shortcut: "<Ctrl><Shift>d" })]),
      ...(s.managementUrl && /api\.netbird\.io/.test(s.managementUrl)
        ? [open("https://app.netbird.io/peers", "Open NetBird Dashboard", { section: "Open" })]
        : []),
    ],
  };
}

function netbirdPeerItem(p: NetbirdPeer): Item {
  const tint = p.connected ? latencyColor(p.latency) ?? "green" : "gray";
  return {
    id: `nb-${p.key}`,
    title: p.name,
    subtitle: p.fqdn,
    icon: { source: Icons.monitor, tint },
    section: p.connected ? "NetBird Peers" : "NetBird Peers Offline",
    keywords: [p.fqdn, p.ip ?? "", p.connection ?? "", ...p.routes, "netbird"],
    accessories: [
      ...(p.connection
        ? [{ tag: p.connection, color: p.connection === "P2P" ? "blue" as const : "gray" as const }]
        : []),
      ...(p.routes.length ? [{ text: `${p.routes.length} route${p.routes.length === 1 ? "" : "s"}` }] : []),
      ...(p.latency !== undefined ? [{ text: ms(p.latency), color: latencyColor(p.latency), tooltip: "Latency" }] : []),
      ...(!p.connected && p.since ? [{ text: ago(p.since), icon: Icons.clock, tooltip: "Disconnected since" }] : []),
      ...(p.ip ? [{ text: p.ip }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Status", p.connected ? "Connected" : "Disconnected", {
          icon: { source: Icons.dot, tint: p.connected ? "green" : "gray" },
        }),
        ...(p.since ? [meta.text(p.connected ? "Since" : "Offline since", ago(p.since), { icon: Icons.clock })] : []),
        ...(p.ip ? [meta.text("NetBird IP", p.ip, { icon: Icons.hash })] : []),
        meta.text("Name", p.fqdn || p.name, { icon: Icons.globe }),
        ...(p.latency !== undefined
          ? [meta.text("Latency", ms(p.latency), { icon: Icons.activity, color: latencyColor(p.latency) })]
          : []),
        ...(p.connection ? [meta.text("Connection", p.connection, { icon: Icons.link })] : []),
        ...(p.endpoint ? [meta.text(p.connection === "Relayed" ? "Relay" : "Endpoint", p.endpoint)] : []),
        ...(p.rx || p.tx ? [meta.text("Traffic", `↓ ${bytes(p.rx)}  ↑ ${bytes(p.tx)}`)] : []),
        ...(p.handshake ? [meta.text("Last handshake", ago(p.handshake))] : []),
        ...(p.routes.length ? [meta.tags("Routes", p.routes)] : []),
      ],
    },
    actions: [
      ...(p.ip ? [copy(p.ip, "Copy IP Address")] : []),
      ...(p.fqdn ? [copy(p.fqdn, "Copy Name", { shortcut: "<Ctrl>period" })] : []),
      ...(p.fqdn ? [open(`http://${p.fqdn}`, "Open in Browser", { icon: Icons.globe, section: "Open" })] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// ZeroTier

type ZtState =
  | { kind: "ok"; node: ZtNode; networks: ZtNetwork[]; peers: ZtPeer[] }
  | { kind: "missing" }
  | { kind: "problem"; message: string };

async function zt(args: string[], signal?: AbortSignal): Promise<string> {
  const r = await cli("zerotier-cli", args, signal);
  if (!r.ok || /^\d{3} /.test(r.out) && !r.out.startsWith("200")) throw new Error(explainZt(r.err || r.out));
  return r.out;
}

async function ztState(signal?: AbortSignal): Promise<ZtState> {
  try {
    const [info, networks, peers] = await Promise.all([
      zt(["-j", "info"], signal),
      zt(["-j", "listnetworks"], signal),
      zt(["-j", "peers"], signal).catch(() => "[]"),
    ]);
    return { kind: "ok", node: parseZtInfo(info), networks: parseZtNetworks(networks), peers: parseZtPeers(peers) };
  } catch (e) {
    if (e instanceof NotInstalled) return { kind: "missing" };
    if (signal?.aborted) throw e;
    return { kind: "problem", message: e instanceof Error ? e.message : String(e) };
  }
}

function joinForm() {
  return form({
    title: "Join ZeroTier Network",
    submitTitle: "Join",
    fields: [field.text("id", "Network ID", { placeholder: "8056c2e21c000001", required: true })],
    async submit(values) {
      const id = cleanNetworkId(values.id);
      if (!id) throw new Error("A network ID is 16 hex digits, like 8056c2e21c000001");
      await zt(["join", id]);
      await toast(`Joined ${id}`, {
        style: "success",
        message: "If the network is private, authorize this device in its controller",
      });
      return pop();
    },
  });
}

const joinAction = action("Join ZeroTier Network…", () => joinForm(), {
  icon: Icons.plus,
  shortcut: "<Ctrl>j",
  section: "ZeroTier",
});

function ztSelf(state: ZtState): Item | undefined {
  if (state.kind === "missing") return undefined;
  if (state.kind === "problem") {
    const token = /auth token/.test(state.message);
    const fix = token ? ZT_TOKEN_FIX : "sudo systemctl enable --now zerotier-one";
    return {
      id: "zt-self",
      title: "ZeroTier",
      subtitle: state.message,
      icon: { source: Icons.globe, tint: "red" },
      section: "ZeroTier",
      accessories: [{ tag: token ? "no access" : "not running", color: "orange" }],
      detail: {
        markdown: [
          `## ${state.message}`,
          "",
          token
            ? "zerotier-cli talks to the service with its secret token. Give your user a copy:"
            : "Start the ZeroTier service:",
          "",
          "```",
          fix,
          "```",
        ].join("\n"),
      },
      actions: [copy(fix, "Copy Command"), action("Try Again", () => refresh(), { icon: Icons.refresh })],
    };
  }
  const { node, networks } = state;
  const ok = networks.filter((n) => n.status === "OK").length;
  return {
    id: "zt-self",
    title: "ZeroTier",
    subtitle: `Node ${node.address}`,
    icon: { source: Icons.globe, tint: node.online ? "green" : "gray" },
    section: "ZeroTier",
    keywords: ["zerotier", "node", node.address],
    accessories: [
      { text: `${ok}/${networks.length} network${networks.length === 1 ? "" : "s"}`, icon: Icons.layers },
      ...(node.tcpFallback ? [{ tag: "TCP relay", color: "orange" as const }] : []),
      { tag: node.online ? "online" : "offline", color: node.online ? "green" as const : "gray" as const },
    ],
    detail: {
      stats: [
        { label: "status", value: node.online ? "Online" : "Offline", color: node.online ? "green" : "gray" },
        { label: "networks", value: `${ok}/${networks.length}` },
        { label: "peers", value: state.peers.filter((p) => p.role === "LEAF").length },
      ],
      metadata: [
        meta.text("Node ID", node.address, { icon: Icons.hash }),
        meta.text("Status", node.online ? "Online" : "Offline", {
          icon: { source: Icons.dot, tint: node.online ? "green" : "gray" },
        }),
        ...(node.tcpFallback
          ? [meta.text("Transport", "TCP fallback relay (UDP blocked)", { icon: Icons.alert, color: "orange" })]
          : []),
        ...(node.port ? [meta.text("Port", `UDP ${node.port}`)] : []),
        ...(node.version ? [meta.text("Version", node.version, { icon: Icons.tag })] : []),
      ],
      markdown: networks.length ? undefined : "No network joined yet: **Join ZeroTier Network…** (Ctrl+J).",
    },
    actions: [
      copy(node.address, "Copy Node ID"),
      joinAction,
      open(ZT_CENTRAL, "Open ZeroTier Central", { section: "Open" }),
    ],
  };
}

function ztNetworkItem(n: ZtNetwork): Item {
  const look = ztStatus(n.status);
  const ip = n.addresses[0]?.split("/")[0];
  return {
    id: `zt-${n.id}`,
    title: n.name || n.id,
    subtitle: n.name ? n.id : undefined,
    icon: { source: Icons.layers, tint: look.color },
    section: "ZeroTier Networks",
    keywords: [n.id, ...n.addresses, n.device ?? "", "zerotier"],
    accessories: [
      ...(n.allowDefault ? [{ tag: "default route", color: "purple" as const }] : []),
      ...(ip ? [{ text: ip }] : []),
      { tag: look.label, color: look.color },
    ],
    detail: {
      markdown: n.status === "ACCESS_DENIED"
        ? "This device is waiting to be authorized: tick it in the network's members, in ZeroTier Central or your controller."
        : undefined,
      metadata: [
        meta.text("Status", look.label, { icon: { source: Icons.dot, tint: look.color } }),
        meta.text("Network ID", n.id, { icon: Icons.hash }),
        meta.text("Type", n.private ? "Private" : "Public", { icon: n.private ? Icons.lock : Icons.globe }),
        ...(n.addresses.length ? [meta.tags("Addresses", n.addresses)] : []),
        ...(n.device ? [meta.text("Interface", n.device)] : []),
        ...(n.mac ? [meta.text("MAC", n.mac)] : []),
        ...(n.routes.length ? [meta.tags("Routes", n.routes)] : []),
        ...(n.dnsDomain ? [meta.text("DNS domain", n.dnsDomain, { icon: Icons.globe })] : []),
        meta.text("Default route", n.allowDefault ? "Allowed" : "No"),
        meta.text("DNS", n.allowDns ? "Allowed" : "No"),
      ],
    },
    actions: [
      ...(ip ? [copy(ip, "Copy IP Address")] : []),
      copy(n.id, "Copy Network ID", { shortcut: "<Ctrl><Shift>c" }),
      open(`${ZT_CENTRAL}/network/${n.id}`, "Open in ZeroTier Central", { section: "Open" }),
      joinAction,
      action("Leave Network", async () => {
        await zt(["leave", n.id]);
        await toast(`Left ${n.name || n.id}`);
        return refresh();
      }, {
        icon: Icons.trash,
        shortcut: "<Ctrl><Shift>l",
        destructive: true,
        confirm: `Leave ${n.name || n.id}? Joining again may need a new authorization`,
        section: "ZeroTier",
      }),
    ],
  };
}

function ztPeerItem(p: ZtPeer): Item {
  const tint = p.direct ? latencyColor(p.latency) ?? "green" : "gray";
  const root = p.role !== "LEAF";
  return {
    id: `ztp-${p.address}`,
    title: p.address,
    subtitle: root ? (p.role === "PLANET" ? "Root server" : "Moon") : p.path,
    icon: { source: root ? Icons.server : Icons.monitor, tint },
    section: root ? "ZeroTier Roots" : "ZeroTier Peers",
    keywords: [p.role, p.path ?? "", "zerotier"],
    accessories: [
      {
        tag: p.direct ? (p.relayed ? "relayed" : "direct") : "relayed",
        color: p.direct && !p.relayed ? "blue" : "gray",
      },
      ...(p.latency !== undefined ? [{ text: ms(p.latency), color: latencyColor(p.latency), tooltip: "Latency" }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Address", p.address, { icon: Icons.hash }),
        meta.text("Role", p.role === "LEAF" ? "Peer" : p.role === "PLANET" ? "Root server" : "Moon"),
        ...(p.latency !== undefined
          ? [meta.text("Latency", ms(p.latency), { icon: Icons.activity, color: latencyColor(p.latency) })]
          : []),
        meta.text("Path", p.path ?? "Relayed through a root", { icon: Icons.link }),
        ...(p.version ? [meta.text("Version", p.version, { icon: Icons.tag })] : []),
      ],
    },
    actions: [
      copy(p.address, "Copy Address"),
      ...(p.path ? [copy(p.path.replace(/:\d+$/, ""), "Copy Physical IP")] : []),
    ],
  };
}

// ---------------------------------------------------------------------------

function installItem(): Item {
  return {
    id: "install",
    title: "Neither NetBird nor ZeroTier is installed",
    subtitle: "Install one of them, then come back",
    icon: { source: Icons.download, tint: "orange" },
    detail: {
      markdown: [
        "## Install a mesh VPN",
        "",
        "**NetBird**",
        "",
        "```",
        "curl -fsSL https://pkgs.netbird.io/install.sh | sh",
        "netbird up",
        "```",
        "",
        "**ZeroTier**",
        "",
        "```",
        "curl -s https://install.zerotier.com | sudo bash",
        ZT_TOKEN_FIX,
        "```",
      ].join("\n"),
    },
    actions: [
      open("https://docs.netbird.io/how-to/installation", "NetBird Install Guide"),
      open("https://www.zerotier.com/download/", "ZeroTier Download Page"),
    ],
  };
}

let status = "";

export default list({
  placeholder: "Filter peers and networks by name, IP, route…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "netbird", title: "NetBird" },
      { value: "zerotier", title: "ZeroTier" },
    ],
    default: "all",
  },
  empty: {
    title: "No peer here",
    description: "Connect, or join a network, and the other devices show up here",
    icon: Icons.vpn,
  },
  status: () => status,
  actions: [action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async items({ filter, signal }) {
    status = "";
    const [nb, z] = await Promise.all([
      filter === "zerotier" ? Promise.resolve<NetbirdState>({ kind: "missing" }) : netbirdState(signal),
      filter === "netbird" ? Promise.resolve<ZtState>({ kind: "missing" }) : ztState(signal),
    ]);
    if (nb.kind === "missing" && z.kind === "missing") {
      return filter === "all" || !filter ? [installItem()] : [];
    }
    const nbStatus = nb.kind === "ok" ? nb.status : undefined;
    const ztNets = z.kind === "ok" ? z.networks : undefined;
    status = summary(nbStatus, ztNets) ?? "";
    if (filter === "all" || !filter) updateCommandMetadata({ subtitle: summary(nbStatus, ztNets) }).catch(() => {});
    const items: Item[] = [];
    const nbSelf = netbirdSelf(nb);
    if (nbSelf) items.push(nbSelf);
    if (nbStatus) {
      // While disconnected, the peers listed are stale.
      items.push(
        ...nbStatus.peers.map((p) =>
          netbirdPeerItem(
            nbStatus.connected ? p : { ...p, connected: false, latency: undefined, connection: undefined },
          )
        ),
      );
    }
    const ztSelfItem = ztSelf(z);
    if (ztSelfItem) items.push(ztSelfItem);
    if (z.kind === "ok") {
      items.push(...z.networks.map(ztNetworkItem), ...z.peers.map(ztPeerItem));
    }
    return items;
  },
});
