import { assertAlmostEquals, assertEquals } from "@std/assert";
import {
  batteryFromUevent,
  duration,
  health,
  levelColor,
  nextProfile,
  parsePowerProfiles,
  parseTuned,
  parseUdevPower,
  parseUpower,
  profileName,
  statusLine,
  summary,
  timeLeft,
} from "./lib.ts";

const PPD = `  performance:
    CpuDriver:	amd_pstate
    PlatformDriver:	platform_profile
    Degraded:   yes (high-operating-temperature)

* balanced:
    CpuDriver:	amd_pstate
    PlatformDriver:	platform_profile

  power-saver:
    CpuDriver:	amd_pstate
    PlatformDriver:	platform_profile
`;

Deno.test("powerprofilesctl", () => {
  const list = parsePowerProfiles(PPD);
  assertEquals(list.map((p) => [p.id, p.active, p.degraded]), [
    ["performance", false, "high-operating-temperature"],
    ["balanced", true, undefined],
    ["power-saver", false, undefined],
  ]);
  assertEquals(list[1].driver, "amd_pstate, platform_profile");
  assertEquals(nextProfile(list)?.id, "performance");
  assertEquals(
    nextProfile([{ id: "performance", active: true }, { id: "power-saver", active: false }])?.id,
    "power-saver",
  );
  assertEquals([profileName("power-saver"), profileName("throughput-performance")], [
    "Power Saver",
    "Throughput Performance",
  ]);
});

Deno.test("tuned-adm", () => {
  const out = `Available profiles:
- accelerator-performance     - Throughput performance based tuning with disabled higher latency STOP states
- balanced                    - General non-specialized tuned profile
- powersave                   - Optimize for low power consumption
- throughput-performance      - Broadly applicable tuning that provides excellent performance
Current active profile: balanced`;
  const list = parseTuned(out);
  assertEquals(list.length, 4);
  assertEquals(list.find((p) => p.active)?.id, "balanced");
  assertEquals(list[2].description, "Optimize for low power consumption");
});

const DB = `P: /devices/LNXSYSTM:00/LNXSYBUS:00/PNP0A08:00/device:1f/PNP0C09:00/ACPI0003:00/power_supply/AC
E: DEVPATH=/devices/LNXSYSTM:00/LNXSYBUS:00/PNP0A08:00/device:1f/PNP0C09:00/ACPI0003:00/power_supply/AC
E: SUBSYSTEM=power_supply
E: POWER_SUPPLY_NAME=AC
E: POWER_SUPPLY_TYPE=Mains
E: POWER_SUPPLY_ONLINE=0

P: /devices/LNXSYSTM:00/LNXSYBUS:00/PNP0C0A:00/power_supply/BAT0
E: DEVPATH=/devices/LNXSYSTM:00/LNXSYBUS:00/PNP0C0A:00/power_supply/BAT0
E: SUBSYSTEM=power_supply
E: POWER_SUPPLY_NAME=BAT0
E: POWER_SUPPLY_TYPE=Battery
E: POWER_SUPPLY_STATUS=Discharging
E: POWER_SUPPLY_PRESENT=1
E: POWER_SUPPLY_TECHNOLOGY=Li-poly
E: POWER_SUPPLY_CYCLE_COUNT=183
E: POWER_SUPPLY_VOLTAGE_MIN_DESIGN=15440000
E: POWER_SUPPLY_VOLTAGE_NOW=16432000
E: POWER_SUPPLY_POWER_NOW=7712000
E: POWER_SUPPLY_ENERGY_FULL_DESIGN=57000000
E: POWER_SUPPLY_ENERGY_FULL=50530000
E: POWER_SUPPLY_ENERGY_NOW=41420000
E: POWER_SUPPLY_CAPACITY=82
E: POWER_SUPPLY_CAPACITY_LEVEL=Normal
E: POWER_SUPPLY_MODEL_NAME=5B10W13930
E: POWER_SUPPLY_MANUFACTURER=SMP

P: /devices/pci0000:00/0000:00:14.0/usb1/1-2/1-2:1.2/0003:046D:C52B.0003/0003:046D:405E.0004/power_supply/hidpp_battery_0
E: SUBSYSTEM=power_supply
E: POWER_SUPPLY_NAME=hidpp_battery_0
E: POWER_SUPPLY_TYPE=Battery
E: POWER_SUPPLY_SCOPE=Device
E: POWER_SUPPLY_STATUS=Discharging
E: POWER_SUPPLY_CAPACITY=55
E: POWER_SUPPLY_MODEL_NAME=MX Master 3
E: POWER_SUPPLY_MANUFACTURER=Logitech

P: /devices/virtual/net/lo
E: SUBSYSTEM=net
`;

Deno.test("batteries from udev", () => {
  const { batteries, plugged } = parseUdevPower(DB);
  assertEquals(plugged, false);
  assertEquals(batteries.map((b) => [b.id, b.capacity, b.peripheral]), [
    ["BAT0", 82, false],
    ["hidpp_battery_0", 55, true],
  ]);
  const b = batteries[0];
  assertEquals([b.cycles, b.technology, b.model, b.manufacturer], [183, "Li-poly", "5B10W13930", "SMP"]);
  assertAlmostEquals(health(b)!, 0.8865, 0.001);
  assertAlmostEquals(b.power!, 7.712, 1e-9);
  assertAlmostEquals(b.timeLeft!, (41.42 / 7.712) * 3600, 1);
  assertEquals(statusLine(b), "5 h 22 min left");
  assertEquals(batteries[1].model, "MX Master 3");
});

Deno.test("batteries reporting charge instead of energy", () => {
  const b = batteryFromUevent({
    POWER_SUPPLY_NAME: "BAT1",
    POWER_SUPPLY_TYPE: "Battery",
    POWER_SUPPLY_STATUS: "Charging",
    POWER_SUPPLY_VOLTAGE_MIN_DESIGN: "11400000",
    POWER_SUPPLY_VOLTAGE_NOW: "12300000",
    POWER_SUPPLY_CURRENT_NOW: "-2000000",
    POWER_SUPPLY_CHARGE_FULL_DESIGN: "4000000",
    POWER_SUPPLY_CHARGE_FULL: "3600000",
    POWER_SUPPLY_CHARGE_NOW: "1800000",
    POWER_SUPPLY_CYCLE_COUNT: "0",
  })!;
  assertEquals(b.capacity, 50);
  assertAlmostEquals(health(b)!, 0.9, 1e-9);
  assertAlmostEquals(b.power!, 24.6, 1e-9);
  assertEquals(b.cycles, undefined); // 0 means "not reported"
  assertEquals(statusLine(b), "Charging · full in 50 min");
  assertEquals(batteryFromUevent({ POWER_SUPPLY_TYPE: "Battery", POWER_SUPPLY_PRESENT: "0" }), undefined);
  assertEquals(batteryFromUevent({ POWER_SUPPLY_TYPE: "Mains" }), undefined);
});

Deno.test("upower", () => {
  const out = `  native-path:          BAT0
  vendor:               SMP
  model:                5B10W13930
  power supply:         yes
  updated:              Tue 28 Oct 2026 14:02:11 CET (12 seconds ago)
  has history:          yes
  battery
    present:             yes
    rechargeable:        yes
    state:               charging
    energy:              41,42 Wh
    energy-full:         50,53 Wh
    energy-full-design:  57 Wh
    energy-rate:         20,5 W
    voltage:             16,432 V
    charge-cycles:       183
    time to full:        26,7 minutes
    percentage:          82%
    capacity:            88,6491%
    technology:          lithium-polymer
`;
  const b = parseUpower(out)!;
  assertEquals([b.id, b.status, b.capacity, b.cycles, b.peripheral, b.kind], [
    "BAT0",
    "Charging",
    82,
    183,
    false,
    "battery",
  ]);
  assertAlmostEquals(b.timeLeft!, 26.7 * 60, 0.1);
  assertAlmostEquals(health(b)!, 0.8865, 0.001);
  assertEquals(parseUpower(`  native-path:          AC\n  line-power\n    online:              yes\n`), undefined);
  const mouse = parseUpower(`  model:                MX Master 3
  power supply:         no
  mouse
    present:             yes
    state:               discharging
    percentage:          55%
`)!;
  assertEquals([mouse.peripheral, mouse.capacity, mouse.kind], [true, 55, "mouse"]);
});

Deno.test("formatting", () => {
  assertEquals([duration(11520), duration(600), duration(7200)], ["3 h 12 min", "10 min", "2 h"]);
  assertEquals(timeLeft("Full", 50, 50, 5), undefined);
  assertEquals(timeLeft("Discharging", 50, 60, 0), undefined);
  assertEquals([levelColor(80), levelColor(40), levelColor(20), levelColor(5), levelColor(undefined)], [
    "green",
    "yellow",
    "orange",
    "red",
    "gray",
  ]);
  const balanced = { id: "balanced", active: true };
  const bat = { id: "BAT0", status: "Discharging", capacity: 82.4, peripheral: false };
  assertEquals(summary(balanced, bat), "Balanced · 82 %");
  assertEquals(summary(balanced, { ...bat, status: "Charging" }), "Balanced · 82 % ⚡");
  assertEquals(summary(undefined, undefined), null);
  assertEquals(statusLine({ ...bat, status: "Full" }), "Fully charged");
});
