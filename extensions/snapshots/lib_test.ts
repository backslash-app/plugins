import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  ago,
  changeRange,
  changesMarkdown,
  countChanges,
  diffMarkdown,
  formatBytes,
  holdOpen,
  MARK,
  parseBtrfsList,
  parseLocalDate,
  parseSnapperConfigs,
  parseSnapperList,
  parseSnapperStatus,
  parseTimeshiftConfig,
  parseTimeshiftList,
  pkexecError,
  rootIsBtrfs,
  snapperCreateArgs,
  snapperError,
  snapperTitle,
  snapperUndoScript,
  sortSnapshots,
  splitMarked,
  timeshiftRestoreScript,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

const TIMESHIFT_LIST =
  `/dev/nvme0n1p2 is mounted at: /run/timeshift/12345/backup, options: rw,relatime,ssd,space_cache=v2

Device : /dev/nvme0n1p2
UUID   : 6d2a1c3e-90f1-4b6e-8a43-3c1d0e2f9b11
Path   : /run/timeshift/12345/backup
Mode   : BTRFS
Status : OK
4 snapshots, 101.5 GB free

Num     Name                 Tags     Description
------------------------------------------------------------------------------
0    >  2024-02-28_09-00-01  B D
1    >  2024-03-01_09-41-06  O        before kernel 6.8
2    >  2024-03-02_10-00-01  W
3    >  2024-03-03_12-30-00  O        B and W test
`;

const TIMESHIFT_CONF = JSON.stringify({
  backup_device_uuid: "6d2a1c3e-90f1-4b6e-8a43-3c1d0e2f9b11",
  parent_device_uuid: "",
  do_first_run: "false",
  btrfs_mode: "true",
  include_btrfs_home_for_backup: "false",
  include_btrfs_home_for_restore: "false",
  stop_cron_emails: "true",
  schedule_monthly: "false",
  schedule_weekly: "true",
  schedule_daily: "true",
  schedule_hourly: "false",
  schedule_boot: "true",
  count_monthly: "2",
  count_weekly: "3",
  count_daily: "5",
  count_hourly: "6",
  count_boot: "5",
  exclude: [],
});

const SNAPPER_CONFIGS = `{
  "configs": [
    { "config": "home", "subvolume": "/home" },
    { "config": "root", "subvolume": "/" }
  ]
}`;

const SNAPPER_LIST = `{
  "root": [
    { "number": 0, "default": false, "active": false, "type": "single", "pre-number": null, "date": "",
      "user": "root", "used-space": null, "cleanup": "", "description": "current", "userdata": null },
    { "number": 1, "default": false, "active": false, "type": "single", "pre-number": null,
      "date": "2024-01-17 09:41:06", "user": "root", "used-space": 16384, "cleanup": "",
      "description": "first root filesystem", "userdata": null },
    { "number": 41, "default": false, "active": false, "type": "pre", "pre-number": null,
      "date": "2024-03-01 10:00:00", "user": "root", "used-space": 52428800, "cleanup": "number",
      "description": "zypp(zypper)", "userdata": { "important": "yes" } },
    { "number": 42, "default": true, "active": true, "type": "post", "pre-number": 41,
      "date": "2024-03-01 10:02:30", "user": "root", "used-space": 1048576, "cleanup": "number",
      "description": "", "userdata": { "important": "yes" } },
    { "number": 43, "default": false, "active": false, "type": "pre", "pre-number": null,
      "date": "2024-03-02 08:00:00", "user": "root", "cleanup": "number", "description": "pacman -Syu",
      "userdata": null }
  ]
}`;

const SNAPPER_STATUS = `c..... /etc/fstab
+..... /etc/new.conf
-..... /usr/lib/old.so
.p.... /etc/sudoers
cpug.. /etc/group
t..... /var/lib/link
`;

const BTRFS = `ID 260 gen 1052 cgen 1051 top level 256 otime 2024-03-01 09:00:00 path @/.snapshots/1/snapshot
ID 275 gen 1200 cgen 1199 top level 5 otime 2024-03-04 18:12:45 path <FS_TREE>/@snapshots/manual-before-upgrade
`;

Deno.test("timeshift list: device, snapshots, tags and descriptions", () => {
  const { device, snapshots } = parseTimeshiftList(TIMESHIFT_LIST);
  assertEquals(device.device, "/dev/nvme0n1p2");
  assertEquals(device.mode, "BTRFS");
  assertEquals(device.status, "OK");
  assertEquals(device.free, "101.5 GB");
  assertEquals(snapshots.length, 4);
  assertEquals(snapshots[0].id, "2024-02-28_09-00-01");
  assertEquals(snapshots[0].tags, ["boot", "daily"]);
  assertEquals(snapshots[0].description, "");
  assertEquals(snapshots[1].tags, ["ondemand"]);
  assertEquals(snapshots[1].description, "before kernel 6.8");
  assertEquals(snapshots[2].tags, ["weekly"]);
  // A description starting with tag letters stays a description.
  assertEquals(snapshots[3].description, "B and W test");
  assertEquals(snapshots[3].tags, ["ondemand"]);
  assertEquals(new Date(snapshots[1].date!).getHours(), 9);
});

Deno.test("timeshift config", () => {
  const c = parseTimeshiftConfig(TIMESHIFT_CONF);
  assertEquals(c.btrfs, true);
  assertEquals(c.schedule, ["boot", "daily", "weekly"]);
  assertEquals(c.counts.daily, 5);
  assertEquals(c.includeHome, false);
  assertEquals(c.deviceUuid, "6d2a1c3e-90f1-4b6e-8a43-3c1d0e2f9b11");
});

Deno.test("snapper configs and list", () => {
  assertEquals(parseSnapperConfigs(SNAPPER_CONFIGS).map((c) => c.name), ["home", "root"]);
  const list = parseSnapperList(SNAPPER_LIST);
  assertEquals(list.map((s) => s.id), ["1", "41", "42", "43"]); // "current" is skipped
  const post = list.find((s) => s.id === "42")!;
  assertEquals(post.kind, "post");
  assertEquals(post.preNumber, 41);
  assertEquals(post.isDefault, true);
  assertEquals(post.size, 1048576);
  assertEquals(post.userdata, { important: "yes" });
  assertEquals(list[0].cleanup, undefined);
  assertEquals(list.find((s) => s.id === "43")!.size, undefined);
  assertEquals(snapperTitle(post, list), "zypp(zypper)");
  assertEquals(sortSnapshots(list).map((s) => s.id), ["43", "42", "41", "1"]);
});

Deno.test("snapper change ranges", () => {
  const list = parseSnapperList(SNAPPER_LIST);
  const get = (id: string) => list.find((s) => s.id === id)!;
  assertEquals(changeRange(get("42"), list), { from: "41", to: "42", label: "#41 → #42" });
  assertEquals(changeRange(get("41"), list), { from: "41", to: "42", label: "#41 → #42" });
  assertEquals(changeRange(get("43"), list), { from: "43", to: "0", label: "#43 → now" });
  assertEquals(changeRange(get("1"), list).to, "0");
});

Deno.test("snapper status", () => {
  const changes = parseSnapperStatus(SNAPPER_STATUS);
  assertEquals(changes.length, 6);
  assertEquals(changes[0], { path: "/etc/fstab", kind: "modified", meta: [] });
  assertEquals(changes[3], { path: "/etc/sudoers", kind: "modified", meta: ["permissions"] });
  assertEquals(changes[4].meta, ["permissions", "owner", "group"]);
  assertEquals(countChanges(changes), { created: 1, deleted: 1, modified: 3, type: 1 });
  const md = changesMarkdown(changes, 2);
  assert(md.startsWith("```\n~ /etc/fstab"));
  assert(md.includes("…and 4 more"));
  assertEquals(changesMarkdown([]), "No file changed.");
});

Deno.test("diff markdown is fenced and cut", () => {
  const diff = "--- a/etc/x\n+++ b/etc/x\n@@ -1 +1 @@\n-a\n+b\n";
  assert(diffMarkdown(diff).startsWith("```diff\n--- a/etc/x"));
  const long = Array.from({ length: 2000 }, (_, i) => `+line ${i}`).join("\n");
  const cut = diffMarkdown(long, 1000);
  assert(cut.length < 1200);
  assert(cut.includes("Cut"));
  assertEquals(diffMarkdown("  \n"), "No difference in file contents.");
});

Deno.test("snapper create arguments and errors", () => {
  assertEquals(snapperCreateArgs("root", { description: "Before upgrade", cleanup: "number", important: true }), [
    "-c",
    "root",
    "create",
    "--print-number",
    "--description",
    "Before upgrade",
    "--cleanup-algorithm",
    "number",
    "--userdata",
    "important=yes",
  ]);
  assertEquals(snapperCreateArgs("home", { description: "x", cleanup: "none", important: false }).length, 6);
  assertEquals(snapperError("No permissions."), "Snapper needs your password for this config");
  assertEquals(snapperError("Unknown config."), "Snapper doesn't know this config");
});

Deno.test("btrfs list and mounts", () => {
  const list = parseBtrfsList(BTRFS);
  assertEquals(list.length, 2);
  assertEquals(list[0].id, "260");
  assertEquals(list[0].path, "@/.snapshots/1/snapshot");
  assertEquals(list[1].path, "@snapshots/manual-before-upgrade");
  assertEquals(list[1].description, "manual-before-upgrade");
  assert(list[1].date);
  assert(rootIsBtrfs("/dev/nvme0n1p2 / btrfs rw,relatime,subvol=/@ 0 0\nproc /proc proc rw 0 0"));
  assert(!rootIsBtrfs("/dev/sda2 / ext4 rw 0 0\n/dev/sda3 /home btrfs rw 0 0"));
});

Deno.test("dates and sizes", () => {
  assertEquals(parseLocalDate("nope"), undefined);
  const t = parseLocalDate("2024-03-01_09-41-06")!;
  assertEquals(t, parseLocalDate("2024-03-01 09:41:06"));
  assertEquals(ago(t, t + 30_000), "just now");
  assertEquals(ago(t, t + 5 * 60_000), "5 min ago");
  assertEquals(ago(t, t + 3 * 3600_000), "3 h ago");
  assertEquals(ago(t, t + 86400_000), "yesterday");
  assertEquals(ago(t, t + 10 * 86400_000), "10 days ago");
  assertEquals(ago(t, t + 70 * 86400_000), "2 months ago");
  assertEquals(formatBytes(16384), "16.0 KB");
  assertEquals(formatBytes(52428800), "50.0 MB");
  assertEquals(formatBytes(512), "512 B");
});

Deno.test("root scripts: markers, pkexec and terminal scripts", () => {
  assertEquals(splitMarked(`42\n${MARK}\n{"root":[]}\n${MARK}\n`), ["42", `{"root":[]}`, ""]);
  assertEquals(splitMarked(`${MARK}\nlist\n`), ["", "list\n"]);
  assertEquals(pkexecError(126, ""), "Authentication was cancelled");
  assertEquals(pkexecError(0, ""), undefined);
  const restore = timeshiftRestoreScript("2024-03-01_09-41-06");
  assertEquals(restore.slice(0, 2), ["sh", "-c"]);
  assert(restore[2].includes("sudo timeshift --restore --snapshot 2024-03-01_09-41-06"));
  assert(restore[2].includes("read -r _"));
  const undo = snapperUndoScript("root", "41", "42");
  assert(undo[2].includes("sudo snapper -c root undochange 41..42"));
  assert(undo[2].includes("sudo snapper -c root status 41..42"));
  assertEquals(holdOpen(["true"])[2].split("\n")[0], "true");
});

Deno.test("every terminal and program is allowed by the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
    commands: { name: string }[];
  };
  const run = new Set(manifest.permissions.run);
  for (const t of [...TERMINALS, "snapper", "pkexec"]) assert(run.has(t), `${t} is not in run`);
  for (const c of manifest.commands) {
    await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  }
});
