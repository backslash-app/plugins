// KDE Connect (kdeconnect-cli, D-Bus) and GSConnect (D-Bus) outputs. No I/O here.

import type { Color } from "@backslash/api";
import { Icons } from "@backslash/api";

export type Backend = "kdeconnect" | "gsconnect";

export interface Device {
  backend: Backend;
  id: string;
  name: string;
  /** smartphone, phone, tablet, desktop, laptop, tv */
  type?: string;
  paired: boolean;
  reachable: boolean;
  battery?: { level: number; charging: boolean };
  /** What the device can do here. */
  can: Capabilities;
  /** GSConnect's D-Bus object. */
  path?: string;
}

export interface Capabilities {
  ring: boolean;
  ping: boolean;
  share: boolean;
  sms: boolean;
  sftp: boolean;
  /** The clipboard plugin pushes the desktop's clipboard itself. */
  clipboard: boolean;
}

export const ALL: Capabilities = { ring: true, ping: true, share: true, sms: true, sftp: true, clipboard: true };

// ---------------------------------------------------------------------------
// KDE Connect

/**
 * `kdeconnect-cli -l`: `- Pixel 8: 1a2b3c4d_5e6f (paired and reachable)`, or with
 * `--id-name-only`: `1a2b3c4d_5e6f Pixel 8` (no state then).
 */
export function parseCliList(out: string): Pick<Device, "id" | "name" | "paired" | "reachable">[] {
  const devices: Pick<Device, "id" | "name" | "paired" | "reachable">[] = [];
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    const full = /^-\s+(.+):\s+(\S+)\s+\(([^)]*)\)$/.exec(line);
    if (full) {
      const state = full[3];
      devices.push({
        name: full[1],
        id: full[2],
        paired: /\bpaired\b/.test(state) && !/\bnot paired\b|\bunpaired\b/.test(state),
        reachable: /\breachable\b/.test(state) && !/\bnot reachable\b|\bunreachable\b/.test(state),
      });
      continue;
    }
    const short = /^([0-9a-zA-Z_-]{6,})\s+(.+)$/.exec(line);
    if (short && !/devices? found/.test(line)) {
      devices.push({ id: short[1], name: short[2], paired: true, reachable: true });
    }
  }
  return devices;
}

/** `busctl --json=short get-property … p1 p2`: one `{"type","data"}` per line, in order. */
export function parseProperties(out: string, names: string[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  out.split("\n").filter((l) => l.trim()).forEach((line, i) => {
    if (i >= names.length) return;
    try {
      values[names[i]] = (JSON.parse(line) as { data: unknown }).data;
    } catch {
      // Not JSON: skip.
    }
  });
  return values;
}

/** `supportedPlugins` (KDE Connect names) to what the actions need. */
export function kdeCapabilities(plugins: string[] | undefined): Capabilities {
  if (!plugins) return ALL;
  const has = (p: string) => plugins.includes(`kdeconnect_${p}`);
  return {
    ring: has("findmyphone"),
    ping: has("ping"),
    share: has("share"),
    sms: has("sms"),
    sftp: has("sftp"),
    clipboard: has("clipboard"),
  };
}

export const DEVICE_PATH = (id: string) => `/modules/kdeconnect/devices/${id}`;

// ---------------------------------------------------------------------------
// GSConnect

export const GSCONNECT = "org.gnome.Shell.Extensions.GSConnect";
export const GSCONNECT_PATH = "/org/gnome/Shell/Extensions/GSConnect";
const GS_DEVICE = `${GSCONNECT}.Device`;

type Variant = { type: string; data: unknown };

/** `busctl --json=short call … GetManagedObjects`: the devices GSConnect knows. */
export function parseManagedObjects(json: string): Omit<Device, "can" | "battery">[] {
  const body = JSON.parse(json) as { data: unknown[] };
  const objects = (body.data?.[0] ?? {}) as Record<string, Record<string, Record<string, Variant>>>;
  const devices: Omit<Device, "can" | "battery">[] = [];
  for (const [path, ifaces] of Object.entries(objects)) {
    const props = ifaces[GS_DEVICE];
    if (!props) continue;
    const v = (k: string) => props[k]?.data;
    devices.push({
      backend: "gsconnect",
      id: String(v("Id") ?? path.split("/").pop()),
      name: String(v("Name") ?? "Device"),
      type: v("Type") ? String(v("Type")) : undefined,
      paired: Boolean(v("Paired")),
      reachable: Boolean(v("Connected")),
      path,
    });
  }
  return devices;
}

export interface GAction {
  enabled: boolean;
  state?: Variant;
}

/** `org.gtk.Actions.DescribeAll`: `a{s(bgav)}`, name → enabled, parameter type, state. */
export function parseDescribeAll(json: string): Record<string, GAction> {
  const body = JSON.parse(json) as { data: unknown[] };
  const all = (body.data?.[0] ?? {}) as Record<string, [boolean, string, Variant[]]>;
  return Object.fromEntries(
    Object.entries(all).map(([name, [enabled, , state]]) => [name, { enabled: Boolean(enabled), state: state?.[0] }]),
  );
}

/** GSConnect's battery action keeps `(bsii)`: charging, icon name, level, time. */
export function gsBattery(actions: Record<string, GAction>): Device["battery"] {
  const s = actions.battery?.state;
  if (!s || !Array.isArray(s.data)) return undefined;
  const [charging, , level] = s.data as [boolean, string, number];
  if (typeof level !== "number" || level < 0) return undefined;
  return { level, charging: Boolean(charging) };
}

export function gsCapabilities(actions: Record<string, GAction>): Capabilities {
  const on = (n: string) => actions[n]?.enabled ?? false;
  return {
    ring: on("ring"),
    ping: on("ping"),
    share: on("shareFile") || on("shareText"),
    sms: on("sendSms"),
    sftp: on("mount"),
    clipboard: on("clipboardPush"),
  };
}

export type Param = { type: "s"; value: string } | { type: "(sb)"; value: [string, boolean] } | {
  type: "(ss)";
  value: [string, string];
};

/** `busctl call` arguments activating a GSConnect device action (`org.gtk.Actions.Activate sava{sv}`). */
export function activateArgs(path: string, action: string, param?: Param): string[] {
  const p = param
    ? ["1", param.type, ...(Array.isArray(param.value) ? param.value.map(String) : [param.value])]
    : ["0"];
  return ["--user", "call", GSCONNECT, path, "org.gtk.Actions", "Activate", "sava{sv}", action, ...p, "0"];
}

// ---------------------------------------------------------------------------
// Looks

export function deviceIcon(type?: string): string {
  switch (type) {
    case "desktop":
      return Icons.monitor;
    case "laptop":
      return Icons.monitor;
    case "tv":
      return Icons.film;
    case "tablet":
    case "phone":
    case "smartphone":
    default:
      return Icons.apps;
  }
}

export const TYPE_TITLES: Record<string, string> = {
  smartphone: "Phone",
  phone: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
  laptop: "Laptop",
  tv: "TV",
};

export function batteryColor(level: number, charging: boolean): Color {
  if (charging) return "green";
  return level <= 15 ? "red" : level <= 30 ? "orange" : "green";
}

export function stateText(d: Device): string {
  if (!d.paired) return d.reachable ? "Not paired" : "Not paired, out of reach";
  if (!d.reachable) return "Out of reach";
  if (d.battery) return `Connected · ${d.battery.level} %${d.battery.charging ? " charging" : ""}`;
  return "Connected";
}

export function sortDevices(devices: Device[]): Device[] {
  const rank = (d: Device) => (d.reachable && d.paired ? 0 : d.paired ? 1 : 2);
  return [...devices].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

/** The line under the command in the root search: the first connected phone and its battery. */
export function summary(devices: Device[]): string | null {
  const up = sortDevices(devices).filter((d) => d.reachable && d.paired);
  if (!up.length) return devices.some((d) => d.paired) ? "No device in reach" : null;
  const d = up[0];
  const battery = d.battery ? ` · ${d.battery.level} %${d.battery.charging ? " ⚡" : ""}` : "";
  return `${d.name}${battery}${up.length > 1 ? ` +${up.length - 1}` : ""}`;
}

/** `~/x` → `/home/me/x`; `file:///a%20b` → `/a b`. */
export function filePath(input: string, home: string | undefined): string {
  let p = input.trim().replace(/^['"]|['"]$/g, "");
  if (p.startsWith("file://")) {
    try {
      p = decodeURIComponent(new URL(p).pathname);
    } catch {
      // Keep it.
    }
  }
  if (home && (p === "~" || p.startsWith("~/"))) p = `${home}${p.slice(1)}`;
  return p;
}

/** Phone numbers as typed: keeps a leading +, digits only. */
export function phoneNumber(input: string): string | undefined {
  const t = input.trim();
  const digits = t.replace(/[\s().-]/g, "");
  return /^\+?\d{3,15}$/.test(digits) ? digits : undefined;
}

/** `ID` and `ID_LIKE` of /etc/os-release. */
export function osIds(osRelease: string): string[] {
  const get = (k: string) => new RegExp(`^${k}=(.*)$`, "m").exec(osRelease)?.[1]?.replace(/^["']|["']$/g, "") ?? "";
  return `${get("ID")} ${get("ID_LIKE")}`.toLowerCase().split(/\s+/).filter(Boolean);
}

/** KDE Connect from the distribution, or GSConnect on GNOME. */
export function installHint(osRelease: string, desktop: string): string[] {
  const ids = osIds(osRelease);
  const gnome = /gnome/i.test(desktop);
  const pkg = ids.some((i) => ["fedora", "rhel", "centos"].includes(i))
    ? gnome ? "sudo dnf install gnome-shell-extension-gsconnect" : "sudo dnf install kde-connect"
    : ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))
    ? gnome ? "sudo pacman -S gnome-shell-extension-gsconnect" : "sudo pacman -S kdeconnect"
    : ids.some((i) => i.startsWith("opensuse") || i === "suse")
    ? gnome ? "sudo zypper install gnome-shell-extension-gsconnect" : "sudo zypper install kdeconnect-kde"
    : gnome
    ? "sudo apt install gnome-shell-extension-gsconnect"
    : "sudo apt install kdeconnect";
  return [pkg];
}
