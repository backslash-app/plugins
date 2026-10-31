import {
  type Accessory,
  type Action,
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type Backend, backend, SetupError, TITLES } from "../api.ts";
import {
  ago,
  bits,
  bytes,
  type Client,
  duration,
  type Router,
  section,
  signalBars,
  signalColor,
  speed,
  statusLine,
} from "../lib.ts";
import type { SetupKind } from "../net.ts";

function routerItem(b: Backend, r: Router, clients: Client[]): Item {
  const online = clients.filter((c) => c.online !== false).length;
  const wifi = clients.filter((c) => c.online !== false && c.connection === "wifi").length;
  const lines: Metadata[] = [
    meta.text("Internet", r.wan.online ? "Connected" : "Down", {
      icon: { source: Icons.globe, tint: r.wan.online ? "green" : "red" },
      color: r.wan.online ? "green" : "red",
    }),
    ...(r.wan.ip ? [meta.text("Public IPv4", r.wan.ip, { icon: Icons.hash })] : []),
    ...(r.wan.ip6 ? [meta.text("IPv6", r.wan.ip6)] : []),
    ...(r.wan.type ? [meta.text("Connection", r.wan.type, { icon: Icons.link })] : []),
    ...(r.wan.maxDown ? [meta.text("Line", `↓ ${bits(r.wan.maxDown)}  ↑ ${bits(r.wan.maxUp)}`)] : []),
    ...(r.wan.latency !== undefined ? [meta.text("Latency", `${r.wan.latency} ms`, { icon: Icons.activity })] : []),
    ...(r.wan.totalDown ? [meta.text("Traffic", `↓ ${bytes(r.wan.totalDown)}  ↑ ${bytes(r.wan.totalUp)}`)] : []),
    meta.separator(),
    ...(r.model ? [meta.text("Model", r.model, { icon: Icons.server })] : []),
    ...(r.firmware ? [meta.text("Firmware", r.firmware, { icon: Icons.tag })] : []),
    ...(r.uptime !== undefined ? [meta.text("Up for", duration(r.uptime), { icon: Icons.clock })] : []),
    ...(r.cpu !== undefined ? [meta.progress("CPU", r.cpu)] : []),
    ...(r.memory !== undefined ? [meta.progress("Memory", r.memory)] : []),
    ...(r.temperature !== undefined
      ? [meta.text("Temperature", `${r.temperature} °C`, { icon: Icons.thermometer })]
      : []),
    meta.text("Clients", `${online} online, ${wifi} on Wi-Fi`, { icon: Icons.wifi }),
  ];
  return {
    id: "router",
    title: r.name,
    subtitle: [TITLES[r.kind], r.model].filter(Boolean).join(" · "),
    icon: { source: Icons.server, tint: r.wan.online ? "green" : "red" },
    section: "Router",
    keywords: [r.wan.ip ?? "", r.firmware ?? "", "wan", "internet", "router"],
    accessories: [
      ...(r.wan.down !== undefined
        ? [{ text: `↓ ${speed(r.wan.down)}  ↑ ${speed(r.wan.up)}`, icon: Icons.activity, tooltip: "Throughput now" }]
        : []),
      ...(r.uptime !== undefined ? [{ text: duration(r.uptime), icon: Icons.clock, tooltip: "Uptime" }] : []),
      { tag: r.wan.online ? "online" : "internet down", color: r.wan.online ? "green" : "red" },
    ],
    detail: {
      stats: [
        ...(r.wan.down !== undefined ? [{ label: "download", value: speed(r.wan.down) }] : []),
        ...(r.wan.up !== undefined ? [{ label: "upload", value: speed(r.wan.up) }] : []),
        { label: "clients", value: online },
      ],
      metadata: lines,
    },
    actions: [
      open(b.admin, `Open ${TITLES[r.kind]}`),
      ...(r.wan.ip ? [copy(r.wan.ip, "Copy Public IP", { shortcut: "<Ctrl><Shift>c" })] : []),
      action("Reboot Router", async () => {
        await b.reboot(r);
        await toast(`${r.name} is rebooting`, { message: "The network is back in a minute or two" });
      }, {
        icon: Icons.power,
        destructive: true,
        confirm: `Reboot ${r.name}? Every device loses the network for a minute or two`,
        section: "Router",
      }),
    ],
  };
}

function clientItem(b: Backend, c: Client): Item {
  const wifi = c.connection === "wifi";
  const tint = c.online === false ? "gray" : wifi ? signalColor(c.signal) ?? "blue" : "blue";
  const accessories: Accessory[] = [
    ...(c.blocked ? [{ tag: "blocked", color: "red" as const }] : []),
    ...(c.down !== undefined && c.down + (c.up ?? 0) > 1000
      ? [{ text: `↓ ${speed(c.down)}`, icon: Icons.activity, tooltip: `↓ ${speed(c.down)}  ↑ ${speed(c.up)}` }]
      : []),
    ...(c.band ? [{ tag: c.band, color: "gray" as const }] : []),
    ...(wifi && c.signal !== undefined
      ? [{ text: signalBars(c.signal), color: signalColor(c.signal), tooltip: `${c.signal} dBm` }]
      : []),
    ...(c.online === false && c.lastSeen ? [{ text: ago(c.lastSeen), icon: Icons.clock, tooltip: "Last seen" }] : []),
    ...(c.ip ? [{ text: c.ip }] : []),
  ];
  const lines: Metadata[] = [
    meta.text(
      "Status",
      c.online === true ? "Online" : c.online === false ? "Offline" : "DHCP lease",
      { icon: { source: Icons.dot, tint: c.online === true ? "green" : "gray" } },
    ),
    meta.text("Connection", wifi ? "Wi-Fi" : "Wired", { icon: wifi ? Icons.wifi : Icons.plug }),
    ...(c.ssid ? [meta.text("Network", c.ssid)] : []),
    ...(c.band ? [meta.text("Band", c.band)] : []),
    ...(c.signal !== undefined
      ? [meta.text("Signal", `${c.signal} dBm ${signalBars(c.signal)}`, { color: signalColor(c.signal) })]
      : []),
    ...(c.linkDown ? [meta.text("Link rate", `↓ ${bits(c.linkDown)}  ↑ ${bits(c.linkUp)}`)] : []),
    ...(c.down !== undefined ? [meta.text("Throughput", `↓ ${speed(c.down)}  ↑ ${speed(c.up)}`)] : []),
    ...(c.totalDown ? [meta.text("Traffic", `↓ ${bytes(c.totalDown)}  ↑ ${bytes(c.totalUp)}`)] : []),
    meta.separator(),
    ...(c.ip ? [meta.text("IPv4", c.ip, { icon: Icons.hash })] : []),
    ...(c.ip6 ? [meta.text("IPv6", c.ip6)] : []),
    meta.text("MAC", c.mac),
    ...(c.vendor ? [meta.text("Vendor", c.vendor)] : []),
    ...(c.network ? [meta.text("VLAN", c.network, { icon: Icons.layers })] : []),
    ...(c.uptime !== undefined ? [meta.text("Connected for", duration(c.uptime), { icon: Icons.clock })] : []),
    ...(c.lease !== undefined ? [meta.text("Lease ends in", duration(c.lease))] : []),
    ...(c.lastSeen ? [meta.text("Last seen", ago(c.lastSeen))] : []),
  ];
  const actions: Action[] = [
    ...(c.ip ? [copy(c.ip, "Copy IP Address")] : []),
    copy(c.mac, "Copy MAC Address", { shortcut: "<Ctrl><Shift>c" }),
    ...(c.ip ? [open(`http://${c.ip}`, "Open in Browser", { icon: Icons.globe, shortcut: "<Ctrl>o" })] : []),
    ...(c.name !== c.mac ? [copy(c.name, "Copy Name", { section: "Copy" })] : []),
  ];
  if (b.kick && wifi && c.online) {
    const kick = b.kick;
    actions.push(action("Reconnect Client", async () => {
      await kick(c.mac);
      await toast(`${c.name} disconnected`, { message: "It reconnects by itself in a few seconds" });
      return refresh();
    }, { icon: Icons.refresh, section: "Client" }));
  }
  if (b.block) {
    const block = b.block;
    actions.push(
      c.blocked
        ? action("Unblock Client", async () => {
          await block(c.mac, false);
          await toast(`${c.name} unblocked`, { style: "success" });
          return refresh();
        }, { icon: Icons.check, section: "Client" })
        : action("Block Client", async () => {
          await block(c.mac, true);
          await toast(`${c.name} blocked`);
          return refresh();
        }, {
          icon: Icons.cross,
          destructive: true,
          confirm: `Block ${c.name}? It can't use the network until you unblock it`,
          section: "Client",
        }),
    );
  }
  return {
    id: c.mac,
    title: c.name,
    subtitle: c.vendor && c.vendor !== c.name ? c.vendor : undefined,
    icon: { source: wifi ? Icons.wifi : Icons.plug, tint },
    section: section(c),
    keywords: [c.mac, c.ip ?? "", c.ip6 ?? "", c.ssid ?? "", c.vendor ?? "", c.band ?? "", wifi ? "wifi" : "wired"],
    accessories,
    detail: { metadata: lines },
    actions,
  };
}

// ---------------------------------------------------------------------------

const CONFIGURE = "**Settings → Extensions → Router → Configure**";

const GUIDE = [
  "### OpenWrt",
  "",
  "The address of LuCI (`http://192.168.1.1`), the user (`root` by default) and its password. Backslash signs in to ubus like LuCI does (`uhttpd-mod-ubus`, installed with LuCI).",
  "",
  "### UniFi",
  "",
  "The console's address (`https://192.168.1.1`), and an **API key**: UniFi Network → Settings → Control Plane → Integrations → Create API Key. Its certificate is self-signed: paste it as the certificate (see below).",
  "",
  "### Freebox",
  "",
  "`http://mafreebox.freebox.fr`, then run **Pair Freebox** and accept on the box's screen.",
].join("\n");

function setupItems(e: SetupError): Item[] {
  const guide: Record<SetupKind, { subtitle: string; icon: string; markdown: string }> = {
    url: { subtitle: "OpenWrt, UniFi or Freebox", icon: Icons.server, markdown: `## Connect your router\n\n${GUIDE}` },
    auth: {
      subtitle: "Password, API key or pairing",
      icon: Icons.key,
      markdown: `## Sign in\n\n${e.message}. Fix it in ${CONFIGURE}.\n\n${GUIDE}`,
    },
    permission: {
      subtitle: "The account lacks a right",
      icon: Icons.lock,
      markdown:
        `## Not allowed\n\n${e.message}.\n\n- **OpenWrt**: use \`root\`, or a user whose rpcd ACL allows \`system\`, \`network.*\`, \`iwinfo\` and \`luci-rpc\`.\n- **Freebox**: Freebox OS → Paramètres → Gestion des accès → Applications → Backslash → tick **Modification des réglages de la Freebox** (needed to reboot).`,
    },
    host: {
      subtitle: "Use the router's local address",
      icon: Icons.globe,
      markdown:
        "## Address out of reach\n\nThis extension may reach local names (`*.lan`, `*.local`, `*.home.arpa`…), `mafreebox.freebox.fr`, private networks (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) and Tailscale. Use the router's local address in " +
        CONFIGURE + ".",
    },
    tls: {
      subtitle: "Paste the router's certificate",
      icon: Icons.lock,
      markdown: [
        "## Self-signed HTTPS certificate",
        "",
        "Backslash can't skip certificate checks. Paste the router's certificate in " + CONFIGURE +
        " (**Certificate**), or use its `http://` address when it has one (OpenWrt, Freebox).",
        "",
        "To get it:",
        "",
        "```",
        "openssl s_client -connect 192.168.1.1:443 </dev/null 2>/dev/null | openssl x509",
        "```",
        "",
        "The certificate's name must match the address: use the name it was issued for if the IP doesn't work.",
      ].join("\n"),
    },
    down: {
      subtitle: "Is the address right?",
      icon: Icons.server,
      markdown: `## The router doesn't answer\n\nCheck that \`${
        e.base ?? "…"
      }\` opens in a browser, and the address in ${CONFIGURE}.`,
    },
    unknown: {
      subtitle: "OpenWrt, UniFi OS or Freebox OS",
      icon: Icons.question,
      markdown:
        `## Not recognized\n\n${e.message}.\n\nSet the kind (\`openwrt\`, \`unifi\` or \`freebox\`) in ${CONFIGURE}.\n\n${GUIDE}`,
    },
  };
  const g = guide[e.kind];
  return [{
    id: "setup",
    title: e.message,
    subtitle: g.subtitle,
    icon: { source: g.icon, tint: "orange" },
    detail: { markdown: g.markdown },
    actions: [
      ...(e.base && e.kind !== "host" ? [open(e.base, "Open Router", { icon: Icons.globe })] : []),
      action("Try Again", () => refresh(), { icon: Icons.refresh }),
    ],
  }];
}

let status = "";

export default list({
  placeholder: "Filter clients by name, IP, MAC, vendor…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "wifi", title: "Wi-Fi" },
      { value: "wired", title: "Wired" },
      { value: "offline", title: "Offline" },
    ],
    default: "all",
  },
  empty: {
    title: "No client here",
    description: "Devices connected to the router show up here",
    icon: Icons.wifi,
  },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : status,
  actions: [action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async items({ preferences, filter, signal }) {
    status = "";
    try {
      const b = backend(preferences);
      const { router, clients } = await b.load(signal);
      status = statusLine(router, clients);
      const online = clients.filter((c) => c.online !== false).length;
      updateCommandMetadata({ subtitle: router.wan.online ? `${online} online` : "Internet down" }).catch(() => {});
      const shown = clients.filter((c) =>
        filter === "wifi"
          ? c.connection === "wifi" && c.online !== false
          : filter === "wired"
          ? c.connection === "wired" && c.online !== false
          : filter === "offline"
          ? c.online === false
          : true
      );
      return [
        ...(filter === "all" || !filter ? [routerItem(b, router, clients)] : []),
        ...shown.map((c) => clientItem(b, c)),
      ];
    } catch (e) {
      if (signal.aborted) throw e;
      if (e instanceof SetupError) return setupItems(e);
      throw e;
    }
  },
});
