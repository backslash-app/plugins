import { assert, assertEquals } from "@std/assert";
import {
  attachModels,
  driverOf,
  formatValue,
  groupOf,
  headline,
  hwmonPaths,
  levelOf,
  limits,
  newWarnings,
  parseGrep,
  parseHwmon,
  parseNvidiaSmi,
  parseSensorsJson,
  prettyLabel,
  type Reading,
  readingsText,
  readingSubtitle,
  readingTitle,
  sortReadings,
  summaryLine,
} from "./lib.ts";

// `sensors -j` (lm-sensors 3.6) on a desktop with an Intel CPU, an AMD GPU, an NVMe drive and a Nuvoton chip.
const JSON_OUT = `{
   "coretemp-isa-0000":{
      "Adapter": "ISA adapter",
      "Package id 0":{
         "temp1_input": 52.000,
         "temp1_max": 80.000,
         "temp1_crit": 100.000,
         "temp1_crit_alarm": 0.000
      },
      "Core 0":{
         "temp2_input": 48.000,
         "temp2_max": 80.000,
         "temp2_crit": 100.000,
         "temp2_crit_alarm": 0.000
      },
      "Core 1":{
         "temp3_input": 83.000,
         "temp3_max": 80.000,
         "temp3_crit": 100.000,
         "temp3_crit_alarm": 0.000
      }
   },
   "amdgpu-pci-0300":{
      "Adapter": "PCI adapter",
      "vddgfx":{
         "in0_input": 0.806
      },
      "fan1":{
         "fan1_input": 0.000,
         "fan1_min": 0.000,
         "fan1_max": 3300.000
      },
      "edge":{
         "temp1_input": 45.000,
         "temp1_crit": 100.000,
         "temp1_crit_hyst": -273.150,
         "temp1_emergency": 105.000
      },
      "junction":{
         "temp2_input": 51.000,
         "temp2_crit": 110.000,
         "temp2_crit_hyst": -273.150,
         "temp2_emergency": 115.000
      },
      "PPT":{
         "power1_average": 12.000,
         "power1_cap": 203.000
      }
   },
   "nvme-pci-0100":{
      "Adapter": "PCI adapter",
      "Composite":{
         "temp1_input": 38.850,
         "temp1_max": 81.850,
         "temp1_min": -273.150,
         "temp1_crit": 84.850,
         "temp1_alarm": 0.000
      },
      "Sensor 1":{
         "temp2_input": 38.850,
         "temp2_max": 65261.850,
         "temp2_min": -273.150
      }
   },
   "nct6798-isa-0290":{
      "Adapter": "ISA adapter",
      "fan1":{
         "fan1_input": 0.000,
         "fan1_min": 0.000,
         "fan1_alarm": 0.000,
         "fan1_beep": 0.000
      },
      "fan2":{
         "fan2_input": 812.000,
         "fan2_min": 300.000,
         "fan2_alarm": 0.000,
         "fan2_beep": 0.000
      },
      "SYSTIN":{
         "temp1_input": 33.000,
         "temp1_max": 80.000,
         "temp1_max_hyst": 75.000,
         "temp1_alarm": 0.000,
         "temp1_type": 4.000
      },
      "AUXTIN1":{
         "temp4_input": 127.000,
         "temp4_alarm": 0.000
      },
      "AUXTIN2":{
         "temp5_input": -62.000
      }
   },
   "acpitz-acpi-0":{
      "Adapter": "ACPI interface",
      "temp1":{
         "temp1_input": 27.800
      }
   }
}`;

Deno.test("sensors -j", () => {
  const r = parseSensorsJson(JSON_OUT);
  assertEquals(r.map((x) => `${x.driver}/${x.label}`), [
    "coretemp/Package id 0",
    "coretemp/Core 0",
    "coretemp/Core 1",
    "amdgpu/fan1",
    "amdgpu/edge",
    "amdgpu/junction",
    "nvme/Composite",
    "nvme/Sensor 1",
    "nct6798/fan2",
    "nct6798/SYSTIN",
    "acpitz/temp1",
  ]);
  const pkg = r[0];
  assertEquals(pkg, {
    id: "coretemp-isa-0000/Package id 0",
    chip: "coretemp-isa-0000",
    driver: "coretemp",
    adapter: "ISA adapter",
    label: "Package id 0",
    unit: "°C",
    value: 52,
    high: 80,
    crit: 100,
    alarm: undefined,
    group: "CPU",
  });
  const edge = r[4];
  assertEquals(edge.crit, 100);
  assertEquals(edge.high, undefined);
  assertEquals(r[3].unit, "RPM");
  assertEquals(r[3].value, 0); // GPU fans stop on purpose: kept
  assertEquals(r[7].high, undefined); // 65261 °C is "not set"
  assertEquals(r[8].min, 300);
  assertEquals(r[9].group, "Motherboard");
  assertEquals(parseSensorsJson("garbage"), []);
  // A warning before the JSON.
  assertEquals(
    parseSensorsJson(
      `ERROR: Can't get value of subfeature temp1_input: Can't read\n{"x-isa-0":{"t":{"temp1_input":40}}}`,
    ).length,
    1,
  );
});

Deno.test("groups and names", () => {
  assertEquals(driverOf("r8169_0_e00:00-mdio-0"), "r8169_0_e00:00");
  assertEquals(groupOf("k10temp"), "CPU");
  assertEquals(groupOf("nvme"), "Storage");
  assertEquals(groupOf("spd5118"), "Memory");
  assertEquals(groupOf("iwlwifi_1"), "Network");
  assertEquals(groupOf("BAT0"), "Battery");
  assertEquals(groupOf("thinkpad"), "Motherboard");
  assertEquals(groupOf("mystery"), "Other");
  assertEquals(prettyLabel("Tccd1"), "CCD 1");
  assertEquals(prettyLabel("Tctl"), "Package (Tctl)");
  assertEquals(prettyLabel("junction"), "Hotspot");
  assertEquals(prettyLabel("temp1"), "Temperature 1");
  assertEquals(prettyLabel("Package id 1"), "Package 1");
});

Deno.test("limits and levels", () => {
  const r = parseSensorsJson(JSON_OUT);
  const [pkg, , core1] = r;
  assertEquals(levelOf(pkg), "ok");
  assertEquals(levelOf(core1), "high");
  assertEquals(levelOf({ ...pkg, value: 75 }), "warm");
  assertEquals(levelOf({ ...pkg, value: 100 }), "critical");
  assertEquals(levelOf({ ...pkg, alarm: true }), "critical");
  // Edge has only a critical mark: high is 10 below.
  assertEquals(limits(r[4]), { high: 90, crit: 100, reported: true });
  // A drive with no limits uses the usual ones.
  const bare: Reading = { ...r[6], high: undefined, crit: undefined };
  assertEquals(limits(bare), { high: 70, crit: 80, reported: false });
  // One user-set mark for all.
  assertEquals(limits(pkg, 60).high, 60);
  assertEquals(levelOf(pkg, 50), "high");
  // A fan under its minimum.
  assertEquals(levelOf({ ...r[8], value: 200 }), "high");
  assertEquals(levelOf(r[8]), "ok");
});

Deno.test("hwmon fallback", () => {
  const paths = hwmonPaths(2, 2, 1);
  assertEquals(paths.length, 2 * (2 + 2 * 4 + 3));
  const grep = [
    "/sys/class/hwmon/hwmon0/name:acpitz",
    "/sys/class/hwmon/hwmon0/temp1_input:27800",
    "/sys/class/hwmon/hwmon0/temp1_crit:105000",
    "/sys/class/hwmon/hwmon1/name:nvme",
    "/sys/class/hwmon/hwmon1/device/model:Samsung SSD 980 PRO 1TB                 ",
    "/sys/class/hwmon/hwmon1/temp1_input:38850",
    "/sys/class/hwmon/hwmon1/temp1_label:Composite",
    "/sys/class/hwmon/hwmon1/temp1_max:81850",
    "/sys/class/hwmon/hwmon1/temp1_crit:84850",
    "/sys/class/hwmon/hwmon1/temp2_input:-273150",
    "/sys/class/hwmon/hwmon2/name:nct6798",
    "/sys/class/hwmon/hwmon2/fan1_input:0",
    "/sys/class/hwmon/hwmon2/fan2_input:1024",
    "/sys/class/hwmon/hwmon2/fan2_min:300",
    "/sys/class/hwmon/hwmon3/name:k10temp",
    "/sys/class/hwmon/hwmon3/temp1_input:61250",
    "/sys/class/hwmon/hwmon3/temp1_label:Tctl",
    "",
  ].join("\n");
  const r = parseHwmon(parseGrep(grep), 4);
  assertEquals(r.map((x) => `${x.driver}/${x.label}/${x.value}`), [
    "acpitz/temp1/27.8",
    "nvme/Composite/38.85",
    "nct6798/fan2/1024",
    "k10temp/Tctl/61.25",
  ]);
  assertEquals(r[0].crit, 105);
  assertEquals(r[1].model, "Samsung SSD 980 PRO 1TB");
  assertEquals(r[1].high, 81.85);
  assertEquals(readingTitle(r[1]), "Samsung SSD 980 PRO 1TB");
  assertEquals(readingSubtitle(r[1]), "Samsung SSD 980 PRO 1TB · NVMe drive");
  assertEquals(r[2].min, 300);

  // The model goes to lm-sensors' only NVMe chip.
  const lm = attachModels(parseSensorsJson(JSON_OUT), r);
  assertEquals(lm.find((x) => x.label === "Composite")?.model, "Samsung SSD 980 PRO 1TB");
});

Deno.test("nvidia-smi", () => {
  const r = parseNvidiaSmi(
    "0, NVIDIA GeForce RTX 4070, 47, 30\n1, NVIDIA GeForce GTX 1050 Ti with Max-Q Design, 55, [N/A]\n",
  );
  assertEquals(r.length, 3);
  assertEquals(r[0], {
    id: "nvidia-gpu-0/GPU",
    chip: "nvidia-gpu-0",
    driver: "nvidia",
    adapter: "NVIDIA GeForce RTX 4070",
    label: "GPU",
    unit: "°C",
    value: 47,
    group: "GPU",
  });
  assertEquals(r[1].unit, "%");
  assertEquals(formatValue(r[1]), "30 %");
  assertEquals(readingSubtitle(r[0]), "NVIDIA GeForce RTX 4070 · NVIDIA GPU");
  assertEquals(parseNvidiaSmi(""), []);
});

Deno.test("summary, order and text", () => {
  const r = parseSensorsJson(JSON_OUT);
  assertEquals(headline(r, "CPU")?.label, "Package id 0");
  assertEquals(headline(r, "GPU")?.label, "edge");
  assertEquals(summaryLine(r), "CPU 52 °C · GPU 45 °C · Drive 39 °C");
  assertEquals(summaryLine(r, true), "CPU 126 °F · GPU 113 °F · Drive 102 °F");
  const sorted = sortReadings(r);
  assertEquals(sorted[0].group, "CPU");
  // GPU temperatures before the GPU fan.
  assertEquals(sorted.filter((x) => x.group === "GPU").map((x) => x.label), ["edge", "junction", "fan1"]);
  assertEquals(sorted.at(-1)?.group, "Motherboard");
  const text = readingsText(r);
  assert(text.startsWith("coretemp-isa-0000 · Package id 0: 52 °C (high 80 °C, crit 100 °C)"));
  assert(text.includes("nct6798-isa-0290 · fan2: 812 RPM"));
});

Deno.test("background warnings: once per episode, again when it gets worse", () => {
  const base = parseSensorsJson(JSON_OUT);
  const first = newWarnings(base, {});
  assertEquals(first.warn.map((w) => [w.reading.label, w.level]), [["Core 1", "high"]]);
  assertEquals(first.next, { "coretemp-isa-0000/Core 1": "high" });

  // Still hot: no new warning.
  const again = newWarnings(base, first.next);
  assertEquals(again.warn, []);

  // Critical now: warn again.
  const worse = base.map((r) => (r.label === "Core 1" ? { ...r, value: 101 } : r));
  const third = newWarnings(worse, again.next);
  assertEquals(third.warn.map((w) => w.level), ["critical"]);

  // Back to 78 °C (close to the 80 °C mark): remembered, no warning.
  const close = base.map((r) => (r.label === "Core 1" ? { ...r, value: 78 } : r));
  const fourth = newWarnings(close, third.next);
  assertEquals(fourth.warn, []);
  assertEquals(fourth.next["coretemp-isa-0000/Core 1"], "critical");

  // Cooled down: forgotten.
  const cool = base.map((r) => (r.label === "Core 1" ? { ...r, value: 60 } : r));
  assertEquals(newWarnings(cool, fourth.next).next, {});
});
