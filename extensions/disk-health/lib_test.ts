import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  ago,
  btrfsFilesystems,
  criticalWarnings,
  diskName,
  explainTestError,
  health,
  hours,
  installSmartctl,
  kind,
  NVME_UNIT,
  osFamily,
  parseDeviceStats,
  parseLsblk,
  parseReadScript,
  parseScrubStatus,
  parseSmart,
  parseZpoolList,
  parseZpoolStatus,
  readScript,
  size,
} from "./lib.ts";

const LSBLK = JSON.stringify({
  blockdevices: [
    { name: "loop0", path: "/dev/loop0", type: "loop", size: 4096, rota: false, rm: false },
    {
      name: "nvme0n1",
      path: "/dev/nvme0n1",
      type: "disk",
      size: 1000204886016,
      model: "Samsung SSD 980 PRO 1TB",
      vendor: null,
      serial: "S5GXNF0R123456",
      rev: "5B2QGXA7",
      tran: "nvme",
      rota: false,
      rm: false,
      children: [
        {
          name: "nvme0n1p1",
          path: "/dev/nvme0n1p1",
          type: "part",
          fstype: "vfat",
          uuid: "AB12",
          mountpoint: "/boot/efi",
        },
        {
          name: "nvme0n1p2",
          path: "/dev/nvme0n1p2",
          type: "part",
          fstype: "btrfs",
          uuid: "u-1",
          label: "fedora",
          mountpoint: "/home",
        },
      ],
    },
    {
      name: "sda",
      path: "/dev/sda",
      type: "disk",
      size: "4000787030016",
      model: "WDC_WD40EFRX-68N32N0",
      vendor: "ATA     ",
      tran: "sata",
      rota: "1",
      rm: "0",
      children: [{ name: "sda1", path: "/dev/sda1", type: "part", fstype: "btrfs", uuid: "u-1", mountpoint: "/" }],
    },
    { name: "sr0", path: "/dev/sr0", type: "rom", size: 1073741312 },
    { name: "zram0", path: "/dev/zram0", type: "disk", size: 8589934592 },
  ],
});

Deno.test("lsblk: physical disks only, with their filesystems", () => {
  const disks = parseLsblk(LSBLK);
  assertEquals(disks.map((d) => d.name), ["nvme0n1", "sda"]);
  assertEquals(disks[1].model, "WDC WD40EFRX-68N32N0");
  assertEquals(disks[1].rotational, true);
  assertEquals(disks[0].filesystems.map((f) => f.fstype), ["vfat", "btrfs"]);
  assertEquals(kind(disks[0]), "NVMe SSD");
  assertEquals(kind(disks[1]), "SATA HDD");
  assertEquals(diskName(disks[1]), "ATA WDC WD40EFRX-68N32N0");
});

Deno.test("btrfs: one entry per filesystem, mounted at the shortest path", () => {
  const fs = btrfsFilesystems(parseLsblk(LSBLK));
  assertEquals(fs.length, 1);
  assertEquals(fs[0].mountpoint, "/");
  assertEquals(fs[0].devices, ["/dev/nvme0n1p2", "/dev/sda1"]);
  assertEquals(fs[0].label, "fedora");
});

const ATA = JSON.stringify({
  smartctl: { version: [7, 4], exit_status: 0 },
  device: { name: "/dev/sda", type: "sat", protocol: "ATA" },
  model_name: "WDC WD40EFRX-68N32N0",
  serial_number: "WD-WCC7K1234567",
  firmware_version: "82.00A82",
  user_capacity: { blocks: 7814037168, bytes: 4000787030016 },
  logical_block_size: 512,
  rotation_rate: 5400,
  smart_support: { available: true, enabled: true },
  smart_status: { passed: true },
  ata_smart_data: {
    self_test: {
      status: { value: 0, string: "completed without error", passed: true },
      polling_minutes: { short: 2, extended: 497 },
    },
  },
  ata_smart_attributes: {
    table: [
      {
        id: 5,
        name: "Reallocated_Sector_Ct",
        value: 200,
        worst: 200,
        thresh: 140,
        when_failed: "",
        raw: { value: 8, string: "8" },
      },
      {
        id: 9,
        name: "Power_On_Hours",
        value: 62,
        worst: 62,
        thresh: 0,
        when_failed: "",
        raw: { value: 28000, string: "28000" },
      },
      {
        id: 194,
        name: "Temperature_Celsius",
        value: 115,
        worst: 100,
        thresh: 0,
        when_failed: "",
        raw: { value: 37, string: "37" },
      },
      {
        id: 197,
        name: "Current_Pending_Sector",
        value: 200,
        worst: 200,
        thresh: 0,
        when_failed: "",
        raw: { value: 0, string: "0" },
      },
      {
        id: 198,
        name: "Offline_Uncorrectable",
        value: 100,
        worst: 253,
        thresh: 0,
        when_failed: "",
        raw: { value: 0, string: "0" },
      },
    ],
  },
  power_on_time: { hours: 28000 },
  power_cycle_count: 123,
  temperature: { current: 37 },
  ata_smart_self_test_log: {
    standard: {
      table: [{
        type: { value: 1, string: "Short offline" },
        status: { value: 0, string: "Completed without error", passed: true },
        lifetime_hours: 27990,
      }],
    },
  },
});

const NVME = JSON.stringify({
  smartctl: { version: [7, 4], exit_status: 0 },
  device: { name: "/dev/nvme0n1", type: "nvme", protocol: "NVMe" },
  model_name: "Samsung SSD 980 PRO 1TB",
  serial_number: "S5GXNF0R123456",
  firmware_version: "5B2QGXA7",
  nvme_total_capacity: 1000204886016,
  smart_support: { available: true, enabled: true },
  smart_status: { passed: true, nvme: { value: 0 } },
  nvme_smart_health_information_log: {
    critical_warning: 0,
    temperature: 41,
    available_spare: 100,
    available_spare_threshold: 10,
    percentage_used: 3,
    data_units_read: 20000000,
    data_units_written: 30000000,
    power_cycles: 900,
    power_on_hours: 4321,
    unsafe_shutdowns: 42,
    media_errors: 0,
  },
  temperature: { current: 41 },
  power_on_time: { hours: 4321 },
  power_cycle_count: 900,
  nvme_self_test_log: {
    current_self_test_operation: { value: 1, string: "Short self-test in progress" },
    current_self_test_completion_percent: 30,
    table: [{
      self_test_code: { value: 1, string: "Short" },
      self_test_result: { value: 0, string: "Completed without error" },
      power_on_hours: 4000,
    }],
  },
});

Deno.test("smart: SATA hard drive", () => {
  const s = parseSmart("/dev/sda", ATA);
  assertEquals(s.protocol, "ATA");
  assertEquals(s.passed, true);
  assertEquals(s.temperature, 37);
  assertEquals(s.powerOnHours, 28000);
  assertEquals(s.reallocated, 8);
  assertEquals(s.pending, 0);
  assertEquals(s.shortTestMinutes, 2);
  assertEquals(s.lastTest?.result, "Completed without error");
  assertEquals(s.testRemaining, undefined);
  const h = health(s);
  assertEquals(h.level, "warning");
  assertEquals(h.reasons, ["8 reallocated sectors"]);
});

Deno.test("smart: NVMe drive with a running self-test", () => {
  const s = parseSmart("/dev/nvme0n1", NVME);
  assertEquals(s.lifeUsed, 3);
  assertEquals(s.bytesWritten, 30000000 * NVME_UNIT);
  assertEquals(size(s.bytesWritten!), "15.4 TB");
  assertEquals(s.unsafeShutdowns, 42);
  assertEquals(s.testRemaining, 70);
  assertEquals(s.shortTestMinutes, 2);
  assertEquals(health(s).level, "good");
});

Deno.test("smart: failing, hot, worn out", () => {
  const s = parseSmart("/dev/sda", ATA);
  assertEquals(health({ ...s, passed: false }).level, "failing");
  const n = parseSmart("/dev/nvme0n1", NVME);
  const worn = health({ ...n, lifeUsed: 95, temperature: 75, criticalWarning: 1 });
  assertEquals(worn.level, "failing");
  assert(worn.reasons.some((r) => r.includes("95%")));
  assert(worn.reasons.some((r) => r.includes("75 °C")));
  assertEquals(criticalWarnings(0b1001), ["spare below threshold", "read-only mode"]);
});

Deno.test("smart: unsupported drives and garbage", () => {
  const usb = parseSmart(
    "/dev/sdb",
    JSON.stringify({
      smartctl: {
        messages: [{ string: "/dev/sdb: Unknown USB bridge [0x1234:0x5678 (0x100)]", severity: "error" }],
        exit_status: 1,
      },
    }),
  );
  assertEquals(usb.available, false);
  assertStringIncludes(usb.error!, "Unknown USB bridge");
  assertEquals(health(usb).level, "unknown");
  assertEquals(parseSmart("/dev/sdc", "sh: smartctl: not found").error, "sh: smartctl: not found");
  assertEquals(health(undefined).label, "Not read");
});

Deno.test("smart: SATA SSD wear from device statistics or attributes", () => {
  const stats = JSON.parse(ATA);
  stats.ata_device_statistics = {
    pages: [{ number: 7, table: [{ name: "Percentage Used Endurance Indicator", value: 12, flags: { valid: true } }] }],
  };
  assertEquals(parseSmart("/dev/sda", JSON.stringify(stats)).lifeUsed, 12);
  const attr = JSON.parse(ATA);
  attr.ata_smart_attributes.table.push({
    id: 177,
    name: "Wear_Leveling_Count",
    value: 91,
    worst: 91,
    thresh: 0,
    raw: { value: 120 },
  });
  attr.ata_smart_attributes.table.push({
    id: 241,
    name: "Total_LBAs_Written",
    value: 99,
    worst: 99,
    thresh: 0,
    raw: { value: 2000000000 },
  });
  const s = parseSmart("/dev/sda", JSON.stringify(attr));
  assertEquals(s.lifeUsed, 9);
  assertEquals(s.bytesWritten, 2000000000 * 512);
});

Deno.test("btrfs scrub status: current and old layouts", () => {
  const finished = parseScrubStatus(`UUID:             5c0f1d7e-1234-4bcd-9a6e-1234567890ab
Scrub started:    Sun Oct 26 03:00:01 2026
Status:           finished
Duration:         0:05:12
Total to scrub:   120.00GiB
Rate:             393.85MiB/s
Error summary:    no errors found
`);
  assertEquals(finished.status, "finished");
  assertEquals(finished.duration, "0:05:12");
  assertEquals(finished.errors, 0);

  const bad = parseScrubStatus(`UUID:             5c0f
Scrub started:    Sun Oct 26 03:00:01 2026
Status:           running
Duration:         0:01:00
Time left:        0:04:00
Bytes scrubbed:   24.00GiB  (20.00%)
Error summary:    csum=2 verify=1
  Corrected:      1
  Uncorrectable:  2
  Unverified:     0
`);
  assertEquals(bad.status, "running");
  assertEquals(bad.progress, 20);
  assertEquals(bad.errors, 3);

  assertEquals(parseScrubStatus("UUID: x\n\tno stats available\n").status, "never");
  const old = parseScrubStatus(
    "scrub status for 5c0f\n\tscrub started at Sun Oct 26 03:00:01 2026 and finished after 00:05:12\n\ttotal bytes scrubbed: 1.23GiB with 4 errors\n",
  );
  assertEquals(old.status, "finished");
  assertEquals(old.errors, 4);
});

Deno.test("btrfs device stats", () => {
  const stats = parseDeviceStats(`[/dev/nvme0n1p2].write_io_errs    0
[/dev/nvme0n1p2].read_io_errs     0
[/dev/nvme0n1p2].flush_io_errs    0
[/dev/nvme0n1p2].corruption_errs  3
[/dev/nvme0n1p2].generation_errs  0
[/dev/sda1].write_io_errs    0
[/dev/sda1].read_io_errs     1
`);
  assertEquals(stats.length, 2);
  assertEquals(stats[0].total, 3);
  assertEquals(stats[0].counters.corruption_errs, 3);
  assertEquals(stats[1].total, 1);
});

Deno.test("zpool list and status", () => {
  const pools = parseZpoolList(
    "tank\t10.9T\t4.20T\t6.70T\t3%\t38%\tONLINE\nbackup\t1.81T\t1.70T\t110G\t20%\t93%\tDEGRADED\n",
  );
  assertEquals(pools.map((p) => [p.name, p.capacity, p.health]), [["tank", 38, "ONLINE"], ["backup", 93, "DEGRADED"]]);
  const status = parseZpoolStatus(`  pool: backup
 state: DEGRADED
status: One or more devices could not be opened.  Sufficient replicas exist for
	the pool to continue functioning in a degraded state.
action: Attach the missing device and online it using 'zpool online'.
  scan: scrub repaired 0B in 01:02:03 with 0 errors on Sun Oct 12 01:26:04 2026
config:

	NAME        STATE     READ WRITE CKSUM
	backup      DEGRADED     0     0     0
	  mirror-0  DEGRADED     0     0     0
	    sdb     ONLINE       0     0     0
	    sdc     UNAVAIL      0     0     0  cannot open

errors: No known data errors

  pool: tank
 state: ONLINE
  scan: scrub in progress since Wed Oct 29 10:00:00 2026
config:

	NAME        STATE     READ WRITE CKSUM
	tank        ONLINE       0     0     0
	  sdd       ONLINE       0     0     0

errors: No known data errors
`);
  const backup = status.get("backup")!;
  assertEquals(backup.state, "DEGRADED");
  assertStringIncludes(backup.status!, "degraded state");
  assertStringIncludes(backup.scan!, "with 0 errors");
  assertEquals(backup.devices!.map((d) => [d.name, d.state]), [["mirror-0", "DEGRADED"], ["sdb", "ONLINE"], [
    "sdc",
    "UNAVAIL",
  ]]);
  assertEquals(status.get("tank")!.errors, "No known data errors");
  assertStringIncludes(status.get("tank")!.scan!, "in progress");
});

Deno.test("root script: built quoted, parsed back by sections", () => {
  const script = readScript(["/dev/sda", "/dev/nvme0n1"], ["/", "/mnt/my data"]);
  assertStringIncludes(script, "for d in /dev/sda /dev/nvme0n1; do");
  assertStringIncludes(script, `for m in / '/mnt/my data'; do`);
  const out =
    `@@smart /dev/sda\n${ATA}\n@@smart /dev/nvme0n1\n${NVME}\n@@scrub /\nStatus: finished\nError summary: no errors found\n` +
    `@@stats /\n[/dev/sda1].read_io_errs 0\n`;
  const report = parseReadScript(out);
  assertEquals(Object.keys(report.smart), ["/dev/sda", "/dev/nvme0n1"]);
  assertEquals(report.smart["/dev/nvme0n1"].lifeUsed, 3);
  assertEquals(report.scrub["/"].status, "finished");
  assertEquals(report.stats["/"][0].device, "/dev/sda1");
  assertEquals(parseReadScript("@@missing smartctl\n").missing, ["smartctl"]);
});

Deno.test("formatting", () => {
  assertEquals(hours(30), "30 h");
  assertEquals(hours(24 * 40), "40 days");
  assertEquals(hours(28000), "3.2 years");
  assertEquals(size(4000787030016), "4 TB");
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(ago(now - 30_000, now), "just now");
  assertEquals(ago(now - 3 * 3600_000, now), "3 h ago");
  assertEquals(ago(now - 26 * 3600_000, now), "1 day ago");
  assertEquals(
    explainTestError(
      "Can't start self-test without aborting current test (90% remaining),\nadd '-t force'... in progress",
    ),
    "A self-test is already running on this drive",
  );
  assertEquals(installSmartctl(osFamily('ID=fedora\nID_LIKE=""\n')), "sudo dnf install smartmontools");
  assertEquals(installSmartctl(osFamily('ID=pop\nID_LIKE="ubuntu debian"\n')), "sudo apt install smartmontools");
});
