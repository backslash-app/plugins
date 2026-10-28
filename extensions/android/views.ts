// Device and app actions, the apps list and the Wi-Fi forms, shared by both commands.

import {
  type Action,
  action,
  close,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  open,
  pop,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  adb,
  connect,
  downloadedApks,
  HOME,
  installHint,
  mirror,
  Missing,
  onDevice,
  pair,
  screenshot,
  screenshotFolder,
} from "./adb.ts";
import {
  appName,
  type Device,
  formatSize,
  installOutcome,
  launchArgs,
  logcatScript,
  normalizeAddress,
  normalizePairingCode,
  parsePackages,
  parseWifiIp,
  screenshotName,
} from "./lib.ts";
import { runInTerminal } from "./terminal.ts";

export interface Prefs {
  terminal?: string;
  scrcpyArgs?: string;
}

/** A failed action as a toast; a missing tool says how to install it. */
async function failed(title: string, e: unknown): Promise<void> {
  if (e instanceof Missing) {
    await toast(`${e.tool} is not installed`, { style: "failure", message: await installHint(e.tool) });
    return;
  }
  await toast(title, { style: "failure", message: (e as Error).message });
}

function terminal(argv: string[], prefs: Prefs, done: string) {
  runInTerminal(argv, prefs.terminal || undefined);
  return close(done);
}

// ---------------------------------------------------------------------------
// Apps

function appItem(d: Device, name: string, pkg: string, prefs: Prefs): Item {
  const app = appName(pkg);
  return {
    id: pkg,
    title: app,
    subtitle: pkg,
    icon: { source: Icons.apps, tint: "green" },
    keywords: pkg.split("."),
    actions: [
      action("Launch", async () => {
        try {
          await onDevice(d.serial, launchArgs(d.serial, pkg).slice(2));
          return close(`Started ${app} on ${name}`);
        } catch (e) {
          await failed(`${app} could not be started`, e);
        }
      }, { icon: Icons.play }),
      action(
        "Show Log in Terminal",
        () => terminal(["sh", "-c", logcatScript(d.serial, pkg)], prefs, `Following the log of ${app}`),
        {
          icon: Icons.terminal,
          shortcut: "<Ctrl>l",
        },
      ),
      copy(pkg, "Copy Package Name", { shortcut: "<Ctrl><Shift>c" }),
      open(`https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`, "Open in Play Store", {
        shortcut: "<Ctrl>o",
      }),
      action("Force Stop", async () => {
        try {
          await onDevice(d.serial, ["shell", "am", "force-stop", pkg]);
          await toast(`Stopped ${app}`, { style: "success" });
        } catch (e) {
          await failed(`${app} could not be stopped`, e);
        }
      }, { icon: Icons.stop, section: "Manage" }),
      action("Clear Data", async () => {
        try {
          const out = await onDevice(d.serial, ["shell", "pm", "clear", pkg]);
          if (!/Success/.test(out)) throw new Error(out || "pm clear failed");
          await toast(`Cleared the data of ${app}`, { style: "success" });
        } catch (e) {
          await failed(`The data of ${app} could not be cleared`, e);
        }
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete all data of ${app} (accounts, settings, files)?`,
        section: "Manage",
      }),
      action("Uninstall", async () => {
        try {
          const r = installOutcome(await onDevice(d.serial, ["uninstall", pkg], undefined, 60_000));
          if (!r.ok && !/Success/.test(r.message)) throw new Error(r.message);
          await toast(`Uninstalled ${app}`, { style: "success" });
          return refresh();
        } catch (e) {
          await failed(`${app} could not be uninstalled`, e);
        }
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Uninstall ${app} from ${name}?`,
        section: "Manage",
        shortcut: "<Ctrl>x",
      }),
    ],
  };
}

/** The apps the user installed (not the system ones), by name. */
export async function appItems(d: Device, name: string, prefs: Prefs, signal?: AbortSignal): Promise<Item[]> {
  const pkgs = parsePackages(await onDevice(d.serial, ["shell", "pm", "list", "packages", "-3"], signal));
  return pkgs.map((pkg) => appItem(d, name, pkg, prefs)).sort((a, b) => a.title.localeCompare(b.title));
}

export function appsView(d: Device, name: string, prefs: Prefs): ListSpec {
  return list({
    title: `Apps on ${name}`,
    placeholder: `Filter the apps you installed on ${name}…`,
    empty: {
      title: "No app installed",
      description: "Only the apps you installed are listed, not the system ones",
      icon: Icons.apps,
    },
    status: (items) => `${items.length} app${items.length === 1 ? "" : "s"}`,
    actions: [installSubmenu(d, name)],
    items: ({ signal }) => appItems(d, name, prefs, signal),
  });
}

// ---------------------------------------------------------------------------
// Device actions

export function installSubmenu(d: Device, name: string): Action {
  return submenu("Install APK from Downloads", async () => {
    const apks = await downloadedApks();
    if (!apks.length) {
      return [action("No .apk in ~/Downloads", () => {}, { icon: Icons.info })];
    }
    return apks.slice(0, 30).map((apk) =>
      action(`${apk.name} · ${formatSize(apk.size)}`, async () => {
        await toast(`Installing ${apk.name} on ${name}…`);
        try {
          const r = installOutcome(await onDevice(d.serial, ["install", "-r", apk.path], undefined, 300_000));
          if (!r.ok) throw new Error(r.message);
          await toast(`Installed ${apk.name}`, { style: "success" });
        } catch (e) {
          await failed(`${apk.name} could not be installed`, e);
        }
      }, { icon: Icons.package })
    );
  }, { icon: Icons.download, shortcut: "<Ctrl>i", section: "Device" });
}

export function deviceActions(d: Device, name: string, prefs: Prefs, ip?: string): Action[] {
  const serial = d.serial;
  const extra = (prefs.scrcpyArgs ?? "").split(/\s+/).filter(Boolean);
  return [
    action("Mirror Screen", async () => {
      try {
        await mirror(serial, name, extra);
        return close(`Mirroring ${name}`);
      } catch (e) {
        await failed(`${name} could not be mirrored`, e);
      }
    }, { icon: Icons.monitor }),
    action("Installed Apps", () => appsView(d, name, prefs), { icon: Icons.apps, shortcut: "<Ctrl>a" }),
    action("Take Screenshot", async () => {
      try {
        const bytes = await screenshot(serial);
        const path = `${await screenshotFolder()}/${screenshotName(name, new Date())}`;
        await Deno.writeFile(path, bytes);
        await toast(`Saved ${path.replace(HOME, "~")}`, { style: "success" });
        return replaceWithShot(path);
      } catch (e) {
        await failed("No screenshot", e);
      }
    }, { icon: Icons.camera, shortcut: "<Ctrl>s" }),
    installSubmenu(d, name),
    action("Open Shell in Terminal", () => terminal(["adb", "-s", serial, "shell"], prefs, `adb shell on ${name}`), {
      icon: Icons.terminal,
      shortcut: "<Ctrl>t",
      section: "Device",
    }),
    action(
      "Show Log in Terminal",
      () => terminal(["adb", "-s", serial, "logcat", "-v", "color"], prefs, `Following the log of ${name}`),
      {
        icon: Icons.activity,
        shortcut: "<Ctrl>l",
        section: "Device",
      },
    ),
    ...(d.transport === "usb"
      ? [
        action("Switch to Wi-Fi", async () => {
          try {
            const addr = ip ??
              parseWifiIp(await onDevice(serial, ["shell", "ip", "-f", "inet", "addr", "show", "wlan0"]));
            if (!addr) throw new Error("The device has no Wi-Fi address: connect it to Wi-Fi first");
            await onDevice(serial, ["tcpip", "5555"]);
            await new Promise((r) => setTimeout(r, 1500));
            const r = await connect(`${addr}:5555`);
            if (!r.ok) throw new Error(r.message);
            await toast(`Connected to ${addr}:5555`, { style: "success", message: "You can unplug the cable" });
            return refresh();
          } catch (e) {
            await failed("Wi-Fi connection failed", e);
          }
        }, { icon: Icons.wifi, section: "Connection" }),
      ]
      : []),
    ...(d.transport === "wifi"
      ? [
        action("Disconnect", async () => {
          try {
            await adbDisconnect(serial);
            await toast(`Disconnected ${name}`, { style: "success" });
            return refresh();
          } catch (e) {
            await failed("Not disconnected", e);
          }
        }, { icon: Icons.wifiOff, section: "Connection", shortcut: "<Ctrl>d" }),
      ]
      : []),
    copy(serial, "Copy Serial", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ...(ip ? [copy(ip, "Copy IP Address", { section: "Copy" })] : []),
    submenu("Reboot", [
      action("Reboot", () => reboot(serial, name, []), { icon: Icons.refresh, confirm: `Reboot ${name}?` }),
      action("Reboot to Recovery", () => reboot(serial, name, ["recovery"]), {
        icon: Icons.refresh,
        confirm: `Reboot ${name} to recovery?`,
      }),
      action("Reboot to Bootloader", () => reboot(serial, name, ["bootloader"]), {
        icon: Icons.refresh,
        confirm: `Reboot ${name} to the bootloader?`,
      }),
    ], { icon: Icons.power, section: "Device", destructive: true }),
  ];
}

async function adbDisconnect(serial: string) {
  await adb(["disconnect", serial]);
}

async function reboot(serial: string, name: string, args: string[]) {
  try {
    await onDevice(serial, ["reboot", ...args]);
    return close(`${name} is restarting`);
  } catch (e) {
    await failed(`${name} could not be restarted`, e);
  }
}

function replaceWithShot(path: string): ListSpec {
  return list({
    title: "Screenshot",
    items: [{
      id: path,
      title: path.split("/").pop()!,
      subtitle: path.replace(HOME, "~"),
      icon: { source: Icons.image, tint: "green" },
      detail: { image: path },
      actions: [
        open(path, "Open Screenshot"),
        open(path.replace(/\/[^/]+$/, ""), "Open Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }),
        copy(path, "Copy Path"),
      ],
    }],
  });
}

// ---------------------------------------------------------------------------
// Wi-Fi forms

export function connectForm(): FormSpec {
  return form({
    title: "Connect over Wi-Fi",
    submitTitle: "Connect",
    fields: [
      field.text("address", "Address", {
        required: true,
        placeholder: "192.168.1.20:5555, or the IP address & port of Wireless debugging",
      }),
    ],
    async submit(values) {
      try {
        const address = normalizeAddress(String(values.address ?? ""));
        const r = await connect(address);
        if (!r.ok) throw new Error(r.message);
        await toast(`Connected to ${address}`, { style: "success" });
        return pop();
      } catch (e) {
        await failed("Not connected", e);
      }
    },
  });
}

export function pairForm(): FormSpec {
  return form({
    title: "Pair with a Code",
    submitTitle: "Pair",
    fields: [
      field.text("pairAddress", "Pairing address", {
        required: true,
        placeholder: "Wireless debugging → Pair device with pairing code: 192.168.1.20:37099",
      }),
      field.text("code", "Pairing code", { required: true, placeholder: "123456" }),
      field.text("connectAddress", "Connect address", {
        placeholder: "Optional: the IP address & port on the Wireless debugging screen",
      }),
    ],
    async submit(values) {
      try {
        const address = normalizeAddress(String(values.pairAddress ?? ""), null);
        const code = normalizePairingCode(String(values.code ?? ""));
        const r = await pair(address, code);
        if (!r.ok) throw new Error(r.message);
        const then = String(values.connectAddress ?? "").trim();
        if (then) {
          const c = await connect(normalizeAddress(then));
          if (!c.ok) throw new Error(`Paired, but not connected: ${c.message}`);
        }
        await toast("Paired", {
          style: "success",
          message: then ? `Connected to ${then}` : "It connects by itself in a few seconds",
        });
        return pop();
      } catch (e) {
        await failed("Pairing failed", e);
      }
    },
  });
}
