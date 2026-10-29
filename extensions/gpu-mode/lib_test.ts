import { assert, assertEquals } from "@std/assert";
import {
  asleep,
  classify,
  commandLine,
  dedupeApps,
  envPrefix,
  launchArgs,
  marketingName,
  mergeProcesses,
  modes,
  offloadEnv,
  parseComputeApps,
  parseDesktop,
  parseFuser,
  parseLspci,
  parseMode,
  parseNvidiaGpus,
  parseRequiredAction,
  parseSupported,
  parseSwitcheroo,
  slotFromDriPrime,
  slotOfDriLink,
  switchCommand,
} from "./lib.ts";

const LSPCI = `Slot:	0000:00:02.0
Class:	VGA compatible controller [0300]
Vendor:	Intel Corporation [8086]
Device:	TigerLake-LP GT2 [Iris Xe Graphics] [9a49]
SVendor:	Lenovo [17aa]
SDevice:	Device [22d8]
Rev:	01
ProgIf:	00
Driver:	i915
Module:	i915

Slot:	0000:00:14.0
Class:	USB controller [0c03]
Vendor:	Intel Corporation [8086]
Device:	Tiger Lake-LP USB 3.2 Gen 2x1 xHCI Host Controller [a0ed]
Driver:	xhci_hcd

Slot:	0000:01:00.0
Class:	3D controller [0302]
Vendor:	NVIDIA Corporation [10de]
Device:	GA107M [GeForce RTX 3050 Mobile] [25a2]
SVendor:	Lenovo [17aa]
SDevice:	Device [22d8]
Rev:	a1
Driver:	nvidia
Module:	nouveau
Module:	nvidia_drm
Module:	nvidia
`;

Deno.test("lspci: display controllers with their roles", () => {
  const gpus = parseLspci(LSPCI);
  assertEquals(gpus.map((g) => [g.vendor, g.name, g.driver, g.discrete]), [
    ["Intel", "Iris Xe Graphics", "i915", false],
    ["NVIDIA", "GeForce RTX 3050 Mobile", "nvidia", true],
  ]);
  assertEquals(gpus[1].slot, "0000:01:00.0");
  assertEquals(gpus[1].vendorId, "10de");
  assertEquals(gpus[0].subsystem, "Lenovo");
});

Deno.test("lspci: one GPU, AMD hybrids, slots without a domain", () => {
  const one = parseLspci(LSPCI.split("\n\n")[0]);
  assertEquals(one[0].discrete, undefined);
  const amd = parseLspci(`Slot:	05:00.0
Class:	VGA compatible controller [0300]
Vendor:	Advanced Micro Devices, Inc. [AMD/ATI] [1002]
Device:	Rembrandt [Radeon 680M] [1681]

Slot:	01:00.0
Class:	VGA compatible controller [0300]
Vendor:	NVIDIA Corporation [10de]
Device:	AD107M [GeForce RTX 4060 Max-Q / Mobile] [28e0]
`);
  assertEquals(amd.map((g) => [g.vendor, g.slot, g.discrete]), [["AMD", "0000:05:00.0", false], [
    "NVIDIA",
    "0000:01:00.0",
    true,
  ]]);
  assertEquals(classify(amd, "0000:01:00.0").map((g) => g.discrete), [true, false]);
  assertEquals(marketingName("Navi 23 [Radeon RX 6600M] [73ff]".replace(/ \[73ff\]$/, "")), "Radeon RX 6600M");
  assertEquals(marketingName("Device 1234"), "Device 1234");
});

Deno.test("modes: current mode in each tool's words", () => {
  assertEquals(parseMode("supergfxctl", "hybrid\n"), "Hybrid");
  assertEquals(parseMode("supergfxctl", "AsusMuxDgpu"), "AsusMuxDgpu");
  assertEquals(parseMode("envycontrol", "Current graphics mode is: hybrid\n"), "hybrid");
  assertEquals(parseMode("envycontrol", "integrated"), "integrated");
  assertEquals(parseMode("prime-select", "on-demand\n"), "on-demand");
  assertEquals(parseMode("system76-power", "nvidia\n"), "nvidia");
  assertEquals(parseMode("prime-select", ""), undefined);
});

Deno.test("modes: supergfxctl's supported list and required action", () => {
  assertEquals(parseSupported("[Integrated, Hybrid, AsusMuxDgpu]\n"), ["Integrated", "Hybrid", "AsusMuxDgpu"]);
  const m = modes("supergfxctl", ["Integrated", "Hybrid", "AsusMuxDgpu"]);
  assertEquals(m.map((x) => [x.title, x.needs]), [["Integrated", "logout"], ["Hybrid", "logout"], [
    "Discrete (MUX)",
    "reboot",
  ]]);
  assertEquals(modes("prime-select").map((x) => x.id), ["intel", "on-demand", "nvidia"]);
  assertEquals(
    parseRequiredAction("Graphics mode changed to Integrated. Required user action is: Logout\n"),
    "logout",
  );
  assertEquals(parseRequiredAction("Required user action is: Reboot"), "reboot");
  assertEquals(parseRequiredAction("Required user action is: Nothing"), "none");
  assertEquals(parseRequiredAction("Done"), undefined);
});

Deno.test("modes: switch commands, as root where needed", () => {
  assertEquals(switchCommand("supergfxctl", "Hybrid"), { argv: ["supergfxctl", "-m", "Hybrid"], root: false });
  assertEquals(switchCommand("envycontrol", "integrated"), { argv: ["envycontrol", "-s", "integrated"], root: true });
  assertEquals(switchCommand("prime-select", "on-demand").argv, ["prime-select", "on-demand"]);
  assertEquals(switchCommand("system76-power", "hybrid").argv, ["system76-power", "graphics", "hybrid"]);
  assert(asleep("suspended"));
  assert(asleep("dgpu disabled"));
  assert(!asleep("active"));
  assert(!asleep(undefined));
});

const SWITCHEROO = `Device: 0
  Name:        Intel Corporation TigerLake-LP GT2 [Iris Xe Graphics]
  Default:     yes
  Environment: DRI_PRIME=pci-0000_00_02_0

Device: 1
  Name:        NVIDIA Corporation GA107M [GeForce RTX 3050 Mobile]
  Default:     no
  Environment: __GLX_VENDOR_LIBRARY_NAME=nvidia __NV_PRIME_RENDER_OFFLOAD=1 __VK_LAYER_NV_optimus=NVIDIA_only
`;

Deno.test("switcheroo-control and offload variables", () => {
  const list = parseSwitcheroo(SWITCHEROO);
  assertEquals(list.map((g) => [g.index, g.default]), [[0, true], [1, false]]);
  assertEquals(list[1].env.__NV_PRIME_RENDER_OFFLOAD, "1");
  assertEquals(slotFromDriPrime(list[0].env.DRI_PRIME), "0000:00:02.0");
  const [, nv] = parseLspci(LSPCI);
  assertEquals(offloadEnv(nv).__GLX_VENDOR_LIBRARY_NAME, "nvidia");
  assertEquals(offloadEnv(nv, list[1]), list[1].env);
  assertEquals(offloadEnv({ ...nv, vendorId: "1002", driver: "amdgpu" }), { DRI_PRIME: "pci-0000_01_00_0" });
  assertEquals(offloadEnv(undefined), { DRI_PRIME: "1" });
  assertEquals(envPrefix({ DRI_PRIME: "1", A: "b c" }), "DRI_PRIME=1 A='b c'");
});

Deno.test("nvidia-smi: GPU state and compute apps", () => {
  const [gpu] = parseNvidiaGpus(
    "0, NVIDIA GeForce RTX 3050 Laptop GPU, 00000000:01:00.0, 550.78, 45, 12, 410, 4096, [N/A], P8\n",
  );
  assertEquals(gpu.name, "NVIDIA GeForce RTX 3050 Laptop GPU");
  assertEquals(gpu.utilization, 12);
  assertEquals(gpu.memoryTotal, 4096);
  assertEquals(gpu.power, undefined);
  assertEquals(gpu.pstate, "P8");
  assertEquals(parseComputeApps("4242, /usr/bin/python3, 1536\n"), [
    { pid: 4242, command: "python3", memory: 1536, devices: ["CUDA"] },
  ]);
  assertEquals(parseComputeApps("No running processes found"), []);
});

Deno.test("fuser: processes per device, merged with nvidia-smi", () => {
  const fuser = parseFuser(`                     USER        PID ACCESS COMMAND
/dev/dri/renderD129: steven     2345 F...m firefox
                     steven     3456 F.... steam
/dev/nvidia0:        root     kernel mount /dev/nvidia0
                     steven     2345 F...m firefox
`);
  assertEquals(fuser.map((p) => [p.pid, p.command, p.devices]), [
    [2345, "firefox", ["/dev/dri/renderD129", "/dev/nvidia0"]],
    [3456, "steam", ["/dev/dri/renderD129"]],
  ]);
  const merged = mergeProcesses(fuser, [{ pid: 3456, command: "steam", memory: 300, devices: ["CUDA"] }]);
  assertEquals(merged[0].pid, 3456);
  assertEquals(merged[0].devices, ["/dev/dri/renderD129", "CUDA"]);
  assertEquals(slotOfDriLink("pci-0000:01:00.0-render"), "0000:01:00.0");
  assertEquals(slotOfDriLink("platform-simple-framebuffer.0-card"), undefined);
});

Deno.test("desktop entries and launching", () => {
  const app = parseDesktop(
    "/usr/share/applications/blender.desktop",
    `[Desktop Entry]
Name=Blender
GenericName=3D modeler
Exec=blender %f
Icon=blender
Terminal=false
Type=Application
PrefersNonDefaultGPU=true
Keywords=3d;cg;modeling;

[Desktop Action new]
Name=New File
Exec=blender --factory-startup
`,
  )!;
  assertEquals(app.name, "Blender");
  assertEquals(app.comment, "3D modeler");
  assertEquals(app.prefersDgpu, true);
  assertEquals(app.keywords, ["3d", "cg", "modeling"]);
  assertEquals(commandLine(app.exec), "blender");
  assertEquals(
    commandLine("flatpak run --command=app org.App @@u %U @@ 100%%"),
    "flatpak run --command=app org.App @@u @@ 100%",
  );
  assertEquals(parseDesktop("x.desktop", "[Desktop Entry]\nName=Hidden\nExec=x\nNoDisplay=true\n"), undefined);
  assertEquals(parseDesktop("x.desktop", "[Desktop Entry]\nName=Link\nType=Link\nURL=https://x\n"), undefined);

  const dup = dedupeApps([{ ...app, file: "/home/a/.local/share/applications/blender.desktop" }, app]);
  assertEquals(dup.length, 1);
  assertEquals(dup[0].file, "/home/a/.local/share/applications/blender.desktop");

  const args = launchArgs("blender", { DRI_PRIME: "1" }, "Blender 4", 42);
  assertEquals(args.slice(-4), ["--", "/bin/sh", "-c", "exec blender"]);
  assert(args.includes("--setenv=DRI_PRIME=1"));
  assert(args.includes("--unit=app-backslash-dgpu-blender-4-42"));
});
