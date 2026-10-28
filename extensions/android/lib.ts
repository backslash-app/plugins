// Parsing adb output, naming files and building the command lines. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// adb devices -l

export type State =
  | "device"
  | "unauthorized"
  | "offline"
  | "no permissions"
  | "recovery"
  | "sideload"
  | "bootloader"
  | "authorizing"
  | "connecting"
  | "unknown";

export type Transport = "usb" | "wifi" | "emulator";

export interface Device {
  serial: string;
  state: State;
  /** `Pixel_7` as adb prints it. */
  model?: string;
  product?: string;
  device?: string;
  transportId?: string;
  usb?: string;
  transport: Transport;
  /** What adb says when it may not open the USB device. */
  problem?: string;
}

const STATES: State[] = [
  "device",
  "unauthorized",
  "offline",
  "recovery",
  "sideload",
  "bootloader",
  "authorizing",
  "connecting",
];

/** `192.168.1.20:5555`, `[fe80::1]:5555` or an mDNS name `adb-<serial>-<id>._adb-tls-connect._tcp`. */
export const isNetworkSerial = (serial: string) =>
  /^(\d{1,3}\.){3}\d{1,3}:\d+$/.test(serial) || /^\[[0-9a-f:]+\]:\d+$/i.test(serial) ||
  /\._adb-tls-connect\._tcp\.?$/.test(serial);

export function transportOf(serial: string, usb?: string): Transport {
  if (/^emulator-\d+$/.test(serial)) return "emulator";
  if (usb) return "usb";
  return isNetworkSerial(serial) ? "wifi" : "usb";
}

/** Parses `adb devices -l`. */
export function parseDevices(out: string): Device[] {
  const devices: Device[] = [];
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("*") || line.startsWith("List of devices") || line.startsWith("adb ")) continue;
    const m = line.match(/^(\S+)\s+(.*)$/);
    if (!m) continue;
    const serial = m[1];
    let rest = m[2];
    let state: State = "unknown";
    let problem: string | undefined;
    const np = rest.match(/^no permissions\s*(\([^)]*\))?(?:;\s*see \[[^\]]*\])?\s*/);
    if (np) {
      state = "no permissions";
      problem = np[1]?.slice(1, -1);
      rest = rest.slice(np[0].length);
    } else {
      const word = rest.split(/\s+/)[0];
      if ((STATES as string[]).includes(word)) state = word as State;
      rest = rest.slice(word.length);
    }
    const props: Record<string, string> = {};
    for (const token of rest.trim().split(/\s+/)) {
      const i = token.indexOf(":");
      if (i > 0) props[token.slice(0, i)] = token.slice(i + 1);
    }
    devices.push({
      serial,
      state,
      model: props.model,
      product: props.product,
      device: props.device,
      transportId: props.transport_id,
      usb: props.usb,
      transport: transportOf(serial, props.usb),
      problem,
    });
  }
  return devices;
}

// ---------------------------------------------------------------------------
// getprop and dumpsys battery

/** `[ro.build.version.release]: [14]` lines → a map. */
export function parseGetprop(out: string): Record<string, string> {
  const props: Record<string, string> = {};
  for (const m of out.matchAll(/^\[([^\]]+)\]:\s*\[([^\]]*)\]/gm)) props[m[1]] = m[2];
  return props;
}

export interface Info {
  manufacturer?: string;
  model?: string;
  /** "14" */
  android?: string;
  sdk?: number;
  abi?: string;
  securityPatch?: string;
  build?: string;
  name?: string;
}

/** Android versions by API level, for the release name when a ROM leaves the release empty. */
const API_NAMES: Record<number, string> = {
  36: "16",
  35: "15",
  34: "14",
  33: "13",
  32: "12L",
  31: "12",
  30: "11",
  29: "10",
  28: "9",
  27: "8.1",
  26: "8.0",
  25: "7.1",
  24: "7.0",
  23: "6.0",
  22: "5.1",
  21: "5.0",
};

export function deviceInfo(props: Record<string, string>): Info {
  const sdk = Number(props["ro.build.version.sdk"]) || undefined;
  return {
    manufacturer: props["ro.product.manufacturer"] || props["ro.product.vendor.manufacturer"] || undefined,
    model: props["ro.product.model"] || props["ro.product.vendor.model"] || undefined,
    android: props["ro.build.version.release_or_codename"] || props["ro.build.version.release"] ||
      (sdk ? API_NAMES[sdk] : undefined),
    sdk,
    abi: props["ro.product.cpu.abi"] || undefined,
    securityPatch: props["ro.build.version.security_patch"] || undefined,
    build: props["ro.build.display.id"] || undefined,
    name: props["persist.sys.device_name"] || props["net.hostname"] || undefined,
  };
}

export type Charging = "charging" | "discharging" | "not charging" | "full" | "unknown";

export interface Battery {
  /** 0 to 100. */
  level?: number;
  status: Charging;
  /** "AC", "USB", "Wireless" or "Dock". */
  source?: string;
  /** °C */
  temperature?: number;
  health?: string;
}

const STATUS: Record<string, Charging> = { "2": "charging", "3": "discharging", "4": "not charging", "5": "full" };
const HEALTH: Record<string, string> = {
  "2": "Good",
  "3": "Overheat",
  "4": "Dead",
  "5": "Over voltage",
  "6": "Failure",
  "7": "Cold",
};

/** Parses `dumpsys battery`. */
export function parseBattery(out: string): Battery | undefined {
  const fields: Record<string, string> = {};
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*([A-Za-z][\w ]*?):\s*(.*)$/);
    if (m) fields[m[1].trim().toLowerCase()] = m[2].trim();
  }
  if (fields.level === undefined && fields.status === undefined) return undefined;
  const level = Number(fields.level);
  const scale = Number(fields.scale) || 100;
  const sources = [["ac powered", "AC"], ["usb powered", "USB"], ["wireless powered", "Wireless"], [
    "dock powered",
    "Dock",
  ]];
  const source = sources.find(([k]) => fields[k] === "true")?.[1];
  const temp = Number(fields.temperature);
  return {
    level: Number.isFinite(level) && fields.level !== undefined ? Math.round((level / scale) * 100) : undefined,
    status: STATUS[fields.status] ?? "unknown",
    source,
    temperature: Number.isFinite(temp) && fields.temperature !== undefined ? temp / 10 : undefined,
    health: HEALTH[fields.health],
  };
}

export function batteryColor(b: Battery): Color {
  if (b.status === "charging" || b.status === "full") return "green";
  if ((b.level ?? 100) <= 15) return "red";
  if ((b.level ?? 100) <= 30) return "orange";
  return "gray";
}

/** `inet 192.168.1.23/24 brd …` from `ip -f inet addr show wlan0` → `192.168.1.23`. */
export function parseWifiIp(out: string): string | undefined {
  for (const m of out.matchAll(/\binet (\d{1,3}(?:\.\d{1,3}){3})\/\d+/g)) {
    if (!m[1].startsWith("127.")) return m[1];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Apps

/** `pm list packages -3` → package names, sorted. */
export function parsePackages(out: string): string[] {
  return out.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("package:")).map((l) =>
    l.slice(8).replace(/\s+.*$/, "")
  ).filter(Boolean).sort();
}

const VENDOR_WORDS = new Set([
  "com",
  "org",
  "net",
  "io",
  "app",
  "de",
  "fr",
  "co",
  "me",
  "android",
  "apps",
  "mobile",
  "www",
]);

/** `com.spotify.music` → "Spotify Music", `org.mozilla.firefox` → "Firefox" (adb can't read app names). */
export function appName(pkg: string): string {
  const parts = pkg.split(".").filter((p) => !VENDOR_WORDS.has(p.toLowerCase()));
  const words = parts.length > 2 ? parts.slice(-2) : parts;
  if (words.length === 2 && words[1].toLowerCase().startsWith(words[0].toLowerCase())) words.shift();
  if (
    words.length === 2 && ["mozilla", "google", "microsoft", "samsung", "facebook"].includes(words[0].toLowerCase())
  ) {
    words.shift();
  }
  const title = words.join(" ").replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return title.replace(/\b\w/g, (c) => c.toUpperCase()) || pkg;
}

/** `adb shell monkey` starts an app's launcher activity without knowing its name. */
export const launchArgs = (serial: string, pkg: string) => [
  "-s",
  serial,
  "shell",
  "monkey",
  "-p",
  pkg,
  "-c",
  "android.intent.category.LAUNCHER",
  "1",
];

// ---------------------------------------------------------------------------
// Names and command lines

/** "Pixel 7" from the model adb or getprop gives. */
export function deviceName(d: Device, info?: Info): string {
  const model = info?.model ?? d.model?.replace(/_/g, " ");
  if (!model) return d.serial;
  const maker = info?.manufacturer;
  if (maker && !model.toLowerCase().startsWith(maker.toLowerCase()) && !/^(google|unknown)$/i.test(maker)) {
    return `${maker.charAt(0).toUpperCase()}${maker.slice(1)} ${model}`;
  }
  return model;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `Screenshot_Pixel-7_20261028-143005.png` */
export function screenshotName(model: string, at: Date): string {
  const safe = model.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "android";
  const stamp = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}-${pad(at.getHours())}${
    pad(at.getMinutes())
  }${pad(at.getSeconds())}`;
  return `Screenshot_${safe}_${stamp}.png`;
}

/** PNG signature: what `screencap -p` must start with. */
export function isPng(bytes: Uint8Array): boolean {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return bytes.length > 8 && sig.every((b, i) => bytes[i] === b);
}

/** A systemd unit name for a device's scrcpy window: one per device. */
export function scrcpyUnit(serial: string): string {
  return `backslash-scrcpy-${serial.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}`;
}

/** `systemd-run --user` arguments that keep scrcpy running once the launcher is hidden. */
export function scrcpyRunArgs(serial: string, title: string, extra: string[] = []): string[] {
  return [
    "--user",
    "--quiet",
    "--collect",
    `--unit=${scrcpyUnit(serial)}`,
    `--description=Backslash: mirroring ${title}`,
    "scrcpy",
    `--serial=${serial}`,
    `--window-title=${title}`,
    ...extra,
  ];
}

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/**
 * A script following an app's log: its process id, starting the app first
 * when it doesn't run, then `adb logcat --pid`.
 */
export function logcatScript(serial: string, pkg: string): string {
  const adb = `adb -s ${quote(serial)}`;
  const pidof = `pid=$(${adb} shell pidof -s ${quote(pkg)} | tr -d '\\r')`;
  return [
    pidof,
    `if [ -z "$pid" ]; then echo ${quote(`Starting ${pkg}…`)}; ${
      shellLine(["adb", ...launchArgs(serial, pkg)])
    } >/dev/null 2>&1; sleep 2; ${pidof}; fi`,
    `if [ -n "$pid" ]; then exec ${adb} logcat -v color --pid="$pid"; fi`,
    `echo ${quote(`${pkg} is not running.`)}; printf '\\n[Press Enter to close] '; read -r _`,
  ].join("\n");
}

/**
 * `192.168.1.20` → `192.168.1.20:5555`; keeps a port given. With no default
 * port (pairing), the port must be typed. Throws on what is not an address.
 */
export function normalizeAddress(text: string, defaultPort: number | null = 5555): string {
  const t = text.trim();
  if (!t) throw new Error("Type the phone's address, as shown in Developer options → Wireless debugging");
  const m = t.match(/^(\[[0-9a-f:]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/i);
  if (!m) throw new Error(`“${t}” is not an address: type it as 192.168.1.20:5555`);
  if (!m[2] && defaultPort === null) {
    throw new Error(`Add the port to ${t}: it is shown next to the address, like ${t}:37099`);
  }
  const port = m[2] ? Number(m[2]) : defaultPort!;
  if (port < 1 || port > 65535) throw new Error(`${port} is not a port number`);
  return `${m[1]}:${port}`;
}

/** The six digits Android shows for pairing. */
export function normalizePairingCode(text: string): string {
  const code = text.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(code)) {
    throw new Error("The pairing code has six digits: Developer options → Wireless debugging → Pair with code");
  }
  return code;
}

/** What `adb connect` / `adb pair` answered, as success or a sentence. */
export function connectOutcome(out: string): { ok: boolean; message: string } {
  const t = out.trim();
  if (/^(connected to|already connected to)/i.test(t)) return { ok: true, message: t };
  if (/^Successfully paired/i.test(t)) return { ok: true, message: t };
  if (/Connection refused/i.test(t)) {
    return { ok: false, message: "The phone refused the connection: turn on Wireless debugging and check the port" };
  }
  if (/No route to host|timed out|Network is unreachable/i.test(t)) {
    return { ok: false, message: "The phone can't be reached: is it on the same Wi-Fi network?" };
  }
  if (/failed to authenticate/i.test(t)) {
    return {
      ok: false,
      message: "The phone didn't accept this computer: allow it on the phone, or pair with a code first",
    };
  }
  if (/wrong password|Failed: Wrong password|protocol fault/i.test(t)) {
    return { ok: false, message: "Pairing failed: check the code and the pairing port (they change each time)" };
  }
  return { ok: !/fail|error|cannot|unable/i.test(t), message: t || "No answer from adb" };
}

/** A sentence for the device states that can't be used yet. */
export function stateHelp(d: Device): string | undefined {
  switch (d.state) {
    case "unauthorized":
      return "Unlock the phone and accept “Allow USB debugging?” for this computer";
    case "no permissions":
      return "Your user may not open the USB device: install the android-udev rules (android-udev or android-sdk-platform-tools-common) and plug it in again";
    case "offline":
      return "adb lost the device: unplug it and plug it in again, or turn USB debugging off and on";
    case "recovery":
      return "The device is in recovery mode";
    case "sideload":
      return "The device waits for an update: adb sideload <file.zip>";
    case "bootloader":
      return "The device is in the bootloader: use fastboot";
    case "authorizing":
    case "connecting":
      return "Connecting…";
    default:
      return undefined;
  }
}

export type Family = "debian" | "fedora" | "arch" | "suse" | "unknown";

export function osFamily(osRelease: string): Family {
  const ids = (osRelease.match(/^ID(?:_LIKE)?=(.*)$/gm) ?? []).join(" ").toLowerCase();
  if (/arch|manjaro|endeavour/.test(ids)) return "arch";
  if (/fedora|rhel|centos/.test(ids)) return "fedora";
  if (/suse/.test(ids)) return "suse";
  if (/debian|ubuntu|mint|pop/.test(ids)) return "debian";
  return "unknown";
}

/** How to install adb or scrcpy on this distribution. */
export function installCommand(tool: "adb" | "scrcpy", family: Family): string {
  const pkg = tool === "adb"
    ? {
      debian: "adb",
      fedora: "android-tools",
      arch: "android-tools",
      suse: "android-tools",
      unknown: "android-tools",
    }[family]
    : "scrcpy";
  switch (family) {
    case "debian":
      return `sudo apt install ${pkg}`;
    case "fedora":
      return `sudo dnf install ${pkg}`;
    case "arch":
      return `sudo pacman -S ${pkg}`;
    case "suse":
      return `sudo zypper install ${pkg}`;
    default:
      return tool === "scrcpy"
        ? "flatpak install flathub com.genymobile.Scrcpy"
        : `Install ${pkg} with your package manager`;
  }
}

/** APKs first by newest; `.apk` only (split bundles need other tools). */
export function isApk(name: string): boolean {
  return /\.apk$/i.test(name);
}

export function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 100 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** adb install's last line: `Success`, or `Failure [INSTALL_FAILED_…]` turned into a sentence. */
export function installOutcome(out: string): { ok: boolean; message: string } {
  if (/^Success\s*$/m.test(out)) return { ok: true, message: "Installed" };
  const code = out.match(/\[(INSTALL_[A-Z_]+|DELETE_[A-Z_]+)[^\]]*\]/)?.[1];
  const known: Record<string, string> = {
    INSTALL_FAILED_UPDATE_INCOMPATIBLE:
      "An app with the same name but another signature is installed: uninstall it first",
    INSTALL_FAILED_VERSION_DOWNGRADE: "A newer version is already installed",
    INSTALL_FAILED_INSUFFICIENT_STORAGE: "Not enough space on the device",
    INSTALL_FAILED_OLDER_SDK: "This app needs a newer Android version",
    INSTALL_FAILED_NO_MATCHING_ABIS: "This APK is not built for the device's processor",
    INSTALL_PARSE_FAILED_NOT_APK: "This file is not an APK",
    INSTALL_FAILED_USER_RESTRICTED:
      "The phone refused: allow the installation on its screen (or turn on “Install via USB”)",
    INSTALL_FAILED_ALREADY_EXISTS: "The app is already installed",
  };
  if (code) return { ok: false, message: known[code] ?? code };
  return { ok: false, message: out.trim().split("\n").pop() || "adb install failed" };
}
