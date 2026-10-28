import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  bytes,
  cpuTemperature,
  cpuUsage,
  duration,
  interfaceKind,
  isPhysicalInterface,
  levelColor,
  parseCpuinfo,
  parseCpuStat,
  parseDf,
  parseGrep,
  parseLoadavg,
  parseMeminfo,
  parseMounts,
  parseNetDev,
  parseNvidiaSmi,
  parseProcStat,
  parsePs,
  parsePsArgs,
  processCpu,
  push,
  realDisks,
  sparkline,
} from "./lib.ts";

Deno.test("grep -H output is split back into files", () => {
  const files = parseGrep(
    "/proc/uptime:2112.17 8289.42\n/proc/loadavg:0.44 0.23 0.11 1/105 5099\n" +
      "/proc/meminfo:MemTotal:       16477352 kB\n/proc/meminfo:MemFree:        15780280 kB\n",
  );
  assertEquals(files.get("/proc/uptime"), "2112.17 8289.42");
  assertEquals(files.get("/proc/meminfo"), "MemTotal:       16477352 kB\nMemFree:        15780280 kB");
  assertEquals(files.has("/sys/class/hwmon/hwmon0/name"), false);
});

const STAT_A = `cpu  4643 0 2717 659833 2391 0 219 161 0 0
cpu0 1045 0 683 165211 409 0 85 39 0 0
cpu1 1164 0 733 164836 661 0 57 38 0 0
intr 454653 0 0 0
ctxt 1234`;
const STAT_B = `cpu  4743 0 2767 659983 2391 0 219 161 0 0
cpu0 1145 0 683 165211 409 0 85 39 0 0
cpu1 1164 0 783 164986 661 0 57 38 0 0`;

Deno.test("cpu usage from two /proc/stat samples", () => {
  const a = parseCpuStat(STAT_A);
  const b = parseCpuStat(STAT_B);
  assertEquals(a.cores.length, 2);
  assertEquals(a.total.idle, 659833 + 2391);
  // 150 busy jiffies out of 300.
  assertAlmostEquals(cpuUsage(a.total, b.total), 0.5);
  assertEquals(cpuUsage(a.cores[0], b.cores[0]), 1);
  assertAlmostEquals(cpuUsage(a.cores[1], b.cores[1]), 0.25);
  assertEquals(cpuUsage(a.total, a.total), 0);
});

Deno.test("cpuinfo on x86 and ARM", () => {
  const x86 = parseCpuinfo(`processor	: 0
vendor_id	: GenuineIntel
model name	: 13th Gen Intel(R) Core(TM) i7-1360P
cpu MHz		: 1200.000
physical id	: 0
core id		: 0

processor	: 1
model name	: 13th Gen Intel(R) Core(TM) i7-1360P
cpu MHz		: 2400.000
physical id	: 0
core id		: 0

processor	: 2
model name	: 13th Gen Intel(R) Core(TM) i7-1360P
cpu MHz		: 1800.000
physical id	: 0
core id		: 4
`);
  assertEquals(x86, { model: "13th Gen Intel Core i7-1360P", threads: 3, cores: 2, mhz: 1800 });
  const arm = parseCpuinfo(`processor	: 0
BogoMIPS	: 108.00
CPU implementer	: 0x41

processor	: 1
BogoMIPS	: 108.00

Hardware	: BCM2835
Model		: Raspberry Pi 4 Model B Rev 1.4
`);
  assertEquals(arm.model, "Raspberry Pi 4 Model B Rev 1.4");
  assertEquals(arm.threads, 2);
  assertEquals(arm.mhz, undefined);
});

Deno.test("loadavg", () => {
  assertEquals(parseLoadavg("0.07 0.09 0.04 1/109 3352\n"), {
    one: 0.07,
    five: 0.09,
    fifteen: 0.04,
    running: 1,
    processes: 109,
  });
});

Deno.test("temperature: package sensor first, then CPU sensors, then ACPI", () => {
  assertEquals(
    cpuTemperature([
      { chip: "nvme", label: "Composite", celsius: 41 },
      { chip: "coretemp", label: "Core 0", celsius: 55 },
      { chip: "coretemp", label: "Package id 0", celsius: 58 },
    ]),
    58,
  );
  assertEquals(
    cpuTemperature([{ chip: "k10temp", label: "Tccd1", celsius: 62 }, { chip: "k10temp", celsius: 66 }]),
    66,
  );
  assertEquals(cpuTemperature([{ chip: "acpitz", celsius: 47 }, { chip: "amdgpu", label: "edge", celsius: 50 }]), 47);
  assertEquals(cpuTemperature([{ chip: "nvme", celsius: 40 }]), undefined);
});

Deno.test("meminfo: used is total minus available", () => {
  const m = parseMeminfo(`MemTotal:       16477352 kB
MemFree:         1780280 kB
MemAvailable:    9848740 kB
Buffers:           13916 kB
Cached:          6273544 kB
SwapCached:            0 kB
SwapTotal:       8388604 kB
SwapFree:        8126460 kB
SReclaimable:     312000 kB
`);
  assertEquals(m.total, 16477352 * 1024);
  assertEquals(m.used, (16477352 - 9848740) * 1024);
  assertEquals(m.swapUsed, (8388604 - 8126460) * 1024);
  assertEquals(m.cached, (6273544 + 312000) * 1024);
});

const DF = `Filesystem     1024-blocks      Used Available Capacity Mounted on
/dev/nvme0n1p2   490617784 211430520 254191496      46% /
tmpfs              8133576     91124   8042452       2% /dev/shm
/dev/nvme0n1p1     1046508     71960    974548       7% /boot/efi
/dev/nvme0n1p2   490617784 211430520 254191496      46% /home
/dev/sda1         60014592  12345678  47668914      21% /run/media/ada/USB STICK
/dev/loop3           75776     75776         0     100% /snap/core22/1612
portal                   0         0         0       0% /run/user/1000/doc`;

const MOUNTS = `/dev/nvme0n1p2 / btrfs rw,relatime 0 0
tmpfs /dev/shm tmpfs rw 0 0
/dev/nvme0n1p1 /boot/efi vfat rw 0 0
/dev/nvme0n1p2 /home btrfs rw,relatime,subvol=/home 0 0
/dev/sda1 /run/media/ada/USB\\040STICK exfat rw 0 0
/dev/loop3 /snap/core22/1612 squashfs ro 0 0
portal /run/user/1000/doc fuse.portal rw 0 0`;

Deno.test("df and mounts: real disks only, subvolumes once", () => {
  const df = parseDf(DF);
  assertEquals(df.length, 7);
  assertEquals(df[4].mount, "/run/media/ada/USB STICK");
  assertEquals(df[0].size, 490617784 * 1024);
  const mounts = parseMounts(MOUNTS);
  assertEquals(mounts.get("/run/media/ada/USB STICK"), { device: "/dev/sda1", fstype: "exfat" });
  const disks = realDisks(df, mounts);
  assertEquals(disks.map((d) => [d.mount, d.fstype]), [
    ["/", "btrfs"],
    ["/boot/efi", "vfat"],
    ["/run/media/ada/USB STICK", "exfat"],
  ]);
});

Deno.test("network counters and interface kinds", () => {
  const net = parseNetDev(`Inter-|   Receive                                                |  Transmit
 face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
    lo: 23199805    5880    0    0    0     0          0         0 23199805    5880    0    0    0     0       0          0
  eth0: 26803741   25442    0    6    0     0          0         0 163159080   25101    0    0    0     0       0          0
wlp2s0:123 4 0 0 0 0 0 0 456 7 0 0 0 0 0 0`);
  assertEquals(net.get("eth0"), { rx: 26803741, tx: 163159080 });
  assertEquals(net.get("wlp2s0"), { rx: 123, tx: 456 });
  assertEquals([...net.keys()].filter(isPhysicalInterface), ["eth0", "wlp2s0"]);
  assertEquals(["wlp2s0", "enp3s0", "wg0", "tailscale0", "wwan0", "zt0"].map(interfaceKind), [
    "wifi",
    "ethernet",
    "vpn",
    "vpn",
    "mobile",
    "other",
  ]);
});

Deno.test("nvidia-smi csv", () => {
  const [gpu] = parseNvidiaSmi("NVIDIA GeForce RTX 3070, 37, 1520, 8192, 54\n");
  assertEquals(gpu.name, "NVIDIA GeForce RTX 3070");
  assertEquals(gpu.usage, 0.37);
  assertEquals(gpu.memoryTotal, 8192 * 1024 * 1024);
  assertEquals(gpu.celsius, 54);
  assertEquals(parseNvidiaSmi("Tesla T4, [N/A], 0, 15360, [N/A]")[0].usage, undefined);
});

Deno.test("process stat with spaces and parentheses in the name", () => {
  const p = parseProcStat(
    "4242 (Web Content (1)) S 4100 4100 4100 0 -1 4194560 2285 37584 0 784 1500 250 19 86 20 0 31 0 28123 26398720 1581 18446744073709551615",
  );
  assertEquals(p, {
    pid: 4242,
    name: "Web Content (1)",
    state: "S",
    ppid: 4100,
    ticks: 1750,
    threads: 31,
    startTicks: 28123,
    rssPages: 1581,
  });
  assertEquals(parseProcStat("garbage"), undefined);
  // 50 ticks over 2 s on 4 cores (800 total jiffies → 200 per core): 25 % of a core.
  assertEquals(processCpu(1000, 1050, 800, 4), 0.25 * 100 / 100);
});

Deno.test("ps output", () => {
  assertEquals(parsePs("    1     0  6572 root\n 4242  1000 204800 ada\n"), [
    { pid: 1, uid: 0, rss: 6572 * 1024, user: "root" },
    { pid: 4242, uid: 1000, rss: 204800 * 1024, user: "ada" },
  ]);
  const args = parsePsArgs("    1 /sbin/init splash\n    2 [kthreadd]\n");
  assertEquals(args.get(1), "/sbin/init splash");
  assertEquals(args.get(2), "[kthreadd]");
});

Deno.test("formatting", () => {
  assertEquals([bytes(512), bytes(1536), bytes(16477352 * 1024), bytes(5 * 1024 ** 4)], [
    "512 B",
    "1.5 kB",
    "15.7 GB",
    "5.0 TB",
  ]);
  assertEquals(duration(93784), "1 d 2 h 3 min");
  assertEquals(duration(3700), "1 h 1 min");
  assertEquals(duration(42), "42 s");
  assertEquals([0.2, 0.65, 0.8, 0.95].map(levelColor), ["green", "yellow", "orange", "red"]);
  assertEquals(sparkline([0, 0.5, 1]), "▁▅█");
  assertEquals(sparkline([10, 20], 0), "▅█");
  assertEquals(push([1, 2, 3], 4, 3), [2, 3, 4]);
});
