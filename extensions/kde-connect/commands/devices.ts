import {
  type Action,
  action,
  clipboard,
  close,
  type Context,
  copy,
  exec,
  field,
  form,
  Icons,
  type Item,
  list,
  meta,
  type Metadata,
  open,
  pop,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  activateArgs,
  ALL,
  batteryColor,
  type Device,
  DEVICE_PATH,
  deviceIcon,
  filePath,
  gsBattery,
  gsCapabilities,
  GSCONNECT,
  GSCONNECT_PATH,
  installHint,
  kdeCapabilities,
  type Param,
  parseCliList,
  parseDescribeAll,
  parseManagedObjects,
  parseProperties,
  phoneNumber,
  sortDevices,
  stateText,
  summary,
  TYPE_TITLES,
} from "../lib.ts";

const POLL_MS = 10_000;

const env = (k: string) => {
  try {
    return Deno.env.get(k);
  } catch {
    return undefined;
  }
};
const HOME = env("HOME");

// --- Backends ------------------------------------------------------------------

const KDE = "org.kde.kdeconnect";

async function busctl(args: string[]): Promise<string> {
  return await exec("busctl", ["--user", "--json=short", ...args]);
}

async function kdeDevices(): Promise<Device[] | undefined> {
  let out: string;
  try {
    out = await exec("kdeconnect-cli", ["-l"]);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable) return undefined;
    throw new Error(`kdeconnect-cli: ${e instanceof Error ? e.message : e}`);
  }
  const listed = parseCliList(out);
  return await Promise.all(listed.map(async (d): Promise<Device> => {
    const [props, battery] = await Promise.all([
      busctl(["get-property", KDE, DEVICE_PATH(d.id), `${KDE}.device`, "type", "supportedPlugins"])
        .then((o) => parseProperties(o, ["type", "supportedPlugins"])).catch(() => ({} as Record<string, unknown>)),
      d.reachable && d.paired
        ? busctl(["get-property", KDE, `${DEVICE_PATH(d.id)}/battery`, `${KDE}.device.battery`, "charge", "isCharging"])
          .then((o) => parseProperties(o, ["charge", "isCharging"])).catch(() => ({} as Record<string, unknown>))
        : Promise.resolve({} as Record<string, unknown>),
    ]);
    const level = typeof battery.charge === "number" && battery.charge >= 0 ? battery.charge : undefined;
    return {
      backend: "kdeconnect",
      ...d,
      type: typeof props.type === "string" ? props.type : undefined,
      battery: level !== undefined ? { level, charging: Boolean(battery.isCharging) } : undefined,
      can: kdeCapabilities(Array.isArray(props.supportedPlugins) ? props.supportedPlugins as string[] : undefined),
    };
  }));
}

async function gsDevices(): Promise<Device[] | undefined> {
  let out: string;
  try {
    out = await busctl(["call", GSCONNECT, GSCONNECT_PATH, "org.freedesktop.DBus.ObjectManager", "GetManagedObjects"]);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable) return undefined;
    // Not running, or not installed.
    return undefined;
  }
  return await Promise.all(
    parseManagedObjects(out).map(async (d): Promise<Device> => {
      const actions = d.reachable
        ? await busctl(["call", GSCONNECT, d.path!, "org.gtk.Actions", "DescribeAll"]).then(parseDescribeAll).catch(
          () => ({}),
        )
        : {};
      return { ...d, battery: gsBattery(actions), can: d.reachable ? gsCapabilities(actions) : ALL };
    }),
  );
}

interface Found {
  devices: Device[];
  backends: ("kdeconnect" | "gsconnect")[];
}

async function devices(): Promise<Found> {
  const [kde, gs] = await Promise.all([kdeDevices(), gsDevices()]);
  return {
    devices: sortDevices([...(kde ?? []), ...(gs ?? [])]),
    backends: [...(kde ? ["kdeconnect" as const] : []), ...(gs ? ["gsconnect" as const] : [])],
  };
}

// --- Device actions ------------------------------------------------------------

async function cli(d: Device, args: string[]) {
  await exec("kdeconnect-cli", ["-d", d.id, ...args]);
}

async function gs(d: Device, name: string, param?: Param) {
  await exec("busctl", activateArgs(d.path!, name, param));
}

const changes = new EventTarget();
const changed = () => changes.dispatchEvent(new Event("change"));

async function ring(d: Device) {
  if (d.backend === "kdeconnect") await cli(d, ["--ring"]);
  else await gs(d, "ring");
  return close(`Ringing ${d.name}`);
}

async function ping(d: Device, message?: string) {
  if (d.backend === "kdeconnect") await cli(d, message ? ["--ping-msg", message] : ["--ping"]);
  else await gs(d, "ping", message ? { type: "s", value: message } : undefined);
}

async function shareText(d: Device, text: string) {
  if (d.backend === "kdeconnect") await cli(d, ["--share-text", text]);
  else await gs(d, "shareText", { type: "s", value: text });
}

async function sendClipboard(d: Device) {
  if (!d.can.clipboard) {
    // Clipboard sync is off on this device: send it as text.
  } else if (d.backend === "kdeconnect") {
    // The clipboard plugin sends the desktop's clipboard itself (KDE Connect 23.08+).
    try {
      await exec("busctl", [
        "--user",
        "call",
        KDE,
        `${DEVICE_PATH(d.id)}/clipboard`,
        `${KDE}.device.clipboard`,
        "sendClipboard",
      ]);
      return close(`Clipboard sent to ${d.name}`);
    } catch {
      // Older KDE Connect: send it as text.
    }
  } else {
    try {
      await gs(d, "clipboardPush");
      return close(`Clipboard sent to ${d.name}`);
    } catch {
      // Clipboard sync off: send it as text.
    }
  }
  const text = await clipboard.read();
  if (!text) throw new Error("The clipboard is empty");
  await shareText(d, text);
  return close(`Clipboard sent to ${d.name}`);
}

async function browse(d: Device) {
  if (d.backend === "kdeconnect") {
    const out = await exec("busctl", [
      "--user",
      "--json=short",
      "call",
      KDE,
      `${DEVICE_PATH(d.id)}/sftp`,
      `${KDE}.device.sftp`,
      "startBrowsing",
    ]);
    if (/"data"\s*:\s*\[\s*false/.test(out)) {
      throw new Error(`${d.name} refused to share its files: allow storage access in the KDE Connect app`);
    }
  } else {
    await gs(d, "mount");
  }
  return close(`Opening the files of ${d.name}`);
}

function fileForm(d: Device) {
  return form({
    title: `Send a File to ${d.name}`,
    submitTitle: "Send",
    fields: [
      field.text("path", "File", { placeholder: "~/Downloads/photo.jpg", value: "~/", required: true }),
      ...(d.backend === "gsconnect" ? [field.checkbox("open", "Open it on the device")] : []),
    ],
    async submit(values) {
      const path = filePath(String(values.path ?? ""), HOME);
      if (!path.startsWith("/")) throw new Error("Enter the full path of the file, e.g. ~/Downloads/photo.jpg");
      if (path.endsWith("/")) throw new Error("That is a folder: add the file name");
      if (d.backend === "kdeconnect") await cli(d, ["--share", path]);
      else await gs(d, "shareFile", { type: "(sb)", value: [path, Boolean(values.open)] });
      await toast(`Sending ${path.split("/").pop()} to ${d.name}`, { style: "success" });
      return pop();
    },
  });
}

function smsForm(d: Device) {
  return form({
    title: `Send an SMS from ${d.name}`,
    submitTitle: "Send SMS",
    fields: [
      field.text("to", "To", { placeholder: "+33 6 12 34 56 78", required: true }),
      field.textArea("message", "Message", { required: true }),
    ],
    async submit(values) {
      const to = phoneNumber(String(values.to ?? ""));
      if (!to) throw new Error(`“${values.to}” is not a phone number`);
      const message = String(values.message ?? "").trim();
      if (!message) throw new Error("Write a message");
      if (d.backend === "kdeconnect") await cli(d, ["--send-sms", message, "--destination", to]);
      else await gs(d, "sendSms", { type: "(ss)", value: [to, message] });
      await toast(`SMS sent to ${to}`, { style: "success" });
      return pop();
    },
  });
}

function textForm(d: Device) {
  return form({
    title: `Send Text to ${d.name}`,
    submitTitle: "Send",
    fields: [field.textArea("text", "Text", { required: true, placeholder: "A link, an address, a code…" })],
    async submit(values) {
      const text = String(values.text ?? "");
      if (!text.trim()) throw new Error("Write something");
      await shareText(d, text);
      await toast(`Sent to ${d.name}`, { style: "success" });
      return pop();
    },
  });
}

function pingForm(d: Device) {
  return form({
    title: `Ping ${d.name}`,
    submitTitle: "Ping",
    fields: [field.text("message", "Message", { placeholder: "Optional" })],
    async submit(values) {
      await ping(d, String(values.message ?? "").trim() || undefined);
      return close(`Pinged ${d.name}`);
    },
  });
}

function deviceActions(d: Device): Action[] {
  if (!d.paired) {
    return d.backend === "kdeconnect"
      ? [action("Pair", async () => {
        await cli(d, ["--pair"]);
        await toast(`Accept the pairing request on ${d.name}`);
        changed();
      }, { icon: Icons.link })]
      : [];
  }
  const actions: Action[] = [];
  if (d.reachable) {
    if (d.can.ring) actions.push(action("Ring", () => ring(d), { icon: Icons.bell }));
    if (d.can.clipboard || d.can.share) {
      actions.push(action("Send Clipboard", () => sendClipboard(d), { icon: Icons.paste, shortcut: "<Ctrl>v" }));
    }
    if (d.can.share) {
      actions.push(
        action("Send File…", () => fileForm(d), { icon: Icons.upload, shortcut: "<Ctrl>f" }),
        action("Send Text…", () => textForm(d), { icon: Icons.text, shortcut: "<Ctrl>t" }),
      );
    }
    if (d.can.sms) actions.push(action("Send SMS…", () => smsForm(d), { icon: Icons.comment, shortcut: "<Ctrl>s" }));
    if (d.can.sftp) actions.push(action("Browse Files", () => browse(d), { icon: Icons.folder, shortcut: "<Ctrl>o" }));
    if (d.can.ping) {
      actions.push(
        action("Ping", async () => {
          await ping(d);
          return close(`Pinged ${d.name}`);
        }, { icon: Icons.bolt, section: "Ping" }),
        action("Ping with Message…", () => pingForm(d), { icon: Icons.comment, section: "Ping" }),
      );
    }
  }
  actions.push(
    action("Refresh", async () => {
      if (d.backend === "kdeconnect") await exec("kdeconnect-cli", ["--refresh"]).catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Device" }),
    copy(d.id, "Copy Device ID", { section: "Copy" }),
  );
  if (d.backend === "kdeconnect") {
    actions.push(action("Unpair", async () => {
      await cli(d, ["--unpair"]);
      await toast(`${d.name} unpaired`, { style: "success" });
      changed();
    }, {
      icon: Icons.cross,
      destructive: true,
      confirm: `Unpair ${d.name}? Pair again from the device`,
      section: "Danger",
    }));
  }
  return actions;
}

function deviceItem(d: Device): Item {
  const type = d.type ? TYPE_TITLES[d.type] ?? d.type : undefined;
  const tint = d.reachable && d.paired ? "green" as const : d.paired ? "gray" as const : "orange" as const;
  const b = d.battery;
  const metadata: Metadata[] = [
    meta.text("Status", stateText(d), {
      icon: { source: d.reachable ? Icons.wifi : Icons.wifiOff, tint },
      color: tint,
    }),
  ];
  if (b) {
    metadata.push(
      meta.progress("Battery", b.level / 100, `${b.level} %${b.charging ? " · charging" : ""}`),
    );
  }
  if (type) metadata.push(meta.text("Type", type, { icon: deviceIcon(d.type) }));
  metadata.push(
    meta.text("Paired", d.paired ? "Yes" : "No", { icon: Icons.link }),
    meta.text("Via", d.backend === "kdeconnect" ? "KDE Connect" : "GSConnect", { icon: Icons.plug }),
    meta.text("Device ID", d.id, { icon: Icons.hash }),
  );
  if (d.reachable && d.paired) {
    const can = [
      d.can.ring && "Ring",
      d.can.clipboard && "Clipboard",
      d.can.share && "Share",
      d.can.sms && "SMS",
      d.can.sftp && "Files",
      d.can.ping && "Ping",
    ].filter(Boolean) as string[];
    if (can.length) metadata.push(meta.tags("Can", can.map((c) => ({ text: c, color: "blue" as const }))));
  }
  return {
    id: `${d.backend}:${d.id}`,
    title: d.name,
    subtitle: stateText(d),
    icon: { source: deviceIcon(d.type), tint },
    section: d.paired ? (d.reachable ? "Connected" : "Paired") : "Available to Pair",
    keywords: [d.id, type ?? "", d.backend],
    accessories: [
      ...(b
        ? [{
          text: `${b.level} %`,
          icon: b.charging ? Icons.batteryCharging : Icons.battery,
          color: batteryColor(b.level, b.charging),
          tooltip: b.charging ? "Charging" : "Battery",
        }]
        : []),
      { tag: d.reachable && d.paired ? "Connected" : d.paired ? "Away" : "Not paired", color: tint },
    ],
    detail: {
      stats: b
        ? [
          { label: "Battery", value: `${b.level} %`, color: batteryColor(b.level, b.charging) },
          { label: "Power", value: b.charging ? "Charging" : "On battery" },
        ]
        : undefined,
      metadata,
    },
    actions: deviceActions(d),
  };
}

// --- Command -------------------------------------------------------------------

async function installItems(): Promise<Item[]> {
  const os = await Deno.readTextFile("/etc/os-release").catch(() => "");
  const desktop = env("XDG_CURRENT_DESKTOP") ?? "";
  const [command] = installHint(os, desktop);
  const gnome = /gnome/i.test(desktop);
  return [{
    id: "install",
    title: gnome ? "GSConnect is not running" : "KDE Connect is not installed",
    subtitle: `Install ${gnome ? "GSConnect" : "KDE Connect"}, then pair your phone`,
    icon: { source: Icons.apps, tint: "orange" },
    detail: {
      markdown: [
        `## ${gnome ? "GSConnect" : "KDE Connect"}`,
        "",
        "Links your phone to this computer: battery, ring, clipboard, files and SMS.",
        "",
        "```",
        command,
        "```",
        "",
        gnome
          ? "Then enable GSConnect in **Extensions**, install **KDE Connect** on the phone (Play Store, F-Droid or App Store) and pair from GSConnect's settings."
          : "Then install **KDE Connect** on the phone (Play Store, F-Droid or App Store), open it on the same network, and pair.",
      ].join("\n"),
    },
    actions: [
      copy(command, "Copy Install Command"),
      open(
        gnome ? "https://extensions.gnome.org/extension/1319/gsconnect/" : "https://kdeconnect.kde.org/download.html",
        gnome ? "Get GSConnect" : "Get KDE Connect",
        { icon: Icons.download },
      ),
    ],
  }];
}

export default (_ctx: Context) => {
  let shown = "";
  return list({
    placeholder: "Filter devices…",
    empty: {
      title: "No device",
      description: "Open KDE Connect on your phone, on the same network, and pair it",
      icon: Icons.apps,
    },
    status: () => shown,
    async *items({ signal }) {
      while (!signal.aborted) {
        const found = await devices();
        if (!found.backends.length) {
          shown = "";
          yield await installItems();
          return;
        }
        const up = found.devices.filter((d) => d.reachable && d.paired).length;
        shown = `${up} connected · ${found.devices.length} known · ${
          found.backends.map((b) => b === "kdeconnect" ? "KDE Connect" : "GSConnect").join(" + ")
        }`;
        updateCommandMetadata({ subtitle: summary(found.devices) }).catch(() => {});
        yield found.devices.map(deviceItem);
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            changes.removeEventListener("change", done);
            signal.removeEventListener("abort", done);
            resolve();
          };
          const timer = setTimeout(done, POLL_MS);
          changes.addEventListener("change", done);
          signal.addEventListener("abort", done);
        });
      }
    },
  });
};
