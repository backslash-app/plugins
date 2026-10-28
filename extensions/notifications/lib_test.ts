import { assertEquals } from "@std/assert";
import {
  ago,
  detectBackend,
  escapeMarkdown,
  parseBootTime,
  parseDunstHistory,
  parseGdbusBool,
  parseMakoHistory,
  parseMakoModes,
  parseServerInfo,
  plainText,
} from "./lib.ts";

Deno.test("server information and backend detection", () => {
  assertEquals(parseServerInfo("('mako', 'emersion', '1.9.0', '1.2')\n"), {
    name: "mako",
    vendor: "emersion",
    version: "1.9.0",
  });
  assertEquals(parseServerInfo("Error: GDBus.Error:org.freedesktop.DBus.Error.ServiceUnknown"), undefined);
  assertEquals(detectBackend("mako", ""), "mako");
  assertEquals(detectBackend("dunst", "Hyprland"), "dunst");
  assertEquals(detectBackend("SwayNotificationCenter", "sway"), "swaync");
  assertEquals(detectBackend("gnome-shell", "ubuntu:GNOME"), "gnome");
  assertEquals(detectBackend("Plasma", "KDE"), "kde");
  assertEquals(detectBackend("Xfce Notify Daemon", "XFCE"), "xfce");
  assertEquals(detectBackend(undefined, "X-Cinnamon"), "cinnamon");
  assertEquals(detectBackend(undefined, "sway"), undefined);
  assertEquals(parseGdbusBool("(<true>,)\n"), true);
  assertEquals(parseGdbusBool("(<false>,)\n"), false);
});

const DUNST = JSON.stringify({
  type: "aa{sv}",
  data: [[
    {
      body: { type: "s", data: "Your build <b>passed</b> &amp; deployed" },
      summary: { type: "s", data: "CI finished" },
      appname: { type: "s", data: "GitHub" },
      category: { type: "s", data: "" },
      id: { type: "i", data: 12 },
      timestamp: { type: "x", data: 1_500_000_000 },
      urgency: { type: "s", data: "CRITICAL" },
    },
    {
      body: { type: "s", data: "" },
      summary: { type: "s", data: "Battery low" },
      appname: { type: "s", data: "upower" },
      category: { type: "s", data: "device" },
      id: { type: "i", data: 11 },
      timestamp: { type: "x", data: 1_000_000_000 },
      urgency: { type: "s", data: "NORMAL" },
    },
  ]],
});

Deno.test("dunst history with dates from the boot time", () => {
  const boot = new Date(2026, 9, 28, 8, 0, 0).getTime();
  const [ci, battery] = parseDunstHistory(DUNST, boot);
  assertEquals(ci, {
    id: "12",
    app: "GitHub",
    summary: "CI finished",
    body: "Your build <b>passed</b> &amp; deployed",
    urgency: "critical",
    category: undefined,
    time: boot + 1_500_000,
  });
  assertEquals(battery.category, "device");
  assertEquals(battery.urgency, "normal");
  assertEquals(parseDunstHistory(DUNST)[0].time, undefined);
});

Deno.test("mako history: D-Bus JSON (< 1.9), plain JSON and text (1.9+)", () => {
  const old = JSON.stringify({
    type: "aa{sv}",
    data: [[{
      "app-name": { type: "s", data: "Firefox" },
      "app-icon": { type: "s", data: "firefox" },
      category: { type: "s", data: "" },
      "desktop-entry": { type: "s", data: "firefox" },
      summary: { type: "s", data: "Download complete" },
      body: { type: "s", data: "report.pdf" },
      id: { type: "u", data: 7 },
      urgency: { type: "y", data: 1 },
      actions: { type: "a{ss}", data: {} },
    }]],
  });
  assertEquals(parseMakoHistory(old), [{
    id: "7",
    app: "Firefox",
    summary: "Download complete",
    body: "report.pdf",
    urgency: "normal",
    category: undefined,
  }]);
  const plain = JSON.stringify([{ id: 9, app_name: "kitty", summary: "Done", body: "make finished", urgency: 2 }]);
  assertEquals(parseMakoHistory(plain)[0].urgency, "critical");
  assertEquals(parseMakoHistory(plain)[0].app, "kitty");
  const text = parseMakoHistory(`Notification 12: Build finished
  App name: kitty
  Urgency: normal
Notification 11: Meeting in 5 minutes
  App name: Thunderbird
  Category: im.received
  Urgency: critical
`);
  assertEquals(text.map((n) => [n.id, n.app, n.summary, n.urgency]), [
    ["12", "kitty", "Build finished", "normal"],
    ["11", "Thunderbird", "Meeting in 5 minutes", "critical"],
  ]);
  assertEquals(parseMakoHistory(""), []);
  assertEquals(parseMakoModes("default\ndo-not-disturb\n"), ["default", "do-not-disturb"]);
});

Deno.test("text helpers", () => {
  assertEquals(
    plainText("Your build <b>passed</b> &amp; <i>deployed</i><br/>Next"),
    "Your build passed & deployed\nNext",
  );
  assertEquals(escapeMarkdown("a *b* `c`"), "a \\*b\\* \\`c\\`");
  const now = new Date(2026, 9, 28, 12, 0, 0).getTime();
  assertEquals(ago(now - 20_000, now), "just now");
  assertEquals(ago(now - 5 * 60_000, now), "5 min ago");
  assertEquals(ago(now - 3 * 3600_000, now), "3 h ago");
  assertEquals(ago(now - 30 * 3600_000, now), "yesterday");
  assertEquals(parseBootTime("2026-10-28 08:12:03\n"), new Date(2026, 9, 28, 8, 12, 3).getTime());
  assertEquals(parseBootTime("garbage"), undefined);
});
