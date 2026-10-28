import { assert, assertEquals } from "@std/assert";
import {
  codeBlock,
  duration,
  fieldText,
  firstLine,
  groupEntries,
  logLine,
  mergeEntries,
  messageKey,
  orderGroups,
  parseBoots,
  parseEntry,
  parseJournal,
  source,
  sourceArgs,
} from "./lib.ts";

const T = 1761645600000000; // µs
const line = (o: Record<string, unknown>) => JSON.stringify(o);

// journalctl -o json from systemd 255, trimmed to the asked fields.
const JOURNAL = [
  line({
    __CURSOR: "s=1;i=10",
    __REALTIME_TIMESTAMP: String(T),
    PRIORITY: "3",
    MESSAGE: "nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)",
    _SYSTEMD_UNIT: "nginx.service",
    SYSLOG_IDENTIFIER: "nginx",
    _PID: "2213",
    _EXE: "/usr/sbin/nginx",
    _COMM: "nginx",
  }),
  line({
    __CURSOR: "s=1;i=11",
    __REALTIME_TIMESTAMP: String(T - 60_000_000),
    PRIORITY: "3",
    MESSAGE: "nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)",
    _SYSTEMD_UNIT: "nginx.service",
    SYSLOG_IDENTIFIER: "nginx",
    _PID: "2201",
  }),
  line({
    __CURSOR: "s=1;i=12",
    __REALTIME_TIMESTAMP: String(T - 30_000_000),
    PRIORITY: "3",
    MESSAGE: "Failed to start nginx.service - A high performance web server.",
    _SYSTEMD_UNIT: "init.scope",
    UNIT: "nginx.service",
    SYSLOG_IDENTIFIER: "systemd",
    _PID: "1",
  }),
  line({
    __CURSOR: "s=1;i=13",
    __REALTIME_TIMESTAMP: String(T - 120_000_000),
    PRIORITY: "4",
    MESSAGE: [87, 105, 70, 105, 32, 255],
    _TRANSPORT: "kernel",
  }),
  line({
    __CURSOR: "s=1;i=14",
    __REALTIME_TIMESTAMP: String(T - 10_000_000),
    PRIORITY: "3",
    MESSAGE:
      "JS ERROR: TypeError: this._notification is null\n_updateState@resource:///org/gnome/shell/ui/messageTray.js",
    _SYSTEMD_UNIT: "user@1000.service",
    _SYSTEMD_USER_UNIT: "org.gnome.Shell@wayland.service",
    SYSLOG_IDENTIFIER: "gnome-shell",
    _PID: "1650",
  }),
  "Hint: not json",
  "{broken",
].join("\n");

Deno.test("parseEntry reads fields, timestamps and byte-array messages", () => {
  const entries = parseJournal(JOURNAL);
  assertEquals(entries.length, 5);
  const [nginx, , systemd, kernel, shell] = entries;
  assertEquals(nginx.time, T / 1000);
  assertEquals([nginx.priority, nginx.unit, nginx.pid, nginx.exe], [3, "nginx.service", 2213, "/usr/sbin/nginx"]);
  assertEquals(systemd.unit, "nginx.service");
  assertEquals(kernel.message, "WiFi �");
  assertEquals(source(kernel), "Kernel");
  assertEquals([shell.unit, shell.userUnit], ["org.gnome.Shell@wayland.service", true]);
  assertEquals(parseEntry("[]")?.message, "");
});

Deno.test("fieldText handles strings, bytes, repeated fields and nulls", () => {
  assertEquals(fieldText("x"), "x");
  assertEquals(fieldText([104, 105]), "hi");
  assertEquals(fieldText(["a", "b"]), "a");
  assertEquals(fieldText(null), undefined);
});

Deno.test("mergeEntries drops duplicates seen by both journals and sorts newest first", () => {
  const sys = parseJournal(JOURNAL);
  const merged = mergeEntries(sys, sys.slice(0, 2));
  assertEquals(merged.length, 5);
  assertEquals(merged.map((e) => e.cursor), ["s=1;i=10", "s=1;i=14", "s=1;i=12", "s=1;i=11", "s=1;i=13"]);
});

Deno.test("groupEntries folds repeats; orderGroups puts noisy units first", () => {
  const groups = orderGroups(groupEntries(mergeEntries(parseJournal(JOURNAL))));
  assertEquals(groups.map((g) => [g.source, g.count]), [
    ["nginx.service", 2],
    ["nginx.service", 1],
    ["org.gnome.Shell@wayland.service", 1],
    ["Kernel", 1],
  ]);
  assertEquals(groups[0].pids, [2213, 2201]);
  assertEquals(groups[0].latest.pid, 2213);
  assertEquals(groups[0].first, T / 1000 - 60_000);
  assertEquals(messageKey("Killed process 4242 at 0xffff12"), "Killed process # at #");
});

Deno.test("sourceArgs picks the right journalctl filter", () => {
  const [nginx, , , kernel, shell] = parseJournal(JOURNAL);
  assertEquals(sourceArgs(nginx), ["-u", "nginx.service"]);
  assertEquals(sourceArgs(kernel), ["-k"]);
  assertEquals(sourceArgs(shell), ["--user", "-u", "org.gnome.Shell@wayland.service"]);
  assertEquals(sourceArgs(parseEntry(line({ __CURSOR: "c", SYSLOG_IDENTIFIER: "cron" }))!), ["-t", "cron"]);
});

Deno.test("parseBoots reads JSON and the older text table", () => {
  const json = parseBoots(JSON.stringify([
    { index: -1, boot_id: "aaaabbbbccccddddeeeeffff00001111", first_entry: T - 86400e6, last_entry: T - 50000e6 },
    { index: 0, boot_id: "3a5f0c2d9e8b4f7a8c1d2e3f4a5b6c7d", first_entry: T - 7200e6, last_entry: T },
  ]));
  assertEquals(json.map((b) => b.index), [0, -1]);
  assertEquals(json[0].first, T / 1000 - 7200e3);
  const text = parseBoots(
    "IDX BOOT ID                          FIRST ENTRY                 LAST ENTRY\n" +
      " -1 aaaabbbbccccddddeeeeffff00001111 Mon 2026-10-27 08:01:12 CET Mon 2026-10-27 23:40:02 CET\n" +
      "  0 3a5f0c2d9e8b4f7a8c1d2e3f4a5b6c7d Tue 2026-10-28 08:00:59 CET Tue 2026-10-28 10:20:00 CET\n",
  );
  assertEquals(text.map((b) => [b.index, b.id]), [[0, "3a5f0c2d9e8b4f7a8c1d2e3f4a5b6c7d"], [
    -1,
    "aaaabbbbccccddddeeeeffff00001111",
  ]]);
  assert(Number.isFinite(text[0].first));
  assertEquals(parseBoots("No journal files were found."), []);
});

Deno.test("formatting helpers", () => {
  assertEquals(duration(45_000), "45 s");
  assertEquals(duration(3 * 3600_000 + 12 * 60_000), "3 h 12 min");
  assertEquals(duration(5 * 86400_000), "5 days");
  assertEquals(firstLine("\n  \nfirst\nsecond"), "first");
  assertEquals(firstLine("x".repeat(200), 10), "xxxxxxxxx…");
  assert(
    logLine(parseJournal(JOURNAL)[0]).endsWith(
      "nginx.service[2213]: nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)",
    ),
  );
  assertEquals(codeBlock("a ``` b"), "```\na ˋˋˋ b\n```");
});
