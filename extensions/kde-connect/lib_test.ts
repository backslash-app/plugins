import { assertEquals } from "@std/assert";
import {
  activateArgs,
  type Device,
  filePath,
  gsBattery,
  gsCapabilities,
  installHint,
  kdeCapabilities,
  parseCliList,
  parseDescribeAll,
  parseManagedObjects,
  parseProperties,
  phoneNumber,
  sortDevices,
  stateText,
  summary,
} from "./lib.ts";

// `kdeconnect-cli -l` (KDE Connect 24.02).
const LIST = `- Pixel 8: 7f3a9c2e_4b1d_4e2a_9f00_aa11bb22cc33 (paired and reachable)
- Galaxy Tab S9: 0d1e2f3a4b5c6d7e (paired)
- Living Room TV: 99aa88bb77cc66dd (reachable)
3 devices found`;

// `busctl --user --json=short call org.gnome.Shell.Extensions.GSConnect … GetManagedObjects`.
const MANAGED = JSON.stringify({
  type: "a{oa{sa{sv}}}",
  data: [{
    "/org/gnome/Shell/Extensions/GSConnect/Device/0c1d2e3f": {
      "org.gnome.Shell.Extensions.GSConnect.Device": {
        Connected: { type: "b", data: true },
        EncryptionInfo: { type: "s", data: "…" },
        IconName: { type: "s", data: "smartphone-symbolic" },
        Id: { type: "s", data: "0c1d2e3f" },
        Name: { type: "s", data: "Fairphone 5" },
        Paired: { type: "b", data: true },
        Type: { type: "s", data: "phone" },
      },
      "org.gtk.Actions": {},
    },
    "/org/gnome/Shell/Extensions/GSConnect": { "org.freedesktop.DBus.ObjectManager": {} },
  }],
});

// `busctl --user --json=short call … org.gtk.Actions DescribeAll`.
const DESCRIBE = JSON.stringify({
  type: "a{s(bgav)}",
  data: [{
    battery: [true, "", [{ type: "(bsii)", data: [true, "battery-good-charging-symbolic", 64, 3600] }]],
    ring: [true, "", []],
    shareFile: [true, "(sb)", []],
    shareText: [true, "s", []],
    sendSms: [false, "(ss)", []],
    mount: [true, "", []],
    clipboardPush: [false, "", []],
  }],
});

const device = (o: Partial<Device>): Device => ({
  backend: "kdeconnect",
  id: "x",
  name: "Phone",
  paired: true,
  reachable: true,
  can: kdeCapabilities(undefined),
  ...o,
});

Deno.test("kdeconnect-cli list", () => {
  assertEquals(parseCliList(LIST), [
    { name: "Pixel 8", id: "7f3a9c2e_4b1d_4e2a_9f00_aa11bb22cc33", paired: true, reachable: true },
    { name: "Galaxy Tab S9", id: "0d1e2f3a4b5c6d7e", paired: true, reachable: false },
    { name: "Living Room TV", id: "99aa88bb77cc66dd", paired: false, reachable: true },
  ]);
  assertEquals(parseCliList("7f3a9c2e_4b1d Pixel 8\n"), [{
    id: "7f3a9c2e_4b1d",
    name: "Pixel 8",
    paired: true,
    reachable: true,
  }]);
  assertEquals(parseCliList("0 devices found"), []);
});

Deno.test("D-Bus properties", () => {
  const out =
    '{"type":"s","data":"smartphone"}\n{"type":"as","data":["kdeconnect_battery","kdeconnect_sms","kdeconnect_share"]}\n';
  const props = parseProperties(out, ["type", "supportedPlugins"]);
  assertEquals(props.type, "smartphone");
  const can = kdeCapabilities(props.supportedPlugins as string[]);
  assertEquals(can, { ring: false, ping: false, share: true, sms: true, sftp: false, clipboard: false });
  assertEquals(parseProperties('{"type":"i","data":82}\n{"type":"b","data":false}', ["charge", "isCharging"]), {
    charge: 82,
    isCharging: false,
  });
});

Deno.test("GSConnect devices and actions", () => {
  const [d] = parseManagedObjects(MANAGED);
  assertEquals(d, {
    backend: "gsconnect",
    id: "0c1d2e3f",
    name: "Fairphone 5",
    type: "phone",
    paired: true,
    reachable: true,
    path: "/org/gnome/Shell/Extensions/GSConnect/Device/0c1d2e3f",
  });
  const actions = parseDescribeAll(DESCRIBE);
  assertEquals(gsBattery(actions), { level: 64, charging: true });
  assertEquals(gsBattery({}), undefined);
  assertEquals(gsCapabilities(actions), {
    ring: true,
    ping: false,
    share: true,
    sms: false,
    sftp: true,
    clipboard: false,
  });
  assertEquals(activateArgs(d.path!, "ring"), [
    "--user",
    "call",
    "org.gnome.Shell.Extensions.GSConnect",
    "/org/gnome/Shell/Extensions/GSConnect/Device/0c1d2e3f",
    "org.gtk.Actions",
    "Activate",
    "sava{sv}",
    "ring",
    "0",
    "0",
  ]);
  assertEquals(activateArgs("/p", "shareFile", { type: "(sb)", value: ["/home/me/a b.pdf", false] }).slice(7), [
    "shareFile",
    "1",
    "(sb)",
    "/home/me/a b.pdf",
    "false",
    "0",
  ]);
  assertEquals(activateArgs("/p", "shareText", { type: "s", value: "hello" }).slice(7), [
    "shareText",
    "1",
    "s",
    "hello",
    "0",
  ]);
});

Deno.test("states, order and the root subtitle", () => {
  const pixel = device({ name: "Pixel 8", battery: { level: 23, charging: true } });
  const tab = device({ name: "Tab", reachable: false });
  const tv = device({ name: "TV", paired: false });
  assertEquals(stateText(pixel), "Connected · 23 % charging");
  assertEquals(stateText(tab), "Out of reach");
  assertEquals(stateText(tv), "Not paired");
  assertEquals(sortDevices([tv, tab, pixel]).map((d) => d.name), ["Pixel 8", "Tab", "TV"]);
  assertEquals(summary([tab, pixel]), "Pixel 8 · 23 % ⚡");
  assertEquals(summary([tab]), "No device in reach");
  assertEquals(summary([]), null);
});

Deno.test("input", () => {
  assertEquals(filePath("~/Downloads/a.pdf", "/home/me"), "/home/me/Downloads/a.pdf");
  assertEquals(filePath("file:///home/me/My%20Photo.jpg", "/home/me"), "/home/me/My Photo.jpg");
  assertEquals(filePath("'/tmp/x y'", "/home/me"), "/tmp/x y");
  assertEquals(phoneNumber("+33 6 12 34 56 78"), "+33612345678");
  assertEquals(phoneNumber("(555) 123-4567"), "5551234567");
  assertEquals(phoneNumber("mom"), undefined);
});

Deno.test("install hints", () => {
  assertEquals(installHint("ID=fedora", "KDE"), ["sudo dnf install kde-connect"]);
  assertEquals(installHint("ID=fedora", "GNOME"), ["sudo dnf install gnome-shell-extension-gsconnect"]);
  assertEquals(installHint("ID=ubuntu\nID_LIKE=debian", "ubuntu:GNOME"), [
    "sudo apt install gnome-shell-extension-gsconnect",
  ]);
  assertEquals(installHint("ID=arch", "KDE"), ["sudo pacman -S kdeconnect"]);
});
