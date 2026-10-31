import {
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
  type Alert,
  ALERT_LOOK,
  bytes,
  type Container,
  type Dataset,
  type Disk,
  duration,
  HEALTH,
  type Nas,
  type Share,
  summary,
  usage,
  usageColor,
  type Volume,
} from "../lib.ts";
import type { SetupKind } from "../net.ts";

const percent = (r: number | undefined) => r === undefined ? "" : `${Math.round(r * 100)} %`;

function systemItem(b: Backend, nas: Nas): Item {
  const s = nas.system;
  const used = nas.volumes.reduce((n, v) => n + (v.used ?? 0), 0);
  const total = nas.volumes.reduce((n, v) => n + (v.total ?? 0), 0);
  const worst = nas.alerts.some((a) => a.level === "critical")
    ? "error"
    : nas.alerts.some((a) => a.level === "warning")
    ? "warning"
    : "ok";
  const look = HEALTH[worst];
  const lines: Metadata[] = [
    meta.text(
      "Health",
      worst === "ok" ? "Healthy" : `${nas.alerts.length} alert${nas.alerts.length === 1 ? "" : "s"}`,
      {
        icon: { source: Icons.dot, tint: look.color },
        color: look.color,
      },
    ),
    ...(total ? [meta.progress("Storage", used / total, `${bytes(used)} of ${bytes(total)}`)] : []),
    ...(s.cpu !== undefined ? [meta.progress("CPU", s.cpu)] : []),
    ...(s.memory !== undefined ? [meta.progress("Memory", s.memory)] : []),
    meta.separator(),
    ...(s.model ? [meta.text("Model", s.model, { icon: Icons.server })] : []),
    ...(s.version ? [meta.text("Version", s.version, { icon: Icons.tag })] : []),
    ...(s.uptime !== undefined ? [meta.text("Up for", duration(s.uptime), { icon: Icons.clock })] : []),
    ...(s.ram ? [meta.text("RAM", bytes(s.ram))] : []),
    ...(s.temperature ? [meta.text("Temperature", `${s.temperature} °C`, { icon: Icons.thermometer })] : []),
    meta.text("Disks", String(nas.disks.length), { icon: Icons.drive }),
    ...(nas.containers.length
      ? [
        meta.text(
          "Containers",
          `${nas.containers.filter((c) => c.running).length} of ${nas.containers.length} running`,
          {
            icon: Icons.box,
          },
        ),
      ]
      : []),
  ];
  return {
    id: "system",
    title: s.name,
    subtitle: [TITLES[nas.kind], s.model, s.version].filter(Boolean).join(" · "),
    icon: { source: Icons.server, tint: look.color },
    section: "System",
    keywords: [TITLES[nas.kind], s.model ?? "", s.version ?? ""],
    accessories: [
      ...(total ? [{ text: `${percent(used / total)} used`, color: usageColor(used / total) }] : []),
      ...(s.uptime !== undefined ? [{ text: duration(s.uptime), icon: Icons.clock, tooltip: "Uptime" }] : []),
      { tag: worst === "ok" ? "healthy" : look.label.toLowerCase(), color: look.color },
    ],
    detail: {
      stats: [
        ...(total ? [{ label: "used", value: percent(used / total), color: usageColor(used / total) }] : []),
        ...(total ? [{ label: "free", value: bytes(total - used) }] : []),
        { label: "alerts", value: nas.alerts.length, color: worst === "ok" ? undefined : look.color },
      ],
      metadata: lines,
    },
    actions: [open(b.admin, `Open ${TITLES[nas.kind]}`), action("Refresh", () => refresh(), { icon: Icons.refresh })],
  };
}

function alertItem(b: Backend, a: Alert): Item {
  const look = ALERT_LOOK[a.level];
  const actions: Action[] = [
    open(b.admin, `Open ${TITLES[b.kind]}`),
    copy([a.title, a.message].filter(Boolean).join("\n"), "Copy Alert"),
  ];
  if (b.dismissAlert && a.id && a.key.startsWith("alert:")) {
    const dismiss = b.dismissAlert, id = a.id;
    actions.push(action("Dismiss Alert", async () => {
      await dismiss(id);
      await toast("Alert dismissed");
      return refresh();
    }, { icon: Icons.check, shortcut: "<Ctrl>d" }));
  }
  return {
    id: a.key,
    title: a.title,
    subtitle: a.message,
    icon: { source: a.level === "info" ? Icons.info : Icons.alert, tint: look.color },
    section: "Alerts",
    keywords: [look.label],
    accessories: [
      ...(a.time ? [{ text: ago(a.time), icon: Icons.clock }] : []),
      { tag: look.label, color: look.color },
    ],
    detail: {
      markdown: [`**${a.title}**`, a.message ?? ""].filter(Boolean).join("\n\n"),
      metadata: [
        meta.text("Level", look.label, { icon: { source: Icons.dot, tint: look.color }, color: look.color }),
        ...(a.time ? [meta.text("Raised", new Date(a.time).toLocaleString("en-GB"), { icon: Icons.clock })] : []),
      ],
    },
    actions,
  };
}

function volumeItem(b: Backend, v: Volume): Item {
  const look = HEALTH[v.health];
  const ratio = usage(v);
  return {
    id: v.key,
    title: v.name,
    subtitle: v.type,
    icon: { source: Icons.database, tint: v.health === "ok" ? usageColor(ratio) ?? "green" : look.color },
    section: "Storage",
    keywords: [v.type, v.status, ...v.details.map(([, value]) => value)],
    accessories: [
      ...(ratio !== undefined
        ? [{ text: `${bytes(v.used)} / ${bytes(v.total)}`, tooltip: "Used / size" }, {
          text: percent(ratio),
          color: usageColor(ratio),
        }]
        : []),
      ...(v.health !== "ok" ? [{ tag: v.status, color: look.color }] : []),
    ],
    detail: {
      stats: [
        ...(ratio !== undefined ? [{ label: "used", value: percent(ratio), color: usageColor(ratio) }] : []),
        ...(v.total ? [{ label: "free", value: bytes(v.total - (v.used ?? 0)) }] : []),
        { label: "health", value: look.label, color: look.color },
      ],
      metadata: [
        meta.text("Status", v.status, { icon: { source: Icons.dot, tint: look.color }, color: look.color }),
        ...(ratio !== undefined ? [meta.progress("Used", ratio, `${bytes(v.used)} of ${bytes(v.total)}`)] : []),
        ...v.details.map(([label, value]) => meta.text(label, value)),
      ],
    },
    actions: [open(b.admin, `Open ${TITLES[b.kind]}`), copy(v.name, "Copy Name")],
  };
}

function diskItem(b: Backend, d: Disk): Item {
  const look = HEALTH[d.health];
  const ratio = usage(d);
  const hot = d.temperature !== undefined && d.temperature >= 50;
  return {
    id: d.key,
    title: d.name,
    subtitle: [d.role, d.model].filter(Boolean).join(" · "),
    icon: { source: Icons.drive, tint: look.color },
    section: "Disks",
    keywords: [d.model ?? "", d.role ?? "", d.status],
    accessories: [
      ...(d.errors ? [{ tag: `${d.errors} errors`, color: "orange" as const }] : []),
      ...(ratio !== undefined ? [{ text: percent(ratio), color: usageColor(ratio), tooltip: "Used" }] : []),
      ...(d.size ? [{ text: bytes(d.size) }] : []),
      ...(d.temperature !== undefined
        ? [{ text: `${d.temperature} °C`, icon: Icons.thermometer, color: hot ? "orange" as const : undefined }]
        : []),
      ...(d.health !== "ok" ? [{ tag: d.status, color: look.color }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Status", d.status, { icon: { source: Icons.dot, tint: look.color }, color: look.color }),
        ...(d.role ? [meta.text("Role", d.role)] : []),
        ...(d.model ? [meta.text("Model", d.model)] : []),
        ...(d.size ? [meta.text("Size", bytes(d.size))] : []),
        ...(ratio !== undefined ? [meta.progress("Used", ratio, `${bytes(d.used)} of ${bytes(d.total)}`)] : []),
        ...(d.temperature !== undefined
          ? [
            meta.text("Temperature", `${d.temperature} °C`, {
              icon: Icons.thermometer,
              color: hot ? "orange" : undefined,
            }),
          ]
          : []),
        ...(d.errors !== undefined ? [meta.text("Errors", String(d.errors))] : []),
      ],
    },
    actions: [open(b.admin, `Open ${TITLES[b.kind]}`), copy(d.name, "Copy Name")],
  };
}

function datasetItem(b: Backend, d: Dataset): Item {
  const total = d.available !== undefined ? d.used + d.available : undefined;
  const ratio = total ? d.used / total : undefined;
  return {
    id: d.key,
    title: d.name,
    subtitle: d.mountpoint,
    icon: { source: d.locked ? Icons.lock : Icons.folder, tint: d.locked ? "orange" : "blue" },
    section: "Datasets",
    keywords: [d.mountpoint ?? "", d.encrypted ? "encrypted" : ""],
    accessories: [
      ...(d.encrypted ? [{ icon: { source: Icons.lock, tint: d.locked ? "orange" as const : "gray" as const } }] : []),
      { text: bytes(d.used), tooltip: "Used" },
      ...(d.available !== undefined ? [{ text: `${bytes(d.available)} free`, color: usageColor(ratio) }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Used", bytes(d.used)),
        ...(d.available !== undefined ? [meta.text("Available", bytes(d.available))] : []),
        ...(ratio !== undefined ? [meta.progress("Of what it may use", ratio)] : []),
        ...(d.mountpoint ? [meta.text("Mount point", d.mountpoint, { icon: Icons.folder })] : []),
        meta.text("Encrypted", d.encrypted ? (d.locked ? "Yes, locked" : "Yes, unlocked") : "No", { icon: Icons.lock }),
      ],
    },
    actions: [
      open(`${b.base}/ui/datasets`, "Open Datasets"),
      ...(d.mountpoint ? [copy(d.mountpoint, "Copy Mount Point")] : []),
    ],
  };
}

function shareItem(b: Backend, s: Share, host: string): Item {
  const url = s.protocol === "SMB" ? `smb://${host}/${s.name}` : `${host}:${s.path}`;
  return {
    id: s.key,
    title: s.name,
    subtitle: s.comment ?? s.path,
    icon: { source: Icons.folder, tint: s.enabled ? "blue" : "gray" },
    section: "Shares",
    keywords: [s.path, s.protocol, s.comment ?? ""],
    accessories: [
      { tag: s.protocol, color: "gray" },
      ...(!s.enabled ? [{ tag: "disabled", color: "gray" as const }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Protocol", s.protocol),
        meta.text("Path", s.path, { icon: Icons.folder }),
        meta.text("Address", url, { icon: Icons.link }),
        meta.text("Enabled", s.enabled ? "Yes" : "No"),
        ...(s.comment ? [meta.text("Comment", s.comment)] : []),
      ],
    },
    actions: [
      ...(s.protocol === "SMB" ? [open(url, "Open in Files")] : []),
      copy(url, s.protocol === "SMB" ? "Copy SMB Address" : "Copy NFS Export"),
      copy(s.path, "Copy Path"),
      open(b.kind === "truenas" ? `${b.base}/ui/sharing` : b.admin, `Open ${TITLES[b.kind]} Shares`, {
        icon: Icons.window,
        section: "Open",
      }),
    ],
  };
}

function containerItem(b: Backend, c: Container): Item {
  const actions: Action[] = [open(`${b.base}/Docker`, "Open Docker Tab")];
  if (b.setContainer) {
    const set = b.setContainer;
    actions.push(
      c.running
        ? action("Stop Container", async () => {
          await set(c.id, false);
          await toast(`${c.name} stopped`);
          return refresh();
        }, { icon: Icons.stop, destructive: true, confirm: `Stop ${c.name}?`, shortcut: "<Ctrl>s" })
        : action("Start Container", async () => {
          await set(c.id, true);
          await toast(`${c.name} started`, { style: "success" });
          return refresh();
        }, { icon: Icons.play, shortcut: "<Ctrl>s" }),
    );
  }
  actions.push(copy(c.image, "Copy Image"));
  return {
    id: `ct:${c.id}`,
    title: c.name,
    subtitle: c.image,
    icon: { source: Icons.box, tint: c.running ? "green" : "gray" },
    section: "Containers",
    keywords: [c.image, c.state],
    accessories: [
      ...(c.status ? [{ text: c.status }] : []),
      { tag: c.state, color: c.running ? "green" : "gray" },
    ],
    detail: {
      metadata: [
        meta.text("State", c.state, { icon: { source: Icons.dot, tint: c.running ? "green" : "gray" } }),
        ...(c.status ? [meta.text("Status", c.status)] : []),
        meta.text("Image", c.image, { icon: Icons.package }),
        ...(c.autoStart !== undefined ? [meta.text("Autostart", c.autoStart ? "Yes" : "No")] : []),
      ],
    },
    actions,
  };
}

// ---------------------------------------------------------------------------

const CONFIGURE = "**Settings → Extensions → NAS → Configure**";

const HOW = [
  "- **TrueNAS**: its `https://` address and an API key (top-right user menu → **My API Keys** → Add). TrueNAS revokes keys used over plain HTTP.",
  "- **Synology**: the DSM address (`http://192.168.1.20:5000`), an administrator account and its password. Accounts with 2-step verification can't sign in from here: create one for Backslash.",
  "- **Unraid** 7.2 or later (or the Unraid Connect plugin): its address and an API key (**Settings → Management Access → API Keys**).",
].join("\n");

function setupItems(e: SetupError): Item[] {
  const guide: Record<SetupKind, string> = {
    url: `## Connect your NAS\n\nIn ${CONFIGURE}:\n\n${HOW}`,
    auth: `## Sign in\n\n${e.message}.\n\n${HOW}`,
    permission: `## Not allowed\n\n${e.message}. Use an administrator account.`,
    host:
      "## Address out of reach\n\nThis extension may reach local names (`*.local`, `*.lan`, `*.home.arpa`…), private networks (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) and Tailscale. Use the NAS's local address in " +
      CONFIGURE + ".",
    tls: [
      "## Self-signed HTTPS certificate",
      "",
      `Backslash can't skip certificate checks. Paste the NAS's certificate (PEM) as **Certificate** in ${CONFIGURE} (TrueNAS: Credentials → Certificates → download), or use its \`http://\` address (Synology, Unraid).`,
      "",
      "The certificate's name must match the address you use.",
    ].join("\n"),
    down: `## The NAS doesn't answer\n\nCheck that \`${
      e.base ?? "…"
    }\` opens in a browser, and the address in ${CONFIGURE}.`,
    unknown:
      `## Not recognized\n\n${e.message}.\n\nSet the kind (\`truenas\`, \`synology\` or \`unraid\`) in ${CONFIGURE}.\n\n${HOW}`,
  };
  return [{
    id: "setup",
    title: e.message,
    subtitle: e.kind === "url" ? "TrueNAS, Synology or Unraid" : "Settings → Extensions → NAS → Configure",
    icon: { source: e.kind === "auth" ? Icons.key : Icons.server, tint: "orange" },
    detail: { markdown: guide[e.kind] },
    actions: [
      ...(e.base && e.kind !== "host" ? [open(e.base, "Open NAS", { icon: Icons.globe })] : []),
      action("Try Again", () => refresh(), { icon: Icons.refresh }),
    ],
  }];
}

let status = "";

export default list({
  placeholder: "Filter pools, disks, shares, containers…",
  filter: {
    options: [
      { value: "all", title: "Overview" },
      { value: "problems", title: "Problems" },
      { value: "storage", title: "Storage" },
      { value: "shares", title: "Shares" },
    ],
    default: "all",
  },
  empty: { title: "Nothing here", description: "No problem to report, or nothing of this kind", icon: Icons.server },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : status,
  actions: [action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async items({ preferences, filter, signal }) {
    status = "";
    try {
      const b = await backend(preferences, signal);
      const nas = await b.load(signal);
      status = `${TITLES[nas.kind]} · ${summary(nas)}`;
      updateCommandMetadata({ subtitle: summary(nas) }).catch(() => {});
      const host = new URL(b.base).hostname;
      const alerts = [...nas.alerts].sort((x, y) =>
        ["critical", "warning", "info"].indexOf(x.level) - ["critical", "warning", "info"].indexOf(y.level)
      );
      if (filter === "problems") {
        return [
          ...alerts.filter((a) => a.level !== "info").map((a) => alertItem(b, a)),
          ...nas.volumes.filter((v) => v.health !== "ok").map((v) => volumeItem(b, v)),
          ...nas.disks.filter((d) => d.health === "warning" || d.health === "error").map((d) => diskItem(b, d)),
        ];
      }
      if (filter === "shares") return nas.shares.map((s) => shareItem(b, s, host));
      if (filter === "storage") {
        return [
          ...nas.volumes.map((v) => volumeItem(b, v)),
          ...nas.datasets.map((d) => datasetItem(b, d)),
          ...nas.disks.map((d) => diskItem(b, d)),
        ];
      }
      return [
        ...alerts.map((a) => alertItem(b, a)),
        systemItem(b, nas),
        ...nas.volumes.map((v) => volumeItem(b, v)),
        ...nas.disks.map((d) => diskItem(b, d)),
        ...nas.datasets.map((d) => datasetItem(b, d)),
        ...nas.shares.map((s) => shareItem(b, s, host)),
        ...nas.containers.map((c) => containerItem(b, c)),
      ];
    } catch (e) {
      if (signal.aborted) throw e;
      if (e instanceof SetupError) {
        updateCommandMetadata({ subtitle: null }).catch(() => {});
        return setupItems(e);
      }
      throw e;
    }
  },
});
