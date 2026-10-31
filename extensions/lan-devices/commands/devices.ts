import {
  type Action,
  action,
  close,
  type Color,
  copy,
  detail,
  Icons,
  type Item,
  list,
  meta,
  open,
} from "@backslash/api";
import {
  type Device,
  displayName,
  hasService,
  type Kind,
  kindOf,
  parsePing,
  serviceLabel,
  SERVICES,
  serviceTags,
  webUrl,
} from "../lib.ts";
import { devices, ping } from "../system.ts";
import { runInTerminal } from "../terminal.ts";

const ICON: Record<Kind, { source: string; tint: Color; label: string }> = {
  this: { source: Icons.monitor, tint: "purple", label: "This computer" },
  router: { source: Icons.wifi, tint: "teal", label: "Router" },
  printer: { source: Icons.printer, tint: "blue", label: "Printer" },
  tv: { source: Icons.film, tint: "pink", label: "TV or streamer" },
  speaker: { source: Icons.speaker, tint: "orange", label: "Speaker" },
  phone: { source: Icons.smile, tint: "green", label: "Phone or tablet" },
  computer: { source: Icons.monitor, tint: "blue", label: "Computer" },
  nas: { source: Icons.server, tint: "blue", label: "NAS" },
  camera: { source: Icons.camera, tint: "red", label: "Camera" },
  smart: { source: Icons.lightbulb, tint: "yellow", label: "Smart home" },
  device: { source: Icons.dot, tint: "gray", label: "Device" },
};

type Prefs = Record<string, unknown>;

function pingAction(d: Device): Action {
  return action("Ping", async () => {
    const out = await ping(d.ip);
    const r = parsePing(out);
    return detail({
      title: `Ping ${displayName(d)}`,
      markdown: `\`\`\`\n${out.trim()}\n\`\`\``,
      stats: r
        ? [
          { label: "Received", value: `${r.received}/${r.sent}`, color: r.received ? "green" : "red" },
          { label: "Loss", value: `${r.loss} %`, color: r.loss ? (r.loss === 100 ? "red" : "orange") : "green" },
          ...(r.avg !== undefined ? [{ label: "Average", value: `${r.avg.toFixed(1)} ms` }] : []),
        ]
        : [],
      actions: [pingAction(d), copy(d.ip, "Copy IP Address")],
    });
  }, { icon: Icons.activity, shortcut: "<Ctrl>p" });
}

function sshAction(d: Device, prefs: Prefs): Action {
  const user = String(prefs.sshUser ?? "").trim();
  const target = `${user ? `${user}@` : ""}${d.ip}`;
  return action("SSH in Terminal", () => {
    const term = runInTerminal(["ssh", target], String(prefs.terminal ?? "") || undefined);
    return close(`ssh ${target} in ${term}`);
  }, { icon: Icons.terminal, shortcut: "<Ctrl>s" });
}

function wolView(d: Device) {
  const mac = d.mac!;
  return action("Wake-on-LAN…", () =>
    detail({
      title: `Wake ${displayName(d)}`,
      markdown: [
        `To switch **${
          displayName(d)
        }** on from here when it sleeps or is off, send a *magic packet* to its MAC address:`,
        "",
        "```",
        `wakeonlan ${mac}`,
        "```",
        "",
        "Or add it in the **Wake on LAN** extension (Add from Network), which also tells when it comes up.",
        "",
        "It only works when the device allows it: *Wake on LAN* enabled in its BIOS or firmware, and on Linux " +
        `\`sudo ethtool -s <interface> wol g\`. Wi-Fi devices rarely support it.`,
        ...(d.randomMac
          ? [
            "",
            "**Note:** this device uses a **random (private) MAC address**, which changes: waking it this way won't work.",
          ]
          : []),
      ].join("\n"),
      metadata: [meta.text("MAC address", mac, { icon: Icons.hash }), meta.text("IP address", d.ip)],
      actions: [copy(`wakeonlan ${mac}`, "Copy Command"), copy(mac, "Copy MAC Address")],
    }), { icon: Icons.power, section: "Device" });
}

function row(d: Device, prefs: Prefs): Item {
  const kind = kindOf(d);
  const icon = ICON[kind];
  const name = displayName(d);
  const tags = serviceTags(d);
  const web = d.services.some((s) => SERVICES[s.type]?.web);
  const ssh = hasService(d, "_ssh._tcp") || hasService(d, "_sftp-ssh._tcp");
  const subtitle = [
    name !== d.ip ? d.ip : undefined,
    d.model ?? d.vendor ?? (d.randomMac ? "private address" : undefined),
  ]
    .filter(Boolean).join(" · ");
  const state = d.state ?? (d.swept ? "answered" : undefined);
  const services = d.services.filter((s, i, all) => all.findIndex((x) => x.type === s.type && x.port === s.port) === i);

  const actions: Action[] = [
    open(webUrl(d), web ? "Open Web Page" : `Open http://${d.ip}`, { icon: Icons.globe }),
    copy(d.ip, "Copy IP Address", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(d.mac ? [copy(d.mac, "Copy MAC Address", { shortcut: "<Ctrl><Shift>m", section: "Copy" })] : []),
    ...(d.hostname ? [copy(d.hostname, "Copy Host Name", { section: "Copy" })] : []),
    ...d.ipv6.map((ip) => copy(ip, `Copy ${ip}`, { section: "Copy" })),
    pingAction(d),
    sshAction(d, prefs),
    ...(d.mac ? [wolView(d)] : []),
  ];
  // Devices announcing SSH but no web page: SSH is what people want, Enter.
  if (ssh && !web) actions.unshift(actions.splice(actions.findIndex((a) => a.title === "SSH in Terminal"), 1)[0]);

  return {
    id: d.mac ?? d.ip,
    title: name,
    subtitle: subtitle || undefined,
    icon: { source: icon.source, tint: icon.tint },
    section: d.self || d.gateway ? "This Network" : undefined,
    keywords: [d.ip, d.mac ?? "", d.hostname ?? "", d.vendor ?? "", d.model ?? "", icon.label, ...tags, ...d.ipv6],
    accessories: [
      ...(d.self ? [{ tag: "this computer", color: "purple" as Color }] : []),
      ...(d.gateway ? [{ tag: "router", color: "teal" as Color }] : []),
      ...tags.map((t) => ({ tag: t, color: "gray" as Color })),
      ...(state
        ? [{
          icon: { source: Icons.dot, tint: (/reachable|answered|permanent/.test(state) ? "green" : "gray") as Color },
          tooltip: `Neighbor state: ${state}`,
        }]
        : []),
    ],
    detail: {
      metadata: [
        meta.text("Kind", icon.label, { icon: icon.source }),
        meta.text("IP address", d.ip, { icon: Icons.globe }),
        ...d.ipv6.map((ip) => meta.text("IPv6", ip)),
        ...(d.hostname ? [meta.text("Host name", d.hostname, { icon: Icons.tag })] : []),
        ...(d.label && d.label !== d.hostname ? [meta.text("Announced as", d.label)] : []),
        ...(d.mac ? [meta.text("MAC address", d.mac, { icon: Icons.hash })] : []),
        ...(d.vendor ? [meta.text("Vendor", d.vendor)] : []),
        ...(d.randomMac ? [meta.text("Vendor", "Unknown: a random (private) MAC address")] : []),
        ...(d.model ? [meta.text("Model", d.model)] : []),
        ...(d.dev ? [meta.text("Interface", d.dev, { icon: Icons.plug })] : []),
        ...(state ? [meta.text("State", state)] : []),
        ...(services.length
          ? [
            meta.separator(),
            ...services.map((s) => meta.text(serviceLabel(s.type), `${s.name}${s.port ? ` · port ${s.port}` : ""}`)),
          ]
          : []),
      ],
    },
    actions,
  };
}

let status = "";

export default list({
  placeholder: "Filter by name, address, vendor or service…",
  filter: {
    options: [
      { value: "known", title: "Known" },
      { value: "sweep", title: "Scan Network" },
    ],
  },
  empty: {
    title: "No device found",
    description: "Only devices this computer talked to recently are listed: press Tab for Scan Network to look for all",
    icon: Icons.wifi,
  },
  status: () => status,
  async *items({ filter, preferences, signal }) {
    status = "Looking around…";
    const known = await devices({ sweep: false, signal });
    status = `${known.length} device${known.length === 1 ? "" : "s"}`;
    yield known.map((d) => row(d, preferences));
    if (filter !== "sweep" || signal.aborted) return;
    status = `${known.length} devices · scanning the network…`;
    yield known.map((d) => row(d, preferences));
    const all = await devices({ sweep: true, signal });
    if (signal.aborted) return;
    status = `${all.length} device${all.length === 1 ? "" : "s"} · scanned`;
    yield all.map((d) => row(d, preferences));
  },
});
