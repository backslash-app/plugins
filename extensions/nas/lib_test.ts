import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  ago,
  bytes,
  duration,
  healthAlerts,
  kindFrom,
  type Nas,
  raidName,
  summary,
  synologyError,
  synologyShares,
  synologyStorage,
  synologySystem,
  synoUptime,
  type TnDataset,
  type TnPool,
  truenasAlerts,
  truenasDatasets,
  truenasPools,
  truenasShares,
  truenasSystem,
  type UnArray,
  unraidAlerts,
  unraidArray,
  unraidContainers,
  unraidUptime,
  usage,
  usageColor,
} from "./lib.ts";
import { checkBase, HOSTS, isAllowedHost, SetupError } from "./net.ts";

const TIB = 1024 ** 4;

// ---------------------------------------------------------------------------
// TrueNAS

// Shaped like TrueNAS SCALE 24.10's /api/v2.0/pool.
const POOLS: TnPool[] = [
  {
    id: 1,
    name: "tank",
    status: "ONLINE",
    healthy: true,
    warning: false,
    status_detail: null,
    size: 8 * TIB,
    allocated: 6 * TIB,
    free: 2 * TIB,
    scan: { function: "SCRUB", state: "FINISHED", end_time: { $date: 1792310400000 }, errors: 0 },
    topology: {
      data: [{
        type: "MIRROR",
        name: "mirror-0",
        status: "ONLINE",
        children: [
          {
            type: "DISK",
            disk: "sda",
            status: "ONLINE",
            stats: { read_errors: 0, write_errors: 0, checksum_errors: 0 },
          },
          {
            type: "DISK",
            disk: "sdb",
            status: "ONLINE",
            stats: { read_errors: 0, write_errors: 0, checksum_errors: 2 },
          },
        ],
      }],
      cache: [],
      log: [],
      spare: [],
    },
  },
  {
    id: 2,
    name: "backup",
    status: "DEGRADED",
    healthy: false,
    status_detail: "One or more devices has been removed by the administrator.",
    size: 4 * TIB,
    allocated: 3.8 * TIB,
    topology: {
      data: [{
        type: "RAIDZ1",
        name: "raidz1-0",
        status: "DEGRADED",
        children: [
          { type: "DISK", disk: "sdc", status: "ONLINE" },
          { type: "DISK", disk: null, name: "1234567890", status: "REMOVED" },
          { type: "DISK", disk: "sde", status: "ONLINE" },
        ],
      }],
    },
  },
];

Deno.test("truenas: pools, layout, scrub and disks from the topology", () => {
  const { volumes, disks } = truenasPools(POOLS);
  const [tank, backup] = volumes;
  assertEquals(tank.health, "ok");
  assertEquals(tank.used, 6 * TIB);
  assertEquals(tank.total, 8 * TIB);
  assertEquals(tank.details[0], ["Layout", "MIRROR"]);
  assertEquals(tank.details[1][0], "Last scrub");
  assert(tank.details[1][1].startsWith("finished, "));
  assertEquals(backup.health, "warning");
  assertEquals(backup.details.at(-1), ["Detail", "One or more devices has been removed by the administrator."]);
  assertEquals(disks.map((d) => [d.name, d.health]), [
    ["sda", "ok"],
    ["sdb", "warning"],
    ["sdc", "ok"],
    ["1234567890", "offline"],
    ["sde", "ok"],
  ]);
  assertEquals(disks[1].errors, 2);
  assertEquals(disks[0].role, "tank data");
});

Deno.test("truenas: datasets, alerts, shares and system", () => {
  const datasets: TnDataset[] = [
    { id: "tank", used: { parsed: 6e12 }, available: { parsed: 2e12 }, mountpoint: "/mnt/tank", encrypted: false },
    { id: "tank/media", used: { parsed: 4e12, rawvalue: "4000000000000" }, available: { rawvalue: "2000000000000" } },
    { id: "tank/media/movies", used: { parsed: 3e12 } },
    { id: "tank/ix-applications", used: { parsed: 1e9 } },
    { id: "boot-pool", used: { parsed: 5e9 } },
    { id: "backup/vault", used: { parsed: 1e9 }, encrypted: true, locked: true },
  ];
  assertEquals(truenasDatasets(datasets).map((d) => d.name), ["backup/vault", "tank", "tank/media"]);
  assertEquals(truenasDatasets(datasets)[2].available, 2e12);
  assertEquals(truenasDatasets(datasets)[0].locked, true);

  const alerts = truenasAlerts([
    {
      uuid: "a1",
      level: "CRITICAL",
      formatted: "Pool backup state is DEGRADED. One or more devices has been removed.",
      dismissed: false,
      datetime: { $date: 1792483200000 },
    },
    { uuid: "a2", level: "WARNING", formatted: "Update available", dismissed: true },
    { uuid: "a3", level: "NOTICE", formatted: "<b>Scrub</b> of pool tank finished." },
  ]);
  assertEquals(alerts.length, 2);
  assertEquals(alerts[0].level, "critical");
  assertEquals(alerts[0].title, "Pool backup state is DEGRADED.");
  assertEquals(alerts[0].message, "One or more devices has been removed.");
  assertEquals(alerts[0].time, 1792483200000);
  assertEquals(alerts[1].title, "Scrub of pool tank finished.");
  assertEquals(alerts[1].level, "info");

  const shares = truenasShares(
    [{ id: 1, name: "media", path: "/mnt/tank/media", enabled: true, comment: "Movies" }],
    [{ id: 2, paths: ["/mnt/tank/backups"], enabled: false }, { id: 3, path: "/mnt/tank/vm" }],
  );
  assertEquals(shares.map((s) => [s.protocol, s.name, s.enabled]), [
    ["SMB", "media", true],
    ["NFS", "backups", false],
    ["NFS", "vm", true],
  ]);

  const sys = truenasSystem({
    version: "TrueNAS-SCALE-24.10.2",
    hostname: "truenas",
    physmem: 34_359_738_368,
    system_product: "ProLiant MicroServer Gen10 Plus",
    uptime_seconds: 1_036_800,
    loadavg: [2, 1.5, 1],
    cores: 4,
  });
  assertEquals(sys.version, "24.10.2");
  assertEquals(sys.model, "ProLiant MicroServer Gen10 Plus");
  assertEquals(sys.cpu, 0.5);
  assertEquals(bytes(sys.ram), "32.0 GiB");
});

// ---------------------------------------------------------------------------
// Synology

// Shaped like DSM 7.2's SYNO.Storage.CGI.Storage load_info.
const STORAGE = {
  volumes: [
    {
      id: "volume_1",
      vol_path: "/volume1",
      status: "normal",
      fs_type: "btrfs",
      size: { total: "11518034677760", used: "10637287915520" },
      pool_path: "reuse_1",
    },
    {
      id: "volume_2",
      vol_path: "/volume2",
      display_name: "Photos",
      status: "degraded",
      fs_type: "ext4",
      size: { total: "3839700721664", used: "1000000000000" },
      pool_path: "reuse_2",
    },
  ],
  storagePools: [
    { id: "reuse_1", status: "normal", device_type: "shr_with_1_disk_protect", disks: ["sata1", "sata2", "sata3"] },
    { id: "reuse_2", status: "degraded", device_type: "raid_1", disks: ["sata4"] },
  ],
  disks: [
    {
      id: "sata1",
      name: "Drive 1",
      longName: "Drive 1",
      vendor: "WDC     ",
      model: "WD40EFRX-68N32N0     ",
      status: "normal",
      overview_status: "normal",
      smart_status: "normal",
      temp: 36,
      size_total: "4000787030016",
      used_by: "reuse_1",
    },
    {
      id: "sata4",
      name: "Drive 4",
      longName: "Drive 4",
      model: "ST4000VN008",
      status: "normal",
      overview_status: "warning",
      smart_status: "abnormal",
      temp: 52,
      size_total: "4000787030016",
      used_by: "reuse_2",
    },
    { id: "sata5", name: "Drive 5", status: "not_initialized", temp: -1, used_by: "" },
  ],
};

Deno.test("synology: volumes with their pool, disks with SMART", () => {
  const { volumes, disks } = synologyStorage(STORAGE);
  const [v1, v2] = volumes;
  assertEquals(v1.name, "Volume 1");
  assertEquals(v1.health, "ok");
  assertEquals(v1.used, 10637287915520);
  assertEquals(usageColor(usage(v1)), "red");
  assert(v1.details.some(([k, v]) => k === "RAID" && v === "SHR (1-disk protection)"));
  assertEquals(v2.name, "Photos");
  assertEquals(v2.health, "warning");
  assertEquals(v2.status, "Degraded");
  assert(v2.details.some(([k, v]) => k === "Storage pool" && v === "Degraded"));
  assertEquals(disks[0].model, "WDC WD40EFRX-68N32N0");
  assertEquals(disks[0].temperature, 36);
  assertEquals(disks[0].role, "In a storage pool");
  assertEquals(disks[1].health, "warning");
  assertEquals(disks[2].health, "offline");
  assertEquals(disks[2].temperature, undefined);
  assertEquals(disks[2].role, "Not in use");
});

Deno.test("synology: system, uptime, shares, errors", () => {
  assertEquals(synoUptime("137:42:5"), 137 * 3600 + 42 * 60 + 5);
  assertEquals(synoUptime("5 days, 3:02:01"), 5 * 86400 + 3 * 3600 + 121);
  assertEquals(synoUptime(""), undefined);
  const s = synologySystem(
    { model: "DS920+", firmware_ver: "DSM 7.2.2-72806 Update 2", up_time: "48:00:00", sys_temp: 41, ram_size: 4096 },
    { cpu: { user_load: 7, system_load: 3, other_load: 2 }, memory: { real_usage: 34 } },
    "DiskStation",
  );
  assertEquals(s.name, "DiskStation");
  assertEquals(s.uptime, 172_800);
  assertEquals(s.cpu, 0.12);
  assertEquals(s.memory, 0.34);
  assertEquals(s.ram, 4 * 1024 ** 3);
  assertEquals(s.temperature, 41);
  assertEquals(synologyShares([{ name: "homes", vol_path: "/volume1", desc: "user home" }])[0].path, "/volume1/homes");
  assertEquals(raidName("shr"), "SHR");
  assertEquals(raidName("raid_5"), "RAID 5");
  assertEquals(synologyError(400, true), "Synology rejected the account or password");
  assertEquals(synologyError(105), "This Synology account isn't an administrator");
  assertEquals(synologyError(999), "Synology error 999");
});

// ---------------------------------------------------------------------------
// Unraid

// Shaped like the Unraid API's `array` (sizes in KiB, capacity as strings).
const ARRAY: UnArray = {
  state: "STARTED",
  capacity: { kilobytes: { free: "4000000000", used: "8000000000", total: "12000000000" } },
  parities: [{ id: "p1", name: "parity", device: "sdb", size: 7814026532, status: "DISK_OK", temp: 34, numErrors: 0 }],
  disks: [
    {
      id: "d1",
      name: "disk1",
      device: "sdc",
      size: 3907018532,
      status: "DISK_OK",
      temp: 33,
      numErrors: 0,
      fsSize: 3905110812,
      fsFree: 1000000000,
      fsUsed: 2905110812,
      fsType: "xfs",
    },
    { id: "d2", name: "disk2", device: "sdd", size: 3907018532, status: "DISK_DSBL", temp: null, numErrors: 12 },
    { id: "d3", name: "disk3", status: "DISK_NP" },
  ],
  caches: [{
    id: "c1",
    name: "cache",
    device: "nvme0n1",
    size: 976762552,
    status: "DISK_OK",
    temp: 45,
    numErrors: 0,
    fsSize: 976762552,
    fsFree: 600000000,
    fsUsed: 376762552,
    fsType: "btrfs",
  }],
};

Deno.test("unraid: array, disabled disk emulated by parity, cache pool", () => {
  const { volumes, disks } = unraidArray(ARRAY);
  const [arr, cache] = volumes;
  assertEquals(arr.health, "warning");
  assertEquals(arr.status, "Started");
  assertEquals(arr.used, 8000000000 * 1024);
  assertEquals(arr.total, 12000000000 * 1024);
  assert(arr.details.some(([k, v]) => k === "Failing disks" && v === "1"));
  assertEquals(cache.name, "cache");
  assertEquals(cache.type, "Cache");
  assertEquals(disks.map((d) => [d.name, d.role, d.health]), [
    ["parity", "Parity", "ok"],
    ["disk1", "Array", "ok"],
    ["disk2", "Array", "error"],
    ["cache", "Cache", "ok"],
  ]);
  assertEquals(disks[2].status, "Disabled");
  assertEquals(disks[1].used, 2905110812 * 1024);
  const stopped = unraidArray({ ...ARRAY, state: "STOPPED" });
  assertEquals(stopped.volumes[0].health, "offline");
  const two = unraidArray({
    ...ARRAY,
    disks: [{ name: "disk1", status: "DISK_DSBL" }, { name: "disk2", status: "DISK_INVALID" }],
  });
  assertEquals(two.volumes[0].health, "error");
});

Deno.test("unraid: containers, notifications and uptime", () => {
  const containers = unraidContainers([
    {
      id: "abc",
      names: ["/sonarr"],
      image: "lscr.io/linuxserver/sonarr",
      state: "EXITED",
      status: "Exited (0) 2 days ago",
    },
    {
      id: "def",
      names: ["/plex"],
      image: "plexinc/pms-docker",
      state: "RUNNING",
      status: "Up 3 days",
      autoStart: true,
    },
  ]);
  assertEquals(containers.map((c) => [c.name, c.running, c.state]), [["plex", true, "Running"], [
    "sonarr",
    false,
    "Exited",
  ]]);
  const alerts = unraidAlerts([
    {
      id: "n1",
      title: "Unraid Status",
      subject: "Disk 2 in error state (disk dsbl)",
      description: "WDC_WD40EFRX (sdd)",
      importance: "ALERT",
      timestamp: "2026-10-31T08:00:00.000Z",
    },
    { id: "n2", subject: "Docker update", importance: "INFO" },
  ]);
  assertEquals(alerts[0].level, "critical");
  assertEquals(alerts[0].title, "Disk 2 in error state (disk dsbl)");
  assertEquals(alerts[0].time, Date.parse("2026-10-31T08:00:00Z"));
  assertEquals(alerts[1].level, "info");
  const now = Date.parse("2026-10-31T10:00:00Z");
  assertEquals(unraidUptime("2026-10-30T10:00:00Z", now), 86400);
  assertEquals(unraidUptime(3600, now), 3600);
  assertEquals(unraidUptime("7200", now), 7200);
  assertEquals(unraidUptime(null, now), undefined);
});

// ---------------------------------------------------------------------------
// Shared

Deno.test("derived alerts: degraded, almost full, failing disks", () => {
  const { volumes, disks } = synologyStorage(STORAGE);
  const alerts = healthAlerts(volumes, disks);
  assertEquals(alerts.map((a) => [a.level, a.title]), [
    ["warning", "Volume 1 is 92 % full"],
    ["warning", "Volume Photos is degraded"],
    ["warning", "Drive 4: warning"],
  ]);
});

Deno.test("summary and formatting", () => {
  const { volumes, disks } = truenasPools(POOLS);
  const nas: Nas = {
    kind: "truenas",
    system: { name: "truenas" },
    volumes,
    disks,
    datasets: [],
    shares: [],
    alerts: [{ key: "a", level: "critical", title: "x" }, { key: "b", level: "warning", title: "y" }],
    containers: [],
  };
  assertEquals(summary(nas), "1 critical · 1 warning · 82 % used");
  assertEquals(summary({ ...nas, alerts: [], volumes: [] }), "healthy");
  assertEquals(bytes(512), "512 B");
  assertEquals(bytes(1536), "1.5 KiB");
  assertEquals(bytes(8 * TIB), "8.0 TiB");
  assertEquals(bytes(undefined), "");
  assertEquals(duration(1_036_800), "12d 0h");
  assertEquals(duration(5400), "1h 30m");
  assertEquals(usageColor(0.5), "green");
  assertEquals(usageColor(0.85), "orange");
  assertEquals(usage({ used: 5 }), undefined);
  assertEquals(ago(Date.parse("2026-10-31T09:30:00Z"), Date.parse("2026-10-31T10:00:00Z")), "30m ago");
});

Deno.test("kind and address", () => {
  assertEquals(kindFrom("TrueNAS SCALE", false), "truenas");
  assertEquals(kindFrom("DSM", false), "synology");
  assertEquals(kindFrom("", true), "synology");
  assertEquals(kindFrom("", false), undefined);
  assertEquals(checkBase("tower.local", "NAS"), "http://tower.local");
  assert(isAllowedHost("truenas"));
  assert(isAllowedHost("100.101.102.103"));
  assertThrows(() => checkBase("https://nas.example.com", "NAS"), SetupError, "outside");
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, HOSTS);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
